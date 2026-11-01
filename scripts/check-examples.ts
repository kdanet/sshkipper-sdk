// `npm run validate`: every example passes the app's checks and packs (`sshkipper-ext pack`) into a temporary
// folder. An example of a compiled language whose program isn't built yet (swift-hello: ./build.sh, or
// `npm run swift`) is named and skipped — `--build` builds it first.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatIssue, MANIFEST_FILES, manifestFile, validateFolder } from "../packages/sdk/src/validate.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "packages/cli/sshkipper-ext.ts");
const build = process.argv.includes("--build");
const out = mkdtempSync(join(tmpdir(), "sshkipper-sdk-pack-"));
let failed = 0;

for (const name of readdirSync(join(root, "examples")).sort()) {
  const dir = join(root, "examples", name);
  if (!statSync(dir).isDirectory() || !MANIFEST_FILES.some((m) => existsSync(join(dir, m)))) continue;
  const m = JSON.parse(readFileSync(join(dir, manifestFile(dir)), "utf8"));
  const program: string | undefined = m.runtime?.command?.[0];
  if (program?.includes("/") && !existsSync(join(dir, program)) && existsSync(join(dir, "build.sh"))) {
    if (!build) { console.log(`– ${name}: ${program} isn't built — ./build.sh (or npm run validate -- --build)`); continue; }
    const b = spawnSync(join(dir, "build.sh"), { stdio: "inherit" });
    if (b.status !== 0) { console.log(`✗ ${name}: build.sh failed`); failed++; continue; }
  }
  const r = validateFolder(dir);
  const errors = r.issues.filter((i) => i.severity === "error");
  if (errors.length) {
    console.log(`✗ ${name}`);
    for (const i of errors) console.log(`  ${formatIssue(i)}`);
    failed++;
    continue;
  }
  const p = spawnSync(process.execPath, [cli, "pack", dir, "-o", join(out, `${name}.${manifestFile(dir) === "sshkipper-extension.json" ? "sshkext" : "sshkmod"}`)], { encoding: "utf8" });
  if (p.status !== 0) { console.log(`✗ ${name}: pack — ${(p.stderr || p.stdout).trim().split("\n").pop()}`); failed++; continue; }
  const warnings = r.issues.length - errors.length;
  console.log(`✓ ${name} — ${r.manifest!.id} ${r.manifest!.version}, ${r.files.length} files, packed${warnings ? `, ${warnings} warning(s)` : ""}`);
}
rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
