# Process modules

`"runtime": {"kind": "process", "command": ["node", "module.ts"]}` — a program of the module on this Mac. The app
starts it on first use, talks JSON-RPC 2.0 over its stdin/stdout (one message per line), keeps it while the module
is used and stops it when the module is turned off or updated, a document it worked for locks (all of them once no
document is open), or the app quits. Any language
works ([spec/protocol.md §4](../../spec/protocol.md)); the SDK ships a TypeScript runtime for Node 24, which runs
`.ts` files as they are.

## A module in TypeScript

```sh
sshkipper-ext new queues --process --id dev.acme.queues
```

```ts
import { defineModule, view, rows, row, ModuleError, quote, tr } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {
    detect: async (_input, ctx) => ({ found: (await ctx.host.exec("command -v redis-cli")).exitCode === 0 }),

    async render(_input, ctx) {
      const r = await ctx.host.exec("redis-cli --raw keys 'queues:*'");
      if (r.exitCode !== 0) throw new ModuleError(r.stderr.trim() || "redis-cli failed");
      const names = r.stdout.split("\n").filter(Boolean).map((k) => k.slice(7));
      return view([rows(names.map((n) => row(n, { id: n, actions: ["clear"] })), { title: tr(ctx, { en: "Queues", ru: "Очереди" }) })]);
    },

    async clear(_input, ctx) {
      const name = String((ctx.item as { id?: string })?.id ?? "");
      await ctx.host.exec(`redis-cli del ${quote("queues:" + name)}`);
      return { message: `${name} cleared`, status: "ok" };
    },
  },
});
```

`lib/sshkipper-sdk/` is the SDK runtime copied into the module (`sshkipper-ext vendor` refreshes it): a module is
self-contained and needs no `npm install` on the user's Mac. Declare every handler in the manifest's `handlers`
(`{}` or `{"timeout": 20}`).

## The handler's context

| | |
|---|---|
| `input` | the action's, tool's or block's parameters, already checked against `params` |
| `ctx.server` | `{id, name, host, user}` of the connection, when there is one |
| `ctx.settings` | the connection's settings of the module (no secrets) |
| `ctx.item` | the row of an `on: item` action or an item page |
| `ctx.container` | the container the service runs in |
| `ctx.locale` | `ru`, `en`, `zh-Hans`… — `tr(ctx, {en, ru})` picks a text |
| `ctx.signal` | aborted when the app no longer waits (the page closed): pass it to `fetch` |
| `ctx.host` | the app's services, below |

Return any JSON (a view for `render` handlers, `{"message", "status"}` for actions); throw `ModuleError(message)` to
fail with words the user sees.

## The host API

Each needs its permission in the manifest; without it the call fails with `-32001`.

| Call | Permission | |
|---|---|---|
| `ctx.host.exec(command, {stdin?, timeout?, sudo?, container?, server?})` | `exec` (`sudo`) | runs on the call's server over the app's SSH session; `{exitCode, stdout, stderr}`; `stderr` is the error stream as it came (empty when the command wrote nothing there). Only servers of the call may be named. On the server itself unless you name a container — `{container: ctx.container}` for the service's own; `stdin` doesn't go into a container. In a container docker runs through `sudo -n` only when the server's Docker settings turn sudo -n on **and** the extension has the `sudo` permission. `timeout` is 1…3600 s (30 by default); past it the call throws “The server didn’t respond within N s” (with `stdin` too) and the command is stopped on the server (with `stdin` through the server's `timeout`, where it has one: coreutils or busybox). Quote values with `quote()`. |
| `ctx.host.secret(key)` | `secrets` | a secret setting of the call's server |
| `ctx.host.store.get(key)` / `.set(key, value)` | `store` | the module's JSON storage on this Mac (≤ 1 MB in all); `null` deletes |
| `ctx.host.notify(title, text)` | `notify` | a notification |
| `ctx.host.log(level, message)` | — | the module's log in the app |

The program runs with a clean environment: `PATH` (the folder its program was found in, system paths, Homebrew), `HOME`,
`TMPDIR`, `LANG`, `SK_SDK`, `SK_MODULE`, `SK_DATA` (a private folder for the module's files),
`PYTHONPYCACHEPREFIX` (Python's byte code under `SK_DATA`) and `runtime.env`. It doesn't get the user's SSH agent or the
app's secrets: reach servers through `host.exec`.

**Don't write into the module folder.** The program can (there is no sandbox), but the app hashes the package's files
before every start of the program: a new or changed file — a cache, a log, `__pycache__` — marks the extension changed,
and the whole of it stops, every contribution, until the user presses “Allow as it is…” in Settings → Extensions. Keep
state in `host.store` and files in `SK_DATA` or `TMPDIR`. For the same reason don't start Python with `-I` or `-E`
(they ignore `PYTHONPYCACHEPREFIX`); add `-B` if you must.

**Limits.**

- `host.ask` — at most 6 questions a minute per extension (refused past that), one on screen, up to 8 waiting.
- `host.forward` — at most 16 different forwards (node, host, port) per run of the program; the same one asked again
  is the one already open. Forwards close with the program.
- The program ends (crashes or exits by itself) — its process group gets SIGTERM at once and SIGKILL 2 s later: the
  `curl` and `ssh` it started don't outlive it.
- Secrets the app handed out (`host.nodeSecret`, `host.secret`, a storage's secret fields, a model provider's key, a
  server module's secret settings) are replaced with “[hidden]” in the extension's log and in a storage's error text —
  exact values of 4 characters or more only. It is a safety net, not a licence: don't print secrets (a changed value —
  `base64`, a piece — isn't recognized).

## Trying it

```sh
sshkipper-ext run render --settings '{"…": "…"}'           # host.exec runs here
sshkipper-ext run render --ssh deploy@web-1                # host.exec runs there, over your ssh
sshkipper-ext preview main --ssh deploy@web-1               # the rendered page as text
```

The stand-in host keeps `host.store` in `.sshkipper-dev-store.json` and prints notifications and logs.

## Start-up: `setup`

`defineModule({ setup: async ({ app, locale, module }) => { … }, handlers })` runs once, before the program answers
`initialize`. The app waits **15 seconds** for that answer, then ends the program and the call fails with «… запустилась, но
не ответила на initialize (Модуль не ответил за 15 с)». Keep `setup` short (read a config, open a file); do slow work — a cache to warm, a connection to a
remote API — on the first call that needs it. Calls that arrive while `setup` runs wait for it; a `setup` that throws
fails them all with «setup failed: …».

## Another language

Read lines from stdin, write lines to stdout:

1. answer `initialize` with `{"handlers": [...]}` — within 15 seconds of starting, or the app ends the program;
2. answer each `handler/call` (params: the request) with the handler's result or a JSON-RPC error;
3. send `host/exec`, `host/store/get`… requests with your own ids and wait for their answers;
4. stop on `shutdown` or when stdin closes. Write logs to stderr.

The example: [examples/http-checks](../../examples/http-checks) — URL checks from the server (curl through
`host.exec`) or from this Mac (`fetch`), history in `host.store`, a notification when a URL goes down, a rendered
page with a chart and a page per URL, an AI tool.
