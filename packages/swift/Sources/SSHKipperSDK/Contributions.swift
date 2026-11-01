import Foundation

// Storage and source contributions (spec/protocol.md §12): protocols to implement, registered as the methods the
// app sends. The optional storage methods answer only when the manifest's `capabilities` name them — the app never
// sends the others.

/// A storage contribution: what each `storage/*` method does.
public protocol StorageProvider: Sendable {
    func list(_ path: String, _ storage: StorageRef, _ ctx: MethodContext) async throws -> [StorageItem]
    /// nil — nothing there.
    func stat(_ path: String, _ storage: StorageRef, _ ctx: MethodContext) async throws -> StorageItem?
    /// Up to `length` bytes from `offset`; `eof` — nothing after them.
    func read(_ path: String, offset: Int, length: Int, _ storage: StorageRef, _ ctx: MethodContext) async throws -> (data: Data, eof: Bool)
    /// An upload in parts: nothing appears at `path` before `commit`; `abort` throws the parts away.
    func writeBegin(_ path: String, size: Int, modified: Int?, _ storage: StorageRef, _ ctx: MethodContext) async throws -> String
    func writeChunk(_ upload: String, offset: Int, data: Data, _ storage: StorageRef, _ ctx: MethodContext) async throws
    func writeCommit(_ upload: String, _ storage: StorageRef, _ ctx: MethodContext) async throws
    func writeAbort(_ upload: String, _ storage: StorageRef, _ ctx: MethodContext) async throws
    /// `folders`.
    func mkdir(_ path: String, _ storage: StorageRef, _ ctx: MethodContext) async throws
    /// `rename` (the app checks that `to` is free first).
    func rename(from: String, to: String, _ storage: StorageRef, _ ctx: MethodContext) async throws
    /// `delete`.
    func delete(_ path: String, recursive: Bool, _ storage: StorageRef, _ ctx: MethodContext) async throws
    /// `links`: `action` list, create or remove.
    func link(_ path: String, action: String, url: String?, id: String?, _ storage: StorageRef, _ ctx: MethodContext) async throws -> [StorageLink]
    /// `check` («Проверить» in the card); `free` in bytes with `freeSpace`.
    func check(_ storage: StorageRef, _ ctx: MethodContext) async throws -> (text: String?, free: Int?, account: String?)
    /// `signIn: browser` — the user pressed «Войти»: call `ctx.host.oauth(node: storage.node, …)`; the account's name.
    func signIn(_ storage: StorageRef, _ ctx: MethodContext) async throws -> String?
}

public extension StorageProvider {
    private func notDeclared(_ what: String) -> ExtensionError { ExtensionError("\(what): not supported by this storage", code: ErrorCode.methodNotFound) }
    func mkdir(_ path: String, _ storage: StorageRef, _ ctx: MethodContext) async throws { throw notDeclared("mkdir") }
    func rename(from: String, to: String, _ storage: StorageRef, _ ctx: MethodContext) async throws { throw notDeclared("rename") }
    func delete(_ path: String, recursive: Bool, _ storage: StorageRef, _ ctx: MethodContext) async throws { throw notDeclared("delete") }
    func link(_ path: String, action: String, url: String?, id: String?, _ storage: StorageRef, _ ctx: MethodContext) async throws -> [StorageLink] { throw notDeclared("link") }
    func check(_ storage: StorageRef, _ ctx: MethodContext) async throws -> (text: String?, free: Int?, account: String?) {
        let n = try await list("/", storage, ctx).count
        return (ctx.tr(["en": "Works: \(n) at the top", "ru": "Работает: наверху \(n)"]), nil, nil)
    }
    func signIn(_ storage: StorageRef, _ ctx: MethodContext) async throws -> String? { throw notDeclared("signIn") }
}

