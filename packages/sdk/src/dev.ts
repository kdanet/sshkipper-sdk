// Running a module's handler without the app, for its author: a server handler with sh here or over `ssh`, a
// process module's program with a stand-in host (exec here or over ssh, a store in a file, notifications printed).
// The script is built as the app builds it for containers (spec/protocol.md §3): the prelude of spec/prelude.sh,
// `sk_file`, the variables, the request on stdin.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json, Manifest, Param, Request } from "./types.ts";
import { quote } from "./module.ts";
import { manifestFile } from "./validate.ts";

/** The app keeps an extension's host.store under 1 MB (its JSON). */
const STORE_LIMIT = 1 << 20;

export const PRELUDE = readFileSync(fileURLToPath(new URL("../../../spec/prelude.sh", import.meta.url)), "utf8");

export interface CallOptions {
  input?: Record<string, Json>;
  /** `context.node` — an extension node's screen (spec/protocol.md §14.1): `{id, name, type, settings, links, secrets}`. */
  node?: Json;
  settings?: Record<string, Json>;
  item?: Json;
  locale?: string;
  /** `user@host` (anything `ssh` takes): run there instead of on this machine. */
  ssh?: string;
  container?: string;
  /** Secret settings: key → value (the app keeps them in its document). */
  secrets?: Record<string, string>;
  /** Process modules: the file host/store keeps its values in. */
  storeFile?: string;
  timeout?: number;
  /** Input as is, not checked against the params that declare it (a page's data handler, a screen's render). */
  unchecked?: boolean;
}

export interface CallResult { ok: boolean; value?: Json; error?: string; stdout: string; stderr: string; log: string[] }

const envKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
const flat = (v: Json): string | undefined =>
  v === null ? undefined : typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "string" ? v : JSON.stringify(v);

/** The stand-in server of a call: `--ssh`'s host, else this machine. */
export const DEV_SERVER = "dev";

/** Everything that runs `handler` with params of its own: actions, AI tools, automation blocks. */
export function referrers(m: Manifest, handler: string): { what: string; risk: string; params?: Param[]; server: boolean }[] {
  const c = m.contributes;
  return [
    ...(m.actions ?? []).map((x) => ({ what: `action «${x.id}»`, risk: x.risk, params: x.params, handler: x.handler, server: true })),
    ...[...(m.tools ?? []), ...(c?.tools ?? [])].map((x) => ({ what: `tool «${x.name}»`, risk: x.risk, params: x.params, handler: x.handler, server: true })),
    ...[...(m.automation ?? []), ...(c?.automation ?? [])].map((x) => ({
      what: `automation block «${x.id}»`, risk: x.risk, params: x.params, handler: x.handler,
      // A server module's block always has its server; a program's only when it says so.
      server: m.runtime.kind === "server" || x.server === true,
    })),
  ].filter((x) => x.handler === handler);
}

/** The input checked as the app checks it before a call (ModuleParam.check): types made right, required ones there,
 * patterns matched in full, choices among theirs; keys no param declares are dropped (`dropped` names them). */
export function checkInput(params: Param[], input: Record<string, Json>): { input: Record<string, Json>; dropped: string[] } {
  const out: Record<string, Json> = {};
  const name = (p: Param) => {
    const t = typeof p.title === "string" ? p.title : p.title?.en ?? Object.values(p.title ?? {})[0] ?? "";
    return t && t !== p.key ? `${t} (${p.key})` : p.key;
  };
  for (const p of params) {
    let v: Json = input[p.key] ?? p.default ?? null;
    if (v === "") v = null;
    if (v === null) {
      if (p.required) throw new Error(`the parameter «${name(p)}» isn't given`);
      continue;
    }
    if (p.type === "number") {
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(",", ".")))) v = Number(v.replace(",", "."));
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`«${name(p)}»: a number is needed`);
    } else if (p.type === "bool") {
      if (typeof v === "string") v = ["1", "true", "yes", "да"].includes(v.toLowerCase());
      if (typeof v !== "boolean") throw new Error(`«${name(p)}»: yes or no is needed`);
    } else {
      if (typeof v === "number") v = String(v);
      if (typeof v !== "string") throw new Error(`«${name(p)}»: text is needed`);
      if ([...v].length > 4000) throw new Error(`«${name(p)}»: too long`);
      if (p.type === "choice" && !(p.choices ?? []).includes(v)) throw new Error(`«${name(p)}»: no choice «${v}»`);
      // The whole value, as the app matches it (JavaScript's «$» without the m flag is the very end, as ICU's \z).
      if (p.pattern !== undefined && !new RegExp(`^(?:${p.pattern})$`).test(v)) throw new Error(`«${name(p)}»: the value doesn't match the extension's pattern`);
    }
    out[p.key] = v;
  }
  return { input: out, dropped: Object.keys(input).filter((k) => !params.some((p) => p.key === k)) };
}

