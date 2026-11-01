// The runtime of a process module (spec/protocol.md §4): JSON-RPC 2.0 over stdio, one message per line. A module
// written with it is a map of async handlers; the app's services (exec on a server, secrets, storage) are `ctx.host`.

import type { ConsoleNode, Context, EventAnswer, ExecResult, ImportFile, ImportResult, Json, Op, Request, ScreenEvent } from "./types.ts";

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

/** A console the app opened (spec/protocol.md §13): bytes both ways, the terminal's size, its end. */
export interface ConsoleSession {
  /** The session's id (the app's). */
  readonly id: string;
  /** The contribution's id (`contributes.console[].id`). */
  readonly console: string;
  readonly node: ConsoleNode;
  /** The terminal's size now (updated before `onResize` callbacks run). */
  readonly cols: number;
  readonly rows: number;
  /** Bytes to the terminal: a string goes as UTF-8. Big writes are split into chunks the app takes (≤ 64 KB). */
  write(data: string | Uint8Array): void;
  /** Ends the console from this side: the tab says it closed (with `reason`). */
  close(reason?: string): void;
  /** What the user typed (keys, pastes — as the terminal encodes them: Return is "\r"). */
  onInput(cb: (data: Uint8Array) => void): void;
  onResize(cb: (cols: number, rows: number) => void): void;
  /** The tab was closed (or the program stops): stop whatever feeds it. */
  onClose(cb: () => void): void;
  /** Aborted when the console closes, from either side. */
  readonly signal: AbortSignal;
}

export type ConsoleFn = (session: ConsoleSession, ctx: HandlerContext) => void | Promise<void>;
export type ImporterFn = (file: ImportFile, ctx: HandlerContext) => ImportResult | Promise<ImportResult>;

export interface ModuleDefinition {
  handlers: Record<string, HandlerFn>;
  /** A live screen's events (spec/protocol.md §11): what the user did → ops changing the screen (and completions). */
  onEvent?: (event: ScreenEvent, ctx: EventContext) => EventAnswer | Promise<EventAnswer>;
  /** `contributes.import[]` by id (§12): the file the user picked → folders and connections. */
  importers?: Record<string, ImporterFn>;
  /** `contributes.console[]` by id (§13): called when the app opens one; write to the session, listen to its input. */
  consoles?: Record<string, ConsoleFn>;
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

  /** `import/parse` (§12): the file's bytes to the importer, its answer back. */
  async function importFile(id: number | string, params: any, abort: AbortController) {
    try {
      const fn = def.importers?.[params?.importer];
      if (!fn) return send({ id, error: { code: Codes.methodNotFound, message: `no importer ${params?.importer}` } });
      const data = new Uint8Array(Buffer.from(String(params.data ?? ""), "base64"));
      const file: ImportFile = { importer: params.importer, name: String(params.name ?? ""), size: data.length, data, text: () => new TextDecoder().decode(data) };
      // No server: an import happens on this Mac, before any connection exists.
      const context = { settings: {}, locale: params.locale ?? "en", sdk: 1, app: "" } as unknown as Context;
      const ctx: HandlerContext = { ...context, host: hostFor(context), signal: abort.signal };
      const result = await fn(file, ctx);
      if (!abort.signal.aborted) send({ id, result: result as unknown as Json });
    } catch (e) {
      if (abort.signal.aborted) return;
      const err = e instanceof ModuleError ? e : new ModuleError(e instanceof Error ? e.message : String(e));
      send({ id, error: { code: err.code, message: err.message } });
    } finally {
      running.delete(String(id));
    }
  }

  /** Open consoles by session id: their callbacks and state. */
  type OpenConsole = { input: ((d: Uint8Array) => void)[]; resize: ((c: number, r: number) => void)[]; close: (() => void)[]; abort: AbortController; size: { cols: number; rows: number } };
  const consoles = new Map<string, OpenConsole>();
  const CHUNK = 48 * 1024;

  function endConsole(session: string) {
    const c = consoles.get(session);
    if (!c) return;
    consoles.delete(session);
    c.abort.abort();
    for (const cb of c.close) { try { cb(); } catch { /* the author's callback */ } }
  }

  /** `console/open` (§13): the session handed to the console's function; answered once that function returns. */
  async function openConsole(id: number | string, params: any) {
    const fn = def.consoles?.[params?.console];
    if (!fn) return send({ id, error: { code: Codes.methodNotFound, message: `no console ${params?.console}` } });
    const session = String(params.session);
    const state: OpenConsole = { input: [], resize: [], close: [], abort: new AbortController(), size: { cols: Number(params.cols ?? 80), rows: Number(params.rows ?? 24) } };
    consoles.set(session, state);
    const s: ConsoleSession = {
      id: session, console: params.console, node: params.node ?? { id: "" },
      get cols() { return state.size.cols; }, get rows() { return state.size.rows; },
      write(data) {
        if (!consoles.has(session)) return;
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        for (let at = 0; at < bytes.length; at += CHUNK) {
          send({ method: "console/data", params: { session, data: Buffer.from(bytes.subarray(at, at + CHUNK)).toString("base64") } });
        }
      },
      close(reason) {
        if (!consoles.has(session)) return;
        send({ method: "console/closed", params: { session, ...(reason ? { reason } : {}) } });
        endConsole(session);
      },
      onInput: (cb) => { state.input.push(cb); },
      onResize: (cb) => { state.resize.push(cb); },
      onClose: (cb) => { state.close.push(cb); },
      signal: state.abort.signal,
    };
    const context: Context = params.context ?? {};
    try {
      await fn(s, { ...context, host: hostFor(context), signal: state.abort.signal });
      send({ id, result: {} });
    } catch (e) {
      consoles.delete(session);
      const err = e instanceof ModuleError ? e : new ModuleError(e instanceof Error ? e.message : String(e));
      send({ id, error: { code: err.code, message: err.message } });
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
      case "import/parse":
        if (!ready) return send({ id: msg.id, error: { code: Codes.invalidRequest, message: "not initialized" } });
        {
          const abort = new AbortController();
          running.set(String(msg.id), abort);
          try { await ready; } catch {
            running.delete(String(msg.id));
            return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } });
          }
          return importFile(msg.id, msg.params, abort);
        }
      case "console/open":
        if (!ready) return send({ id: msg.id, error: { code: Codes.invalidRequest, message: "not initialized" } });
        try { await ready; } catch { return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } }); }
        return openConsole(msg.id, msg.params);
      case "console/input": {
        const c = consoles.get(String(msg.params?.session));
        if (!c) return;
        const data = new Uint8Array(Buffer.from(String(msg.params?.data ?? ""), "base64"));
        for (const cb of c.input) { try { cb(data); } catch (e) { console.error(e); } }
        return;
      }
      case "console/resize": {
        const c = consoles.get(String(msg.params?.session));
        if (!c) return;
        c.size = { cols: Number(msg.params?.cols ?? c.size.cols), rows: Number(msg.params?.rows ?? c.size.rows) };
        for (const cb of c.resize) { try { cb(c.size.cols, c.size.rows); } catch (e) { console.error(e); } }
        return;
      }
      case "console/close":
        endConsole(String(msg.params?.session));
        return;
      case "cancel":
        running.get(String(msg.params?.id))?.abort();
        return;
      case "shutdown":
        for (const s of [...consoles.keys()]) endConsole(s);
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
