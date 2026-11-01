// __TITLE__: a console of SSHKipper SDK 1 (spec/protocol.md §16). The app opens it from a connection's menu
// («Консоль: …») in its own terminal: what the user types comes to `onInput`, what you `write` is drawn. The node's
// address and login come with it, never a password. This start echoes lines; a real console relays the bytes to the
// provider's gateway (a WebSocket, a serial-over-LAN session…) and back.

import { defineModule, type ConsoleSession } from "./lib/sshkipper-sdk/index.ts";

function serial(s: ConsoleSession) {
  let line = "";
  s.write(`\x1b[1mConnected to ${s.node.name ?? s.node.host ?? "the device"}\x1b[0m (${s.cols}×${s.rows}). Type «exit» to leave.\r\n> `);
  s.onInput((bytes) => {
    for (const ch of new TextDecoder().decode(bytes)) {
      if (ch === "\r") {
        s.write("\r\n");
        if (line.trim() === "exit") return s.close("the device said goodbye");
        if (line) s.write(`you typed: ${line}\r\n`);
        line = "";
        s.write("> ");
      } else if (ch === "\x7f") {
        if (line) { line = line.slice(0, -1); s.write("\b \b"); }
      } else if (ch === "\x04") {
        return s.close("Ctrl-D");
      } else if (ch >= " ") {
        line += ch;
        s.write(ch);
      }
    }
  });
  s.onResize((cols, rows) => s.write(`\r\n[size ${cols}×${rows}]\r\n> ${line}`));
}

defineModule({
  handlers: {},
  consoles: { serial },
});
