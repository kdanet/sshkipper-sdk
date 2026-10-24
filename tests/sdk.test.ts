// The SDK against itself and against what the app expects: `npm test` (node --test, Node 24+).

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { call } from "../packages/sdk/src/dev.ts";
import { serve, type Transport } from "../packages/sdk/src/module.ts";
import { preview } from "../packages/sdk/src/preview.ts";
import { scaffold } from "../packages/sdk/src/scaffold.ts";
import { expand } from "../packages/sdk/src/template.ts";
import type { Json, Manifest } from "../packages/sdk/src/types.ts";
import { view, rows, row, metric, grid, each, $ } from "../packages/sdk/src/ui.ts";
import { validateFolder, validateManifest, validateView } from "../packages/sdk/src/validate.ts";
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
    if (c.error) assert.throws(() => expand(c.view, c.vars ?? {}, c.components ?? {}), undefined, c.name);
    else assert.deepEqual(expand(c.view, c.vars ?? {}, c.components ?? {}), c.expected, c.name);
  }
});

test("validate: the examples are clean", () => {
  for (const ex of ["processes", "http-checks"]) {
    const r = validateFolder(join(root, "examples", ex));
    assert.deepEqual(r.issues.filter((i) => i.severity === "error"), [], ex);
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
});

test("validate: views take templates in place of values", () => {
  const v = { blocks: [{ type: "rows", items: [{ each: "data.p", as: "p", block: { title: "{{ p.name }}", status: "{{ p.status }}", data: "{{ p }}" } }] }],
    status: [{ if: "data.bad", block: { text: "Bad", tone: "bad" } }] };
  assert.deepEqual(validateView(v as Json), []);
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

test("scaffolds validate and their handlers run", async () => {
  for (const kind of ["server", "process"] as const) {
    const dir = write(scaffold({ kind, id: `dev.test.${kind}`, title: "Disks" }));
    try {
      const r = validateFolder(dir);
      assert.deepEqual(r.issues.filter((i) => i.severity === "error"), [], kind);
      const s = await call(dir, "summary", { settings: { warn_pct: 85 } });
      assert.ok(s.ok, `${kind}: ${s.error}`);
      assert.match(String((s.value as Record<string, Json>).text), /%/);
      assert.ok(["ok", "warn", "bad"].includes(String((s.value as Record<string, Json>).status)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("server calls: request on stdin, variables, sk_file, secrets, failures", async () => {
  const dir = write({
    "sshkipper-module.json": JSON.stringify({ sdk: 1, id: "dev.test.echo", version: "1.0.0", title: "E", runtime: { kind: "server" }, permissions: ["secrets"],
      settings: [{ key: "token", title: "T", type: "secret" }],
      handlers: { echo: { script: "scripts/echo.sh" }, fail: { script: "scripts/fail.sh" }, text: { script: "scripts/text.sh", output: "lines" } } }),
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
  for (const n of ["sdk_guide", "sdk_schema", "ui_kit", "module_scaffold", "module_validate", "view_preview", "template_expand", "module_run_local"]) assert.ok(tools.includes(n), n);
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

test("MCP: handlers that change things don't run locally without allow_changes", async () => {
  const input = new PassThrough();
  const out: string[] = [];
  serveMCP(input, (s) => out.push(...s.split("\n").filter(Boolean)));
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "module_run_local", arguments: { folder: join(root, "examples/processes"), handler: "signal_kill", item: { id: "1" } } } }) + "\n");
  for (let i = 0; i < 200 && !out.length; i++) await new Promise((r) => setTimeout(r, 10));
  const r = JSON.parse(out[0]).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /allow_changes/);
});
