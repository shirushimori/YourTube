mod downloader;
mod file_server;
mod installer;
mod list_downloads;
mod metadata;
mod progress;
mod protocol;
mod tui;

use std::io::ErrorKind;
use anyhow::Result;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use protocol::{NativeMessage, Request, Response};

async fn read_message<R: AsyncReadExt + Unpin>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_le_bytes(len_buf) as usize;
    if len == 0 {
        return Ok(Some(Vec::new()));
    }

    if len > 10 * 1024 * 1024 {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            "Message length exceeds 10MB limit",
        ));
    }

    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload).await?;
    Ok(Some(payload))
}

async fn write_message<W: AsyncWriteExt + Unpin, T: serde::Serialize>(
    writer: &mut W,
    msg: &T,
) -> std::io::Result<()> {
    let json_bytes = serde_json::to_vec(msg)
        .map_err(|e| std::io::Error::new(ErrorKind::InvalidData, e))?;
    let len = (json_bytes.len() as u32).to_le_bytes();
    writer.write_all(&len).await?;
    writer.write_all(&json_bytes).await?;
    writer.flush().await?;
    Ok(())
}

async fn run_native_messaging() -> Result<()> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<NativeMessage<Response>>(128);

    let writer_handle = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(msg) = rx.recv().await {
            if let Err(err) = write_message(&mut stdout, &msg).await {
                eprintln!("Error writing message to stdout: {err}");
                break;
            }
        }
    });

    let mut stdin = tokio::io::stdin();

    loop {
        let msg_bytes = match read_message(&mut stdin).await {
            Ok(Some(bytes)) => bytes,
            Ok(None) => break,
            Err(err) => {
                eprintln!("Error reading native message: {err}");
                break;
            }
        };

        if msg_bytes.is_empty() {
            continue;
        }

        let native_req: Result<NativeMessage<Request>, _> = serde_json::from_slice(&msg_bytes);

        let tx = tx.clone();
        tokio::spawn(async move {
            match native_req {
                Ok(NativeMessage { id, payload }) => match payload {
                    Request::FetchMetadata { url } => {
                        match metadata::fetch_metadata(&url).await {
                            Ok(resp) => {
                                let _ = tx.send(NativeMessage::with_id(id, resp)).await;
                            }
                            Err(err) => {
                                let _ = tx
                                    .send(NativeMessage::with_id(id, Response::error(err.to_string())))
                                    .await;
                            }
                        }
                    }
                    Request::Download {
                        url,
                        download_type,
                        quality,
                        audio_format,
                        audio_bitrate,
                        output_dir,
                        start_time,
                        end_time,
                        download_metadata,
                    } => {
                        let req_id = id.clone();
                        let tx_progress = tx.clone();
                        let progress_sender = move |resp: Response| {
                            let tx = tx_progress.clone();
                            let req_id = req_id.clone();
                            async move {
                                let _ = tx.send(NativeMessage::with_id(req_id, resp)).await;
                            }
                        };

                        if let Err(err) = downloader::download(
                            &url,
                            &download_type,
                            quality.as_deref(),
                            audio_format.as_deref(),
                            audio_bitrate.as_deref(),
                            output_dir.as_deref(),
                            start_time.as_deref(),
                            end_time.as_deref(),
                            download_metadata,
                            progress_sender,
                        )
                        .await
                        {
                            let _ = tx
                                .send(NativeMessage::with_id(id, Response::error(err.to_string())))
                                .await;
                        }
                    }
                    Request::ListDownloads { directory } => {
                        let default_dir = dirs::video_dir()
                            .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
                            .to_string_lossy()
                            .into_owned();
                        let dir = directory.as_deref()
                            .unwrap_or(&default_dir);
                        match list_downloads::list_downloads(dir) {
                            Ok(resp) => {
                                let _ = tx.send(NativeMessage::with_id(id, resp)).await;
                            }
                            Err(err) => {
                                let _ = tx
                                    .send(NativeMessage::with_id(id, Response::error(err.to_string())))
                                    .await;
                            }
                        }
                    }
                    Request::ServeFile { path } => {
                        match file_server::start_file_server(&path).await {
                            Ok(server) => {
                                let url = format!("http://127.0.0.1:{}/video", server.addr().port());
                                let _ = tx.send(NativeMessage::with_id(id, Response::FileServed {
                                    url,
                                    path,
                                })).await;
                            }
                            Err(err) => {
                                let _ = tx
                                    .send(NativeMessage::with_id(id, Response::error(err.to_string())))
                                    .await;
                            }
                        }
                    }
                },
                Err(err) => {
                    let _ = tx
                        .send(NativeMessage::new(Response::error(format!(
                            "Invalid request JSON: {err}"
                        ))))
                        .await;
                }
            }
        });
    }

    drop(tx);
    let _ = writer_handle.await;
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--install") {
        let runtime = tokio::runtime::Runtime::new()?;
        runtime.block_on(async {
            installer::install().await
        })?;
        return Ok(());
    }

    if args.iter().any(|a| a == "--tui") {
        let runtime = tokio::runtime::Runtime::new()?;
        runtime.block_on(async {
            tui::run_tui()
        })?;
        return Ok(());
    }

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(run_native_messaging())
}
