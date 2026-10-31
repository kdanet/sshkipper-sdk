#!/usr/bin/env node
// The MCP server of the SSHKipper module SDK: lets an AI agent learn the SDK, scaffold a module, check it, preview
// its pages and run its handlers on this machine. stdio, newline-delimited JSON-RPC (MCP 2025-06-18), no
// dependencies. Start with `sshkipper-module mcp` or `node packages/mcp/server.ts`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogText } from "../sdk/src/catalog.ts";
import { call } from "../sdk/src/dev.ts";
import { preview } from "../sdk/src/preview.ts";
import { scaffold } from "../sdk/src/scaffold.ts";
import { expand } from "../sdk/src/template.ts";
import type { Json, Manifest } from "../sdk/src/types.ts";
import { formatIssue, schema, symbols, validateFolder, validateManifest, validateView } from "../sdk/src/validate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const VERSION = "1.0.0";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const GUIDES: Record<string, string> = {
  overview: "README.md", "getting-started": "getting-started.md", manifest: "manifest.md", "ui-kit": "ui-kit.md",
  server: "server-modules.md", process: "process-modules.md", "ai-and-automation": "ai-and-automation.md",
  publishing: "publishing.md", security: "security.md", agents: "agents.md", "ui-kit-reference": "ui-kit-reference.md",
  protocol: "../../spec/protocol.md",
};

const guide = (topic: string) => {
  const f = GUIDES[topic];
  if (!f) throw new Error(`no guide «${topic}»: ${Object.keys(GUIDES).join(", ")}`);
  return readFileSync(join(root, "docs/en", f), "utf8");
};

