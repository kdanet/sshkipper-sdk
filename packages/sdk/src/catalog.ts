// The UI-Kit as data: every block with what it is for, its fields and an example — for the MCP tool `ui_kit` and
// docs/*/ui-kit.md. The app draws each natively with the parts of its own service pages.

export interface BlockDoc { type: string; group: string; use: string; fields: string; example: object }

export const BLOCKS: BlockDoc[] = [
  // Layout
  { type: "stack", group: "layout", use: "Children one under another (axis vertical) or in a row (horizontal).", fields: "axis, children, title?, subtitle?",
    example: { type: "stack", axis: "horizontal", children: [{ type: "button", title: "Restart", action: { run: "restart" } }] } },
  { type: "grid", group: "layout", use: "Children in columns that wrap: metrics, gauges, cards.", fields: "columns (1–6), children",
    example: { type: "grid", columns: 3, children: [{ type: "metric", title: "Requests", value: 1204 }] } },
  { type: "tabs", group: "layout", use: "One child at a time, chosen by its title.", fields: "children (each with a title)",
    example: { type: "tabs", children: [{ type: "stack", title: "Overview", children: [] }, { type: "stack", title: "Logs", children: [] }] } },
  { type: "card", group: "layout", use: "A titled card around children.", fields: "title, subtitle?, symbol?, children",
    example: { type: "card", title: "Replication", symbol: "arrow.triangle.2.circlepath", children: [{ type: "text", text: "In sync" }] } },
  { type: "divider", group: "layout", use: "A thin line.", fields: "—", example: { type: "divider" } },
  // Content
  { type: "text", group: "content", use: "Markdown text: **bold**, `code`, links, lists.", fields: "text, title?",
    example: { type: "text", text: "Last backup **3 h ago**." } },
  { type: "metric", group: "content", use: "A number with a title, unit, a delta line, a sparkline.", fields: "title, value, unit?, delta?, status?, series?",
    example: { type: "metric", title: "Latency", value: 42, unit: "ms", delta: "p95", status: "ok", series: [{ values: [40, 44, 39, 42] }] } },
  { type: "gauge", group: "content", use: "A value of a maximum as a ring.", fields: "title, value, max, unit?, subtitle?",
    example: { type: "gauge", title: "/", value: 71, max: 100, unit: "%", subtitle: "36 GB of 50 GB" } },
  { type: "chart", group: "content", use: "Lines, bars, areas or a pie.", fields: "chart (line|bar|area|pie), series [{name?, values}], labels?, unit?, height?",
    example: { type: "chart", chart: "line", title: "Requests/s", series: [{ name: "shop", values: [3, 5, 4, 8] }] } },
  { type: "table", group: "content", use: "Rows and columns of text.", fields: "headers, rows",
    example: { type: "table", headers: ["Queue", "Jobs"], rows: [["mail", 3], ["video", 0]] } },
  { type: "keyvalue", group: "content", use: "Name — value pairs.", fields: "items [{title, detail}]",
    example: { type: "keyvalue", items: [{ title: "Version", detail: "1.27.1" }, { title: "Uptime", detail: "12 d" }] } },
  { type: "list", group: "content", use: "A simple list of items.", fields: "items [{title, detail?, status?, symbol?}]",
    example: { type: "list", items: [{ title: "web-1", status: "ok" }] } },
  { type: "timeline", group: "content", use: "Events in time order.", fields: "items [{title, detail?, time?, status?}]",
    example: { type: "timeline", items: [{ title: "Deployed", time: "12:04", status: "ok" }] } },
  { type: "checklist", group: "content", use: "Steps with done marks.", fields: "items [{title, done}]",
    example: { type: "checklist", items: [{ title: "Dump", done: true }, { title: "Upload", done: false }] } },
  { type: "code", group: "content", use: "Monospaced text: a config, a command.", fields: "text, language?",
    example: { type: "code", language: "nginx", text: "server { listen 80; }" } },
  { type: "diff", group: "content", use: "Before and after, line by line.", fields: "before, after",
    example: { type: "diff", before: "a\nb", after: "a\nc" } },
  { type: "callout", group: "content", use: "A highlighted note: info, ok, warn, bad.", fields: "status, title, text?",
    example: { type: "callout", status: "warn", title: "Certificate expires in 5 days" } },
  // Service-page blocks
  { type: "rows", group: "service", use: "The list of a service page: a status dot, title and detail, trailing text, a badge, a ⋯ menu of the module's actions, a click.",
    fields: "items [{id, title, detail?, status?, symbol?, trailing?, badge?, badgeTone?, actions?, action?, data?}], title?, bind? (a search variable), text? (when empty)",
    example: { type: "rows", title: "Units", bind: "q", items: [{ id: "nginx.service", title: "nginx", detail: "active (running)", status: "ok", badge: "enabled", actions: ["restart"], action: { page: "unit" } }] } },
  { type: "logs", group: "service", use: "Log lines in the dark well; errors red, warnings yellow.", fields: "lines, title?, height?",
    example: { type: "logs", title: "Last lines", lines: ["12:00:01 started", "12:00:02 ERROR no such file"] } },
  { type: "chips", group: "service", use: "Small labels that wrap.", fields: "items [{title, status?, badgeTone?}]",
    example: { type: "chips", items: [{ title: "http/2" }, { title: "TLS 1.3", badgeTone: "good" }] } },
  { type: "message", group: "service", use: "An empty or failed state: symbol, title, advice, a button.", fields: "symbol, title, text?, status?, subtitle? (button title), action?",
    example: { type: "message", symbol: "tray", title: "No queues", text: "Start a worker to see one here.", subtitle: "Refresh", action: { refresh: true } } },
  { type: "search", group: "service", use: "The search capsule; rows with the same bind filter by it.", fields: "bind, subtitle? (placeholder), width?",
    example: { type: "search", bind: "q", subtitle: "Name or user" } },
  // Inputs
  { type: "button", group: "input", use: "Does an action: a module action (run), a page, refresh, set state, open an app link, ask the AI.", fields: "title, action, symbol?, status? (bad — destructive look)",
    example: { type: "button", title: "Flush", symbol: "trash", status: "bad", action: { run: "flush" } } },
  { type: "field", group: "input", use: "A text field bound to a state variable.", fields: "bind, title, subtitle? (placeholder)",
    example: { type: "field", bind: "host", title: "Host" } },
  { type: "toggle", group: "input", use: "A switch bound to a state variable.", fields: "bind, title", example: { type: "toggle", bind: "failedOnly", title: "Only failed" } },
  { type: "picker", group: "input", use: "A choice bound to a state variable.", fields: "bind, title, options [{title, value}]",
    example: { type: "picker", bind: "range", title: "Range", options: [{ title: "1 h", value: 60 }, { title: "1 d", value: 1440 }] } },
  { type: "slider", group: "input", use: "A number bound to a state variable.", fields: "bind, title, min, max, step?, unit?",
    example: { type: "slider", bind: "workers", title: "Workers", min: 1, max: 16 } },
];

