// sshkipper-ext as a whole: every kind `new` makes validates and works, `run` reaches contribution methods, the
// preview lives a screen through its events, ops apply as the app applies them, every example packs, and the MCP
// server keeps what changes things to the person's --allow-changes.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { call, callMethod } from "../packages/sdk/src/dev.ts";
import { applyOps, preview } from "../packages/sdk/src/preview.ts";
import type { Json } from "../packages/sdk/src/types.ts";
import { KINDS, scaffold, slug } from "../packages/sdk/src/scaffold.ts";
import { previewScreen } from "../packages/sdk/src/screens.ts";
import { ops } from "../packages/sdk/src/ui.ts";
import { passesForTheApp, validateFolder } from "../packages/sdk/src/validate.ts";
import { serveMCP } from "../packages/mcp/server.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "packages/cli/sshkipper-ext.ts");

function write(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sk-ext-"));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
  return dir;
}

const storage = (kind: string) => ({ node: "n1", kind, settings: { bucket: `t${process.pid}` }, readOnly: false, throughServer: false });

/** What each kind's start answers, spoken to as the app does. */
const SMOKE: Record<string, (dir: string, id: string) => Promise<void>> = {
  service: async (dir) => {
    const r = await call(dir, "summary", { settings: { warn_pct: 85 } });
    assert.ok(r.ok, r.error);
    assert.match(String((r.value as any).text), /%/);
  },
  storage: async (dir, id) => {
    const s = storage(slug(id));
    const up = await callMethod(dir, "storage/write/begin", { storage: s, path: "/a.txt", size: 2 });
    assert.ok(up.ok, up.error);
    const listed = await callMethod(dir, "storage/check", { storage: s });
    assert.match(String((listed.value as any).text), /Works/);
    const missing = await callMethod(dir, "storage/list", { storage: s, path: "/../../x" });
    assert.match(String(missing.error), /Bad path/);
  },
  source: async (dir, id) => {
    const r = await callMethod(dir, "source/poll", { source: { node: "n", kind: slug(id), settings: { hosts: ["web-1 10.0.0.5:2222 deploy prod", "-bad"] } } });
    assert.ok(r.ok, r.error);
    assert.deepEqual((r.value as any).hosts.map((h: any) => [h.id, h.address, h.port, h.user, h.group]), [["web-1", "10.0.0.5", 2222, "deploy", "prod"]]);
  },
  import: async (dir) => {
    const data = readFileSync(join(dir, "samples/hosts.txt"));
    const r = await callMethod(dir, "import/parse", { importer: "hosts", name: "hosts.txt", size: data.length, data: data.toString("base64"), locale: "en" });
    assert.ok(r.ok, r.error);
    assert.deepEqual((r.value as any).nodes[0].children.map((c: any) => c.port ?? 22), [22, 2222, 22]);
  },
  ai: async (dir) => {
    const r = await callMethod(dir, "ai/chat", { id: "s", provider: "model", model: "echo-1", system: "", tools: [], max_tokens: 50, settings: {}, secrets: {},
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }] });
    assert.ok(r.ok, r.error);
    assert.equal(r.notices.filter((n) => n.method === "ai/delta" && (n.params as any).type === "text").map((n) => (n.params as any).text).join(""), "You asked: ping");
  },
  automation: async (dir) => {
    const t = await call(dir, "threshold", { input: { value: 7, min: 20 } });
    assert.equal((t.value as any).status, "error");
    const d = await call(dir, "disk_free", { input: { mount: "/" } });
    assert.ok(d.ok, d.error);
    assert.equal((d.value as any).unit, "%");
  },
  "node-type": async (dir) => {
    const node = { id: `n${process.pid}`, name: "Release", type: "ext:x/tasks", settings: {}, links: {}, secrets: [] };
    const r = await previewScreen(dir, "tasks", { node, storeFile: join(dir, "store.json"), events: [
      { type: "open" }, { type: "press", block: "toolbar", value: { item: "add" } }, { type: "submit", block: "new", value: { values: { title: "Ship it" } } },
    ] });
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.problems, []);
    assert.match(r.text, /Ship it/);
    assert.match(r.answers.join("\n"), /submit: 2 op/);
  },
  console: async (dir) => {
    // The console is spoken to as the app does: open, and once it answers, what the user types.
    const m = JSON.parse(readFileSync(join(dir, "sshkipper-extension.json"), "utf8"));
    const p = spawn("node", [m.runtime.command[1]], { cwd: dir, stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    const send = (x: object) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...x }) + "\n");
    const until = async (re: RegExp) => { for (let i = 0; i < 500 && !re.test(stdout); i++) await new Promise((r) => setTimeout(r, 10)); };
    p.stdout.on("data", (d) => (stdout += d));
    send({ id: 1, method: "initialize", params: { sdk: 1, app: "t", module: { id: m.id, version: "1" }, locale: "en" } });
    send({ id: 2, method: "console/open", params: { console: "serial", session: "c", cols: 80, rows: 24, node: { id: "n", name: "dev" }, context: { settings: {}, locale: "en" } } });
    await until(/"id":2/);
    send({ method: "console/input", params: { session: "c", data: Buffer.from("hi\rexit\r").toString("base64") } });
    await until(/console\/closed/);
    p.stdin.end();
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));
    const shown = lines.filter((l) => l.method === "console/data").map((l) => Buffer.from(l.params.data, "base64").toString()).join("");
    assert.match(shown, /Connected to dev/);
    assert.match(shown, /you typed: hi/);
    assert.ok(lines.some((l) => l.method === "console/closed"));
  },
  database: async (dir, id) => {
    const lines = [
      { id: 1, method: "hello", params: {} },
      { id: 2, method: "connect", params: { session: "s", connection: { engine: slug(id), host: "", port: 0, tls: "disabled", timeoutSeconds: 5, path: join(dir, "samples/demo.json") } } },
      { id: 3, method: "objects", params: { session: "s", database: "main" } },
      { id: 4, method: "query", params: { session: "s", sql: "select * from hosts limit 2", maxRows: 100, queryID: "q" } },
      { id: 5, method: "tableData", params: { session: "s", queryID: "q2", request: { table: "hosts", filters: [{ column: "role", op: "equals", value: "web", enabled: true }], matchAll: true, orderBy: [{ column: "name", ascending: false }], limit: 10, offset: 0, countTotal: true } } },
      { id: 6, method: "query", params: { session: "s", sql: "delete from hosts", maxRows: 100, queryID: "q3" } },
      { id: 7, method: "nope", params: {} },
    ];
    const p = spawnSync("node", ["driver.ts"], { cwd: dir, encoding: "utf8", timeout: 10_000, input: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" });
    const by = Object.fromEntries(p.stdout.trim().split("\n").map((l) => { assert.match(l, /^\{"id":/); const j = JSON.parse(l); return [j.id, j]; }));
    assert.equal(by[1].result.engines[0].engine, slug(id));
    // A session said read-only makes the app refuse every statement of an engine without verified read commands
    // (spec/database.md §5) — the editor's SELECT too: the start must not say it (XR-S-02).
    assert.equal(by[2].result.readOnly, undefined, "connect must not declare the session read-only");
    assert.deepEqual(by[3].result.map((o: any) => o.name), ["hosts", "owners"]);
    assert.equal(by[4].result.rows.length, 2);
    assert.deepEqual(by[5].result.result.rows.map((r: any) => r[0]), ["web-2", "web-1"]);
    assert.equal(by[5].result.totalRows, 2);
    assert.equal(by[6].error.code, "query");
    assert.equal(by[7].error.code, "unsupported");
  },
};

test("new: every kind validates clean and its start works", async () => {
  for (const kind of KINDS) {
    for (const process of kind === "service" ? [false, true] : [false]) {
      const id = `dev.test.my-${kind}`;
      const dir = write(scaffold({ kind, id, title: `My ${kind}`, process }));
      try {
        const r = validateFolder(dir);
        assert.deepEqual(r.issues, [], `${kind}: ${JSON.stringify(r.issues)}`);
        assert.ok(r.files.includes("sshkipper-extension.json"), kind);
        await SMOKE[kind](dir, id);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  }
});

test("new --module: a service as the module manifest of SDK 1.0", () => {
  const files = scaffold({ kind: "service", id: "dev.test.old", title: "Old", module: true });
  assert.ok("sshkipper-module.json" in files && !("sshkipper-extension.json" in files));
});

test("CLI: sshkipper-ext new/validate/run/pack; the old name says it once and still works", () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-cli-"));
  try {
    const ext = (...a: string[]) => spawnSync("node", [cli, ...a], { encoding: "utf8", timeout: 30_000 });
    assert.equal(ext("new", join(dir, "src"), "--kind", "source", "--id", "dev.test.src").status, 0);
    assert.equal(ext("validate", join(dir, "src")).status, 0);
    const poll = ext("run", join(dir, "src"), "source/poll", "--params", JSON.stringify({ source: { node: "n", kind: "src", settings: { hosts: ["a 1.2.3.4"] } } }));
    assert.equal(poll.status, 0, poll.stderr);
    assert.equal(JSON.parse(poll.stdout).hosts[0].address, "1.2.3.4");
    const packed = ext("pack", join(dir, "src"), "-o", join(dir, "src.sshkext"));
    assert.equal(packed.status, 0, packed.stderr);
    assert.match(packed.stdout, /src\.sshkext — \d+ files/);
    const old = spawnSync("node", [join(root, "packages/cli/sshkipper-module.ts"), "validate", join(dir, "src")], { encoding: "utf8" });
    assert.equal(old.status, 0);
    assert.equal(old.stderr.trim().split("\n").length, 1);
    assert.match(old.stderr, /now sshkipper-ext/);
    assert.equal(ext("new", join(dir, "x"), "--kind", "nope").status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ops: applied as the app applies them; what can't apply is reported, the rest still applies", () => {
  const v = { events: true, blocks: [
    { type: "split", children: [{ type: "tree", id: "t", nodes: [{ id: "q", title: "q", expandable: true }] }, { type: "stack", id: "side", children: [] }] },
    { type: "datatable", id: "d", columns: ["a"], rows: [{ id: 1, cells: ["x"] }, { id: 2, cells: ["y"] }], total: 2 },
    { type: "terminal", id: "out", text: "a\n" },
    { type: "chart", id: "c", chart: "line", series: [{ values: [] }], window: 2 },
  ] };
  const r = applyOps(v as unknown as Json, [
    ops.children("t", "q", [{ id: "q1", title: "job" }]),
    ops.insert({ type: "text", id: "hint", text: "hi" }, { parent: "side" }),
    ops.updateRows("d", [{ id: 2, cells: ["z"] }]),
    ops.removeRows("d", ["1"]),
    ops.append("out", { text: "b\n" }),
    ops.append("c", { points: [[1], [2], [3]] }),
    ops.set("nope", { title: "x" }),
    ops.rows("out", 0, []),
    ops.notice("done", "ok"),
  ]);
  assert.deepEqual(r.problems.map((p) => p.index), [6, 7]);
  const t = preview(r.view);
  assert.match(t, /▸ q[\s\S]*· job/);
  assert.match(t, /hi/);
  assert.match(t, /z/);
  assert.doesNotMatch(t, /\| x/);
  assert.match(t, /notice \(ok\): done/);
  assert.deepEqual((r.view as any).blocks[3].series[0].values, [2, 3], "the window keeps the last points");
  assert.equal((r.view as any).blocks[1].total, 1);
  assert.equal(v.blocks[1].rows?.length, 2, "the view given isn't changed");
});

test("preview: the screens example lives through open and more, its pushes applied", async () => {
  const r = await previewScreen(join(root, "examples/screens"), undefined, { events: [{ type: "open" }, { type: "more", block: "jobs", value: { offset: 200, limit: 100 } }], wait: 1200 });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.problems, []);
  assert.match(r.text, /300 of 50000 rows/);
  assert.match(r.answers.join("\n"), /push: 1 op/);
});

test("every example validates and packs (npm run validate)", () => {
  const p = spawnSync("node", [join(root, "scripts/check-examples.ts")], { encoding: "utf8", timeout: 120_000 });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  for (const name of ["processes", "http-checks", "screens", "example-folder-storage", "example-hetzner-source", "db-sqlite-node", "node-type-sitechecks", "import-csv", "console-echo", "ai-echo-provider"]) {
    assert.match(p.stdout, new RegExp(`✓ ${name} `), name);
  }
});

/** Tools called on an MCP server started with or without --allow-changes: their results in order. */
async function mcp(allowChanges: boolean, calls: [string, object][]) {
  {
    const input = new PassThrough();
    const out: string[] = [];
    serveMCP(input, (s) => out.push(...s.split("\n").filter(Boolean)), { allowChanges });
    const results: any[] = [];
    for (const [i, [name, args]] of calls.entries()) {
      input.write(JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name, arguments: args } }) + "\n");
      for (let k = 0; k < 1000; k++) {
        const hit = out.find((l) => JSON.parse(l).id === i + 1);
        if (hit) { results.push(JSON.parse(hit).result); break; }
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    return results;
  }
}

test("MCP: a scaffold of every kind, methods that read run, what changes waits for --allow-changes", async () => {
  const run = mcp;
  const dir = mkdtempSync(join(tmpdir(), "sk-mcp-"));
  try {
    const store = join(dir, "storage");
    const [made, guide, ru, listed, write, screen, alias] = await run(false, [
      ["ext_scaffold", { kind: "storage", id: "dev.test.store", title: "Store", folder: store }],
      ["sdk_guide", { topic: "storage-and-sources" }],
      ["sdk_guide", { topic: "ui-kit", lang: "ru" }],
      ["ext_run_local", { folder: store, method: "storage/check", params: { storage: storage("store") } }],
      ["ext_run_local", { folder: store, method: "storage/write/begin", params: { storage: storage("store"), path: "/a", size: 1 } }],
      ["screen_preview", { folder: join(root, "examples/screens"), events: [{ type: "press", value: { item: "refresh" } }] }],
      ["module_validate", { folder: store }],
    ]);
    assert.match(made.content[0].text, /Read next: sdk_guide «storage-and-sources»/);
    assert.ok(!guide.isError && /storage/i.test(guide.content[0].text));
    assert.match(ru.content[0].text, /[а-я]/);
    assert.ok(!listed.isError, listed.content[0].text);
    assert.match(listed.content[0].text, /Works/);
    assert.equal(write.isError, true);
    assert.match(write.content[0].text, /--allow-changes/);
    assert.equal(screen.isError, true);
    assert.match(alias.content[0].text, /no issues/);
    const [allowed] = await run(true, [["ext_run_local", { folder: store, method: "storage/write/begin", params: { storage: storage("store"), path: "/a", size: 1 } }]]);
    assert.ok(!allowed.isError, allowed.content[0].text);
    assert.match(allowed.content[0].text, /upload/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MCP: safe by default — a handler runs without --allow-changes only when the manifest uses it for reading", async () => {
  // The agent writes the manifest: a handler nothing names, or one a «read» tool shares with a danger action, is a change.
  const dir = mkdtempSync(join(tmpdir(), "sk-mcp-safe-"));
  const marker = join(dir, "BOOM-marker");
  try {
    const touch = `touch ${JSON.stringify(marker)}; echo '{}'`;
    writeFileSync(join(dir, "sshkipper-extension.json"), JSON.stringify({
      sdk: 1, id: "dev.test.safe", version: "1.0.0", title: "Safe", runtime: { kind: "server" }, permissions: ["exec"],
      service: { detect: "look" },
      handlers: { look: { script: "scripts/look.sh" }, boom: { script: "scripts/boom.sh" }, both: { script: "scripts/boom.sh" } },
      tools: [{ name: "both", description: "Reads, it says.", handler: "both", risk: "read" }],
      actions: [{ id: "wipe", title: "Wipe", handler: "both", risk: "danger", confirm: "Wipe?" }],
    }));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts/look.sh"), "echo '{\"found\": true}'\n");
    writeFileSync(join(dir, "scripts/boom.sh"), touch + "\n");
    const [look, boom, both] = await mcp(false, [
      ["ext_run_local", { folder: dir, handler: "look" }],
      ["ext_run_local", { folder: dir, handler: "boom" }],
      ["ext_run_local", { folder: dir, handler: "both" }],
    ]);
    assert.ok(!look.isError, look.content[0].text);
    assert.equal(boom.isError, true);
    assert.match(boom.content[0].text, /isn't used for reading[\s\S]*--allow-changes/);
    assert.equal(both.isError, true);
    assert.match(both.content[0].text, /action «wipe» \(danger\)/);
    assert.equal(existsSync(marker), false, "refused handlers didn't run");
    const [allowed] = await mcp(true, [["ext_run_local", { folder: dir, handler: "boom" }]]);
    assert.ok(!allowed.isError, allowed.content[0].text);
    assert.equal(existsSync(marker), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("preview as the app: a sheet only for a press or OK, numbers clamped, one line for unloaded rows (round 2)", () => {
  const view = { blocks: [{ type: "sheet", id: "s", title: "S", children: [] }, { type: "datatable", id: "t", columns: ["a"], rows: [{ id: "r1", cells: ["x"] }] }] } as unknown as Json;
  const pushed = applyOps(view, [{ op: "sheet", id: "s" }], { push: true });
  assert.equal((pushed.view as any).sheet, undefined);
  assert.match(pushed.problems[0].message, /from ui\/push/);
  assert.match(applyOps(view, [{ op: "sheet", id: "s" }], { event: "open" }).problems[0].message, /answer to «open»/);
  assert.equal((applyOps(view, [{ op: "sheet", id: "s" }], { event: "press" }).view as any).sheet, "s");
  const big = applyOps(view, [{ op: "rows", id: "t", offset: -5, rows: [{ id: "r1", cells: ["y"] }], total: 1e9 }]);
  assert.equal((big.view as any).blocks[1].total, 10_000_000);
  assert.equal(big.problems.length, 2);
  const many = applyOps(view, [{ op: "update_rows", id: "t", rows: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, cells: ["z"] })) }]);
  assert.equal(many.problems.length, 1);
  assert.match(many.problems[0].message, /and 195 more/);
});

test("a title can't be the app's, look-alike letters too (round 2)", () => {
  for (const t of ["SSHKipper", "SSH Kipper", "SSНKipper", "ＳＳＨＫｉｐｐｅｒ", "ЅЅНКірреr"]) assert.equal(passesForTheApp(t), true, t);
  for (const t of ["Kipper tools", "SSH helper", "Мои серверы"]) assert.equal(passesForTheApp(t), false, t);
});
