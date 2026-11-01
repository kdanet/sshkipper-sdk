#!/usr/bin/env node
// sshkipper-module — the command line of the SSHKipper module SDK: new, validate, call, preview, pack, vendor, mcp.
// Node 24+ runs it as is (TypeScript types are stripped), no dependencies.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { call } from "../sdk/src/dev.ts";
import { preview } from "../sdk/src/preview.ts";
import { scaffold, vendorFiles, type Kind } from "../sdk/src/scaffold.ts";
import type { Json, Manifest } from "../sdk/src/types.ts";
import { formatIssue, listFiles, MANIFEST_FILES, manifestFile, validateFolder } from "../sdk/src/validate.ts";

const HELP = `sshkipper-module — build modules for SSHKipper (SDK 1)

  new <folder> [--process] [--id dev.acme.disks] [--title "Disks"]
                         a module that works: a service page, an action, an AI tool, an automation block
  validate [folder]      the checks the app makes before installing (schemas, handlers, files, views)
  call [folder] <handler> [--input JSON] [--settings JSON] [--item JSON] [--ssh user@host] [--container NAME]
                         [--secret key=value] [--locale ru]
                         run a handler: a server script with sh here or on --ssh; a process module's program
                         with host.exec here or on --ssh
  preview [folder] <page> [--data JSON] [--item JSON] [--settings JSON] [--run] [--ssh user@host]
                         the page as text: its template with --data (or, with --run, with what its handlers return)
  pack [folder] [-o file.sshkmod]
                         validate, then zip the module for «Install extension…» (.sshkext for sshkipper-extension.json)
  vendor [folder]        copy the SDK runtime into lib/sshkipper-sdk/ (process modules)
  mcp [--allow-changes]  the MCP server for AI agents (stdio); --allow-changes lets module_run_local run handlers that
                         change things (stop, delete, restart) on this machine — your decision, not the agent's

Docs: docs/en/README.md · Protocol: spec/protocol.md`;

type Flags = { _: string[]; [k: string]: string | string[] | boolean };

/** Flags that take no value: `new --process disks` names the folder, it isn't the flag's value. */
const SWITCHES = new Set(["process", "run", "help"]);

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
  console.error(`sshkipper-module: ${message}`);
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

const f = parse(process.argv.slice(2));
const [command, ...args] = f.help ? ["help"] : f._;

switch (command) {
  case "new": {
    const folder = args[0] ?? fail("new <folder>");
    if (existsSync(folder) && readdirSync(folder).length) fail(`${folder} isn't empty`);
    const kind: Kind = f.process ? "process" : "server";
    const id = typeof f.id === "string" ? f.id : `dev.example.${basename(resolve(folder)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "module"}`;
    const files = scaffold({ kind, id, title: typeof f.title === "string" ? f.title : "Disks" });
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, p)), { recursive: true });
      writeFileSync(join(folder, p), text);
    }
    console.log(`${kind} module ${id} in ${folder}: ${Object.keys(files).length} files`);
    report(resolve(folder));
    break;
  }
  case "validate": {
    const [dir] = folderAnd(args);
    process.exit(report(dir) ? 0 : 1);
  }
  case "call": {
    const [dir, rest] = folderAnd(args);
    const handler = rest[0] ?? fail("call [folder] <handler>");
    const secrets = Object.fromEntries(((f.secret as string[]) ?? []).map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]));
    const r = await call(dir, handler, {
      input: jsonFlag(f, "input") as Record<string, Json>, settings: jsonFlag(f, "settings") as Record<string, Json>, item: jsonFlag(f, "item"),
      ssh: f.ssh as string | undefined, container: f.container as string | undefined, secrets, locale: (f.locale as string) ?? "en",
    });
    for (const l of r.log) console.error(`· ${l}`);
    if (!r.ok && r.stderr.trim() && r.stderr.trim() !== r.error) console.error(r.stderr.trim());
    if (!r.ok) fail(r.error ?? "failed");
    console.log(typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 2));
    break;
  }
  case "preview": {
    const [dir, rest] = folderAnd(args);
    const m: Manifest = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
    const pageID = rest[0] ?? m.service?.page ?? m.pages?.[0]?.id ?? fail("preview [folder] <page>");
    const page = m.pages?.find((p) => p.id === pageID) ?? fail(`no page «${pageID}»`);
    const opts = { settings: jsonFlag(f, "settings") as Record<string, Json>, item: jsonFlag(f, "item"), ssh: f.ssh as string | undefined, locale: (f.locale as string) ?? "en" };
    let v: Json;
    const vars: Record<string, Json> = { settings: opts.settings ?? {}, item: opts.item ?? null, server: opts.ssh ? { name: opts.ssh } : null };
    if (page.render) {
      const r = await call(dir, page.render, opts);
      if (!r.ok) fail(r.error ?? "render failed");
      v = r.value!;
    } else {
      v = JSON.parse(readFileSync(join(dir, page.view!), "utf8"));
      const data: Record<string, Json> = (jsonFlag(f, "data") as Record<string, Json>) ?? {};
      if (f.run) {
        for (const [k, h] of Object.entries(page.data ?? {})) {
          const r = await call(dir, h, opts);
          if (!r.ok) fail(`${h}: ${r.error}`);
          data[k] = r.value!;
        }
      }
      vars.data = data;
    }
    console.log(preview(v, vars, (m.components ?? {}) as Record<string, Json>));
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
    serveMCP(process.stdin, (s) => process.stdout.write(s), { allowChanges: process.argv.includes("--allow-changes") });
    break;
  }
  case undefined: case "help":
    console.log(HELP);
    break;
  default:
    fail(`no command «${command}» — sshkipper-module help`);
}
