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
  tones; the header also has the refresh button and the «⋯» menu of `on: service` actions.
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
  `attention`, `bad`, `accent`, `info`.
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
  `item`, `settings`, `server`, `props`, `index`.
- Filters: `default:"—"`, `upper`, `lower`, `json`, `count`, `bytes` (1.2 MB), `duration` (seconds → 3 h 5 min),
  `ago` (a Unix time → 5 min ago).
- `each` (`as`, `where`, `limit`), `if` (`block`, `else`), `use` (`props`) nodes go wherever a block, a row or a
  status part goes.
- Anything else in `{{ }}` stays for the page's live formulas over `state` — so decide statuses and words in the
  handler (`"status": "bad"`), not in the template.
- Limits: 400 blocks after expansion, 12 levels, 2 MB.

Check without the app: `sshkipper-module preview <page> --data data.json` or `--run`.

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
