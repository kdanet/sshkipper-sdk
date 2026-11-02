import Foundation

// The database protocol (spec/database.md): what a driver of a `contributes.database` engine answers. One JSON object
// per line on stdin (requests) and stdout (responses), answered in any order — the id ties them together; logs go to
// stderr. Not JSON-RPC: the wire of the app's built-in driver; these types are the shapes of the `sql` model.
// `keyValue` and `document` engines answer the key browser's and a collection's methods (spec/database.md §4.1)
// with `on("redis.scan", JSON.self) { … }`.
//
//   request  {"id": 7, "method": "query", "params": {…}}
//   response {"id": 7, "result": {…}}   or   {"id": 7, "error": {"code": "query", "message": "…"}}

public enum DB {
    public static let protocolVersion = 1

    /// One engine in `hello`. The engine's descriptor (model, file, quotes) is the manifest's; these drive the screens.
    public struct EngineInfo: Codable, Sendable {
        public var engine: String
        public var title: String
        public var keywords: [String]
        public var functions: [String]
        public var identifierQuote: String
        public var supportsEditing: Bool
        public var supportsTransactions: Bool
        public var hasDatabases: Bool
        public init(engine: String, title: String, keywords: [String] = [], functions: [String] = [], identifierQuote: String = "\"",
                    supportsEditing: Bool = false, supportsTransactions: Bool = false, hasDatabases: Bool = false) {
            self.engine = engine; self.title = title; self.keywords = keywords; self.functions = functions; self.identifierQuote = identifierQuote
            self.supportsEditing = supportsEditing; self.supportsTransactions = supportsTransactions; self.hasDatabases = hasDatabases
        }
    }

    public struct PluginInfo: Codable, Sendable {
        public var protocolVersion: Int
        public var pluginVersion: String
        public var engines: [EngineInfo]
        /// `passwordBytes`: the password comes as `passwordBase64`.
        public var features: [String]?
        public init(pluginVersion: String, engines: [EngineInfo], features: [String]? = ["passwordBytes"]) {
            self.protocolVersion = DB.protocolVersion; self.pluginVersion = pluginVersion; self.engines = engines; self.features = features
        }
    }

    public struct ConnectParams: Codable, Sendable {
        public var engine: String
        /// Through a server: 127.0.0.1 and the port the app forwarded over SSH.
        public var host: String
        public var port: Int
        public var user: String?
        public var passwordBase64: String?
        public var password: String?
        public var database: String?
        /// `disabled`, `required`, `verifyIdentity`.
        public var tls: String
        public var timeoutSeconds: Double
        public var tlsServerName: String?
        /// A file engine: the absolute path on this Mac.
        public var path: String?
        /// The node is «Только чтение»: refuse writes where the engine can.
        public var readOnly: Bool?

        /// The password as text (from `passwordBase64` or `password`). Keep it no longer than needed.
        public var passwordText: String? {
            if let b = passwordBase64, let d = Data(base64Encoded: b) { return String(decoding: d, as: UTF8.self) }
            return password
        }
    }

    public struct Connect: Codable, Sendable { public var session: String; public var connection: ConnectParams }

    public struct SessionInfo: Codable, Sendable {
        public var serverVersion: String
        public var serverTitle: String
        public var database: String?
        public var readOnly: Bool?
        public var readOnlyReason: String?
        public init(serverVersion: String, serverTitle: String, database: String? = nil, readOnly: Bool? = nil, readOnlyReason: String? = nil) {
            self.serverVersion = serverVersion; self.serverTitle = serverTitle; self.database = database; self.readOnly = readOnly; self.readOnlyReason = readOnlyReason
        }
    }

    public struct SessionRef: Codable, Sendable { public var session: String }

    /// `kind`: text, integer, decimal, float, bool, date, datetime, time, json, binary, other.
    public struct Column: Codable, Sendable {
        public var name: String
        public var type: String
        public var kind: String
        public var table: String?
        public init(name: String, type: String = "text", kind: String = "text", table: String? = nil) { self.name = name; self.type = type; self.kind = kind; self.table = table }
    }

