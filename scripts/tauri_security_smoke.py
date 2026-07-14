#!/usr/bin/env python3
"""Static smoke checks for Tauri desktop security baseline."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONF = ROOT / "desktop" / "tauri" / "src-tauri" / "tauri.conf.json"
LIB = ROOT / "desktop" / "tauri" / "src-tauri" / "src" / "lib.rs"


def main() -> int:
    errors: list[str] = []

    if not CONF.exists():
        errors.append(f"missing {CONF}")
    else:
        conf = json.loads(CONF.read_text(encoding="utf-8"))
        csp = (
            conf.get("app", {})
            .get("security", {})
            .get("csp")
        )
        if not csp or not isinstance(csp, str):
            errors.append("tauri.conf.json: CSP missing or empty")
        else:
            if "default-src *" in csp or csp.strip() == "null":
                errors.append("tauri.conf.json: CSP too permissive (default-src *)")
            if "object-src 'none'" not in csp:
                errors.append("tauri.conf.json: CSP should set object-src 'none'")
            if "default-src 'self'" not in csp:
                errors.append("tauri.conf.json: CSP should start from default-src 'self'")

    if not LIB.exists():
        errors.append(f"missing {LIB}")
    else:
        text = LIB.read_text(encoding="utf-8")
        if "fn assert_path_allowed" not in text:
            errors.append("lib.rs: assert_path_allowed missing")
        for cmd in (
            "write_text_file",
            "read_text_file",
            "write_bytes_file",
            "read_bytes_file",
            "copy_file",
        ):
            # Ensure command body calls the allowlist helper.
            m = re.search(
                rf"fn {cmd}\s*\([\s\S]*?assert_path_allowed",
                text,
            )
            if not m:
                errors.append(f"lib.rs: {cmd} must call assert_path_allowed")

        # Must not re-enable null CSP in conf-adjacent comments count as ok;
        # keep a hard ban on dangerous tauri allowlist all.
        if re.search(r'csp\s*:\s*null', text, re.I):
            errors.append("lib.rs: must not set csp null in code")

    if errors:
        for e in errors:
            print(f"ERROR {e}")
        return 1
    print("tauri security smoke: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
