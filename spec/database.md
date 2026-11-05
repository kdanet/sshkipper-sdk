# SSHKipper database protocol — version 1

What a driver of a `contributes.database` engine answers (spec/protocol.md §10). It is the protocol of the app's
built-in database extension (`sshkipper-db`): an extension's engine gets the same tab — query editor, grid with edits, filters, structure, AI, Production and «Только чтение», a
forward over SSH — because its program answers the same requests. TypeScript types and a serve loop:
`packages/sdk/src/database.ts`; an example driver: `examples/db-sqlite-node`.

## 1. The engine in the manifest

```json
"contributes": {
  "database": [{
    "id": "example-sqlite", "title": { "ru": "SQLite (Node)", "en": "SQLite (Node)" }, "logo": "si:sqlite",
    "model": "sql", "isFile": true, "hasEditorTransactions": true, "identifierQuote": "\"",
    "keywords": ["SELECT", "FROM"], "functions": ["count", "lower"], "readCommands": ["select", "explain"]
  }]
}
```

| Field | What the app does with it |
|---|---|
| `id` | The engine's id (`DBEngine`) in documents. Never a built-in one (`mysql`, `redis`, `clickhouse`, `postgres`, `sqlite`, `mongodb`). |
| `title`, `logo`, `defaultPort` | The engine picker, the node's icon, the port field's placeholder. |
| `model` | Which screens: `sql` — editor, grid, structure, filters, edits; `keyValue` — the key browser; `document` — collections. |
| `isFile` | A file on this Mac instead of a server: the node asks for a path, the driver gets it in `connect.path`. A file through a server is refused (the app has a server-side helper for SQLite only). |
| `hasSchemas` | Tables live in schemas: names come as references `schema.name` (`DBObjectRef`). |
| `hasEditorTransactions` | The editor's statements keep transactions open (BEGIN … COMMIT): the tab shows «Транзакция открыта» and asks before closing. |
| `identifierQuote` | `"` or `` ` ``: how the app quotes names it writes (completion, «Копировать как INSERT», filters it builds) — the generic dialect `standard` or `standardBacktick`. Strings are always `'…'` with `''`. |
| `keywords`, `functions` | Highlighting, completion and the AI's dialect hint (when `hello` sends none). |
| `readCommands` | First words of statements that only read. **Trusted only for an extension of the SSHKipper library** (§5). |
| `command` | The driver's own program; without it the extension's `runtime.command` is started for the driver. |

The engine is known as soon as the extension is active — pickers, the palette and File → Database… list it before any
program runs. Switched off or removed, it disappears from the pickers; its nodes stay in the document and the tab
says the extension is needed.

## 2. How the driver runs

- A program on this Mac, started on the first request of a tab and again after it exits. **Separate from the module
  program** of the same extension (that one speaks JSON-RPC, §4 of protocol.md): one driver per extension and command,
  with `SK_ROLE=database` in its environment — a program serving both can tell which it is.
- The same rules as a process module (protocol.md §4): every file of the package hashed again before each start (a
  changed or added file refuses the start and marks the extension changed), a clean environment (`PATH`, `HOME`,
  `TMPDIR`, `LANG`, `SK_*`, the manifest's `runtime.env` without variables that load outside code), the package folder
  as the working directory.
- **SSH stays in the app.** A database behind a server is reached through a forward the app opens on its SSH session
  (bastions, 2FA): the driver gets `127.0.0.1` and the forwarded port, the database's own name in `tlsServerName`, and
  the password of the one database it opens. It never gets the document, keys or other secrets.
- Stopped when the app quits, when the last document locks (it holds passwords), and when its extension is switched
  off, removed or changed. Closing stdin is the request to exit.
- If it exits on its own, the tabs it served say «Расширение «…» завершилось (код N): <last stderr lines>»; the next
  request starts it again and the tabs reconnect.

## 3. Wire format

One JSON object per line, UTF-8, on the driver's stdin (requests) and stdout (responses). Logs go to stderr (the
extension's log in Settings → Extensions). **Not JSON-RPC**: no `jsonrpc` field, errors are objects with a text code.

```
→ {"id": 7, "method": "query", "params": {"session": "…", "sql": "select 1", "maxRows": 1000, "queryID": "…"}}
← {"id": 7, "result": {"columns": [...], "rows": [["1"]], "truncated": false, "durationMs": 0.4}}
← {"id": 8, "error": {"code": "query", "message": "no such table: x", "serverCode": "1"}}
```

- Requests are answered in any order; several run at once (a `cancel` comes while its `query` runs).
- Write `"id"` first: the app finds the caller from the start of a line. A response line is at most 256 MB.
- Error codes: `auth` (login refused), `connection` (can't reach), `query` (the statement failed), `cancelled`,
  `unsupported` (a method this driver doesn't do), `notConnected` (unknown or closed session — the app reconnects
  and repeats the request once — unless the editor holds a transaction), `invalidRequest`, `internalError`. An unknown code reads as
  `internalError`; the message is shown as is.
- Values in results are text (`null` for NULL); binary as `0x…` hex.
- stdout carries responses only. A line the app can't read an `id` from is skipped without a trace (it is not in the
  extension's log); a line with an `id` is taken as that request's response. Log to stderr — the SDK's `serveDatabase`
  redirects `console.log` / `console.info` there, as `defineModule` does; a driver of its own must do so itself.
- `truncated` (a `Result`): there are more rows than the answer holds — the driver stopped at `maxRows`, or earlier
  because the result was too big. The editor shows «первые N строк» and a note on the limit, the agent «есть ещё»;
  with fewer rows than `limit`, `tableData`'s next page starts after the rows that came. `false` when every row came.

## 4. Methods

Types are in `packages/sdk/src/database.ts` (`Methods`). All but `hello` name a `session` the app chose in `connect`.

| Method | Params | Result | Notes |
|---|---|---|---|
| `hello` | `{}` | `{protocolVersion: 1, pluginVersion, engines: [EngineInfo], features?}` | Asked once per process. `engines[]` must name the manifest's engines: `engine` and `title` are required, the rest optional — `supportsEditing` (false), `supportsTransactions` (false), `hasDatabases` (true) drive the grid, `keywords` and `functions` ([] — the manifest's), `identifierQuote` (the manifest's); the descriptor stays the manifest's. `features: ["passwordBytes"]` — the password comes as `passwordBase64`. |
| `connect` | `{session, connection: ConnectParams}` | `{serverVersion, serverTitle, database?, readOnly?, readOnlyReason?}` | `connection.readOnly` — the node is «Только чтение»: open read-only where you can. Say `readOnly: true` (with `readOnlyReason`) only when the session can't write anyway — a read-only file, a replica: the tab is then «Только чтение» whatever the node's mode, and for an engine without verified read commands (§5) that refuses every statement of the editor, a SELECT too. A driver that just doesn't write leaves it out. |
| `disconnect` | `{session}` | `{}` | Also stops what still runs. |
| `ping` | `{session}` | `{}` | |
| `query` | `{session, sql, database?, maxRows, queryID, readOnly?, isolated?}` | `Result` | One statement (the app splits scripts by the dialect). `readOnly` — the app wants a read the engine guarantees; `isolated` — not on the editor's connection state. Report `inTransaction` after it when the engine has editor transactions. |
| `cancel` | `{session, queryID}` | `{}` | Stop the `query` or `tableData` with this id; answer at once. The cancelled request answers `cancelled`. |
| `databases` | `{session}` | `[{name, isSystem, tables?}]` | |
| `objects` | `{session, database, offset?, limit?, filter?}` | `[{name, kind, rows?, size?, comment?, schema?}]` | `kind`: `table`, `view`, `materializedView`, `collection`, … Above 2000 tables the app asks by pages. |
| `structure` | `{session, database?, table, fresh?}` | `{columns, indexes, foreignKeys, primaryKey, ddl?, info}` | `primaryKey` empty — the grid doesn't edit the table. |
| `tableData` | `{session, request: TableRequest, queryID}` | `{result, primaryKey, totalRows?, sql}` | **Always a read**, whatever the session. Build the SELECT from `filters` (operators in `FilterOperator`, `matchAll` — AND/OR), `rawWhere` (a condition the app already checked: one read, no `;`, no comments), `orderBy`, `limit`, `offset`; `countTotal` — also COUNT. Quote names yourself. |
| `applyChanges` | `{session, database?, table, changes: [RowChange], dryRun}` | `{statements, affectedRows}` | `dryRun` — only the statements: the app shows them in its confirmation before it sends the same request without `dryRun`. Write all or nothing; an update or delete must touch exactly its row (else roll back and say «nothing written»). Refuse while the editor holds a transaction. |
| `serverInfo` | `{session}` | `[{title, value, key?, number?, unit?}]` | The info panel. |

A method a driver doesn't answer is `unsupported` and the tab says so where it is used. The methods above serve
every model; the browsers of the other two models add their own (types: `database.ts` — `KeyInfo`, `ScanResult`,
`KeyValue`, `Reply`, `FindResult`, `WriteOp`; Swift: `DB.Redis…`, `DB.Mongo…`). They are the methods of the app's
built-in Redis and MongoDB drivers, with their semantics.

### 4.1 `keyValue` — the key browser (like Redis)

The tab lists `databases` (numbered: `name` is `"0"`, `"1"`…; `detail` — what the list shows beside it), the key
browser pages keys and opens values, and the editor is a console: `query` gets one command line in redis-cli syntax
(`HGET user:1 name`; quotes and `\xff` escapes as redis-cli reads them) in `sql`, `database` — the number, and answers
one column with the reply as redis-cli prints it.

| Method | Params | Result | Notes |
|---|---|---|---|
| `redis.scan` | `{session, db, cursor, pattern, count}` | `{cursor, keys: [{key, type, ttl}]}` | One SCAN step: `pattern` — a glob (`*`, `?`, `[…]`), `count` — a hint. `cursor: "0"` back — the scan is complete. `type`: `string`, `hash`, `list`, `set`, `zset`, `stream` (others are shown, not edited); `ttl` in seconds, -1 — none. |
| `redis.value` | `{session, db, key, offset, limit}` | `{key, type, ttl, length, memory?, encoding?, text?, textIsExact?, binaryPreviewBytes?, items, offset}` | A string: `text` (binary bytes escaped as `\xff`), `textIsExact` — `text` is the whole value as plain text (only then it is editable), `binaryPreviewBytes` — `text` shows only that many bytes. A collection: `items` from `offset` — `[value]` (list, set), `[field, value]` (hash), `[member, score]` (zset), `[id, "field=value"…]` (stream); `length` — elements in all. |
| `redis.command` | `{session, db, args, escaped}` | `{kind, text?, items?}` | A command as words (`["HSET", "k", "f", "v"]`) — the browser's edits (SET, HSET, LSET, ZADD, DEL, EXPIRE…). `escaped` — positions of arguments written as the browser shows bytes (`\xff`): decode them to bytes. The reply as a tree: `kind` — `string`, `status`, `error`, `integer`, `double`, `bool`, `null`, `array`, `map`, `set`, `bigNumber`, `verbatim`. |

Every `redis.command`, and every console line, is a change for an extension's engine (§5): Production asks with the
command, «Только чтение» refuses it.

### 4.2 `document` — the collection browser (like MongoDB)

`objects` lists collections (`kind: "collection"`), `structure` describes one (fields seen in its documents as
`columns`, its indexes), and the editor sends Mongo shell commands in `query.sql` — one per request
(`db.orders.find({status: "paid"})`), the result's rows being documents in shell syntax. Values are shell text
everywhere: `{_id: ObjectId("…"), total: NumberDecimal("9.90"), at: ISODate("…")}`.

| Method | Params | Result | Notes |
|---|---|---|---|
| `mongo.find` | `{session, database, collection, filter, projection?, sort?, skip, limit, countTotal, queryID}` | `{documents, total?, command, durationMs, cut?}` | A page of a collection. `filter`, `projection`, `sort` — shell text (`{status: "paid", total: {$gt: 100}}`), empty — none. `countTotal` — count the matches too (bounded in time; leave `total` out when it took too long). `command` — what ran, as the shell would write it. `cut` — positions of documents too big to hand over whole (the browser shows them read-only). Cancelled by `queryID` (`cancel`). |
| `mongo.write` | `{session, database, collection, ops: [{kind, original?, document?}], dryRun}` | `{statements, affectedRows}` | The browser's edits, in order: `insert` (`document`), `replace` (`original` → `document`, the `_id` kept), `delete` (`original`). A replace or delete applies only while the document still equals `original` — else stop and fail with `appliedChanges` (how many were written). `dryRun` — only `statements`, the shell commands that would run, for the confirmation. |

## 5. What runs without a question

The app decides, not the driver (`DBChangeDecision`): for an extension's engine **every statement is a change** —
Production asks with the full text, «Только чтение» refuses it, «Обычный» runs it. Table edits are always changes.
A new node of an extension's engine is «Обычный», a file engine's too (a built-in SQLite file opens «Только чтение»):
with every statement a change, a read-only default would refuse even the first SELECT. The user picks Production or
«Только чтение» in the node's card; then the refusal says why — the node's mode, or a session the driver declared
read-only (§4 `connect`) — and that without verified read commands no statement runs in it (tables, keys and
collections are still browsed: `tableData`, `redis.scan`/`redis.value`, `mongo.find` are reads by definition).
The AI filter's «Выполнить как запрос» goes as a typed statement too: for an extension's engine Production asks.

`readCommands` loosen this only for an extension **verified by SSHKipper now** — its installed files are the ones the
library's signed index lists for a version it hasn't taken back (a changed file, a revocation or an entry gone from
the library takes the trust back at once, whatever was recorded at install); for any other the app ignores them and
writes why in the extension's log. Even then a statement is a read
only if it starts with a declared word and every quoting the app knows reads it the same way, it is one statement,
it holds no word that changes data anywhere (`insert`, `update`, `delete`, `create`, `drop`, `into`, `returning`…),
no locking read, no side-effect or table function (`sleep`, `load_file`, `url(…)`…). Words that change data (`with`,
`set`, `insert`…) are never accepted as read commands. In Production a read that calls a function neither the
manifest's `functions` nor the app knows is asked about («it may change data inside»).

The driver should still refuse writes where the engine can: open a «Только чтение» node read-only
(`connection.readOnly`), run `readOnly` queries and `tableData` on a read-only connection.

## 6. Versions

`protocolVersion` is 1; a driver with another version is refused with «update one of them». New fields are
optional and ignored by older apps; a driver ignores fields it doesn't know.
