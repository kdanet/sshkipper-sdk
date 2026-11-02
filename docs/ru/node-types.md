# Свой тип узла и экран

Расширение может добавить в документ пользователя **свой узел** — со своей иконкой, карточкой настроек и вкладкой.
Приложение хранит узел и рисует всё само; расширение описывает поля и строит экран из блоков UI-Kit. Протокол —
[spec/protocol.md §14](../../spec/protocol.md). Готовый пример — [examples/node-type-sitechecks](../../examples/node-type-sitechecks)
(«Проверки сайтов»).

## 1. Манифест

```json
{
  "sdk": 1, "id": "dev.example.sites", "version": "1.0.0", "title": "Проверки сайтов",
  "runtime": { "kind": "process", "command": ["node", "extension.ts"] },
  "permissions": ["secrets", "store"],
  "contributes": {
    "nodeType": [{
      "id": "checks", "title": "Проверки сайтов", "icon": { "symbol": "checkmark.shield", "color": "green" },
      "screen": "checks",
      "fields": [
        { "key": "urls", "title": "Адреса", "type": "list" },
        { "key": "interval", "title": "Интервал, с", "type": "number", "default": 5 },
        { "key": "token", "title": "Токен", "type": "secret" },
        { "key": "server", "title": "Сервер", "type": "node", "nodeKinds": ["connection"] }
      ]
    }],
    "screen": [{ "id": "checks", "title": "Проверки сайтов", "placement": "tab", "render": "render" }]
  },
  "handlers": { "render": { "timeout": 10 } }
}
```

- **Поля** — те же виды, что у настроек модуля (`text`, `number`, `bool`, `choice`, `list`, `path`, `secret`), и
  `node` — ссылка на другой узел документа. `nodeKinds`: `connection` (по умолчанию), `database`, `storage`, `tunnel`,
  `terminal`, `folder` или `ext:<свой тип>`. Ссылка бывает только у полей своего узла.
- **Секрет** хранится секретом документа и принадлежит узлу: копируется и удаляется вместе с ним. В настройки,
  которые получает программа, он не попадает — только ключ в `node.secrets`, значение — через `host.nodeSecret`.
- **Экран** `tab` открывается двойным щелчком по узлу; `section` — раздел вкладки служб сервера (там, где
  расширение включено в «Службах» карточки); `panel` пока не открывается.

Пользователь создаёт узел через Файл → Из расширений → «<название>…» (то же — в «+» панели инструментов и в меню
«Создать» дерева) или палитру; карточка — нативная форма
из ваших полей. Без расширения узел остаётся в документе с пазлом «нужно расширение», данные не теряются.

## 2. Экран

```ts
import { datatable, defineModule, screen, split, toolbar, type NodeContext } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {
    render: (input, ctx) => {
      const node = ctx.node as NodeContext;            // id, name, settings, links, secrets
      return screen([
        toolbar([{ id: "check", title: "Проверить сейчас", symbol: "arrow.clockwise" }]),
        split([datatable(["Адрес", "Код"], [], { id: "checks", selection: "single" }), /* … */]),
      ], { title: node.name, fill: true });
    },
  },
  async onEvent(e, ctx) {
    if (e.type === "open") { /* таймер: ctx.push([...]) — живые данные */ }
    if (e.type === "press" && (e.value as any).item === "check") { /* … */ }
    return null;
  },
});
```

`render` получает `input.node` (и `ctx.node`), события — `ctx.node` в контексте. Экран строится **заново**, когда
меняются настройки узла, расширение обновили или включили, документ снова разблокирован, программа перезапустилась.
Открытые вкладки возвращаются после перезапуска приложения.

## 3. Что программа может попросить

Программа видит только узел открытого экрана, узлы, к которым его привязали, и сервер раздела — и между вызовами
тоже (таймер). Чужой id — отказ.

```ts
const token = await ctx.host.nodeSecret("token");                 // секрет своего узла (право secrets)
await ctx.host.exec("uptime", { server: ctx.node!.links.server.id }); // привязанный сервер (право exec)
await ctx.host.open({ terminal: { server: id, command: "curl -sI http://…" } }); // сначала спросит пользователя
const button = await ctx.host.ask({
  title: "Очистить историю?", text: "Точки графика удалятся.",
  buttons: ["Очистить", "Отмена"], risk: "danger",             // первая кнопка — красная, не по Return
});
```

- `host.open` открывает узел (`{node}`), свой экран (`{screen, node?}` / `{screen, server}`) или терминал на сервере.
  Команду терминала приложение показывает пользователю, с оценкой политики команд; `false` — пользователь отказался.
  Не больше 5 открытий за 10 с.
- `host.ask` показывает диалог приложения с подписью «Спрашивает расширение «…»»; ответ — номер кнопки. Одновременно
  на экране один вопрос расширения, остальные ждут (до 8).

## 4. Проверка

```sh
node packages/cli/sshkipper-ext.ts validate examples/node-type-sitechecks
```

```sh
sshkipper-ext preview examples/node-type-sitechecks checks \
  --node '{"id":"n1","name":"Shop","type":"ext:dev.sshkipper.example.sitechecks/checks","settings":{},"links":{},"secrets":[]}' \
  --events '[{"type":"open"},{"type":"press","block":"toolbar","value":{"item":"check"}}]'
```

`preview` строит экран для заданного узла (`--node`) и проводит его через события, печатая экран после них. В
SSHKipper: Настройки → Расширения → Папка разработки… → папка, затем Файл → Из расширений → ваш тип; двойной щелчок
открывает вкладку, а «⋯» вкладки → «Инспектор экрана» показывает каждое событие и изменение.
