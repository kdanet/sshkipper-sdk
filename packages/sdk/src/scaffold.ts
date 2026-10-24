// `sshkipper-module new` and the MCP tool `module_scaffold`: a module that works from the first minute — a service
// with a page, an action, an AI tool and (for server modules) an automation block — to change into one's own.
// Its scripts and code are real files in ../templates (checked by the SDK's tests on dash, busybox and mawk).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Kind = "server" | "process";

export interface ScaffoldOptions {
  kind: Kind;
  /** Reverse-DNS: dev.acme.disks. */
  id: string;
  title: string;
  /** Russian title when the main one is English (or the other way). */
  titleRu?: string;
}

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

/** The files of a new module: relative path → text. */
export function scaffold(o: ScaffoldOptions): Record<string, string> {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(o.id)) throw new Error(`«${o.id}»: a reverse-DNS id, like dev.acme.disks`);
  const title = o.titleRu ? { en: o.title, ru: o.titleRu } : o.title;
  const common = {
    $schema: SCHEMA, sdk: 1, id: o.id, version: "0.1.0", title,
    description: "Disk usage of the server's file systems: a page, an action, an AI tool.",
    icon: { symbol: "internaldrive", color: "blue" },
  };
  const settings = [{ key: "warn_pct", title: { en: "Warn above, %", ru: "Предупреждать выше, %" }, type: "number", default: 85 }];
  const tools = [{ name: "disk_usage", description: "File systems of the server with size, used bytes and use %, the fullest first.", handler: "list", risk: "read" }];
  const refresh = { id: "refresh", title: { en: "Refresh", ru: "Обновить" }, symbol: "arrow.clockwise", handler: "list", risk: "read" };
  const extra = { "README.md": readme(o, o.kind), ".gitignore": "*.sshkmod\n.sshkipper-dev-store.json\n" };

  if (o.kind === "server") {
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
    return { "sshkipper-module.json": json(manifest), ...files(join(templates, "server")), ...extra };
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
  return { "sshkipper-module.json": json(manifest), "module.ts": code, ...vendorFiles(), ...extra };
}

function readme(o: ScaffoldOptions, kind: Kind): string {
  return `# ${o.title}

An SSHKipper module (SDK 1, ${kind === "server" ? "scripts that run on the server" : "a program on this Mac"}).

\`\`\`sh
sshkipper-module validate .            # what the app will say before installing it
sshkipper-module call . list           # run a handler${kind === "server" ? " here (add --ssh user@host to run it on a server)" : " (host.exec runs here; --ssh user@host — there)"}
sshkipper-module preview . main --run  # the page as text
sshkipper-module pack .                # → ${o.id}-0.1.0.sshkmod
\`\`\`

In SSHKipper: Settings → Extensions → Modules → «Connect folder for development…» picks this folder and reloads
it as you edit; then the connection's Services show the module.
`;
}
