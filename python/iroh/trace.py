"""IrohRedux native Python tracer (0.9.0) — stdlib only.

Runs a Python program and streams trace events as JSON lines on stdout,
in the same shape the JavaScript CLI emits, so Iroh.analyze() works
unchanged across languages:

    {"type":"event","event":"FUNCTION_CALL","category":"CALL",
     "trigger":"before","hash":123456,"indent":0,"name":"factorial",
     "arguments":[3],"file":"prog.py","line":2}
    ...
    {"type":"result","value":null}

Two mechanisms, both stdlib:

- ``sys.settrace`` for call/return: every call of a function defined in
  the target file emits FUNCTION_CALL (trigger "before", with the call
  arguments) and FUNCTION_ENTER (trigger "enter", with the call depth
  as ``indent``); every return emits FUNCTION_CALL_END (trigger "after",
  with the return value) and FUNCTION_LEAVE (trigger "leave"). Frames
  from other files (imports, the standard library) are not traced.
- AST instrumentation of the target file before it runs, so the
  analyzer's loop/branch/catch findings work: ``while`` and ``for``
  tests are wrapped in a hook that emits LOOP_TEST (value true/false)
  and LOOP_ENTER on the first true test; ``if`` tests are wrapped in a
  hook that emits IF_TEST; the first statement of every ``except``
  handler is a hook that emits CATCH_ENTER. Hashes are CRC32 of
  kind:file:line, so the same program always gets the same hashes.

What v1 does NOT see (stated plainly, not hidden): per-assignment
events — assignments are not instrumented, so no ASSIGN events fire
(the JS engine's private-field and destructuring blind spots have a
Python cousin: every assignment is a blind spot here). Comprehensions,
``async for`` and lambdas' bodies are not loop/branch instrumented.
Only the target file is traced; functions imported from other modules
run untraced. The trace is single-threaded: ``threading.settrace`` is
not installed.

The traced program's own stdout is redirected to stderr while it runs,
so the JSONL stream on stdout stays clean — the program's prints are
still visible, just on the other stream. On an uncaught exception the
tracer prints a final {"type":"error",...} line and exits 1; the
events that fired before it are already on stdout.

Usage:
    python3 -m iroh.trace [--events CALL,LOOP] prog.py
    python3 -m iroh.trace -c "print(1 + 2)"
    python3 -m iroh.trace --events ALL prog.py
"""

import ast
import dis
import json
import os
import sys
import zlib

__all__ = ["trace_code", "trace_file", "main"]

# Event categories the JS engine knows (src/labels.js). Python emits a
# subset; --events is validated against the full list, like the CLI.
KNOWN_CATEGORIES = {
    "THIS", "UNARY", "UPDATE", "BINARY", "LOGICAL", "TERNARY", "ASSIGN",
    "ALLOC", "MEMBER", "LITERAL", "IDENTIFIER", "TRY", "CATCH", "FINALLY",
    "OP_NEW", "VAR", "IF", "ELSE", "SWITCH", "CASE", "BREAK", "CONTINUE",
    "LOOP", "CALL", "FUNCTION", "BLOCK", "PROGRAM", "METHOD", "SUPER",
    "AWAIT",
}

# Categories this tracer can emit.
EMITTED_CATEGORIES = {"CALL", "FUNCTION", "LOOP", "IF", "CATCH"}

# ---------------------------------------------------------------------------
# Event sink (module state, reset per run)
# ---------------------------------------------------------------------------

_out = sys.stdout  # the real stdout; the program's stdout is redirected
_wanted = None  # None = all categories; otherwise a set of names
_depth = 0
_stack = []
_entered_loops = set()  # loop hashes that have emitted LOOP_ENTER
_target_filename = None
_suspended = set()  # generator/coroutine frames suspended at a yield
_raised = set()  # frames whose most recent event was an exception

# Opcodes at which a generator/coroutine frame suspends instead of
# returning (read from dis so the numbers track the running Python).
_SUSPEND_OPS = frozenset(
    op for op in (dis.opmap.get("YIELD_VALUE"), dis.opmap.get("SEND"),
                  dis.opmap.get("YIELD_FROM"))
    if op is not None
)
# co_flags bits for generator / coroutine / async-generator frames.
_GEN_FLAGS = 0x20 | 0x80 | 0x200  # CO_GENERATOR | CO_COROUTINE | CO_ASYNC_GENERATOR


def _hash(kind, filename, lineno):
    return zlib.crc32(("%s:%s:%d" % (kind, filename, lineno)).encode("utf-8"))


