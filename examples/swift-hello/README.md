# Hello from Swift — an extension in Swift

**Shows:** a program written with the SDK's Swift package ([packages/swift](../../packages/swift)): a service whose
page is a live screen — the server's `uptime` through `host.exec`, «Refresh» on the toolbar (`press` → `replace` and a
notice), a chart of this Mac's load the program pushes every 2 s while the screen is open (`ui/push`, stopped on
`close`).

**Contributes:** `service`. Permissions: `exec`.

**Try it** (from the SDK's root, `sshkipper-ext` on PATH):

```sh
examples/swift-hello/build.sh  # → bin/swift-hello (SwiftPM builds in $TMPDIR: the app hashes every file here)
sshkipper-ext validate examples/swift-hello
sshkipper-ext run examples/swift-hello summary
sshkipper-ext preview examples/swift-hello main --events '[{"type": "open"}, {"type": "press", "value": {"item": "refresh"}}]' --wait 2500
```

**In SSHKipper:** Settings → Extensions → Development folder… (after `./build.sh`; no `.build` in the folder) → a connection's Services →
«Привет из Swift». Guide: [Swift](../../docs/en/swift.md).

**По-русски:** расширение на Swift с пакетом SSHKipperSDK: служба с живым экраном, `host.exec`, панель инструментов,
график, который программа шлёт сама. Собрать — `./build.sh`; руководство — [Swift](../../docs/ru/swift.md).
