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

__all__ = ["run", "trace_file", "TraceError", "find_cli"]
__version__ = "0.8.0"


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


def _run_cli(args, code):
    """Run the CLI, feeding it ``code`` on stdin; return (events, result)."""
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
        elif item.get("type") == "error":
            raise TraceError(item.get("message", "Unknown error"),
                            name=item.get("name"), events=events)
    if proc.returncode != 0:
        raise TraceError(
            f"iroh CLI exited with code {proc.returncode}: "
            f"{proc.stderr.strip() or 'no details'}",
            events=events,
        )
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
