"""Optimizer tests (spec sections 27-28)."""

import unittest

from src.compiler import IrohCompiler


def compile_ir(source):
    return IrohCompiler().compile(source).ir


class TestConstantFolding(unittest.TestCase):
    def test_fold_add(self):
        ir = compile_ir("LET X = 10 + 20")
        self.assertEqual(ir[0]["value"],
                         {"op": "LIT", "value": 30, "type": "Int"})

    def test_fold_nested(self):
        ir = compile_ir("LET X = (1 + 2) * (3 + 4)")
        self.assertEqual(ir[0]["value"]["value"], 21)

    def test_fold_string_concat(self):
        ir = compile_ir('LET X = "a" + "b"')
        self.assertEqual(ir[0]["value"]["value"], "ab")

    def test_fold_comparison(self):
        ir = compile_ir("LET X = 3 > 2")
        self.assertEqual(ir[0]["value"]["value"], True)

    def test_fold_not(self):
        ir = compile_ir("LET X = NOT FALSE")
        self.assertEqual(ir[0]["value"]["value"], True)

    def test_fold_neg(self):
        ir = compile_ir("LET X = -5")
        self.assertEqual(ir[0]["value"]["value"], -5)

    def test_no_fold_div_by_zero(self):
        ir = compile_ir("LET X = 1 / 0")
        self.assertEqual(ir[0]["value"]["op"], "DIV")

    def test_no_fold_mod_by_zero(self):
        ir = compile_ir("LET X = 1 % 0")
        self.assertEqual(ir[0]["value"]["op"], "MOD")

    def test_no_fold_unknown_operands(self):
        ir = compile_ir("LET Y = 1\nLET X = Y + 2")
        self.assertEqual(ir[1]["value"]["op"], "ADD")


class TestDeadCodeElimination(unittest.TestCase):
    def test_if_false_eliminated(self):
        ir = compile_ir('IF FALSE\n PRINT "never"\nEND IF')
        self.assertEqual(ir, [])

    def test_if_true_spliced(self):
        ir = compile_ir('IF TRUE\n PRINT "yes"\nEND IF')
        self.assertEqual(len(ir), 1)
        self.assertEqual(ir[0]["op"], "PRINT")

    def test_after_return_removed(self):
        ir = compile_ir("FUNCTION F()\n RETURN 1\n PRINT 2\nEND FUNCTION")
        self.assertEqual(len(ir[0]["body"]), 1)
        self.assertEqual(ir[0]["body"][0]["op"], "RETURN")

    def test_if_false_in_function(self):
        ir = compile_ir("FUNCTION F()\n IF FALSE\n RETURN 1\n END IF\n"
                        " RETURN 2\nEND FUNCTION")
        self.assertEqual(len(ir[0]["body"]), 1)
        self.assertEqual(ir[0]["body"][0]["op"], "RETURN")


if __name__ == "__main__":
    unittest.main()
