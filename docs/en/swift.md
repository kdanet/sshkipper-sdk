# A program in Swift

A program of an extension may be written in any language; the SDK ships a Swift package for it next to the TypeScript
runtime: [packages/swift](../../packages/swift) — `SSHKipperSDK`, SwiftPM, macOS 13+, no dependencies and nothing of
the app (the app never loads extension code: the program is its own process). It has:

- the manifest and protocol types (`Manifest`, `Request`, `Context`, `ScreenEvent`, `StorageRef`, `FoundHost`,
  `ImportResult`, `AIChatRequest`…), all `Codable`, and `JSON` for anything loose;
- `Extension` — the JSON-RPC loop of spec/protocol.md §4 on stdin/stdout: handlers, cancellation (`cancel` cancels the
  handler's task), `initialize` and `shutdown`;
- `AppHost` — what the app does for a program (`ctx.host`): `exec`, `secret`, `nodeSecret`, `storeGet` / `storeSet`,
  `notify`, `log`, `forward`, `oauth`, `open`, `ask` (named `AppHost`, not `Host`: Foundation has a `Host`);
- live screens: `onEvent` answers `EventAnswer(ops:)`, `ctx.push(_:)` sends ops by itself (`ui/push`);
- contributions: `storage(_: StorageProvider)`, `source(_: SourceProvider)`, `importer(_:_:)`, `console(_:_:)`,
  `ai(_: AIProvider)`, `method(_:_:)` for anything else;
- `UI` and `Op` — the UI-Kit builders and the ops of `ui/patch`;
- `DB` and `DatabaseDriver` — the database protocol (spec/database.md) for a `contributes.database` driver: the same
  shapes as the app's `Packages/DatabaseProtocol` for the `sql` model; `"id"` first on every line.

## The example

[examples/swift-hello](../../examples/swift-hello) — a service with a live screen: the server's `uptime` through
`host.exec`, «Refresh» on the toolbar, a chart of this Mac's load the program pushes every 2 s while the screen is open.

```swift
import SSHKipperSDK

let ext = Extension()
ext.handler("summary") { _, ctx in
    let r = try await ctx.host.exec("uptime", timeout: 10)
    return ["text": .string(r.stdout), "status": "ok"]
}
ext.handler("render") { _, ctx in
    UI.screen([UI.toolbar([("refresh", ctx.tr(["en": "Refresh", "ru": "Обновить"]), "arrow.clockwise")]),
               UI.liveChart("line", series: ["load"], id: "load", window: 60)])
}
ext.onEvent { event, ctx in
    if event.type == "open" { ctx.push([Op.append("load", points: [[0.4]])]) }
    return .none
}
await ext.run()
```

## Building

The manifest names the binary inside the extension folder — `"runtime": {"kind": "process", "command":
["bin/swift-hello"]}` — and the app hashes **every file** of the folder before each start. SwiftPM's `.build` holds
thousands of files, so build outside the folder and copy the binary in:

```sh
cd examples/swift-hello
./build.sh                    # swift build -c release --scratch-path $TMPDIR/… → bin/swift-hello
sshkipper-ext validate .
sshkipper-ext run . summary   # host.exec runs here
sshkipper-ext preview . main --events '[{"type": "open"}]' --wait 2500
sshkipper-ext pack .          # → dev.sshkipper.example.swift-hello-1.0.0.sshkext (with bin/swift-hello)
```

`swift build` in the folder works too (to check it compiles) — delete `.build` before linking the folder in the app
or packing it. From the SDK's root, `npm run swift` builds and tests the package, builds the example, validates and
packs it.

A package with a binary is for your own Macs and people who trust you: SSHKipper's library accepts sources only and
builds them in its CI.

## Your own extension in Swift

`sshkipper-ext new … --kind …` writes TypeScript. For Swift, start from `swift-hello`: copy the folder, change `id`,
`title` and the contributions in `sshkipper-extension.json`, point `Package.swift` at the SDK package (a path, or a
Git URL once the SDK is published), write the handlers and methods in `main.swift`, `./build.sh`.
