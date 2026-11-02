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

## 4. Methods

Types are in `packages/sdk/src/database.ts` (`Methods`). All but `hello` name a `session` the app chose in `connect`.

| Method | Params | Result | Notes |
|---|---|---|---|
| `hello` | `{}` | `{protocolVersion: 1, pluginVersion, engines: [EngineInfo], features?}` | Asked once per process. `engines[]` must name the manifest's engines: `engine` and `title` are required, the rest optional — `supportsEditing` (false), `supportsTransactions` (false), `hasDatabases` (true) drive the grid, `keywords` and `functions` ([] — the manifest's), `identifierQuote` (the manifest's); the descriptor stays the manifest's. `features: ["passwordBytes"]` — the password comes as `passwordBase64`. |
| `connect` | `{session, connection: ConnectParams}` | `{serverVersion, serverTitle, database?, readOnly?, readOnlyReason?}` | `connection.readOnly` — the node is «Только чтение»: open read-only where you can. Say `readOnly: true` when the session can't write anyway. |
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

A method a driver doesn't answer is `unsupported` and the tab says so where it is used.

### 4.1 `keyValue` and `document` engines

A `keyValue` engine answers the key browser with Redis's semantics (types `string`, `hash`, `list`, `set`, `zset`,
`stream`; commands as redis-cli words); a `document` engine answers a collection's page and its edits (filters,
projections and sorts as Mongo shell text: `{status: "paid", total: {$gt: 100}}`). Besides `hello`, `connect`,
`disconnect`, `ping`, `cancel`, `databases`, `objects` (`kind: "collection"` for a document engine) and `serverInfo`:

| Method | Params | Result |
|---|---|---|
| `redis.scan` | `{session, db, cursor, pattern, count}` — `cursor` `"0"` to start, `pattern` a glob (`*`) | `{cursor, keys: [{key, type, ttl}]}` — `cursor` `"0"` when the scan is done; `ttl` seconds, `-1` none, `-2` gone |
| `redis.value` | `{session, db, key, offset, limit}` | `{key, type, ttl, length, memory?, encoding?, text?, textIsExact?, binaryPreviewBytes?, items, offset}` |
| `redis.command` | `{session, db, args: [string], escaped: [int]}` — `escaped`: positions of arguments written as the browser shows bytes (`\xff`) | a RESP reply `{kind, text?, items?}` |
| `mongo.find` | `{session, database, collection, filter, projection?, sort?, skip, limit, countTotal, queryID}` | `{documents: [string], total?, command, durationMs, cut?}` |
| `mongo.write` | `{session, database, collection, ops: [{kind, original?, document?}], dryRun}` | `{statements, affectedRows}` |

- `redis.value`: `length` — elements in the value (a string: its bytes); `memory` — bytes the key uses, when known;
  `text` — a string's value; `textIsExact` — `text` is the whole value as plain text (safe to edit and write back);
  `binaryPreviewBytes` — a binary string: `text` shows only its first this many bytes. `items` — a page of a
  collection's elements: `[value]` for `list` and `set`, `[field, value]` for `hash`, `[member, score]` for `zset`,
  `[id, "field=value"…]` for `stream`; a list's index is `offset + row`.
- A RESP reply's `kind`: `string`, `status`, `error`, `integer`, `double`, `bool`, `null`, `array`, `map`, `set`,
  `bigNumber`, `verbatim`; scalars carry `text`, `array` / `map` / `set` carry `items` (a map — key, value, key…).
- `mongo.find`: `documents` — Mongo shell text, field order kept; `total` — matching documents, or absent when not
  counted; `command` — the command as the shell would write it (the tab shows it); `cut` — positions of documents
  too big to hand over whole (over 1 MB of text): shown read-only.
- `mongo.write`: `kind` `insert` (`document`), `replace` (`original`, `document` — the `_id` kept) or `delete`
  (`original`). A replacement or deletion applies only while the stored document still is `original`; on the first
  that isn't, stop and answer an error with `appliedChanges` — how many were written. `dryRun` — only the shell
  commands that would run, as `statements`.
- The pages (`redis.scan`, `redis.value`, `mongo.find`) are reads; a command typed in the console and a write of the
  key browser or a collection (`redis.command`, `mongo.write`) are changes of an extension's engine and are asked
  about as §5 says.

## 5. What runs without a question

The app decides, not the driver (`DBChangeDecision`): for an extension's engine **every statement is a change** —
Production asks with the full text, «Только чтение» refuses it, «Обычный» runs it. Table edits are always changes.

`readCommands` loosen this only for an extension **verified by SSHKipper** (installed from the library, `trust ==
library`); for any other the app ignores them and writes why in the extension's log. Even then a statement is a read
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
