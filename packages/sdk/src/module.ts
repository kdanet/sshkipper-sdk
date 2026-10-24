// The runtime of a process module (spec/protocol.md §4): JSON-RPC 2.0 over stdio, one message per line. A module
// written with it is a map of async handlers; the app's services (exec on a server, secrets, storage) are `ctx.host`.

import type { Context, ExecResult, Json, Request } from "./types.ts";

/** A failure the app shows to the user (or gives to the model / fails the automation block with). */
export class ModuleError extends Error {
  code: number;
  constructor(message: string, code = -32000) {
    super(message);
    this.code = code;
  }
}

export const Codes = {
  parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602,
  handlerFailed: -32000, permission: -32001, cancelled: -32002, timeout: -32003,
} as const;

/** What the app does for a module (§4.3). Each call needs the matching permission in the manifest. */
export interface Host {
  /** A command on a server, over the app's SSH session (bastions, 2FA, containers handled by the app). */
  exec(command: string, opts?: { server?: string; stdin?: string; timeout?: number; sudo?: boolean; container?: string }): Promise<ExecResult>;
  /** A secret setting of the module for the call's server. */
  secret(key: string, server?: string): Promise<string>;
  store: { get(key: string): Promise<Json | null>; set(key: string, value: Json | null): Promise<void> };
  notify(title: string, text: string): Promise<void>;
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
}

export interface HandlerContext extends Context {
  host: Host;
  /** Aborted when the app cancels the call (the page closed, the user stopped it). */
  signal: AbortSignal;
}

export type HandlerFn = (input: Record<string, Json>, ctx: HandlerContext) => Promise<Json | void> | Json | void;

export interface ModuleDefinition {
  handlers: Record<string, HandlerFn>;
  /** Called once after initialize (the app's version, the locale). */
  setup?: (info: { app: string; locale: string; module: { id: string; version: string } }) => void | Promise<void>;
}

type Pending = { resolve: (v: Json) => void; reject: (e: ModuleError) => void };

/** Streams to talk over: process stdio by default, anything with the same shape in tests. */
export interface Transport {
  write(line: string): void;
  onLine(cb: (line: string) => void): void;
  onClose(cb: () => void): void;
  /** Ends the program after shutdown or a closed stdin (tests pass a no-op). */
  exit?: () => void;
}

export function stdioTransport(): Transport {
  // stdout is the protocol: a console.log in a handler goes to stderr (the module's log in the app) instead.
  console.log = (...a: unknown[]) => console.error(...a);
  console.info = console.log;
  let buffer = "";
  const lineCbs: ((l: string) => void)[] = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) for (const cb of lineCbs) cb(line);
    }
  });
  return {
    write: (line) => process.stdout.write(line + "\n"),
    onLine: (cb) => lineCbs.push(cb),
    onClose: (cb) => process.stdin.on("end", cb),
  };
}

/** Runs the module until the app closes stdin. Returns the connection (tests use it). */
export function serve(def: ModuleDefinition, transport: Transport = stdioTransport()) {
  let nextID = 1;
  const pending = new Map<number, Pending>();
  const running = new Map<string, AbortController>();
  // Set by `initialize`, settled when `setup` is done: calls that come meanwhile wait for it.
  let ready: Promise<void> | null = null;
  const exit = transport.exit ?? (() => process.exit(0));

  const send = (msg: Record<string, unknown>) => transport.write(JSON.stringify({ jsonrpc: "2.0", ...msg }));

  function request(method: string, params: Json): Promise<Json> {
    const id = nextID++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
  }

  function hostFor(ctx: Context): Host {
    const server = ctx.server?.id;
    return {
      async exec(command, opts = {}) {
        const r = await request("host/exec", {
          server: opts.server ?? server ?? null, command,
          ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
          ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
          ...(opts.sudo ? { sudo: true } : {}),
          ...(opts.container ?? ctx.container ? { container: opts.container ?? ctx.container! } : {}),
        });
        return r as unknown as ExecResult;
      },
      async secret(key, s) {
        const r = (await request("host/secret", { server: s ?? server ?? null, key })) as { value: string };
        return r.value;
      },
      store: {
        async get(key) { return ((await request("host/store/get", { key })) as { value: Json }).value ?? null; },
        async set(key, value) { await request("host/store/set", { key, value }); },
      },
      async notify(title, text) { await request("host/notify", { title, text }); },
      log(level, message) { send({ method: "host/log", params: { level, message } }); },
    };
  }

  async function call(id: number | string, params: Request) {
    const fn = def.handlers[params.handler];
    if (!fn) return send({ id, error: { code: Codes.methodNotFound, message: `no handler ${params.handler}` } });
    const abort = new AbortController();
    running.set(String(id), abort);
    try {
      const ctx: HandlerContext = { ...params.context, host: hostFor(params.context), signal: abort.signal };
      const result = await fn(params.input ?? {}, ctx);
      if (!abort.signal.aborted) send({ id, result: result === undefined ? null : result });
    } catch (e) {
      if (abort.signal.aborted) return;
      const err = e instanceof ModuleError ? e : new ModuleError(e instanceof Error ? e.message : String(e));
      send({ id, error: { code: err.code, message: err.message } });
    } finally {
      running.delete(String(id));
    }
  }

  transport.onLine(async (line) => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: Codes.parse, message: "not JSON" } }); }
    // An answer to one of our requests.
    if (msg.method === undefined && msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new ModuleError(msg.error.message ?? "error", msg.error.code ?? Codes.handlerFailed));
      else p.resolve(msg.result ?? null);
      return;
    }
    switch (msg.method) {
      case "initialize":
        ready ??= (async () => {
          if (def.setup) await def.setup({ app: msg.params?.app ?? "", locale: msg.params?.locale ?? "en", module: msg.params?.module ?? { id: "", version: "" } });
        })();
        try { await ready; } catch (e) {
          return send({ id: msg.id, error: { code: Codes.handlerFailed, message: `setup failed: ${e instanceof Error ? e.message : String(e)}` } });
        }
        return send({ id: msg.id, result: { handlers: Object.keys(def.handlers) } });
      case "handler/call":
        if (!ready) return send({ id: msg.id, error: { code: Codes.invalidRequest, message: "not initialized" } });
        try { await ready; } catch {
          return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } });
        }
        return call(msg.id, msg.params as Request);
      case "cancel":
        running.get(String(msg.params?.id))?.abort();
        return;
      case "shutdown":
        send({ id: msg.id, result: null });
        setTimeout(() => exit(), 10);
        return;
      default:
        if (msg.id !== undefined) send({ id: msg.id, error: { code: Codes.methodNotFound, message: `no method ${msg.method}` } });
    }
  });
  transport.onClose(() => exit());
  return { request, running };
}

/** Defines and serves a module in one line: `defineModule({ handlers: { … } })`. */
export function defineModule(def: ModuleDefinition) {
  return serve(def);
}

/** A single-quoted word for a shell command of `host.exec`: `quote("it's")` → `'it'\''s'`. */
export function quote(s: string): string {
  return "'" + s.replaceAll("'", "'\\''") + "'";
}

/** The text for the call's language: `tr(ctx, { ru: "Готово", en: "Done" })` (English when there's no such). */
export function tr(ctx: { locale: string }, t: Record<string, string>): string {
  const base = ctx.locale.split(/[-_]/)[0];
  return t[ctx.locale] ?? t[base] ?? t.en ?? Object.values(t)[0] ?? "";
}
