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

In SDK 1 automation blocks are for server modules; a process module's blocks are skipped with a warning.
A block's id in a graph comes from the module id and the block id: an automation shared with someone who has the
module installed finds the block.
