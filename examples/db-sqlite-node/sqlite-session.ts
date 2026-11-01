// One session's SQLite file, in a process of its own (driver.ts forks it): node:sqlite is synchronous and a running
// statement stays inside SQLite's C code, where neither the event loop nor a worker's terminate reaches it — `cancel`
// kills this process, and the session's next request opens the file again. Two connections: the editor's (its
// transactions live here) and a read-only one for table pages and reads the app wants guaranteed (`readOnly`).

import { DatabaseSync, type StatementSync } from "node:sqlite";
import { statSync } from "node:fs";

type Json = any;
interface Failure { code: string; message: string; serverCode?: string; appliedChanges?: number }

const path = process.env.SQLITE_PATH ?? "";
const readOnly = process.env.SQLITE_READONLY === "1";
let rw: DatabaseSync | undefined;
let ro: DatabaseSync | undefined;

function fail(code: string, message: string, extra: Partial<Failure> = {}): never {
  throw Object.assign(new Error(message), { failure: { code, message, ...extra } });
}

function open(): Json {
  try {
    statSync(path);
  } catch {
    fail("connection", `Файл ${path} не найден`);
  }
  try {
    ro = new DatabaseSync(path, { readOnly: true });
    if (!readOnly) rw = new DatabaseSync(path);
  } catch (e) {
    fail("connection", (e as Error).message);
  }
  const version = String((ro!.prepare("select sqlite_version() as v").get() as any).v);
  return { serverVersion: version, serverTitle: `SQLite ${version} (Node)`, database: "main", readOnly: readOnly || undefined,
           readOnlyReason: readOnly ? "открыт только для чтения" : undefined };
}

// MARK: Values

function kindOf(type: string | null | undefined): string {
  const t = (type ?? "").toUpperCase();
  if (t.includes("INT")) return "integer";
  if (t.includes("BOOL")) return "bool";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "float";
  if (t.includes("DEC") || t.includes("NUMERIC")) return "decimal";
  if (t.includes("BLOB")) return "binary";
  if (t.includes("DATETIME") || t.includes("TIMESTAMP")) return "datetime";
  if (t.includes("DATE")) return "date";
  if (t.includes("TIME")) return "time";
  if (t.includes("JSON")) return "json";
  return "text";
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return "0x" + Buffer.from(v).toString("hex");
  return String(v);
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (v: string | null | undefined, kind: string) => {
  if (v === null || v === undefined) return "NULL";
  if (kind === "binary" && /^0x([0-9a-fA-F]{2})*$/.test(v)) return `X'${v.slice(2)}'`;
  if ((kind === "integer" || kind === "float" || kind === "decimal") && /^-?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$/.test(v)) return v;
  return `'${v.replaceAll("'", "''")}'`;
};

function rowsOf(st: StatementSync, maxRows: number, args: unknown[] = []) {
  st.setReturnArrays(true);
  st.setReadBigInts(true);
  const columns = st.columns().map((c) => ({ name: c.name, type: c.type ?? "", kind: kindOf(c.type), table: c.table ?? undefined }));
  const rows: (string | null)[][] = [];
  let truncated = false;
  for (const r of st.iterate(...(args as any[])) as Iterable<unknown[]>) {
    if (rows.length >= maxRows) { truncated = true; break; }
    rows.push(r.map(text));
  }
  return { columns, rows, truncated };
}

function sqlError(e: unknown): never {
  const err = e as any;
  if (err?.failure) throw err;
  fail("query", String(err?.message ?? e), { serverCode: err?.errcode !== undefined ? String(err.errcode) : undefined });
}

// MARK: Requests

function query(p: Json): Json {
  const started = performance.now();
  const db = p.readOnly || !rw ? ro! : rw;
  try {
    const st = db.prepare(p.sql);
    if (st.columns().length > 0) {
      const { columns, rows, truncated } = rowsOf(st, p.maxRows ?? 1000);
      return { columns, rows, truncated, durationMs: performance.now() - started, inTransaction: rw?.isTransaction ?? false };
    }
    // `changes` repeats the last INSERT/UPDATE/DELETE's count after any statement (BEGIN, CREATE): the total's step
    // is what this one changed.
    const total = () => Number((db.prepare("select total_changes() as n").get() as any).n);
    const before = total();
    const r = st.run();
    const changed = total() - before;
    return { columns: [], rows: [], affectedRows: changed, lastInsertID: changed && r.lastInsertRowid ? String(r.lastInsertRowid) : undefined,
             truncated: false, durationMs: performance.now() - started, inTransaction: rw?.isTransaction ?? false };
  } catch (e) { sqlError(e); }
}

function objects(p: Json): Json {
  const filter = typeof p.filter === "string" && p.filter ? `%${p.filter}%` : "%";
  const st = ro!.prepare(`select name, type from sqlite_schema where type in ('table', 'view') and name not like 'sqlite_%'
                          and name like ? order by name limit ? offset ?`);
  return (st.all(filter, p.limit ?? -1, p.offset ?? 0) as any[]).map((r) => {
    let rows: number | undefined;
    if (r.type === "table") { try { rows = Number((ro!.prepare(`select count(*) as n from ${ident(r.name)}`).get() as any).n); } catch { /* unreadable */ } }
    return { name: r.name, kind: r.type === "view" ? "view" : "table", rows };
  });
}

function structure(p: Json): Json {
  const t = ident(p.table);
  const cols = ro!.prepare(`pragma table_xinfo(${t})`).all() as any[];
  if (!cols.length) fail("query", `Нет таблицы ${p.table}`);
  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name as string);
  const indexes = (ro!.prepare(`pragma index_list(${t})`).all() as any[]).map((i) => ({
    name: i.name, unique: !!i.unique, type: i.origin,
    columns: (ro!.prepare(`pragma index_info(${ident(i.name)})`).all() as any[]).map((c) => String(c.name)),
  }));
  const fks = new Map<number, any>();
  for (const f of ro!.prepare(`pragma foreign_key_list(${t})`).all() as any[]) {
    const fk = fks.get(f.id) ?? { name: `fk_${f.id}`, columns: [], referencedTable: f.table, referencedColumns: [], onUpdate: f.on_update, onDelete: f.on_delete };
    fk.columns.push(f.from); fk.referencedColumns.push(f.to ?? "");
    fks.set(f.id, fk);
  }
  const ddl = (ro!.prepare("select sql from sqlite_schema where name = ?").get(p.table) as any)?.sql ?? undefined;
  return {
    columns: cols.map((c) => ({ name: c.name, type: c.type, kind: kindOf(c.type), nullable: !c.notnull && c.pk === 0,
                                defaultValue: c.dflt_value ?? undefined, isPrimaryKey: c.pk > 0, extra: c.hidden ? "generated" : undefined })),
    indexes, foreignKeys: [...fks.values()], primaryKey: pk, ddl, info: [],
  };
}

