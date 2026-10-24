// Template expansion as the app does it (spec/protocol.md §6) — for previews, tests and the CLI. The conformance
// cases in tests/conformance/templates.json are run against this and against the app's own implementation.

import type { Json } from "./types.ts";

export const ROOTS = new Set(["data", "item", "settings", "server", "props", "index", "context"]);
export const MAX_BLOCKS = 400;
export const MAX_DEPTH = 32; // levels of JSON (a block is several: block → items → item → action); the app draws 8 of blocks

export class TemplateError extends Error {}

type Scope = { vars: Record<string, Json>; names: Set<string> };

export function expand(view: Json, vars: Record<string, Json>, components: Record<string, Json> = {}): Json {
  const budget = { left: MAX_BLOCKS };
  const out = node(view, { vars, names: new Set(Object.keys(vars)) }, 0, budget, components);
  if (out.length !== 1) throw new TemplateError("the view's top level is one object");
  return out[0];
}

function isPath(head: string, s: Scope) { return ROOTS.has(head) || s.names.has(head); }
function withVar(s: Scope, name: string, v: Json): Scope { return { vars: { ...s.vars, [name]: v }, names: new Set([...s.names, name]) }; }

function node(v: Json, s: Scope, depth: number, budget: { left: number }, comps: Record<string, Json>): Json[] {
  if (depth > MAX_DEPTH) throw new TemplateError(`nesting deeper than ${MAX_DEPTH}`);
  if (typeof v === "string") return [str(v, s)];
  if (Array.isArray(v)) return [v.flatMap((x) => node(x, s, depth + 1, budget, comps))];
  if (v === null || typeof v !== "object") return [v];
  const o = v as Record<string, Json>;
  if (typeof o.each === "string" && o.block !== undefined) {
    const name = typeof o.as === "string" ? o.as : "item";
    const list = lookup(o.each, s.vars) ?? [];
    if (!Array.isArray(list)) throw new TemplateError(`each ${o.each} is not an array`);
    const limit = typeof o.limit === "number" ? Math.max(0, Math.floor(o.limit)) : 1000;
    const out: Json[] = [];
    list.forEach((el, i) => {
      const inner = withVar(withVar(s, name, el), "index", i);
      if (typeof o.where === "string" && !condition(o.where, inner)) return;
      if (out.length >= limit) return;
      out.push(...node(o.block, inner, depth + 1, budget, comps));
    });
    return out;
  }
  if (typeof o.if === "string" && o.block !== undefined) {
    if (condition(o.if, s)) return node(o.block, s, depth + 1, budget, comps);
    return o.else !== undefined ? node(o.else, s, depth + 1, budget, comps) : [];
  }
  if (typeof o.use === "string" && o.type === undefined) {
    const c = comps[o.use];
    if (c === undefined) throw new TemplateError(`no component ${o.use}`);
    const props = o.props !== undefined ? node(o.props, s, depth + 1, budget, comps)[0] ?? null : {};
    return node(c, { ...s, vars: { ...s.vars, props } }, depth + 1, budget, comps);
  }
  if (o.type !== undefined && --budget.left < 0) throw new TemplateError(`more than ${MAX_BLOCKS} blocks`);
  const out: Record<string, Json> = {};
  for (const [k, x] of Object.entries(o)) out[k] = node(x, s, depth + 1, budget, comps)[0] ?? null;
  return [out];
}

function str(s: string, scope: Scope): Json {
  if (!s.includes("{{")) return s;
  const parts = split(s);
  if (parts.length === 1 && parts[0].ph !== undefined) {
    const v = placeholder(parts[0].ph, scope);
    return v === undefined ? s : v;
  }
  return parts.map((p) => {
    if (p.ph === undefined) return p.text!;
    const v = placeholder(p.ph, scope);
    return v === undefined ? `{{${p.ph}}}` : print(v);
  }).join("");
}

