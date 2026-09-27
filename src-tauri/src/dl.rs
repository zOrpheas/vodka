// Download pipeline: a job list with N parallel workers driving yt-dlp + ffmpeg sidecars.
// Every change is pushed to the UI as a "jobs" event; finished tracks arrive as "track-added".

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::watch,
};

const STOPPED: &str = "stopped";
const PEAKS: usize = 72;
const RATE: usize = 8000;

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    id: String,
    url: String,
    source: String,
    title: Option<String>,
    artist: Option<String>,
    progress: f64,
    status: String, // waiting | resolving | downloading | tagging | done | failed | paused
    error: Option<String>,
    track_id: Option<String>,
    #[serde(skip)]
    run: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    id: String,
    title: String,
    artist: String,
    dur: f64,
    src: String,
    url: String,
    file: String,
    art: Option<String>,
    peaks: Vec<f32>,
    gain: f32,
    onset: f64,
    added: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    folder: String,
    format: String,
    bitrate: String,
    parallel: usize,
    autotag: bool,
    skip_dupes: bool,
    close_to_tray: bool,
    known: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            folder: "~/Music/Vodka".into(),
            format: "MP3".into(),
            bitrate: "320".into(),
            parallel: 2,
            autotag: true,
            skip_dupes: true,
            close_to_tray: true,
            known: vec![],
        }
    }
}

#[derive(Default)]
pub struct Dl {
    jobs: Mutex<Vec<Job>>, // oldest first
    stops: Mutex<HashMap<String, (u64, watch::Sender<bool>)>>,
    cfg: Mutex<Config>,
    seq: AtomicU64,
}

impl Dl {
    pub fn close_to_tray(&self) -> bool {
        self.cfg.lock().unwrap().close_to_tray
    }
    fn next(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::SeqCst) + 1
    }
    fn stop(&self, id: &str) {
        if let Some((_, tx)) = self.stops.lock().unwrap().remove(id) {
            let _ = tx.send(true);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn src_of(url: &str) -> Option<&'static str> {
    let u = url.to_lowercase();
    if u.contains("youtube.com") || u.contains("youtu.be") {
        Some("yt")
    } else if u.contains("soundcloud.com") {
        Some("sc")
    } else if u.contains("spotify.com") || u.starts_with("spotify:") {
        Some("sp")
    } else {
        None
    }
}

fn is_running(status: &str) -> bool {
    matches!(status, "resolving" | "downloading" | "tagging")
}

fn emit(app: &AppHandle) {
    let jobs = app.state::<Dl>().jobs.lock().unwrap().clone();
    let _ = app.emit("jobs", jobs);
}

/// Applies `f` only if the job still exists and belongs to this run (pause/cancel/retry invalidate runs).
fn update(app: &AppHandle, id: &str, run: u64, f: impl FnOnce(&mut Job)) -> bool {
    let ok = {
        let dl = app.state::<Dl>();
        let mut jobs = dl.jobs.lock().unwrap();
        match jobs.iter_mut().find(|j| j.id == id && j.run == run) {
            Some(j) => {
                f(j);
                true
            }
            None => false,
        }
    };
    if ok {
        emit(app);
    }
    ok
}

fn pump(app: &AppHandle) {
    let dl = app.state::<Dl>();
    let parallel = dl.cfg.lock().unwrap().parallel.max(1);
    let mut starts = vec![];
    {
        let mut jobs = dl.jobs.lock().unwrap();
        let mut running = jobs.iter().filter(|j| is_running(&j.status)).count();
        for j in jobs.iter_mut() {
            if running >= parallel {
                break;
            }
            if j.status == "waiting" {
                j.status = "resolving".into();
                j.run = dl.next();
                running += 1;
                starts.push(j.clone());
            }
        }
    }
    for job in starts {
        let (tx, rx) = watch::channel(false);
        dl.stops.lock().unwrap().insert(job.id.clone(), (job.run, tx));
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let (id, run) = (job.id.clone(), job.run);
            let res = process(&app, job, rx).await;
            finish(&app, &id, run, res);
        });
    }
    emit(app);
}

