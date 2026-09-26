import { useState } from 'react';
import c from './ui.module.css';
import { art, letterOf, mediaUrl } from './lib';
import type { Track } from './store';

export const Heart = ({ w = 14, h = 13 }) => (
  <svg width={w} height={h} viewBox="0 0 14 13"><path d="M7 13L1.2 7.2A3.6 3.6 0 0 1 7 2.4a3.6 3.6 0 0 1 5.8 4.8z" fill="currentColor" /></svg>
);
export const X = ({ size = 10, sw = 1.6 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth={sw} /></svg>
);
export const PlayIcon = () => <svg width="13" height="14" viewBox="0 0 13 14"><path d="M1 0l12 7-12 7z" fill="currentColor" /></svg>;
export const PauseIcon = () => (
  <svg width="12" height="14" viewBox="0 0 12 14"><rect x="0" y="0" width="4" height="14" fill="currentColor" /><rect x="8" y="0" width="4" height="14" fill="currentColor" /></svg>
);
export const SmallPlay = () => <svg width="11" height="12" viewBox="0 0 11 12"><path d="M0 0l11 6-11 6z" fill="currentColor" /></svg>;
export const PrevIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14"><rect x="0" y="0" width="2.5" height="14" fill="currentColor" /><path d="M14 0L3 7l11 7z" fill="currentColor" /></svg>
);
export const NextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M0 0l11 7-11 7z" fill="currentColor" /><rect x="11.5" y="0" width="2.5" height="14" fill="currentColor" /></svg>
);

const EQ_H = [0.5, 1, 0.7];
export const Eq = ({ playing }: { playing: boolean }) => (
  <span className={c.eq}>
    {EQ_H.map((h, i) => (
      <span key={i} style={playing ? { animation: `vk-eq ${0.7 + i * 0.18}s ease-in-out ${-i * 0.3}s infinite alternate` } : { transform: `scaleY(${h})` }} />
    ))}
  </span>
);

/** Flat color + letter, with the real cover on top when there is one. */
export function Tile({ t, size, letter, className = c.tile, children }: { t?: Track; size?: number; letter: number; className?: string; children?: React.ReactNode }) {
  const [bad, setBad] = useState<string | null>(null);
  const src = t?.art && bad !== t.art ? mediaUrl(t.art) : null;
  return (
    <div className={className} style={{ width: size, height: size, background: t ? art(t.hue) : '#1b1e22' }}>
      <span style={{ fontSize: letter }}>{t ? letterOf(t.title) : ''}</span>
      {src && <img src={src} alt="" onError={() => setBad(t!.art!)} />}
      {children}
    </div>
  );
}
