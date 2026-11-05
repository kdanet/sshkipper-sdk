# Манифест

`sshkipper-extension.json` в корне расширения — или `sshkipper-module.json` у модуля (только служба, инструменты AI и
блоки автоматизаций; читается так же, упаковывается в `.sshkmod`). В папке — один из двух. Схема у обоих —
[schemas/module.schema.json](../../schemas/module.schema.json) (укажите её в `$schema`, и редактор будет дополнять и
проверять ключи); остальное проверяет `sshkipper-ext validate`. Что расширение добавляет кроме службы — `contributes` —
в конце страницы.

```json
{
  "$schema": "https://raw.githubusercontent.com/kdanet/sshkipper-sdk/main/schemas/module.schema.json",
  "sdk": 1,
  "id": "dev.acme.queues",
  "version": "1.2.0",
  "title": { "en": "Queues", "ru": "Очереди" },
  "description": "Laravel queues of the server: workers, failed jobs, retry.",
  "author": { "name": "Acme", "url": "https://acme.dev" },
  "license": "MIT",
  "icon": { "symbol": "tray.full", "color": "orange" },
  "runtime": { "kind": "server" },
  "permissions": ["exec", "sudo"],
  "settings": [ … ],
  "service": { … },
  "pages": [ … ],
  "handlers": { … },
  "actions": [ … ],
  "tools": [ … ],
  "automation": [ … ],
  "components": { … }
}
```

## Кто это

| Ключ | |
|---|---|
| `sdk` | `1` — версия протокола. Версию, которую приложение не знает, оно не принимает. |
| `id` | Обратный DNS, строчными буквами: `dev.acme.queues`. Уникален; по нему хранятся настройки, данные `store` и блоки автоматизаций. |
| `version` | Семантическая версия. Если установленный модуль изменился, приложение снова спросит разрешение. |
| `title`, `description` | Строка или по строке на язык: `{"en": "Queues", "ru": "Очереди"}`. Приложение берёт язык пользователя, затем его основной язык, затем английский, затем любой другой. |
| `icon` | `symbol` — один из [schemas/symbols.json](../../schemas/symbols.json) (другие показываются пазлом); `color` — имя из палитры (`blue green orange red yellow purple pink teal indigo cyan mint brown gray`, они подстраиваются под тёмную тему) или `#RRGGBB`. |

## Способ выполнения и права

```json
"runtime": { "kind": "server" }
"runtime": { "kind": "process", "command": ["node", "module.ts"], "env": { "LOG_LEVEL": "info" } }
```

`process`: команда запускается в папке модуля. Голое имя (`node`, `python3`) ищется в обычных местах и в `PATH`
оболочки входа пользователя; путь (`bin/agent`) должен вести к файлу модуля.

`permissions` — при установке показываются словами; проверяются там, где через приложение идёт работа:

| | |
|---|---|
| `exec` | Команды на серверах. **Обязательно** для серверного модуля с обработчиками (без него приложение не принимает модуль и не запускает ни один его скрипт) и для `host.exec` у модулей-программ |
| `sudo` | Через `sudo -n` — там, где у сервера включено «Использовать sudo -n» |
| `secrets` | Секретные настройки (`type: "secret"`) — обработчики получают их файлами или через `host.secret` |
| `network` | Объявление: программа сама открывает соединения с этого Mac (модули-программы). Не ограничивается — у модуля-программы нет песочницы |
| `store` | `host.store` — данные модуля в JSON на этом Mac |
| `notify` | `host.notify` — уведомления |
| `forward` | `host.forward` — проброс порта через SSH-сессию приложения к серверу, к которому привязано хранилище (или база) |
| `oauth` | `host.oauth` — вход через браузер, пока пользователь нажимает «Войти»; токен хранится секретом узла |

Обновление, которое добавляет право (или вклад), ставится выключенным, пока пользователь его не включит.

## Настройки

Свои у каждого подключения: в карточке подключения, под модулем (раздел «Службы»), наследуются от папок. Задали один
раз на папке — действует у каждого сервера в ней.

