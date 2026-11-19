# Changelog

## 0.4.0 — Fix and extend (21 Nov 2026, AEDT 19 Nov 2026)

Fork of Felix Maier's Iroh 0.3.0 (last upstream commit Jan 2018), kept under
the name `iroh` in `package.json`. The core engine is unchanged: parse with
Acorn, rewrite the AST in 8 patch stages, regenerate with astring, fire
listeners while the code runs.

### Fixed — real bugs, not just age
- **Arrow functions as callbacks crashed.** `STAGE6` passed the generated
  arrow name (`$$ANON_ARROW_*`) as a bare identifier to `DEBUG_FUNCTION_ENTER`,
  but astring never emits an `id` for arrows, so `[1,2,3].map(x => x * 2)`
  threw `ReferenceError: $$ANON_ARROW_* is not defined`. The name is now
  passed as a string literal (it is only stored as `currentScope` and the
  event name comes from `nodes[hash].node.id.name`). Same fix for
  `FunctionExpression` — object methods and getters (`m() {}`, `get v() {}`)
  also lose the artificial id in generated code and threw the same way.
- **Expression-bodied arrows returned `undefined`.** The old code built a
  `DEBUG_FUNCTION_RETURN` call into the dead `node.argument` field and left
  the expression bare in the block. Arrows now convert to a block with a
  real `ReturnStatement`, handled by the normal return path.
- **`null ?? 7` evaluated to `null`.** The `OP` table had no `??` and
  `DEBUG_LOGICAL` had no case for it, so the result fell through as `null`.
  Both added; `??=` also works.
- **Private fields crashed.** The `MemberExpression` patch passed a bare
  `#x` identifier to `DEBUG_MEMBER_EXPR` — invalid JS outside a member
  expression. `PrivateIdentifier` is now passed as a string literal, while
  the outer member keeps the original node so `.#x` still generates.
- **Class methods printed to stdout.** `DEBUG_METHOD_ENTER`/`LEAVE` were the
  only debug traces left live; they printed `method`/`ctor` on every class
  method call. Silenced like the rest of the file.
- **Build warning.** Rollup warned about unresolved `acorn/dist/walk`;
  the walk code now comes from the `acorn-walk` package.
- **Browser build.** Broke during the upgrade (buble cannot parse astring
  1.9's `.mjs`; the old `namedExports` for astring conflicted with 1.9).
  The iife config now resolves CJS entry points and only declares
  `namedExports` for acorn/acorn-walk. `npm run browser` builds again and
  the bundle was verified to run.
- **Dead links.** README/GETTING_STARTED pointed at `maierfelix.github.io`,
  the rawgit CDN (dead) and the upstream repo. Now pointed at this repo;
  the browser distribution is built locally with `npm run browser`.

### Extended — modern syntax (Acorn 5 → 8.19, astring 1 → 1.9)
- Parses ES2022 (pinned `ecmaVersion: 2022` in `Stage.patch` and in the
  internal `parse()` helpers): optional chaining, nullish coalescing,
  async/await, class fields, private fields, logical assignment.
  Node types with no dedicated patch handler are walked generically by
  acorn-walk's base visitors — they run, they just don't get their own
  listener yet. `import`/`export` still require `sourceType: module` and
  are intentionally unsupported.
- `engines` is now `node >= 18` (was `>= 6`).

### Tests — first real suite
- `tests/index.js` was a stub that threw `Not implemented yet`. There is
  now a real suite in `tests/iroh.test.js` on Node's built-in test runner
  (no new dependencies): **15 tests, all passing on Node v24.22.1** —
  factorial trace, VAR/CALL/FUNCTION listeners, return-value rewriting,
  the arrow/method/getter regressions, stdout silence for class methods,
  modern syntax, control flow, and listener coverage.

### Known limitations
- No dedicated listeners yet for the new constructs (optional chaining,
  `await`, class fields) — they execute and can be observed through the
  listeners on the expressions around them, but there is no `Iroh.AWAIT`
  or `Iroh.CHAIN` event.
- `tests/expressions/*` fixtures from 2017 are still unused by the suite.

## 0.3.0 — upstream (Jan 2018)

Last upstream release by Felix Maier. See git history.
