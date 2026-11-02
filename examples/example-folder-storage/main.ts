// «Хранилище-папка» — an example storage contribution of SDK 1 (spec/protocol.md §12): the files of the storage are in
// a folder on this Mac given in its settings. It answers every `storage/*` method: listing, reading and writing in
// parts (an upload goes to a part file in SK_DATA and appears only on commit), folders, renames, deletes, the check.

import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readdir, realpath, rename, rm, statfs, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defineModule, ModuleError, storageMethods, tr, type StorageItem, type StorageRef } from "./lib/sshkipper-sdk/index.ts";

/** The storage's folder, as its settings name it, with the links on the way to it resolved (on macOS /tmp is one):
 *  the user chose it, so wherever it really is, that is the storage. */
async function root(s: StorageRef): Promise<string> {
  const r = typeof s.settings.root === "string" ? s.settings.root.trim() : "";
  if (!r.startsWith("/")) throw new ModuleError("Set the folder: a full path");
  try {
    return await realpath(resolve(r));
  } catch {
    throw new ModuleError(`No folder ${r}`);
  }
}

/** Something at the path is missing: `stat` answers null for it. */
function missing(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** A storage path ("/a/b.txt") as a path inside the folder — never outside it. Every part is checked on the disk:
 *  no "..", and no symbolic link anywhere below the folder (`etc -> /etc` inside it would lead out, for reading and
 *  for writing). `create`: the last part may not exist yet (a file being written, a new folder).
 *  A program that changes the folder between this check and the open could still race it; the opens below add
 *  O_NOFOLLOW for the last part, and a storage shared with untrusted local users needs more than an example gives. */
async function local(s: StorageRef, path: string, create = false): Promise<string> {
  const base = await root(s);
  const parts = String(path ?? "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || p.includes("\0"))) throw new ModuleError(`Bad path: ${path}`);
  let at = base;
  for (const [i, p] of parts.entries()) {
    at = join(at, p);
    let st;
    try {
      st = await lstat(at);
    } catch (e) {
      if (create && i === parts.length - 1 && (e as { code?: string })?.code === "ENOENT") return at;
      throw e;
    }
    if (st.isSymbolicLink()) throw new ModuleError(`Not inside the storage: ${path} (a symbolic link)`);
    if (i < parts.length - 1 && !st.isDirectory()) throw Object.assign(new Error(`Not a folder: ${path}`), { code: "ENOTDIR" });
  }
  return at;
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
const uploads = new Map<string, { file: string; path: string; size: number }>();

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
      const dir = await local(s, path);
      const out: StorageItem[] = [];
      for (const name of await readdir(dir)) {
        const i = await item(name, join(dir, name));
        if (i) out.push(i);
      }
      return out;
    },

    async stat(path, s) {
      let full: string;
      try {
        full = await local(s, path);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
      return item(full.split("/").pop() ?? "", full);
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
      async begin(path, size, _modified, s) {
        readOnly(s);
        await local(s, path, true);
        await mkdir(parts, { recursive: true, mode: 0o700 });
        const id = randomUUID();
        const file = join(parts, id);
        await (await open(file, "w", 0o600)).close();
        uploads.set(id, { file, path, size });
        return id;
      },
      async chunk(upload, offset, data) {
        const u = uploads.get(upload);
        if (!u) throw new ModuleError(`No upload ${upload}`);
        const h = await open(u.file, "r+");
        try { await h.write(data, 0, data.length, offset); } finally { await h.close(); }
      },
      async commit(upload, s) {
        const u = uploads.get(upload);
        if (!u) throw new ModuleError(`No upload ${upload}`);
        uploads.delete(upload);
        try {
          readOnly(s);
          // Checked again: the folder may have changed (a link put in its way) since the upload began.
          const target = await local(s, u.path, true);
          // The part was private to SK_DATA; in the folder it reads like any file there.
          await chmod(u.file, 0o644);
          await place(u.file, target);
        } catch (e) {
          await rm(u.file, { force: true });
          throw e;
        }
      },
      async abort(upload) {
        const u = uploads.get(upload);
        uploads.delete(upload);
        if (u) await rm(u.file, { force: true });
      },
    },

    async mkdir(path, s) {
      readOnly(s);
      await mkdir(await local(s, path, true));
    },

    async rename(from, to, s) {
      readOnly(s);
      const target = await local(s, to, true);
      if (await item("", target)) throw new ModuleError(`Already exists: ${to}`);
      await rename(await local(s, from), target);
    },

    async delete(path, recursive, s) {
      readOnly(s);
      const full = await local(s, path);
      if (full === (await root(s))) throw new ModuleError("The storage's own folder is not deleted");
      await rm(full, { recursive, force: false });
    },

    async check(s, ctx) {
      const base = await root(s);
      const n = (await readdir(base)).length;
      const fs = await statfs(base);
      return { text: tr(ctx, { ru: `Работает: в папке ${n}`, en: `Works: ${n} in the folder` }), free: fs.bavail * fs.bsize };
    },
  }),
});
