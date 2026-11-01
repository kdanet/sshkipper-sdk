import Foundation

// The messages of spec/protocol.md as Swift types. Field names are the wire's; optional fields are left out when nil.

/// JSON-RPC error codes (§4.4).
public enum ErrorCode {
    public static let parse = -32700
    public static let invalidRequest = -32600
    public static let methodNotFound = -32601
    public static let invalidParams = -32602
    public static let handlerFailed = -32000
    public static let permission = -32001
    public static let cancelled = -32002
    public static let timeout = -32003
}

/// A failure the app shows to the user (or gives to the model, or fails the automation step with).
public struct ExtensionError: Error, Sendable, CustomStringConvertible {
    public var message: String
    public var code: Int
    public init(_ message: String, code: Int = ErrorCode.handlerFailed) { self.message = message; self.code = code }
    public var description: String { message }
}

// MARK: Calls (§2)

public struct Server: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var host: String
    public var user: String?
}

/// A node a program sees (§14.3): `kind` — `connection`, `database`… or `ext:<extension>/<type>`.
public struct NodeLink: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var kind: String
    public var host: String?
    public var user: String?
}

/// `context.node` (§14.1): the extension's node a screen is open for.
public struct NodeContext: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var type: String
    public var settings: [String: JSON]
    public var links: [String: NodeLink]
    public var secrets: [String]

    public init(id: String, name: String, type: String, settings: [String: JSON] = [:], links: [String: NodeLink] = [:], secrets: [String] = []) {
        self.id = id; self.name = name; self.type = type; self.settings = settings; self.links = links; self.secrets = secrets
    }
}

public struct Context: Codable, Sendable, Hashable {
    public var server: Server?
    public var container: String?
    public var settings: [String: JSON]
    public var item: JSON?
    public var node: NodeContext?
    public var locale: String
    public var sdk: Int?
    public var app: String?
    /// An automation block's call (§8).
    public var automation: Bool?

    public init(server: Server? = nil, settings: [String: JSON] = [:], item: JSON? = nil, node: NodeContext? = nil, locale: String = "en") {
        self.server = server; self.settings = settings; self.item = item; self.node = node; self.locale = locale
    }

    enum CodingKeys: String, CodingKey { case server, container, settings, item, node, locale, sdk, app, automation }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        server = try c.decodeIfPresent(Server.self, forKey: .server)
        container = try c.decodeIfPresent(String.self, forKey: .container)
        settings = try c.decodeIfPresent([String: JSON].self, forKey: .settings) ?? [:]
        item = try c.decodeIfPresent(JSON.self, forKey: .item)
        node = try c.decodeIfPresent(NodeContext.self, forKey: .node)
        locale = try c.decodeIfPresent(String.self, forKey: .locale) ?? "en"
        sdk = try c.decodeIfPresent(Int.self, forKey: .sdk)
        app = try c.decodeIfPresent(String.self, forKey: .app)
        automation = try c.decodeIfPresent(Bool.self, forKey: .automation)
    }
}

/// The request of `handler/call` (§2).
public struct Request: Codable, Sendable {
    public var handler: String
    public var input: [String: JSON]
    public var context: Context

    enum CodingKeys: String, CodingKey { case handler, input, context }

    public init(handler: String, input: [String: JSON] = [:], context: Context = Context()) {
        self.handler = handler; self.input = input; self.context = context
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        handler = try c.decode(String.self, forKey: .handler)
        input = try c.decodeIfPresent([String: JSON].self, forKey: .input) ?? [:]
        context = try c.decodeIfPresent(Context.self, forKey: .context) ?? Context()
    }
}

public struct ExecResult: Codable, Sendable, Hashable {
    public var exitCode: Int
    public var stdout: String
    public var stderr: String
}

/// `host/open` (§14.3).
public enum OpenTarget: Sendable, Hashable {
    /// A node the program sees, as a double click.
    case node(String)
    /// A tab screen of its own (for a node), or a `section` screen on a server.
    case screen(String, node: String? = nil, server: String? = nil)
    /// A terminal on a server it sees; the user is asked about the command first.
    case terminal(server: String, command: String? = nil, title: String? = nil)