fn finish(app: &AppHandle, id: &str, run: u64, res: Result<Option<Track>, String>) {
    {
        let dl = app.state::<Dl>();
        let mut stops = dl.stops.lock().unwrap();
        if stops.get(id).is_some_and(|(r, _)| *r == run) {
            stops.remove(id);
        }
    }
    match res {
        Ok(Some(track)) => {
            let tid = track.id.clone();
            let _ = app.emit("track-added", track);
            update(app, id, run, |j| {
                j.status = "done".into();
                j.progress = 100.0;
                j.track_id = Some(tid);
            });
        }
        Ok(None) => {}
        Err(e) if e == STOPPED => {}
        Err(e) => {
            let msg = friendly(&e);
            if update(app, id, run, |j| {
                j.status = "failed".into();
                j.error = Some(msg);
            }) {
                let _ = app.emit("job-failed", id);
            }
        }
    }
    pump(app);
}

fn friendly(e: &str) -> String {
    let l = e.to_lowercase();
    let msg = if ["private", "region", "country", "not available", "unavailable", "sign in"].iter().any(|k| l.contains(k)) {
        "Private or region-locked"
    } else if l.contains("unsupported url") {
        "Unsupported link"
    } else if l.contains("no match") {
        "No match found"
    } else if l.contains("could not start") {
        "Downloader missing"
    } else if l.contains("spotify") {
        "Spotify lookup failed"
    } else {
        "Download failed"
    };
    msg.into()
}

/// Replaces a playlist/album job with one waiting job per track, in place.
fn expand(app: &AppHandle, id: &str, run: u64, entries: Vec<(String, Option<String>, Option<String>)>) {
    let dl = app.state::<Dl>();
    {
        let cfg = dl.cfg.lock().unwrap();
        let mut jobs = dl.jobs.lock().unwrap();
        let Some(idx) = jobs.iter().position(|j| j.id == id && j.run == run) else { return };
        let source = jobs[idx].source.clone();
        let mut seen: HashSet<String> = jobs.iter().map(|j| j.url.clone()).collect();
        if cfg.skip_dupes {
            seen.extend(cfg.known.iter().cloned());
        }
        jobs.remove(idx);
        let fresh: Vec<Job> = entries
            .into_iter()
            .filter(|(u, _, _)| seen.insert(u.clone()) || !cfg.skip_dupes)
            .map(|(url, title, artist)| Job {
                id: format!("j{}", dl.next()),
                url,
                source: source.clone(),
                title,
                artist,
                status: "waiting".into(),
                ..Default::default()
            })
            .collect();
        jobs.splice(idx..idx, fresh);
    }
    emit(app);
}

/// Writable folder for tools that must stay current (yt-dlp); preferred over the bundled copies.
static TOOLS: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

fn bin(name: &str) -> PathBuf {
    let exe = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    if let Some(own) = TOOLS.get().map(|d| d.join(&exe)).filter(|p| p.exists()) {
        return own;
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(&exe)))
        .filter(|p| p.exists())
        .unwrap_or_else(|| exe.into())
}

/// YouTube changes often and a bundled yt-dlp goes stale within weeks, while the install folder is
/// usually read-only. So we keep a private copy in the app data folder and let yt-dlp update itself.
pub async fn keep_ytdlp_current(dir: PathBuf) {
    let exe = format!("yt-dlp{}", std::env::consts::EXE_SUFFIX);
    let own = dir.join(&exe);
    if !own.exists() {
        let bundled = bin("yt-dlp");
        let tmp = dir.join(format!("{exe}.part"));
        let copied = bundled.is_absolute()
            && std::fs::create_dir_all(&dir).is_ok()
            && std::fs::copy(&bundled, &tmp).is_ok() // keeps the executable bit
            && std::fs::rename(&tmp, &own).is_ok();
        if !copied {
            return;
        }
        // A copy made outside the approved app bundle must not carry the "downloaded file" quarantine flag.
        #[cfg(target_os = "macos")]
        let _ = Command::new("xattr").args(["-d", "com.apple.quarantine"]).arg(&own).status().await;
    }
    let _ = TOOLS.set(dir);
    let _ = cmd("yt-dlp").arg("-U").stdout(Stdio::null()).stderr(Stdio::null()).status().await;
}