export function request(m: Manifest, handler: string, o: CallOptions): Request {
  // As the app: a call has its server, unless it is a program's automation block that takes none.
  const refs = referrers(m, handler);
  const local = !refs.length || refs.some((r) => r.server);
  return {
    handler, input: o.input ?? {},
    context: {
      ...(o.ssh ? { server: { id: DEV_SERVER, name: o.ssh, host: o.ssh.split("@").pop()!, user: o.ssh.includes("@") ? o.ssh.split("@")[0] : undefined } }
        : local ? { server: { id: DEV_SERVER, name: "this machine", host: "localhost" } } : {}),
      ...(o.container ? { container: o.container } : {}),
      settings: o.settings ?? {}, ...(o.item !== undefined ? { item: o.item } : {}),
      ...(o.node !== undefined ? { node: o.node } : {}),
      locale: o.locale ?? "en", sdk: 1, app: "sshkipper-ext",
    },
  } as Request;
}

/** One script for `sh`: what the app sends into a container. Secrets travel as files of `$SK_TMP` here. */
export function serverScript(dir: string, m: Manifest, handler: string, o: CallOptions): string {
  const h = m.handlers?.[handler];
  if (!h?.script) throw new Error(`no handler «${handler}» with a script`);
  const body = readFileSync(join(dir, h.script), "utf8");
  // The module's other files under scripts/, for `sk_file` (as the app ships them).
  const files = listScripts(dir).filter((f) => f !== h.script!.replace(/^(\.\/)+/, "")).slice(0, 64);
  let s = PRELUDE;
  if (files.length) {
    s += "sk_file() {\n  case \"$1\" in\n";
    for (const f of files) {
      const b64 = readFileSync(join(dir, f)).toString("base64");
      s += `    ${quote(f)}) printf '%s\\n' ${quote(b64)} | { base64 -d 2>/dev/null || base64 -D 2>/dev/null || openssl base64 -d -A; } ;;\n`;
    }
    s += "    *) sk_fail \"no file $1 in the module\" ;;\n  esac\n}\n";
  } else s += "sk_file() { sk_fail \"no file $1 in the module\"; }\n";
  const r = request(m, handler, o);
  const vars: [string, string][] = [["SK_HANDLER", handler], ["SK_MODULE", m.id], ["SK_SDK", "1"], ["SK_LOCALE", r.context.locale]];
  for (const [k, v] of Object.entries(r.input).sort()) { const f = flat(v); if (f !== undefined) vars.push(["SK_INPUT_" + envKey(k), f]); }
  for (const [k, v] of Object.entries(r.context.settings).sort()) { const f = flat(v); if (f !== undefined) vars.push(["SK_SETTING_" + envKey(k), f]); }
  const item = r.context.item as Record<string, Json> | undefined;
  if (item && typeof item === "object" && !Array.isArray(item) && item.id !== undefined) vars.push(["SK_ITEM_ID", String(item.id)]);
  if (o.container) vars.push(["SK_CONTAINER", o.container]);
  for (const [k, v] of vars) s += `${k}=${quote(v)}; export ${k}\n`;
  s += "SK_TMP=$(mktemp -d 2>/dev/null || echo /tmp/sk.$$); mkdir -p \"$SK_TMP\"; chmod 700 \"$SK_TMP\"; export SK_TMP\n";
  s += "trap 'rm -rf \"$SK_TMP\"' EXIT\n";
  // As in the app: a container's command line is readable on the server, so no secrets go into one.
  for (const [k, v] of Object.entries(o.container ? {} : o.secrets ?? {})) {
    const name = "secret_" + envKey(k).toLowerCase();
    s += `(umask 077; printf '%s' ${quote(v)} > "$SK_TMP/${name}")\nSK_SECRET_${envKey(k)}="$SK_TMP/${name}"; export SK_SECRET_${envKey(k)}\n`;
  }
  s += `printf '%s' ${quote(JSON.stringify(r))} > "$SK_TMP/request.json"\n`;
  s += `cat > "$SK_TMP/handler.sh" <<'SK_HANDLER_EOF'\n${body}${body.endsWith("\n") ? "" : "\n"}SK_HANDLER_EOF\n`;
  s += "( cd \"$SK_TMP\" && . \"$SK_TMP/handler.sh\" ) < \"$SK_TMP/request.json\"\n";
  return s;
}

