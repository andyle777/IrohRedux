"""CLI entry for the IrohScript tracer: ``python3 -m src.trace prog.iroh``.

Thin wrapper over src.tracer; see that module for the event shape
and the documented blind spots.
"""

import os
import sys

# Allow running as a script (python3 irohscript/src/trace.py) as well
# as a module (python3 -m src.trace from the irohscript directory).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.tracer import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
