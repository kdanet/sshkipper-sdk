# Process modules

`"runtime": {"kind": "process", "command": ["node", "module.ts"]}` — a program of the module on this Mac. The app
starts it on first use, talks JSON-RPC 2.0 over its stdin/stdout (one message per line), keeps it while the module
is used and stops it when the module is turned off or updated, all documents lock, or the app quits. Any language
works ([spec/protocol.md §4](../../spec/protocol.md)); the SDK ships a TypeScript runtime for Node 24, which runs
`.ts` files as they are.

## A module in TypeScript

```sh
sshkipper-module new queues --process --id dev.acme.queues
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

`lib/sshkipper-sdk/` is the SDK runtime copied into the module (`sshkipper-module vendor` refreshes it): a module is
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
| `ctx.host.exec(command, {stdin?, timeout?, sudo?, container?, server?})` | `exec` (`sudo`) | runs on the call's server over the app's SSH session; `{exitCode, stdout, stderr}`. Only servers of the call may be named. Quote values with `quote()`. |
| `ctx.host.secret(key)` | `secrets` | a secret setting of the call's server |
| `ctx.host.store.get(key)` / `.set(key, value)` | `store` | the module's JSON storage on this Mac (≤ 1 MB in all); `null` deletes |
| `ctx.host.notify(title, text)` | `notify` | a notification |
| `ctx.host.log(level, message)` | — | the module's log in the app |

The program runs with a clean environment: `PATH` (the folder its program was found in, system paths, Homebrew), `HOME`,
`TMPDIR`, `LANG`, `SK_SDK`, `SK_MODULE`, `SK_DATA` (a private folder for the module's files) and `runtime.env`. It
doesn't get the user's SSH agent or the app's secrets: reach servers through `host.exec`.

## Trying it

```sh
sshkipper-module call render --settings '{"…": "…"}'           # host.exec runs here
sshkipper-module call render --ssh deploy@web-1                # host.exec runs there, over your ssh
sshkipper-module preview main --ssh deploy@web-1               # the rendered page as text
```

The stand-in host keeps `host.store` in `.sshkipper-dev-store.json` and prints notifications and logs.

## Another language

Read lines from stdin, write lines to stdout:

1. answer `initialize` with `{"handlers": [...]}`;
2. answer each `handler/call` (params: the request) with the handler's result or a JSON-RPC error;
3. send `host/exec`, `host/store/get`… requests with your own ids and wait for their answers;
4. stop on `shutdown` or when stdin closes. Write logs to stderr.

The example: [examples/http-checks](../../examples/http-checks) — URL checks from the server (curl through
`host.exec`) or from this Mac (`fetch`), history in `host.store`, a notification when a URL goes down, a rendered
page with a chart and a page per URL, an AI tool.
