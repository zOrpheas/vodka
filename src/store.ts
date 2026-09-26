import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { SRC, srcOf, setMediaBase, type Src } from './lib';

export interface Track {
  id: string; title: string; artist: string; dur: number; src: Src; url: string; file: string;
  art?: string | null; peaks: number[]; gain: number; added: number; liked: boolean; hue: number;
  lyrics?: Lyrics | null; // undefined = not looked up yet, null = none found
  onset?: number; // seconds of silence before the first audible sample
}
export interface Lyrics {
  lines: { t: number; text: string }[]; plain?: string | null; instrumental: boolean;
  aligned?: boolean; // true = re-timed to this file, false = tried and kept LRCLIB timing
}
export interface Playlist { id: string; name: string; ids: string[] }
export type JobStatus = 'waiting' | 'resolving' | 'downloading' | 'tagging' | 'done' | 'failed' | 'paused';
export interface Job {
  id: string; url: string; source: Src; title?: string; artist?: string;
  progress: number; status: JobStatus; error?: string; trackId?: string;
}
export interface Settings {
  folder: string; format: 'MP3' | 'M4A' | 'OPUS' | 'FLAC'; bitrate: '128' | '192' | '256' | '320'; parallel: number;
  autotag: boolean; skipDupes: boolean; crossfade: number; normalize: boolean; gapless: boolean;
  notify: boolean; tray: boolean; startup: boolean;
  speed: number; // playback rate, 1.0 to 2.5
  keepPitch: boolean; // true: faster at the same pitch; false: 'sped up' sound
  syncLyrics: boolean; // fit LRCLIB timings to the actual file with local speech recognition
  lyricsNudge: number; // manual lyrics timing, on top of the measured syncLatency
  syncLatency: number; // measured delay between the player's position and what is heard
}
export type View = 'library' | 'playlist' | 'downloads' | 'playlists' | 'settings' | 'lyrics';
export type Filter = 'all' | 'liked' | Src;
export type Repeat = 'off' | 'all' | 'one';

interface State {
  hydrated: boolean;
  tracks: Track[]; playlists: Playlist[]; jobs: Job[]; set: Settings;
  // player
  cur: string | null; pos: number; playing: boolean; shuffle: boolean; repeat: Repeat;
  vol: number; muted: boolean; queue: string[]; ctx: string; upNext: string[];
  seq: number; // bumps whenever the current track must (re)start from 0
  // ui
  w: number; view: View; plId: string | null; filter: Filter; query: string;
  sort: { key: 'title' | 'added' | 'dur' | null; dir: 1 | -1 };
  menuFor: string | null; panelOpen: boolean; help: boolean;
  toast: { msg: string; undo?: () => void; id: number } | null;
  lyricsFailed: string | null; // track id whose lookup failed (offline etc.)
  aligning: string | null; // track id whose lyrics are being matched to the audio
  modelPct: number | null; // speech model download progress
}

const DEFAULT_SET: Settings = {
  folder: '~/Music/Vodka', format: 'MP3', bitrate: '320', parallel: 2, autotag: true, skipDupes: true,
  crossfade: 4, normalize: true, gapless: true, notify: true, tray: true, startup: false, speed: 1, keepPitch: true, syncLyrics: true, lyricsNudge: 0, syncLatency: 0,
};

export const useStore = create<State>(() => ({
  hydrated: false, tracks: [], playlists: [], jobs: [], set: DEFAULT_SET,
  cur: null, pos: 0, playing: false, shuffle: false, repeat: 'off', vol: 0.72, muted: false,
  queue: [], ctx: 'lib', upNext: [], seq: 0,
  w: window.innerWidth, view: 'library', plId: null, filter: 'all', query: '',
  sort: { key: null, dir: 1 }, menuFor: null, panelOpen: window.innerWidth >= 1180, help: false, toast: null, lyricsFailed: null, aligning: null, modelPct: null,
}));

