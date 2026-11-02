# Hetzner Cloud — a source contribution

**Shows:** a live folder of servers (spec/protocol.md §12.2): `source/poll` asks the Hetzner Cloud API
(`GET /v1/servers`, pages) with a secret token field, labels become tags, folders by location or by a label, the
address to connect to (public IPv4/IPv6 or the private network) and a bastion by a connection's name. Hosts never go
into the document; host keys never come from the extension. `fixtures/servers.json` is what the tests' stand-in API
answers.

**Contributes:** `source` (kind `hetzner-cloud`). Permissions: `network`, `secrets`.

```sh
sshkipper-ext validate examples/example-hetzner-source
# A stand-in API on 127.0.0.1 serving fixtures/servers.json, then:
sshkipper-ext run examples/example-hetzner-source source/poll --params '{"source": {"node": "t", "kind": "hetzner-cloud", "settings": {"token": "…", "api": "http://127.0.0.1:8080/v1"}}}'
```

**In SSHKipper:** Settings → Extensions → Development folder… → File → Server source → «Hetzner Cloud…» → the token → a live folder in the
tree, polled every 5 minutes. Guide: [storages and sources](../../docs/en/storage-and-sources.md).

**По-русски:** источник — живая папка серверов проекта Hetzner Cloud по API: секретный токен, метки как теги, папки по
расположению, бастион по имени подключения. Руководство — [хранилища и источники](../../docs/ru/storage-and-sources.md).
