#!/bin/bash
# Idempotent setup: the code always installs to ~/.organizer, whether run
# from a checkout or piped from curl — the invocation only decides where the
# code comes from. Local data (items.json etc.) in the root always survives.
set -e

ROOT="$HOME/.organizer"
WIDGETS="$HOME/Library/Application Support/Übersicht/widgets"
LINK="$WIDGETS/organizer.jsx"

if ! [ -d "/Applications/Übersicht.app" ] && ! [ -d "$HOME/Applications/Übersicht.app" ]; then
  echo "Übersicht not found — install it first:  brew install --cask ubersicht" >&2
  exit 1
fi

TMP=""
if [ -f "$(dirname "${BASH_SOURCE[0]:-/dev/null}")/org.py" ]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  TMP="$(mktemp -d)"
  SRC="$TMP"
  echo "downloading organizer"
  curl -fsSL https://github.com/sholub-dev/organizer/archive/refs/heads/master.tar.gz |
    tar xz -C "$SRC" --strip-components 1
fi

mkdir -p "$ROOT"
if [ "$(cd "$SRC" && pwd -P)" != "$(cd "$ROOT" && pwd -P)" ]; then
  echo "installing code to $ROOT"
  rsync -a --delete --exclude .git --exclude items.json --exclude .notified.json \
    --exclude runs.json --exclude runs --exclude __pycache__ \
    --exclude app/Organizer.app "$SRC/" "$ROOT/"
fi
[ -n "$TMP" ] && rm -rf "$TMP"
chmod +x "$ROOT/org.py"

# adopt data from a previous in-repo install the widget pointed at
OLD="$(dirname "$(dirname "$(readlink "$LINK" 2>/dev/null || true)")")"
for f in items.json .notified.json; do
  if ! [ -f "$ROOT/$f" ]; then
    if [ -f "$OLD/$f" ]; then cp "$OLD/$f" "$ROOT/$f"
    elif [ -f "$SRC/$f" ]; then cp "$SRC/$f" "$ROOT/$f"
    fi
  fi
done
[ -f "$ROOT/items.json" ] || printf '{\n  "items": []\n}\n' > "$ROOT/items.json"

# notifier app (own name/icon on notifications; osascript fallback if absent)
[ -x "$ROOT/app/Organizer.app/Contents/MacOS/organizer" ] || bash "$ROOT/app/build.sh" ||
  echo "notifier build failed (needs Xcode Command Line Tools: xcode-select --install); notifications will use the osascript fallback" >&2

# Ubersicht: recreating the widget symlink makes a running Übersicht drop
# the widget, so relaunch it in that case; otherwise just refresh.
mkdir -p "$WIDGETS"
if [ "$(readlink "$LINK" 2>/dev/null)" != "$ROOT/ubersicht/organizer.jsx" ]; then
  ln -sf "$ROOT/ubersicht/organizer.jsx" "$LINK"
  # ASCII pattern: the app name's umlaut is NFD on disk, so "Übersicht"
  # typed here (NFC) never matches killall/pkill by name
  pkill -f "bersicht.app/Contents" 2>/dev/null || true
  sleep 1
fi
open -b tracesOf.Uebersicht || open -a "Übersicht" || true
osascript -e 'tell application id "tracesOf.Uebersicht" to refresh' 2>/dev/null || true

# remove the legacy launchd reminder job (reminders now fire from the widget
# feed; launchd agents cannot read ~/Documents without Full Disk Access)
launchctl bootout "gui/$(id -u)/com.organizer.remind" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.organizer.remind.plist"

echo "installed to $ROOT"
echo "next: in Übersicht preferences set an interaction shortcut (hold it to click the widget),"
echo "      and allow Organizer in System Settings > Notifications when the first reminder fires"