def _safe(value, depth=3, seen=None):
    """JSON-safe projection of a value, like Iroh.safeValue (depth-capped)."""
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return repr(value)
        return value
    if seen is None:
        seen = set()
    if depth <= 0:
        return "[Object]"
    if isinstance(value, (list, tuple)):
        if id(value) in seen:
            return "[Circular]"
        seen.add(id(value))
        return [_safe(v, depth - 1, seen) for v in value]
    if isinstance(value, dict):
        if id(value) in seen:
            return "[Circular]"
        seen.add(id(value))
        out = {}
        for k, v in list(value.items())[:50]:
            out[str(k)] = _safe(v, depth - 1, seen)
        return out
    if isinstance(value, (set, frozenset)):
        return [_safe(v, depth - 1, seen) for v in list(value)[:50]]
    return repr(value)


def _emit(event, category, trigger, hash_, indent=None, **fields):
    if _wanted is not None and category not in _wanted:
        return
    line = {
        "type": "event",
        "event": event,
        "category": category,
        "trigger": trigger,
        "hash": hash_,
        "indent": _depth if indent is None else indent,
    }
    for key, value in fields.items():
        if value is not None:
            line[key] = value
    _out.write(json.dumps(line, separators=(",", ":")) + "\n")
    _out.flush()


# ---------------------------------------------------------------------------
# AST hooks (called from the instrumented program; defined here so their
# frames carry this file's name and settrace ignores them)
# ---------------------------------------------------------------------------

def __iroh_loop_test(hash_, value):
    _emit("LOOP_TEST", "LOOP", "test", hash_, value=bool(value), kind="While")
    if value and hash_ not in _entered_loops:
        _entered_loops.add(hash_)
        _emit("LOOP_ENTER", "LOOP", "enter", hash_, kind="While")
    return value


def __iroh_for_iter(hash_, iterable):
    iterator = iter(iterable)
    while True:
        try:
            item = next(iterator)
        except StopIteration:
            _emit("LOOP_TEST", "LOOP", "test", hash_, value=False, kind="For")
            return
        _emit("LOOP_TEST", "LOOP", "test", hash_, value=True, kind="For")
        if hash_ not in _entered_loops:
            _entered_loops.add(hash_)
            _emit("LOOP_ENTER", "LOOP", "enter", hash_, kind="For")
        yield item


def __iroh_if_test(hash_, value):
    _emit("IF_TEST", "IF", "test", hash_, value=bool(value), kind="If")
    return value


def __iroh_catch(hash_):
    _emit("CATCH_ENTER", "CATCH", "enter", hash_, kind="ExceptHandler")
    return None


class _Instrument(ast.NodeTransformer):
    """Wrap loop tests, if tests and except handlers with the hooks above."""

    def __init__(self, filename):
        self.filename = filename

    def _hash(self, kind, node):
        return _hash(kind, self.filename, node.lineno)

    def visit_While(self, node):
        self.generic_visit(node)
        node.test = ast.Call(
            func=ast.Name(id="__iroh_loop_test", ctx=ast.Load()),
            args=[ast.Constant(value=self._hash("loop", node)), node.test],
            keywords=[],
        )
        return node

    def visit_For(self, node):
        self.generic_visit(node)
        node.iter = ast.Call(
            func=ast.Name(id="__iroh_for_iter", ctx=ast.Load()),
            args=[ast.Constant(value=self._hash("loop", node)), node.iter],
            keywords=[],
        )
        return node

    def visit_If(self, node):
        self.generic_visit(node)
        node.test = ast.Call(
            func=ast.Name(id="__iroh_if_test", ctx=ast.Load()),
            args=[ast.Constant(value=self._hash("if", node)), node.test],
            keywords=[],
        )
        return node

    def visit_ExceptHandler(self, node):
        self.generic_visit(node)
        hook = ast.Expr(
            value=ast.Call(
                func=ast.Name(id="__iroh_catch", ctx=ast.Load()),
                args=[ast.Constant(value=self._hash("catch", node))],
                keywords=[],
            )
        )
        node.body.insert(0, hook)
        return node


# ---------------------------------------------------------------------------
# settrace hook — calls and returns in the target file only
# ---------------------------------------------------------------------------

