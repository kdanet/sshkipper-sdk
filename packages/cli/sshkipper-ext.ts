#!/usr/bin/env node
// sshkipper-ext — the command line of the SSHKipper extension SDK: new, validate, run, preview, pack, vendor, mcp.
// Node 24+ runs it as is (TypeScript types are stripped), no dependencies. `sshkipper-module` is its old name.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { call, callMethod } from "../sdk/src/dev.ts";
import { databaseFile, KIND_INFO, KINDS, scaffold, vendorFiles, type Kind } from "../sdk/src/scaffold.ts";
import { previewScreen, type PreviewEvent } from "../sdk/src/screens.ts";
import type { Json, Manifest } from "../sdk/src/types.ts";
import { formatIssue, MANIFEST_FILES, manifestFile, packFiles, validateFolder } from "../sdk/src/validate.ts";
import { zip } from "../sdk/src/zip.ts";

const NAME = "sshkipper-ext";

/** Every command: its usage, what it does, the flags it takes (a value flag ends with «=»), whether it names things
 * after the folder (a handler, a page) — the rest take the folder alone. */
interface Command { usage: string; about: string; flags: string[]; names: number }

const COMMANDS: Record<string, Command> = {
  new: {
    usage: "new <folder> [--kind KIND] [--process] [--module] [--id dev.acme.disks] [--title \"Disks\"]",
    about: `an extension that works, one kind of contribution (--kind, «service» by default):
${KINDS.map((k) => `  ${k.padEnd(10)} ${KIND_INFO[k]}`).join("\n")}
--process: a service as a TypeScript program on this Mac; --module: a service as sshkipper-module.json (.sshkmod)`,
    flags: ["kind=", "process", "module", "id=", "title="], names: 0,
  },
  validate: {
    usage: "validate [folder]",
    about: "the checks the app makes before installing (schemas, handlers, files, views, contributions); exit 1 on errors",
    flags: [], names: 0,
  },
  run: {
    usage: `run [folder] <handler> [--input JSON] [--settings JSON] [--item JSON] [--node JSON] [--ssh user@host]
    [--container NAME] [--secret key=value]… [--locale ru]
run [folder] <method> [--params JSON] [--file PATH --importer ID] [--node JSON] [--ssh user@host] [--locale ru]`,
    about: `a handler: a server script with sh here or on --ssh; a program's handler with host.exec here or on --ssh.
--input is checked against the params of the handler's actions, tools and blocks, as the app checks it.
A name with a slash is a contribution's own method of a program: storage/list, source/poll, import/parse (--file:
the file's bytes as the app sends them, --importer: the contributes.import id), ai/models, ai/chat, ui/event…
A JSON value may be @file. («call» — the same, its old name.)`,
    flags: ["input=", "settings=", "item=", "node=", "ssh=", "container=", "secret=", "locale=", "params=", "file=", "importer="], names: 1,
  },
  preview: {
    usage: "preview [folder] [page|screen] [--data JSON] [--run] [--node JSON] [--events JSON] [--wait MS] [--settings JSON] [--item JSON] [--ssh user@host] [--locale ru]",
    about: `a page or a screen as text: a template with --data (--run — with what its data handlers return), a rendered
page, a screen of contributes.screen (--node — its node); a live screen gets --events in order
([{"type": "open"}, {"type": "press", "value": {...}}]), their ops and the program's pushes applied. Exit 1 when
the view has errors, an op doesn't apply or an event fails.`,
    flags: ["data=", "run", "node=", "events=", "wait=", "settings=", "item=", "ssh=", "locale="], names: 1,
  },
  pack: {
    usage: "pack [folder] [-o file]",
    about: `validate, then zip it for «Установить расширение…»: .sshkext (sshkipper-extension.json) or .sshkmod
(sshkipper-module.json). The same files give the same bytes: paths sorted, one fixed time.`,
    flags: ["out="], names: 0,
  },
  vendor: {
    usage: "vendor [folder]",
    about: `copy the SDK runtime into lib/sshkipper-sdk/ of a TypeScript program (and lib/database.ts of a database
driver that has one) — again after updating the SDK`,
    flags: [], names: 0,
  },
  mcp: {
    usage: "mcp [--allow-changes]",
    about: `the MCP server for AI agents (stdio). Without --allow-changes it runs only what reads: handlers referenced
as reading (detect, summary, page data, render, risk «read») and reading methods. --allow-changes is the
person's decision, made when starting it — not the agent's.`,
    flags: ["allow-changes"], names: 0,
  },
  help: { usage: "help [command]", about: "this text, or one command's", flags: [], names: 1 },
};
COMMANDS.call = COMMANDS.run;

