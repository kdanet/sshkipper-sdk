# Драйверы баз данных

Расширение может добавить в SSHKipper **движок базы данных**. Узел «База данных» этого движка открывает ту же вкладку,
что встроенные MySQL и PostgreSQL: редактор запросов с подсветкой и дополнением, сетку с фильтрами и правкой, структуру и
DDL, AI-фильтр и «Составить запрос», Production и «Только чтение», проброс через SSH-сессию приложения (бастионы, 2FA).
Всё это рисует приложение; ваша программа только отвечает по **протоколу баз** ([spec/database.md](../../spec/database.md)).

Пример: [examples/db-sqlite-node](../../examples/db-sqlite-node) — файлы SQLite через встроенный в Node модуль
`node:sqlite`, ничего устанавливать не нужно.

## 1. Манифест

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

- `model` выбирает экраны: `sql` — редактор и таблицы, `keyValue` — обозреватель ключей, `document` — коллекции.
- `isFile` — файл на этом Mac (узел спрашивает путь); иначе адрес и порт — напрямую или через сервер.
- `command` — если драйвер — не та программа, что `runtime.command`. Без него программа из `runtime` запускается
  **отдельным процессом** для драйвера, с `SK_ROLE=database` в окружении.
- `readCommands` — см. «Что спрашивается» ниже.

Движок появляется в «Новой базе», палитре и выборе СУБД в карточке узла, как только расширение включено, — раньше, чем
ваша программа запустится. Выключили или удалили расширение — узлы остаются и говорят, какое расширение им нужно.

## 2. Программа

Один JSON-объект на строку в stdin и stdout: на входе `{"id", "method", "params"}`, на выходе `{"id", "result"}` или
`{"id", "error": {"code", "message"}}`, журнал — в stderr. С SDK:

```ts
import { DATABASE_PROTOCOL_VERSION, DatabaseError, serveDatabase } from "./lib/database.ts";

await serveDatabase({
  hello: () => ({ protocolVersion: DATABASE_PROTOCOL_VERSION, pluginVersion: "1.0.0", features: ["passwordBytes"],
    engines: [{ engine: "duckdb", title: "DuckDB", keywords: [], functions: [], identifierQuote: "\"",
                supportsEditing: true, supportsTransactions: true, hasDatabases: true }] }),
  connect: async ({ session, connection }) => { /* открыть connection.path или host:port */ return { serverVersion: "1.2", serverTitle: "DuckDB 1.2" }; },
  query: async ({ session, sql, maxRows }) => { /* … */ },
  // disconnect, ping, cancel, databases, objects, structure, tableData, applyChanges, serverInfo
});
```

Скопируйте `packages/sdk/src/database.ts` в расширение (`lib/database.ts`): там типы всех запросов и ответов и цикл
обработки. Методы и что каждый должен делать — [spec/database.md §4](../../spec/database.md#4-methods). Главное:

- `tableData` — всегда чтение, какой бы ни была сессия; SELECT собираете сами по запросу, имена в кавычках — тоже вы.
- `applyChanges` с `dryRun` возвращает выражения, которые приложение покажет в вопросе; без него — всё или ничего,
  ровно одна строка на UPDATE и DELETE.
- `cancel` должен работать, пока идёт `query`: пример убивает процесс, в котором выполняется выражение.
- Значения — текст, `null` для NULL, двоичные — `0x…`.
- Не отвечайте на `connect` с `readOnly: true`, если сессия на деле может писать (это для файла только для чтения,
  реплики): вкладка станет «Только чтение», и без проверенных команд чтения (раздел 4) редактор не выполнит ничего,
  даже SELECT.
- Движки `keyValue` и `document` отвечают и на методы своих браузеров — `redis.scan`, `redis.value`, `redis.command`
  и `mongo.find`, `mongo.write`: [spec/database.md §4.1–4.2](../../spec/database.md#41-keyvalue--the-key-browser-like-redis),
  типы `KeyInfo`, `ScanResult`, `KeyValue`, `Reply`, `FindResult`, `WriteOp` в `database.ts`.

## 3. Как запускается

- На этом Mac, при первом запросе и снова после выхода; останавливается при блокировке документов и выходе из
  приложения (закрывается stdin — тогда завершайтесь).
- Перед каждым запуском все файлы расширения хешируются заново: изменили файл установленного расширения — оно не
  запустится, пока его не разрешат снова. Для разработки подключите папку (Настройки → Расширения →
  «Папка разработки…»): изменения применяются сразу.
- База за сервером: приложение пробрасывает порт по своей SSH-сессии и даёт вам `127.0.0.1:<порт>`; ключи SSH,
  документ и пароли других баз вы не видите.
- Программа завершилась — её вкладки пишут «Расширение «…» завершилось» с последними строками stderr и переподключаются
  при следующем действии.

## 4. Что спрашивается

Решает приложение, а не драйвер. У движка расширения **любое выражение — изменение**: Production спросит перед
выполнением, «Только чтение» откажет. `readCommands` (`["select", "show", "explain"]`) пропускают простые чтения без
вопроса — **только у расширений, проверенных SSHKipper** (из библиотеки); у остальных они не учитываются, и журнал
расширения говорит почему. И тогда выражение со вторым выражением, CTE или подзапросом с изменением, `INTO`,
блокирующим чтением или функцией с побочным эффектом остаётся изменением, а слова, меняющие данные (`with`, `set`,
`insert`…), командами чтения не принимаются.

Новый узел вашего движка — «Обычный» (и у файлового движка): выражения выполняются как набраны. В Production каждое
спрашивается; в «Только чтение» без проверенных команд чтения не выполняется ни одно, и вкладка говорит почему —
таблицы, ключи и коллекции при этом просматриваются. Открывайте узел «Только чтение» только для чтения сами
(`connection.readOnly`) — вторая линия защиты.

## 5. Попробовать

```sh
node packages/cli/sshkipper-ext.ts validate examples/db-sqlite-node
node --test tests/database.test.ts          # пример целиком по протоколу
```

В SSHKipper: Настройки → Расширения → «Установить расширение…» (или `sshkipper-ext pack` → `.sshkext`), затем
Файл → База данных…, СУБД «SQLite (Node, пример)», файл `.sqlite` на этом Mac.
