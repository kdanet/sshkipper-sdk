// Running a module's handler without the app, for its author: a server handler with sh here or over `ssh`, a
// process module's program with a stand-in host (exec here or over ssh, a store in a file, notifications printed).
// The script is built as the app builds it for containers (spec/protocol.md §3): the prelude of spec/prelude.sh,
// `sk_file`, the variables, the request on stdin.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json, Manifest, Request } from "./types.ts";
import { quote } from "./module.ts";

export const PRELUDE = readFileSync(fileURLToPath(new URL("../../../spec/prelude.sh", import.meta.url)), "utf8");

export interface CallOptions {
  input?: Record<string, Json>;
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
}

export interface CallResult { ok: boolean; value?: Json; error?: string; stdout: string; stderr: string; log: string[] }

const envKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
const flat = (v: Json): string | undefined =>
  v === null ? undefined : typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "string" ? v : JSON.stringify(v);

export function request(m: Manifest, handler: string, o: CallOptions): Request {
  return {
    handler, input: o.input ?? {},
    context: {
      ...(o.ssh ? { server: { id: "dev", name: o.ssh, host: o.ssh.split("@").pop()!, user: o.ssh.includes("@") ? o.ssh.split("@")[0] : undefined } } : {}),
      ...(o.container ? { container: o.container } : {}),
      settings: o.settings ?? {}, ...(o.item !== undefined ? { item: o.item } : {}),
      locale: o.locale ?? "en", sdk: 1, app: "sshkipper-module",
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
  const m: Manifest = JSON.parse(readFileSync(join(dir, "sshkipper-module.json"), "utf8"));
  const h = m.handlers?.[handler];
  if (!h) return { ok: false, error: `no handler «${handler}» in handlers`, stdout: "", stderr: "", log: [] };
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
      return { ok: false, error: last, stdout: r.stdout, stderr: r.stderr, log: [] };
    }
    try { return { ok: true, value: answer(r.stdout, h.output ?? "json"), stdout: r.stdout, stderr: r.stderr, log: [] }; } catch (e) {
      return { ok: false, error: (e as Error).message, stdout: r.stdout, stderr: r.stderr, log: [] };
    }
  }
  return processCall(dir, m, handler, o, timeout);
}

/** A process module: its program started in `dir`, initialize, one handler/call, the host's methods answered here. */
function processCall(dir: string, m: Manifest, handler: string, o: CallOptions, timeout: number): Promise<CallResult> {
  if (m.runtime.kind !== "process") throw new Error("not a process module");
  const [cmd, ...args] = m.runtime.command;
  const perms = new Set(m.permissions ?? []);
  const log: string[] = [];
  const storeFile = o.storeFile ?? join(dir, ".sshkipper-dev-store.json");
  const store: Record<string, Json> = existsSync(storeFile) ? JSON.parse(readFileSync(storeFile, "utf8")) : {};
  return new Promise((resolve) => {
    // The environment the app gives a program: a clean one (no SSH agent, nothing of yours), SK_DATA its own folder.
    const data = join(tmpdir(), "sshkipper-dev", m.id);
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const own = Object.fromEntries(Object.entries(m.runtime.kind === "process" ? m.runtime.env ?? {} : {}).filter(([k]) => !k.startsWith("SK_") && k !== "PATH"));
    const found = cmd.includes("/") ? dirname(join(dir, cmd)) : (process.env.PATH ?? "").split(":").find((d) => existsSync(join(d, cmd))) ?? "";
    const env = {
      PATH: [found, "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":"),
      HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp", LANG: "en_US.UTF-8",
      SK_SDK: "1", SK_MODULE: m.id, SK_DATA: data, ...own,
    };
    const p = spawn(cmd, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "", stderr = "", done = false;
    const finish = (r: Omit<CallResult, "stderr" | "log" | "stdout">) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      p.stdin.end();
      setTimeout(() => p.kill(), 500);
      if (perms.has("store")) writeFileSync(storeFile, JSON.stringify(store, null, 2));
      resolve({ ...r, stdout: "", stderr, log });
    };
    const t = setTimeout(() => finish({ ok: false, error: `no answer in ${timeout} s` }), timeout * 1000);
    const send = (msg: object) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
    const need = (perm: string, id: unknown) => { if (perms.has(perm as never)) return true; send({ id, error: { code: -32001, message: `permission «${perm}» isn't in the manifest` } }); return false; };
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => finish({ ok: false, error: `${cmd}: ${e.message}` }));
    p.on("close", (code) => finish({ ok: false, error: `the program exited (${code})${stderr ? ": " + stderr.trim().split("\n").pop() : ""}` }));
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
          if (msg.id === 1) send({ id: 2, method: "handler/call", params: request(m, handler, o) });
          else if (msg.id === 2) finish(msg.error ? { ok: false, error: msg.error.message } : { ok: true, value: msg.result ?? null });
          continue;
        }
        const pr = msg.params ?? {};
        switch (msg.method) {
          case "host/log": log.push(`${pr.level}: ${pr.message}`); break;
          case "host/exec": {
            if (!need("exec", msg.id) || (pr.sudo && !need("sudo", msg.id))) break;
            const r = await shell(pr.sudo ? `sudo -n sh -c ${quote(pr.command)}` : pr.command, { ssh: o.ssh, stdin: pr.stdin, timeout: pr.timeout ?? 30, container: pr.container });
            log.push(`exec${o.ssh ? " on " + o.ssh : " here"}: ${pr.command} → ${r.code}`);
            send({ id: msg.id, result: { exitCode: r.code, stdout: r.stdout, stderr: r.stderr } });
            break;
          }
          case "host/secret":
            if (!need("secrets", msg.id)) break;
            if (o.secrets?.[pr.key] === undefined) send({ id: msg.id, error: { code: -32000, message: `no secret «${pr.key}» (pass --secret ${pr.key}=…)` } });
            else send({ id: msg.id, result: { value: o.secrets[pr.key] } });
            break;
          case "host/store/get": if (need("store", msg.id)) send({ id: msg.id, result: { value: store[pr.key] ?? null } }); break;
          case "host/store/set":
            if (!need("store", msg.id)) break;
            if (pr.value === null) delete store[pr.key]; else store[pr.key] = pr.value;
            send({ id: msg.id, result: null });
            break;
          case "host/notify": if (need("notify", msg.id)) { log.push(`notify: ${pr.title} — ${pr.text}`); send({ id: msg.id, result: null }); } break;
          default: if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } });
        }
      }
    });
    send({ id: 1, method: "initialize", params: { sdk: 1, app: "sshkipper-module", module: { id: m.id, version: m.version }, locale: o.locale ?? "en" } });
  });
}
