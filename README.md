# SSHKipper Extension SDK

**Add your own services, screens, storages, server sources, database engines and AI tools to
[SSHKipper](https://github.com/kdanet/sshkipper-releases), the native macOS SSH manager — described in JSON, drawn by
the app with its own controls.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/node-%E2%89%A524-339933.svg)](package.json)
[![Swift 6](https://img.shields.io/badge/swift-6-F05138.svg)](packages/swift/Package.swift)
[![Protocol: SDK 1](https://img.shields.io/badge/protocol-SDK%201-555.svg)](spec/protocol.md)

An extension is a folder with `sshkipper-extension.json` that lists its **contributions** — the points of the app it
adds to. Your code never runs inside the app: handlers are POSIX `sh` scripts the app runs on the server over its own
SSH session (bastions, 2FA, containers, `sudo -n` included), or a program on this Mac speaking JSON-RPC over stdio.
Every screen is JSON the app draws natively — no HTML, no web views.

## Quick start

```sh
npm install -g github:kdanet/sshkipper-sdk      # Node 24+; puts sshkipper-ext on PATH
sshkipper-ext new disks --id dev.acme.disks      # a working service: scripts, a page, an action, an AI tool, a block
sshkipper-ext validate disks                     # the checks the app makes before installing
sshkipper-ext run disks summary --ssh deploy@web-1   # a handler on a real server (or here, without --ssh)
sshkipper-ext preview disks main --run           # the page as text, filled by its handlers
sshkipper-ext pack disks                         # → dev.acme.disks-0.1.0.sshkext
```

In SSHKipper: Settings → Extensions → Development folder… (reloads as you edit) or Install extension… with the
`.sshkext`. Every command has `--help`; [Getting started](docs/en/getting-started.md) walks through it.

## What you can build

`sshkipper-ext new <folder> --kind <kind>` writes a working extension of each kind.

| Contribution | What the user gets | `--kind` | Example | Guide |
|---|---|---|---|---|
| `service` | A service of a server: a node in the tree, pages, actions | `service` | [processes](examples/processes), [screens](examples/screens), [swift-hello](examples/swift-hello) | [server scripts](docs/en/server-modules.md), [programs](docs/en/process-modules.md) |
| `tools` | AI tools the app's agent calls under the server's AI mode | `service` | [processes](examples/processes) | [AI and automation](docs/en/ai-and-automation.md) |
| `automation` | Blocks of the automations library | `automation` | [http-checks](examples/http-checks) | [AI and automation](docs/en/ai-and-automation.md) |
| `database` | A database engine with the app's whole database tab | `database` | [db-sqlite-node](examples/db-sqlite-node) | [database drivers](docs/en/database-drivers.md) |
| `storage` | A kind of storage in the file panel, transfers, automations | `storage` | [example-folder-storage](examples/example-folder-storage) | [storages and sources](docs/en/storage-and-sources.md) |
| `source` | A live folder of servers in the tree | `source` | [example-hetzner-source](examples/example-hetzner-source) | [storages and sources](docs/en/storage-and-sources.md) |
| `nodeType`, `screen` | A node of its own with a card and a live tab | `node-type` | [node-type-sitechecks](examples/node-type-sitechecks) | [node types](docs/en/node-types.md) |
| `import` | Another program's file into folders and connections | `import` | [import-csv](examples/import-csv) | [importers and consoles](docs/en/importers-and-consoles.md) |
| `console` | A text console in the app's terminal tab | `console` | [console-echo](examples/console-echo) | [importers and consoles](docs/en/importers-and-consoles.md) |
| `ai` | A model provider: a profile of Settings → AI | `ai` | [ai-echo-provider](examples/ai-echo-provider) | [AI and automation](docs/en/ai-and-automation.md) |

What an extension can and can't do, and what the user approves: [Security](docs/en/security.md).

## Docs

- **Guides:** [English](docs/en/README.md) · [Русский](docs/ru/README.md) — the same guides in both, from getting
  started to publishing; [glossary](docs/glossary.md) (one word for one thing, en ↔ ru).
- **Protocol** (normative): [spec/protocol.md](spec/protocol.md) — handlers, server and process runtimes, pages and
  templates, extensions, live screens, storages and sources, model providers, node types, import, consoles (§1–16);
  [spec/database.md](spec/database.md) — database drivers; [spec/prelude.sh](spec/prelude.sh) — the shell prelude the
  app puts before every server script.
- **Schemas:** [module.schema.json](schemas/module.schema.json) (both manifests),
  [view.schema.json](schemas/view.schema.json) (pages and live screens), [symbols.json](schemas/symbols.json) (the SF
  Symbols the app draws).
- **UI-Kit:** [guide](docs/en/ui-kit.md) · [reference](docs/en/ui-kit-reference.md) — every block, style, action and op.

## Libraries

| | |
|---|---|
| **TypeScript** (Node 24) | [packages/sdk](packages/sdk/src): types, UI-Kit builders (`view`, `rows`, `metric`, `datatable`, `tree`, `editor`, `terminal`, `liveChart`, `ops`…), the program runtime `defineModule` (handlers, `host.exec`, `host.store`, contributions), `serveDatabase` for drivers. A program carries its copy in `lib/sshkipper-sdk/` (`sshkipper-ext vendor` refreshes it), so the user's Mac needs no `npm install`. The package also exports `sshkipper-sdk` and `sshkipper-sdk/database`. |
| **Swift** (6, macOS 13+) | [packages/swift](packages/swift): `SSHKipperSDK` — the manifest and protocol types, the JSON-RPC loop, every contribution, UI-Kit, the database protocol; no dependencies. `.package(url: "https://github.com/kdanet/sshkipper-sdk.git", from: "1.1.0")` — [guide](docs/en/swift.md), [example](examples/swift-hello). |
| **Shell** | [spec/prelude.sh](spec/prelude.sh), put before every server script: `sk_json_string`, `sk_json_kv`, `sk_fail`, `sk_has`, `sk_secret` — JSON without `jq`, on busybox and mawk too; `sk_file` reads the extension's other files under `scripts/`. |

## For AI agents

`sshkipper-ext mcp` is an MCP server (stdio, no dependencies) that lets an agent write extensions the way a person
does with the CLI: the guides and schemas, the UI-Kit catalog, a scaffold of every kind, the app's validation,
previews of pages and live screens, and a local runner.

```sh
claude mcp add sshkipper-sdk -- sshkipper-ext mcp
```

```json
{ "mcpServers": { "sshkipper-sdk": { "command": "sshkipper-ext", "args": ["mcp"] } } }
```

Without `--allow-changes` (a flag you give when starting it, not the agent) it runs only what reads. Tools and
resources: [docs/en/agents.md](docs/en/agents.md).

## Repository layout

| Folder | |
|---|---|
| [spec/](spec) | the protocols and the shell prelude |
| [schemas/](schemas) | JSON Schemas of the manifests and views; `symbols.json` |
| [packages/sdk/](packages/sdk) | TypeScript: types, UI-Kit, the program runtime, templates of every kind, validation, preview, the local runner |
| [packages/swift/](packages/swift) | the Swift package `SSHKipperSDK` (also built from the root [Package.swift](Package.swift) for a Git dependency) |
| [packages/cli/](packages/cli) | `sshkipper-ext` — `new`, `validate`, `run`, `preview`, `pack`, `vendor`, `mcp` (`sshkipper-module` — its old name) |
| [packages/mcp/](packages/mcp) | the MCP server |
| [examples/](examples) | one extension per contribution, each with a README: what it shows, how to try and install it |
| [docs/](docs) | the guides in English and Russian, the glossary |
| [tests/](tests) | `npm test`; [tests/conformance/](tests/conformance) — cases the app runs against its own code too |

## Development

```sh
git clone https://github.com/kdanet/sshkipper-sdk.git && cd sshkipper-sdk
npm install && npm link    # TypeScript and Node's types are the only (dev) dependencies; a clone runs its .ts as is
npm test                   # the tests, then tsc --strict over the SDK, the examples and a new extension of every kind
npm run validate           # every example passes the app's checks and packs
npm run swift              # the Swift package's tests; swift-hello builds (in $TMPDIR), validates, packs and answers
npm run docs               # regenerates docs/*/ui-kit-reference.md from the catalog
```

`SSHKIPPER_SDK_DOCKER=1 npm test` also runs the shell parts on busybox and dash + mawk, with `alpine:3.22` and
`debian:bookworm-slim` images already on the machine (nothing is pulled). The app's own test suite compares
`schemas/symbols.json`, `spec/prelude.sh` and `tests/conformance/` with its code — a change there is a protocol
change. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE).
