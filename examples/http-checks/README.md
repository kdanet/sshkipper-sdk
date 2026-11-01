# HTTP checks — a module in TypeScript

**Shows:** a program on this Mac (Node 24, the vendored SDK runtime in `lib/sshkipper-sdk/`) answering a service's
handlers over JSON-RPC: URLs checked from the server itself (`curl` through `host.exec`) or from this Mac, the history
of response times in `host.store`, a notification when one goes down (`host.notify`), an AI tool, and automation
blocks of a program (one through the server, one from this Mac).

**Contributes:** `service`, `tools`, `automation` (a module). Permissions: `exec`, `store`, `notify`, `network`.

```sh
sshkipper-ext validate examples/http-checks
sshkipper-ext run examples/http-checks render --settings '{"urls": ["http://127.0.0.1:9/"]}'   # host.exec runs here
sshkipper-ext preview examples/http-checks main --ssh deploy@web-1
```

**In SSHKipper:** «Папка разработки…» or a packed `.sshkmod` → a connection's «Службы» → «Проверки сайтов», its URLs in
the module's settings. Guide: [process modules](../../docs/en/process-modules.md).

**По-русски:** модуль-программа на TypeScript: проверки адресов с сервера (curl через `host.exec`) или с этого Mac,
история в `host.store`, уведомления, инструмент AI, блоки автоматизаций. Руководство —
[модули-программы](../../docs/ru/process-modules.md).
