#!/usr/bin/env node
// sshkipper-ext: starts the CLI. Node strips TypeScript types, but never inside node_modules — so an installed package
// (npm, a tarball, git) runs the JavaScript built by `npm run build` (prepack / prepare), and a clone (npm link) runs
// its TypeScript as is, never a stale build.
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

const installed = fileURLToPath(import.meta.url).split(sep).includes("node_modules");
const js = new URL("../packages/cli/sshkipper-ext.js", import.meta.url);
const ts = new URL("../packages/cli/sshkipper-ext.ts", import.meta.url);
if (installed && !existsSync(js)) {
  console.error("sshkipper-ext: the package isn't built (packages/cli/sshkipper-ext.js is missing) — install it from a tarball made by `npm pack`, or clone the repository and `npm link`");
  process.exit(1);
}
const { main } = await import((installed ? js : ts).href);
await main(process.argv.slice(2));
