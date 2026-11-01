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
  // A live screen's own (view with "events": true; spec/protocol.md §11)
  { type: "datatable", group: "screen", use: "Any number of rows, loaded a page at a time (`more` events); sorting, editable cells, a row menu, drops.", fields: "id, columns [{id, title?, kind?, editable?}], rows, total, pageSize?, sort?, selection?, menu?, draggable?, drop?",
    example: { type: "datatable", id: "jobs", total: 50000, columns: [{ id: "id", kind: "number" }, "name"], rows: [[1, "send-mail"]], menu: [{ id: "retry", title: "Retry" }] } },
  { type: "tree", group: "screen", use: "Nodes whose children you give when one is expanded (`expand`).", fields: "id, nodes [{id, title, children?, expandable?}], menu?, drop?",
    example: { type: "tree", id: "queues", nodes: [{ id: "q", title: "default", expandable: true }] } },
  { type: "split", group: "screen", use: "Two or three panes side by side; the user's widths are remembered.", fields: "children (2–3), sizes?",
    example: { type: "split", sizes: [240], children: [{ type: "tree", id: "t", nodes: [] }, { type: "text", id: "details", text: "—" }] } },
  { type: "editor", group: "screen", use: "A code editor: colors, `change` and `complete` events.", fields: "id, text, language?, keywords?, completion?, editable?",
    example: { type: "editor", id: "q", language: "sql", text: "select 1", completion: true } },
  { type: "terminal", group: "screen", use: "Output as it comes, ANSI colors kept; append with ops.", fields: "id, text, maxLines?",
    example: { type: "terminal", id: "out", text: "ready\n" } },
  { type: "toolbar", group: "screen", use: "Buttons with symbols; each press is a `press` event.", fields: "items [{id, title, symbol?, status: bad?, action?}]",
    example: { type: "toolbar", items: [{ id: "refresh", title: "Refresh", symbol: "arrow.clockwise" }] } },
  { type: "sheet", group: "screen", use: "A form shown as a sheet; OK sends `submit` with its values.", fields: "id, title, text?, subtitle (OK), children (fields)",
    example: { type: "sheet", id: "new", title: "New job", subtitle: "Add", children: [{ type: "field", bind: "name", title: "Name" }] } },
  { type: "chart", group: "screen", use: "A live chart: give it an `id` and the program appends points (`append` op, `ui/push`); `window` — points kept.", fields: "id, chart, series [{name, values}], window? (300), labels?, unit?, height?",
    example: { type: "chart", id: "rate", chart: "line", title: "Requests/s", window: 60, series: [{ name: "shop", values: [] }] } },
];

/** What each block is for, in Russian (docs/ru/ui-kit-reference.md). */
export const USE_RU: Record<string, string> = {
  stack: "Дети друг под другом (axis vertical) или в ряд (horizontal).",
  grid: "Дети в колонках с переносом: метрики, кольца, карточки.",
  tabs: "Один ребёнок за раз, выбор — по его заголовку.",
  card: "Карточка с заголовком вокруг детей.",
  divider: "Тонкая линия.",
  text: "Текст Markdown: **жирный**, `код`, ссылки, списки.",
  metric: "Число с заголовком, единицей, строкой изменения и спарклайном.",
  gauge: "Значение от максимума — кольцом.",
  chart: "Линии, столбцы, области или круг.",
  table: "Строки и колонки текста.",
  keyvalue: "Пары «название — значение».",
  list: "Простой список.",
  timeline: "События по времени.",
  checklist: "Шаги с отметками.",
  code: "Моноширинный текст: конфиг, команда.",
  diff: "Было и стало, построчно.",
  callout: "Выделенная заметка: info, ok, warn, bad.",
  rows: "Список страницы службы: точка статуса, заголовок и подробность, текст справа, метка, меню «⋯» действий модуля, щелчок.",
  logs: "Строки журнала в тёмном колодце; ошибки красные, предупреждения жёлтые.",
  chips: "Маленькие метки с переносом.",
  message: "Пустое или ошибочное состояние: символ, заголовок, совет, кнопка.",
  search: "Капсула поиска; строки с тем же bind фильтруются по ней.",
  button: "Выполняет действие: действие модуля (run), страницу, обновление, изменение состояния, ссылку приложения, вопрос AI.",
  field: "Текстовое поле, привязанное к переменной состояния.",
  toggle: "Переключатель, привязанный к переменной состояния.",
  picker: "Выбор, привязанный к переменной состояния.",
  slider: "Число, привязанное к переменной состояния.",
  datatable: "Сколько угодно строк, подгрузка страницами (события `more`); сортировка, правка ячеек, меню строк, перетаскивание.",
  tree: "Узлы, чьих детей вы даёте при раскрытии (`expand`).",
  split: "Две или три панели рядом; ширины пользователя запоминаются.",
  editor: "Редактор кода: подсветка, события `change` и `complete`.",
  terminal: "Вывод по мере поступления, цвета ANSI сохраняются; дописывается операциями.",
  toolbar: "Кнопки с символами; каждое нажатие — событие `press`.",
  sheet: "Форма листом; OK шлёт `submit` со значениями полей.",
  "chart (live)": "Живой график: дайте ему `id`, и программа дописывает точки (операция `append`, `ui/push`); `window` — сколько точек хранить.",
};

