"""Tests for the Python Iroh client. Stdlib unittest only.

Run from the repo root:  python3 -m unittest discover -s python/tests -v
The tests locate the CLI via the checkout layout (no install needed).
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from iroh import run, trace_file, TraceError  # noqa: E402


class TestRun(unittest.TestCase):
    def test_factorial_calls_and_result(self):
        events, result = run(
            "function factorial(n) {"
            "  if (n === 0) return 1;"
            "  return n * factorial(n - 1);"
            "}; factorial(3);",
            events=["CALL", "IF"],
        )
        self.assertEqual(result, 6)
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["arguments"] for c in calls], [[3], [2], [1], [0]])
        returns = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual([r["return"] for r in returns], [1, 1, 2, 6])

    def test_arrow_map_result(self):
        events, result = run("let x = [1,2,3].map(v => v * 2); x;", events=["VAR"])
        self.assertEqual(result, [2, 4, 6])
        init = [e for e in events if e["event"] == "VAR_INIT"]
        self.assertEqual(init[0]["value"], [2, 4, 6])

    def test_async_program_is_awaited(self):
        events, result = run(
            "async function f() { return await Promise.resolve(42); } f();",
            events=["AWAIT"],
        )
        self.assertEqual(result, 42)
        self.assertEqual(len([e for e in events if e["event"] == "AWAIT"]), 1)

    def test_events_default_to_all_categories(self):
        events, result = run("let x = 1; x;")
        categories = {e["category"] for e in events}
        self.assertIn("VAR", categories)
        self.assertEqual(result, 1)

    def test_parse_error_raises_trace_error(self):
        with self.assertRaises(TraceError) as ctx:
            run("let x = ;")
        self.assertEqual(ctx.exception.name, "SyntaxError")

    def test_runtime_error_keeps_events_before_it(self):
        with self.assertRaises(TraceError) as ctx:
            run("let a = 1; throw new Error('boom');")
        self.assertEqual(ctx.exception.message, "boom")
        self.assertTrue(len(ctx.exception.events) > 0)

    def test_trace_file(self):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write("function add(a, b) { return a + b; }; add(1, 2);")
            name = f.name
        try:
            events, result = trace_file(name, events=["CALL"])
            self.assertEqual(result, 3)
        finally:
            os.unlink(name)


if __name__ == "__main__":
    unittest.main()
