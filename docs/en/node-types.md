# A node type and a screen of your own

An extension can add **a node of its own** to the user's document — with its icon, its settings card and its tab.
The app keeps the node and draws everything; the extension describes the fields and builds the screen from UI-Kit
blocks. The protocol — [spec/protocol.md §12](../../spec/protocol.md). A complete example —
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
  extension is switched on in the card's «Services»); `panel` doesn't open yet.

The user creates a node with «Create ▸ …» in the tree, File → «New «…»…» or the palette; the card is a native form
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
  an extension at a time, the rest wait (up to 8).

## 4. Checking it

```sh
node packages/cli/sshkipper-module.ts validate examples/node-type-sitechecks
```

In a review instance: `extinstall <folder>`, `extnodenew ext:<id>/<type>`, `extnodeset <key>|<value>`,
`extnodesave`, `extnodeopen <name>`, `extnodedump <file>`; screen events — `screenevent`, `screenselect`.
