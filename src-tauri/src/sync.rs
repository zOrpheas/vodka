// Fits LRCLIB timings to the user's actual file. LRCLIB lyrics are often timed for another edit of the song
// (album vs. video, extra intro, cut verse), so we transcribe the file locally with whisper.cpp, find where each
// lyric line is really sung, and move the lines there. Lines we can't hear are placed between their neighbours.

use crate::lyrics::Line;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{io::AsyncWriteExt, sync::Mutex};

const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_BYTES: u64 = 147_951_465; // ggml-base.bin (multilingual)

/// One transcription at a time: it is CPU heavy.
static BUSY: Mutex<()> = Mutex::const_new(());

fn norm(w: &str) -> String {
    w.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn sim(a: &str, b: &str) -> f32 {
    if a == b {
        return 2.0;
    }
    if a.chars().count() < 3 || b.chars().count() < 3 {
        return 0.0;
    }
    // cheap fuzzy match: shared prefix covers most of both words ("makin" / "making", "wanna" / "want")
    let common = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    let longer = a.chars().count().max(b.chars().count());
    if common * 4 >= longer * 3 || (common >= 4 && common * 3 >= longer * 2) {
        1.0
    } else {
        0.0
    }
}

/// Re-times `lines` against transcribed `words` [(seconds, word)]. None when too little of it could be heard.
pub fn align(lines: &[Line], words: &[(f64, String)], dur: f64) -> Option<Vec<Line>> {
    let heard: Vec<(f64, String)> = words.iter().map(|(t, w)| (*t, norm(w))).filter(|(_, w)| !w.is_empty()).collect();
    let lw: Vec<(usize, String)> =
        lines.iter().enumerate().flat_map(|(i, l)| l.text.split_whitespace().map(move |w| (i, norm(w)))).filter(|(_, w)| !w.is_empty()).collect();
    let (n, m) = (lw.len(), heard.len());
    if n == 0 || m == 0 {
        return None;
    }

    // Weighted LCS: best in-order pairing of lyric words with heard words (gaps are free).
    let mut d = vec![vec![0f32; m + 1]; n + 1];
    for i in 1..=n {
        for j in 1..=m {
            let s = sim(&lw[i - 1].1, &heard[j - 1].1);
            d[i][j] = d[i - 1][j].max(d[i][j - 1]).max(if s > 0.0 { d[i - 1][j - 1] + s } else { f32::MIN });
        }
    }
    let (mut i, mut j, mut matched) = (n, m, HashMap::new());
    while i > 0 && j > 0 {
        let s = sim(&lw[i - 1].1, &heard[j - 1].1);
        if s > 0.0 && d[i][j] == d[i - 1][j - 1] + s {
            matched.insert(i - 1, j - 1);
            i -= 1;
            j -= 1;
        } else if d[i][j] == d[i - 1][j] {
            i -= 1;
        } else {
            j -= 1;
        }
    }

    // A line is anchored when at least half its words were heard; it starts at its first heard word.
    let mut anchors: Vec<(usize, f64)> = vec![]; // (line index, new time)
    for li in 0..lines.len() {
        let ks: Vec<usize> = (0..n).filter(|&k| lw[k].0 == li).collect();
        let got: Vec<(usize, usize)> = ks.iter().enumerate().filter_map(|(pos, k)| matched.get(k).map(|&j| (pos, j))).collect();
        if !got.is_empty() && got.len() * 2 >= ks.len() {
            let (pos, j) = got[0];
            let t = (heard[j].0 - 0.3 * pos as f64).max(0.0);
            if anchors.last().is_none_or(|&(_, prev)| t >= prev) {
                anchors.push((li, t));
            }
        }
    }
    let spoken = lines.iter().filter(|l| !l.text.trim().is_empty()).count();
    if anchors.len() < 4 || anchors.len() * 10 < spoken * 3 {
        return None;
    }

    // Everything else moves with its neighbours: shift interpolated between the surrounding anchors.
    let shift = |li: usize| -> f64 {
        let t0 = lines[li].t;
        let before = anchors.iter().rev().find(|(a, _)| *a <= li);
        let after = anchors.iter().find(|(a, _)| *a >= li);
        let delta = |&(a, t): &(usize, f64)| t - lines[a].t;
        match (before, after) {
            (Some(b), Some(a)) if b.0 != a.0 && lines[a.0].t > lines[b.0].t => {
                let k = (t0 - lines[b.0].t) / (lines[a.0].t - lines[b.0].t);
                delta(b) + (delta(a) - delta(b)) * k.clamp(0.0, 1.0)
            }
            (Some(b), _) => delta(b),
            (None, Some(a)) => delta(a),
            (None, None) => 0.0,
        }
    };
    let mut out: Vec<Line> = vec![];
    for (li, l) in lines.iter().enumerate() {
        let t = anchors.iter().find(|(a, _)| *a == li).map_or_else(|| l.t + shift(li), |&(_, t)| t);
        // Lines pushed before the start or past the end aren't in this edit of the song.
        if t < 0.0 || t > dur {
            continue;
        }
        let t = out.last().map_or(t, |p: &Line| t.max(p.t));
        out.push(Line { t, text: l.text.clone() });
    }
    Some(out)
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ggml-base.bin"))
}

/// Downloads the speech model once (~148 MB), reporting progress as "sync-model" events (0..100).
async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let path = model_path(app)?;
    if path.metadata().is_ok_and(|m| m.len() == MODEL_BYTES) {
        return Ok(path);
    }
    let tmp = path.with_extension("part");
    let mut res = reqwest::get(MODEL_URL).await.map_err(|e| format!("model download: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("model download: {}", res.status()));
    }
    let total = res.content_length().unwrap_or(MODEL_BYTES);
    let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    let (mut got, mut last) = (0u64, 0u64);
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("model download: {e}"))? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        let pct = got * 100 / total.max(1);
        if pct != last {
            last = pct;
            let _ = app.emit("sync-model", pct);
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if got != MODEL_BYTES {
        let _ = std::fs::remove_file(&tmp);
        return Err("model download: incomplete".into());
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Word timestamps for a file: ffmpeg -> 16 kHz wav -> whisper-cli JSON.
async fn transcribe(app: &AppHandle, file: &Path, lang: &str) -> Result<Vec<(f64, String)>, String> {
    let model = ensure_model(app).await?;
    let work = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("sync");
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let wav = work.join("in.wav");
    let out = work.join("out");
    let ok = crate::dl::cmd("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(file)
        .args(["-ar", "16000", "-ac", "1"])
        .arg(&wav)
        .status()
        .await
        .is_ok_and(|s| s.success());
    if !ok {
        return Err("could not decode audio".into());
    }
    let threads = (std::thread::available_parallelism().map_or(4, |n| n.get()) / 2).max(1).to_string();
    let status = crate::dl::cmd("whisper-cli")
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(&wav)
        .args(["-l", lang, "-t", &threads, "-ml", "1", "-sow", "-oj", "-np", "-of"])
        .arg(&out)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("could not start whisper-cli: {e}"))?;
    let _ = std::fs::remove_file(&wav);
    if !status.success() {
        return Err("transcription failed".into());
    }
    let json = out.with_extension("json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(&json).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&json);
    Ok(v["transcription"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let text = s["text"].as_str()?.trim();
            // skip non-speech markers like "(upbeat music)", "[Music]", "♪"
            if text.is_empty() || text.contains(['(', ')', '[', ']', '♪', '*']) {
                return None;
            }
            Some((s["offsets"]["from"].as_f64()? / 1000.0, text.to_string()))
        })
        .collect())
}

/// Ok(None) = transcribed but couldn't match the lyrics (keep LRCLIB timing).
#[tauri::command]
pub async fn align_lyrics(app: AppHandle, path: String, lines: Vec<Line>, dur: f64) -> Result<Option<Vec<Line>>, String> {
    let _busy = BUSY.lock().await;
    // Hint the language: mostly-ASCII lyrics are almost always English, which whisper handles best when told.
    let text: String = lines.iter().map(|l| l.text.as_str()).collect();
    let letters = text.chars().filter(|c| c.is_alphabetic()).count().max(1);
    let lang = if text.chars().filter(|c| c.is_ascii_alphabetic()).count() * 10 >= letters * 9 { "en" } else { "auto" };
    let words = transcribe(&app, Path::new(&path), lang).await?;
    Ok(align(&lines, &words, dur))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(t: f64, text: &str) -> Line {
        Line { t, text: text.into() }
    }

    #[test]
    fn realigns_a_different_edit() {
        // LRCLIB timing (album): intro line, then verses. Our file: intro cut, verses 13s earlier, one chorus unheard.
        let lrc = vec![
            line(5.0, "If you've got love in your sights"),
            line(28.4, "When you make love do you look in your mirror"),
            line(35.4, "Who do you think of does he look like me"),
            line(43.1, "Do you tell lies and say that it's forever"),
            line(50.5, "Love bites love bleeds"),
            line(57.0, "Do you think twice or just touch and see"),
            line(65.1, "When you're alone do you let go"),
        ];
        let heard: Vec<(f64, String)> = [
            (14.8, "When you make love do you look in the mirror"),
            (22.6, "Who do you think of does he look like me"),
            (30.2, "Do you tell lies and say that its forever"),
            (43.9, "Do you think twice or just touch and see"),
            (52.4, "When youre alone do you let go"),
        ]
        .iter()
        .flat_map(|(t, s)| s.split(' ').enumerate().map(move |(i, w)| (t + i as f64 * 0.3, w.to_string())))
        .collect();
        let out = align(&lrc, &heard, 321.0).unwrap();
        let find = |s: &str| out.iter().find(|l| l.text.starts_with(s)).map(|l| l.t);
        assert_eq!(find("If you've"), None, "intro isn't in this edit");
        assert!((find("When you make").unwrap() - 14.8).abs() < 0.01);
        assert!((find("Do you think twice").unwrap() - 43.9).abs() < 0.01);
        let chorus = find("Love bites").unwrap();
        assert!(chorus > 30.2 && chorus < 43.9, "unheard line lands between its neighbours: {chorus}");
        assert!(out.windows(2).all(|w| w[0].t <= w[1].t));

        // Nothing recognisable -> keep the original timing.
        assert!(align(&lrc, &[(1.0, "la".into()), (2.0, "la".into())], 321.0).is_none());
        assert_eq!(sim("makin", "making"), 1.0);
        assert_eq!(sim("love", "live"), 0.0);
    }
}
