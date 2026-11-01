# Модули-программы

`"runtime": {"kind": "process", "command": ["node", "module.ts"]}` — программа модуля на этом Mac. Приложение
запускает её при первом обращении, говорит с ней по JSON-RPC 2.0 через её stdin/stdout (одно сообщение в строке),
держит её, пока модулем пользуются, и останавливает, когда модуль выключили или обновили, заблокировался документ, для
которого она работала (все программы — когда не открыт ни один документ), или приложение завершается. Язык — любой
([spec/protocol.md §4](../../spec/protocol.md)); в SDK есть среда на TypeScript для Node 24, которая выполняет файлы
`.ts` как есть.

## Модуль на TypeScript

```sh
sshkipper-ext new queues --process --id dev.acme.queues
```

```ts
import { defineModule, view, rows, row, ModuleError, quote, tr } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {
    detect: async (_input, ctx) => ({ found: (await ctx.host.exec("command -v redis-cli")).exitCode === 0 }),

    async render(_input, ctx) {
      const r = await ctx.host.exec("redis-cli --raw keys 'queues:*'");
      if (r.exitCode !== 0) throw new ModuleError(r.stderr.trim() || "redis-cli failed");
      const names = r.stdout.split("\n").filter(Boolean).map((k) => k.slice(7));
      return view([rows(names.map((n) => row(n, { id: n, actions: ["clear"] })), { title: tr(ctx, { en: "Queues", ru: "Очереди" }) })]);
    },

    async clear(_input, ctx) {
      const name = String((ctx.item as { id?: string })?.id ?? "");
      await ctx.host.exec(`redis-cli del ${quote("queues:" + name)}`);
      return { message: `${name} cleared`, status: "ok" };
    },
  },
});
```

`lib/sshkipper-sdk/` — среда SDK, скопированная в модуль (`sshkipper-ext vendor` обновляет её): модуль самодостаточен,
на Mac пользователя ему не нужен `npm install`. Объявите каждый обработчик в `handlers` манифеста (`{}` или
`{"timeout": 20}`).

## Контекст обработчика

| | |
|---|---|
| `input` | параметры действия, инструмента или блока, уже проверенные по `params` |
| `ctx.server` | `{id, name, host, user}` подключения, если оно есть |
| `ctx.settings` | настройки модуля в этом подключении (без секретов) |
| `ctx.item` | строка действия `on: item` или страницы строки |
| `ctx.container` | контейнер, в котором работает служба |
| `ctx.locale` | `ru`, `en`, `zh-Hans`… — `tr(ctx, {en, ru})` выбирает текст |
| `ctx.signal` | срабатывает, когда приложение больше не ждёт (страницу закрыли): передайте его в `fetch` |
| `ctx.host` | запросы к приложению, ниже |

Верните любой JSON (вид — у обработчиков `render`, `{"message", "status"}` — у действий); бросьте
`ModuleError(message)`, чтобы завершиться со сбоем и словами, которые увидит пользователь.

## Запросы к приложению

Каждому нужно своё право в манифесте; без него вызов завершается ошибкой `-32001`.

| Вызов | Право | |
|---|---|---|
| `ctx.host.exec(command, {stdin?, timeout?, sudo?, container?, server?})` | `exec` (`sudo`) | выполняет команду на сервере вызова по SSH-сессии приложения; `{exitCode, stdout, stderr}`. Указать можно только серверы вызова. Значения берите в кавычки через `quote()`. |
| `ctx.host.secret(key)` | `secrets` | секретная настройка сервера вызова |
| `ctx.host.store.get(key)` / `.set(key, value)` | `store` | JSON-хранилище модуля на этом Mac (всего ≤ 1 МБ); `null` удаляет |
| `ctx.host.notify(title, text)` | `notify` | уведомление |
| `ctx.host.log(level, message)` | — | журнал модуля в приложении |

Программа запускается с чистым окружением: `PATH` (папка, где нашлась её программа, системные пути, Homebrew), `HOME`,
`TMPDIR`, `LANG`, `SK_SDK`, `SK_MODULE`, `SK_DATA` (личная папка для файлов модуля), `PYTHONPYCACHEPREFIX` (байт-код
Python — в `SK_DATA`) и `runtime.env`. SSH-агента пользователя и секретов приложения она не получает: до серверов —
через `host.exec`. Папка модуля для неё только для чтения: файлы установленного модуля разрешены по их хешам, и всё,
что записано туда (кеш, журнал, `__pycache__` — поэтому не запускайте Python с `-I` или `-E`, они не смотрят на
`PYTHONPYCACHEPREFIX`; если очень нужно, добавьте `-B`), делает модуль изменённым, пока пользователь не разрешит его
снова.

## Попробовать

```sh
sshkipper-ext run render --settings '{"…": "…"}'           # host.exec выполняется здесь
sshkipper-ext run render --ssh deploy@web-1                # host.exec выполняется там, через ваш ssh
sshkipper-ext preview main --ssh deploy@web-1              # нарисованная страница текстом
```

Подставное приложение хранит `host.store` в `.sshkipper-dev-store.json` и печатает уведомления и журнал.

## Другой язык

Читайте строки из stdin, пишите строки в stdout:

1. на `initialize` ответьте `{"handlers": [...]}`;
2. на каждый `handler/call` (параметры — запрос) ответьте результатом обработчика или ошибкой JSON-RPC;
3. отправляйте запросы `host/exec`, `host/store/get`… со своими id и ждите ответов на них;
4. завершайтесь на `shutdown` или когда закрылся stdin. Журнал пишите в stderr.

Пример: [examples/http-checks](../../examples/http-checks) — проверки адресов с сервера (curl через `host.exec`) или с
этого Mac (`fetch`), история в `host.store`, уведомление, когда адрес перестал отвечать, нарисованная страница с
графиком и страница на каждый адрес, инструмент AI.
