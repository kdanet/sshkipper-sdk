# Publishing

## Packing

```sh
sshkipper-ext pack            # validates, then → <id>-<version>.sshkext (or .sshkmod for sshkipper-module.json)
sshkipper-ext pack -o dist/queues.sshkext
```

A package is a ZIP of the folder with the manifest at its root: `.sshkext` for an extension
(`sshkipper-extension.json`), `.sshkmod` for a module (`sshkipper-module.json`) — exactly the files the app hashes
(everything but `.git` folders and `.DS_Store`). Limits: 2 000 files, 64 MB; no symbolic links, no paths leaving the
folder. A compiled program (Swift, Go, Rust) goes in as its binary: build it outside the folder so the build tree
isn't packed ([Swift](swift.md)).

## Installing

Settings → Extensions → **Install extension…** takes a folder, a `.sshkext` or a `.sshkmod` (a double click on
the file in Finder does the same). Before installing, the app shows what the extension adds (its contributions),
where its code runs, the permissions in words, its AI tools and automation blocks, and that the author isn't verified.
It copies the package into its own folder and records the SHA-256 of every file.

- A program's files are hashed again **before every start**: a changed, added or removed file stops it, and the
  extension is marked changed until the user approves it again (“Allow as is”).
- **Development folder…** links a folder instead of copying it: the app reloads it as files change and marks it
  «из папки». Use it while writing.
- The «⋯» menu of an extension in the list: Log… (what each handler wrote to stderr, how long it took, what
  failed), Finder, remove.

## Versions

- `version` is semantic. A new version installed over an old one keeps the users' settings (they are keyed by `id`
  and setting `key`): rename a setting only with a major version, and read the old key for a while.
- An update that adds a permission or a contribution is installed **switched off** until the user switches it on.
- `sdk` is the protocol's major version. A new major version of the protocol comes with a new number; the app keeps
  running extensions of the versions it knows and refuses newer ones with «update SSHKipper».

## The library

SSHKipper's own library of extensions it reviewed — «Проверено SSHKipper» — is a signed index: authors send a pull
request with the sources, the extension is read and built by its CI, and the owner signs the index (no binaries from
authors). An installed extension shows «Проверено SSHKipper» while its id, version and files match the index's record.
The library isn't published yet; until then share the package file or a link to a release.

## Before you share

- `sshkipper-ext validate` is clean (warnings explained in your README).
- Text parameters that reach scripts have a `pattern`.
- Every `change`/`danger` action has a `confirm` question that names what it changes.
- Tool descriptions say what they return.
- The README says what the extension needs (on the server: `redis-cli`, `systemctl`…; on this Mac: Node 24 for a
  TypeScript program) and what it changes.
