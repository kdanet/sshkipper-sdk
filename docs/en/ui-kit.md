# UI-Kit

A module's page is **JSON** — a view — that the app draws with its own controls: the same cards, rows, gauges,
log wells and search capsules as its nginx, cron and Docker pages. Nothing is HTML; nothing runs in the page.
The full list of blocks with fields and examples: [ui-kit-reference.md](ui-kit-reference.md) (the MCP tool `ui_kit`
gives agents the same).

## A view

```json
{
  "title": "Queues",
  "status": [{ "text": "3 of 4 workers run." }, { "text": " video is stuck", "tone": "bad" }],
  "state": { "q": "" },
  "blocks": [
    { "type": "grid", "columns": 3, "children": [
      { "type": "metric", "title": "Jobs waiting", "value": 12, "status": "ok", "series": [{ "values": [4, 9, 12] }] },
      { "type": "metric", "title": "Failed today", "value": 3, "status": "warn" },
      { "type": "gauge", "title": "Workers", "value": 3, "max": 4 }
    ] },
    { "type": "search", "bind": "q", "subtitle": "Queue" },
    { "type": "rows", "title": "Queues", "bind": "q", "items": [
      { "id": "mail", "title": "mail", "detail": "redis · 2 workers", "status": "ok", "trailing": "0 waiting",
        "badge": "high", "actions": ["retry", "pause"], "action": { "page": "queue" } }
    ] }
  ]
}
```

