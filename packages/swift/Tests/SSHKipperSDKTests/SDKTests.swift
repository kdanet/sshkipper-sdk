import Foundation
import Testing
@testable import SSHKipperSDK

/// The SDK's own folders, from this file.
let sdkRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()

@Suite("JSON")
struct JSONTests {
    @Test func literalsAndAccess() throws {
        var j: JSON = ["a": 1, "b": [true, "x", nil], "c": 2.5]
        #expect(j["a"].int == 1)
        #expect(j["b"][1].string == "x")
        #expect(j["b"][2].isNull)
        #expect(j["c"].double == 2.5)
        j["d"] = "new"
        #expect(try JSON.parse(try j.encoded()) == j)
        // Whole numbers go as integers.
        #expect(try JSON.number(3).encoded() == "3")
    }
}

@Suite("Manifest")
struct ManifestTests {
    /// Every example of the SDK reads with these types (the JSON Schema is normative; the types must keep up).
    @Test func everyExampleReads() throws {
        let examples = sdkRoot.appendingPathComponent("examples")
        var read = 0
        for name in try FileManager.default.contentsOfDirectory(atPath: examples.path).sorted() {
            let dir = examples.appendingPathComponent(name)
            guard Manifest.files.contains(where: { FileManager.default.fileExists(atPath: dir.appendingPathComponent($0).path) }) else { continue }
            let m = try Manifest.load(folder: dir)
            #expect(m.sdk == 1, "\(name)")
            #expect(!m.contributionKinds.isEmpty || m.pages != nil, "\(name)")
            read += 1
        }
        #expect(read >= 10)
    }

    @Test func textByLanguage() {
        let t: LocalizedText = .byLanguage(["ru": "Диски", "en": "Disks"])
        #expect(t.text("ru-RU") == "Диски")
        #expect(t.text("de") == "Disks")
    }
}

/// Plays the app: sends requests to an extension over a pipe and reads what it writes.
struct App {
    let pipe = PipeTransport()
    let task: Task<Void, Never>

    init(_ ext: Extension) {
        let pipe = self.pipe
        task = Task { await ext.run(transport: pipe) }
    }

    /// Sends and waits for the answer with this id (answering host requests with `host`).
    func call(_ id: Int, _ method: String, _ params: JSON, host: @escaping @Sendable (JSON) -> JSON? = { _ in nil }) async -> JSON {
        pipe.send(["jsonrpc": "2.0", "id": .number(Double(id)), "method": .string(method), "params": params])
        var seen = 0
        var answered = Set<Int>()
        while true {
            await pipe.waitFor(count: seen + 1)
            let all = pipe.written
            for (i, m) in all.enumerated() where i >= seen {
                if m["method"].isNull, m["id"].int == id { return m }
                if let hid = m["id"].int, m["method"].string?.hasPrefix("host/") == true, !answered.contains(hid), let r = host(m) {
                    answered.insert(hid)
                    pipe.send(["jsonrpc": "2.0", "id": .number(Double(hid)), "result": r])
                }
            }
            seen = all.count
        }
    }
}

@Suite("Runtime")
struct RuntimeTests {
    @Test func initializeHandlersAndHostExec() async throws {
        let ext = Extension()
        ext.handler("summary") { _, ctx in
            let r = try await ctx.host.exec("uptime")
            return ["text": .string(r.stdout), "status": "ok", "server": .string(ctx.server?.name ?? "")]
        }
        ext.handler("fail") { _, _ in throw ExtensionError("nope") }
        let app = App(ext)
        let i = await app.call(1, "initialize", ["sdk": 1, "app": "t", "module": ["id": "x", "version": "1"], "locale": "ru"])
        #expect(i["result"]["handlers"] == ["fail", "summary"])
        let r = await app.call(2, "handler/call", ["handler": "summary", "input": [:], "context": ["server": ["id": "s1", "name": "web-1", "host": "10.0.0.5"], "settings": [:], "locale": "ru"]]) { m in
            m["method"] == "host/exec" && m["params"]["server"] == "s1" ? ["exitCode": 0, "stdout": "up 3 days", "stderr": ""] : nil
        }
        #expect(r["result"]["text"] == "up 3 days")
        #expect(r["result"]["server"] == "web-1")
        let f = await app.call(3, "handler/call", ["handler": "fail", "input": [:], "context": ["settings": [:], "locale": "en"]])
        #expect(f["error"]["message"] == "nope")
        #expect(f["error"]["code"].int == ErrorCode.handlerFailed)
        let missing = await app.call(4, "storage/list", [:])
        #expect(missing["error"]["code"].int == ErrorCode.methodNotFound)
        app.pipe.close()
        await app.task.value
    }

