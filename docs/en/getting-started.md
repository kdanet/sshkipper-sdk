# Getting started

## 1. The command line

Node.js 24 or later. Install the CLI as a package — npm builds it to JavaScript (Node runs TypeScript as is, but not
inside `node_modules`):

```sh
npm install -g github:kdanet/sshkipper-sdk   # or a tarball: npm pack in a clone → npm install -g sshkipper-sdk-1.1.0.tgz
sshkipper-ext help
```

Or work from a clone, the TypeScript as is — changes to the SDK apply at once:

```sh
git clone https://github.com/kdanet/sshkipper-sdk.git
cd sshkipper-sdk && npm install && npm link   # TypeScript and Node's types are its only (dev) dependencies
```

Without either: `node /path/to/sshkipper-sdk/packages/cli/sshkipper-ext.ts …`. Every command has `--help`. The old
name `sshkipper-module` still works (one line says it was renamed; its `call` is `run`).

## 2. An extension

```sh
sshkipper-ext new disks --id dev.acme.disks --title "Disks"
cd disks
sshkipper-ext validate
```

`new` writes an extension that already works — by default a **service** of servers made of shell scripts: the
**service** shows up where `df` answers; a **page** with rings and rows; an **action** “Refresh”; an **AI tool**
`disk_usage`; an **automation block** “Disk usage” of one mount point. `--process` — the same as a program in
TypeScript on this Mac.

```
disks/
  sshkipper-extension.json   the manifest: what it adds and which handler does what
  scripts/detect.sh          {"found": true} where the service is
  scripts/summary.sh         {"text": "/ — 71%", "status": "ok"} — the line next to it in the tree
  scripts/list.sh            the page's data
  scripts/usage.sh           the automation block
  views/main.json            the page: a template over data.list
```

`--kind` starts from another contribution instead — each one works from the first minute and its README says how to
try it:

| `--kind` | What you get | Read next |
|---|---|---|
| `service` | a service of servers (scripts; `--process` — a program) | [server](server-modules.md), [process](process-modules.md) |
| `database` | a database engine with the app's whole database tab (reads tables from a JSON file) | [database drivers](database-drivers.md) |
| `storage` | a kind of storage for the file panel and transfers | [storages and sources](storage-and-sources.md) |
| `source` | a live folder of servers in the tree | [storages and sources](storage-and-sources.md) |
| `node-type` | a node of your own with its card and a live screen in a tab | [node types](node-types.md) |
| `import` | another program's file into folders and connections | [importers and consoles](importers-and-consoles.md) |
| `console` | a text console in the app's terminal | [importers and consoles](importers-and-consoles.md) |
| `ai` | a model provider for Settings → AI | [AI and automation](ai-and-automation.md) |
| `automation` | automation blocks answered by a program | [AI and automation](ai-and-automation.md) |

A program in Swift instead of TypeScript: [Swift](swift.md).

## 3. Running it without the app

```sh
sshkipper-ext run summary                     # the handler, here, with sh
sshkipper-ext run summary --ssh deploy@web-1  # the same on a server, over your ssh
sshkipper-ext preview main --run              # the page as text, with what its handlers return
```

`run` gives the handler what the app gives it: the request on stdin, `SK_*` variables, the SDK prelude, other
files of `scripts/` for `sk_file`. `--input '{"mount": "/var"}'`, `--settings '{…}'`, `--secret key=value` — the rest.
A name with a slash is a contribution's own method of a program: `run source/poll --params '{…}'`,
`run import/parse --file servers.txt --importer hosts`. `preview` lives a live screen through events:
`preview tasks --events '[{"type": "open"}, {"type": "press", "value": {"item": "add"}}]'`.

## 4. In SSHKipper

1. Settings → Extensions → **Development folder…** → pick `disks/`. A linked folder is reloaded as you save files.
2. Open a connection: its **Services** now list “Disks” (automatic: on where `detect` finds it), with the module's
   settings under it. The sidebar shows the service under the server; the server's services tab has its section.
3. The section is your page, drawn with the app's own parts. Its «⋯» menu has your actions; the extension's «⋯» in
   Settings → Extensions has Log… — what each handler printed to stderr, how long it took, what failed.

## 5. Make it yours

- Change `scripts/list.sh` to print your data as JSON — the prelude's `sk_json_string` and `sk_json_kv` write JSON
  without `jq`.
- Change `views/main.json`: blocks are listed in [UI-Kit](ui-kit.md); `{{ data.list.… }}` takes what `list` returned.
- Add an action: a handler, then `actions: [{"id", "title", "handler", "risk": "change", "confirm": "…"}]`, and put its
  id in a row's `actions` — it shows in the row's menu and asks before it runs.
- `sshkipper-ext validate` after each change says what the app would of the manifest and the templates of
  `views/*.json`. A view a `render` handler builds it doesn't see — `sshkipper-ext preview <page> --run` checks that.

## 6. Share it

```sh
sshkipper-ext pack            # → dev.acme.disks-0.1.0.sshkext
```

Settings → Extensions → **Install extension…** takes the file; the app shows what the extension adds and asks
for (permissions, commands on servers, AI tools) before installing. See [Publishing](publishing.md).
