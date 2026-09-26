export type Src = 'yt' | 'sc' | 'sp';

export const SRC: Record<Src, { label: string; short: string }> = {
  yt: { label: 'YouTube', short: 'YT' },
  sc: { label: 'SoundCloud', short: 'SC' },
  sp: { label: 'Spotify', short: 'SP' },
};

export const WAVE_N = 72;

export const fmt = (s: number) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

export const art = (h: number) => `oklch(0.37 0.07 ${h})`;

export const letterOf = (t: string) => ((t || '').match(/[\p{L}\p{N}]/u) || ['·'])[0].toUpperCase();

export const srcOf = (q: string): Src | null => {
  if (/(youtube\.com|youtu\.be)/i.test(q)) return 'yt';
  if (/soundcloud\.com/i.test(q)) return 'sc';
  if (/(spotify\.com|^spotify:)/i.test(q)) return 'sp';
  return null;
};

/** Every YouTube / SoundCloud / Spotify link in a blob of text (split on whitespace or commas). */
export const links = (q: string) =>
  (q || '')
    .split(/[\s,]+/)
    .map(x => x.trim())
    .filter(x => x && srcOf(x))
    .map(x => (/^(https?:|spotify:)/i.test(x) ? x : 'https://' + x));

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const addedLabel = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const totalMin = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl ';

/** Local files are served by the app's loopback media server (WebKitGTK can't stream asset:// audio). */
let mediaBase = '';
export const setMediaBase = (b: string) => { mediaBase = b; };
export const mediaUrl = (path: string) => mediaBase + encodeURIComponent(path);
