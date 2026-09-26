import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import c from './ui.module.css';
import { SRC, art } from './lib';
import { useStore, nav, newPlaylist, playFrom, jobCmd, retryFailed, clearFinished, setSet, setSpeed, toast, SPEED_MIN, SPEED_MAX, type Settings, type Track } from './store';
import { speedLabel } from './Player';
import { X } from './bits';
import { mosaic } from './Tracks';

export const fmtLabel = (st: Settings) => (st.format === 'FLAC' ? 'FLAC lossless' : `${st.format} ${st.bitrate}k`);

export const diskSize = (tracks: Track[], st: Settings) => {
  const mb = tracks.reduce((a, t) => a + t.dur, 0) * (st.format === 'FLAC' ? 900 : +st.bitrate) / 8 / 1024;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
};

const h1Style = (w: number) => ({ ['--h1' as string]: w >= 860 ? '76px' : '48px' });

export function Downloads() {
  const { jobs, tracks, st, w } = useStore(useShallow(s => ({ jobs: s.jobs, tracks: s.tracks, st: s.set, w: s.w })));
  const byId = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);
  const active = jobs.filter(j => !['done', 'failed'].includes(j.status)).length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const done = jobs.filter(j => j.status === 'done').length;

  return (
    <div style={h1Style(w)}>
      <div className={c.head}>
        <div>
          <div className={c.eyebrow}>{active} active · {failed} failed · {done} done</div>
          <h1 className={`${c.display} ${c.h1}`}>Downloads</h1>
        </div>
        <div className={c.btnRow}>
          {failed > 0 && <button className={c.danger} onClick={retryFailed}>RETRY FAILED</button>}
          {done > 0 && <button className={c.outline} style={{ height: 36, padding: '0 12px', fontSize: 11 }} onClick={clearFinished}>CLEAR FINISHED</button>}
        </div>
      </div>
      <div className={c.info}>
        <span>Format <b>{fmtLabel(st)}</b></span>
        <span style={{ textTransform: 'none' }}>Folder <b>{st.folder}</b></span>
        <span>Parallel <b>{st.parallel}</b></span>
        <button className={c.linkBtn} onClick={() => nav({ view: 'settings' })}>Edit</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {jobs.map(j => {
          const t = j.trackId ? byId.get(j.trackId) : undefined;
          const isDone = j.status === 'done', isFail = j.status === 'failed';
          const idle = j.status === 'waiting' || j.status === 'paused';
          const running = !isDone && !isFail && !idle;
          const status = isFail ? j.error || 'Download failed'
            : isDone ? (t ? 'In library' : 'Removed')
            : j.status === 'paused' ? 'Paused' : j.status === 'waiting' ? 'Waiting'
            : j.status === 'resolving' ? 'Resolving' : j.status === 'downloading' ? 'Downloading'
            : st.autotag ? 'Tagging' : 'Converting';
          return (
            <div key={j.id} className={`${c.job} ${isFail ? c.fail : ''}`}>
              <div className={c.jobTile} style={{ background: t ? art(t.hue) : '#1b1e22' }}>{SRC[j.source].short}</div>
              <div style={{ minWidth: 0 }}>
                {j.status === 'resolving' && !j.title ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 17 }}>
                    <span className={c.skel} style={{ width: '38%', height: 11 }} />
                    <span className={c.skel} style={{ width: '20%', height: 9, animationDelay: '.15s' }} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <span className={`${c.tTitle} ${c.ell}`}>{j.title || j.url}</span>
                    <span className={c.ell} style={{ fontSize: 12.5, color: 'var(--muted)' }}>{j.artist}</span>
                  </div>
                )}
                <div className={`${c.jobUrl} ${c.ell}`}>{j.url}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={c.pct} style={{ color: isFail ? 'var(--error)' : running ? 'var(--ink)' : 'var(--dim)' }}>
                  {isDone ? (t ? 'OK' : '·') : isFail ? 'ERR' : Math.floor(j.progress) + '%'}
                </div>
                <div className={c.jobStatus} style={isFail ? { color: 'var(--error)' } : undefined}>{status}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {isDone && t && <button className={c.jBtn} onClick={() => playFrom(t.id, tracks.map(x => x.id), 'lib')}>PLAY</button>}
                {isFail && <button className={`${c.jBtn} ${c.red}`} onClick={() => jobCmd('retry_job', j.id)}>RETRY</button>}
                {!isDone && !isFail && (
                  <button className={`${c.jBtn} ${c.pause}`} onClick={() => jobCmd(j.status === 'paused' ? 'resume_job' : 'pause_job', j.id)}>
                    {j.status === 'paused' ? 'RESUME' : 'PAUSE'}
                  </button>
                )}
                <button className={c.x} style={{ width: 30, height: 30 }} title={isDone ? 'Remove from list' : 'Cancel'} onClick={() => jobCmd('cancel_job', j.id)}><X /></button>
              </div>
              <div className={c.progress} style={{
                width: j.progress.toFixed(1) + '%',
                background: isFail ? 'var(--error)' : isDone ? 'transparent' : idle ? 'var(--faint)' : 'var(--ink)',
              }} />
            </div>
          );
        })}
      </div>
      {!jobs.length && (
        <div className={c.empty} style={{ borderBottom: 0 }}>
          <div className={c.display}>The bar is dry.</div>
          <div className={c.emptyBody}>Paste one or more YouTube, SoundCloud or Spotify links in the bar above. Playlist and album links work too.</div>
        </div>
      )}
    </div>
  );
}

