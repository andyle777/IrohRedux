// Dist drift gate (1.1.1, F3): the CLI and require("iroh") load dist/,
// so a fix that lands in src/ and is not rebuilt ships nothing — and
// every test that runs from src/ stays green while the installed
// package is wrong. This gate rebuilds dist/ into a temp dir from
// the CURRENT working-tree src/ and byte-compares it against the
// checked-in dist/. It fails with the list of differing files.
//
// Run: node scripts/check-dist-drift.mjs
// (Also run by tests/dist-drift.test.js as part of npm test, and as
// a step in CI. The same shape as the codegen:irohscript drift check
// in tests/irohscript-codegen.test.js, extended to all of dist/.
// npm run dist alone is not a gate; it is a build.)
//
// The rebuild happens in a temp dir, never in place: rebuilding in
// place would rewrite the checked-in dist/ and hide the drift it is
// meant to catch. The temp tree gets copies of src/, rollup/,
// package.json and the personality matrix (the build's inputs) plus
// a hardlinked node_modules, so no dependency is reinstalled.
//
// The temp dir MUST live on the same filesystem as the repo (a
// sibling of the repo root), because node_modules is hardlinked, not
// copied — hardlinks cannot cross devices. This preserves the same
// dependency files for the isolated build without reinstalling them.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST_FILES = ["iroh-node.js", "iroh-node.es.mjs", "iroh-browser.js"];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (let entry of fs.readdirSync(src, { withFileTypes: true })) {
    let from = path.join(src, entry.name);
    let to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to);
  }
}

// Hardlink a directory tree: same inodes, no extra disk, fast.
// Only works on the same filesystem as the source, which is why the
// temp dir is a sibling of the repo root (see the header comment).
function hardlinkDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (let entry of fs.readdirSync(src, { withFileTypes: true })) {
    let from = path.join(src, entry.name);
    let to = path.join(dest, entry.name);
    if (entry.isDirectory()) hardlinkDir(from, to);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.linkSync(from, to);
  }
}

function main() {
  let tmp = path.join(
    path.dirname(ROOT),
    ".iroh-dist-drift-" + crypto.randomBytes(6).toString("hex")
  );
  fs.mkdirSync(tmp, { recursive: true });
  try {
    copyDir(path.join(ROOT, "src"), path.join(tmp, "src"));
    copyDir(path.join(ROOT, "rollup"), path.join(tmp, "rollup"));
    fs.copyFileSync(path.join(ROOT, "package.json"), path.join(tmp, "package.json"));
    fs.copyFileSync(
      path.join(ROOT, "personality-matrix.json"),
      path.join(tmp, "personality-matrix.json")
    );
    hardlinkDir(path.join(ROOT, "node_modules"), path.join(tmp, "node_modules"));
    let build = spawnSync("npm", ["run", "dist"], {
      cwd: tmp,
      encoding: "utf8",
      timeout: 300000,
    });
    if (build.status !== 0) {
      console.error("dist drift gate: the rebuild itself failed, so dist/ cannot be verified:");
      console.error(build.stdout);
      console.error(build.stderr);
      process.exit(1);
    }
    let differing = [];
    for (let file of DIST_FILES) {
      let checkedIn = path.join(ROOT, "dist", file);
      let rebuilt = path.join(tmp, "dist", file);
      if (!fs.existsSync(rebuilt)) {
        differing.push(file + " (rebuild did not produce it)");
        continue;
      }
      if (!fs.existsSync(checkedIn)) {
        differing.push(file + " (no checked-in copy)");
        continue;
      }
      let a = fs.readFileSync(checkedIn);
      let b = fs.readFileSync(rebuilt);
      if (!a.equals(b)) differing.push(file);
    }
    if (differing.length > 0) {
      console.error("dist drift gate: checked-in dist/ is stale — src/ changed without a rebuild.");
      console.error("Differing files (run `npm run dist` and commit the result):");
      for (let file of differing) console.error("  dist/" + file);
      process.exit(1);
    }
    console.log("dist drift gate: dist/ matches a fresh rebuild (" + DIST_FILES.join(", ") + ").");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
