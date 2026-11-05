// A view as text: what the app would draw, block by block — for an agent that can't see the app, a test, the CLI.
// Templates are expanded first (with the data given), as the app does before drawing.

import { BLOCKS } from "./catalog.ts";
import type { Json, Op, View } from "./types.ts";
import { expand, print } from "./template.ts";

const dot: Record<string, string> = { ok: "●", warn: "▲", bad: "✖", off: "○", info: "ℹ" };

/** The outline of a view; `vars` — data, item, settings, server for its placeholders. */
export function preview(view: Json | View, vars: Record<string, Json> = {}, components: Record<string, Json> = {}): string {
  const v = (Object.keys(vars).length || JSON.stringify(view).includes("{{") ? expand(view as Json, vars, components) : view) as any;
  const lines: string[] = [];
  if (v.title) lines.push(`# ${v.title}`);
  if (Array.isArray(v.status) && v.status.length) {
    lines.push(v.status.map((p: any) => (p.tone ? `${p.text} (${p.tone})` : p.text)).join(""));
  }
  if (v.state && Object.keys(v.state).length) lines.push(`state: ${JSON.stringify(v.state)}`);
  if (v.events) lines.push(`live screen: events → ${v.events === true ? "the program (ui/event)" : `handler ${v.events}`}${v.layout === "fill" ? ", fills the area" : ""}`);
  if (v.notice) lines.push(`notice${v.notice.status ? ` (${v.notice.status})` : ""}: ${v.notice.text}`);
  if (v.sheet) lines.push(`sheet shown: #${v.sheet}`);
  for (const b of v.blocks ?? []) block(b, 0, lines);
  return lines.join("\n");
}

// MARK: Ops (spec/protocol.md §11.4)

/** What `applyOps` couldn't apply — an unknown id, a block that doesn't read the op — as the app's screen inspector
 * reports it; the other ops still apply. */
export interface OpProblem { index: number; op: string; message: string }

/** A live screen after ops of `ui/patch` / `ui/push`, as the app applies them (a copy; `view` isn't changed). The
 * preview's own extras: `notice` and `sheet` on the view, `selected` on a datatable or tree. */
