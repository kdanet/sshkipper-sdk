// A package's zip (`sshkipper-ext pack`): the same bytes for the same files — paths sorted, one fixed time, no
// extra fields — so a release can be rebuilt and compared. No `zip` program needed. Deflate, no ZIP64 (the app
// takes packages far below 4 GB); the Unix mode keeps a program or a script executable after the app unpacks it.

import { deflateRawSync, crc32 } from "node:zlib";

export interface ZipEntry { path: string; data: Uint8Array; executable?: boolean }

/** 1980-01-01 00:00, the earliest MS-DOS time: no clock of the machine that packed it gets in. */
const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function zip(entries: ZipEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const e of sorted) {
    const name = Buffer.from(e.path, "utf8");
    const deflated = deflateRawSync(e.data, { level: 9 });
    // Stored when deflate doesn't help (a binary, a small file).
    const stored = deflated.length >= e.data.length;
    const body = stored ? Buffer.from(e.data) : deflated;
    const crc = crc32(e.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);                 // version needed: 2.0
    head.writeUInt16LE(0x0800, 6);             // UTF-8 names
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(e.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE((3 << 8) | 20, 4);       // made by Unix: the mode below is read
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(((e.executable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + body.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
