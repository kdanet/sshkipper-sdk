// «Импорт из CSV» — an example importer (spec/protocol.md §12). The app reads the file the user picked and sends its
// bytes in `import/parse`; the program answers with folders and connections, and the app shows them, asks, and merges
// them into the document like its own ~/.ssh/config import. Passwords from the table come apart (`secrets`): the app
// asks the user before any of them goes into the document.

import { defineModule, ModuleError } from "./lib/sshkipper-sdk/index.ts";
import { parseTable } from "./csv.ts";

defineModule({
  handlers: {},
  importers: {
    csv: (file, ctx) => {
      const text = file.text();
      if (text.includes("\u0000")) throw new ModuleError(ctx.locale.startsWith("ru") ? "Это не текстовая таблица" : "This isn't a text table");
      return parseTable(text, { ru: ctx.locale.startsWith("ru") });
    },
  },
});
