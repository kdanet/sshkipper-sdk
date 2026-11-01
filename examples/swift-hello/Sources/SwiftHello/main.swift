// «Hello from Swift» — a service of servers with a live screen, written with the SSHKipperSDK Swift package
// (spec/protocol.md §4, §11). The app starts bin/swift-hello on this Mac and calls its handlers over JSON-RPC;
// `ctx.host.exec` runs a command on the server over the app's own SSH session. The screen's toolbar sends `press`
// events; while the screen is open the program pushes this Mac's load to a live chart by itself (`ui/push`).

import Foundation
import SSHKipperSDK

/// `uptime` of the server: its text and the three load averages.
func uptime(_ host: AppHost) async throws -> (text: String, load: [Double]) {
    let r = try await host.exec("uptime", timeout: 10)
    guard r.exitCode == 0 else { throw ExtensionError(r.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "uptime failed" : r.stderr) }
    let text = r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    // "… load average: 0.10, 0.20, 0.30" (Linux) or "… load averages: 1.2 1.4 1.5" (macOS).
    let tail = text.components(separatedBy: "load average").last ?? ""
    let load = tail.split(whereSeparator: { " ,:s".contains($0) }).compactMap { Double($0) }
    return (text, Array(load.prefix(3)))
}

/// The load of this Mac: what the program can read by itself, between calls too.
func macLoad() -> Double {
    var l = [Double](repeating: 0, count: 3)
    return getloadavg(&l, 3) > 0 ? l[0] : 0
}

func facts(_ u: (text: String, load: [Double]), _ ctx: HandlerContext) -> JSON {
    UI.keyvalue([
        (ctx.tr(["en": "Server", "ru": "Сервер"]), ctx.server?.name ?? "—"),
        (ctx.tr(["en": "Load, 1 / 5 / 15 min", "ru": "Нагрузка, 1 / 5 / 15 мин"]), u.load.map { String(format: "%.2f", $0) }.joined(separator: " / ")),
        ("uptime", u.text),
    ], title: ctx.tr(["en": "Now", "ru": "Сейчас"]), id: "facts")
}

/// Live charts being fed, by screen: a timer per open screen, stopped on `close`.
actor Feeds {
    private var tasks: [String: Task<Void, Never>] = [:]
    func start(_ screen: String, _ ctx: EventContext) {
        tasks[screen]?.cancel()
        tasks[screen] = Task {
            while !Task.isCancelled {
                ctx.push([Op.append("load", points: [[macLoad()]])])
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
    func stop(_ screen: String) {
        tasks.removeValue(forKey: screen)?.cancel()
    }
}

let feeds = Feeds()
let ext = Extension()

ext.handler("detect") { _, ctx in
    ["found": .bool((try await ctx.host.exec("command -v uptime", timeout: 5)).exitCode == 0)]
}

ext.handler("summary") { _, ctx in
    let u = try await uptime(ctx.host)
    let one = u.load.first ?? 0
    return ["text": .string(String(format: "load %.2f", one)), "status": one > 4 ? "warn" : "ok"]
}

ext.handler("render") { _, ctx in
    let u = try await uptime(ctx.host)
    return UI.screen([
        UI.toolbar([("refresh", ctx.tr(["en": "Refresh", "ru": "Обновить"]), "arrow.clockwise")]),
        facts(u, ctx),
        UI.liveChart("line", series: [ctx.tr(["en": "this Mac", "ru": "этот Mac"])], id: "load",
                     title: ctx.tr(["en": "Load of this Mac (pushed by the program)", "ru": "Нагрузка этого Mac (программа шлёт сама)"]), window: 60),
    ], title: ctx.tr(["en": "Hello from Swift", "ru": "Привет из Swift"]))
}

ext.onEvent { event, ctx in
    switch event.type {
    case "open":
        await feeds.start(event.screen, ctx)
        return .none
    case "close":
        await feeds.stop(event.screen)
        return .none
    case "press" where event.value?["item"].string == "refresh":
        // A press counts as a call on the page's server: host.exec may name it now.
        let u = try await uptime(ctx.host)
        return EventAnswer(ops: [Op.replace("facts", facts(u, ctx.handler)), Op.notice(ctx.handler.tr(["en": "Refreshed", "ru": "Обновлено"]), status: "ok")])
    default:
        return .none
    }
}

await ext.run()