function listScripts(dir: string): string[] {
  const p = join(dir, "scripts");
  if (!existsSync(p)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(d, e.name), `${rel}/${e.name}`);
      else if (e.isFile()) out.push(`${rel}/${e.name}`);
    }
  };
  walk(p, "scripts");
  return out;
}

function run(command: string, args: string[], stdin: string, timeout: number, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const t = setTimeout(() => { stderr += `\n(stopped after ${timeout} s)`; p.kill("SIGKILL"); }, timeout * 1000);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, stdout, stderr }); });
    p.on("error", (e) => { clearTimeout(t); resolve({ code: 127, stdout, stderr: e.message }); });
    p.stdin.end(stdin);
  });
}

/** A shell command here (`sh -c`) or on `ssh`'s host. */
export function shell(command: string, o: { ssh?: string; stdin?: string; timeout?: number; container?: string }) {
  const full = o.container ? `docker exec -i ${quote(o.container)} sh -c ${quote(command)}` : command;
  return o.ssh ? run("ssh", ["-T", "-o", "BatchMode=yes", o.ssh, full], o.stdin ?? "", o.timeout ?? 30)
    : run("/bin/sh", ["-c", full], o.stdin ?? "", o.timeout ?? 30);
}

function answer(output: string, kind: "json" | "text" | "lines"): Json {
  if (kind === "text") return output;
  if (kind === "lines") return output.replace(/\n$/, "").split("\n");
  const t = output.trim();
  if (!t) throw new Error("the handler printed nothing: JSON was expected");
  try { return JSON.parse(t); } catch { throw new Error(`the handler printed something that isn't JSON: ${t.slice(0, 160)}`); }
}

/** Runs a handler of the module in `dir`. */
export async function call(dir: string, handler: string, o: CallOptions = {}): Promise<CallResult> {
  const m: Manifest = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
  const h = m.handlers?.[handler];
  if (!h) return { ok: false, error: `no handler «${handler}» in handlers`, stdout: "", stderr: "", log: [] };
  const log: string[] = [];
  if (!o.unchecked) {
    // As the app: what an action, a tool or a block passes is checked against its params before anything runs.
    const declared = referrers(m, handler).flatMap((r) => r.params ?? []).filter((p, i, all) => all.findIndex((q) => q.key === p.key) === i);
    try {
      const r = checkInput(declared, o.input ?? {});
      if (r.dropped.length) log.push(`input ${r.dropped.join(", ")}: no param of the handler's actions, tools or blocks declares it — the app doesn't pass it`);
      o = { ...o, input: r.input };
    } catch (e) {
      return { ok: false, error: (e as Error).message, stdout: "", stderr: "", log };
    }
  }
  const timeout = o.timeout ?? h.timeout ?? 30;
  if (m.runtime.kind === "server") {
    const script = serverScript(dir, m, handler, o);
    // sudo: required runs as root as in the app (where the server allows it); auto runs as you here.
    const sh = h.sudo === "required" ? "sudo -n sh -s" : "sh -s";
    const r = o.container
      ? await shell(sh, { ssh: o.ssh, stdin: script, timeout, container: o.container })
      : o.ssh ? await run("ssh", ["-T", "-o", "BatchMode=yes", o.ssh, sh], script, timeout)
        : h.sudo === "required" ? await run("sudo", ["-n", "sh", "-s"], script, timeout) : await run("/bin/sh", ["-s"], script, timeout);
    if (r.code !== 0) {
      const last = r.stderr.trim().split("\n").pop() || `exit code ${r.code}`;
      return { ok: false, error: last, stdout: r.stdout, stderr: r.stderr, log };
    }
    try { return { ok: true, value: answer(r.stdout, h.output ?? "json"), stdout: r.stdout, stderr: r.stderr, log }; } catch (e) {
      return { ok: false, error: (e as Error).message, stdout: r.stdout, stderr: r.stderr, log };
    }
  }
  const r = await processCall(dir, m, handler, o, timeout);
  return { ...r, log: [...log, ...r.log] };
}

