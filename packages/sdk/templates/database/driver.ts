// __TITLE__: a database driver of SSHKipper SDK 1 (spec/database.md). The app draws the tab — the editor, the grid,
// filters, structure — and sends requests one JSON object per line; this program answers them (not JSON-RPC: the same
// wire as the app's built-in drivers). The start reads tables from a JSON file on this Mac
// ({"tables": {"hosts": [{"name": "web-1", "port": 22}]}}) and answers `select * from <table> [limit n]` — replace
// it with your engine's client. Every statement of an extension's engine counts as a change for the app (Production
// asks, «Только чтение» refuses), whatever the driver does.

import { readFileSync } from "node:fs";
import { DatabaseError, serveDatabase, type Column, type Filter, type Result } from "./lib/database.ts";

type Row = Record<string, unknown>;
const sessions = new Map<string, { path: string; tables: Record<string, Row[]> }>();

function session(id: string) {
  return sessions.get(id) ?? (() => { throw new DatabaseError("notConnected", "No such session"); })();
}

function table(id: string, name: string): Row[] {
  const t = session(id).tables[name.replace(/^"|"$/g, "")];
  if (!t) throw new DatabaseError("query", `No table «${name}»`);
  return t;
}

const columnsOf = (rows: Row[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))];
const text = (v: unknown) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));

function result(rows: Row[], started: number, truncated = false): Result {
  const names = columnsOf(rows);
  const columns: Column[] = names.map((name) => ({ name, type: typeof rows.find((r) => r[name] != null)?.[name] === "number" ? "number" : "text", kind: "text" }));
  return { columns, rows: rows.map((r) => names.map((n) => text(r[n]))), truncated, durationMs: Date.now() - started };
}

function matches(r: Row, f: Filter): boolean {
  if (!f.enabled || !f.column) return true;
  const v = text(r[f.column]);
  switch (f.op) {
    case "equals": return v === f.value;
    case "notEquals": return v !== f.value;
    case "contains": return (v ?? "").includes(f.value);
    case "notContains": return !(v ?? "").includes(f.value);
    case "startsWith": return (v ?? "").startsWith(f.value);
    case "endsWith": return (v ?? "").endsWith(f.value);
    case "isNull": return v === null;
    case "isNotNull": return v !== null;
    case "isEmpty": return !v;
    case "isNotEmpty": return !!v;
    case "inList": return f.value.split(",").map((x) => x.trim()).includes(v ?? "");
    case "greater": return Number(v) > Number(f.value);
    case "greaterOrEqual": return Number(v) >= Number(f.value);
    case "less": return Number(v) < Number(f.value);
    case "lessOrEqual": return Number(v) <= Number(f.value);
    default: return true;
  }
}

await serveDatabase({
  hello: () => ({
    protocolVersion: 1, pluginVersion: "0.1.0", features: ["passwordBytes"],
    // `engine` must be the manifest's `contributes.database[].id` — rename both together, or the app says the
    // program «doesn't name the engine in hello».
    engines: [{ engine: "__SLUG__", title: "__TITLE__", keywords: [], functions: [], identifierQuote: "\"", supportsEditing: false, supportsTransactions: false, hasDatabases: false }],
  }),
  connect: ({ session: id, connection }) => {
    if (!connection.path) throw new DatabaseError("connection", "Choose a JSON file");
    let data: any;
    try { data = JSON.parse(readFileSync(connection.path, "utf8")); } catch (e) { throw new DatabaseError("connection", `Can't read ${connection.path}: ${(e as Error).message}`); }
    if (!data || typeof data.tables !== "object") throw new DatabaseError("connection", "The file has no «tables» object");
    sessions.set(id, { path: connection.path, tables: data.tables });
    // No `readOnly` here although nothing writes: an extension's engine without verified read commands has every
    // statement counted as a change (spec/database.md §5), so a session said read-only would refuse even the editor's
    // SELECT. Say `readOnly: true` (with `readOnlyReason`) only when the session really can't write — a read-only file,
    // a replica; `query` below refuses anything but a read on its own.
    return { serverVersion: "0.1.0", serverTitle: "__TITLE__", database: "main" };
  },
  disconnect: ({ session: id }) => { sessions.delete(id); return {}; },
  ping: ({ session: id }) => { session(id); return {}; },
  databases: () => [{ name: "main", isSystem: false }],
  objects: ({ session: id }) => Object.entries(session(id).tables).map(([name, rows]) => ({ name, kind: "table" as const, rows: rows.length })),
  structure: ({ session: id, table: name }) => ({
    columns: columnsOf(table(id, name)).map((c) => ({ name: c, type: "text", kind: "text" as const, nullable: true, isPrimaryKey: false })),
    indexes: [], foreignKeys: [], primaryKey: [], info: [{ title: "Rows", value: String(table(id, name).length) }],
  }),
  tableData: ({ session: id, request: q }) => {
    const started = Date.now();
    let rows = table(id, q.table).filter((r) => (q.matchAll ? q.filters.every((f) => matches(r, f)) : !q.filters.some((f) => f.enabled) || q.filters.some((f) => f.enabled && matches(r, f))));
    for (const o of [...q.orderBy].reverse()) rows = [...rows].sort((a, b) => String(text(a[o.column]) ?? "").localeCompare(String(text(b[o.column]) ?? ""), undefined, { numeric: true }) * (o.ascending ? 1 : -1));
    const page = rows.slice(q.offset, q.offset + q.limit);
    return { result: result(page, started, rows.length > q.offset + q.limit), primaryKey: [], totalRows: q.countTotal ? rows.length : undefined, sql: `select * from "${q.table}"` };
  },
  query: ({ session: id, sql, maxRows }) => {
    const started = Date.now();
    const m = sql.trim().replace(/;$/, "").match(/^select\s+\*\s+from\s+("?[\w.-]+"?)(?:\s+limit\s+(\d+))?$/i);
    if (!m) throw new DatabaseError("query", "This start reads «select * from <table> [limit n]» only — write your engine's query in driver.ts");
    const rows = table(id, m[1]);
    const limit = Math.min(Number(m[2] ?? maxRows), maxRows);
    return result(rows.slice(0, limit), started, rows.length > limit);
  },
  cancel: () => ({}),
  serverInfo: ({ session: id }) => [{ title: "File", value: session(id).path }, { title: "Tables", value: String(Object.keys(session(id).tables).length) }],
});