export const STYLE = {
  fields: "style: {tone, color, background (card|well|none|<color>), font (title|headline|body|callout|caption|mono), weight, padding, radius, align, width, grow}",
  tones: ["plain", "secondary", "tertiary", "good", "warning", "attention", "bad", "accent", "info"],
  colors: ["blue", "green", "orange", "red", "yellow", "purple", "pink", "teal", "indigo", "cyan", "mint", "brown", "gray", "#RRGGBB"],
  statuses: ["ok", "warn", "bad", "off", "info"],
};

/** The ops of `ui/patch` and `ui/push` (spec/protocol.md §11.4): an event's answer or a push, by block id. */
export const OPS: [string, string, string][] = [
  ["replace", "id, block", "The block anew (its id kept)"],
  ["insert", "block, parent?, index? | after?", "A new block into a container (stack, grid, tabs, card, split, sheet) or the top"],
  ["remove", "id", "The block goes"],
  ["set", "id, props", "Fields of the block (title, value, status, items, text…); not type or id"],
  ["state", "values", "Variables of the screen"],
  ["title", "text", "The screen's title"],
  ["rows", "id, offset, rows, total?, reset?", "A page of a datatable; reset — the other loaded rows are forgotten"],
  ["update_rows", "id, rows (with ids)", "Rows in place"],
  ["insert_rows", "id, index, rows", "Rows inserted"],
  ["remove_rows", "id, ids", "Rows removed"],
  ["children", "id, node?, nodes", "A tree node's children (no node — the top)"],
  ["append", "id, text | lines | points (+ labels)", "Text to a terminal, lines to logs, points to a live chart"],
  ["clear", "id", "A terminal, logs or chart emptied"],
  ["text", "id, text", "An editor's text replaced"],
  ["select", "id, ids", "Rows (nodes) selected and shown"],
  ["sheet / close_sheet", "id / —", "A sheet shown / closed"],
  ["notice", "text, status?", "A note over the screen (empty text removes it)"],
];

export const TEMPLATES = `Templates are expanded by the app before drawing (spec/protocol.md §6):
- "{{ data.x }}" alone keeps the value's type; inside text it's printed. Roots: data, item, settings, server, props, index, context.
- Filters: default:"—", upper, lower, number, json, count, bytes, duration, ago.
- {"each": "data.units", "as": "u", "where": "u.state == 'failed'", "limit": 50, "block": {...}} — once per element.
- {"if": "item.failed", "block": {...}, "else": {...}}.
- {"use": "component", "props": {...}} — a component of the manifest's "components".
- Anything else in {{ }} is a live formula over state (e.g. {{ rate * 2 }}).
Limits: 400 blocks, 32 levels of JSON (8 levels of blocks are drawn), 2 MB.`;

