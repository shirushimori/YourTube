use std::sync::LazyLock;
use regex::Regex;
use crate::protocol::Response;

static RE_DOWNLOADING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+([0-9]+(?:\.[0-9]+)?)%\s+of\s+(?:~\s*)?([0-9.]+[A-Za-z]+)\s+at\s+([0-9.]+[A-Za-z]+(?:/s)?)\s+ETA\s+([0-9:]+|Unknown|\S+)").unwrap()
});

static RE_COMPLETED_IN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+100(?:\.0+)?%\s+of\s+(?:~\s*)?([0-9.]+[A-Za-z]+)\s+in\s+([0-9:]+)(?:\s+at\s+([0-9.]+[A-Za-z]+(?:/s)?))?").unwrap()
});

static RE_GENERIC_PERCENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+([0-9]+(?:\.[0-9]+)?)%\s+of\s+(?:~\s*)?([0-9.]+[A-Za-z]+)").unwrap()
});

static RE_DESTINATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+Destination:\s+(.+)").unwrap()
});

static RE_ALREADY_DOWNLOADED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+(.+)\s+has already been downloaded").unwrap()
});

static RE_SIZE_PARSER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([0-9.]+)\s*([A-Za-z]+)$").unwrap()
});

/// Calculates the downloaded size string based on completion percentage and total size.
fn calculate_downloaded(percent: f32, total_size_str: &str) -> Option<String> {
    let caps = RE_SIZE_PARSER.captures(total_size_str.trim())?;
    let val: f64 = caps.get(1)?.as_str().parse().ok()?;
    let unit = caps.get(2)?.as_str();
    let downloaded_val = val * (percent as f64 / 100.0);
    Some(format!("{:.2}{}", downloaded_val, unit))
}

