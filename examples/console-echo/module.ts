// «Учебная консоль» — an example console (spec/protocol.md §13). The app opens it from a server's menu («Консоль:
// Учебная консоль») in a terminal tab of its own; this program answers `console/open`, streams the device's output
// (`console/data`) and gets what the user types (`console/input`), the terminal's size (`console/resize`) and the tab's
// end (`console/close`). The device is pretend (device.ts): no shell, no port, no network.

import { defineModule } from "./lib/sshkipper-sdk/index.ts";
import { Device } from "./device.ts";

defineModule({
  handlers: {},
  consoles: {
    echo: (session, ctx) => {
      const device = new Device({
        write: (t) => session.write(t),
        close: (reason) => session.close(reason),
        size: () => ({ cols: session.cols, rows: session.rows }),
      }, session.node.name ?? "device", ctx.locale.startsWith("ru"));
      session.onInput((d) => device.input(d));
      session.onClose(() => device.stop());
      device.boot();
    },
  },
});
