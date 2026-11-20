// Dist drift gate (1.1.1, F3): the CLI and require("iroh") load
// dist/, so a fix that lands in src/ and is not rebuilt ships
// nothing — and every test that runs from src/ stays green while
// the installed package is wrong. This test runs
// scripts/check-dist-drift.mjs, which rebuilds dist/ into a temp
// dir from the current working-tree src/ and byte-compares it
// against the checked-in dist/. It fails with the list of differing
// files. Run `npm run dist` and commit the result to fix it.
//
// This test exists because the gate caught real drift on its first
// run: after the D1 fix (8908f20) the node bundles were rebuilt with
// `npm run build`, but the browser bundle was not (`npm run browser`
// is a separate step inside `npm run dist`), so the checked-in
// dist/iroh-browser.js still carried the buggy inline ternary.

const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("dist matches a fresh rebuild (drift gate)", () => {
  let result = spawnSync(process.execPath, ["scripts/check-dist-drift.mjs"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 300000,
  });
  // Show the gate's own output on failure so the differing files are visible.
  if (result.status !== 0) {
    throw new Error(
      "dist drift gate failed:\n" + (result.stdout || "") + (result.stderr || "")
    );
  }
});
