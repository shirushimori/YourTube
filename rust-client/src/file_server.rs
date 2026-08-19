use std::net::SocketAddr;
use anyhow::{Context, Result};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::TcpListener;

const VIDEO_MIME_TYPES: &[(&str, &str)] = &[
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("mkv", "video/x-matroska"),
    ("avi", "video/x-msvideo"),
    ("mov", "video/quicktime"),
    ("flv", "video/x-flv"),
    ("wmv", "video/x-ms-wmv"),
    ("m4v", "video/x-m4v"),
    ("mp3", "audio/mpeg"),
    ("wav", "audio/wav"),
    ("flac", "audio/flac"),
    ("aac", "audio/aac"),
    ("ogg", "audio/ogg"),
    ("opus", "audio/opus"),
    ("m4a", "audio/mp4"),
];

fn guess_mime(path: &str) -> &str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    for (e, mime) in VIDEO_MIME_TYPES {
        if *e == ext {
            return mime;
        }
    }
    "application/octet-stream"
}

pub struct FileServer {
    addr: SocketAddr,
}

impl FileServer {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

pub async fn start_file_server(path: &str) -> Result<FileServer> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("Failed to bind file server")?;

    let addr = listener.local_addr()?;
    let path = path.to_string();

    tokio::spawn(async move {
        loop {
            let (mut stream, _) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => continue,
            };

            let path = path.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = match stream.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");

                if !first_line.starts_with("GET ") {
                    let resp = b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n";
                    let _ = stream.write_all(resp).await;
                    return;
                }

                let mut file = match tokio::fs::File::open(&path).await {
                    Ok(f) => f,
                    Err(_) => {
                        let resp = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                        let _ = stream.write_all(resp).await;
                        return;
                    }
                };

                let file_len = match file.metadata().await {
                    Ok(m) => m.len(),
                    Err(_) => 0,
                };

                let mime = guess_mime(&path);

                // Parse Range header if present (e.g. "Range: bytes=0-1024")
                let mut range_start: Option<u64> = None;
                let mut range_end: Option<u64> = None;

                for line in request.lines() {
                    let lower = line.to_lowercase();
                    if lower.starts_with("range: bytes=") {
                        let val = &line[13..].trim();
                        let parts: Vec<&str> = val.split('-').collect();
                        if let Ok(s) = parts[0].trim().parse::<u64>() {
                            range_start = Some(s);
                        }
                        if parts.len() > 1 && !parts[1].trim().is_empty() {
                            if let Ok(e) = parts[1].trim().parse::<u64>() {
                                range_end = Some(e);
                            }
                        }
                        break;
                    }
                }

                if let Some(start) = range_start {
                    let end = range_end.unwrap_or(file_len.saturating_sub(1)).min(file_len.saturating_sub(1));
                    let chunk_len = if end >= start { end - start + 1 } else { 0 };

                    let header = format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                        mime,
                        chunk_len,
                        start,
                        end,
                        file_len
                    );

                    let _ = stream.write_all(header.as_bytes()).await;
                    let _ = file.seek(std::io::SeekFrom::Start(start)).await;

                    let mut remaining = chunk_len;
                    let mut chunk_buf = vec![0u8; 64 * 1024];
                    while remaining > 0 {
                        let to_read = (remaining as usize).min(chunk_buf.len());
                        let bytes_read = match file.read(&mut chunk_buf[..to_read]).await {
                            Ok(n) if n > 0 => n,
                            _ => break,
                        };
                        if stream.write_all(&chunk_buf[..bytes_read]).await.is_err() {
                            break;
                        }
                        remaining = remaining.saturating_sub(bytes_read as u64);
                    }
                } else {
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                        mime,
                        file_len
                    );

                    let _ = stream.write_all(header.as_bytes()).await;

                    let mut chunk_buf = vec![0u8; 64 * 1024];
                    loop {
                        let bytes_read = match file.read(&mut chunk_buf).await {
                            Ok(n) if n > 0 => n,
                            _ => break,
                        };
                        if stream.write_all(&chunk_buf[..bytes_read]).await.is_err() {
                            break;
                        }
                    }
                }
            });
        }
    });

    Ok(FileServer { addr })
}