/** A process module's handler: its program started in `dir`, initialize, one handler/call. */
async function processCall(dir: string, m: Manifest, handler: string, o: CallOptions, timeout: number): Promise<CallResult> {
  const p = startProgram(dir, m, o);
  const r = await p.request("handler/call", request(m, handler, o) as unknown as Json, timeout);
  return { ...r, stdout: "", stderr: await p.close(), log: p.log };
}

/** A notification the program sent (`ui/push`, `ai/delta`, `console/data`…), in order. */
export interface Notice { method: string; params: Json }

/** What a contribution's own method answered, with the notifications that came meanwhile. */
export interface MethodResult extends CallResult { notices: Notice[] }

/** A contribution's own method (`storage/list`, `source/poll`, `import/parse`, `ai/models`, `ai/chat`, `ui/event`…)
 * of a process extension in `dir`: its program started, initialize, the one request, the host's methods answered here. */
export async function callMethod(dir: string, method: string, params: Json, o: CallOptions = {}): Promise<MethodResult> {
  const m: Manifest = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
  if (m.runtime.kind !== "process") return { ok: false, error: "a server module has no methods of its own: run a handler", stdout: "", stderr: "", log: [], notices: [] };
  const p = startProgram(dir, m, o);
  const r = await p.request(method, params, o.timeout ?? 60);
  return { ...r, stdout: "", stderr: await p.close(), log: p.log, notices: p.notices };
}

/** A program kept running for several requests (a screen's render, then its events). */
export interface ProgramSession {
  /** One request; the host's methods it asks meanwhile are answered here (exec here or on `ssh`, a store file…). */
  request(method: string, params: Json, timeout?: number): Promise<{ ok: boolean; value?: Json; error?: string }>;
  /** Notifications of the program so far, in order (`ui/push`, `ai/delta`, `console/data`…). */
  notices: Notice[];
  log: string[];
  /** Ends the program (`shutdown`, stdin closed); its stderr. */
  close(): Promise<string>;
}

/** Starts a process extension's program as the app does (a clean environment, `SK_DATA`, the package folder) and
 * initializes it. The host's methods are answered by a stand-in: exec here or on `o.ssh`, a store in a file,
 * notifications and logs collected, `host/forward` gives the target as is, `host/open` answers «not opened» and
 * `host/ask` its cancel button — there is no person here. */
