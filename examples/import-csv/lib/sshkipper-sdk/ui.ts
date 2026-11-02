// UI-Kit builders: plain functions returning the JSON the app draws natively. Nothing here draws — the app does,
// with the same parts as its own service pages. Any field the helpers don't name can still be passed in `extra`.

import type { Block, Column, Item, Json, MenuItem, Node, Op, Row, Status, Style, Tone, TreeNode, View, ViewAction } from "./types.ts";

type Common = { id?: string; style?: Style; visible?: string };

/** A whole page. `status` — the sentence under the title, in parts. `events` — a live screen (spec/protocol.md §11). */
export function view(blocks: Node[], opts: { title?: string; status?: (string | { text: string; tone?: Tone })[]; state?: View["state"]; events?: View["events"]; layout?: View["layout"] } = {}): View {
  const v: View = { blocks };
  if (opts.title) v.title = opts.title;
  if (opts.status) v.status = opts.status.map((p) => (typeof p === "string" ? { text: p } : p));
  if (opts.state) v.state = opts.state;
  if (opts.events !== undefined) v.events = opts.events;
  if (opts.layout) v.layout = opts.layout;
  return v;
}

/** A live screen: a view whose events the program answers (`ui/event`). */
export const screen = (blocks: Node[], opts: { title?: string; state?: View["state"]; fill?: boolean } = {}): View =>
  view(blocks, { title: opts.title, state: opts.state, events: true, ...(opts.fill ? { layout: "fill" as const } : {}) });

// MARK: Live screen blocks (spec/protocol.md §11)

type Heavy = Common & { title?: string; subtitle?: string; height?: number };

/** Many rows: the first `rows` here, the rest asked for with `more` as the user scrolls (answer with `ops.rows`). */
export const datatable = (columns: (string | Column)[], rows: (Row | (string | number | boolean | null)[])[],
  o: Heavy & { id: string; total?: number; pageSize?: number; sort?: Block["sort"]; selection?: Block["selection"]; menu?: MenuItem[]; draggable?: boolean; drop?: Block["drop"] }): Block =>
  ({ type: "datatable", columns, rows, ...o });
/** Nodes; give `expandable: true` without `children` to have them asked for (`expand`, answer with `ops.children`). */
export const tree = (nodes: TreeNode[], o: Heavy & { id: string; selection?: Block["selection"]; menu?: MenuItem[]; drop?: Block["drop"] }): Block =>
  ({ type: "tree", nodes, ...o });
/** Two or three panes side by side; `sizes` — widths of all but the last, in points (the user's are remembered). */
export const split = (panes: Node[], o: Common & { sizes?: number[]; height?: number } = {}): Block => ({ type: "split", children: panes, ...o });
/** A code editor; `completion` — `complete` events (answer with `{ items }`), `change` events as the text changes. */
export const editor = (source: string, o: Heavy & { id: string; language?: string; completion?: boolean; editable?: boolean; keywords?: string[] }): Block =>
  ({ type: "editor", text: source, ...o });
/** Output as it comes (ANSI colors kept): append with `ops.append`. */
export const terminal = (output: string, o: Heavy & { id: string; maxLines?: number }): Block => ({ type: "terminal", text: output, ...o });
/** Buttons with symbols: each press is a `press` event with `{item}`. */
export const toolbar = (items: { id: string; title: string; symbol?: string; danger?: boolean; action?: ViewAction }[], o: Common & { title?: string } = {}): Block =>
  ({ type: "toolbar", items: items.map(({ danger, ...i }) => ({ ...i, ...(danger ? { status: "bad" as const } : {}) })), ...o });
/** A form shown as a sheet (a button's `{sheet: id}` or `ops.sheet`); OK sends `submit` with the fields' values. */
export const sheet = (id: string, title: string, fields: Node[], o: Common & { text?: string; ok?: string } = {}): Block => {
  const { ok, ...rest } = o;
  return { type: "sheet", id, title, children: fields, ...(ok ? { subtitle: ok } : {}), ...rest };
};
/** A chart whose points the program appends (`ops.append`); `window` — points kept. */
export const liveChart = (kind: "line" | "bar" | "area", series: { name?: string; values?: (number | null)[] }[],
  o: Common & { id: string; title?: string; labels?: string[]; unit?: string; height?: number; window?: number }): Block =>
  ({ type: "chart", chart: kind, series, ...o });

