# Prompt for Claude Code

Paste this into Claude Code from the root of an empty repo (or your existing one), with this `design_handoff_vodka/` folder copied in.

---

You are building **Vodka**, a desktop music app. The user pastes YouTube, SoundCloud or Spotify links; Vodka downloads the audio to a local library, where they can play it, like it, build playlists, queue tracks and control playback (shuffle, repeat off/all/one, volume, seek).

The full visual + behavioral spec is in `design_handoff_vodka/README.md`. The interactive reference prototype is `design_handoff_vodka/design/Vodka.dc.html` (open it in a browser; all state is simulated). Treat the HTML as a **design reference**, not code to ship. Recreate it pixel-accurately in the stack below.

**Stack**
- Tauri 2 (Rust backend) + React + TypeScript + Vite. Use Electron only if Tauri blocks something.
- Styling: CSS modules or vanilla-extract using the tokens in the README. No UI kit, no icon library; icons are the few inline SVG shapes described in the README.
- State: Zustand. Persist library, playlists, settings, liked flags and volume to SQLite (`tauri-plugin-sql`) or a JSON file in the app data dir.
- Audio: HTML5 `<audio>` through Web Audio (GainNode for volume/normalize, two elements for crossfade). Waveform peaks are generated once per track at import (ffmpeg → downsample to 72 bars) and stored.
- Downloads: sidecar binaries `yt-dlp` and `ffmpeg`. YouTube/SoundCloud go straight through yt-dlp. Spotify links: resolve metadata via the Spotify Web API (or oEmbed), then search/download the matching audio via yt-dlp (`ytsearch1:"artist - title"`), and tag with Spotify metadata. Playlist/album links expand into one job per track.
- Metadata tagging + cover art embedding: ffmpeg or `lofty` (Rust).

**Build order**
1. Scaffold Tauri + React + TS, app shell (custom title bar, sidebar, main, right Now Playing panel, bottom player) with tokens and fonts (Archivo variable with `wdth`, JetBrains Mono).
2. Library view with the track table, filter tabs, sorting, current-row inversion, context menu.
3. Player engine + bottom bar (waveform seek, text toggles, segmented volume) + keyboard shortcuts.
4. Queue / Now Playing panel (up next + "then from" context).
5. Download pipeline in Rust: job queue with N parallel workers, progress events to the UI (resolving → downloading % → tagging → done / failed), pause/resume/cancel/retry, dedupe by URL, a paste/drop-anywhere link parser.
6. Playlists (create, rename inline, delete with undo, add/remove tracks), Liked.
7. Settings (all rows in README) wired to the real pipeline/player.
8. Responsive narrow layout (<860px), toasts with Undo, empty states, skeleton rows.

Keep copy exactly as in the README. No em dashes in UI copy. Sharp corners (2px max), no gradients, no glow, no pastel colors.

After each step, run the app and compare it side by side with the prototype.
