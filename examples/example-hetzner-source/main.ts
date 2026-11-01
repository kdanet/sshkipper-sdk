// «Источник Hetzner Cloud» — an example source contribution of SDK 1 (spec/protocol.md §12): `source/poll` asks the
// Hetzner Cloud API for the project's servers (GET /v1/servers, page by page) and answers them as hosts. The API's
// address is a setting, so tests and review point it at a stand-in on this Mac — no real network there.

import { defineModule, ModuleError, sourceMethods, tr, type FoundHost, type MethodContext, type SourceRef } from "./lib/sshkipper-sdk/index.ts";

type Server = {
  id: number;
  name: string;
  status: string;
  public_net?: { ipv4?: { ip?: string } | null; ipv6?: { ip?: string } | null };
  private_net?: { ip?: string }[];
  labels?: Record<string, string>;
  server_type?: { name?: string; description?: string };
  datacenter?: { name?: string; location?: { name?: string; city?: string } };
  image?: { os_flavor?: string; os_version?: string } | null;
};

const text = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);

function api(src: SourceRef): string {
  const a = text(src.settings.api, "https://api.hetzner.cloud/v1").replace(/\/+$/, "");
  if (!/^https:\/\//.test(a) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(a)) {
    throw new ModuleError("API address: https://, or http:// on this Mac (a stand-in)");
  }
  return a;
}

/** Every server of the project, page by page (50 a page, at most 40 pages). */
async function servers(src: SourceRef, ctx: MethodContext): Promise<Server[]> {
  const token = text(src.settings.token);
  if (!token) throw new ModuleError(tr(ctx, { ru: "Не задан токен API", en: "The API token is not set" }));
  const out: Server[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`${api(src)}/servers?page=${page}&per_page=50`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
    });
    if (res.status === 401) throw new ModuleError(tr(ctx, { ru: "Токен API не подошёл (401)", en: "The API token was refused (401)" }));
    if (!res.ok) throw new ModuleError(`Hetzner API: HTTP ${res.status}`);
    const body = (await res.json()) as { servers?: Server[]; meta?: { pagination?: { next_page?: number | null } } };
    out.push(...(body.servers ?? []));
    if (!body.meta?.pagination?.next_page) break;
  }
  return out;
}

function host(s: Server, src: SourceRef): FoundHost | null {
  const mode = text(src.settings.address, "ipv4");
  const v6 = s.public_net?.ipv6?.ip?.replace(/\/\d+$/, "").replace(/::$/, "::1");
  const address = mode === "private" ? s.private_net?.[0]?.ip : mode === "ipv6" ? v6 : s.public_net?.ipv4?.ip;
  if (!address) return null;
  const labels = s.labels ?? {};
  const port = Number(labels["ssh-port"]);
  const group = text(src.settings.group_by, "location");
  const os = [s.image?.os_flavor, s.image?.os_version].filter(Boolean).join(" ");
  return {
    // The API's id: stays when the server is renamed or gets another address.
    id: String(s.id),
    name: s.name,
    address,
    ...(Number.isInteger(port) && port > 0 && port < 65536 ? { port } : {}),
    user: text(labels["ssh-user"]) || text(src.settings.user, "root") || undefined,
    jump: text(labels["sshkipper-jump"]) || text(src.settings.jump) || undefined,
    online: s.status === "running",
    ...(os ? { os } : {}),
    tags: Object.entries(labels).map(([k, v]) => (v ? `${k}=${v}` : k)),
    ...(group === "location" && s.datacenter?.location?.city ? { group: s.datacenter.location.city } : {}),
    ...(group === "label" && labels.group ? { group: labels.group } : {}),
    addresses: [s.public_net?.ipv4?.ip, v6, ...(s.private_net ?? []).map((n) => n.ip)].filter((a): a is string => !!a),
    details: [s.server_type?.name, s.datacenter?.name, s.status].filter((d): d is string => !!d),
  };
}

defineModule({
  handlers: {},
  methods: sourceMethods({
    async poll(src, ctx) {
      const list = await servers(src, ctx);
      return { hosts: list.map((s) => host(s, src)).filter((h): h is FoundHost => h !== null), scope: new URL(api(src)).host };
    },
    async check(src, ctx) {
      const list = await servers(src, ctx);
      const running = list.filter((s) => s.status === "running").length;
      return { text: tr(ctx, { ru: `Работает: серверов ${list.length}, запущено ${running}`, en: `Works: ${list.length} servers, ${running} running` }) };
    },
  }),
});
