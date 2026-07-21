#!/bin/bash
# Builds Organizer.app, the faceless notifier bundle (needs Xcode CLT).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/Organizer.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.organizer.notify</string>
  <key>CFBundleName</key><string>Organizer</string>
  <key>CFBundleExecutable</key><string>organizer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>organizer</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
cp "$DIR/organizer.icns" "$APP/Contents/Resources/organizer.icns"
swiftc -O -o "$APP/Contents/MacOS/organizer" "$DIR/notify.swift" \
  -framework AppKit -framework UserNotifications
codesign -f -s - "$APP"
echo "built $APP"
