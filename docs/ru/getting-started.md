# Быстрый старт

## 1. Командная строка

Нужен Node.js 24 или новее. CLI ставится пакетом — npm собирает его в JavaScript (Node выполняет TypeScript как есть,
но не внутри `node_modules`):

```sh
npm install -g github:kdanet/sshkipper-sdk   # или архив: npm pack в клоне → npm install -g sshkipper-sdk-1.1.0.tgz
sshkipper-ext help
```

Или работайте из клона, с TypeScript как есть — правки SDK действуют сразу:

```sh
git clone https://github.com/kdanet/sshkipper-sdk.git
cd sshkipper-sdk && npm install && npm link   # единственные зависимости (для разработки) — TypeScript и типы Node
```

Без того и другого: `node /путь/к/sshkipper-sdk/packages/cli/sshkipper-ext.ts …`. У каждой команды есть `--help`.
Старое имя `sshkipper-module` работает (одна строка скажет, что оно переименовано; его `call` — это `run`).

## 2. Расширение

```sh
sshkipper-ext new disks --id dev.acme.disks --title "Диски"
cd disks
sshkipper-ext validate
```

`new` пишет расширение, которое уже работает, — по умолчанию **службу** серверов из shell-скриптов: **служба**
появляется там, где отвечает `df`; **страница** с кольцами и строками; **действие** «Обновить»; **инструмент AI**
`disk_usage`; **блок автоматизации** «Заполненность дисков» одной точки монтирования. `--process` — то же самое
программой на TypeScript на этом Mac.

```
disks/
  sshkipper-extension.json   манифест: что расширение добавляет и какой обработчик что делает
  scripts/detect.sh          {"found": true} там, где служба есть
  scripts/summary.sh         {"text": "/ — 71%", "status": "ok"} — строка рядом с ней в дереве
  scripts/list.sh            данные страницы
  scripts/usage.sh           блок автоматизации
  views/main.json            страница: шаблон над data.list
```

`--kind` начинает с другого вклада — каждый работает с первой минуты, его README говорит, как попробовать:

| `--kind` | Что получится | Читать дальше |
|---|---|---|
| `service` | служба серверов (скрипты; `--process` — программа) | [на сервере](server-modules.md), [программы](process-modules.md) |
| `database` | движок базы данных со всей вкладкой базы приложения (читает таблицы из JSON-файла) | [драйверы баз данных](database-drivers.md) |
| `storage` | вид хранилища для панели файлов и передач | [хранилища и источники](storage-and-sources.md) |
| `source` | живая папка серверов в дереве | [хранилища и источники](storage-and-sources.md) |
| `node-type` | свой узел с карточкой и живым экраном во вкладке | [свой тип узла](node-types.md) |
| `import` | файл другой программы → папки и подключения | [импорт и консоли](importers-and-consoles.md) |
| `console` | текстовая консоль в терминале приложения | [импорт и консоли](importers-and-consoles.md) |
| `ai` | провайдер модели для Настройки → AI | [AI и автоматизации](ai-and-automation.md) |
| `automation` | блоки автоматизаций, на которые отвечает программа | [AI и автоматизации](ai-and-automation.md) |

Программа на Swift вместо TypeScript — [Swift](swift.md).

## 3. Запуск без приложения

```sh
sshkipper-ext run summary                     # обработчик здесь, через sh
sshkipper-ext run summary --ssh deploy@web-1  # то же на сервере, через ваш ssh
sshkipper-ext preview main --run              # страница текстом, с тем, что вернули обработчики
```

`run` даёт обработчику то же, что приложение: запрос на stdin, переменные `SK_*`, прелюдию SDK, остальные файлы
`scripts/` для `sk_file`. Ещё: `--input '{"mount": "/var"}'`, `--settings '{…}'`, `--secret ключ=значение`. Имя с
косой чертой — собственный метод вклада программы: `run source/poll --params '{…}'`,
`run import/parse --file servers.txt --importer hosts`. `preview` проводит живой экран через события:
`preview tasks --events '[{"type": "open"}, {"type": "press", "value": {"item": "add"}}]'`.

## 4. В SSHKipper

1. Настройки → Расширения → **«Папка разработки…»** → папка `disks/`. Подключённая папка перечитывается, когда вы
   сохраняете файлы.
2. Откройте подключение: в **«Службах»** появится «Диски» («Автоматически» — включена там, где `detect` её находит) с
   настройками модуля. В дереве служба стоит под сервером, во вкладке служб сервера — её раздел.
3. Раздел — ваша страница, нарисованная деталями самого приложения. В её меню «⋯» — ваши действия; в «⋯» расширения
   в Настройки → Расширения — «Журнал…»: что каждый обработчик написал в stderr, сколько шёл, что упало.

## 5. Сделайте его своим

- `scripts/list.sh` печатает ваши данные в JSON — `sk_json_string` и `sk_json_kv` из прелюдии пишут JSON без `jq`.
- `views/main.json` — блоки описаны в [UI-Kit](ui-kit.md); `{{ data.list.… }}` берёт то, что вернул `list`.
- Действие: обработчик, затем `actions: [{"id", "title", "handler", "risk": "change", "confirm": "…"}]` и его id в
  `actions` строки — оно появится в меню строки и спросит перед запуском.
- `sshkipper-ext validate` после каждой правки скажет то же, что скажет приложение.

## 6. Поделиться

```sh
sshkipper-ext pack            # → dev.acme.disks-0.1.0.sshkext
```

Настройки → Расширения → **«Установить расширение…»** берёт файл; перед установкой приложение показывает, что
расширение добавляет и просит (права, команды на серверах, инструменты AI). Подробнее — [Публикация](publishing.md).
