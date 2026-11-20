"""Tests for the BASIC tracer (src/basic_trace.py).

Run from the irohscript directory:
    python3 -m unittest discover -s tests -v
The tracer emits the CLI's JSONL event shape (see src/basic_trace.py
for the shape and the documented blind spots).
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.basic_trace import trace_source, trace_file  # noqa: E402


def _events_of(source, **kwargs):
    events, error = trace_source(source, **kwargs)
    assert error is None, error
    return events


HOT_LOOP = ("10 LET S = 0\n20 FOR I = 1 TO 150\n30 S = S + I\n"
            "40 NEXT I\n50 PRINT S\n")


class TestBasicTracerLoops(unittest.TestCase):
    def test_hot_loop_events(self):
        events = _events_of(HOT_LOOP, filename="hot.bas")
        tests = [e for e in events if e["event"] == "LOOP_TEST"]
        enters = [e for e in events if e["event"] == "LOOP_ENTER"]
        # 150 true tests, one final false test, one entry.
        self.assertEqual(len(tests), 151)
        self.assertEqual(sum(1 for t in tests if t["value"] is True), 150)
        self.assertEqual([t["value"] for t in tests[-1:]], [False])
        self.assertEqual(len(enters), 1)
        self.assertEqual(tests[0]["kind"], "For")
        self.assertEqual(enters[0]["hash"], tests[0]["hash"])

    def test_zero_iteration_loop(self):
        events = _events_of(
            "10 FOR I = 5 TO 1\n20 PRINT I\n30 NEXT I\n40 PRINT \"done\"\n",
            filename="zero.bas")
        tests = [e for e in events if e["event"] == "LOOP_TEST"]
        enters = [e for e in events if e["event"] == "LOOP_ENTER"]
        self.assertEqual([t["value"] for t in tests], [False])
        self.assertEqual(enters, [])

    def test_loop_assign_events(self):
        events = _events_of(
            "10 FOR I = 1 TO 2\n20 NEXT I\n", filename="la.bas")
        assigns = [e for e in events if e["event"] == "ASSIGN"]
        self.assertEqual([(a["name"], a["value"]) for a in assigns],
                         [("I", 1), ("I", 2), ("I", 3)])

    # 1.1.1 (M5): WHILE/WEND traces like FOR/NEXT — one true test per
    # iteration, plus the final false test, one entry.
    def test_while_loop_events(self):
        events = _events_of(
            "10 LET I = 1\n20 WHILE I <= 3\n30 I = I + 1\n40 WEND\n50 PRINT \"done\"\n",
            filename="while.bas")
        tests = [e for e in events if e["event"] == "LOOP_TEST"]
        enters = [e for e in events if e["event"] == "LOOP_ENTER"]
        self.assertEqual(len(tests), 4)
        self.assertEqual(sum(1 for t in tests if t["value"] is True), 3)
        self.assertEqual([t["value"] for t in tests[-1:]], [False])
        self.assertEqual(len(enters), 1)
        self.assertEqual(tests[0]["kind"], "While")
        self.assertEqual(enters[0]["hash"], tests[0]["hash"])


class TestBasicTracerCalls(unittest.TestCase):
    def test_gosub_calls_and_returns(self):
        events = _events_of(
            "10 GOSUB 100\n20 PRINT \"back\"\n30 END\n"
            "100 PRINT \"sub\"\n110 RETURN\n",
            filename="sub.bas")
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual([c["name"] for c in calls], ["gosub@100"])
        self.assertEqual([c["indent"] for c in calls], [0])
        self.assertEqual([c["arguments"] for c in calls], [[]])
        self.assertEqual(len(ends), 1)
        # A subroutine has no return value: like the Python tracer, a
        # None return is omitted from the event, not faked as null.
        self.assertNotIn("return", ends[0])

    def test_nested_gosub_depth(self):
        events = _events_of(
            "10 GOSUB 100\n20 END\n"
            "100 GOSUB 200\n110 RETURN\n"
            "200 PRINT \"deep\"\n210 RETURN\n",
            filename="deep.bas")
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["name"] for c in calls],
                         ["gosub@100", "gosub@200"])
        self.assertEqual([c["indent"] for c in calls], [0, 1])

    def test_hashes_are_stable_across_runs(self):
        first = _events_of(HOT_LOOP, filename="hot.bas")
        second = _events_of(HOT_LOOP, filename="hot.bas")
        self.assertEqual([e["hash"] for e in first],
                         [e["hash"] for e in second])

    def test_events_filter(self):
        events = _events_of(HOT_LOOP, filename="hot.bas",
                            events={"LOOP"})
        self.assertTrue(all(e["category"] == "LOOP" for e in events))
        self.assertTrue(any(e["event"] == "LOOP_TEST" for e in events))
        self.assertFalse(any(e["event"] == "ASSIGN" for e in events))


class TestBasicTracerBranches(unittest.TestCase):
    def test_if_test_values(self):
        events = _events_of(
            '10 IF 5 > 3 THEN PRINT "yes" ELSE PRINT "no"\n',
            filename="if.bas")
        tests = [e for e in events if e["event"] == "IF_TEST"]
        self.assertEqual([t["value"] for t in tests], [True])

    def test_one_sided_branch_seen_twice(self):
        # The same IF, twice, both true: the shape the analyzer reads
        # as ONE_SIDED_BRANCH (min 2 tests).
        events = _events_of(
            "10 FOR K = 1 TO 2\n"
            "20 IF 7 > 3 THEN PRINT \"yes\"\n"
            "30 NEXT K\n",
            filename="one.bas")
        tests = [e for e in events if e["event"] == "IF_TEST"]
        self.assertEqual([t["value"] for t in tests], [True, True])
        self.assertEqual(len({t["hash"] for t in tests}), 1)

    def test_goto_loop_is_invisible(self):
        # GOTO has no event category: a GOTO loop shows no loop events.
        # Documented, not hidden.
        events = _events_of(
            "10 LET I = 0\n20 LET I = I + 1\n30 IF I < 3 THEN 20\n"
            "40 PRINT I\n",
            filename="goto.bas")
        self.assertFalse(any(e["event"] == "LOOP_TEST" for e in events))
        self.assertFalse(any(e["event"] == "LOOP_ENTER" for e in events))


class TestBasicTracerErrors(unittest.TestCase):
    def test_goto_undefined_line_is_an_error(self):
        _, error = trace_source("10 GOTO 99\n", filename="bad.bas")
        self.assertIsNotNone(error)
        self.assertEqual(error["name"], "BasicError")
        self.assertIn("undefined line 99", error["message"])

    def test_input_reads_from_the_given_stream(self):
        events, error = trace_source(
            "10 INPUT X\n20 PRINT X * 2\n", filename="in.bas",
            input_stream=io.StringIO("21\n"))
        self.assertIsNone(error)
        assigns = [e for e in events if e["event"] == "ASSIGN"]
        self.assertEqual([(a["name"], a["value"]) for a in assigns],
                         [("X", 21)])


class TestBasicTracerCli(unittest.TestCase):
    def test_basic_trace_cli_streams_jsonl(self):
        root = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            prog = os.path.join(tmp, "hot.bas")
            with open(prog, "w", encoding="utf-8") as handle:
                handle.write(HOT_LOOP)
            proc = subprocess.run(
                [sys.executable, str(root / "src" / "basic_trace.py"), prog],
                capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            lines = [json.loads(l) for l in proc.stdout.splitlines() if l]
            self.assertTrue(any(
                l.get("event") == "LOOP_TEST" for l in lines))
            self.assertEqual(lines[-1], {"type": "result", "value": None})
            self.assertIn("11325", proc.stderr)


if __name__ == "__main__":
    unittest.main()
