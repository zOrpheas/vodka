# Handoff: Vodka desktop music app

## Overview
Vodka is a desktop app that works like a personal Spotify you fill yourself. You paste YouTube, SoundCloud or Spotify links, it downloads the audio into a local library, and from there you play, like, queue and organize tracks into playlists.

## About the design files
`design/Vodka.dc.html` is a **design reference built in HTML**: a working prototype of the intended look and behavior. Downloads, audio playback, the folder picker and the window controls are simulated. Don't ship the HTML. Recreate it in the target stack (recommended: Tauri + React + TypeScript; see `PROMPT.md`). To view it, open `design/Vodka.dc.html` in a browser (keep `support.js` next to it).

## Fidelity
**High fidelity.** Final colors, type, spacing, copy and interactions. Recreate pixel-accurately.

---

## Design tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| bg | `#0c0d0f` | main background |
| bg-deep | `#0a0b0d` | sidebar, right panel, player bar (player at 92% alpha + 16px backdrop blur) |
| bg-titlebar | `#08090a` | window title bar |
| surface | `#121417` | search field, modals |
| surface-menu | `#16181c` | context menu |
| ink | `#eceef1` | primary text, primary buttons, active states, played waveform |
| ink-hover | `#ffffff` | primary button hover |
| muted | `#8c939d` | secondary text |
| dim | `#5b626c` | indices, counts, column headers, placeholder |
| faint | `#3b4048` | inactive heart, paused bars, sub-text on inverted row |
| off | `#2c3036` | unplayed waveform bars, unliked heart |
| track-bg | `#24272c` | skeleton blocks, scrollbar thumb, volume track |
| error | `#ff7a7a` | failures, delete, muted |
| window-close-hover | `#c42b1c` | |
| lines | `rgba(255,255,255,.045)` row dividers · `.06` panel borders · `.08` section rules · `.12–.18` control borders |

**Album-art placeholder color:** flat `oklch(0.37 0.07 H)` with a per-track hue H (0–360). In production, use the real thumbnail. Keep the flat tile + letter as the fallback.

### Typography
- **Archivo** (variable, Google Fonts, `wdth 62..125`, `wght 400..900`): UI body.
- **Display**: Archivo, `font-stretch: 62%`, weight 900, UPPERCASE, `line-height .82`, `letter-spacing -.01em`. Page titles 76px (48px narrow), logo 46px, section titles 24px, now-playing title 32px/0.9, empty states 34px.
- **JetBrains Mono** 400/500/700: labels, counts, times, toggles, badges. Usually 10–11.5px, UPPERCASE, `letter-spacing .04–.08em`.
- Body sizes: track title 14/700, artist 12.5/400, menu items 13.5/500, settings label 14/700, settings description 12.5.

### Shape
- Radius: **2px** on controls; **0** on panels, rows, tiles.
- Shadows only on floating layers: menu `0 18px 48px rgba(0,0,0,.6)`, modal `0 30px 80px rgba(0,0,0,.6)`, toast `0 18px 50px rgba(0,0,0,.55)`.
- No gradients (except the dashed volume track), no glows, no pastels.

### Spacing
Content padding 24px (14px narrow). Row padding 6px 8px (compact: 3px 8px). Sidebar items 34px tall, 16px side padding. Player bar padding 10px 16px.

---

## Layout (wide, ≥ 860px)
```
┌──────────────────── title bar 32px ─────────────────────┐
├ sidebar 216 ┬──────── main (scroll) ────────┬ panel 300 ┤  panel docked ≥1180px,
│             │ sticky search/paste bar        │ Now       │  otherwise overlays 320px
│             │ page header + tabs             │ playing + │
│             │ track table                    │ queue     │
├─────────────┴────────────────────────────────┴───────────┤
│ player bar: [art+title+♥] [controls / waveform] [queue vol]│  grid 1fr 2fr 1fr
└──────────────────────────────────────────────────────────┘
```
Narrow (< 860px): no sidebar or right panel. Bottom has a 2px seek line, a mini player (art, title, ♥, play, next) and a 5-tab bar: LIBRARY · LISTS · QUEUE · DL n · SETUP. The queue opens full-screen.

## Components

**Title bar (32px, draggable).** Left: mono 10.5/700 uppercase `VODKA · {view}` plus `· NOW PLAYING {title}` while playing. Right: `KEYS ?` button (opens shortcuts), then minimize / maximize / close (44px wide each; close hover is red).

