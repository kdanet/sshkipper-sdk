#!/usr/bin/env node
// The MCP server of the SSHKipper extension SDK: lets an AI agent learn the SDK (a guide per contribution, the
// schemas, the UI-Kit), scaffold an extension of any kind, check it, preview its pages and live screens, and run its
// handlers and contribution methods on this machine. stdio, newline-delimited JSON-RPC (MCP 2025-06-18), no
// dependencies. Start with `sshkipper-ext mcp` or `node packages/mcp/server.ts`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogText } from "../sdk/src/catalog.ts";
import { call, callMethod, referrers } from "../sdk/src/dev.ts";
import { applyOps, preview } from "../sdk/src/preview.ts";
import { KIND_INFO, KINDS, scaffold, type Kind } from "../sdk/src/scaffold.ts";
import { previewScreen, type PreviewEvent } from "../sdk/src/screens.ts";
import { expand } from "../sdk/src/template.ts";
import type { Json, Manifest } from "../sdk/src/types.ts";
import { formatIssue, manifestFile, schema, symbols, validateFolder, validateManifest, validateView } from "../sdk/src/validate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const VERSION = "1.1.0";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Guides by topic: a file of docs/<lang>/, or of the repository (the protocol). */
const GUIDES: Record<string, string> = {
  overview: "README.md", "getting-started": "getting-started.md", manifest: "manifest.md", "ui-kit": "ui-kit.md",
  "ui-kit-reference": "ui-kit-reference.md", server: "server-modules.md", process: "process-modules.md", swift: "swift.md",
  "ai-and-automation": "ai-and-automation.md", "storage-and-sources": "storage-and-sources.md", "database-drivers": "database-drivers.md",
  "node-types": "node-types.md", "importers-and-consoles": "importers-and-consoles.md", publishing: "publishing.md", security: "security.md",
  agents: "agents.md", glossary: "../glossary.md", protocol: "../../spec/protocol.md", "database-protocol": "../../spec/database.md",
};

/** The guide of each kind of contribution: what to read before writing one. */
const KIND_GUIDE: Record<string, string> = {
  service: "server", database: "database-drivers", storage: "storage-and-sources", source: "storage-and-sources",
  "node-type": "node-types", import: "importers-and-consoles", console: "importers-and-consoles", ai: "ai-and-automation", automation: "ai-and-automation",
};

const guide = (topic: string, lang = "en") => {
  const f = GUIDES[topic];
  if (!f) throw new Error(`no guide «${topic}»: ${Object.keys(GUIDES).join(", ")}`);
  const localized = join(root, "docs", lang, f);
  return readFileSync(lang !== "en" && existsSync(localized) ? localized : join(root, "docs/en", f), "utf8");
};

const text = (s: string, isError = false) => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });
const issuesText = (issues: { severity: string; path: string; message: string }[]) =>
  issues.length ? issues.map((i) => formatIssue(i as never)).join("\n") : "no issues";

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/** Methods of a contribution that only read: run without --allow-changes. */
const READ_METHODS = new Set(["storage/list", "storage/stat", "storage/read", "storage/check", "source/poll", "source/check", "import/parse", "ai/models"]);
/** Events of a live screen that only look (by the protocol's convention): the rest may change things. */
const READ_EVENTS = new Set(["open", "close", "select", "expand", "collapse", "more", "sort", "change", "complete"]);
const ALLOW = "the person who started this MCP server can restart it with `sshkipper-ext mcp --allow-changes`";

/** Whether a handler only reads, by what the manifest uses it for: true, or why not. Reading uses — a service's
 * detect, summary and tree, a page's data and render, a screen's render, an action, tool or block of risk «read» —
 * and no changing one. Anything else (a handler nothing names, an event handler, a change) counts as a change. */
