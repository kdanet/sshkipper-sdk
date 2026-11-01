// Checks a module the way the app does before it installs one (the app's ModuleValidation): the JSON Schemas of
// schemas/, then what a schema can't say — handlers that exist, files that are there, pages a service can show.
// Used by the CLI (`sshkipper-module validate`) and the MCP server (`module_validate`).

import { readFileSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json, Manifest, Param } from "./types.ts";
import { expand, TemplateError } from "./template.ts";

/** What a storage contribution may declare beyond list, stat, read and write (spec/protocol.md §11). */
export const STORAGE_CAPABILITIES = ["folders", "rename", "delete", "links", "freeSpace", "check"];

export type Issue = { severity: "error" | "warning"; path: string; message: string };

const schemaDir = fileURLToPath(new URL("../../../schemas/", import.meta.url));
const cache = new Map<string, any>();

/** A schema of schemas/: "module", "view"; or "symbols" — the symbol names the app draws. */
export function schema(name: "module" | "view" | "symbols"): any {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(join(schemaDir, name === "symbols" ? "symbols.json" : `${name}.schema.json`), "utf8")));
  return cache.get(name);
}

export const symbols = (): Set<string> => new Set(schema("symbols") as string[]);

// MARK: JSON Schema (the subset the SDK's schemas use)

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(t: string, v: unknown): boolean {
  const actual = typeOf(v);
  return t === actual || (t === "number" && actual === "integer");
}

/** Errors of `value` against `s`; `$ref`s resolve in `root`. `templates` — a view template: a string that is one
 * placeholder ("{{ p.status }}") stands for any value, and text with placeholders isn't held to enums and patterns. */
