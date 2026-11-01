import Foundation

// UI-Kit builders: functions returning the JSON the app draws natively (schemas/view.schema.json). Nothing here
// draws — the app does, with its own parts. Fields the helpers don't name go in `extra`.

public enum UI {
    /// A page or a screen. `status` — the sentence under the title in parts; `events: true` — a live screen whose events
    /// the program answers (§11); `fill` — the screen takes the whole area.
    public static func view(_ blocks: [JSON], title: String? = nil, status: [String] = [], state: [String: JSON]? = nil,
                            events: Bool = false, fill: Bool = false) -> JSON {
        object([
            ("title", title.map(JSON.string)),
            ("status", status.isEmpty ? nil : .array(status.map { ["text": .string($0)] })),
            ("state", state.map(JSON.object)),
            ("events", events ? true : nil),
            ("layout", fill ? "fill" : nil),
            ("blocks", .array(blocks)),
        ])
    }

    /// A live screen: a view whose events the program answers.
    public static func screen(_ blocks: [JSON], title: String? = nil, state: [String: JSON]? = nil, fill: Bool = false) -> JSON {
        view(blocks, title: title, state: state, events: true, fill: fill)
    }

    static func block(_ type: String, _ fields: [(String, JSON?)], _ extra: [String: JSON]) -> JSON {
        var j = object([("type", .string(type))] + fields)
        for (k, v) in extra { j[k] = v }
        return j
    }

    // MARK: Layout

    public static func vstack(_ children: [JSON], title: String? = nil, id: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        block("stack", [("axis", "vertical"), ("children", .array(children)), ("title", title.map(JSON.string)), ("id", id.map(JSON.string))], extra)
    }
    public static func hstack(_ children: [JSON], id: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        block("stack", [("axis", "horizontal"), ("children", .array(children)), ("id", id.map(JSON.string))], extra)
    }
    public static func grid(_ children: [JSON], columns: Int = 2, id: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        block("grid", [("columns", .number(Double(columns))), ("children", .array(children)), ("id", id.map(JSON.string))], extra)
    }
    public static func card(_ title: String, _ children: [JSON], symbol: String? = nil, id: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        block("card", [("title", .string(title)), ("children", .array(children)), ("symbol", symbol.map(JSON.string)), ("id", id.map(JSON.string))], extra)
    }
    public static func tabs(_ children: [JSON], id: String? = nil) -> JSON { block("tabs", [("children", .array(children)), ("id", id.map(JSON.string))], [:]) }
    public static func divider() -> JSON { ["type": "divider"] }

    // MARK: Content

