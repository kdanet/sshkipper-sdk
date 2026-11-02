# Extension protocol, SDK 1

Normative. Words MUST / SHOULD as in RFC 2119. The guides in `docs/` explain the same with examples; the words are
those of [docs/glossary.md](../docs/glossary.md). An **extension** (§10) is a package of **contributions**; a
**module** is the extension of a service, AI tools and automation blocks only. §1–§9 describe what every extension's
handlers do (written for modules, where they started), §10 the package and its contributions, §11 live screens,
§12–§16 the contributions a program answers by its own methods. A database driver speaks its own protocol:
[database.md](database.md).

| § | |
|---|---|
| 1–3 | The model, a handler's call, scripts on the server |
| 4 | A program on this Mac: JSON-RPC over stdio, what each side may ask |
| 5–6 | Pages and templates |
| 7 | Packages (`.sshkext`, `.sshkmod`) and versions |
| 8–9 | Automation blocks, AI tools |
| 10 | Extensions: the manifest's `contributes` |
| 11 | Live screens: `ui/event`, ops, `ui/push` |
| 12 | Storages and sources; `host/forward`, `host/oauth` |
| 13 | Model providers |
| 14 | Node types and their screens; `host/open`, `host/ask` |
| 15 | Importers |
| 16 | Consoles |

## 1. Model

A module is a folder (or a `.sshkmod` archive of it) with `sshkipper-module.json` at its root
(`schemas/module.schema.json`). It describes **one** integration — a service of a server (systemd, a queue, a
self-written backend) or an outside system — and contributes to the app:

| Contribution | Manifest | Where the user sees it |
|---|---|---|
| Service of a server | `service` | «Службы» of a connection, a node in the tree, a section of the server's services tab |
| Pages | `pages` | The section (or a tab), drawn natively from UI-Kit blocks |
| Actions | `actions` | The page's «⋯» menu and row menus; change/danger ask first |
| AI tools | `tools` | The agent, under the server's AI mode and confirmations |
| Automation blocks | `automation` | The automations library |
| Settings | `settings` | The connection card, inherited from folders |

All work is done by **handlers**: named units the app calls with an input and gets JSON back. Where a handler runs
is the module's **runtime**:

- `server` — each handler is a shell script of the module. The app runs it on the server over its SSH session
  (bastions, 2FA and ControlMaster as for everything else), through `docker exec` when the service lives in a
  container, through `sudo -n` when allowed. Nothing runs on the Mac.
- `process` — a program of the module on this Mac (any language) speaking JSON-RPC 2.0 over stdio. It may ask the
  app to run commands on servers (`host/exec`) instead of logging in itself.

The app never loads module code into its own process and never shows HTML: pages are JSON the app draws with its
own components (`schemas/view.schema.json`).

## 2. Calling a handler

Every call carries the same **request**:

```json
{
  "handler": "list_units",
  "input": { "unit": "nginx.service" },
  "context": {
    "server": { "id": "6F1C…", "name": "web-1", "host": "10.0.0.5", "user": "deploy" },
    "container": "app-1",
    "settings": { "scope": "system", "show_inactive": false },
    "item": { "id": "nginx.service", "state": "failed" },
    "locale": "ru",
    "sdk": 1, "app": "1.0.1704"
  }
}
```

- `input` — parameters of an action, tool or automation block, already checked against their `params`.
- `context.item` — the row an `on: item` action or a tree item page works on.
- `context.settings` — the connection's settings of this module, inherited from folders. Settings of type
  `secret` are NOT in it (see §3.3, §4.3).
- `context.container` — present when the service runs in a container.

The **response** is the handler's JSON value (any JSON). By convention:

| Handler used as | Returns |
|---|---|
| `service.detect` | `{"found": true}` (optionally `"version": "252"`) |
| `service.summary` | `{"text": "3 из 4 работают", "status": "ok" \| "warn" \| "bad" \| "off"}` |
| `service.tree.handler` | `{"items": [{"id", "title", "subtitle"?, "status"?, "symbol"?}]}` |
| `pages[].data` | Anything; the template reads it as `data.<name>` |
| `pages[].render` | A view (`view.schema.json`) |
| action / tool / automation | `{"message": "Перезапущен", "status": "ok"}`, or any JSON — tools give it to the model, automations to the next block |

An error is a failed call (§3.4, §4.4); its message is shown to the user, given to the model or fails the block.

## 3. Server runtime

### 3.1 How a script runs

A server module needs the `exec` permission: without it the app refuses the module and runs none of its scripts. The
app runs `detect` (and `summary`) by itself only on servers where the module's service is switched on — or on every
connected server when the user allowed that when installing it.

The app runs `sh` on the server (through `docker exec <container> sh` when in a container, through `sudo -n sh`
when the handler's `sudo` and the server's settings allow it). The script gets:

- **stdin** — the request (§2) as one JSON line, then EOF.
- **environment**:
  - `SK_HANDLER`, `SK_MODULE`, `SK_SDK=1`, `SK_LOCALE`;
  - `SK_INPUT_<KEY>` for each top-level input value (strings; numbers as text; booleans `1`/`0`; a list or an
    object as its JSON text, `["a","b"]` — the full value is in the request on stdin);
  - `SK_SETTING_<KEY>` for each non-secret setting, the same way (a `list` setting — `["a","b"]`; if the server has
    `jq`, read it from `context.settings` of the request instead; a process module (§4) gets a real array
    there — `http-checks` reads its `urls` that way);
  - `SK_ITEM_ID` when there is an item;
  - `SK_CONTAINER` — the container's name when the service runs in one;
  - `SK_AUTOMATION=1` when the handler runs as an automation block (§8);
  - `SK_TMP` — a private temporary directory (0700), removed after the run;
  - `SK_SECRET_<KEY>` — the **path** of a 0600 file holding a secret setting (never its value).
  Keys are upper-cased. Values are passed through the session, not on the command line: other users of the server
  can't see them in `ps`.
- **In a container** (`service.containers`, the service runs in Docker): the handler's script — with the request,
  the plain settings and the item — goes to `docker exec` as an argument, so any user of the server (unless `/proc` is
  mounted with `hidepid`) and the container's own processes can see it in `ps` while it runs. Secret settings never
  go into a container (`SK_SECRET_*` are not set there). `sudo` of the handler doesn't apply inside: it runs as
  `docker exec`'s user and the server's «Use sudo -n» isn't required for it (the server's «sudo for docker» decides
  only how docker itself is called) — the validator warns about `sudo: required` in such a module.
- **The SDK prelude** (§3.5) is defined before the script.
- **Its own folder is not on the server.** Scripts run from the module package each time; nothing is installed.
  A module MAY ship more files under `scripts/` and read them with `sk_file <path>` (they travel with the call).

### 3.2 Output

