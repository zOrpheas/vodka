import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import c from './ui.module.css';
import { SRC, WAVE_N, fmt, pad2 } from './lib';
import { useStore, like, togglePlay, skip, cycleRepeat, setVol, volBy, start, nav, toggleLyrics, setSpeed, setSet, SPEED_MIN, SPEED_MAX, byId as findTrack } from './store';
import { seek, prev, setDragging } from './engine';
import { Heart, NextIcon, PauseIcon, PlayIcon, PrevIcon, Tile, X } from './bits';
import { fmtLabel } from './Views';

const set = useStore.setState;

function useCur() {
  const id = useStore(s => s.cur);
  const tracks = useStore(s => s.tracks);
  return useMemo(() => tracks.find(t => t.id === id), [tracks, id]);
}

/** Pointer drag on a horizontal strip, reporting 0..1. */
function useDrag(onPos: (k: number) => void, onEnd?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const apply = (x: number) => {
      const r = ref.current!.getBoundingClientRect();
      onPos(Math.min(1, Math.max(0, (x - r.left) / r.width)));
    };
    apply(e.clientX);
    setDragging(true);
    const mv = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); setDragging(false); onEnd?.(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  return { ref, down };
}

const toSeek = (k: number) => { const t = findTrack(useStore.getState().cur); if (t) seek(k * t.dur); };

export const speedLabel = (v: number) => v.toFixed(Math.round(v * 100) % 10 ? 2 : 1) + '×';

