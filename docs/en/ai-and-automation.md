# AI tools and automation blocks

The same handlers that fill pages can serve the app's AI agent and its automations.

## AI tools

```json
"tools": [
  { "name": "queue_list", "handler": "queues", "risk": "read",
    "description": "Queues of the server with jobs waiting, failed and workers. Use it to see whether jobs pile up." },
  { "name": "queue_retry", "title": { "ru": "Повторить задания очереди", "en": "Retry a queue's jobs" },
    "handler": "retry", "risk": "change",
    "description": "Retries the failed jobs of one queue; returns how many went back.",
    "params": [{ "key": "queue", "title": "Queue", "type": "text", "required": true, "pattern": "[a-z0-9_-]{1,40}" }] }
]
```

- The agent sees two fixed tools — `module_tools` (what the modules of a server offer) and `module_call` — so its
  tool list doesn't change as modules come and go (the prompt cache holds).
- `description` is all the model reads to choose: what it does, what it returns, when to use it.
- `title` (optional) is for people: the confirmation of a call says «Модуль «Очереди»: Повторить задания очереди», not
  `queue_retry`.
- `risk` goes through the server's AI mode like any command: `read` — a check, `change` — a service action,
  `danger` — a disruptive one; the user confirms what the mode asks for. Production servers stay protected.
- `params` are checked (types, `required`, `choices`, `pattern` as a full match) and unknown keys dropped before the
  handler runs; secrets in the answer are masked; long answers are cut.
- Return compact JSON: the model reads it, not a person.

## Automation blocks

```json
"automation": [
  { "id": "failed_jobs", "title": { "en": "Failed jobs", "ru": "Упавшие задачи" }, "symbol": "tray.full",
    "handler": "failed_count", "risk": "read", "returns": "json",
    "params": [{ "key": "queue", "title": "Queue", "type": "text", "default": "default", "pattern": "[a-z0-9_-]{1,40}" }] }
]
```

A block shows in the automations library under “From installed modules”, with one input — the **server** — and its
parameters on the card. It runs on the server like any automation step: on schedule, without the user, its log and
result in the run's history.

What the handler gets is what a page's handler gets, with three differences:

- `context.automation` is `true` and there's no `context.server` (the card's server is where it runs);
- settings are their **defaults** — a card has no connection settings; pass what varies as block parameters;
- secret settings aren't passed.

`returns` says what the next block gets:

| | |
|---|---|
| `json` (default) | the JSON; its summary keys make the block's line in the run: `{"status": "ok" \| "warn" \| "error", "summary": "3 failed", "value": 3, "unit": "jobs", "items": [{"label", "status", "value", "detail"}]}` (`message` works as `summary`). Other keys are values the next blocks read as `{{ in.<key> }}`. |
| `text`, `number`, `list` | read from stdout the way the automations' “What to return” reads a command's output |
| `none` | only whether it worked |

```sh
# scripts/failed_count.sh
q=${SK_INPUT_QUEUE:-default}
n=$(php "$SK_SETTING_ARTISAN" queue:failed --queue="$q" 2>/dev/null | grep -c '^|' || true)
st=ok; [ "$n" -gt 0 ] && st=warn; [ "$n" -gt 50 ] && st=error
printf '{"status": "%s", "summary": %s, "value": %d, "unit": "jobs"}' "$st" "$(sk_json_string "$q: $n failed")" "$n"
```

A block's id in a graph comes from the module id and the block id: an automation shared with someone who has the
module installed finds the block.

### Blocks of a process module

A process module's block calls its handler in the program on this Mac (protocol §8.1) — no script, no shell:

```json
"automation": [
  { "id": "check_urls", "handler": "check_list", "risk": "read", "server": true, "returns": "json",
    "title": { "en": "Check URLs from the server", "ru": "Проверить адреса с сервера" },
    "params": [{ "key": "urls", "type": "text", "required": true, "title": "URLs" }] }
]
```

- `input` is the card's parameters, typed; `context.settings` — the module's settings.
- `server: true` gives the block a server input (needs `exec`): `ctx.host.exec` there goes through the
  **automation's sessions** — its profile, its line of logins; at night a 2FA code nobody can type makes the step
  wait for a person. Without `server` there is no server and `host.exec` is refused.
- Return the result as an object (`{status, summary, value, items: [{label, value, unit, status, detail}]}`) for
  `returns: json`, or a string for `text` / `number` / `list`. A thrown `ModuleError` fails the step with its message.
- The approval shows “extension program” on this Mac, the handler, the parameters and the block's `risk`.
- Stopping the run aborts `ctx.signal`. Such a block can't run “on the server by cron” (the program is on this Mac):
  installing the automation on a server is refused.

See `examples/http-checks` (`check_urls`, `check_urls_mac`).

## Model providers

An extension can be a model provider (`contributes.ai`, protocol §12): Settings → AI gets a profile of it, used
wherever a profile is chosen — the AI panel, query drafting, AI filters, automations.

```json
"contributes": { "ai": [{ "id": "echo", "title": "Echo", "reasoning": ["low", "medium", "high"],
  "fields": [{ "key": "base_url", "type": "text", "title": "Address" }, { "key": "api_key", "type": "secret", "title": "API key" }] }] }
```

```ts
defineModule({
  handlers: {},
  ai: {
    models: () => [{ id: "echo-1", title: "Echo 1" }],
    async chat(req, ctx) {
      ctx.delta({ type: "text", text: "Hello" });            // pieces as they come (ai/delta)
      // a tool call: ctx.delta({ type: "tool_use", toolId: "t1", name: "list_sessions", input: {} }); return { stop: "tool_use" }
      return { stop: "end_turn", usage: { input_tokens: 10, output_tokens: 1 } };
    },
  },
});
```

- `req` is what every provider of the app gets — `system`, `messages` (blocks: text, tool_use, tool_result),
  `tools`, `max_tokens`, `effort` — already masked by the app; `settings` and `secrets` are the profile's (secret
  fields live in the keychain and need the `secrets` permission).
- A tool call goes through the AI mode's rules and the user's confirmations; the program never runs a tool itself.
- `ctx.signal` aborts when the user presses Stop (`ai/cancel`). An error you throw is shown as the provider's error.
- `examples/ai-echo-provider` — a deterministic stand-in with streaming and tool calls, no network.
