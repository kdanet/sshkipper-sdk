// The runtime of a process module (spec/protocol.md §4): JSON-RPC 2.0 over stdio, one message per line. A module
// written with it is a map of async handlers; the app's services (exec on a server, secrets, storage) are `ctx.host`.

import type { AIChatRequest, AIChatResult, AIDelta, AIModel, Context, EventAnswer, ExecResult, Json, Op, Request, ScreenEvent } from "./types.ts";

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

/** An event's context: the call's, plus `push` — ops to this screen at any time later (live data, `ui/push`). */
export interface EventContext extends HandlerContext {
  push(ops: Op[]): void;
}

/** An answer of a model provider streaming: `delta` sends a piece now (`ai/delta`); `signal` — the user stopped it. */
export interface AIChatContext {
  delta(d: AIDelta): void;
  signal: AbortSignal;
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
}

/** A model provider (`contributes.ai`, spec/protocol.md §12). */
export interface AIProviderDefinition {
  models(request: { provider: string; settings: Record<string, Json>; secrets: Record<string, string> }): AIModel[] | string[] | Promise<AIModel[] | string[]>;
  chat(request: AIChatRequest, ctx: AIChatContext): AIChatResult | void | Promise<AIChatResult | void>;
}

export interface ModuleDefinition {
  handlers: Record<string, HandlerFn>;
  /** A model provider: `ai/models`, `ai/chat` (with `ai/delta`), `ai/cancel`. */
  ai?: AIProviderDefinition;
  /** A live screen's events (spec/protocol.md §11): what the user did → ops changing the screen (and completions). */
  onEvent?: (event: ScreenEvent, ctx: EventContext) => EventAnswer | Promise<EventAnswer>;
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

  async function call(id: number | string, params: Request, abort: AbortController) {
    const fn = def.handlers[params.handler];
    if (!fn) { running.delete(String(id)); return send({ id, error: { code: Codes.methodNotFound, message: `no handler ${params.handler}` } }); }
    // Cancelled while it waited for setup: it doesn't run.
    if (abort.signal.aborted) { running.delete(String(id)); return; }
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

  /** Ops to a screen at any time (`ui/push`): live data. The app takes them only for screens of this module. */
  function push(screen: string, ops: Op[]) {
    if (ops.length) send({ method: "ui/push", params: { screen, ops } });
  }

  /** A live screen's event (§11.3): `onEvent` answers with ops (and completions). */
  async function event(id: number | string, params: { event: ScreenEvent; context: Context }, abort: AbortController) {
    try {
      if (!def.onEvent) return send({ id, result: null });
      const ctx: EventContext = { ...params.context, host: hostFor(params.context), signal: abort.signal, push: (ops) => push(params.event.screen, ops) };
      const result = await def.onEvent(params.event, ctx);
      if (!abort.signal.aborted) send({ id, result: result === undefined ? null : result });
    } catch (e) {
      if (abort.signal.aborted) return;
      const err = e instanceof ModuleError ? e : new ModuleError(e instanceof Error ? e.message : String(e));
      send({ id, error: { code: err.code, message: err.message } });
    } finally {
      running.delete(String(id));
    }
  }

  /** `ai/models`, `ai/chat` (§12): answered by `def.ai`; `ai/cancel` aborts a chat by its stream id. */
  const chats = new Map<string, AbortController>();
  async function ai(id: number | string, method: string, params: any, abort: AbortController) {
    try {
      if (!def.ai) return send({ id, error: { code: Codes.methodNotFound, message: "no model provider" } });
      if (method === "ai/models") {
        const list = await def.ai.models({ provider: params?.provider ?? "", settings: params?.settings ?? {}, secrets: params?.secrets ?? {} });
        if (!abort.signal.aborted) send({ id, result: { models: list as Json } });
        return;
      }
      const stream = String(params?.id ?? "");
      chats.set(stream, abort);
      const ctx: AIChatContext = {
        delta: (d) => { if (!abort.signal.aborted) send({ method: "ai/delta", params: { ...d, id: stream } }); },
        signal: abort.signal,
        log: (level, message) => send({ method: "host/log", params: { level, message } }),
      };
      const result = await def.ai.chat(params as AIChatRequest, ctx);
      if (!abort.signal.aborted) send({ id, result: (result ?? {}) as Json });
    } catch (e) {
      if (abort.signal.aborted) return;
      const err = e instanceof ModuleError ? e : new ModuleError(e instanceof Error ? e.message : String(e));
      send({ id, error: { code: err.code, message: err.message } });
    } finally {
      running.delete(String(id));
      if (params?.id !== undefined && chats.get(String(params.id)) === abort) chats.delete(String(params.id));
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
        {
          // Known to `cancel` from the moment it arrives, also while it waits for setup.
          const abort = new AbortController();
          running.set(String(msg.id), abort);
          try { await ready; } catch {
            running.delete(String(msg.id));
            return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } });
          }
          return call(msg.id, msg.params as Request, abort);
        }
      case "ui/event":
        if (!ready) return send({ id: msg.id, error: { code: Codes.invalidRequest, message: "not initialized" } });
        {
          const abort = new AbortController();
          running.set(String(msg.id), abort);
          try { await ready; } catch {
            running.delete(String(msg.id));
            return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } });
          }
          return event(msg.id, msg.params, abort);
        }
      case "ai/models":
      case "ai/chat":
        if (!ready) return send({ id: msg.id, error: { code: Codes.invalidRequest, message: "not initialized" } });
        {
          const abort = new AbortController();
          running.set(String(msg.id), abort);
          try { await ready; } catch {
            running.delete(String(msg.id));
            return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } });
          }
          return ai(msg.id, msg.method, msg.params, abort);
        }
      case "ai/cancel":
        chats.get(String(msg.params?.id))?.abort();
        return;
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
  return { request, running, push };
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
