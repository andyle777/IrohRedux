"""Interpreter tests: programs that actually run."""

import unittest

from src.bridge import IrohRuntime
from src.errors import CompileError, IrohRuntimeError


def run(source):
    return IrohRuntime().run_source(source)


class TestInterpreterRequiredPrograms(unittest.TestCase):
    def test_let_int(self):
        out = run("LET X : Int = 10")
        self.assertEqual(out["variables"]["X"], 10)

    def test_add_function_prints_30(self):
        # Add(10, 20) is 30: 10 + 20 = 30.
        out = run("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION\n"
                  "LET result = Add(10, 20)\nPRINT result")
        self.assertEqual(out["output"], ["30"])
        self.assertEqual(out["variables"]["result"], 30)

    def test_if_threat_true_prints(self):
        out = run('LET THREAT : Bool = TRUE\nIF THREAT\n'
                  ' PRINT "Defend the archive."\nEND IF')
        self.assertEqual(out["output"], ["Defend the archive."])

    def test_if_threat_false_prints_nothing(self):
        out = run('LET THREAT : Bool = FALSE\nIF THREAT\n'
                  ' PRINT "Defend the archive."\nEND IF')
        self.assertEqual(out["output"], [])

    def test_legacy_defend(self):
        out = run("LET enemy : Bool = TRUE\nenemy -> defend")
        self.assertEqual(out["output"], ["defend"])
        self.assertEqual(out["actions"], ["defend"])

    def test_legacy_enemy_false_no_action(self):
        out = run("LET enemy : Bool = FALSE\nenemy -> defend")
        self.assertEqual(out["output"], [])
        self.assertEqual(out["actions"], [])

    def test_constant_folding_runs(self):
        out = run("LET X = 10 + 20\nPRINT X")
        self.assertEqual(out["output"], ["30"])

    def test_dead_code_runs(self):
        out = run('IF FALSE\n PRINT "never"\nEND IF\nPRINT "alive"')
        self.assertEqual(out["output"], ["alive"])

    def test_const_mutation_rejected(self):
        with self.assertRaises(CompileError):
            run('CONST IDENTITY_ROOT = "AETHER-001"\n'
                'IDENTITY_ROOT = "OTHER"')

    def test_type_error_rejected(self):
        with self.assertRaises(CompileError):
            run('LET X : Int = "hello"')


class TestInterpreterFeatures(unittest.TestCase):
    def test_struct_default_and_field_assign(self):
        out = run("STRUCT AgentState\n Trust : Float\nEND STRUCT\n"
                  "LET State : AgentState\nState.Trust = 0.72\n"
                  "PRINT State.Trust")
        self.assertEqual(out["output"], ["0.72"])
        self.assertEqual(out["variables"]["State"]["Trust"], 0.72)

    def test_struct_defaults(self):
        out = run("STRUCT S\n A : Int\n B : String\n C : Bool\nEND STRUCT\n"
                  "LET s : S")
        self.assertEqual(out["variables"]["s"],
                         {"$struct": "S", "A": 0, "B": "", "C": False})

    def test_nested_struct_default_and_field_assign(self):
        # A struct-typed field defaults to a struct of its own type,
        # recursively — `LET o : Outer` gives o.inner as an Inner
        # value, so `o.inner.x = 3` works (before the fix the field
        # defaulted to None and the assignment died with "Cannot set
        # a field on a non-struct").
        out = run("STRUCT Inner\n X : Int\nEND STRUCT\n"
                  "STRUCT Outer\n Inner : Inner\n N : Int\nEND STRUCT\n"
                  "LET o : Outer\no.N = 7\no.Inner.X = 3\n"
                  "PRINT o.N + o.Inner.X")
        self.assertEqual(out["output"], ["10"])
        self.assertEqual(out["variables"]["o"],
                         {"$struct": "Outer",
                          "Inner": {"$struct": "Inner", "X": 3}, "N": 7})

    def test_enum_member(self):
        out = run("ENUM BranchState\n ACTIVE\n PAUSED\nEND ENUM\n"
                  "PRINT BranchState.ACTIVE")
        self.assertEqual(out["output"], ["BranchState.ACTIVE"])

    def test_intent_recorded_in_core(self):
        out = run('FUNCTION Protect(target)\n'
                  ' INTENT "protect " + target\nEND FUNCTION\n'
                  'Protect("archive")')
        self.assertEqual(out["intents"],
                         [{"text": "protect archive", "origin": "program"}])

    def test_function_first_class(self):
        out = run("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION\n"
                  "LET f = Add\nLET x = f(3, 4)\nPRINT x")
        self.assertEqual(out["output"], ["7"])

    def test_recursion_factorial(self):
        out = run("FUNCTION Fact(n)\n IF n <= 1\n RETURN 1\n ELSE\n"
                  " RETURN n * Fact(n - 1)\n END IF\nEND FUNCTION\n"
                  "PRINT Fact(5)")
        self.assertEqual(out["output"], ["120"])

    def test_bool_prints_true_false(self):
        out = run("PRINT TRUE\nPRINT FALSE")
        self.assertEqual(out["output"], ["TRUE", "FALSE"])

    def test_else_branch(self):
        out = run("LET x : Int = 1\nIF x == 2\n PRINT \"two\"\n"
                  "ELSE\n PRINT \"other\"\nEND IF")
        self.assertEqual(out["output"], ["other"])

    def test_division_by_zero_runtime_error(self):
        with self.assertRaises(IrohRuntimeError):
            run("LET x = 1 / 0\nPRINT x")

    def test_loop_raises_clear_error(self):
        with self.assertRaises(IrohRuntimeError) as ctx:
            run("LOOP\n PRINT 1\nEND")
        self.assertIn("LOOP", str(ctx.exception))

    def test_conditional_loop_executes_and_terminates(self):
        # Amendment A1: LOOP <Bool> is test-first, like IF.
        out = run("LET i : Int = 0\nLOOP i < 3\n"
                  " PRINT i\n i = i + 1\nEND LOOP\n")
        self.assertEqual(out["output"], ["0", "1", "2"])
        self.assertEqual(out["variables"]["i"], 3)

    def test_conditional_loop_zero_iterations(self):
        out = run('LET f : Bool = FALSE\nLOOP f\n'
                  ' PRINT "never"\nEND LOOP\n')
        self.assertEqual(out["output"], [])

    def test_conditional_loop_requires_bool_condition(self):
        with self.assertRaises(CompileError):
            run("LOOP 3\n PRINT 1\nEND\n")

    def test_conditional_loop_runtime_guards_non_bool(self):
        # Direct execution of a hand-built IRX document bypasses the
        # checker; the interpreter still refuses to guess.
        from src.interpreter import Interpreter
        from src.irohcore import IrohCore
        irx = {"version": "3.0", "program": [
            {"version": "3.0", "opcode": "LOOP", "cond":
             {"op": "LIT", "value": 3, "type": "Int"},
             "body": []}]}
        with self.assertRaises(IrohRuntimeError):
            Interpreter(IrohCore()).execute(irx)

    def test_undefined_at_runtime_cannot_happen_via_compile(self):
        # The checker catches it first; the interpreter never sees it.
        with self.assertRaises(CompileError):
            run("PRINT nope")


if __name__ == "__main__":
    unittest.main()
