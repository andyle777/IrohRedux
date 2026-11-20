"""IRX emission + determinism tests (spec sections 26, 30)."""

import json
import unittest

from src.compiler import IrohCompiler
from src.irx import from_json, to_json


class TestIRX(unittest.TestCase):
    def test_set_matches_spec_section_26(self):
        irx = IrohCompiler().compile("LET X : Int = 10").irx
        self.assertEqual(irx["program"], [{
            "version": "3.0", "opcode": "SET", "register": "X",
            "type": "Int",
            "value": {"op": "LIT", "value": 10, "type": "Int"},
        }])

    def test_document_version(self):
        irx = IrohCompiler().compile("PRINT 1").irx
        self.assertEqual(irx["version"], "3.0")

    def test_every_instruction_carries_version(self):
        irx = IrohCompiler().compile(
            "FUNCTION F(a)\n RETURN a\nEND FUNCTION\nLET x = F(1)").irx
        for instr in irx["program"]:
            self.assertEqual(instr["version"], "3.0")
            self.assertIn("opcode", instr)

    def test_determinism_same_source_twice(self):
        source = ("FUNCTION Add(a, b)\n RETURN a + b\nEND FUNCTION\n"
                  "LET result = Add(10, 20)\nPRINT result")
        first = to_json(IrohCompiler().compile(source).irx)
        second = to_json(IrohCompiler().compile(source).irx)
        self.assertEqual(first, second)

    def test_determinism_across_instances(self):
        source = 'IF TRUE\n PRINT "x"\nEND IF'
        a = to_json(IrohCompiler().compile(source).irx)
        b = to_json(IrohCompiler().compile(source).irx)
        self.assertEqual(a, b)

    def test_json_round_trip(self):
        irx = IrohCompiler().compile("LET X : Int = 10").irx
        self.assertEqual(from_json(to_json(irx)), irx)

    def test_json_is_sorted_keys(self):
        irx = IrohCompiler().compile("LET X : Int = 10").irx
        text = to_json(irx)
        parsed = json.loads(text)
        self.assertEqual(list(parsed.keys()), sorted(parsed.keys()))


if __name__ == "__main__":
    unittest.main()
