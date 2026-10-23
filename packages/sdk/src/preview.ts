// A view as text: what the app would draw, block by block — for an agent that can't see the app, a test, the CLI.
// Templates are expanded first (with the data given), as the app does before drawing.

import type { Json } from "./types.ts";
import { expand, print } from "./template.ts";

const dot: Record<string, string> = { ok: "●", warn: "▲", bad: "✖", off: "○", info: "ℹ" };

/** The outline of a view; `vars` — data, item, settings, server for its placeholders. */
export function preview(view: Json, vars: Record<string, Json> = {}, components: Record<string, Json> = {}): string {
  const v = (Object.keys(vars).length || JSON.stringify(view).includes("{{") ? expand(view, vars, components) : view) as any;
  const lines: string[] = [];
  if (v.title) lines.push(`# ${v.title}`);
  if (Array.isArray(v.status) && v.status.length) {
    lines.push(v.status.map((p: any) => (p.tone ? `${p.text} (${p.tone})` : p.text)).join(""));
  }
  if (v.state && Object.keys(v.state).length) lines.push(`state: ${JSON.stringify(v.state)}`);
  for (const b of v.blocks ?? []) block(b, 0, lines);
  return lines.join("\n");
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
    case "chart":
      head(`[chart ${b.chart ?? "line"}]${t}: ${(b.series ?? []).map((s: any) => `${s.name ?? "series"} (${s.values?.length ?? 0})`).join(", ")}`);
      return;
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
    default: head(`[${b.type ?? "?"}]${t}`);
  }
}
