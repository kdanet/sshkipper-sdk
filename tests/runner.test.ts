// The local runner (`run`, `preview`, MCP's ext_run_local) refuses what the app refuses, so what works here works in
// the app: input checked against params, host.* only for the servers and nodes of the call, the store's limits; and
// the TypeScript runtime sends host.exec the way the Swift one does.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { call, callMethod } from "../packages/sdk/src/dev.ts";
import { serve, type Transport } from "../packages/sdk/src/module.ts";
import { scaffold } from "../packages/sdk/src/scaffold.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const sdk = JSON.stringify(join(root, "packages/sdk/src/index.ts"));

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sk-runner-"));
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), t); }
  return dir;
}

test("host.exec: the service's container only when named — as in Swift — and stdin stays possible on the host", async () => {
  const sent: any[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => sent.push(JSON.parse(l)), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  serve({
    handlers: {
      host: async (_i, ctx) => (await ctx.host.exec("psql -f -", { stdin: "select 1;" })).stdout,
      inside: async (_i, ctx) => (await ctx.host.exec("ls", { container: ctx.container })).stdout,
    },
  }, transport);
  const next = async () => { for (let i = 0; i < 100 && !sent.length; i++) await new Promise((r) => setTimeout(r, 5)); return sent.shift(); };
  const context = { server: { id: "s1", name: "web" }, container: "app-1", settings: {}, locale: "en", sdk: 1, app: "t" };
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } }));
  await next();
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "handler/call", params: { handler: "host", input: {}, context } }));
  const a = await next();
  assert.equal(a.method, "host/exec");
  assert.equal(a.params.container, undefined, "not filled from ctx.container");
  assert.equal(a.params.stdin, "select 1;");
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: a.id, result: { exitCode: 0, stdout: "1", stderr: "" } }));
  await next();
  lineCb(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "handler/call", params: { handler: "inside", input: {}, context } }));
  const b = await next();
  assert.equal(b.params.container, "app-1");
});

