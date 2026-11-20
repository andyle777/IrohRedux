"""Tests for the native Python tracer (0.9.0) and the Python client
additions that use it. Stdlib unittest only.

Run from the repo root:  python3 -m unittest discover -s python/tests -v
The tracer is stdlib-only (sys.settrace + AST instrumentation); the
client functions go through the Node CLI (--lang python).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from iroh import trace_python, trace_python_file, scan_python  # noqa: E402
from iroh.trace import trace_code, trace_file  # noqa: E402


def _events_of(code, **kwargs):
    events, error = trace_code(code, **kwargs)
    assert error is None, error
    return events


class TestTracer(unittest.TestCase):
    def test_factorial_calls_returns_and_depth(self):
        events = _events_of(
            "def factorial(n):\n"
            "    if n == 0:\n"
            "        return 1\n"
            "    return n * factorial(n - 1)\n"
            "\n"
            "factorial(3)\n"
        )
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["arguments"] for c in calls], [[3], [2], [1], [0]])
        self.assertEqual([c["indent"] for c in calls], [0, 1, 2, 3])
        self.assertEqual([c["name"] for c in calls], ["factorial"] * 4)
        returns = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual([r["return"] for r in returns], [1, 1, 2, 6])
        # The if test fired 4 times: once true (n == 0), three times false.
        tests = [e for e in events if e["event"] == "IF_TEST"]
        self.assertEqual(len(tests), 4)
        self.assertEqual([t["value"] for t in tests], [False, False, False, True])

    def test_hot_loop_events(self):
        events = _events_of(
            "total = 0\n"
            "for i in range(150):\n"
            "    total += i\n"
        )
        loop_tests = [e for e in events if e["event"] == "LOOP_TEST"]
        self.assertEqual(len(loop_tests), 151)  # 150 true + 1 final false
        self.assertEqual(sum(1 for e in loop_tests if e["value"] is True), 150)
        self.assertEqual(len([e for e in events if e["event"] == "LOOP_ENTER"]), 1)
        enters = [e for e in events if e["event"] == "LOOP_ENTER"]
        self.assertEqual(enters[0]["kind"], "For")

    def test_while_loop_events(self):
        events = _events_of(
            "i = 0\n"
            "s = 0\n"
            "while i < 5:\n"
            "    s += i\n"
            "    i += 1\n"
        )
        loop_tests = [e for e in events if e["event"] == "LOOP_TEST"]
        self.assertEqual(len(loop_tests), 6)  # 5 true + 1 false
        self.assertEqual(len([e for e in events if e["event"] == "LOOP_ENTER"]), 1)

    def test_zero_iteration_loop(self):
        events = _events_of("for i in range(0):\n    print(i)\n")
        loop_tests = [e for e in events if e["event"] == "LOOP_TEST"]
        self.assertEqual(len(loop_tests), 1)
        self.assertIs(loop_tests[0]["value"], False)
        self.assertEqual([e for e in events if e["event"] == "LOOP_ENTER"], [])

    def test_caught_exception_emits_catch_enter(self):
        events = _events_of(
            "try:\n"
            "    raise ValueError('boom')\n"
            "except ValueError:\n"
            "    x = 1\n"
        )
        catches = [e for e in events if e["event"] == "CATCH_ENTER"]
        self.assertEqual(len(catches), 1)

    def test_uncaught_exception_returns_error(self):
        events, error = trace_code("raise RuntimeError('kaboom')\n")
        self.assertIsNotNone(error)
        self.assertEqual(error["name"], "RuntimeError")
        self.assertEqual(error["message"], "kaboom")
        self.assertEqual(events, [])

    def test_program_stdout_goes_to_stderr_not_the_event_stream(self):
        proc = subprocess.run(
            [sys.executable, "-m", "iroh.trace", "-c", "print('hello')"],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent.parent),
            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parent.parent)},
        )
        self.assertEqual(proc.returncode, 0)
        lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
        self.assertTrue(all(l["type"] in ("event", "result") for l in lines))
        self.assertEqual(lines[-1], {"type": "result", "value": None})
        self.assertIn("hello", proc.stderr)

    def test_trace_file(self):
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write("def add(a, b):\n    return a + b\n\nadd(1, 2)\n")
            name = f.name
        try:
            events, error = trace_file(name)
            self.assertIsNone(error)
            calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
            self.assertEqual([c["arguments"] for c in calls], [[1, 2]])
        finally:
            os.unlink(name)

    def test_events_filter(self):
        events = _events_of(
            "def f():\n    return 1\n\nf()\n", events=["CALL"]
        )
        self.assertTrue(all(e["category"] == "CALL" for e in events))
        self.assertTrue(any(e["event"] == "FUNCTION_CALL" for e in events))
        self.assertFalse(any(e["event"] == "FUNCTION_ENTER" for e in events))

    def test_generator_traced_as_one_call(self):
        # A generator yielding 3 values is ONE call, not four: the
        # "return" event settrace fires per yield must not emit a
        # CALL_END/LEAVE pair, and each resume must not re-emit CALL.
        events = _events_of(
            "def gen(n):\n"
            "    for i in range(n):\n"
            "        yield i * 2\n"
            "total = 0\n"
            "for v in gen(3):\n"
            "    total += v\n"
        )
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["name"] for c in calls], ["gen"])
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual(len(ends), 1)
        # While the generator is suspended it is not on the stack: a
        # call made between two yields has indent 0, not 1.
        events = _events_of(
            "def gen():\n"
            "    yield 1\n"
            "def h():\n"
            "    return 5\n"
            "g = gen()\n"
            "next(g)\n"
            "h()\n"
        )
        h_call = [e for e in events
                  if e["event"] == "FUNCTION_CALL" and e["name"] == "h"][0]
        self.assertEqual(h_call["indent"], 0)

    def test_generator_that_raises_closes(self):
        events = _events_of(
            "def gen():\n"
            "    yield 1\n"
            "    raise ValueError('x')\n"
            "try:\n"
            "    for v in gen():\n"
            "        pass\n"
            "except ValueError:\n"
            "    pass\n"
        )
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        ends = [e for e in events if e["event"] == "FUNCTION_CALL_END"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(ends), 1)

    def test_kwonly_args_do_not_crash_and_are_reported(self):
        # co_varnames is positional, kwonly, *args, **kwargs — the old
        # code read *args at index nargs, which is a kwonly arg, and
        # raised TypeError: 'int' object is not iterable.
        events = _events_of(
            "def f(a, b=2, *args, c, **kw):\n"
            "    return a\n"
            "f(1, 3, 4, c=5, d=6)\n"
        )
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["arguments"] for c in calls],
                         [[1, 3, 4, {"c": 5, "d": 6}]])

    def test_return_indent_matches_call_indent(self):
        # The return event belongs to the frame's own depth — the
        # call's indent, not the depth while the frame was running.
        events = _events_of(
            "def f(a):\n"
            "    return a\n"
            "def g():\n"
            "    return f(1)\n"
            "g()\n"
        )
        calls = {e["name"]: e["indent"] for e in events
                 if e["event"] == "FUNCTION_CALL"}
        ends = {e["name"]: e["indent"] for e in events
                if e["event"] == "FUNCTION_CALL_END"}
        self.assertEqual(calls, ends)
        self.assertEqual(calls, {"g": 0, "f": 1})

    def test_sibling_import_resolves(self):
        # CPython puts the script's directory at sys.path[0]; the
        # tracer execs in-process, so it must do the same, or a program
        # importing a sibling module fails under the tracer only.
        import sys as _sys
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "helper.py"), "w") as f:
                f.write("def answer():\n    return 42\n")
            main = os.path.join(d, "main.py")
            with open(main, "w") as f:
                f.write("from helper import answer\nprint(answer())\n")
            before = list(_sys.path)
            events, error = trace_file(main)
            self.assertIsNone(error)
            self.assertEqual(list(_sys.path), before)  # restored
            # helper.py is another file, so its functions run untraced
            # and the trace is empty — the point is that the import
            # works at all instead of ModuleNotFoundError.
            self.assertEqual(events, [])

    def test_hashes_are_deterministic(self):
        code = "for i in range(3):\n    pass\n"
        first = _events_of(code)
        second = _events_of(code)
        self.assertEqual(first, second)


class TestClient(unittest.TestCase):
    def test_trace_python_via_cli(self):
        events, result = trace_python(
            "def factorial(n):\n"
            "    if n == 0:\n"
            "        return 1\n"
            "    return n * factorial(n - 1)\n"
            "\n"
            "factorial(3)\n"
        )
        self.assertIsNone(result)  # Python programs have no completion value
        calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
        self.assertEqual([c["arguments"] for c in calls], [[3], [2], [1], [0]])

    def test_trace_python_file_via_cli(self):
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write("total = 0\nfor i in range(150):\n    total += i\n")
            name = f.name
        try:
            events, result = trace_python_file(name)
            self.assertIsNone(result)
            loop_tests = [e for e in events if e["event"] == "LOOP_TEST"]
            self.assertEqual(len(loop_tests), 151)
        finally:
            os.unlink(name)

    def test_scan_python_via_cli(self):
        doc = scan_python(
            "total = 0\nfor i in range(150):\n    total += i\n"
        )
        self.assertEqual(doc["summary"]["language"], "python")
        codes = [f["code"] for f in doc["findings"]]
        self.assertIn("HOT_LOOP", codes)
        hot = [f for f in doc["findings"] if f["code"] == "HOT_LOOP"][0]
        self.assertEqual(hot["evidence"]["iterations"], 150)
        self.assertEqual(set(doc["vectors"]["names"]),
                         {"calls", "depth", "repeat", "imbalance", "mix", "coverage"})


if __name__ == "__main__":
    unittest.main()
