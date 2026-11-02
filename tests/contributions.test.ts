// The storage and source contributions of the examples, spoken to as the app does (spec/protocol.md §12): the
// program is started, initialized and called line by line over stdio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFolder, validateManifest } from "../packages/sdk/src/validate.ts";

const root = join(fileURLToPath(import.meta.url), "../..");

function program(folder: string, env: Record<string, string> = {}) {
  const p = spawn(process.execPath, ["main.ts"], { cwd: folder, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  let id = 0;
  const waiting = new Map<number, (m: any) => void>();
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d: string) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  const call = (method: string, params: unknown) => new Promise<any>((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  return { call, stop: () => p.kill() };
}

test("examples validate", () => {
  for (const ex of ["example-folder-storage", "example-hetzner-source"]) {
    const r = validateFolder(join(root, "examples", ex));
    assert.deepEqual(r.issues.filter((i) => i.severity === "error"), [], ex);
  }
});

test("folder storage: parts, abort, folders, rename, delete, no way out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-folder-"));
  const data = mkdtempSync(join(tmpdir(), "sk-data-"));
  const p = program(join(root, "examples/example-folder-storage"), { SK_DATA: data });
  try {
    const storage = { node: "n1", kind: "folder", settings: { root: dir }, readOnly: false, throughServer: false };
    assert.ok((await p.call("initialize", { sdk: 1, app: "t", module: { id: "x", version: "1" }, locale: "en" })).result);
    // An upload in two parts appears only on commit.
    const up = (await p.call("storage/write/begin", { storage, path: "/a.txt", size: 11 })).result.upload;
    await p.call("storage/write/chunk", { storage, upload: up, offset: 0, data: Buffer.from("hello ").toString("base64") });
    assert.equal((await p.call("storage/stat", { storage, path: "/a.txt" })).result.item, null);
    await p.call("storage/write/chunk", { storage, upload: up, offset: 6, data: Buffer.from("world").toString("base64") });
    await p.call("storage/write/commit", { storage, upload: up });
    assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "hello world");
    // An aborted one leaves nothing, not even its part.
    const gone = (await p.call("storage/write/begin", { storage, path: "/b.txt", size: 3 })).result.upload;
    await p.call("storage/write/chunk", { storage, upload: gone, offset: 0, data: Buffer.from("xyz").toString("base64") });
    await p.call("storage/write/abort", { storage, upload: gone });
    assert.ok(!existsSync(join(dir, "b.txt")));
    assert.deepEqual(readdirSync(join(data, "uploads")), []);
    // Read in parts.
    const r1 = (await p.call("storage/read", { storage, path: "/a.txt", offset: 0, length: 5 })).result;
    const r2 = (await p.call("storage/read", { storage, path: "/a.txt", offset: 5, length: 100 })).result;
    assert.equal(Buffer.from(r1.data, "base64").toString() + Buffer.from(r2.data, "base64").toString(), "hello world");
    assert.equal(r1.eof, false);
    assert.equal(r2.eof, true);
    await p.call("storage/mkdir", { storage, path: "/docs" });
    await p.call("storage/rename", { storage, from: "/a.txt", to: "/docs/a.txt" });
    const items = (await p.call("storage/list", { storage, path: "/docs" })).result.items;
    assert.deepEqual(items.map((i: any) => [i.name, i.type, i.size]), [["a.txt", "file", 11]]);
    assert.ok((await p.call("storage/rename", { storage, from: "/docs", to: "/docs" })).error, "a rename onto itself fails");
    await p.call("storage/delete", { storage, path: "/docs", recursive: true });
    assert.deepEqual((await p.call("storage/list", { storage, path: "/" })).result.items, []);
    // Outside the folder: refused.
    assert.match((await p.call("storage/list", { storage, path: "/../.." })).error.message, /Bad path/);
    // Read-only: no write begins.
    assert.ok((await p.call("storage/write/begin", { storage: { ...storage, readOnly: true }, path: "/c", size: 1 })).error);
    const chk = (await p.call("storage/check", { storage })).result;
    assert.ok(chk.text && chk.free > 0);
  } finally {
    p.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("hetzner source: pages, hosts, labels — from a stand-in API on 127.0.0.1", async () => {
  const fixture = JSON.parse(readFileSync(join(root, "examples/example-hetzner-source/fixtures/servers.json"), "utf8")).servers;
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer fake-token") { res.writeHead(401).end("{}"); return; }
    const page = Number(new URL(req.url ?? "/", "http://x").searchParams.get("page") ?? 1);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      servers: fixture.slice((page - 1) * 2, page * 2),
      meta: { pagination: { next_page: page * 2 < fixture.length ? page + 1 : null } },
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const p = program(join(root, "examples/example-hetzner-source"));
  try {
    await p.call("initialize", { sdk: 1, app: "t", module: { id: "x", version: "1" }, locale: "en" });
    const source = { node: "s1", kind: "hetzner-cloud", settings: { token: "fake-token", api: `http://127.0.0.1:${port}/v1`, address: "ipv4", user: "root", group_by: "location" } };
    const r = (await p.call("source/poll", { source })).result;
    assert.deepEqual(r.hosts.map((h: any) => h.id), ["4711", "4712", "4713"]);
    const web = r.hosts[0];
    assert.equal(web.address, "127.0.0.1");
    assert.equal(web.port, 2234);
    assert.equal(web.user, "svc");
    assert.equal(web.group, "Falkenstein");
    assert.equal(r.hosts[1].jump, "bastion1");
    assert.equal(r.hosts[2].online, false);
    assert.equal(r.scope, `127.0.0.1:${port}`);
    const bad = await p.call("source/poll", { source: { ...source, settings: { ...source.settings, token: "wrong" } } });
    assert.match(bad.error.message, /401/);
    const off = await p.call("source/poll", { source: { ...source, settings: { ...source.settings, api: "http://example.com/v1" } } });
    assert.match(off.error.message, /https/);
    assert.match((await p.call("source/check", { source })).result.text, /3/);
  } finally {
    p.stop();
    server.close();
  }
});

test("a method nobody answers: method not found", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-folder-"));
  writeFileSync(join(dir, "x"), "1");
  const p = program(join(root, "examples/example-folder-storage"));
  try {
    await p.call("initialize", { sdk: 1, app: "t", module: { id: "x", version: "1" }, locale: "en" });
    const unknown = await p.call("storage/nope", {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    p.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a contribution's symbol outside schemas/symbols.json is a warning before install, as the app says", () => {
  const m = {
    sdk: 1, id: "dev.acme.icons", version: "1.0.0", title: "Icons", runtime: { kind: "process", command: ["node", "main.ts"] },
    icon: { symbol: "no.such.symbol" },
    contributes: {
      import: [{ id: "csv", title: "CSV", fileExtensions: ["csv"], icon: { symbol: "tablecells.badge.ellipsis" } }],
      console: [{ id: "serial", title: "Serial", targets: ["connection"], icon: { symbol: "terminal" } }],
      storage: [{ id: "folder", title: "Folder", icon: { symbol: "folder" }, capabilities: [] }],
    },
  };
  const warned = new Set(validateManifest(m as any).filter((i) => i.severity === "warning").map((i) => i.path));
  assert.ok(warned.has("icon.symbol"));
  assert.ok(warned.has("contributes.import[0].icon.symbol"));
  assert.ok(!warned.has("contributes.console[0].icon.symbol"), "terminal is drawn");
  assert.ok(!warned.has("contributes.storage[0].icon.symbol"), "folder is drawn");
});
