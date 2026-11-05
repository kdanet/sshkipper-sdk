# Security

SSHKipper keeps passwords, keys and 2FA secrets of many servers. An extension gets only what its contributions need,
and the user sees what that is before installing it. This page says what the app guarantees for every extension,
then what each kind of contribution gets and what it never gets.

## What the app guarantees

- **Nothing of an extension runs in the app.** Server scripts run on the server; a program is a separate process on
  this Mac with a clean environment. Pages and screens are JSON drawn by the app — no HTML, no scripts in a view.
- **The user installs extensions**, from a file or a folder; the app first shows in words what the extension adds,
  its permissions, where its code runs (for a program — its command, and that it runs with the user's rights without
  a sandbox), what it changes, its AI tools and automation blocks. Agents and documents can't install extensions. An
  update that adds a permission or a contribution is installed switched off until the user switches it on; one the
  user switched off stays off.
- **Trust is shown, not assumed.** An extension from any file is «Автор не проверен» (Author not verified). Only an
  extension installed from SSHKipper's signed library whose files match the library's record is «Проверено
  SSHKipper» (Verified by SSHKipper) — and only then does the app take its claims about reading (a database engine's
  `readCommands`) into account.
- **Integrity.** Every file of an installed extension is hashed, again before each start of its program: a changed,
  added or removed file stops it until the user approves it again.
- **Credentials stay in the app.** No extension sees a server's password, keys or 2FA codes, the document, or another
  extension's secrets. Server scripts run over the app's session; a program asks the app (`host.exec`,
  `host.forward`) and may name only the servers and nodes of its calls in progress and of its open screens.
- **Secrets on request.** A secret setting or field is kept encrypted by the app and given only to its own
  extension: to a server script as a 0600 file in a private folder removed after the run (`SK_SECRET_<KEY>`), never
  on a command line and never into a container; to a program on `host.secret` / `host.nodeSecret`, or in its own
  node's `settings` (storages, sources) — never in `context.settings` of a page.