pub(crate) fn cmd(name: &str) -> Command {
    let mut c = Command::new(bin(name));
    c.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

fn expand_tilde(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))) {
        (Some(rest), Some(home)) => Path::new(&home).join(rest),
        _ => PathBuf::from(p),
    }
}

fn clean(s: &str) -> String {
    let s: String = s.chars().map(|c| if "/\\:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    s.trim().trim_matches('.').chars().take(120).collect()
}

/// yt-dlp --parse-metadata argument that sets a literal value.
fn meta(value: &str, field: &str) -> String {
    format!("{}:%(meta_{field})s", value.replace('\\', "\\\\").replace('%', "%%").replace(':', "\\:"))
}

/// Runs a process, feeding stdout lines to `on_line`; kills it when `stop` fires.
async fn exec(c: &mut Command, stop: &mut watch::Receiver<bool>, mut on_line: impl FnMut(&str)) -> Result<String, String> {
    c.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| format!("could not start {:?}: {e}", c.as_std().get_program()))?;
    let stderr = child.stderr.take().unwrap();
    let err_task = tauri::async_runtime::spawn(async move {
        let (mut last, mut lines) = (String::new(), BufReader::new(stderr).lines());
        while let Ok(Some(l)) = lines.next_line().await {
            if l.starts_with("ERROR") || !last.starts_with("ERROR") {
                last = l;
            }
        }
        last
    });
    let mut out = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut all = String::new();
    loop {
        tokio::select! {
            l = out.next_line() => match l {
                Ok(Some(l)) => { on_line(&l); all.push_str(&l); all.push('\n'); }
                _ => break,
            },
            _ = stop.changed() => { let _ = child.kill().await; return Err(STOPPED.into()); }
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let err = err_task.await.unwrap_or_default();
    if status.success() {
        Ok(all)
    } else {
        Err(err)
    }
}

fn sp_ref(url: &str) -> Option<(&'static str, String)> {
    for k in ["track", "album", "playlist"] {
        let at = url.find(&format!("{k}/")).or_else(|| url.find(&format!("{k}:")));
        if let Some(i) = at {
            let id: String = url[i + k.len() + 1..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
            if !id.is_empty() {
                return Some((k, id));
            }
        }
    }
    None
}

/// Spotify metadata without API keys: the public embed page carries the entity as JSON.
async fn spotify(url: &str) -> Result<Value, String> {
    let (kind, id) = sp_ref(url).ok_or("unsupported url")?;
    let html = reqwest::Client::new()
        .get(format!("https://open.spotify.com/embed/{kind}/{id}"))
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| format!("spotify: {e}"))?
        .text()
        .await
        .map_err(|e| format!("spotify: {e}"))?;
    let json = html
        .split("<script id=\"__NEXT_DATA__\"")
        .nth(1)
        .and_then(|s| s.split_once('>'))
        .and_then(|(_, s)| s.split("</script>").next())
        .ok_or("spotify: no data")?;
    let v: Value = serde_json::from_str(json).map_err(|e| format!("spotify: {e}"))?;
    Ok(v["props"]["pageProps"]["state"]["data"]["entity"].clone())
}

fn s(v: &Value) -> Option<String> {
    v.as_str().filter(|x| !x.is_empty()).map(String::from)
}

async fn process(app: &AppHandle, job: Job, mut stop: watch::Receiver<bool>) -> Result<Option<Track>, String> {
    let cfg = app.state::<Dl>().cfg.lock().unwrap().clone();
    let (id, run) = (job.id.clone(), job.run);

    // 1. Resolve
    let (title, artist, cover, target) = if job.source == "sp" {
        let e = spotify(&job.url).await?;
        if e["type"] != "track" {
            let entries = e["trackList"].as_array().cloned().unwrap_or_default();
            let entries = entries
                .iter()
                .filter_map(|t| {
                    let tid = s(&t["uri"])?.rsplit(':').next()?.to_string();
                    Some((format!("https://open.spotify.com/track/{tid}"), s(&t["title"]), s(&t["subtitle"])))
                })
                .collect();
            expand(app, &id, run, entries);
            return Ok(None);
        }
        let title = s(&e["name"]).ok_or("spotify: no title")?;
        let artists: Vec<String> = e["artists"].as_array().into_iter().flatten().filter_map(|a| s(&a["name"])).collect();
        let artist = artists.join(", ");
        let cover = e["visualIdentity"]["image"]
            .as_array()
            .and_then(|imgs| imgs.iter().max_by_key(|i| i["maxWidth"].as_u64().unwrap_or(0)))
            .and_then(|i| s(&i["url"]));
        let target = format!("ytsearch1:{artist} - {title} audio");
        (title, artist, cover, target)
    } else {
        let out = exec(cmd("yt-dlp").args(["-J", "--flat-playlist", "--no-playlist", "--js-runtimes", "node", &job.url]), &mut stop, |_| {}).await?;
        let v: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
        if v["_type"] == "playlist" {
            let entries = v["entries"].as_array().cloned().unwrap_or_default();
            let entries = entries
                .iter()
                .filter_map(|t| Some((s(&t["webpage_url"]).or_else(|| s(&t["url"]))?, s(&t["title"]), s(&t["uploader"]))))
                .collect();
            expand(app, &id, run, entries);
            return Ok(None);
        }
        let mut title = s(&v["track"]).or_else(|| s(&v["title"])).unwrap_or_else(|| "Untitled".into());
        let mut artist = s(&v["artist"])
            .or_else(|| s(&v["creator"]))
            .or_else(|| s(&v["uploader"]))
            .or_else(|| s(&v["channel"]))
            .unwrap_or_else(|| "Unknown artist".into())
            .trim_end_matches(" - Topic")
            .to_string();
        if v["track"].is_null() && job.source == "yt" {
            if let Some((a, t)) = title.clone().split_once(" - ") {
                (artist, title) = (a.trim().into(), t.trim().into());
            }
        }
        let target = s(&v["webpage_url"]).unwrap_or(job.url.clone());
        (title, artist, None, target)
    };
    if !update(app, &id, run, |j| {
        j.title = Some(title.clone());
        j.artist = Some(artist.clone());
        j.status = "downloading".into();
    }) {
        return Err(STOPPED.into());
    }

    // 2. Download + convert + tag
    let folder = expand_tilde(&cfg.folder);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = format!("{} - {}", clean(&artist), clean(&title)).replace('%', "%%");
    let fmt = cfg.format.to_lowercase();
    let mut c = cmd("yt-dlp");
    c.args(["-f", "bestaudio/best", "-x", "--audio-format", &fmt, "--no-playlist", "--newline", "--progress", "--no-colors"])
        .args(["--js-runtimes", "node", "--write-thumbnail", "--convert-thumbnails", "jpg"])
        .args(["--progress-template", "download:VKP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s"])
        .args(["--print", "after_move:VKF %(filepath)s", "-o"])
        .arg(folder.join(format!("{name}.%(ext)s")));
    if fmt != "flac" {
        c.args(["--audio-quality", &format!("{}K", cfg.bitrate)]);
    }
    if let Some(dir) = bin("ffmpeg").parent().filter(|d| d.is_absolute()) {
        c.arg("--ffmpeg-location").arg(dir);
    }
    if cfg.autotag {
        c.args(["--embed-metadata", "--embed-thumbnail", "--parse-metadata", &meta(&title, "title"), "--parse-metadata", &meta(&artist, "artist")]);
    }
    c.arg(&target);
    let (mut file, mut last) = (None::<String>, 0.0);
    exec(&mut c, &mut stop, |l| {
        if let Some(rest) = l.strip_prefix("VKP ") {
            let n: Vec<f64> = rest.split(' ').map(|x| x.parse().unwrap_or(0.0)).collect();
            let total = if n[1] > 0.0 { n[1] } else { n[2] };
            if total > 0.0 {
                let pct = (n[0] / total * 100.0).min(100.0);
                if pct - last >= 0.5 || pct >= 100.0 {
                    last = pct;
                    update(app, &id, run, |j| {
                        j.progress = pct;
                        if pct >= 100.0 {
                            j.status = "tagging".into();
                        }
                    });
                }
            }
        } else if let Some(p) = l.strip_prefix("VKF ") {
            file = Some(p.to_string());
        }
    })
    .await?;
    let file = PathBuf::from(file.ok_or("no match found")?);
    update(app, &id, run, |j| {
        j.progress = 100.0;
        j.status = "tagging".into();
    });

    let jpg = file.with_extension("jpg");
    if let Some(url) = cover {
        // Spotify: replace the YouTube thumbnail with the real cover, then re-embed it.
        if let Ok(bytes) = async { reqwest::get(&url).await?.bytes().await }.await {
            if std::fs::write(&jpg, &bytes).is_ok() && cfg.autotag {
                embed_cover(&file, &jpg).await;
            }
        }
    }

    // 3. Waveform peaks + loudness
    let samples = pcm(&file, None).await?;
    let (dur, peaks, gain) = analyze(&samples);

    Ok(Some(Track {
        id: format!("t{}{}", now_ms(), run),
        title,
        artist,
        dur,
        src: job.source,
        url: job.url,
        file: file.to_string_lossy().into(),
        art: jpg.exists().then(|| jpg.to_string_lossy().into()),
        peaks,
        gain,
        onset: onset_of(&samples),
        added: now_ms(),
    }))
}

/// Decodes to mono f32 at RATE Hz (optionally only the first `secs` seconds).
async fn pcm(file: &Path, secs: Option<u32>) -> Result<Vec<f32>, String> {
    let mut c = cmd("ffmpeg");
    c.args(["-v", "quiet", "-i"]).arg(file);
    if let Some(s) = secs {
        c.args(["-t", &s.to_string()]);
    }
    let out = c
        .args(["-ac", "1", "-ar", &RATE.to_string(), "-f", "s16le", "-"])
        .stdout(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("could not start ffmpeg: {e}"))?
        .stdout;
    Ok(out.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect())
}

/// Seconds until the first audible sample (same threshold the player's sync probe uses).
fn onset_of(s: &[f32]) -> f64 {
    s.iter().position(|v| v.abs() > 0.02).unwrap_or(0) as f64 / RATE as f64
}

/// Onset for tracks downloaded before it was stored at import.
#[tauri::command]
pub async fn onset(path: String) -> Result<f64, String> {
    Ok(onset_of(&pcm(Path::new(&path), Some(30)).await?))
}

/// Best effort: ffmpeg can't attach pictures to Ogg/Opus, so those keep the YouTube thumbnail.
async fn embed_cover(file: &Path, jpg: &Path) {
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
    if !["mp3", "m4a", "flac"].contains(&ext) {
        return;
    }
    let tmp = file.with_extension(format!("cover.{ext}"));
    let ok = cmd("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(file)
        .arg("-i")
        .arg(jpg)
        .args(["-map", "0:a", "-map", "1:0", "-c", "copy", "-disposition:v:0", "attached_pic", "-id3v2_version", "3"])
        .arg(&tmp)
        .status()
        .await
        .is_ok_and(|s| s.success());
    if ok {
        let _ = std::fs::rename(&tmp, file);
    } else {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Mono samples at RATE Hz -> (duration s, 72 bars in 0.12..1, normalize gain).
fn analyze(s: &[f32]) -> (f64, Vec<f32>, f32) {
    let dur = s.len() as f64 / RATE as f64;
    let rms = |x: &[f32]| if x.is_empty() { 0.0 } else { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() };
    let chunk = (s.len() / PEAKS).max(1);
    let bars: Vec<f32> = (0..PEAKS).map(|i| rms(&s[(i * chunk).min(s.len())..((i + 1) * chunk).min(s.len())])).collect();
    let max = bars.iter().cloned().fold(0.0, f32::max).max(1e-6);
    let peaks = bars.iter().map(|b| (b / max).max(0.12)).collect();
    // ponytail: RMS to -16 dBFS as a loudness proxy, swap for ebur128 if levels still feel uneven.
    let level = rms(s).max(1e-6);
    let peak = s.iter().fold(0.0f32, |a, v| a.max(v.abs())).max(1e-6);
    let gain = (10f32.powf(-16.0 / 20.0) / level).min(1.0 / peak).clamp(0.25, 4.0);
    (dur, peaks, gain)
}

#[tauri::command]
pub fn configure(app: AppHandle, dl: State<Dl>, cfg: Config) {
    *dl.cfg.lock().unwrap() = cfg;
    pump(&app);
}

#[tauri::command]
pub fn add_jobs(app: AppHandle, dl: State<Dl>, urls: Vec<String>) {
    {
        let mut jobs = dl.jobs.lock().unwrap();
        for url in urls {
            let Some(source) = src_of(&url) else { continue };
            jobs.push(Job { id: format!("j{}", dl.next()), url, source: source.into(), status: "waiting".into(), ..Default::default() });
        }
    }
    pump(&app);
}

fn edit(app: &AppHandle, dl: &Dl, id: &str, f: impl FnOnce(&mut Job)) {
    if let Some(j) = dl.jobs.lock().unwrap().iter_mut().find(|j| j.id == id) {
        f(j);
    }
    pump(app);
}

#[tauri::command]
pub fn pause_job(app: AppHandle, dl: State<Dl>, id: String) {
    dl.stop(&id);
    edit(&app, &dl, &id, |j| {
        if j.status == "waiting" || is_running(&j.status) {
            j.status = "paused".into();
            j.run = 0;
        }
    });
}

#[tauri::command]
pub fn resume_job(app: AppHandle, dl: State<Dl>, id: String) {
    edit(&app, &dl, &id, |j| {
        if j.status == "paused" {
            j.status = "waiting".into();
        }
    });
}

#[tauri::command]
pub fn retry_job(app: AppHandle, dl: State<Dl>, id: String) {
    edit(&app, &dl, &id, |j| {
        if j.status == "failed" {
            j.status = "waiting".into();
            j.progress = 0.0;
            j.error = None;
        }
    });
}

#[tauri::command]
pub fn retry_failed(app: AppHandle, dl: State<Dl>) {
    for j in dl.jobs.lock().unwrap().iter_mut().filter(|j| j.status == "failed") {
        j.status = "waiting".into();
        j.progress = 0.0;
        j.error = None;
    }
    pump(&app);
}

#[tauri::command]
pub fn cancel_job(app: AppHandle, dl: State<Dl>, id: String) {
    dl.stop(&id);
    dl.jobs.lock().unwrap().retain(|j| j.id != id);
    pump(&app);
}

#[tauri::command]
pub fn clear_finished(app: AppHandle, dl: State<Dl>) {
    dl.jobs.lock().unwrap().retain(|j| j.status != "done");
    emit(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyze_and_parse() {
        let tone: Vec<f32> = (0..RATE * 3).map(|i| (i as f32 * 0.05).sin() * (i as f32 / (RATE * 3) as f32)).collect();
        let (dur, peaks, gain) = analyze(&tone);
        assert_eq!(dur, 3.0);
        assert_eq!(peaks.len(), PEAKS);
        assert!(peaks[0] >= 0.12 && peaks[PEAKS - 1] == 1.0 && peaks[10] < peaks[60]);
        assert!(gain > 0.25 && gain <= 4.0);
        let mut quiet_intro = vec![0.001f32; RATE / 2];
        quiet_intro.extend([0.5, 0.5]);
        assert_eq!(onset_of(&quiet_intro), 0.5);
        assert_eq!(sp_ref("https://open.spotify.com/intl-de/track/4cOd?si=x"), Some(("track", "4cOd".into())));
        assert_eq!(sp_ref("spotify:album:AbC1"), Some(("album", "AbC1".into())));
        assert_eq!(src_of("https://youtu.be/x"), Some("yt"));
        assert_eq!(src_of("https://example.com"), None);
        assert_eq!(meta("A: 5%", "artist"), "A\\: 5%%:%(meta_artist)s");
        assert_eq!(clean("AC/DC: Live?"), "AC_DC_ Live_");
    }
}
