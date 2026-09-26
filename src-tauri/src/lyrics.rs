// Lyrics from LRCLIB (https://lrclib.net): free, no key, time-stamped LRC.
// Entries there are user-submitted, so every candidate is checked for real content and a matching length.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Line {
    pub t: f64,
    pub text: String,
}

#[derive(Serialize, Debug)]
pub struct Lyrics {
    lines: Vec<Line>, // synced; empty when only plain text exists
    plain: Option<String>,
    instrumental: bool,
}

/// Parses LRC ("[mm:ss.xx]text", several stamps per line allowed, optional [offset:ms]).
fn parse_lrc(lrc: &str) -> Vec<Line> {
    let mut offset = 0.0;
    let mut out = vec![];
    for raw in lrc.lines() {
        let mut rest = raw.trim();
        let mut stamps = vec![];
        while let Some(end) = rest.strip_prefix('[').and_then(|r| r.find(']')) {
            let tag = &rest[1..end + 1];
            if let Some(ms) = tag.strip_prefix("offset:") {
                offset = ms.trim().parse::<f64>().unwrap_or(0.0) / 1000.0;
            } else if let Some((m, s)) = tag.split_once(':') {
                if let (Ok(m), Ok(s)) = (m.trim().parse::<f64>(), s.trim().parse::<f64>()) {
                    stamps.push(m * 60.0 + s);
                }
            }
            rest = rest[end + 2..].trim_start();
        }
        for t in stamps {
            out.push(Line { t: (t - offset).max(0.0), text: rest.trim().to_string() });
        }
    }
    out.sort_by(|a, b| a.t.total_cmp(&b.t));
    out
}

/// "Song (Official Video) [HD] ft. X" -> "Song"
fn clean_title(t: &str) -> String {
    let mut s = String::new();
    let mut depth = 0;
    for c in t.chars() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = (depth - 1).max(0),
            _ if depth == 0 => s.push(c),
            _ => {}
        }
    }
    let lower = s.to_lowercase();
    let cut = [" ft.", " feat.", " ft ", " feat ", " | "].iter().filter_map(|k| lower.find(k)).min().unwrap_or(s.len());
    s[..cut].trim().trim_end_matches(['-', '|']).trim().to_string()
}

fn first_artist(a: &str) -> &str {
    [",", " & ", " x ", " feat", " ft."].iter().filter_map(|k| a.find(k)).min().map_or(a, |i| &a[..i]).trim()
}

/// Best candidate: good synced lyrics with the closest length, else plain text, else instrumental.
fn pick(cands: &[Value], dur: f64) -> Option<Lyrics> {
    let off = |c: &Value| (c["duration"].as_f64().unwrap_or(0.0) - dur).abs();
    let near = |c: &&Value| dur <= 0.0 || off(c) <= 15.0;
    let synced = cands
        .iter()
        .filter(near)
        .filter_map(|c| {
            let lines = parse_lrc(c["syncedLyrics"].as_str()?);
            (lines.iter().filter(|l| !l.text.is_empty()).count() >= 6).then(|| (off(c), lines, c))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0));
    if let Some((_, lines, c)) = synced {
        return Some(Lyrics { lines, plain: c["plainLyrics"].as_str().map(String::from), instrumental: false });
    }
    let plain = cands.iter().filter(near).filter_map(|c| c["plainLyrics"].as_str()).find(|p| p.lines().filter(|l| !l.trim().is_empty()).count() >= 4);
    if let Some(p) = plain {
        return Some(Lyrics { lines: vec![], plain: Some(p.to_string()), instrumental: false });
    }
    cands.iter().filter(near).any(|c| c["instrumental"] == true).then(|| Lyrics { lines: vec![], plain: None, instrumental: true })
}

async fn search(client: &reqwest::Client, q: &[(&str, &str)]) -> Result<Vec<Value>, String> {
    let r = client.get("https://lrclib.net/api/search").query(q).send().await.map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("lrclib {}", r.status()));
    }
    let body = r.text().await.map_err(|e| e.to_string())?;
    Ok(serde_json::from_str::<Value>(&body).map_err(|e| e.to_string())?.as_array().cloned().unwrap_or_default())
}

/// Ok(None) means "looked, nothing there" (safe to cache); Err means try again later (offline etc.).
#[tauri::command]
pub async fn lyrics(title: String, artist: String, dur: f64) -> Result<Option<Lyrics>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Vodka music player (https://lrclib.net client)")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let clean = clean_title(&title);
    let a1 = first_artist(&artist);
    let free = format!("{a1} {clean}");
    let attempts: [&[(&str, &str)]; 3] = [
        &[("track_name", &title), ("artist_name", &artist)],
        &[("track_name", &clean), ("artist_name", a1)],
        &[("q", &free)],
    ];
    let mut all = vec![];
    for q in attempts {
        all.extend(search(&client, q).await?);
        if let Some(l) = pick(&all, dur).filter(|l| !l.lines.is_empty()) {
            return Ok(Some(l));
        }
    }
    Ok(pick(&all, dur))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_and_pick() {
        let l = parse_lrc("[ar:x]\n[offset:500]\n[00:12.50]Hello\n[00:05.00][01:00.00]Chorus\n[00:20.00]\nbad line");
        assert_eq!(l.iter().map(|x| (x.t, x.text.as_str())).collect::<Vec<_>>(), vec![(4.5, "Chorus"), (12.0, "Hello"), (19.5, ""), (59.5, "Chorus")]);

        assert_eq!(clean_title("Song Name (Official Video) [HD] ft. Someone"), "Song Name");
        assert_eq!(clean_title("i dont like me either"), "i dont like me either");
        assert_eq!(first_artist("Rick Astley, Someone"), "Rick Astley");

        let good: String = (0..10).map(|i| format!("[00:{i:02}.00]line {i}\n")).collect();
        let cands = vec![
            json!({"duration": 214.0, "syncedLyrics": "[00:00.00]probe", "plainLyrics": "probe"}),
            json!({"duration": 300.0, "syncedLyrics": good}),
            json!({"duration": 211.0, "syncedLyrics": good, "plainLyrics": "p"}),
        ];
        let p = pick(&cands, 214.0).unwrap();
        assert_eq!(p.lines.len(), 10); // junk "probe" skipped, 300s version too far off
        assert!(pick(&[json!({"duration": 100.0, "instrumental": true})], 101.0).unwrap().instrumental);
        assert!(pick(&cands[..1], 214.0).is_none());
    }

    #[tokio::test]
    #[ignore] // hits the network: cargo test -- --ignored
    async fn live_lookup() {
        let l = lyrics("Never Gonna Give You Up".into(), "Rick Astley".into(), 213.6).await.unwrap().unwrap();
        assert!(l.lines.len() > 30, "{:?}", l.lines.len());
        let l = lyrics("i dont like me either".into(), "never goodbye".into(), 60.4).await.unwrap().unwrap();
        assert!(!l.lines.is_empty());
        println!("{:?}", &l.lines[..3]);
    }
}
