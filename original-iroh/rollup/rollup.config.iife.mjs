import { createRequire } from "node:module";
import buble from "@rollup/plugin-buble";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import config from "./rollup.config.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export default {
  ...config,
  external: [],
  plugins: [
    ...config.plugins,
    buble(),
    nodeResolve({
      mainFields: ["jsnext:main", "module", "main"],
      browser: true
    }),
    commonjs()
  ],
  output: {
    file: pkg.browser,
    format: "iife",
    name: "iroh",
    strict: false
  }
};
