// A server table → folders and connections (spec/protocol.md §12). Pure: no files, no network — the app hands the
// file's text over and takes the answer back. Kept apart from module.ts so tests can call it without a program.

import type { ImportConnection, ImportCredential, ImportFolder, ImportNode, ImportResult, ImportSecret } from "./lib/sshkipper-sdk/index.ts";

/** Columns by their header in Russian or English; a table without a header has them in this order. */
const COLUMNS: Record<string, string[]> = {
  name: ["имя", "название", "name"],
  host: ["адрес", "хост", "host", "address", "hostname"],
  port: ["порт", "port"],
  user: ["пользователь", "логин", "user", "username", "login"],
  folder: ["папка", "группа", "folder", "group", "path"],
  bastion: ["бастион", "через", "bastion", "jump", "proxyjump"],
  note: ["заметка", "описание", "note", "notes", "description"],
  tags: ["теги", "метки", "tags"],
  password: ["пароль", "password"],
};
const ORDER = ["name", "host", "port", "user", "folder"];

/** RFC 4180 rows with the file line each starts on: quotes, doubled quotes, separators and line feeds inside quotes. */
export function rows(text: string, sep: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  let row: string[] = [], cell = "", quoted = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === "\n") line++; cell += ch; }
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) out.push({ cells: row, line: start });
      row = [];
      start = ++line;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push({ cells: row, line: start });
  return out;
}

/** The separator the table uses most on its first line: «,» (CSV), «;» (Excel in many locales) or a tab (TSV). */
export function separator(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((s) => [s, first.split(s).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
}

export function parseTable(text: string, opts: { ru?: boolean } = {}): ImportResult {
  const say = (ru: string, en: string) => (opts.ru ? ru : en);
  const table = rows(text.replace(/^﻿/, ""), separator(text));
  const warnings: string[] = [];
  if (!table.length) return { nodes: [], warnings: [say("Файл пуст", "The file is empty")] };
  // A header row: the first row naming a known column (else the fixed order).
  const head = table[0].cells.map((c) => c.trim().toLowerCase());
  const named = head.some((h) => Object.values(COLUMNS).some((names) => names.includes(h)));
  const index: Record<string, number> = {};
  if (named) {
    for (const [key, names] of Object.entries(COLUMNS)) {
      const at = head.findIndex((h) => names.includes(h));
      if (at >= 0) index[key] = at;
    }
  } else ORDER.forEach((k, i) => { index[k] = i; });
  if (index.host === undefined) return { nodes: [], warnings: [say("Нет столбца с адресом («адрес» / «host»)", "No address column («host»)")] };

  const top: ImportNode[] = [];
  const folders = new Map<string, ImportFolder>();
  /** The folder for «Prod/Web» (made on the way), or the top. */
  const into = (path: string): ImportNode[] => {
    const parts = path.split("/").map((p) => p.trim()).filter(Boolean);
    let list = top, key = "";
    for (const p of parts) {
      key += "/" + p;
      let f = folders.get(key);
      if (!f) { f = { type: "folder", name: p, children: [] }; folders.set(key, f); list.push(f); }
      list = f.children!;
    }
    return list;
  };
  const credentials: ImportCredential[] = [];
  const secrets: ImportSecret[] = [];
  const cell = (r: string[], k: string) => (index[k] === undefined ? "" : (r[index[k]] ?? "").trim());

  table.slice(named ? 1 : 0).forEach(({ cells: r, line }) => {
    const host = cell(r, "host");
    if (!host) { warnings.push(say(`Строка ${line}: нет адреса — пропущена`, `Line ${line}: no address — skipped`)); return; }
    if (/\s/.test(host) || host.startsWith("-")) { warnings.push(say(`Строка ${line}: адрес «${host}» не похож на адрес — пропущена`, `Line ${line}: «${host}» isn't an address — skipped`)); return; }
    const c: ImportConnection = { type: "connection", id: `row-${line}`, name: cell(r, "name") || host, host };
    const port = cell(r, "port");
    if (port) {
      const n = Number(port);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) c.port = n;
      else warnings.push(say(`Строка ${line}: порт «${port}» не число от 1 до 65535 — взят 22`, `Line ${line}: port «${port}» isn't 1…65535 — 22 is used`));
    }
    const user = cell(r, "user");
    if (user && !/\s/.test(user) && !user.startsWith("-")) c.user = user;
    const bastion = cell(r, "bastion");
    if (bastion) c.bastion = bastion;
    const note = cell(r, "note");
    if (note) c.note = note;
    const tags = cell(r, "tags").split(/[;,]/).map((t) => t.trim()).filter(Boolean);
    if (tags.length) c.tags = tags;
    // A password in the table: a credential of its own, the password apart — the app asks before it imports it.
    const password = cell(r, "password");
    if (password) {
      const id = `cred-${line}`;
      credentials.push({ id, name: `${user || "root"} @ ${c.name}`, user: user || undefined });
      secrets.push({ credential: id, kind: "password", value: password });
      c.credential = id;
    }
    into(cell(r, "folder")).push(c);
  });
  return { nodes: top, credentials, secrets, warnings };
}
