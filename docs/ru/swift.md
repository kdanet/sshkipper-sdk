# Программа на Swift

Программу расширения можно писать на любом языке; рядом со средой TypeScript в SDK есть пакет для Swift:
[packages/swift](../../packages/swift) — `SSHKipperSDK`, SwiftPM, macOS 13+, без зависимостей и без кода приложения
(приложение никогда не загружает код расширения: программа — отдельный процесс). В нём:

- типы манифеста и протокола (`Manifest`, `Request`, `Context`, `ScreenEvent`, `StorageRef`, `FoundHost`,
  `ImportResult`, `AIChatRequest`…), все `Codable`, и `JSON` для свободных данных;
- `Extension` — цикл JSON-RPC из spec/protocol.md §4 на stdin/stdout: обработчики, отмена (`cancel` отменяет задачу
  обработчика), `initialize` и `shutdown`; `setup { app, locale in … }` выполняется до ответа на `initialize` —
  приложение ждёт этот ответ 15 с, поэтому держите его коротким, а долгое делайте при первом вызове;
- `AppHost` — что приложение делает для программы (`ctx.host`): `exec`, `secret`, `nodeSecret`, `storeGet` /
  `storeSet`, `notify`, `log`, `forward`, `oauth`, `open`, `ask` (имя `AppHost`, а не `Host`: в Foundation есть свой
  `Host`);
- живые экраны: `onEvent` отвечает `EventAnswer(ops:)`, `ctx.push(_:)` шлёт операции сам (`ui/push`);
- вклады: `storage(_: StorageProvider)`, `source(_: SourceProvider)`, `importer(_:_:)`, `console(_:_:)`,
  `ai(_: AIProvider)`, `method(_:_:)` для остального;
- `UI` и `Op` — конструкторы UI-Kit и операции `ui/patch`;
- `DB` и `DatabaseDriver` — протокол баз (spec/database.md) для драйвера `contributes.database`: формы spec/database.md для
  модели `sql` и движков `keyValue` и `document` (§4.1–4.2: `DB.RedisScan`, `DB.MongoFind`… — `on("redis.scan", DB.RedisScan.self) { … }`); `"id"` — первым в
  каждой строке.

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

### Скомпилированная программа в пакете

- **Архитектура.** `swift build` собирает программу для того Mac, на котором запущен (`file bin/swift-hello` —
  `arm64`). Для Mac на Intel тоже — универсальную: `swift build -c release --arch arm64 --arch x86_64`.
- **Подпись.** Неподписанную программу с чужого Mac Gatekeeper не запускает, как только на ней флаг карантина.
  Приложение устанавливает пакет без этого флага (установка — решение пользователя), но то, чем делитесь, подписывайте
  — `codesign --sign "Developer ID Application: …" --options runtime bin/<программа>` — и по возможности
  нотаризуйте: тогда она запустится, куда бы её ни скопировали.
- **Если не запускается**, приложение называет причину вместо тайм-аута: флаг карантина (с командой
  `xattr -d com.apple.quarantine …`), сигнал системы или программу, которая запустилась, но не ответила на
  `initialize`.

## Своё расширение на Swift

`sshkipper-ext new … --kind …` пишет TypeScript. Для Swift начните со `swift-hello`: скопируйте папку (из клона или
из установленного пакета — `$(npm root -g)/sshkipper-sdk/examples/swift-hello`), поменяйте `id`, `title` и вклады в
`sshkipper-extension.json`, напишите обработчики и методы в `main.swift`. Пример находит SDK по пути внутри
репозитория SDK, поэтому в копии укажите в `Package.swift` сам SDK — адресом Git или путём к клону либо к
установленному пакету (в нём есть и исходники Swift):

```swift
dependencies: [.package(url: "https://github.com/kdanet/sshkipper-sdk.git", branch: "main")],
// или: [.package(path: "/usr/local/lib/node_modules/sshkipper-sdk")]  — где он, скажет `npm root -g`
targets: [
    .executableTarget(name: "swift-hello", dependencies: [.product(name: "SSHKipperSDK", package: "sshkipper-sdk")],
                      path: "Sources/SwiftHello"),
],
```

Затем `./build.sh`.