export function applyOps(view: Json | View, ops: (Json | Op)[]): { view: Json; problems: OpProblem[] } {
  const v = structuredClone(view) as any;
  v.blocks ??= [];
  const problems: OpProblem[] = [];
  /** The block with `id` and the array holding it. */
  const find = (id: string): { block: any; list: any[]; index: number } | null => {
    const walk = (list: any[]): { block: any; list: any[]; index: number } | null => {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || typeof b !== "object") continue;
        if (b.id === id) return { block: b, list, index: i };
        for (const k of ["children", "blocks"]) if (Array.isArray(b[k])) { const r = walk(b[k]); if (r) return r; }
      }
      return null;
    };
    return walk(v.blocks);
  };
  const rowID = (r: any, i: number) => (r && !Array.isArray(r) && r.id !== undefined ? String(r.id) : `#${i}`);
  const types = new Set(BLOCKS.map((b) => b.type));
  ops.forEach((raw, index) => {
    const o = raw as any;
    const fail = (message: string) => problems.push({ index, op: String(o?.op), message });
    // A block of a type the app doesn't draw: the app skips it with a warning — said here too.
    const known = (b: any) => {
      const walk = (x: any) => {
        if (!x || typeof x !== "object") return;
        if (typeof x.type === "string" && !types.has(x.type)) fail(`unknown block type «${x.type}» — the app doesn't draw it`);
        for (const k of ["children", "blocks"]) if (Array.isArray(x[k])) x[k].forEach(walk);
      };
      walk(b);
    };
    const target = (types?: string[]) => {
      const f = typeof o.id === "string" ? find(o.id) : null;
      if (!f) { fail(`no block «${o.id}»`); return null; }
      if (types && !types.includes(f.block.type)) { fail(`«${o.id}» is a ${f.block.type}: it doesn't read «${o.op}»`); return null; }
      return f;
    };
    switch (o?.op) {
      case "replace": { const f = target(); if (f) { known(o.block); f.list[f.index] = { ...o.block, id: o.id }; } break; }
      case "insert": {
        known(o.block);
        let list: any[] = v.blocks;
        if (o.parent) {
          const f = find(o.parent);
          if (!f) { fail(`no block «${o.parent}»`); break; }
          if (!["stack", "grid", "tabs", "card", "split", "sheet"].includes(f.block.type)) { fail(`«${o.parent}» is a ${f.block.type}: it holds no blocks`); break; }
          list = f.block.children ??= [];
        }
        const after = o.after ? list.findIndex((b) => b?.id === o.after) : -1;
        const at = after >= 0 ? after + 1 : typeof o.index === "number" ? Math.min(Math.max(0, o.index), list.length) : list.length;
        list.splice(at, 0, o.block);
        break;
      }
      case "remove": { const f = target(); if (f) f.list.splice(f.index, 1); break; }
      case "set": {
        const f = target();
        if (!f) break;
        for (const [k, x] of Object.entries(o.props ?? {})) {
          if (k === "type" || k === "id") fail(`«${k}» isn't changed by set`); else f.block[k] = x;
        }
        break;
      }
      case "state": v.state = { ...(v.state ?? {}), ...(o.values ?? {}) }; break;
      case "title": v.title = o.text; break;
      case "rows": {
        const f = target(["datatable"]);
        if (!f) break;
        // As the app reads them (N-SDK-U06): an offset below 0 is refused there, a total is capped at 10 000 000.
        if (o.offset !== undefined && (!Number.isInteger(o.offset) || o.offset < 0)) fail(`offset ${o.offset}: a whole number from 0`);
        if (o.total !== undefined && (!Number.isInteger(o.total) || o.total < 0 || o.total > 10_000_000)) fail(`total ${o.total}: a whole number from 0 to 10 000 000`);
        const rows: any[] = o.reset ? [] : [...(f.block.rows ?? [])];
        (o.rows ?? []).forEach((r: any, i: number) => { rows[(o.offset ?? 0) + i] = r; });
        f.block.rows = rows;
        if (typeof o.total === "number") f.block.total = o.total;
        break;
      }
      case "update_rows": {
        const f = target(["datatable"]);
        if (!f) break;
        const rows: any[] = f.block.rows ?? [];
        for (const r of o.rows ?? []) {
          const i = rows.findIndex((x, j) => rowID(x, j) === String(r.id));
          if (i < 0) fail(`no row «${r.id}» loaded`); else rows[i] = r;
        }
        break;
      }
      case "insert_rows": {
        const f = target(["datatable"]);
        if (!f) break;
        f.block.rows = f.block.rows ?? [];
        f.block.rows.splice(Math.min(o.index ?? 0, f.block.rows.length), 0, ...(o.rows ?? []));
        if (typeof f.block.total === "number") f.block.total += (o.rows ?? []).length;
        break;
      }
      case "remove_rows": {
        const f = target(["datatable"]);
        if (!f) break;
        const gone = new Set((o.ids ?? []).map(String));
        const before = (f.block.rows ?? []).length;
        f.block.rows = (f.block.rows ?? []).filter((r: any, i: number) => !gone.has(rowID(r, i)));
        if (typeof f.block.total === "number") f.block.total -= before - f.block.rows.length;
        break;
      }
      case "children": {
        const f = target(["tree"]);
        if (!f) break;
        if (!o.node) { f.block.nodes = o.nodes ?? []; break; }
        const walk = (ns: any[]): any => { for (const n of ns ?? []) { if (n.id === o.node) return n; const x = walk(n.children); if (x) return x; } return null; };
        const n = walk(f.block.nodes);
        if (!n) fail(`no node «${o.node}» in «${o.id}»`); else n.children = o.nodes ?? [];
        break;
      }
      case "append": {
        const f = target(["terminal", "logs", "chart"]);
        if (!f) break;
        const b = f.block;
        if (b.type === "terminal") {
          const lines = String((b.text ?? "") + (o.text ?? "")).split("\n");
          b.text = lines.slice(-(b.maxLines ?? 5000)).join("\n");
        } else if (b.type === "logs") b.lines = [...(b.lines ?? []), ...(o.lines ?? [])];
        else {
          const keep = b.window ?? 300;
          b.series = b.series ?? [];
          for (const point of o.points ?? []) {
            (point as (number | null)[]).forEach((x, s) => {
              b.series[s] ??= { values: [] };
              b.series[s].values = [...(b.series[s].values ?? []), x].slice(-keep);
            });
          }
          if (o.labels) b.labels = [...(b.labels ?? []), ...o.labels].slice(-keep);
        }
        break;
      }
      case "clear": {
        const f = target(["terminal", "logs", "chart"]);
        if (!f) break;
        if (f.block.type === "terminal") f.block.text = "";
        else if (f.block.type === "logs") f.block.lines = [];
        else { f.block.series = (f.block.series ?? []).map((s: any) => ({ ...s, values: [] })); f.block.labels = []; }
        break;
      }
      case "text": { const f = target(["editor"]); if (f) f.block.text = o.text ?? ""; break; }
      case "select": {
        const f = target(["datatable", "tree"]);
        if (!f) break;
        if (f.block.type === "datatable") {
          const ids = new Set((f.block.rows ?? []).map((r: any, i: number) => rowID(r, i)));
          const paged = typeof f.block.total === "number" && f.block.total > (f.block.rows ?? []).length;
          for (const id of o.ids ?? []) if (!paged && !ids.has(String(id))) fail(`no row «${id}» to select`);
        }
        f.block.selected = o.ids ?? [];
        break;
      }
      case "sheet": { const f = target(["sheet"]); if (f) v.sheet = o.id; break; }
      case "close_sheet": delete v.sheet; break;
      case "notice": if (o.text) v.notice = { text: o.text, ...(o.status ? { status: o.status } : {}) }; else delete v.notice; break;
      default: fail(`unknown op «${o?.op}»`);
    }
  });
  return { view: v, problems };
}