- `output: json` (default) — stdout MUST be one JSON value. Trailing whitespace is ignored.
- `output: text` — stdout as one string.
- `output: lines` — stdout as an array of lines without the trailing newline.
- stderr is the handler's log: shown in the module log (and under a failed action), never parsed.
- At most 8 MB of stdout is read; past it the call fails.

### 3.3 Sudo

`sudo: auto` (the default) runs the script through `sudo -n` when the server's «Использовать sudo -n» is on and the
module declares the `sudo` permission; otherwise as the user. `required` fails with a clear message when sudo isn't
allowed; `never` never uses it. A script MUST NOT call `sudo` itself (it would hang waiting for a password).

### 3.4 Errors and limits

- A non-zero exit code is an error; its message is the last non-empty stderr line (or `exit N`).
- `timeout` (30 s by default) stops the whole process group on the server.
- Closing the page, the tab or the app stops what runs for it the same way.

### 3.5 The SDK prelude

Defined before each script (POSIX sh, no dependencies — `jq` is not assumed):

| Function | Does |
|---|---|
| `sk_json_string <text>` | Prints `<text>` as a JSON string (quotes, escapes, control characters). |
| `sk_json_kv <key> <value> [<key> <value>…]` | Prints a JSON object of strings. |
| `sk_fail <message>` | Prints the message to stderr and exits 1. |
| `sk_has <command>` | True when the command is on `PATH`. |
| `sk_file <relative path>` | Prints a file of the module's `scripts/` folder (shipped with the call). |
| `sk_secret <key>` | Prints a secret setting (reads `$SK_SECRET_<KEY>`). |

## 4. Process runtime

### 4.1 Transport

`runtime.command` starts in the module folder with a clean environment (`PATH` — the program's own folder, then
`/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin`, fixed; `HOME`, `TMPDIR`, `LANG`, `SK_SDK=1`,
`SK_MODULE`, `SK_DATA` — a private folder for the module's files, `PYTHONPYCACHEPREFIX` under it (Python's byte code is
read and written there, never in the module folder), plus `runtime.env` — except variables that load code from
outside the module: `DYLD_*`, `LD_*`, `*_OPTIONS`, `*OPT`, `PYTHONSTARTUP`, `PYTHONPATH`, `PYTHONPYCACHEPREFIX`,
`NODE_PATH`, `PHPRC`, `PERL5DB`, `BASH_ENV`… are refused by the check and never set, and the app's own `PATH`, `HOME`,
`TMPDIR`, `LANG`, `SK_*` can't be changed). Arguments of `runtime.command` are files of the package: an absolute path,
`~` or `..` (also after `=`, `--require=/tmp/x.js`) is refused by the check. The program runs with the user's rights and **no sandbox**. **The module folder is read-only for the module**: an
installed module's files are hashed and approved, and a file written there (a cache, a log) reads as a changed module,
which stops until the user approves it again — write state to `SK_DATA` or `host/store`. `.git` and `.DS_Store` are
never part of a module. Messages are JSON-RPC 2.0 objects, **one per line**
(UTF-8, `\n`-terminated, no embedded newlines) on stdin (app → module) and stdout (module → app). stderr is the
module's log. Both sides MAY send requests; ids are unique per sender. A line longer than 16 MB ends the process.

The app starts the program on first use and keeps it while the module is used; it stops it (`shutdown`, stdin closed,
then SIGTERM to its process group after 3 s and SIGKILL to what is left 2 s later; at quit at once) when the module is
disabled, updated or removed, after ten minutes without calls, when a document locks and the program worked for
one of its servers (it may hold that document's secrets or output), when no unlocked document is left, or when the
app quits. A program serving only other open documents keeps running when one document locks. A program that exits
is started again on the next call.

### 4.2 App → module

| Method | Params | Result |
|---|---|---|
| `initialize` | `{"sdk": 1, "app": "1.0.1704", "module": {"id", "version"}, "locale": "ru"}` | `{"handlers": ["list_units", …]}` — the names it answers |
| `handler/call` | the request of §2 | the handler's JSON value |
| `cancel` (notification) | `{"id": <id of a handler/call>}` | — the call should end (the app no longer waits) |
| `ui/event` | `{"event", "context"}` — a live screen's event (§11.3) | ops (and completions) |
| `import/parse` | `{"importer", "name", "size", "data", "locale"}` — a file to import (§15) | `{"nodes", "credentials"?, "secrets"?, "warnings"?}` |
| `console/open` | `{"console", "session", "cols", "rows", "node", "context"}` — a console to open (§16) | `{}` once it is open |
| `console/input`, `console/resize`, `console/close` (notifications) | `{"session", …}` (§16) | — |
| `storage/…`, `source/…` | `{"storage" \| "source", …}` — a storage's or source's own methods (§12) | as §12 says |
| `ai/models`, `ai/chat`; `ai/cancel` (notification) | a model provider's (§13) | `{"models"}`; the answer, after `ai/delta` notifications |
| `shutdown` | `{}` | `null`; then the module SHOULD exit |

The program MUST answer `initialize` within **15 seconds** of starting; the app then ends it and the call fails with
«… запустилась, но не ответила на initialize (Модуль не ответил за 15 с)». A program that never got to run says why
instead: macOS keeps the file in quarantine, or the system stopped it (a signal — unsigned, built for another Mac). The SDKs answer it after their `setup` hook (`defineModule({ setup })`,
`Extension.setup`): keep that hook short and do slow work (warming a cache, a first connection) lazily, on the first
call that needs it. Calls the app sends meanwhile wait for `setup`.

### 4.3 Module → app

| Method | Params | Result | Permission |
|---|---|---|---|
| `host/exec` | `{"server": "<context.server.id>", "command": "…", "stdin"?: "…", "timeout"?: 30, "sudo"?: false, "container"?: "…"}` | `{"exitCode", "stdout", "stderr"}` | `exec` (`sudo` for sudo) |
| `host/secret` | `{"server": "<id>", "key": "<secret setting key>"}` | `{"value": "…"}` | `secrets` |
| `host/store/get` | `{"key": "…"}` | `{"value": <json> \| null}` | `store` |
| `host/store/set` | `{"key": "…", "value": <json> \| null}` | `null` | `store` |
| `host/notify` | `{"title": "…", "text": "…"}` | `null` | `notify` |
| `host/log` (notification) | `{"level": "debug"\|"info"\|"warn"\|"error", "message": "…"}` | — | — |
| `ui/push` (notification) | `{"screen": "…", "ops": […]}` — ops to one of its live screens (§11.5) | — | — |
| `console/data`, `console/closed` (notifications) | `{"session", "data"}` / `{"session", "reason"?}` — a console's output, its end (§16) | — | — |
| `ai/delta` (notification) | `{"id", "type", …}` — a piece of a model provider's answer (§13) | — | — |
| `host/forward`, `host/oauth` | a port forwarded through the app's SSH session; a browser sign-in (§12.3) | §12.3 | `forward`, `oauth` |
| `host/secret {node}`, `host/open`, `host/ask` | an extension node's secret field; open a node, screen or terminal; ask the user (§14.3) | §14.3 | `secrets` (`node`) / — |

`host/exec` runs over the app's session to that server, the same way as the server runtime (bastions, 2FA,
containers); only the servers of calls **in progress** (their `context.server.id`) may be named — and, for an
extension, the servers its open screens and consoles point at (§14): between calls a program reaches only those.
Without `container` the command runs on the server itself, also for a call whose service runs in a container: a
program names `"container": context.container` to run inside it — the SDKs never fill it in. `stdin` and `container`
don't go together (a container's command line is readable on the server); the request fails with `-32602`. A method the
module may not use returns error `-32001` ("permission").

