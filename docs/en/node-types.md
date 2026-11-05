# A node type and a screen of your own

An extension can add **a node of its own** to the user's document — with its icon, its settings card and its tab.
The app keeps the node and draws everything; the extension describes the fields and builds the screen from UI-Kit
blocks. The protocol — [spec/protocol.md §14](../../spec/protocol.md). A complete example —
[examples/node-type-sitechecks](../../examples/node-type-sitechecks) («Site checks»).

## 1. The manifest

```json
{
  "sdk": 1, "id": "dev.example.sites", "version": "1.0.0", "title": "Site checks",
  "runtime": { "kind": "process", "command": ["node", "extension.ts"] },
  "permissions": ["secrets", "store"],
  "contributes": {
    "nodeType": [{
      "id": "checks", "title": "Site checks", "icon": { "symbol": "checkmark.shield", "color": "green" },
      "screen": "checks",
      "fields": [
        { "key": "urls", "title": "Addresses", "type": "list" },
        { "key": "interval", "title": "Interval, s", "type": "number", "default": 5 },
        { "key": "token", "title": "Token", "type": "secret" },
        { "key": "server", "title": "Server", "type": "node", "nodeKinds": ["connection"] }
      ]
    }],
    "screen": [{ "id": "checks", "title": "Site checks", "placement": "tab", "render": "render" }]
  },
  "handlers": { "render": { "timeout": 10 } }
}
```

- **Fields** are the kinds of a module's settings (`text`, `number`, `bool`, `choice`, `list`, `path`, `secret`) plus
  `node` — a link to another node of the document. `nodeKinds`: `connection` (the default), `database`, `storage`,
  `tunnel`, `terminal`, `folder` or `ext:<own type>`. Only a node type's fields may link.
- **A secret** is a secret of the document owned by the node: copied and deleted with it. It is never in the settings
  the program gets — only its key in `node.secrets`; the value comes from `host.nodeSecret`.
- **A screen** `tab` opens on a double click on the node; `section` is a section of a server's services tab (where the
  extension is switched on in the card's «Services»); `panel` doesn't open yet. A `tab` screen no `nodeType.screen`
  names is opened by the user from the palette by its title, and by the program with `host.open({screen})`: such a tab
  has **neither a node nor a server** (`ctx.node` and `ctx.server` are empty, `host.exec` is refused as «not a server
  of the call»). A screen that needs a server is a `section` (the server whose services are open) or a screen of your
  node type with a `node` field pointing at the server.

The user creates a node with File → From extensions → «<title>…» (the same in the toolbar's «+» and the tree's
Create menu) or the palette; the card is a native form
from your fields. Without the extension the node stays in the document with a puzzle piece, «extension needed», and
loses nothing.

## 2. The screen

```ts
import { datatable, defineModule, screen, split, toolbar, type NodeContext } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {
    render: (input, ctx) => {
      const node = ctx.node as NodeContext;            // id, name, settings, links, secrets
      return screen([
        toolbar([{ id: "check", title: "Check now", symbol: "arrow.clockwise" }]),
        split([datatable(["Address", "Code"], [], { id: "checks", selection: "single" }), /* … */]),
      ], { title: node.name, fill: true });
    },
  },
  async onEvent(e, ctx) {
    if (e.type === "open") { /* a timer: ctx.push([...]) — live data */ }
    if (e.type === "press" && (e.value as any).item === "check") { /* … */ }
    return null;
  },
});
```

`render` gets `input.node` (and `ctx.node`); events carry `ctx.node`. The screen is built **anew** when the node's
settings change, the extension is updated or switched on, the document is unlocked again, or the program restarted.
Open tabs come back after the app is relaunched.

## 3. What a program may ask

A program sees only the node of an open screen, the nodes it was linked to, and a section's server — between calls
too (a timer). Any other id is refused.

```ts
const token = await ctx.host.nodeSecret("token");                 // its own node's secret (the secrets right)
await ctx.host.exec("uptime", { server: ctx.node!.links.server.id }); // a linked server (the exec right)
await ctx.host.open({ terminal: { server: id, command: "curl -sI http://…" } }); // asks the user first
const button = await ctx.host.ask({
  title: "Clear the history?", text: "The chart's points go.",
  buttons: ["Clear", "Cancel"], risk: "danger",                 // the first button red, not on Return
});
```

- `host.open` opens a node (`{node}`), its own screen (`{screen, node?}` / `{screen, server}`) or a terminal on a
  server. The app shows a terminal's command to the user with the command policy's verdict; `false` — they said no.
  At most 5 opens in 10 s.
- `host.ask` shows the app's dialog signed «Asked by extension «…»»; the answer is the button's index. One question of
  an extension at a time, the rest wait (up to 8); at most 6 questions a minute — refused past that.

## 4. Checking it

```sh
node packages/cli/sshkipper-ext.ts validate examples/node-type-sitechecks
```

```sh
sshkipper-ext preview examples/node-type-sitechecks checks \
  --node '{"id":"n1","name":"Shop","type":"ext:dev.sshkipper.example.sitechecks/checks","settings":{},"links":{},"secrets":[]}' \
  --events '[{"type":"open"},{"type":"press","block":"toolbar","value":{"item":"check"}}]'
```

`preview` builds the screen for the node you give (`--node`) and lives it through the events, printing the screen
after them. In SSHKipper: Settings → Extensions → Development folder… → the folder, then File → From extensions →
your type; a double click opens its tab, and the tab's «⋯» → «Инспектор экрана» shows every event and patch.
