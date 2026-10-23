# Getting started

## 1. The CLI

```sh
git clone https://github.com/kdanet/sshkipper-sdk.git
cd sshkipper-sdk && npm link          # puts sshkipper-module on PATH (Node 24+, no dependencies)
sshkipper-module help
```

Without `npm link`: `node /path/to/sshkipper-sdk/packages/cli/sshkipper-module.ts …`.

## 2. A module

```sh
sshkipper-module new disks --id dev.acme.disks --title "Disks"
cd disks
sshkipper-module validate
```

`new` writes a server module that already works: a **service** that appears where `df` answers, a **page** with
gauges and rows, a **refresh action**, an **AI tool** (`disk_usage`) and an **automation block** («Disk usage» of one
mount point). `--process` writes the same as a TypeScript program instead.

```
disks/
  sshkipper-module.json      the manifest: what the module adds and which handler does each thing
  scripts/detect.sh          {"found": true} where the service is
  scripts/summary.sh         {"text": "/ — 71%", "status": "ok"} — the line next to it in the tree
  scripts/list.sh            the page's data
  scripts/usage.sh           the automation block
  views/main.json            the page: a template over data.list
```

## 3. Run it without the app

```sh
sshkipper-module call summary                     # the handler, here, with sh
sshkipper-module call summary --ssh deploy@web-1  # the same on a server, over your ssh
sshkipper-module preview main --run               # the page as text, with what its handlers return
```

`call` gives the handler what the app gives it: the request on stdin, `SK_*` variables, the SDK prelude, other
files of `scripts/` for `sk_file`. `--input '{"mount": "/var"}'`, `--settings '{…}'`, `--secret key=value` — the rest.

## 4. In SSHKipper

1. Settings → Extensions → Modules → **Connect a Folder for Development…** → pick `disks/`. A linked folder is
   reloaded as you save files.
2. Open a connection: its **Services** now list «Disks» (automatic: on where `detect` finds it), with the module's
   settings under it. The sidebar shows the service under the server; the server's services tab has its section.
3. The section is your page, drawn with the app's own parts. Its «⋯» menu has your actions and «Module Log…» —
   what each handler printed to stderr, how long it took, what failed.

## 5. Make it yours

- Change `scripts/list.sh` to print your data as JSON — the prelude's `sk_json_string` and `sk_json_kv` write JSON
  without `jq`.
- Change `views/main.json`: blocks are listed in [UI-Kit](ui-kit.md); `{{ data.list.… }}` takes what `list` returned.
- Add an action: a handler, then `actions: [{"id", "title", "handler", "risk": "change", "confirm": "…"}]`, and put its
  id in a row's `actions` — it shows in the row's menu and asks before it runs.
- `sshkipper-module validate` after each change says what the app would.

## 6. Share it

```sh
sshkipper-module pack            # → dev.acme.disks-0.1.0.sshkmod
```

Settings → Extensions → Modules → **Install Module…** takes the file; the app shows what the module asks for
(permissions, commands on servers, AI tools) before installing. See [Publishing](publishing.md).
