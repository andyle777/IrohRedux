#!/bin/bash
# Execution-matrix gate for the Python translator (Fix Spec 3.6 layer 2,
# 8.2), ported to the 1.1.0 tree. For each template-literal case it:
#   1. runs the JS under node for the expected output,
#   2. emits Python through the dist under test,
#   3. runs the Layer 1 property check (tools/check_fstring_fields.py),
#   4. runs the emitted file on Python 3.9, 3.10, 3.11 and 3.12 and
#      diffs the output against node's.
#
# Usage: tools/check-translate-matrix.sh [dist-path]
#   dist-path defaults to dist/iroh-node.js (relative to the repo root).
#
# INTERPRETER COVERAGE — READ THIS BEFORE TRUSTING A GREEN RUN:
# This gate MUST run all four interpreters. A missing interpreter
# FAILS the gate; it is never silently skipped (a gate that silently
# reduces coverage is how the 3.12 blind spot survived in the first
# place — spec 3.4). Interpreters are resolved, per version, in this
# order: $PY39 / $PY310 / $PY311 / $PY312 if set, then python3.9 etc.
# on PATH, then the standalone builds under .pythons/ in this repo
# (indygreg python-build-standalone install_only tarballs, extracted
# locally; they are NOT checked in — see .gitignore). There is no CI
# in the 1.1.0 tree (no .github/workflows), so this gate runs locally
# via `npm run check:matrix`; a CI job would install all four via
# actions/setup-python and run the same script.
#
# This gate does NOT use ast.parse(feature_version=...) anywhere: on a
# 3.12 box that check parses text a real 3.9 box cannot compile
# (spec 3.4). The only honest check for "runs on 3.9-3.11" is running
# it on 3.9-3.11.
#
# Exit 0: every case green on every interpreter. Exit 1 otherwise.
# The gate is written to FAIL on the pre-fix 1.1.0 dist: FOUR of the
# cases below emit f-strings that are SyntaxErrors below 3.12 — the
# three string cases from spec 3.3 (string literal in a field,
# ternary of strings, literal text + field) AND the bool case, which
# 1.1.0 never fixed (1.1.1 fixed bool only, as D1; 1.1.0 still emits
# the inline ("true" if v else "false") ternary inside the f-string).
# Expect 20 FAIL lines on the old dist (5 failing cases x 1 property
# check + 3 interpreters each).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${1:-$ROOT/dist/iroh-node.js}"
case "$DIST" in
  /*) ;;
  *) DIST="$ROOT/$DIST" ;;
esac

fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- resolve interpreters (missing = FAIL, never skip) ----------------
declare -A PY
for spec in "39:3.9" "310:3.10" "311:3.11" "312:3.12"; do
  key="${spec%%:*}"; ver="${spec##*:}"
  envvar="PY$key"
  cand="${!envvar:-}"
  if [ -z "$cand" ] && command -v "python$ver" >/dev/null 2>&1; then
    cand="$(command -v "python$ver")"
  fi
  if [ -z "$cand" ]; then
    # standalone builds are versioned py3.9.20 etc; match the dir prefix
    for d in "$ROOT"/.pythons/py"$ver".*/bin/python3; do
      [ -x "$d" ] && cand="$d" && break
    done
  fi
  if [ -z "$cand" ]; then
    echo "MISSING python$ver (gate cannot pass blind)"
    fail=1
  else
    PY["$ver"]="$cand"
    echo "python$ver: $cand ($("$cand" --version 2>&1))"
  fi
done

# --- cases ------------------------------------------------------------
# Four red-on-1.1.0 cases (spec 3.3 + the unfixed bool case), the
# double case, and a quote-inside-a-quote case (spec 8.2).
CASES=(
  'console.log(`a=${"lit"}`);'
  'const ok=true;console.log(`a=${ok ? "yes" : "no"}`);'
  'console.log(`pre${"x"}post`);'
  'const b=true;console.log(`b=${b}`);'
  'console.log(`n=${1e16}`);'
  'console.log(`s=${"a\"b"}`);'
)

n=0
for c in "${CASES[@]}"; do
  n=$((n + 1))
  js="$TMP/case$n.js"
  py="$TMP/case$n.py"
  printf '%s\n' "$c" > "$js"
  exp="$(node "$js" 2>&1)"
  node_status=$?
  if [ "$node_status" -ne 0 ]; then
    echo "FAIL case $n: node itself failed on: $c"
    echo "  node: $exp"
    fail=1
    continue
  fi
  # 2) emit Python through the dist under test
  if ! node "$ROOT/tools/emit-translation.cjs" "$DIST" "$js" > "$py" 2> "$TMP/emit$n.err"; then
    echo "FAIL case $n: emit failed: $c"
    cat "$TMP/emit$n.err"
    fail=1
    continue
  fi
  # 3) Layer 1 property check, before execution
  if ! python3 "$ROOT/tools/check_fstring_fields.py" "$py" > "$TMP/check$n.out" 2>&1; then
    echo "FAIL case $n: f-string property check: $c"
    cat "$TMP/check$n.out"
    fail=1
  fi
  # 4) run on every interpreter, diff against node
  for ver in 3.9 3.10 3.11 3.12; do
    interp="${PY[$ver]:-}"
    [ -n "$interp" ] || continue  # already counted as MISSING above
    got="$("$interp" "$py" 2>&1)"
    status=$?
    if [ "$status" -ne 0 ] || [ "$got" != "$exp" ]; then
      echo "FAIL case $n on python$ver: $c"
      echo "  expected: $exp"
      echo "  got (exit $status): $got"
      fail=1
    fi
  done
done

if [ "$fail" -eq 0 ]; then
  echo "MATRIX GREEN: ${#CASES[@]} cases x 4 interpreters, dist $DIST"
else
  echo "MATRIX RED: dist $DIST"
fi
exit "$fail"
