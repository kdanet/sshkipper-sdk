# Processes — a server module

**Shows:** a service made of POSIX `sh` scripts that run on the server over the app's SSH session (nothing installed
there): the load, memory and the busiest processes; a page per process; actions that send TERM, HUP or KILL — each
asks first, `sudo -n` where the server allows it; AI tools (`top`, `stop`…) under the server's AI mode; an automation
block. Templates (`views/*.json`) over the scripts' JSON, no program on the Mac.

**Contributes:** `service`, `tools`, `automation` (a module: `sshkipper-module.json`, packed as `.sshkmod`).
Permissions: `exec`, `sudo`.

```sh
sshkipper-ext validate examples/processes
sshkipper-ext run examples/processes overview                 # here, with sh
sshkipper-ext run examples/processes overview --ssh deploy@web-1
sshkipper-ext preview examples/processes main --run
```

**In SSHKipper:** Settings → Extensions → «Папка разработки…» → this folder (or `sshkipper-ext pack` and «Установить
расширение…»). A connection's «Службы» → «Процессы»; the service's node under the server, its section in the
server's services tab. Guide: [server modules](../../docs/en/server-modules.md).

**По-русски:** служба из sh-скриптов на сервере — нагрузка, память, самые занятые процессы, страница процесса,
сигналы TERM/HUP/KILL с вопросом, инструменты AI и блок автоматизации. Поставить — «Папка разработки…» или
«Установить расширение…»; руководство — [модули на сервере](../../docs/ru/server-modules.md).
