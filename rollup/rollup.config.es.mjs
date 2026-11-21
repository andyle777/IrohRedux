import { createRequire } from "node:module";
import config from "./rollup.config.mjs";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export default {
  ...config,
  plugins: [
    ...config.plugins,
    nodeResolve({ mainFields: ["main"] }),
    commonjs()
  ],
  output: {
    file: pkg.module,
    format: "es",
    strict: false
  }
};
