"""IrohRedux for Python.

Run JavaScript through Iroh — dynamic code analysis: record the code flow
in realtime, intercept runtime information, manipulate program behaviour
on the fly — from Python, without writing JavaScript yourself.

This package is a thin client over the IrohRedux CLI (``cli/iroh.js``):
it feeds JavaScript to the CLI on stdin, reads the JSON lines the CLI
streams back, and returns them as plain Python data.

    from iroh import run

    events, result = run(
        "function factorial(n) {"
        "  if (n === 0) return 1;"
        "  return n * factorial(n - 1);"
        "}; factorial(3);",
        events=["CALL", "IF"],
    )
    calls = [e for e in events if e["event"] == "FUNCTION_CALL"]
    print(calls[0]["arguments"])  # [3]
    print(result)                 # 6

The CLI is located automatically (next to this package in the IrohRedux
checkout). Override it with the ``IROH_CLI`` environment variable, and
the Node binary with ``IROH_NODE``.
"""

import json
import os
import subprocess
from pathlib import Path

__all__ = ["run", "trace_file", "trace_python", "trace_python_file",
           "scan", "scan_python", "scan_python_file", "TraceError", "find_cli"]
__version__ = "1.1.1"


class TraceError(Exception):
    """Raised when the traced program fails (parse error or runtime error).

    Attributes:
        message: the error message from the JavaScript side.
        name: the JavaScript error name (e.g. "SyntaxError", "Error").
        events: the trace events that fired before the failure.
    """

    def __init__(self, message, name=None, events=None):
        super().__init__(message)
        self.message = message
        self.name = name
        self.events = events or []


def find_cli():
    """Locate the IrohRedux CLI (``cli/iroh.js``).

    Order: ``IROH_CLI`` env var, then the checkout layout (this package
    lives in ``<repo>/python/iroh/``, the CLI in ``<repo>/cli/``).
    """
    env = os.environ.get("IROH_CLI")
    if env:
        return env
    here = Path(__file__).resolve()
    candidate = here.parent.parent.parent / "cli" / "iroh.js"
    if candidate.is_file():
        return str(candidate)
    raise TraceError(
        "Could not find the IrohRedux CLI (cli/iroh.js). "
        "Set IROH_CLI to its path, or run from an IrohRedux checkout."
    )


def _node():
    return os.environ.get("IROH_NODE", "node")


def _run_cli(args, code, want_scan=False):
    """Run the CLI, feeding it ``code`` on stdin.

    Returns ``(events, result)``, or ``(events, result, scan)`` when
    ``want_scan`` is true (the CLI was run with ``--scan``; ``scan`` is
    the scan document dict, or None when the CLI emitted none).
    """
    cli = find_cli()
    cmd = [_node(), cli, *args]
    try:
        proc = subprocess.run(
            cmd,
            input=code,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError as exc:
        raise TraceError(
            f"Could not run Node ({_node()!r}): {exc}. "
            "Install Node.js, or set IROH_NODE to its path."
        ) from exc
    events = []
    result = None
    scan = None
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if item.get("type") == "event":
            events.append(item)
        elif item.get("type") == "result":
            result = item.get("value")
        elif item.get("type") == "scan":
            scan = {k: v for k, v in item.items() if k != "type"}
        elif item.get("type") == "error":
            raise TraceError(item.get("message", "Unknown error"),
                            name=item.get("name"), events=events)
    if proc.returncode != 0:
        raise TraceError(
            f"iroh CLI exited with code {proc.returncode}: "
            f"{proc.stderr.strip() or 'no details'}",
            events=events,
        )
    if want_scan:
        return events, result, scan
    return events, result


def run(code, events=None):
    """Trace JavaScript ``code`` and return ``(events, result)``.

    ``events`` is a list of event dicts (each with ``event``, ``category``,
    ``trigger``, ``hash``, ``indent`` and the event's own fields, e.g.
    ``name``, ``arguments``, ``return``). Pass ``events`` as a list of
    category names (``["CALL", "IF"]``) to filter; the default is all
    categories. ``result`` is the program's completion value (``None``
    when the program has none).

    Raises :class:`TraceError` if the program fails to parse or throws.
    """
    args = []
    if events is not None:
        args += ["--events", ",".join(events)]
    return _run_cli(args, code)


def trace_file(path, events=None):
    """Trace the JavaScript file at ``path``; same return as :func:`run`."""
    code = Path(path).read_text(encoding="utf-8")
    return run(code, events=events)


def trace_python(code, events=None):
    """Trace Python ``code`` with the native Python tracer (0.9.0) and
    return ``(events, result)`` — the same event shape as :func:`run`,
    from ``python/iroh/trace.py`` (``sys.settrace`` + AST
    instrumentation). ``result`` is always None: a Python program has
    no completion value. Raises :class:`TraceError` if the program
    fails; the events that fired before the failure ride on the
    exception, as with :func:`run`.
    """
    args = ["--lang", "python"]
    if events is not None:
        args += ["--events", ",".join(events)]
    return _run_cli(args, code)


def trace_python_file(path, events=None):
    """Trace the Python file at ``path``; same return as
    :func:`trace_python`. The file is passed to the tracer directly
    (no temp copy), so tracebacks and ``__file__`` point at it.
    """
    args = ["--lang", "python", "--file", str(path)]
    if events is not None:
        args += ["--events", ",".join(events)]
    return _run_cli(args, "")


def scan(code, events=None):
    """Scan JavaScript ``code`` — trace, analyze, refract to a vector
    in one pass — and return the scan document (``vectors``,
    ``findings``, ``scores``, ``summary``). No event flood: the raw
    events are not returned unless you trace it yourself.
    """
    args = ["--scan"]
    if events is not None:
        args += ["--events", ",".join(events)]
    _, _, doc = _run_cli(args, code, want_scan=True)
    return doc


def scan_python(code, events=None):
    """Scan Python ``code`` with the native Python tracer; same return
    as :func:`scan`, with ``summary["language"] == "python"`.
    """
    args = ["--lang", "python", "--scan"]
    if events is not None:
        args += ["--events", ",".join(events)]
    _, _, doc = _run_cli(args, code, want_scan=True)
    return doc


def scan_python_file(path, events=None):
    """Scan the Python file at ``path``; same return as
    :func:`scan_python`.
    """
    args = ["--lang", "python", "--scan", "--file", str(path)]
    if events is not None:
        args += ["--events", ",".join(events)]
    _, _, doc = _run_cli(args, "", want_scan=True)
    return doc