/// A source contribution: its hosts now, and the card's «Проверить».
public protocol SourceProvider: Sendable {
    func poll(_ source: SourceRef, _ ctx: MethodContext) async throws -> (hosts: [FoundHost], scope: String?)
    func check(_ source: SourceRef, _ ctx: MethodContext) async throws -> String
}

public extension SourceProvider {
    /// Polls and counts the hosts.
    func check(_ source: SourceRef, _ ctx: MethodContext) async throws -> String {
        let r = try await poll(source, ctx)
        return "\(r.hosts.count) host(s)\(r.scope.map { " · \($0)" } ?? "")"
    }
}

public extension Extension {
    /// Answers `storage/*` with `provider`.
    func storage(_ provider: some StorageProvider) {
        let ref: @Sendable (JSON) throws -> StorageRef = { p in try p["storage"].decode(StorageRef.self) }
        method("storage/list") { p, ctx in ["items": try JSON(encoding: try await provider.list(p["path"].string ?? "/", try ref(p), ctx))] }
        method("storage/stat") { p, ctx in ["item": try await provider.stat(p["path"].string ?? "/", try ref(p), ctx).map { try JSON(encoding: $0) } ?? .null] }
        method("storage/read") { p, ctx in
            let r = try await provider.read(p["path"].string ?? "/", offset: p["offset"].int ?? 0, length: p["length"].int ?? 1 << 20, try ref(p), ctx)
            return ["data": .string(r.data.base64EncodedString()), "eof": .bool(r.eof)]
        }
        method("storage/write/begin") { p, ctx in
            ["upload": .string(try await provider.writeBegin(p["path"].string ?? "/", size: p["size"].int ?? 0, modified: p["modified"].int, try ref(p), ctx))]
        }
        method("storage/write/chunk") { p, ctx in
            try await provider.writeChunk(p["upload"].text, offset: p["offset"].int ?? 0, data: Data(base64Encoded: p["data"].string ?? "") ?? Data(), try ref(p), ctx)
            return [:]
        }
        method("storage/write/commit") { p, ctx in try await provider.writeCommit(p["upload"].text, try ref(p), ctx); return [:] }
        method("storage/write/abort") { p, ctx in try await provider.writeAbort(p["upload"].text, try ref(p), ctx); return [:] }
        method("storage/mkdir") { p, ctx in try await provider.mkdir(p["path"].text, try ref(p), ctx); return [:] }
        method("storage/rename") { p, ctx in try await provider.rename(from: p["from"].text, to: p["to"].text, try ref(p), ctx); return [:] }
        method("storage/delete") { p, ctx in try await provider.delete(p["path"].text, recursive: p["recursive"].bool ?? false, try ref(p), ctx); return [:] }
        method("storage/link") { p, ctx in
            let links = try await provider.link(p["path"].text, action: p["action"].string ?? "list", url: p["url"].string, id: p["id"].string, try ref(p), ctx)
            if p["action"].string == "create", let first = links.first { return try JSON(encoding: first) }
            return p["action"].string == "remove" ? [:] : ["links": try JSON(encoding: links)]
        }
        method("storage/check") { p, ctx in
            let r = try await provider.check(try ref(p), ctx)
            return object([("text", r.text.map(JSON.string)), ("free", r.free.map { .number(Double($0)) }), ("account", r.account.map(JSON.string))])
        }
        method("storage/signIn") { p, ctx in object([("account", try await provider.signIn(try ref(p), ctx).map(JSON.string))]) }
    }

    /// Answers `source/poll` and `source/check` with `provider`.
    func source(_ provider: some SourceProvider) {
        method("source/poll") { p, ctx in
            let r = try await provider.poll(try p["source"].decode(SourceRef.self), ctx)
            return object([("hosts", try JSON(encoding: r.hosts)), ("scope", r.scope.map(JSON.string))])
        }
        method("source/check") { p, ctx in ["text": .string(try await provider.check(try p["source"].decode(SourceRef.self), ctx))] }
    }
}
