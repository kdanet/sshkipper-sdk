# Быстрый старт

## 1. Командная строка

```sh
git clone https://github.com/kdanet/sshkipper-sdk.git
cd sshkipper-sdk && npm link          # sshkipper-module в PATH (Node 24+, без зависимостей)
sshkipper-module help
```

Без `npm link`: `node /путь/к/sshkipper-sdk/packages/cli/sshkipper-module.ts …`.

## 2. Модуль

```sh
sshkipper-module new disks --id dev.acme.disks --title "Диски"
cd disks
sshkipper-module validate
```

`new` пишет серверный модуль, который уже работает: **служба** появляется там, где отвечает `df`; **страница** с
кольцами и строками; **действие** «Обновить»; **инструмент AI** `disk_usage`; **блок автоматизации** «Заполненность
дисков» одной точки монтирования. `--process` — то же самое программой на TypeScript.

```
disks/
  sshkipper-module.json      манифест: что модуль добавляет и какой обработчик что делает
  scripts/detect.sh          {"found": true} там, где служба есть
  scripts/summary.sh         {"text": "/ — 71%", "status": "ok"} — строка рядом с ней в дереве
  scripts/list.sh            данные страницы
  scripts/usage.sh           блок автоматизации
  views/main.json            страница: шаблон над data.list
```

## 3. Запуск без приложения

```sh
sshkipper-module call summary                     # обработчик здесь, через sh
sshkipper-module call summary --ssh deploy@web-1  # то же на сервере, через ваш ssh
sshkipper-module preview main --run               # страница текстом, с тем, что вернули обработчики
```

`call` даёт обработчику то же, что приложение: запрос на stdin, переменные `SK_*`, прелюдию SDK, остальные файлы
`scripts/` для `sk_file`. Ещё: `--input '{"mount": "/var"}'`, `--settings '{…}'`, `--secret ключ=значение`.

## 4. В SSHKipper

1. Настройки → Расширения → Модули → **Подключить папку для разработки…** → папка `disks/`. Подключённая папка
   перечитывается, когда вы сохраняете файлы.
2. Откройте подключение: в **«Службах»** появится «Диски» («Автоматически» — включён там, где `detect` её находит) с
   настройками модуля. В дереве служба стоит под сервером, во вкладке служб сервера — её раздел.
3. Раздел — ваша страница, нарисованная деталями самого приложения. В меню «⋯» — ваши действия и «Журнал модуля…»:
   что каждый обработчик написал в stderr, сколько шёл, что упало.

## 5. Сделайте его своим

- `scripts/list.sh` печатает ваши данные в JSON — `sk_json_string` и `sk_json_kv` из прелюдии пишут JSON без `jq`.
- `views/main.json` — блоки описаны в [UI-Kit](../en/ui-kit.md); `{{ data.list.… }}` берёт то, что вернул `list`.
- Действие: обработчик, затем `actions: [{"id", "title", "handler", "risk": "change", "confirm": "…"}]` и его id в
  `actions` строки — оно появится в меню строки и спросит перед запуском.
- `sshkipper-module validate` после каждой правки скажет то же, что скажет приложение.

## 6. Поделиться

```sh
sshkipper-module pack            # → dev.acme.disks-0.1.0.sshkmod
```

Настройки → Расширения → Модули → **Установить модуль…** берёт файл; перед установкой приложение показывает, что
модуль просит (права, команды на серверах, инструменты AI).
