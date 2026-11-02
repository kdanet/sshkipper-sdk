import Foundation

// The runtime of a program on this Mac (spec/protocol.md §4): JSON-RPC 2.0, one message per line on stdin (app →
// program) and stdout (program → app); stderr is the extension's log. An extension is a set of handlers and
// contribution methods registered on `Extension`, then `await ext.run()`.

// MARK: Transport

/// Lines in and out: stdio for a real program, `PipeTransport` in tests.
public protocol Transport: Sendable {
    /// The app's messages, one per line, until stdin closes.
    func lines() -> AsyncStream<String>
    func write(_ line: String)
}

/// stdin / stdout of the process. `print` would mix with the protocol: log with `FileHandle.standardError` or `host.log`.
public struct StdioTransport: Transport {
    private static let out = NSLock()
    public init() {}

    public func lines() -> AsyncStream<String> {
        AsyncStream { continuation in
            let task = Task.detached {
                do {
                    for try await line in FileHandle.standardInput.bytes.lines where !line.isEmpty { continuation.yield(line) }
                } catch {}
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func write(_ line: String) {
        Self.out.lock()
        defer { Self.out.unlock() }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

/// An in-memory transport: `send` plays the app, `written` is what the program wrote. For tests.
public final class PipeTransport: Transport, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<String>.Continuation?
    private var stream: AsyncStream<String>?
    private var out: [String] = []
    private var waiters: [(count: Int, cont: CheckedContinuation<Void, Never>)] = []

    public init() {
        var c: AsyncStream<String>.Continuation?
        stream = AsyncStream { c = $0 }
        continuation = c
    }

    public func lines() -> AsyncStream<String> { lock.withLock { stream! } }

    public func write(_ line: String) {
        let ready: [CheckedContinuation<Void, Never>] = lock.withLock {
            out.append(line)
            let n = out.count
            let done = waiters.filter { $0.count <= n }.map(\.cont)
            waiters.removeAll { $0.count <= n }
            return done
        }
        for c in ready { c.resume() }
    }

    /// A message to the program, as the app sends it.
    public func send(_ message: JSON) { continuation?.yield((try? message.encoded()) ?? "") }
    /// Closes the program's stdin.
    public func close() { continuation?.finish() }
    /// Every line the program wrote, parsed.
    public var written: [JSON] { lock.withLock { out }.compactMap { try? JSON.parse($0) } }

    /// Waits until the program has written at least `count` lines.
    public func waitFor(count: Int) async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            let now = lock.withLock { () -> Bool in
                if out.count >= count { return true }
                waiters.append((count, c))
                return false
            }
            if now { c.resume() }
        }
    }
}

// MARK: The connection

final class Connection: @unchecked Sendable {
    let transport: Transport
    private let lock = NSLock()
    private var nextID = 1
    private var pending: [Int: CheckedContinuation<JSON, Error>] = [:]

    init(transport: Transport) { self.transport = transport }

    func send(_ message: JSON) {
        var m = message
        m["jsonrpc"] = "2.0"
        transport.write((try? m.encoded()) ?? #"{"jsonrpc":"2.0","error":{"code":-32603,"message":"not encodable"}}"#)
    }

    func notify(_ method: String, _ params: JSON) { send(["method": .string(method), "params": params]) }

    /// A request to the app; its answer (or its error as `ExtensionError`).
    func request(_ method: String, _ params: JSON) async throws -> JSON {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<JSON, Error>) in
            let id = lock.withLock { () -> Int in
                let id = nextID
                nextID += 1
                pending[id] = c
                return id
            }
            send(["id": .number(Double(id)), "method": .string(method), "params": params])
        }
    }

    /// An answer of the app to one of our requests.
    func answer(_ message: JSON) {
        guard let id = message["id"].int, let c = lock.withLock({ pending.removeValue(forKey: id) }) else { return }
        if message["error"].isNull { c.resume(returning: message["result"]) }
        else { c.resume(throwing: ExtensionError(message["error"]["message"].string ?? "error", code: message["error"]["code"].int ?? ErrorCode.handlerFailed)) }
    }

    func failAll() {
        let all = lock.withLock { () -> [CheckedContinuation<JSON, Error>] in
            let a = Array(pending.values)
            pending.removeAll()
            return a
        }
        for c in all { c.resume(throwing: ExtensionError("the app closed the connection")) }
    }
}

// MARK: What the app does for a program (§4.3, §12.3, §14.3)

public enum LogLevel: String, Sendable { case debug, info, warn, error }

/// The app's services. Each needs its permission in the manifest; a refusal is an `ExtensionError` with code -32001.
public struct AppHost: Sendable {
    let connection: Connection
    /// The call's server (`context.server.id`) and node (`context.node.id`): the defaults of `exec`, `secret`, `nodeSecret`.
    let server: String?
    let node: String?

