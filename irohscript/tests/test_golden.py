"""Golden tests (spec section 50).

Every language construct gets a canonical source -> AST -> IR -> IRX
with the expected output stored in tests/golden/*.json. A compiler
change that unexpectedly alters the representation fails here first.
"""

import json
import os
import unittest

from src.compiler import IrohCompiler

GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "golden")


class TestGolden(unittest.TestCase):
    def test_all_golden_files(self):
        files = sorted(f for f in os.listdir(GOLDEN_DIR)
                       if f.endswith(".json"))
        self.assertGreater(len(files), 0, "no golden files found")
        for filename in files:
            with self.subTest(golden=filename):
                path = os.path.join(GOLDEN_DIR, filename)
                with open(path, "r", encoding="utf-8") as handle:
                    expected = json.load(handle)
                result = IrohCompiler().compile(expected["source"])
                self.assertEqual(result.ast.to_dict(), expected["ast"],
                                 "AST drift in %s" % filename)
                self.assertEqual(result.ir, expected["ir"],
                                 "IR drift in %s" % filename)
                self.assertEqual(result.irx, expected["irx"],
                                 "IRX drift in %s" % filename)

    def test_legacy_and_basic_share_golden_ast(self):
        """Spec section 7, enforced at the golden level too."""
        with open(os.path.join(GOLDEN_DIR, "legacy.json")) as handle:
            legacy = json.load(handle)
        with open(os.path.join(GOLDEN_DIR, "basic_conditional.json")) as h:
            basic = json.load(h)
        self.assertEqual(legacy["ast"], basic["ast"])
        self.assertEqual(legacy["ir"], basic["ir"])
        self.assertEqual(legacy["irx"], basic["irx"])


if __name__ == "__main__":
    unittest.main()
