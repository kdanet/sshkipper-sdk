# Queues — a live screen

**Shows:** a service page that is a live screen (spec/protocol.md §11): a tree of queues expanded on demand
(`expand` → `children`), a 50 000-job `datatable` loaded page by page and sorted by the program (`more`, `sort` →
`rows`), a row menu, an editor with completion (`complete`), a terminal, a chart the program adds points to by itself
(`ui/push`), a sheet for a new job (`submit`). The data is made up — nothing happens on the server.

**Contributes:** `service` (a module, a TypeScript program). Permissions: none.

```sh
sshkipper-ext validate examples/screens
sshkipper-ext preview examples/screens --events '[{"type": "open"}, {"type": "more", "block": "jobs", "value": {"offset": 200, "limit": 100}}]' --wait 1500
```

**In SSHKipper:** «Папка разработки…» → a connection's «Службы» → «Очереди (пример экрана)» on → the section in the
server's services tab. Its «⋯» → «Инспектор экрана» shows the block tree, every event and every patch. Guide:
[UI-Kit](../../docs/en/ui-kit.md) (live screens).

**По-русски:** живой экран модуля: дерево с раскрытием по запросу, таблица на 50 000 строк страницами, редактор с
автодополнением, терминал, график по `ui/push`, лист. Руководство — [UI-Kit](../../docs/ru/ui-kit.md).
