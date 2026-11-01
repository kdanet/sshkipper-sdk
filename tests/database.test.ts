// The database protocol (spec/database.md): the serve loop, the example driver end to end, the manifest's checks.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DatabaseError, serveDatabase } from "../packages/sdk/src/database.ts";
import { validateFolder, validateManifest } from "../packages/sdk/src/validate.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = join(root, "examples/db-sqlite-node");

test("database: the example carries the SDK's protocol file and validates", () => {
  assert.equal(readFileSync(join(example, "lib/database.ts"), "utf8"), readFileSync(join(root, "packages/sdk/src/database.ts"), "utf8"),
    "copy packages/sdk/src/database.ts to examples/db-sqlite-node/lib/database.ts");
  assert.deepEqual(validateFolder(example).issues.filter((i) => i.severity === "error"), []);
});

test("database: read commands that change data and odd quotes are refused", () => {
  const m = {
    sdk: 1, id: "dev.acme.db", version: "1.0.0", title: "DB", runtime: { kind: "process", command: ["node", "d.ts"] },
    contributes: { database: [{ id: "acme", title: "Acme", model: "sql", identifierQuote: "'", readCommands: ["select", "with", "DELETE", "two words"] }] },
  };
  const issues = new Set(validateManifest(m as any).filter((i) => i.severity === "error").map((i) => i.path));
  for (const p of ["contributes.database[0].identifierQuote", "contributes.database[0].readCommands[1]",
    "contributes.database[0].readCommands[2]", "contributes.database[0].readCommands[3]"]) assert.ok(issues.has(p), p);
  assert.ok(!issues.has("contributes.database[0].readCommands[0]"), "select is a read");
});

test("database: the serve loop answers by id, errors with codes, unknown methods as unsupported", async () => {
  const input = new PassThrough();
  const out: string[] = [];
  const done = serveDatabase({
    ping: () => ({}),
    query: async (p) => { if (p.sql === "boom") throw new DatabaseError("query", "syntax", { serverCode: "1" }); return { columns: [], rows: [], truncated: false, durationMs: 0 }; },
  }, { input, output: (l) => out.push(l) });
  input.write(JSON.stringify({ id: 1, method: "ping", params: { session: "s" } }) + "\n");
  input.write(JSON.stringify({ id: 2, method: "query", params: { sql: "boom" } }) + "\n");
  input.write(JSON.stringify({ id: 3, method: "redis.scan", params: {} }) + "\n");
  input.end();
  await done;
  for (const l of out) assert.ok(l.startsWith('{"id":'), "the id comes first");
  const byID = Object.fromEntries(out.map((l) => { const m = JSON.parse(l); return [m.id, m]; }));
  assert.deepEqual(byID[1].result, {});
  assert.deepEqual(byID[2].error, { code: "query", message: "syntax", serverCode: "1" });
  assert.equal(byID[3].error.code, "unsupported");
});

test("database: the example driver end to end — read, edit, transaction, cancel", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-db-"));
  const file = join(dir, "t.sqlite");
  const db = new DatabaseSync(file);
  db.exec("create table t(id integer primary key, name text); insert into t(name) values ('a'), ('b');");
  db.close();
  const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "driver.ts"], { cwd: example, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map<number, (m: any) => void>();
  createInterface({ input: p.stdout! }).on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  let n = 0;
  const call = (method: string, params: unknown) => new Promise<any>((r) => { const id = ++n; waiting.set(id, r); p.stdin!.write(JSON.stringify({ id, method, params }) + "\n"); });
  try {
    const hello = (await call("hello", {})).result;
    assert.equal(hello.protocolVersion, 1);
    assert.equal(hello.engines[0].engine, "example-sqlite");
    assert.ok((await call("connect", { session: "s", connection: { engine: "example-sqlite", host: "", port: 0, tls: "disabled", timeoutSeconds: 5, path: file } })).result.serverVersion);
    assert.deepEqual((await call("objects", { session: "s", database: "main" })).result.map((o: any) => o.name), ["t"]);
    const page = (await call("tableData", { session: "s", queryID: "p", request: { table: "t", filters: [{ column: "name", op: "equals", value: "b", enabled: true }], matchAll: true, orderBy: [], limit: 10, offset: 0, countTotal: true } })).result;
    assert.deepEqual([page.result.rows, page.totalRows, page.primaryKey], [[["2", "b"]], 1, ["id"]]);
    const edit = { session: "s", table: "t", changes: [{ kind: "update", key: [{ column: "id", value: { text: "1", isDefault: false } }], values: [{ column: "name", value: { text: "it's", isDefault: false } }] }] };
    assert.deepEqual((await call("applyChanges", { ...edit, dryRun: true })).result.statements, [`update "t" set "name" = 'it''s' where "id" = 1`]);
    assert.equal((await call("applyChanges", { ...edit, dryRun: false })).result.affectedRows, 1);
    assert.equal((await call("query", { session: "s", sql: "begin", maxRows: 10, queryID: "b" })).result.inTransaction, true);
    const slow = call("query", { session: "s", sql: "with recursive c(x) as (select 1 union all select x + 1 from c) select count(*) from c", maxRows: 1, queryID: "slow" });
    await new Promise((r) => setTimeout(r, 200));
    await call("cancel", { session: "s", queryID: "slow" });
    assert.equal((await slow).error.code, "cancelled");
    const after = (await call("query", { session: "s", sql: "select name from t where id = 1", maxRows: 10, queryID: "a" })).result;
    assert.deepEqual([after.rows, after.inTransaction], [[["it's"]], false]);
    assert.equal((await call("query", { session: "x", sql: "select 1", maxRows: 1, queryID: "x" })).error.code, "notConnected");
  } finally {
    p.stdin!.end();
    await new Promise((r) => p.once("exit", r));
    rmSync(dir, { recursive: true, force: true });
  }
});
