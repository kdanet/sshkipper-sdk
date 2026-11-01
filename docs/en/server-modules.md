# Server modules

`"runtime": {"kind": "server"}` — every handler is a POSIX `sh` script of the module that the app runs **on the
server**, over the SSH session it already has: through the user's bastions and 2FA, in a container when the service
lives in one, through `sudo -n` when allowed. Nothing is installed on the server and nothing runs on the Mac.

## What a script gets

| | |
|---|---|
| stdin | the request as JSON: `{"handler", "input", "context": {"server", "container", "settings", "item", "locale", "sdk", "app"}}` |
| `SK_INPUT_<KEY>` | each value of `input` (numbers as text, booleans `1`/`0`, lists and objects as JSON) |
| `SK_SETTING_<KEY>` | each non-secret setting of the connection |
| `SK_SECRET_<KEY>` | the **path** of a 0600 file with a secret setting (needs `secrets`); `sk_secret key` prints it |
| `SK_ITEM_ID` | the row's id, for `on: item` actions and item pages |
| `SK_CONTAINER` | the container's name when it runs in one |
| `SK_AUTOMATION` | `1` when it runs as an automation block |
| `SK_TMP` | a private 0700 folder, removed after the run (also the working directory) |
| `SK_HANDLER`, `SK_MODULE`, `SK_SDK`, `SK_LOCALE` | which handler, which module, `1`, `ru`/`en`/… |

Values come over the session, not on the command line: other users of the server don't see them in `ps`.

## The prelude

Defined before your script ([spec/prelude.sh](../../spec/prelude.sh)), because `jq` isn't on every server:

```sh
sk_json_string "$name"                 # "a \"quoted\" name"
sk_json_kv state active pid 1234       # {"state":"active","pid":"1234"}
sk_fail "no such queue: $q"            # to stderr, exit 1 — the user sees this line
sk_has supervisorctl || sk_fail "supervisor isn't installed"
sk_file scripts/lib.awk > "$SK_TMP/lib.awk"   # another file of the module's scripts/
sk_secret token                        # the secret setting “token”
```

## Output

- `output: "json"` (default) — print **one** JSON value. Build it with `printf` and `sk_json_string`, or with awk:

  ```sh
  printf '{"queues": ['
  first=1
  for q in $(redis-cli --raw keys 'queues:*'); do
    [ $first = 1 ] || printf ','; first=0
    n=$(redis-cli --raw llen "$q")
    printf '{"name": %s, "waiting": %d}' "$(sk_json_string "${q#queues:}")" "$n"
  done
  printf ']}'
  ```

- `output: "text"` — stdout as a string; `"lines"` — an array of lines.
- stderr is the log: the module's log in the app keeps it; on a failure its **last line** is the message.
- A non-zero exit is a failure. `timeout` (30 s by default) stops the whole process group on the server; so does
  closing the page.

## Sudo

Don't call `sudo` in a script (it would wait for a password). Say what the handler needs:

- `"sudo": "auto"` (default) — through `sudo -n` when the server's “Use sudo -n” is on and the module has the `sudo`
  permission; when sudo asks for a password anyway, the app runs it as the user and remembers that for the session;
- `"required"` — fails with a clear message where sudo isn't allowed. What the app runs by itself — `detect`, and the
  summary of a service left on «Automatic» — never gets sudo (switch the service on for a server to give it sudo
  there); in a container sudo doesn't apply — the handler runs as `docker exec`'s user;
- `"never"`.

## Containers

`"service": {"containers": true}` lets the user say the service runs in a Docker container of the server
(“Where it runs”). The handler then runs in `docker exec -i <container> sh` (the server's docker path and sudo), with
`SK_CONTAINER` set. In a container, secrets aren't passed (a container's command line is readable on the server);
a handler that needs one fails with a message.

## Writing scripts that work everywhere

- POSIX `sh`: dash on Debian, busybox ash on Alpine. No `[[ ]]`, arrays, `local -n`, `echo -e`.
- awk is POSIX awk (mawk, busybox): no `gensub`, `asort`; `sub()` turns a number into text — `x += 0` before comparing.
- Prefer `printf` to `echo`; quote every variable.
- `command -v` (or `sk_has`) before a tool that may be missing, with a message that says what to install.
- Text parameters reach your script: give them a `pattern` in the manifest — the app checks values before running.
- Keep handlers quick: a page waits for its data handlers.

## Trying them

```sh
sshkipper-ext run list --settings '{"artisan": "/var/www/app/artisan"}'            # here
sshkipper-ext run list --ssh deploy@web-1                                            # on a server (your ssh)
sshkipper-ext run restart --ssh deploy@web-1 --item '{"id": "mail"}' --secret token=…
```

The examples: [examples/processes](../../examples/processes) — load, memory, the busiest processes, a process page,
TERM/HUP/KILL actions with confirmations, an AI tool, an automation block.