    var json: JSON {
        switch self {
        case .node(let id): return ["node": .string(id)]
        case .screen(let id, let node, let server): return object([("screen", .string(id)), ("node", node.map(JSON.string)), ("server", server.map(JSON.string))])
        case .terminal(let server, let command, let title):
            return ["terminal": object([("server", .string(server)), ("command", command.map(JSON.string)), ("title", title.map(JSON.string))])]
        }
    }
}

/// `host/ask` (§14.3): `buttons[0]` is the main one; `danger` makes it red and never the Return default.
public struct Question: Codable, Sendable, Hashable {
    public var title: String
    public var text: String?
    public var buttons: [String]?
    /// `info`, `warn`, `danger`.
    public var risk: String?
    public var cancel: Int?
    public init(title: String, text: String? = nil, buttons: [String]? = nil, risk: String? = nil, cancel: Int? = nil) {
        self.title = title; self.text = text; self.buttons = buttons; self.risk = risk; self.cancel = cancel
    }
}

// MARK: Live screens (§11)

/// What the user did on a screen (`ui/event`). `state` — the screen's variables now.
public struct ScreenEvent: Codable, Sendable, Hashable {
    public var screen: String
    public var seq: Int
    /// `open`, `close`, `press`, `activate`, `select`, `change`, `submit`, `expand`, `collapse`, `more`, `sort`, `edit`,
    /// `menu`, `drop`, `move`, `complete`.
    public var type: String
    public var block: String?
    public var value: JSON?
    public var state: [String: JSON]?
}

/// What an event answers: ops, and completions for `complete`.
public struct EventAnswer: Sendable {
    public var ops: [JSON]
    public var items: [JSON]?
    public init(ops: [JSON] = [], items: [JSON]? = nil) { self.ops = ops; self.items = items }
    public static let none = EventAnswer()

    var json: JSON { items.map { ["ops": .array(ops), "items": .array($0)] } ?? .array(ops) }
}

// MARK: Storage and source (§12)

/// Which storage a `storage/*` call is for: its node, kind, settings (secret fields as text).
public struct StorageRef: Codable, Sendable, Hashable {
    public var node: String
    public var kind: String
    public var settings: [String: JSON]
    public var readOnly: Bool
    public var throughServer: Bool

    enum CodingKeys: String, CodingKey { case node, kind, settings, readOnly, throughServer }
    public init(node: String, kind: String, settings: [String: JSON] = [:], readOnly: Bool = false, throughServer: Bool = false) {
        self.node = node; self.kind = kind; self.settings = settings; self.readOnly = readOnly; self.throughServer = throughServer
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        node = try c.decode(String.self, forKey: .node)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
        settings = try c.decodeIfPresent([String: JSON].self, forKey: .settings) ?? [:]
        readOnly = try c.decodeIfPresent(Bool.self, forKey: .readOnly) ?? false
        throughServer = try c.decodeIfPresent(Bool.self, forKey: .throughServer) ?? false
    }
}

/// One entry of a storage. `modified` — seconds since 1970; `digest` — checked by the app after a download.
public struct StorageItem: Codable, Sendable, Hashable {
    public var name: String
    /// `file` or `folder`.
    public var type: String
    public var size: Int?
    public var modified: Int?
    public var digest: Digest?

    public struct Digest: Codable, Sendable, Hashable { public var algorithm: String; public var value: String }

    public init(name: String, type: String, size: Int? = nil, modified: Int? = nil, digest: Digest? = nil) {
        self.name = name; self.type = type; self.size = size; self.modified = modified; self.digest = digest
    }
    public static func file(_ name: String, size: Int, modified: Int? = nil) -> StorageItem { .init(name: name, type: "file", size: size, modified: modified) }
    public static func folder(_ name: String, modified: Int? = nil) -> StorageItem { .init(name: name, type: "folder", modified: modified) }
}

