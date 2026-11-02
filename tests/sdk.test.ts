// The SDK against itself and against what the app expects: `npm test` (node --test, Node 24+).

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { call } from "../packages/sdk/src/dev.ts";
import { serve, type Transport } from "../packages/sdk/src/module.ts";
import { preview } from "../packages/sdk/src/preview.ts";
import { scaffold, VENDORED } from "../packages/sdk/src/scaffold.ts";
import { expand } from "../packages/sdk/src/template.ts";
import type { Json, Manifest } from "../packages/sdk/src/types.ts";
import { view, rows, row, metric, grid, each, $, screen, datatable, tree, split, editor, terminal, toolbar, sheet, field, liveChart, ops } from "../packages/sdk/src/ui.ts";
import { schema, validateFolder, validateManifest, validateView } from "../packages/sdk/src/validate.ts";
import { BLOCKS, STYLE } from "../packages/sdk/src/catalog.ts";
import { serveMCP } from "../packages/mcp/server.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function write(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sk-sdk-"));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
  return dir;
}

test("templates: the conformance cases the app runs too", () => {
  const cases = JSON.parse(readFileSync(join(root, "tests/conformance/templates.json"), "utf8"));
  for (const c of cases) {
    if (c.error) assert.throws(() => expand(c.view, c.vars ?? {}, c.components ?? {}), Error, c.name);
    else assert.deepEqual(expand(c.view, c.vars ?? {}, c.components ?? {}), c.expected, c.name);
  }
});

test("validate: says what's wrong where", () => {
  const m = {
    sdk: 1, id: "dev.acme.q", version: "1.0.0", title: "Q", runtime: { kind: "server" },
    handlers: { list: { script: "scripts/list.sh", sudo: "required" } },
    pages: [{ id: "main", title: "Q", view: "views/main.json" }],
    service: { detect: "detect", page: "main" },
    actions: [{ id: "flush", title: "Flush", handler: "flush", risk: "danger" }],
    tools: [{ name: "q", description: "short", handler: "list", risk: "read" }],
  } as unknown as Manifest;
  const issues = validateManifest(m, new Set(["sshkipper-module.json"]));
  const at = (p: string) => issues.filter((i) => i.path === p).map((i) => i.message).join("; ");
  assert.match(at("handlers.list.script"), /no file/);
  assert.match(at("handlers.list.sudo"), /permissions/);
  assert.match(at("service.detect"), /no handler «detect»/);
  assert.match(at("actions[0].handler"), /no handler «flush»/);
  assert.match(at("actions[0].confirm"), /question/);
  assert.match(at("tools[0].description"), /at least 10 characters/);
  assert.match(at("pages[0].view"), /no file/);
  // The schema first: an unknown key and a wrong type stop there.
  const bad = validateManifest({ ...m, colour: "red", version: 1 } as never);
  assert.ok(bad.some((i) => i.path === "colour" && /unknown key/.test(i.message)));
  assert.ok(bad.some((i) => i.path === "version" && /must be string/.test(i.message)));
  // python -I/-E ignores PYTHONPYCACHEPREFIX: warned, as in the app; -B is fine.
  const py = (command: string[]) => validateManifest({ sdk: 1, id: "dev.a.p", version: "1.0.0", title: "P", runtime: { kind: "process", command } } as never)
    .filter((i) => i.path === "runtime.command" && i.severity === "warning");
  assert.equal(py(["python3", "-I", "main.py"]).length, 1);
  assert.equal(py(["python3", "-I", "-B", "main.py"]).length, 0);
  assert.equal(py(["/usr/bin/env", "python3", "-Is", "main.py"]).length, 1);
  assert.equal(py(["python3", "-IB", "main.py"]).length, 0);
  assert.equal(py(["python3", "main.py", "-I"]).length, 0);
  // A value both the schema and the app's checks refuse: one error, the app's words.
  const slow = validateManifest({ ...m, handlers: { list: { script: "scripts/list.sh", timeout: -1e19 } } } as never);
  assert.deepEqual(slow.filter((i) => i.path === "handlers.list.timeout").map((i) => i.message), ["timeout is seconds from 1 to 3600"]);
});

