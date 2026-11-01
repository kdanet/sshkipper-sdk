#!/usr/bin/env node
// sshkipper-ext — the command line of the SSHKipper extension SDK: new, validate, run, preview, pack, vendor, mcp.
// Node 24+ runs it as is (TypeScript types are stripped), no dependencies. `sshkipper-module` is its old name.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { call, callMethod } from "../sdk/src/dev.ts";
import { KIND_INFO, KINDS, scaffold, vendorFiles, type Kind } from "../sdk/src/scaffold.ts";
import { previewScreen, type PreviewEvent } from "../sdk/src/screens.ts";
import type { Json, Manifest } from "../sdk/src/types.ts";
import { formatIssue, listFiles, MANIFEST_FILES, manifestFile, validateFolder } from "../sdk/src/validate.ts";

const NAME = "sshkipper-ext";

const HELP = `${NAME} — build extensions for SSHKipper (SDK 1)

  new <folder> [--kind KIND] [--process] [--module] [--id dev.acme.disks] [--title "Disks"]
                         an extension that works, one kind of contribution:
${KINDS.map((k) => `                           ${k.padEnd(10)} ${KIND_INFO[k]}`).join("\n")}
                         --module: a service as sshkipper-module.json (.sshkmod)
  validate [folder]      the checks the app makes before installing (schemas, handlers, files, views, contributions)
  run [folder] <handler> [--input JSON] [--settings JSON] [--item JSON] [--node JSON] [--ssh user@host]
                         [--container NAME] [--secret key=value] [--locale ru]
                         run a handler: a server script with sh here or on --ssh; a program's handler with
                         host.exec here or on --ssh
  run [folder] <method> [--params JSON] [--file PATH --importer ID]
                         a contribution's own method of a program: storage/list, source/poll, import/parse
                         (--file: the file's bytes as the app sends them), ai/models, ai/chat, ui/event…
                         (call — the same, its old name)
  preview [folder] [page|screen] [--data JSON] [--run] [--node JSON] [--events JSON] [--wait MS] [--ssh user@host]
                         a page or a screen as text: a template with --data (--run — with what its handlers
                         return), a rendered page, a screen of contributes.screen (--node — its node); a live
                         screen gets --events in order ([{"type": "open"}, {"type": "press", "value": {...}}]),
                         their ops and the program's pushes applied
  pack [folder] [-o file]
                         validate, then zip it for «Установить расширение…»: .sshkext (sshkipper-extension.json)
                         or .sshkmod (sshkipper-module.json)
  vendor [folder]        copy the SDK runtime into lib/sshkipper-sdk/ (programs in TypeScript)
  mcp [--allow-changes]  the MCP server for AI agents (stdio); --allow-changes lets ext_run_local run what changes
                         things (stop, delete, write) on this machine — your decision, not the agent's

Docs: docs/en/README.md · Protocol: spec/protocol.md · Swift: packages/swift`;

type Flags = { _: string[]; [k: string]: string | string[] | boolean };

/** Flags that take no value: `new --process disks` names the folder, it isn't the flag's value. */
const SWITCHES = new Set(["process", "run", "help", "module", "allow-changes"]);

function parse(argv: string[]): Flags {
  const f: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o") { f.out = argv[++i]; continue; }
    if (a === "-h") { f.help = true; continue; }
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (SWITCHES.has(k) || next === undefined || next.startsWith("--")) { f[k] = true; continue; }
      i++;
      if (k === "secret") f.secret = [...((f.secret as string[]) ?? []), next];
      else f[k] = next;
      continue;
    }
    f._.push(a);
  }
  return f;
}

function fail(message: string): never {
  console.error(`${NAME}: ${message}`);
  process.exit(1);
}

function jsonFlag(f: Flags, k: string): Json | undefined {
  const v = f[k];
  if (typeof v !== "string") return undefined;
  const text = v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v;
  try { return JSON.parse(text); } catch (e) { fail(`--${k}: not JSON (${(e as Error).message})`); }
}

/** [folder, ...rest]: the first argument is the folder when it has a manifest, else the current folder. */
function folderAnd(args: string[]): [string, string[]] {
  if (args[0] && MANIFEST_FILES.some((m) => existsSync(join(args[0], m)))) return [resolve(args[0]), args.slice(1)];
  if (!MANIFEST_FILES.some((m) => existsSync(m))) fail("no sshkipper-extension.json or sshkipper-module.json here: name the folder");
  return [resolve("."), args];
}

function report(dir: string): boolean {
  const r = validateFolder(dir);
  for (const i of r.issues) console.log(formatIssue(i));
  const errors = r.issues.filter((i) => i.severity === "error").length;
  const warnings = r.issues.length - errors;
  console.log(errors ? `${errors} error(s), ${warnings} warning(s): fix the errors — the app refuses some of them on install, the rest break pages or calls` : `ok — ${r.manifest?.id} ${r.manifest?.version}, ${r.files.length} files${warnings ? `, ${warnings} warning(s)` : ""}`);
  return errors === 0;
}

const print = (v: Json | undefined) => console.log(typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2));

