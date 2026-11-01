// Types of the SSHKipper module SDK 1. They mirror schemas/module.schema.json and schemas/view.schema.json and
// spec/protocol.md; the JSON Schemas are normative, these are for editors and type checks.

/** Any JSON value. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A string, or one per language: { ru: "Очереди", en: "Queues" }. */
export type Text = string | { [lang: string]: string };

/** Palette names follow the light and dark themes; #RRGGBB is taken as is. */
export type Color =
  | "blue" | "green" | "orange" | "red" | "yellow" | "purple" | "pink" | "teal" | "indigo" | "cyan" | "mint" | "brown" | "gray"
  | `#${string}`;

export type Risk = "read" | "change" | "danger";
export type Permission = "exec" | "sudo" | "secrets" | "network" | "store" | "notify" | "forward" | "oauth";

export interface Setting {
  key: string;
  title: Text;
  help?: Text;
  type: "text" | "number" | "bool" | "choice" | "secret" | "path" | "list";
  default?: Json;
  choices?: { value: string; title: Text }[];
  placeholder?: string;
}

export interface Param {
  key: string;
  title: Text;
  type: "text" | "number" | "bool" | "choice";
  default?: Json;
  required?: boolean;
  choices?: string[];
  /** A regular expression the value must match — a must for text that reaches shell scripts. */
  pattern?: string;
}

export interface Handler {
  /** Server runtime: a file of the module run with sh on the server. */
  script?: string;
  timeout?: number;
  sudo?: "never" | "auto" | "required";
  output?: "json" | "text" | "lines";
}

export interface Page {
  id: string;
  title: Text;
  /** A view template file (view.schema.json). */
  view?: string;
  /** Template variables from handlers: { units: "list_units" } makes data.units. */
  data?: Record<string, string>;
  /** A handler returning the whole view (process modules). */
  render?: string;
  refresh?: number;
}

export interface Action {
  id: string;
  title: Text;
  symbol?: string;
  handler: string;
  risk: Risk;
  on?: "service" | "item";
  confirm?: Text;
  params?: Param[];
}

export interface Tool {
  name: string;
  /** For people: the confirmation of a call names the tool by it (the model reads `description`). */
  title?: Text;
  description: string;
  handler: string;
  risk: Risk;
  params?: Param[];
}

export interface AutomationBlock {
  id: string;
  title: Text;
  description?: Text;
  symbol?: string;
  handler: string;
  risk: Risk;
  params?: Param[];
  returns?: "none" | "text" | "number" | "list" | "json";
}

export interface Manifest {
  $schema?: string;
  sdk: 1;
  id: string;
  version: string;
  title: Text;
  description?: Text;
  author?: { name: string; url?: string };
  license?: string;
  homepage?: string;
  icon?: { symbol: string; color?: Color };
  runtime: { kind: "server" } | { kind: "process"; command: string[]; env?: Record<string, string> };
  permissions?: Permission[];
  settings?: Setting[];
  service?: {
    detect?: string;
    summary?: string;
    page?: string;
    tree?: { handler: string; page?: string };
    containers?: boolean;
  };
  pages?: Page[];
  handlers?: Record<string, Handler>;
  actions?: Action[];
  tools?: Tool[];
  automation?: AutomationBlock[];
  components?: Record<string, Node>;
  /** An extension's contributions (sshkipper-extension.json; spec/protocol.md §10). `service`, `tools` and
   * `automation` may be written here instead of at the top level — not in both places. */
  contributes?: Contributes;
}

// MARK: Extensions (spec/protocol.md §10)

export type ContributionKind = "service" | "tools" | "automation" | "database" | "storage" | "source" | "nodeType" | "screen" | "import" | "console" | "ai";

interface Contribution { id: string; title: Text; icon?: { symbol: string; color?: Color } }

