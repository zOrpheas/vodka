import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import c from './ui.module.css';
import { MOD, SRC, art, links, srcOf } from './lib';
import { useStore, nav, newPlaylist, addLinks, toast, undoToast, togglePlay, skip, like, cycleRepeat, volBy, toggleLyrics, setSpeed } from './store';
import { LyricsView } from './Lyrics';
import { seekBy, prev } from './engine';
import { X } from './bits';
import { TrackView } from './Tracks';
import { Downloads, Playlists, SettingsView, diskSize } from './Views';
import { MiniPlayer, NowPlaying, PlayerBar } from './Player';

const set = useStore.setState;
const win = getCurrentWindow();

const SHORTCUTS = [
  ['Play / pause', 'SPACE'], ['Search or paste', MOD + 'K'], ['Next track', 'SHIFT →'], ['Previous track', 'SHIFT ←'],
  ['Seek 5s', '← →'], ['Volume', '↑ ↓'], ['Like current', 'L'], ['Now playing panel', 'Q'],
  ['Shuffle', 'S'], ['Repeat mode', 'R'], ['Mute', 'M'], ['Lyrics', 'Y'], ['Speed', '[ ]'], ['This panel', '?'],
];

function useGlobalInput(inputRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onResize = () => set({ w: window.innerWidth });
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLInputElement | null;
      const inInput = !!ae && /INPUT|TEXTAREA/.test(ae.tagName) && ae.type !== 'range';
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); inputRef.current?.focus(); return; }
      if (inInput) {
        if (e.key === 'Escape') { if (ae === inputRef.current) set({ query: '' }); ae!.blur(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight' && e.shiftKey) skip(1);
      else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
      else if (e.key === 'ArrowRight') seekBy(5);
      else if (e.key === 'ArrowLeft') seekBy(-5);
      else if (e.key === 'ArrowUp') { e.preventDefault(); volBy(0.05); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); volBy(-0.05); }
      else if (k === 'q') set(s => ({ panelOpen: !s.panelOpen }));
      else if (k === 'l') like(useStore.getState().cur);
      else if (k === 'm') set(s => ({ muted: !s.muted }));
      else if (k === 's') set(s => ({ shuffle: !s.shuffle }));
      else if (k === 'r') cycleRepeat();
      else if (k === 'y') toggleLyrics();
      else if (e.key === '[') setSpeed(useStore.getState().set.speed - 0.1);
      else if (e.key === ']') setSpeed(useStore.getState().set.speed + 0.1);
      else if (e.key === '?') set(s => ({ help: !s.help }));
      else if (e.key === 'Escape') set({ menuFor: null, help: false });
    };
    const onPaste = (e: ClipboardEvent) => {
      if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
      const l = links(e.clipboardData?.getData('text') || '');
      if (l.length) { e.preventDefault(); addLinks(l); }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const l = links(e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text') || '');
      if (l.length) addLinks(l); else toast('Not a YouTube, SoundCloud or Spotify link');
    };
    const evs = { resize: onResize, keydown: onKey, paste: onPaste, dragover: onDragOver, drop: onDrop } as unknown as Record<string, EventListener>;
    Object.entries(evs).forEach(([k, f]) => window.addEventListener(k, f));
    return () => Object.entries(evs).forEach(([k, f]) => window.removeEventListener(k, f));
  }, [inputRef]);
}

