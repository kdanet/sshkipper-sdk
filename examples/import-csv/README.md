# Import from CSV — an importer

**Shows:** another program's file read into folders and connections (spec/protocol.md §15): a server table
«name,host,port,user,folder» (and «bastion», «note», «tags», «password» when present), CSV or TSV. The app reads the
file and sends its bytes — the program never gets the path; passwords come apart, as `secrets` of their credentials,
and the app asks before it imports any. `samples/servers.csv` to try.

**Contributes:** `import` (`csv`). Permissions: none.

**Try it** (from the SDK's root, `sshkipper-ext` on PATH):

```sh
sshkipper-ext validate examples/import-csv
sshkipper-ext run examples/import-csv import/parse --file examples/import-csv/samples/servers.csv --importer csv
```

**In SSHKipper:** Settings → Extensions → Development folder… → File → Import → «Таблица серверов (CSV)…» → the file → the question with the
tree of what comes. Guide: [importers and consoles](../../docs/en/importers-and-consoles.md).

**По-русски:** импорт таблицы серверов из CSV/TSV в папки и подключения, пароли — отдельно и только с согласия.
Руководство — [импорт и консоли](../../docs/ru/importers-and-consoles.md).
