# A folder storage — a storage contribution

**Shows:** a kind of storage whose files are in a folder on this Mac, answering the whole storage protocol
(spec/protocol.md §12.1): listing, reading and writing in parts (an upload goes to a part file in `SK_DATA` and
appears only on commit), folders, renames, deletes, free space and «Проверить»; a path check that never leaves the
folder — no `..`, no symbolic link below it (a link inside could lead anywhere), checked again at commit. The app
draws the file panel, the transfer queue and the card from `fields`.

**Contributes:** `storage` (kind `folder`). Permissions: none.

**Try it** (from the SDK's root, `sshkipper-ext` on PATH):

```sh
sshkipper-ext validate examples/example-folder-storage
sshkipper-ext run examples/example-folder-storage storage/list --params '{"storage": {"node": "t", "kind": "folder", "settings": {"root": "/tmp"}, "readOnly": true, "throughServer": false}, "path": "/"}'
```

**In SSHKipper:** Settings → Extensions → Development folder… → File → Storage… → «Папка на этом Mac» under From extensions → the folder → the file panel.
Guide: [storages and sources](../../docs/en/storage-and-sources.md).

**По-русски:** хранилище-папка на этом Mac — весь протокол `storage/*`: список, чтение и запись частями, папки,
переименование, удаление, проверка. Руководство — [хранилища и источники](../../docs/ru/storage-and-sources.md).
