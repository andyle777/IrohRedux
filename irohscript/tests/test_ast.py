"""AST + canonicalization tests (spec section 7: one Conditional)."""

import unittest

from src import ast_nodes as A
from src.irohcore import IrohCore
from src.parser import parse


def canon(source):
    return IrohCore().canonicalize(parse(source))


class TestCanonicalization(unittest.TestCase):
    def test_legacy_equals_basic_conditional(self):
        """Spec section 7: both spellings produce the same Conditional."""
        legacy = canon("enemy -> defend")
        basic = canon("IF enemy\n ACTION defend\nEND IF")
        self.assertEqual(legacy.to_dict(), basic.to_dict())

    def test_legacy_conditional_shape(self):
        node = canon("enemy -> defend").statements[0]
        self.assertEqual(node.to_dict(), {
            "node": "Conditional",
            "condition": {"node": "Name", "name": "enemy"},
            "action": {"node": "Literal", "value": "defend",
                       "type": "String"},
        })

    def test_single_action_if_becomes_conditional(self):
        node = canon('IF x\n ACTION "go"\nEND IF').statements[0]
        self.assertIsInstance(node, A.Conditional)

    def test_if_with_print_stays_if(self):
        node = canon('IF x\n PRINT "hi"\nEND IF').statements[0]
        self.assertIsInstance(node, A.If)

    def test_if_with_else_stays_if(self):
        node = canon('IF x\n ACTION "a"\nELSE\n ACTION "b"\nEND IF')
        self.assertIsInstance(node.statements[0], A.If)

    def test_multi_action_if_stays_if(self):
        node = canon('IF x\n ACTION "a"\n ACTION "b"\nEND IF')
        self.assertIsInstance(node.statements[0], A.If)

    def test_canonicalization_inside_function(self):
        node = canon("FUNCTION F()\n IF x\n ACTION y\n END IF\nEND FUNCTION")
        inner = node.statements[0].body[0]
        self.assertIsInstance(inner, A.Conditional)

    def test_canonicalization_inside_loop(self):
        node = canon("LOOP\n IF x\n ACTION y\n END IF\nEND")
        self.assertIsInstance(node.statements[0].body[0], A.Conditional)


class TestAstToDict(unittest.TestCase):
    def test_let_dict_matches_spec_section_24(self):
        node = parse("LET X : Int = 10").statements[0]
        self.assertEqual(node.to_dict(), {
            "node": "Let", "name": "X", "type": "Int",
            "value": {"node": "Literal", "value": 10, "type": "Int"},
        })

    def test_program_dict(self):
        prog = parse("PRINT 1")
        d = prog.to_dict()
        self.assertEqual(d["node"], "Program")
        self.assertEqual(len(d["statements"]), 1)

    def test_function_dict(self):
        node = parse("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION")
        node = node.statements[0]
        d = node.to_dict()
        self.assertEqual(d["node"], "FunctionDef")
        self.assertEqual(d["params"],
                         [{"name": "a", "type": None},
                          {"name": "b", "type": None}])


class TestAstWithConds(unittest.TestCase):
    """Amendment A2: the translation view of the AST carries the
    Amendment A1 Loop cond (golden to_dict stays cond-free).
    """

    def test_conditional_loop_cond_is_grafted(self):
        program = canon("LOOP i < 3\n PRINT 1\nEND")
        out = A.ast_with_conds(program)
        loop = out["statements"][0]
        self.assertIs(loop["node"], "Loop")
        self.assertIsNotNone(loop["cond"])
        self.assertEqual(loop["cond"]["node"], "BinOp")
        self.assertEqual(loop["cond"]["op"], "LT")

    def test_legacy_loop_cond_is_none(self):
        program = canon("LOOP\n PRINT 1\nEND")
        out = A.ast_with_conds(program)
        self.assertIsNone(out["statements"][0]["cond"])

    def test_nested_loops_get_conds(self):
        program = canon(
            "LOOP i < 3\n"
            " IF i > 1\n"
            "  LOOP i < 1\n"
            "   PRINT 99\n"
            "  END\n"
            " ELSE\n"
            "  PRINT 0\n"
            " END IF\n"
            " i = i + 1\n"
            "END LOOP\n"
            "FUNCTION F()\n"
            " LOOP TRUE\n"
            "  RETURN 1\n"
            " END\n"
            "END FUNCTION\n")
        out = A.ast_with_conds(program)
        found = []

        def walk(node):
            if isinstance(node, dict):
                if node.get("node") == "Loop":
                    found.append(node.get("cond"))
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(out)
        # outer loop, loop inside the IF branch, loop in F's body
        self.assertEqual(len(found), 3)
        self.assertTrue(all(c is not None for c in found))

    def test_to_dict_stays_byte_stable(self):
        # The graft touches only its own view; to_dict() output
        # (and so every golden AST file) is unchanged.
        program = canon("LOOP i < 3\n PRINT 1\nEND")
        self.assertEqual(program.to_dict(), {
            "node": "Program",
            "statements": [{"node": "Loop", "body": [
                {"node": "Print",
                 "value": {"node": "Literal", "value": 1,
                           "type": "Int"}}]}],
        })
        self.assertNotIn("cond", program.to_dict()["statements"][0])

    def test_length_drift_is_asserted(self):
        # The graft never walks blind: a statement list whose dict
        # twin has drifted in length fails loudly instead of
        # silently dropping statements (the A1 lesson).
        program = canon("LOOP i < 1\n PRINT 1\nEND")
        out = A.ast_with_conds(program)
        with self.assertRaises(AssertionError):
            A._graft_conds(program.statements, out["statements"][:-1])


class TestIrohCoreIntents(unittest.TestCase):
    def test_record_intent(self):
        core = IrohCore()
        entry = core.record_intent("protect archive")
        self.assertEqual(entry, {"text": "protect archive",
                                 "origin": "program"})
        self.assertEqual(len(core.intents), 1)

    def test_identity_root_default_none(self):
        self.assertIsNone(IrohCore().identity_root)

    def test_set_identity_root(self):
        core = IrohCore()
        core.set_identity_root("AETHER-001")
        self.assertEqual(core.identity_root, "AETHER-001")


if __name__ == "__main__":
    unittest.main()
