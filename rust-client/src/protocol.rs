use serde::{Deserialize, Serialize};

/// Envelope for native messaging messages, optionally retaining request correlation ID.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NativeMessage<T = Request> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(flatten)]
    pub payload: T,
}

impl<T> NativeMessage<T> {
    pub fn new(payload: T) -> Self {
        Self { id: None, payload }
    }

    pub fn with_id(id: Option<String>, payload: T) -> Self {
        Self { id, payload }
    }
}

/// Incoming request from the browser extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Request {
    #[serde(alias = "fetchMetadata", alias = "get_metadata", alias = "metadata")]
    FetchMetadata {
        url: String,
    },
    #[serde(alias = "downloadVideo", alias = "download_video")]
    Download {
        url: String,
        #[serde(default = "default_download_type", alias = "downloadType")]
        download_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        quality: Option<String>,
        #[serde(default, alias = "outputDir", skip_serializing_if = "Option::is_none")]
        output_dir: Option<String>,
        #[serde(default, alias = "startTime", skip_serializing_if = "Option::is_none")]
        start_time: Option<String>,
        #[serde(default, alias = "endTime", skip_serializing_if = "Option::is_none")]
        end_time: Option<String>,
    },
}

fn default_download_type() -> String {
    "video_audio".to_string()
}

/// Outgoing response sent back to the browser extension.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    #[serde(rename = "metadata")]
    Metadata {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        thumbnail: Option<String>,
        formats: Vec<FormatInfo>,
    },
    #[serde(rename = "download_progress", alias = "progress", alias = "downloadProgress")]
    DownloadProgress {
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        percent: Option<f32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        speed: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        eta: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total_size: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        downloaded: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
    },
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Response::Error {
            message: message.into(),
        }
    }
}

/// Detailed information about a single media format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FormatInfo {
    pub format_id: String,
    #[serde(rename = "extension", alias = "ext")]
    pub extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filesize: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vcodec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acodec: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_fetch_metadata() {
        let json = r#"{"type":"fetch_metadata","url":"https://youtu.be/test"}"#;
        let req: Request = serde_json::from_str(json).unwrap();
        match req {
            Request::FetchMetadata { url } => assert_eq!(url, "https://youtu.be/test"),
            _ => panic!("Expected FetchMetadata"),
        }
    }

    #[test]
    fn test_deserialize_download() {
        let json = r#"{"type":"download","url":"https://youtu.be/test","download_type":"video_audio","quality":"1080p","output_dir":"/downloads"}"#;
        let req: Request = serde_json::from_str(json).unwrap();
        match req {
            Request::Download {
                url,
                download_type,
                quality,
                output_dir,
                start_time,
                end_time,
            } => {
                assert_eq!(url, "https://youtu.be/test");
                assert_eq!(download_type, "video_audio");
                assert_eq!(quality, Some("1080p".to_string()));
                assert_eq!(output_dir, Some("/downloads".to_string()));
                assert_eq!(start_time, None);
                assert_eq!(end_time, None);
            }
            _ => panic!("Expected Download"),
        }
    }

    #[test]
    fn test_native_message_envelope() {
        let json = r#"{"id":"msg-42","type":"fetch_metadata","url":"https://youtu.be/test"}"#;
        let msg: NativeMessage<Request> = serde_json::from_str(json).unwrap();
        assert_eq!(msg.id, Some("msg-42".to_string()));
        match msg.payload {
            Request::FetchMetadata { url } => assert_eq!(url, "https://youtu.be/test"),
            _ => panic!("Expected FetchMetadata"),
        }

        let resp_msg = NativeMessage::with_id(
            msg.id,
            Response::Metadata {
                title: "Test Video".to_string(),
                duration: Some(120.0),
                thumbnail: Some("https://example.com/thumb.jpg".to_string()),
                formats: vec![],
            },
        );
        let serialized = serde_json::to_string(&resp_msg).unwrap();
        assert!(serialized.contains(r#""id":"msg-42""#));
        assert!(serialized.contains(r#""type":"metadata""#));
        assert!(serialized.contains(r#""title":"Test Video""#));
    }
}