function item(i: any): string {
  const parts = [i.status ? `${dot[i.status] ?? "·"} ` : "", i.symbol ? `[${i.symbol}] ` : "", i.title ?? ""];
  if (i.detail) parts.push(` — ${i.detail}`);
  if (i.trailing) parts.push(`  · ${i.trailing}`);
  if (i.badge) parts.push(`  [${i.badge}]`);
  if (i.actions?.length) parts.push(`  ⋯ ${i.actions.join(", ")}`);
  if (i.action) parts.push(`  → ${act(i.action)}`);
  return parts.join("");
}

function act(a: any): string {
  if (a.run) return `run ${a.run}${a.params ? " " + JSON.stringify(a.params) : ""}`;
  if (a.page) return `page ${a.page}`;
  if (a.refresh) return "refresh";
  if (a.set) return `set ${JSON.stringify(a.set)}`;
  if (a.open) return `open ${a.open}`;
  if (a.ask) return `ask «${a.ask}»`;
  if (a.event) return `event ${a.event}${a.params ? " " + JSON.stringify(a.params) : ""}`;
  if (a.sheet) return `sheet ${a.sheet}`;
  return "?";
}

function block(b: any, depth: number, out: string[]) {
  const pad = "  ".repeat(depth);
  const head = (s: string) => out.push(pad + s);
  const t = b.title ? ` ${b.title}` : "";
  const st = b.status ? ` (${b.status})` : "";
  switch (b.type) {
    case "stack": case "grid": case "tabs": case "card":
      head(`[${b.type}${b.type === "grid" ? " " + (b.columns ?? 2) : b.axis === "horizontal" ? " horizontal" : ""}]${t}${b.subtitle ? " — " + b.subtitle : ""}`);
      for (const c of b.children ?? []) block(c, depth + 1, out);
      return;
    case "divider": head("———"); return;
    case "text": head(String(b.text ?? "").split("\n").join("\n" + pad)); return;
    case "metric":
      head(`[metric]${t}: ${print(b.value ?? "")}${b.unit ? " " + b.unit : ""}${b.delta ? ` (${b.delta})` : ""}${st}${b.series?.[0]?.values ? ` ~${b.series[0].values.length} points` : ""}`);
      return;
    case "gauge": head(`[gauge]${t}: ${print(b.value ?? "")} of ${print(b.max ?? 100)}${b.unit ? " " + b.unit : ""}${b.subtitle ? " — " + b.subtitle : ""}`); return;
    case "chart": {
      const last = (s: any) => (s.values?.length ? ` last ${print(s.values[s.values.length - 1])}` : "");
      head(`[chart ${b.chart ?? "line"}${b.id ? ` #${b.id}` : ""}]${t}: ${(b.series ?? []).map((s: any) => `${s.name ?? "series"} (${s.values?.length ?? 0}${last(s)})`).join(", ")}${b.window ? ` — live, keeps ${b.window}` : ""}`);
      return;
    }
    case "table":
      head(`[table]${t}: ${(b.headers ?? []).join(" | ")}`);
      for (const r of (b.rows ?? []).slice(0, 20)) head(`  ${r.map((c: any) => print(c ?? "")).join(" | ")}`);
      if ((b.rows ?? []).length > 20) head(`  … ${b.rows.length - 20} more`);
      return;
    case "rows": case "list": case "timeline": case "checklist": case "keyvalue": case "chips": {
      const items = b.items ?? [];
      head(`[${b.type}]${t}${b.bind ? ` (filtered by ${b.bind})` : ""}: ${items.length || (b.text ?? "empty")}`);
      for (const i of items.slice(0, 50)) head(`  ${b.type === "keyvalue" ? `${i.title}: ${i.detail ?? ""}` : item(i)}`);
      if (items.length > 50) head(`  … ${items.length - 50} more`);
      return;
    }
    case "logs":
      head(`[logs]${t}: ${(b.lines ?? []).length} lines`);
      for (const l of (b.lines ?? []).slice(-10)) head(`  ${l}`);
      return;
    case "code": case "diff": head(`[${b.type}${b.language ? " " + b.language : ""}]${t}`); return;
    case "callout": head(`[callout ${b.status ?? "info"}]${t}${b.text ? " — " + b.text : ""}`); return;
    case "message": head(`[message${b.symbol ? " " + b.symbol : ""}]${t}${b.text ? " — " + b.text : ""}${b.action ? ` [${b.subtitle ?? "Повторить"} → ${act(b.action)}]` : ""}`); return;
    case "search": head(`[search ${b.bind}]${b.subtitle ? " " + b.subtitle : ""}`); return;
    case "button": head(`[button]${t} → ${b.action ? act(b.action) : "nothing"}`); return;
    case "field": case "toggle": case "picker": case "slider": head(`[${b.type} ${b.bind}]${t}`); return;
    // A live screen's own blocks.
    case "datatable": {
      const cols = (b.columns ?? []).map((c: any) => (typeof c === "string" ? c : c.title ?? c.id));
      const rows = b.rows ?? [];
      head(`[datatable #${b.id ?? "?"}]${t}: ${cols.join(" | ")} — ${rows.length} of ${b.total ?? rows.length} rows${b.menu?.length ? ` ⋯ ${b.menu.map((m: any) => m.title).join(", ")}` : ""}`);
      for (const r of rows.slice(0, 10)) {
        const cells = Array.isArray(r) ? r : r.cells ?? (b.columns ?? []).map((c: any) => r.values?.[typeof c === "string" ? c : c.id] ?? "");
        head(`  ${r.status ? `${dot[r.status] ?? "·"} ` : ""}${cells.map((c: any) => print(c ?? "")).join(" | ")}`);
      }
      if ((b.total ?? rows.length) > Math.min(rows.length, 10)) head(`  … the rest come page by page (more)`);
      return;
    }
    case "tree": {
      head(`[tree #${b.id ?? "?"}]${t}`);
      const walk = (n: any, d: number) => {
        head(`${"  ".repeat(d + 1)}${n.children?.length || n.expandable ? "▸ " : "· "}${n.status ? `${dot[n.status] ?? ""} ` : ""}${n.title}${n.detail ? ` — ${n.detail}` : ""}${n.expandable && !n.children ? " (asks)" : ""}`);
        for (const c of (n.children ?? []).slice(0, 30)) walk(c, d + 1);
      };
      for (const n of (b.nodes ?? []).slice(0, 50)) walk(n, 0);
      return;
    }
    case "split":
      head(`[split${b.sizes?.length ? " " + b.sizes.join("/") : ""}]`);
      for (const c of b.children ?? []) block(c, depth + 1, out);
      return;
    case "editor": head(`[editor #${b.id ?? "?"}${b.language ? " " + b.language : ""}${b.completion ? " completion" : ""}]${t}: ${String(b.text ?? "").split("\n").length} lines`); return;
    case "terminal": {
      head(`[terminal #${b.id ?? "?"}]${t}`);
      // eslint-disable-next-line no-control-regex
      for (const l of String(b.text ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split("\n").filter(Boolean).slice(-8)) head(`  ${l}`);
      return;
    }
    case "toolbar": head(`[toolbar] ${(b.items ?? []).map((i: any) => `[${i.title}${i.status === "bad" ? " !" : ""}]`).join(" ")}`); return;
    case "sheet":
      head(`[sheet #${b.id ?? "?"}]${t} — OK: ${b.subtitle ?? "Готово"}`);
      for (const c of b.children ?? []) block(c, depth + 1, out);
      return;
    default: head(`[${b.type ?? "?"}]${t}`);
  }
}
