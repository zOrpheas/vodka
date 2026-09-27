// Loopback HTTP server for library audio + covers. WebKitGTK's media stack can't stream from the
// custom asset:// scheme, but plays http fine. Bound to 127.0.0.1 and gated by a random token.

use std::{
    fs::File,
    hash::{BuildHasher, Hasher},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    thread,
};

pub struct Media {
    pub base: String,
}

pub fn start() -> io::Result<Media> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    // RandomState keys come from the OS's secure random source on every platform: 128 unguessable bits.
    let random = || std::collections::hash_map::RandomState::new().build_hasher().finish();
    let token = format!("{:016x}{:016x}", random(), random());
    let base = format!("http://127.0.0.1:{port}/{token}/");
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let token = token.clone();
            thread::spawn(move || {
                let _ = serve(stream, &token);
            });
        }
    });
    Ok(Media { base })
}

fn mime(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "opus" | "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return None,
    })
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// "bytes=a-b" / "bytes=a-" / "bytes=-n" -> inclusive (start, end).
fn range(h: &str, len: u64) -> Option<(u64, u64)> {
    let (a, b) = h.trim().strip_prefix("bytes=")?.split(',').next()?.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => (len.saturating_sub(n.parse().ok()?), len - 1),
        (a, "") => (a.parse().ok()?, len - 1),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && end < len).then_some((start, end))
}

fn serve(stream: TcpStream, token: &str) -> io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut out = stream;
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let mut range_h = None;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h)? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.eq_ignore_ascii_case("range") {
                range_h = Some(v.trim().to_string());
            }
        }
    }
    let fail = |out: &mut TcpStream, code: &str| {
        write!(out, "HTTP/1.1 {code}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
    };
    let path = target
        .strip_prefix('/')
        .and_then(|t| t.strip_prefix(token))
        .and_then(|t| t.strip_prefix('/'))
        .and_then(|t| decode(t.split('?').next().unwrap_or(t)));
    let (Some(path), true) = (path, method == "GET" || method == "HEAD") else { return fail(&mut out, "404 Not Found") };
    let Some(ctype) = mime(&path) else { return fail(&mut out, "404 Not Found") };
    let Ok(mut file) = File::open(&path) else { return fail(&mut out, "404 Not Found") };
    let len = file.metadata()?.len();
    if len == 0 {
        return fail(&mut out, "404 Not Found");
    }
    let (status, start, end) = match range_h.as_deref() {
        Some(h) => match range(h, len) {
            Some((s, e)) => ("206 Partial Content", s, e),
            None => {
                return write!(out, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            }
        },
        None => ("200 OK", 0, len - 1),
    };
    let n = end - start + 1;
    write!(
        out,
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {n}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{len}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
    )?;
    if method == "GET" {
        file.seek(SeekFrom::Start(start))?;
        io::copy(&mut file.take(n), &mut out)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_ranges() {
        assert_eq!(range("bytes=0-", 10), Some((0, 9)));
        assert_eq!(range("bytes=2-4", 10), Some((2, 4)));
        assert_eq!(range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(range("bytes=5-99", 10), Some((5, 9)));
        assert_eq!(range("bytes=12-", 10), None);
        assert_eq!(decode("%2Fhome%2Fa%20b.mp3").as_deref(), Some("/home/a b.mp3"));

        let dir = std::env::temp_dir().join(format!("vodka-media-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a b.mp3");
        std::fs::write(&f, b"0123456789").unwrap();
        let m = start().unwrap();
        let get = |path: &str, extra: &str| {
            let url = m.base.strip_prefix("http://").unwrap();
            let (host, tail) = url.split_once('/').unwrap();
            let mut s = TcpStream::connect(host).unwrap();
            write!(s, "GET /{tail}{path} HTTP/1.1\r\nHost: x\r\n{extra}\r\n").unwrap();
            let mut r = String::new();
            s.read_to_string(&mut r).unwrap();
            r
        };
        let enc: String = f.to_str().unwrap().bytes().map(|b| format!("%{b:02X}")).collect();
        let r = get(&enc, "Range: bytes=2-4\r\n");
        assert!(r.starts_with("HTTP/1.1 206") && r.ends_with("234") && r.contains("Content-Range: bytes 2-4/10"), "{r}");
        assert!(get(&enc, "").ends_with("0123456789"));
        assert!(get("%2Fetc%2Fpasswd", "").starts_with("HTTP/1.1 404"));
        let bad = m.base.replace("http://", "").split_once('/').unwrap().0.to_string();
        let mut s = TcpStream::connect(bad).unwrap();
        write!(s, "GET /wrongtoken/{enc} HTTP/1.1\r\n\r\n").unwrap();
        let mut r = String::new();
        s.read_to_string(&mut r).unwrap();
        assert!(r.starts_with("HTTP/1.1 404"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