```json
"settings": [
  { "key": "artisan", "title": "artisan path", "type": "path", "default": "/var/www/app/artisan" },
  { "key": "connection", "title": "Queue connection", "type": "choice", "default": "redis",
    "choices": [{ "value": "redis", "title": "Redis" }, { "value": "database", "title": "Database" }] },
  { "key": "token", "title": "API token", "type": "secret" },
  { "key": "queues", "title": "Queues", "type": "list", "placeholder": "default" }
]
```

Виды: `text`, `number`, `bool`, `choice`, `path`, `list` (строки), `secret` (хранится в документе зашифрованным,
в `context.settings` не попадает никогда). У настроек нет `pattern`: значение `text`, `path` или `list` доходит до
скрипта как его ввёл пользователь — берите `"$SK_SETTING_…"` в кавычки и проверяйте в скрипте сами; `number` — любое
число (дробное и отрицательное тоже). Обработчики читают настройки как `SK_SETTING_<KEY>` (сервер) или
`ctx.settings` (программа). Поля типа узла (`contributes.nodeType[].fields`) могут быть ещё и `node` — ссылка на
другой узел документа, с `nodeKinds` ([свой тип узла](node-types.md)).

## Служба

```jsonc
"service": {
  "detect": "detect",          // {"found": true} там, где служба есть; без detect — только там, где её включили
  "summary": "summary",        // {"text": "3 of 4 run", "status": "ok|warn|bad|off"} — строка и точка в дереве
  "page": "main",              // страница раздела (по умолчанию первая)
  "tree": { "handler": "queues", "page": "queue" },   // дочерние строки её узла в дереве; щелчок открывает эту страницу
  "containers": true           // может работать в Docker-контейнере сервера («Где работает»)
}
```

У каждого подключения модуль **«Автоматически»** (включён там, где его находит `detect`), **«Включена»** или
**«Выключена»**.

## Страницы

```json
"pages": [
  { "id": "main", "title": "Queues", "view": "views/main.json", "data": { "queues": "queues", "failed": "failed" }, "refresh": 10 },
  { "id": "queue", "title": "Queue", "view": "views/queue.json", "data": { "jobs": "jobs" } },
  { "id": "report", "title": "Report", "render": "report" }
]
```

Страница — это **шаблон** (`view` + `data`: обработчики идут параллельно, шаблон читает `data.<имя>`) или
**построенная** (`render`: обработчик возвращает весь вид). `refresh` — секунды между обновлениями, пока страница на
экране (от 2). `action: {"page": "queue"}` у строки открывает страницу, где эта строка — `item`; «Назад» возвращает.

## Обработчики

```json
"handlers": {
  "queues": { "script": "scripts/queues.sh", "timeout": 15 },
  "retry":  { "script": "scripts/retry.sh", "sudo": "auto" },
  "log":    { "script": "scripts/log.sh", "output": "lines" }
}
```

| Ключ | |
|---|---|
| `script` | Способ `server`: файл, который запускается через `sh` на сервере. Способ `process`: не нужен — ключ и есть имя, на которое отвечает программа. |
| `timeout` | Секунды, по умолчанию 30. |
| `sudo` | `auto` (по умолчанию): через `sudo -n`, когда сервер это разрешает и у модуля есть право `sudo`; `required`; `never`. В блоке автоматизации `auto` — **без** sudo: через `sudo -n` его выполняет только `required`. |
| `output` | `json` (по умолчанию), `text`, `lines`. |

## Действия

```json
"actions": [
  { "id": "retry", "title": "Retry", "symbol": "arrow.clockwise", "handler": "retry", "risk": "change", "on": "item",
    "confirm": "Retry {{ item.count }} failed jobs of {{ item.name }}?" },
  { "id": "flush", "title": "Flush failed…", "symbol": "trash", "handler": "flush", "risk": "danger",
    "confirm": "Delete every failed job on {{ server.name }}?",
    "params": [{ "key": "older", "title": "Older than, hours", "type": "number", "default": 24 }] }
]
```