### 4.4 Errors

JSON-RPC errors. Codes: `-32700` parse, `-32600` invalid request, `-32601` method not found, `-32602` invalid
params, `-32000` handler failed (its `message` is shown), `-32001` permission, `-32002` cancelled, `-32003` timeout.

## 5. Pages

A page is either a **template** (`view` + `data`) or **rendered** by a handler (`render`). The app:

1. calls the `data` handlers (in parallel) or the `render` handler;
2. expands the template (§6) with `data`, `item`, `settings`, `server`;
3. draws the view natively: the page header (title, the `status` sentence, refresh, the «⋯» menu of
   `on: service` actions), then the blocks.

`refresh` reloads while the page is on screen. Actions with `refresh: true` buttons, `run` buttons and finished
actions reload the page.

## 6. Templates

Template expansion is done by the app on the JSON of a view before drawing:

- `"{{ path }}"` — a value from `data.*`, `item.*`, `settings.*`, `server.*`, `props.*`, `index`, `context.*`
  (`context.locale` — `ru`, `en`…: `{"if": "context.locale == 'ru'", …}` localizes a template). A string that is
  only a placeholder keeps the value's type (number, array…); inside text it is printed (`"{{ item.name }} — up"`).
  A missing path prints nothing. Filters: `| default:"—"`, `| upper`, `| lower`, `| number` (the decimal mark of the app's language: «2,55» in Russian; `| number:1` — at most one digit), `| bytes` (1.2 МБ),
  `| duration` (seconds → «3 ч 5 мин»), `| ago` (a Unix time → «5 мин назад»), `| json`, `| count`.
- `{"each": "data.units", "as": "unit", "where": "unit.state == 'failed'", "limit": 50, "block": {…}}` — the block
  once per element (`index` is its number from 0).
- `{"if": "item.failed", "block": {…}, "else": {…}}` — one or the other.
- `{"use": "unit_row", "props": {…}}` — a component of the manifest's `components`, with `props.*`.
- Conditions: paths, literals (`'text'`, numbers, `true`, `false`, `null`), `== != < <= > >=`, `&& || !`,
  parentheses.
- Anything else in `{{ }}` (a formula over `state`, e.g. `{{ rate * 2 }}`) is left for the view's own formulas,
  evaluated live as the user changes inputs.

Limits: 400 blocks after expansion, 32 levels of JSON nesting (the app draws 8 levels of blocks), 2 MB of JSON.

## 7. Packages and versions

- `sdk` in the manifest is the major version of this protocol. The app runs modules of the SDK versions it knows and
  refuses others with a clear message.
- A `.sshkmod` is a ZIP of the module folder (the manifest at its root); a `.sshkext` is the same for an extension
  (§10). Before unpacking, the app reads the archive's table of contents: more than 2 000 files or 64 MB unpacked, a
  path with `..` or a leading `/`, or a symbolic link refuses the archive; `__MACOSX` is left out. Installing records
  the SHA-256 of every file; a changed file disables the module until it is approved again, and a program's files are
  hashed again **before every start** — a file changed, added or removed since stops it from starting. A module linked from a folder (development)
  is reloaded when its files change and is marked «из папки».
- Files a package may hold: the manifest, `views/*.json`, `scripts/**`, `assets/**`, the program and its files.
  At most 2 000 files and 64 MB. Every file is hashed (`node_modules` too); only `.git` folders and `.DS_Store`
  files are left out, and an install doesn't copy them.

## 8. Automation blocks

An `automation` entry is a block of the automations library (its section «Из расширений», From extensions). A server module's block
runs as a script on its server (below); a **process module's block** calls its handler in the program on this Mac
(§8.1).

- The block has one input, a **server**, and the parameters of its `params` (set on the card).
- The app makes one script of the handler: the card's values become `SK_INPUT_<KEY>` (checked as on a page:
  `required`, numbers, `choices`, `pattern` — here as a POSIX ERE, so keep patterns to what both ERE and ICU read the
  same), the request comes on stdin with `context.automation: true` and no server, the handler runs as on a page.
- Settings take their **defaults**: a card has no connection settings of its own. Secret settings don't reach
  automations; pass what varies as block parameters.