const TEMPLATES_RU = `Шаблоны раскрывает приложение до рисования (spec/protocol.md §6):
- "{{ data.x }}" целиком сохраняет тип значения; внутри текста — печатается. Корни: data, item, settings, server, props, index, context.
- Фильтры: default:"—", upper, lower, number, json, count, bytes, duration, ago.
- {"each": "data.units", "as": "u", "where": "u.state == 'failed'", "limit": 50, "block": {...}} — блок для каждого элемента.
- {"if": "item.failed", "block": {...}, "else": {...}} — одно из двух.
- {"use": "component", "props": {...}} — компонент из "components" манифеста.
- Остальное в {{ }} — живая формула над state (например, {{ rate * 2 }}).
Пределы: 400 блоков, 32 уровня JSON (рисуется 8 уровней блоков), 2 МБ.`;

const GROUPS: Record<string, [string, string]> = {
  layout: ["Layout", "Раскладка"], content: ["Content", "Содержимое"], service: ["Service-page blocks", "Блоки страниц служб"],
  input: ["Inputs", "Ввод"], screen: ["A live screen's own (a view with \"events\")", "Только живого экрана (вид с \"events\")"],
};

/** The catalog as text for a model (and docs/<lang>/ui-kit-reference.md). */
export function catalogText(symbols: string[], lang: "en" | "ru" = "en"): string {
  const ru = lang === "ru";
  let s = ru
    ? "# UI-Kit SSHKipper (SDK 1)\n\nВид — {title?, status?: [{text, tone?}], state?: {переменная: значение}, events?, layout?, blocks: [...]}. Каждый блок приложение рисует само (AppKit/SwiftUI, без веб-видов).\n"
    : "# SSHKipper UI-Kit (SDK 1)\n\nA view is {title?, status?: [{text, tone?}], state?: {var: value}, events?, layout?, blocks: [...]}. The app draws every block natively (AppKit/SwiftUI, no web views).\n";
  for (const [g, [en, r]] of Object.entries(GROUPS)) {
    s += `\n## ${ru ? r : en}\n`;
    for (const b of BLOCKS.filter((x) => x.group === g)) {
      const name = g === "screen" && b.type === "chart" ? "chart (live)" : b.type;
      s += `\n### ${name}\n${ru ? USE_RU[name] ?? b.use : b.use}\n${ru ? "Поля" : "Fields"}: ${b.fields}\n${ru ? "Пример" : "Example"}: ${JSON.stringify(b.example)}\n`;
    }
  }
  s += `\n## ${ru ? "Стиль (любой блок)" : "Style (any block)"}\n${STYLE.fields}\n${ru ? "Тона" : "Tones"}: ${STYLE.tones.join(", ")}\n${ru ? "Цвета" : "Colors"}: ${STYLE.colors.join(", ")}\n${ru ? "Статусы" : "Statuses"}: ${STYLE.statuses.join(", ")}\n`;
  s += `\n## ${ru ? "Действия" : "Actions"}\n{run: "<action id>", params?} · {page: "<page id>"} · {refresh: true} · {set: {var: value | "= formula"}} · {open: "node:<id>"} · {ask: "question for the AI panel"} · ${ru ? "живые экраны" : "live screens"}: {event: "<name>", params?} · {sheet: "<sheet id>"}\n`;
  s += `\n## ${ru ? "Операции живого экрана (ui/patch, ui/push — spec/protocol.md §11.4)" : "Ops of a live screen (ui/patch, ui/push — spec/protocol.md §11.4)"}\n\n`;
  for (const [op, fields, does] of OPS) s += `- \`${op}\` {${fields}} — ${does}\n`;
  s += `\n## ${ru ? "Шаблоны" : "Templates"}\n${ru ? TEMPLATES_RU : TEMPLATES}\n`;
  s += `\n## ${ru ? "Символы (SF Symbols, которые рисует приложение; другие — кусочек пазла)" : "Symbols (SF Symbols the app draws; any other shows a puzzle piece)"}\n${symbols.join(", ")}\n`;
  return s;
}
