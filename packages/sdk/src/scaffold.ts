// `sshkipper-ext new` and the MCP tool `ext_scaffold`: an extension that works from the first minute, one per kind
// of contribution — to change into one's own. Its scripts and code are real files in ../templates (the SDK's tests
// validate every one and run it: on dash, busybox and mawk for the server scripts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** What `new --kind` makes: a service (server scripts, or a program with `process`) or one contribution of a program. */
export const KINDS = ["service", "database", "storage", "source", "node-type", "import", "console", "ai", "automation"] as const;
export type ExtensionKind = (typeof KINDS)[number];

/** `server` / `process` — the service kinds of SDK 1.0 (`new --process`), still taken. */
export type Kind = ExtensionKind | "server" | "process";

export interface ScaffoldOptions {
  kind: Kind;
  /** A service only: a program on this Mac instead of scripts on the server. */
  process?: boolean;
  /** Reverse-DNS: dev.acme.disks. */
  id: string;
  title: string;
  /** Russian title when the main one is English (or the other way). */
  titleRu?: string;
  /** A service only: `sshkipper-module.json` (packed as `.sshkmod`) instead of `sshkipper-extension.json`. */
  module?: boolean;
}

/** One line each: what a kind makes (help, the MCP tool, the guides). */
export const KIND_INFO: Record<ExtensionKind, string> = {
  service: "a service of servers: detect, summary, a page, an action, an AI tool, an automation block (scripts on the server; --process — a TypeScript program)",
  database: "a database engine with the app's whole database tab (a driver speaking spec/database.md; reads a JSON file to start)",
  storage: "a kind of storage for the file panel: list, read and write in parts, folders, rename, delete, check",
  source: "a live folder of servers in the tree (source/poll)",
  "node-type": "a node of your own in the tree with its card and a live screen in a tab",
  import: "another program's file into folders and connections (import/parse)",
  console: "a text console in the app's terminal tab (console/open, data both ways)",
  ai: "a model provider: a profile of Settings → AI (ai/models, ai/chat streaming)",
  automation: "automation blocks answered by a program on this Mac (one with a server, one without)",
};

const sdkSrc = fileURLToPath(new URL("./", import.meta.url));
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

/** What a process module carries of the SDK: the runtime, the builders, the types (no CLI parts). */
export const VENDORED = ["index.ts", "types.ts", "ui.ts", "module.ts", "template.ts"];

/** The SDK runtime files for `lib/sshkipper-sdk/` of a process module. */
export function vendorFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(sdkSrc)) if (VENDORED.includes(f)) out[`lib/sshkipper-sdk/${f}`] = readFileSync(join(sdkSrc, f), "utf8");
  return out;
}

/** The database protocol's file a driver carries (`lib/database.ts`): self-contained, no other SDK file. */
export const databaseFile = () => readFileSync(join(sdkSrc, "database.ts"), "utf8");

function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split(sep).join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const SCHEMA = "https://raw.githubusercontent.com/kdanet/sshkipper-sdk/main/schemas/module.schema.json";

/** The id of a contribution whose id is global (an engine, a kind of storage or source): the extension id's last part. */
export function slug(id: string): string {
  const s = (id.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 40);
  return s || "mine";
}

/** The files of a new extension: relative path → text. */
export function scaffold(o: ScaffoldOptions): Record<string, string> {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(o.id)) throw new Error(`«${o.id}»: a reverse-DNS id, like dev.acme.disks`);
  const kind: ExtensionKind = o.kind === "server" || o.kind === "process" ? "service" : o.kind;
  if (!KINDS.includes(kind)) throw new Error(`«${o.kind}»: one of ${KINDS.join(", ")}`);
  const program = o.kind === "process" || (kind === "service" && o.process === true);
  const title = o.titleRu ? { en: o.title, ru: o.titleRu } : o.title;
  const plain = o.title.replace(/[\r\n]/g, " ");
  const extra = { "README.md": readme(o, kind, program), ".gitignore": "*.sshkmod\n*.sshkext\n.sshkipper-dev-store.json\n" };
  if (kind === "service") return { ...service(o, title, program), ...extra };

  const dir = join(templates, kind);
  const out: Record<string, string> = {};
  for (const [p, t] of Object.entries(files(dir))) {
    if (p === "sshkipper-extension.json") {
      const text = t.replaceAll('"__TITLE__"', JSON.stringify(title)).replaceAll("__ID__", o.id).replaceAll("__SLUG__", slug(o.id));
      out[p] = json(JSON.parse(text));
    } else {
      // Code: the title as text (comments, strings), the slug where the engine names itself.
      out[p] = t.replaceAll("__TITLE__", plain.replaceAll('"', "'")).replaceAll("__SLUG__", slug(o.id)).replaceAll("__ID__", o.id);
    }
  }
  const lib = kind === "database" ? { "lib/database.ts": databaseFile() } : vendorFiles();
  return { ...out, ...lib, ...extra };
}