export interface DatabaseContribution extends Contribution {
  description?: Text;
  /** "si:<slug>" of a logo bundled with the app. */
  logo?: string;
  model: "sql" | "keyValue" | "document";
  defaultPort?: number;
  isFile?: boolean;
  hasSchemas?: boolean;
  hasEditorTransactions?: boolean;
  identifierQuote?: string;
  keywords?: string[];
  functions?: string[];
  /** Its own program speaking the database protocol; else the extension's runtime. */
  command?: string[];
}
export interface StorageContribution extends Contribution {
  description?: Text;
  signIn?: "keys" | "login" | "browser" | "none";
  fields?: Setting[];
  capabilities?: string[];
}
export interface SourceContribution extends Contribution { description?: Text; fields?: Setting[]; refresh?: number }
export interface NodeTypeContribution extends Contribution { description?: Text; fields?: Setting[]; screen?: string }
export interface ScreenContribution extends Contribution { placement: "tab" | "section" | "panel"; render: string }
export interface ImportContribution extends Contribution { fileExtensions: string[]; handler: string }
export interface HandlerContribution extends Contribution { handler: string }

export interface Contributes {
  service?: Manifest["service"];
  tools?: Tool[];
  automation?: AutomationBlock[];
  database?: DatabaseContribution[];
  storage?: StorageContribution[];
  source?: SourceContribution[];
  nodeType?: NodeTypeContribution[];
  screen?: ScreenContribution[];
  import?: ImportContribution[];
  console?: HandlerContribution[];
  ai?: HandlerContribution[];
}

// MARK: Views (UI-Kit)

export type Tone = "plain" | "secondary" | "good" | "warning" | "attention" | "bad" | "accent" | "info";
export type Status = "ok" | "warn" | "bad" | "off" | "info";

export interface Style {
  tone?: Tone;
  color?: Color;
  background?: Color | "card" | "well" | "none";
  font?: "title" | "headline" | "body" | "callout" | "caption" | "mono";
  weight?: "regular" | "medium" | "semibold" | "bold";
  padding?: number;
  radius?: number;
  align?: "leading" | "center" | "trailing";
  width?: number;
  grow?: boolean;
}

/** What a button, a row click or a message's button does. */
export interface ViewAction {
  /** A module action id; the row's item and params go with it. */
  run?: string;
  params?: Record<string, Json>;
  refresh?: boolean;
  /** A page of the module; the row's item goes as `item`. */
  page?: string;
  /** State changes; "= expr" — a formula. */
  set?: Record<string, string | number | boolean>;
  /** An app link: node:<id>, docker:<server>… */
  open?: string;
  /** A question for the AI panel. */
  ask?: string;
  /** A live screen: a `press` event with this name (and `params`) goes to the program. */
  event?: string;
  /** A live screen: opens its sheet block of this id. */
  sheet?: string;
}

export interface Item {
  id?: string;
  title?: string;
  detail?: string;
  status?: Status | string;
  symbol?: string;
  badge?: string;
  badgeTone?: Tone;
  trailing?: string;
  /** Module action ids in the row's menu (on: "item"). */
  actions?: string[];
  action?: ViewAction;
  /** The item actions get (defaults to the row). */
  data?: Record<string, Json>;
  time?: string;
  done?: boolean;
  ref?: string;
}

export type BlockType =
  | "text" | "stack" | "grid" | "tabs" | "card" | "divider"
  | "metric" | "gauge" | "chart" | "table" | "list" | "keyvalue" | "timeline" | "checklist" | "code" | "diff" | "callout"
  | "rows" | "logs" | "chips" | "message" | "search"
  | "slider" | "field" | "toggle" | "picker" | "button"
  // A live screen's own (spec/protocol.md §11).
  | "datatable" | "tree" | "split" | "editor" | "terminal" | "toolbar" | "sheet";

/** A column of a datatable. */
export interface Column {
  id: string;
  title?: string;
  width?: number;
  kind?: "text" | "number" | "date";
  sortable?: boolean;
  /** A double click edits the cell: an `edit` event. */
  editable?: boolean;
}

/** A row of a datatable: cells in column order, or `values` by column id. */
export interface Row {
  id?: string | number;
  cells?: (string | number | boolean | null)[];
  values?: Record<string, string | number | boolean | null>;
  status?: Status;
  data?: Record<string, Json>;
}

/** A node of a tree; `expandable` without `children` — they are asked for when it is expanded. */
export interface TreeNode {
  id: string;
  title: string;
  detail?: string;
  symbol?: string;
  status?: Status;
  badge?: string;
  children?: TreeNode[];
  expandable?: boolean;
  data?: Record<string, Json>;
}

