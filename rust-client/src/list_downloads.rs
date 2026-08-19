use anyhow::Result;
use crate::protocol::{DownloadFile, Response};

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "webm", "mkv", "avi", "mov", "flv", "wmv", "m4v",
    "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a",
];

pub fn list_downloads(directory: &str) -> Result<Response> {
    // Expand ~ to home directory
    let expanded = if directory.starts_with("~/") || directory == "~" {
        if let Some(home) = dirs::home_dir() {
            if directory.len() > 2 {
                home.join(&directory[2..]).to_string_lossy().to_string()
            } else {
                home.to_string_lossy().to_string()
            }
        } else {
            directory.to_string()
        }
    } else {
        directory.to_string()
    };

    let dir = std::path::Path::new(&expanded);
    if !dir.exists() {
        let _ = std::fs::create_dir_all(dir);
    }

    if !dir.is_dir() {
        return Ok(Response::DownloadsList {
            directory: expanded,
            files: Vec::new(),
        });
    }

    let mut files = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => {
            return Ok(Response::DownloadsList {
                directory: expanded,
                files: Vec::new(),
            });
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_info) = process_file(&path) {
                files.push(file_info);
            }
        } else if path.is_dir() {
            // Also scan 1 level of subdirectories (e.g. playlist folders)
            if let Ok(sub_entries) = std::fs::read_dir(&path) {
                for sub_entry in sub_entries.flatten() {
                    let sub_path = sub_entry.path();
                    if sub_path.is_file() {
                        if let Some(file_info) = process_file(&sub_path) {
                            files.push(file_info);
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(Response::DownloadsList {
        directory: expanded,
        files,
    })
}

fn process_file(path: &std::path::Path) -> Option<DownloadFile> {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    match &ext {
        Some(e) if VIDEO_EXTENSIONS.contains(&e.as_str()) => {}
        _ => return None,
    }

    let metadata = std::fs::metadata(path).ok()?;
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

    Some(DownloadFile {
        name,
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        modified,
        ext,
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