/// Parses a single line of yt-dlp output into a structured DownloadProgress response.
pub fn parse_progress_line(line: &str) -> Option<Response> {
    let trimmed = line.trim();

    // 1. Check standard downloading line: [download] 78.5% of 1.08GiB at 18.4MiB/s ETA 00:13
    if let Some(caps) = RE_DOWNLOADING.captures(trimmed) {
        let percent: f32 = caps.get(1)?.as_str().parse().ok()?;
        let total_size = caps.get(2)?.as_str().to_string();
        let speed = caps.get(3)?.as_str().to_string();
        let eta = caps.get(4)?.as_str().to_string();
        let downloaded = calculate_downloaded(percent, &total_size);
        let status = if percent >= 100.0 {
            "finished".to_string()
        } else {
            "downloading".to_string()
        };

        return Some(Response::DownloadProgress {
            status,
            percent: Some(percent),
            speed: Some(speed),
            eta: Some(eta),
            total_size: Some(total_size),
            downloaded,
        });
    }

    // 2. Check completion line: [download] 100% of 1.08GiB in 00:01
    if let Some(caps) = RE_COMPLETED_IN.captures(trimmed) {
        let total_size = caps.get(1)?.as_str().to_string();
        let speed = caps.get(3).map(|m| m.as_str().to_string());
        return Some(Response::DownloadProgress {
            status: "finished".to_string(),
            percent: Some(100.0),
            speed,
            eta: Some("00:00".to_string()),
            total_size: Some(total_size.clone()),
            downloaded: Some(total_size),
        });
    }

    // 3. Check fallback percent line: [download] 50.0% of 10.00MiB
    if let Some(caps) = RE_GENERIC_PERCENT.captures(trimmed) {
        let percent: f32 = caps.get(1)?.as_str().parse().ok()?;
        let total_size = caps.get(2)?.as_str().to_string();
        let downloaded = calculate_downloaded(percent, &total_size);
        let status = if percent >= 100.0 {
            "finished".to_string()
        } else {
            "downloading".to_string()
        };

        return Some(Response::DownloadProgress {
            status,
            percent: Some(percent),
            speed: None,
            eta: None,
            total_size: Some(total_size),
            downloaded,
        });
    }

    // 4. Starting destination
    if RE_DESTINATION.is_match(trimmed) {
        return Some(Response::DownloadProgress {
            status: "starting".to_string(),
            percent: Some(0.0),
            speed: None,
            eta: None,
            total_size: None,
            downloaded: None,
        });
    }

    // 5. Already downloaded
    if RE_ALREADY_DOWNLOADED.is_match(trimmed) {
        return Some(Response::DownloadProgress {
            status: "finished".to_string(),
            percent: Some(100.0),
            speed: None,
            eta: None,
            total_size: None,
            downloaded: None,
        });
    }

    // 6. Post-processing steps
    if trimmed.starts_with("[Merger]") {
        return Some(Response::DownloadProgress {
            status: "merging".to_string(),
            percent: Some(100.0),
            speed: None,
            eta: None,
            total_size: None,
            downloaded: None,
        });
    }

    if trimmed.starts_with("[ExtractAudio]") {
        return Some(Response::DownloadProgress {
            status: "extracting_audio".to_string(),
            percent: Some(100.0),
            speed: None,
            eta: None,
            total_size: None,
            downloaded: None,
        });
    }

    if trimmed.starts_with("[Fixup") || trimmed.starts_with("[ffmpeg]") {
        return Some(Response::DownloadProgress {
            status: "processing".to_string(),
            percent: Some(100.0),
            speed: None,
            eta: None,
            total_size: None,
            downloaded: None,
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_standard_progress() {
        let line = "[download]  78.5% of 1.08GiB at 18.4MiB/s ETA 00:13";
        let progress = parse_progress_line(line).expect("Should parse progress line");

        match progress {
            Response::DownloadProgress {
                status,
                percent,
                speed,
                eta,
                total_size,
                downloaded,
            } => {
                assert_eq!(status, "downloading");
                assert_eq!(percent, Some(78.5));
                assert_eq!(speed, Some("18.4MiB/s".to_string()));
                assert_eq!(eta, Some("00:13".to_string()));
                assert_eq!(total_size, Some("1.08GiB".to_string()));
                assert_eq!(downloaded, Some("0.85GiB".to_string()));
            }
            _ => panic!("Expected DownloadProgress"),
        }
    }

    #[test]
    fn test_parse_progress_with_tilde() {
        let line = "[download]  12.3% of ~ 15.20MiB at  2.45MiB/s ETA 00:05";
        let progress = parse_progress_line(line).expect("Should parse progress line");

        match progress {
            Response::DownloadProgress {
                status,
                percent,
                speed,
                eta,
                total_size,
                downloaded,
            } => {
                assert_eq!(status, "downloading");
                assert_eq!(percent, Some(12.3));
                assert_eq!(speed, Some("2.45MiB/s".to_string()));
                assert_eq!(eta, Some("00:05".to_string()));
                assert_eq!(total_size, Some("15.20MiB".to_string()));
                assert_eq!(downloaded, Some("1.87MiB".to_string()));
            }
            _ => panic!("Expected DownloadProgress"),
        }
    }

    #[test]
    fn test_parse_completed_in() {
        let line = "[download] 100% of 1.08GiB in 00:01 at 18.4MiB/s";
        let progress = parse_progress_line(line).expect("Should parse completion line");

        match progress {
            Response::DownloadProgress {
                status,
                percent,
                speed,
                eta,
                total_size,
                downloaded,
            } => {
                assert_eq!(status, "finished");
                assert_eq!(percent, Some(100.0));
                assert_eq!(speed, Some("18.4MiB/s".to_string()));
                assert_eq!(eta, Some("00:00".to_string()));
                assert_eq!(total_size, Some("1.08GiB".to_string()));
                assert_eq!(downloaded, Some("1.08GiB".to_string()));
            }
            _ => panic!("Expected DownloadProgress"),
        }
    }

    #[test]
    fn test_parse_merger_and_audio() {
        let merger_line = "[Merger] Merging formats into \"output.mp4\"";
        let progress = parse_progress_line(merger_line).expect("Should parse merger line");
        match progress {
            Response::DownloadProgress { status, .. } => assert_eq!(status, "merging"),
            _ => panic!("Expected DownloadProgress"),
        }

        let audio_line = "[ExtractAudio] Destination: output.mp3";
        let progress = parse_progress_line(audio_line).expect("Should parse extract audio line");
        match progress {
            Response::DownloadProgress { status, .. } => assert_eq!(status, "extracting_audio"),
            _ => panic!("Expected DownloadProgress"),
        }
    }
}
