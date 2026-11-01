# SSHKipper module SDK

Build modules for [SSHKipper](https://github.com/kdanet/sshkipper-releases), the native macOS SSH manager: a service
of your servers with its own pages, actions, AI tools and automation blocks — drawn natively by the app, run over its
SSH sessions.

```sh
npm link                                   # Node 24+, no dependencies
sshkipper-module new disks --id dev.acme.disks
sshkipper-module validate disks
sshkipper-module call disks summary --ssh deploy@web-1
sshkipper-module pack disks
```

- **Docs:** [English](docs/en/README.md) · [Русский](docs/ru/README.md)
- **Protocol:** [spec/protocol.md](spec/protocol.md) · **Schemas:** [schemas/](schemas)
- **Examples:** [processes](examples/processes) (a server module) · [http-checks](examples/http-checks) (a TypeScript process module) · [screens](examples/screens) (a live screen: big table, tree, split, editor, live chart)
- **For AI agents:** `sshkipper-module mcp` — an MCP server with the guides, schemas, UI-Kit, scaffolds, validation,
  previews and a local runner ([docs/en/agents.md](docs/en/agents.md))

| Folder | |
|---|---|
| `spec/` | the protocol and the shell prelude the app puts before every server script |
| `schemas/` | `module.schema.json`, `view.schema.json`, `symbols.json` |
| `packages/sdk/` | TypeScript: types, UI-Kit builders, the process runtime, templates, validation, preview, dev runner |
| `packages/cli/` | `sshkipper-module` |
| `packages/mcp/` | the MCP server |
| `tests/` | `npm test`; `tests/conformance/` — cases the app runs against its own implementation too |

The app checks this repository too: its test suite compares `schemas/symbols.json`, `spec/prelude.sh` and the
template conformance cases with its own code, and validates the examples.

License: MIT.