    /// A command on a server over the app's SSH session (bastions, 2FA, containers handled by the app). Only servers of
    /// calls in progress (or ones the program's screens see) may be named.
    public func exec(_ command: String, server: String? = nil, stdin: String? = nil, timeout: Int? = nil, sudo: Bool = false,
                     container: String? = nil) async throws -> ExecResult {
        let r = try await connection.request("host/exec", object([
            ("server", (server ?? self.server).map(JSON.string) ?? .null), ("command", .string(command)), ("stdin", stdin.map(JSON.string)),
            ("timeout", timeout.map { .number(Double($0)) }), ("sudo", sudo ? true : nil), ("container", container.map(JSON.string)),
        ]))
        return try r.decode(ExecResult.self)
    }

    /// A secret setting of the module for the call's server (permission `secrets`).
    public func secret(_ key: String, server: String? = nil) async throws -> String {
        try await connection.request("host/secret", ["server": (server ?? self.server).map(JSON.string) ?? .null, "key": .string(key)])["value"].string ?? ""
    }

    /// A secret field of an extension's node: the call's node by default (permission `secrets`).
    public func nodeSecret(_ key: String, node: String? = nil) async throws -> String {
        try await connection.request("host/secret", ["node": (node ?? self.node).map(JSON.string) ?? .null, "key": .string(key)])["value"].string ?? ""
    }

    /// The extension's own JSON store (permission `store`).
    public func storeGet(_ key: String) async throws -> JSON { try await connection.request("host/store/get", ["key": .string(key)])["value"] }
    public func storeSet(_ key: String, _ value: JSON) async throws { _ = try await connection.request("host/store/set", ["key": .string(key), "value": value]) }

    /// A notification of macOS (permission `notify`).
    public func notify(title: String, text: String) async throws { _ = try await connection.request("host/notify", ["title": .string(title), "text": .string(text)]) }

    /// A line of the extension's log (Settings → Extensions → Log…).
    public func log(_ level: LogLevel, _ message: String) { connection.notify("host/log", ["level": .string(level.rawValue), "message": .string(message)]) }

    /// A port forwarded through the SSH session of the server the user bound `node` to (permission `forward`).
    public func forward(node: String, host: String, port: Int) async throws -> (host: String, port: Int) {
        let r = try await connection.request("host/forward", ["node": .string(node), "host": .string(host), "port": .number(Double(port))])
        return (r["host"].string ?? "127.0.0.1", r["port"].int ?? 0)
    }

    /// A browser sign-in, only while `storage/signIn` for `node` runs (permission `oauth`): the access token.
    public func oauth(node: String, authURL: String, tokenURL: String, clientID: String, clientSecret: String? = nil, scope: String? = nil,
                      params: [String: String]? = nil) async throws -> String? {
        try await connection.request("host/oauth", object([
            ("node", .string(node)), ("authURL", .string(authURL)), ("tokenURL", .string(tokenURL)), ("clientID", .string(clientID)),
            ("clientSecret", clientSecret.map(JSON.string)), ("scope", scope.map(JSON.string)), ("params", params.map { .object($0.mapValues(JSON.string)) }),
        ]))["accessToken"].string
    }

