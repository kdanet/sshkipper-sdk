# UI-Kit

Страница модуля — это **JSON**, вид, который приложение рисует своими контролами: те же карточки, строки, кольца,
окна логов и капсулы поиска, что и на его страницах nginx, cron и Docker. Никакого HTML; на странице ничего не
выполняется. Полный список блоков с полями и примерами — [справочник UI-Kit](ui-kit-reference.md) (то же самое
агентам даёт MCP-инструмент `ui_kit`).

## Вид

```json
{
  "title": "Queues",
  "status": [{ "text": "3 of 4 workers run." }, { "text": " video is stuck", "tone": "bad" }],
  "state": { "q": "" },
  "blocks": [
    { "type": "grid", "columns": 3, "children": [
      { "type": "metric", "title": "Jobs waiting", "value": 12, "status": "ok", "series": [{ "values": [4, 9, 12] }] },
      { "type": "metric", "title": "Failed today", "value": 3, "status": "warn" },
      { "type": "gauge", "title": "Workers", "value": 3, "max": 4 }
    ] },
    { "type": "search", "bind": "q", "subtitle": "Queue" },
    { "type": "rows", "title": "Queues", "bind": "q", "items": [
      { "id": "mail", "title": "mail", "detail": "redis · 2 workers", "status": "ok", "trailing": "0 waiting",
        "badge": "high", "actions": ["retry", "pause"], "action": { "page": "queue" } }
    ] }
  ]
}
```

- `title` — заголовок страницы (по умолчанию — название страницы модуля); `status` — фраза под ним, из частей с
  тонами, которые склеиваются как написаны (пробелы ставьте в частях сами: `"3 of 4 workers run."` +
  `" video is stuck"`). В заголовке есть ещё кнопка обновления и меню «⋯» с действиями `on: service`.
- `state` — переменные страницы: их меняют `search`, `field`, `toggle`, `picker`, `slider`; `rows` с тем же `bind`
  фильтруются поиском; `visible: "failedOnly == false"` прячет блок; формулы `{{ rate * 2 }}` их читают.
- `blocks` — сверху вниз. Ширина подстраивается: сетки переносятся, у строк длинные подробности сокращаются в середине.

## Блоки по назначению

| Назначение | Блоки |
|---|---|
| Раскладка | `stack` (вертикальный или горизонтальный), `grid`, `tabs`, `card`, `divider` |
| Числа | `metric` (число, строка изменения, спарклайн), `gauge`, `chart` (линия, столбцы, область, круг) |
| Списки | `rows` (список страницы службы: точка, заголовок, подробности, значение справа, метка, меню «⋯», щелчок), `list`, `table`, `keyvalue`, `timeline`, `checklist`, `chips` |
| Текст | `text` (Markdown), `code`, `diff`, `callout`, `logs` (тёмное окно; ошибки красные, предупреждения жёлтые) |
| Состояния | `message` (пусто или ошибка: символ, заголовок, совет, кнопка) |
| Ввод | `search`, `field`, `toggle`, `picker`, `slider`, `button` |

## Действия кнопок и строк

```jsonc
{ "run": "retry", "params": { "queue": "mail" } }   // действие модуля (сначала спросит, если так велит его риск)
{ "page": "queue" }                                  // страница модуля; item строки уходит как item
{ "refresh": true }                                  // обновить эту страницу
{ "set": { "q": "", "failedOnly": "= !failedOnly" } }// изменить state («= …» — формула)
{ "open": "node:<id>" }                              // ссылка приложения
{ "ask": "Why is the video queue stuck?" }           // вопрос в AI-панель
```

`actions: ["retry", "pause"]` у строки собирает её меню «⋯» (и контекстное меню) из этих действий `on: item`;
`data` строки (или сама строка) — то, что они получают как `item`.

## Статусы и тоны

- `status` блоков и строк: `ok`, `warn`, `bad`, `off`, `info` — точка и цвет метрики.
- `tone` частей статуса, меток (`badgeTone`) и стилей: `plain`, `secondary`, `tertiary`, `good`, `warning`,
  `attention`, `bad`, `accent`, `info`. Статус `warn` рисуется тоном `warning` (жёлтым). `attention` — насыщенный
  оранжевый: в светлой теме он близок к `bad`, поэтому берите его для акцента рядом с жёлтым, а не для «что-то не так».
- Метка — это подпись (версия, пользователь), серая, пока вы не зададите ей тон.

## Свой облик: `style`

Каждый блок принимает `style` поверх того, что рисует его вид:

```json
{ "type": "text", "text": "**Maintenance** until 14:00",
  "style": { "tone": "attention", "background": "orange", "padding": 10, "radius": 8, "font": "callout", "weight": "semibold" } }
```

| | |
|---|---|
| `tone`, `color` | цвет текста: тон, имя из палитры или `#RRGGBB` |
| `background` | `card`, `well`, `none` или цвет (рисуется бледно) |
| `font`, `weight` | `title headline body callout caption mono`; `regular medium semibold bold` |
| `padding`, `radius`, `width`, `align`, `grow` | отступы и размер |

