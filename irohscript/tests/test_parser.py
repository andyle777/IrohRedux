"""Parser tests: every BASIC construct plus the legacy dialect."""

import unittest

from src import ast_nodes as A
from src.errors import ParseError
from src.parser import parse


class TestParserLet(unittest.TestCase):
    def test_let_typed(self):
        prog = parse("LET X : Int = 10")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Let)
        self.assertEqual((node.name, node.type_ann), ("X", "Int"))
        self.assertEqual(node.value.value, 10)

    def test_let_inferred(self):
        prog = parse('LET Name = "Aether"')
        node = prog.statements[0]
        self.assertIsNone(node.type_ann)
        self.assertEqual(node.value.type_name, "String")

    def test_let_generic_type(self):
        prog = parse("LET V : Vector<Float> = x")
        node = prog.statements[0]
        self.assertEqual(node.type_ann, "Vector<Float>")

    def test_let_default_instance(self):
        prog = parse("LET State : AgentState")
        node = prog.statements[0]
        self.assertIsNone(node.value)
        self.assertEqual(node.type_ann, "AgentState")

    def test_let_needs_value_or_type(self):
        with self.assertRaises(ParseError):
            parse("LET x")

    def test_const(self):
        prog = parse('CONST IDENTITY_ROOT = "AETHER-001"')
        node = prog.statements[0]
        self.assertTrue(node.is_const)
        self.assertEqual(node.value.value, "AETHER-001")

    def test_const_needs_value(self):
        with self.assertRaises(ParseError):
            parse("CONST X : Int")


class TestParserExpressions(unittest.TestCase):
    def test_precedence_mul_over_add(self):
        prog = parse("LET x = 1 + 2 * 3")
        expr = prog.statements[0].value
        self.assertEqual(expr.op, "ADD")
        self.assertEqual(expr.right.op, "MUL")

    def test_precedence_comparison(self):
        prog = parse("LET x = a + 1 == b")
        expr = prog.statements[0].value
        self.assertEqual(expr.op, "EQ")

    def test_parentheses(self):
        prog = parse("LET x = (1 + 2) * 3")
        expr = prog.statements[0].value
        self.assertEqual(expr.op, "MUL")
        self.assertEqual(expr.left.op, "ADD")

    def test_and_or_not(self):
        prog = parse("LET x = NOT a AND b OR c")
        expr = prog.statements[0].value
        self.assertEqual(expr.op, "OR")
        self.assertEqual(expr.left.op, "AND")

    def test_string_concat(self):
        prog = parse('LET x = "a" + "b"')
        expr = prog.statements[0].value
        self.assertEqual(expr.op, "ADD")

    def test_call_args(self):
        prog = parse("LET x = Add(10, 20)")
        call = prog.statements[0].value
        self.assertIsInstance(call, A.Call)
        self.assertEqual(len(call.args), 2)

    def test_member_access(self):
        prog = parse("LET x = State.Trust")
        expr = prog.statements[0].value
        self.assertIsInstance(expr, A.MemberAccess)
        self.assertEqual(expr.member, "Trust")

    def test_unary_minus(self):
        prog = parse("LET x = -5")
        expr = prog.statements[0].value
        self.assertIsInstance(expr, A.UnaryOp)
        self.assertEqual(expr.op, "NEG")


