import Foundation

// The manifest, `sshkipper-extension.json` or `sshkipper-module.json` (schemas/module.schema.json is normative; these
// types read it). Unknown keys are ignored, as the app reads a newer manifest's fields it doesn't know.

/// A string, or one per language: `{"ru": "Очереди", "en": "Queues"}`.
public enum LocalizedText: Codable, Sendable, Hashable, ExpressibleByStringLiteral {
    case plain(String)
    case byLanguage([String: String])

    public init(stringLiteral value: String) { self = .plain(value) }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { self = .plain(s) } else { self = .byLanguage(try c.decode([String: String].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .plain(let s): try c.encode(s)
        case .byLanguage(let d): try c.encode(d)
        }
    }

    /// The text for a language (`ru`, `en-GB`…): that language, its base, English, any.
    public func text(_ locale: String = "en") -> String {
        switch self {
        case .plain(let s): return s
        case .byLanguage(let d):
            let base = String(locale.split(whereSeparator: { $0 == "-" || $0 == "_" }).first ?? "")
            return d[locale] ?? d[base] ?? d["en"] ?? d.values.sorted().first ?? ""
        }
    }
}

public struct Icon: Codable, Sendable, Hashable {
    public var symbol: String
    public var color: String?
    public init(symbol: String, color: String? = nil) { self.symbol = symbol; self.color = color }
}

public enum Risk: String, Codable, Sendable { case read, change, danger }

public enum Permission: String, Codable, Sendable, CaseIterable {
    case exec, sudo, secrets, network, store, notify, forward, oauth
}

public struct Runtime: Codable, Sendable, Hashable {
    /// `server` — scripts on the server; `process` — a program on this Mac.
    public var kind: String
    public var command: [String]?
    public var env: [String: String]?
}

/// A setting of a module, or a field of a storage, source, node type or model provider.
public struct Setting: Codable, Sendable, Hashable {
    public var key: String
    public var title: LocalizedText
    public var help: LocalizedText?
    /// `text`, `number`, `bool`, `choice`, `secret`, `path`, `list`, `node` (a node type's link).
    public var type: String
    public var `default`: JSON?
    public var choices: [Choice]?
    public var placeholder: String?
    public var nodeKinds: [String]?

    public struct Choice: Codable, Sendable, Hashable { public var value: String; public var title: LocalizedText }
}

/// A parameter of an action, a tool or an automation block.
public struct Param: Codable, Sendable, Hashable {
    public var key: String
    public var title: LocalizedText
    public var type: String
    public var `default`: JSON?
    public var required: Bool?
    public var choices: [String]?
    public var pattern: String?
}

public struct HandlerSpec: Codable, Sendable, Hashable {
    public var script: String?
    public var timeout: Double?
    public var sudo: String?
    public var output: String?
}

public struct Page: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var view: String?
    public var data: [String: String]?
    public var render: String?
    public var refresh: Double?
}

public struct Action: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var symbol: String?
    public var handler: String
    public var risk: Risk
    public var on: String?
    public var confirm: LocalizedText?
    public var params: [Param]?
}

public struct Tool: Codable, Sendable, Hashable {
    public var name: String
    public var title: LocalizedText?
    public var description: String
    public var handler: String
    public var risk: Risk
    public var params: [Param]?
}

public struct AutomationBlock: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var description: LocalizedText?
    public var symbol: String?
    public var handler: String
    public var risk: Risk
    public var params: [Param]?
    public var returns: String?
    public var server: Bool?
}

public struct Service: Codable, Sendable, Hashable {
    public var detect: String?
    public var summary: String?
    public var page: String?
    public var tree: Tree?
    public var containers: Bool?

    public struct Tree: Codable, Sendable, Hashable { public var handler: String; public var page: String? }
}

// MARK: Contributions (spec/protocol.md §10)

