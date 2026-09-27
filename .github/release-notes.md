## Download

| System | File |
|---|---|
| **Windows** 10 / 11 | `Vodka_…_x64-setup.exe` (or the `.msi`) |
| **macOS** Apple Silicon (M1 and newer) | `Vodka_…_aarch64.dmg` |
| **macOS** Intel | `Vodka_…_x64.dmg` |
| **Linux**, any distro | `Vodka_…_amd64.AppImage` |
| **Linux**, Debian / Ubuntu / Mint | `Vodka_…_amd64.deb` |
| **Linux**, Fedora / openSUSE | `Vodka-…x86_64.rpm` |

Everything Vodka needs (yt-dlp, ffmpeg, whisper.cpp) is included. The lyrics sync model (148 MB) downloads the first time a song with lyrics plays.

### First launch

The app isn't signed with a paid developer certificate yet, so your system asks once:

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** open the app, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Linux AppImage:** make it executable first: `chmod +x Vodka_*.AppImage`, then run it.