    /// Opens a node, a screen of the extension or a terminal; `false` — the user said no.
    public func open(_ target: OpenTarget) async throws -> Bool { try await connection.request("host/open", target.json)["opened"].bool != false }

    /// Asks the user in the app's dialog: the index of the button pressed.
    public func ask(_ question: Question) async throws -> Int { try await connection.request("host/ask", try JSON(encoding: question))["button"].int ?? 0 }
}

// MARK: Contexts

/// What a handler gets besides its input: the call's context and the app's services.
public struct HandlerContext: Sendable {
    public let context: Context
    public let host: AppHost
    public var locale: String { context.locale }
    public var settings: [String: JSON] { context.settings }
    public var server: Server? { context.server }
    public var node: NodeContext? { context.node }
    public var item: JSON? { context.item }
    /// The text for the call's language.
    public func tr(_ texts: [String: String]) -> String { SSHKipperSDK.tr(locale, texts) }
}

/// An event's context: the call's, plus `push` — ops to this screen at any time later (live data, `ui/push`).
public struct EventContext: Sendable {
    public let handler: HandlerContext
    public let screen: String
    let connection: Connection
    public var host: AppHost { handler.host }
    public var locale: String { handler.locale }
    public var node: NodeContext? { handler.node }
    public var server: Server? { handler.server }
    public func push(_ ops: [JSON]) {
        if !ops.isEmpty { connection.notify("ui/push", ["screen": .string(screen), "ops": .array(ops)]) }
    }
}

/// What a contribution's own method gets.
public struct MethodContext: Sendable {
    public let host: AppHost
    public let locale: String
    public func tr(_ texts: [String: String]) -> String { SSHKipperSDK.tr(locale, texts) }
}

public typealias HandlerFunction = @Sendable (_ input: [String: JSON], _ ctx: HandlerContext) async throws -> JSON
public typealias EventFunction = @Sendable (_ event: ScreenEvent, _ ctx: EventContext) async throws -> EventAnswer
public typealias MethodFunction = @Sendable (_ params: JSON, _ ctx: MethodContext) async throws -> JSON
public typealias ImporterFunction = @Sendable (_ file: ImportFile, _ ctx: HandlerContext) async throws -> ImportResult
public typealias ConsoleFunction = @Sendable (_ session: ConsoleSession, _ ctx: HandlerContext) async throws -> Void

// MARK: The extension

/// A program's handlers and contribution methods. Register, then `await run()` — it returns when the app closes stdin.
public final class Extension: @unchecked Sendable {
    private let lock = NSLock()
    private var handlers: [String: HandlerFunction] = [:]
    private var methods: [String: MethodFunction] = [:]
    private var importers: [String: ImporterFunction] = [:]
    private var consoles: [String: ConsoleFunction] = [:]
    private var eventFunction: EventFunction?
    private var aiProvider: (any AIProvider)?
    private var setupFunction: (@Sendable (_ app: String, _ locale: String) async throws -> Void)?
    private var running: [String: Task<Void, Never>] = [:]
    private var chats: [String: Task<Void, Never>] = [:]
    private var sessions: [String: ConsoleSession] = [:]

    public init() {}

    /// A handler of `handlers` in the manifest: pages, actions, tools, automation blocks, screens' `render`.
    public func handler(_ name: String, _ fn: @escaping HandlerFunction) { lock.withLock { handlers[name] = fn } }
    /// A live screen's events (§11): what the user did → ops changing the screen.
    public func onEvent(_ fn: @escaping EventFunction) { lock.withLock { eventFunction = fn } }
    /// A contribution's own method by name (`storage/list`…). `storage(_:)` and `source(_:)` register theirs.
    public func method(_ name: String, _ fn: @escaping MethodFunction) { lock.withLock { methods[name] = fn } }
    /// `contributes.import[]` by id (§15).
    public func importer(_ id: String, _ fn: @escaping ImporterFunction) { lock.withLock { importers[id] = fn } }
    /// `contributes.console[]` by id (§16): called when the app opens one.
    public func console(_ id: String, _ fn: @escaping ConsoleFunction) { lock.withLock { consoles[id] = fn } }
    /// A model provider (`contributes.ai`, §13).
    public func ai(_ provider: some AIProvider) { lock.withLock { aiProvider = provider } }
    /// Called once after `initialize`, before any call.
    public func setup(_ fn: @escaping @Sendable (_ app: String, _ locale: String) async throws -> Void) { lock.withLock { setupFunction = fn } }

