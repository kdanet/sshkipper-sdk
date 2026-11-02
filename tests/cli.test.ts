// sshkipper-ext as an author meets it: mistakes in arguments are errors (never quietly another folder), every
// command has --help, a package is the same bytes for the same files, and the npm package installs and runs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scaffold } from "../packages/sdk/src/scaffold.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "packages/cli/sshkipper-ext.ts");
const ext = (cwd: string, ...a: string[]) => spawnSync(process.execPath, [cli, ...a], { cwd, encoding: "utf8", timeout: 60_000 });

function write(dir: string, files: Record<string, string>) {
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), t); }
}

test("CLI: a folder that isn't there, or holds no manifest, is an error — never the current folder", () => {
  const base = mkdtempSync(join(tmpdir(), "sk-cli-args-"));
  try {
    const here = join(base, "x-service");
    write(here, scaffold({ kind: "service", id: "dev.test.here", title: "Here" }));
    mkdirSync(join(base, "empty"));
    for (const args of [["validate", "../nosuch"], ["pack", "../x-databse"], ["validate", "../empty"], ["run", "../nosuch", "list"], ["preview", "./nope"], ["vendor", "../empty"]]) {
      const r = ext(here, ...args);
      assert.equal(r.status, 1, `${args.join(" ")}: ${r.stdout}`);
      assert.match(r.stderr, /no such folder|no sshkipper-extension\.json/, args.join(" "));
      assert.doesNotMatch(r.stdout, /ok —/, args.join(" "));
    }
    assert.ok(!existsSync(join(here, "dev.test.here-0.1.0.sshkext")), "pack of a typo packed nothing");
    // The current folder still works when nothing is named, and a handler name isn't taken for a folder.
    assert.equal(ext(here, "validate").status, 0);
    assert.equal(ext(here, "run", "detect").status, 0, ext(here, "run", "detect").stderr);
    // A typo in a handler's name says which handlers there are.
    assert.match(ext(here, "run", "lsit").stderr, /no handler «lsit» in handlers — detect, summary, list, usage/);
    // Without --id the id is a placeholder, and `new` says so.
    const placeholder = ext(base, "new", "mine");
    assert.equal(placeholder.status, 0, placeholder.stderr);
    assert.match(placeholder.stdout, /the id dev\.example\.mine is a placeholder/);
    assert.doesNotMatch(ext(base, "new", "theirs", "--id", "dev.test.theirs").stdout, /placeholder/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("CLI: unknown flags, flags without their value and flags of another kind are errors", () => {
  const base = mkdtempSync(join(tmpdir(), "sk-cli-flags-"));
  try {
    const cases: [string[], RegExp][] = [
      [["new", "t1", "--knd", "database"], /no flag --knd/],
      [["new", "t2", "--kind", "storage", "--module"], /--module is for --kind service/],
      [["new", "t3", "--kind", "source", "--process"], /--process is for --kind service/],
      [["new", "t4", "--kind"], /--kind needs a value/],
      [["validate", ".", "--strict"], /no flag --strict/],
    ];
    for (const [args, message] of cases) {
      const r = ext(base, ...args);
      assert.equal(r.status, 1, args.join(" "));
      assert.match(r.stderr, message, args.join(" "));
      if (args[0] === "new") assert.ok(!existsSync(join(base, args[1])), `${args.join(" ")} made nothing`);
    }
    const dir = join(base, "svc");
    write(dir, scaffold({ kind: "service", id: "dev.test.svc", title: "Svc" }));
    const r = ext(dir, "run", "usage", "--input");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--input needs a value/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("CLI: --help of every command says what it does; help <command> the same", () => {
  for (const c of ["new", "validate", "run", "call", "preview", "pack", "vendor", "mcp"]) {
    const r = ext(root, c, "--help");
    assert.equal(r.status, 0, c);
    assert.match(r.stdout, new RegExp(`^sshkipper-ext ${c === "call" ? "run" : c}`), c);
    assert.equal(ext(root, "help", c).stdout, r.stdout, c);
  }
  assert.match(ext(root).stdout, /sshkipper-ext <command> --help/);
  assert.equal(ext(root, "nope").status, 1);
});

test("CLI: pack is the same bytes for the same files; validate and pack count the same files", () => {
  const base = mkdtempSync(join(tmpdir(), "sk-cli-pack-"));
  try {
    const dir = join(base, "svc");
    write(dir, scaffold({ kind: "service", id: "dev.test.svc", title: "Svc" }));
    assert.equal(ext(dir, "pack", ".", "-o", join(base, "a.sshkext")).status, 0);
    // Touched files and a package lying in the folder change nothing.
    utimesSync(join(dir, "scripts/list.sh"), new Date(), new Date(Date.now() + 60_000));
    writeFileSync(join(dir, "old.sshkext"), "x");
    const v = ext(dir, "validate"), p = ext(dir, "pack", ".", "-o", join(base, "b.sshkext"));
    assert.equal(p.status, 0, p.stderr);
    assert.deepEqual(readFileSync(join(base, "a.sshkext")), readFileSync(join(base, "b.sshkext")));
    const count = (s: string) => Number(s.match(/(\d+) files/)?.[1]);
    assert.equal(count(v.stdout), count(p.stdout.split("\n").at(-2) ?? ""), v.stdout + p.stdout);
    // The app's unzip takes it, the executable bit kept.
    if (process.platform === "darwin") {
      spawnSync("chmod", ["+x", join(dir, "scripts/list.sh")]);
      assert.equal(ext(dir, "pack", ".", "-o", join(base, "c.sshkext")).status, 0);
      const out = join(base, "unpacked");
      assert.equal(spawnSync("ditto", ["-x", "-k", join(base, "c.sshkext"), out]).status, 0);
      assert.equal(readFileSync(join(out, "scripts/list.sh"), "utf8"), readFileSync(join(dir, "scripts/list.sh"), "utf8"));
      assert.ok(spawnSync("test", ["-x", join(out, "scripts/list.sh")]).status === 0, "executable after unpacking");
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("CLI: preview exits 1 when the view is wrong; vendor updates a driver's lib/database.ts", () => {
  const base = mkdtempSync(join(tmpdir(), "sk-cli-preview-"));
  try {
    const dir = join(base, "bad");
    write(dir, {
      "sshkipper-extension.json": JSON.stringify({ sdk: 1, id: "dev.test.bad", version: "1.0.0", title: "Bad", runtime: { kind: "server" },
        pages: [{ id: "main", title: "Main", view: "views/main.json" }], service: { page: "main" } }),
      "views/main.json": JSON.stringify({ blocks: [{ type: "text", text: "a" }, { type: "nope" }] }),
    });
    const r = ext(dir, "preview");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /✗ blocks\[1\]/);
    const db = join(base, "db");
    write(db, scaffold({ kind: "database", id: "dev.test.db", title: "Db" }));
    writeFileSync(join(db, "lib/database.ts"), "// old\n");
    assert.equal(ext(db, "vendor").status, 0);
    assert.equal(readFileSync(join(db, "lib/database.ts"), "utf8"), readFileSync(join(root, "packages/sdk/src/database.ts"), "utf8"));
    assert.ok(!existsSync(join(db, "lib/sshkipper-sdk")), "a driver keeps only the database protocol");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("CLI: import/parse names the importers when --importer is missing", () => {
  const base = mkdtempSync(join(tmpdir(), "sk-cli-import-"));
  try {
    write(base, scaffold({ kind: "import", id: "dev.test.imp", title: "Imp" }));
    const r = ext(base, "run", "import/parse", "--file", "samples/hosts.txt");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--importer ID is needed: hosts/);
    assert.equal(ext(base, "run", "import/parse", "--file", "samples/hosts.txt", "--importer", "hosts").status, 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("new --process: the automation block it promises, no permission it doesn't use", () => {
  const files = scaffold({ kind: "service", id: "dev.test.proc", title: "Proc", process: true });
  const m = JSON.parse(files["sshkipper-extension.json"]);
  assert.equal(m.automation?.[0]?.handler, "usage");
  assert.ok(m.handlers.usage);
  assert.deepEqual(m.permissions, ["exec"]);
  assert.match(files["module.ts"], /usage: async/);
  assert.doesNotMatch(files["README.md"], /--process —/);
});

test("npm package: packed, installed from the tarball into another prefix, its CLI runs", { skip: !existsSync(join(root, "node_modules/typescript")) && "npm install first (TypeScript builds the package)" }, () => {
  // A copy of the repository (the build writes .js next to the sources), node_modules shared.
  const base = mkdtempSync(join(tmpdir(), "sk-npm-"));
  try {
    const copy = join(base, "sdk");
    cpSync(root, copy, { recursive: true, filter: (p) => !/\/(node_modules|\.git|\.build|\.swiftpm)(\/|$)/.test(p.slice(root.length - 1)) });
    symlinkSync(join(root, "node_modules"), join(copy, "node_modules"));
    const npm = (args: string[], cwd: string) => spawnSync("npm", args, { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" } });
    const packed = npm(["pack", "--pack-destination", base], copy);
    assert.equal(packed.status, 0, packed.stderr);
    const tgz = join(base, packed.stdout.trim().split("\n").pop()!);
    const prefix = join(base, "prefix");
    const installed = npm(["install", "-g", "--offline", "--prefix", prefix, tgz], base);
    assert.equal(installed.status, 0, installed.stderr);
    const bin = join(prefix, "bin/sshkipper-ext");
    const run = (...a: string[]) => spawnSync(bin, a, { cwd: base, encoding: "utf8", timeout: 60_000 });
    assert.match(run("help").stdout, /build extensions for SSHKipper/);
    assert.equal(run("new", "w", "--kind", "source", "--id", "dev.test.w").status, 0);
    const poll = run("run", "w", "source/poll", "--params", JSON.stringify({ source: { node: "n", kind: "w", settings: { hosts: ["a 1.2.3.4"] } } }));
    assert.equal(poll.status, 0, poll.stderr);
    assert.equal(run("pack", "w", "-o", join(base, "w.sshkext")).status, 0);
    // The library: types and code, as a package import.
    const lib = join(prefix, "lib/node_modules/sshkipper-sdk");
    const pkg = JSON.parse(readFileSync(join(lib, "package.json"), "utf8"));
    assert.equal(pkg.license, "MIT");
    assert.match(readFileSync(join(lib, "LICENSE"), "utf8"), /^MIT License/, "the licence text travels with the package");
    for (const p of [pkg.exports["."].default, pkg.exports["."].types, pkg.exports["./database"].default]) assert.ok(existsSync(join(lib, p)), p);
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `import { view, quote } from ${JSON.stringify(join(lib, pkg.exports["."].default))}; console.log(quote("it's"), view([]).blocks.length)`], { encoding: "utf8" });
    assert.equal(imported.stdout.trim(), "'it'\\''s' 0", imported.stderr);
    // Swift: the package a copy of swift-hello points at — by path to the installed SDK (its root manifest, the
    // sources it names) — travels too, and no SwiftPM build folder does.
    assert.match(readFileSync(join(lib, "Package.swift"), "utf8"), /path: "packages\/swift\/Sources\/SSHKipperSDK"/);
    assert.ok(existsSync(join(lib, "packages/swift/Sources/SSHKipperSDK/Runtime.swift")), "the Swift sources");
    assert.ok(existsSync(join(lib, "examples/swift-hello/Package.swift")), "the Swift example");
    assert.ok(!existsSync(join(lib, "packages/swift/.build")) && !existsSync(join(lib, "examples/swift-hello/bin")));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
