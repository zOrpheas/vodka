// Audio engine: two <audio> decks through Web Audio (per-deck gain for normalize + crossfade, master gain for volume).
import { invoke } from '@tauri-apps/api/core';
import { mediaUrl } from './lib';
import { useStore, byId, skip, hasNext, toast, setSet, type Track } from './store';

const ac = new AudioContext();
const master = ac.createGain();
master.connect(ac.destination);

const decks = [0, 1].map(() => {
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  const g = ac.createGain();
  const an = ac.createAnalyser(); // pre-gain tap, used to measure output delay (see measure())
  an.fftSize = 1024;
  ac.createMediaElementSource(el).connect(an).connect(g).connect(master);
  return { el, g, an, t: undefined as Track | undefined, fresh: false };
});
type Deck = (typeof decks)[number];
let active = 0;
let loaded = { cur: null as string | null, seq: -1 };
let handoff = 0; // seconds of overlap for the next load (crossfade / gapless)

const deck = () => decks[active];
const st = useStore.getState;
const trackGain = (t?: Track) => (t && st().set.normalize ? t.gain || 1 : 1);

/** Speed applies to both decks; 'preservesPitch' off gives the sped-up (higher pitch) sound. */
function applyRate(el: HTMLAudioElement) {
  const { speed, keepPitch } = st().set;
  el.defaultPlaybackRate = speed || 1;
  el.playbackRate = speed || 1;
  el.preservesPitch = keepPitch;
  (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = keepPitch;
}

function play(el: HTMLAudioElement) {
  ac.resume();
  el.play().catch(() => {});
}

// Pausing the element alone leaves ~1s of already-decoded audio queued in WebKit's Web Audio bridge,
// so the output is suspended first: silence is immediate.
function pauseNow() {
  ac.suspend();
  decks.forEach(d => d.el.pause());
}

function load(t: Track | undefined) {
  const now = ac.currentTime, from = deck();
  if (handoff) active ^= 1;
  const d = deck(), other = decks[active ^ 1];
  d.g.gain.cancelScheduledValues(now);
  if (!t) { d.el.removeAttribute('src'); d.el.load(); return; }
  d.el.src = mediaUrl(t.file);
  applyRate(d.el);
  d.el.currentTime = 0;
  d.t = t;
  d.fresh = true;
  if (handoff > 0.2) {
    d.g.gain.setValueAtTime(0, now);
    d.g.gain.linearRampToValueAtTime(trackGain(t), now + handoff);
    from.g.gain.cancelScheduledValues(now);
    from.g.gain.setValueAtTime(from.g.gain.value, now);
    from.g.gain.linearRampToValueAtTime(0, now + handoff);
    const el = from.el;
    setTimeout(() => el.pause(), handoff * 1000 + 50);
  } else {
    d.g.gain.setValueAtTime(trackGain(t), now);
    if (!handoff) other.el.pause(); // gapless lets the old deck finish its last few ms
  }
  handoff = 0;
  if (st().playing) play(d.el);
}

useStore.subscribe((s, p) => {
  if (s.cur !== loaded.cur || s.seq !== loaded.seq) {
    loaded = { cur: s.cur, seq: s.seq };
    load(byId(s.cur));
  } else if (s.playing !== p.playing) {
    if (s.playing) play(deck().el);
    else pauseNow();
  }
  if (s.vol !== p.vol || s.muted !== p.muted) master.gain.value = s.muted ? 0 : s.vol;
  if (s.set.normalize !== p.set.normalize) deck().g.gain.value = trackGain(byId(s.cur));
  if (s.set.speed !== p.set.speed || s.set.keepPitch !== p.set.keepPitch) decks.forEach(d => applyRate(d.el));
});

export function initEngine() {
  const s = st();
  master.gain.value = s.muted ? 0 : s.vol;
  loaded = { cur: s.cur, seq: s.seq };
  useStore.setState({ playing: false });
  load(byId(s.cur));

  decks.forEach((d, i) => {
    d.el.addEventListener('playing', () => {
      if (d.fresh) { d.fresh = false; measure(d); }
    });
    d.el.addEventListener('ended', () => {
      if (i !== active) return;
      if (st().repeat === 'one') { d.el.currentTime = 0; play(d.el); return; }
      skip(1);
    });
    d.el.addEventListener('error', async () => {
      if (i !== active || !d.el.getAttribute('src')) return;
      useStore.setState({ playing: false });
      const missing = await fetch(d.el.src, { method: 'HEAD' }).then(r => r.status === 404, () => false);
      toast(missing ? 'File is missing. Delete it and paste the link again.' : 'Could not play this file');
    });
  });

  mediaKeys();
  lat = s.set.syncLatency ? [s.set.syncLatency] : [];
  latency = s.set.syncLatency || 0;
  fillOnsets();

  setInterval(() => {
    const s = st(), el = deck().el;
    if (!s.playing || dragging) return;
    useStore.setState({ pos: el.currentTime });
    // Arm the handoff to the next track a little early for crossfade / gapless.
    const left = (el.duration - el.currentTime) / (el.playbackRate || 1), cf = s.set.crossfade; // real seconds
    const fade = cf > 0 && el.duration > cf * 2 && left <= cf;
    // ponytail: HTML audio can't schedule sample-accurate starts, so "gapless" overlaps the last ~150ms instead of true gapless.
    const gapless = !cf && s.set.gapless && left <= 0.15;
    if (!isFinite(left) || s.repeat === 'one' || !(fade || gapless) || !hasNext()) return;
    handoff = fade ? left : 0.01;
    skip(1);
  }, 100);
}

let dragging = false;
export const setDragging = (v: boolean) => { dragging = v; };

export function seek(sec: number) {
  const t = byId(st().cur);
  if (!t) return;
  const dur = deck().el.duration || t.dur;
  sec = Math.min(dur - 0.5, Math.max(0, sec));
  deck().el.currentTime = sec;
  useStore.setState({ pos: sec });
}
export const seekBy = (d: number) => seek(st().pos + d);
export const prev = () => (st().pos > 3 ? seek(0) : skip(-1));

// ---------- sync ----------
// WebKitGTK queues decoded audio between <audio> and Web Audio and reports outputLatency as 0, so what you
// hear trails el.currentTime. Each fresh track start measures that gap: the tap sees the first audible sample
// (whose file position, t.onset, we know) arrive while currentTime has already moved on.
const LOUD = 0.02; // same threshold as dl.rs onset_of
let lat: number[] = [];
let latency = 0;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function measure(d: Deck) {
  const t = byId(d.t?.id ?? null);
  const from = t?.onset;
  if (!t || from == null || d.el.currentTime > from + 0.25) return;
  const buf = new Float32Array(d.an.fftSize), t0 = performance.now();
  const probe = () => {
    if (d.el.paused || d.t?.id !== t.id || performance.now() - t0 > 4000) return;
    d.an.getFloatTimeDomainData(buf);
    if (!buf.some(x => Math.abs(x) > LOUD)) { requestAnimationFrame(probe); return; }
    const l = (d.el.currentTime - from) / (d.el.playbackRate || 1); // queue length in real seconds
    if (!(l >= 0 && l < 3)) return;
    lat = [...lat.slice(-6), l];
    latency = median(lat);
    if (Math.abs(latency - st().set.syncLatency) > 0.02) setSet('syncLatency', Math.round(latency * 1000) / 1000);
  };
  requestAnimationFrame(probe);
}

/** Onsets for tracks imported before they were measured at download time. */
async function fillOnsets() {
  for (const t of st().tracks.filter(x => x.onset == null)) {
    const onset = await invoke<number>('onset', { path: t.file }).catch(() => null);
    if (onset != null) useStore.setState(s => ({ tracks: s.tracks.map(x => (x.id === t.id ? { ...x, onset } : x)) }));
  }
}

/** Position in the current track that is actually coming out of the speakers right now. */
export const heardTime = () => Math.max(0, deck().el.currentTime - latency * (deck().el.playbackRate || 1));
export const syncLatency = () => latency;

/** OS media keys / now-playing widgets (where the webview supports the Media Session API). */
function mediaKeys() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const h: [MediaSessionAction, () => void][] = [
    ['play', () => useStore.setState({ playing: true })],
    ['pause', () => useStore.setState({ playing: false })],
    ['nexttrack', () => skip(1)],
    ['previoustrack', prev],
  ];
  h.forEach(([a, f]) => { try { ms.setActionHandler(a, f); } catch { /* unsupported action */ } });
  useStore.subscribe((s, p) => {
    if (s.playing !== p.playing) ms.playbackState = s.playing ? 'playing' : 'paused';
    if (s.cur === p.cur && s.tracks === p.tracks) return;
    const t = byId(s.cur);
    ms.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist, artwork: t.art ? [{ src: mediaUrl(t.art) }] : [] }) : null;
  });
}
