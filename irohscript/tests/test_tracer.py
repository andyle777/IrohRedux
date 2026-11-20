"""Tests for the IrohScript tracer (src/tracer.py).

Run from the irohscript directory:
    python3 -m unittest discover -s tests -v
The tracer is stdlib-only; it subclasses the IRX interpreter and
emits the CLI's JSONL event shape (see src/tracer.py for the shape
and the documented blind spots).
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.tracer import trace_source, trace_file  # noqa: E402


def _events_of(source, **kwargs):
    events, error = trace_source(source, **kwargs)
    assert error is None, error
    return events


ADD_PROGRAM = (
    "FUNCTION Add(a, b)\n"
    " RETURN a + b\n"
    "END FUNCTION\n"
    "LET result = Add(10, 20)\n"
    "PRINT result\n"
)

FACT_PROGRAM = (
    "FUNCTION Fact(n)\n"
    " IF n <= 1\n"
    "  RETURN 1\n"
    " END IF\n"
    " RETURN n * Fact(n - 1)\n"
    "END FUNCTION\n"
    "LET f5 = Fact(5)\n"
    "PRINT f5\n"
)


class TestTracerCalls(unittest.TestCase):
    def test_add_calls_returns_and_assign(self):
        events = _events_of(ADD_PROGRAM, filename="add.iroh")
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["name"], "Add")
        self.assertEqual(calls[0]["arguments"], [10, 20])
        self.assertEqual(calls[0]["indent"], 0)
        self.assertEqual(calls[0]["file"], "add.iroh")
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual([e["return"] for e in ends], [30])
        enters = [e for e in events if e["event"] == "FUNCTION_ENTER"]
        leaves = [e for e in events if e["event"] == "FUNCTION_LEAVE"]
        self.assertEqual(len(enters), 1)
        self.assertEqual(len(leaves), 1)
        # The call, its enter and its leave share one hash.
        self.assertEqual(
            {calls[0]["hash"], enters[0]["hash"], leaves[0]["hash"]},
            {calls[0]["hash"]})
        assigns = [e for e in events if e["event"] == "ASSIGN"]
        self.assertEqual(
            [(a["name"], a["value"], a["op"]) for a in assigns],
            [("result", 30, "=")])

    def test_factorial_depth_grows(self):
        events = _events_of(FACT_PROGRAM, filename="fact.iroh")
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["arguments"] for c in calls],
                         [[5], [4], [3], [2], [1]])
        self.assertEqual([c["indent"] for c in calls], [0, 1, 2, 3, 4])
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual([e["return"] for e in ends], [1, 2, 6, 24, 120])

    def test_first_class_function_call_traces(self):
        events = _events_of(
            "FUNCTION Add(a, b)\n"
            " RETURN a + b\n"
            "END FUNCTION\n"
            "LET f = Add\n"
            "LET r = f(3, 4)\n",
            filename="first.iroh")
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([(c["name"], c["arguments"]) for c in calls],
                         [("f", [3, 4])])
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual([e["return"] for e in ends], [7])

    def test_call_that_throws_has_no_call_end(self):
        events, error = trace_source(
            "FUNCTION Boom()\n"
            " RETURN 1 / 0\n"
            "END FUNCTION\n"
            "LET x = Boom()\n",
            filename="boom.iroh")
        self.assertIsNotNone(error)
        self.assertEqual(error["name"], "IrohRuntimeError")
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(ends, [])

    def test_hashes_are_stable_across_runs(self):
        first = _events_of(ADD_PROGRAM, filename="add.iroh")
        second = _events_of(ADD_PROGRAM, filename="add.iroh")
        self.assertEqual([e["hash"] for e in first],
                         [e["hash"] for e in second])

    def test_events_filter_keeps_only_call(self):
        events = _events_of(ADD_PROGRAM, filename="add.iroh",
                            events={"CALL"})
        self.assertTrue(all(e["category"] == "CALL" for e in events))
        self.assertTrue(any(e["event"] == "FUNCTION_CALL" for e in events))
        self.assertFalse(any(e["event"] == "FUNCTION_ENTER" for e in events))


class TestTracerBranches(unittest.TestCase):
    def test_if_test_values(self):
        events = _events_of(
            "LET THREAT = TRUE\n"
            "IF THREAT\n"
            " PRINT \"Defend.\"\n"
            "END IF\n",
            filename="def.iroh")
        tests = [e for e in events if e["event"] == "IF_TEST"]
        self.assertEqual([t["value"] for t in tests], [True])
        self.assertEqual(tests[0]["kind"], "If")

    def test_one_sided_branch_seen_twice(self):
        # Two executions of the same IF, both true: the shape the
        # analyzer reads as ONE_SIDED_BRANCH (min 2 tests).
        events = _events_of(
            "FUNCTION Check(x)\n"
            " IF x > 10\n"
            "  RETURN \"big\"\n"
            " END IF\n"
            " RETURN \"small\"\n"
            "END FUNCTION\n"
            "LET a = Check(11)\n"
            "LET b = Check(12)\n",
            filename="one.iroh")
        tests = [e for e in events if e["event"] == "IF_TEST"]
        self.assertEqual([t["value"] for t in tests], [True, True])
        self.assertEqual(len({t["hash"] for t in tests}), 1)

    def test_legacy_conditional_emits_if_test(self):
        # `enemy` must be defined for the condition to evaluate; an
        # undefined name errors before any IF_TEST (there is no value
        # to report).
        events = _events_of("LET enemy = TRUE\nenemy -> defend\n",
                            filename="leg.iroh")
        tests = [e for e in events if e["event"] == "IF_TEST"]
        self.assertEqual([t["value"] for t in tests], [True])


class TestTracerErrors(unittest.TestCase):
    def test_loop_is_an_error_naming_the_open_question(self):
        _, error = trace_source(
            "LOOP\n PRINT \"round\"\nEND LOOP\n", filename="loop.iroh")
        self.assertIsNotNone(error)
        self.assertIn("open design question", error["message"])
        # No LOOP_TEST was faked before the error.
        events, _ = trace_source(
            "LOOP\n PRINT \"round\"\nEND LOOP\n", filename="loop.iroh")
        self.assertFalse(any(e["event"] == "LOOP_TEST" for e in events))

    def test_compile_error_is_reported(self):
        _, error = trace_source("LET X : Int = \"hello\"\n",
                                filename="bad.iroh")
        self.assertIsNotNone(error)
        self.assertEqual(error["name"], "TypeCheckError")

    def test_const_assign_emits_const_op(self):
        events = _events_of("CONST X = 5\n", filename="c.iroh")
        assigns = [e for e in events if e["event"] == "ASSIGN"]
        self.assertEqual([(a["name"], a["value"], a["op"]) for a in assigns],
                         [("X", 5, "const")])


class TestTracerCli(unittest.TestCase):
    def test_trace_py_cli_streams_jsonl(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            prog = os.path.join(tmp, "add.iroh")
            with open(prog, "w", encoding="utf-8") as handle:
                handle.write(ADD_PROGRAM)
            proc = subprocess.run(
                [sys.executable, str(root / "src" / "trace.py"), prog],
                capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            lines = [json.loads(l) for l in proc.stdout.splitlines() if l]
            self.assertTrue(any(
                l.get("event") == "FUNCTION_CALL" for l in lines))
            self.assertEqual(lines[-1], {"type": "result", "value": None})
            self.assertIn("30", proc.stderr)

    def test_trace_py_cli_loop_is_exit_1(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            prog = os.path.join(tmp, "loop.iroh")
            with open(prog, "w", encoding="utf-8") as handle:
                handle.write("LOOP\n PRINT \"x\"\nEND LOOP\n")
            proc = subprocess.run(
                [sys.executable, str(root / "src" / "trace.py"), prog],
                capture_output=True, text=True)
            self.assertEqual(proc.returncode, 1)
            lines = [json.loads(l) for l in proc.stdout.splitlines() if l]
            err = [l for l in lines if l.get("type") == "error"]
            self.assertEqual(len(err), 1)
            self.assertIn("open design question", err[0]["message"])


if __name__ == "__main__":
    unittest.main()
