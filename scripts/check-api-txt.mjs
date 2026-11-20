import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "API.md");

if (process.argv.length > 3) {
  throw new Error("Usage: node scripts/check-api-txt.mjs [api-text-path]");
}

const help = spawnSync(process.execPath, [path.join(root, "cli", "iroh.js"), "--help"], {
  encoding: "utf8",
});
if (help.error) throw help.error;
if (help.status !== 0) {
  throw new Error("iroh --help exited " + help.status + "\n" + (help.stderr || ""));
}
const helpText = help.stdout + help.stderr;
const flags = new Set([...helpText.matchAll(/--[a-z][a-z0-9-]*/g)].map((match) => match[0]));
for (const command of ["capabilities", "doctor", "serve", "node"]) {
  if (new RegExp("\\b" + command + "\\b").test(helpText)) flags.add(command);
}
flags.add("-h");

const api = fs.readFileSync(apiPath, "utf8");
const missing = [...flags].sort().filter((flag) => !api.includes(flag));
if (missing.length > 0) {
  process.stderr.write("API text is missing --help flags: " + missing.join(", ") + "\n");
  process.exitCode = 1;
} else {
  process.stdout.write("check:api-txt OK (" + flags.size + " flags from --help all appear in " + path.basename(apiPath) + ")\n");
}
