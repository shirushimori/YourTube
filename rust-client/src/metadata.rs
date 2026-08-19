#![allow(dead_code)]
use std::path::PathBuf;
use anyhow::{Context, Result};
use serde::Deserialize;
use tokio::process::Command;

use crate::protocol::{FormatInfo, Response};

#[derive(Debug, Deserialize)]
struct YtDlpThumbnail {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpFormat {
    format_id: Option<String>,
    ext: Option<String>,
    resolution: Option<String>,
    width: Option<u64>,
    height: Option<u64>,
    fps: Option<f64>,
    filesize: Option<u64>,
    filesize_approx: Option<u64>,
    vcodec: Option<String>,
    acodec: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpOutput {
    title: Option<String>,
    description: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    thumbnails: Option<Vec<YtDlpThumbnail>>,
    view_count: Option<u64>,
    like_count: Option<u64>,
    channel: Option<String>,
    uploader: Option<String>,
    upload_date: Option<String>,
    webpage_url: Option<String>,
    extractor: Option<String>,
    formats: Option<Vec<YtDlpFormat>>,
}

/// Locates the `yt-dlp` executable.
/// Priority:
/// 1. `YT_DLP` environment variable
/// 2. Sibling executable in the same directory as this binary
/// 3. Current working directory (`./yt-dlp`)
/// 4. PATH lookup (`yt-dlp`)
pub fn find_yt_dlp() -> PathBuf {
    if let Ok(path) = std::env::var("YT_DLP") {
        if std::path::Path::new(&path).is_file() {
            return PathBuf::from(path);
        }
    }

    if let Ok(mut exe_path) = std::env::current_exe() {
        exe_path.pop();
        let bundled = exe_path.join("yt-dlp");
        if bundled.is_file() {
            return bundled;
        }
        #[cfg(windows)]
        {
            let bundled_win = exe_path.join("yt-dlp.exe");
            if bundled_win.is_file() {
                return bundled_win;
            }
        }
    }

    let local = PathBuf::from("./yt-dlp");
    if local.is_file() {
        return local;
    }
    #[cfg(windows)]
    {
        let local_win = PathBuf::from("./yt-dlp.exe");
        if local_win.is_file() {
            return local_win;
        }
    }

    PathBuf::from("yt-dlp")
}

/// Parses yt-dlp JSON stdout output into a `Response::Metadata`.
pub fn parse_metadata_json(json_bytes: &[u8]) -> Result<Response> {
    let parsed: YtDlpOutput = serde_json::from_slice(json_bytes)
        .context("Failed to parse yt-dlp JSON output")?;

    let thumbnail = parsed.thumbnail.or_else(|| {
        parsed
            .thumbnails
            .and_then(|thumbs| thumbs.into_iter().rev().find_map(|t| t.url))
    });

    let formats = parsed
        .formats
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| {
            let format_id = f.format_id?;
            let extension = f.ext.unwrap_or_else(|| "mp4".to_string());
            let resolution = f.resolution.or_else(|| match (f.width, f.height) {
                (Some(w), Some(h)) => Some(format!("{}x{}", w, h)),
                _ => None,
            });
            let filesize = f.filesize.or(f.filesize_approx);

            Some(FormatInfo {
                format_id,
                extension,
                resolution,
                fps: f.fps,
                filesize,
                vcodec: f.vcodec.filter(|c| c != "none"),
                acodec: f.acodec.filter(|c| c != "none"),
            })
        })
        .collect();

    Ok(Response::Metadata {
        title: parsed.title.unwrap_or_else(|| "Unknown Title".to_string()),
        description: parsed.description,
        duration: parsed.duration,
        thumbnail,
        view_count: parsed.view_count,
        like_count: parsed.like_count,
        channel: parsed.channel.or(parsed.uploader),
        upload_date: parsed.upload_date,
        source: parsed.webpage_url,
        formats,
    })
}

/// Executes yt-dlp with `--dump-single-json --no-download <url>` and returns parsed metadata.
pub async fn fetch_metadata(url: &str) -> Result<Response> {
    let yt_dlp_bin = find_yt_dlp();

    let output = Command::new(&yt_dlp_bin)
        .arg("--dump-single-json")
        .arg("--no-download")
        .arg("--no-warnings")
        .arg("--js-runtimes")
        .arg("node")
        .arg(url)
        .output()
        .await
        .with_context(|| format!("Failed to execute yt-dlp at {:?}", yt_dlp_bin))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("yt-dlp failed: {}", stderr.trim());
    }

    parse_metadata_json(&output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_metadata_json() {
        let sample_json = r#"{
            "title": "Example Video",
            "duration": 182.5,
            "thumbnail": "https://example.com/thumb.jpg",
            "formats": [
                {
                    "format_id": "137",
                    "ext": "mp4",
                    "resolution": "1920x1080",
                    "fps": 30.0,
                    "filesize": 10485760,
                    "vcodec": "avc1.640028",
                    "acodec": "none"
                },
                {
                    "format_id": "140",
                    "ext": "m4a",
                    "resolution": "audio only",
                    "fps": null,
                    "filesize_approx": 2048000,
                    "vcodec": "none",
                    "acodec": "mp4a.40.2"
                }
            ]
        }"#;

        let res = parse_metadata_json(sample_json.as_bytes()).expect("Should parse metadata");
        match res {
            Response::Metadata {
                title,
                duration,
                thumbnail,
                formats,
                ..
            } => {
                assert_eq!(title, "Example Video");
                assert_eq!(duration, Some(182.5));
                assert_eq!(thumbnail, Some("https://example.com/thumb.jpg".to_string()));
                assert_eq!(formats.len(), 2);
                assert_eq!(formats[0].format_id, "137");
                assert_eq!(formats[0].extension, "mp4");
                assert_eq!(formats[0].filesize, Some(10485760));
                assert_eq!(formats[0].vcodec, Some("avc1.640028".to_string()));
                assert_eq!(formats[0].acodec, None);

                assert_eq!(formats[1].format_id, "140");
                assert_eq!(formats[1].filesize, Some(2048000));
                assert_eq!(formats[1].vcodec, None);
                assert_eq!(formats[1].acodec, Some("mp4a.40.2".to_string()));
            }
            _ => panic!("Expected Response::Metadata"),
        }
    }
}
