# Storages and sources

An extension can add a **kind of storage** — files in the app's file panel, the transfer queue and automations — and a
**kind of source** — a live folder of servers in the tree. Both are answered by the extension's program on this Mac
(`runtime: process`); the app draws everything itself. The normative description is
[spec/protocol.md §12](../../spec/protocol.md); two working examples are in `examples/`:

| Example | What it shows |
|---|---|
| [`example-folder-storage`](../../examples/example-folder-storage) | A storage whose files are in a folder on this Mac: every `storage/*` method, uploads in parts, a safe path check |
| [`example-hetzner-source`](../../examples/example-hetzner-source) | The servers of a Hetzner Cloud project (`GET /v1/servers`): a secret token, pages, labels as tags, folders by location, a bastion by name |

## A storage

```json
"contributes": {
  "storage": [{
    "id": "folder", "title": "A folder on this Mac", "signIn": "none",
    "fields": [{ "key": "root", "type": "path", "title": "Folder" }],
    "capabilities": ["folders", "rename", "delete", "freeSpace", "check"]
  }]
}
```

- `fields` become the storage's card (the same field types as a module's settings). A `secret` field needs the
  `secrets` permission; the value is kept encrypted in the document and comes to the program in `storage.settings`.
- `capabilities` say what the panel offers besides browsing, downloading and uploading: new folders, rename, delete,
  public links, free space, the program's own «Проверить». What isn't declared isn't in the menus.
- `signIn: "browser"` adds «Войти через браузер…» to the card (needs `oauth`): the app calls `storage/signIn`, the
  program calls `host.oauth(...)`, the token becomes the node's secret and comes back as `settings.oauth`.

```ts
import { defineModule, storageMethods } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {},
  methods: storageMethods({
    list: async (path, storage) => [...],          // [{ name, type: "file" | "folder", size, modified }]
    stat: async (path, storage) => null,           // or an item
    read: async (path, offset, length, storage) => ({ data, eof }),
    write: { begin, chunk, commit, abort },        // nothing appears before commit
    mkdir, rename, delete, check,                  // as the capabilities say
  }),
});
```

**Through a server.** The user may bind the storage to a server («Через сервер» in its card); `storage.throughServer`
is then true. With the `forward` permission, `ctx.host.forward({ node: storage.node, host, port })` gives a port on
127.0.0.1 of this Mac forwarded over the app's SSH session (bastions, 2FA included); it closes with the program and when
nothing uses the storage any more.

**What the app doesn't do for an extension's kind:** copy between a server and the storage directly, or upload from
a server by its cron in automations — those need the storage's protocol on the server. Automations upload from this
Mac instead.

## A source

```json
"contributes": {
  "source": [{
    "id": "hetzner-cloud", "title": "Hetzner Cloud", "refresh": 300,
    "fields": [{ "key": "token", "type": "secret", "title": "API token" }]
  }]
},
"permissions": ["network", "secrets"]
```

```ts
import { defineModule, sourceMethods } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {},
  methods: sourceMethods({
    async poll(source, ctx) {
      return { hosts: [{ id: "4711", name: "web-1", address: "203.0.113.5", user: "root", group: "Falkenstein" }] };
    },
  }),
});
```

- `id` must stay the same between polls (an API id, not an address): open tabs and the user's settings of the host
  follow it.
- `jump` names a bastion by a connection's name in the user's document; `group` makes a folder under the source.
- Host keys are never taken from a source: the first connection shows the key for checking.
- The user's filters (offline, tags, name) and hidden hosts are applied by the app.

## Checking it

`sshkipper-ext validate <folder>` checks the manifest like the app; `sshkipper-ext run <folder> storage/list --params …`
and `run <folder> source/poll --params …` call the program as the app does. In SSHKipper: Settings → Extensions →
Development folder… → your folder, then File → Storage… → your kind's tile under From extensions, or File → Server
source → «<title>…». The tests in `tests/contributions.test.ts` speak to both examples as the app does — a good start
for your own.