test("validate: views take templates in place of values", () => {
  const v = { blocks: [{ type: "rows", items: [{ each: "data.p", as: "p", block: { title: "{{ p.name }}", status: "{{ p.status }}", data: "{{ p }}" } }] }],
    status: [{ if: "data.bad", block: { text: "Bad", tone: "bad" } }] };
  assert.deepEqual(validateView(v), []);
  const wrong = validateView({ blocks: [{ type: "metric", title: "x", value: 1, colour: "red" }, { type: "rows", items: [{ title: "a", status: "weird", symbol: "no.such.symbol" }] }] } as Json);
  assert.ok(wrong.some((i) => i.path === "blocks[0].colour"));
  assert.ok(wrong.some((i) => i.path === "blocks[1].items[0].status"));
});

test("ui builders make views the schema takes", () => {
  const v = view([grid([metric("Load", 0.4, { status: "ok", series: [1, 2] })], 2), rows([row("nginx", { status: "ok", actions: ["restart"], action: { page: "unit" } }), each("data.units", row($("u.name")), { as: "u" }) as never])],
    { title: "Units", status: ["3 of 4 work.", { text: " nginx is down", tone: "bad" }] });
  assert.deepEqual(validateView(v as unknown as Json), []);
  const text = preview(v as unknown as Json, { data: { units: [{ name: "cron" }] } });
  assert.match(text, /# Units/);
  assert.match(text, /● nginx {2}⋯ restart {2}→ page unit/);
  assert.match(text, /cron/);
});

test("scaffold: the kinds of SDK 1.0 (server, process) still make a service", () => {
  // What a service makes is checked by ext.test.ts («new: every kind…»); here only that the old names lead there.
  assert.deepEqual(scaffold({ kind: "server", id: "dev.test.d", title: "D" }), scaffold({ kind: "service", id: "dev.test.d", title: "D" }));
  assert.deepEqual(scaffold({ kind: "process", id: "dev.test.d", title: "D" }), scaffold({ kind: "service", process: true, id: "dev.test.d", title: "D" }));
});

test("extensions: sshkipper-extension.json with contributions, checked as the app checks them (protocol §10)", () => {
  const manifest = {
    sdk: 1, id: "dev.test.multi", version: "1.0.0", title: "Multi",
    runtime: { kind: "process", command: ["node", "main.ts"] }, permissions: ["exec", "secrets", "oauth", "forward"],
    handlers: { status: {}, board: {}, rtsx: {} },
    pages: [{ id: "main", title: "Main", render: "status" }],
    contributes: {
      service: { page: "main" },
      database: [{ id: "duckdb", title: "DuckDB", model: "sql", isFile: true }],
      storage: [{ id: "box", title: "Box", signIn: "browser", fields: [{ key: "token", title: "Token", type: "secret" }] }],
      source: [{ id: "hetzner", title: "Hetzner Cloud", refresh: 300 }],
      nodeType: [{ id: "board", title: "Board", screen: "board" }],
      screen: [{ id: "board", title: "Board", placement: "tab", render: "board" }],
      import: [{ id: "royal", title: "Royal TSX", fileExtensions: ["rtsx"], handler: "rtsx" }],
    },
  };
  const dir = write({ "sshkipper-extension.json": JSON.stringify(manifest), "main.ts": "" });
  try {
    const r = validateFolder(dir);
    assert.deepEqual(r.issues.filter((i) => i.severity === "error"), []);
    assert.equal(r.manifest?.contributes?.database?.[0].id, "duckdb");
    // Both manifests: which one is meant?
    writeFileSync(join(dir, "sshkipper-module.json"), JSON.stringify(manifest));
    assert.match(validateFolder(dir).issues.map((i) => i.message).join("\n"), /keep one/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const errors = (contributes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    validateManifest({ ...manifest, ...extra, contributes } as unknown as Manifest).filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`).join("\n");
  assert.match(errors({ widgets: [{ id: "w", title: "W" }] }), /contributes\.widgets: unknown kind of contribution «widgets»/);
  assert.match(errors({ database: [{ id: "mysql", title: "M", model: "sql" }] }), /built into SSHKipper/);
  assert.match(errors({ storage: [{ id: "box", title: "Box", signIn: "browser" }] }, { permissions: ["exec"] }), /oauth/);
  assert.match(errors({ nodeType: [{ id: "n", title: "N", screen: "nope" }] }), /no screen «nope»/);
  assert.match(errors({ storage: [{ id: "ftp", title: "FTP" }] }, { runtime: { kind: "server" } }), /process/);
  assert.match(errors({ service: { page: "main" } }, { service: { page: "main" } }), /both in contributes and at the top level/);
});

test("server calls: request on stdin, variables, sk_file, secrets, failures", async () => {
  const dir = write({
    "sshkipper-module.json": JSON.stringify({ sdk: 1, id: "dev.test.echo", version: "1.0.0", title: "E", runtime: { kind: "server" }, permissions: ["secrets"],
      settings: [{ key: "token", title: "T", type: "secret" }],
      handlers: { echo: { script: "scripts/echo.sh" }, fail: { script: "scripts/fail.sh" }, text: { script: "scripts/text.sh", output: "lines" } },
      tools: [{ name: "echo", description: "Echoes what it was given.", handler: "echo", risk: "read", params: [{ key: "name", title: "Name", type: "text" }] }] }),
    "scripts/echo.sh": `r=$(cat); printf '{"in": %s, "unit": %s, "lib": %s, "secret": %s, "request": %s}' "$(sk_json_string "$SK_INPUT_NAME")" "$(sk_json_string "$SK_SETTING_UNIT")" "$(sk_json_string "$(sk_file scripts/lib.txt)")" "$(sk_json_string "$(sk_secret token)")" "$r"`,
    "scripts/lib.txt": "shared",
    "scripts/fail.sh": "echo working; sk_fail 'the queue is gone'",
    "scripts/text.sh": "printf 'a\\nb\\n'",
  });
  try {
    const r = await call(dir, "echo", { input: { name: "it's \"x\"" }, settings: { unit: "nginx" }, secrets: { token: "s3cr3t" } });
    assert.ok(r.ok, r.error);
    const v = r.value as Record<string, any>;
    assert.equal(v.in, "it's \"x\"");
    assert.equal(v.unit, "nginx");
    assert.equal(v.lib, "shared");
    assert.equal(v.secret, "s3cr3t");
    assert.equal(v.request.handler, "echo");
    assert.equal(v.request.context.settings.token, undefined);
    const f = await call(dir, "fail");
    assert.equal(f.ok, false);
    assert.equal(f.error, "the queue is gone");
    assert.deepEqual((await call(dir, "text")).value, ["a", "b"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("process runtime: handlers, host requests, errors, cancel", async () => {
  const toModule = new PassThrough(), fromModule: string[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => fromModule.push(l), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  serve({
    handlers: {
      hello: async (input, ctx) => ({ hi: input.name, stored: await ctx.host.store.get("k") }),
      boom: () => { throw new Error("no such queue"); },
    },
  }, transport);
  void toModule;
  const next = async () => { for (let i = 0; i < 50 && !fromModule.length; i++) await new Promise((r) => setTimeout(r, 5)); return JSON.parse(fromModule.shift()!); };
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } }));
  assert.deepEqual((await next()).result.handlers, ["hello", "boom"]);
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "handler/call", params: { handler: "hello", input: { name: "web" }, context: { settings: {}, locale: "en", sdk: 1, app: "t" } } }));
  const ask = await next();
  assert.equal(ask.method, "host/store/get");
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: ask.id, result: { value: 7 } }));
  assert.deepEqual((await next()).result, { hi: "web", stored: 7 });
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "handler/call", params: { handler: "boom", input: {}, context: { settings: {}, locale: "en", sdk: 1, app: "t" } } }));
  assert.deepEqual((await next()).error, { code: -32000, message: "no such queue" });
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "handler/call", params: { handler: "nope", input: {}, context: { settings: {}, locale: "en", sdk: 1, app: "t" } } }));
  assert.equal((await next()).error.code, -32601);
});

test("process runtime: a call sent during setup waits for it", async () => {
  const fromModule: string[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => fromModule.push(l), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  let conn = "";
  serve({
    setup: async () => { await new Promise((r) => setTimeout(r, 40)); conn = "open"; },
    handlers: { state: () => ({ conn }) },
  }, transport);
  const next = async () => { for (let i = 0; i < 100 && !fromModule.length; i++) await new Promise((r) => setTimeout(r, 5)); return JSON.parse(fromModule.shift()!); };
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } }));
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "handler/call", params: { handler: "state", input: {}, context: { settings: {}, locale: "en", sdk: 1, app: "t" } } }));
  const a = await next(), b = await next();
  assert.deepEqual([a, b].find((m) => m.id === 2).result, { conn: "open" });
});

test("examples carry the current SDK runtime (sshkipper-ext vendor)", () => {
  // Every example with a copy of the runtime — or of the database protocol — has exactly what `vendor` copies now.
  const stale: string[] = [];
  let copies = 0;
  for (const ex of readdirSync(join(root, "examples"))) {
    const dir = join(root, "examples", ex);
    const own = [
      ...(existsSync(join(dir, "lib/sshkipper-sdk")) ? VENDORED.map((f) => [`lib/sshkipper-sdk/${f}`, f]) : []),
      ...(existsSync(join(dir, "lib/database.ts")) ? [["lib/database.ts", "database.ts"]] : []),
    ];
    for (const [copy, src] of own) {
      copies++;
      const at = join(dir, copy);
      if (!existsSync(at) || readFileSync(at, "utf8") !== readFileSync(join(root, "packages/sdk/src", src), "utf8")) stale.push(`examples/${ex}/${copy}`);
    }
  }
  assert.ok(copies >= 9, `only ${copies} vendored files found`);
  assert.deepEqual(stale, [], "stale copies: run sshkipper-ext vendor examples/<name> for each");
});

test("MCP: handshake, tools, validation through the server", async () => {
  const input = new PassThrough();
  const out: string[] = [];
  serveMCP(input, (s) => out.push(...s.split("\n").filter(Boolean)));
  const ask = async (id: number, method: string, params: object = {}) => {
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    for (let i = 0; i < 200; i++) {
      const hit = out.find((l) => JSON.parse(l).id === id);
      if (hit) return JSON.parse(hit);
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no answer to ${method}`);
  };
  const init = await ask(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "sshkipper-sdk");
  const tools = (await ask(2, "tools/list")).result.tools.map((t: { name: string }) => t.name);
  for (const n of ["sdk_guide", "sdk_schema", "ui_kit", "ext_scaffold", "ext_validate", "view_preview", "screen_preview", "template_expand", "ext_run_local"]) assert.ok(tools.includes(n), n);
  const kit = (await ask(3, "tools/call", { name: "ui_kit", arguments: {} })).result.content[0].text;
  assert.match(kit, /### rows/);
  assert.match(kit, /internaldrive/);
  const v = (await ask(4, "tools/call", { name: "module_validate", arguments: { folder: join(root, "examples/http-checks") } })).result;
  assert.match(v.content[0].text, /no issues/);
  const p = (await ask(5, "tools/call", { name: "view_preview", arguments: { view: { blocks: [{ type: "metric", title: "Up", value: "{{ data.n }}" }] }, data: { n: 3 } } })).result;
  assert.match(p.content[0].text, /\[metric\] Up: 3/);
  const g = (await ask(6, "tools/call", { name: "sdk_guide", arguments: { topic: "overview" } })).result;
  assert.ok(!g.isError, g.content[0].text);
  assert.equal((await ask(7, "nope")).error.code, -32601);
});

test("MCP: handlers that change things don't run locally unless the person started the server with --allow-changes", async () => {
  const input = new PassThrough();
  const out: string[] = [];
  serveMCP(input, (s) => out.push(...s.split("\n").filter(Boolean)));
  // The agent setting a parameter itself is no consent: refused all the same.
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "module_run_local", arguments: { folder: join(root, "examples/processes"), handler: "signal_kill", item: { id: "1" }, allow_changes: true } } }) + "\n");
  for (let i = 0; i < 200 && !out.length; i++) await new Promise((r) => setTimeout(r, 10));
  const r = JSON.parse(out[0]).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /--allow-changes/);
});

