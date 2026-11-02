// The database protocol (spec/database.md): what a driver of a `contributes.database` engine answers. One JSON object
// per line on stdin (requests) and stdout (responses), answered in any order — the id ties them together; logs go to
// stderr. Not JSON-RPC: the same wire as the app's built-in driver `sshkipper-db` (Packages/DatabaseProtocol).
//
//   request  {"id": 7, "method": "query", "params": {…}}
//   response {"id": 7, "result": {…}}   or   {"id": 7, "error": {"code": "query", "message": "…"}}
//
// Self-contained (no other SDK file): a driver copies it next to its code, like the examples do.

import { createInterface } from "node:readline";

export const DATABASE_PROTOCOL_VERSION = 1;

// MARK: Engine and session

export type DataModel = "sql" | "keyValue" | "document";

/** One engine in `hello`. The app takes the engine's descriptor (model, file, quotes) from the manifest; these
 *  facts drive the screens: editing, transactions, databases. */
export interface EngineInfo {
  engine: string;
  title: string;
  /** Highlighting and completion (the manifest's are used when these are empty). */
  keywords: string[];
  functions: string[];
  identifierQuote: string;
  /** Rows of a table can be changed from the grid (by primary key). */
  supportsEditing: boolean;
  /** `applyChanges` writes all or nothing. */
  supportsTransactions: boolean;
  hasDatabases: boolean;
  model?: DataModel;
  isFile?: boolean;
  hasSchemas?: boolean;
  hasEditorTransactions?: boolean;
  defaultPort?: number;
  icon?: string;
}

export interface PluginInfo {
  protocolVersion: number;
  pluginVersion: string;
  engines: EngineInfo[];
  /** "passwordBytes": the password comes as `passwordBase64` (else as the text `password`). */
  features?: string[];
}

export type TLSMode = "disabled" | "required" | "verifyIdentity";

export interface ConnectParams {
  engine: string;
  /** Through a server: 127.0.0.1 and the port the app forwarded over SSH. */
  host: string;
  port: number;
  user?: string;
  /** The password's UTF-8 bytes in base64 (with the `passwordBytes` feature). Keep it no longer than needed. */
  passwordBase64?: string;
  password?: string;
  database?: string;
  tls: TLSMode;
  timeoutSeconds: number;
  /** The name the certificate must carry (the database's address as the server sees it). */
  tlsServerName?: string;
  /** A file engine (`isFile`): the absolute path on this Mac. */
  path?: string;
  /** The node is «Только чтение»: refuse writes where the engine can (open read-only). */
  readOnly?: boolean;
}

export interface SessionInfo {
  serverVersion: string;
  serverTitle: string;
  database?: string;
  /** The session can't write whatever the node says (a read-only file, a replica). */
  readOnly?: boolean;
  readOnlyReason?: string;
}

// MARK: Results

export type ValueKind = "text" | "integer" | "decimal" | "float" | "bool" | "date" | "datetime" | "time" | "json" | "binary" | "other";

export interface Column { name: string; type: string; kind: ValueKind; table?: string }

export interface Result {
  columns: Column[];
  /** Values as text, null for NULL; binary as "0x…" hex. */
  rows: (string | null)[][];
  affectedRows?: number;
  lastInsertID?: string;
  message?: string;
  warnings?: number;
  /** More rows than `maxRows` were there. */
  truncated: boolean;
  durationMs: number;
  /** A transaction is open on the session after the statement (the editor shows it, asks before closing). */
  inTransaction?: boolean;
}

export interface Database { name: string; isSystem: boolean; tables?: number; detail?: string }

export type ObjectKind = "table" | "view" | "materializedView" | "dictionary" | "other" | "sequence" | "function" | "procedure" | "foreignTable" | "collection";

export interface DBObject { name: string; kind: ObjectKind; engine?: string; rows?: number; size?: number; comment?: string; schema?: string }

export interface ColumnInfo {
  name: string; type: string; kind: ValueKind; nullable: boolean; defaultValue?: string; isPrimaryKey: boolean; extra?: string; comment?: string;
}
export interface IndexInfo { name: string; columns: string[]; unique: boolean; type?: string }
export interface ForeignKeyInfo { name: string; columns: string[]; referencedTable: string; referencedColumns: string[]; onUpdate?: string; onDelete?: string }
export interface InfoItem { title: string; value: string; key?: string; number?: number; unit?: "count" | "bytes" | "seconds" | "unixTime" }

export interface Structure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  /** Columns that identify a row for editing; empty — the grid doesn't edit the table. */
  primaryKey: string[];
  ddl?: string;
  info: InfoItem[];
}