class TestParserStatements(unittest.TestCase):
    def test_if_else(self):
        prog = parse("IF a\n PRINT 1\nELSE\n PRINT 2\nEND IF")
        node = prog.statements[0]
        self.assertIsInstance(node, A.If)
        self.assertEqual(len(node.then_body), 1)
        self.assertEqual(len(node.else_body), 1)

    def test_if_bare_end(self):
        prog = parse("IF a\n PRINT 1\nEND")
        self.assertIsInstance(prog.statements[0], A.If)

    def test_function_params(self):
        prog = parse("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION")
        node = prog.statements[0]
        self.assertEqual(node.name, "Add")
        self.assertEqual([n for n, _ in node.params], ["a", "b"])

    def test_function_typed_param(self):
        prog = parse("FUNCTION COMPILE(source : String)\n RETURN 1\nEND FUNCTION")
        node = prog.statements[0]
        self.assertEqual(node.params, [("source", "String")])

    def test_struct(self):
        prog = parse("STRUCT AgentState\n Trust : Float\nEND STRUCT")
        node = prog.statements[0]
        self.assertEqual(node.fields, [("Trust", "Float")])

    def test_enum(self):
        prog = parse("ENUM BranchState\n ACTIVE\n PAUSED\nEND ENUM")
        node = prog.statements[0]
        self.assertEqual(node.members, ["ACTIVE", "PAUSED"])

    def test_import(self):
        prog = parse("IMPORT Memory")
        self.assertEqual(prog.statements[0].name, "Memory")

    def test_intent(self):
        prog = parse('INTENT "protect archive"')
        self.assertIsInstance(prog.statements[0], A.Intent)

    def test_loop(self):
        prog = parse("LOOP\n PRINT 1\nEND")
        self.assertIsInstance(prog.statements[0], A.Loop)
        # The bare legacy form carries no condition (Amendment A1
        # keeps cond None so the run-time error stays byte-stable).
        self.assertIsNone(prog.statements[0].cond)

    def test_conditional_loop_parses(self):
        # Amendment A1 (2026-11-21): LOOP <Bool-expr> is the decided
        # conditional (test-first) form.
        prog = parse("LOOP i < 3\n PRINT 1\nEND")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Loop)
        self.assertIsNotNone(node.cond)
        self.assertIsInstance(node.cond, A.BinOp)
        self.assertEqual(node.cond.op, "LT")

    def test_conditional_loop_accepts_end_loop(self):
        prog = parse("LOOP x\n PRINT 1\nEND LOOP")
        self.assertIsInstance(prog.statements[0], A.Loop)
        self.assertIsNotNone(prog.statements[0].cond)

    def test_lowered_conditional_loop_keeps_cond_through_compile(self):
        # Regression: IrohCore.canonicalize used to rebuild Loop
        # without the cond, so the condition vanished before IR.
        from src.irohcore import IrohCore
        ast = IrohCore().canonicalize(parse("LOOP i < 3\n PRINT 1\nEND"))
        node = ast.statements[0]
        self.assertIsInstance(node, A.Loop)
        self.assertIsNotNone(node.cond)

    def test_assignment(self):
        prog = parse("x = 5")
        self.assertIsInstance(prog.statements[0], A.Assign)

    def test_member_assignment(self):
        prog = parse("State.Trust = 0.5")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Assign)
        self.assertIsInstance(node.target, A.MemberAccess)

    def test_nested_member_assignment(self):
        prog = parse("o.inner.x = 3")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Assign)
        self.assertIsInstance(node.target, A.MemberAccess)
        self.assertEqual(node.target.member, "x")
        self.assertIsInstance(node.target.obj, A.MemberAccess)
        self.assertEqual(node.target.obj.member, "inner")

    def test_bare_call_statement(self):
        prog = parse('Protect("archive")')
        self.assertIsInstance(prog.statements[0], A.Call)

    def test_missing_end(self):
        with self.assertRaises(ParseError):
            parse("IF a\n PRINT 1")

    def test_bare_expression_statement_rejected(self):
        with self.assertRaises(ParseError):
            parse("1 + 2")

    def test_action_bare_identifier_is_symbol(self):
        prog = parse("ACTION defend")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Action)
        self.assertEqual(node.value.value, "defend")
        self.assertEqual(node.value.type_name, "String")


class TestParserLegacy(unittest.TestCase):
    def test_legacy_arrow(self):
        prog = parse("enemy -> defend")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Conditional)
        self.assertEqual(node.condition.name, "enemy")
        self.assertEqual(node.action.value, "defend")

    def test_legacy_if_block(self):
        prog = parse("if condition\n consequence -> effect\nend")
        node = prog.statements[0]
        self.assertIsInstance(node, A.If)
        self.assertIsInstance(node.then_body[0], A.Conditional)

    def test_legacy_loop_block(self):
        prog = parse("loop\n action -> result\nend")
        node = prog.statements[0]
        self.assertIsInstance(node, A.Loop)
        self.assertIsInstance(node.body[0], A.Conditional)


if __name__ == "__main__":
    unittest.main()
