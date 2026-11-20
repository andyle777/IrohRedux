"""IR lowering tests (spec section 25)."""

import unittest

from src.compiler import IrohCompiler


def compile_ir(source):
    return IrohCompiler().compile(source).ir


class TestIRLowering(unittest.TestCase):
    def test_let_matches_spec_section_25(self):
        ir = compile_ir("LET X : Int = 10")
        self.assertEqual(ir, [{"op": "SET", "target": "X", "type": "Int",
                               "value": {"op": "LIT", "value": 10,
                                         "type": "Int"}}])

    def test_const_op(self):
        ir = compile_ir('CONST R = "AETHER-001"')
        self.assertEqual(ir[0]["op"], "CONST")

    def test_let_default_instance(self):
        ir = compile_ir("STRUCT S\n T : Float\nEND STRUCT\nLET s : S")
        self.assertEqual(ir[-1], {"op": "DEFAULT", "target": "s",
                                  "type": "S"})

    def test_if_shape(self):
        # A non-constant condition: IF TRUE would be folded away by the
        # optimizer (dead-code elimination), so use a variable condition.
        ir = compile_ir('LET x : Bool = TRUE\nIF x\n PRINT "x"\nEND IF')
        self.assertEqual(ir[-1]["op"], "IF")
        self.assertEqual(ir[-1]["then"][0]["op"], "PRINT")
        self.assertEqual(ir[-1]["else"], [])

    def test_conditional_lowers_to_if_action(self):
        ir = compile_ir("LET e : Bool = TRUE\ne -> defend")
        cond = ir[-1]
        self.assertEqual(cond["op"], "IF")
        self.assertEqual(cond["then"][0]["op"], "ACTION")
        self.assertEqual(cond["then"][0]["value"]["value"], "defend")

    def test_function_def(self):
        ir = compile_ir("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION")
        fn = ir[0]
        self.assertEqual(fn["op"], "FUNCDEF")
        self.assertEqual(fn["params"],
                         [{"name": "a", "type": None},
                          {"name": "b", "type": None}])
        self.assertEqual(fn["body"][0]["op"], "RETURN")

    def test_call_expr(self):
        ir = compile_ir("FUNCTION F(a)\n RETURN a\nEND FUNCTION\n"
                        "LET x = F(3)")
        call = ir[-1]["value"]
        self.assertEqual(call, {"op": "CALL", "name": "F",
                                "args": [{"op": "LIT", "value": 3,
                                          "type": "Int"}]})

    def test_member_assign_is_setfield(self):
        ir = compile_ir("STRUCT S\n T : Float\nEND STRUCT\n"
                        "LET s : S\ns.T = 0.5")
        self.assertEqual(ir[-1]["op"], "SETFIELD")
        self.assertEqual(ir[-1]["field"], "T")

    def test_struct_enum_defs(self):
        ir = compile_ir("STRUCT S\n T : Float\nEND STRUCT\n"
                        "ENUM E\n A\nEND ENUM")
        self.assertEqual(ir[0]["op"], "STRUCTDEF")
        self.assertEqual(ir[1]["op"], "ENUMDEF")
        self.assertEqual(ir[1]["members"], ["A"])

    def test_import_and_intent(self):
        ir = compile_ir('IMPORT Memory\nINTENT "x"')
        self.assertEqual(ir[0], {"op": "IMPORT", "name": "Memory"})
        self.assertEqual(ir[1]["op"], "INTENT")


if __name__ == "__main__":
    unittest.main()