/** A service: scripts on the server, or a program on this Mac. */
function service(o: ScaffoldOptions, title: string | { en: string; ru: string }, program: boolean): Record<string, string> {
  const name = o.module ? "sshkipper-module.json" : "sshkipper-extension.json";
  const common = {
    $schema: SCHEMA, sdk: 1, id: o.id, version: "0.1.0", title,
    description: "Disk usage of the server's file systems: a page, an action, an AI tool.",
    icon: { symbol: "internaldrive", color: "blue" },
  };
  const settings = [{ key: "warn_pct", title: { en: "Warn above, %", ru: "Предупреждать выше, %" }, type: "number", default: 85 }];
  const tools = [{ name: "disk_usage", description: "File systems of the server with size, used bytes and use %, the fullest first.", handler: "list", risk: "read" }];
  const refresh = { id: "refresh", title: { en: "Refresh", ru: "Обновить" }, symbol: "arrow.clockwise", handler: "list", risk: "read" };

  if (!program) {
    const manifest = {
      ...common, runtime: { kind: "server" }, permissions: ["exec"], settings,
      service: { detect: "detect", summary: "summary", page: "main" },
      pages: [{ id: "main", title, view: "views/main.json", data: { list: "list" }, refresh: 30 }],
      handlers: {
        detect: { script: "scripts/detect.sh", timeout: 5, sudo: "never" },
        summary: { script: "scripts/summary.sh", timeout: 10, sudo: "never" },
        list: { script: "scripts/list.sh", timeout: 15, sudo: "never" },
        usage: { script: "scripts/usage.sh", timeout: 15, sudo: "never" },
      },
      actions: [refresh],
      tools,
      automation: [{
        id: "usage", title: { en: "Disk usage", ru: "Заполненность дисков" }, symbol: "internaldrive", handler: "usage", risk: "read", returns: "json",
        params: [{ key: "mount", title: { en: "Mount point", ru: "Точка монтирования" }, type: "text", default: "/", pattern: "/[A-Za-z0-9._/-]*" }],
      }],
    };
    return { [name]: json(manifest), ...files(join(templates, "server")) };
  }
  const manifest = {
    ...common, runtime: { kind: "process", command: ["node", "module.ts"] }, permissions: ["exec", "store"], settings,
    service: { detect: "detect", summary: "summary", page: "main" },
    pages: [{ id: "main", title, render: "render", refresh: 30 }],
    handlers: { detect: { timeout: 10 }, summary: { timeout: 15 }, list: { timeout: 15 }, render: { timeout: 20 } },
    actions: [refresh],
    tools,
  };
  const code = readFileSync(join(templates, "process/module.ts"), "utf8").replaceAll("__TITLE__", o.title.replace(/[\r\n]/g, " "));
  return { [name]: json(manifest), "module.ts": code, ...vendorFiles() };
}

/** How to try each kind without the app, and where the app shows it. */
const TRY: Record<ExtensionKind, (o: ScaffoldOptions, program: boolean) => string> = {
  service: (_o, program) => `sshkipper-ext run . list${program ? "                 # host.exec runs here; --ssh user@host — there" : "                 # here; --ssh user@host — on a server"}
sshkipper-ext preview . main --run         # the page as text`,
  database: () => `node driver.ts                             # then type: {"id":1,"method":"hello","params":{}}
# In SSHKipper: «Новая база» → the engine → the file samples/demo.json`,
  storage: (o) => `sshkipper-ext run . storage/list --params '{"storage":{"node":"t","kind":"${slug(o.id)}","settings":{},"readOnly":false,"throughServer":false},"path":"/"}'
# In SSHKipper: Файл → «Новое хранилище …» → the file panel`,
  source: (o) => `sshkipper-ext run . source/poll --params '{"source":{"node":"t","kind":"${slug(o.id)}","settings":{"hosts":["web-1 10.0.0.5 deploy"]}}}'
# In SSHKipper: Файл → «Новый источник …»: a live folder in the tree`,
  "node-type": () => `sshkipper-ext preview . tasks --node '{"id":"n1","name":"Release","type":"ext:x/tasks","settings":{},"links":{},"secrets":[]}' --events '[{"type":"open"},{"type":"press","block":"toolbar","value":{"item":"add"}}]'
# In SSHKipper: the tree's «Создать ▸» → your type; a double click opens its tab`,
  import: () => `sshkipper-ext run . import/parse --file samples/hosts.txt --importer hosts
# In SSHKipper: Файл → «Импорт: …»`,
  console: () => `# In SSHKipper: a connection's menu → «Консоль: …» (the app's terminal tab)`,
  ai: () => `sshkipper-ext run . ai/models --params '{"provider":"model","settings":{},"secrets":{}}'
# In SSHKipper: Settings → AI → «+» → «Из расширений»`,
  automation: () => `sshkipper-ext run . threshold --input '{"value": 7, "min": 20}'
sshkipper-ext run . disk_free --input '{"mount": "/"}'   # host.exec runs here
# In SSHKipper: an automation's library → «Из установленных модулей»`,
};

function readme(o: ScaffoldOptions, kind: ExtensionKind, program: boolean): string {
  const pkg = kind === "service" && o.module ? "sshkmod" : "sshkext";
  return `# ${o.title}

An SSHKipper extension (SDK 1): ${KIND_INFO[kind]}.${kind === "service" ? ` It runs ${program ? "as a program on this Mac" : "as scripts on the server"}.` : ""}

\`\`\`sh
sshkipper-ext validate .                   # what the app will say before installing it
${TRY[kind](o, program)}
sshkipper-ext pack .                       # → ${o.id}-0.1.0.${pkg}
\`\`\`

In SSHKipper: Settings → Extensions → «Папка разработки…» picks this folder and reloads it as you edit; «Установить
расширение…» takes the packed file. The guides: https://github.com/kdanet/sshkipper-sdk/tree/main/docs/en.
`;
}
