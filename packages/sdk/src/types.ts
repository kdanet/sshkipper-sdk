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
export type Permission = "exec" | "sudo" | "secrets" | "network" | "store" | "notify";

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
  | "slider" | "field" | "toggle" | "picker" | "button";

export interface Block {
  type: BlockType;
  id?: string;
  title?: string;
  subtitle?: string;
  text?: string;
  symbol?: string;
  status?: Status | string;
  axis?: "vertical" | "horizontal";
  columns?: number;
  children?: Node[];
  value?: number | string;
  max?: number | string;
  unit?: string;
  delta?: string;
  chart?: "line" | "bar" | "area" | "pie";
  series?: { name?: string; values?: number[]; formula?: string; points?: number }[];
  labels?: string[];
  headers?: string[];
  rows?: (string | number | boolean | null)[][];
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
  blocks: Node[];
}

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