export const STYLE = {
  fields: "style: {tone, color, background (card|well|none|<color>), font (title|headline|body|callout|caption|mono), weight, padding, radius, align, width, grow}",
  tones: ["plain", "secondary", "tertiary", "good", "warning", "attention", "bad", "accent", "info"],
  colors: ["blue", "green", "orange", "red", "yellow", "purple", "pink", "teal", "indigo", "cyan", "mint", "brown", "gray", "#RRGGBB"],
  statuses: ["ok", "warn", "bad", "off", "info"],
};

export const TEMPLATES = `Templates are expanded by the app before drawing (spec/protocol.md §6):
- "{{ data.x }}" alone keeps the value's type; inside text it's printed. Roots: data, item, settings, server, props, index.
- Filters: default:"—", upper, lower, json, count, bytes, duration, ago.
- {"each": "data.units", "as": "u", "where": "u.state == 'failed'", "limit": 50, "block": {...}} — once per element.
- {"if": "item.failed", "block": {...}, "else": {...}}.
- {"use": "component", "props": {...}} — a component of the manifest's "components".
- Anything else in {{ }} is a live formula over state (e.g. {{ rate * 2 }}).
Limits: 400 blocks, 12 levels, 2 MB.`;

/** The catalog as text for a model. */
export function catalogText(symbols: string[]): string {
  const groups = ["layout", "content", "service", "input"];
  let s = "# SSHKipper UI-Kit (SDK 1)\n\nA view is {title?, status?: [{text, tone?}], state?: {var: value}, blocks: [...]}. The app draws every block natively (AppKit/SwiftUI, no web views).\n";
  for (const g of groups) {
    s += `\n## ${g}\n`;
    for (const b of BLOCKS.filter((x) => x.group === g)) s += `\n### ${b.type}\n${b.use}\nFields: ${b.fields}\nExample: ${JSON.stringify(b.example)}\n`;
  }
  s += `\n## Style (any block)\n${STYLE.fields}\nTones: ${STYLE.tones.join(", ")}\nColors: ${STYLE.colors.join(", ")}\nStatuses: ${STYLE.statuses.join(", ")}\n`;
  s += `\n## Actions\n{run: "<action id>", params?} · {page: "<page id>"} · {refresh: true} · {set: {var: value | "= formula"}} · {open: "node:<id>"} · {ask: "question for the AI panel"}\n`;
  s += `\n## Templates\n${TEMPLATES}\n`;
  s += `\n## Symbols (SF Symbols the app draws; any other shows a puzzle piece)\n${symbols.join(", ")}\n`;
  return s;
}