def _call_arguments(frame):
    code = frame.f_code
    args = []
    nargs = code.co_argcount
    names = code.co_varnames
    for i in range(nargs):
        if i < len(names) and names[i] in frame.f_locals:
            args.append(_safe(frame.f_locals[names[i]]))
    # co_varnames layout is positional, kwonly, *args, **kwargs — the
    # *args slot sits AFTER the kwonly args, not at index nargs.
    idx = nargs + code.co_kwonlyargcount
    kwargs = {}
    for i in range(nargs, nargs + code.co_kwonlyargcount):
        if i < len(names) and names[i] in frame.f_locals:
            kwargs[names[i]] = _safe(frame.f_locals[names[i]])
    if code.co_flags & 0x04:  # CO_VARARGS — *args: extend with its items
        if idx < len(names) and names[idx] in frame.f_locals:
            args.extend(_safe(frame.f_locals[names[idx]]) or [])
        idx += 1
    if code.co_flags & 0x08:  # CO_VARKEYWORDS — **kwargs: merge into the dict
        if idx < len(names) and names[idx] in frame.f_locals:
            kwargs.update(_safe(frame.f_locals[names[idx]]) or {})
    if kwargs:
        args.append(kwargs)
    return args


def _trace(frame, event, arg):
    global _depth
    if frame.f_code.co_filename != _target_filename:
        return None
    if event == "call":
        if frame.f_code.co_name == "<module>":
            return None
        if frame in _suspended:
            # A generator/coroutine resuming after a yield: not a new
            # call — the CALL/ENTER pair was already emitted at its
            # first call. It re-enters the stack at the current depth.
            _suspended.discard(frame)
            _stack.append(frame)
            _depth += 1
            return _trace
        name = frame.f_code.co_name
        hash_ = _hash("func", _target_filename, frame.f_code.co_firstlineno)
        call_line = frame.f_back.f_lineno if frame.f_back is not None else frame.f_lineno
        _emit("FUNCTION_CALL", "CALL", "before", hash_,
              name=name, arguments=_call_arguments(frame),
              file=_target_filename.rsplit("/", 1)[-1], line=call_line)
        _emit("FUNCTION_ENTER", "FUNCTION", "enter", hash_,
              name=name, file=_target_filename.rsplit("/", 1)[-1],
              line=frame.f_code.co_firstlineno)
        _stack.append(frame)
        _depth += 1
        return _trace
    if event == "exception":
        # Remember that this frame raised; a "return" straight after
        # an exception is a real exit (raise / close()), even when the
        # frame was suspended at a yield point. Cleared by the next
        # "line" event, which means the exception was caught and the
        # frame keeps running.
        _raised.add(frame)
        return _trace
    if event == "line":
        _raised.discard(frame)
        return _trace
    if event == "return":
        hash_ = _hash("func", _target_filename, frame.f_code.co_firstlineno)
        name = frame.f_code.co_name
        code = frame.f_code
        # A generator yielding suspends — it does not return, and the
        # frame will resume on the next "call" event with the same
        # frame object. The opcode at f_lasti tells suspension from a
        # real return: the "return" event's arg cannot, because it is
        # the yielded value on a yield and the return value on a
        # return. Emitting a CALL_END/LEAVE per yield would make one
        # generator look like many calls and could spuriously fire
        # REPEATED_SEQUENCE.
        op = (code.co_code[frame.f_lasti]
              if 0 <= frame.f_lasti < len(code.co_code) else None)
        if (code.co_flags & _GEN_FLAGS and frame not in _raised
                and op in _SUSPEND_OPS):
            # Suspended, not returned: the frame leaves the call stack
            # until it resumes (a suspended generator is not on the
            # stack — keeping its depth would inflate every other
            # call's indent, and could spuriously fire DEEP_RECURSION).
            # A generator closed with .close() fires no trace event at
            # all, so its CALL stays unclosed in the stream — that is
            # a sys.settrace limit, not a pairing bug; the depth is
            # already correct because the yield dropped it.
            _suspended.add(frame)
            if _stack and _stack[-1] is frame:
                _stack.pop()
            elif frame in _stack:
                _stack.remove(frame)
            _depth = max(0, _depth - 1)
            return _trace
        _raised.discard(frame)
        # The return belongs to the frame's own depth — the call's
        # indent, one less than the depth while the frame was running
        # (the JS engine's FUNCTION_LEAVE does the same).
        indent = max(0, _depth - 1)
        _emit("FUNCTION_CALL_END", "CALL", "after", hash_, indent,
              name=name, **{"return": _safe(arg)},
              file=_target_filename.rsplit("/", 1)[-1], line=frame.f_lineno)
        _emit("FUNCTION_LEAVE", "FUNCTION", "leave", hash_, indent,
              name=name, file=_target_filename.rsplit("/", 1)[-1],
              line=frame.f_lineno)
        if _stack and _stack[-1] is frame:
            _stack.pop()
        elif frame in _stack:
            _stack.remove(frame)
        _depth = max(0, _depth - 1)
        return _trace
    return _trace


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

