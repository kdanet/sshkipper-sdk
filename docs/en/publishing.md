# Publishing

## Packing

```sh
sshkipper-module pack            # validates, then → <id>-<version>.sshkmod
sshkipper-module pack -o dist/queues.sshkmod
```

A `.sshkmod` is a ZIP of the module folder with the manifest at its root: exactly the files the app hashes
(everything but `.git` folders and `.DS_Store`). Limits: 2 000 files, 64 MB.

## Installing

Settings → Extensions → Modules → **Install module…** takes a `.sshkmod` or a folder. Before installing, the app
shows what the module asks for: permissions, what runs on servers, its AI tools and automation blocks. It copies the
module into its own folder and records the SHA-256 of every file.

- A changed file of an installed module turns the module off until the user approves it again (“Allow as is”).
- **Connect folder for development…** links a folder instead of copying it: the app reloads it as files change
  and marks it “from a folder”. Use it while writing.
- A module can be turned off, removed, or its log opened from the same list.

## Versions

- `version` is semantic. A new version installed over an old one keeps the users' settings (they are keyed by `id`
  and setting `key`): rename a setting only with a major version, and read the old key for a while.
- `sdk` is the protocol's major version. A new major version of the protocol comes with a new number; the app keeps
  running modules of the versions it knows.

## A catalog

A public catalog of modules (a GitHub repository with a list of `.sshkmod` releases and their hashes) is planned;
until then share the file or a link to a release.

## Before you share

- `sshkipper-module validate` is clean (warnings explained in your README).
- Text parameters that reach scripts have a `pattern`.
- Every `change`/`danger` action has a `confirm` question that names what it changes.
- Tool descriptions say what they return.
- The README says what the module needs on the server (`redis-cli`, `systemctl`…) and what it changes.
