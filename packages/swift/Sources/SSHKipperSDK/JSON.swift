import Foundation

/// Any JSON value: what handlers take and return, the params of methods, views and ops.
public enum JSON: Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])
}

extension JSON: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSON].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSON].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            // Whole numbers as integers: 3, not 3.0 — what a JSON reader on the other side expects of a count.
            if n.rounded() == n, abs(n) < 9.0e15 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

extension JSON: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
    ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSON...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSON)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
}

public extension JSON {
    subscript(key: String) -> JSON {
        get { if case .object(let o) = self { return o[key] ?? .null }; return .null }
        set {
            var o: [String: JSON] = [:]
            if case .object(let old) = self { o = old }
            o[key] = newValue
            self = .object(o)
        }
    }

    subscript(index: Int) -> JSON {
        if case .array(let a) = self, a.indices.contains(index) { return a[index] }
        return .null
    }

    var isNull: Bool { self == .null }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var double: Double? { if case .number(let n) = self { return n }; return nil }
    var int: Int? { double.flatMap { $0.rounded() == $0 && abs($0) < 9.0e15 ? Int($0) : nil } }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    var array: [JSON]? { if case .array(let a) = self { return a }; return nil }
    var object: [String: JSON]? { if case .object(let o) = self { return o }; return nil }

    /// The value as text the way a person reads it: a string as is, numbers and booleans printed, others as JSON.
    var text: String {
        switch self {
        case .string(let s): return s
        case .null: return ""
        case .number(let n): return n.rounded() == n && abs(n) < 9.0e15 ? String(Int64(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        default: return (try? encoded()) ?? ""
        }
    }

    /// Any `Encodable` as JSON (a struct of the SDK's types, a dictionary…).
    init(encoding value: some Encodable) throws {
        let data = try JSONEncoder().encode(value)
        self = try JSONDecoder().decode(JSON.self, from: data)
    }

    /// The value as a `Decodable` type.
    func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }

    /// One line of JSON (keys sorted, `/` not escaped).
    func encoded() throws -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try e.encode(self), as: UTF8.self)
    }

    /// Parses JSON text.
    static func parse(_ text: String) throws -> JSON {
        try JSONDecoder().decode(JSON.self, from: Data(text.utf8))
    }
}

/// Builds an object from optional fields: the `nil` ones are left out.
func object(_ pairs: [(String, JSON?)]) -> JSON {
    var o: [String: JSON] = [:]
    for (k, v) in pairs { if let v { o[k] = v } }
    return .object(o)
}
