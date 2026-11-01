// «Хранилище-папка» — an example storage contribution of SDK 1 (spec/protocol.md §11): the files of the storage are in
// a folder on this Mac given in its settings. It answers every `storage/*` method: listing, reading and writing in
// parts (an upload goes to a part file in SK_DATA and appears only on commit), folders, renames, deletes, the check.

import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readdir, rename, rm, statfs, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { defineModule, ModuleError, storageMethods, tr, type StorageItem, type StorageRef } from "./lib/sshkipper-sdk/index.ts";

/** The storage's folder, as its settings name it. */
function root(s: StorageRef): string {
  const r = typeof s.settings.root === "string" ? s.settings.root.trim() : "";
  if (!r.startsWith("/")) throw new ModuleError("Set the folder: a full path");
  return resolve(r);
}

/** A storage path ("/a/b.txt") inside the folder — never outside it ("..", or a name with "/" from somewhere). */
function local(s: StorageRef, path: string): string {
  const base = root(s);
  const parts = String(path ?? "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || p.includes("\0"))) throw new ModuleError(`Bad path: ${path}`);
  const full = join(base, ...parts);
  if (full !== base && !full.startsWith(base + sep)) throw new ModuleError(`Bad path: ${path}`);
  return full;
}

function readOnly(s: StorageRef) {
  if (s.readOnly) throw new ModuleError("The storage is read-only");
}

async function item(name: string, full: string): Promise<StorageItem | null> {
  try {
    // Links are left out: one could point outside the folder.
    const st = await lstat(full);
    if (st.isDirectory()) return { name, type: "folder", modified: Math.floor(st.mtimeMs / 1000) };
    if (st.isFile()) return { name, type: "file", size: st.size, modified: Math.floor(st.mtimeMs / 1000) };
    return null;
  } catch (e: any) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw e;
  }
}

// Uploads in progress: a part file in SK_DATA (the extension's own folder), moved into place on commit.
const parts = join(process.env.SK_DATA ?? "/tmp", "uploads");
const uploads = new Map<string, { file: string; target: string; size: number }>();

async function place(from: string, to: string) {
  try { await rename(from, to); } catch (e: any) {
    // Another volume: copied, then the part removed.
    if (e?.code !== "EXDEV") throw e;
    await copyFile(from, to);
    await unlink(from);
  }
}

defineModule({
  handlers: {},
  methods: storageMethods({
    async list(path, s) {
      const dir = local(s, path);
      const out: StorageItem[] = [];
      for (const name of await readdir(dir)) {
        const i = await item(name, join(dir, name));
        if (i) out.push(i);
      }
      return out;
    },

    async stat(path, s) {
      const full = local(s, path);
      return item(full.split(sep).pop() ?? "", full);
    },

    async read(path, offset, length, s) {
      const h = await open(local(s, path), constants.O_RDONLY | constants.O_NOFOLLOW);
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
      async begin(path, size, _modified, s) {
        readOnly(s);
        const target = local(s, path);
        await mkdir(parts, { recursive: true, mode: 0o700 });
        const id = randomUUID();
        const file = join(parts, id);
        await (await open(file, "w", 0o600)).close();
        uploads.set(id, { file, target, size });
        return id;
      },
      async chunk(upload, offset, data) {
        const u = uploads.get(upload);
        if (!u) throw new ModuleError(`No upload ${upload}`);
        const h = await open(u.file, "r+");
        try { await h.write(data, 0, data.length, offset); } finally { await h.close(); }
      },
      async commit(upload) {
        const u = uploads.get(upload);
        if (!u) throw new ModuleError(`No upload ${upload}`);
        uploads.delete(upload);
        // The part was private to SK_DATA; in the folder it reads like any file there.
        await chmod(u.file, 0o644);
        await place(u.file, u.target);
      },
      async abort(upload) {
        const u = uploads.get(upload);
        uploads.delete(upload);
        if (u) await rm(u.file, { force: true });
      },
    },

    async mkdir(path, s) {
      readOnly(s);
      await mkdir(local(s, path));
    },

    async rename(from, to, s) {
      readOnly(s);
      const target = local(s, to);
      if (await item("", target)) throw new ModuleError(`Already exists: ${to}`);
      await rename(local(s, from), target);
    },

    async delete(path, recursive, s) {
      readOnly(s);
      const full = local(s, path);
      if (full === root(s)) throw new ModuleError("The storage's own folder is not deleted");
      await rm(full, { recursive, force: false });
    },

    async check(s, ctx) {
      const base = root(s);
      const n = (await readdir(base)).length;
      const fs = await statfs(base);
      return { text: tr(ctx, { ru: `Работает: в папке ${n}`, en: `Works: ${n} in the folder` }), free: fs.bavail * fs.bsize };
    },
  }),
});