export interface MenuItem { id: string; title: string; symbol?: string; danger?: boolean }

export interface Block {
  type: BlockType;
  id?: string;
  title?: string;
  subtitle?: string;
  text?: string;
  symbol?: string;
  status?: Status | string;
  axis?: "vertical" | "horizontal";
  /** grid: how many columns; datatable: the columns. */
  columns?: number | (string | Column)[];
  children?: Node[];
  value?: number | string;
  max?: number | string;
  unit?: string;
  delta?: string;
  chart?: "line" | "bar" | "area" | "pie";
  /** `null` in values is a gap: the line breaks there. */
  series?: { name?: string; values?: (number | null)[]; formula?: string; points?: number }[];
  labels?: string[];
  headers?: string[];
  rows?: ((string | number | boolean | null)[] | Row)[];
  // A live screen's blocks.
  total?: number;
  pageSize?: number;
  sort?: { column: string; ascending?: boolean };
  selection?: "none" | "single" | "multiple";
  menu?: MenuItem[];
  draggable?: boolean;
  drop?: ("files" | "rows")[];
  nodes?: TreeNode[];
  sizes?: number[];
  completion?: boolean;
  editable?: boolean;
  keywords?: string[];
  maxLines?: number;
  window?: number;
  items?: (Item | Node)[];
  lines?: string[];
  language?: string;
  before?: string;
  after?: string;
  bind?: string;
  min?: number;
  step?: number;
  options?: { title: string; value: string | number | boolean }[];
  action?: ViewAction;
  visible?: string;
  height?: number;
  style?: Style;
}

/** A block, or a template node the app expands: each / if / use. */
export type Node =
  | Block
  | { each: string; as?: string; where?: string; limit?: number; block: Node | Item }
  | { if: string; block: Node | Item; else?: Node | Item }
  | { use: string; props?: Record<string, Json> };

export interface View {
  $schema?: string;
  title?: string;
  /** The sentence under the page title, in parts. */
  status?: { text: string; tone?: Tone }[];
  state?: Record<string, string | number | boolean>;
  /** A live screen: true — the program answers its events (`ui/event`); a handler's name — a server module's. */
  events?: boolean | string;
  /** fill: the screen takes the whole area. */
  layout?: "fill";
  blocks: Node[];
}

// MARK: Live screens (spec/protocol.md §11)

export type EventType =
  | "open" | "close" | "press" | "activate" | "select" | "change" | "submit" | "expand" | "collapse"
  | "more" | "sort" | "edit" | "menu" | "drop" | "move" | "complete";

/** What the user did on a screen. `state` — the screen's variables now. */
export interface ScreenEvent {
  screen: string;
  seq: number;
  type: EventType;
  block?: string;
  value?: Json;
  state?: Record<string, string | number | boolean>;
}

/** One change of a screen by block id (`ui/patch`). */
export interface Op {
  op: "replace" | "insert" | "remove" | "set" | "state" | "title" | "rows" | "update_rows" | "insert_rows" | "remove_rows"
    | "children" | "append" | "clear" | "text" | "select" | "sheet" | "close_sheet" | "notice";
  id?: string;
  parent?: string;
  index?: number;
  after?: string;
  block?: Block;
  props?: Record<string, Json>;
  values?: Record<string, string | number | boolean>;
  text?: string;
  status?: Status;
  offset?: number;
  total?: number;
  reset?: boolean;
  rows?: ((string | number | boolean | null)[] | Row)[];
  ids?: string[];
  node?: string;
  nodes?: TreeNode[];
  lines?: string[];
  points?: (number | null)[][];
  labels?: string[];
}

export interface Completion { title: string; insert?: string; detail?: string }

/** What `ui/event` answers: ops, or ops and completions (for `complete`). */
export type EventAnswer = Op[] | { ops?: Op[]; items?: (string | Completion)[] } | null | void;

// MARK: Calls (spec/protocol.md §2)

export interface Server {
  id: string;
  name: string;
  host: string;
  user?: string;
}

export interface Context {
  server?: Server;
  container?: string;
  settings: Record<string, Json>;
  item?: Json;
  locale: string;
  sdk: 1;
  app: string;
}

export interface Request {
  handler: string;
  input: Record<string, Json>;
  context: Context;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
