// __TITLE__: automation blocks of a program, SSHKipper SDK 1 (spec/protocol.md §8.1). A step calls the block's
// handler here, on this Mac, with the card's parameters as `input`. `server: true` gives the block a server: its
// `host.exec` goes through the automation's session (its profile, «without a person» on a schedule). The answer is
// the step's result: `{status, summary, value, unit, items}`; other keys become `{{ in.<key> }}` for the next blocks.

import { defineModule, ModuleError, quote, tr } from "./lib/sshkipper-sdk/index.ts";

defineModule({
  handlers: {
    async disk_free(input, ctx) {
      const mount = String(input.mount ?? "/");
      const r = await ctx.host.exec(`df -P -k ${quote(mount)}`, { timeout: 20 });
      if (r.exitCode !== 0) throw new ModuleError(r.stderr.trim() || `df failed (${r.exitCode})`);
      const used = Number(r.stdout.trim().split("\n").pop()?.split(/\s+/)[4]?.replace("%", ""));
      if (!Number.isFinite(used)) throw new ModuleError("df said something unexpected");
      const free = 100 - used;
      // The summary is what the run's result says: in the user's language (ctx.locale).
      const summary = tr(ctx, { en: `${mount}: ${free}% free`, ru: `${mount}: свободно ${free}%` });
      return { status: free < 10 ? "error" : free < 20 ? "warn" : "ok", summary, value: free, unit: "%", mount };
    },
    threshold(input, ctx) {
      const value = Number(input.value), min = Number(input.min ?? 20);
      const status = value >= min ? "ok" : value >= min / 2 ? "warn" : "error";
      const summary = status === "ok" ? tr(ctx, { en: `${value} — above ${min}`, ru: `${value} — выше ${min}` })
        : tr(ctx, { en: `${value} — below ${min}`, ru: `${value} — ниже ${min}` });
      return { status, summary, value };
    },
  },
});
