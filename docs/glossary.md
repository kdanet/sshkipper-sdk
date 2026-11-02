# Glossary · Словарь терминов

One word for one thing, in the guides of both languages, in the protocol and in the app's interface. Menus and
buttons are named as the guide's language names them in the app (English or Russian interface — the table at the
end); what the app says to the user (messages, states) is quoted «as in the Russian interface», its source language.

Одно слово — одна вещь: в руководствах на обоих языках, в протоколе и в интерфейсе приложения. Меню и кнопки названы
так, как их называет приложение на языке руководства (таблица в конце); то, что приложение говорит пользователю
(сообщения, состояния), — в «кавычках», как в русском интерфейсе.

| English | Русский | What it is · Что это |
|---|---|---|
| extension | расширение | A package that adds to the app: a folder or `.sshkext` with `sshkipper-extension.json`. · Пакет, который дополняет приложение: папка или `.sshkext` с `sshkipper-extension.json`. |
| module | модуль | An extension of `service`, `tools`, `automation` only; `sshkipper-module.json`, `.sshkmod`. · Расширение только со службой, инструментами и блоками; `sshkipper-module.json`, `.sshkmod`. |
| contribution | вклад | One point of the app an extension adds to (`contributes.<kind>[]`): `service`, `tools`, `automation`, `database`, `storage`, `source`, `nodeType`, `screen`, `import`, `console`, `ai`. · Точка приложения, которую расширение дополняет. |
| manifest | манифест | `sshkipper-extension.json` / `sshkipper-module.json` (`schemas/module.schema.json`). |
| package | пакет | The folder, or its ZIP: `.sshkext` (extension), `.sshkmod` (module). · Папка или её ZIP. |
| runtime: `server` / `process` | способ выполнения: `server` / `process` | sh scripts on the server over the app's SSH session / a program on this Mac speaking JSON-RPC over stdio. · sh-скрипты на сервере через SSH-сессию приложения / программа на этом Mac, JSON-RPC через stdio. |
| program | программа | The process runtime's executable (`runtime.command`). · Исполняемое расширения на этом Mac. |
| handler | обработчик | A named unit the app calls (`handler/call`): a script or a name the program answers. · Именованная единица, которую вызывает приложение. |
| method (of a contribution) | метод (вклада) | A JSON-RPC request of a contribution: `storage/list`, `source/poll`, `import/parse`, `console/open`, `ai/chat`, `ui/event`. · Свой запрос вклада. |
| host request (`host/*`) | запрос к приложению (`host/*`) | What a program asks of the app: `host/exec`, `secret`, `store`, `notify`, `log`, `forward`, `oauth`, `open`, `ask`. · Что программа просит у приложения. |
| permission | право | `exec`, `sudo`, `secrets`, `store`, `notify`, `network`, `forward`, `oauth` in the manifest; each host request needs its own. · Права в манифесте; каждому запросу — своё. |
| service | служба | A service of a server: detect, summary, tree, pages — «Службы» of the connection card. · Служба сервера: обнаружение, сводка, дерево, страницы. |
| page | страница | A page of a service: a template (`view` + `data`) or `render`. · Страница службы: шаблон или `render`. |
| view | вид | The JSON of a page or a screen: `title`, `status`, `state`, `blocks` (`schemas/view.schema.json`). · JSON страницы или экрана. |
| block | блок | One element of a view the app draws natively (UI-Kit). · Элемент вида, который приложение рисует само. |
| UI-Kit | UI-Kit | The set of blocks, styles, actions and templates. · Набор блоков, стилей, действий и шаблонов. |
| template | шаблон | `{{ … }}`, `each`, `if`, `use` — expanded by the app before drawing. · Подстановки, которые приложение раскрывает до рисования. |
| live screen | живой экран | A view with `events`: the app keeps its state, sends events, applies ops. · Вид с `events`: состояние у приложения, события — программе. |
| screen (contribution) | экран (вклад) | `contributes.screen`: a tab or a section of the services tab, built by `render`. · Вкладка или раздел вкладки служб. |
| event | событие | `ui/event`: press, select, change, expand, more, sort, edit, submit… · Что сделал пользователь. |
| op | операция | One change of a screen in `ui/patch`: `replace`, `set`, `rows`, `append`… · Одно изменение экрана. |
| push | отправка (`ui/push`) | Ops a program sends by itself: live data. · Операции, которые программа шлёт сама. |
| action | действие | `actions[]`: a menu item or button running a handler; risk `read` / `change` / `danger`. · Пункт меню или кнопка с обработчиком. |
| risk | риск | `read` (reads), `change` (changes, asks), `danger` (disruptive, asks in red). · Чтение / изменение / опасное. |
| AI tool | инструмент AI | `tools[]`: what the app's agent may call under the server's AI mode. · Что агент приложения вызывает в рамках режима AI. |
| automation block | блок автоматизации | `automation[]`: a block of the automations library. The library itself calls every block a «модуль» (module): blocks of extensions are in its section «Из расширений» (From extensions), the user's own in «Мои модули». · Блок библиотеки автоматизаций; в самой библиотеке блоки называются «модулями»: блоки расширений — в разделе «Из расширений», свои — в «Мои модули». |
| setting | настройка | `settings[]` of a module: the connection card, inherited from folders. · Настройки модуля в карточке подключения. |
| field | поле | `fields[]` of a storage, source, node type, model provider: their card. · Поля карточки вклада. |
| secret | секрет | A `secret` setting or field: kept encrypted by the app, given only on request. · Хранится зашифрованным, выдаётся только по запросу. |
| node | узел | An item of the user's document (connection, folder, database, storage…). · Элемент документа пользователя. |
| node type | тип узла | `contributes.nodeType`: a node of the extension's own. · Свой узел расширения. |
| storage | хранилище | `contributes.storage`: a kind of storage in the file panel. · Свой вид хранилища в панели файлов. |
| source | источник | `contributes.source`: a live folder of found hosts in the tree. · Живая папка найденных узлов. |
| found host | найденный узел | A host a source returns; never written into the document. · Узел источника; в документ не пишется. |
| importer | импорт | `contributes.import`: another program's file into folders and connections. · Файл другой программы → папки и подключения. |
| console | консоль | `contributes.console`: a text console in the app's terminal tab. · Текстовая консоль во вкладке терминала. |
| model provider | провайдер модели | `contributes.ai`: a profile of Settings → AI. · Профиль в Настройки → AI. |
| database driver | драйвер базы | `contributes.database`: a separate process speaking the database protocol (`spec/database.md`). · Отдельный процесс по протоколу баз. |
| engine | движок | A database engine id (`example-sqlite`). · Id движка базы. |
| forward | проброс | `host/forward`: a port forwarded through the app's SSH session. · Порт через SSH-сессию приложения. |
| browser sign-in | вход через браузер | `host/oauth`: OAuth with PKCE on 127.0.0.1. |
| development folder | папка разработки | A folder linked in Settings → Extensions, reloaded on every change. · Подключённая папка, перечитывается при изменении. |
| library | библиотека | SSHKipper's signed index of extensions it reviewed. · Подписанный список проверенных расширений. |
| «Проверено SSHKipper» / «Автор не проверен» | — | Verified (files match the library's record) / unverified. · Файлы совпадают с записью библиотеки / не проверено. |
| fingerprint | отпечаток | The hash of every file of a package. · Хеш всех файлов пакета. |
| prelude | прелюдия | `spec/prelude.sh`: shell functions the app puts before each server script. · Функции sh перед каждым серверным скриптом. |
| context | контекст | `context` of a request: server, settings, item, node, locale. · Контекст вызова. |
| Production | Production | A server or node marked Production: changes always ask. · Узел с пометкой Production: изменения всегда спрашиваются. |

## The app's menus · Меню приложения

Where a contribution shows up, in both interfaces. · Где появляется вклад — в обоих интерфейсах.

| Contribution · Вклад | English interface | Русский интерфейс |
|---|---|---|
| install, develop · установка, разработка | Settings → Extensions → Install extension… / Development folder… / Log… | Настройки → Расширения → Установить расширение… / Папка разработки… / Журнал… |
| `service` | a connection's card → Services | карточка подключения → Службы |
| `database` | File → Database… → the engine | Файл → База данных… → движок |
| `storage` | File → Storage… → its tile under From extensions | Файл → Хранилище… → плитка в разделе «Из расширений» |
| `source` | File → Server source → «<title>…» | Файл → Источник серверов → «<название>…» |
| `nodeType` | File → From extensions → «<title>…» (also «+» in the toolbar, Create in the tree's menu) | Файл → Из расширений → «<название>…» (и «+» на панели, «Создать» в меню дерева) |
| `import` | File → Import → «<title>…» | Файл → Импорт → «<название>…» |
| `console` | a connection's menu → Console: <title> | меню подключения → Консоль: <название> |
| `ai` | Settings → AI → «+» → From extensions | Настройки → AI → «+» → Из расширений |
| `automation` | an automation's library → From extensions | библиотека автоматизации → Из расширений |
