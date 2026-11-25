# Security workflow verification

No APIsec account, secrets, paid scanner, or SARIF upload is required.

The Security workflow has independent dependency-audit and execution-regressions jobs. It audits all locked npm dependencies (including development dependencies), with a high/critical failure threshold. An unavailable advisory service is a failed audit. The audit installation disables lifecycle scripts. Workflow actions are pinned to the full commits observed in the successful earlier Security run, and checkout does not persist credentials.

The execution-regressions job runs the native runner configuration regression (not a runtime containment test) on Node 24.  Full project CI remains separate and unchanged.

Pushes and pull requests run the checks; manual and weekly scheduled runs are also configured. GitHub scheduled workflows execute on the default branch, not independently on maintenance branches.

These checks are not an external API penetration test, general static analysis, secret scanner, or OS sandbox certification. Execute only trusted code; independent containment, encrypted transport, release provenance and repository protection remain separate requirements.
