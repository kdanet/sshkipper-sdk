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
- `risk` goes through the agent's level on the server like any command: `read` — a check, `change` — a service action,
  `danger` — one that interrupts work. What asks:

  | Agent level | `read` | `change` | `danger` |
  |---|---|---|---|
  | “Ask for permission” | asks | asks | asks |
  | “Approve for me” (the default) | runs | runs | asks |
  | “Full access” | runs | runs | runs |
  | “Read-only” | runs | refused | refused |

  A server's Production mark doesn't change this table — which is why an honest `risk` matters. Besides, a parameter
  holding an address outside the server (a URL, `host:port`) asks at every level but “Full access”; with nobody to ask
  (an automation's agent at night) it is refused.
- `params` are checked (types, `required`, `choices`, `pattern` as a full match) and unknown keys dropped before the
  handler runs.
- The model gets the answer with secrets masked and **at most 20 000 characters** long: a longer one is cut, and a
  line “…[module answer cut…]” tells the model so (cut JSON is no longer JSON — return a summary, not everything). An answer whose secret couldn't be masked in place is replaced by “[module
  answer hidden…]”.
- Return compact JSON: the model reads it, not a person.

## Automation blocks

```json
"automation": [
  { "id": "failed_jobs", "title": { "en": "Failed jobs", "ru": "Упавшие задачи" }, "symbol": "tray.full",
    "handler": "failed_count", "risk": "read", "returns": "json",
    "params": [{ "key": "queue", "title": "Queue", "type": "text", "default": "default", "pattern": "[a-z0-9_-]{1,40}" }] }
]
```

A block shows in the automations library under “From extensions”, with one input — the **server** — and its
parameters on the card. It runs on the server like any automation step: on schedule, without the user, its log and
result in the run's history.

What the handler gets is what a page's handler gets, with three differences:

- `context.automation` is `true` and there's no `context.server` (the card's server is where it runs);
- settings are their **defaults** — a card has no connection settings; pass what varies as block parameters;
- secret settings aren't passed.

`returns` says what the next block gets:

| | |
|---|---|
| `json` (default) | the JSON; its summary keys make the block's line in the run: `{"status": "ok" \| "warn" \| "error", "summary": "3 failed", "value": 3, "unit": "jobs", "items": [{"label", "status", "value", "detail"}]}` (`message` works as `summary`). Other top-level keys are values the next blocks read as `{{ in.<key> }}` (below). |
| `text`, `number`, `list` | read from stdout the way the automations' “What to return” reads a command's output |
| `none` | only whether it worked |

```sh
# scripts/failed_count.sh
q=${SK_INPUT_QUEUE:-default}
n=$(php "$SK_SETTING_ARTISAN" queue:failed --queue="$q" 2>/dev/null | grep -c '^|' || true)
st=ok; [ "$n" -gt 0 ] && st=warn; [ "$n" -gt 50 ] && st=error
printf '{"status": "%s", "summary": %s, "value": %d, "unit": "jobs"}' "$st" "$(sk_json_string "$q: $n failed")" "$n"
```

**What the next blocks get.** `{{ in.value }}`, `{{ in.summary }}`, `{{ in.status }}`, `{{ in.unit }}` — from the
summary; `{{ in.<key> }}` — every other top-level key (and the keys of a `values` object) whose value is a string, a
number or `true`/`false`: arrays, objects and `null` don't go on, up to 64 keys, a string up to 2 000 characters. Keys
the app sets itself (`stdout`, `exit_code`, `stdout_bytes`, `duration`) aren't overwritten, and the format's keys
(`items`, `metrics`, `values`, `state`, `series`, `rows`…) are read for what they mean — give your own values names of
your own: `{"status": "ok", "summary": "…", "dump_file": "/tmp/x.sql.gz"}` → `{{ in.dump_file }}`.

**Sudo.** `"sudo": "required"` runs the block through `sudo -n` (the server must allow it); `auto` (the default) and
`never` run it as the connection's user, without sudo.

**No service needed.** The block runs on the card's server whenever the extension is on in Settings → Extensions —
whatever its service is on that server in “Services” (“Off” too). Check for the program you need in the script
itself (`sk_has … || sk_fail …`).

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
- Return the result as the same JSON a server block prints on stdout: an object (`{status, summary, value, items:
  [{label, value, unit, status, detail}], …}` — its keys reach `{{ in.<key> }}` the same way) for `returns: json`, or a
  string for `text` / `number` / `list`. A thrown `ModuleError` fails the step with its message.
- The approval shows “extension program” on this Mac, the handler, the parameters and the block's `risk`.
- Stopping the run aborts `ctx.signal`. Such a block can't run “on the server by cron” (the program is on this Mac):
  installing the automation on a server is refused.

See `examples/http-checks` (`check_urls`, `check_urls_mac`).

## Model providers

An extension can be a model provider (`contributes.ai`, protocol §13): Settings → AI gets a profile of it, used
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
- In the AI panel the user's last message starts with a text block of the app's own,
  `<sshkipper_context>…</sshkipper_context>`: the date and time, the chat's server and the user's tab, the brief of the
  agent folders, the open sessions (`s1=web-1[доступ есть, safeWrite, production]`). Pass it to the model as it is —
  it is how the model knows which `s1`, `s2` it may use.
- `ctx.signal` aborts when the user presses Stop (`ai/cancel`). An error you throw is shown as the provider's error.
  `ai/chat` has 30 minutes for the whole answer (`ai/models` 60 s): until then only Stop ends it.
- The values of the profile's secret fields (4 characters or more) are replaced by the app in every `ai/delta`, in the
  result, in errors and in the extension's log. It is a safety net: a value encoded or split across pieces isn't
  recognized — don't print the key at all.
- `examples/ai-echo-provider` — a deterministic stand-in with streaming and tool calls, no network.