function where(req: Json, kinds: Map<string, string>): { sql: string; args: unknown[] } {
  const parts: string[] = [], args: unknown[] = [];
  const like = (v: string) => v.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  for (const f of (req.filters ?? []) as any[]) {
    if (!f.enabled) continue;
    const cols = f.column ? [f.column] : [...kinds.keys()];
    const one = (c: string) => {
      const col = ident(c);
      switch (f.op) {
        case "equals": args.push(f.value); return `${col} = ?`;
        case "notEquals": args.push(f.value); return `${col} <> ?`;
        case "greater": args.push(f.value); return `${col} > ?`;
        case "greaterOrEqual": args.push(f.value); return `${col} >= ?`;
        case "less": args.push(f.value); return `${col} < ?`;
        case "lessOrEqual": args.push(f.value); return `${col} <= ?`;
        case "contains": args.push(`%${like(f.value)}%`); return `${col} like ? escape '\\'`;
        case "notContains": args.push(`%${like(f.value)}%`); return `${col} not like ? escape '\\'`;
        case "startsWith": args.push(`${like(f.value)}%`); return `${col} like ? escape '\\'`;
        case "endsWith": args.push(`%${like(f.value)}`); return `${col} like ? escape '\\'`;
        case "isNull": return `${col} is null`;
        case "isNotNull": return `${col} is not null`;
        case "isEmpty": return `(${col} is null or ${col} = '')`;
        case "isNotEmpty": return `(${col} is not null and ${col} <> '')`;
        case "inList": {
          const items = String(f.value).split(",").map((s) => s.trim()).filter(Boolean);
          args.push(...items);
          return `${col} in (${items.map(() => "?").join(", ") || "null"})`;
        }
        default: fail("invalidRequest", `Неизвестный оператор ${f.op}`);
      }
    };
    parts.push(cols.length > 1 ? `(${cols.map(one).join(" or ")})` : one(cols[0]));
  }
  const joined = parts.length ? `(${parts.join(req.matchAll === false ? " or " : " and ")})` : "";
  const raw = typeof req.rawWhere === "string" && req.rawWhere.trim() ? `(${req.rawWhere})` : "";
  const all = [joined, raw].filter(Boolean).join(" and ");
  return { sql: all ? ` where ${all}` : "", args };
}

