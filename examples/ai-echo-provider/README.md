# Echo model — a model provider

**Shows:** a model provider (spec/protocol.md §13): a profile of Settings → AI with its own fields (a secret key kept
in the keychain), reasoning levels, models the program lists (`ai/models`), an answer streamed in pieces (`ai/delta`),
tool calls (asked to check a server, it calls `list_sessions`, then `run_command uptime` — through the app's rules and
confirmations), «Стоп» (`ai/cancel`). Deterministic, no network, no real model.

**Contributes:** `ai` (`echo`). Permissions: `secrets`.

**Try it** (from the SDK's root, `sshkipper-ext` on PATH):

```sh
sshkipper-ext validate examples/ai-echo-provider
sshkipper-ext run examples/ai-echo-provider ai/models --params '{"provider": "echo", "settings": {}, "secrets": {}}'
```

`ai/chat` would answer through a model's API in a real provider, so the MCP server runs it only with
`--allow-changes`; the CLI runs it for you.

**In SSHKipper:** Settings → Extensions → Development folder… → Settings → AI → «+» → From extensions → «Эхо»; choose the profile in the AI panel. Guide: [AI and automation](../../docs/en/ai-and-automation.md).

**По-русски:** подставной провайдер модели: ответ кусочками, вызовы инструментов, «Стоп». Руководство —
[AI и автоматизации](../../docs/ru/ai-and-automation.md).
