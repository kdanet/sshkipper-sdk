# Манифест

`sshkipper-module.json` в корне модуля. Схема — [schemas/module.schema.json](../../schemas/module.schema.json)
(укажите её в `$schema`, и редактор будет дополнять и проверять ключи); остальное проверяет `sshkipper-ext validate`.

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
в `context.settings` не попадает никогда). Обработчики читают настройки как `SK_SETTING_<KEY>` (сервер) или
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
| `sudo` | `auto` (по умолчанию): через `sudo -n`, когда сервер это разрешает и у модуля есть право `sudo`; `required`; `never`. |
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
  `number`, `bool`, `choice`. Значения проверяются по ним до того, как что-то запустится.

## Инструменты AI и блоки автоматизаций

См. [Инструменты AI и блоки автоматизаций](ai-and-automation.md).

## Компоненты

Части видов, которые подставляются через `{"use": "имя", "props": {…}}` и читаются как `props.*`:

```json
"components": {
  "kpi": { "type": "metric", "title": "{{ props.title }}", "value": "{{ props.value }}", "status": "{{ props.status }}" }
}
```
