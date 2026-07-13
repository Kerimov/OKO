#!/usr/bin/env bash
# Install «ОКО Заполнение» from a built .dmg, replacing both possible app names
# so Dock/Spotlight don't keep an old build.
set -euo pipefail
DMG="${1:-}"
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "Usage: $0 /path/to/OKO\\ Zapolnenie_0.1.0_aarch64.dmg"
  exit 1
fi

MOUNT=$(hdiutil attach -nobrowse -readonly "$DMG" | awk '/\/Volumes\//{print $NF; exit}')
if [[ -z "$MOUNT" || ! -d "$MOUNT" ]]; then
  echo "Failed to mount DMG"
  exit 1
fi
cleanup() { hdiutil detach "$MOUNT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

SRC=$(find "$MOUNT" -maxdepth 2 -name '*.app' | head -1)
if [[ -z "$SRC" ]]; then
  echo "No .app in DMG"
  exit 1
fi

pkill -f 'oko-filler-tauri' 2>/dev/null || true
sleep 1

for DEST in "/Applications/OKO Zapolnenie.app" "/Applications/ОКО Заполнение.app"; do
  rm -rf "$DEST"
  echo "Installing → $DEST"
  cp -R "$SRC" "$DEST"
done

echo "Done. Launch: open \"/Applications/ОКО Заполнение.app\""