public struct StorageLink: Codable, Sendable, Hashable {
    public var url: String
    public var id: String?
    public var expires: Int?
    public var hasPassword: Bool?
    public init(url: String, id: String? = nil, expires: Int? = nil, hasPassword: Bool? = nil) {
        self.url = url; self.id = id; self.expires = expires; self.hasPassword = hasPassword
    }
}

public struct SourceRef: Codable, Sendable, Hashable {
    public var node: String
    public var kind: String
    public var settings: [String: JSON]
}

/// One host a source found. `id` is stable in the source (never the address); `jump` — a bastion by the name of a
/// connection of the user's document. Host keys never come from a source.
public struct FoundHost: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var address: String
    public var port: Int?
    public var user: String?
    public var jump: String?
    public var online: Bool?
    public var os: String?
    public var tags: [String]?
    public var group: String?
    public var addresses: [String]?
    public var details: [String]?
    public var lastSeen: Int?

    public init(id: String, name: String, address: String, port: Int? = nil, user: String? = nil, jump: String? = nil, online: Bool? = nil,
                os: String? = nil, tags: [String]? = nil, group: String? = nil) {
        self.id = id; self.name = name; self.address = address; self.port = port; self.user = user; self.jump = jump; self.online = online
        self.os = os; self.tags = tags; self.group = group
    }
}

// MARK: Import (§15)

/// The file the user picked, as the app read it — never its path.
public struct ImportFile: Sendable {
    public var importer: String
    public var name: String
    public var data: Data
    public var locale: String
    public var text: String { String(decoding: data, as: UTF8.self) }
}

public indirect enum ImportNode: Sendable, Hashable, Encodable {
    case folder(name: String, note: String? = nil, children: [ImportNode] = [])
    case connection(ImportConnection)

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .folder(let name, let note, let children):
            try object([("type", "folder"), ("name", .string(name)), ("note", note.map(JSON.string)), ("children", .array(try children.map { try JSON(encoding: $0) }))]).encode(to: encoder)
        case .connection(let c): try c.encode(to: encoder)
        }
    }
}

public struct ImportConnection: Encodable, Sendable, Hashable {
    public var type = "connection"
    public var id: String?
    public var name: String
    public var host: String
    public var port: Int?
    public var user: String?
    public var note: String?
    public var tags: [String]?
    public var bastion: String?
    public var credential: String?
    public init(id: String? = nil, name: String, host: String, port: Int? = nil, user: String? = nil, note: String? = nil, tags: [String]? = nil,
                bastion: String? = nil, credential: String? = nil) {
        self.id = id; self.name = name; self.host = host; self.port = port; self.user = user; self.note = note; self.tags = tags
        self.bastion = bastion; self.credential = credential
    }
}

public struct ImportCredential: Encodable, Sendable, Hashable { public var id: String; public var name: String?; public var user: String? }
/// A password or key of the file: the app asks the user before it imports any (`kind`: `password`, `privateKey`).
public struct ImportSecret: Encodable, Sendable, Hashable { public var credential: String; public var kind: String; public var value: String }

public struct ImportResult: Encodable, Sendable {
    public var nodes: [ImportNode]
    public var credentials: [ImportCredential]?
    public var secrets: [ImportSecret]?
    public var warnings: [String]?
    public init(nodes: [ImportNode], credentials: [ImportCredential]? = nil, secrets: [ImportSecret]? = nil, warnings: [String]? = nil) {
        self.nodes = nodes; self.credentials = credentials; self.secrets = secrets; self.warnings = warnings
    }
}

// MARK: Consoles (§16)

/// The node a console was opened for: its address and login (never a password).
public struct ConsoleNode: Codable, Sendable, Hashable {
    public var id: String
    public var name: String?
    public var host: String?
    public var port: Int?
    public var user: String?
}

// MARK: Model providers (§13)

/// A block of a message as the app keeps a chat.
public enum AIBlock: Codable, Sendable, Hashable {
    case text(String)
    case toolUse(id: String, name: String, input: [String: JSON])
    case toolResult(id: String, content: String, isError: Bool)
    case opaque(JSON)