**Sidebar.**
- Logo block: `VODKA` in display 46px, with `{n} TRACKS · {size}` in mono 10px below it.
- Nav rows (grid `24px 1fr auto`): `01 Library`, `02 Liked`, `03 Downloads`. The index is mono. The count is mono; on Downloads it becomes an inverted badge (`#eceef1` background) while jobs are active, e.g. `1 · 1 ERR`. The active row gets a `rgba(255,255,255,.06)` background and ink text.
- Playlists header, with a `+ NEW` mono button (hover inverts).
- Playlist rows: 10px color square (the first track's art color), name, count.
- Footer: `04 Settings`.

**Search / paste bar (sticky, blurred background).** 42px, 1px border, 2px radius.
- Left mode cell reads `FIND`, or `POUR` when the text contains a link (the border also turns ink).
- Placeholder: "Search your library, or paste YouTube / SoundCloud / Spotify links to download".
- When links are detected, an inverted button `POUR YT ↵` (or `POUR 3 LINKS ↵`) submits.
- A `⌘K` / `Ctrl K` hint shows when idle; a clear × shows when there's text.
- Plain text filters the current list live.

**Page header.** Mono eyebrow (`14 tracks · 52 min`, or `3 results for "x"`) above the display title (`LIBRARY` / `LIKED` / `DOWNLOADS` / `SETTINGS` / playlist name). Right side:
- `SHUFFLE`: outline, mono 11.5/700.
- `▶ Play all`: inverted, Archivo 14/800, 40px tall.

**Filter tabs.** Mono 11/700 uppercase: ALL · LIKED · YOUTUBE · SOUNDCLOUD · SPOTIFY, each followed by a dim count. The active tab has a 2px ink underline; the row sits on a 1px bottom rule.

**Track table.**
- Columns: `No.` (26) · Title (1fr: 38px art tile + title/artist) · `Src` badge (34, mono 10/700, 1px border) · Added (70, hidden at mid widths) · ♥ (28) · Len (44, right-aligned) · `···` (28).
- Header labels: mono 10px dim uppercase. Title, Added and Len sort when clicked: first click ascending (Added starts newest-first), second click flips, third clears. The active header shows an ↑/↓ arrow.
- Rows: 1px bottom divider, hover `rgba(255,255,255,.035)`.
- **Current track row is inverted**: `#eceef1` background, `#0c0d0f` text, sub-text `#3b4048`, animated 3-bar equalizer in place of the number.
- Art tile: flat color with the first letter of the title (display 900, 40px), anchored bottom-left and cropped.

**Context menu** (••• button or right-click). 232px wide, 2px radius; item hover inverts.
- Play next · Add to queue · Save to Liked / Remove from Liked `L`
- PLAYLISTS: one row per playlist with a 10px checkbox square (filled when the track is in it) · + New playlist
- Copy {Source} link · Remove from this playlist (playlist view only) · Delete from library (red)

**Playlist header.** 150px 2×2 mosaic of the first four art colors. The name is an inline-editable input in display type. Buttons: ▶ Play, SHUFFLE, + QUEUE, and DELETE (right-aligned text button).

**Downloads.**
- Header eyebrow: `n active · n failed · n done`. Buttons: RETRY FAILED (red outline), CLEAR FINISHED.
- Info strip of bordered cells: `Format MP3 320k | Folder ~/Music/Vodka | Parallel 2 | Edit`.
- Job row (grid `40px 1fr auto auto`):
  - Source tile (`YT` / `SC` / `SP`).
  - Title + artist, with the URL in mono 11px below. While resolving, a pulsing skeleton (two bars) replaces the title.
  - Right: a big display percentage (30px), or `OK` / `ERR`, with the status in mono 10px: Resolving · Downloading · Tagging / Converting · Waiting · Paused · In library · Private or region-locked.
  - Actions: PLAY / RETRY / PAUSE–RESUME / ×.
  - A 2px progress line along the row's bottom edge (ink when active, `#3b4048` when waiting or paused, red on fail). Failed rows get a `rgba(255,122,122,.05)` tint.

**Right panel: Now Playing + Queue.**
- NOW PLAYING label and a × close button.
- Square art (full width) with a 300px letter and a black corner tag `YT · MP3 320K`.
- Title in display 32px, artist, and a ♥ box button.
- `QUEUED · n` section (with CLEAR) listing tracks that play before the context resumes; each has ×.
- `THEN FROM {Library / playlist}` section showing the remaining context order. Includes wrap-around when repeat-all is on; otherwise "End of list. Turn on repeat to loop."

**Player bar.**
- Left: 48px art, title (14/800), artist, ♥.
- Center, top row: `SHUF` toggle · prev · 40px square play/pause (inverted) · next · repeat toggle cycling `REPEAT` → `RPT ALL` → `RPT 1`. Toggles are mono 10/700, 26px tall, outlined when off and inverted when on.
- Center, below: elapsed · **waveform scrubber** (72 bars, 2px gap, 26px tall; played bars ink, unplayed `#2c3036`; click or drag to seek) · duration.
- Right: `QUEUE` toggle, `VOL` label (turns red and reads `MUTED`, click to mute), segmented volume bar (110px, 3px ticks with 2px gaps; drag or scroll-wheel), and the number 0–100.

**Settings.** Sections `01 DOWNLOADS`, `02 PLAYBACK`, `03 APP`, each a display-24 title over a rule. Rows have a label and description on the left and a control on the right:
- Save to: path + `BROWSE` (native folder picker)
- Format: MP3 / M4A / OPUS / FLAC segmented
- Bitrate (kbps): 128 / 192 / 256 / 320 (disabled at 35% opacity for FLAC)
- Parallel downloads: stepper 1–5
- Auto-tag metadata and artwork; Skip duplicates: OFF/ON switches
- Crossfade: native range 0–12s (`accent-color: #eceef1`), label `OFF` or `4s`
- Normalize volume; Gapless playback: switches
- Notify when downloads finish; Close to tray; Launch on startup: switches

The page eyebrow shows `{n} tracks · {size} on disk`, estimated from duration × bitrate.

**Toast.** Bottom-center, above the player. Inverted block, 13.5/700, optional `UNDO` cell. Stays 2.6s, or 4.5s when it has Undo. Enters with a 6px rise and fade over 160ms.

**Shortcuts modal.** Blurred scrim. Two-column list of label + mono key chip.

## Interactions & behavior
- **Adding links:** paste in the bar and press Enter, paste anywhere outside an input, or drag-and-drop a link onto the window. Several URLs at once (split on whitespace or commas) create several jobs. Duplicates (URL already in the library or jobs) are skipped when the setting is on, with a toast. Non-matching drops show "Not a YouTube, SoundCloud or Spotify link".
- **Download queue:** oldest pending jobs run first, up to `Parallel downloads` at a time; the rest show Waiting. When a job finishes, the track is added to the top of the library (added = "Today") and a toast reads `"Title" is in your library` (if notifications are on). On failure, the toast reads "A download failed. Retry it in Downloads."
- **Playback:** clicking a row plays it, using the visible (filtered/sorted) list as the context queue; clicking the current row toggles pause. A tweak allows double-click-to-play instead. Next takes from the manual queue first, then the context. Shuffle picks a random other track. Repeat all wraps; repeat one restarts. Prev restarts the track if more than 3s in, otherwise goes back.
- **Undo:** available for deleting a track, deleting a playlist, and removing from a playlist.
- **Menus:** close on outside click or Esc.
- **Keyboard:** Space play/pause · ⌘/Ctrl K focus the bar · Shift →/← next/prev · ←/→ seek 5s · ↑/↓ volume 5% · L like · Q panel · S shuffle · R repeat · M mute · ? shortcuts · Esc close/clear. Shortcuts are ignored while typing in an input.
- **Close button:** hides to tray when "Close to tray" is on.
- **Responsive:** below 1100px (or 1400px with the panel docked) the Added column hides. Below 1180px the right panel overlays instead of docking. Below 860px the narrow layout applies.

## State (suggested store shape)
```ts
Track { id, title, artist, durationSec, source: 'yt'|'sc'|'sp', sourceUrl, filePath, addedAt, liked, artUrl?, hue, peaks: number[72] }
Playlist { id, name, trackIds: string[] }
Job { id, url, source, title?, artist?, progress 0–100, status: 'waiting'|'resolving'|'downloading'|'tagging'|'done'|'failed'|'paused', error?, trackId? }
Player { currentId, positionSec, playing, shuffle, repeat: 'off'|'all'|'one', volume 0–1, muted, contextIds: string[], contextName, upNext: string[] }
UI { view: 'library'|'playlist'|'downloads'|'playlists'|'settings', filter: 'all'|'liked'|'yt'|'sc'|'sp', playlistId?, query, sort: {key: 'title'|'added'|'dur'|null, dir}, menuFor?, panelOpen, helpOpen, toast? }
Settings { folder, format, bitrate, parallel, autotag, skipDupes, crossfadeSec, normalize, gapless, notify, closeToTray, launchOnStartup }
```

## Assets
- No images. Album art is a placeholder: flat color + letter. Replace it with the source thumbnail (yt-dlp `--write-thumbnail`, embedded as cover).
- Icons are hand-drawn primitive SVGs (triangle, bars, ×, heart, window glyphs). No icon library.
- Fonts: Archivo, JetBrains Mono (Google Fonts). Bundle them locally in the app.

## Files
- `design/Vodka.dc.html`: interactive prototype (open in a browser)
- `design/support.js`: runtime needed to open the prototype
- `PROMPT.md`: ready-to-paste Claude Code prompt
