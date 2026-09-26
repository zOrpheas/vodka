import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import c from './ui.module.css';
import { SRC, addedLabel, art, fmt, links, pad2, totalMin, type Src } from './lib';
import {
  useStore, nav, playFrom, like, toast, deleteTrack, newPlaylist, togglePl, removeFromPl, deletePl, start,
  type Track, type Playlist,
} from './store';
import { Eq, Heart, SmallPlay, Tile } from './bits';

const set = useStore.setState;

export const mosaic = (p: Playlist, byId: Map<string, Track>) => {
  const a = p.ids.map(i => byId.get(i)).filter(Boolean).slice(0, 4).map(t => art(t!.hue));
  while (a.length < 4) a.push(a.length % 3 === 0 ? '#1b1e22' : '#15171a');
  return a;
};

export function TrackView() {
  const s = useStore(useShallow(x => ({
    tracks: x.tracks, playlists: x.playlists, view: x.view, plId: x.plId, filter: x.filter, query: x.query, sort: x.sort,
    cur: x.cur, playing: x.playing, menuFor: x.menuFor, w: x.w, panelOpen: x.panelOpen, hydrated: x.hydrated,
  })));
  const [menuUp, setMenuUp] = useState(false);
  const wide = s.w >= 860, docked = s.w >= 1180;
  const mid = s.w < 1100 || (s.panelOpen && docked && s.w < 1400);
  const byId = useMemo(() => new Map(s.tracks.map(t => [t.id, t])), [s.tracks]);
  const pl = s.view === 'playlist' ? s.playlists.find(p => p.id === s.plId) : undefined;
  const isPl = !!pl;
  const q = s.query.trim();
  const search = links(q).length ? '' : q.toLowerCase();

  let base = pl ? (pl.ids.map(i => byId.get(i)).filter(Boolean) as Track[]) : s.tracks;
  if (!pl && s.filter === 'liked') base = base.filter(t => t.liked);
  else if (!pl && s.filter !== 'all') base = base.filter(t => t.src === s.filter);
  let list = search ? base.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(search)) : base;
  const { key, dir } = s.sort;
  if (key) list = [...list].sort((a, b) => key === 'title' ? dir * a.title.localeCompare(b.title) : key === 'dur' ? dir * (a.dur - b.dur) : dir * (a.added - b.added));
  const ids = list.map(t => t.id);
  const ctx = pl ? pl.id : s.filter === 'liked' ? 'liked' : 'lib';

  const eyebrow = search
    ? `${list.length} result${list.length === 1 ? '' : 's'} for "${q}"`
    : `${list.length} track${list.length === 1 ? '' : 's'} · ${totalMin(list.reduce((a, t) => a + t.dur, 0))}`;
  const cols = wide ? (mid ? '26px minmax(0,1fr) 34px 28px 44px 28px' : '26px minmax(0,1fr) 34px 70px 28px 44px 28px') : 'minmax(0,1fr) 28px 40px 28px';

  const playAll = (shuffle: boolean) => () => {
    if (!ids.length) return;
    const first = shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
    start(first, { queue: ids, ctx, ...(shuffle ? { shuffle: true } : {}) });
  };
  const sortBy = (k: 'title' | 'added' | 'dur') => () => {
    const first = k === 'added' ? -1 : 1;
    set(x => ({ sort: x.sort.key !== k ? { key: k, dir: first } : x.sort.dir === first ? { key: k, dir: (-first) as 1 | -1 } : { key: null, dir: 1 } }));
  };
  const arrow = (k: string) => (key === k ? (dir > 0 ? '↑' : '↓') : '');
  const sortCls = (k: string) => `${c.sortBtn} ${key === k ? c.on : ''}`;

  const counts: Record<string, number> = { all: s.tracks.length, liked: s.tracks.filter(t => t.liked).length };
  (Object.keys(SRC) as Src[]).forEach(k => (counts[k] = s.tracks.filter(t => t.src === k).length));
  const h1 = wide ? '76px' : '48px';

  return (
    <div style={{ ['--h1' as string]: h1 }}>
      {!isPl && (
        <>
          <div className={c.head}>
            <div style={{ minWidth: 0 }}>
              <div className={c.eyebrow}>{eyebrow}</div>
              <h1 className={`${c.display} ${c.h1}`}>{s.filter === 'liked' ? 'Liked' : 'Library'}</h1>
            </div>
            <div className={c.btnRow}>
              <button className={c.outline} onClick={playAll(true)}>SHUFFLE</button>
              <button className={c.primary} onClick={playAll(false)}><SmallPlay />Play all</button>
            </div>
          </div>
          <div className={c.tabs}>
            {(['all', 'liked', 'yt', 'sc', 'sp'] as const).map(k => (
              <button key={k} className={`${c.tab} ${s.filter === k ? c.on : ''}`} onClick={() => nav({ view: 'library', filter: k })}>
                {k === 'all' ? 'All' : k === 'liked' ? 'Liked' : SRC[k].label}<span>{counts[k]}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {pl && (
        <div className={c.plHeader}>
          <div className={c.mosaic} style={{ width: wide ? 150 : 110, height: wide ? 150 : 110 }}>
            {mosaic(pl, byId).map((m, i) => <div key={i} style={{ background: m }} />)}
          </div>
          <div className={c.plInfo}>
            <div className={c.eyebrow}>Playlist · {eyebrow}</div>
            <input className={`${c.display} ${c.plInput}`} value={pl.name} spellCheck={false} title="Click to rename"
              onChange={e => { const v = e.target.value; set(x => ({ playlists: x.playlists.map(y => (y.id === pl.id ? { ...y, name: v } : y)) })); }}
              onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={() => !pl.name.trim() && set(x => ({ playlists: x.playlists.map(y => (y.id === pl.id ? { ...y, name: 'Untitled playlist' } : y)) }))} />
            <div className={c.plBtns}>
              <button className={c.primary} onClick={playAll(false)}><SmallPlay />Play</button>
              <button className={c.outline} onClick={playAll(true)}>SHUFFLE</button>
              <button className={c.outline} onClick={() => { set(x => ({ upNext: [...x.upNext, ...ids] })); toast(`${ids.length} tracks queued`); }}>+ QUEUE</button>
              <button className={c.delText} onClick={() => deletePl(pl.id)}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      {wide && (
        <div className={c.thead} style={{ gridTemplateColumns: cols }}>
          <span>No.</span>
          <button className={sortCls('title')} onClick={sortBy('title')}>Title {arrow('title')}</button>
          <span>Src</span>
          {!mid && <button className={sortCls('added')} onClick={sortBy('added')}>Added {arrow('added')}</button>}
          <span />
          <button className={sortCls('dur')} style={{ justifySelf: 'end' }} onClick={sortBy('dur')}>{arrow('dur')} Len</button>
          <span />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!s.hydrated && Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={c.row} style={{ gridTemplateColumns: cols }}>
            {wide && <span className={c.skel} style={{ width: 14, height: 9 }} />}
            <div className={c.titleCell}>
              <span className={c.skel} style={{ width: 38, height: 38, animationDelay: `${i * 0.05}s` }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className={c.skel} style={{ width: '38%', height: 11 }} />
                <span className={c.skel} style={{ width: '20%', height: 9, animationDelay: '.15s' }} />
              </div>
            </div>
          </div>
        ))}
        {list.map((t, i) => {
          const isCur = t.id === s.cur, open = s.menuFor === t.id;
          const sp = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
          const likeColor = t.liked ? (isCur ? '#0c0d0f' : '#eceef1') : isCur ? 'rgba(0,0,0,.2)' : '#2c3036';
          const openMenu = (e: React.MouseEvent) => {
            e.preventDefault(); e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).closest(`.${c.row}`)!.getBoundingClientRect();
            setMenuUp(r.bottom > window.innerHeight - 420 && r.top > 420);
            set({ menuFor: open && e.type === 'click' ? null : t.id });
          };
          return (
            <div key={t.id} className={`${c.row} ${isCur ? c.cur : ''} ${open ? c.open : ''}`} style={{ gridTemplateColumns: cols }}
              onClick={() => playFrom(t.id, ids, ctx)} onContextMenu={openMenu}>
              {wide && <div className={c.num}>{isCur ? <Eq playing={s.playing} /> : pad2(i + 1)}</div>}
              <div className={c.titleCell}>
                <Tile t={t} size={38} letter={40} />
                <div style={{ minWidth: 0 }}>
                  <div className={`${c.tTitle} ${c.ell}`}>{t.title}</div>
                  <div className={c.tArtist}>
                    {!wide && <span className={c.inlineSrc}>{SRC[t.src].short}</span>}
                    <span className={c.ell}>{t.artist}</span>
                  </div>
                </div>
              </div>
              {wide && <span className={c.srcTag} title={SRC[t.src].label}>{SRC[t.src].short}</span>}
              {wide && !mid && <div className={c.cellMono}>{addedLabel(t.added)}</div>}
              <button className={c.heart} style={{ color: likeColor }} title={t.liked ? 'Remove from Liked' : 'Save to Liked'} onClick={sp(() => like(t.id))}><Heart /></button>
              <div className={c.cellMono} style={{ textAlign: 'right' }}>{fmt(t.dur)}</div>
              <button className={c.more} title="More (or right-click)" onClick={openMenu}>···</button>
              {open && (
                <div className={`${c.menu} ${menuUp ? c.up : ''}`} onClick={e => e.stopPropagation()}>
                  <button className={c.mi} onClick={() => { set(x => ({ upNext: [t.id, ...x.upNext], menuFor: null })); toast(`"${t.title}" plays next`); }}>Play next</button>
                  <button className={c.mi} onClick={() => { set(x => ({ upNext: [...x.upNext, t.id], menuFor: null })); toast('Added to queue'); }}>Add to queue</button>
                  <button className={c.mi} onClick={() => { like(t.id); set({ menuFor: null }); }}>{t.liked ? 'Remove from Liked' : 'Save to Liked'}<span className={c.mKey}>L</span></button>
                  <div className={c.mSep} />
                  <div className={c.mLabel}>Playlists</div>
                  {s.playlists.map(p => (
                    <button key={p.id} className={`${c.mi} ${c.left}`} onClick={() => togglePl(p, t.id)}>
                      <span className={c.check} style={{ background: p.ids.includes(t.id) ? 'currentColor' : 'transparent' }} />
                      <span className={c.ell}>{p.name}</span>
                    </button>
                  ))}
                  <button className={`${c.mi} ${c.left}`} style={{ fontWeight: 600 }} onClick={() => newPlaylist(t.id)}>
                    <span style={{ width: 10, textAlign: 'center', fontFamily: 'var(--mono)' }}>+</span>New playlist
                  </button>
                  <div className={c.mSep} />
                  <button className={c.mi} onClick={() => { navigator.clipboard.writeText(t.url).catch(() => {}); set({ menuFor: null }); toast('Link copied'); }}>Copy {SRC[t.src].label} link</button>
                  {pl && <button className={c.mi} onClick={() => removeFromPl(pl.id, t.id)}>Remove from this playlist</button>}
                  <button className={`${c.mi} ${c.red}`} onClick={() => deleteTrack(t)}>Delete from library</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {s.hydrated && !list.length && (
        <div className={c.empty}>
          <div className={c.display}>{search ? 'No matches' : isPl ? 'Empty playlist' : s.filter === 'liked' ? 'Nothing liked yet' : 'Nothing here yet'}</div>
          <div className={c.emptyBody}>
            {search ? 'Try another search, or paste a link to download something new.'
              : isPl ? 'Right-click any track, or use its ··· menu, to add it here.'
              : s.filter === 'liked' ? 'Hit the heart on any track, or press L while it plays.'
              : 'Paste a link in the bar above, or anywhere in the app.'}
          </div>
        </div>
      )}
    </div>
  );
}