- **Values are checked.** Parameters of actions, tools and blocks are checked against their `params` (types,
  choices, `pattern` in full) before a handler runs; unknown keys are dropped. Answers are checked too, if more
  leniently: a view so that the page still shows (keys a block doesn't know aren't read, an unknown block is left out
  with a warning in the log, what is too long is cut — [UI-Kit, “View limits”](ui-kit.md#view-limits)); an import
  strictly, before anything changes; console output against its limits.
- **An extension's screen doesn't pass for the app.** An extension's screen tab is captioned along its top “Screen
  of the extension “…””, its sheet “Window of the extension “…””, a `host.ask` question with the extension's name. A
  sheet opens only in answer to the user's press on that screen — never from `ui/push` or the background. SSHKipper
  never asks for a document's or a server's password on an extension's screen: a password field there is always the
  extension's.
- **Changes ask.** `change` and `danger` actions ask the user first; the agent's calls go through the server's AI mode
  and confirmations like its own commands; automation steps go through the automation's approval; a database
  engine's statements through the node's mode (Production asks, «Только чтение» refuses).
- **Permissions are checked** where the app is in the path: `exec` (server scripts, `host.exec`), `sudo`, `secrets`
  (`host.secret`, secret settings and fields), `store`, `notify`, `forward` (`host.forward`) and `oauth`
  (`host.oauth`) — a request without its permission fails with `-32001`. `network` is not checked: it is the author's
  declaration.
- **Programs end with their children.** A program runs in its own process group: switched off, updated, removed, idle
  for ten minutes, a document locked that it worked for (every program once no document is left open), or the app
  quitting — SIGTERM to the group, SIGKILL to what is left a few seconds later. `runtime.env` can't set variables that
  load code from outside the extension (`NODE_OPTIONS`, `DYLD_*`, `LD_*`, `PYTHONSTARTUP`, `*_OPTIONS`…).
- **Limits.** Timeouts stop the whole process group on the server; closed pages stop their calls. Sizes: a server
  script's stdout — 8 MB; a program's JSON-RPC line — 16 MB and 64 levels of nesting; a view (a page, `render`) — 2 MB
  and 400 blocks; the answer to a live screen's event and a `ui/push` — 8 MB and 2 000 ops; a model provider's answer —
  4 MB; a tool's answer the model reads — 20 000 characters.

## What each contribution gets

| Contribution | Gets | Never gets · checked by the app |
|---|---|---|
| `service`, `tools`, `automation` (server scripts) | the request on stdin, its settings, its own secret settings as files | the session's credentials; secrets inside a container. Runs only where its service is on, or the user opened, pressed, allowed or scheduled it; `detect` checks every connected server by itself only if the user ticked that — never with sudo |
| a program's handlers and blocks | `context` of the call (server, settings, item, node), `host.exec` on the call's server | servers of other calls; between calls — nothing but what its open screens show |
| `database` | `127.0.0.1` and a port the app forwards over its SSH session, the database's name for TLS, **the password of the one database** it opens | the document, keys, other databases' passwords. A separate process; stopped when the last document locks. For an unverified extension every statement is a change (Production asks with the full text, «Только чтение» refuses) |
| `storage` | its own node's fields, secret ones as text; `host.forward` to a target behind the server the user bound the node to; `host.oauth` while the user signs in | another node's fields or secrets; a forward for a node not in a call; a sign-in the user didn't start. The refresh token is kept as the node's secret; a download's `digest` is checked |
| `source` | its own node's fields, secret ones as text | the document: found hosts are never written into it; host keys of found hosts are not trusted — the first connection shows the key; the user's filters are applied by the app |
| `nodeType`, `screen` | its node's settings and links; `host.nodeSecret` of its own type's secret fields; `host.exec` on a server the node points at; `host.open`, `host.ask` | nodes it doesn't see (another node's id, a guessed one, another extension's node); a document's password, key or 2FA (a record shared with one is refused). A terminal command is typed only after the user says yes in a question that shows it and the command policy's verdict; at most 5 opens in 10 s; questions are signed with the extension's name |
| `import` | the file's bytes and name, as the user picked it (≤ 8 MB or `maxSizeMB`) | the file's path or anything else of the disk. The answer is checked before anything changes; passwords and keys come apart and are imported only when the user says so |
| `console` | the node's address and login; what the user types; the terminal's size | a password or key. Output is capped (≈ 1 MB a chunk, 2 MB/s after a burst), OSC 52 is asked as for any server, data for a session it didn't open is ignored |
| `ai` | the request after the app's masking and policy (what a session may show the model, Production, what is hidden from AI); its profile's secret fields, kept in the keychain | the right to run a tool: a tool call in its answer goes through the AI mode's rules and the user's confirmations. An answer over 4 MB fails |

## What is "as far as possible"

- A program is a program with the user's rights on this Mac: `network` (and what it does with files) is a declaration
  the user reads, not a sandbox. What a program is given — a database's password, a storage's token, a profile's API
  key — it can send anywhere. Install programs from people you trust — as with any app.
- An extension is known by its `id`, not by its author. A package of the same `id` installs over the installed one
  and gets everything kept by the `id`: settings, secret settings, `host.store`, nodes of its types. The install window
  says “Replaces the installed “…””, but doesn't compare authors (outside the library an author isn't verified anyway).
- A server script runs with the rights of the connection's user (and root through `sudo -n` where allowed): it can do
  on the server what that user can. Read an extension's scripts before giving it `sudo`.
- An agent can call an extension's tools only within the server's AI mode; a tool that changes things is as safe as
  its `risk` is honest. Review `risk` when you install an extension.
- `sshkipper-ext mcp` without `--allow-changes` runs only handlers the manifest uses for reading and methods that read
  — a guard against an agent running a declared change by mistake, not a sandbox: the agent writes the code it runs.

## For extension authors

- Give every text parameter that reaches a script a `pattern`; quote every variable; never `eval` input.
- Don't print secrets: stderr goes to the extension's log, stdout to pages, models and automation runs.
- Use `quote()` (TypeScript) for values in `host.exec` commands.
- Ask for the least: no `sudo` if a handler can do without; `sudo: never` on handlers that read; no `forward` or
  `oauth` your storage doesn't use.
- Keep secrets you are given in memory: don't write a storage's token or a database's password to `SK_DATA` or logs.
- A database driver: open a «Только чтение» node read-only where the engine can (`connection.readOnly`), and keep
  `tableData` and `readOnly` queries on a read-only connection.
- Take an `id` of your own domain and never change it: a package of the same `id` from anyone installs over yours and
  gets your users' settings, secrets and `host.store` ([Publishing](publishing.md#versions)). For users: “Replaces the
  installed…” in the install window of a package from an unfamiliar source is a reason to stop.
- Don't fetch code at run time (`curl … | sh`, a plugin downloaded on start): what runs should be what the user
  approved.
