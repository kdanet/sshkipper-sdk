// «Проверки сайтов» — an example of an extension's own node type with its own screen (spec/protocol.md §12).
//
// The node's card is drawn by the app from `contributes.nodeType[].fields`; a double click on the node calls `render`
// with `input.node` (and `ctx.node`): its settings, the nodes it points at, which secrets are set. The screen then
// lives: `open` starts a timer that checks the addresses and pushes the results (`ctx.push`), the toolbar presses
// check now, clear the history (after `host.ask`), open a terminal on the linked server (`host.open`, the app asks
// the user about the command). The token is a secret of the document: `host.nodeSecret("token")`.
//
// No network: only addresses of this Mac are checked, and the example serves them itself on 127.0.0.1.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  card, datatable, defineModule, liveChart, ops, screen, split, text, toolbar, tr, vstack,
  type EventContext, type HandlerContext, type Json, type NodeContext, type Op, type Row, type ScreenEvent,
} from "./lib/sshkipper-sdk/index.ts";

// MARK: The example's own server (so it never needs the network)

let flakyCount = 0;
const demo = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const send = (code: number, body = "") => { res.writeHead(code, { "content-type": "text/plain" }); res.end(body); };
  switch (path) {
    case "/ok": return send(200, "ok");
    case "/slow": return void setTimeout(() => send(200, "slow"), 250 + Math.round(Math.random() * 600));
    case "/flaky": return send(++flakyCount % 3 === 0 ? 500 : 200, "flaky");
    case "/down": return send(503, "down");
    case "/auth": return send(req.headers.authorization === "Bearer demo-token" ? 200 : 401, "auth");
    default: return send(404);
  }
});
const demoReady = new Promise<number>((resolve) => demo.listen(0, "127.0.0.1", () => resolve((demo.address() as AddressInfo).port)));
// The server must not keep the program alive once the app closes stdin.
demo.unref();

// MARK: Checks

interface Result { at: number; code: number | null; ms: number; ok: boolean; note?: string }
interface Screen {
  node: NodeContext;
  urls: string[];
  selected?: string;
  timer?: ReturnType<typeof setInterval>;
  busy: boolean;
}

const screens = new Map<string, Screen>();
/** The last results of each address, per node — kept with `host/store`, so a reopened tab shows them again. */
const history = new Map<string, Record<string, Result[]>>();
const KEEP = 60;

const isLocal = (u: string) => {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(u).hostname); } catch { return false; }
};

async function urlsOf(node: NodeContext): Promise<string[]> {
  const own = (node.settings.urls as string[] | undefined) ?? [];
  if (own.length || node.settings.demo === false) return own;
  const port = await demoReady;
  return ["ok", "slow", "flaky", "down", "auth"].map((p) => `http://127.0.0.1:${port}/${p}`);
}

const good = (code: number, expect: string) =>
  expect === "200" ? code === 200 : expect === "2xx3xx" ? code >= 200 && code < 400 : code >= 200 && code < 300;

async function check(url: string, node: NodeContext, ctx: HandlerContext): Promise<Result> {
  const at = Date.now();
  if (!isLocal(url)) return { at, code: null, ms: 0, ok: false, note: tr(ctx, { ru: "пропущено: только адреса этого Mac", en: "skipped: this Mac's addresses only" }) };
  const headers: Record<string, string> = {};
  // The token is never in the settings: the app gives it to the node's own extension while its screen is open.
  if (node.secrets.includes("token")) headers.authorization = "Bearer " + (await ctx.host.nodeSecret("token"));
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(3000), redirect: "manual" });
    await r.arrayBuffer();
    const ms = Math.round(performance.now() - t0);
    return { at, code: r.status, ms, ok: good(r.status, String(node.settings.expect ?? "2xx")) };
  } catch (e) {
    return { at, code: null, ms: Math.round(performance.now() - t0), ok: false, note: e instanceof Error ? e.message : String(e) };
  }
}

function hist(node: string): Record<string, Result[]> {
  let h = history.get(node);
  if (!h) { h = {}; history.set(node, h); }
  return h;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour12: false });

