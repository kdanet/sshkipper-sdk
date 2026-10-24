// __TITLE__: a process module of SSHKipper SDK 1. The app starts `node module.ts` on this Mac and calls the
// handlers below over JSON-RPC; `ctx.host.exec` runs a command on the server over the app's own SSH session.
import { defineModule, gauge, grid, rows, row, tr, view, type HandlerContext } from "./lib/sshkipper-sdk/index.ts";

type Disk = { mount: string; device: string; size: number; used: number; pct: number };

/** Pseudo file systems are always "full" and say nothing (devfs, tmpfs, snaps): left out. */
const pseudo = (dev: string, mount: string) => mount !== "/" && (
  /^(devfs|tmpfs|devtmpfs|udev|overlay|shm|none|map )/.test(dev) || /^\/(dev|run|sys|proc|snap)(\/|$)/.test(mount) ||
  /^\/System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)/.test(mount) || mount.startsWith("/Library/Developer/CoreSimulator"));

async function disks(ctx: HandlerContext): Promise<Disk[]> {
  const r = await ctx.host.exec("df -P -k", { timeout: 10 });
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || "df failed");
  const out: Disk[] = [];
  for (const line of r.stdout.trim().split("\n").slice(1)) {
    // A device name may have spaces ("map auto_home"): the fields are counted from the % column.
    const f = line.trim().split(/\s+/);
    const p = f.findIndex((x, i) => i > 0 && /^\d+%$/.test(x));
    if (p < 4) continue;
    const disk = { device: f.slice(0, p - 3).join(" "), size: Number(f[p - 3]) * 1024, used: Number(f[p - 2]) * 1024,
      pct: parseInt(f[p]), mount: f.slice(p + 1).join(" ") };
    if (disk.size > 0 && !pseudo(disk.device, disk.mount)) out.push(disk);
  }
  return out.sort((a, b) => b.pct - a.pct);
}

const warn = (ctx: HandlerContext) => (typeof ctx.settings.warn_pct === "number" ? ctx.settings.warn_pct : 85);
const status = (d: Disk, ctx: HandlerContext) => (d.pct >= 95 ? "bad" : d.pct >= warn(ctx) ? "warn" : "ok");
const gb = (n: number) => `${(n / 2 ** 30).toFixed(1)} GB`;

defineModule({
  handlers: {
    detect: async (_input, ctx) => ({ found: (await ctx.host.exec("command -v df")).exitCode === 0 }),
    summary: async (_input, ctx) => {
      const [d] = await disks(ctx);
      return d ? { text: `${d.mount} — ${d.pct}%`, status: status(d, ctx) } : { text: "—", status: "off" };
    },
    list: async (_input, ctx) => ({ disks: await disks(ctx) }),
    render: async (_input, ctx) => {
      const all = await disks(ctx);
      return view([
        grid(all.slice(0, 6).map((d) => gauge(d.mount, d.pct, 100, { unit: "%" })), 3),
        rows(all.map((d) => row(d.mount, { id: d.mount, detail: d.device, status: status(d, ctx), trailing: `${gb(d.used)} / ${gb(d.size)}` })),
          { title: tr(ctx, { en: "File systems", ru: "Файловые системы" }) }),
      ], { status: [{ text: tr(ctx, { en: `${all.length} file systems.`, ru: `Файловых систем: ${all.length}.` }) }] });
    },
  },
});
