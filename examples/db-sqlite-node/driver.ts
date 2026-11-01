// «SQLite на Node» — an example database driver of an SSHKipper extension (spec/database.md): the engine
// `example-sqlite` (model `sql`, a file on this Mac) answered with Node's built-in `node:sqlite`, nothing to install.
// The app draws the whole tab — editor, grid, structure, filters, edits, Production and «Только чтение» — and talks to
// this program over the database protocol (lib/database.ts, the SDK's `packages/sdk/src/database.ts`).
//
// Each session's file lives in a child process (sqlite-session.ts): `cancel` kills the one that runs the statement,
// and the session opens the file again on its next request.

import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DATABASE_PROTOCOL_VERSION, DatabaseError, serveDatabase, type ConnectParams, type ErrorCode } from "./lib/database.ts";

const ENGINE = "example-sqlite";

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE", "GLOB", "BETWEEN", "ORDER", "BY", "GROUP", "HAVING",
  "LIMIT", "OFFSET", "AS", "JOIN", "LEFT", "INNER", "CROSS", "ON", "USING", "UNION", "ALL", "DISTINCT", "INSERT", "INTO",
  "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "VIEW", "INDEX", "DROP", "ALTER", "ADD", "COLUMN", "PRIMARY", "KEY",
  "DEFAULT", "BEGIN", "COMMIT", "ROLLBACK", "EXPLAIN", "QUERY", "PLAN", "WITH", "CASE", "WHEN", "THEN", "ELSE", "END", "PRAGMA",
];
const FUNCTIONS = ["count", "sum", "avg", "min", "max", "length", "lower", "upper", "substr", "coalesce", "ifnull", "round", "abs",
  "date", "time", "datetime", "strftime", "json_extract", "printf", "typeof", "total", "group_concat"];

interface Session {
  params: ConnectParams;
  worker?: ChildProcess;
  next: number;
  waiting: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; queryID?: string }>;
}

const sessions = new Map<string, Session>();

function worker(s: Session): ChildProcess {
  if (s.worker) return s.worker;
  // stdout is the protocol's: the child gets none, only stderr (the app's log of the extension) and the IPC channel.
  const w = fork(fileURLToPath(new URL("./sqlite-session.ts", import.meta.url)), [], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: ["--disable-warning=ExperimentalWarning"],
    env: { ...process.env, SQLITE_PATH: s.params.path ?? "", SQLITE_READONLY: s.params.readOnly ? "1" : "0" },
  });
  w.on("message", (m: { id: number; result?: any; error?: { code: ErrorCode; message: string; serverCode?: string; appliedChanges?: number } }) => {
    const k = s.waiting.get(m.id);
    if (!k) return;
    s.waiting.delete(m.id);
    if (m.error) k.reject(new DatabaseError(m.error.code, m.error.message, m.error));
    else k.resolve(m.result);
  });
  // The process ended (cancelled or crashed): whatever waited on it fails; the next request starts another one.
  const gone = (why: DatabaseError) => {
    if (s.worker !== w) return;
    s.worker = undefined;
    for (const k of s.waiting.values()) k.reject(why);
    s.waiting.clear();
  };
  w.on("error", (e) => gone(new DatabaseError("internalError", e.message)));
  w.on("exit", (code, signal) => gone(signal === "SIGKILL" ? new DatabaseError("cancelled", "Запрос остановлен")
    : new DatabaseError("internalError", `Процесс сессии SQLite завершился (${signal ?? `код ${code}`})`)));
  s.worker = w;
  return w;
}

const end = (w?: ChildProcess) => { if (w && w.exitCode === null) w.kill("SIGKILL"); };

async function ask(s: Session, op: string, params: unknown, queryID?: string): Promise<any> {
  const fresh = !s.worker;
  const w = worker(s);
  // A new worker (after a cancel) opens the file first.
  if (fresh && op !== "open") await send(s, w, "open", {});
  return send(s, w, op, params, queryID);
}

function send(s: Session, w: ChildProcess, op: string, params: unknown, queryID?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++s.next;
    s.waiting.set(id, { resolve, reject, queryID });
    w.send({ id, op, params });
  });
}

function session(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new DatabaseError("notConnected", "Сессия закрыта — подключитесь заново");
  return s;
}

await serveDatabase({
  hello: () => ({
    protocolVersion: DATABASE_PROTOCOL_VERSION,
    pluginVersion: "1.0.0",
    features: ["passwordBytes"],
    engines: [{
      engine: ENGINE, title: "SQLite (Node)", keywords: KEYWORDS, functions: FUNCTIONS, identifierQuote: "\"",
      supportsEditing: true, supportsTransactions: true, hasDatabases: true,
      model: "sql", isFile: true, hasEditorTransactions: true,
    }],
  }),

  connect: async ({ session: id, connection }) => {
    if (connection.engine !== ENGINE) throw new DatabaseError("unsupported", `Движок ${connection.engine} не поддерживается`);
    if (!connection.path?.startsWith("/")) throw new DatabaseError("invalidRequest", "Нужен полный путь к файлу базы");
    const s: Session = { params: connection, next: 0, waiting: new Map() };
    sessions.set(id, s);
    try {
      return await ask(s, "open", {});
    } catch (e) {
      sessions.delete(id);
      end(s.worker);
      throw e;
    }
  },

  disconnect: async ({ session: id }) => {
    const s = sessions.get(id);
    sessions.delete(id);
    end(s?.worker);
    return {};
  },

  ping: ({ session: id }) => { session(id); return {}; },

  query: (p) => ask(session(p.session), "query", p, p.queryID),
  tableData: (p) => ask(session(p.session), "tableData", p, p.queryID),
  databases: (p) => ask(session(p.session), "databases", p),
  objects: (p) => ask(session(p.session), "objects", p),
  structure: (p) => ask(session(p.session), "structure", p),
  applyChanges: (p) => ask(session(p.session), "applyChanges", p),
  serverInfo: (p) => ask(session(p.session), "serverInfo", p),

  // The statement runs inside SQLite in its own process: killing it is the only way to stop it. Its connection goes
  // with it (SQLite rolls an open transaction back from the journal).
  cancel: ({ session: id, queryID }) => {
    const s = sessions.get(id);
    if (s?.worker && [...s.waiting.values()].some((k) => k.queryID === queryID)) end(s.worker);
    return {};
  },
});

// stdin closed: the app stops the driver. Its sessions end with it (their processes hold the files open).
for (const s of sessions.values()) end(s.worker);
process.exit(0);