    @Test func eventsAnswerWithOpsAndPush() async throws {
        let ext = Extension()
        ext.handler("render") { _, _ in UI.screen([UI.toolbar([("refresh", "Refresh", "arrow.clockwise")]), UI.terminal("", id: "out")]) }
        ext.onEvent { e, ctx in
            if e.type == "open" { ctx.push([Op.append("out", text: "hello\n")]) }
            if e.type == "press" { return EventAnswer(ops: [Op.notice("pressed \(e.value?["item"].text ?? "")")]) }
            return .none
        }
        let app = App(ext)
        _ = await app.call(1, "initialize", ["locale": "en"])
        let open = await app.call(2, "ui/event", ["event": ["screen": "s", "seq": 1, "type": "open"], "context": ["settings": [:], "locale": "en"]])
        #expect(open["result"] == [])
        #expect(app.pipe.written.contains { $0["method"] == "ui/push" && $0["params"]["screen"] == "s" && $0["params"]["ops"][0]["op"] == "append" })
        let press = await app.call(3, "ui/event", ["event": ["screen": "s", "seq": 2, "type": "press", "block": "tb", "value": ["item": "refresh"]], "context": ["settings": [:], "locale": "en"]])
        #expect(press["result"][0]["text"] == "pressed refresh")
        app.pipe.close()
        await app.task.value
    }

    @Test func cancelStopsAHandlerWithoutAnAnswer() async throws {
        let ext = Extension()
        ext.handler("slow") { _, _ in try await Task.sleep(nanoseconds: 5_000_000_000); return "late" }
        ext.handler("quick") { _, _ in "done" }
        let app = App(ext)
        _ = await app.call(1, "initialize", [:])
        app.pipe.send(["jsonrpc": "2.0", "id": 2, "method": "handler/call", "params": ["handler": "slow", "context": ["settings": [:], "locale": "en"]]])
        app.pipe.send(["jsonrpc": "2.0", "method": "cancel", "params": ["id": 2]])
        let q = await app.call(3, "handler/call", ["handler": "quick", "context": ["settings": [:], "locale": "en"]])
        #expect(q["result"] == "done")
        #expect(!app.pipe.written.contains { $0["id"] == 2 })
        app.pipe.close()
        await app.task.value
    }

