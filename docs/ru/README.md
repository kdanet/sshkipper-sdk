# Расширения SSHKipper

SSHKipper — нативный SSH-менеджер для macOS. **Расширение** дополняет его: папка (или архив `.sshkext`) с
`sshkipper-extension.json`, где в `contributes` перечислены точки приложения, которые оно дополняет, — его **вклады**.
**Модуль** — самый старый вид: расширение только со службой, инструментами AI и блоками автоматизаций
(`sshkipper-module.json`, `.sshkmod`), читается так же.

## Расширение = вклады

| Вклад | Что получает пользователь | Кто отвечает | Руководство | Пример |
|---|---|---|---|---|
| `service` | Службу сервера: «Службы» карточки, узел в дереве, раздел вкладки служб, страницы, действия | обработчики | [на сервере](server-modules.md), [программы](process-modules.md) | [processes](../../examples/processes), [http-checks](../../examples/http-checks), [screens](../../examples/screens), [swift-hello](../../examples/swift-hello) |
| `tools` | Инструменты AI, которые агент приложения вызывает в рамках режима AI сервера | обработчики | [AI и автоматизации](ai-and-automation.md) | [processes](../../examples/processes) |
| `automation` | Блоки библиотеки автоматизаций | обработчики | [AI и автоматизации](ai-and-automation.md) | [http-checks](../../examples/http-checks) |
| `database` | Движок базы данных со всей вкладкой базы | драйвер ([database.md](../../spec/database.md)) | [драйверы баз данных](database-drivers.md) | [db-sqlite-node](../../examples/db-sqlite-node) |
| `storage` | Вид хранилища в панели файлов, передачах, автоматизациях | `storage/*` | [хранилища и источники](storage-and-sources.md) | [example-folder-storage](../../examples/example-folder-storage) |
| `source` | Живую папку серверов в дереве | `source/*` | [хранилища и источники](storage-and-sources.md) | [example-hetzner-source](../../examples/example-hetzner-source) |
| `nodeType`, `screen` | Свой узел с карточкой и вкладкой; экран во вкладке или разделе | `render`, `ui/event` | [свой тип узла](node-types.md) | [node-type-sitechecks](../../examples/node-type-sitechecks) |
| `import` | Файл другой программы → папки и подключения | `import/parse` | [импорт и консоли](importers-and-consoles.md) | [import-csv](../../examples/import-csv) |
| `console` | Текстовую консоль во вкладке терминала приложения | `console/*` | [импорт и консоли](importers-and-consoles.md) | [console-echo](../../examples/console-echo) |
| `ai` | Провайдера модели: профиль в Настройки → AI | `ai/*` | [AI и автоматизации](ai-and-automation.md) | [ai-echo-provider](../../examples/ai-echo-provider) |

Каждый экран — JSON, который приложение рисует своими контролами ([UI-Kit](ui-kit.md)): никакого HTML и WebView.

## Где выполняется код

| | `server` | `process` |
|---|---|---|
| Обработчики | shell-скрипты расширения | имена, на которые отвечает программа |
| Где выполняются | на сервере, через SSH-сессию приложения (бастионы, 2FA, контейнеры, `sudo -n`) | на этом Mac: программа, JSON-RPC через stdio |
| Для чего | смотреть и менять что-то на сервере | API, история, логика — все вклады, кроме службы |
| Как достать сервер | они уже там | `host.exec(...)` — команду выполнит приложение по своей сессии |
| Язык | POSIX `sh` (без `jq`; JSON пишет прелюдия SDK) | любой; в SDK — [TypeScript](process-modules.md) (Node 24) и [Swift](swift.md) |

Код расширения никогда не загружается в процесс приложения. Серверные скрипты нигде не устанавливаются: они едут с
каждым вызовом и ничего не оставляют. Программа сверяется по хешам перед каждым запуском и получает чистое окружение.

## Порядок чтения

1. [Быстрый старт](getting-started.md) — работающее расширение за пять минут, `sshkipper-ext new --kind …`
2. [Манифест](manifest.md) — каждый ключ, права, `contributes`
3. [UI-Kit](ui-kit.md) — виды, блоки, живые экраны, шаблоны ([справочник](ui-kit-reference.md))
4. Способ выполнения: [модули на сервере](server-modules.md) · [программы на TypeScript](process-modules.md) · [Swift](swift.md)
5. Ваш вклад: [инструменты AI, блоки автоматизаций, провайдеры моделей](ai-and-automation.md) ·
   [хранилища и источники](storage-and-sources.md) · [драйверы баз данных](database-drivers.md) ·
   [свой тип узла и экран](node-types.md) · [импорт и консоли](importers-and-consoles.md)
6. [Публикация](publishing.md) — упаковка, установка, версии, библиотека
7. [Безопасность](security.md) — что расширение может и чего не может, что одобряет пользователь
8. [Для AI-агентов](agents.md) — MCP-сервер

Протокол (нормативный, на английском): [spec/protocol.md](../../spec/protocol.md) (§1–9 обработчики и модули, §10
расширения, §11 живые экраны, §12 хранилища и источники, §13 провайдеры моделей, §14 типы узлов, §15 импорт, §16
консоли) и [spec/database.md](../../spec/database.md). Одно слово — одна вещь: [словарь терминов](../glossary.md).

## В этом репозитории

| | |
|---|---|
| [spec/](../../spec) | Протоколы, нормативно |
| [schemas/](../../schemas) | JSON Schema манифеста и видов; `symbols.json` — символы, которые рисует приложение |
| [packages/sdk](../../packages/sdk/src) | TypeScript: типы, конструкторы UI-Kit, среда программы, шаблоны, проверка, предпросмотр, локальный запуск |
| [packages/swift](../../packages/swift) | Swift: пакет `SSHKipperSDK` |
| [packages/cli](../../packages/cli) | `sshkipper-ext`: new, validate, run, preview, pack, vendor, mcp |
| [packages/mcp](../../packages/mcp) | MCP-сервер для AI-агентов, которые пишут расширения |
| [examples/](../../examples) | Расширение каждого вида, у каждого README |

Нужно: SSHKipper с расширениями (Настройки → Расширения); Node.js 24+ для командной строки и программ на TypeScript;
Swift 6 для пакета на Swift.