function split(s: string): { text?: string; ph?: string }[] {
  const parts: { text?: string; ph?: string }[] = [];
  let rest = s;
  for (;;) {
    const open = rest.indexOf("{{");
    if (open < 0) break;
    if (open > 0) parts.push({ text: rest.slice(0, open) });
    const close = rest.indexOf("}}", open + 2);
    if (close < 0) { parts.push({ text: rest.slice(open) }); return parts; }
    parts.push({ ph: rest.slice(open + 2, close) });
    rest = rest.slice(close + 2);
  }
  if (rest) parts.push({ text: rest });
  return parts;
}

function placeholder(raw: string, scope: Scope): Json | undefined {
  const pieces = raw.split("|").map((p) => p.trim());
  const head = /^[\p{L}\p{N}_]+/u.exec(pieces[0])?.[0];
  if (!head || !isPath(head, scope)) return undefined;
  let v: Json = lookup(pieces[0], scope.vars) ?? null;
  for (const f of pieces.slice(1)) v = filter(f, v);
  return v;
}

export function lookup(path: string, vars: Record<string, Json>): Json | undefined {
  const segs: string[] = [];
  let cur = "";
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === ".") { if (cur) segs.push(cur); cur = ""; }
    else if (c === "[") {
      if (cur) segs.push(cur);
      cur = "";
      const close = path.indexOf("]", i);
      if (close < 0) throw new TemplateError(`${path}: no ]`);
      segs.push(path.slice(i + 1, close).trim().replace(/^['"]|['"]$/g, ""));
      i = close;
    } else if (!/\s/.test(c)) cur += c;
  }
  if (cur) segs.push(cur);
  if (!segs.length || !(segs[0] in vars)) return undefined;
  let v: Json = vars[segs[0]];
  for (const s of segs.slice(1)) {
    if (Array.isArray(v)) {
      if (s === "count" || s === "length") { v = v.length; continue; }
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0 || n >= v.length) return undefined;
      v = v[n];
    } else if (v !== null && typeof v === "object") {
      if (!(s in v)) return undefined;
      v = (v as Record<string, Json>)[s];
    } else if (typeof v === "string" && (s === "count" || s === "length")) v = v.length;
    else return undefined;
  }
  return v;
}

export function print(v: Json): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, Json>)[k])]));
  return v;
}

function num(v: Json): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

