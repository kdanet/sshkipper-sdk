# SSHKipper extension SDK

Build extensions for [SSHKipper](https://github.com/kdanet/sshkipper-releases), the native macOS SSH manager. An
extension is a package of **contributions** — a service of your servers with its own pages and live screens, AI tools,
automation blocks, a database engine, a kind of storage, a source of servers, a node type with its own tab, an
importer, a console, a model provider. The app draws everything natively from the blocks you describe; your code runs
as scripts on the server over the app's SSH session or as a program on this Mac — never inside the app.

```sh
npm link                                      # Node 24+, no dependencies → sshkipper-ext on PATH
sshkipper-ext new disks --id dev.acme.disks   # --kind service|database|storage|source|node-type|import|console|ai|automation
sshkipper-ext validate disks
sshkipper-ext run disks summary --ssh deploy@web-1
sshkipper-ext preview disks main --run
sshkipper-ext pack disks                      # → dev.acme.disks-0.1.0.sshkext
```

- **Docs:** [English](docs/en/README.md) · [Русский](docs/ru/README.md) · [Glossary · Словарь](docs/glossary.md)
- **Protocol:** [spec/protocol.md](spec/protocol.md) (extensions, §1–16) · [spec/database.md](spec/database.md)
  (database drivers) · **Schemas:** [schemas/](schemas)
- **Libraries:** TypeScript ([packages/sdk](packages/sdk/src)) · Swift ([packages/swift](packages/swift), [guide](docs/en/swift.md))
- **For AI agents:** `sshkipper-ext mcp` — an MCP server with the guides, schemas, UI-Kit, scaffolds of every kind,
  validation, previews of pages and live screens and a local runner ([docs/en/agents.md](docs/en/agents.md))
- **Examples:** one per contribution — [examples/](examples) (each has a README: what it shows, how to try and install it)

| Folder | |
|---|---|
| `spec/` | the protocols and the shell prelude the app puts before every server script |
| `schemas/` | `module.schema.json` (both manifests), `view.schema.json`, `symbols.json` |
| `packages/sdk/` | TypeScript: types, UI-Kit builders, the program runtime, templates, validation, preview, the local runner |
| `packages/swift/` | Swift: `SSHKipperSDK` — types, the JSON-RPC loop, contributions, UI-Kit, the database protocol |
| `packages/cli/` | `sshkipper-ext` (`sshkipper-module` — its old name) |
| `packages/mcp/` | the MCP server |
| `examples/` | an extension of every kind |
| `tests/` | `npm test`; `tests/conformance/` — cases the app runs against its own implementation too |

`npm test` — the SDK's tests; `npm run validate` — every example passes the app's checks and packs; `npm run swift` —
the Swift package and its example build and pass. The app checks this repository too: its test suite compares
`schemas/symbols.json`, `spec/prelude.sh` and the template conformance cases with its own code, and validates the
examples.

License: MIT.