export function startProgram(dir: string, m: Manifest, o: CallOptions = {}): ProgramSession {
  if (m.runtime.kind !== "process") throw new Error("not a process module");
  const [cmd, ...args] = m.runtime.command;
  const perms = new Set(m.permissions ?? []);
  const log: string[] = [];
  const notices: Notice[] = [];
  const storeFile = o.storeFile ?? join(dir, ".sshkipper-dev-store.json");
  const store: Record<string, Json> = existsSync(storeFile) ? JSON.parse(readFileSync(storeFile, "utf8")) : {};
  // The environment the app gives a program: a clean one (no SSH agent, nothing of yours), SK_DATA its own folder.
  const data = join(tmpdir(), "sshkipper-dev", m.id);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const own = Object.fromEntries(Object.entries(m.runtime.env ?? {}).filter(([k]) => !k.startsWith("SK_") && k !== "PATH"));
  const found = cmd.includes("/") ? dirname(join(dir, cmd)) : (process.env.PATH ?? "").split(":").find((d) => existsSync(join(d, cmd))) ?? "";
  const env = {
    PATH: [found, "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":"),
    HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp", LANG: "en_US.UTF-8",
    SK_SDK: "1", SK_MODULE: m.id, SK_DATA: data, PYTHONPYCACHEPREFIX: join(data, "pycache"), ...own,
  };
  const p = spawn(cmd.includes("/") ? join(dir, cmd) : cmd, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", stderr = "", exited: string | null = null, nextID = 1;
  const waiting = new Map<number, (r: { ok: boolean; value?: Json; error?: string }) => void>();
  const send = (msg: object) => { if (!exited) p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n"); };
  const refuse = (id: unknown, code: number, message: string) => send({ id, error: { code, message } });
  const need = (perm: string, id: unknown) => {
    if (perms.has(perm as never)) return true;
    refuse(id, -32001, `permission «${perm}» isn't in the manifest`);
    return false;
  };
  // As the app (§4.3): host.exec and a server's secret only for the servers of calls in progress — a storage's or a
  // source's method has none — and the servers the open screen's node points at.
  const inFlight = new Map<number, string>();
  const servers = () => new Set([...inFlight.values(),
    ...Object.values((o.node as { links?: Record<string, Json> } | undefined)?.links ?? {}).filter((x): x is string => typeof x === "string")]);
  const notOurs = (s: unknown) => `server «${s ?? ""}» isn't a server of a call in progress (the app refuses it: only context.server.id of the call)`;
  const end = (why: string) => {
    if (exited) return;
    exited = why;
    for (const [, w] of waiting) w({ ok: false, error: why });
    waiting.clear();
  };
  const closed = new Promise<void>((resolve) => p.on("close", () => resolve()));
  p.stderr.on("data", (d) => (stderr += d));
  p.stdin.on("error", () => { /* the program is gone: its close says why */ });
  p.on("error", (e) => end(`${cmd}: ${e.message}`));
  p.on("close", (code) => end(`the program exited (${code})${stderr ? ": " + stderr.trim().split("\n").pop() : ""}`));
  p.stdout.on("data", async (d) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: any;
      // As the app: a stray line (a console.log) is logged, the conversation goes on.
      try { msg = JSON.parse(line); } catch { log.push(`not JSON-RPC (stdout is the protocol — log to stderr): ${line.slice(0, 120)}`); continue; }
      if (msg.method === undefined) {
        const w = waiting.get(msg.id);
        if (w) { waiting.delete(msg.id); w(msg.error ? { ok: false, error: msg.error.message } : { ok: true, value: msg.result ?? null }); }
        continue;
      }
      const pr = msg.params ?? {};
      switch (msg.method) {
        case "host/log": log.push(`${pr.level}: ${pr.message}`); break;
        case "host/exec": {
          if (!need("exec", msg.id) || (pr.sudo && !need("sudo", msg.id))) break;
          if (typeof pr.command !== "string" || !pr.command) { refuse(msg.id, -32602, "command"); break; }
          if (!servers().has(String(pr.server))) { refuse(msg.id, -32001, notOurs(pr.server)); break; }
          if (pr.container && pr.stdin !== undefined) { refuse(msg.id, -32602, "stdin doesn't go into a container — drop stdin or container (the app refuses the pair)"); break; }
          const r = await shell(pr.sudo ? `sudo -n sh -c ${quote(pr.command)}` : pr.command, { ssh: o.ssh, stdin: pr.stdin, timeout: pr.timeout ?? 30, container: pr.container });
          log.push(`exec${o.ssh ? " on " + o.ssh : " here"}: ${pr.command} → ${r.code}`);
          send({ id: msg.id, result: { exitCode: r.code, stdout: r.stdout, stderr: r.stderr } });
          break;
        }
        case "host/secret": {
          if (!need("secrets", msg.id)) break;
          if ("node" in pr) {
            // A node's secret field (§14.3): the call's node or one it points at, a secret field of the extension's types.
            const node = o.node as { id?: string; links?: Record<string, Json> } | undefined;
            const visible = new Set([node?.id, ...Object.values(node?.links ?? {})].filter((x) => typeof x === "string"));
            if (typeof pr.node !== "string" || !visible.has(pr.node)) { refuse(msg.id, -32001, "the node isn't visible to the extension: only the open screen's node (--node) and the nodes it points at"); break; }
            const fields = (m.contributes?.nodeType ?? []).flatMap((t) => t.fields ?? []).filter((f) => f.type === "secret").map((f) => f.key);
            if (!fields.includes(pr.key)) { refuse(msg.id, -32602, `no secret field «${pr.key}» in the extension's node types`); break; }
          } else {
            if (!servers().has(String(pr.server))) { refuse(msg.id, -32001, notOurs(pr.server)); break; }
            const keys = (m.settings ?? []).filter((s) => s.type === "secret").map((s) => s.key);
            if (!keys.includes(pr.key)) { refuse(msg.id, -32602, `no secret setting «${pr.key}» (settings with type «secret»: ${keys.join(", ") || "none"})`); break; }
          }
          const value = o.secrets?.[pr.key];
          if (value === undefined) refuse(msg.id, -32000, `no secret «${pr.key}» (pass --secret ${pr.key}=…)`);
          else send({ id: msg.id, result: { value } });
          break;
        }
        case "host/store/get":
        case "host/store/set": {
          if (!need("store", msg.id)) break;
          if (typeof pr.key !== "string" || !pr.key || [...pr.key].length > 200) { refuse(msg.id, -32602, "key: 1–200 characters"); break; }
          if (msg.method === "host/store/get") { send({ id: msg.id, result: { value: store[pr.key] ?? null } }); break; }
          const next = { ...store };
          if (pr.value === null || pr.value === undefined) delete next[pr.key]; else next[pr.key] = pr.value;
          if (Buffer.byteLength(JSON.stringify(next)) > STORE_LIMIT) { refuse(msg.id, -32602, "the extension's store is over 1 MB"); break; }
          if (pr.value === null || pr.value === undefined) delete store[pr.key]; else store[pr.key] = pr.value;
          send({ id: msg.id, result: null });
          break;
        }
        case "host/notify": if (need("notify", msg.id)) { log.push(`notify: ${pr.title} — ${pr.text}`); send({ id: msg.id, result: null }); } break;
        case "host/forward":
          // No SSH session here: the target as is (a service on this machine, a stand-in).
          if (need("forward", msg.id)) { log.push(`forward: ${pr.host}:${pr.port} (as is — no SSH session here)`); send({ id: msg.id, result: { host: pr.host, port: pr.port } }); }
          break;
        case "host/open":
          log.push(`open: ${JSON.stringify(pr)} — answered «not opened» (no app here)`);
          send({ id: msg.id, result: { opened: false } });
          break;
        case "host/ask": {
          const buttons: string[] = Array.isArray(pr.buttons) && pr.buttons.length ? pr.buttons : ["OK"];
          const cancel = typeof pr.cancel === "number" ? pr.cancel : buttons.length - 1;
          log.push(`ask: «${pr.title}» [${buttons.join(" / ")}] — answered «${buttons[cancel] ?? cancel}», the cancel button (no person here)`);
          send({ id: msg.id, result: { button: cancel } });
          break;
        }
        default:
          if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: `${msg.method}: not available without the app` } });
          else notices.push({ method: msg.method, params: pr });
      }
    }
  });
  const ask = (method: string, params: Json, timeout: number) => new Promise<{ ok: boolean; value?: Json; error?: string }>((resolve) => {
    if (exited) return resolve({ ok: false, error: exited });
    const id = nextID++;
    const server = (params as { context?: { server?: { id?: string } } } | null)?.context?.server?.id;
    if (server) inFlight.set(id, server);
    const t = setTimeout(() => {
      waiting.delete(id);
      inFlight.delete(id);
      send({ method: "cancel", params: { id } });
      resolve({ ok: false, error: `no answer in ${timeout} s` });
    }, timeout * 1000);
    waiting.set(id, (r) => { clearTimeout(t); inFlight.delete(id); resolve(r); });
    send({ id, method, params });
  });
  const ready = ask("initialize", { sdk: 1, app: "sshkipper-ext", module: { id: m.id, version: m.version }, locale: o.locale ?? "en" }, 30);
  return {
    async request(method, params, timeout = 30) {
      const init = await ready;
      return init.ok ? ask(method, params, timeout) : init;
    },
    notices, log,
    async close() {
      if (!exited) {
        await ask("shutdown", {}, 3);
        p.stdin.end();
        const kill = setTimeout(() => p.kill(), 1500);
        await closed;
        clearTimeout(kill);
      }
      if (perms.has("store")) writeFileSync(storeFile, JSON.stringify(store, null, 2));
      return stderr;
    },
  };
}
