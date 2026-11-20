#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "memory" / "iroh-memory.sqlite3"
APPLICATION_ID = 0x49524F48
CATALOG_FORMAT = "iroh.offline-memory.v1"
DOCUMENT_PATHS = (
    "README.md",
    "API.md",
    "GETTING_STARTED.md",
    "SERVER.md",
    "CHANGELOG.md",
    "docs/memory.md",
    "docs/offline-memory-catalog.md",
    "cpp/README.md",
    "python/README.md",
    "irohscript/README.md",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_source(path):
    source = ROOT / path
    if source.is_symlink() or not source.is_file():
        raise ValueError("catalog input must be a regular file: " + path)
    data = source.read_bytes()
    return data.decode("utf-8"), sha256(data)


def source_rows():
    documents = []
    for path in DOCUMENT_PATHS:
        content, digest = read_source(path)
        documents.append((path, "text/markdown", content, digest))

    json_paths = ["package.json", "generations.json", "personality-matrix.json"]
    schema_dir = ROOT / "schemas"
    for source in sorted(schema_dir.glob("*.json")):
        if source.is_symlink() or not source.is_file():
            raise ValueError("catalog schema must be a regular file: " + str(source))
        json_paths.append(source.relative_to(ROOT).as_posix())

    artifacts = []
    for path in sorted(json_paths):
        content, digest = read_source(path)
        json.loads(content)
        artifacts.append((path, content, digest))

    package = json.loads(read_source("package.json")[0])
    return package, documents, artifacts


def expected_metadata(package):
    matrix = json.loads(read_source("personality-matrix.json")[0])
    return {
        "format": CATALOG_FORMAT,
        "engine.name": package["name"],
        "engine.version": package["version"],
        "personality-matrix.format": matrix["format"],
        "privacy": "static-reference-data-only",
        "schema.version": "1",
    }


def check_database(database, package, documents, artifacts):
    if database.is_symlink() or not database.is_file():
        raise ValueError("catalog database is missing or not a regular file: " + str(database))
    uri = database.resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        if connection.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
            raise ValueError("catalog application_id does not match")
        if connection.execute("PRAGMA user_version").fetchone()[0] != 1:
            raise ValueError("catalog schema version does not match")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("catalog failed SQLite quick_check")

        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        if metadata != expected_metadata(package):
            raise ValueError("catalog metadata is stale")
        stored_documents = {
            row[0]: row[1:]
            for row in connection.execute(
                "SELECT path, media_type, content, sha256 FROM memory_documents"
            )
        }
        expected_documents = {
            path: (media_type, content, digest)
            for path, media_type, content, digest in documents
        }
        if stored_documents != expected_documents:
            raise ValueError("catalog documents are stale")
        stored_artifacts = {
            row[0]: row[1:]
            for row in connection.execute(
                "SELECT path, content, sha256 FROM json_artifacts"
            )
        }
        expected_artifacts = {
            path: (content, digest)
            for path, content, digest in artifacts
        }
        if stored_artifacts != expected_artifacts:
            raise ValueError("catalog JSON artifacts are stale")


def build_database(database, package, documents, artifacts):
    database.parent.mkdir(parents=True, exist_ok=True)
    if database.is_symlink() or (database.exists() and not database.is_file()):
        raise ValueError("catalog output must be a regular file: " + str(database))
    if database.exists():
        try:
            with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
                application_id = connection.execute("PRAGMA application_id").fetchone()[0]
                metadata = dict(connection.execute("SELECT key, value FROM metadata"))
            if application_id != APPLICATION_ID or metadata.get("format") != CATALOG_FORMAT:
                raise ValueError
        except (sqlite3.Error, ValueError):
            raise ValueError("refusing to replace an unrecognized catalog: " + str(database))

    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=".iroh-memory-", suffix=".sqlite3", dir=database.parent
    )
    os.close(file_descriptor)
    temporary = Path(temporary_name)
    try:
        with sqlite3.connect(temporary) as connection:
            connection.execute("PRAGMA application_id = " + str(APPLICATION_ID))
            connection.execute("PRAGMA user_version = 1")
            connection.execute("PRAGMA journal_mode = DELETE")
            connection.execute("PRAGMA synchronous = FULL")
            connection.executescript(
                """
                CREATE TABLE metadata (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                ) WITHOUT ROWID;
                CREATE TABLE memory_documents (
                    path TEXT PRIMARY KEY NOT NULL,
                    media_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
                ) WITHOUT ROWID;
                CREATE TABLE json_artifacts (
                    path TEXT PRIMARY KEY NOT NULL,
                    content TEXT NOT NULL,
                    sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
                ) WITHOUT ROWID;
                """
            )
            connection.executemany(
                "INSERT INTO metadata(key, value) VALUES (?, ?)",
                sorted(expected_metadata(package).items()),
            )
            connection.executemany(
                "INSERT INTO memory_documents(path, media_type, content, sha256) "
                "VALUES (?, ?, ?, ?)",
                documents,
            )
            connection.executemany(
                "INSERT INTO json_artifacts(path, content, sha256) VALUES (?, ?, ?)",
                artifacts,
            )
            connection.commit()
            connection.execute("VACUUM")
        check_database(temporary, package, documents, artifacts)
        os.chmod(temporary, 0o644)
        os.replace(temporary, database)
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description="Build or verify the offline IrohRedux SQLite catalog.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="verify the existing database without writing")
    args = parser.parse_args()
    requested_output = args.output
    if not requested_output.is_absolute():
        requested_output = Path.cwd() / requested_output
    database = requested_output.parent.resolve() / requested_output.name
    if database.name in ("", ".", ".."):
        raise ValueError("catalog output must name a file")
    package, documents, artifacts = source_rows()
    if args.check:
        check_database(database, package, documents, artifacts)
        action = "verified"
    else:
        build_database(database, package, documents, artifacts)
        action = "built"
    print(
        "Offline memory catalog " + action + ": " + str(database) +
        " (" + str(len(documents)) + " documents, " + str(len(artifacts)) +
        " JSON artifacts, engine " + package["version"] + ")"
    )


if __name__ == "__main__":
    main()
