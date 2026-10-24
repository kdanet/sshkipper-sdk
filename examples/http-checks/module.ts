// «Проверки сайтов» — an example process module of SDK 1: a program on this Mac that answers the app over
// JSON-RPC (lib/sshkipper-sdk), checks URLs from the server (host.exec → curl over the app's SSH session) or from
// this Mac (fetch), keeps a history in the module's store and draws its pages with the UI-Kit builders.

import {
  chart, defineModule, grid, keyvalue, logs, message, metric, ModuleError, part, quote, row, rows, search, text, tr, view,
  type HandlerContext, type Item, type Json,
} from "./lib/sshkipper-sdk/index.ts";

type Check = { url: string; ok: boolean; code: number; ms: number; error?: string; at: number };
type History = Record<string, Check[]>;

const KEEP = 60;

function urls(ctx: HandlerContext): string[] {
  const list = Array.isArray(ctx.settings.urls) ? ctx.settings.urls : [];
  return list.filter((u): u is string => typeof u === "string" && /^https?:\/\/[^\s'"\\]+$/.test(u.trim())).map((u) => u.trim());
}

const slowMs = (ctx: HandlerContext) => (typeof ctx.settings.slow_ms === "number" ? ctx.settings.slow_ms : 800);
const where = (ctx: HandlerContext) => (ctx.settings.from === "mac" || !ctx.server ? "mac" : "server");
// One history per server, also when checked from this Mac: each server has its own list of URLs.
const key = (ctx: HandlerContext) => `history:${where(ctx)}:${ctx.server?.id ?? "-"}`;

/** One URL: from this Mac with fetch, or from the server with curl through the app's session. */
async function probe(url: string, ctx: HandlerContext, from = where(ctx)): Promise<Check> {
  const at = Math.floor(Date.now() / 1000);
  if (from === "mac") {
    const started = performance.now();
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]) });
      await res.body?.cancel();
      return { url, ok: res.status < 400, code: res.status, ms: Math.round(performance.now() - started), at };
    } catch (e) {
      return { url, ok: false, code: 0, ms: Math.round(performance.now() - started), error: e instanceof Error ? e.message : String(e), at };
    }
  }
  const r = await ctx.host.exec(`curl -sS -o /dev/null -L --max-time 10 -w '%{http_code} %{time_total}' -- ${quote(url)}`, { timeout: 15 });
  if (r.exitCode === 127) throw new ModuleError(tr(ctx, { ru: "На сервере нет curl", en: "There is no curl on the server" }));
  const [code, secs] = r.stdout.trim().split(" ");
  const n = Number(code) || 0;
  const error = r.exitCode === 0 ? undefined : r.stderr.trim().split("\n").pop() || `curl ${r.exitCode}`;
  return { url, ok: r.exitCode === 0 && n > 0 && n < 400, code: n, ms: Math.round(Number(secs) * 1000) || 0, ...(error ? { error } : {}), at };
}

// The summary and the page may check at once: their read-modify-write of the history goes one after another.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const next = queue.then(f, f);
  queue = next.catch(() => undefined);
  return next;
}

/** Checks every URL, keeps the history, notifies about the ones that just went down. */
function checkAll(ctx: HandlerContext): Promise<{ checks: Check[]; history: History }> {
  return serial(() => checkAllNow(ctx));
}

async function checkAllNow(ctx: HandlerContext): Promise<{ checks: Check[]; history: History }> {
  const list = urls(ctx);
  const checks = await Promise.all(list.map((u) => probe(u, ctx)));
  const history = ((await ctx.host.store.get(key(ctx))) ?? {}) as History;
  for (const c of checks) {
    const before = history[c.url]?.at(-1);
    if (before?.ok && !c.ok && ctx.settings.notify !== false) {
      await ctx.host.notify(tr(ctx, { ru: "Адрес не отвечает", en: "A URL is down" }), `${c.url} — ${c.error ?? `HTTP ${c.code}`}`);
    }
    history[c.url] = [...(history[c.url] ?? []), c].slice(-KEEP);
  }
  // URLs taken out of the settings take their history with them.
  for (const u of Object.keys(history)) if (!list.includes(u)) delete history[u];
  await ctx.host.store.set(key(ctx), history as unknown as Json);
  return { checks, history };
}

function status(c: Check, ctx: HandlerContext): "ok" | "warn" | "bad" {
  return !c.ok ? "bad" : c.ms > slowMs(ctx) ? "warn" : "ok";
}