export function readingHandler(m: Manifest, handler: string): true | string {
  const reads: string[] = [];
  for (const s of [m.service, m.contributes?.service]) {
    if (!s) continue;
    if (s.detect === handler) reads.push("service.detect");
    if (s.summary === handler) reads.push("service.summary");
    if (s.tree?.handler === handler) reads.push("service.tree");
  }
  for (const p of m.pages ?? []) {
    if (p.render === handler || Object.values(p.data ?? {}).includes(handler)) reads.push(`page «${p.id}»`);
  }
  for (const s of m.contributes?.screen ?? []) if (s.render === handler) reads.push(`screen «${s.id}»`);
  const refs = referrers(m, handler);
  const changes = refs.filter((r) => r.risk !== "read");
  if (changes.length) return `is the handler of ${changes.map((r) => `${r.what} (${r.risk})`).join(", ")}: it changes things`;
  if (!reads.length && !refs.length) return "isn't used for reading anywhere in the manifest (detect, summary, a page's data or render, a screen's render, risk «read»): it counts as a change";
  return true;
}

const TOOLS = [
  {
    name: "sdk_guide",
    description: "The SSHKipper extension SDK documentation. Start with «overview» (the map: an extension = contributions), then «getting-started», then the guide of your kind of contribution. Topics: " + Object.keys(GUIDES).join(", ") + ". «lang»: en (default) or ru.",
    inputSchema: obj({ topic: { type: "string", enum: Object.keys(GUIDES) }, lang: { type: "string", enum: ["en", "ru"] } }, ["topic"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "sdk_schema",
    description: "A JSON Schema of SDK 1: «module» (sshkipper-extension.json and sshkipper-module.json: contributions, handlers, permissions), «view» (a page or a live screen: blocks, templates, ops) or «symbols» (the SF Symbols the app draws).",
    inputSchema: obj({ name: { type: "string", enum: ["module", "view", "symbols"] } }, ["name"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "ui_kit",
    description: "Every UI-Kit block with its fields and an example — a live screen's own too (datatable, tree, split, editor, terminal, toolbar, sheet, live chart) — styles, actions, the ops of ui/patch, templates and the SF Symbols the app draws. Read it before writing a view.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: "ext_scaffold",
    description: "A working extension to start from, one per kind: " + KINDS.map((k) => `${k} — ${KIND_INFO[k]}`).join("; ") + ". Returns its files and the guide to read; with «folder» also writes them there (the folder must not exist or be empty).",
    inputSchema: obj({
      kind: { type: "string", enum: [...KINDS], description: "What it contributes" },
      process: { type: "boolean", description: "kind service: a program on this Mac (TypeScript, JSON-RPC) instead of sh scripts on the server" },
      id: { type: "string", description: "Reverse-DNS id: dev.acme.queues" },
      title: { type: "string" },
      folder: { type: "string", description: "Where to write it (absolute path)" },
    }, ["kind", "id", "title"]),
  },
  {
    name: "ext_validate",
    description: "The checks SSHKipper makes before installing an extension: schemas, handlers, files, pages, views, symbols, contributions. Give «folder» (an extension folder) or «manifest» (its JSON) with optional «files» (relative paths).",
    inputSchema: obj({ folder: { type: "string" }, manifest: { type: "object" }, files: { type: "array", items: { type: "string" } } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "view_preview",
    description: "A view as text, the way the app would draw it, after template expansion with the given data — and after «ops» (ui/patch) when given; plus what's wrong with it. Use it to check a page or a screen's JSON without the app.",
    inputSchema: obj({
      view: { type: "object" },
      data: { type: "object", description: "data.* — what the page's data handlers return, by name" },
      item: {}, settings: { type: "object" }, server: { type: "object" },
      components: { type: "object", description: "The manifest's components" },
      ops: { type: "array", description: "Ops of ui/patch / ui/push to apply to the view, in order" },
    }, ["view"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "screen_preview",
    description: "Builds a page or a screen (contributes.screen) of an extension folder ON THIS MACHINE — its render handler or template — and sends it live-screen events in order, applying the ops each answers and the program's own pushes: the screen as text after each step, what each event got, ops that didn't apply. Events that only look (open, close, select, expand, collapse, more, sort, change, complete) always run; press, submit, edit, menu, drop, move, activate may change things and run only with --allow-changes.",
    inputSchema: obj({
      folder: { type: "string" }, id: { type: "string", description: "A page id or a screen id (default: the service's page, else the first screen)" },
      node: { type: "object", description: "context.node of a node type's screen: {id, name, type, settings, links, secrets}" },
      settings: { type: "object" }, data: { type: "object" }, run: { type: "boolean", description: "A template page: call its data handlers" },
      events: { type: "array", items: { type: "object" }, description: "[{type, block?, value?}] in order" },
      wait: { type: "number", description: "Milliseconds to wait for the program's pushes after the last event (≤ 10000)" },
      locale: { type: "string" },
    }, ["folder"]),
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: "template_expand",
    description: "Expands a view template (each, if, use, {{ }} placeholders and filters) the way the app does; returns the JSON.",
    inputSchema: obj({ view: { type: "object" }, vars: { type: "object" }, components: { type: "object" } }, ["view"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "ext_run_local",
    description: "Runs one handler — or one method of a contribution (storage/list, source/poll, import/parse, ai/models…) — of an extension folder ON THIS MACHINE (server scripts with sh, programs as the app starts them; host.exec runs here too), to see what it returns while writing it — never on servers. Safe by default: without --allow-changes (the person's flag when starting this server, not a parameter) only what reads runs — a handler the manifest uses for reading (service detect, summary or tree, a page's data or render, a screen's render, an action, tool or block of risk «read») and the methods that read; everything else, a handler nothing names included, is refused. Consoles are interactive: try them in the app.",
    inputSchema: obj({
      folder: { type: "string" }, handler: { type: "string" }, method: { type: "string" },
      input: { type: "object" }, params: { type: "object", description: "A method's params, as the app sends them (spec/protocol.md §12–15)" },
      settings: { type: "object" }, item: {}, node: { type: "object" }, locale: { type: "string" },
    }, ["folder"]),
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

/** Old names (SDK 1.0) still answered. */
const ALIASES: Record<string, string> = { module_scaffold: "ext_scaffold", module_validate: "ext_validate", module_run_local: "ext_run_local" };

const manifestOf = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));

async function tool(name: string, a: Record<string, any>) {
  switch (ALIASES[name] ?? name) {
    case "sdk_guide": return text(guide(a.topic, a.lang ?? "en"));
    case "sdk_schema": return text(JSON.stringify(schema(a.name), null, 2));
    case "ui_kit": return text(catalogText([...symbols()].sort()));
    case "ext_scaffold": {
      // The old tool's kinds: server / process — a service.
      const kind = (a.kind === "server" || a.kind === "process" ? "service" : a.kind) as Kind;
      const files = scaffold({ kind, id: a.id, title: a.title, process: a.process === true || a.kind === "process" });
      if (a.folder) {
        const dir = resolve(a.folder);
        if (existsSync(dir) && readdirSync(dir).length) return text(`${dir} isn't empty: nothing written`, true);
        for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
      }
      // The vendored SDK is long and the same for every extension: named, not shown.
      const shown = Object.entries(files).filter(([p]) => !p.startsWith("lib/"));
      const vendored = Object.keys(files).filter((p) => p.startsWith("lib/"));
      return text(`${a.folder ? `Written to ${resolve(a.folder)}.\n\n` : ""}Read next: sdk_guide «${KIND_GUIDE[kind]}».\n\n${shown.map(([p, t]) => `--- ${p}\n${t}`).join("\n")}${vendored.length ? `\n--- ${vendored.join(", ")}: the SDK runtime (sshkipper-ext vendor)` : ""}`);
    }
    case "ext_validate": {
      if (a.folder) {
        const r = validateFolder(resolve(a.folder));
        return text(`${r.manifest ? `${r.manifest.id} ${r.manifest.version}, ${r.files.length} files\n` : ""}${issuesText(r.issues)}`);
      }
      if (a.manifest) return text(issuesText(validateManifest(a.manifest as Manifest, a.files ? new Set(a.files) : undefined)));
      return text("give «folder» or «manifest»", true);
    }
    case "view_preview": {
      const vars = { data: a.data ?? {}, item: a.item ?? null, settings: a.settings ?? {}, server: a.server ?? null };
      const issues = validateView(a.view, { components: a.components, vars });
      let out: string;
      let problems = "";
      try {
        let v: Json = expand(a.view, vars, a.components ?? {});
        if (Array.isArray(a.ops) && a.ops.length) {
          const r = applyOps(v, a.ops);
          v = r.view;
          problems = r.problems.map((p) => `✗ op ${p.index} (${p.op}): ${p.message}`).join("\n");
        }
        out = preview(v);
      } catch (e) { out = `(not drawn: ${(e as Error).message})`; }
      return text(`${out}${problems ? `\n\n${problems}` : ""}\n\n${issuesText(issues)}`);
    }
    case "screen_preview": {
      const events = (Array.isArray(a.events) ? a.events : []) as PreviewEvent[];
      const changing = events.filter((e) => !READ_EVENTS.has(e.type)).map((e) => e.type);
      if (changing.length && !options.allowChanges) {
        return text(`events ${[...new Set(changing)].join(", ")} may change things — the program would act on this machine: not allowed; ${ALLOW}. Events that only look run: ${[...READ_EVENTS].join(", ")}.`, true);
      }
      const r = await previewScreen(resolve(a.folder), a.id, {
        node: a.node, settings: a.settings, data: a.data, run: a.run === true, events, wait: Math.min(Number(a.wait ?? 0), 10_000), locale: a.locale ?? "en",
      });
      const parts = [r.text];
      if (r.answers.length) parts.push(`events:\n${r.answers.join("\n")}`);
      if (r.problems.length) parts.push(`ops not applied:\n${r.problems.map((p) => `op ${p.index} (${p.op}): ${p.message}`).join("\n")}`);
      parts.push(r.issues.length ? `view:\n${r.issues.join("\n")}` : "view: no issues");
      if (r.log.length) parts.push(`log:\n${r.log.join("\n")}`);
      return text(parts.join("\n\n"));
    }
    case "template_expand":
      return text(JSON.stringify(expand(a.view, a.vars ?? {}, a.components ?? {}), null, 2));
    case "ext_run_local": {
      const dir = resolve(a.folder);
      const m = manifestOf(dir);
      const opts = { input: a.input, settings: a.settings, item: a.item, node: a.node, locale: a.locale ?? "en" };
      if (a.method) {
        const method = String(a.method);
        if (method.startsWith("console/")) return text("a console is interactive (bytes both ways): open it in the app — a connection's menu → «Console: <title>»", true);
        const reads = READ_METHODS.has(method) || (method === "storage/link" && (a.params?.action ?? "list") === "list");
        if (!reads && !options.allowChanges) {
          return text(`«${method}» may change things (writes, deletes, a model's API) — it would run on this machine: not allowed; ${ALLOW}. Methods that only read run: ${[...READ_METHODS].join(", ")}.`, true);
        }
        const r = await callMethod(dir, method, a.params ?? {}, opts);
        const notes = r.notices.length ? `\n\nnotifications:\n${r.notices.map((n) => `${n.method} ${JSON.stringify(n.params).slice(0, 300)}`).join("\n")}` : "";
        const log = r.log.length ? `\n\nlog:\n${r.log.join("\n")}` : "";
        return r.ok ? text(JSON.stringify(r.value, null, 2) + notes + log) : text(`${r.error}${r.stderr ? `\n\nstderr:\n${r.stderr.slice(-4000)}` : ""}${log}`, true);
      }
      if (!a.handler) return text("give «handler» or «method»", true);
      // Safe by default: without --allow-changes only a handler the manifest uses for reading runs on the agent's
      // machine (a kill handler would kill a local PID). A parameter the agent sets itself would be no one's consent.
      const why = readingHandler(m, String(a.handler));
      if (why !== true && !options.allowChanges) return text(`«${a.handler}» ${why} — it would run on this machine: not allowed; ${ALLOW}.`, true);
      const r = await call(dir, a.handler, opts);
      const log = r.log.length ? `\n\nlog:\n${r.log.join("\n")}` : "";
      return r.ok ? text(JSON.stringify(r.value, null, 2) + log) : text(`${r.error}${r.stderr ? `\n\nstderr:\n${r.stderr.slice(-4000)}` : ""}${log}`, true);
    }
  }
  throw Object.assign(new Error(`no tool ${name}`), { code: -32602 });
}

const RESOURCES = [
  ...Object.keys(GUIDES).map((t) => ({ uri: `sshkipper-sdk://guide/${t}`, name: `guide: ${t}`, mimeType: "text/markdown" })),
  ...Object.keys(GUIDES).filter((t) => existsSync(join(root, "docs/ru", GUIDES[t]))).map((t) => ({ uri: `sshkipper-sdk://guide/ru/${t}`, name: `руководство: ${t}`, mimeType: "text/markdown" })),
  { uri: "sshkipper-sdk://schema/module", name: "module.schema.json", mimeType: "application/schema+json" },
  { uri: "sshkipper-sdk://schema/view", name: "view.schema.json", mimeType: "application/schema+json" },
];

function readResource(uri: string) {
  const g = uri.match(/^sshkipper-sdk:\/\/guide\/(?:(ru|en)\/)?(.+)$/);
  if (g) return { uri, mimeType: "text/markdown", text: guide(g[2], g[1] ?? "en") };
  const s = uri.match(/^sshkipper-sdk:\/\/schema\/(module|view)$/);
  if (s) return { uri, mimeType: "application/schema+json", text: JSON.stringify(schema(s[1] as "module" | "view"), null, 2) };
  throw Object.assign(new Error(`no resource ${uri}`), { code: -32002 });
}

const INSTRUCTIONS = `Tools for writing SSHKipper extensions (SDK 1) for a native macOS SSH manager. An extension is a folder with sshkipper-extension.json listing contributions: a service of servers with pages and live screens, AI tools, automation blocks, a database engine, a storage, a source of servers, a node type with its screen, an importer, a console, a model provider.
Read sdk_guide «overview» and ui_kit first; ext_scaffold gives a working start for each kind and names the guide to read; check every change with ext_validate, view_preview and screen_preview; ext_run_local runs a handler or a contribution's method on this machine. Views are JSON the app draws natively — no HTML.`;

async function handle(msg: any): Promise<unknown> {
  const p = msg.params ?? {};
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "sshkipper-sdk", version: VERSION },
        instructions: INSTRUCTIONS,
      };
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call":
      try { return await tool(p.name, p.arguments ?? {}); } catch (e) {
        if ((e as { code?: number }).code === -32602) throw e;
        return text((e as Error).message, true);
      }
    case "resources/list": return { resources: RESOURCES };
    case "resources/read": return { contents: [readResource(p.uri)] };
    default: throw Object.assign(new Error(`no method ${msg.method}`), { code: -32601 });
  }
}

/// How the server was started (by the person, not the agent): `--allow-changes` lets ext_run_local and screen_preview
/// run what changes things on this machine.
const options = { allowChanges: false };

/** Serves MCP over `input`/`output` (stdio by default). */
export function serveMCP(input: NodeJS.ReadableStream = process.stdin, write: (s: string) => void = (s) => process.stdout.write(s),
                         opts: { allowChanges?: boolean } = {}) {
  options.allowChanges = opts.allowChanges === true;
  let buf = "";
  input.setEncoding?.("utf8");
  input.on("data", async (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); continue; }
      if (msg.id === undefined) continue; // notifications: initialized, cancelled
      try { write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: await handle(msg) }) + "\n"); } catch (e) {
        write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: (e as { code?: number }).code ?? -32603, message: (e as Error).message } }) + "\n");
      }
    }
  });
}

// Run as a program (not imported by the CLI or a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveMCP(process.stdin, (s) => process.stdout.write(s), { allowChanges: process.argv.includes("--allow-changes") });
}
