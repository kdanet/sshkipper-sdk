# For AI agents: the MCP server

The SDK has an MCP server so an AI agent (Claude Code, Claude Desktop, Cursor, any MCP client) can write modules
the way a person does with the CLI: learn the SDK, start from a working module, check every change, preview pages
and run handlers.

## Connecting

```json
{
  "mcpServers": {
    "sshkipper-sdk": { "command": "node", "args": ["/path/to/sshkipper-sdk/packages/cli/sshkipper-module.ts", "mcp"] }
  }
}
```

Claude Code: `claude mcp add sshkipper-sdk -- node /path/to/sshkipper-sdk/packages/cli/sshkipper-module.ts mcp`.

## Tools

| Tool | |
|---|---|
| `sdk_guide {topic}` | these guides: overview, getting-started, manifest, ui-kit, server, process, ai-and-automation, publishing, security, protocol |
| `sdk_schema {name}` | the JSON Schema of `module` or `view` |
| `ui_kit {}` | every block with fields and an example, styles, actions, templates, the symbols the app draws |
| `module_scaffold {kind, id, title, folder?}` | a working module (server or process); writes it with `folder` |
| `module_validate {folder}` or `{manifest, files?}` | the app's checks before installing |
| `view_preview {view, data?, item?, settings?, components?}` | the page as text after templates, with its problems |
| `template_expand {view, vars, components?}` | the expanded JSON |
| `module_run_local {folder, handler, input?, settings?, item?, allow_changes?}` | runs a handler **on this machine** (scripts with sh; a program with `host.exec` here); handlers of change/danger actions only with `allow_changes: true`, after asking the user |

Resources: `sshkipper-sdk://guide/<topic>`, `sshkipper-sdk://schema/module|view`.

## A good loop for an agent

1. `sdk_guide overview`, `ui_kit` — what a module is, what a page can show.
2. `module_scaffold` with `folder` — start from something that works.
3. Change one thing: a handler's script, a view, an action.
4. `module_validate` — fix every error; read the warnings.
5. `module_run_local` the handler; `view_preview` the page with what it returned.
6. Ask the user to link the folder in SSHKipper (Settings → Extensions → Modules → Connect folder for
   development…) and look at it on a real server.

Agents can't install modules into the app or run them on the user's servers through this server: installing stays
with the user, and the app's own agent reaches servers only through the tools the user's AI modes allow.
