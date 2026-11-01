// Model providers (spec/protocol.md §12) and blocks of programs in automations (§8): the runtime, the manifest's
// checks, the echo example.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve, type Transport } from "../packages/sdk/src/module.ts";
import type { Manifest } from "../packages/sdk/src/types.ts";
import { validateFolder, validateManifest } from "../packages/sdk/src/validate.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

function harness(def: Parameters<typeof serve>[0]) {
  const fromModule: string[] = [];
  let lineCb: (l: string) => void = () => {};
  const transport: Transport = { write: (l) => fromModule.push(l), onLine: (cb) => { lineCb = cb; }, onClose: () => {}, exit: () => {} };
  serve(def, transport);
  const next = async () => {
    for (let i = 0; i < 100 && !fromModule.length; i++) await new Promise((r) => setTimeout(r, 5));
    return JSON.parse(fromModule.shift()!);
  };
  const send = (m: object) => lineCb(JSON.stringify({ jsonrpc: "2.0", ...m }));
  return { next, send, fromModule };
}

const init = { id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "en", module: { id: "x", version: "1" } } };

test("model providers: ai/models, ai/chat with ai/delta, ai/cancel", async () => {
  let aborted = false;
  const h = harness({
    handlers: {},
    ai: {
      models: () => [{ id: "m1", title: "M 1" }],
      async chat(req, ctx) {
        if (req.model === "hang") {
          await new Promise<void>((r) => ctx.signal.addEventListener("abort", () => { aborted = true; r(); }));
          return;
        }
        ctx.delta({ type: "text", text: `${req.settings.greeting}: ` });
        ctx.delta({ type: "text", text: req.secrets.api_key ? "key" : "none" });
        return { stop: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } };
      },
    },
  });
  h.send(init);
  await h.next();
  h.send({ id: 2, method: "ai/models", params: { provider: "p", settings: {}, secrets: {} } });
  assert.deepEqual((await h.next()).result, { models: [{ id: "m1", title: "M 1" }] });
  const chat = { id: "s-1", provider: "p", model: "m1", system: "", messages: [], tools: [], max_tokens: 10, settings: { greeting: "Hi" }, secrets: { api_key: "k" } };
  h.send({ id: 3, method: "ai/chat", params: chat });
  // Pieces first, each with the stream's id, then the answer.
  assert.deepEqual(await h.next(), { jsonrpc: "2.0", method: "ai/delta", params: { type: "text", text: "Hi: ", id: "s-1" } });
  assert.deepEqual(await h.next(), { jsonrpc: "2.0", method: "ai/delta", params: { type: "text", text: "key", id: "s-1" } });
  assert.deepEqual((await h.next()).result, { stop: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } });
  // Stopped by the app: the chat is aborted and answers nothing.
  h.send({ id: 4, method: "ai/chat", params: { ...chat, id: "s-2", model: "hang" } });
  await new Promise((r) => setTimeout(r, 20));
  h.send({ method: "ai/cancel", params: { id: "s-2" } });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(aborted);
  assert.equal(h.fromModule.length, 0);
});

test("model providers: a module without one says so", async () => {
  const h = harness({ handlers: {} });
  h.send(init);
  await h.next();
  h.send({ id: 2, method: "ai/models", params: {} });
  assert.equal((await h.next()).error.code, -32601);
});

