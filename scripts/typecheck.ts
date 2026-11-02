// `npm run typecheck` (also the end of `npm test`): `tsc --strict` over the SDK, its tests and every example — and
// over a fresh extension of every kind `sshkipper-ext new` makes, as an author's editor will check it.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KINDS, scaffold, type ScaffoldOptions } from "../packages/sdk/src/scaffold.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const tsc = join(root, "node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) {
  console.error("typecheck: TypeScript isn't installed — npm install (it is a devDependency)");
  process.exit(1);
}
const check = (project: string, what: string) => {
  const r = spawnSync(process.execPath, [tsc, "-p", project], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`✗ ${what}\n${(r.stdout + r.stderr).trim()}`);
    return false;
  }
  console.log(`✓ ${what}`);
  return true;
};

let ok = check(join(root, "tsconfig.json"), "the SDK, its tests and the examples (tsc --strict)");

// Fresh extensions: what `new` writes, checked with the SDK's own compiler options and Node's types.
const out = mkdtempSync(join(tmpdir(), "sshkipper-sdk-typecheck-"));
try {
  const cases: [string, Omit<ScaffoldOptions, "id" | "title">][] = [
    ...KINDS.map((k) => [`x-${k}`, { kind: k }] as [string, Omit<ScaffoldOptions, "id" | "title">]),
    ["x-process", { kind: "service", process: true }],
    ["x-process-module", { kind: "service", process: true, module: true }],
  ];
  for (const [name, o] of cases) {
    for (const [p, text] of Object.entries(scaffold({ ...o, id: `dev.example.${name.replace(/^x-/, "")}`, title: name }))) {
      mkdirSync(dirname(join(out, name, p)), { recursive: true });
      writeFileSync(join(out, name, p), text);
    }
  }
  // Node takes the code as ES modules by its syntax; tsc needs to be told.
  writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module", private: true }));
  writeFileSync(join(out, "tsconfig.json"), JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: { typeRoots: [join(root, "node_modules/@types")] },
    include: ["**/*.ts"], exclude: [],
  }));
  ok = check(join(out, "tsconfig.json"), `a new extension of every kind (${cases.length})`) && ok;
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