const HELP = `${NAME} — build extensions for SSHKipper (SDK 1)

${Object.entries(COMMANDS).filter(([k]) => k !== "call").map(([, c]) => `  ${c.usage.split("\n").join("\n  ")}`).join("\n")}

${NAME} <command> --help — what a command does. Docs: docs/en/README.md · Protocol: spec/protocol.md`;

const commandHelp = (name: string, c: Command) => `${NAME} ${c.usage}\n\n${c.about}`;

type Flags = { _: string[]; [k: string]: string | string[] | boolean };

function fail(message: string): never {
  console.error(`${NAME}: ${message}`);
  process.exit(1);
}

/** The arguments of `command`: an unknown flag, or a value flag with no value, is an error. */
function parse(command: string, c: Command, argv: string[]): Flags {
  const f: Flags = { _: [] };
  const takesValue = new Set(c.flags.filter((x) => x.endsWith("=")).map((x) => x.slice(0, -1)));
  const switches = new Set(c.flags.filter((x) => !x.endsWith("=")));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { f.help = true; continue; }
    if (a === "-o" && takesValue.has("out")) { f.out = argv[++i] ?? fail("-o: give the file"); continue; }
    if (!a.startsWith("--")) { f._.push(a); continue; }
    const eq = a.indexOf("=");
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (switches.has(k)) { if (eq > 0) fail(`--${k} takes no value`); f[k] = true; continue; }
    if (!takesValue.has(k)) {
      const known = c.flags.map((x) => `--${x.replace(/=$/, "")}`).join(", ") || "none";
      fail(`${command}: no flag --${k} (flags: ${known}) — ${NAME} ${command} --help`);
    }
    const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (v === undefined || (eq < 0 && v.startsWith("--"))) fail(`--${k} needs a value — ${NAME} ${command} --help`);
    if (k === "secret") f.secret = [...((f.secret as string[]) ?? []), v];
    else if (f[k] !== undefined) fail(`--${k} given twice`);
    else f[k] = v;
  }
  return f;
}

function jsonFlag(f: Flags, k: string): Json | undefined {
  const v = f[k];
  if (typeof v !== "string") return undefined;
  let text = v;
  if (v.startsWith("@")) {
    try { text = readFileSync(v.slice(1), "utf8"); } catch (e) { fail(`--${k}: ${(e as Error).message}`); }
  }
  try { return JSON.parse(text); } catch (e) { fail(`--${k}: not JSON (${(e as Error).message})`); }
}

const hasManifest = (dir: string) => MANIFEST_FILES.some((m) => existsSync(join(dir, m)));
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** [folder, names]: the first argument is the folder when it is a path — an existing one, or one written as a path
 * («./x», «../x», «/x», «~/x») — else (a command that names things) the current folder. A folder without a manifest
 * is an error, never quietly the current folder. */
function folderAnd(command: string, args: string[], names: number): [string, string[]] {
  const first = args[0];
  const pathLike = first !== undefined && (existsSync(first) || /^(\.{1,2}|~)?\//.test(first) || first === "." || first === ".." || names === 0);
  let dir = ".", rest = args;
  if (first !== undefined && pathLike) { dir = first; rest = args.slice(1); }
  if (!existsSync(dir)) fail(`${dir}: no such folder`);
  if (!isDir(dir)) fail(`${dir} isn't a folder`);
  if (!hasManifest(dir)) fail(dir === "." ? "no sshkipper-extension.json or sshkipper-module.json here: name the extension's folder" : `${dir}: no sshkipper-extension.json or sshkipper-module.json in it`);
  if (rest.length > names) fail(`${command}: unexpected «${rest[names]}» — ${NAME} ${command} --help`);
  return [resolve(dir), rest];
}

function report(dir: string): boolean {
  const r = validateFolder(dir);
  for (const i of r.issues) console.log(formatIssue(i));
  const errors = r.issues.filter((i) => i.severity === "error").length;
  const warnings = r.issues.length - errors;
  let count = r.files.length;
  try { count = packFiles(dir).length; } catch { /* the issues say why */ }
  console.log(errors ? `${errors} error(s), ${warnings} warning(s): fix the errors — the app refuses some of them on install, the rest break pages or calls` : `ok — ${r.manifest?.id} ${r.manifest?.version}, ${count} files${warnings ? `, ${warnings} warning(s)` : ""}`);
  return errors === 0;
}

const print = (v: Json | undefined) => console.log(typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2));