const get = useStore.getState;
const set = useStore.setState;
// Id -> track index, rebuilt only when the tracks array changes (lookups run on every playback tick).
let index: { tracks: Track[]; map: Map<string, Track> } | null = null;
export const byId = (id: string | null) => {
  const tracks = get().tracks;
  if (index?.tracks !== tracks) index = { tracks, map: new Map(tracks.map(t => [t.id, t])) };
  return id ? index.map.get(id) : undefined;
};

let toastTimer = 0;
export function toast(msg: string, undo?: () => void) {
  clearTimeout(toastTimer);
  set({ toast: { msg, undo, id: Date.now() } });
  toastTimer = window.setTimeout(() => set({ toast: null }), undo ? 4500 : 2600);
}
export function undoToast() {
  const f = get().toast?.undo;
  clearTimeout(toastTimer);
  set({ toast: null });
  f?.();
}

export function nav(to: { view: View; plId?: string; filter?: Filter }) {
  set(s => ({
    view: to.view, plId: to.plId ?? null, filter: to.filter ?? (to.view === 'library' ? s.filter : 'all'),
    menuFor: null, sort: { key: null, dir: 1 },
    ...(s.w < 1180 ? { panelOpen: false } : {}),
  }));
}

// ---------- playback ----------
export const start = (id: string, extra: Partial<State> = {}) =>
  set(s => ({ cur: id, pos: 0, playing: true, seq: s.seq + 1, ...extra }));

export function togglePlay() {
  if (byId(get().cur)) set(s => ({ playing: !s.playing }));
}

export function playFrom(id: string, ids: string[], ctx: string) {
  if (get().cur === id) return togglePlay();
  start(id, { queue: ids, ctx });
}

const ctxQueue = () => get().queue.filter(id => byId(id));

/** Whether skip(1) would land on a track (used to arm crossfades). */
export function hasNext() {
  const s = get(), q = ctxQueue();
  return s.upNext.some(id => byId(id)) || s.repeat === 'all' || (s.shuffle && q.length > 1) || q.indexOf(s.cur!) < q.length - 1;
}

export function skip(dir: 1 | -1) {
  const s = get();
  const up = s.upNext.filter(id => byId(id));
  if (dir > 0 && up.length) return start(up[0], { upNext: up.slice(1) });
  const q = ctxQueue();
  if (!q.length) return;
  const idx = q.indexOf(s.cur!);
  let ni: number;
  if (s.shuffle && dir > 0 && q.length > 1) { do ni = Math.floor(Math.random() * q.length); while (ni === idx); }
  else ni = idx + dir;
  if (ni >= q.length) {
    if (s.repeat === 'all') ni = 0;
    else return set(x => ({ playing: false, pos: 0, seq: x.seq + 1 }));
  }
  if (ni < 0) ni = s.repeat === 'all' ? q.length - 1 : 0;
  start(q[ni]);
}

export const SPEED_MIN = 1, SPEED_MAX = 2.5;
export const setSpeed = (v: number) => setSet('speed', Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) * 100) / 100);

export const cycleRepeat = () => set(s => ({ repeat: ({ off: 'all', all: 'one', one: 'off' } as const)[s.repeat] }));
export const setVol = (v: number) => set({ vol: Math.min(1, Math.max(0, v)), muted: false });
export const volBy = (d: number) => set(s => ({ vol: Math.min(1, Math.max(0, (s.muted ? 0 : s.vol) + d)), muted: false }));

export function like(id: string | null) {
  const t = byId(id);
  if (!t) return;
  set(s => ({ tracks: s.tracks.map(x => (x.id === id ? { ...x, liked: !x.liked } : x)) }));
  toast(t.liked ? 'Removed from Liked' : 'Saved to Liked');
}

// ---------- library ----------
export function deleteTrack(t: Track) {
  const s = get();
  const snap = { tracks: s.tracks, playlists: s.playlists, cur: s.cur, upNext: s.upNext };
  set(x => ({
    menuFor: null, tracks: x.tracks.filter(y => y.id !== t.id), upNext: x.upNext.filter(y => y !== t.id),
    playlists: x.playlists.map(y => ({ ...y, ids: y.ids.filter(z => z !== t.id) })),
    ...(x.cur === t.id ? { playing: false, pos: 0, seq: x.seq + 1, cur: x.tracks.find(y => y.id !== t.id)?.id ?? null } : {}),
  }));
  toast(`Deleted "${t.title}"`, () => set(snap));
  // The file goes once the undo window has passed, unless undone or shared with another entry.
  setTimeout(() => {
    const ts = get().tracks;
    if (!ts.some(x => x.id === t.id || x.file === t.file)) invoke('delete_file', { path: t.file });
  }, 5000);
}

