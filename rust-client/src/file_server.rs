use std::net::SocketAddr;
use anyhow::{Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
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

                let mime = guess_mime(&path);
                let file_bytes = match tokio::fs::read(&path).await {
                    Ok(b) => b,
                    Err(_) => {
                        let resp = b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                        let _ = stream.write_all(resp).await;
                        return;
                    }
                };

                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                    mime,
                    file_bytes.len()
                );

                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&file_bytes).await;
            });
        }
    });

    Ok(FileServer { addr })
}