export function checkSchema(value: unknown, s: any, root: any = s, path = "", out: Issue[] = [], templates = false): Issue[] {
  const err = (message: string) => out.push({ severity: "error", path: path || "(root)", message });
  if (s === true || s === undefined) return out;
  if (templates && typeof value === "string" && value.includes("{{")) {
    if (/^\{\{[^{}]*\}\}$/.test(value.trim())) return out;
    if (s.$ref || s.oneOf || s.anyOf || s.enum || s.pattern) return out;
  }
  const sub = (v: unknown, x: any, at: string) => checkSchema(v, x, root, at, out, templates);
  // A template node goes wherever an element of a list goes (both engines expand each/if in any array): its block is
  // held to what an element is.
  if (templates && value && typeof value === "object" && !Array.isArray(value) && "block" in (value as object)
      && ("each" in (value as object) || "if" in (value as object))) {
    const t = value as Record<string, unknown>;
    sub(t.block, s, `${path}.block`);
    if (t.else !== undefined) sub(t.else, s, `${path}.else`);
    return out;
  }
  if (s === false) { err("not allowed here"); return out; }
  if (s.$ref) {
    const target = (s.$ref as string).replace(/^#\//, "").split("/").reduce((o: any, k: string) => o?.[k], root);
    if (!target) { err(`schema reference ${s.$ref} is missing`); return out; }
    return checkSchema(value, target, root, path, out, templates);
  }
  if (s.oneOf || s.anyOf) {
    const options: any[] = s.oneOf ?? s.anyOf;
    const results = options.map((o) => checkSchema(value, o, root, path, [], templates));
    // Overlapping forms are fine for this SDK's schemas (the first that fits is taken).
    if (results.some((r) => r.length === 0)) return out;
    // None fits: say what's wrong with the form the value means — the one whose const / enum key it carries
    // ({"kind": "process"}, {"type": "metric"}) or whose required keys it has ({"each": …}) — with all its errors.
    const resolve = (o: any): any => (o?.$ref ? resolve((o.$ref as string).replace(/^#\//, "").split("/").reduce((x: any, k: string) => x?.[k], root)) : o);
    const meant = (o: any): number => {
      const r = resolve(o);
      if (!value || typeof value !== "object" || Array.isArray(value) || !r?.properties) return 0;
      const v = value as Record<string, unknown>;
      for (const [k, p] of Object.entries<any>(r.properties)) {
        if (!(k in v)) continue;
        if (p.const !== undefined && JSON.stringify(p.const) === JSON.stringify(v[k])) return 3;
        if (p.enum && p.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(v[k])) && (r.required ?? []).includes(k)) return 2;
      }
      return (r.required ?? []).length && (r.required as string[]).every((k) => k in v) ? 1 : 0;
    };
    // Of the forms nothing names, the one of the value's own JSON type («title»: {} is meant as an object).
    const sameType = (o: any) => { const t = resolve(o)?.type; return t !== undefined && [t].flat().some((x: string) => typeMatches(x, value)) ? 0.5 : 0; };
    const ranked = options.map((o, i) => ({ score: meant(o) || sameType(o), errors: results[i] }))
      .sort((a, b) => b.score - a.score || a.errors.length - b.errors.length);
    const best = ranked[0];
    if (best.score > 0 || best.errors.length <= 3) out.push(...best.errors.slice(0, 12));
    else err("matches none of the allowed forms");
    return out;
  }
  if (s.const !== undefined && JSON.stringify(value) !== JSON.stringify(s.const)) err(`must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(value))) {
    err(`must be one of ${s.enum.map((e: unknown) => JSON.stringify(e)).join(", ")}`);
  }
  if (s.type) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(t, value))) { err(`must be ${types.join(" or ")}, not ${typeOf(value)}`); return out; }
  }
  if (typeof value === "string") {
    if (s.minLength !== undefined && [...value].length < s.minLength) err(`at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && [...value].length > s.maxLength) err(`at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern, "u").test(value)) err(`«${value.slice(0, 60)}» doesn't match ${s.pattern}`);
  }
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) err(`at least ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) err(`at most ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) err(`at least ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) err(`at most ${s.maxItems} items`);
    if (s.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) err("items repeat");
    if (s.items) value.forEach((v, i) => sub(v, s.items, `${path}[${i}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (s.minProperties !== undefined && keys.length < s.minProperties) err(`at least ${s.minProperties} keys`);
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) err(`at most ${s.maxProperties} keys`);
    for (const r of s.required ?? []) if (!(r in o)) err(`«${r}» is required`);
    const props = s.properties ?? {};
    for (const k of keys) {
      const at = path ? `${path}.${k}` : k;
      if (s.propertyNames) sub(k, s.propertyNames, `${at} (name)`);
      if (k in props) sub(o[k], props[k], at);
      else if (s.additionalProperties === false) {
        if (k !== "$schema") out.push({ severity: "error", path: at, message: "unknown key" });
      } else if (typeof s.additionalProperties === "object") sub(o[k], s.additionalProperties, at);
    }
  }
  return out;
}

// MARK: The manifest

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const isInside = (p: string) => !p.startsWith("/") && !p.split("/").includes("..") && !p.includes("\0");
const norm = (p: string) => p.replace(/^(\.\/)+/, "");

/** The manifest names a package folder may hold: an extension's first (spec/protocol.md §10). */
export const MANIFEST_FILES = ["sshkipper-extension.json", "sshkipper-module.json"] as const;

/** Which manifest a folder has; an error when it has none or both (the app refuses both too). */
export function manifestFile(dir: string): string {
  const present = MANIFEST_FILES.filter((f) => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } });
  if (present.length > 1) throw new Error("the folder has both sshkipper-extension.json and sshkipper-module.json — keep one");
  if (!present.length) throw new Error("no sshkipper-extension.json or sshkipper-module.json");
  return present[0];
}

/** The contributions the app knows (spec/protocol.md §10). */
export const CONTRIBUTION_KINDS = ["service", "tools", "automation", "database", "storage", "source", "nodeType", "screen", "import", "console", "ai"] as const;