    @Test func storageSourceImportAI() async throws {
        struct Memory: StorageProvider {
            func list(_ path: String, _ s: StorageRef, _ ctx: MethodContext) async throws -> [StorageItem] { [.file("a.txt", size: 3), .folder("docs")] }
            func stat(_ path: String, _ s: StorageRef, _ ctx: MethodContext) async throws -> StorageItem? { nil }
            func read(_ path: String, offset: Int, length: Int, _ s: StorageRef, _ ctx: MethodContext) async throws -> (data: Data, eof: Bool) { (Data("abc".utf8), true) }
            func writeBegin(_ path: String, size: Int, modified: Int?, _ s: StorageRef, _ ctx: MethodContext) async throws -> String { "u1" }
            func writeChunk(_ upload: String, offset: Int, data: Data, _ s: StorageRef, _ ctx: MethodContext) async throws {}
            func writeCommit(_ upload: String, _ s: StorageRef, _ ctx: MethodContext) async throws {}
            func writeAbort(_ upload: String, _ s: StorageRef, _ ctx: MethodContext) async throws {}
        }
        struct Hosts: SourceProvider {
            func poll(_ s: SourceRef, _ ctx: MethodContext) async throws -> (hosts: [FoundHost], scope: String?) {
                ([FoundHost(id: "w1", name: "web-1", address: "10.0.0.5", user: s.settings["user"]?.string)], nil)
            }
        }
        struct Echo: AIProvider {
            func models(_ r: AIModelsRequest) async throws -> [AIModel] { [AIModel(id: "echo")] }
            func chat(_ r: AIChatRequest, _ ctx: AIChatContext) async throws -> AIChatResult {
                ctx.delta(.text("you said: \(r.lastQuestion)"))
                return AIChatResult(model: r.model)
            }
        }
        let ext = Extension()
        ext.storage(Memory())
        ext.source(Hosts())
        ext.ai(Echo())
        ext.importer("hosts") { file, _ in
            ImportResult(nodes: [.folder(name: file.name, children: file.text.split(separator: "\n").map { .connection(ImportConnection(name: String($0), host: String($0))) })])
        }
        let app = App(ext)
        _ = await app.call(1, "initialize", [:])
        let storage: JSON = ["node": "n", "kind": "mem", "settings": [:], "readOnly": false, "throughServer": false]
        #expect(await app.call(2, "storage/list", ["storage": storage, "path": "/"])["result"]["items"][1]["type"] == "folder")
        #expect(await app.call(3, "storage/read", ["storage": storage, "path": "/a.txt", "offset": 0, "length": 10])["result"]["data"] == .string(Data("abc".utf8).base64EncodedString()))
        #expect(await app.call(4, "storage/check", ["storage": storage])["result"]["text"] == "Works: 2 at the top")
        #expect(await app.call(5, "storage/mkdir", ["storage": storage, "path": "/x"])["error"]["code"].int == ErrorCode.methodNotFound)
        let poll = await app.call(6, "source/poll", ["source": ["node": "n", "kind": "h", "settings": ["user": "deploy"]]])
        #expect(poll["result"]["hosts"][0]["user"] == "deploy")
        #expect(await app.call(7, "source/check", ["source": ["node": "n", "kind": "h", "settings": [:]]])["result"]["text"] == "1 host(s)")
        let imp = await app.call(8, "import/parse", ["importer": "hosts", "name": "l.txt", "size": 7, "data": .string(Data("a\nb".utf8).base64EncodedString())])
        #expect(imp["result"]["nodes"][0]["type"] == "folder")
        #expect(imp["result"]["nodes"][0]["children"][1]["host"] == "b")
        #expect(await app.call(9, "ai/models", ["provider": "p", "settings": [:], "secrets": [:]])["result"][0]["id"] == "echo")
        let chat = await app.call(10, "ai/chat", ["id": "st", "provider": "p", "model": "echo", "system": "", "tools": [], "max_tokens": 10, "settings": [:], "secrets": [:],
                                                  "messages": [["role": "user", "content": [["type": "text", "text": "hi"]]]]])
        #expect(chat["result"]["stop"] == "end_turn")
        #expect(app.pipe.written.contains { $0["method"] == "ai/delta" && $0["params"]["id"] == "st" && $0["params"]["text"] == "you said: hi" })
        app.pipe.close()
        await app.task.value
    }

