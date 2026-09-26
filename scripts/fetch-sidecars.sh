#!/bin/sh
# Puts yt-dlp, ffmpeg, ffprobe and whisper-cli into src-tauri/binaries with the target-triple suffix Tauri expects.
# whisper-cli (lyrics sync) is built from source: needs git, cmake and a C++ compiler.
# ponytail: ffmpeg/ffprobe are copied from this machine's PATH; for a redistributable build drop static builds here instead.
set -e
mkdir -p "$(dirname "$0")/../src-tauri/binaries"
cd "$(dirname "$0")/../src-tauri/binaries"
T=$(rustc -vV | sed -n 's/host: //p')
case "$T" in
  *linux*) Y=yt-dlp_linux; E= ;;
  *darwin*) Y=yt-dlp_macos; E= ;;
  *windows*) Y=yt-dlp.exe; E=.exe ;;
esac
curl -fL -o "yt-dlp-$T$E" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$Y"
for b in ffmpeg ffprobe; do cp "$(command -v $b)" "$b-$T$E"; done
# whisper.cpp, pinned: local speech recognition used to fit lyrics to each file
W=v1.9.4
if [ ! -f "whisper-cli-$T$E" ]; then
  rm -rf .whisper-src
  git clone -q --depth 1 --branch "$W" https://github.com/ggml-org/whisper.cpp .whisper-src
  cmake -S .whisper-src -B .whisper-src/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null
  cmake --build .whisper-src/build --config Release -j --target whisper-cli
  cp .whisper-src/build/bin/whisper-cli$E "whisper-cli-$T$E" 2>/dev/null || cp .whisper-src/build/bin/Release/whisper-cli$E "whisper-cli-$T$E"
  rm -rf .whisper-src
fi
chmod +x ./*
ls -la
