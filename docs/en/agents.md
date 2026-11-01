# For AI agents: the MCP server

The SDK has an MCP server so an AI agent (Claude Code, Claude Desktop, Cursor, any MCP client) can write extensions
the way a person does with the CLI: learn the SDK, start from a working extension of any kind, check every change,
preview pages and live screens, run handlers and contribution methods.

## Connecting

```json
{
  "mcpServers": {
    "sshkipper-sdk": { "command": "node", "args": ["/path/to/sshkipper-sdk/packages/cli/sshkipper-ext.ts", "mcp"] }
  }
}
```

Claude Code: `claude mcp add sshkipper-sdk -- node /path/to/sshkipper-sdk/packages/cli/sshkipper-ext.ts mcp`.

## Tools

| Tool | |
|---|---|
| `sdk_guide {topic, lang?}` | these guides — overview, getting-started, manifest, ui-kit, ui-kit-reference, server, process, swift, ai-and-automation, storage-and-sources, database-drivers, node-types, importers-and-consoles, publishing, security, agents, glossary, protocol, database-protocol; `lang: "ru"` — in Russian |
| `sdk_schema {name}` | the JSON Schema of `module` (both manifests) or `view`; `symbols` — the SF Symbols the app draws |
| `ui_kit {}` | every block with fields and an example (a live screen's own too), styles, actions, the ops of `ui/patch`, templates, symbols |
| `ext_scaffold {kind, id, title, process?, folder?}` | a working extension of a kind — service, database, storage, source, node-type, import, console, ai, automation — and the guide to read next; writes it with `folder` |
| `ext_validate {folder}` or `{manifest, files?}` | the app's checks before installing |
| `view_preview {view, data?, item?, settings?, components?, ops?}` | a view as text after templates (and after `ops`), with its problems |
| `screen_preview {folder, id?, node?, settings?, events?, wait?}` | a page or a screen built by its handler, then lived through `events`: their ops and the program's pushes applied, each step's answer, ops that didn't apply |
| `template_expand {view, vars, components?}` | the expanded JSON |
| `ext_run_local {folder, handler \| method, input?, params?, settings?, item?, node?}` | a handler or a contribution's method (`storage/list`, `source/poll`, `import/parse`, `ai/models`…) **on this machine** |

Resources: `sshkipper-sdk://guide/<topic>`, `sshkipper-sdk://guide/ru/<topic>`, `sshkipper-sdk://schema/module|view`.
The old names `module_scaffold`, `module_validate`, `module_run_local` still answer.

## What runs on this machine

`ext_run_local` and `screen_preview` run the extension **here**, with your rights and without a sandbox: scripts with
`sh`, programs as the app starts them, `host.exec` here too. So what changes things runs only when **you** started the
server with `sshkipper-ext mcp --allow-changes` — the agent can't allow it itself:

- handlers of `change`/`danger` actions, tools and blocks;
- contribution methods other than reads (`storage/write/*`, `mkdir`, `rename`, `delete`, links that create or remove,
  `ai/chat` — it would call a model's API);
- screen events other than looking (`press`, `submit`, `edit`, `menu`, `drop`, `move`, `activate`).

Consoles are interactive: try them in the app. `host/open` and `host/ask` are answered «not opened» and the cancel
button (there is no person here); `host/forward` gives the target as is.

## A good loop for an agent

1. `sdk_guide overview`, `ui_kit` — what an extension is, what a screen can show.
2. `ext_scaffold` with `folder` — start from something that works; read the guide it names.
3. Change one thing: a handler, a view, a method.
4. `ext_validate` — fix every error; read the warnings.
5. `ext_run_local` the handler or method; `view_preview` / `screen_preview` the page or screen.
6. Ask the user to link the folder in SSHKipper (Settings → Extensions → «Папка разработки…») and look at it for real.

Agents can't install extensions into the app or run them on the user's servers through this server: installing stays
with the user, and the app's own agent reaches servers only through the tools the user's AI modes allow.