test("live screens: the builders make what the schema allows; the preview reads them", () => {
  const v = screen([
    toolbar([{ id: "r", title: "Refresh", symbol: "arrow.clockwise" }, { id: "x", title: "Delete", danger: true }]),
    split([
      tree([{ id: "q", title: "default", expandable: true }], { id: "queues", menu: [{ id: "pause", title: "Pause" }] }),
      datatable([{ id: "id", kind: "number" }, "name"], [[1, "a"], { id: "j2", values: { id: 2, name: "b" }, status: "bad" }], { id: "jobs", total: 10_000, drop: ["files"] }),
    ], { sizes: [240] }),
    editor("select 1", { id: "q1", language: "sql", completion: true }),
    terminal("\u001b[32mok\u001b[0m\n", { id: "out" }),
    liveChart("line", [{ values: [1, 2] }], { id: "rate", window: 60 }),
    sheet("new", "New", [field("name", "Name")], { ok: "Add" }),
  ], { title: "Queues", fill: true });
  assert.deepEqual(validateView(v).filter((i) => i.severity === "error"), []);
  assert.equal(v.events, true);
  assert.equal(v.layout, "fill");
  // A block the schema doesn't know is still an error; a grid's count of columns still a number.
  assert.ok(validateView({ blocks: [{ type: "datatable", id: "t", columns: [{ id: "a", nope: 1 }] }] }).some((i) => i.severity === "error"));
  assert.ok(validateView({ blocks: [{ type: "grid", columns: 9, children: [] }] }).some((i) => i.severity === "error"));
  const text = preview(v);
  assert.match(text, /live screen: events → the program/);
  assert.match(text, /\[datatable #jobs\]: id \| name — 2 of 10000 rows/);
  assert.match(text, /▸ default \(asks\)/);
  assert.match(text, /\[terminal #out\]\n {2}ok/);
  assert.match(text, /\[sheet #new\] New — OK: Add/);
});

test("live screens: ui/event answered by onEvent; push goes to the screen", async () => {
  const fromModule: string[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => fromModule.push(l), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  let pushLater: ((o: any[]) => void) | undefined;
  serve({
    handlers: {},
    onEvent: (e, ctx) => {
      if (e.type === "open") { pushLater = ctx.push; return null; }
      if (e.type === "more") return [ops.rows("jobs", (e.value as any).offset, [[1, "a"]])];
      if (e.type === "complete") return { items: ["status"] };
      throw new Error("no such event");
    },
  }, transport);
  const next = async () => { for (let i = 0; i < 100 && !fromModule.length; i++) await new Promise((r) => setTimeout(r, 5)); return JSON.parse(fromModule.shift()!); };
  const context = { settings: {}, locale: "en", sdk: 1, app: "t" };
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } }));
  await next();
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ui/event", params: { event: { screen: "s1", seq: 1, type: "open" }, context } }));
  assert.equal((await next()).result, null);
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ui/event", params: { event: { screen: "s1", seq: 2, type: "more", block: "jobs", value: { offset: 200, limit: 200 } }, context } }));
  assert.deepEqual((await next()).result, [{ op: "rows", id: "jobs", offset: 200, rows: [[1, "a"]] }]);
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ui/event", params: { event: { screen: "s1", seq: 3, type: "complete", block: "q" }, context } }));
  assert.deepEqual((await next()).result, { items: ["status"] });
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ui/event", params: { event: { screen: "s1", seq: 4, type: "drop" }, context } }));
  assert.deepEqual((await next()).error, { code: -32000, message: "no such event" });
  // Later, by itself: a notification for that screen.
  pushLater!([ops.append("rate", { points: [[5]] })]);
  assert.deepEqual(await next(), { jsonrpc: "2.0", method: "ui/push", params: { screen: "s1", ops: [{ op: "append", id: "rate", points: [[5]] }] } });
});

test("node types: a link field only in a node type, with kinds the app knows", () => {
  const base = { sdk: 1, id: "dev.a.n", version: "1.0.0", title: "N", runtime: { kind: "process", command: ["node", "m.ts"] }, permissions: ["secrets"], handlers: { render: {} } };
  const screen = [{ id: "s", title: "S", placement: "tab", render: "render" }];
  const errs = (m: object) => validateManifest(m as never).filter((i) => i.severity === "error").map((i) => i.path);
  assert.deepEqual(errs({ ...base, contributes: { nodeType: [{ id: "n", title: "N", screen: "s", fields: [{ key: "s", title: "S", type: "node", nodeKinds: ["connection", "ext:n"] }] }], screen } }), []);
  assert.deepEqual(errs({ ...base, settings: [{ key: "s", title: "S", type: "node" }] }), ["settings[0].type"]);
  assert.deepEqual(errs({ ...base, contributes: { nodeType: [{ id: "n", title: "N", screen: "s", fields: [{ key: "s", title: "S", type: "node", nodeKinds: ["credential"] }] }], screen } }),
    ["contributes.nodeType[0].fields[0].nodeKinds[0]", "contributes.nodeType[0].fields[0].nodeKinds"]);
});

test("node types: host.nodeSecret, host.open, host.ask send what the app reads", async () => {
  const fromModule: string[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => fromModule.push(l), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  const got: unknown[] = [];
  serve({
    handlers: {},
    onEvent: async (e, ctx) => {
      got.push(await ctx.host.nodeSecret("token"));
      got.push(await ctx.host.open({ terminal: { server: "S1", command: "uptime" } }));
      got.push(await ctx.host.ask({ title: "Q?", buttons: ["Да", "Нет"], risk: "danger" }));
      return null;
    },
  }, transport);
  const next = async () => { for (let i = 0; i < 100 && !fromModule.length; i++) await new Promise((r) => setTimeout(r, 5)); return JSON.parse(fromModule.shift()!); };
  const context = { settings: {}, locale: "en", sdk: 1, app: "t", node: { id: "N1", name: "Сайты", type: "ext:dev.a/n", settings: {}, links: {}, secrets: ["token"] } };
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } }));
  await next();
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ui/event", params: { event: { screen: "s1", seq: 1, type: "press" }, context } }));
  const a = await next();
  assert.deepEqual([a.method, a.params], ["host/secret", { node: "N1", key: "token" }]);
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: a.id, result: { value: "t0k" } }));
  const b = await next();
  assert.deepEqual([b.method, b.params], ["host/open", { terminal: { server: "S1", command: "uptime" } }]);
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { opened: false } }));
  const c = await next();
  assert.deepEqual([c.method, c.params], ["host/ask", { title: "Q?", buttons: ["Да", "Нет"], risk: "danger" }]);
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: c.id, result: { button: 1 } }));
  assert.equal((await next()).result, null);
  assert.deepEqual(got, ["t0k", false, 1]);
});