/** "1.0×" button with a small panel: slider 1.0 to 2.5, keep-pitch switch, reset. */
function Speed() {
  const { speed, keepPitch } = useStore(useShallow(x => ({ speed: x.set.speed, keepPitch: x.set.keepPitch })));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('click', close);
    addEventListener('keydown', esc);
    return () => { removeEventListener('click', close); removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={c.speedWrap} onClick={e => e.stopPropagation()}>
      <button className={`${c.tgl} ${speed !== 1 ? c.on : ''}`} style={{ minWidth: 50 }} title="Speed ([ ])" onClick={() => setOpen(o => !o)}>{speedLabel(speed)}</button>
      {open && (
        <div className={c.speedPop}>
          <div className={c.speedHead}><span className={c.label}>SPEED</span><span className={c.speedVal}>{speedLabel(speed)}</span></div>
          <input type="range" className={c.range} style={{ width: '100%' }} min={SPEED_MIN} max={SPEED_MAX} step={0.05} value={speed}
            onChange={e => setSpeed(+e.target.value)} />
          <div className={c.speedScale}><span>1.0×</span><span>1.5×</span><span>2.0×</span><span>2.5×</span></div>
          <div className={c.speedFoot}>
            <button className={`${c.tgl} ${keepPitch ? c.on : ''}`} title="On: faster at the same pitch. Off: the 'sped up' sound." onClick={() => setSet('keepPitch', !keepPitch)}>KEEP PITCH</button>
            <button className={c.tgl} disabled={speed === 1} onClick={() => setSpeed(1)}>RESET</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlayerBar() {
  const cur = useCur();
  const s = useStore(useShallow(x => ({ pos: x.pos, playing: x.playing, shuffle: x.shuffle, repeat: x.repeat, vol: x.muted ? 0 : x.vol, panelOpen: x.panelOpen, lyrics: x.view === 'lyrics' })));
  const wave = useDrag(toSeek);
  const vol = useDrag(setVol);
  const bars = cur?.peaks?.length ? cur.peaks : Array(WAVE_N).fill(0.12);
  const frac = cur ? s.pos / cur.dur : 0;

  return (
    <footer className={c.player}>
      <div className={c.pLeft}>
        <Tile t={cur} size={48} letter={50} />
        <div style={{ minWidth: 0 }}>
          <div className={`${c.pTitle} ${c.ell}`}>{cur ? cur.title : 'Nothing playing'}</div>
          <div className={`${c.pArtist} ${c.ell}`}>{cur ? cur.artist : 'Pour something in'}</div>
        </div>
        <button className={c.heart} style={{ color: cur?.liked ? '#eceef1' : '#3b4048', flex: 'none' }} title="Like (L)" onClick={() => like(cur?.id ?? null)}><Heart /></button>
      </div>
      <div className={c.pCenter}>
        <div className={c.controls}>
          <button className={`${c.tgl} ${s.shuffle ? c.on : ''}`} style={{ marginRight: 8 }} title="Shuffle (S)" onClick={() => set(x => ({ shuffle: !x.shuffle }))}>SHUF</button>
          <button className={c.ctlBtn} title="Previous (Shift ←)" onClick={prev}><PrevIcon /></button>
          <button className={c.playBtn} title="Play / pause (Space)" onClick={togglePlay}>{s.playing ? <PauseIcon /> : <PlayIcon />}</button>
          <button className={c.ctlBtn} title="Next (Shift →)" onClick={() => skip(1)}><NextIcon /></button>
          <button className={`${c.tgl} ${s.repeat !== 'off' ? c.on : ''}`} style={{ minWidth: 52, marginLeft: 8 }} title="Repeat (R)" onClick={cycleRepeat}>
            {{ off: 'REPEAT', all: 'RPT ALL', one: 'RPT 1' }[s.repeat]}
          </button>
        </div>
        <div className={c.seekRow}>
          <span className={c.time} style={{ textAlign: 'right' }}>{fmt(s.pos)}</span>
          <div ref={wave.ref} className={c.wave} title="Seek (← →)" onPointerDown={wave.down}>
            {bars.map((h, i) => (
              <div key={i} style={{ height: (h * 100).toFixed(0) + '%', background: (i + 0.5) / bars.length <= frac ? '#eceef1' : '#2c3036' }} />
            ))}
          </div>
          <span className={c.time}>{cur ? fmt(cur.dur) : '0:00'}</span>
        </div>
      </div>
      <div className={c.pRight}>
        <Speed />
        <button className={`${c.tgl} ${s.lyrics ? c.on : ''}`} title="Lyrics (Y)" onClick={e => { e.stopPropagation(); toggleLyrics(); }}>LYRICS</button>
        <button className={`${c.tgl} ${s.panelOpen ? c.on : ''}`} title="Now playing and queue (Q)" onClick={e => { e.stopPropagation(); set(x => ({ panelOpen: !x.panelOpen })); }}>QUEUE</button>
        <button className={`${c.mute} ${s.vol === 0 ? c.red : ''}`} title="Mute (M)" onClick={() => set(x => ({ muted: !x.muted }))}>{s.vol === 0 ? 'MUTED' : 'VOL'}</button>
        <div ref={vol.ref} className={c.vol} title="Volume (↑ ↓)" onPointerDown={vol.down} onWheel={e => volBy(e.deltaY < 0 ? 0.04 : -0.04)}>
          <div className={c.volTrack}><div className={c.volFill} style={{ width: (s.vol * 100).toFixed(1) + '%' }} /></div>
        </div>
        <span className={c.volNum}>{Math.round(s.vol * 100)}</span>
      </div>
    </footer>
  );
}

export function MiniPlayer() {
  const cur = useCur();
  const s = useStore(useShallow(x => ({ pos: x.pos, playing: x.playing, view: x.view, panelOpen: x.panelOpen, jobs: x.jobs })));
  const seekDrag = useDrag(toSeek);
  const active = s.jobs.filter(j => !['done', 'failed'].includes(j.status)).length;
  const on = (v: boolean) => (v ? c.on : '');
  const go = (view: 'library' | 'playlists' | 'downloads' | 'settings') => () => nav({ view, filter: view === 'library' ? 'all' : undefined });
  return (
    <div className={c.mini}>
      <div ref={seekDrag.ref} className={c.miniSeek} onPointerDown={seekDrag.down}>
        <div className={c.miniLine}><div style={{ width: cur ? (s.pos / cur.dur * 100).toFixed(2) + '%' : '0%' }} /></div>
      </div>
      <div className={c.miniRow}>
        <Tile t={cur} size={40} letter={42} />
        <div style={{ minWidth: 0, flex: 1, paddingLeft: 8 }}>
          <div className={`${c.pTitle} ${c.ell}`}>{cur ? cur.title : 'Nothing playing'}</div>
          <div className={`${c.pArtist} ${c.ell}`} style={{ fontSize: 12 }}>{cur ? cur.artist : 'Pour something in'}</div>
        </div>
        <button className={c.bigBtn} style={{ color: cur?.liked ? '#eceef1' : '#3b4048' }} onClick={() => like(cur?.id ?? null)}><Heart w={15} h={14} /></button>
        <button className={c.playBtn} style={{ width: 44, height: 44 }} onClick={togglePlay}>{s.playing ? <PauseIcon /> : <PlayIcon />}</button>
        <button className={c.bigBtn} onClick={() => skip(1)}><NextIcon /></button>
      </div>
      <nav className={c.tabbar}>
        <button className={on(s.view === 'library')} onClick={go('library')}>LIBRARY</button>
        <button className={on(s.view === 'playlists' || s.view === 'playlist')} onClick={go('playlists')}>LISTS</button>
        <button className={on(s.panelOpen)} onClick={e => { e.stopPropagation(); set(x => ({ panelOpen: !x.panelOpen })); }}>QUEUE</button>
        <button className={on(s.view === 'lyrics')} onClick={e => { e.stopPropagation(); toggleLyrics(); }}>LYRICS</button>
        <button className={on(s.view === 'downloads')} onClick={go('downloads')}>{active ? `DL ${active}` : 'DL'}</button>
        <button className={on(s.view === 'settings')} onClick={go('settings')}>SETUP</button>
      </nav>
    </div>
  );
}

export function NowPlaying() {
  const cur = useCur();
  const s = useStore(useShallow(x => ({ tracks: x.tracks, playlists: x.playlists, upNext: x.upNext, queue: x.queue, ctx: x.ctx, repeat: x.repeat, st: x.set, w: x.w })));
  const byId = useMemo(() => new Map(s.tracks.map(t => [t.id, t])), [s.tracks]);
  const docked = s.w >= 1180, wide = s.w >= 860;

  const upIds = s.upNext.filter(id => byId.has(id));
  const cq = s.queue.filter(id => byId.has(id));
  const ci = cq.indexOf(cur?.id ?? '');
  let rest = cq.slice(ci + 1);
  if (s.repeat === 'all') rest = rest.concat(cq.slice(0, Math.max(0, ci)));
  const ctxName = s.ctx === 'lib' ? 'Library' : s.ctx === 'liked' ? 'Liked' : s.playlists.find(p => p.id === s.ctx)?.name || 'Library';
  const removeUp = (i: number) => set(x => ({ upNext: x.upNext.filter(id => byId.has(id)).filter((_, k) => k !== i) }));

  return (
    <aside className={c.panel} onClick={e => e.stopPropagation()}
      style={{ position: docked ? 'relative' : 'absolute', width: docked ? 'auto' : wide ? 320 : '100%' }}>
      <div className={c.panelHead}>
        <span className={c.label}>NOW PLAYING</span>
        <button className={c.x} style={{ width: 28, height: 28 }} title="Hide (Q)" onClick={() => set({ panelOpen: false })}><X /></button>
      </div>
      <div style={{ padding: '0 16px', flex: 'none' }}>
        <Tile t={cur} letter={300} className={c.bigArt}>
          {cur && <span className={c.corner}>{SRC[cur.src].short} · {fmtLabel(s.st).toUpperCase()}</span>}
        </Tile>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={`${c.display} ${c.npTitle}`}>{cur ? cur.title : 'Nothing playing'}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>{cur ? cur.artist : 'Pour something in'}</div>
          </div>
          <button className={c.likeBox} style={{ color: cur?.liked ? '#eceef1' : '#3b4048' }} title="Like (L)" onClick={() => like(cur?.id ?? null)}><Heart /></button>
        </div>
      </div>
      <div style={{ marginTop: 18, borderTop: '1px solid var(--line-panel)' }}>
        {upIds.length > 0 && (
          <>
            <div className={c.qHead}>
              <span className={c.label}>QUEUED · {upIds.length}</span>
              <button className={c.x} style={{ font: '700 10.5px var(--mono)' }} onClick={() => set({ upNext: [] })}>CLEAR</button>
            </div>
            {upIds.map((id, i) => {
              const t = byId.get(id)!;
              return (
                <div key={id + i} className={`${c.qRow} ${c.up}`} onClick={() => { removeUp(i); start(id); }}>
                  <span className={c.qIdx}>{pad2(i + 1)}</span>
                  <div style={{ minWidth: 0 }}><div className={`${c.qT} ${c.ell}`}>{t.title}</div><div className={`${c.qA} ${c.ell}`}>{t.artist}</div></div>
                  <button className={c.x} style={{ width: 24, height: 24, color: 'var(--dim)' }} title="Remove" onClick={e => { e.stopPropagation(); removeUp(i); }}><X size={8} sw={1.8} /></button>
                </div>
              );
            })}
          </>
        )}
        <div className={c.qHead}><span className={`${c.label} ${c.ell}`}>Then from {ctxName}</span></div>
        {rest.slice(0, 40).map((id, i) => {
          const t = byId.get(id)!;
          return (
            <div key={id} className={c.qRow} onClick={() => start(id)}>
              <span className={c.qIdx}>{pad2(upIds.length + i + 1)}</span>
              <div style={{ minWidth: 0 }}><div className={`${c.qT} ${c.ell}`}>{t.title}</div><div className={`${c.qA} ${c.ell}`}>{t.artist}</div></div>
              <span className={c.qIdx}>{fmt(t.dur)}</span>
            </div>
          );
        })}
        {!rest.length && (
          <div style={{ padding: '4px 16px 16px', fontSize: 13, color: 'var(--muted)' }}>
            {s.repeat === 'all' ? 'Nothing else here.' : 'End of list. Turn on repeat to loop.'}
          </div>
        )}
      </div>
    </aside>
  );
}