export type FilterOperator =
  | "equals" | "notEquals" | "greater" | "greaterOrEqual" | "less" | "lessOrEqual"
  | "contains" | "notContains" | "startsWith" | "endsWith" | "isNull" | "isNotNull" | "isEmpty" | "isNotEmpty" | "inList";

export interface Filter { column?: string; op: FilterOperator; value: string; enabled: boolean }

export interface TableRequest {
  database?: string;
  table: string;
  filters: Filter[];
  /** Filters joined with AND (true) or OR. */
  matchAll: boolean;
  /** A condition the user typed (checked by the app: one read-only condition), ANDed with the filters. */
  rawWhere?: string;
  orderBy: { column: string; ascending: boolean }[];
  limit: number;
  offset: number;
  countTotal: boolean;
  cellBytes?: number;
}

export interface TableData { result: Result; primaryKey: string[]; totalRows?: number; sql: string }

export interface CellValue { text?: string | null; isDefault: boolean }
export interface ColumnValue { column: string; value: CellValue }
export interface RowChange { kind: "update" | "insert" | "delete"; key: ColumnValue[]; values: ColumnValue[] }
export interface ApplyResult { statements: string[]; affectedRows: number }

// MARK: keyValue engines (the key browser) — spec/database.md §4.1

/** A key in a `redis.scan` page. `type`: string, hash, list, set, zset, stream (another type is shown, not edited). */
export interface KeyInfo { key: string; type: string; /** Seconds to live; -1 — no expiry, -2 — gone. */ ttl: number }

export interface ScanResult {
  /** "0" when the scan is complete; else what the next `redis.scan` sends back. */
  cursor: string;
  keys: KeyInfo[];
}

/** One key's value, a page of its elements. */
export interface KeyValue {
  key: string;
  type: string;
  ttl: number;
  /** Elements in the value (a string: its bytes). */
  length: number;
  /** Memory the key uses, bytes, when known. */
  memory?: number;
  encoding?: string;
  /** A string value as text (binary bytes escaped as "\xff"). */
  text?: string;
  /** `text` is the whole value as plain text (not cut, no escaped bytes): the browser lets it be edited. */
  textIsExact?: boolean;
  /** A binary string: `text` shows only its first this many bytes. */
  binaryPreviewBytes?: number;
  /** Elements from `offset`: [value] for list and set, [field, value] for hash, [member, score] for zset,
   *  [id, "field=value"…] for stream. A list's index is `offset + row`. */
  items: string[][];
  offset: number;
}

/** A reply of `redis.command`, as a tree (redis-cli shows it). */
export interface Reply {
  kind: "string" | "status" | "error" | "integer" | "double" | "bool" | "null" | "array" | "map" | "set" | "bigNumber" | "verbatim";
  text?: string;
  items?: Reply[];
}

// MARK: document engines (the collection browser) — spec/database.md §4.2

export interface FindResult {
  /** Documents as Mongo shell text (`{_id: ObjectId("…"), name: "a"}`), field order kept. */
  documents: string[];
  /** Matching documents in all; omit when not counted. */
  total?: number;
  /** The command that ran, as the shell would write it (shown and copyable). */
  command: string;
  durationMs: number;
  /** Positions of documents too big to hand over whole: shown read-only. */
  cut?: number[];
}

/** A change of `mongo.write`: `original` — the document as read (it must still be so on the server), shell text. */
export interface WriteOp { kind: "insert" | "replace" | "delete"; original?: string; document?: string }

// MARK: Requests

export interface Methods {
  hello(p: Record<string, never>): PluginInfo;
  connect(p: { session: string; connection: ConnectParams }): SessionInfo;
  disconnect(p: { session: string }): Record<string, never>;
  ping(p: { session: string }): Record<string, never>;
  /** One statement (the app splits scripts). `readOnly`: the app wants a read the server guarantees (an agent in
   *  «Только чтение»); `isolated`: not on the session's own connection state (an agent's statement). */
  query(p: { session: string; sql: string; database?: string; maxRows: number; queryID: string; readOnly?: boolean; isolated?: boolean }): Result;
  /** Stop the statement or page with this `queryID` (best effort; answer once it is asked). */
  cancel(p: { session: string; queryID: string }): Record<string, never>;
  databases(p: { session: string }): Database[];
  objects(p: { session: string; database: string; offset?: number; limit?: number; filter?: string }): DBObject[];
  structure(p: { session: string; database?: string; table: string; fresh?: boolean }): Structure;
  /** A page of a table — always a read, whatever the session. */
  tableData(p: { session: string; request: TableRequest; queryID: string }): TableData;
  /** Edits of the grid; `dryRun` — only the statements (the app shows them before asking). */
  applyChanges(p: { session: string; database?: string; table: string; changes: RowChange[]; dryRun: boolean }): ApplyResult;
  serverInfo(p: { session: string }): InfoItem[];