export function Playlists() {
  const { playlists, tracks, w } = useStore(useShallow(s => ({ playlists: s.playlists, tracks: s.tracks, w: s.w })));
  const byId = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);
  return (
    <div style={h1Style(w)}>
      <h1 className={`${c.display} ${c.h1}`} style={{ margin: '0 0 14px', letterSpacing: 0 }}>Playlists</h1>
      <div className={c.plGrid}>
        {playlists.map(p => (
          <button key={p.id} className={c.plCard} onClick={() => nav({ view: 'playlist', plId: p.id })}>
            <div className={c.mosaic}>{mosaic(p, byId).map((m, i) => <div key={i} style={{ background: m }} />)}</div>
            <div>
              <div className={c.tTitle}>{p.name}</div>
              <div style={{ font: '500 10.5px var(--mono)', color: 'var(--muted)', marginTop: 3 }}>{p.ids.filter(i => byId.has(i)).length} TRACKS</div>
            </div>
          </button>
        ))}
        <button className={c.plNew} onClick={() => newPlaylist()}>+ NEW PLAYLIST</button>
      </div>
    </div>
  );
}

type Item = { label: string; desc: string; ctl: React.ReactNode };

export function SettingsView() {
  const { st, tracks, w } = useStore(useShallow(s => ({ st: s.set, tracks: s.tracks, w: s.w })));
  const tog = (k: keyof Settings, label: string, desc: string): Item => ({
    label, desc,
    ctl: (
      <button className={`${c.ctl} ${c.switch}`} role="switch" aria-checked={!!st[k]} onClick={() => setSet(k, !st[k] as never)}>
        <span className={st[k] ? '' : c.offOn}>OFF</span>
        <span className={st[k] ? c.on : ''}>ON</span>
      </button>
    ),
  });
  const seg = <K extends 'format' | 'bitrate'>(k: K, label: string, desc: string, opts: Settings[K][], disabled = false): Item => ({
    label, desc,
    ctl: (
      <div className={c.ctl}>
        {opts.map(o => (
          <button key={o} className={`${c.seg} ${st[k] === o && !disabled ? c.on : ''}`} disabled={disabled} onClick={() => setSet(k, o)}>{o}</button>
        ))}
      </div>
    ),
  });
  const browse = async () => {
    const dir = await open({ directory: true, title: 'Save downloads to' }).catch(() => null);
    if (typeof dir !== 'string') return;
    const home = (await homeDir().catch(() => '')).replace(/[\\/]$/, '');
    setSet('folder', home && dir.startsWith(home + '/') ? '~' + dir.slice(home.length) : dir);
    toast('Download folder changed');
  };

  const sections: { title: string; items: Item[] }[] = [
    { title: 'Downloads', items: [
      { label: 'Save to', desc: 'Where downloaded audio files are stored on disk.', ctl: (
        <div className={c.ctl}>
          <span className={`${c.path} ${c.ell}`}>{st.folder}</span>
          <button className={c.browse} onClick={browse}>BROWSE</button>
        </div>
      ) },
      seg('format', 'Format', 'Audio container for new downloads.', ['MP3', 'M4A', 'OPUS', 'FLAC']),
      seg('bitrate', 'Bitrate (kbps)', st.format === 'FLAC' ? 'FLAC is always lossless.' : 'Higher bitrate means bigger files.', ['128', '192', '256', '320'], st.format === 'FLAC'),
      { label: 'Parallel downloads', desc: 'How many links download at the same time.', ctl: (
        <div className={c.ctl}>
          <button className={c.step} onClick={() => setSet('parallel', Math.max(1, st.parallel - 1))}>−</button>
          <span className={c.stepVal}>{st.parallel}</span>
          <button className={c.step} onClick={() => setSet('parallel', Math.min(5, st.parallel + 1))}>+</button>
        </div>
      ) },
      tog('autotag', 'Auto-tag metadata and artwork', 'Fill in title, artist, album and cover from the source.'),
      tog('skipDupes', 'Skip duplicates', 'Ignore links already in your library or downloads.'),
    ] },
    { title: 'Playback', items: [
      { label: 'Crossfade', desc: 'Blend the end of one track into the next.', ctl: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" className={c.range} min={0} max={12} step={1} value={st.crossfade} onChange={e => setSet('crossfade', +e.target.value)} />
          <span style={{ minWidth: 36, font: '700 11px var(--mono)' }}>{st.crossfade ? st.crossfade + 's' : 'OFF'}</span>
        </div>
      ) },
      { label: 'Speed', desc: 'Play faster, from normal up to 2.5 times. Also in the player bar.', ctl: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="range" className={c.range} min={SPEED_MIN} max={SPEED_MAX} step={0.05} value={st.speed} onChange={e => setSpeed(+e.target.value)} />
          <span style={{ minWidth: 44, font: '700 11px var(--mono)' }}>{speedLabel(st.speed)}</span>
        </div>
      ) },
      tog('keepPitch', 'Keep pitch', 'On: faster at the same pitch. Off: the sped-up sound, pitch rises with speed.'),
      tog('normalize', 'Normalize volume', 'Keep loudness even across YouTube, SoundCloud and Spotify rips.'),
      tog('syncLyrics', 'Match lyrics to your file', 'Listens to each song on this computer so lyrics line up with your exact version. Downloads a 148 MB speech model once.'),
      tog('gapless', 'Gapless playback', 'No silence between tracks from the same album.'),
    ] },
    { title: 'App', items: [
      tog('notify', 'Notify when downloads finish', 'Show a notice when a track lands in your library.'),
      tog('tray', 'Close to tray', 'Keep playing and downloading after the window closes.'),
      tog('startup', 'Launch on startup', 'Open Vodka when you log in.'),
    ] },
  ];

  return (
    <div style={h1Style(w)}>
      <div style={{ paddingBottom: 14 }}>
        <div className={c.eyebrow}>{tracks.length} tracks · {diskSize(tracks, st)} on disk</div>
        <h1 className={`${c.display} ${c.h1}`} style={{ letterSpacing: 0 }}>Settings</h1>
      </div>
      <div className={c.secs}>
        {sections.map((sec, si) => (
          <div key={sec.title}>
            <div className={c.secHead}>
              <span style={{ font: '500 10.5px var(--mono)', color: 'var(--dim)' }}>{String(si + 1).padStart(2, '0')}</span>
              <span className={c.display}>{sec.title}</span>
            </div>
            {sec.items.map(it => (
              <div key={it.label} className={c.setRow}>
                <div className={c.setText}>
                  <div className={c.setLabel}>{it.label}</div>
                  <div className={c.setDesc}>{it.desc}</div>
                </div>
                {it.ctl}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
