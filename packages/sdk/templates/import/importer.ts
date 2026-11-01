// __TITLE__: an importer of SSHKipper SDK 1 (spec/protocol.md §15). The user picks a file; the app reads it and sends
// its bytes (`import/parse`) — never its path. The answer is checked whole before anything changes, shown as a tree,
// and merged like the app's own ~/.ssh/config import. Passwords, if a format has them, go in `secrets`, never in a
// connection: the app asks the user first.

import { defineModule, ModuleError, tr, type ImportConnection, type ImportFile, type HandlerContext } from "./lib/sshkipper-sdk/index.ts";

/** «web-1 10.0.0.5:2222 deploy» → a connection; blank lines and # comments are skipped. */
function parse(file: ImportFile, ctx: HandlerContext) {
  const connections: ImportConnection[] = [];
  const warnings: string[] = [];
  file.text().split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const [name, address, user] = line.split(/\s+/);
    const m = (address ?? "").match(/^([^\s:]+)(?::(\d+))?$/);
    if (!m) { warnings.push(tr(ctx, { en: `line ${i + 1}: no address — skipped`, ru: `строка ${i + 1}: нет адреса — пропущена` })); return; }
    connections.push({ type: "connection", name, host: m[1], ...(m[2] ? { port: Number(m[2]) } : {}), ...(user ? { user } : {}) });
  });
  if (!connections.length) throw new ModuleError(tr(ctx, { en: "No hosts in the file", ru: "В файле нет хостов" }));
  return { nodes: [{ type: "folder" as const, name: file.name.replace(/\.[^.]+$/, ""), children: connections }], warnings };
}

defineModule({
  handlers: {},
  importers: { hosts: parse },
});