    /// Serves the app until it closes stdin (or sends `shutdown`).
    public func run(transport: Transport = StdioTransport()) async {
        let connection = Connection(transport: transport)
        var locale = "en"
        for await line in transport.lines() {
            guard let msg = try? JSON.parse(line) else {
                connection.send(["id": .null, "error": ["code": .number(Double(ErrorCode.parse)), "message": "not JSON"]])
                continue
            }
            let id = msg["id"]
            guard let method = msg["method"].string else { connection.answer(msg); continue }
            let params = msg["params"]
            switch method {
            case "initialize":
                locale = params["locale"].string ?? locale
                do {
                    if let setup = lock.withLock({ setupFunction }) { try await setup(params["app"].string ?? "", locale) }
                    let names = lock.withLock { handlers.keys.sorted() }
                    connection.send(["id": id, "result": ["handlers": .array(names.map(JSON.string))]])
                } catch {
                    connection.send(["id": id, "error": ["code": .number(Double(ErrorCode.handlerFailed)), "message": .string("setup failed: \(Self.message(error))")]])
                }
            case "cancel":
                lock.withLock { running[params["id"].text] }?.cancel()
            case "ai/cancel":
                lock.withLock { chats[params["id"].text] }?.cancel()
            case "console/input":
                if let s = lock.withLock({ sessions[params["session"].text] }) { s.input(Data(base64Encoded: params["data"].string ?? "") ?? Data()) }
            case "console/resize":
                if let s = lock.withLock({ sessions[params["session"].text] }) { s.resize(cols: params["cols"].int ?? s.cols, rows: params["rows"].int ?? s.rows) }
            case "console/close":
                if let s = lock.withLock({ sessions.removeValue(forKey: params["session"].text) }) { s.end() }
            case "shutdown":
                for s in lock.withLock({ () -> [ConsoleSession] in let a = Array(sessions.values); sessions.removeAll(); return a }) { s.end() }
                connection.send(["id": id, "result": .null])
                connection.failAll()
                return
            default:
                guard !id.isNull else { continue }
                start(id: id, stream: method == "ai/chat" ? params["id"].text : nil, connection: connection, work: route(method, params, connection, locale))
            }
        }
        connection.failAll()
    }

    /// Runs a request in its own task, known to `cancel` (and to `ai/cancel` by its stream) from the start.
    private func start(id: JSON, stream: String?, connection: Connection, work: @escaping @Sendable () async throws -> JSON) {
        let key = id.text
        // Created under the lock: a quick task can't remove itself before it is listed.
        lock.withLock {
            let task = Task {
                let result: Result<JSON, Error>
                do { result = .success(try await work()) } catch { result = .failure(error) }
                // A cancelled call isn't answered: the app no longer waits for it.
                let cancelled = Task.isCancelled
                self.lock.withLock {
                    _ = self.running.removeValue(forKey: key)
                    if let stream { _ = self.chats.removeValue(forKey: stream) }
                }
                if cancelled { return }
                switch result {
                case .success(let v): connection.send(["id": id, "result": v])
                case .failure(let e):
                    if e is CancellationError { return }
                    let code = (e as? ExtensionError)?.code ?? ErrorCode.handlerFailed
                    connection.send(["id": id, "error": ["code": .number(Double(code)), "message": .string(Self.message(e))]])
                }
            }
            running[key] = task
            if let stream { chats[stream] = task }
        }
    }