Свои части собирайте из блоков через `components` (ниже). Приложение держит облик единым и контраст правильным в
обеих темах; `style` даёт модулю свои акценты, не выходя за эти рамки.

## Шаблоны

Страница с `view` + `data` — шаблон, который приложение раскрывает до рисования:

```json
{ "type": "rows", "title": "Workers", "items": [
  { "each": "data.workers", "as": "w", "where": "w.queue == item.name", "limit": 100, "block": {
    "id": "{{ w.pid }}", "title": "{{ w.name }}", "detail": "up {{ w.uptime | duration }}",
    "status": "{{ w.status }}", "trailing": "{{ w.memory | bytes }}"
  } }
] }
```

- `"{{ путь }}"` целиком сохраняет тип значения (число, список, объект); внутри текста — печатается. Корни: `data`,
  `item`, `settings`, `server`, `props`, `index`, `context` (`context.locale` — для перевода:
  `{"if": "context.locale == 'ru'", "block": …, "else": …}`).
- Фильтры: `default:"—"`, `upper`, `lower`, `json`, `count`, `number` (десятичный знак языка приложения: «2,55»
  по-русски; `number:1` — не больше одной цифры после запятой), `bytes` (1.2 MB), `duration` (секунды → 3 ч 5 мин),
  `ago` (время Unix → 5 мин назад).
- Узлы `each` (`as`, `where`, `limit`), `if` (`block`, `else`), `use` (`props`) ставятся везде, где может стоять блок,
  строка или часть статуса.
- Всё остальное в `{{ }}` остаётся живым формулам страницы над `state` — поэтому статусы и слова решайте в
  обработчике (`"status": "bad"`), а не в шаблоне.
- Пределы: 400 блоков после раскрытия, 32 уровня JSON (рисуются 8 уровней блоков), 2 МБ.

Проверка без приложения: `sshkipper-ext preview <страница> --data data.json` или `--run`.

## Компоненты

```json
"components": {
  "worker_row": { "id": "{{ props.w.pid }}", "title": "{{ props.w.name }}", "status": "{{ props.w.status }}" }
}
```

`{ "use": "worker_row", "props": { "w": "{{ w }}" } }` — внутри `each`.

## Виды на TypeScript

Модули-программы возвращают виды из обработчиков; в `ui.ts` есть построитель для каждого блока:

```ts
import { view, grid, metric, rows, row, search, part } from "./lib/sshkipper-sdk/index.ts";

return view([
  grid([metric("Waiting", 12, { status: "ok" }), metric("Failed", 3, { status: "warn" })], 2),
  search("q", "Queue"),
  rows(queues.map((q) => row(q.name, { id: q.name, status: q.ok ? "ok" : "bad", trailing: `${q.waiting} waiting`, actions: ["retry"] })), { bind: "q" }),
], { status: [part("3 of 4 workers run."), part(" video is stuck", "bad")], state: { q: "" } });
```

## Символы

Поля `symbol` принимают имена SF Symbols из [schemas/symbols.json](../../schemas/symbols.json) — набор, который
приложение везде рисует надёжно; другое имя показывается пазлом (проверка предупредит).

## Живые экраны

Страница с `events` — живой экран ([протокол §11](../../spec/protocol.md)): приложение отправляет вашей программе то,
что делает пользователь, и применяет операции из её ответа — меняются только блоки, которые они называют. Программа
может и сама присылать операции (живые данные).

```ts
import { datatable, defineModule, ops, screen, tree } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {
    render: () => screen([
      tree([{ id: "q", title: "default", expandable: true }], { id: "queues" }),
      datatable(["id", "name"], [], { id: "jobs", total: 50_000 }),
    ]),
  },
  onEvent: (e, ctx) => {
    if (e.type === "more") return [ops.rows("jobs", e.value.offset, loadPage(e.value.offset, e.value.limit))];
    if (e.type === "expand") return [ops.children("queues", e.value.node, childrenOf(e.value.node))];
    if (e.type === "open") setInterval(() => ctx.push([ops.append("rate", { points: [[sample()]] })]), 1000);
    return null;
  },
});
```

Свои блоки экрана: `datatable` (любое число строк, по странице за раз; загруженное приложение сортирует само, а
остальное просит отсортировать вас), `tree` (дочерние строки запрашиваются при раскрытии), `split`, `editor`
(дополнение — от вас), `terminal` (цвета ANSI), `toolbar`, `sheet` (форма; «OK» отправляет её значения), `chart` с `id`
(добавление точек). Контекстные меню (`menu`), перетаскивание (`draggable`, `drop: ["files"]`) и редактируемые ячейки
(колонки `editable`) тоже присылают события. Ответ на событие, которое уже обогнало более новое (второе выделение,
продолжение ввода), приложение отбрасывает — поэтому отвечайте быстро и не думайте о порядке. См.
[examples/screens](../../examples/screens); «Инспектор экрана…» приложения (меню «⋯» страницы) показывает дерево
блоков, каждое событие и каждый ответ с операциями (`ui/patch`).
