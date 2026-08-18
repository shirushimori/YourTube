use std::future::Future;
use std::process::Stdio;
use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::metadata::find_yt_dlp;
use crate::progress::parse_progress_line;
use crate::protocol::Response;

pub fn sanitize_quality(quality: &str) -> Option<String> {
    let q = quality.trim().to_lowercase();
    if q == "best" || q == "max" || q.is_empty() {
        return None;
    }
    if q == "4k" || q == "2160" || q == "2160p" {
        return Some("2160".to_string());
    }
    if q == "2k" || q == "1440" || q == "1440p" {
        return Some("1440".to_string());
    }
    let digits: String = q.chars().filter(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        Some(digits)
    } else {
        None
    }
}

/// Builds the argument list for yt-dlp based on the download options.
pub fn build_yt_dlp_args(
    url: &str,
    download_type: &str,
    quality: Option<&str>,
    output_dir: Option<&str>,
    start_time: Option<&str>,
    end_time: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["--newline".to_string()];

    match download_type {
        "audio_only" => {
            args.extend([
                "-f".to_string(),
                "bestaudio/best".to_string(),
                "--extract-audio".to_string(),
                "--audio-format".to_string(),
                "mp3".to_string(),
            ]);
        }
        "video_only" => {
            if let Some(height) = quality.and_then(sanitize_quality) {
                args.extend([
                    "-f".to_string(),
                    format!("bestvideo[height<={height}]/bestvideo"),
                ]);
            } else {
                args.extend(["-f".to_string(), "bestvideo".to_string()]);
            }
        }
        _ => {
            // "video_audio" or default
            if let Some(height) = quality.and_then(sanitize_quality) {
                args.extend([
                    "-f".to_string(),
                    format!("bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"),
                ]);
            } else {
                args.extend(["-f".to_string(), "bestvideo+bestaudio/best".to_string()]);
            }
        }
    }

    let out_template = match output_dir {
        Some(dir) if !dir.trim().is_empty() => {
            let clean_dir = dir.trim().trim_end_matches('/');
            format!("{}/%(title)s.%(ext)s", clean_dir)
        }
        _ => "%(title)s.%(ext)s".to_string(),
    };
    args.extend(["-o".to_string(), out_template]);

    let section = match (start_time, end_time) {
        (Some(s), Some(e)) if !s.trim().is_empty() && !e.trim().is_empty() => {
            Some(format!("*{}-{}", s.trim(), e.trim()))
        }
        (Some(s), _) if !s.trim().is_empty() => Some(format!("*{}-inf", s.trim())),
        (_, Some(e)) if !e.trim().is_empty() => Some(format!("*0-{}", e.trim())),
        _ => None,
    };
    if let Some(sec) = section {
        args.extend(["--download-sections".to_string(), sec]);
    }

    args.push(url.to_string());
    args
}

/// Spawns a yt-dlp child process to download the requested media and streams progress updates.
pub async fn download<F, Fut>(
    url: &str,
    download_type: &str,
    quality: Option<&str>,
    output_dir: Option<&str>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    mut on_progress: F,
) -> Result<()>
where
    F: FnMut(Response) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let yt_dlp_bin = find_yt_dlp();
    let args = build_yt_dlp_args(
        url,
        download_type,
        quality,
        output_dir,
        start_time,
        end_time,
    );

    let mut cmd = Command::new(&yt_dlp_bin);
    cmd.args(&args);
    cmd.arg("--js-runtimes").arg("node");
    cmd.arg("--extractor-args").arg("youtube:player_client=web_creator,web");
    cmd.arg("--cookies-from-browser").arg("firefox");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .with_context(|| format!("Failed to spawn yt-dlp from {:?}", yt_dlp_bin))?;

    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");

    // Concurrently consume stderr to capture error logs and avoid deadlocks
    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut err_lines = Vec::new();
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line).await {
            if n == 0 {
                break;
            }
            err_lines.push(line.clone());
            line.clear();
        }
        err_lines.join("")
    });

    let mut reader = BufReader::new(stdout).lines();
    let mut sent_finished = false;

    while let Ok(Some(line)) = reader.next_line().await {
        if let Some(resp) = parse_progress_line(&line) {
            if let Response::DownloadProgress { ref status, .. } = resp {
                if status == "finished" {
                    sent_finished = true;
                }
            }
            on_progress(resp).await;
        }
    }

    let status = child
        .wait()
        .await
        .context("Failed to wait on yt-dlp child process")?;
    let stderr_output = stderr_handle.await.unwrap_or_default();

    if !status.success() {
        anyhow::bail!("yt-dlp download failed: {}", stderr_output.trim());
    }

    if !sent_finished {
        on_progress(Response::DownloadProgress {
            status: "finished".to_string(),
            percent: Some(100.0),
            speed: None,
            eta: Some("00:00".to_string()),
            total_size: None,
            downloaded: None,
        })
        .await;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_quality() {
        assert_eq!(sanitize_quality("1080p"), Some("1080".to_string()));
        assert_eq!(sanitize_quality("720P"), Some("720".to_string()));
        assert_eq!(sanitize_quality("4k"), Some("2160".to_string()));
        assert_eq!(sanitize_quality("2k"), Some("1440".to_string()));
        assert_eq!(sanitize_quality("best"), None);
        assert_eq!(sanitize_quality(""), None);
    }

    #[test]
    fn test_build_yt_dlp_args_video_audio() {
        let args = build_yt_dlp_args(
            "https://youtu.be/test",
            "video_audio",
            Some("1080p"),
            Some("/tmp/downloads"),
            Some("00:01:00"),
            Some("00:02:00"),
        );
        assert!(args.contains(&"--newline".to_string()));
        assert!(args.contains(&"bestvideo[height<=1080]+bestaudio/best[height<=1080]/best".to_string()));
        assert!(args.contains(&"/tmp/downloads/%(title)s.%(ext)s".to_string()));
        assert!(args.contains(&"*00:01:00-00:02:00".to_string()));
        assert_eq!(args.last(), Some(&"https://youtu.be/test".to_string()));
    }

    #[test]
    fn test_build_yt_dlp_args_audio_only() {
        let args = build_yt_dlp_args(
            "https://youtu.be/test",
            "audio_only",
            None,
            None,
            None,
            None,
        );
        assert!(args.contains(&"--extract-audio".to_string()));
        assert!(args.contains(&"mp3".to_string()));
        assert!(args.contains(&"%(title)s.%(ext)s".to_string()));
    }

    #[test]
    fn test_build_yt_dlp_args_video_only() {
        let args = build_yt_dlp_args(
            "https://youtu.be/test",
            "video_only",
            Some("720p"),
            None,
            None,
            None,
        );
        assert!(args.contains(&"bestvideo[height<=720]/bestvideo".to_string()));
    }
}
