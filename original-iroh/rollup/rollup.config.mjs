import json from "@rollup/plugin-json";

export default {
  input: "src/index.js",
  external: [
    "acorn",
    "acorn/dist/walk",
    "astring"
  ],
  plugins: [
    json({ compact: true })
  ]
};