- `title` — the page header (the module's page title by default); `status` — the sentence under it, in parts with
  tones, joined as written (put the spaces in the parts yourself: `"3 of 4 workers run."` + `" video is stuck"`); the
  header also has the refresh button and the “⋯” menu of `on: service` actions.
- `state` — variables of the page: `search`, `field`, `toggle`, `picker`, `slider` change them; `rows` with the
  same `bind` filter by a search; `visible: "failedOnly == false"` hides a block; formulas `{{ rate * 2 }}` read them.
- `blocks` — top to bottom. Width adapts: grids wrap, rows truncate the middle of long details.

## Blocks by purpose

| Purpose | Blocks |
|---|---|
| Layout | `stack` (vertical or horizontal), `grid`, `tabs`, `card`, `divider` |
| Numbers | `metric` (a number, a delta line, a sparkline), `gauge`, `chart` (line, bar, area, pie) |
| Lists | `rows` (a service page's list: dot, title, detail, trailing, badge, ⋯ menu, click), `list`, `table`, `keyvalue`, `timeline`, `checklist`, `chips` |
| Text | `text` (Markdown), `code`, `diff`, `callout`, `logs` (the dark well; errors red, warnings yellow) |
| States | `message` (empty or failed: symbol, title, advice, a button) |
| Input | `search`, `field`, `toggle`, `picker`, `slider`, `button` |

## Actions of buttons and rows

```jsonc
{ "run": "retry", "params": { "queue": "mail" } }   // a module action (asks first when its risk says so)
{ "page": "queue" }                                  // a page of the module; a row's item goes as item
{ "refresh": true }                                  // reload this page
{ "set": { "q": "", "failedOnly": "= !failedOnly" } }// change state ("= …" — a formula)
{ "open": "node:<id>" }                              // an app link
{ "ask": "Why is the video queue stuck?" }           // a question to the AI panel
```

A row's `actions: ["retry", "pause"]` makes its ⋯ menu (and right-click menu) of those `on: item` actions; the
row's `data` (or the row itself) is what they get as `item`.

## Statuses and tones

- `status` of blocks and rows: `ok`, `warn`, `bad`, `off`, `info` — the dot and the colour of a metric.
- `tone` of status parts, badges (`badgeTone`) and styles: `plain`, `secondary`, `tertiary`, `good`, `warning`,
  `attention`, `bad`, `accent`, `info`. A `warn` status is drawn `warning` (yellow). `attention` is a deep orange:
  in the light theme it sits close to `bad`, so keep it for an accent next to a yellow, not for «something is off».
- A badge is a label (a version, a user), grey unless you give it a tone.

## Your own look: `style`

Every block takes a `style` on top of what its kind draws:

```json
{ "type": "text", "text": "**Maintenance** until 14:00",
  "style": { "tone": "attention", "background": "orange", "padding": 10, "radius": 8, "font": "callout", "weight": "semibold" } }
```

| | |
|---|---|
| `tone`, `color` | text colour: a tone, or a palette name / `#RRGGBB` |
| `background` | `card`, `well`, `none`, or a colour (drawn faint) |
| `font`, `weight` | `title headline body callout caption mono`; `regular medium semibold bold` |
| `padding`, `radius`, `width`, `align`, `grow` | spacing and size |

Combine blocks into your own parts with `components` (see below). The app keeps the look consistent and the
contrast right in both themes; `style` lets a module have its own accents without leaving that.

## Templates

A page with `view` + `data` is a template the app expands before drawing:

```json
{ "type": "rows", "title": "Workers", "items": [
  { "each": "data.workers", "as": "w", "where": "w.queue == item.name", "limit": 100, "block": {
    "id": "{{ w.pid }}", "title": "{{ w.name }}", "detail": "up {{ w.uptime | duration }}",
    "status": "{{ w.status }}", "trailing": "{{ w.memory | bytes }}"
  } }
] }
```

- `"{{ path }}"` alone keeps the value's type (a number, a list, an object); inside text it prints. Roots: `data`,
  `item`, `settings`, `server`, `props`, `index`, `context` (`context.locale` — to localize:
  `{"if": "context.locale == 'ru'", "block": …, "else": …}`).
- Filters: `default:"—"`, `upper`, `lower`, `json`, `count`, `number` (a decimal mark of the app's language: «2,55» in Russian; `number:1` — at most one digit), `bytes` (1.2 MB), `duration` (seconds → 3 h 5 min),
  `ago` (a Unix time → 5 min ago).
- `each` (`as`, `where`, `limit`), `if` (`block`, `else`), `use` (`props`) nodes go wherever a block, a row or a
  status part goes.
- Anything else in `{{ }}` stays for the page's live formulas over `state` — so decide statuses and words in the
  handler (`"status": "bad"`), not in the template.
- Limits: 400 blocks after expansion, 32 levels of JSON (8 levels of blocks are drawn), 2 MB (the rest — under “View
  limits” below).

Check without the app: `sshkipper-ext preview <page> --data data.json` or `--run`. `sshkipper-ext validate` checks only
the templates of `views/*.json`; a view a `render` handler builds is seen only by `preview … --run`.

## View limits

A view is checked leniently, so that a page shows even with a mistake in it: keys a block doesn't know aren't read, an
unknown or broken block is left out — with a warning in the extension's log (for a development folder also as a note
above the page). What goes past the limits is cut the same way, without a word:

| | |
|---|---|
| The whole view | 2 MB of JSON, 400 blocks, 8 levels of nested blocks drawn (deeper ones aren't shown) |
| A block's text | `text`, `callout` and the like — 4 000 characters; `code`, `diff` — 12 000; `editor` — 1 000 000; `terminal` — 200 000 in the view (appended by ops — up to 1 MB) |
| Lists | `rows`, `list` and the like — 200 items; `table` — 300 rows, 12 columns, 300 characters a cell; `logs` — 2 000 lines of 2 000 characters |
| Charts | 8 series, 1 000 points |
| Titles | 200 characters |

The program's answer itself is a JSON-RPC line: at most 16 MB and at most 64 levels of nesting, the message's envelope
counted. A deeper answer isn't read (“The module sent something that isn’t JSON-RPC” in the log), and the call waits
until its timeout.

## Components

```json
"components": {
  "worker_row": { "id": "{{ props.w.pid }}", "title": "{{ props.w.name }}", "status": "{{ props.w.status }}" }
}
```

`{ "use": "worker_row", "props": { "w": "{{ w }}" } }` — inside an `each`.

## Building views in TypeScript

Process modules return views from handlers; `ui.ts` has a builder per block:

```ts
import { view, grid, metric, rows, row, search, part } from "./lib/sshkipper-sdk/index.ts";

return view([
  grid([metric("Waiting", 12, { status: "ok" }), metric("Failed", 3, { status: "warn" })], 2),
  search("q", "Queue"),
  rows(queues.map((q) => row(q.name, { id: q.name, status: q.ok ? "ok" : "bad", trailing: `${q.waiting} waiting`, actions: ["retry"] })), { bind: "q" }),
], { status: [part("3 of 4 workers run."), part(" video is stuck", "bad")], state: { q: "" } });
```

## Symbols

`symbol` fields take SF Symbols names from [schemas/symbols.json](../../schemas/symbols.json) — the set the app
draws safely everywhere; another name shows a puzzle piece (the validator warns).

## Live screens

A page with `events` is a live screen (protocol §11): the app sends what the user does to your program and applies
the ops it answers with — only the blocks they name change. Your program can also push ops by itself (live data).

```ts
import { datatable, defineModule, ops, screen, tree } from "./lib/sshkipper-sdk/index.ts";

let timer: ReturnType<typeof setInterval> | undefined;
defineModule({
  handlers: {
    render: () => screen([
      tree([{ id: "q", title: "default", expandable: true }], { id: "queues" }),
      datatable(["id", "name"], [], { id: "jobs", total: 50_000 }),
    ]),
  },
  onEvent: (e, ctx) => {
    if (e.type === "more") return [ops.rows("jobs", e.value.offset, loadPage(e.value.offset, e.value.limit))];
    if (e.type === "expand") return [ops.children("queues", e.value.node, childrenOf(e.value.node))];
    // A timer only for what the program knows by itself (here, a counter on this Mac); see “The server between events”.
    if (e.type === "open") timer = setInterval(() => ctx.push([ops.append("rate", { points: [[sample()]] })]), 1000);
    if (e.type === "close") clearInterval(timer);
    return null;
  },
});
```

The screen's own blocks: `datatable` (any number of rows, a page at a time; the app sorts what's loaded and asks you
to sort the rest), `tree` (children asked for on expand), `split`, `editor` (completion from you), `terminal` (ANSI
colors), `toolbar`, `sheet` (a form; OK sends its values), a `chart` with an `id` (append points). Context menus
(`menu`), drag and drop (`draggable`, `drop: ["files"]`) and editable cells (`editable` columns) send events too. An
answer to an event overtaken by a newer one (a second selection, more typing) is dropped by the app, so answer
quickly and don't worry about order. See [examples/screens](../../examples/screens); the app's «Инспектор экрана» (the
page's «⋯» menu) shows the block tree and every event and patch.

### Sheets

The `sheet` op shows a sheet only when it comes **in the answer to the user's own press**: `press` (a button, a toolbar
item, a row with an action), `activate` (a row's double click) or `submit` (another sheet's OK). From `ui/push`, from the
answer to `open`, `select`, `change`, `more` and the other events no sheet opens — the screen's journal (the inspector)
says “sheet “…” not shown”. A button with `{"sheet": "<id>"}` opens its sheet by itself. A sheet is captioned “Window
of the extension “<title>””, and an extension's screen tab has a “Screen of the extension “<title>”” line along its
top.

Why: a sheet is modal over the main window. If a program could open one whenever it liked, a screen in the background
could put “Session expired — enter the root password” over the user's work, indistinguishable from SSHKipper's own. The
app never asks for a document's or a server's password on an extension's screen — and the caption shows whose it is.

### The server between events

`host.exec` and `host.secret` name the server **of a call in progress**: `render`, `ui/event` (30 s), an action. A timer
started on `open` runs between calls, so:

- on a **service page** (`pages`, a service's section) `host.exec` from a timer is refused (“the server isn’t one of
  the module call’s”): live data from the server there comes by the page's `refresh` or in an event's answer;
- **screens of the `screen` and `nodeType` contributions** ([your own node type](node-types.md), protocol §14) see their
  server between events too, while they are open: the screen's node, the nodes it points at, a section's server. A
  timer with `host.exec` belongs there.

### Rows that aren't there yet

In a paged table (`total` larger than what's loaded) the app keeps only the pages it asked for (up to 200 000 rows;
those far from sight are forgotten). `update_rows` and `remove_rows` for rows it doesn't have do nothing and write “no
rows …” to the screen's journal. That's not a mistake: keep the truth in your program and give it in the answer to
`more` — the user reaches a row not loaded yet through `more` anyway. Much changed, or the order did — `rows` with
`reset: true` (and a new `total`).