/** Ops of `ui/patch`: what an event's answer (or `push`) changes, by block id. */
export const ops = {
  replace: (id: string, block: Block): Op => ({ op: "replace", id, block }),
  insert: (block: Block, at: { parent?: string; index?: number; after?: string } = {}): Op => ({ op: "insert", block, ...at }),
  remove: (id: string): Op => ({ op: "remove", id }),
  set: (id: string, props: Record<string, Json>): Op => ({ op: "set", id, props }),
  state: (values: Record<string, string | number | boolean>): Op => ({ op: "state", values }),
  title: (text: string): Op => ({ op: "title", text }),
  /** A page of rows at `offset`; `reset` forgets the others (a new sort or filter); `total` — the new count. */
  rows: (id: string, offset: number, rows: (Row | (string | number | boolean | null)[])[], o: { total?: number; reset?: boolean } = {}): Op => ({ op: "rows", id, offset, rows, ...o }),
  updateRows: (id: string, rows: Row[]): Op => ({ op: "update_rows", id, rows }),
  insertRows: (id: string, index: number, rows: Row[]): Op => ({ op: "insert_rows", id, index, rows }),
  removeRows: (id: string, ids: string[]): Op => ({ op: "remove_rows", id, ids }),
  /** The children of `node` (none — the tree's top level). */
  children: (id: string, node: string | undefined, nodes: TreeNode[]): Op => ({ op: "children", id, ...(node ? { node } : {}), nodes }),
  /** Text to a terminal, lines to a logs block, or points (one value per series each) to a live chart. */
  append: (id: string, what: { text?: string; lines?: string[]; points?: (number | null)[][]; labels?: string[] }): Op => ({ op: "append", id, ...what }),
  clear: (id: string): Op => ({ op: "clear", id }),
  text: (id: string, text: string): Op => ({ op: "text", id, text }),
  select: (id: string, ids: string[]): Op => ({ op: "select", id, ids }),
  sheet: (id: string): Op => ({ op: "sheet", id }),
  closeSheet: (): Op => ({ op: "close_sheet" }),
  notice: (text: string, status?: Status): Op => ({ op: "notice", text, ...(status ? { status } : {}) }),
};

/** One part of a status sentence. */
export const part = (text: string, tone?: Tone) => (tone ? { text, tone } : { text });

// MARK: Layout

export const vstack = (children: Node[], o: Common & { title?: string; subtitle?: string } = {}): Block => ({ type: "stack", axis: "vertical", children, ...o });
export const hstack = (children: Node[], o: Common & { title?: string } = {}): Block => ({ type: "stack", axis: "horizontal", children, ...o });
export const grid = (children: Node[], columns = 2, o: Common = {}): Block => ({ type: "grid", columns, children, ...o });
export const tabs = (children: Block[], o: Common = {}): Block => ({ type: "tabs", children, ...o });
export const card = (title: string, children: Node[], o: Common & { subtitle?: string; symbol?: string } = {}): Block => ({ type: "card", title, children, ...o });
export const divider = (): Block => ({ type: "divider" });

// MARK: Content

export const text = (markdown: string, o: Common & { title?: string } = {}): Block => ({ type: "text", text: markdown, ...o });
export const metric = (title: string, value: number | string, o: Common & { unit?: string; delta?: string; status?: Status; series?: number[] } = {}): Block => {
  const { series, ...rest } = o;
  return { type: "metric", title, value, ...rest, ...(series ? { series: [{ values: series }] } : {}) };
};
export const gauge = (title: string, value: number | string, max: number | string = 100, o: Common & { unit?: string; subtitle?: string } = {}): Block => ({ type: "gauge", title, value, max, ...o });
export const chart = (kind: "line" | "bar" | "area" | "pie", series: { name?: string; values: (number | null)[] }[], o: Common & { title?: string; labels?: string[]; unit?: string; height?: number } = {}): Block =>
  ({ type: "chart", chart: kind, series, ...o });
