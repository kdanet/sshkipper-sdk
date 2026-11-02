# Site checks — a node type with its screen

**Shows:** a node of the extension's own in the user's tree (spec/protocol.md §14): its card from `fields` (addresses,
an interval, a choice, a secret token kept as the document's secret, a link to a server), and a tab — checks on the
left, a live chart and the history on the right (`split`, `toolbar`, `ui/push`), «Clear history…» behind `host.ask`, a
terminal on the linked server through `host.open` (the user confirms the command), the token through
`host.nodeSecret`. No network: it checks addresses of this Mac and serves them itself.

**Contributes:** `nodeType` (`checks`), `screen` (`checks`, a tab). Permissions: `secrets`, `store`.

```sh
sshkipper-ext validate examples/node-type-sitechecks
sshkipper-ext preview examples/node-type-sitechecks checks --node '{"id": "n1", "name": "Sites", "type": "ext:dev.sshkipper.example.sitechecks/checks", "settings": {"demo": true, "interval": 5}, "links": {}, "secrets": []}' --events '[{"type": "open"}]' --wait 3000
```

**In SSHKipper:** Settings → Extensions → Development folder… → File → From extensions → «Site checks…» → a double click opens the tab. Guide:
[node types](../../docs/en/node-types.md).

**По-русски:** свой тип узла: карточка из полей (адреса, интервал, секретный токен, ссылка на сервер) и вкладка с
живым графиком, вопросом `host.ask` и терминалом через `host.open`. Руководство — [свой тип узла](../../docs/ru/node-types.md).
