# Database drivers

An extension can add a **database engine** to SSHKipper: a node «База данных» of that engine opens the same tab as
the built-in MySQL or PostgreSQL — query editor with highlighting and completion, a grid with filters and edits,
structure and DDL, the AI filter and «Составить запрос», Production and «Только чтение», a forward over the app's SSH
session (bastions, 2FA). The app draws all of it; your program only answers the **database protocol**
([spec/database.md](../../spec/database.md)).

Example: [examples/db-sqlite-node](../../examples/db-sqlite-node) — SQLite files through Node's built-in
`node:sqlite`, nothing to install.

## 1. The manifest

`sshkipper-extension.json`:

```json
{
  "sdk": 1,
  "id": "dev.acme.duck",
  "version": "1.0.0",
  "title": "DuckDB",
  "runtime": { "kind": "process", "command": ["node", "driver.ts"] },
  "contributes": {
    "database": [{
      "id": "duckdb", "title": "DuckDB", "model": "sql", "isFile": true,
      "identifierQuote": "\"", "keywords": ["SELECT", "FROM", "QUALIFY"], "functions": ["list_value", "epoch_ms"]
    }]
  }
}
```

- `model` picks the screens: `sql` (editor, tables), `keyValue` (the key browser), `document` (collections).
- `isFile` — a file on this Mac (the node asks for a path); otherwise host and port, reached directly or through a server.
- `command` — when the driver is another program than `runtime.command`. Without it the runtime's program is started
  **as a separate process** for the driver, with `SK_ROLE=database` in its environment.
- `readCommands` — see «What asks first» below.

The engine shows up in File → Database…, the palette and the node's engine picker as soon as the extension is on — before
your program ever runs. Off or removed, the nodes stay and say which extension they need.

## 2. The program

One JSON object per line on stdin and stdout — `{"id", "method", "params"}` in, `{"id", "result"}` or
`{"id", "error": {"code", "message"}}` out, logs on stderr. With the SDK:

```ts
import { DATABASE_PROTOCOL_VERSION, DatabaseError, serveDatabase } from "./lib/database.ts";

await serveDatabase({
  hello: () => ({ protocolVersion: DATABASE_PROTOCOL_VERSION, pluginVersion: "1.0.0", features: ["passwordBytes"],
    engines: [{ engine: "duckdb", title: "DuckDB", keywords: [], functions: [], identifierQuote: "\"",
                supportsEditing: true, supportsTransactions: true, hasDatabases: true }] }),
  connect: async ({ session, connection }) => { /* open connection.path or host:port */ return { serverVersion: "1.2", serverTitle: "DuckDB 1.2" }; },
  query: async ({ session, sql, maxRows }) => { /* … */ },
  // disconnect, ping, cancel, databases, objects, structure, tableData, applyChanges, serverInfo
});
```

Copy `packages/sdk/src/database.ts` into your extension (`lib/database.ts`): it has the types of every request and
result and the serve loop. The methods and what each must do are in [spec/database.md §4](../../spec/database.md#4-methods).
The rules that matter most:

- `tableData` is always a read, whatever the session; build the SELECT from the request and quote names yourself.
- `applyChanges` with `dryRun` returns the statements the app shows before asking; without it, write all or nothing,
  one row per update or delete.
- `cancel` must work while a `query` runs — the example kills the process that runs the statement.
- Values are text, `null` for NULL, binary as `0x…`.
- `truncated: true` in a `query` result means “there are more rows than in the answer”: you stopped at `maxRows` (or
  earlier, the result being too big). The editor then says “first N rows” and “showing the first N — limit” (fewer than
  `maxRows` — “more than 64 MB of text in one result isn't loaded: narrow the query”), the AI agent sees “there are
  more”. In `tableData`, with `truncated` and fewer rows than `limit`, the next page starts after what came. Every row
  given — `truncated: false`.
- **stdout is for answers only.** `serveDatabase` doesn't redirect `console.log` (unlike `defineModule`): a line of
  text on stdout is lost (the app looks for `"id"` in each line and skips the rest without a word — it won't be in the
  log), and a printed object with an `id` is taken as the answer to another request. Log to stderr — `console.error`.
- Don't answer `connect` with `readOnly: true` unless the session really can't write (a read-only file, a replica):
  the tab becomes «Только чтение», and without verified read commands (§4 below) the editor then runs nothing, not
  even a SELECT.
- `keyValue` and `document` engines answer their browsers' methods too — `redis.scan`, `redis.value`, `redis.command`
  and `mongo.find`, `mongo.write`: [spec/database.md §4.1–4.2](../../spec/database.md#41-keyvalue--the-key-browser-like-redis),
  types `KeyInfo`, `ScanResult`, `KeyValue`, `Reply`, `FindResult`, `WriteOp` in `database.ts`.

## 3. How it runs

- On this Mac, started on the first request, again after it exits; stopped when the documents lock and when the app
  quits (stdin closes — exit then).
- Every file of the extension is hashed again before each start: change a file of an installed extension and it
  won't start until approved again. For development link the folder (Settings → Extensions → Development
  folder…): changes apply at once.
- A database behind a server: the app forwards a port over its own SSH session and gives you `127.0.0.1:<port>`; you
  never see SSH keys, the document or other databases' passwords.
- If the program exits, its tabs say «Расширение «…» завершилось» with the last lines of stderr, and reconnect on the
  next action.

## 4. What asks first

The app decides, not the driver. For an extension's engine **every statement is a change**: Production asks before
running it, «Только чтение» refuses it. `readCommands` (`["select", "show", "explain"]`) let plain reads run without
a question — **only for extensions verified by SSHKipper** (from the library); for any other extension they are
ignored, and the extension's log says so. Even then a statement with a second statement, a CTE or subquery that
changes data, `INTO`, a locking read or a side-effect function is still a change, and words that change data
(`with`, `set`, `insert`…) are never accepted as read commands.

A new node of your engine is «Обычный» (a file engine's too): statements run as typed. In Production each asks; in
«Только чтение» none runs without verified read commands, and the tab says so — tables, keys and collections are
still browsed. Open a «Только чтение» node read-only yourself (`connection.readOnly`) — a second line of defence.

## 5. Try it

```sh
node packages/cli/sshkipper-ext.ts validate examples/db-sqlite-node
node --test tests/database.test.ts          # the example end to end over the protocol
```

In SSHKipper: Settings → Extensions → Install extension… (or `sshkipper-ext pack` for a `.sshkext`), then
File → Database…, engine «SQLite (Node, пример)», a `.sqlite` file on this Mac.