    static func message(_ e: Error) -> String { (e as? ExtensionError)?.message ?? (e as? LocalizedError)?.errorDescription ?? String(describing: e) }

    /// The work a request asks for; run in its own task (cancellable by `cancel`).
    private func route(_ method: String, _ params: JSON, _ connection: Connection, _ locale: String) -> @Sendable () async throws -> JSON {
        let host: @Sendable (Context) -> AppHost = { ctx in AppHost(connection: connection, server: ctx.server?.id, node: ctx.node?.id) }
        switch method {
        case "handler/call":
            let fn = lock.withLock { handlers[params["handler"].string ?? ""] }
            return {
                guard let fn else { throw ExtensionError("no handler \(params["handler"].text)", code: ErrorCode.methodNotFound) }
                let request = try params.decode(Request.self)
                return try await fn(request.input, HandlerContext(context: request.context, host: host(request.context)))
            }
        case "ui/event":
            let fn = lock.withLock { eventFunction }
            return {
                guard let fn else { return .null }
                let event = try params["event"].decode(ScreenEvent.self)
                let context = try params["context"].isNull ? Context(locale: locale) : params["context"].decode(Context.self)
                let ctx = EventContext(handler: HandlerContext(context: context, host: host(context)), screen: event.screen, connection: connection)
                return try await fn(event, ctx).json
            }
        case "ai/models", "ai/chat":
            let provider = lock.withLock { aiProvider }
            return {
                guard let provider else { throw ExtensionError("no model provider", code: ErrorCode.methodNotFound) }
                if method == "ai/models" {
                    return try JSON(encoding: try await provider.models(try params.decode(AIModelsRequest.self)))
                }
                let request = try params.decode(AIChatRequest.self)
                let ctx = AIChatContext(stream: request.id, connection: connection)
                return try JSON(encoding: try await provider.chat(request, ctx))
            }
        case "import/parse":
            let fn = lock.withLock { importers[params["importer"].string ?? ""] }
            return {
                guard let fn else { throw ExtensionError("no importer \(params["importer"].text)", code: ErrorCode.methodNotFound) }
                let file = ImportFile(importer: params["importer"].text, name: params["name"].text, data: Data(base64Encoded: params["data"].string ?? "") ?? Data(),
                                      locale: params["locale"].string ?? locale)
                // No server: an import happens on this Mac, before any connection exists.
                let context = Context(locale: file.locale)
                return try JSON(encoding: try await fn(file, HandlerContext(context: context, host: host(context))))
            }
        case "console/open":
            let fn = lock.withLock { consoles[params["console"].string ?? ""] }
            // Listed before the loop reads on: input or a resize right behind the open isn't lost.
            let node = (try? params["node"].decode(ConsoleNode.self)) ?? ConsoleNode(id: "")
            let session = ConsoleSession(id: params["session"].text, console: params["console"].text, node: node,
                                         cols: params["cols"].int ?? 80, rows: params["rows"].int ?? 24, connection: connection)
            if fn != nil {
                session.onEnd = { self.lock.withLock { _ = self.sessions.removeValue(forKey: session.id) } }
                lock.withLock { sessions[session.id] = session }
            }
            return {
                guard let fn else { throw ExtensionError("no console \(params["console"].text)", code: ErrorCode.methodNotFound) }
                let context = (try? params["context"].decode(Context.self)) ?? Context(locale: locale)
                do { try await fn(session, HandlerContext(context: context, host: host(context))) } catch {
                    self.lock.withLock { _ = self.sessions.removeValue(forKey: session.id) }
                    throw error
                }
                return [:]
            }
        default:
            let fn = lock.withLock { methods[method] }
            return {
                guard let fn else { throw ExtensionError("no method \(method)", code: ErrorCode.methodNotFound) }
                return try await fn(params, MethodContext(host: AppHost(connection: connection, server: nil, node: nil), locale: locale))
            }
        }
    }
}

// MARK: Model providers (§13)

/// A model provider: the models it offers and a chat answered in pieces (`ctx.delta`). «Стоп» cancels the task:
/// check `Task.isCancelled` (or let `Task.sleep` throw).
public protocol AIProvider: Sendable {
    func models(_ request: AIModelsRequest) async throws -> [AIModel]
    func chat(_ request: AIChatRequest, _ ctx: AIChatContext) async throws -> AIChatResult
}

public struct AIChatContext: Sendable {
    let stream: String
    let connection: Connection
    /// A piece of the answer now (`ai/delta`).
    public func delta(_ d: AIDelta) {
        var j = d.json
        j["id"] = .string(stream)
        connection.notify("ai/delta", j)
    }
    public func log(_ level: LogLevel, _ message: String) { connection.notify("host/log", ["level": .string(level.rawValue), "message": .string(message)]) }
}

// MARK: Consoles (§16)

/// A console the app opened: bytes both ways, the terminal's size, its end.
public final class ConsoleSession: @unchecked Sendable {
    public let id: String
    /// The contribution's id.
    public let console: String
    public let node: ConsoleNode
    private let lock = NSLock()
    private var size: (cols: Int, rows: Int)
    private var closed = false
    private var inputs: [@Sendable (Data) -> Void] = []
    /// Input that came before the console listened (typed while it opened): given to the first `onInput`.
    private var queued: [Data] = []
    private var resizes: [@Sendable (Int, Int) -> Void] = []
    private var closes: [@Sendable () -> Void] = []
    private let connection: Connection
    var onEnd: (@Sendable () -> Void)?