function checkRow(url: string, results: Result[], ctx: HandlerContext): Row {
  const last = results.at(-1);
  const up = results.filter((r) => r.ok).length;
  const state = !last ? tr(ctx, { ru: "ещё не проверен", en: "not checked yet" })
    : last.note ?? (last.ok ? tr(ctx, { ru: "работает", en: "up" }) : tr(ctx, { ru: "не отвечает как надо", en: "not as expected" }));
  return {
    id: url,
    cells: [url, state, last?.code ?? "—", last ? last.ms : "—", results.length ? `${Math.round((100 * up) / results.length)}%` : "—"],
    status: !last ? undefined : last.ok ? "ok" : last.note && !last.code ? "warn" : "bad",
  };
}

const historyRows = (results: Result[]): Row[] =>
  results.slice().reverse().map((r, i) => ({ id: `${r.at}-${i}`, cells: [time(r.at), r.code ?? "—", r.ms], status: r.ok ? undefined : "bad" }));

/** One round over the addresses: the changed rows, a point on the chart, a line in the history. */
async function round(s: Screen, ctx: HandlerContext): Promise<Op[]> {
  if (s.busy) return [];
  s.busy = true;
  try {
    const h = hist(s.node.id);
    const out: Op[] = [];
    for (const url of s.urls) {
      const r = await check(url, s.node, ctx);
      const list = (h[url] ??= []);
      list.push(r);
      if (list.length > KEEP) list.splice(0, list.length - KEEP);
      out.push(ops.updateRows("checks", [checkRow(url, list, ctx)]));
      if (url === s.selected) {
        out.push(ops.append("latency", { points: [[r.code ? r.ms : null]], labels: [time(r.at)] }));
        out.push(ops.insertRows("history", 0, historyRows([r])));
      }
    }
    const up = s.urls.filter((u) => h[u]?.at(-1)?.ok).length;
    out.push(ops.set("summary", { text: tr(ctx, { ru: `**${up} из ${s.urls.length}** отвечают как надо · ${time(Date.now())}`, en: `**${up} of ${s.urls.length}** answer as expected · ${time(Date.now())}` }) }));
    await ctx.host.store.set("history:" + s.node.id, h as unknown as Json).catch(() => {});
    return out;
  } finally {
    s.busy = false;
  }
}

/** The right pane for the selected address: its chart and its history, anew. */
function selectedOps(s: Screen, ctx: HandlerContext): Op[] {
  const list = (s.selected && hist(s.node.id)[s.selected]) || [];
  return [
    ops.set("details", { title: s.selected ?? tr(ctx, { ru: "Выберите адрес слева", en: "Choose an address on the left" }) }),
    ops.clear("latency"),
    ...(list.length ? [ops.append("latency", { points: list.map((r) => [r.code ? r.ms : null]), labels: list.map((r) => time(r.at)) })] : []),
    ops.rows("history", 0, historyRows(list), { reset: true, total: list.length }),
  ];
}

// MARK: The screen

async function render(input: Record<string, Json>, ctx: HandlerContext) {
  const node = (input.node ?? ctx.node) as unknown as NodeContext | undefined;
  if (!node) return screen([text(tr(ctx, { ru: "Этот экран открывается из узла «Проверки сайтов».", en: "This screen opens from a «Site checks» node." }))]);
  const urls = await urlsOf(node);
  if (!history.has(node.id)) {
    const saved = await ctx.host.store.get("history:" + node.id).catch(() => null);
    history.set(node.id, (saved as unknown as Record<string, Result[]>) ?? {});
  }
  const h = hist(node.id);
  const server = node.links.server;
  return screen([
    toolbar([
      { id: "check", title: tr(ctx, { ru: "Проверить сейчас", en: "Check now" }), symbol: "arrow.clockwise" },
      ...(server ? [{ id: "terminal", title: tr(ctx, { ru: `Терминал на «${server.name}»`, en: `Terminal on «${server.name}»` }), symbol: "terminal" }] : []),
      { id: "clear", title: tr(ctx, { ru: "Очистить историю…", en: "Clear history…" }), symbol: "trash", danger: true },
    ]),
    text(tr(ctx, { ru: "Ещё не проверено", en: "Not checked yet" }), { id: "summary" }),
    split([
      datatable(
        [{ id: "url", title: tr(ctx, { ru: "Адрес", en: "Address" }), width: 260 }, { id: "state", title: tr(ctx, { ru: "Состояние", en: "State" }), width: 170 },
          { id: "code", title: tr(ctx, { ru: "Код", en: "Code" }), kind: "number", width: 60 }, { id: "ms", title: tr(ctx, { ru: "мс", en: "ms" }), kind: "number", width: 60 },
          { id: "up", title: tr(ctx, { ru: "Доступность", en: "Uptime" }), width: 90 }],
        urls.map((u) => checkRow(u, h[u] ?? [], ctx)),
        { id: "checks", selection: "single", title: tr(ctx, { ru: `Проверки · ${urls.length}`, en: `Checks · ${urls.length}` }) }),
      vstack([
        liveChart("line", [{ name: tr(ctx, { ru: "задержка, мс", en: "latency, ms" }), values: [] }],
          { id: "latency", title: tr(ctx, { ru: "Задержка", en: "Latency" }), unit: "ms", height: 180, window: KEEP }),
        datatable([{ id: "time", title: tr(ctx, { ru: "Время", en: "Time" }), width: 90 }, { id: "code", title: tr(ctx, { ru: "Код", en: "Code" }), kind: "number", width: 60 },
          { id: "ms", title: tr(ctx, { ru: "мс", en: "ms" }), kind: "number" }], [], { id: "history", title: tr(ctx, { ru: "История", en: "History" }) }),
      ], { id: "details", title: tr(ctx, { ru: "Выберите адрес слева", en: "Choose an address on the left" }) }),
    ], { id: "main", sizes: [640] }),
  ], { title: node.name, fill: true });
}

