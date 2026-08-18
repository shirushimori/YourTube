use std::path::Path;
use anyhow::{Context, Result};
use crate::protocol::{DownloadFile, Response};

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "webm", "mkv", "avi", "mov", "flv", "wmv", "m4v",
    "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a",
];

pub fn list_downloads(directory: &str) -> Result<Response> {
    let dir = Path::new(directory);
    if !dir.is_dir() {
        anyhow::bail!("Directory does not exist: {}", directory);
    }

    let mut files = Vec::new();

    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("Failed to read directory: {}", directory))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());

        match &ext {
            Some(e) if VIDEO_EXTENSIONS.contains(&e.as_str()) => {}
            _ => continue,
        }

        let metadata = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let modified = metadata.modified()
            .ok()
            .and_then(|t| {
                let dur = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                Some(chrono_timestamp(dur.as_secs()))
            })
            .unwrap_or_default();

        files.push(DownloadFile {
            name,
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            modified,
            ext,
        });
    }

    files.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(Response::DownloadsList {
        directory: directory.to_string(),
        files,
    })
}

fn chrono_timestamp(secs: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if now > secs {
        let diff = now - secs;
        let hours = diff / 3600;
        let minutes = (diff % 3600) / 60;

        if hours < 1 {
            format!("{}m ago", minutes)
        } else if hours < 24 {
            format!("{}h {}m ago", hours, minutes)
        } else {
            let days = hours / 24;
            format!("{}d ago", days)
        }
    } else {
        "just now".to_string()
    }
}