export function newPlaylist(withTrack?: string) {
  const id = 'p' + Date.now();
  const n = get().playlists.length + 1;
  set(s => ({ playlists: [...s.playlists, { id, name: 'Playlist ' + n, ids: withTrack ? [withTrack] : [] }], query: '' }));
  nav({ view: 'playlist', plId: id });
}

export function togglePl(p: Playlist, trackId: string) {
  const has = p.ids.includes(trackId);
  set(x => ({ playlists: x.playlists.map(y => (y.id !== p.id ? y : { ...y, ids: has ? y.ids.filter(z => z !== trackId) : [...y.ids, trackId] })) }));
  toast(has ? `Removed from ${p.name}` : `Added to ${p.name}`);
}

export function removeFromPl(pid: string, trackId: string) {
  const pl = get().playlists.find(p => p.id === pid);
  if (!pl) return;
  const before = pl.ids;
  set(x => ({ menuFor: null, playlists: x.playlists.map(y => (y.id !== pid ? y : { ...y, ids: y.ids.filter(z => z !== trackId) })) }));
  toast(`Removed from ${pl.name}`, () => set(x => ({ playlists: x.playlists.map(y => (y.id !== pid ? y : { ...y, ids: before })) })));
}

export function deletePl(pid: string) {
  const snap = get().playlists, pl = snap.find(p => p.id === pid);
  if (!pl) return;
  set(x => ({ playlists: x.playlists.filter(y => y.id !== pid) }));
  nav({ view: 'library', filter: 'all' });
  toast(`Deleted ${pl.name}`, () => set({ playlists: snap }));
}

export function setSet<K extends keyof Settings>(k: K, v: Settings[K]) {
  set(s => ({ set: { ...s.set, [k]: v } }));
  if (k === 'startup') (v ? enableAutostart() : disableAutostart()).catch(() => toast('Could not change startup setting'));
}

// ---------- lyrics ----------
let back: { view: View; plId?: string; filter: Filter } | null = null;
export function toggleLyrics() {
  const s = get();
  if (s.view === 'lyrics') return nav(back ?? { view: 'library', filter: 'all' });
  back = { view: s.view, plId: s.plId ?? undefined, filter: s.filter };
  nav({ view: 'lyrics' });
}

const lyricsInFlight = new Set<string>();
export async function ensureLyrics(id: string | null, force = false) {
  const t = byId(id);
  if (!t || lyricsInFlight.has(t.id) || (!force && t.lyrics !== undefined)) return;
  lyricsInFlight.add(t.id);
  set(s => ({ lyricsFailed: s.lyricsFailed === t.id ? null : s.lyricsFailed, tracks: force ? s.tracks.map(x => (x.id === t.id ? { ...x, lyrics: undefined } : x)) : s.tracks }));
  try {
    const lyrics = await invoke<Lyrics | null>('lyrics', { title: t.title, artist: t.artist, dur: t.dur });
    set(s => ({ tracks: s.tracks.map(x => (x.id === t.id ? { ...x, lyrics } : x)) }));
  } catch {
    set({ lyricsFailed: t.id });
  } finally {
    lyricsInFlight.delete(t.id);
  }
  ensureAligned(t.id);
}