export async function main(argv: string[]) {
  const [first, ...tail] = argv;
  if (first === undefined || first === "help" || first === "-h" || first === "--help") {
    const c = first === "help" && tail[0] ? COMMANDS[tail[0]] : undefined;
    if (first === "help" && tail[0] && !c) fail(`no command «${tail[0]}» — ${NAME} help`);
    console.log(c ? commandHelp(tail[0], c) : HELP);
    return;
  }
  const command = first;
  const c = COMMANDS[command] ?? fail(`no command «${command}» — ${NAME} help`);
  const f = parse(command, c, tail);
  if (f.help) { console.log(commandHelp(command, c)); return; }
  const args = f._;
  switch (command) {
    case "new": {
      if (args.length !== 1) fail(`new <folder> [--kind …] — ${NAME} new --help`);
      const folder = args[0];
      if (existsSync(folder) && (!isDir(folder) || readdirSync(folder).length)) fail(`${folder} isn't an empty folder`);
      const kind = (typeof f.kind === "string" ? f.kind : "service") as Kind;
      if (!(KINDS as readonly string[]).includes(kind)) fail(`--kind ${kind}: one of ${KINDS.join(", ")}`);
      for (const k of ["process", "module"]) if (f[k] && kind !== "service") fail(`--${k} is for --kind service, not ${kind}`);
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
      if (!report(resolve(folder))) process.exit(1);
      break;
    }
    case "validate": {
      const [dir] = folderAnd(command, args, 0);
      process.exit(report(dir) ? 0 : 1);
    }
    case "run": case "call": {
      const [dir, rest] = folderAnd(command, args, 1);
      const name = rest[0] ?? fail(`run [folder] <handler|method> — ${NAME} run --help`);
      const secrets: Record<string, string> = {};
      for (const s of (f.secret as string[]) ?? []) {
        if (!s.includes("=")) fail(`--secret ${s}: key=value`);
        secrets[s.slice(0, s.indexOf("="))] = s.slice(s.indexOf("=") + 1);
      }
      const opts = {
        input: jsonFlag(f, "input") as Record<string, Json>, settings: jsonFlag(f, "settings") as Record<string, Json>, item: jsonFlag(f, "item"),
        node: jsonFlag(f, "node"), ssh: f.ssh as string | undefined, container: f.container as string | undefined, secrets, locale: (f.locale as string) ?? "en",
      };
      if (opts.input !== undefined && (typeof opts.input !== "object" || opts.input === null || Array.isArray(opts.input))) fail("--input: a JSON object");
      // A name with a slash is a contribution's own method; the rest are handlers.
      if (name.includes("/")) {
        for (const k of ["input", "item", "container", "secret"]) if (f[k] !== undefined) fail(`--${k} is for a handler; a method takes --params`);
        let params = (jsonFlag(f, "params") ?? {}) as Record<string, Json>;
        if (name === "import/parse" || f.file !== undefined || f.importer !== undefined) {
          const m: Manifest = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
          const importers = (m.contributes?.import ?? []).map((x) => x.id);
          if (name !== "import/parse") fail("--file and --importer are for import/parse");
          if (typeof f.file !== "string") fail(`import/parse needs --file PATH (the file the user would pick) and --importer ID: ${importers.join(", ") || "the manifest has no contributes.import"}`);
          if (typeof f.importer !== "string") fail(`--importer ID is needed: ${importers.join(", ") || "the manifest has no contributes.import"}`);
          if (!importers.includes(f.importer)) fail(`--importer ${f.importer}: no such contributes.import — ${importers.join(", ") || "none"}`);
          let data: Buffer;
          try { data = readFileSync(f.file); } catch (e) { fail(`--file: ${(e as Error).message}`); }
          params = { importer: f.importer, name: basename(f.file), size: data.length, data: data.toString("base64"), locale: opts.locale, ...params };
        }
        const r = await callMethod(dir, name, params, opts);
        for (const l of r.log) console.error(`· ${l}`);
        for (const n of r.notices) console.error(`← ${n.method} ${JSON.stringify(n.params).slice(0, 200)}`);
        if (!r.ok) { if (r.stderr.trim()) console.error(r.stderr.trim()); fail(r.error ?? "failed"); }
        print(r.value);
        break;
      }
      for (const k of ["params", "file", "importer"]) if (f[k] !== undefined) fail(`--${k} is for a method (a name with a slash); a handler takes --input`);
      const r = await call(dir, name, opts);
      for (const l of r.log) console.error(`· ${l}`);
      if (!r.ok && r.stderr.trim() && r.stderr.trim() !== r.error) console.error(r.stderr.trim());
      if (!r.ok) fail(r.error ?? "failed");
      print(r.value);
      break;
    }
    case "preview": {
      const [dir, rest] = folderAnd(command, args, 1);
      const events = jsonFlag(f, "events");
      if (events !== undefined && !Array.isArray(events)) fail("--events: a JSON array of events");
      const wait = typeof f.wait === "string" ? Number(f.wait) : undefined;
      if (wait !== undefined && !(wait >= 0)) fail("--wait: milliseconds");
      let failed = false;
      try {
        const r = await previewScreen(dir, rest[0], {
          data: jsonFlag(f, "data") as Record<string, Json>, run: f.run === true, settings: jsonFlag(f, "settings") as Record<string, Json>,
          item: jsonFlag(f, "item"), node: jsonFlag(f, "node"), ssh: f.ssh as string | undefined, locale: (f.locale as string) ?? "en",
          events: events as unknown as PreviewEvent[] | undefined, wait,
        });
        console.log(r.text);
        for (const a of r.answers) console.error(`→ ${a}`);
        for (const p of r.problems) console.error(`✗ op ${p.index} (${p.op}): ${p.message}`);
        for (const i of r.issues) console.error(i);
        for (const l of r.log) console.error(`· ${l}`);
        failed = r.problems.length > 0 || r.issues.some((i) => i.startsWith("✗")) || r.answers.some((a) => /: (error —|not sent)/.test(a));
      } catch (e) { fail((e as Error).message); }
      if (failed) process.exit(1);
      break;
    }
    case "pack": {
      const [dir] = folderAnd(command, args, 0);
      if (!report(dir)) process.exit(1);
      const name = manifestFile(dir);
      const m: Manifest = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const ext = name === "sshkipper-extension.json" ? "sshkext" : "sshkmod";
      const out = resolve((f.out as string) ?? `${m.id}-${m.version}.${ext}`);
      // Exactly the files the app hashes, at the archive's root.
      const files = packFiles(dir);
      const archive = zip(files.map((p) => {
        const at = join(dir, p);
        return { path: p, data: readFileSync(at), executable: (statSync(at).mode & 0o111) !== 0 };
      }));
      try { writeFileSync(out, archive); } catch (e) { fail(`${out}: ${(e as Error).message}`); }
      console.log(`${out} — ${files.length} files`);
      break;
    }
    case "vendor": {
      const [dir] = folderAnd(command, args, 0);
      const m: Manifest = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
      if (m.runtime?.kind !== "process") fail(`${dir}: scripts on the server carry no SDK runtime — vendor is for a program (runtime.kind «process»)`);
      // A driver that carries only the database protocol keeps only that; a program of the SDK runtime gets it anew.
      const own: Record<string, string> = {};
      if (existsSync(join(dir, "lib/database.ts"))) own["lib/database.ts"] = databaseFile();
      if (existsSync(join(dir, "lib/sshkipper-sdk")) || !own["lib/database.ts"]) Object.assign(own, vendorFiles());
      for (const [p, text] of Object.entries(own)) {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), text);
      }
      console.log(`${Object.keys(own).join(", ")} → ${dir}`);
      break;
    }
    case "mcp": {
      if (args.length) fail(`mcp: unexpected «${args[0]}»`);
      const { serveMCP } = await import("../mcp/server.ts");
      serveMCP(process.stdin, (s) => process.stdout.write(s), { allowChanges: f["allow-changes"] === true });
      break;
    }
  }
}

// Run as a program (bin/ and the old name import it and call `main` themselves).
// `npm link` runs it through a symbolic link: both sides as real paths.
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