const text = (s: string, isError = false) => ({ content: [{ type: "text", text: s }], ...(isError ? { isError: true } : {}) });
const issuesText = (issues: { severity: string; path: string; message: string }[]) =>
  issues.length ? issues.map((i) => formatIssue(i as never)).join("\n") : "no issues";

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const TOOLS = [
  {
    name: "sdk_guide",
    description: "The SSHKipper module SDK documentation. Start with topic «overview», then «getting-started». Topics: " + Object.keys(GUIDES).join(", ") + ".",
    inputSchema: obj({ topic: { type: "string", enum: Object.keys(GUIDES) } }, ["topic"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "sdk_schema",
    description: "A JSON Schema of SDK 1: «module» (sshkipper-module.json) or «view» (a page view: blocks, templates).",
    inputSchema: obj({ name: { type: "string", enum: ["module", "view"] } }, ["name"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "ui_kit",
    description: "Every UI-Kit block with its fields and an example, styles, actions, templates and the SF Symbols the app draws. Read it before writing a view.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: "module_scaffold",
    description: "A working module to start from (a service page, an action, an AI tool; an automation block for server modules). Returns its files; with «folder» also writes them there (the folder must not exist or be empty).",
    inputSchema: obj({
      kind: { type: "string", enum: ["server", "process"], description: "server — sh scripts run on the server over the app's SSH session; process — a program on the Mac (TypeScript), JSON-RPC" },
      id: { type: "string", description: "Reverse-DNS id: dev.acme.queues" },
      title: { type: "string" },
      folder: { type: "string", description: "Where to write it (absolute path)" },
    }, ["kind", "id", "title"]),
  },
  {
    name: "module_validate",
    description: "The checks SSHKipper makes before installing a module: schemas, handlers, files, pages, views, symbols. Give «folder» (a module folder) or «manifest» (its JSON) with optional «files» (relative paths).",
    inputSchema: obj({
      folder: { type: "string" },
      manifest: { type: "object" },
      files: { type: "array", items: { type: "string" } },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "view_preview",
    description: "A view as text, the way the app would draw it, after template expansion with the given data; plus what's wrong with it. Use it to check a page without the app.",
    inputSchema: obj({
      view: { type: "object" },
      data: { type: "object", description: "data.* — what the page's data handlers return, by name" },
      item: {}, settings: { type: "object" }, server: { type: "object" },
      components: { type: "object", description: "The manifest's components" },
    }, ["view"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "template_expand",
    description: "Expands a view template (each, if, use, {{ }} placeholders and filters) the way the app does; returns the JSON.",
    inputSchema: obj({ view: { type: "object" }, vars: { type: "object" }, components: { type: "object" } }, ["view"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "module_run_local",
    description: "Runs one handler of a module folder ON THIS MACHINE (server scripts with sh, process modules with their program; host.exec runs here too), to see what it returns while writing it — never on servers. Handlers of change/danger actions, tools or blocks (they stop, delete, restart) run only when the person started this server with --allow-changes: the agent can't allow them itself.",
    inputSchema: obj({
      folder: { type: "string" }, handler: { type: "string" },
      input: { type: "object" }, settings: { type: "object" }, item: {}, locale: { type: "string" },
    }, ["folder", "handler"]),
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

async function tool(name: string, a: Record<string, any>) {
  switch (name) {
    case "sdk_guide": return text(guide(a.topic));
    case "sdk_schema": return text(JSON.stringify(schema(a.name), null, 2));
    case "ui_kit": return text(catalogText([...symbols()].sort()));
    case "module_scaffold": {
      const files = scaffold({ kind: a.kind, id: a.id, title: a.title });
      if (a.folder) {
        const dir = resolve(a.folder);
        if (existsSync(dir) && readdirSync(dir).length) return text(`${dir} isn't empty: nothing written`, true);
        for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
      }
      // The vendored SDK is long and the same for every module: named, not shown.
      const shown = Object.entries(files).filter(([p]) => !p.startsWith("lib/"));
      const vendored = Object.keys(files).filter((p) => p.startsWith("lib/"));
      return text(`${a.folder ? `Written to ${resolve(a.folder)}.\n\n` : ""}${shown.map(([p, t]) => `--- ${p}\n${t}`).join("\n")}${vendored.length ? `\n--- ${vendored.join(", ")}: the SDK runtime (sshkipper-module vendor)` : ""}`);
    }
    case "module_validate": {
      if (a.folder) {
        const r = validateFolder(resolve(a.folder));
        return text(`${r.manifest ? `${r.manifest.id} ${r.manifest.version}, ${r.files.length} files\n` : ""}${issuesText(r.issues)}`);
      }
      if (a.manifest) return text(issuesText(validateManifest(a.manifest as Manifest, a.files ? new Set(a.files) : undefined)));
      return text("give «folder» or «manifest»", true);
    }
    case "view_preview": {
      const issues = validateView(a.view, { components: a.components, vars: { data: a.data ?? {}, item: a.item ?? null, settings: a.settings ?? {}, server: a.server ?? null } });
      let out: string;
      try { out = preview(a.view, { data: a.data ?? {}, item: a.item ?? null, settings: a.settings ?? {}, server: a.server ?? null }, a.components ?? {}); } catch (e) { out = `(not drawn: ${(e as Error).message})`; }
      return text(`${out}\n\n${issuesText(issues)}`);
    }
    case "template_expand":
      return text(JSON.stringify(expand(a.view, a.vars ?? {}, a.components ?? {}), null, 2));
    case "module_run_local": {
      const dir = resolve(a.folder);
      const m: Manifest = JSON.parse(readFileSync(join(dir, "sshkipper-module.json"), "utf8"));
      // What changes things isn't run on the agent's machine (a kill handler would kill a local PID) unless the person
      // started the server with --allow-changes: a parameter the agent sets itself would be no one's consent.
      const changes = [...(m.actions ?? []), ...(m.tools ?? []), ...(m.automation ?? [])].filter((x) => x.handler === a.handler && x.risk !== "read");
      if (changes.length && !options.allowChanges) {
        return text(`«${a.handler}» is the handler of ${changes.map((x) => ("id" in x ? x.id : (x as { name: string }).name) + ` (${x.risk})`).join(", ")}: it changes things. ` +
          "It would run on this machine — not allowed: the person who started this MCP server can restart it with `sshkipper-module mcp --allow-changes`.", true);
      }
      const r = await call(dir, a.handler, { input: a.input, settings: a.settings, item: a.item, locale: a.locale ?? "en" });
      const log = r.log.length ? `\n\nlog:\n${r.log.join("\n")}` : "";
      return r.ok ? text(JSON.stringify(r.value, null, 2) + log) : text(`${r.error}${r.stderr ? `\n\nstderr:\n${r.stderr.slice(-4000)}` : ""}${log}`, true);
    }
  }
  throw Object.assign(new Error(`no tool ${name}`), { code: -32602 });
}

const RESOURCES = [
  ...Object.keys(GUIDES).map((t) => ({ uri: `sshkipper-sdk://guide/${t}`, name: `guide: ${t}`, mimeType: "text/markdown" })),
  { uri: "sshkipper-sdk://schema/module", name: "module.schema.json", mimeType: "application/schema+json" },
  { uri: "sshkipper-sdk://schema/view", name: "view.schema.json", mimeType: "application/schema+json" },
];

function readResource(uri: string) {
  const [, kind, name] = uri.match(/^sshkipper-sdk:\/\/(guide|schema)\/(.+)$/) ?? [];
  if (kind === "guide") return { uri, mimeType: "text/markdown", text: guide(name) };
  if (kind === "schema" && (name === "module" || name === "view")) return { uri, mimeType: "application/schema+json", text: JSON.stringify(schema(name), null, 2) };
  throw Object.assign(new Error(`no resource ${uri}`), { code: -32002 });
}

const INSTRUCTIONS = `Tools for writing SSHKipper modules (SDK 1): native pages, actions, AI tools and automation blocks for a macOS SSH manager.
A module is a folder with sshkipper-module.json. Read sdk_guide «overview» and ui_kit first; module_scaffold gives a working start;
check every change with module_validate and view_preview; module_run_local runs a handler on this machine. Views are JSON the app draws natively — no HTML.`;

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

/** Serves MCP over `input`/`output` (stdio by default). */
/// How the server was started (by the person, not the agent): `--allow-changes` lets module_run_local run handlers that
/// change things on this machine.
const options = { allowChanges: false };

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
