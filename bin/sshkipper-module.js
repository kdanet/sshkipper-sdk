#!/usr/bin/env node
// sshkipper-module — the old name of sshkipper-ext: the same commands, one line to say so (not in `mcp`, whose stdout
// is the protocol and whose stderr a client may show as an error).
const argv = process.argv.slice(2);
if (argv[0] !== "mcp") console.error("sshkipper-module is now sshkipper-ext — the same commands; `call` is `run`.");
await import("./sshkipper-ext.js");