test("model providers and program blocks: the manifest's checks", () => {
  const base = { sdk: 1, id: "dev.x.y", version: "1.0.0", title: "X", runtime: { kind: "process", command: ["node", "m.ts"] } };
  const ai = validateManifest({ ...base, contributes: { ai: [{ id: "p", title: "P", fields: [{ key: "api_key", type: "secret", title: "K" }], reasoning: ["low"] }] } } as unknown as Manifest);
  assert.ok(ai.some((i) => i.severity === "error" && i.message.includes("secrets")), JSON.stringify(ai));
  const ok = validateManifest({ ...base, permissions: ["secrets"], contributes: { ai: [{ id: "p", title: "P", fields: [{ key: "api_key", type: "secret", title: "K" }] }] } } as unknown as Manifest);
  assert.deepEqual(ok.filter((i) => i.severity === "error"), []);
  const block = { id: "b", title: "B", handler: "h", risk: "read", server: true };
  const noExec = validateManifest({ ...base, handlers: { h: {} }, automation: [block] } as unknown as Manifest);
  assert.ok(noExec.some((i) => i.path === "automation[0].server" && i.severity === "error"), JSON.stringify(noExec));
  const fine = validateManifest({ ...base, permissions: ["exec"], handlers: { h: {} }, automation: [block] } as unknown as Manifest);
  assert.deepEqual(fine, [], "a program's block is no longer a warning");
});

test("examples: the echo provider and the site checks' blocks are clean", () => {
  for (const ex of ["ai-echo-provider", "http-checks"]) {
    const r = validateFolder(join(root, "examples", ex));
    assert.deepEqual(r.issues.filter((i) => i.severity === "error"), [], ex);
  }
});

test("examples: the echo provider answers deterministically and asks for tools", async () => {
  const p = spawn(process.execPath, ["module.ts"], { cwd: join(root, "examples/ai-echo-provider"), stdio: ["pipe", "pipe", "inherit"] });
  const lines: any[] = [];
  let buf = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  const send = (m: object) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const answer = async (id: number) => {
    for (let i = 0; i < 400; i++) {
      const a = lines.find((l) => l.id === id);
      if (a) return a;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no answer ${id}`);
  };
  try {
    send({ id: 1, method: "initialize", params: { sdk: 1, app: "t", locale: "ru", module: { id: "dev.sshkipper.example.ai-echo", version: "1.0.0" } } });
    await answer(1);
    send({ id: 2, method: "ai/models", params: { provider: "echo", settings: {}, secrets: {} } });
    assert.deepEqual((await answer(2)).result.models.map((m: any) => m.id), ["echo-1", "echo-1-slow"]);
    const tools = [{ name: "list_sessions", description: "", input_schema: {} }, { name: "run_command", description: "", input_schema: {} }];
    const req = (id: string, messages: object[]) => ({ id, provider: "echo", model: "echo-1", system: "", messages, tools, max_tokens: 100,
      settings: { greeting: "Эхо", delay_ms: 0 }, secrets: { api_key: "abcd" } });
    send({ id: 3, method: "ai/chat", params: req("a", [{ role: "user", content: [{ type: "text", text: "привет" }] }]) });
    assert.equal((await answer(3)).result.stop, "end_turn");
    const said = lines.filter((l) => l.method === "ai/delta" && l.params.id === "a").map((l) => l.params.text).join("");
    assert.equal(said, "Эхо: вы написали «привет». Модель echo-1; сообщений 1, инструментов 2. Ключ получен (4 знаков).");
    send({ id: 4, method: "ai/chat", params: req("b", [{ role: "user", content: [{ type: "text", text: "проверь сервер" }] }]) });
    assert.equal((await answer(4)).result.stop, "tool_use");
    assert.ok(lines.some((l) => l.method === "ai/delta" && l.params.id === "b" && l.params.type === "tool_use" && l.params.name === "list_sessions"));
    // The sessions came back: uptime on the first one.
    send({ id: 5, method: "ai/chat", params: req("c", [
      { role: "user", content: [{ type: "text", text: "проверь сервер" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "echo-ls", name: "list_sessions", input: {} }] },
      { role: "user", content: [{ type: "tool_result", id: "echo-ls", content: "s7: target — подключено; доступ: есть", is_error: false }] },
    ]) });
    assert.equal((await answer(5)).result.stop, "tool_use");
    const input = lines.filter((l) => l.method === "ai/delta" && l.params.id === "c" && l.params.type === "tool_input").map((l) => l.params.json).join("");
    assert.equal(JSON.parse(input).session_id, "s7");
    assert.equal(JSON.parse(input).command, "uptime");
  } finally {
    p.kill();
  }
});