function sentence(checks: Check[], ctx: HandlerContext) {
  const up = checks.filter((c) => c.ok).length;
  const slow = checks.filter((c) => status(c, ctx) === "warn").length;
  return { up, slow, text: tr(ctx, { ru: `${up} из ${checks.length} отвечают`, en: `${up} of ${checks.length} answer` }) };
}

const short = (url: string) => url.replace(/^https?:\/\//, "");
const ago = (ctx: HandlerContext, at: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - at);
  return s < 60 ? tr(ctx, { ru: "только что", en: "just now" }) : tr(ctx, { ru: `${Math.floor(s / 60)} мин назад`, en: `${Math.floor(s / 60)} min ago` });
};

defineModule({
  handlers: {
    detect: (_input, ctx) => ({ found: urls(ctx).length > 0 }),

    async summary(_input, ctx) {
      const { checks } = await checkAll(ctx);
      const s = sentence(checks, ctx);
      return { text: s.text, status: s.up < checks.length ? "bad" : s.slow ? "warn" : "ok" };
    },

    async check(_input, ctx) {
      const { checks } = await checkAll(ctx);
      const s = sentence(checks, ctx);
      return { message: s.text, status: s.up < checks.length ? "bad" : "ok" };
    },

    async clear(_input, ctx) {
      await ctx.host.store.set(key(ctx), null);
      return { message: tr(ctx, { ru: "История очищена", en: "History cleared" }), status: "ok" };
    },

    async check_url(input, ctx) {
      const url = String(input.url ?? "");
      if (!/^https?:\/\//.test(url)) throw new ModuleError("url must start with http:// or https://", -32602);
      // The model picks the URL: it is fetched from the server, never from this Mac's network (localhost, the LAN).
      if (!ctx.server) throw new ModuleError("http_check needs a server", -32602);
      const c = await probe(url, ctx, "server");
      return { url, ok: c.ok, http_code: c.code, ms: c.ms, from: "server", ...(c.error ? { error: c.error } : {}) };
    },

    async render(_input, ctx) {
      if (urls(ctx).length === 0) {
        return view([
          message("globe", tr(ctx, { ru: "Адресов нет", en: "No URLs" }), {
            text: tr(ctx, {
              ru: "Добавьте адреса в настройках подключения: «Службы» → «Проверки сайтов» → «Адреса».",
              en: "Add URLs in the connection's settings: Services → Site checks → URLs.",
            }),
          }),
        ]);
      }
      const { checks, history } = await checkAll(ctx);
      const s = sentence(checks, ctx);
      const answered = checks.filter((c) => c.ok);
      const avg = answered.length ? Math.round(answered.reduce((a, c) => a + c.ms, 0) / answered.length) : 0;
      // Every URL that answered at all (an HTTP 404 took its time too), not only the healthy ones.
      const slowest = checks.filter((c) => c.code > 0).sort((a, b) => b.ms - a.ms)[0];
      // The average of each round of checks, oldest first: the sparkline under «Среднее».
      const rounds = Math.max(0, ...Object.values(history).map((h) => h.length));
      const averages = Array.from({ length: rounds }, (_, i) => {
        const at = Object.values(history).map((h) => h[h.length - rounds + i]).filter((c): c is Check => !!c && c.ok);
        return at.length ? Math.round(at.reduce((a, c) => a + c.ms, 0) / at.length) : 0;
      });
      const items: Item[] = checks.map((c) => row(short(c.url), {
        id: c.url,
        status: status(c, ctx),
        detail: c.error ?? (!c.ok ? tr(ctx, { ru: "отвечает ошибкой", en: "answers with an error" })
          : status(c, ctx) === "warn" ? tr(ctx, { ru: "медленно", en: "slow" }) : tr(ctx, { ru: "отвечает", en: "answers" })),
        // No answer has no time: a dash, not «0 мс».
        trailing: c.code > 0 ? `${c.ms} ${tr(ctx, { ru: "мс", en: "ms" })}` : "—",
        badge: c.code ? `HTTP ${c.code}` : tr(ctx, { ru: "нет ответа", en: "no answer" }),
        badgeTone: c.ok ? "secondary" : "bad",
        action: { page: "url" },
        data: { url: c.url },
      }));
      const down = checks.length - s.up;
      return view([
        grid([
          metric(tr(ctx, { ru: "Отвечают", en: "Answer" }), `${s.up} / ${checks.length}`, { status: down ? "bad" : "ok" }),
          metric(tr(ctx, { ru: "Среднее время", en: "Average time" }), avg, { unit: tr(ctx, { ru: "мс", en: "ms" }), series: averages.slice(-30) }),
          metric(tr(ctx, { ru: "Самый медленный", en: "Slowest" }), slowest ? slowest.ms : "—", {
            unit: slowest ? tr(ctx, { ru: "мс", en: "ms" }) : undefined,
            delta: slowest ? short(slowest.url) : undefined,
            status: slowest && slowest.ms > slowMs(ctx) ? "warn" : undefined,
          }),
        ], 3),
        chart("line", Object.entries(history).map(([u, h]) => ({ name: short(u), values: h.slice(-30).map((c) => (c.ok ? c.ms : 0)) })), {
          title: tr(ctx, { ru: "Время ответа, мс", en: "Response time, ms" }), height: 160,
        }),
        search("q", tr(ctx, { ru: "Адрес", en: "URL" })),
        rows(items, { title: tr(ctx, { ru: "Адреса", en: "URLs" }), bind: "q" }),
        text(where(ctx) === "mac"
          ? tr(ctx, { ru: "Проверяется с этого Mac.", en: "Checked from this Mac." })
          : tr(ctx, { ru: `Проверяется с сервера «${ctx.server!.name}» (curl).`, en: `Checked from the server “${ctx.server!.name}” (curl).` }),
          { style: { tone: "secondary", font: "caption" } }),
      ], {
        status: [part(s.text + (down ? "" : "."), down ? "bad" : undefined),
          ...(s.slow ? [part(tr(ctx, { ru: ` Медленно: ${s.slow}.`, en: ` Slow: ${s.slow}.` }), "attention")] : [])],
        state: { q: "" },
      });
    },

    async render_url(_input, ctx) {
      const url = typeof ctx.item === "object" && ctx.item && !Array.isArray(ctx.item) ? String((ctx.item as Record<string, Json>).url ?? "") : "";
      const history = (((await ctx.host.store.get(key(ctx))) ?? {}) as History)[url] ?? [];
      const last = history.at(-1);
      if (!last) return view([message("clock", tr(ctx, { ru: "Проверок ещё не было", en: "No checks yet" }))], { title: short(url) });
      const ok = history.filter((c) => c.ok);
      const uptime = Math.round((ok.length / history.length) * 100);
      return view([
        grid([
          metric(tr(ctx, { ru: "Сейчас", en: "Now" }), last.ok ? last.ms : "—", { unit: last.ok ? tr(ctx, { ru: "мс", en: "ms" }) : undefined, status: status(last, ctx) }),
          metric(tr(ctx, { ru: "Отвечал", en: "Answered" }), uptime, { unit: "%", delta: tr(ctx, { ru: `из ${history.length} проверок`, en: `of ${history.length} checks` }) }),
          metric(tr(ctx, { ru: "Медленнее всего", en: "Slowest" }), ok.length ? Math.max(...ok.map((c) => c.ms)) : "—", { unit: ok.length ? tr(ctx, { ru: "мс", en: "ms" }) : undefined }),
        ], 3),
        chart("bar", [{ values: history.map((c) => (c.ok ? c.ms : 0)) }], { title: tr(ctx, { ru: "Время ответа, мс", en: "Response time, ms" }), height: 140 }),
        keyvalue([
          [tr(ctx, { ru: "Адрес", en: "URL" }), url],
          [tr(ctx, { ru: "Последний ответ", en: "Last answer" }), last.code ? `HTTP ${last.code}` : tr(ctx, { ru: "нет", en: "none" })],
          [tr(ctx, { ru: "Проверено", en: "Checked" }), ago(ctx, last.at)],
          [tr(ctx, { ru: "Откуда", en: "From" }), where(ctx) === "mac" ? tr(ctx, { ru: "этот Mac", en: "this Mac" }) : ctx.server!.name],
        ]),
        logs(history.slice().reverse().slice(0, 30).map((c) =>
          `${new Date(c.at * 1000).toLocaleTimeString(ctx.locale)}  ${c.ok ? "OK   " : "ERROR"}  ${c.code || "—"}  ${c.ms} ms${c.error ? "  " + c.error : ""}`),
        { title: tr(ctx, { ru: "Последние проверки", en: "Recent checks" }) }),
      ], { title: short(url), status: [part(last.ok ? tr(ctx, { ru: "Отвечает.", en: "Answers." }) : tr(ctx, { ru: "Не отвечает.", en: "Down." }), last.ok ? undefined : "bad")] });
    },
  },
});