async function onEvent(e: ScreenEvent, ctx: EventContext): Promise<Op[] | null> {
  const node = ctx.node;
  if (!node) return null;
  let s = screens.get(e.screen);
  if (!s) { s = { node, urls: await urlsOf(node), busy: false }; screens.set(e.screen, s); }
  s.node = node;
  const v = (e.value ?? {}) as Record<string, any>;
  switch (e.type) {
    case "open": {
      // Live data while the tab is on screen: a round every interval, pushed by itself.
      const every = Math.min(Math.max(Number(node.settings.interval ?? 5), 1), 3600) * 1000;
      const st = s;
      if (st.timer) clearInterval(st.timer);
      st.timer = setInterval(async () => { const out = await round(st, ctx).catch(() => []); if (out.length) ctx.push(out); }, every);
      round(st, ctx).then((out) => ctx.push(out)).catch(() => {});
      return null;
    }
    case "close":
      if (s.timer) clearInterval(s.timer);
      screens.delete(e.screen);
      return null;
    case "select":
      s.selected = (v.rows ?? [])[0];
      return selectedOps(s, ctx);
    case "press":
      if (v.item === "check") return [...(await round(s, ctx)), ops.notice(tr(ctx, { ru: "Проверено", en: "Checked" }), "ok")];
      if (v.item === "terminal") {
        const server = node.links.server;
        if (!server) return null;
        const url = s.selected ?? s.urls[0];
        // The app asks the user about the command first (risk by its command policy) and types it after login.
        const opened = await ctx.host.open({ terminal: { server: server.id, command: `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\\n' '${url.replaceAll("'", "")}'`, title: tr(ctx, { ru: "curl", en: "curl" }) } });
        return opened ? null : [ops.notice(tr(ctx, { ru: "Команду не выполнили", en: "The command wasn't run" }), "info")];
      }
      if (v.item === "clear") {
        const which = s.selected ?? tr(ctx, { ru: "всех адресов", en: "every address" });
        const answer = await ctx.host.ask({
          title: tr(ctx, { ru: `Очистить историю ${s.selected ? `«${which}»` : which}?`, en: `Clear the history of ${s.selected ? `«${which}»` : which}?` }),
          text: tr(ctx, { ru: "Точки графика и строки истории удалятся; проверки продолжатся.", en: "The chart's points and the history's rows go; the checks go on." }),
          buttons: [tr(ctx, { ru: "Очистить", en: "Clear" }), tr(ctx, { ru: "Отмена", en: "Cancel" })],
          risk: "danger",
        });
        if (answer !== 0) return null;
        const h = hist(node.id);
        for (const u of s.selected ? [s.selected] : s.urls) delete h[u];
        await ctx.host.store.set("history:" + node.id, h as unknown as Json).catch(() => {});
        return [ops.updateRows("checks", s.urls.map((u) => checkRow(u, h[u] ?? [], ctx))), ...selectedOps(s, ctx),
          ops.notice(tr(ctx, { ru: "История очищена", en: "History cleared" }), "ok")];
      }
      return null;
    default:
      return null;
  }
}

defineModule({ handlers: { render }, onEvent });
