import { createRequire } from "node:module";
import config from "./rollup.config.mjs";
import buble from "@rollup/plugin-buble";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export default {
  ...config,
  external: [],
  plugins: [
    ...config.plugins,
    buble(),
    nodeResolve({
      mainFields: ["main"],
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