public struct DatabaseContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    public var logo: String?
    /// `sql`, `keyValue`, `document`.
    public var model: String
    public var defaultPort: Int?
    public var isFile: Bool?
    public var hasSchemas: Bool?
    public var hasEditorTransactions: Bool?
    public var identifierQuote: String?
    public var keywords: [String]?
    public var functions: [String]?
    public var readCommands: [String]?
    public var command: [String]?
}

public struct StorageContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    /// `keys`, `login`, `browser` (needs `oauth`), `none`.
    public var signIn: String?
    public var fields: [Setting]?
    /// `folders`, `rename`, `delete`, `links`, `freeSpace`, `check`.
    public var capabilities: [String]?
}

public struct SourceContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    public var fields: [Setting]?
    public var refresh: Int?
}

public struct NodeTypeContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    public var fields: [Setting]?
    public var screen: String?
}

public struct ScreenContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    /// `tab`, `section`, `panel`.
    public var placement: String
    public var render: String
}

public struct ImportContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    public var fileExtensions: [String]
    public var maxSizeMB: Double?
}

public struct ConsoleContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    public var appliesTo: [String]?
}

public struct AIContribution: Codable, Sendable, Hashable {
    public var id: String
    public var title: LocalizedText
    public var icon: Icon?
    public var description: LocalizedText?
    public var fields: [Setting]?
    public var reasoning: [String]?
}

public struct Contributes: Codable, Sendable, Hashable {
    public var service: Service?
    public var tools: [Tool]?
    public var automation: [AutomationBlock]?
    public var database: [DatabaseContribution]?
    public var storage: [StorageContribution]?
    public var source: [SourceContribution]?
    public var nodeType: [NodeTypeContribution]?
    public var screen: [ScreenContribution]?
    public var `import`: [ImportContribution]?
    public var console: [ConsoleContribution]?
    public var ai: [AIContribution]?
}

public struct Manifest: Codable, Sendable, Hashable {
    public var sdk: Int
    public var id: String
    public var version: String
    public var title: LocalizedText
    public var description: LocalizedText?
    public var author: Author?
    public var license: String?
    public var homepage: String?
    public var icon: Icon?
    public var runtime: Runtime
    public var permissions: [Permission]?
    public var settings: [Setting]?
    public var service: Service?
    public var pages: [Page]?
    public var handlers: [String: HandlerSpec]?
    public var actions: [Action]?
    public var tools: [Tool]?
    public var automation: [AutomationBlock]?
    public var components: [String: JSON]?
    public var contributes: Contributes?

    public struct Author: Codable, Sendable, Hashable { public var name: String; public var url: String? }

    /// The manifest file names a package folder may hold, an extension's first.
    public static let files = ["sshkipper-extension.json", "sshkipper-module.json"]

    /// Reads the manifest of a package folder.
    public static func load(folder: URL) throws -> Manifest {
        let present = files.filter { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0).path) }
        guard present.count == 1 else {
            throw ExtensionError(present.isEmpty ? "no sshkipper-extension.json or sshkipper-module.json" : "both manifests in one folder — keep one")
        }
        return try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: folder.appendingPathComponent(present[0])))
    }

    /// The kinds of contribution it makes, as `contributes` names them (service, tools, automation counted at either place).
    public var contributionKinds: [String] {
        var k: [String] = []
        if service != nil || contributes?.service != nil { k.append("service") }
        if !(tools ?? contributes?.tools ?? []).isEmpty { k.append("tools") }
        if !(automation ?? contributes?.automation ?? []).isEmpty { k.append("automation") }
        let c = contributes
        let more: [(String, Int)] = [("database", c?.database?.count ?? 0), ("storage", c?.storage?.count ?? 0), ("source", c?.source?.count ?? 0),
                                     ("nodeType", c?.nodeType?.count ?? 0), ("screen", c?.screen?.count ?? 0), ("import", c?.import?.count ?? 0),
                                     ("console", c?.console?.count ?? 0), ("ai", c?.ai?.count ?? 0)]
        return k + more.filter { $0.1 > 0 }.map(\.0)
    }
}
