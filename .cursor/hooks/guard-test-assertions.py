#!/usr/bin/env python3
"""Block agent edits that weaken active expect( assertions in Playwright tests."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

TEST_FILE_RE = re.compile(
    r"(^|[/\\])tests[/\\].*\.(spec|test)\.[jt]sx?$",
    re.IGNORECASE,
)
EXPECT_RE = re.compile(r"\bexpect\s*\(")


def count_active_expects(content: str) -> int:
    """Count expect( calls that are not in // or * comment lines."""
    total = 0
    for raw_line in content.splitlines():
        stripped = raw_line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        code = raw_line.split("//", 1)[0]
        total += len(EXPECT_RE.findall(code))
    return total


def reconstruct_before(after_content: str, edits: list[dict[str, Any]]) -> str | None:
    """Reverse edits[] to recover pre-edit content. Return None on failure."""
    content = after_content
    for edit in reversed(edits):
        old = edit.get("old_string")
        new = edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str):
            return None
        # Empty new_string is a deletion; position is unknown, so fall back.
        if new == "" or new not in content:
            return None
        content = content.replace(new, old, 1)
    return content


def fallback_before_count(after_count: int, edits: list[dict[str, Any]]) -> int:
    """Estimate before_count as after + sum(old expects − new expects)."""
    delta = 0
    for edit in edits:
        old = edit.get("old_string", "")
        new = edit.get("new_string", "")
        if not isinstance(old, str):
            old = ""
        if not isinstance(new, str):
            new = ""
        delta += count_active_expects(old) - count_active_expects(new)
    return after_count + delta


def is_test_spec(file_path: str) -> bool:
    normalized = file_path.replace("\\", "/")
    return bool(TEST_FILE_RE.search(normalized))


def main() -> int:
    raw = sys.stdin.read()
    if not raw or not raw.strip():
        print("guard-test-assertions: empty stdin JSON", file=sys.stderr)
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"guard-test-assertions: invalid JSON: {exc}", file=sys.stderr)
        return 1

    if not isinstance(payload, dict):
        print("guard-test-assertions: JSON root must be an object", file=sys.stderr)
        return 1

    file_path = payload.get("file_path")
    if not isinstance(file_path, str) or not file_path:
        print("guard-test-assertions: missing or invalid file_path", file=sys.stderr)
        return 1

    if not is_test_spec(file_path):
        return 0

    edits = payload.get("edits")
    if edits is None:
        edits = []
    if not isinstance(edits, list):
        print("guard-test-assertions: edits must be an array", file=sys.stderr)
        return 1

    path = Path(file_path)
    if not path.is_file():
        print(f"guard-test-assertions: file not found: {file_path}", file=sys.stderr)
        return 1

    try:
        after_content = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"guard-test-assertions: failed to read {file_path}: {exc}", file=sys.stderr)
        return 1

    after_count = count_active_expects(after_content)

    before_content = reconstruct_before(after_content, edits)
    if before_content is not None:
        before_count = count_active_expects(before_content)
    else:
        before_count = fallback_before_count(after_count, edits)

    if after_count < before_count:
        message = (
            f"Blocked: test assertions weakened in {file_path} — active expect( "
            f"count {before_count} -> {after_count}. Do not delete or comment out "
            f"assertions to make tests pass. Fix the app, locator, or test data instead."
        )
        print(
            json.dumps(
                {
                    "user_message": message,
                    "agent_message": message,
                }
            )
        )
        print(message, file=sys.stderr)
        return 2

    print(
        f"guard-test-assertions: OK — {after_count} active expect( preserved",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
