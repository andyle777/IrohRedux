// CI check: every flag in `iroh --help` appears in the API text.
//
//   node scripts/check-api-txt.mjs [api-text-path]
//
// The API text defaults to API.md in this repo; the bundle builder
// passes the generated txt/API.txt. The two are the same file by
// construction (the bundle copies API.md verbatim), so a flag missing
// from either fails the same way. Flags are the --word tokens in the
// --help output. (1.0.1 has no subcommands — capabilities, doctor,
// serve, node do not exist in this generation — so no subcommand
// words are checked; the loop below only adds a word when --help
// actually lists it.)
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "API.md");

const help = spawnSync(process.execPath, [path.join(root, "cli", "iroh.js"), "--help"], { encoding: "utf8" });
if (help.status !== 0) throw new Error("iroh --help exited " + help.status);
const text = help.stdout + help.stderr;

const flags = new Set();
for (const m of text.matchAll(/--[a-z][a-z0-9-]*/g)) flags.add(m[0]);
for (const word of ["capabilities", "doctor", "serve", "node"]) {
  if (new RegExp("\\b" + word + "\\b").test(text)) flags.add(word);
}
// -h is handled by the CLI but never printed in --help; it is a flag
// all the same, and API.md documents it.
flags.add("-h");

const api = fs.readFileSync(apiPath, "utf8");
const missing = [...flags].sort().filter((f) => !api.includes(f));
if (missing.length > 0) {
  process.stderr.write("API text is missing --help flags: " + missing.join(", ") + "\n");
  process.exit(1);
}
process.stdout.write("check:api-txt OK (" + flags.size + " flags from --help all appear in " + path.basename(apiPath) + ")\n");