    @Test func consoleBytesBothWays() async throws {
        let ext = Extension()
        ext.console("serial") { s, _ in
            s.write("hello \(s.node.name ?? "")\r\n")
            s.onInput { data in
                if String(decoding: data, as: UTF8.self) == "bye\r" { s.close(reason: "done") } else { s.write(data) }
            }
        }
        let app = App(ext)
        _ = await app.call(1, "initialize", [:])
        let open = await app.call(2, "console/open", ["console": "serial", "session": "c1", "cols": 80, "rows": 24, "node": ["id": "n", "name": "web-1"]])
        #expect(open["result"] == [:])
        app.pipe.send(["jsonrpc": "2.0", "method": "console/input", "params": ["session": "c1", "data": .string(Data("ls".utf8).base64EncodedString())]])
        app.pipe.send(["jsonrpc": "2.0", "method": "console/input", "params": ["session": "c1", "data": .string(Data("bye\r".utf8).base64EncodedString())]])
        // A request after them: answered once both inputs were handled (the loop reads in order).
        _ = await app.call(3, "ai/models", [:])
        let data = app.pipe.written.filter { $0["method"] == "console/data" }.compactMap { Data(base64Encoded: $0["params"]["data"].string ?? "") }
        #expect(data.map { String(decoding: $0, as: UTF8.self) } == ["hello web-1\r\n", "ls"])
        #expect(app.pipe.written.contains { $0["method"] == "console/closed" && $0["params"]["reason"] == "done" })
        app.pipe.close()
        await app.task.value
    }
}

@Suite("Console timing")
struct ConsoleTimingTests {
    /// The user may type while the console opens: input right behind `console/open` reaches the first `onInput`.
    @Test func inputBeforeTheConsoleListensIsKept() async throws {
        let ext = Extension()
        ext.console("serial") { s, _ in
            try await Task.sleep(nanoseconds: 50_000_000)
            s.onInput { s.write($0) }
        }
        let app = App(ext)
        _ = await app.call(1, "initialize", [:])
        app.pipe.send(["jsonrpc": "2.0", "id": 2, "method": "console/open", "params": ["console": "serial", "session": "c", "cols": 80, "rows": 24, "node": ["id": "n"]]])
        app.pipe.send(["jsonrpc": "2.0", "method": "console/input", "params": ["session": "c", "data": .string(Data("early".utf8).base64EncodedString())]])
        _ = await app.call(3, "nothing/here", [:])
        while !app.pipe.written.contains(where: { $0["id"] == 2 }) { try await Task.sleep(nanoseconds: 10_000_000) }
        let echoed = app.pipe.written.filter { $0["method"] == "console/data" }.compactMap { Data(base64Encoded: $0["params"]["data"].string ?? "") }
        #expect(echoed.map { String(decoding: $0, as: UTF8.self) } == ["early"])
        app.pipe.close()
        await app.task.value
    }
}

@Suite("Database protocol")
struct DatabaseTests {
    @Test func answersByIDWithCodes() async throws {
        let driver = DatabaseDriver()
        driver.on("hello", DB.Empty.self) { _ in DB.PluginInfo(pluginVersion: "1.0", engines: [DB.EngineInfo(engine: "mine", title: "Mine")]) }
        driver.on("query", DB.Query.self) { q in
            guard q.sql == "select 1" else { throw DB.Failure("query", "only select 1") }
            return DB.QueryResult(columns: [DB.Column(name: "1")], rows: [["1"]])
        }
        let pipe = PipeTransport()
        let task = Task { await driver.run(transport: pipe) }
        pipe.send(["id": 1, "method": "hello", "params": [:]])
        pipe.send(["id": 2, "method": "query", "params": ["session": "s", "sql": "select 1", "maxRows": 10, "queryID": "q"]])
        pipe.send(["id": 3, "method": "query", "params": ["session": "s", "sql": "drop", "maxRows": 10, "queryID": "q"]])
        pipe.send(["id": 4, "method": "structure", "params": [:]])
        await pipe.waitFor(count: 4)
        pipe.close()
        await task.value
        let byID = Dictionary(uniqueKeysWithValues: pipe.written.map { ($0["id"].int ?? -1, $0) })
        #expect(byID[1]?["result"]["protocolVersion"] == 1)
        #expect(byID[1]?["result"]["engines"][0]["engine"] == "mine")
        #expect(byID[2]?["result"]["rows"][0][0] == "1")
        #expect(byID[3]?["error"]["code"] == "query")
        #expect(byID[4]?["error"]["code"] == "unsupported")
    }
}
