# The manifest

`sshkipper-module.json` at the module's root. The schema is [schemas/module.schema.json](../../schemas/module.schema.json)
(point `$schema` at it and your editor completes and checks keys); `sshkipper-module validate` checks the rest.

```json
{
  "$schema": "https://raw.githubusercontent.com/kdanet/sshkipper-sdk/main/schemas/module.schema.json",
  "sdk": 1,
  "id": "dev.acme.queues",
  "version": "1.2.0",
  "title": { "en": "Queues", "ru": "Очереди" },
  "description": "Laravel queues of the server: workers, failed jobs, retry.",
  "author": { "name": "Acme", "url": "https://acme.dev" },
  "license": "MIT",
  "icon": { "symbol": "tray.full", "color": "orange" },
  "runtime": { "kind": "server" },
  "permissions": ["exec", "sudo"],
  "settings": [ … ],
  "service": { … },
  "pages": [ … ],
  "handlers": { … },
  "actions": [ … ],
  "tools": [ … ],
  "automation": [ … ],
  "components": { … }
}
```

## Identity

| Key | |
|---|---|
| `sdk` | `1` — the protocol version. The app refuses versions it doesn't know. |
| `id` | Reverse-DNS, lowercase: `dev.acme.queues`. Unique; settings, the store and automation blocks are keyed by it. |
| `version` | Semantic version. An installed module that changes asks to be approved again. |
| `title`, `description` | A string, or one per language: `{"en": "Queues", "ru": "Очереди"}` — the app takes the user's language, then its base language, then English, then any other. |
| `icon` | `symbol` — one of [schemas/symbols.json](../../schemas/symbols.json) (others show a puzzle piece); `color` — a palette name (`blue green orange red yellow purple pink teal indigo cyan mint brown gray`, they follow the dark theme) or `#RRGGBB`. |

## Runtime and permissions

```json
"runtime": { "kind": "server" }
"runtime": { "kind": "process", "command": ["node", "module.ts"], "env": { "LOG_LEVEL": "info" } }
```

`process`: the command runs in the module's folder; a bare name (`node`, `python3`) is looked up in the usual
places and the user's login shell `PATH`; a path (`bin/agent`) must be a file of the module.

`permissions` — shown in words when the module is installed; checked where the app is in the path:

| | |
|---|---|
| `exec` | Commands on servers. **Required** for a server module with handlers (the app refuses the module without it and runs none of its scripts) and for `host.exec` of process modules |
| `sudo` | Through `sudo -n`, where the server's “Use sudo -n” is on |
| `secrets` | Secret settings (`type: "secret"`) — handed to handlers as files or through `host.secret` |
| `network` | A declaration: the program makes its own connections from this Mac (process modules). Not limited — a process module has no sandbox |
| `store` | `host.store` — the module's JSON storage on this Mac |
| `notify` | `host.notify` — notifications |

## Settings

Per connection, in the connection card under the module (Services), inherited from folders: set once on a folder,
every server in it has it.

```json
"settings": [
  { "key": "artisan", "title": "artisan path", "type": "path", "default": "/var/www/app/artisan" },
  { "key": "connection", "title": "Queue connection", "type": "choice", "default": "redis",
    "choices": [{ "value": "redis", "title": "Redis" }, { "value": "database", "title": "Database" }] },
  { "key": "token", "title": "API token", "type": "secret" },
  { "key": "queues", "title": "Queues", "type": "list", "placeholder": "default" }
]
```

Types: `text`, `number`, `bool`, `choice`, `path`, `list` (strings), `secret` (stored encrypted in the document,
never in `context.settings`). Handlers read them as `SK_SETTING_<KEY>` (server) or `ctx.settings` (process).

## Service

```jsonc
"service": {
  "detect": "detect",          // {"found": true} where the service is; without detect — only where switched on
  "summary": "summary",        // {"text": "3 of 4 run", "status": "ok|warn|bad|off"} — the tree's line and dot
  "page": "main",              // the page of the section (the first by default)
  "tree": { "handler": "queues", "page": "queue" },   // children of its tree node; a click opens that page
  "containers": true           // may run in a Docker container of the server (“Where it runs”)
}
```

On each connection the module is **Automatic** (on where `detect` finds it), **On** or **Off**.

## Pages

```json
"pages": [
  { "id": "main", "title": "Queues", "view": "views/main.json", "data": { "queues": "queues", "failed": "failed" }, "refresh": 10 },
  { "id": "queue", "title": "Queue", "view": "views/queue.json", "data": { "jobs": "jobs" } },
  { "id": "report", "title": "Report", "render": "report" }
]
```

A page is a **template** (`view` + `data`: handlers run in parallel, the template reads `data.<name>`) or **rendered**
(`render`: a handler returns the whole view). `refresh` — seconds between reloads while it's on screen (2+).
A row's `action: {"page": "queue"}` opens a page with that row as `item`; “Back” returns.

## Handlers

```json
"handlers": {
  "queues": { "script": "scripts/queues.sh", "timeout": 15 },
  "retry":  { "script": "scripts/retry.sh", "sudo": "auto" },
  "log":    { "script": "scripts/log.sh", "output": "lines" }
}
```

| Key | |
|---|---|
| `script` | Server runtime: the file run with `sh` on the server. Process runtime: not used — the key is the name the program answers. |
| `timeout` | Seconds, 30 by default. |
| `sudo` | `auto` (default): through `sudo -n` when the server allows it and the module has `sudo`; `required`; `never`. |
| `output` | `json` (default), `text`, `lines`. |

## Actions

```json
"actions": [
  { "id": "retry", "title": "Retry", "symbol": "arrow.clockwise", "handler": "retry", "risk": "change", "on": "item",
    "confirm": "Retry {{ item.count }} failed jobs of {{ item.name }}?" },
  { "id": "flush", "title": "Flush failed…", "symbol": "trash", "handler": "flush", "risk": "danger",
    "confirm": "Delete every failed job on {{ server.name }}?",
    "params": [{ "key": "older", "title": "Older than, hours", "type": "number", "default": 24 }] }
]
```

- `on: "service"` (default) — in the page's “⋯” menu; `on: "item"` — in rows that list its id in `actions`.
- `risk`: `read` runs at once; `change` asks; `danger` asks with a red button. `confirm` is the question
  (`{{ item.* }}`, `{{ params.* }}`, `{{ server.* }}`, `{{ settings.* }}`).
- `params` — a small form before it runs: `text` (always give a `pattern` when it reaches a script), `number`,
  `bool`, `choice`. Values are checked against them before anything runs.

## AI tools and automation blocks

See [AI tools and automation blocks](ai-and-automation.md).

## Components

Pieces of views used with `{"use": "name", "props": {…}}`, read as `props.*`:

```json
"components": {
  "kpi": { "type": "metric", "title": "{{ props.title }}", "value": "{{ props.value }}", "status": "{{ props.status }}" }
}
```