/** What's wrong with a manifest: the schema, then the checks the app makes. `files` — relative paths of the folder. */
export function validateManifest(m: Manifest, files?: Set<string>): Issue[] {
  const out = checkSchema(m, schema("module"));
  // A module's own contributions written under `contributes` are checked where the app reads them: at the top level.
  const c = m.contributes;
  const merged: Manifest = c ? { ...m, service: m.service ?? c.service, tools: m.tools ?? c.tools, automation: m.automation ?? c.automation } : m;
  // The app's checks too, as far as the shape lets them run: a wrong type the schema named may stop them.
  try { semantic(merged, files, out); } catch { /* the schema's errors say it */ }
  try { contributions(m, files, out); } catch { /* the schema's errors say it */ }
  const seen = new Set<string>();
  return out.filter((i) => { const k = `${i.path}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function semantic(m: Manifest, files: Set<string> | undefined, out: Issue[]) {
  // One error a path: the app's «from 1 to 3600» in place of the schema's «at least 1» for the same value.
  const schemaErrors = new Set(out.filter((i) => i.severity === "error"));
  const err = (path: string, message: string) => {
    for (let i = out.length - 1; i >= 0; i--) if (schemaErrors.has(out[i]) && out[i].path === path) out.splice(i, 1);
    out.push({ severity: "error", path, message });
  };
  const warn = (path: string, message: string) => out.push({ severity: "warning", path, message });
  const perms = new Set(m.permissions ?? []);
  const handlers = m.handlers ?? {};
  const server = m.runtime.kind === "server";
  const sym = symbols();
  const symbol = (path: string, s?: string) => { if (s && !sym.has(s)) warn(path, `symbol «${s}» isn't one the app draws (schemas/symbols.json): a puzzle piece shows instead`); };
  const handler = (path: string, n?: string) => { if (n !== undefined && !(n in handlers)) err(path, `no handler «${n}» in handlers`); };

  if (m.id === "registry.json") err("id", "«registry.json» is taken by the app");
  // As the app: a server module's handlers are commands on servers — without «exec» it runs none of them.
  if (server && Object.keys(handlers).length && !perms.has("exec")) err("permissions", "the module's scripts run on servers — add «exec» to permissions");
  symbol("icon.symbol", m.icon?.symbol);
  for (const [n, h] of Object.entries(handlers)) {
    if (h.timeout !== undefined && !(typeof h.timeout === "number" && h.timeout >= 1 && h.timeout <= 3600)) err(`handlers.${n}.timeout`, "timeout is seconds from 1 to 3600");
    if (server) {
      if (!h.script) { err(`handlers.${n}`, "a server module's handler is a script: set «script»"); continue; }
      if (!isInside(h.script)) err(`handlers.${n}.script`, `«${h.script}» leaves the module folder`);
      else if (files && !files.has(norm(h.script))) err(`handlers.${n}.script`, `no file «${h.script}» in the module`);
      if (h.sudo === "required" && !perms.has("sudo")) err(`handlers.${n}.sudo`, "sudo: required — add «sudo» to permissions");
      if (h.sudo === "required" && m.service?.containers) warn(`handlers.${n}.sudo`, "in a container a handler's sudo doesn't apply: it runs as docker exec's user");
      // detect runs by itself on every connected server: the app never gives it sudo.
      if (h.sudo === "required" && n === m.service?.detect) warn(`handlers.${n}.sudo`, "detect runs on every server by itself, without sudo — drop sudo: required");
    } else {
      if (h.script) warn(`handlers.${n}.script`, "a process module doesn't use scripts: the handler is a name its program answers");
      if (h.sudo) warn(`handlers.${n}.sudo`, "in a process module sudo is asked by host/exec, not the handler");
    }
  }
  if (m.runtime.kind === "process") {
    const cmd = m.runtime.command;
    if (!cmd.length) err("runtime.command", "empty command");
    else if (cmd[0].includes("/") && files && !files.has(norm(cmd[0]))) err("runtime.command", `no program «${cmd[0]}» in the module`);
    // Same as the app: -I/-E ignore PYTHONPYCACHEPREFIX, byte code would land in the hashed module folder.
    if (pythonIgnoresCachePrefix(cmd)) {
      warn("runtime.command", "python with -I or -E writes byte code into the module folder — after its first run the module reads as changed; add -B");
    }
    for (const k of Object.keys(m.runtime.env ?? {}).sort()) {
      if (loadsOutsideCode(k)) err(`runtime.env.${k}`, `«${k}» loads code from outside the module — such variables can't be set`);
    }
    const program = cmd.slice(1).find((a) => /\.(ts|js|mjs|py|rb)$/.test(a));
    if (program && files && !files.has(norm(program))) err("runtime.command", `no file «${program}» in the module`);
  }

  const settingKeys = new Set<string>();
  (m.settings ?? []).forEach((s, i) => {
    if (settingKeys.has(s.key)) err(`settings[${i}].key`, `«${s.key}» repeats`);
    settingKeys.add(s.key);
    if (s.type === "choice" && !(s.choices ?? []).length) err(`settings[${i}].choices`, "a choice without choices");
    if (s.type === "secret" && !perms.has("secrets")) err(`settings[${i}]`, "a secret setting — add «secrets» to permissions");
  });

  const pageIDs = new Set<string>();
  (m.pages ?? []).forEach((p, i) => {
    const at = `pages[${i}]`;
    if (pageIDs.has(p.id)) err(`${at}.id`, `page «${p.id}» repeats`);
    pageIDs.add(p.id);
    if (!p.view && !p.render) err(at, "needs «view» (a template) or «render» (a handler building the view)");
    if (p.view && p.render) err(at, "«view» and «render» together — pick one");
    if (p.view) {
      if (!isInside(p.view)) err(`${at}.view`, `«${p.view}» leaves the module folder`);
      else if (files && !files.has(norm(p.view))) err(`${at}.view`, `no file «${p.view}» in the module`);
    }
    handler(`${at}.render`, p.render);
    for (const [k, h] of Object.entries(p.data ?? {})) {
      if (!NAME.test(k)) err(`${at}.data.${k}`, "a name: lowercase latin, digits and _");
      handler(`${at}.data.${k}`, h);
    }
    if (p.render && Object.keys(p.data ?? {}).length) warn(`${at}.data`, "a page with «render» doesn't use data");
    if (p.refresh !== undefined && p.refresh < 2) err(`${at}.refresh`, "no more often than every 2 s");
  });

  if (m.service) {
    const s = m.service;
    handler("service.detect", s.detect);
    handler("service.summary", s.summary);
    if (s.tree) {
      handler("service.tree.handler", s.tree.handler);
      if (s.tree.page && !pageIDs.has(s.tree.page)) err("service.tree.page", `no page «${s.tree.page}»`);
    }
    if (s.page && !pageIDs.has(s.page)) err("service.page", `no page «${s.page}»`);
    if (!pageIDs.size) err("service", "a service without pages: its section would be empty");
    if (s.containers && !server) warn("service.containers", "«runs in a container» applies to server scripts and host/exec");
  }
  if (pageIDs.size && !m.service) warn("pages", "pages show in the service's section: without «service» they have nowhere to go");

  const params = (at: string, ps?: Param[]) => {
    const keys = new Set<string>();
    (ps ?? []).forEach((p, j) => {
      if (keys.has(p.key)) err(`${at}.params[${j}].key`, `«${p.key}» repeats`);
      keys.add(p.key);
      if (p.type === "choice" && !(p.choices ?? []).length) err(`${at}.params[${j}].choices`, "a choice without choices");
      // As the app, for actions, tools and blocks alike: «{{» would be a field of the automations engine.
      if (p.pattern?.includes("{{") || (p.choices ?? []).some((c) => c.includes("{{"))) err(`${at}.params[${j}]`, "«{{» isn't allowed in patterns and choices");
      // The app checks with ICU (NSRegularExpression): it reads more than JavaScript ((?i), possessive and atomic
      // groups) — what JavaScript can't read is a warning, the app's own check decides.
      if (p.pattern) { try { new RegExp(p.pattern); } catch { warn(`${at}.params[${j}].pattern`, "JavaScript can't read this pattern — make sure the app (ICU regular expressions) can"); } }
      if (server && p.type === "text" && !p.pattern) warn(`${at}.params[${j}]`, "text reaches a script: set «pattern» so nothing more gets in");
    });
  };
  const ids = new Set<string>();
  (m.actions ?? []).forEach((a, i) => {
    const at = `actions[${i}]`;
    if (ids.has(a.id)) err(`${at}.id`, `action «${a.id}» repeats`);
    ids.add(a.id);
    handler(`${at}.handler`, a.handler);
    params(at, a.params);
    symbol(`${at}.symbol`, a.symbol);
    if (a.risk !== "read" && !a.confirm) warn(`${at}.confirm`, "a changing action asks in general words — better your own question");
  });
  const tools = new Set<string>();
  (m.tools ?? []).forEach((t, i) => {
    const at = `tools[${i}]`;
    if (tools.has(t.name)) err(`${at}.name`, `tool «${t.name}» repeats`);
    tools.add(t.name);
    handler(`${at}.handler`, t.handler);
    params(at, t.params);
    // As the app checks (a short description is the schema's error already): a title that says something.
    const titles = t.title === undefined ? [] : typeof t.title === "string" ? [t.title] : Object.values(t.title);
    if (t.title !== undefined && titles.every((x) => typeof x !== "string" || x.trim() === "")) warn(`${at}.title`, "an empty title — the question shows the tool's name");
  });
  const blocks = new Set<string>();
  (m.automation ?? []).forEach((b, i) => {
    const at = `automation[${i}]`;
    if (blocks.has(b.id)) err(`${at}.id`, `block «${b.id}» repeats`);
    blocks.add(b.id);
    handler(`${at}.handler`, b.handler);
    params(at, b.params);
    symbol(`${at}.symbol`, b.symbol);
    if (!server) warn(at, "automation blocks run only for server modules so far");
    for (const [j, p] of (b.params ?? []).entries()) {
      // In automations the pattern is checked by grep -E on the server: POSIX ERE.
      if (p.pattern && /\\[dDwWsSbB]|\(\?|\\[pP]\{/.test(p.pattern)) {
        warn(`${at}.params[${j}].pattern`, "automation blocks check patterns with grep -E (POSIX ERE): use [0-9], [A-Za-z0-9_], ( ) instead of \\d, \\w, (?: )");
      }
    }
  });
}

// MARK: Extensions

const BUILT_IN = {
  database: new Set(["mysql", "redis", "clickhouse", "postgres", "sqlite", "mongodb"]),
  storage: new Set(["s3", "webdav", "gdrive", "yadisk", "dropbox"]),
  source: new Set(["tailscale", "lan"]),
};
const CONTRIBUTION_ID = /^[a-z][a-z0-9_-]{0,39}$/;
/** Run by a program on this Mac: a server script can't answer for them (as the app checks). */
const NEEDS_PROGRAM = new Set(["database", "storage", "source", "import", "console", "ai"]);

/** The app's checks of `contributes` (its ModuleKit `contributionIssues`). */
function contributions(m: Manifest, files: Set<string> | undefined, out: Issue[]) {
  const c = m.contributes;
  if (!c) return;
  const schemaErrors = new Set(out.filter((i) => i.severity === "error"));
  const err = (path: string, message: string) => {
    for (let i = out.length - 1; i >= 0; i--) if (schemaErrors.has(out[i]) && out[i].path === path) out.splice(i, 1);
    out.push({ severity: "error", path, message });
  };
  const warn = (path: string, message: string) => out.push({ severity: "warning", path, message });
  const perms = new Set(m.permissions ?? []);
  const handlers = m.handlers ?? {};
  const server = m.runtime.kind === "server";
  const known = CONTRIBUTION_KINDS as readonly string[];
  for (const k of Object.keys(c)) {
    if (!known.includes(k)) err(`contributes.${k}`, `unknown kind of contribution «${k}» — this version of SSHKipper knows: ${known.join(", ")}`);
  }
  for (const k of ["service", "tools", "automation"] as const) {
    if (c[k] !== undefined && m[k] !== undefined) err(`contributes.${k}`, `«${k}» is both in contributes and at the top level — keep one`);
  }
  const handler = (path: string, n?: string) => { if (n !== undefined && !(n in handlers)) err(path, `no handler «${n}» in handlers`); };
  const fields = (at: string, fs?: { key: string; type: string; choices?: unknown[] }[]) => {
    const keys = new Set<string>();
    (fs ?? []).forEach((f, j) => {
      if (keys.has(f.key)) err(`${at}.fields[${j}].key`, `«${f.key}» repeats`);
      keys.add(f.key);
      if (f.type === "choice" && !(f.choices ?? []).length) err(`${at}.fields[${j}].choices`, "a choice without choices");
      if (f.type === "secret" && !perms.has("secrets")) err(`${at}.fields[${j}]`, "a secret field — add «secrets» to permissions");
    });
  };
  const screens = new Set((c.screen ?? []).map((s) => s.id));
  for (const kind of ["database", "storage", "source", "nodeType", "screen", "import", "console", "ai"] as const) {
    const ids = new Set<string>();
    ((c[kind] ?? []) as any[]).forEach((x, i) => {
      const at = `contributes.${kind}[${i}]`;
      if (!CONTRIBUTION_ID.test(x.id ?? "")) err(`${at}.id`, `«${x.id}»: lowercase latin, digits, _ and -, starting with a letter, up to 40`);
      if (ids.has(x.id)) err(`${at}.id`, `«${x.id}» repeats`);
      ids.add(x.id);
      if (NEEDS_PROGRAM.has(kind) && server && !(kind === "database" && x.command)) err(at, `«${kind}» runs as a program on this Mac — it needs the «process» runtime`);
      if (kind in BUILT_IN && BUILT_IN[kind as keyof typeof BUILT_IN].has(x.id)) err(`${at}.id`, `«${x.id}» is built into SSHKipper — an extension doesn't replace it`);
      switch (kind) {
        case "database":
          if (x.command?.[0]?.includes("/")) {
            if (!isInside(x.command[0])) err(`${at}.command`, `«${x.command[0]}» leaves the extension folder`);
            else if (files && !files.has(norm(x.command[0]))) err(`${at}.command`, `no program «${x.command[0]}» in the extension`);
          }
          break;
        case "storage":
          if (x.signIn === "browser" && !perms.has("oauth")) err(`${at}.signIn`, "sign-in through the browser — add «oauth» to permissions");
          for (const c of x.capabilities ?? []) {
            if (!STORAGE_CAPABILITIES.includes(c)) warn(`${at}.capabilities`, `«${c}» isn't known and won't be offered — known: ${STORAGE_CAPABILITIES.join(", ")}`);
          }
          fields(at, x.fields);
          break;
        case "source": fields(at, x.fields); break;
        case "nodeType":
          fields(at, x.fields);
          if (x.screen !== undefined && !screens.has(x.screen)) err(`${at}.screen`, `no screen «${x.screen}» in contributes.screen`);
          if (x.screen === undefined) warn(at, "an item without a screen opens only its settings card");
          break;
        case "screen": handler(`${at}.render`, x.render); break;
        default: handler(`${at}.handler`, x.handler);
      }
    });
  }
}

// MARK: Views

/** What's wrong with a view: the schema, block symbols, the template (with `vars`, when given). */
export function validateView(v: Json, opts: { components?: Record<string, Json>; vars?: Record<string, Json> } = {}): Issue[] {
  const out = checkSchema(v, schema("view"), schema("view"), "", [], true);
  const sym = symbols();
  const walk = (n: any, path: string) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (typeof n.symbol === "string" && !n.symbol.includes("{{") && !sym.has(n.symbol)) {
      out.push({ severity: "warning", path: `${path}.symbol`, message: `symbol «${n.symbol}» isn't one the app draws` });
    }
    if (typeof n.use === "string" && opts.components && !(n.use in opts.components)) {
      out.push({ severity: "error", path: `${path}.use`, message: `no component «${n.use}» in the manifest` });
    }
    for (const [k, x] of Object.entries(n)) if (typeof x === "object") walk(x, path ? `${path}.${k}` : k);
  };
  walk(v, "");
  if (opts.vars) {
    try { expand(v, opts.vars, opts.components ?? {}); } catch (e) {
      out.push({ severity: "error", path: "(template)", message: e instanceof TemplateError ? e.message : String(e) });
    }
  }
  return out;
}

// MARK: A folder

/** Every file of a module folder as the app reads it (`.git` and `.DS_Store` left out), relative paths. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const base = realpathSync(dir);
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === ".git" || name === ".DS_Store") continue;
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        const target = realpathSync(p);
        if (!target.startsWith(base + sep)) throw new Error(`the link «${relative(base, p)}» leads out of the module folder`);
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(relative(base, p).split(sep).join("/"));
      else throw new Error(`«${relative(base, p)}» isn't a regular file`);
    }
  };
  walk(base);
  return out.sort();
}

/** The manifest, its issues and those of every view of a module folder; limits of the app (2000 files, 64 MB). */
export function validateFolder(dir: string): { manifest?: Manifest; files: string[]; issues: Issue[] } {
  const issues: Issue[] = [];
  let files: string[] = [];
  try { files = listFiles(dir); } catch (e) { return { files, issues: [{ severity: "error", path: "(folder)", message: (e as Error).message }] }; }
  const size = files.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
  if (files.length > 2000 || size > 64 << 20) issues.push({ severity: "error", path: "(folder)", message: "more than 2000 files or 64 MB" });
  let name: string;
  try { name = manifestFile(dir); } catch (e) { return { files, issues: [...issues, { severity: "error", path: "(folder)", message: (e as Error).message }] }; }
  let manifest: Manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, name), "utf8")); } catch (e) {
    return { files, issues: [...issues, { severity: "error", path: name, message: `not JSON: ${(e as Error).message}` }] };
  }
  issues.push(...validateManifest(manifest, new Set(files)));
  for (const [i, p] of (manifest.pages ?? []).entries()) {
    if (!p.view || !files.includes(norm(p.view))) continue;
    let v: Json;
    try { v = JSON.parse(readFileSync(join(dir, p.view), "utf8")); } catch (e) {
      issues.push({ severity: "error", path: `pages[${i}].view`, message: `${p.view} isn't JSON: ${(e as Error).message}` });
      continue;
    }
    // Expanded too (with no data), as the app will: nesting, components, conditions that don't read.
    const vars: Record<string, Json> = { data: {}, item: null, settings: {}, server: null, context: { locale: "en", sdk: 1, app: "" } };
    for (const x of validateView(v, { components: (manifest.components ?? {}) as Record<string, Json>, vars })) {
      issues.push({ ...x, path: `${p.view}: ${x.path}` });
    }
  }
  return { manifest, files, issues };
}