    public init(from decoder: Decoder) throws {
        let j = try JSON(from: decoder)
        switch j["type"].string {
        case "text": self = .text(j["text"].string ?? "")
        case "tool_use": self = .toolUse(id: j["id"].string ?? "", name: j["name"].string ?? "", input: j["input"].object ?? [:])
        case "tool_result": self = .toolResult(id: j["id"].string ?? "", content: j["content"].text, isError: j["is_error"].bool ?? false)
        default: self = .opaque(j["value"])
        }
    }

    public func encode(to encoder: Encoder) throws {
        let j: JSON
        switch self {
        case .text(let t): j = ["type": "text", "text": .string(t)]
        case .toolUse(let id, let name, let input): j = ["type": "tool_use", "id": .string(id), "name": .string(name), "input": .object(input)]
        case .toolResult(let id, let content, let isError): j = ["type": "tool_result", "id": .string(id), "content": .string(content), "is_error": .bool(isError)]
        case .opaque(let v): j = ["type": "opaque", "value": v]
        }
        try j.encode(to: encoder)
    }
}

public struct AIMessage: Codable, Sendable, Hashable {
    /// `user`, `assistant`, `system`.
    public var role: String
    public var content: [AIBlock]
}

public struct AITool: Codable, Sendable, Hashable {
    public var name: String
    public var description: String
    public var input_schema: JSON
}

/// What `ai/chat` gets: the request every provider of the app gets (already masked), the profile's settings.
public struct AIChatRequest: Codable, Sendable {
    /// The stream's id: every `ai/delta` of this answer carries it.
    public var id: String
    public var provider: String
    public var model: String
    public var system: String
    public var messages: [AIMessage]
    public var tools: [AITool]
    public var max_tokens: Int
    public var effort: String?
    public var settings: [String: JSON]
    public var secrets: [String: String]

    /// The text of the last user message.
    public var lastQuestion: String {
        messages.last(where: { $0.role == "user" })?.content.compactMap { if case .text(let t) = $0 { return t }; return nil }.joined(separator: " ") ?? ""
    }
}

public struct AIModelsRequest: Codable, Sendable {
    public var provider: String
    public var settings: [String: JSON]
    public var secrets: [String: String]
}

public struct AIModel: Codable, Sendable, Hashable {
    public var id: String
    public var title: String?
    public init(id: String, title: String? = nil) { self.id = id; self.title = title }
}

/// A piece of a streamed answer (`ai/delta`).
public enum AIDelta: Sendable, Hashable {
    case text(String)
    case toolUse(toolID: String, name: String, input: [String: JSON]? = nil)
    case toolInput(toolID: String, json: String)
    case progress(String)
    case usage(input: Int, output: Int, model: String? = nil)

    var json: JSON {
        switch self {
        case .text(let t): return ["type": "text", "text": .string(t)]
        case .toolUse(let id, let name, let input): return object([("type", "tool_use"), ("toolId", .string(id)), ("name", .string(name)), ("input", input.map(JSON.object))])
        case .toolInput(let id, let json): return ["type": "tool_input", "toolId": .string(id), "json": .string(json)]
        case .progress(let t): return ["type": "progress", "text": .string(t)]
        case .usage(let i, let o, let m): return object([("type", "usage"), ("input", .number(Double(i))), ("output", .number(Double(o))), ("model", m.map(JSON.string))])
        }
    }
}

/// What `ai/chat` answers. `message` — the whole answer, for a program that doesn't stream.
public struct AIChatResult: Encodable, Sendable {
    /// `end_turn`, `tool_use`, `max_tokens`, `refusal`.
    public var stop: String?
    public var usage: Usage?
    public var model: String?
    public var message: Message?

    public struct Usage: Codable, Sendable { public var input_tokens: Int; public var output_tokens: Int }
    public struct Message: Encodable, Sendable { public var content: [AIBlock] }

    public init(stop: String? = "end_turn", usage: Usage? = nil, model: String? = nil, message: [AIBlock]? = nil) {
        self.stop = stop; self.usage = usage; self.model = model; self.message = message.map { Message(content: $0) }
    }
}