def trace_code(code, filename="<iroh>", events=None):
    """Trace Python ``code``; returns (events, error).

    ``events`` is a list of event dicts in the CLI's JSONL shape.
    ``error`` is None on success, else {"name": ..., "message": ...}.
    The program runs in-process; its stdout is redirected to stderr
    while it runs so the caller's stdout stays a clean event channel.
    """
    global _wanted, _depth, _stack, _entered_loops, _target_filename, _out
    global _suspended, _raised
    _wanted = None if events is None else set(events)
    _depth = 0
    _stack = []
    _entered_loops = set()
    _suspended = set()
    _raised = set()
    _target_filename = filename
    collected = []

    real_out = _out
    _out = _ListWriter(collected)
    try:
        tree = ast.parse(code, filename=filename)
        tree = _Instrument(filename).visit(tree)
        ast.fix_missing_locations(tree)
        compiled = compile(tree, filename, "exec")
        globs = {
            "__name__": "__main__",
            "__file__": filename,
            "__builtins__": __builtins__,
            "__iroh_loop_test": __iroh_loop_test,
            "__iroh_for_iter": __iroh_for_iter,
            "__iroh_if_test": __iroh_if_test,
            "__iroh_catch": __iroh_catch,
        }
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        old_trace = sys.gettrace()
        sys.settrace(_trace)
        # CPython puts the script's directory at sys.path[0] when
        # running `python3 prog.py`; the tracer execs in-process, so do
        # the same — otherwise a program importing a sibling module
        # fails under the tracer but works when run directly.
        prog_dir = None
        inserted_path = False
        if filename != "<iroh>":
            prog_dir = os.path.dirname(os.path.abspath(filename))
            if prog_dir not in sys.path:
                sys.path.insert(0, prog_dir)
                inserted_path = True
        try:
            exec(compiled, globs)
        finally:
            sys.settrace(old_trace)
            sys.stdout = old_stdout
            if inserted_path and prog_dir in sys.path:
                sys.path.remove(prog_dir)
    except SystemExit as exc:
        code_ = exc.code
        if code_ in (None, 0):
            return collected, None
        return collected, {"name": "SystemExit", "message": "exit code %s" % (code_,)}
    except BaseException as exc:  # noqa: BLE001 — the tracer reports, never crashes
        return collected, {"name": type(exc).__name__, "message": str(exc)}
    finally:
        _out = real_out
    return collected, None


class _ListWriter:
    """A file-like sink that collects emitted JSON lines as dicts."""

    def __init__(self, collected):
        self.collected = collected

    def write(self, text):
        for line in text.splitlines():
            if line.strip():
                self.collected.append(json.loads(line))

    def flush(self):
        pass


def trace_file(path, events=None):
    """Trace the Python file at ``path``; same return as :func:`trace_code`."""
    with open(path, "r", encoding="utf-8") as handle:
        code = handle.read()
    return trace_code(code, filename=path, events=events)


def _print_error(error):
    sys.stdout.write(json.dumps(
        {"type": "error", "name": error["name"], "message": error["message"]},
        separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main(argv=None):
    """CLI entry point: ``python3 -m iroh.trace [--events ...] prog.py``."""
    import argparse

    parser = argparse.ArgumentParser(
        prog="iroh.trace",
        description="Trace a Python program; stream JSONL events on stdout.")
    parser.add_argument("file", nargs="?", help="Python file to trace")
    parser.add_argument("-c", dest="code", default=None,
                        help="Python code to trace (instead of a file)")
    parser.add_argument("--events", default="ALL",
                        help="comma list of event categories, or ALL")
    parser.add_argument("--no-result", action="store_true",
                        help="skip the final result line")
    args = parser.parse_args(argv)

    if args.events.upper() != "ALL":
        wanted = [s.strip().upper() for s in args.events.split(",") if s.strip()]
        unknown = [name for name in wanted if name not in KNOWN_CATEGORIES]
        if unknown:
            sys.stderr.write("Unknown event category: %s\n" % (unknown[0],))
            return 2
    else:
        wanted = None

    if args.code is not None:
        code, filename = args.code, "<iroh>"
    elif args.file is not None:
        try:
            with open(args.file, "r", encoding="utf-8") as handle:
                code = handle.read()
        except OSError as exc:
            _print_error({"name": "Error",
                          "message": "Cannot read %s: %s" % (args.file, exc)})
            return 1
        filename = args.file
    else:
        parser.print_usage(sys.stderr)
        return 2

    events, error = trace_code(code, filename=filename, events=wanted)
    for event in events:
        sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    if error is not None:
        _print_error(error)
        return 1
    if not args.no_result:
        sys.stdout.write(json.dumps({"type": "result", "value": None},
                                    separators=(",", ":")) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