    public struct QueryResult: Codable, Sendable {
        public var columns: [Column]
        /// Values as text, nil for NULL; binary as "0x…" hex.
        public var rows: [[String?]]
        public var affectedRows: Int?
        public var lastInsertID: String?
        public var message: String?
        public var warnings: Int?
        public var truncated: Bool
        public var durationMs: Double
        public var inTransaction: Bool?
        public init(columns: [Column], rows: [[String?]], truncated: Bool = false, durationMs: Double = 0, affectedRows: Int? = nil, message: String? = nil) {
            self.columns = columns; self.rows = rows; self.truncated = truncated; self.durationMs = durationMs; self.affectedRows = affectedRows; self.message = message
        }
    }

    public struct Query: Codable, Sendable {
        public var session: String
        public var sql: String
        public var database: String?
        public var maxRows: Int
        public var queryID: String
        public var readOnly: Bool?
        public var isolated: Bool?
    }

    public struct Cancel: Codable, Sendable { public var session: String; public var queryID: String }

    public struct DatabaseInfo: Codable, Sendable {
        public var name: String
        public var isSystem: Bool
        public var tables: Int?
        public init(name: String, isSystem: Bool = false, tables: Int? = nil) { self.name = name; self.isSystem = isSystem; self.tables = tables }
    }

    public struct Objects: Codable, Sendable { public var session: String; public var database: String; public var offset: Int?; public var limit: Int?; public var filter: String? }

    /// `kind`: table, view, materializedView, dictionary, sequence, function, procedure, foreignTable, collection, other.
    public struct Object: Codable, Sendable {
        public var name: String
        public var kind: String
        public var rows: Int?
        public var size: Int?
        public var comment: String?
        public var schema: String?
        public init(name: String, kind: String = "table", rows: Int? = nil, size: Int? = nil, comment: String? = nil, schema: String? = nil) {
            self.name = name; self.kind = kind; self.rows = rows; self.size = size; self.comment = comment; self.schema = schema
        }
    }

    public struct StructureRequest: Codable, Sendable { public var session: String; public var database: String?; public var table: String; public var fresh: Bool? }

    public struct ColumnInfo: Codable, Sendable {
        public var name: String
        public var type: String
        public var kind: String
        public var nullable: Bool
        public var defaultValue: String?
        public var isPrimaryKey: Bool
        public var extra: String?
        public var comment: String?
        public init(name: String, type: String = "text", kind: String = "text", nullable: Bool = true, isPrimaryKey: Bool = false) {
            self.name = name; self.type = type; self.kind = kind; self.nullable = nullable; self.isPrimaryKey = isPrimaryKey
        }
    }
    public struct IndexInfo: Codable, Sendable { public var name: String; public var columns: [String]; public var unique: Bool; public var type: String? }
    public struct ForeignKeyInfo: Codable, Sendable {
        public var name: String; public var columns: [String]; public var referencedTable: String; public var referencedColumns: [String]
        public var onUpdate: String?; public var onDelete: String?
    }
    /// `unit`: count, bytes, seconds, unixTime.
    public struct InfoItem: Codable, Sendable {
        public var title: String; public var value: String; public var key: String?; public var number: Double?; public var unit: String?
        public init(title: String, value: String) { self.title = title; self.value = value }
    }

    public struct Structure: Codable, Sendable {
        public var columns: [ColumnInfo]
        public var indexes: [IndexInfo]
        public var foreignKeys: [ForeignKeyInfo]
        /// Columns that identify a row for editing; empty — the grid doesn't edit the table.
        public var primaryKey: [String]
        public var ddl: String?
        public var info: [InfoItem]
        public init(columns: [ColumnInfo], primaryKey: [String] = [], indexes: [IndexInfo] = [], foreignKeys: [ForeignKeyInfo] = [], ddl: String? = nil, info: [InfoItem] = []) {
            self.columns = columns; self.primaryKey = primaryKey; self.indexes = indexes; self.foreignKeys = foreignKeys; self.ddl = ddl; self.info = info
        }
    }

    /// `op`: equals, notEquals, greater, greaterOrEqual, less, lessOrEqual, contains, notContains, startsWith, endsWith,
    /// isNull, isNotNull, isEmpty, isNotEmpty, inList.
    public struct Filter: Codable, Sendable { public var column: String?; public var op: String; public var value: String; public var enabled: Bool }
    public struct Order: Codable, Sendable { public var column: String; public var ascending: Bool }

