# Программа на Swift

Программу расширения можно писать на любом языке; рядом со средой TypeScript в SDK есть пакет для Swift:
[packages/swift](../../packages/swift) — `SSHKipperSDK`, SwiftPM, macOS 13+, без зависимостей и без кода приложения
(приложение никогда не загружает код расширения: программа — отдельный процесс). В нём:

- типы манифеста и протокола (`Manifest`, `Request`, `Context`, `ScreenEvent`, `StorageRef`, `FoundHost`,
  `ImportResult`, `AIChatRequest`…), все `Codable`, и `JSON` для свободных данных;
- `Extension` — цикл JSON-RPC из spec/protocol.md §4 на stdin/stdout: обработчики, отмена (`cancel` отменяет задачу
  обработчика), `initialize` и `shutdown`;
- `AppHost` — что приложение делает для программы (`ctx.host`): `exec`, `secret`, `nodeSecret`, `storeGet` /
  `storeSet`, `notify`, `log`, `forward`, `oauth`, `open`, `ask` (имя `AppHost`, а не `Host`: в Foundation есть свой
  `Host`);
- живые экраны: `onEvent` отвечает `EventAnswer(ops:)`, `ctx.push(_:)` шлёт операции сам (`ui/push`);
- вклады: `storage(_: StorageProvider)`, `source(_: SourceProvider)`, `importer(_:_:)`, `console(_:_:)`,
  `ai(_: AIProvider)`, `method(_:_:)` для остального;
- `UI` и `Op` — конструкторы UI-Kit и операции `ui/patch`;
- `DB` и `DatabaseDriver` — протокол баз (spec/database.md) для драйвера `contributes.database`: те же формы, что у
  `Packages/DatabaseProtocol` приложения для модели `sql`; `"id"` — первым в каждой строке.

## Пример

[examples/swift-hello](../../examples/swift-hello) — служба с живым экраном: `uptime` сервера через `host.exec`,
«Обновить» на панели инструментов, график нагрузки этого Mac, который программа шлёт каждые 2 с, пока экран открыт.

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

## Сборка

Манифест называет программу внутри папки расширения — `"runtime": {"kind": "process", "command":
["bin/swift-hello"]}`, — а приложение перед каждым запуском хеширует **каждый файл** папки. В `.build` у SwiftPM
тысячи файлов, поэтому собирайте вне папки и копируйте готовый файл внутрь:

```sh
cd examples/swift-hello
./build.sh                    # swift build -c release --scratch-path $TMPDIR/… → bin/swift-hello
sshkipper-ext validate .
sshkipper-ext run . summary   # host.exec выполняется здесь
sshkipper-ext preview . main --events '[{"type": "open"}]' --wait 2500
sshkipper-ext pack .          # → dev.sshkipper.example.swift-hello-1.0.0.sshkext (с bin/swift-hello)
```

`swift build` прямо в папке тоже работает (проверить, что собирается) — удалите `.build`, прежде чем подключать папку
в приложении или упаковывать. Из корня SDK `npm run swift` собирает и тестирует пакет, собирает пример, проверяет и
упаковывает его.

Пакет с готовой программой — для своих Mac и тех, кто вам доверяет: библиотека SSHKipper принимает только исходники и
собирает их своим CI.

## Своё расширение на Swift

`sshkipper-ext new … --kind …` пишет TypeScript. Для Swift начните со `swift-hello`: скопируйте папку, поменяйте `id`,
`title` и вклады в `sshkipper-extension.json`, укажите в `Package.swift` пакет SDK (путь или адрес Git, когда SDK
опубликуют), напишите обработчики и методы в `main.swift`, `./build.sh`.
