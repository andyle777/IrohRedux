import json from "@rollup/plugin-json";

export default {
  input: "src/index.js",
  external: [
    "acorn",
    "acorn-walk",
    "astring"
  ],
  plugins: [
    json()
  ]
}