  /** keyValue: a page of keys of database `db` matching `pattern` (glob: `*`, `?`, `[…]`) from `cursor`. */
  "redis.scan"(p: { session: string; db: number; cursor: string; pattern: string; count: number }): ScanResult;
  /** keyValue: a key's value and a page of its elements (`offset`, `limit`). */
  "redis.value"(p: { session: string; db: number; key: string; offset: number; limit: number }): KeyValue;
  /** keyValue: a command as redis-cli words (`["HSET", "k", "f", "v"]`); `escaped` — positions of arguments written
   *  as the browser shows bytes ("\xff"): decode them to bytes. The browser's writes and its console come here. */
  "redis.command"(p: { session: string; db: number; args: string[]; escaped: number[] }): Reply;
  /** document: a page of a collection. `filter`, `projection`, `sort` — Mongo shell text (`{status: "paid"}`); empty —
   *  none. `countTotal` — count the matching documents too (bounded in time). Cancelled by `queryID` like a query. */
  "mongo.find"(p: { session: string; database: string; collection: string; filter: string; projection?: string; sort?: string;
                    skip: number; limit: number; countTotal: boolean; queryID: string }): FindResult;
  /** document: whole documents inserted, replaced, deleted in order; a replace or delete applies only while the document
   *  still equals `original`, else stop and fail with `appliedChanges`. `dryRun` — only the shell commands. */
  "mongo.write"(p: { session: string; database: string; collection: string; ops: WriteOp[]; dryRun: boolean }): ApplyResult;
}

export type ErrorCode = "auth" | "connection" | "query" | "cancelled" | "unsupported" | "notConnected" | "invalidRequest" | "internalError";

/** A failure the app shows as is (`code` picks the screen: login, connection, the statement's error). */
export class DatabaseError extends Error {
  code: ErrorCode;
  serverCode?: string;
  /** applyChanges failed after this many changes were written for good. */
  appliedChanges?: number;
  constructor(code: ErrorCode, message: string, extra: { serverCode?: string; appliedChanges?: number } = {}) {
    super(message);
    this.code = code;
    this.serverCode = extra.serverCode;
    this.appliedChanges = extra.appliedChanges;
  }
}

export type Handlers = { [M in keyof Methods]?: (params: Parameters<Methods[M]>[0]) => ReturnType<Methods[M]> | Promise<ReturnType<Methods[M]>> };

/** Answers the app's requests with `handlers` until stdin closes (the app stops the driver by closing it). Requests
 *  run concurrently: a `cancel` arrives while the `query` it names is still running. */
export function serveDatabase(handlers: Handlers, io: { input?: NodeJS.ReadableStream; output?: (line: string) => void } = {}): Promise<void> {
  const write = io.output ?? ((line: string) => { process.stdout.write(line + "\n"); });
  const rl = createInterface({ input: io.input ?? process.stdin, crlfDelay: Infinity });
  const running = new Set<Promise<void>>();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let id: number = -1, method = "", params: any = {};
    try {
      const req = JSON.parse(line);
      id = typeof req.id === "number" ? req.id : -1;
      method = String(req.method ?? "");
      params = req.params ?? {};
    } catch {
      write(JSON.stringify({ id: -1, error: { code: "invalidRequest", message: "not JSON" } }));
      return;
    }
    const task = (async () => {
      const h = (handlers as Record<string, ((p: any) => unknown) | undefined>)[method];
      try {
        if (!h) throw new DatabaseError("unsupported", `${method}: not supported by this driver`);
        const result = await h(params);
        // "id" first: the app finds a response's caller from the start of the line.
        write(JSON.stringify({ id, result: result ?? {} }));
      } catch (e) {
        const err = e instanceof DatabaseError ? e : new DatabaseError("internalError", e instanceof Error ? e.message : String(e));
        const body: Record<string, unknown> = { code: err.code, message: err.message };
        if (err.serverCode) body.serverCode = err.serverCode;
        if (err.appliedChanges !== undefined) body.appliedChanges = err.appliedChanges;
        write(JSON.stringify({ id, error: body }));
      }
    })();
    running.add(task);
    task.finally(() => running.delete(task));
  });
  return new Promise((resolve) => rl.on("close", async () => { await Promise.allSettled([...running]); resolve(); }));
}

/** The password of a connect request as text (from `passwordBase64` or `password`). */
export function passwordOf(c: ConnectParams): string | undefined {
  if (c.passwordBase64 !== undefined) return Buffer.from(c.passwordBase64, "base64").toString("utf8");
  return c.password;
}
