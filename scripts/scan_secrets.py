#!/usr/bin/env python3
"""Lightweight secrets scan for tracked files (release hardening)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".cursor",
    "test-results",
    "playwright-report",
    "coverage",
}

# Real-looking secrets (not placeholder wording).
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_pat", re.compile(r"ghp_[A-Za-z0-9]{20,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    (
        "hardcoded_oko_token",
        re.compile(
            r"""(?:OKO_ADMIN_TOKEN|OKO_USER_TOKEN|OKO_BOOTSTRAP_ADMIN_PASSWORD)\s*=\s*['\"]?(?!change|changeme|your-|xxx|placeholder|example|<)([^\s'\"]{8,})""",
            re.I,
        ),
    ),
]

TEXT_SUFFIXES = {
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".yml",
    ".yaml",
    ".env",
    ".md",
    ".sql",
    ".sh",
    ".py",
    ".toml",
    ".rs",
}


def iter_files() -> list[Path]:
    out: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {
            "Dockerfile",
            "Dockerfile.api-nest",
            "Dockerfile.portal",
        }:
            continue
        if path.name.endswith(".lock"):
            continue
        out.append(path)
    return out


def main() -> int:
    findings: list[str] = []
    for path in iter_files():
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        # Skip docs that only discuss env var names as examples.
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith("docs/") or rel.endswith(".md"):
            continue
        for name, pat in PATTERNS:
            for m in pat.finditer(text):
                # Ignore self in this scanner / example compose empties handled by negative lookahead
                if "scan_secrets.py" in rel:
                    continue
                line = text.count("\n", 0, m.start()) + 1
                findings.append(f"{rel}:{line}: {name}")

    if findings:
        print("ERROR potential secrets found:")
        for f in findings[:50]:
            print(f"  {f}")
        if len(findings) > 50:
            print(f"  … and {len(findings) - 50} more")
        return 1
    print("secrets scan: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