test("runner: input is checked against the params as the app checks it — pattern in full, required, types; the rest dropped", async () => {
  const dir = folder(scaffold({ kind: "service", id: "dev.test.disks", title: "Disks" }));
  try {
    const bad = await call(dir, "usage", { input: { mount: "; rm -rf /" } });
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /doesn't match the extension's pattern/);
    const multi = await call(dir, "usage", { input: { mount: "/\n; reboot" } });
    assert.equal(multi.ok, false, "the whole value, not a line of it");
    const extra = await call(dir, "usage", { input: { mount: "/", sneaky: "x" } });
    assert.ok(extra.ok, extra.error);
    assert.match(extra.log.join("\n"), /input sneaky: no param/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const auto = folder(scaffold({ kind: "automation", id: "dev.test.blocks", title: "Blocks" }));
  try {
    const missing = await call(auto, "threshold", { input: {} });
    assert.equal(missing.ok, false);
    assert.match(missing.error!, /«Value \(value\)» isn't given/);
    const number = await call(auto, "threshold", { input: { value: "7", min: "20" } });
    assert.ok(number.ok, number.error);
    assert.equal((number.value as any).value, 7, "«7» made a number, as the app makes it");
    const ru = await call(auto, "threshold", { input: { value: 7 }, locale: "ru" });
    assert.match((ru.value as any).summary, /ниже 20/, "the summary in the user's language");
  } finally { rmSync(auto, { recursive: true, force: true }); }
});

test("runner: host.* answer only for the call's servers and nodes; the store keeps the app's limits", async () => {
  const dir = folder({
    "sshkipper-extension.json": JSON.stringify({
      sdk: 1, id: "dev.test.host", version: "1.0.0", title: "Host", runtime: { kind: "process", command: ["node", "main.ts"] },
      permissions: ["exec", "secrets", "store"],
      settings: [{ key: "token", title: "Token", type: "secret" }, { key: "plain", title: "Plain", type: "text" }],
      handlers: { probe: {} },
      tools: [{ name: "probe", description: "Probes the host API.", handler: "probe", risk: "read", params: [{ key: "what", title: "What", type: "text", pattern: "[a-z-]+" }] }],
      contributes: {
        storage: [{ id: "box", title: "Box", capabilities: [] }],
        nodeType: [{ id: "site", title: "Site", fields: [{ key: "key", title: "Key", type: "secret" }] }],
      },
    }),
    "main.ts": `import { defineModule, storageMethods } from ${sdk};
const tryIt = async (f: () => Promise<unknown>) => { try { return { ok: await f() }; } catch (e) { return { error: (e as Error).message }; } };
defineModule({
  handlers: {
    probe: async (input, ctx) => {
      switch (input.what) {
        case "exec": return tryIt(async () => (await ctx.host.exec("echo hi")).stdout.trim());
        case "other-server": return tryIt(() => ctx.host.exec("echo hi", { server: "elsewhere" }));
        case "stdin-container": return tryIt(() => ctx.host.exec("cat", { stdin: "x", container: "app-1" }));
        case "secret": return tryIt(() => ctx.host.secret("token"));
        case "plain-secret": return tryIt(() => ctx.host.secret("plain"));
        case "node-secret": return tryIt(() => ctx.host.nodeSecret("key"));
        case "foreign-node": return tryIt(() => ctx.host.nodeSecret("key", "someone-else"));
        case "big-store": return tryIt(() => ctx.host.store.set("k", "x".repeat(1100000)));
        case "long-key": return tryIt(() => ctx.host.store.set("k".repeat(201), 1));
      }
      return null;
    },
  },
  methods: storageMethods({
    list: async (_p, _s, ctx) => { await ctx.host.exec("echo hi"); return []; },
    stat: () => null,
    read: async () => ({ data: new Uint8Array(), eof: true }),
    write: { begin: () => "u", chunk: () => {}, commit: () => {}, abort: () => {} },
  }),
});
`,
  });
  try {
    const probe = async (what: string, o: Parameters<typeof call>[2] = {}) => {
      const r = await call(dir, "probe", { ...o, input: { what } });
      assert.ok(r.ok, `${what}: ${r.error}`);
      return r.value as { ok?: unknown; error?: string };
    };
    assert.deepEqual(await probe("exec"), { ok: "hi" }, "the call's own server: this machine here");
    assert.match((await probe("other-server")).error!, /isn't a server of a call in progress/);
    assert.match((await probe("stdin-container")).error!, /stdin doesn't go into a container/);
    assert.deepEqual(await probe("secret", { secrets: { token: "t0k" } }), { ok: "t0k" });
    assert.match((await probe("plain-secret", { secrets: { plain: "x" } })).error!, /no secret setting «plain»/);
    const node = { id: "n1", name: "Site", type: "ext:dev.test.host/site", settings: {}, links: {}, secrets: ["key"] };
    assert.deepEqual(await probe("node-secret", { node, secrets: { key: "k3y" } }), { ok: "k3y" });
    assert.match((await probe("foreign-node", { node, secrets: { key: "k3y" } })).error!, /isn't visible to the extension/);
    assert.match((await probe("big-store", { storeFile: join(dir, "store.json") })).error!, /over 1 MB/);
    assert.match((await probe("long-key", { storeFile: join(dir, "store.json") })).error!, /1–200 characters/);
    // A storage's method has no server: host.exec is refused there, as in the app.
    const listed = await callMethod(dir, "storage/list", { storage: { node: "t", kind: "box", settings: {}, readOnly: false, throughServer: false }, path: "/" });
    assert.equal(listed.ok, false);
    assert.match(listed.error!, /isn't a server of a call in progress/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Night review 2026-11-06 (N-SDK-M04): a handler's timeout ends what it started; settings take the manifest's defaults.
test("run: a timeout ends the handler's children too; settings come with their defaults", async () => {
  const dir = folder({
    "sshkipper-module.json": JSON.stringify({
      sdk: 1, id: "dev.test.night", version: "1.0.0", title: "Night", runtime: { kind: "server" },
      settings: [{ key: "header", title: "Header", type: "text", default: "X-Night" }],
      handlers: { slow: { script: "scripts/slow.sh", output: "text" }, show: { script: "scripts/show.sh", output: "text" } },
    }),
    "scripts/slow.sh": "sleep 123 &\nsleep 124\n",
    "scripts/show.sh": "printf '%s' \"$SK_SETTING_HEADER\"\n",
  });
  try {
    const started = Date.now();
    const r = await call(dir, "slow", { timeout: 1 } as any);
    assert.ok(Date.now() - started < 20_000, "the CLI didn't wait for the handler's children");
    assert.match(r.stderr, /stopped after 1 s/);
    const s = await call(dir, "show", {});
    assert.equal(s.ok ? s.value : s.error, "X-Night");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
