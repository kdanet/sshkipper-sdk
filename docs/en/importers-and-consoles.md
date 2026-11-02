# Importers and consoles

Two contributions of an extension that run as a program on this Mac (`runtime.kind: "process"`): an **importer**
turns another program's file into folders and connections, a **console** streams a text console into a terminal tab
of the app. The protocol is in [spec/protocol.md](../../spec/protocol.md) §15 and §16; the examples are
[examples/import-csv](../../examples/import-csv) and [examples/console-echo](../../examples/console-echo).

## An importer

```json
"contributes": {
  "import": [{
    "id": "csv",
    "title": { "ru": "Таблица серверов (CSV)", "en": "Server table (CSV)" },
    "fileExtensions": ["csv", "tsv"],
    "maxSizeMB": 2
  }]
}
```

The user picks the file (File → Import → «Таблица серверов (CSV)…»). The app reads it — up to 8 MB, or your `maxSizeMB`
— and calls your importer with its bytes; you never get the path. Return folders and connections:

```ts
import { defineModule } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {},
  importers: {
    csv: (file, ctx) => ({
      nodes: [
        { type: "folder", name: "Production", children: [
          { type: "connection", id: "j", name: "jump", host: "bastion.example.net", port: 2222, user: "ops" },
          { type: "connection", name: "web-1", host: "10.0.1.11", user: "deploy", bastion: "j", tags: ["prod"] },
        ] },
      ],
      warnings: ["line 7: no address — skipped"],
    }),
  },
});
```

- `file` is `{ importer, name, size, data: Uint8Array, text() }`. Throw `ModuleError` for a file you can't read:
  the user sees your message.
- **Passwords and keys go apart.** If the format carries them, return a credential (a login only) and the secret
  separately — the app asks the user before it keeps any:

  ```ts
  credentials: [{ id: "c1", name: "deploy @ web-1", user: "deploy" }],
  secrets: [{ credential: "c1", kind: "password", value: "…" }],
  // and on the connection: credential: "c1"
  ```
- `bastion` is another connection of the answer (its `id`, else its `name`) or one of the user's document, by name.
- The app checks the answer before it changes anything: an address or a login starting with `-` or with spaces, a
  port outside 1…65535, an unknown `credential` stop the import with the place («nodes[2].port — …»). Keep to the
  limits: 5 000 items, 12 levels.
- What happens next is the app's: the same question, merge and undo as its own ~/.ssh/config import. A second import
  of an updated file updates the same nodes (found by folder and name) and keeps the fields the user edited.

Try it without the app: `node --test` the parsing (the example keeps it in `csv.ts`, apart from `module.ts`).

## A console

```json
"contributes": {
  "console": [{ "id": "sol", "title": "IPMI SoL", "appliesTo": ["connection"] }]
}
```

A server's menu gets «Console: IPMI SoL» («Консоль: IPMI SoL» in Russian). The app opens a terminal tab — its own terminal, with find, copying and
the session log — and calls your console with a session:

```ts
defineModule({
  handlers: {},
  consoles: {
    sol: (session, ctx) => {
      session.write(`Connected to ${session.node.name}\r\n`);
      session.onInput((bytes) => device.write(bytes));      // what the user typed
      session.onResize((cols, rows) => device.resize(cols, rows));
      session.onClose(() => device.end());                   // the tab closed
      device.on("data", (b) => session.write(b));
      device.on("end", () => session.close("the device hung up"));
    },
  },
});
```

- Bytes are bytes: write what the device sends (ANSI colours included), `\r\n` for a new line. The terminal sends
  what a key means (Return is `\r`, arrows are escape sequences) — a serial line has no local echo, so echo what the
  device would.
- `session.node` is `{ id, name, host, port, user }` — no password; ask for your own secret setting with
  `ctx.host.secret(key)` (`secrets` permission). While the console is open, `ctx.host.exec` may run commands on that
  server (`exec` permission).
- A console of your own node type (`appliesTo: ["<type>"]`) gets the node as its screen does: `session.node` and
  `ctx.node` carry `type`, `settings`, `links` and the keys of the secrets that are set, `host`/`port`/`user` are the
  server its `node` field points at; `ctx.host.nodeSecret(key)` reads its secret fields, `ctx.host.exec` runs on that
  server.
- Output is limited to a 4 MB burst and 2 MB a second; what's above is dropped and the terminal says so.
- `session.close(reason)` ends it from your side; the tab shows the reason and offers to open it again. If your
  program exits, every console it had closes the same way.
- A graphical console (KVM, VNC) can't be an extension's console: the app draws no pixels of an extension.

[examples/console-echo](../../examples/console-echo) is a pretend serial device — boot log, echo, line editing,
colours, `size`, `flood N` to see the limit — with no shell, port or network behind it.
