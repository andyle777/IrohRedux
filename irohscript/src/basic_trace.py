"""BASIC tracer — run a BASIC program through the interpreter and
stream IrohRedux trace events as JSON lines, in the same shape the
JavaScript CLI emits and the native Python tracer emits
(python/iroh/trace.py), so Iroh.analyze() works unchanged:

    {"type":"event","event":"LOOP_TEST","category":"LOOP",
     "trigger":"test","hash":123456,"indent":0,"value":true,
     "kind":"For","file":"hot.bas"}
    ...
    {"type":"result","value":null}

How it works: TracingBasicInterpreter subclasses the BASIC
interpreter and overrides its hook points — FOR loop tests and
entries (LOOP_TEST / LOOP_ENTER, one true test per iteration, plus
the final false test), IF conditions (IF_TEST), GOSUB subroutines
(FUNCTION_CALL / FUNCTION_ENTER / FUNCTION_CALL_END / FUNCTION_LEAVE,
named "gosub@<line>", with the call depth as ``indent``), and
assignments (ASSIGN with the post-assignment value). PRINT output is
collected by the interpreter and written to stderr after the run, so
the JSONL stream on stdout stays clean; INPUT reads from the
inherited stdin, like the Python tracer.

Hashes are CRC32 of kind:file:site, where the site is the BASIC
line and the statement index on it ("10.0"). Deterministic across
runs: the same program always gets the same hashes.

What v1 does NOT see (stated plainly, not hidden):
- GOTO is a jump, and the JS engine has no jump event category, so
  GOTOs are invisible in the trace — a program that loops with GOTO
  shows no loop events at all. (FOR/NEXT is the observable loop.)
- DIM has no event; array reads have none either — only array
  element writes emit ASSIGN.
- A GOSUB that raises emits FUNCTION_CALL / FUNCTION_ENTER but no
  CALL_END / LEAVE: the subroutine exited by throwing, not by
  returning. The error line at the end of the stream is the record
  of it.
- INPUT has no event beyond the ASSIGNs of the variables it fills.

Usage:
    python3 -m src.basic_trace [--events CALL,LOOP,IF] prog.bas
    python3 -m src.basic_trace -c "10 PRINT 1 + 2"
"""

import io
import os
import sys

# Allow running as a script (python3 irohscript/src/basic_trace.py)
# as well as a module (python3 -m src.basic_trace).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.basic import BasicError, BasicInterpreter, parse_program  # noqa: E402
from src.traceutil import EventSink, cli_main, error_name, safe_value, site_hash  # noqa: E402

__all__ = ["TracingBasicInterpreter", "trace_source", "trace_file", "main"]

# Categories this tracer can emit.
EMITTED_CATEGORIES = {"CALL", "FUNCTION", "LOOP", "IF", "ASSIGN"}


class TracingBasicInterpreter(BasicInterpreter):
    """The BASIC interpreter, with event hooks for the analyzer."""

    def __init__(self, filename, sink, input_stream=None):
        super().__init__(input_stream=input_stream)
        self.filename = filename
        self.basename = filename.rsplit("/", 1)[-1]
        self.sink = sink
        self._depth = 0
        # Parallel to the base interpreter's GOSUB return stack: the
        # (hash, name) of each open subroutine call, so RETURN closes
        # the right call even when subroutines nest. A GOSUB that
        # raises never reaches its RETURN hook, so its CALL stays
        # unclosed — documented, like the Python tracer's unclosed
        # generator calls.
        self._gosub_calls = []

    def _hash(self, kind, site):
        return site_hash(kind, self.filename, site)

    def _hook_assign(self, name, value, op, obj, site):
        self.sink.emit("ASSIGN", "ASSIGN", "assign", self._hash("assign", site),
                       self._depth, name=name, value=safe_value(value),
                       result=safe_value(value), op=op, object=obj,
                       kind="Assign", file=self.basename)

    def _hook_if(self, site, value):
        self.sink.emit("IF_TEST", "IF", "test", self._hash("if", site),
                       self._depth, value=bool(value), kind="If",
                       file=self.basename)

    def _hook_loop_test(self, site, value):
        self.sink.emit("LOOP_TEST", "LOOP", "test", self._hash("loop", site),
                       self._depth, value=bool(value), kind="For",
                       file=self.basename)

    def _hook_loop_enter(self, site):
        self.sink.emit("LOOP_ENTER", "LOOP", "enter", self._hash("loop", site),
                       self._depth, kind="For", file=self.basename)

    def _hook_gosub(self, site, name):
        hash_ = self._hash("gosub", site)
        self.sink.emit("FUNCTION_CALL", "CALL", "before", hash_,
                       self._depth, name=name, arguments=[],
                       file=self.basename)
        self.sink.emit("FUNCTION_ENTER", "FUNCTION", "enter", hash_,
                       self._depth, name=name, file=self.basename)
        self._depth += 1
        # Remember the call so the matching RETURN can close it even
        # when subroutines nest.
        self._gosub_calls.append((hash_, name))

    def _hook_gosub_return(self, site, name):
        hash_, call_name = self._gosub_calls.pop()
        self._depth -= 1
        self.sink.emit("FUNCTION_CALL_END", "CALL", "after", hash_,
                       self._depth, name=call_name,
                       **{"return": None}, file=self.basename)
        self.sink.emit("FUNCTION_LEAVE", "FUNCTION", "leave", hash_,
                       self._depth, name=call_name, file=self.basename)


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

def trace_source(source, filename="<basic>", events=None, input_stream=None):
    """Trace BASIC ``source``; returns (events, error).

    ``events`` is a list of event dicts in the CLI's JSONL shape.
    ``error`` is None on success, else {"name": ..., "message": ...}.
    The program runs in-process; its PRINT output goes to stderr
    while it runs so the caller's stdout stays a clean event channel.
    ``input_stream`` supplies INPUT lines (default: sys.stdin).
    """
    sink = EventSink(events)
    try:
        program = parse_program(source)
    except BasicError as exc:
        return [], {"name": "BasicError", "message": str(exc)}
    interp = TracingBasicInterpreter(filename, sink,
                                     input_stream=input_stream)
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        outcome = interp.run(program)
    except BaseException as exc:  # noqa: BLE001 — the tracer reports, never crashes
        return sink.events, {"name": error_name(exc), "message": str(exc)}
    finally:
        sys.stdout = old_stdout
    for line in outcome["output"]:
        sys.stderr.write(line + "\n")
    sys.stderr.flush()
    return sink.events, None


def trace_file(path, events=None):
    """Trace the BASIC file at ``path``; same return as trace_source."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            source = handle.read()
    except OSError as exc:
        return [], {"name": "Error",
                    "message": "Cannot read %s: %s" % (path, exc)}
    return trace_source(source, filename=path, events=events)


def main(argv=None):
    """CLI entry point: ``python3 -m src.basic_trace [--events ...] prog.bas``."""
    return cli_main(argv, trace_source, trace_file,
                    "src.basic_trace",
                    "Trace a BASIC program; stream JSONL events on stdout.")


if __name__ == "__main__":
    sys.exit(main())
