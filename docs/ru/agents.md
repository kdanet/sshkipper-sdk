# Для AI-агентов: MCP-сервер

В SDK есть MCP-сервер: AI-агент (Claude Code, Claude Desktop, Cursor, любой клиент MCP) пишет расширения так же, как
человек с командной строкой, — изучает SDK, начинает с работающего расширения любого вида, проверяет каждую правку,
смотрит страницы и живые экраны, запускает обработчики и методы вкладов.

## Подключение

```json
{
  "mcpServers": {
    "sshkipper-sdk": { "command": "node", "args": ["/путь/к/sshkipper-sdk/packages/cli/sshkipper-ext.ts", "mcp"] }
  }
}
```

Claude Code: `claude mcp add sshkipper-sdk -- node /путь/к/sshkipper-sdk/packages/cli/sshkipper-ext.ts mcp`.

## Инструменты

| Инструмент | |
|---|---|
| `sdk_guide {topic, lang?}` | эти руководства — overview, getting-started, manifest, ui-kit, ui-kit-reference, server, process, swift, ai-and-automation, storage-and-sources, database-drivers, node-types, importers-and-consoles, publishing, security, agents, glossary, protocol, database-protocol; `lang: "ru"` — по-русски |
| `sdk_schema {name}` | JSON Schema `module` (оба манифеста) или `view`; `symbols` — SF Symbols, которые рисует приложение |
| `ui_kit {}` | каждый блок с полями и примером (и блоки живого экрана), стили, действия, операции `ui/patch`, шаблоны, символы |
| `ext_scaffold {kind, id, title, process?, folder?}` | работающее расширение вида — service, database, storage, source, node-type, import, console, ai, automation — и какое руководство читать дальше; с `folder` записывает файлы |
| `ext_validate {folder}` или `{manifest, files?}` | проверки приложения перед установкой |
| `view_preview {view, data?, item?, settings?, components?, ops?}` | вид текстом после шаблонов (и после `ops`), с его ошибками |
| `screen_preview {folder, id?, node?, settings?, events?, wait?}` | страница или экран, построенные обработчиком, затем проведённые через `events`: операции и отправки программы применены, ответ каждого шага, операции, которые не применились |
| `template_expand {view, vars, components?}` | раскрытый JSON |
| `ext_run_local {folder, handler \| method, input?, params?, settings?, item?, node?}` | обработчик или метод вклада (`storage/list`, `source/poll`, `import/parse`, `ai/models`…) **на этой машине** |

Ресурсы: `sshkipper-sdk://guide/<тема>`, `sshkipper-sdk://guide/ru/<тема>`, `sshkipper-sdk://schema/module|view`.
Старые имена `module_scaffold`, `module_validate`, `module_run_local` по-прежнему отвечают.

## Что выполняется на этой машине

`ext_run_local` и `screen_preview` запускают расширение **здесь**, с вашими правами и без песочницы: скрипты — через
`sh`, программы — как их запускает приложение, `host.exec` — тоже здесь. Поэтому сервер **безопасен по умолчанию**:
без `--allow-changes` — флага, который даёте **вы** при запуске (`sshkipper-ext mcp --allow-changes`), а не параметра,
который может передать агент, — выполняется только то, что читает:

- обработчики, которые манифест использует для чтения: `detect`, `summary` и `tree` службы, данные и `render` страницы,
  `render` экрана, действия, инструменты и блоки с риском `read` — и только если тот же обработчик не делит с ними
  действие `change`/`danger`. Любой другой обработчик, в том числе тот, на который в манифесте ничто не ссылается, —
  отказ;
- читающие методы вкладов (`storage/list`, `stat`, `read`, `check`, список ссылок, `source/*`, `import/parse`,
  `ai/models`); запись, удаление и `ai/chat` (API модели) — отказ;
- события экрана, которые только смотрят (`open`, `close`, `select`, `expand`, `collapse`, `more`, `sort`, `change`,
  `complete`).

Это защита от того, что агент по ошибке запустит объявленное изменение, **а не песочница**. Манифест и код агент пишет
сам — обработчик, объявленный читающим, может сделать что угодно, — а `ext_scaffold` с `folder` пишет файлы в пустую
папку, которую он назовёт. Запускайте сервер там, где ошибка агента обойдётся дёшево.

Консоли интерактивны — пробуйте их в приложении. На `host/open` и `host/ask` здесь отвечают «не открыто» и кнопкой
отмены (человека нет); `host/forward` отдаёт цель как есть.

## Хороший порядок работы агента

1. `sdk_guide overview`, `ui_kit` — что такое расширение, что умеет экран.
2. `ext_scaffold` с `folder` — начать с работающего; прочитать руководство, которое он назовёт.
3. Изменить одну вещь: обработчик, вид, метод.
4. `ext_validate` — исправить все ошибки, прочитать предупреждения.
5. `ext_run_local` обработчика или метода; `view_preview` / `screen_preview` страницы или экрана.
6. Попросить пользователя подключить папку в SSHKipper (Настройки → Расширения → «Папка разработки…») и посмотреть
   вживую.

Через этот сервер агент не может установить расширение в приложение или запустить его на серверах пользователя:
установка остаётся за пользователем, а свой агент приложения ходит на серверы только через инструменты, которые
разрешают режимы AI пользователя.