function Sidebar() {
  const s = useStore(useShallow(x => ({ tracks: x.tracks, playlists: x.playlists, jobs: x.jobs, view: x.view, filter: x.filter, plId: x.plId, st: x.set })));
  const byId = useMemo(() => new Map(s.tracks.map(t => [t.id, t])), [s.tracks]);
  const isLib = s.view === 'library';
  const active = s.jobs.filter(j => !['done', 'failed'].includes(j.status)).length;
  const failed = s.jobs.filter(j => j.status === 'failed').length;
  const item = (on: boolean, idx: string, label: string, count: React.ReactNode, go: () => void, badge = false) => (
    <button key={idx} className={`${c.navItem} ${on ? c.on : ''}`} onClick={go}>
      <span className={c.navIdx}>{idx}</span>
      <span className={c.navLabel}>{label}</span>
      {count !== null && <span className={`${c.navCount} ${badge ? c.badge : ''}`}>{count}</span>}
    </button>
  );
  return (
    <aside className={c.side}>
      <div className={c.logo}>
        <div className={c.display}>Vodka</div>
        <div className={c.sideMeta}>{s.tracks.length} tracks · {diskSize(s.tracks, s.st)}</div>
      </div>
      <nav className={c.nav}>
        {item(isLib && s.filter !== 'liked', '01', 'Library', s.tracks.length, () => nav({ view: 'library', filter: 'all' }))}
        {item(isLib && s.filter === 'liked', '02', 'Liked', s.tracks.filter(t => t.liked).length, () => nav({ view: 'library', filter: 'liked' }))}
        {item(s.view === 'downloads', '03', 'Downloads', failed ? `${active} · ${failed} ERR` : active, () => nav({ view: 'downloads' }), active > 0 || failed > 0)}
      </nav>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
        <div className={c.plHead}>
          <span>Playlists</span>
          <button className={c.newBtn} onClick={() => newPlaylist()}>+ NEW</button>
        </div>
        <div className={c.plList}>
          {s.playlists.map(p => {
            const first = p.ids.map(i => byId.get(i)).find(Boolean);
            return (
              <button key={p.id} className={`${c.navItem} ${s.view === 'playlist' && s.plId === p.id ? c.on : ''}`} onClick={() => nav({ view: 'playlist', plId: p.id })}>
                <span className={c.swatch} style={{ background: first ? art(first.hue) : '#2c3036' }} />
                <span className={`${c.plName} ${c.ell}`}>{p.name}</span>
                <span className={c.navCount} style={{ padding: 0 }}>{p.ids.filter(i => byId.has(i)).length}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className={c.sideFoot}>{item(s.view === 'settings', '04', 'Settings', null, () => nav({ view: 'settings' }))}</div>
    </aside>
  );
}

function SearchBar({ inputRef, wide }: { inputRef: React.RefObject<HTMLInputElement | null>; wide: boolean }) {
  const query = useStore(s => s.query);
  const [focused, setFocused] = useState(false);
  const q = query.trim(), qLinks = links(q);
  return (
    <div className={c.bar}>
      <form className={`${c.form} ${qLinks.length ? c.link : ''}`} onSubmit={e => { e.preventDefault(); if (qLinks.length) addLinks(qLinks); }}>
        <span className={c.mode}>{qLinks.length ? 'POUR' : 'FIND'}</span>
        <input ref={inputRef} className={c.input} value={query} spellCheck={false}
          placeholder={wide ? 'Search your library, or paste YouTube / SoundCloud / Spotify links to download' : 'Search or paste links'}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={e => {
            const v = e.target.value;
            set(x => ({ query: v, ...(!links(v).length && v.trim() && !['library', 'playlist'].includes(x.view) ? { view: 'library' as const } : {}) }));
          }} />
        {query && <button type="button" className={`${c.x} ${c.clearBtn}`} title="Clear (Esc)" onClick={() => { set({ query: '' }); inputRef.current?.focus(); }}><X /></button>}
        {qLinks.length > 0 && <button type="submit" className={c.pourBtn}>POUR {qLinks.length > 1 ? `${qLinks.length} LINKS` : SRC[srcOf(qLinks[0])!].short} ↵</button>}
        {wide && !qLinks.length && !focused && !q && <span className={c.kbd}>{MOD}K</span>}
      </form>
    </div>
  );
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  useGlobalInput(inputRef);
  const s = useStore(useShallow(x => ({
    w: x.w, view: x.view, filter: x.filter, plId: x.plId, playlists: x.playlists, panelOpen: x.panelOpen, help: x.help,
    toast: x.toast, menuFor: x.menuFor, playing: x.playing, curTitle: x.tracks.find(t => t.id === x.cur)?.title,
  })));
  const wide = s.w >= 860, docked = s.w >= 1180;
  const pl = s.view === 'playlist' ? s.playlists.find(p => p.id === s.plId) : undefined;
  const viewName = pl ? pl.name : s.view === 'library' ? (s.filter === 'liked' ? 'Liked' : 'Library')
    : { downloads: 'Downloads', playlists: 'Playlists', settings: 'Settings', lyrics: 'Lyrics' }[s.view as string] || 'Library';

  return (
    <div className={c.app} onClick={() => s.menuFor && set({ menuFor: null })} style={{ ['--pad' as string]: wide ? '24px' : '14px' }}>
      <header className={c.titlebar} data-tauri-drag-region>
        <span className={`${c.winTitle} ${c.ell}`} data-tauri-drag-region>
          Vodka · {viewName}{s.curTitle && s.playing ? `  ·  now playing ${s.curTitle}` : ''}
        </span>
        <button className={c.keysBtn} title="Keyboard shortcuts (?)" onClick={e => { e.stopPropagation(); set({ help: true }); }}>KEYS ?</button>
        <div className={c.winBtns}>
          <button className={c.winBtn} title="Minimize" onClick={() => win.minimize()}><svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg></button>
          <button className={c.winBtn} title="Maximize" onClick={() => win.toggleMaximize()}><svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg></button>
          <button className={`${c.winBtn} ${c.winClose}`} title="Close" onClick={() => win.close()}><X sw={1} /></button>
        </div>
      </header>

      <div className={c.body} style={{ gridTemplateColumns: wide ? (s.panelOpen && docked ? '216px minmax(0,1fr) 300px' : '216px minmax(0,1fr)') : 'minmax(0,1fr)' }}>
        {wide && <Sidebar />}
        <main className={c.main}>
          <SearchBar inputRef={inputRef} wide={wide} />
          <div className={c.content}>
            {(s.view === 'library' || pl) && <TrackView />}
            {s.view === 'downloads' && <Downloads />}
            {s.view === 'playlists' && <Playlists />}
            {s.view === 'settings' && <SettingsView />}
            {s.view === 'lyrics' && <LyricsView />}
          </div>
        </main>
        {s.panelOpen && <NowPlaying />}
      </div>

      {wide ? <PlayerBar /> : <MiniPlayer />}

      {s.help && (
        <div className={c.scrim} onClick={() => set({ help: false })}>
          <div className={c.modal} onClick={e => e.stopPropagation()}>
            <div className={c.modalHead}>
              <span className={c.display}>Keyboard</span>
              <button className={c.x} style={{ width: 30, height: 30 }} onClick={() => set({ help: false })}><X /></button>
            </div>
            <div className={c.keys}>
              {SHORTCUTS.map(([label, key]) => <div key={label} className={c.key}><span>{label}</span><span className={c.chip}>{key}</span></div>)}
            </div>
          </div>
        </div>
      )}

      {s.toast && (
        <div key={s.toast.id} className={c.toast} style={{ bottom: wide ? 92 : 124 }}>
          <span>{s.toast.msg}</span>
          {s.toast.undo && <button className={c.undo} onClick={undoToast}>UNDO</button>}
        </div>
      )}
    </div>
  );
}
