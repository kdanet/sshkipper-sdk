// UI-Kit builders: plain functions returning the JSON the app draws natively. Nothing here draws — the app does,
// with the same parts as its own service pages. Any field the helpers don't name can still be passed in `extra`.

import type { Block, Item, Json, Node, Status, Style, Tone, View, ViewAction } from "./types.ts";

type Common = { id?: string; style?: Style; visible?: string };

/** A whole page. `status` — the sentence under the title, in parts. */
export function view(blocks: Node[], opts: { title?: string; status?: (string | { text: string; tone?: Tone })[]; state?: View["state"] } = {}): View {
  const v: View = { blocks };
  if (opts.title) v.title = opts.title;
  if (opts.status) v.status = opts.status.map((p) => (typeof p === "string" ? { text: p } : p));
  if (opts.state) v.state = opts.state;
  return v;
}

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
export const gauge = (title: string, value: number | string, max: number | string = 100, o: Common & { unit?: string } = {}): Block => ({ type: "gauge", title, value, max, ...o });
export const chart = (kind: "line" | "bar" | "area" | "pie", series: { name?: string; values: number[] }[], o: Common & { title?: string; labels?: string[]; unit?: string; height?: number } = {}): Block =>
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