- `on: "service"` (по умолчанию) — в меню «⋯» страницы; `on: "item"` — в строках, у которых его id есть в `actions`.
- `risk`: `read` выполняется сразу; `change` спрашивает; `danger` спрашивает с красной кнопкой. `confirm` — вопрос
  (`{{ item.* }}`, `{{ params.* }}`, `{{ server.* }}`, `{{ settings.* }}`).
- `params` — небольшая форма перед запуском: `text` (всегда задавайте `pattern`, если значение попадает в скрипт),
  `number` (любое число: целого, `min` и `max` нет — проверяйте в обработчике), `bool`, `choice`. Значения
  проверяются по ним до того, как что-то запустится. `choices` у параметра — **массив строк** (значение и есть
  надпись), у настройки — массив объектов:

  ```json
  "params":   [{ "key": "signal", "title": "Signal", "type": "choice", "choices": ["TERM", "HUP", "KILL"], "default": "TERM" }]
  "settings": [{ "key": "scope", "title": "Scope", "type": "choice", "default": "system",
                 "choices": [{ "value": "system", "title": "System" }, { "value": "user", "title": "User" }] }]
  ```

- Что видит пользователь, когда действие закончилось: над страницей на 4 секунды — `message` ответа (до 400 знаков),
  строка, если обработчик вернул строку, иначе «Готово»; затем страница обновляется. Ошибка обработчика (ненулевой
  код, `ModuleError`) — его сообщение, красным, и строка в журнале.

## Инструменты AI и блоки автоматизаций

См. [Инструменты AI и блоки автоматизаций](ai-and-automation.md).

## Компоненты

Части видов, которые подставляются через `{"use": "имя", "props": {…}}` и читаются как `props.*`:

```json
"components": {
  "kpi": { "type": "metric", "title": "{{ props.title }}", "value": "{{ props.value }}", "status": "{{ props.status }}" }
}
```

## Вклады (`contributes`)

Расширение перечисляет, что оно добавляет в приложение, в `contributes`: каждый вид — массив вкладов с `id`
(`^[a-z][a-z0-9_-]{0,39}$`, уникален внутри вида), `title` и необязательной `icon`. `service`, `tools` и
`automation` можно писать и там, и на верхнем уровне (но не в обоих местах). Протокол — [spec/protocol.md](../../spec/protocol.md) §10.

| Вид | Свои ключи | Кто отвечает | Руководство |
|---|---|---|---|
| `service`, `tools`, `automation` | как выше | обработчики | [на сервере](server-modules.md), [программы](process-modules.md), [AI и автоматизации](ai-and-automation.md) |
| `database` | `model`, `defaultPort`, `isFile`, `hasSchemas`, `hasEditorTransactions`, `identifierQuote`, `keywords`, `functions`, `readCommands`, `logo`, `command` | драйвер, [spec/database.md](../../spec/database.md) | [драйверы баз данных](database-drivers.md) |
| `storage` | `signIn`, `fields`, `capabilities` | `storage/*` (§12.1) | [хранилища и источники](storage-and-sources.md) |
| `source` | `fields`, `refresh` | `source/*` (§12.2) | [хранилища и источники](storage-and-sources.md) |
| `nodeType` | `fields` (со ссылками `node`), `screen` | `render` его экрана (§14) | [свой тип узла](node-types.md) |
| `screen` | `placement` (`tab`, `section`), `render` | `render`, затем `ui/event` (§11, §14.2) | [свой тип узла](node-types.md), [UI-Kit](ui-kit.md) |
| `import` | `fileExtensions`, `maxSizeMB` | `import/parse` (§15) | [импорт и консоли](importers-and-consoles.md) |
| `console` | `appliesTo` | `console/*` (§16) | [импорт и консоли](importers-and-consoles.md) |
| `ai` | `fields`, `reasoning` | `ai/models`, `ai/chat` (§13) | [AI и автоматизации](ai-and-automation.md) |

Всё, кроме `service`, `tools`, `automation`, `nodeType` и `screen`, требует способа выполнения `process` (у
`database` может быть своя `command`). Встроенные id (`mysql`, `s3`, `tailscale`…) расширение не заменяет; вид,
которого эта версия приложения не знает, — ошибка.