function tableData(p: Json): Json {
  const req = p.request;
  const started = performance.now();
  const s = structure({ table: req.table });
  const kinds = new Map<string, string>(s.columns.map((c: any) => [c.name, c.kind]));
  const w = where(req, kinds);
  const order = (req.orderBy ?? []).map((o: any) => `${ident(o.column)} ${o.ascending ? "asc" : "desc"}`).join(", ");
  const sql = `select * from ${ident(req.table)}${w.sql}${order ? ` order by ${order}` : ""} limit ${Number(req.limit) | 0} offset ${Number(req.offset) | 0}`;
  try {
    const { columns, rows } = rowsOf(ro!.prepare(sql), Number(req.limit) | 0, w.args);
    const total = req.countTotal ? Number((ro!.prepare(`select count(*) as n from ${ident(req.table)}${w.sql}`).get(...(w.args as any[])) as any).n) : undefined;
    return { result: { columns, rows, truncated: false, durationMs: performance.now() - started }, primaryKey: s.primaryKey, totalRows: total, sql };
  } catch (e) { sqlError(e); }
}

function applyChanges(p: Json): Json {
  const s = structure({ table: p.table });
  const kinds = new Map<string, string>(s.columns.map((c: any) => [c.name, c.kind]));
  const t = ident(p.table);
  const cond = (key: any[]) => key.map((k) => k.value.text === null || k.value.text === undefined ? `${ident(k.column)} is null` : `${ident(k.column)} = ${literal(k.value.text, kinds.get(k.column) ?? "text")}`).join(" and ");
  const statements: string[] = [];
  for (const c of p.changes as any[]) {
    const values = (c.values ?? []) as any[];
    switch (c.kind) {
      case "update":
        if (!c.key?.length) fail("invalidRequest", "Нет первичного ключа строки");
        statements.push(`update ${t} set ${values.map((v) => `${ident(v.column)} = ${v.value.isDefault ? "default" : literal(v.value.text, kinds.get(v.column) ?? "text")}`).join(", ")} where ${cond(c.key)}`);
        break;
      case "insert": {
        const given = values.filter((v) => !v.value.isDefault);
        statements.push(given.length
          ? `insert into ${t} (${given.map((v) => ident(v.column)).join(", ")}) values (${given.map((v) => literal(v.value.text, kinds.get(v.column) ?? "text")).join(", ")})`
          : `insert into ${t} default values`);
        break;
      }
      case "delete":
        if (!c.key?.length) fail("invalidRequest", "Нет первичного ключа строки");
        statements.push(`delete from ${t} where ${cond(c.key)}`);
        break;
    }
  }
  if (p.dryRun) return { statements, affectedRows: 0 };
  if (!rw) fail("query", "База открыта только для чтения");
  if (rw.isTransaction) fail("query", "Сначала завершите транзакцию в редакторе запросов");
  let affected = 0;
  rw.exec("begin");
  try {
    statements.forEach((sql, i) => {
      const n = Number(rw!.prepare(sql).run().changes);
      // An update or delete touches exactly its row: anything else means the key no longer names one row.
      if (p.changes[i].kind !== "insert" && n !== 1) fail("query", `Изменение ${i + 1} затронуло ${n} строк вместо одной — ничего не записано`);
      affected += n;
    });
    rw.exec("commit");
  } catch (e) {
    rw.exec("rollback");
    sqlError(e);
  }
  return { statements, affectedRows: affected };
}

function serverInfo(): Json {
  const size = statSync(path).size;
  const v = String((ro!.prepare("select sqlite_version() as v").get() as any).v);
  return [
    { title: "Файл", value: path, key: "file" },
    { title: "Размер", value: String(size), key: "fileSize", number: size, unit: "bytes" },
    { title: "Версия", value: v, key: "version" },
    { title: "Драйвер", value: `Node ${process.version}, node:sqlite` },
  ];
}

const ops: Record<string, (p: Json) => Json> = {
  open, query, objects, structure, tableData, applyChanges, serverInfo,
  databases: () => [{ name: "main", isSystem: false, tables: Number((ro!.prepare("select count(*) as n from sqlite_schema where type = 'table' and name not like 'sqlite_%'").get() as any).n) }],
};

process.on("message", (m: { id: number; op: string; params: Json }) => {
  try {
    const f = ops[m.op];
    if (!f) fail("unsupported", m.op);
    process.send!({ id: m.id, result: f(m.params) });
  } catch (e) {
    const failure: Failure = (e as any)?.failure ?? { code: "internalError", message: String((e as Error)?.message ?? e) };
    process.send!({ id: m.id, error: failure });
  }
});
// The driver went away: so does the session.
process.on("disconnect", () => process.exit(0));