/** LRCLIB timings often belong to another edit of the song; re-time them against the file itself (once). */
const aligned = new Set<string>();
export async function ensureAligned(id: string | null) {
  const t = byId(id);
  const l = t?.lyrics;
  if (!t || !l?.lines.length || l.aligned !== undefined || !get().set.syncLyrics || aligned.has(t.id)) return;
  aligned.add(t.id);
  set({ aligning: t.id });
  try {
    const lines = await invoke<Lyrics['lines'] | null>('align_lyrics', { path: t.file, lines: l.lines, dur: t.dur });
    set(s => ({ tracks: s.tracks.map(x => (x.id === t.id && x.lyrics ? { ...x, lyrics: { ...x.lyrics, lines: lines ?? x.lyrics.lines, aligned: !!lines } } : x)) }));
  } catch (e) {
    console.error('lyrics sync failed', e);
    aligned.delete(t.id); // try again next time it plays
  } finally {
    set(s => ({ aligning: s.aligning === t.id ? null : s.aligning, modelPct: null }));
  }
}

// ---------- downloads ----------
export function addLinks(urls: string[]) {
  const s = get();
  const known = new Set([...s.tracks.map(t => t.url), ...s.jobs.map(j => j.url)]);
  const fresh = s.set.skipDupes ? [...new Set(urls)].filter(u => !known.has(u)) : urls;
  const skipped = urls.length - fresh.length;
  set({ query: '' });
  if (!fresh.length) return toast(urls.length > 1 ? 'All of those are already in your library' : 'Already in your library. Skipped.');
  invoke('add_jobs', { urls: fresh });
  const dup = skipped ? ` · ${skipped} duplicate skipped` : '';
  toast(fresh.length > 1 ? `Pouring ${fresh.length} links${dup}` : `Pouring from ${SRC[srcOf(fresh[0])!].label}${dup}`);
}

export const jobCmd = (cmd: 'pause_job' | 'resume_job' | 'cancel_job' | 'retry_job', id: string) => invoke(cmd, { id });
export const retryFailed = () => invoke('retry_failed');
export const clearFinished = () => invoke('clear_finished');

// ---------- persistence + backend bridge ----------
const PERSIST = ['tracks', 'playlists', 'set', 'vol', 'muted', 'shuffle', 'repeat', 'cur', 'queue', 'ctx'] as const;

export async function boot() {
  try {
    setMediaBase(await invoke<string>('media_base'));
    const raw = await invoke<string | null>('load_db');
    const saved = raw ? JSON.parse(raw) : {};
    set({ ...saved, set: { ...DEFAULT_SET, ...saved.set } });
  } catch (e) {
    console.error('load failed', e);
  }
  set({ hydrated: true });

  const configure = () => {
    const { set: st, tracks } = get();
    invoke('configure', {
      cfg: { folder: st.folder, format: st.format, bitrate: st.bitrate, parallel: st.parallel, autotag: st.autotag,
        skipDupes: st.skipDupes, closeToTray: st.tray, known: tracks.map(t => t.url) },
    });
  };
  configure();

  ensureLyrics(get().cur);
  ensureAligned(get().cur);
  useStore.subscribe((s, prev) => {
    if (s.cur !== prev.cur) { ensureLyrics(s.cur); ensureAligned(s.cur); }
    if (s.set.syncLyrics && !prev.set.syncLyrics) ensureAligned(s.cur);
  });
  listen<number>('sync-model', e => set({ modelPct: e.payload < 100 ? e.payload : null }));

  let saveTimer = 0;
  useStore.subscribe((s, prev) => {
    if (!PERSIST.some(k => s[k] !== prev[k])) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const snap = Object.fromEntries(PERSIST.map(k => [k, get()[k]]));
      invoke('save_db', { json: JSON.stringify(snap) }).catch(e => console.error('save failed', e));
      configure();
    }, 400);
  });

  listen<Job[]>('jobs', e => set({ jobs: [...e.payload].reverse() }));
  listen<Omit<Track, 'liked' | 'hue'>>('track-added', e => {
    const t: Track = { ...e.payload, liked: false, hue: Math.floor(Math.random() * 360) };
    set(s => ({ tracks: [t, ...s.tracks], queue: s.ctx === 'lib' ? [t.id, ...s.queue] : s.queue }));
    if (get().set.notify) toast(`"${t.title}" is in your library`);
  });
  listen('job-failed', () => toast('A download failed. Retry it in Downloads.'));
  listen<string>('tray', e => (e.payload === 'next' ? skip(1) : togglePlay()));
}