// MARK: Import and consoles (spec/protocol.md §15, §16)

/** A module served over an in-memory transport: send lines, take what it wrote. */
function harness(def: Parameters<typeof serve>[0]) {
  const fromModule: string[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => fromModule.push(l), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  serve(def, transport);
  const send = (m: Record<string, unknown>) => lineCb(JSON.stringify({ jsonrpc: "2.0", ...m }));
  const next = async () => { for (let i = 0; i < 200 && !fromModule.length; i++) await new Promise((r) => setTimeout(r, 5)); return JSON.parse(fromModule.shift()!); };
  const drain = async (ms = 60) => { await new Promise((r) => setTimeout(r, ms)); return fromModule.splice(0).map((l) => JSON.parse(l)); };
  return { send, next, drain };
}

test("import: import/parse gives the file's bytes to the importer; the example reads a table", async () => {
  const { parseTable } = await import("../examples/import-csv/csv.ts");
  const h = harness({ handlers: {}, importers: { csv: (file) => parseTable(file.text(), { ru: true }) } });
  h.send({ id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "ru", module: { id: "x", version: "1" } } });
  await h.next();
  const csv = readFileSync(join(root, "examples/import-csv/samples/servers.csv"));
  h.send({ id: 2, method: "import/parse", params: { importer: "csv", name: "servers.csv", size: csv.length, data: csv.toString("base64"), locale: "ru" } });
  const r = (await h.next()).result;
  const names = (n: any[]): string[] => n.flatMap((x) => (x.type === "folder" ? [`${x.name}/`, ...names(x.children ?? [])] : [x.name]));
  assert.deepEqual(names(r.nodes), ["Инфраструктура/", "jump", "Production/", "Web/", "web-1", "web-2", "DB/", "db-1", "Staging/", "stage"]);
  const db = r.nodes[1].children[1].children[0];
  assert.deepEqual([db.host, db.port, db.user, db.bastion, db.tags], ["10.0.2.21", 5022, "postgres", "jump", ["prod", "db"]]);
  assert.match(db.note, /Основная база\nреплика/);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Строка 8: нет адреса/);
  // Another importer: «method not found» in its words.
  h.send({ id: 3, method: "import/parse", params: { importer: "nope", name: "a", data: "" } });
  assert.equal((await h.next()).error.code, -32601);
});