- `sudo: required` runs the block through `sudo -n` (the server must allow it); `auto` runs it as the user.
- `returns` says what goes to the next block: `text`, `number` and `list` are read from stdout as the automations'
  «Что вернуть» does; `json` (default) also becomes the block's summary — `{"status": "ok" | "warn" | "error",
  "summary" (or "message"), "value", "unit", "items": [{"label", "status", "value", "detail"}], …}`; other keys
  become values the next blocks read as `{{ in.<key> }}`.
- The block's id in graphs is derived from the module id and the block id, so an automation shared with someone who
  has the module installed finds the block.

### 8.1 Blocks of a process module

- The app calls the handler as a page's (`handler/call`, §4.2): `input` — the card's parameters, typed (`text`,
  `number`, `bool`, `choice`) and checked as an action's are (`required`, a number, one of `choices`, `pattern` matched
  whole, `default`; a key the block doesn't declare isn't sent, a switch never touched is `false`) — a value that
  fails fails the step before the program is called; `context.settings` — the module's settings; no `item`.
- `server: true` gives the block a **server** input: `context.server` is that server, and the program's `host/exec`
  there goes through **the automation's sessions** — its server profile, its line of logins, and «without a person»
  for a run by the schedule: a 2FA code nobody can type makes the step wait for a person (the call gets an error for
  that `host/exec`, the step shows «нужен человек»), as a command's step would. It needs `exec`. Without `server`
  the block has no server, and `host/exec` is refused.
- The answer is the block's result as the server block's `$SK_RESULT` is: with `returns: json` (default) an object
  `{status, summary, value, unit, items: [{label, value, unit, status, detail}], …}`; with `text`, `number`, `list` — a
  string (or an object's `value` / `text` / `summary`; an array — one line per element) read as «Что вернуть». An
  error of the handler fails the step with its message alone.
- The approval window shows «программа расширения» on this Mac, the handler and the parameters, and the block's
  `risk` (`read` / `change` / `danger`) from the manifest.
- Cancelling the run cancels the call (`cancel`, §4.2 — the handler's `signal` aborts). The handler's timeout is the
  step's.
- «На сервере по cron» can't run it — the program is on this Mac: installing such an automation on a server is
  refused with the block's name.

## 9. AI tools

A `tools` entry is offered to the app's agent through two fixed tools, `module_tools` (what the modules of a server
offer, with parameters) and `module_call` (call one). The list the model sees doesn't grow with modules, so the
prompt cache holds.

- The model gives `target` (an open session), `module`, `tool` and `input`; the input is checked against `params`
  (types, `required`, `choices`, `pattern` as a full match) and unknown keys are dropped.
- `risk` goes through the server's AI mode like any command: `read` — as a check, `change` — as a service action,
  `danger` — as a disruptive one; the user confirms what the mode asks for.
- The answer is the handler's JSON (or text), with secrets masked, cut to what a model reads.
- `description` is what the model reads to choose the tool: say what it does, what it returns and when to use it.

## 10. Extensions

A module is one kind of **extension**. An extension package is a folder (or a `.sshkext` archive of it) with
`sshkipper-extension.json` at its root. The manifest is the module manifest (`schemas/module.schema.json`, the same
fields, the same `sdk`) plus `contributes` — what it adds to the app. A folder holds one manifest: both
`sshkipper-extension.json` and `sshkipper-module.json` is an error. `sshkipper-module.json` and `.sshkmod` stay valid
and read as extensions unchanged.

| Contribution | Manifest | Protocol |
|---|---|---|
| `service`, `tools`, `automation` | `contributes.*` or the top level (not both) | §1–§9 |
| `database[]` | `id` (engine, never a built-in one), `title`, `model` (`sql` / `keyValue` / `document`), `defaultPort`, `isFile`, `hasSchemas`, `hasEditorTransactions`, `identifierQuote` (`"` or `` ` ``), `keywords`, `functions`, `readCommands` (trusted only for library extensions), `logo` (`si:<slug>`), `command` (its own program; else `runtime`, started apart with `SK_ROLE=database`). The driver speaks the database protocol — [database.md](database.md) | database.md |
| `storage[]` | `id` (kind), `title`, `signIn` (`keys` / `login` / `browser` — needs `oauth` / `none`), `fields` (settings, §3.3 kinds), `capabilities` | §12 |
| `source[]` | `id` (kind), `title`, `fields`, `refresh` (s, 60…86400) | §12 |
| `nodeType[]` | `id`, `title`, `icon`, `fields` (settings and `node` links, §14), `screen` (an id of `contributes.screen`) | §14 |
| `screen[]` | `id`, `title`, `placement` (`tab` / `section` / `panel`), `render` (a handler building the view) | §11, §14 |
| `import[]` | `id`, `title`, `description`, `fileExtensions` (no dot, or `*`), `maxSizeMB`; the program answers `import/parse` | §15 |
| `console[]` | `id`, `title`, `description`, `appliesTo` (`connection` — the default — and node types of the extension); the program answers `console/open` | §16 |
| `ai[]` | `id`, `title`, `icon`, `description`, `fields` (the profile's settings; `secret` ones kept in the keychain), `reasoning` (levels) | §13 |

- Every contribution has an `id` (`^[a-z][a-z0-9_-]{0,39}$`, unique within its kind), a `title` (text or per
  language) and an optional `icon`. Built-in kinds and engines (`mysql`, `s3`, `tailscale`…) are never replaced.
- `database`, `storage`, `source`, `import`, `console` and `ai` are answered by a program on this Mac: they need the
  `process` runtime (a `database` may name its own `command`).
- A key of `contributes` this app doesn't know is an error (with the list of known ones); a manifest of a newer `sdk`
  is refused before its fields are read.
- Permissions add `forward` (`host/forward`: a port forwarded through the app's SSH session of a server) and `oauth`
  (`host/oauth`: a sign-in through the browser, the token kept as the node's secret) — §12.3.
- An update that adds a contribution, like one that adds a permission, is installed **switched off** until the user
  switches it on.
- Trust: an extension installed from any file is shown as «Автор не проверен»; extensions of SSHKipper's library
  (signed by SSHKipper) as «Проверено SSHKipper».
- A program serves every contribution of its extension: handlers through `handler/call` (§4.2), a contribution's own
  methods (`ui/event`, a storage's `storage/list`… — §11–12) as JSON-RPC requests on the same connection. A
  database driver is the exception: a separate process speaking the database protocol ([database.md](database.md)).

## 11. Live screens

A page whose view has `events` is a **live screen**: the app keeps its state, sends what the user does to the module
(`ui/event`) and applies the module's answer — **ops** that change only the blocks they name (`ui/patch`). A program may
also send ops by itself at any time (`ui/push`): live data. Selection, scrolling and sorting of the rows already loaded,
typing, a sheet's fields — the app does them by itself, without asking.

### 11.1 The view

| Field | Meaning |
|---|---|
| `events` | `true` — the program answers (`ui/event`, a process module); a handler's name — that handler of a server module answers, with the event as its input `event` (`SK_INPUT_EVENT`, and the request on stdin). Without `events` a page is a plain view: nothing is sent. |
| `layout` | `fill` — the screen takes the whole area (a split, a big table to the bottom edge) instead of scrolling. |

A server module can't push (nothing runs between calls); a process module can.

### 11.2 Blocks of a live screen

Besides every block of a view (`schemas/view.schema.json`), a live screen reads these. Each MUST have an `id` to be
patched (the app gives one to those without, but a program can't name it).

| Block | Fields | Events |
|---|---|---|
| `datatable` | `columns` [{id, title, width, kind: text\|number\|date, sortable, editable}], `rows` — the first ones (cells in column order, or `{id, cells \| values, status, data}`), `total`, `pageSize` (200), `sort`, `selection` none\|single\|multiple, `menu`, `draggable`, `drop` [files, rows] | `more {offset, limit}` when rows in sight aren't loaded; `sort {column, ascending}` when not every row is loaded (all loaded — the app sorts itself); `select {rows}`; `activate {row, data}` (double click); `edit {row, column, value}`; `menu {item, rows}`; `move {rows, to}`; `drop {paths, source, target, position}` or `drop {rows, from, target}` |
| `tree` | `nodes` [{id, title, detail, symbol, status, badge, children, expandable, data}], `selection`, `menu`, `drop` | `expand {node}` for a node with `expandable` and no `children`; `collapse {node}`; `select {nodes}`; `activate {node}`; `menu {item, nodes}`; `drop {paths, target}` |
| `split` | `children` — 2 or 3 panes; `sizes` — widths but the last's, points (the user's widths are remembered per screen and block) | — |
| `editor` | `text`, `language` (sql, sh, python, js colored), `keywords`, `completion`, `editable` | `change {text}` (half a second after typing stops); `complete {text, cursor, prefix}` — answer with `{"items": [...]}` |
| `terminal` | `text` (ANSI colors kept), `maxLines` (5000) | — (append with ops) |
| `toolbar` | `items` [{id, title, symbol, status: bad, action}] | `press {item}` |
| `sheet` | `title`, `text`, `subtitle` — the OK button, `children` — fields | `submit {values}` — the values of its fields' `bind`s; shown by a button's `{"sheet": id}` or the `sheet` op |
| `chart` with an `id` | `window` — points kept (300) | — (append points with ops) |

A button's `{"event": "name", "params": {...}}` sends `press {event, params}`; a row's item with such an action — also
`item`. An input (`field`, `toggle`, `picker`, `slider`, `search`) with an `id` sends `change {bind, value}` when its
value changes (fields in a sheet go with its `submit`).

Files dropped from the app's file panel come as their paths on that panel's server (`source: "pane"`); from Finder —
paths on this Mac (`source: "finder"`).

### 11.3 `ui/event` (app → module)

| | |
|---|---|
| Params | `{"event": {"screen", "seq", "type", "block"?, "value"?, "state"}, "context": <as in §2>}` |
| Result | `[op, …]`, `{"ops": [op, …], "items": [completion, …]}` or `null` |

`type` is one of `open`, `close`, `press`, `activate`, `select`, `change`, `submit`, `expand`, `collapse`, `more`,
`sort`, `edit`, `menu`, `drop`, `move`, `complete`. `open` comes when the screen is shown (a program may start pushing),
`close` when it goes. `state` — the screen's variables now. For a process module the call counts as a call on the
page's server: `host/exec` and `host/secret` may name `context.server.id` while it runs. Its timeout is 30 s.

**Order.** Events are numbered (`seq`). An answer the app gets after a newer event of the same kind was sent is
**dropped**: `select`, `change`, `complete`, `sort` of a block; `expand`/`collapse` of a node; `more` of a table sorted
anew since. Presses, submits, edits, menus and drops are never dropped (each is its own). Everything asked before a
screen is loaded anew (another page, a reload) is dropped. A program SHOULD answer within half a second: past it the
screen shows «waiting for the program», and the window never waits.

### 11.4 Ops (`ui/patch`)

Applied in order; an op that can't apply (an unknown id, a block that doesn't read) is reported to the author (the
screen's inspector, the module's log) and skipped — the others still apply.

| `op` | Fields | Does |
|---|---|---|
| `replace` | `id`, `block` | The block anew (its id kept) |
| `insert` | `block`, `parent`? (a container: stack, grid, tabs, card, split, sheet; none — the top), `index`? or `after`? | A new block |
| `remove` | `id` | The block goes |
| `set` | `id`, `props` | Fields of the block (`title`, `value`, `status`, `items`, `text`…); not `type`, `id` |
| `state` | `values` | Variables of the screen |
| `title` | `text` | The screen's title |
| `rows` | `id`, `offset`, `rows`, `total`?, `reset`? | A page of a datatable; `reset` — every other loaded row is forgotten (a new sort, a new filter) |
| `update_rows` | `id`, `rows` (with ids) | Rows in place — only they are drawn again |
| `insert_rows` | `id`, `index`, `rows` | Rows inserted; those below move |
| `remove_rows` | `id`, `ids` | Rows removed |
| `children` | `id`, `node`? (none — the top), `nodes` | A tree node's children |
| `append` | `id`, `text` \| `lines` \| `points` (+ `labels`) | Text to a terminal, lines to `logs`, points to a chart (each point — a value per series) |
| `clear` | `id` | A terminal, logs or chart emptied |
| `text` | `id`, `text` | An editor's text replaced |
| `select` | `id`, `ids` | Rows (nodes) selected and shown |
| `sheet` / `close_sheet` | `id` / — | A sheet shown / closed |
| `notice` | `text`, `status`? | A note over the screen (empty `text` removes it) |

A completion: `"status"` or `{"title", "insert"?, "detail"?}`.

Limits: 8 MB of an answer, 2 000 ops, 10 000 rows (row ids) an op, 10 000 000 rows a table (the app keeps up to
200 000 loaded — pages far from sight are forgotten and asked again), 50 000 nodes a tree, 400 blocks a screen; a
`terminal` keeps its last `maxLines` lines and at most 1 MB of text, breaks a line longer than 16 KB, and reads `\r`
as a carriage return (the text after it starts its line anew — a progress bar).

- Numbers are counts and places: `offset`, `index`, `total` move into `0 … 10 000 000` (a fraction is rounded);
  rows past 10 000 000 aren't kept and the op says how many («строки дальше … не показываются»). Rows past 10 000 an
  op are left out the same way. A `reset` (a new sort or filter) drops the answers to `more` asked before it.
- The answer and `ui/push` are read off the main thread; the ops of one answer or push are applied together — a table
  is drawn again once for thousands of row ops, not once each.

### 11.5 `ui/push` (module → app, a notification)

`{"screen": "<event.screen>", "ops": [...]}` — the same ops. The app applies pushes only to screens of the module
that sends them, gathers those coming faster than it draws (applied together, at most 5 000 waiting), and drops them
once the screen is closed. A program learns a screen's id from its events (`open` first).

## 12. Storage and source contributions

A program answers a contribution's own methods as JSON-RPC requests on the connection of §4 (the SDK:
`defineModule({ handlers: {}, methods: { ...storageMethods(impl), ...sourceMethods(impl) } })`). They come after
`initialize`, can be cancelled like `handler/call` (`cancel` with the request's id), and fail with the errors of §4.4
(the `message` is shown to the user). The app never sends a method a contribution doesn't declare (`capabilities`).

### 12.1 Storage («Вклад storage»)

Every call carries `storage` — which storage node it is for:

```json
{"node": "<uuid>", "kind": "folder", "settings": {"root": "/tmp/x", "token": "…"}, "readOnly": false, "throughServer": false}
```

`settings` holds every field of the contribution's `fields` (its value, else its `default`); a `secret` field comes as
text — the program is trusted with its own node's secrets, and only with a record that is that node's field and
nothing else's. A browser sign-in's token comes as `settings.oauth`. Paths are `/`-rooted inside the storage (`/`,
`/a/b.txt`); the app drops entries whose names are empty, have `/` or NUL, or are `.` / `..` — in every answer, for
the file panel, automations and folder pickers alike. An item:

```json
{"name": "b.txt", "type": "file" | "folder", "size": 11, "modified": 1767225600, "digest": {"algorithm": "sha256" | "md5", "value": "<hex>"}}
```

`modified` — seconds since 1970, or an ISO 8601 date and time (`2026-01-01T00:00:00.000Z`, fractional seconds and an
offset optional; without an offset it is UTC); `digest` — optional: the app checks the downloaded file
against it and fails the download on a mismatch.

| Method | Params (besides `storage`) | Result | Capability |
|---|---|---|---|
| `storage/list` | `path` | `{"items": [item…]}`; a missing folder is an error | — |
| `storage/stat` | `path` | `{"item": item \| null}` (null — nothing there) | — |
| `storage/read` | `path`, `offset`, `length` (1 MiB) | `{"data": "<base64, ≤ length>", "eof": bool}` | — |
| `storage/write/begin` | `path`, `size`, `modified`? | `{"upload": "<id>"}` | — |
| `storage/write/chunk` | `upload`, `offset`, `data` (base64, ≤ 1 MiB) | `{}` | — |
| `storage/write/commit` | `upload` | `{}` — the file appears at `path` now, whole | — |
| `storage/write/abort` | `upload` | `{}` — the parts go; an unknown id is not an error | — |
| `storage/mkdir` | `path` | `{}` | `folders` |
| `storage/rename` | `from`, `to` | `{}` (the app checks that `to` is free first) | `rename` |
| `storage/delete` | `path`, `recursive` | `{}` | `delete` |
| `storage/link` | `path`, `action` (`list` / `create` / `remove`), `url`?, `id`? | `list` — `{"links": [{"url", "id"?, "expires"?, "hasPassword"?}]}`; `create` — one link; `remove` — `{}` | `links` |
| `storage/check` | — | `{"text"?, "free"?, "account"?}` — «Проверить» in the card, `free` in bytes | `check` (`free` for `freeSpace`) |
| `storage/signIn` | — | `{"account"?}` — the user pressed «Войти через браузер…» | `signIn: "browser"` |

- **Reading** goes part by part: the app asks the next `offset` until `eof` (or an empty `data`). A transfer that is
  paused continues from its offset. A part more than twice `length` fails the download. The file's `size` from
  `storage/stat` bounds the read: the app stops there even without `eof`, and a part that goes past it fails the
  download («больше, чем размер»). Give a file's exact `size` (or none): without one the app stops at 16 GB.
- **Writing** is an upload in parts: `begin`, `chunk` in order (offsets grow), `commit`. Nothing may appear at `path`
  before `commit`. On any error, a cancel or a paused transfer the app sends `abort` (a new upload starts over).
- A storage opened `readOnly` gets no write calls from the panel; the program should refuse them too.
- **Not done by the app for an extension's kind:** a direct copy between a server and the storage (the server would
  need the storage's protocol), an automation's upload «на сервере» by the server's cron (refused with the reason).
  Automations upload from this Mac: the stream is spooled to a private temporary file, then written in parts.

### 12.2 Source («Вклад source»)

Every call carries `source`: `{"node": "<uuid>", "kind": "hetzner-cloud", "settings": {…}}` (settings as for a storage).

| Method | Params | Result |
|---|---|---|
| `source/poll` | `source` | `{"hosts": [host…], "scope"?: "api.hetzner.cloud"}` |
| `source/check` | `source` | `{"text": "…"}` — «Проверить» in the source's card (the SDK polls and counts by default) |

A host: `{"id", "name", "address", "port"?, "user"?, "jump"?, "online"? (true), "os"?, "tags"?, "group"?, "addresses"?,
"details"?, "lastSeen"?}`. `id` must be stable in the source (not the address): the app derives the tree node's id
from the source and it, so open tabs, settings the user gave the host and its expansion survive polls. `group` — a
folder under the source; `jump` — a bastion **by the name of a connection of the user's document** (a name that
isn't there, or names two, is ignored). Hosts are never written into the document; the user's own settings for a
host are kept in the source by its `id`. **Host keys are never taken from an extension**: the first connection shows
the server's key for checking, as for any new server. At most 5000 hosts; text fields are cut to one line.

The source is polled every `refresh` seconds of the manifest (60…86400; the user may change it in the card), not on
the app's activation.

### 12.3 `host/forward` and `host/oauth`

| Method | Params | Result | Permission |
|---|---|---|---|
| `host/forward` | `{"node": "<storage.node>", "host": "db.internal", "port": 5432}` | `{"host": "127.0.0.1", "port": 50123}` | `forward` |
| `host/oauth` | `{"node", "authURL", "tokenURL", "clientID", "clientSecret"?, "scope"?, "params"?}` | `{"accessToken": "…" \| null, "stored": true}` | `oauth` |

- **`host/forward`** — a port forwarded through the SSH session of the server the user bound the node to («Через
  сервер» in a storage's card; bastions and 2FA as for any session). It listens on 127.0.0.1 of this Mac only. The
  same node and target share one forward; it closes when the program stops and when the node's panes and transfers
  are gone. Only the node of a call **in progress** may be named; a node not reached through a server is an error.
- **`host/oauth`** — only while the app's `storage/signIn` for that node runs (the user pressed «Войти»). The app
  opens `authURL` in the browser (PKCE, `redirect_uri` on 127.0.0.1 of a one-shot listener), exchanges the code at
  `tokenURL` (https, or http on 127.0.0.1 for a stand-in), keeps the refresh token as the node's secret `oauth` once the
  card is saved, and gives the program the access token. Later calls bring the refresh token in `settings.oauth`:
  the program refreshes its access token itself.

## 13. Model providers

A `contributes.ai[]` entry is a **model provider**: Settings → AI gets a profile of it («Из расширений») — its
`title` and `icon`, the `fields` as the profile's settings (`text`, `number`, `bool`, `choice`, `list`; `secret` ones
kept in the Mac's keychain like a built-in provider's API key), the models the program lists, the `reasoning` levels
it declares. The profile is chosen wherever a profile is: the AI panel, «Составить запрос», AI filters of tables and
logs, the second model of a command's review, «AI: обработать» and the agent block of automations.

The program answers three methods of its own (on the same connection as its handlers, §4):

| Method | Params | Result |
|---|---|---|
| `ai/models` (request) | `{provider, settings, secrets}` | `{"models": [{"id", "title"?}] \| ["id"]}` in the order to show |
| `ai/chat` (request) | `{id, provider, model, system, messages, tools, max_tokens, effort?, settings, secrets}` | `{stop?, usage?, model?, message?}` |
| `ai/cancel` (notification) | `{id}` | — |

- `id` of `ai/chat` is the **stream's id**: the answer's pieces come before the result as notifications
  `ai/delta {id, type, …}`:
  - `{"type": "text", "text"}` — text of the answer;
  - `{"type": "tool_use", "toolId", "name", "input"?}` — a tool call starts (its whole input may come here);
  - `{"type": "tool_input", "toolId", "json"}` — a piece of its input, JSON text;
  - `{"type": "progress", "text"}` — a short note shown as a status line, not part of the answer;
  - `{"type": "usage", "input", "output", "model"?}` — tokens so far.
  Unknown types are skipped.
- The result: `stop` — `end_turn`, `tool_use`, `max_tokens`, `refusal` (none: `tool_use` when the answer calls a tool);
  `usage` — `{input_tokens, output_tokens}`; `message` — `{"content": [blocks]}`, the whole answer, for a program
  that doesn't stream (when given, it is the answer).
- `messages` — `[{role: "user" | "assistant" | "system", content: [blocks]}]`; a block is `{"type": "text", "text"}`,
  `{"type": "tool_use", "id", "name", "input"}`, `{"type": "tool_result", "id", "content", "is_error"}` or
  `{"type": "opaque", "value"}`. Tool results of one turn come in one user message. `tools` —
  `[{name, description, input_schema}]`.
- **What the program gets** is what every provider gets: the request after the app's masking of secrets and its
  policy (what a session may show the model, Production, what is hidden from AI). The answer is a model's like any
  other: a tool call goes through the AI mode's rules and the user's confirmations — the program can't run a tool
  itself.
- `ai/cancel` — the user stopped the answer: abort the work (the SDK aborts `ctx.signal`). The app forgets the
  request; a late answer is dropped.
- An error of `ai/chat` (`{"code", "message"}`) is shown as the provider's error, never retried by the app. An answer
  over 4 MB (text, tool inputs, tool calls) is cut and fails at once: the program gets `cancel` and `ai/cancel`.
- Token counts in `usage` are kept to 0 … 10^12.
- `secrets` — the profile's secret fields; never put them in an answer or the log (the app masks each value in what it
  shows anyway).

In TypeScript: `defineModule({ handlers: {}, ai: { models(req), async chat(req, ctx) { ctx.delta({type: "text",
text: "…"}); return { stop: "end_turn" }; } } })` — `examples/ai-echo-provider`.

## 14. Node types and screens

An extension may add **a node of its own** to the user's document (`contributes.nodeType`) and **screens** the app
draws from blocks (`contributes.screen`). The app keeps the node; the extension describes it.

### 14.1 The node

A node of a type is stored in the document as kind `extension` with `{"extension": "<id>", "type": "<type id>",
"values", "secrets", "links"}`; the protocol names a type `ext:<extension>/<type>`. The card the user fills is
drawn from the type's `fields` (settings, §3.3 kinds, plus `node`):

- `secret` fields are secrets of the document, owned by the node (copied and deleted with it). They are never in
  `settings`; the program asks for them (§14.3).
- `node` fields point at another node of the document — `nodeKinds`: `connection` (the default), `database`,
  `storage`, `tunnel`, `terminal`, `folder`, or `ext:<type>` of the same extension. A `node` field outside a node type
  (a module's settings, a storage's fields) is an error.
- Without the extension installed and on, the node stays as it is (a puzzle piece, «нужно расширение»): every value is
  kept, values of kinds the app doesn't read and keys it doesn't know too.

`context.node` — in every call made for a node's screen (the `render` and `ui/event`):

```json
{ "id": "D66F…", "name": "Сайты стенда", "type": "ext:dev.example.sites/checks",
  "settings": { "interval": 5, "urls": ["http://127.0.0.1:8080/health"] },
  "links": { "server": { "id": "6F1C…", "name": "web-1", "kind": "connection", "host": "10.0.0.5", "user": "deploy" } },
  "secrets": ["token"] }
```

`settings` — the type's fields but secrets and links, defaults filled in; `secrets` — keys of the secret fields that
are set. When the node points at a server, `context.server` is the first such server: `host/exec` works there as in a
module's call.

### 14.2 Screens

`screen[].placement`:

- `tab` — a tab of its own. Opened by a double click (Enter, the palette) on a node whose type names it
  (`nodeType.screen`), by `host/open {screen}`, or — a tab screen no node type names — from the palette by its title.
  One tab per screen and node: opening it again brings it forward.
- `section` — a section of a server's services tab, next to modules' sections, on the servers where the extension is
  switched on in «Службы» of the card (or its `service` is shown there). `context.server` is that server.
- `panel` — reserved; not opened yet.

The app calls the screen's `render` handler with input `{"screen": "<id>", "node": <context.node>}` and draws the
view it returns (a live screen, §11 — `screen(...)` of the SDK). Then the screen lives as every live screen: `open`,
events, ops, `ui/push`. The app builds it **anew** (render, then `close`/`open`) when the extension is updated or
switched on again, when the node's settings change, after the document is unlocked again, and when the program was
restarted (stopped, crashed) — a new program never saw the screen, so the event that found it gone isn't sent. Tabs
of a document open again when it is unlocked, after a relaunch too (the app remembers them on this Mac).

A program with a screen on screen isn't stopped as idle (it pushes to it).

### 14.3 What a program sees

Only what its screens and consoles on screen show: **the node a screen (a console, §16) is open for, the nodes that
node points at, the server of a section** — between calls too (a timer pushing live data). «Points at» is through the
`node` fields the type declares **now**: a link under a key the schema no longer has (an update renamed the field, a
document came with one more) is kept but gives nothing — the card lists it apart, to remove. Anything else — another
node's id, a guessed one, another extension's node — is refused (`-32001`).

| Method | Params | Result | Permission |
|---|---|---|---|
| `host/secret` | `{"node": "<id>", "key": "<secret field>"}` — a node of **its own type** it sees | `{"value": "…"}` | `secrets` |
| `host/exec` | as §4.3; `server` — a call's server or one it sees | as §4.3 | `exec` |
| `host/open` | `{"node": "<id>"}` — as a double click; `{"screen": "<id>", "node"?: "<id>"}` — its tab screen; `{"screen": "<id>", "server": "<id>"}` — its section; `{"terminal": {"server": "<id>", "command"?: "…", "title"?: "…"}}` | `{"opened": true \| false}` | — |
| `host/ask` | `{"title", "text"?, "buttons"?: [≤ 4], "risk"?: "info" \| "warn" \| "danger", "cancel"?: <index>}` | `{"button": <index>}` | — |

- `host/secret` with `node`: never a secret of another extension's node, never a password, key or 2FA of the
  document (a record shared with one is refused).
- `host/open terminal`: a command (one line, ≤ 2000 characters) is typed into a new terminal of that server only after
  the user says yes in a question that shows it, who sent it, and what the command policy finds in it (red when it
  changes the system or the server is Production); `{"opened": false}` — the user said no. At most 5 opens in 10 s.
  The command is refused (`-32602`) with any control character (CR, LF, Tab, ESC, Ctrl-U…, DEL, C1), a line or
  paragraph separator, bidi or zero-width marks: the shell would read them as keys, the dialog would show another text.
- `host/ask`: the app's dialog says which extension asks. `buttons[0]` is the main one; `risk: danger` makes it red
  and never the Return default; Esc answers `cancel` (the last button by default) — an index of a button exactly,
  anything else (a fraction, a huge number) is `-32602`. One question of an extension on screen at a time, at most 8
  waiting; with no window to ask over (closed to the menu bar, everything locked) a question waits for one.
- While a question of the program is on screen (`host/ask`, the command of `host/open terminal`), the timeouts of its
  calls stop: an event that waits for the user's answer isn't cancelled after 30 s.
- The program ends (crashes, is killed) while its screen is open: the screen says so at once and stops — its last
  numbers aren't shown as live; «Повторить» builds it on a new program.

## 15. Import

A `contributes.import[]` item reads another program's file into folders and connections. The user picks the file
(File → Import → «<title>…», the same in the toolbar's «+» and the tree's Create menu); **the app reads it** and sends its bytes — the
program never gets the path, and gets nothing else of the disk through the app.

### 15.1 `import/parse` (app → program)

| | |
|---|---|
| Params | `{"importer": "<contribution id>", "name": "servers.csv", "size": 1234, "data": "<base64>", "locale": "ru"}` — `name` is the file's name only |
| Result | `{"nodes": [node, …], "credentials"?: [credential, …], "secrets"?: [secret, …], "warnings"?: ["…"]}` |
| Timeout | 60 s (cancelled — `cancel` — when the user closes the progress sheet) |

The file is at most 8 MB (`maxSizeMB` lowers it); a bigger one is refused before it is read. A file whose name
doesn't end with one of `fileExtensions` (`*` — any) is refused too.

| Item | Fields |
|---|---|
| folder | `{"type": "folder", "name", "note"?, "children"?: [node, …]}` |
| connection | `{"type": "connection", "id"?, "name", "host", "port"?: 1…65535 (number or numeric string), "user"?, "note"?, "tags"?: ["…"], "bastion"?, "credential"?}` |
| credential | `{"id", "name"?, "user"?}` — a login only |
| secret | `{"credential": "<credential id>", "kind": "password" \| "privateKey", "value": "…"}` |

- `bastion` names another connection of this import — its `id`, else its `name` — or, failing that, a connection of
  the document by name. A name two connections have (of this import or of the document) is not guessed: the
  connection goes direct and the summary says the name is ambiguous. One not found leaves the connection direct too
  (the summary names it); a chain that comes back to itself sets no bastion.
- Give connections and credentials a stable `id` (the row's key in the other program): a re-import finds a node by it
  first — wherever the user moved it — and two of one name in one folder stay two.
- **Secrets come apart.** A password or a key the file held goes in `secrets`, never in a connection: the app asks
  («Импортировать без паролей» — the default, or «с паролями») and keeps them only on a yes, in the credential, as
  the document's own encrypted records. A key with a passphrase isn't taken.
- The answer is checked before anything changes: an unknown `type`, a connection without `host`, a port out of range,
  an address or login with spaces or starting with `-` (ssh would read it as an option), a `credential` or a secret
  naming no credential, a repeated `id` — the import stops with the place and the reason
  («nodes[2].port — порт от 1 до 65535»). Control characters are removed from every text. Limits: 5 000 items, 12
  levels, 1 000 credentials, 2 000 secrets, 100 warnings, names up to 200 characters, notes up to 64 KB.
- Tags have no field in the document: they go into the note («Теги: a, b»). Unknown keys of an item are ignored.

The app shows what came (a tree, the counts, the program's warnings) in the built-in import's question, then merges
the way its ~/.ssh/config import does: one folder per importer («Импорт: <title>», found again by the extension's and
importer's ids, so another interface language or a new title doesn't make a second one); a re-import finds a node by
its `id`, else by its folder path and name (a node of this import is never taken twice), and updates only the fields
the user hasn't changed since; undo (⌘Z) takes the whole import back. The free version imports as many connections
as it allows.

## 16. Consoles

A `contributes.console[]` item is a text console the program streams — a provider's serial console, IPMI SoL, a
hypervisor's `virsh console` — in a terminal tab of the app: the app's own terminal (find, copy, the session log when
the server keeps one, OSC 52 asked as for any server). It opens from a node's menu («Console: <title>», «Консоль: <title>») — a
connection's, unless `appliesTo` says otherwise. A graphical console (KVM, VNC) can't be one: the app draws no
pixels of an extension.

| Method | Direction | Params |
|---|---|---|
| `console/open` (request) | app → program | `{"console", "session", "cols", "rows", "node": {"id", "name", "host", "port", "user"}, "context"}` — answer `{}` once the console runs (30 s at most); an error is shown in the tab. A node of the extension's own type: `node` is its `context.node` (§14.1: `type`, `settings`, `links`, `secrets`) plus `host`, `port`, `user` of the server its fields point at |
| `console/data` | program → app | `{"session", "data": "<base64>"}` — bytes for the terminal (it MAY come before the `console/open` answer) |
| `console/input` | app → program | `{"session", "data": "<base64>"}` — what the user typed, as the terminal encodes it (Return is `\r`; a paste comes in pieces of 48 KB) |
| `console/resize` | app → program | `{"session", "cols", "rows"}` — when the grid changes |
| `console/close` | app → program | `{"session"}` — the tab was closed: stop feeding it |
| `console/closed` | program → app | `{"session", "reason"?}` — the program ended the console; the tab shows the reason |

- `node` carries no password or key; `context` is the call's (§2: settings of the extension for that server, the
  language). While the console is open the node's server counts as a call in progress: `host/exec` and `host/secret`
  may name it, and the program isn't stopped as idle. A document lock that stops the program closes its consoles.
- A console of a node of the extension's own type (`appliesTo: ["<type>"]`) works as its screen does (§14.3):
  `context.node` is the node, `context.server` the first server its fields point at; while the console is open the
  program sees the node and what it points at — `host/secret {"node", "key"}` of its secret fields
  (`ctx.host.nodeSecret(key)`), `host/exec` on that server.
- **Limits.** A `console/data` chunk is at most ≈ 1 MB (1 400 000 base64 characters) — a bigger one is dropped whole;
  the output may burst to 4 MB and keeps to 2 MB a second after — the rest is dropped and the terminal says how much
  («[консоль: вывод слишком быстрый — пропущено N КБ]»). Bytes go to the terminal off the main thread. A chunk too
  big or not base64 is the author's mistake: the terminal and the extension's log say which («кусок console/data
  больше 1 МБ», «console/data не в base64»).
- `console/data` for a session the program didn't open is ignored (and noted in the extension's log).
- The program exiting, crashing or being stopped ends its consoles: each tab says why and offers «Открыть снова» (⌘R).
