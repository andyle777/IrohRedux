import json from "rollup-plugin-json";

export default {
  entry: "src/index.js",
  moduleName: "iroh",
  external: [
    "acorn",
    "acorn-walk",
    "astring"
  ],
  plugins: [
    json()
  ],
  useStrict: false
}