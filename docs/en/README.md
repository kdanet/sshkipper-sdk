# SSHKipper modules

SSHKipper is a native macOS SSH manager. A **module** adds one integration to it — a service of your servers (a
queue, a systemd unit set, your own backend) or an outside system — with:

- a **service** in the connection's Services, a node in the sidebar tree and a section of the server's services tab;
- **pages** the app draws natively from UI-Kit blocks (no HTML, no web views — JSON the app turns into its own controls);
- **actions** in the page's menus, with confirmations for anything that changes the server;
- **AI tools** the app's agent can call under the server's AI mode;
- **automation blocks** for the automations canvas;
- **settings** on the connection card, inherited through folders.

Modules are small and atomic: one module — one thing, the way the app's own Docker, nginx, cron and databases are
built.

## Two runtimes

| | `server` | `process` |
|---|---|---|
| Handlers are | shell scripts of the module | names a program answers |
| They run | on the server, over the app's own SSH session (bastions, 2FA, containers, `sudo -n`) | on this Mac, a program speaking JSON-RPC over stdio |
| Good for | reading and changing things on a server | APIs, history, logic, anything that needs a real language |
| Reach the server by | being there | `host.exec(...)` — the app runs the command over its session |
| Language | POSIX `sh` (no `jq` assumed; the SDK prelude writes JSON) | any; the SDK ships a TypeScript runtime for Node 24 |

Neither runtime puts module code into the app's process. Server scripts aren't installed anywhere: they travel
with each call and leave nothing behind.

## In this repository

| | |
|---|---|
| [spec/protocol.md](../../spec/protocol.md) | The protocol, normative |
| [schemas/](../../schemas) | JSON Schemas of the manifest and of views; `symbols.json` — symbols the app draws |
| [packages/sdk](../../packages/sdk/src) | TypeScript: types, UI-Kit builders, the process runtime, templates, validation |
| [packages/cli](../../packages/cli) | `sshkipper-module`: new, validate, call, preview, pack, vendor, mcp |
| [packages/mcp](../../packages/mcp) | The MCP server for AI agents writing modules |
| [examples/processes](../../examples/processes) | A server module: load, memory, the busiest processes, signals |
| [examples/http-checks](../../examples/http-checks) | A process module in TypeScript: URL checks, history, notifications, an AI tool |

## Guides

1. [Getting started](getting-started.md) — a working module in five minutes
2. [The manifest](manifest.md) — every key of `sshkipper-module.json`
3. [UI-Kit](ui-kit.md) — views, blocks, styles, templates ([reference](ui-kit-reference.md))
4. [Server modules](server-modules.md) — scripts, the environment, the prelude, sudo, containers
5. [Process modules](process-modules.md) — the TypeScript runtime and the host API
6. [AI tools and automation blocks](ai-and-automation.md)
7. [Publishing](publishing.md) — packing, installing, versions
8. [Security](security.md) — what a module can and can't do, what the user approves
9. [For AI agents](agents.md) — the MCP server

Requirements: SSHKipper with modules (Settings → Extensions → Modules); Node.js 24+ for the CLI and for TypeScript
modules.
