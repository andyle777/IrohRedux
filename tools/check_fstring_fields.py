#!/usr/bin/env python3
"""Layer 1 property check for generated Python (Fix Spec 3.6 layer 1).

Property P1 (spec 3.2): on Python before 3.12, a replacement field in an
f-string cannot contain the delimiter quote character, a backslash, a
`#` comment marker, or an unbalanced `{`, `}` or `:` that the parser
reads as the format-spec separator.

This checker enforces P1 on emitted text, using Python's own parser so
the checker and the target cannot share a bug:

* `ast.parse` failing is itself a detection (on a 3.9-3.11 interpreter
  the parse of a nested-quote f-string raises SyntaxError).
* For every `ast.JoinedStr` node, every `ast.FormattedValue` source
  segment is scanned for a quote character, a backslash, `#`, a `:`
  at bracket depth 0 (format-spec separator / lambda colon), and
  unbalanced braces.

It is deliberately NOT an `ast.parse(feature_version=...)` check: on a
3.12 interpreter `feature_version` does not walk the f-string tokenizer
back (spec 3.4), so that check passes text a real 3.9 box cannot
compile. This script never passes `feature_version`.

Usage:
    python3 tools/check_fstring_fields.py <file.py>
    python3 tools/check_fstring_fields.py -        # read stdin

Exit 0: no violations. Exit 1: violations found (each printed), or the
source does not parse.
"""

import ast
import sys


def _check_segment(seg, path, lineno):
    """Scan one replacement-field body (outer braces stripped).

    Returns a list of violation strings.
    """
    bad = []
    if '"' in seg:
        bad.append('contains a double quote')
    if "'" in seg:
        bad.append('contains a single quote')
    if "\\" in seg:
        bad.append('contains a backslash')
    if "#" in seg:
        bad.append('contains a # comment marker')
    # Track bracket depth: parens, square brackets and braces opened
    # inside the field. A ':' at depth 0 is the format-spec separator
    # (or a lambda colon), which the pre-3.12 parser reads as the end
    # of the expression. A '{' / '}' that unbalances the field is the
    # same class of failure.
    depth = 0
    brace_depth = 0
    for ch in seg:
        if ch in "([{":
            depth += 1
            if ch == "{":
                brace_depth += 1
        elif ch in ")]}":
            depth -= 1
            if ch == "}":
                brace_depth -= 1
            if brace_depth < 0:
                bad.append('contains an unbalanced }')
                brace_depth = 0
        elif ch == ":" and depth == 0:
            bad.append('contains a : at field depth 0 (format-spec separator)')
    if brace_depth > 0:
        bad.append('contains an unbalanced {')
    return ["%s:%s: f-string field {%s} %s" % (path, lineno, seg, b) for b in bad]


def check(src, path):
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return ["%s:%s: source does not parse: %s" % (path, e.lineno, e.msg)]
    bad = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            for value in node.values:
                if isinstance(value, ast.FormattedValue):
                    seg = ast.get_source_segment(src, value) or ""
                    # Strip the outer { ... } of the replacement field.
                    if seg.startswith("{") and seg.endswith("}"):
                        seg = seg[1:-1]
                    bad.extend(_check_segment(seg, path, getattr(value, "lineno", "?")))
    return bad


def main(argv):
    if len(argv) != 2:
        sys.stderr.write("usage: check_fstring_fields.py <file.py>|-\n")
        return 2
    if argv[1] == "-":
        src = sys.stdin.read()
        path = "<stdin>"
    else:
        path = argv[1]
        with open(path, encoding="utf-8") as f:
            src = f.read()
    bad = check(src, path)
    for line in bad:
        print(line)
    if bad:
        print("%d f-string field violation(s) in %s" % (len(bad), path))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