export const formatIssue = (i: Issue) => `${i.severity === "error" ? "✗" : "⚠"} ${i.path}: ${i.message}`;

/** Environment variables that make an interpreter or the loader take code from outside the module (as the app checks). */
export function loadsOutsideCode(key: string): boolean {
  const k = key.toUpperCase();
  if (k.startsWith("DYLD_") || k.startsWith("LD_") || k.endsWith("_OPTIONS") || k.endsWith("OPT")) return true;
  return ["PYTHONSTARTUP", "PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE", "NODE_PATH", "PERL5LIB", "PERLLIB", "RUBYLIB",
    "BASH_ENV", "ENV", "ZDOTDIR", "CLASSPATH", "GEM_PATH", "GEM_HOME", "LUA_PATH", "LUA_CPATH"].includes(k);
}

/** `python3 -I main.py`, `/usr/bin/env python3 -Is …`: the interpreter's own options hold I or E and not B (as the app checks). */
export function pythonIgnoresCachePrefix(cmd: string[]): boolean {
  let i = (cmd[0] ?? "").split("/").pop() === "env" ? 1 : 0;
  if (!/^python/.test((cmd[i] ?? "").split("/").pop() ?? "")) return false;
  const letters = new Set<string>();
  for (const a of cmd.slice(i + 1)) {
    if (!a.startsWith("-") || a.startsWith("--") || a.length < 2) break;
    for (const c of a.slice(1)) letters.add(c);
    if (/[cmWX]/.test(a.slice(1))) break;
  }
  return (letters.has("I") || letters.has("E")) && !letters.has("B");
}