test("import: a password in the table comes apart, as a secret of its own credential", async () => {
  const { parseTable } = await import("../examples/import-csv/csv.ts");
  const r = parseTable("name;host;user;password\nweb;10.0.0.5;deploy;s3cr3t\nbad port;10.0.0.6;;\n");
  assert.deepEqual(r.credentials, [{ id: "cred-2", name: "deploy @ web", user: "deploy" }]);
  assert.deepEqual(r.secrets, [{ credential: "cred-2", kind: "password", value: "s3cr3t" }]);
  assert.equal((r.nodes[0] as any).credential, "cred-2");
  assert.ok(!JSON.stringify(r.nodes).includes("s3cr3t"));
  // No header: the fixed order «name,host,port,user,folder».
  const plain = parseTable("a,1.2.3.4,2200,root,X\n");
  assert.deepEqual((plain.nodes[0] as any).children[0], { type: "connection", id: "row-1", name: "a", host: "1.2.3.4", port: 2200, user: "root" });
});

test("console: open, data both ways, resize, close from either side", async () => {
  let seen: any;
  const typed: string[] = [];
  const sizes: string[] = [];
  let closed = 0;
  const h = harness({
    handlers: {},
    consoles: {
      echo: (s) => {
        seen = s;
        s.onInput((d) => { typed.push(new TextDecoder().decode(d)); s.write(d); });
        s.onResize((c, r) => sizes.push(`${c}x${r}`));
        s.onClose(() => { closed++; });
        s.write("hello\r\n");
      },
    },
  });
  h.send({ id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } });
  await h.next();
  h.send({ id: 2, method: "console/open", params: { console: "echo", session: "s1", cols: 100, rows: 30, node: { id: "n", name: "target" }, context: { settings: {}, locale: "en", sdk: 1, app: "t" } } });
  const [data, opened] = await h.drain();
  assert.deepEqual(data, { jsonrpc: "2.0", method: "console/data", params: { session: "s1", data: Buffer.from("hello\r\n").toString("base64") } });
  assert.deepEqual(opened, { jsonrpc: "2.0", id: 2, result: {} });
  assert.equal(seen.node.name, "target");
  assert.equal(`${seen.cols}x${seen.rows}`, "100x30");
  h.send({ method: "console/input", params: { session: "s1", data: Buffer.from("ls\r").toString("base64") } });
  h.send({ method: "console/resize", params: { session: "s1", cols: 80, rows: 24 } });
  const echoed = await h.drain();
  assert.deepEqual(typed, ["ls\r"]);
  assert.equal(Buffer.from(echoed[0].params.data, "base64").toString(), "ls\r");
  assert.deepEqual(sizes, ["80x24"]);
  assert.equal(`${seen.cols}x${seen.rows}`, "80x24");
  // A big write goes in chunks the app takes.
  seen.write("x".repeat(100_000));
  const chunks = await h.drain();
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c: any) => Buffer.from(c.params.data, "base64").length <= 48 * 1024));
  // The tab closed: the console's onClose runs, its writes go nowhere.
  h.send({ method: "console/close", params: { session: "s1" } });
  await h.drain();
  assert.equal(closed, 1);
  assert.ok(seen.signal.aborted);
  seen.write("late");
  assert.deepEqual(await h.drain(), []);
  // The program closes another one: `console/closed` with the reason.
  h.send({ id: 3, method: "console/open", params: { console: "echo", session: "s2", cols: 80, rows: 24, node: { id: "n" } } });
  await h.drain();
  seen.close("bye");
  assert.deepEqual((await h.drain())[0], { jsonrpc: "2.0", method: "console/closed", params: { session: "s2", reason: "bye" } });
  assert.equal(closed, 2);
});

