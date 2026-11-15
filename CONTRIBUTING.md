# Contributing

Thanks for helping. Issues and pull requests are welcome at
[github.com/kdanet/sshkipper-sdk](https://github.com/kdanet/sshkipper-sdk).

## Setting up

Node.js 24 or later; Swift 6 for the Swift package (macOS).

```sh
git clone https://github.com/kdanet/sshkipper-sdk.git && cd sshkipper-sdk
npm install && npm link    # sshkipper-ext from this clone, its TypeScript as is
```

## Checks

Run them before a pull request:

```sh
npm test                   # node --test tests/*.test.ts, then tsc --strict (SDK, tests, examples, a new extension of every kind)
npm run validate           # every example passes the app's checks and packs
npm run swift              # the Swift package's tests and swift-hello (built in $TMPDIR)
```

- `SSHKIPPER_SDK_DOCKER=1 npm test` — the shell parts on busybox (Alpine) and dash + mawk (Debian), with
  `alpine:3.22` and `debian:bookworm-slim` already on the machine (nothing is pulled).
- `npm run docs` after changing `packages/sdk/src/catalog.ts` or `schemas/symbols.json`: `docs/*/ui-kit-reference.md`
  are generated, and a test fails while they are stale.
- `sshkipper-ext vendor <example>` after changing the runtime (`packages/sdk/src/module.ts`): the TypeScript examples
  carry a copy in `lib/sshkipper-sdk/`, and a test checks it is current.

## The public contract

The app checks this repository against its own code: `schemas/symbols.json`, `spec/prelude.sh`,
`tests/conformance/` and the examples. A change to any of them, to `schemas/*.schema.json` or to the behaviour
`spec/*.md` describes is a **protocol change**: say so in the pull request, update the spec, the schemas, both
languages of the docs and [CHANGELOG.md](CHANGELOG.md), and keep extensions of `"sdk": 1` working.

## Style

- TypeScript that Node runs as is: erasable syntax only (no `enum`, no `namespace`, no parameter properties), `.ts`
  extensions in imports, `import type` for types, no runtime dependencies.
- Shell for servers is POSIX `sh` — no bashisms, no `jq`; JSON through the prelude (`sk_json_string`, `sk_json_kv`).
- Comments in English, short, saying why. Messages of the CLI say what is wrong and what to do next.
- Docs: `docs/en` and `docs/ru` keep the same files and sections; one word for one thing — [the glossary](docs/glossary.md).
  The app's interface is Russian, so its labels (`«Службы»`, `«Стоп»`) are quoted as the user sees them.
- An example has a README in one format: **Shows**, **Contributes**, **Try it**, **In SSHKipper**, **По-русски**.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
