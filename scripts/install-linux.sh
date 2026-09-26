#!/bin/sh
# Builds a release of Vodka and installs it for the current user, with an app-launcher entry.
#   sh scripts/install-linux.sh              build + install (or update)
#   sh scripts/install-linux.sh --uninstall  remove it again (your library and music are kept)
set -e
cd "$(dirname "$0")/.."

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APP="$DATA/vodka"
DESKTOP="$DATA/applications/vodka.desktop"
ICONS="$DATA/icons/hicolor"

if [ "$1" = "--uninstall" ]; then
  rm -rf "$APP" "$DESKTOP"
  rm -f "$ICONS/32x32/apps/vodka.png" "$ICONS/128x128/apps/vodka.png" "$ICONS/256x256/apps/vodka.png"
  update-desktop-database "$DATA/applications" 2>/dev/null || true
  echo "Vodka removed. Your library and music files were left alone."
  exit 0
fi

T=$(rustc -vV | sed -n 's/host: //p')
[ -f "src-tauri/binaries/whisper-cli-$T" ] || sh scripts/fetch-sidecars.sh
[ -d node_modules ] || npm install
npx tauri build --no-bundle

mkdir -p "$APP" "$DATA/applications" "$ICONS/32x32/apps" "$ICONS/128x128/apps" "$ICONS/256x256/apps"
# The app finds its helper tools (yt-dlp, ffmpeg, ffprobe, whisper-cli) next to its own executable.
for b in vodka yt-dlp ffmpeg ffprobe whisper-cli; do
  install -m 755 "src-tauri/target/release/$b" "$APP/$b"
done
install -m 644 src-tauri/icons/32x32.png "$ICONS/32x32/apps/vodka.png"
install -m 644 src-tauri/icons/128x128.png "$ICONS/128x128/apps/vodka.png"
install -m 644 "src-tauri/icons/128x128@2x.png" "$ICONS/256x256/apps/vodka.png"

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Vodka
GenericName=Music Player
Comment=Paste YouTube, SoundCloud or Spotify links and build your own music library
Exec="$APP/vodka"
Icon=vodka
Terminal=false
Categories=AudioVideo;Audio;Player;
Keywords=music;player;youtube;soundcloud;spotify;lyrics;
StartupWMClass=vodka
EOF

update-desktop-database "$DATA/applications" 2>/dev/null || true
gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
echo "Vodka installed. Find it in your app launcher, or run: $APP/vodka"
