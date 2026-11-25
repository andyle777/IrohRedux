# Maintenance security notice

Source maintenance candidate; existing release tags and binaries are not changed.

Native tracer/compiler subprocesses now have a 120-second per-process timeout and a 64 MiB captured-output limit. These are resource safeguards, not a sandbox. JavaScript execution and native child descendants are not isolated. Run only trusted code under a restricted account or external sandbox. The distributed server/node feature is absent from this generation; do not backport it as a security fix.

The CI regression checks configuration of the four subprocess calls; independent runtime and platform verification is still required. Published binaries must be rebuilt from an identified source commit and independently checked before release.
