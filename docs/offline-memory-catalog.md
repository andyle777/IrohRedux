# Offline memory catalog

`memory/iroh-memory.sqlite3` is a static, read-only reference catalog. It
contains the current memory guide and usage documentation, the generation
registry, JSON Schemas, and the portable trace-hotness personality matrix.
It does not contain user traces, identifiers, or runtime telemetry.

The schema is versioned independently from IrohRedux:

- `metadata(key, value)` identifies the catalog format and engine version.
- `memory_documents(path, media_type, content, sha256)` stores Markdown
  references as UTF-8 text.
- `json_artifacts(path, content, sha256)` stores the JSON contracts and model.

Use the standard SQLite driver for your language, or inspect it with the
`sqlite3` command:

```sql
SELECT content
FROM memory_documents
WHERE path = 'docs/memory.md';

SELECT content
FROM json_artifacts
WHERE path = 'personality-matrix.json';
```

The JSON files remain the portable source for consumers that do not use
SQLite. C++, BASIC, IrohScript, Python, and JavaScript tracing keep their
existing interfaces; this catalog adds no database dependency to those
runtimes. The catalog is local and works offline. It is not synchronized by
the online `serve`/`node` protocol.

The npm package exposes the matrix at `iroh/personality-matrix.json` and the
database as a data-file subpath at
`iroh/memory/iroh-memory.sqlite3`. In Node.js, use
`require.resolve("iroh/memory/iroh-memory.sqlite3")` to locate the database
file for a SQLite driver.

Regenerate and verify it after changing its source documents:

```sh
npm run build:catalog
npm run check:catalog
```
