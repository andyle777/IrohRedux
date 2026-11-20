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
