#!/usr/bin/env python3
"""Resize Tauri icons to correct dimensions and RGBA."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
SRC = Image.open(ROOT / "icon.png").convert("RGBA")

TARGETS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "rachel.c@example.org": 256,
    "icon.png": 512,
}

for name, size in TARGETS.items():
    im = SRC.resize((size, size), Image.Resampling.LANCZOS)
    im.save(ROOT / name, format="PNG")
    print(f"wrote {name} {im.mode} {im.size}")

bogus = ROOT / "henry.w@example.net"
if bogus.exists():
    bogus.unlink()
    print(f"removed {bogus.name}")
