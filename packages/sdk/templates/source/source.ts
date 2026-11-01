// __TITLE__: a source contribution of SSHKipper SDK 1 (spec/protocol.md §12.2). The app polls `source/poll` every
// `refresh` seconds and shows the hosts as a live folder; they never go into the document, and host keys never come
// from here. The start reads its hosts from the card's «Servers» — ask your inventory's API instead (with the
// «network» permission, and a «secret» field for its token).

import { defineModule, ModuleError, sourceMethods, tr, type FoundHost, type SourceRef } from "./lib/sshkipper-sdk/index.ts";

/** «web-1 10.0.0.5:22 deploy group» → a host. Its id must stay the same between polls: the name here. */
function host(line: string, s: SourceRef): FoundHost | null {
  const [name, address, user, group] = line.trim().split(/\s+/);
  if (!name || !address) return null;
  const m = address.match(/^(.+?)(?::(\d+))?$/)!;
  if (m[1].startsWith("-") || /\s/.test(m[1])) throw new ModuleError(`«${name}»: a bad address`);
  return {
    id: name, name, address: m[1],
    ...(m[2] ? { port: Number(m[2]) } : {}),
    user: user ?? String(s.settings.user ?? "root"),
    ...(group ? { group } : {}),
    online: true,
  };
}

function hosts(s: SourceRef): FoundHost[] {
  const list = Array.isArray(s.settings.hosts) ? s.settings.hosts.map(String) : String(s.settings.hosts ?? "").split(/[\n,]/);
  return list.map((l) => host(l, s)).filter((h): h is FoundHost => h !== null);
}

defineModule({
  handlers: {},
  methods: sourceMethods({
    poll: (s) => ({ hosts: hosts(s) }),
    check: (s, ctx) => {
      const n = hosts(s).length;
      return { text: n ? tr(ctx, { en: `${n} server(s)`, ru: `Серверов: ${n}` }) : tr(ctx, { en: "No servers yet: fill in «Servers»", ru: "Серверов нет: заполните «Серверы»" }) };
    },
  }),
});
