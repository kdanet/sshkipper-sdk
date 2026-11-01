# Pretend console — a console

**Shows:** a text console in the app's own terminal tab (spec/protocol.md §16): the program pretends to be a device's
serial console — a boot log, echo, line editing, colours, the window's size, `flood N` to see the app's rate limit,
Ctrl-D to leave. No shell, no port, no network: a real console would relay the bytes to a provider's gateway
(`device.ts` is the device, `module.ts` the contribution).

**Contributes:** `console` (`echo`, on connections). Permissions: none.

```sh
sshkipper-ext validate examples/console-echo
```

A console is interactive: try it in the app. **In SSHKipper:** «Папка разработки…» → a connection's menu → «Консоль:
Учебная консоль». Guide: [importers and consoles](../../docs/en/importers-and-consoles.md).

**По-русски:** консоль во вкладке терминала приложения: программа изображает серийную консоль устройства (эхо,
редактирование строки, цвета, размер окна). Руководство — [импорт и консоли](../../docs/ru/importers-and-consoles.md).