    public struct TableRequest: Codable, Sendable {
        public var database: String?
        public var table: String
        public var filters: [Filter]
        public var matchAll: Bool
        /// A condition the app already checked (one read, no `;`, no comments), ANDed with the filters.
        public var rawWhere: String?
        public var orderBy: [Order]
        public var limit: Int
        public var offset: Int
        public var countTotal: Bool
        public var cellBytes: Int?
    }
    public struct TableDataRequest: Codable, Sendable { public var session: String; public var request: TableRequest; public var queryID: String }
    public struct TableData: Codable, Sendable {
        public var result: QueryResult; public var primaryKey: [String]; public var totalRows: Int?; public var sql: String
        public init(result: QueryResult, primaryKey: [String] = [], totalRows: Int? = nil, sql: String) { self.result = result; self.primaryKey = primaryKey; self.totalRows = totalRows; self.sql = sql }
    }

    public struct CellValue: Codable, Sendable { public var text: String?; public var isDefault: Bool }
    public struct ColumnValue: Codable, Sendable { public var column: String; public var value: CellValue }
    /// `kind`: update, insert, delete.
    public struct RowChange: Codable, Sendable { public var kind: String; public var key: [ColumnValue]; public var values: [ColumnValue] }
    public struct ApplyChanges: Codable, Sendable { public var session: String; public var database: String?; public var table: String; public var changes: [RowChange]; public var dryRun: Bool }
    public struct ApplyResult: Codable, Sendable { public var statements: [String]; public var affectedRows: Int; public init(statements: [String], affectedRows: Int) { self.statements = statements; self.affectedRows = affectedRows } }

    public struct Empty: Codable, Sendable { public init() {} }

    /// A failure the app shows as is. `code`: auth, connection, query, cancelled, unsupported, notConnected,
    /// invalidRequest, internalError.
    public struct Failure: Error, Sendable {
        public var code: String
        public var message: String
        public var serverCode: String?
        public var appliedChanges: Int?
        public init(_ code: String, _ message: String, serverCode: String? = nil, appliedChanges: Int? = nil) {
            self.code = code; self.message = message; self.serverCode = serverCode; self.appliedChanges = appliedChanges
        }
    }
}

/// Answers the app's database requests until stdin closes (the app stops a driver by closing it). Requests run
/// concurrently: a `cancel` arrives while the `query` it names is still running.
public final class DatabaseDriver: @unchecked Sendable {
    private let lock = NSLock()
    private var handlers: [String: @Sendable (JSON) async throws -> JSON] = [:]

    public init() {}

    /// The answer to `method` (`hello`, `connect`, `query`, `tableData`…), its params decoded as `P`.
    public func on<P: Decodable & Sendable, R: Encodable & Sendable>(_ method: String, _ params: P.Type = P.self,
                                                                    _ fn: @escaping @Sendable (P) async throws -> R) {
        lock.withLock { handlers[method] = { try JSON(encoding: try await fn(try $0.decode(P.self))) } }
    }

    public func run(transport: Transport = StdioTransport()) async {
        await withTaskGroup(of: Void.self) { group in
            for await line in transport.lines() {
                guard let req = try? JSON.parse(line) else {
                    transport.write(#"{"id":-1,"error":{"code":"invalidRequest","message":"not JSON"}}"#)
                    continue
                }
                let id = req["id"].int ?? -1
                let method = req["method"].text
                let fn = lock.withLock { handlers[method] }
                let params = req["params"].isNull ? JSON.object([:]) : req["params"]
                group.addTask {
                    // "id" first: the app finds a response's caller from the start of the line.
                    do {
                        guard let fn else { throw DB.Failure("unsupported", "\(method): not supported by this driver") }
                        transport.write("{\"id\":\(id),\"result\":\(try (try await fn(params)).encoded())}")
                    } catch {
                        let f = error as? DB.Failure ?? DB.Failure(error is DecodingError ? "invalidRequest" : "internalError", Extension.message(error))
                        let body = object([("code", .string(f.code)), ("message", .string(f.message)), ("serverCode", f.serverCode.map(JSON.string)),
                                           ("appliedChanges", f.appliedChanges.map { .number(Double($0)) })])
                        transport.write("{\"id\":\(id),\"error\":\((try? body.encoded()) ?? "{}")}")
                    }
                }
            }
        }
    }
}
