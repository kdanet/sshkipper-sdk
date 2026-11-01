// «Очереди» — an example live screen (spec/protocol.md §10): the page is a screen with `events`, and the program
// answers what the user does with ops that change only the blocks they name. Nothing here touches a server: the
// queues and jobs are made up, so the example runs anywhere (`sshkipper-module call` or a development folder).

import {
  card, datatable, defineModule, editor, field, liveChart, ops, picker, screen, sheet, split, terminal, text, toolbar, tr, tree,
  type EventContext, type Op, type Row, type ScreenEvent, type TreeNode,
} from "./lib/sshkipper-sdk/index.ts";

const TOTAL = 50_000;
const STATES = ["done", "done", "done", "running", "failed"];
const FIELDS = ["state", "queue", "duration", "attempts", "created"];

/** Job n (1-based) as a row; `desc` — counted from the end (the program sorts, the app asks). */
function job(i: number, order: { column: string; ascending: boolean }): Row {
  const n = order.ascending ? i + 1 : TOTAL - i;
  const state = STATES[(n * 7) % STATES.length];
  const ms = order.column === "duration" ? (order.ascending ? i * 3 : (TOTAL - i) * 3) : (n * 37) % 9000;
  return { id: `job-${n}`, cells: [n, `export-${n % 97}`, state, ms], status: state === "failed" ? "bad" : state === "running" ? "warn" : undefined };
}

const children = (node: string): TreeNode[] =>
  [1, 2, 3].map((k) => ({ id: `${node}/${k}`, title: `${node.split("/").pop()}-${k}`, symbol: "tray", expandable: node.split("/").length < 3 }));

/** Per screen: how the table is sorted, the timer pushing chart points while it is on screen. */
const screens = new Map<string, { order: { column: string; ascending: boolean }; timer?: ReturnType<typeof setInterval>; tick: number }>();

function onEvent(e: ScreenEvent, ctx: EventContext): Op[] | { items: string[] } | null {
  const s = screens.get(e.screen) ?? { order: { column: "id", ascending: true }, tick: 0 };
  screens.set(e.screen, s);
  const v = (e.value ?? {}) as Record<string, any>;
  switch (e.type) {
    case "open":
      // Live data: a point a second, pushed to this screen until it closes.
      s.timer ??= setInterval(() => {
        s.tick += 1;
        ctx.push([ops.append("rate", { points: [[20 + Math.round(10 * Math.sin(s.tick / 3))]], labels: [String(s.tick)] })]);
      }, 1000);
      return null;
    case "close":
      if (s.timer) clearInterval(s.timer);
      screens.delete(e.screen);
      return null;
    case "more": {
      const offset = Number(v.offset ?? 0), limit = Math.min(Number(v.limit ?? 200), 1000);
      const rows = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, k) => job(offset + k, s.order));
      return [ops.rows("jobs", offset, rows)];
    }
    case "sort":
      s.order = { column: String(v.column ?? "id"), ascending: v.ascending !== false };
      return [ops.rows("jobs", 0, Array.from({ length: 200 }, (_, k) => job(k, s.order)), { reset: true, total: TOTAL })];
    case "expand":
      return [ops.children("queues", String(v.node), children(String(v.node)))];
    case "select": {
      const id = (v.rows ?? v.nodes ?? [])[0];
      return [ops.set("details", { text: id ? tr(ctx, { ru: `Выбрано: **${id}**`, en: `Selected: **${id}**` }) : "—" })];
    }
    case "menu":
      return [ops.append("out", { text: `\u001b[33m${v.item}\u001b[0m ${(v.rows ?? []).join(", ")}\n` }),
        ...(v.item === "retry" ? (v.rows ?? []).map((id: string) => ops.updateRows("jobs", [{ id, cells: [Number(id.split("-")[1]), "retry", "running", 0], status: "warn" }])) : [])];
    case "press":
      if (v.item === "refresh") return [ops.notice(tr(ctx, { ru: "Обновлено", en: "Refreshed" }), "ok")];
      return [ops.append("out", { text: `\u001b[32m›\u001b[0m ${v.item ?? v.event}\n` })];
    case "submit":
      return [ops.append("out", { text: `\u001b[36m+\u001b[0m ${JSON.stringify(v.values)}\n` }), ops.notice(tr(ctx, { ru: "Задача добавлена", en: "Job added" }), "ok")];
    case "complete": {
      const prefix = String(v.prefix ?? "").toLowerCase();
      return { items: FIELDS.filter((f) => f.startsWith(prefix)) };
    }
    case "drop":
      return [ops.append("out", { text: `dropped: ${(v.paths ?? v.rows ?? []).join(", ")}\n` })];
    default:
      return null;
  }
}

defineModule({
  handlers: {
    detect: () => ({ found: true }),
    render: (_input, ctx) => {
      const order = { column: "id", ascending: true };
      return screen([
        toolbar([
          { id: "refresh", title: tr(ctx, { ru: "Обновить", en: "Refresh" }), symbol: "arrow.clockwise" },
          { id: "new", title: tr(ctx, { ru: "Новая задача…", en: "New job…" }), symbol: "doc.text", action: { sheet: "create" } },
        ]),
        split([
          tree([{ id: "default", title: "default", symbol: "tray.full", expandable: true }, { id: "mail", title: "mail", symbol: "envelope", expandable: true }],
            { id: "queues", menu: [{ id: "pause", title: tr(ctx, { ru: "Приостановить", en: "Pause" }) }] }),
          datatable(
            [{ id: "id", title: "№", kind: "number", width: 70 }, { id: "name", title: tr(ctx, { ru: "Задача", en: "Job" }) },
              { id: "state", title: tr(ctx, { ru: "Состояние", en: "State" }) }, { id: "duration", title: tr(ctx, { ru: "мс", en: "ms" }), kind: "number", width: 80 }],
            Array.from({ length: 100 }, (_, k) => job(k, order)),
            { id: "jobs", total: TOTAL, pageSize: 200, menu: [{ id: "retry", title: tr(ctx, { ru: "Повторить", en: "Retry" }) }, { id: "drop", title: tr(ctx, { ru: "Удалить", en: "Delete" }), danger: true }], drop: ["files"] }),
          card(tr(ctx, { ru: "Подробности", en: "Details" }), [text("—", { id: "details" }),
            liveChart("line", [{ name: tr(ctx, { ru: "в секунду", en: "per second" }), values: [] }], { id: "rate", title: tr(ctx, { ru: "Задач в секунду", en: "Jobs per second" }), height: 160, window: 60 })]),
        ], { id: "main", sizes: [220, 520], height: 420 }),
        editor("state = 'failed'", { id: "filter", title: tr(ctx, { ru: "Фильтр", en: "Filter" }), language: "sql", completion: true, keywords: FIELDS, height: 80 }),
        terminal("\u001b[32m✓\u001b[0m ready\n", { id: "out", title: tr(ctx, { ru: "Вывод", en: "Output" }), height: 140 }),
        sheet("create", tr(ctx, { ru: "Новая задача", en: "New job" }), [
          field("job_name", tr(ctx, { ru: "Имя", en: "Name" })),
          picker("job_queue", tr(ctx, { ru: "Очередь", en: "Queue" }), [{ title: "default", value: "default" }, { title: "mail", value: "mail" }]),
        ], { ok: tr(ctx, { ru: "Добавить", en: "Add" }) }),
      ], { title: tr(ctx, { ru: "Очереди", en: "Queues" }), state: { job_name: "", job_queue: "default" } });
    },
  },
  onEvent,
});
