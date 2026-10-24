// The shell parts on the shells and awks servers have: busybox (Alpine) and dash + mawk (Debian). Opt-in, with
// images already on this machine (nothing is pulled): SSHKIPPER_SDK_DOCKER=1 npm test.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PRELUDE, serverScript } from "../packages/sdk/src/dev.ts";
import { scaffold } from "../packages/sdk/src/scaffold.ts";
import type { Manifest } from "../packages/sdk/src/types.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const images = ["alpine:3.22", "debian:bookworm-slim"].filter((i) => spawnSync("docker", ["image", "inspect", i]).status === 0);
const on = process.env.SSHKIPPER_SDK_DOCKER === "1" && images.length > 0;

function sh(image: string, script: string) {
  const r = spawnSync("docker", ["run", "--rm", "-i", "--network", "none", image, "sh", "-s"], { input: script, encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
}

test("the prelude writes valid JSON everywhere", { skip: !on }, () => {
  const tricky = 'a\\\\b "q" t\\tx\\001y\\nline2 привет';
  for (const image of images) {
    const r = sh(image, `${PRELUDE}\nv=$(printf '${tricky}'); sk_json_kv k "$v"`);
    assert.equal(r.code, 0, `${image}: ${r.err}`);
    assert.equal(JSON.parse(r.out).k, 'a\\b "q" t\txy\nline2 привет', image);
  }
});

test("scaffold and example handlers answer JSON on busybox and mawk", { skip: !on }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-port-"));
  try {
    for (const [p, t] of Object.entries(scaffold({ kind: "server", id: "dev.test.disks", title: "Disks" }))) {
      mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t);
    }
    const cases: [string, string, Record<string, unknown>][] = [
      [dir, "detect", {}], [dir, "summary", {}], [dir, "list", {}], [dir, "usage", { mount: "/" }],
      [join(root, "examples/processes"), "detect", {}], [join(root, "examples/processes"), "overview", {}],
    ];
    for (const image of images) {
      for (const [folder, handler, input] of cases) {
        const m: Manifest = JSON.parse(readFileSync(join(folder, "sshkipper-module.json"), "utf8"));
        const r = sh(image, serverScript(folder, m, handler, { input: input as never, settings: { warn_pct: 85 } }));
        assert.equal(r.code, 0, `${image} ${handler}: ${r.err}`);
        const v = JSON.parse(r.out);
        if (handler === "list") for (const d of v.disks) assert.ok(Number.isInteger(d.size) && d.size >= 0, `${image}: size ${d.size}`);
        if (handler === "overview") assert.ok(Number.isInteger(v.mem_total) && v.mem_total > 2 ** 31, `${image}: mem_total ${v.mem_total}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
