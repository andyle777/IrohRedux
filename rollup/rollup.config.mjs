import json from "@rollup/plugin-json";

export default {
  input: "src/index.js",
  // Self-contained dist (2026-11-21): acorn, acorn-walk and
  // astring are bundled into the dist files instead of being
  // required at runtime, so the CLI runs from a source checkout
  // with zero npm installs; a restricted AI sandbox needs nothing
  // but Node on PATH. The npm package still declares the three
  // dependencies; npm consumers are unaffected either way.
  external: [],
  plugins: [
    json({ compact: true })
  ]
}