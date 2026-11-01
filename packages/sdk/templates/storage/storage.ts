// __TITLE__: a storage contribution of SSHKipper SDK 1 (spec/protocol.md §12.1). The app draws the file panel, the
// transfers and the card; this program answers `storage/*`. The start keeps files in SK_DATA (the extension's own
// folder) under the card's «bucket» — replace the file calls with your service's API.

import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { defineModule, ModuleError, storageMethods, tr, type StorageItem, type StorageRef } from "./lib/sshkipper-sdk/index.ts";

const data = resolve(process.env.SK_DATA ?? "/tmp/sshkipper-storage");

/** The storage's own folder: a bucket name from the card, never a path. */
async function root(s: StorageRef): Promise<string> {
  const bucket = String(s.settings.bucket ?? "default").replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
  const dir = join(data, "buckets", bucket);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** A storage path ("/a/b.txt") inside the bucket — never outside it. */
async function local(s: StorageRef, path: string): Promise<string> {
  const base = await root(s);
  const parts = String(path ?? "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || p.includes("\0"))) throw new ModuleError(`Bad path: ${path}`);
  const full = join(base, ...parts);
  if (full !== base && !full.startsWith(base + sep)) throw new ModuleError(`Bad path: ${path}`);
  return full;
}

const writable = (s: StorageRef) => { if (s.readOnly) throw new ModuleError("The storage is read-only"); };

async function item(name: string, full: string): Promise<StorageItem | null> {
  try {
    const st = await lstat(full);
    if (st.isDirectory()) return { name, type: "folder", modified: Math.floor(st.mtimeMs / 1000) };
    if (st.isFile()) return { name, type: "file", size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
    return null;
  } catch (e: any) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw e;
  }
}

// Uploads in progress: nothing appears at the path before commit.
const uploads = new Map<string, { file: string; target: string }>();

defineModule({
  handlers: {},
  methods: storageMethods({
    async list(path, s) {
      const dir = await local(s, path);
      const out: StorageItem[] = [];
      for (const name of await readdir(dir)) {
        const i = await item(name, join(dir, name));
        if (i) out.push(i);
      }
      return out;
    },
    async stat(path, s) {
      const full = await local(s, path);
      return item(full.split(sep).pop() ?? "", full);
    },
    async read(path, offset, length, s) {
      const h = await open(await local(s, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const size = (await h.stat()).size;
        const buf = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
        const { bytesRead } = buf.length ? await h.read(buf, 0, buf.length, offset) : { bytesRead: 0 };
        return { data: buf.subarray(0, bytesRead), eof: offset + bytesRead >= size };
      } finally {
        await h.close();
      }
    },
    write: {
      async begin(path, _size, _modified, s) {
        writable(s);
        const target = await local(s, path);
        await mkdir(join(data, "parts"), { recursive: true, mode: 0o700 });
        const id = randomUUID();
        const file = join(data, "parts", id);
        await (await open(file, "w", 0o600)).close();
        uploads.set(id, { file, target });
        return id;
      },
      async chunk(upload, offset, bytes) {
        const u = uploads.get(upload) ?? (() => { throw new ModuleError(`No upload ${upload}`); })();
        const h = await open(u.file, "r+");
        try { await h.write(bytes, 0, bytes.length, offset); } finally { await h.close(); }
      },
      async commit(upload) {
        const u = uploads.get(upload) ?? (() => { throw new ModuleError(`No upload ${upload}`); })();
        uploads.delete(upload);
        await rename(u.file, u.target);
      },
      async abort(upload) {
        const u = uploads.get(upload);
        uploads.delete(upload);
        if (u) await rm(u.file, { force: true });
      },
    },
    async mkdir(path, s) { writable(s); await mkdir(await local(s, path)); },
    async rename(from, to, s) {
      writable(s);
      const target = await local(s, to);
      if (await item("", target)) throw new ModuleError(`Already exists: ${to}`);
      await rename(await local(s, from), target);
    },
    async delete(path, recursive, s) {
      writable(s);
      const full = await local(s, path);
      if (full === (await root(s))) throw new ModuleError("The storage itself is not deleted");
      await rm(full, { recursive, force: false });
    },
    async check(s, ctx) {
      const n = (await readdir(await root(s))).length;
      return { text: tr(ctx, { en: `Works: ${n} at the top`, ru: `Работает: наверху ${n}` }) };
    },
  }),
});
