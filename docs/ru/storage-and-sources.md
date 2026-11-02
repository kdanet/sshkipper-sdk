# Хранилища и источники

Расширение может добавить **вид хранилища** — файлы в панели файлов, очереди передач и автоматизациях — и **вид
источника** — живую папку серверов в дереве. На них отвечает программа расширения на этом Mac (`runtime: process`),
а всё рисует приложение. Точное описание — [spec/protocol.md §12](../../spec/protocol.md); два рабочих примера — в
`examples/`:

| Пример | Что показывает |
|---|---|
| [`example-folder-storage`](../../examples/example-folder-storage) | Хранилище с файлами в папке на этом Mac: все методы `storage/*`, выгрузка частями, проверка пути |
| [`example-hetzner-source`](../../examples/example-hetzner-source) | Серверы проекта Hetzner Cloud (`GET /v1/servers`): секретный токен, страницы, метки как теги, папки по расположению, бастион по имени |

## Хранилище

```json
"contributes": {
  "storage": [{
    "id": "folder", "title": "Папка на этом Mac", "signIn": "none",
    "fields": [{ "key": "root", "type": "path", "title": "Папка" }],
    "capabilities": ["folders", "rename", "delete", "freeSpace", "check"]
  }]
}
```

- Из `fields` строится карточка хранилища (те же типы полей, что у настроек модуля). Поле `secret` требует права
  `secrets`; значение хранится в документе зашифрованным и приходит программе в `storage.settings`.
- `capabilities` — что панель предлагает кроме просмотра, скачивания и выгрузки: новые папки, переименование,
  удаление, публичные ссылки, свободное место, свою «Проверить». Чего нет в списке — нет и в меню.
- `signIn: "browser"` добавляет в карточку «Войти через браузер…» (нужно право `oauth`): приложение вызывает
  `storage/signIn`, программа — `host.oauth(...)`, токен становится секретом узла и приходит как `settings.oauth`.

```ts
import { defineModule, storageMethods } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {},
  methods: storageMethods({
    list: async (path, storage) => [...],          // [{ name, type: "file" | "folder", size, modified }]
    stat: async (path, storage) => null,           // или элемент
    read: async (path, offset, length, storage) => ({ data, eof }),
    write: { begin, chunk, commit, abort },        // до commit файла нет
    mkdir, rename, delete, check,                  // как сказано в capabilities
  }),
});
```

**Через сервер.** Пользователь может привязать хранилище к серверу («Через сервер» в карточке) — тогда
`storage.throughServer` истинно. С правом `forward` вызов `ctx.host.forward({ node: storage.node, host, port })` даёт
порт на 127.0.0.1 этого Mac, проброшенный по SSH-сессии приложения (с бастионами и 2FA); он закрывается вместе с
программой и когда хранилищем больше никто не пользуется.

**Чего приложение для вида расширения не делает:** прямое копирование между сервером и хранилищем и выгрузку в
автоматизациях «на сервере» по его cron — для этого на сервере нужен протокол хранилища. Автоматизации выгружают с
этого Mac.

## Источник

```json
"contributes": {
  "source": [{
    "id": "hetzner-cloud", "title": "Hetzner Cloud", "refresh": 300,
    "fields": [{ "key": "token", "type": "secret", "title": "Токен API" }]
  }]
},
"permissions": ["network", "secrets"]
```

```ts
import { defineModule, sourceMethods } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {},
  methods: sourceMethods({
    async poll(source, ctx) {
      return { hosts: [{ id: "4711", name: "web-1", address: "203.0.113.5", user: "root", group: "Falkenstein" }] };
    },
  }),
});
```

- `id` не меняется между опросами (id в API, а не адрес): по нему за узлом следуют открытые вкладки и настройки,
  которые пользователь дал этому узлу.
- `jump` — бастион по имени подключения в документе пользователя; `group` — папка внутри источника.
- Ключам серверов из источника приложение не доверяет: при первом подключении ключ показывается для проверки.
- Фильтры пользователя (выключенные, теги, имя) и скрытые узлы применяет приложение.

## Проверка

`sshkipper-ext validate <папка>` проверяет манифест, как приложение; `sshkipper-ext run <папка> storage/list --params …`
и `run <папка> source/poll --params …` вызывают программу так же, как приложение. В SSHKipper: Настройки → Расширения →
Папка разработки… → ваша папка, затем Файл → Хранилище… → плитка вашего вида в разделе «Из расширений» или Файл →
Источник серверов → «<название>…». Тесты `tests/contributions.test.ts` говорят с обоими примерами, как приложение, —
хорошая основа для своих.
