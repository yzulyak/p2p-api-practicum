#!/usr/bin/env python3
"""Block agent edits that introduce constitution violations in tests/ or pages/."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

SCOPED_FILE_RE = re.compile(
    r"(^|[/\\])(tests|pages)[/\\].*\.[jt]sx?$",
    re.IGNORECASE,
)
SPEC_FILE_RE = re.compile(
    r"(^|[/\\])tests[/\\].*\.(spec|test)\.[jt]sx?$",
    re.IGNORECASE,
)
EXPECT_RE = re.compile(r"\bexpect\s*\(")

# Patterns that violate the constitution when newly introduced.
WAIT_FOR_TIMEOUT_RE = re.compile(r"\.waitForTimeout\s*\(")
XPATH_LOCATOR_RE = re.compile(r"""\blocator\s*\(\s*(['"`])//""")
ANY_TYPE_RE = re.compile(
    r"""(?::\s*any\b|\bas\s+any\b|<any>|Array\s*<\s*any\s*>)"""
)
FILL_EMAIL_RE = re.compile(
    r"""\.fill\s*\([^)]*(['"`])[^'"`\n]*@[^'"`\n]+\1"""
)
CREDENTIAL_ASSIGN_RE = re.compile(
    r"""(?i)\b(?:password|secret|api_key|token)\b\s*[:=]\s*(['"`])[^'"`]{4,}\1"""
)
DESCRIBE_TAG_RE = re.compile(
    r"""\btest\.describe\s*\([^)]*?\{\s*[^}]*\btag\s*:""",
    re.DOTALL,
)

PATTERN_CHECKS: list[tuple[str, re.Pattern[str]]] = [
    (".waitForTimeout(", WAIT_FOR_TIMEOUT_RE),
    ("XPath locator (locator('//…'))", XPATH_LOCATOR_RE),
    ("the any type", ANY_TYPE_RE),
    ("hardcoded credential via .fill(email)", FILL_EMAIL_RE),
    ("hardcoded credential (password/secret/api_key/token literal)", CREDENTIAL_ASSIGN_RE),
    ("tag on test.describe(…, { tag: … })", DESCRIBE_TAG_RE),
]


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


def is_scoped_file(file_path: str) -> bool:
    normalized = file_path.replace("\\", "/")
    return bool(SCOPED_FILE_RE.search(normalized))


def is_spec_file(file_path: str) -> bool:
    normalized = file_path.replace("\\", "/")
    return bool(SPEC_FILE_RE.search(normalized))


def pattern_present(content: str, pattern: re.Pattern[str]) -> bool:
    return pattern.search(content) is not None


def find_introduced_violations(
    before: str | None,
    after: str,
    edits: list[dict[str, Any]],
) -> list[str]:
    """Return reasons for patterns newly introduced by this edit."""
    reasons: list[str] = []

    if before is not None:
        for label, pattern in PATTERN_CHECKS:
            if pattern_present(after, pattern) and not pattern_present(before, pattern):
                reasons.append(label)
        return reasons

    # Reconstruction failed: flag only patterns in new_string but not old_string.
    for label, pattern in PATTERN_CHECKS:
        for edit in edits:
            old = edit.get("old_string", "")
            new = edit.get("new_string", "")
            if not isinstance(old, str):
                old = ""
            if not isinstance(new, str):
                new = ""
            if pattern_present(new, pattern) and not pattern_present(old, pattern):
                reasons.append(label)
                break
    return reasons


def expect_drop_reason(
    file_path: str,
    before: str | None,
    after: str,
    edits: list[dict[str, Any]],
) -> str | None:
    """For spec files, block if active expect( count drops."""
    if not is_spec_file(file_path):
        return None

    after_count = count_active_expects(after)
    if before is not None:
        before_count = count_active_expects(before)
    else:
        # Mirror guard-test-assertions fallback: estimate from edit deltas.
        delta = 0
        for edit in edits:
            old = edit.get("old_string", "")
            new = edit.get("new_string", "")
            if not isinstance(old, str):
                old = ""
            if not isinstance(new, str):
                new = ""
            delta += count_active_expects(old) - count_active_expects(new)
        before_count = after_count + delta

    if after_count < before_count:
        return (
            f"active expect( count dropped {before_count} -> {after_count} "
            f"(do not delete or comment out assertions)"
        )
    return None


def block(file_path: str, reasons: list[str]) -> int:
    reason_text = "; ".join(reasons)
    message = f"Blocked: constitution violation in {file_path} — {reason_text}"
    agent_message = (
        f"{message} The edit already landed on disk (afterFileEdit runs after the "
        f"write). Revert this edit now: restore {file_path} to its pre-edit content "
        f"(remove the violating change) before continuing."
    )
    print(
        json.dumps(
            {
                "user_message": message,
                "agent_message": agent_message,
            }
        )
    )
    print(message, file=sys.stderr)
    return 2


def main() -> int:
    raw = sys.stdin.read()
    if not raw or not raw.strip():
        print("guard-constitution: empty stdin JSON", file=sys.stderr)
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"guard-constitution: invalid JSON: {exc}", file=sys.stderr)
        return 1

    if not isinstance(payload, dict):
        print("guard-constitution: JSON root must be an object", file=sys.stderr)
        return 1

    file_path = payload.get("file_path")
    if not isinstance(file_path, str) or not file_path:
        print("guard-constitution: missing or invalid file_path", file=sys.stderr)
        return 1

    if not is_scoped_file(file_path):
        return 0

    edits = payload.get("edits")
    if edits is None:
        edits = []
    if not isinstance(edits, list):
        print("guard-constitution: edits must be an array", file=sys.stderr)
        return 1

    path = Path(file_path)
    if not path.is_file():
        print(f"guard-constitution: file not found: {file_path}", file=sys.stderr)
        return 1

    try:
        after_content = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"guard-constitution: failed to read {file_path}: {exc}", file=sys.stderr)
        return 1

    before_content = reconstruct_before(after_content, edits)

    reasons = find_introduced_violations(before_content, after_content, edits)
    drop = expect_drop_reason(file_path, before_content, after_content, edits)
    if drop is not None:
        reasons.append(drop)

    if reasons:
        return block(file_path, reasons)

    print(f"guard-constitution: OK — {file_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
