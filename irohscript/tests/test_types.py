"""Type checker + semantic analysis tests (spec sections 11-14, 42)."""

import unittest

from src.compiler import IrohCompiler
from src.errors import (NameResolutionError, SemanticError, TypeCheckError)


def check_ok(source):
    IrohCompiler().compile(source)  # raises on any error


def check_err(source, exc):
    with unittest.TestCase().assertRaises(exc):
        IrohCompiler().compile(source)


class TestTypeErrors(unittest.TestCase):
    def test_int_cannot_hold_string(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile('LET X : Int = "hello"')

    def test_float_cannot_hold_int_literal(self):
        # Strict: Int and Float are distinct types in the MVP.
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile("LET X : Float = 10")

    def test_string_plus_int(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile('LET X = "a" + 1')

    def test_if_condition_must_be_bool(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile('IF "yes"\n PRINT 1\nEND IF')

    def test_compare_mismatched_types(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile('LET X = 1 == "a"')

    def test_and_requires_bool(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile("LET X = 1 AND TRUE")

    def test_assignment_type_mismatch(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile('LET X : Int = 1\nX = "a"')

    def test_call_arity(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile(
                "FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION\n"
                "LET x = Add(1)")

    def test_call_typed_param_mismatch(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile(
                "FUNCTION F(s : String)\n RETURN 1\nEND FUNCTION\n"
                "LET x = F(42)")

    def test_struct_field_type_mismatch(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile(
                "STRUCT S\n Trust : Float\nEND STRUCT\n"
                "LET s : S\ns.Trust = \"high\"")

    def test_intent_requires_string(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile("INTENT 42")

    def test_unknown_type(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile("LET X : Nope = 1")

    def test_vector_construction_rejected(self):
        with self.assertRaises(TypeCheckError):
            IrohCompiler().compile("LET V : Vector<Float> = 1")


class TestSemanticErrors(unittest.TestCase):
    def test_const_mutation_rejected(self):
        with self.assertRaises(SemanticError) as ctx:
            IrohCompiler().compile(
                'CONST IDENTITY_ROOT = "AETHER-001"\n'
                'IDENTITY_ROOT = "OTHER"')
        self.assertIn("IDENTITY_ROOT", str(ctx.exception))

    def test_undeclared_name(self):
        with self.assertRaises(NameResolutionError):
            IrohCompiler().compile("PRINT missing")

    def test_undeclared_function_call(self):
        with self.assertRaises(NameResolutionError):
            IrohCompiler().compile("LET x = Nope(1)")

    def test_return_outside_function(self):
        with self.assertRaises(SemanticError):
            IrohCompiler().compile("RETURN 1")

    def test_duplicate_declaration(self):
        with self.assertRaises(NameResolutionError):
            IrohCompiler().compile("LET x = 1\nLET x = 2")

    def test_struct_unknown_field(self):
        with self.assertRaises(NameResolutionError):
            IrohCompiler().compile(
                "STRUCT S\n Trust : Float\nEND STRUCT\n"
                "LET s : S\nPRINT s.Nope")

    def test_enum_unknown_member(self):
        with self.assertRaises(NameResolutionError):
            IrohCompiler().compile(
                "ENUM E\n A\n B\nEND ENUM\nPRINT E.C")

    def test_struct_name_not_a_value(self):
        with self.assertRaises(SemanticError):
            IrohCompiler().compile(
                "STRUCT S\n Trust : Float\nEND STRUCT\nPRINT S")

    def test_namespace_use_rejected(self):
        with self.assertRaises(SemanticError) as ctx:
            IrohCompiler().compile(
                'IMPORT Memory\nLET x = Memory.Query("archive")')
        self.assertIn("Memory", str(ctx.exception))

    def test_namespace_bare_use_rejected(self):
        with self.assertRaises(SemanticError):
            IrohCompiler().compile("IMPORT Memory\nPRINT Memory")

    def test_assignment_to_function(self):
        with self.assertRaises(SemanticError):
            IrohCompiler().compile(
                "FUNCTION F()\n RETURN 1\nEND FUNCTION\nF = 2")


class TestCheckerPasses(unittest.TestCase):
    def test_typed_lets_pass(self):
        check_ok('LET X : Int = 10\nLET Name : String = "Aether"\n'
                 'LET C : Float = 0.92\nLET A : Bool = TRUE')

    def test_untyped_param_concat_passes(self):
        check_ok('FUNCTION Protect(target)\n'
                 ' INTENT "protect " + target\nEND FUNCTION')

    def test_forward_function_call_passes(self):
        check_ok("LET x = Later(1)\n"
                 "FUNCTION Later(n)\n RETURN n\nEND FUNCTION")

    def test_recursion_passes(self):
        check_ok("FUNCTION Fact(n)\n"
                 " IF n <= 1\n RETURN 1\n ELSE\n RETURN n * Fact(n - 1)\n"
                 " END IF\nEND FUNCTION")

    def test_struct_and_enum_pass(self):
        check_ok("STRUCT AgentState\n Trust : Float\nEND STRUCT\n"
                 "ENUM BranchState\n ACTIVE\nEND ENUM\n"
                 "LET s : AgentState\nPRINT BranchState.ACTIVE")

    def test_intent_string_passes(self):
        check_ok('INTENT "protect archive"')

    def test_legacy_conditional_passes(self):
        check_ok("LET enemy : Bool = TRUE\nenemy -> defend")


if __name__ == "__main__":
    unittest.main()
