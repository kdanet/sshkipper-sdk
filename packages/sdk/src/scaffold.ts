// `sshkipper-module new` and the MCP tool `module_scaffold`: a module that works from the first minute — a service
// with a page, an action, an AI tool and (for server modules) an automation block — to change into one's own.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/** What a process module carries of the SDK: the runtime, the builders, the types (no CLI parts). */
export const VENDORED = ["index.ts", "types.ts", "ui.ts", "module.ts", "template.ts"];

/** The SDK runtime files for `lib/sshkipper-sdk/` of a process module. */
export function vendorFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(sdkSrc)) if (VENDORED.includes(f)) out[`lib/sshkipper-sdk/${f}`] = readFileSync(join(sdkSrc, f), "utf8");
  return out;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** The files of a new module: relative path → text. */
export function scaffold(o: ScaffoldOptions): Record<string, string> {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(o.id)) throw new Error(`«${o.id}»: a reverse-DNS id, like dev.acme.disks`);
  const title = o.titleRu ? { en: o.title, ru: o.titleRu } : o.title;
  const common = {
    $schema: "https://raw.githubusercontent.com/kdanet/sshkipper-sdk/main/schemas/module.schema.json",
    sdk: 1, id: o.id, version: "0.1.0", title,
    description: "Disk usage of the server's file systems: a page, an action, an AI tool.",
    icon: { symbol: "internaldrive", color: "blue" },
  };
  const settings = [{ key: "warn_pct", title: { en: "Warn above, %", ru: "Предупреждать выше, %" }, type: "number", default: 85 }];
  const pages = [o.kind === "server" ? { id: "main", title, view: "views/main.json", data: { list: "list" }, refresh: 30 } : { id: "main", title, render: "render", refresh: 30 }];
  const tools = [{ name: "disk_usage", description: "File systems of the server with size, used bytes and use %, the fullest first.", handler: "list", risk: "read" }];

  if (o.kind === "server") {
    const manifest = {
      ...common, runtime: { kind: "server" }, permissions: ["exec"], settings,
      service: { detect: "detect", summary: "summary", page: "main" },
      pages,
      handlers: {
        detect: { script: "scripts/detect.sh", timeout: 5, sudo: "never" },
        summary: { script: "scripts/summary.sh", timeout: 10, sudo: "never" },
        list: { script: "scripts/list.sh", timeout: 15, sudo: "never" },
        usage: { script: "scripts/usage.sh", timeout: 15, sudo: "never" },
      },
      actions: [{ id: "refresh", title: { en: "Refresh", ru: "Обновить" }, symbol: "arrow.clockwise", handler: "list", risk: "read" }],
      tools,
      automation: [{
        id: "usage", title: { en: "Disk usage", ru: "Заполненность дисков" }, symbol: "internaldrive", handler: "usage", risk: "read", returns: "json",
        params: [{ key: "mount", title: { en: "Mount point", ru: "Точка монтирования" }, type: "text", default: "/", pattern: "/[A-Za-z0-9._/-]*" }],
      }],
    };
    return {
      "sshkipper-module.json": json(manifest),
      "scripts/detect.sh": `# Found when df answers (protocol.md §2: service.detect → {"found": true}).\nif sk_has df; then printf '{"found": true}'; else printf '{"found": false}'; fi\n`,
      "scripts/list.sh": `# File systems as JSON: {"disks": [{"mount", "size", "used", "pct", "status"}]}, the fullest first.
warn=\${SK_SETTING_WARN_PCT:-85}
df -P -k 2>/dev/null | awk -v warn="$warn" 'NR > 1 && $2 > 0 {
  pct = $5; sub(/%/, "", pct); pct += 0  # a number again: after sub() "100" >= 95 compares as text
  st = pct >= 95 ? "bad" : pct >= warn ? "warn" : "ok"
  line[n++] = sprintf("{\\"id\\": \\"%s\\", \\"mount\\": \\"%s\\", \\"device\\": \\"%s\\", \\"size\\": %d, \\"used\\": %d, \\"pct\\": %d, \\"status\\": \\"%s\\"}", $6, $6, $1, $2 * 1024, $3 * 1024, pct, st)
  p[n - 1] = pct
}
END {
  # The fullest first: a small insertion sort (awk has no sort everywhere).
  for (i = 1; i < n; i++) for (j = i; j > 0 && p[j] > p[j - 1]; j--) { t = p[j]; p[j] = p[j - 1]; p[j - 1] = t; t = line[j]; line[j] = line[j - 1]; line[j - 1] = t }
  printf "{\\"disks\\": ["; for (i = 0; i < n; i++) printf "%s%s", (i ? ", " : ""), line[i]; printf "]}"
}'
`,
      "scripts/summary.sh": `# The line next to the service in the tree: {"text", "status"}.
warn=\${SK_SETTING_WARN_PCT:-85}
df -P -k 2>/dev/null | awk -v warn="$warn" 'NR > 1 && $2 > 0 { pct = $5; sub(/%/, "", pct); pct += 0; if (pct > max) { max = pct; m = $6 } }
  END { printf "{\\"text\\": \\"%s — %d%%\\", \\"status\\": \\"%s\\"}", m, max, (max >= 95 ? "bad" : max >= warn ? "warn" : "ok") }'
`,
      "scripts/usage.sh": `# The automation block: one mount point's use, in the automations' summary words
# (status, summary, value, unit — protocol.md §8).
mount=\${SK_INPUT_MOUNT:-/}
warn=\${SK_SETTING_WARN_PCT:-85}
df -P -k -- "$mount" 2>/dev/null | awk -v warn="$warn" 'NR == 2 { pct = $5; sub(/%/, "", pct); pct += 0  # a number again: after sub() "100" >= 95 compares as text
  printf "{\\"status\\": \\"%s\\", \\"summary\\": \\"%s — %d%%\\", \\"value\\": %d, \\"unit\\": \\"%%\\"}", (pct >= 95 ? "error" : pct >= warn ? "warn" : "ok"), $6, pct, pct; ok = 1 }
  END { if (!ok) exit 1 }' || sk_fail "no file system at $mount"
`,
      "views/main.json": json({
        $schema: "https://raw.githubusercontent.com/kdanet/sshkipper-sdk/main/schemas/view.schema.json",
        status: [{ text: "{{ data.list.disks | count }} file systems." }],
        blocks: [
          { type: "grid", columns: 3, children: [
            { each: "data.list.disks", as: "d", limit: 6, block: {
              type: "gauge", title: "{{ d.mount }}", value: "{{ d.pct }}", max: 100, unit: "%", subtitle: "{{ d.used | bytes }} of {{ d.size | bytes }}",
            } },
          ] },
          { type: "rows", title: "File systems", items: [
            { each: "data.list.disks", as: "d", block: { id: "{{ d.id }}", title: "{{ d.mount }}", detail: "{{ d.device }}", status: "{{ d.status }}", trailing: "{{ d.pct }}%" } },
          ] },
        ],
      }),
      "README.md": readme(o, "server"),
      ".gitignore": "*.sshkmod\n.sshkipper-dev-store.json\n",
    };
  }

  const manifest = {
    ...common, runtime: { kind: "process", command: ["node", "module.ts"] }, permissions: ["exec", "store"], settings,
    service: { detect: "detect", summary: "summary", page: "main" },
    pages,
    handlers: { detect: { timeout: 10 }, summary: { timeout: 15 }, list: { timeout: 15 }, render: { timeout: 20 } },
    actions: [{ id: "refresh", title: { en: "Refresh", ru: "Обновить" }, symbol: "arrow.clockwise", handler: "list", risk: "read" }],
    tools,
  };
  return {
    "sshkipper-module.json": json(manifest),
    "module.ts": `// ${o.title}: a process module of SSHKipper SDK 1. The app starts \`node module.ts\` on this Mac and calls the
// handlers below over JSON-RPC; \`ctx.host.exec\` runs a command on the server over the app's own SSH session.
import { defineModule, gauge, grid, rows, row, tr, view, type HandlerContext } from "./lib/sshkipper-sdk/index.ts";

type Disk = { mount: string; device: string; size: number; used: number; pct: number };

async function disks(ctx: HandlerContext): Promise<Disk[]> {
  const r = await ctx.host.exec("df -P -k", { timeout: 10 });
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "df failed");
  return r.stdout.trim().split("\\n").slice(1).map((l) => l.split(/\\s+/)).filter((f) => Number(f[1]) > 0)
    .map((f) => ({ mount: f[5], device: f[0], size: Number(f[1]) * 1024, used: Number(f[2]) * 1024, pct: parseInt(f[4]) }))
    .sort((a, b) => b.pct - a.pct);
}

const warn = (ctx: HandlerContext) => (typeof ctx.settings.warn_pct === "number" ? ctx.settings.warn_pct : 85);
const status = (d: Disk, ctx: HandlerContext) => (d.pct >= 95 ? "bad" : d.pct >= warn(ctx) ? "warn" : "ok");
const gb = (n: number) => \`\${(n / 2 ** 30).toFixed(1)} GB\`;

defineModule({
  handlers: {
    detect: async (_input, ctx) => ({ found: (await ctx.host.exec("command -v df")).exitCode === 0 }),
    summary: async (_input, ctx) => {
      const [d] = await disks(ctx);
      return d ? { text: \`\${d.mount} — \${d.pct}%\`, status: status(d, ctx) } : { text: "—", status: "off" };
    },
    list: async (_input, ctx) => ({ disks: await disks(ctx) }),
    render: async (_input, ctx) => {
      const all = await disks(ctx);
      return view([
        grid(all.slice(0, 6).map((d) => gauge(d.mount, d.pct, 100, { unit: "%" })), 3),
        rows(all.map((d) => row(d.mount, { id: d.mount, detail: d.device, status: status(d, ctx), trailing: \`\${gb(d.used)} / \${gb(d.size)}\` })),
          { title: tr(ctx, { en: "File systems", ru: "Файловые системы" }) }),
      ], { status: [{ text: tr(ctx, { en: \`\${all.length} file systems.\`, ru: \`Файловых систем: \${all.length}.\` }) }] });
    },
  },
});
`,
    ...vendorFiles(),
    "README.md": readme(o, "process"),
    ".gitignore": "*.sshkmod\n.sshkipper-dev-store.json\n",
  };
}

function readme(o: ScaffoldOptions, kind: Kind): string {
  return `# ${o.title}

An SSHKipper module (SDK 1, ${kind === "server" ? "scripts that run on the server" : "a program on this Mac"}).

\`\`\`sh
sshkipper-module validate .            # what the app will say before installing it
sshkipper-module call . list           # run a handler${kind === "server" ? " here (add --ssh user@host to run it on a server)" : " (host.exec runs here; --ssh user@host — there)"}
sshkipper-module preview . main        # the page as text
sshkipper-module pack .                # → ${o.id}-0.1.0.sshkmod
\`\`\`

In SSHKipper: Settings → Extensions → Modules → «Connect a folder for development…» picks this folder and reloads
it as you edit; then the connection's Services show the module.
`;
}
