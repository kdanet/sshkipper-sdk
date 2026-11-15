# SQLite on Node — a database driver

**Shows:** a database engine of an extension with the app's whole database tab — the editor, the grid with edits,
filters, structure, transactions of the editor, «Стоп» — answered by a driver speaking the database protocol
([spec/database.md](../../spec/database.md)): SQLite files on this Mac through Node's built-in `node:sqlite`, a process
per session so «Стоп» can end a statement. `lib/database.ts` is the SDK's protocol file (types and the serve loop).

**Contributes:** `database` (engine `example-sqlite`, model `sql`, a file). Permissions: none.

**Try it** (from the SDK's root, `sshkipper-ext` on PATH):

```sh
sshkipper-ext validate examples/db-sqlite-node
node --disable-warning=ExperimentalWarning examples/db-sqlite-node/driver.ts   # then {"id":1,"method":"hello","params":{}}
```

**In SSHKipper:** Settings → Extensions → Development folder… → File → Database… → «SQLite (Node, пример)» → a `.sqlite` file. The node starts
«Обычный»: the editor runs `select * from t` at once. Its `readCommands` count only when the extension comes from
SSHKipper's library: otherwise every statement is a change — Production asks before each, and «Только чтение» runs
none (the tab says so; tables are still browsed, read-only). The driver opens a «Только чтение» node's file read-only
itself and answers `connect` with `readOnly` only then. Guide: [database drivers](../../docs/en/database-drivers.md).

**По-русски:** драйвер базы данных: файлы SQLite на этом Mac через `node:sqlite`, вся вкладка базы приложения. Новый
узел — «Обычный»; в «Только чтение» без проверки SSHKipper редактор не выполняет ни одного запроса (так и пишет).
Руководство — [драйверы баз данных](../../docs/ru/database-drivers.md).
