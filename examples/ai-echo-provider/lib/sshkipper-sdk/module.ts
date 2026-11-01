// The runtime of a process module (spec/protocol.md §4): JSON-RPC 2.0 over stdio, one message per line. A module
// written with it is a map of async handlers; the app's services (exec on a server, secrets, storage) are `ctx.host`.

import type {
  AIChatRequest, AIChatResult, AIDelta, AIModel, Context, EventAnswer, ExecResult, FoundHost, Json, Op, Request, ScreenEvent,
  SourceRef, StorageItem, StorageLink, StorageRef,
} from "./types.ts";

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
  /** A port forwarded through the SSH session of the server the user bound `node` to (a storage reached through a
   * server): connect to the answer's 127.0.0.1:port. Permission `forward`; only for the node of a call in progress. */
  forward(opts: { node: string; host: string; port: number }): Promise<{ host: string; port: number }>;
  /** The browser sign-in of `node` (only while the app's `storage/signIn` for it runs): the app opens `authURL`,
   * receives the code on 127.0.0.1 (PKCE), exchanges it at `tokenURL` and keeps the refresh token as the node's secret
   * `oauth` (it comes back in `settings.oauth` of later calls). Permission `oauth`. */
  oauth(opts: { node: string; authURL: string; tokenURL: string; clientID: string; clientSecret?: string; scope?: string;
    params?: Record<string, string> }): Promise<{ accessToken: string | null }>;
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

/** What a contribution's own method gets (spec/protocol.md §12): the app's services, the cancel signal, the locale. */
export interface MethodContext {
  host: Host;
  signal: AbortSignal;
  locale: string;
}

/** A contribution's own method (`storage/list`, `source/poll`…): its params, its JSON answer. */
export type MethodFn = (params: Record<string, any>, ctx: MethodContext) => Promise<Json | void> | Json | void;

/** An answer of a model provider streaming: `delta` sends a piece now (`ai/delta`); `signal` — the user stopped it. */
export interface AIChatContext {
  delta(d: AIDelta): void;
  signal: AbortSignal;
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
}