test("console example: a pretend device echoes, edits its line, answers commands and leaves on Ctrl-D", async () => {
  const { Device } = await import("../examples/console-echo/device.ts");
  let out = "";
  let closedWith: string | undefined;
  const d = new Device({ write: (t: string) => { out += t; }, close: (r?: string) => { closedWith = r; }, size: () => ({ cols: 90, rows: 20 }) }, "box", false);
  d.boot(true);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(out, /Welcome to box/);
  out = "";
  d.input(new TextEncoder().encode("sizz\u007fe\r"));
  assert.match(out, /sizz\x08 \x08e\r\n90x20\r\n/);
  out = "";
  d.input(new TextEncoder().encode("\u001b[Auname\r"));
  assert.match(out, /PretendOS 1\.0 box/);
  d.input(new TextEncoder().encode("\u0004"));
  assert.equal(closedWith, "Ctrl-D");
  d.stop();
});

test("UI-Kit catalog: every tone, status, color and example it teaches passes the view schema", () => {
  const defs = (schema("view") as any).$defs;
  assert.deepEqual([...STYLE.tones].sort(), [...defs.tone.enum].sort(), "tones: the catalog and view.schema.json $defs.tone");
  assert.deepEqual([...STYLE.statuses].sort(), [...defs.status.enum].sort(), "statuses");
  const color = new RegExp(defs.color.pattern);
  for (const c of STYLE.colors.filter((c) => !c.startsWith("#"))) assert.match(c, color, `color ${c}`);
  for (const tone of STYLE.tones) {
    const v = { blocks: [{ type: "text", text: "x", style: { tone } }], status: [{ text: "x", tone }] };
    assert.deepEqual(validateView(v as Json).filter((i) => i.severity === "error"), [], `tone ${tone}`);
  }
  for (const b of BLOCKS) {
    assert.deepEqual(validateView({ blocks: [b.example as Json] }).filter((i) => i.severity === "error"), [], `the example of ${b.type}`);
  }
});
