# Security

SSHKipper keeps passwords, keys and 2FA secrets of many servers. A module gets only what it needs for its own
work, and the user sees what that is before installing it.

## What the app guarantees

- **Nothing of a module runs in the app.** Server scripts run on the server; a process module is a separate program
  with a clean environment. Pages are JSON drawn by the app — no HTML, no scripts in the page.
- **The user installs modules**, from a file or a folder; the app shows the permissions, what runs on servers, the
  AI tools and the automation blocks first. Agents and documents can't install modules.
- **Integrity.** Every file of an installed module is hashed; a changed file turns the module off until the user
  approves it again.
- **Credentials stay in the app.** A module never sees the server's password, keys or 2FA codes: server scripts run
  over the app's session; a process module asks the app (`host.exec`) and may name only the servers of the call.
- **Secrets as files.** A secret setting reaches a server script as a 0600 file in a private folder removed after the
  run (its path in `SK_SECRET_<KEY>`), never on a command line; it isn't in `context.settings`; in a container it
  isn't passed at all.
- **Values are checked.** Parameters of actions, tools and blocks are checked against their `params` (types,
  choices, `pattern` in full) before a handler runs; unknown keys are dropped.
- **Changes ask.** `change` and `danger` actions ask the user first; the agent's calls go through the server's AI mode
  and confirmations like its own commands; automation steps go through the automation's approval.
- **Permissions are enforced** where the app is in the path: `host.exec` without `exec`, `host.secret` without
  `secrets`, `host.store` without `store` fail; secret settings without `secrets` aren't offered.
- **Limits.** Timeouts stop the whole process group on the server; output is capped (8 MB from a script, 16 MB a
  JSON-RPC line); views are capped (400 blocks, 2 MB); stopped pages stop their calls.

## What is "as far as possible"

- A process module is a program with the user's rights on this Mac: `network` (and what it does with files) is a
  declaration the user reads, not a sandbox. Install programs from people you trust — as with any app.
- A server script runs with the rights of the connection's user (and root through `sudo -n` where allowed): it can
  do on the server what that user can. Read a module's scripts before giving it `sudo`.
- An agent can call a module's tools only within the server's AI mode; a tool that changes things is as safe as its
  `risk` is honest. Review `risk` when you install a module.

## For module authors

- Give every text parameter that reaches a script a `pattern`; quote every variable; never `eval` input.
- Don't print secrets: stderr goes to the module log, stdout to pages, models and automation runs.
- Use `quote()` (TypeScript) for values in `host.exec` commands.
- Ask for the least: no `sudo` if a handler can do without; `sudo: never` on handlers that read.
- Don't fetch code at run time (`curl … | sh`): what runs should be what the user approved.