/** A model provider (`contributes.ai`, spec/protocol.md §13). */
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
  /** A contribution's own methods by name (`storage/list`…): requests on the same connection as `handler/call`. */
  methods?: Record<string, MethodFn>;
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
      async forward(opts) { return (await request("host/forward", opts as unknown as Json)) as unknown as { host: string; port: number }; },
      async oauth(opts) { return (await request("host/oauth", opts as unknown as Json)) as unknown as { accessToken: string | null }; },
    };
  }

  let locale = "en";

  async function method(id: number | string, fn: MethodFn, params: Record<string, any>, abort: AbortController) {
    try {
      const result = await fn(params ?? {}, { host: hostFor({} as Context), signal: abort.signal, locale });
      if (!abort.signal.aborted) send({ id, result: result === undefined ? null : result });
    } catch (e) {
      if (abort.signal.aborted) return;
      const err = e instanceof ModuleError ? e : new ModuleError(e instanceof Error ? e.message : String(e));
      send({ id, error: { code: err.code, message: err.message } });
    } finally {
      running.delete(String(id));
    }
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

  /** `ai/models`, `ai/chat` (§13): answered by `def.ai`; `ai/cancel` aborts a chat by its stream id. */
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
        locale = msg.params?.locale ?? locale;
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
      default: {
        const fn = def.methods?.[msg.method];
        if (fn && msg.id !== undefined) {
          if (!ready) return send({ id: msg.id, error: { code: Codes.invalidRequest, message: "not initialized" } });
          const abort = new AbortController();
          running.set(String(msg.id), abort);
          try { await ready; } catch {
            running.delete(String(msg.id));
            return send({ id: msg.id, error: { code: Codes.handlerFailed, message: "setup failed" } });
          }
          return method(msg.id, fn, msg.params, abort);
        }
        if (msg.id !== undefined) send({ id: msg.id, error: { code: Codes.methodNotFound, message: `no method ${msg.method}` } });
      }
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

/** A storage contribution (spec/protocol.md §12): what each `storage/*` method does. The optional ones answer only
 * when the manifest's `capabilities` name them (`folders` → mkdir, `rename`, `delete`, `links` → link, `check`). */
export interface StorageImpl {
  list(path: string, storage: StorageRef, ctx: MethodContext): Promise<StorageItem[]> | StorageItem[];
  /** null — nothing there. */
  stat(path: string, storage: StorageRef, ctx: MethodContext): Promise<StorageItem | null> | StorageItem | null;
  /** Up to `length` bytes from `offset`; `eof` — nothing after them. */
  read(path: string, offset: number, length: number, storage: StorageRef, ctx: MethodContext): Promise<{ data: Uint8Array; eof: boolean }>;
  /** An upload in parts: nothing appears at `path` before `commit`; `abort` throws the parts away. */
  write: {
    begin(path: string, size: number, modified: number | undefined, storage: StorageRef, ctx: MethodContext): Promise<string> | string;
    chunk(upload: string, offset: number, data: Uint8Array, storage: StorageRef, ctx: MethodContext): Promise<void> | void;
    commit(upload: string, storage: StorageRef, ctx: MethodContext): Promise<void> | void;
    abort(upload: string, storage: StorageRef, ctx: MethodContext): Promise<void> | void;
  };
  mkdir?(path: string, storage: StorageRef, ctx: MethodContext): Promise<void> | void;
  rename?(from: string, to: string, storage: StorageRef, ctx: MethodContext): Promise<void> | void;
  delete?(path: string, recursive: boolean, storage: StorageRef, ctx: MethodContext): Promise<void> | void;
  link?(path: string, action: "list" | "create" | "remove", link: { url?: string; id?: string }, storage: StorageRef, ctx: MethodContext):
    Promise<StorageLink[] | StorageLink | void> | StorageLink[] | StorageLink | void;
  check?(storage: StorageRef, ctx: MethodContext): Promise<{ text?: string; free?: number; account?: string }> | { text?: string; free?: number; account?: string };
  /** The user's «Войти»: call `ctx.host.oauth({ node: storage.node, … })`, answer the account's name. */
  signIn?(storage: StorageRef, ctx: MethodContext): Promise<{ account?: string }> | { account?: string };
}

const b64 = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString("base64");
const unb64 = (s: unknown) => new Uint8Array(Buffer.from(typeof s === "string" ? s : "", "base64"));

/** The `storage/*` methods of `defineModule({ methods })` from a `StorageImpl`. */
export function storageMethods(impl: StorageImpl): Record<string, MethodFn> {
  const ref = (p: Record<string, any>) => p.storage as StorageRef;
  const m: Record<string, MethodFn> = {
    "storage/list": async (p, ctx) => ({ items: (await impl.list(p.path, ref(p), ctx)) as unknown as Json }),
    "storage/stat": async (p, ctx) => ({ item: ((await impl.stat(p.path, ref(p), ctx)) ?? null) as unknown as Json }),
    "storage/read": async (p, ctx) => {
      const r = await impl.read(p.path, Number(p.offset) || 0, Number(p.length) || 1 << 20, ref(p), ctx);
      return { data: b64(r.data), eof: r.eof };
    },
    "storage/write/begin": async (p, ctx) => ({ upload: await impl.write.begin(p.path, Number(p.size) || 0, p.modified, ref(p), ctx) }),
    "storage/write/chunk": async (p, ctx) => { await impl.write.chunk(p.upload, Number(p.offset) || 0, unb64(p.data), ref(p), ctx); return {}; },
    "storage/write/commit": async (p, ctx) => { await impl.write.commit(p.upload, ref(p), ctx); return {}; },
    "storage/write/abort": async (p, ctx) => { await impl.write.abort(p.upload, ref(p), ctx); return {}; },
  };
  if (impl.mkdir) m["storage/mkdir"] = async (p, ctx) => { await impl.mkdir!(p.path, ref(p), ctx); return {}; };
  if (impl.rename) m["storage/rename"] = async (p, ctx) => { await impl.rename!(p.from, p.to, ref(p), ctx); return {}; };
  if (impl.delete) m["storage/delete"] = async (p, ctx) => { await impl.delete!(p.path, p.recursive === true, ref(p), ctx); return {}; };
  if (impl.link) m["storage/link"] = async (p, ctx) => {
    const r = await impl.link!(p.path, p.action, { url: p.url, id: p.id }, ref(p), ctx);
    return (Array.isArray(r) ? { links: r } : r ?? {}) as unknown as Json;
  };
  if (impl.check) m["storage/check"] = async (p, ctx) => (await impl.check!(ref(p), ctx)) as unknown as Json;
  if (impl.signIn) m["storage/signIn"] = async (p, ctx) => (await impl.signIn!(ref(p), ctx)) as unknown as Json;
  return m;
}

/** A source contribution (spec/protocol.md §12): its hosts now, and the editor's «Проверить». */
export interface SourceImpl {
  poll(source: SourceRef, ctx: MethodContext): Promise<{ hosts: FoundHost[]; scope?: string }> | { hosts: FoundHost[]; scope?: string };
  /** Without it, «Проверить» polls and counts the hosts. */
  check?(source: SourceRef, ctx: MethodContext): Promise<{ text: string }> | { text: string };
}

/** The `source/*` methods of `defineModule({ methods })` from a `SourceImpl`. */
export function sourceMethods(impl: SourceImpl): Record<string, MethodFn> {
  return {
    "source/poll": async (p, ctx) => (await impl.poll(p.source as SourceRef, ctx)) as unknown as Json,
    "source/check": async (p, ctx) => {
      if (impl.check) return (await impl.check(p.source as SourceRef, ctx)) as unknown as Json;
      const r = await impl.poll(p.source as SourceRef, ctx);
      return { text: `${r.hosts.length} host(s)${r.scope ? " · " + r.scope : ""}` };
    },
  };
}
