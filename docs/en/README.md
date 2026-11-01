# SSHKipper extensions

SSHKipper is a native macOS SSH manager. An **extension** adds to it: a folder (or a `.sshkext` archive) with
`sshkipper-extension.json`, whose `contributes` lists the points of the app it adds to — its **contributions**. A
**module** is the oldest kind: an extension of a service, AI tools and automation blocks only (`sshkipper-module.json`,
`.sshkmod`), read the same way.

## An extension = contributions

| Contribution | What the user gets | Answered by | Guide | Example |
|---|---|---|---|---|
| `service` | A service of a server: «Службы» of the card, a node in the tree, a section of the services tab, pages, actions | handlers | [server](server-modules.md), [process](process-modules.md) | [processes](../../examples/processes), [http-checks](../../examples/http-checks), [screens](../../examples/screens), [swift-hello](../../examples/swift-hello) |
| `tools` | AI tools the app's agent may call under the server's AI mode | handlers | [AI and automation](ai-and-automation.md) | [processes](../../examples/processes) |
| `automation` | Blocks of the automations library | handlers | [AI and automation](ai-and-automation.md) | [http-checks](../../examples/http-checks) |
| `database` | A database engine with the whole database tab | a driver ([database.md](../../spec/database.md)) | [database drivers](database-drivers.md) | [db-sqlite-node](../../examples/db-sqlite-node) |
| `storage` | A kind of storage in the file panel, transfers, automations | `storage/*` | [storages and sources](storage-and-sources.md) | [example-folder-storage](../../examples/example-folder-storage) |
| `source` | A live folder of servers in the tree | `source/*` | [storages and sources](storage-and-sources.md) | [example-hetzner-source](../../examples/example-hetzner-source) |
| `nodeType`, `screen` | A node of its own with a card and a tab; a screen in a tab or a section | `render`, `ui/event` | [node types](node-types.md) | [node-type-sitechecks](../../examples/node-type-sitechecks) |
| `import` | Another program's file into folders and connections | `import/parse` | [importers and consoles](importers-and-consoles.md) | [import-csv](../../examples/import-csv) |
| `console` | A text console in the app's terminal tab | `console/*` | [importers and consoles](importers-and-consoles.md) | [console-echo](../../examples/console-echo) |
| `ai` | A model provider: a profile of Settings → AI | `ai/*` | [AI and automation](ai-and-automation.md) | [ai-echo-provider](../../examples/ai-echo-provider) |

Every screen is JSON the app draws with its own controls ([UI-Kit](ui-kit.md)): no HTML, no web views.

## Where the code runs

| | `server` | `process` |
|---|---|---|
| Handlers are | shell scripts of the extension | names a program answers |
| They run | on the server, over the app's own SSH session (bastions, 2FA, containers, `sudo -n`) | on this Mac, a program speaking JSON-RPC over stdio |
| Good for | reading and changing things on a server | APIs, history, logic, every contribution but a service |
| Reach the server by | being there | `host.exec(...)` — the app runs the command over its session |
| Language | POSIX `sh` (no `jq` assumed; the SDK prelude writes JSON) | any; the SDK has [TypeScript](process-modules.md) (Node 24) and [Swift](swift.md) |

Neither puts extension code into the app's process. Server scripts aren't installed anywhere: they travel with each
call and leave nothing behind. A program is hashed before every start and runs with a clean environment.

## Reading order

1. [Getting started](getting-started.md) — a working extension in five minutes, `sshkipper-ext new --kind …`
2. [The manifest](manifest.md) — every key, permissions, `contributes`
3. [UI-Kit](ui-kit.md) — views, blocks, live screens, templates ([reference](ui-kit-reference.md))
4. Your runtime: [server modules](server-modules.md) · [programs in TypeScript](process-modules.md) · [Swift](swift.md)
5. Your contribution: [AI tools, automation blocks, model providers](ai-and-automation.md) ·
   [storages and sources](storage-and-sources.md) · [database drivers](database-drivers.md) ·
   [node types and screens](node-types.md) · [importers and consoles](importers-and-consoles.md)
6. [Publishing](publishing.md) — packing, installing, versions, the library
7. [Security](security.md) — what an extension can and can't do, what the user approves
8. [For AI agents](agents.md) — the MCP server

The protocol, normative: [spec/protocol.md](../../spec/protocol.md) (§1–9 handlers and modules, §10 extensions, §11
live screens, §12 storages and sources, §13 model providers, §14 node types, §15 import, §16 consoles) and
[spec/database.md](../../spec/database.md). One word for one thing: [the glossary](../glossary.md).

## In this repository

| | |
|---|---|
| [spec/](../../spec) | The protocols, normative |
| [schemas/](../../schemas) | JSON Schemas of the manifest and of views; `symbols.json` — symbols the app draws |
| [packages/sdk](../../packages/sdk/src) | TypeScript: types, UI-Kit builders, the program runtime, templates, validation, preview, the local runner |
| [packages/swift](../../packages/swift) | Swift: the `SSHKipperSDK` package |
| [packages/cli](../../packages/cli) | `sshkipper-ext`: new, validate, run, preview, pack, vendor, mcp |
| [packages/mcp](../../packages/mcp) | The MCP server for AI agents writing extensions |
| [examples/](../../examples) | An extension of every kind, each with a README |

Requirements: SSHKipper with extensions (Settings → Extensions); Node.js 24+ for the CLI and TypeScript programs;
Swift 6 for the Swift package.