    public static func text(_ markdown: String, title: String? = nil, id: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        block("text", [("text", .string(markdown)), ("title", title.map(JSON.string)), ("id", id.map(JSON.string))], extra)
    }
    public static func metric(_ title: String, _ value: JSON, unit: String? = nil, status: String? = nil, delta: String? = nil, id: String? = nil,
                              extra: [String: JSON] = [:]) -> JSON {
        block("metric", [("title", .string(title)), ("value", value), ("unit", unit.map(JSON.string)), ("status", status.map(JSON.string)),
                         ("delta", delta.map(JSON.string)), ("id", id.map(JSON.string))], extra)
    }
    public static func gauge(_ title: String, _ value: Double, max: Double = 100, unit: String? = nil, id: String? = nil) -> JSON {
        block("gauge", [("title", .string(title)), ("value", .number(value)), ("max", .number(max)), ("unit", unit.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    /// `kind`: line, bar, area, pie. Series: name and values (`nil` — a gap).
    public static func chart(_ kind: String, _ series: [(name: String, values: [Double?])], title: String? = nil, labels: [String]? = nil,
                             unit: String? = nil, id: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        let s: [JSON] = series.map { ["name": .string($0.name), "values": .array($0.values.map { $0.map(JSON.number) ?? .null })] }
        return block("chart", [("chart", .string(kind)), ("series", .array(s)), ("title", title.map(JSON.string)), ("labels", labels.map { .array($0.map(JSON.string)) }),
                               ("unit", unit.map(JSON.string)), ("id", id.map(JSON.string))], extra)
    }
    /// A chart the program appends points to (`Op.append(id, points:)`); `window` — points kept.
    public static func liveChart(_ kind: String, series: [String], id: String, title: String? = nil, unit: String? = nil, window: Int = 300,
                                 height: Double? = nil) -> JSON {
        block("chart", [("chart", .string(kind)), ("series", .array(series.map { ["name": .string($0), "values": []] })), ("id", .string(id)),
                        ("title", title.map(JSON.string)), ("unit", unit.map(JSON.string)), ("window", .number(Double(window))), ("height", height.map(JSON.number))], [:])
    }
    public static func table(_ headers: [String], _ rows: [[JSON]], title: String? = nil, id: String? = nil) -> JSON {
        block("table", [("headers", .array(headers.map(JSON.string))), ("rows", .array(rows.map(JSON.array))), ("title", title.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    public static func keyvalue(_ pairs: [(String, String)], title: String? = nil, id: String? = nil) -> JSON {
        block("keyvalue", [("items", .array(pairs.map { ["title": .string($0.0), "detail": .string($0.1)] })), ("title", title.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    public static func code(_ source: String, language: String? = nil, title: String? = nil, id: String? = nil) -> JSON {
        block("code", [("text", .string(source)), ("language", language.map(JSON.string)), ("title", title.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    /// `status`: info, ok, warn, bad.
    public static func callout(_ status: String, _ title: String, text: String? = nil, id: String? = nil) -> JSON {
        block("callout", [("status", .string(status)), ("title", .string(title)), ("text", text.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }

    // MARK: Service-page blocks

    /// One row: a status dot, title and detail, trailing text, a badge, a menu of module `actions`, a click `action`.
    public static func row(_ title: String, id: String? = nil, detail: String? = nil, status: String? = nil, symbol: String? = nil,
                           trailing: String? = nil, badge: String? = nil, actions: [String]? = nil, action: JSON? = nil) -> JSON {
        object([("title", .string(title)), ("id", id.map(JSON.string)), ("detail", detail.map(JSON.string)), ("status", status.map(JSON.string)),
                ("symbol", symbol.map(JSON.string)), ("trailing", trailing.map(JSON.string)), ("badge", badge.map(JSON.string)),
                ("actions", actions.map { .array($0.map(JSON.string)) }), ("action", action)])
    }
    public static func rows(_ items: [JSON], title: String? = nil, empty: String? = nil, bind: String? = nil, id: String? = nil) -> JSON {
        block("rows", [("items", .array(items)), ("title", title.map(JSON.string)), ("text", empty.map(JSON.string)), ("bind", bind.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    public static func logs(_ lines: [String], title: String? = nil, id: String? = nil) -> JSON {
        block("logs", [("lines", .array(lines.map(JSON.string))), ("title", title.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    public static func chips(_ labels: [String], id: String? = nil) -> JSON {
        block("chips", [("items", .array(labels.map { ["title": .string($0)] })), ("id", id.map(JSON.string))], [:])
    }
    /// An empty or failed state, with a button doing `action`.
    public static func message(_ symbol: String, _ title: String, text: String? = nil, button: String? = nil, action: JSON? = nil, id: String? = nil) -> JSON {
        block("message", [("symbol", .string(symbol)), ("title", .string(title)), ("text", text.map(JSON.string)), ("subtitle", button.map(JSON.string)),
                          ("action", action), ("id", id.map(JSON.string))], [:])
    }
    public static func search(_ bind: String, placeholder: String? = nil) -> JSON {
        block("search", [("bind", .string(bind)), ("subtitle", placeholder.map(JSON.string))], [:])
    }

    // MARK: Inputs

    public static func button(_ title: String, action: JSON, symbol: String? = nil, danger: Bool = false, id: String? = nil) -> JSON {
        block("button", [("title", .string(title)), ("action", action), ("symbol", symbol.map(JSON.string)), ("status", danger ? "bad" : nil), ("id", id.map(JSON.string))], [:])
    }
    public static func field(_ bind: String, _ title: String, placeholder: String? = nil, id: String? = nil) -> JSON {
        block("field", [("bind", .string(bind)), ("title", .string(title)), ("subtitle", placeholder.map(JSON.string)), ("id", id.map(JSON.string))], [:])
    }
    public static func toggle(_ bind: String, _ title: String, id: String? = nil) -> JSON {
        block("toggle", [("bind", .string(bind)), ("title", .string(title)), ("id", id.map(JSON.string))], [:])
    }
    public static func picker(_ bind: String, _ title: String, options: [(title: String, value: JSON)], id: String? = nil) -> JSON {
        block("picker", [("bind", .string(bind)), ("title", .string(title)), ("options", .array(options.map { ["title": .string($0.title), "value": $0.value] })), ("id", id.map(JSON.string))], [:])
    }

    /// What a button does: a module action, a live screen's event, a sheet, a refresh.
    public enum Do {
        public static func run(_ action: String, params: [String: JSON]? = nil) -> JSON { object([("run", .string(action)), ("params", params.map(JSON.object))]) }
        public static func event(_ name: String, params: [String: JSON]? = nil) -> JSON { object([("event", .string(name)), ("params", params.map(JSON.object))]) }
        public static func sheet(_ id: String) -> JSON { ["sheet": .string(id)] }
        public static func page(_ id: String) -> JSON { ["page": .string(id)] }
        public static let refresh: JSON = ["refresh": true]
    }

    // MARK: A live screen's own (§11.2)

    /// A column of a datatable: `kind` text, number or date.
    public static func column(_ id: String, title: String? = nil, kind: String? = nil, width: Double? = nil, sortable: Bool? = nil, editable: Bool? = nil) -> JSON {
        object([("id", .string(id)), ("title", title.map(JSON.string)), ("kind", kind.map(JSON.string)), ("width", width.map(JSON.number)),
                ("sortable", sortable.map(JSON.bool)), ("editable", editable.map(JSON.bool))])
    }
    /// A row of a datatable: cells in column order.
    public static func tableRow(_ id: String, _ cells: [JSON], status: String? = nil) -> JSON {
        object([("id", .string(id)), ("cells", .array(cells)), ("status", status.map(JSON.string))])
    }
    /// Many rows: the first here, the rest asked for with `more` events (answer with `Op.rows`).
    public static func datatable(_ columns: [JSON], rows: [JSON], id: String, total: Int? = nil, selection: String? = nil,
                                 menu: [(id: String, title: String)] = [], extra: [String: JSON] = [:]) -> JSON {
        block("datatable", [("id", .string(id)), ("columns", .array(columns)), ("rows", .array(rows)), ("total", total.map { .number(Double($0)) }),
                            ("selection", selection.map(JSON.string)), ("menu", menu.isEmpty ? nil : .array(menu.map { ["id": .string($0.id), "title": .string($0.title)] }))], extra)
    }
    /// A tree node; `expandable` without `children` — they are asked for (`expand`, answer with `Op.children`).
    public static func node(_ id: String, _ title: String, detail: String? = nil, status: String? = nil, children: [JSON]? = nil, expandable: Bool = false) -> JSON {
        object([("id", .string(id)), ("title", .string(title)), ("detail", detail.map(JSON.string)), ("status", status.map(JSON.string)),
                ("children", children.map(JSON.array)), ("expandable", expandable ? true : nil)])
    }
    public static func tree(_ nodes: [JSON], id: String, title: String? = nil, extra: [String: JSON] = [:]) -> JSON {
        block("tree", [("id", .string(id)), ("nodes", .array(nodes)), ("title", title.map(JSON.string))], extra)
    }
    /// Two or three panes; `sizes` — widths of all but the last, points (the user's are remembered).
    public static func split(_ panes: [JSON], sizes: [Double]? = nil, id: String? = nil) -> JSON {
        block("split", [("children", .array(panes)), ("sizes", sizes.map { .array($0.map(JSON.number)) }), ("id", id.map(JSON.string))], [:])
    }
    public static func editor(_ source: String, id: String, language: String? = nil, completion: Bool = false, title: String? = nil) -> JSON {
        block("editor", [("id", .string(id)), ("text", .string(source)), ("language", language.map(JSON.string)), ("completion", completion ? true : nil), ("title", title.map(JSON.string))], [:])
    }
    /// Output as it comes (ANSI colors kept); append with `Op.append(id, text:)`.
    public static func terminal(_ output: String, id: String, title: String? = nil) -> JSON {
        block("terminal", [("id", .string(id)), ("text", .string(output)), ("title", title.map(JSON.string))], [:])
    }
    /// Buttons with symbols: each press is a `press` event with `{item}`.
    public static func toolbar(_ items: [(id: String, title: String, symbol: String?)], id: String? = nil) -> JSON {
        block("toolbar", [("items", .array(items.map { object([("id", .string($0.id)), ("title", .string($0.title)), ("symbol", $0.symbol.map(JSON.string))]) })), ("id", id.map(JSON.string))], [:])
    }
    /// A form shown as a sheet (`UI.Do.sheet(id)` or `Op.sheet(id)`); OK sends `submit` with its fields' values.
    public static func sheet(_ id: String, _ title: String, fields: [JSON], ok: String? = nil) -> JSON {
        block("sheet", [("id", .string(id)), ("title", .string(title)), ("children", .array(fields)), ("subtitle", ok.map(JSON.string))], [:])
    }
}

/// Ops of `ui/patch` (§11.4): what an event's answer, or a push, changes — by block id.
public enum Op {
    public static func replace(_ id: String, _ block: JSON) -> JSON { ["op": "replace", "id": .string(id), "block": block] }
    public static func insert(_ block: JSON, parent: String? = nil, index: Int? = nil, after: String? = nil) -> JSON {
        object([("op", "insert"), ("block", block), ("parent", parent.map(JSON.string)), ("index", index.map { .number(Double($0)) }), ("after", after.map(JSON.string))])
    }
    public static func remove(_ id: String) -> JSON { ["op": "remove", "id": .string(id)] }
    public static func set(_ id: String, _ props: [String: JSON]) -> JSON { ["op": "set", "id": .string(id), "props": .object(props)] }
    public static func state(_ values: [String: JSON]) -> JSON { ["op": "state", "values": .object(values)] }
    public static func title(_ text: String) -> JSON { ["op": "title", "text": .string(text)] }
    /// A page of rows at `offset`; `reset` forgets the others (a new sort or filter).
    public static func rows(_ id: String, offset: Int, _ rows: [JSON], total: Int? = nil, reset: Bool = false) -> JSON {
        object([("op", "rows"), ("id", .string(id)), ("offset", .number(Double(offset))), ("rows", .array(rows)), ("total", total.map { .number(Double($0)) }), ("reset", reset ? true : nil)])
    }
    public static func updateRows(_ id: String, _ rows: [JSON]) -> JSON { ["op": "update_rows", "id": .string(id), "rows": .array(rows)] }
    public static func insertRows(_ id: String, index: Int, _ rows: [JSON]) -> JSON { ["op": "insert_rows", "id": .string(id), "index": .number(Double(index)), "rows": .array(rows)] }
    public static func removeRows(_ id: String, _ ids: [String]) -> JSON { ["op": "remove_rows", "id": .string(id), "ids": .array(ids.map(JSON.string))] }
    /// The children of `node` (nil — the tree's top level).
    public static func children(_ id: String, node: String?, _ nodes: [JSON]) -> JSON {
        object([("op", "children"), ("id", .string(id)), ("node", node.map(JSON.string)), ("nodes", .array(nodes))])
    }
    /// Text to a terminal, lines to a logs block, or points (one value per series each) to a live chart.
    public static func append(_ id: String, text: String? = nil, lines: [String]? = nil, points: [[Double?]]? = nil, labels: [String]? = nil) -> JSON {
        object([("op", "append"), ("id", .string(id)), ("text", text.map(JSON.string)), ("lines", lines.map { .array($0.map(JSON.string)) }),
                ("points", points.map { .array($0.map { .array($0.map { $0.map(JSON.number) ?? .null }) }) }), ("labels", labels.map { .array($0.map(JSON.string)) })])
    }
    public static func clear(_ id: String) -> JSON { ["op": "clear", "id": .string(id)] }
    public static func text(_ id: String, _ text: String) -> JSON { ["op": "text", "id": .string(id), "text": .string(text)] }
    public static func select(_ id: String, _ ids: [String]) -> JSON { ["op": "select", "id": .string(id), "ids": .array(ids.map(JSON.string))] }
    public static func sheet(_ id: String) -> JSON { ["op": "sheet", "id": .string(id)] }
    public static let closeSheet: JSON = ["op": "close_sheet"]
    /// A note over the screen; an empty text removes it.
    public static func notice(_ text: String, status: String? = nil) -> JSON { object([("op", "notice"), ("text", .string(text)), ("status", status.map(JSON.string))]) }
}

/// The text for the call's language: `tr(ctx.locale, ["ru": "Готово", "en": "Done"])`.
public func tr(_ locale: String, _ texts: [String: String]) -> String {
    LocalizedText.byLanguage(texts).text(locale)
}
