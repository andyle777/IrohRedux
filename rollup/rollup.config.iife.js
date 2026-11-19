const pkg = require("../package.json");
import config from "./rollup.config";
import json from "rollup-plugin-json";
import buble from "rollup-plugin-buble";
import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";

config.format = "iife";
config.dest = pkg.browser;
/*config.paths = { 
  "acorn/dist/walk": "acorn/dist/walk"
};*/
config.external = [];
config.plugins = [
  json(),
  buble(),
  // NOTE: resolve the CJS entry points (main), not the ESM ones (jsnext/module):
  // buble is ES2015-only and cannot parse astring 1.9's .mjs.
  resolve({
    main: true,
    module: false,
    jsnext: false,
    browser: true
  }),
  // namedExports only where the plugin fails to infer them: acorn's
  // `parse` and acorn-walk's walkers. astring must NOT be listed — its
  // 1.9 CJS file already exports `generate` and a manual entry creates a
  // duplicate export.
  commonjs({
    namedExports: {
      "node_modules/acorn/dist/acorn.js": ["parse"],
      "node_modules/acorn-walk/dist/walk.js": ["base", "full", "recursive"]
    }
  })
];

export default config;
