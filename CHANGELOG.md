# Changelog

The package's version follows [semantic versioning](https://semver.org). It is apart from the protocol's generation,
`"sdk": 1` in every manifest: the app runs extensions of the generations it knows and refuses others with a clear
message ([spec/protocol.md §7](spec/protocol.md#7-packages-and-versions)).

## 1.1.0 — the first public release

Everything below is new to the public; versions before it were developed together with the app.

### Protocol (`"sdk": 1`)

- [spec/protocol.md](spec/protocol.md): handlers and their calls, the server runtime (POSIX `sh` over the app's SSH
  session) and the process runtime (a program on this Mac, JSON-RPC over stdio, `host/*` requests), pages and
  templates, packages and versions, automation blocks, AI tools, extensions and contributions, live screens
  (`ui/event`, `ui/patch`, `ui/push`), storages and sources, model providers, node types and screens, import, consoles.
- [spec/database.md](spec/database.md): database drivers — engines, the wire format, methods, what runs without a
  question, versions.
- [spec/prelude.sh](spec/prelude.sh): the shell prelude the app puts before every server script.
- [schemas/](schemas): `module.schema.json` (`sshkipper-extension.json` and `sshkipper-module.json`),
  `view.schema.json` (pages and live screens), `symbols.json` (the 128 SF Symbols the app draws).
- [tests/conformance/](tests/conformance): template cases the app runs against its own implementation too.

### Contributions

`service`, `tools`, `automation`, `database`, `storage`, `source`, `nodeType`, `screen`, `import`, `console`, `ai`.

### TypeScript (Node 24)

- Types mirroring the schemas; UI-Kit builders for every block, a live screen's blocks and `ops`.
- `defineModule`: handlers, `host.exec` / `host.store` / `host.notify` and the other host requests, cancellation by
  `ctx.signal`, helpers for storages, sources, importers, consoles and model providers.
- `serveDatabase` (`sshkipper-sdk/database`) for database drivers.
- Templates of every kind, validation with the app's checks, previews of pages and live screens as text, and a local
  runner for handlers and contribution methods (here or over `ssh`).

### Swift (6, macOS 13+)

- `SSHKipperSDK`: the manifest and protocol types, the JSON-RPC loop, every contribution, UI-Kit builders and ops, the
  database protocol. No dependencies; usable by Git URL thanks to the root `Package.swift`.

### CLI `sshkipper-ext`

- `new` (`--kind service|database|storage|source|node-type|import|console|ai|automation`, `--process`, `--module`),
  `validate`, `run`, `preview`, `pack` (reproducible `.sshkext` / `.sshkmod`), `vendor`, `mcp`, `help`, `--version`.

### MCP server for AI agents

- `sdk_guide`, `sdk_schema`, `ui_kit`, `ext_scaffold`, `ext_validate`, `view_preview`, `screen_preview`,
  `template_expand`, `ext_run_local`; guides and schemas as resources. Only what reads runs unless the person starts it
  with `--allow-changes`.

### Examples and docs

- Eleven examples, one per contribution: `processes`, `http-checks`, `screens`, `swift-hello`, `db-sqlite-node`,
  `example-folder-storage`, `example-hetzner-source`, `node-type-sitechecks`, `import-csv`, `console-echo`,
  `ai-echo-provider`.
- Guides in English and Russian with the same sections, and a glossary.

### Still accepted

- `sshkipper-module.json` / `.sshkmod` (a module: a service, AI tools and automation blocks only).
- The CLI's old name `sshkipper-module` and its `call` (now `run`); the scaffold kinds `server` and `process`; the MCP
  tools' old names `module_scaffold`, `module_validate`, `module_run_local`.
