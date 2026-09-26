import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import c from './ui.module.css';
import { useStore, ensureLyrics, setSet } from './store';
import { seek, heardTime, syncLatency } from './engine';

// Light a line up a hair before it is sung: the eye needs a moment, and the color fades in over .2s.
const LEAD = 0.12;

const fmtOffset = (o: number) => (o > 0 ? '+' : o < 0 ? '−' : '') + Math.abs(o).toFixed(2) + 's';

export function LyricsView() {
  const s = useStore(useShallow(x => ({
    t: x.tracks.find(t => t.id === x.cur), w: x.w, offset: x.set.lyricsNudge, failed: x.lyricsFailed, measured: x.set.syncLatency, aligning: x.aligning, modelPct: x.modelPct,
  })));
  const { t, offset } = s;
  const lines = t?.lyrics?.lines ?? [];

  // Follow the audio every frame (not the 10 Hz store position), re-rendering only when the line changes.
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const at = heardTime() - offset + LEAD;
      let i = -1;
      while (i + 1 < lines.length && lines[i + 1].t <= at) i++;
      setIdx(i);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [lines, offset]);

  // Keep the current line centered, unless the user scrolled in the last few seconds.
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const manual = useRef(0);
  useEffect(() => {
    if (idx < 0 || Date.now() - manual.current < 4000) return;
    refs.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx, t?.id]);

  const wide = s.w >= 860;
  const failed = t && s.failed === t.id;
  const synced = lines.length > 0;
  const matching = t && s.aligning === t.id;
  const status = matching ? (s.modelPct != null ? ` · downloading sync model ${s.modelPct}%` : ' · matching to your file') : t?.lyrics?.aligned ? ' · matched to your file' : '';
  const eyebrow = !t ? 'Lyrics' : synced ? `Synced lyrics · ${t.artist}${status}` : t.lyrics?.plain ? `Lyrics · not synced · ${t.artist}` : `Lyrics · ${t.artist}`;
  const nudge = (d: number) => setSet('lyricsNudge', Math.round((offset + d) * 100) / 100);

  const empty = (title: string, body: string, retry = false) => (
    <div className={c.empty} style={{ borderBottom: 0, paddingLeft: 0 }}>
      <div className={c.display}>{title}</div>
      <div className={c.emptyBody}>{body}</div>
      {retry && <button className={c.outline} style={{ marginTop: 16 }} onClick={() => ensureLyrics(t!.id, true)}>SEARCH AGAIN</button>}
    </div>
  );

  return (
    <div style={{ ['--h1' as string]: wide ? '48px' : '34px', ['--lyric' as string]: wide ? '30px' : '22px' }} onWheel={() => (manual.current = Date.now())} onTouchMove={() => (manual.current = Date.now())}>
      <div className={c.head}>
        <div style={{ minWidth: 0 }}>
          <div className={c.eyebrow}>{eyebrow}</div>
          <h1 className={`${c.display} ${c.h1}`} style={{ lineHeight: 0.9 }}>{t ? t.title : 'Lyrics'}</h1>
        </div>
        {synced && (
          <div className={c.ctl} title={`Vodka measures your audio delay automatically (now ${syncLatency().toFixed(2)}s). Still ahead of the music? Press LATER. Behind? Press EARLIER.`}>
            <button className={c.seg} onClick={() => nudge(-0.25)}>EARLIER</button>
            <span className={c.stepVal} style={{ minWidth: 64, fontSize: 10.5 }}>{fmtOffset(offset)}</span>
            <button className={c.seg} onClick={() => nudge(0.25)}>LATER</button>
          </div>
        )}
      </div>

      {!t ? empty('Nothing playing', 'Play a track and its lyrics show up here, in time with the music.')
        : failed ? empty("Couldn't reach lyrics", 'Check your internet connection and try again.', true)
        : t.lyrics === undefined ? (
          <div className={c.lyrics}>
            {[62, 48, 70, 40, 56].map((w, i) => <span key={i} className={c.skel} style={{ width: `${w}%`, height: wide ? 26 : 20, animationDelay: `${i * 0.1}s` }} />)}
          </div>
        )
        : t.lyrics === null ? empty('No lyrics found', "LRCLIB doesn't have lyrics for this track yet.", true)
        : t.lyrics.instrumental ? empty('Instrumental', 'This track has no vocals.')
        : synced ? (
          <div className={c.lyrics}>
            {lines.map((l, i) => (
              <button key={i} ref={el => { refs.current[i] = el; }}
                className={`${c.lyric} ${i === idx ? c.now : i < idx ? c.past : ''} ${l.text ? '' : c.gap}`}
                onClick={() => { manual.current = 0; seek(l.t + offset); }}>
                {l.text || '···'}
              </button>
            ))}
            <div className={c.credit}>Lyrics from LRCLIB</div>
          </div>
        )
        : <div className={c.plainLyrics}>{t.lyrics.plain}<div className={c.credit}>Lyrics from LRCLIB</div></div>}
    </div>
  );
}