export async function main(argv: string[]) {
  const f = parse(argv);
  const [command, ...args] = f.help ? ["help"] : f._;
  switch (command) {
    case "new": {
      const folder = args[0] ?? fail("new <folder> [--kind …]");
      if (existsSync(folder) && readdirSync(folder).length) fail(`${folder} isn't empty`);
      const kind = (typeof f.kind === "string" ? f.kind : "service") as Kind;
      if (!(KINDS as readonly string[]).includes(kind)) fail(`--kind ${kind}: one of ${KINDS.join(", ")}`);
      const id = typeof f.id === "string" ? f.id : `dev.example.${basename(resolve(folder)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "extension"}`;
      let files: Record<string, string>;
      try {
        files = scaffold({ kind, id, title: typeof f.title === "string" ? f.title : basename(resolve(folder)), process: f.process === true, module: f.module === true });
      } catch (e) { fail((e as Error).message); }
      for (const [p, text] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, p)), { recursive: true });
        writeFileSync(join(folder, p), text);
      }
      console.log(`${kind}${kind === "service" ? (f.process ? " (a program)" : " (server scripts)") : ""} ${id} in ${folder}: ${Object.keys(files).length} files — README.md says how to try it`);
      report(resolve(folder));
      break;
    }
    case "validate": {
      const [dir] = folderAnd(args);
      process.exit(report(dir) ? 0 : 1);
    }
    case "run": case "call": {
      const [dir, rest] = folderAnd(args);
      const name = rest[0] ?? fail("run [folder] <handler|method>");
      const secrets = Object.fromEntries(((f.secret as string[]) ?? []).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
      const opts = {
        input: jsonFlag(f, "input") as Record<string, Json>, settings: jsonFlag(f, "settings") as Record<string, Json>, item: jsonFlag(f, "item"),
        node: jsonFlag(f, "node"), ssh: f.ssh as string | undefined, container: f.container as string | undefined, secrets, locale: (f.locale as string) ?? "en",
      };
      // A name with a slash is a contribution's own method; the rest are handlers.
      if (name.includes("/")) {
        let params = (jsonFlag(f, "params") ?? {}) as Record<string, Json>;
        if (typeof f.file === "string") {
          const data = readFileSync(f.file);
          params = { importer: (f.importer as string) ?? "", name: basename(f.file), size: data.length, data: data.toString("base64"), locale: opts.locale, ...params };
        }
        const r = await callMethod(dir, name, params, opts);
        for (const l of r.log) console.error(`· ${l}`);
        for (const n of r.notices) console.error(`← ${n.method} ${JSON.stringify(n.params).slice(0, 200)}`);
        if (!r.ok) { if (r.stderr.trim()) console.error(r.stderr.trim()); fail(r.error ?? "failed"); }
        print(r.value);
        break;
      }
      const r = await call(dir, name, opts);
      for (const l of r.log) console.error(`· ${l}`);
      if (!r.ok && r.stderr.trim() && r.stderr.trim() !== r.error) console.error(r.stderr.trim());
      if (!r.ok) fail(r.error ?? "failed");
      print(r.value);
      break;
    }
    case "preview": {
      const [dir, rest] = folderAnd(args);
      const events = jsonFlag(f, "events");
      if (events !== undefined && !Array.isArray(events)) fail("--events: a JSON array of events");
      try {
        const r = await previewScreen(dir, rest[0], {
          data: jsonFlag(f, "data") as Record<string, Json>, run: f.run === true, settings: jsonFlag(f, "settings") as Record<string, Json>,
          item: jsonFlag(f, "item"), node: jsonFlag(f, "node"), ssh: f.ssh as string | undefined, locale: (f.locale as string) ?? "en",
          events: events as unknown as PreviewEvent[] | undefined, wait: typeof f.wait === "string" ? Number(f.wait) : undefined,
        });
        console.log(r.text);
        for (const a of r.answers) console.error(`→ ${a}`);
        for (const p of r.problems) console.error(`✗ op ${p.index} (${p.op}): ${p.message}`);
        for (const i of r.issues) console.error(i);
        for (const l of r.log) console.error(`· ${l}`);
      } catch (e) { fail((e as Error).message); }
      break;
    }
    case "pack": {
      const [dir] = folderAnd(args);
      if (!report(dir)) process.exit(1);
      const name = manifestFile(dir);
      const m: Manifest = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const ext = name === "sshkipper-extension.json" ? "sshkext" : "sshkmod";
      const out = resolve((f.out as string) ?? `${m.id}-${m.version}.${ext}`);
      if (existsSync(out)) rmSync(out);
      // Exactly the files the app hashes, at the archive's root.
      const files = listFiles(dir).filter((p) => !p.endsWith(".sshkmod") && !p.endsWith(".sshkext") && p !== ".sshkipper-dev-store.json");
      const r = spawnSync("zip", ["-q", "-X", out, "-@"], { cwd: dir, input: files.join("\n") });
      if (r.status !== 0) fail(`zip: ${r.stderr?.toString().trim() || "failed"} (install zip, or use ditto -c -k on macOS)`);
      console.log(`${out} — ${files.length} files`);
      break;
    }
    case "vendor": {
      const dir = resolve(args[0] ?? ".");
      for (const [p, text] of Object.entries(vendorFiles())) {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), text);
      }
      console.log(`SDK runtime copied into ${join(dir, "lib/sshkipper-sdk")}`);
      break;
    }
    case "mcp": {
      const { serveMCP } = await import("../mcp/server.ts");
      serveMCP(process.stdin, (s) => process.stdout.write(s), { allowChanges: f["allow-changes"] === true });
      break;
    }
    case undefined: case "help":
      console.log(HELP);
      break;
    default:
      fail(`no command «${command}» — ${NAME} help`);
  }
}

// Run as a program (the old name imports it and calls `main` itself).
// `npm link` runs it through a symbolic link: both sides as real paths.
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
