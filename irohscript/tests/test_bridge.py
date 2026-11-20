"""Python bridge tests (spec section 47)."""

import unittest

from src.bridge import IrohRuntime
from src.compiler import CompilationResult
from src.irx import to_json


class TestBridge(unittest.TestCase):
    def test_execute_irx_dict(self):
        runtime = IrohRuntime()
        result = runtime.compile("LET X : Int = 10")
        out = runtime.execute(result.irx)
        self.assertEqual(out["variables"]["X"], 10)

    def test_execute_irx_json_string(self):
        runtime = IrohRuntime()
        result = runtime.compile('PRINT "hi"')
        out = runtime.execute(to_json(result.irx))
        self.assertEqual(out["output"], ["hi"])

    def test_run_source_returns_irx_and_warnings(self):
        out = IrohRuntime().run_source("PRINT 1")
        self.assertIn("irx", out)
        self.assertEqual(out["irx"]["version"], "3.0")
        self.assertEqual(out["warnings"], [])

    def test_legacy_warning_present(self):
        out = IrohRuntime().run_source("LET e : Bool = TRUE\ne -> defend")
        self.assertEqual(len(out["warnings"]), 1)
        self.assertIn("Legacy", out["warnings"][0])

    def test_no_state_leak_between_executions(self):
        runtime = IrohRuntime()
        first = runtime.compile("LET X : Int = 1")
        runtime.execute(first.irx)
        second = runtime.compile("LET Y : Int = 2")
        out = runtime.execute(second.irx)
        self.assertNotIn("X", out["variables"])
        self.assertEqual(out["variables"]["Y"], 2)

    def test_intents_persist_on_runtime(self):
        runtime = IrohRuntime()
        runtime.run_source('INTENT "first"')
        out = runtime.run_source('INTENT "second"')
        self.assertEqual([i["text"] for i in out["intents"]],
                         ["first", "second"])

    def test_compile_returns_result(self):
        result = IrohRuntime().compile("LET X : Int = 10")
        self.assertIsInstance(result, CompilationResult)
        self.assertEqual(result.errors, [])


if __name__ == "__main__":
    unittest.main()