export const table = (headers: string[], rows: (string | number | boolean | null)[][], o: Common & { title?: string } = {}): Block => ({ type: "table", headers, rows, ...o });
export const keyvalue = (pairs: Record<string, string | number> | [string, string | number][], o: Common & { title?: string } = {}): Block => ({
  type: "keyvalue",
  items: (Array.isArray(pairs) ? pairs : Object.entries(pairs)).map(([k, v]) => ({ title: k, detail: String(v) })),
  ...o,
});
export const timeline = (items: Item[], o: Common & { title?: string } = {}): Block => ({ type: "timeline", items, ...o });
export const code = (source: string, language?: string, o: Common & { title?: string } = {}): Block => ({ type: "code", text: source, ...(language ? { language } : {}), ...o });
export const callout = (status: "info" | "ok" | "warn" | "bad", title: string, body?: string, o: Common = {}): Block => ({ type: "callout", status, title, ...(body ? { text: body } : {}), ...o });

// MARK: Service-page blocks

/** Rows on a soft card, like a service page's list. `bind` — a search variable filtering them. */
export const rows = (items: (Item | Node)[], o: Common & { title?: string; subtitle?: string; empty?: string; bind?: string } = {}): Block => {
  const { empty, ...rest } = o;
  return { type: "rows", items, ...rest, ...(empty ? { text: empty } : {}) };
};
/** One row: a dot by `status`, title and detail, trailing text, a badge, a menu of `actions`, a click `action`. */
export const row = (title: string, o: Omit<Item, "title"> = {}): Item => ({ title, ...o });
export const logs = (lines: string[], o: Common & { title?: string; subtitle?: string; height?: number } = {}): Block => ({ type: "logs", lines, ...o });
export const chips = (labels: (string | { title: string; status?: Status; tone?: Tone })[], o: Common = {}): Block => ({
  type: "chips",
  items: labels.map((l) => (typeof l === "string" ? { title: l } : { title: l.title, ...(l.status ? { status: l.status } : {}), ...(l.tone ? { badgeTone: l.tone } : {}) })),
  ...o,
});
/** An empty or failed state, with a button doing `action`. */
export const message = (symbol: string, title: string, o: Common & { text?: string; status?: Status; button?: string; action?: ViewAction } = {}): Block => {
  const { button, ...rest } = o;
  return { type: "message", symbol, title, ...rest, ...(button ? { subtitle: button } : {}) };
};
export const search = (bind: string, placeholder?: string, o: Common = {}): Block => ({ type: "search", bind, ...(placeholder ? { subtitle: placeholder } : {}), ...o });

// MARK: Inputs and buttons

export const button = (title: string, action: ViewAction, o: Common & { symbol?: string; danger?: boolean } = {}): Block => {
  const { danger, ...rest } = o;
  return { type: "button", title, action, ...(danger ? { status: "bad" } : {}), ...rest };
};
export const field = (bind: string, title: string, o: Common & { placeholder?: string } = {}): Block => {
  const { placeholder, ...rest } = o;
  return { type: "field", bind, title, ...(placeholder ? { subtitle: placeholder } : {}), ...rest };
};
export const toggle = (bind: string, title: string, o: Common = {}): Block => ({ type: "toggle", bind, title, ...o });
export const picker = (bind: string, title: string, options: { title: string; value: string | number | boolean }[], o: Common = {}): Block => ({ type: "picker", bind, title, options, ...o });
export const slider = (bind: string, title: string, min: number, max: number, o: Common & { step?: number; unit?: string } = {}): Block => ({ type: "slider", bind, title, min, max, ...o });

// MARK: Templates (expanded by the app with data.*, item.*, settings.*, server.*, props.*)

/** The node once per element of `path`. */
export const each = (path: string, block: Node | Item, o: { as?: string; where?: string; limit?: number } = {}): Node => ({ each: path, ...o, block });
/** One of two nodes by a condition. */
export const when = (condition: string, block: Node | Item, otherwise?: Node | Item): Node => ({ if: condition, block, ...(otherwise ? { else: otherwise } : {}) });
/** A component of the manifest's `components`. */
export const use = (name: string, props: Record<string, Json> = {}): Node => ({ use: name, props });
/** A placeholder: `$("item.name")` → "{{ item.name }}"; filters after "|". */
export const $ = (path: string) => `{{ ${path} }}`;
