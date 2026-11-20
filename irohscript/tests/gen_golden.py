"""Generate the golden test fixtures (spec section 50).

Run once after reviewing the compiler output by hand:

    python3 tests/gen_golden.py

Each file stores source -> AST -> IR -> IRX. The golden test then
compares a fresh compile against the stored output, so any compiler
change that alters the representation is immediately visible.

These files were generated from the compiler and hand-checked line by
line before being committed as fixtures. Regenerating them silently
after a compiler change would defeat their purpose: if a golden test
fails, fix the compiler (or get Andy to approve the representation
change), do not just re-run this script.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.compiler import IrohCompiler  # noqa: E402

GOLDEN = {
    "let_int": "LET X : Int = 10",
    "add": ("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION\n"
            "LET result = Add(10, 20)\nPRINT result"),
    "defend": ('LET THREAT : Bool = TRUE\nIF THREAT\n'
               ' PRINT "Defend the archive."\nEND IF'),
    "legacy": "LET enemy : Bool = TRUE\nenemy -> defend",
    "basic_conditional": ("LET enemy : Bool = TRUE\nIF enemy\n"
                          " ACTION defend\nEND IF"),
    "fold": "LET X = 10 + 20\nPRINT X",
    "deadcode": ('IF FALSE\n PRINT "never"\nEND IF\nPRINT "alive"'),
    "const": 'CONST IDENTITY_ROOT = "AETHER-001"',
    "structs": ("STRUCT AgentState\n Trust : Float\n Curiosity : Float\n"
                " Stability : Float\nEND STRUCT\n"
                "ENUM BranchState\n ACTIVE\n PAUSED\n ARCHIVED\nEND ENUM\n"
                "LET State : AgentState\nState.Trust = 0.72\n"
                "PRINT State.Trust\nPRINT BranchState.ACTIVE"),
    "intent": ('FUNCTION Protect(target)\n'
               ' INTENT "protect " + target\nEND FUNCTION\n'
               'Protect("archive")'),
}


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "golden")
    os.makedirs(out_dir, exist_ok=True)
    compiler = IrohCompiler()
    for name, source in sorted(GOLDEN.items()):
        result = compiler.compile(source)
        payload = {"source": source,
                   "ast": result.ast.to_dict(),
                   "ir": result.ir,
                   "irx": result.irx}
        path = os.path.join(out_dir, name + ".json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, sort_keys=True, indent=2)
            handle.write("\n")
        print("wrote %s" % path)


if __name__ == "__main__":
    main()