export function filter(f: string, v: Json): Json {
  const colon = f.indexOf(":");
  const name = (colon < 0 ? f : f.slice(0, colon)).trim();
  const arg = colon < 0 ? undefined : f.slice(colon + 1).trim();
  switch (name) {
    case "default": {
      const empty = v === null || v === "";
      return empty ? (arg ?? "").replace(/^["']|["']$/g, "") : v;
    }
    case "upper": return print(v).toUpperCase();
    case "lower": return print(v).toLowerCase();
    case "json": return JSON.stringify(sortKeys(v));
    case "count": return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : print(v).length;
    case "number": {
      // The app prints the decimal mark of its language («2,55» in Russian); the preview, this machine's.
      const n = num(v);
      // As the app: past 1e15 as it came, no «-0».
      if (n === undefined || !Number.isFinite(n) || Math.abs(n) >= 1e15) return v;
      const d = arg !== undefined && /^\s*\d+\s*$/.test(arg) ? Math.min(Number(arg), 6) : 2;
      const s = new Intl.NumberFormat(undefined, { maximumFractionDigits: d, useGrouping: false }).format(n);
      return s === "-0" ? "0" : s;
    }
    case "bytes": { const n = num(v); return n === undefined ? v : bytes(n); }
    case "duration": { const n = num(v); return n === undefined ? v : duration(n); }
    case "ago": { const n = num(v); return n === undefined ? v : agoText(Date.now() / 1000 - n); }
    default: throw new TemplateError(`no filter ${name}`);
  }
}

/** Like macOS's ByteCountFormatter (binary): "1 MB", "1.5 KB". The app prints its own locale's units. */
export function bytes(n: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  if (Math.abs(n) < 1024) return `${n} bytes`;
  let i = 0, x = n;
  while (Math.abs(x) >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  const s = x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

export function duration(s: number): string {
  const t = Math.round(s);
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (d > 0) return h > 0 ? `${d} д ${h} ч` : `${d} д`;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  if (m > 0) return `${m} мин`;
  return `${sec} с`;
}

function agoText(s: number) { return s < 60 ? "только что" : `${duration(Math.max(0, s))} назад`; }

// MARK: Conditions

type Tok = { k: "path" | "str" | "num" | "bool" | "null" | "op" | "(" | ")"; v?: any };

export function condition(src: string, scope: { vars: Record<string, Json> }): boolean {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const truthy = (v: Json) => v === null ? false : typeof v === "boolean" ? v : typeof v === "number" ? v !== 0
    : typeof v === "string" ? v.length > 0 : Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
  const equal = (a: Json, b: Json) => {
    const x = num(a), y = num(b);
    if (x !== undefined && y !== undefined && !(typeof a === "string" && typeof b === "string")) return x === y;
    if (b === null) return a === null;
    return print(a) === print(b);
  };
  function primary(): Json {
    const t = toks[i++];
    if (!t) throw new TemplateError(`condition ${src}: cut short`);
    switch (t.k) {
      case "(": { const v = or(); if (peek()?.k !== ")") throw new TemplateError(`condition ${src}: no )`); i++; return v; }
      case "path": return lookup(t.v, scope.vars) ?? null;
      case "str": case "num": case "bool": return t.v;
      case "null": return null;
      default: throw new TemplateError(`condition ${src}: a value expected`);
    }
  }
  function unary(): Json { if (peek()?.k === "op" && peek()!.v === "!") { i++; return !truthy(unary()); } return primary(); }
  function cmp(): Json {
    const l = unary();
    const t = peek();
    if (!t || t.k !== "op" || !["==", "!=", "<", "<=", ">", ">="].includes(t.v)) return l;
    i++;
    const r = unary();
    if (t.v === "==") return equal(l, r);
    if (t.v === "!=") return !equal(l, r);
    const a = num(l), b = num(r);
    const [x, y] = a !== undefined && b !== undefined ? [a, b] : [print(l), print(r)];
    return t.v === "<" ? x < y : t.v === "<=" ? x <= y : t.v === ">" ? x > y : x >= y;
  }
  function and(): Json { let l = cmp(); while (peek()?.k === "op" && peek()!.v === "&&") { i++; const r = cmp(); l = truthy(l) && truthy(r); } return l; }
  function or(): Json { let l = and(); while (peek()?.k === "op" && peek()!.v === "||") { i++; const r = and(); l = truthy(l) || truthy(r); } return l; }
  const v = or();
  if (i !== toks.length) throw new TemplateError(`condition ${src}: extra at the end`);
  return truthy(v);
}

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { out.push({ k: c }); i++; continue; }
    if (c === "'" || c === '"') {
      const j = s.indexOf(c, i + 1);
      if (j < 0) throw new TemplateError(`condition ${s}: quote not closed`);
      out.push({ k: "str", v: s.slice(i + 1, j) }); i = j + 1; continue;
    }
    const two = s.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ k: "op", v: two }); i += 2; continue; }
    if ("<>!".includes(c)) { out.push({ k: "op", v: c }); i++; continue; }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ k: "num", v: Number(s.slice(i, j)) }); i = j; continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < s.length && /[\p{L}\p{N}_.\[\]]/u.test(s[j])) j++;
      const w = s.slice(i, j);
      out.push(w === "true" ? { k: "bool", v: true } : w === "false" ? { k: "bool", v: false } : w === "null" ? { k: "null" } : { k: "path", v: w });
      i = j; continue;
    }
    throw new TemplateError(`condition ${s}: unknown sign ${c}`);
  }
  return out;
}
