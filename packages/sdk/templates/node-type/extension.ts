// __TITLE__: a node type with its own screen, SSHKipper SDK 1 (spec/protocol.md §14). The app keeps the node in the
// user's document and draws its card from `fields`; a double click calls `render` with `input.node` (its settings,
// the nodes it points at). The screen is live (§11): the app sends what the user does (`onEvent`) and applies the ops
// you answer with. Tasks are kept per node in `host.store`.

import {
  datatable, defineModule, field, ops, screen, sheet, toolbar, tr,
  type EventContext, type HandlerContext, type Json, type NodeContext, type Op, type ScreenEvent,
} from "./lib/sshkipper-sdk/index.ts";

type Task = { id: string; title: string; done: boolean };

const key = (node?: NodeContext) => `tasks:${node?.id ?? "none"}`;
const load = async (ctx: HandlerContext, node?: NodeContext) => ((await ctx.host.store.get(key(node))) ?? []) as Task[];
const save = (ctx: HandlerContext, node: NodeContext | undefined, tasks: Task[]) => ctx.host.store.set(key(node), tasks as unknown as Json);

const rows = (tasks: Task[]) => tasks.map((t) => ({ id: t.id, cells: [t.title, t.done ? "✓" : ""], status: t.done ? "ok" as const : "off" as const }));

async function render(input: Record<string, Json>, ctx: HandlerContext) {
  const node = (input.node ?? ctx.node) as unknown as NodeContext | undefined;
  const tasks = await load(ctx, node);
  const server = node?.links?.server?.name;
  return screen([
    toolbar([
      { id: "add", title: tr(ctx, { en: "Add", ru: "Добавить" }) },
      { id: "clear", title: tr(ctx, { en: "Clear done", ru: "Убрать сделанные" }), symbol: "trash" },
    ]),
    datatable([{ id: "title", title: tr(ctx, { en: "Task", ru: "Задача" }) }, { id: "done", title: "", width: 40 }], rows(tasks), {
      id: "tasks", total: tasks.length, selection: "multiple",
      menu: [{ id: "toggle", title: tr(ctx, { en: "Done / not done", ru: "Сделано / не сделано" }) }, { id: "delete", title: tr(ctx, { en: "Delete", ru: "Удалить" }), danger: true }],
    }),
    sheet("new", tr(ctx, { en: "New task", ru: "Новая задача" }), [field("title", tr(ctx, { en: "Task", ru: "Задача" }))], { ok: tr(ctx, { en: "Add", ru: "Добавить" }) }),
  ], { title: `${node?.name ?? "—"}${server ? ` · ${server}` : ""}`, state: { title: "" }, fill: true });
}

async function onEvent(e: ScreenEvent, ctx: EventContext): Promise<Op[] | null> {
  const v = (e.value ?? {}) as Record<string, any>;
  const tasks = await load(ctx, ctx.node);
  const changed = async (next: Task[]) => {
    await save(ctx, ctx.node, next);
    return [ops.rows("tasks", 0, rows(next), { total: next.length, reset: true })];
  };
  switch (e.type) {
    case "press":
      if (v.item === "add") return [ops.sheet("new")];
      if (v.item === "clear") return changed(tasks.filter((t) => !t.done));
      return null;
    case "submit": {
      const title = String(v.values?.title ?? "").trim();
      if (!title) return [ops.notice(tr(ctx, { en: "A task needs a title", ru: "У задачи нужно название" }), "warn")];
      return [ops.closeSheet(), ...(await changed([...tasks, { id: String(Date.now()), title, done: false }]))];
    }
    case "menu": {
      const ids = new Set((v.rows ?? []).map(String));
      if (v.item === "delete") return changed(tasks.filter((t) => !ids.has(t.id)));
      if (v.item === "toggle") return changed(tasks.map((t) => (ids.has(t.id) ? { ...t, done: !t.done } : t)));
      return null;
    }
    case "activate": return changed(tasks.map((t) => (t.id === String(v.row) ? { ...t, done: !t.done } : t)));
    default: return null;
  }
}

defineModule({ handlers: { render }, onEvent });