    init(id: String, console: String, node: ConsoleNode, cols: Int, rows: Int, connection: Connection) {
        self.id = id; self.console = console; self.node = node; self.size = (cols, rows); self.connection = connection
    }

    public var cols: Int { lock.withLock { size.cols } }
    public var rows: Int { lock.withLock { size.rows } }
    public var isClosed: Bool { lock.withLock { closed } }

    /// Bytes to the terminal, in chunks the app takes (≤ 48 KB).
    public func write(_ data: Data) {
        guard !isClosed else { return }
        var at = data.startIndex
        while at < data.endIndex {
            let end = data.index(at, offsetBy: 48 * 1024, limitedBy: data.endIndex) ?? data.endIndex
            connection.notify("console/data", ["session": .string(id), "data": .string(data[at..<end].base64EncodedString())])
            at = end
        }
    }
    public func write(_ text: String) { write(Data(text.utf8)) }

    /// Ends the console from this side: the tab says it closed.
    public func close(reason: String? = nil) {
        guard !isClosed else { return }
        connection.notify("console/closed", object([("session", .string(id)), ("reason", reason.map(JSON.string))]))
        end()
    }

    /// What the user typed (Return is "\r"; a paste comes in pieces).
    public func onInput(_ fn: @escaping @Sendable (Data) -> Void) {
        let early = lock.withLock { () -> [Data] in inputs.append(fn); defer { queued = [] }; return queued }
        for d in early { fn(d) }
    }
    public func onResize(_ fn: @escaping @Sendable (_ cols: Int, _ rows: Int) -> Void) { lock.withLock { resizes.append(fn) } }
    /// The tab was closed (or the program stops): stop whatever feeds it.
    public func onClose(_ fn: @escaping @Sendable () -> Void) { lock.withLock { closes.append(fn) } }

    func input(_ data: Data) {
        let fs = lock.withLock { () -> [@Sendable (Data) -> Void] in if inputs.isEmpty { queued.append(data) }; return inputs }
        for f in fs { f(data) }
    }
    func resize(cols: Int, rows: Int) {
        let fs = lock.withLock { () -> [@Sendable (Int, Int) -> Void] in size = (cols, rows); return resizes }
        for f in fs { f(cols, rows) }
    }
    func end() {
        let fs = lock.withLock { () -> [@Sendable () -> Void]? in
            if closed { return nil }
            closed = true
            return closes
        }
        guard let fs else { return }
        onEnd?()
        for f in fs { f() }
    }
}
