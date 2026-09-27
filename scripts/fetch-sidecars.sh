#!/bin/sh
# Puts yt-dlp, ffmpeg, ffprobe and whisper-cli into src-tauri/binaries with the target-triple suffix Tauri expects.
#   TARGET=<rust triple>  build for another target (default: this machine), e.g. x86_64-apple-darwin
# whisper-cli (lyrics sync) is built from source: needs git, cmake and a C++ compiler.
# Re-running always refreshes yt-dlp; the other tools are only fetched or built when missing.
set -e
mkdir -p "$(dirname "$0")/../src-tauri/binaries"
cd "$(dirname "$0")/../src-tauri/binaries"
T=${TARGET:-$(rustc -vV | sed -n 's/host: //p')}

case "$T" in
  x86_64-unknown-linux-gnu)  Y=yt-dlp_linux;         F=linux-x64;    E= ;;
  aarch64-unknown-linux-gnu) Y=yt-dlp_linux_aarch64; F=linux-arm64;  E= ;;
  x86_64-apple-darwin)       Y=yt-dlp_macos;         F=darwin-x64;   E= ;;
  aarch64-apple-darwin)      Y=yt-dlp_macos;         F=darwin-arm64; E= ;;
  x86_64-pc-windows-msvc)    Y=yt-dlp.exe;           F=win32-x64;    E=.exe ;;
  *) echo "Unsupported target: $T" >&2; exit 1 ;;
esac

# yt-dlp: always the latest release (the app also keeps its own copy updated at runtime)
curl -fsSL -o "yt-dlp-$T$E" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$Y"

# ffmpeg + ffprobe: self-contained static builds, so packaged apps don't depend on system libraries
FF=b6.1.1
for b in ffmpeg ffprobe; do
  if [ ! -f "$b-$T$E" ]; then
    curl -fsSL "https://github.com/eugeneware/ffmpeg-static/releases/download/$FF/$b-$F.gz" | gunzip > "$b-$T$E.part"
    mv "$b-$T$E.part" "$b-$T$E"
  fi
done

# whisper.cpp, pinned: local speech recognition used to fit lyrics to each file
W=v1.9.4
if [ ! -f "whisper-cli-$T$E" ]; then
  set -- -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
  # Portable: no -march=native (would crash on other CPUs), no OpenMP runtime to ship alongside
  # (measured 2.5x faster without it too), and C++ runtime linked in.
  set -- "$@" -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
  case "$T" in x86_64-*) set -- "$@" -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON ;; esac
  case "$T" in
    *linux*) set -- "$@" "-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc" ;;
    *windows*) set -- "$@" -DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded ;;
  esac
  case "$T" in
    x86_64-apple-darwin) set -- "$@" -DCMAKE_OSX_ARCHITECTURES=x86_64 ;;
    aarch64-apple-darwin) set -- "$@" -DCMAKE_OSX_ARCHITECTURES=arm64 ;;
  esac
  rm -rf .whisper-src
  git clone -q --depth 1 --branch "$W" https://github.com/ggml-org/whisper.cpp .whisper-src
  cmake -S .whisper-src -B .whisper-src/build "$@" >/dev/null
  cmake --build .whisper-src/build --config Release -j 4 --target whisper-cli
  cp ".whisper-src/build/bin/whisper-cli$E" "whisper-cli-$T$E" 2>/dev/null || cp ".whisper-src/build/bin/Release/whisper-cli$E" "whisper-cli-$T$E"
  rm -rf .whisper-src
fi

chmod +x ./*
ls -la
