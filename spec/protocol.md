# Module protocol, SDK 1

Normative. Words MUST / SHOULD as in RFC 2119. The guides in `docs/` explain the same with examples.

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
outside the module: `DYLD_*`, `LD_*`, `*_OPTIONS`, `*OPT`, `PYTHONSTARTUP`, `PYTHONPATH`, `NODE_PATH`, `BASH_ENV`… are
refused by the check and never set). The program runs with the user's rights and **no sandbox**. **The module folder is read-only for the module**: an
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
| `shutdown` | `{}` | `null`; then the module SHOULD exit |

### 4.3 Module → app

| Method | Params | Result | Permission |
|---|---|---|---|
| `host/exec` | `{"server": "<context.server.id>", "command": "…", "stdin"?: "…", "timeout"?: 30, "sudo"?: false, "container"?: "…"}` | `{"exitCode", "stdout", "stderr"}` | `exec` (`sudo` for sudo) |
| `host/secret` | `{"server": "<id>", "key": "<secret setting key>"}` | `{"value": "…"}` | `secrets` |
| `host/store/get` | `{"key": "…"}` | `{"value": <json> \| null}` | `store` |
| `host/store/set` | `{"key": "…", "value": <json> \| null}` | `null` | `store` |
| `host/notify` | `{"title": "…", "text": "…"}` | `null` | `notify` |
| `host/log` (notification) | `{"level": "debug"\|"info"\|"warn"\|"error", "message": "…"}` | — | — |

`host/exec` runs over the app's session to that server, the same way as the server runtime (bastions, 2FA,
containers); only the servers of calls **in progress** (their `context.server.id`) may be named — a program can't
reach a server between calls. `stdin` and `container` don't go together (a container's command line is readable on
the server); the request fails. A method the
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

An `automation` entry is a block of the automations library («Из установленных модулей»). In SDK 1 only server
modules have them; a process module's blocks are listed with a warning and not offered.

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

| Contribution | Manifest | Used by the app since |
|---|---|---|
| `service`, `tools`, `automation` | `contributes.*` or the top level (not both) | modules (§1–§9) |
| `database[]` | `id` (engine, never a built-in one), `title`, `model` (`sql` / `keyValue` / `document`), `defaultPort`, `isFile`, `hasSchemas`, `hasEditorTransactions`, `identifierQuote` (`"` or `` ` ``), `keywords`, `functions`, `readCommands` (trusted only for library extensions), `logo` (`si:<slug>`), `command` (its own program; else `runtime`, started apart with `SK_ROLE=database`). The driver speaks the database protocol — [database.md](database.md) | stage 2 |
| `storage[]` | `id` (kind), `title`, `signIn` (`keys` / `login` / `browser` — needs `oauth` / `none`), `fields` (settings, §3.3 kinds), `capabilities` | stage 4 |
| `source[]` | `id` (kind), `title`, `fields`, `refresh` (s, 60…86400) | stage 4 |
| `nodeType[]` | `id`, `title`, `icon`, `fields`, `screen` (an id of `contributes.screen`) | stage 3 |
| `screen[]` | `id`, `title`, `placement` (`tab` / `section` / `panel`), `render` (a handler building the view) | stage 3 |
| `import[]` | `id`, `title`, `fileExtensions`, `handler` | stage 6 |
| `console[]`, `ai[]` | `id`, `title`, `handler` | stage 6 |

- Every contribution has an `id` (`^[a-z][a-z0-9_-]{0,39}$`, unique within its kind), a `title` (text or per
  language) and an optional `icon`. Built-in kinds and engines (`mysql`, `s3`, `tailscale`…) are never replaced.
- `database`, `storage`, `source`, `import`, `console` and `ai` are answered by a program on this Mac: they need the
  `process` runtime (a `database` may name its own `command`).
- A key of `contributes` this app doesn't know is an error (with the list of known ones); a manifest of a newer `sdk`
  is refused before its fields are read.
- Permissions add `forward` (`host/forward`: a port forwarded through the app's SSH session of a server) and `oauth`
  (`host/oauth`: a sign-in through the browser, the token kept as the node's secret); both are answered from stage 4.
- An update that adds a contribution, like one that adds a permission, is installed **switched off** until the user
  switches it on.
- Trust: an extension installed from any file is shown as «Автор не проверен»; extensions of SSHKipper's library
  (signed, stage 5) as «Проверено SSHKipper».
- A program serves every contribution of its extension: handlers through `handler/call` (§4.2), a contribution's own
  methods (`ui/event`, a storage's `list`…, defined by their stages) as JSON-RPC requests on the same connection. A
  database driver is the exception: a separate process speaking the database protocol ([database.md](database.md)).
