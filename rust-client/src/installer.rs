use std::path::PathBuf;
use std::fs;
use anyhow::{Context, Result};

#[cfg(windows)]
use winreg::{enums::*, RegKey};

fn get_install_dir() -> PathBuf {
    #[cfg(windows)]
    {
        dirs::data_local_dir().unwrap_or_default().join("YourTube")
    }
    #[cfg(not(windows))]
    {
        dirs::home_dir().unwrap_or_default().join(".local").join("bin")
    }
}

fn get_binary_extension() -> &'static str {
    if cfg!(windows) {
        ".exe"
    } else {
        ""
    }
}

pub async fn install() -> Result<()> {
    println!("=== YourTube Installer ===");

    let install_dir = get_install_dir();
    if !install_dir.exists() {
        fs::create_dir_all(&install_dir)?;
    }

    let client_exe = std::env::current_exe().context("Failed to get current executable path")?;
    let target_client = install_dir.join(format!("yourtube-client{}", get_binary_extension()));

    println!("Copying client to {:?}", target_client);
    fs::copy(&client_exe, &target_client)?;

    let yt_dlp_name = format!("yt-dlp{}", get_binary_extension());
    let target_yt_dlp = install_dir.join(&yt_dlp_name);

    println!("Downloading {}...", yt_dlp_name);
    download_yt_dlp(&target_yt_dlp).await?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target_client, fs::Permissions::from_mode(0o755))?;
        fs::set_permissions(&target_yt_dlp, fs::Permissions::from_mode(0o755))?;
    }

    let manifest_path = target_client.to_string_lossy().to_string();
    // Escape backslashes for JSON on Windows
    let manifest_path = manifest_path.replace("\\", "\\\\");

    println!("Installing browser manifests...");
    install_browser_manifests(&manifest_path)?;

    println!("\nInstallation complete! You can now use the YourTube extension.");
    Ok(())
}

async fn download_yt_dlp(target_path: &PathBuf) -> Result<()> {
    let url = if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    let response = reqwest::get(url).await?.error_for_status()?;
    let bytes = response.bytes().await?;
    tokio::fs::write(target_path, &bytes).await?;

    Ok(())
}

fn install_browser_manifests(binary_path: &str) -> Result<()> {
    let chrome_manifest = format!(
        r#"{{
  "name": "com.yourtube.client",
  "description": "YourTube yt-dlp client",
  "path": "{}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}}"#,
        binary_path
    );

    let firefox_manifest = format!(
        r#"{{
  "name": "com.yourtube.client",
  "description": "YourTube yt-dlp client",
  "path": "{}",
  "type": "stdio",
  "allowed_extensions": ["yourtube@shirushimori"]
}}"#,
        binary_path
    );

    #[cfg(windows)]
    {
        // On Windows, Native Messaging Hosts are registered via the Registry
        let manifest_dir = get_install_dir();
        let chrome_json = manifest_dir.join("com.yourtube.client.chrome.json");
        let firefox_json = manifest_dir.join("com.yourtube.client.firefox.json");

        fs::write(&chrome_json, chrome_manifest)?;
        fs::write(&firefox_json, firefox_manifest)?;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // Chrome/Edge/Brave
        let browsers = ["Google\\Chrome", "Chromium", "BraveSoftware\\Brave-Browser", "Microsoft\\Edge"];
        for browser in browsers {
            let path = format!("Software\\{}\\NativeMessagingHosts\\com.yourtube.client", browser);
            if let Ok((key, _)) = hkcu.create_subkey(&path) {
                let _ = key.set_value("", &chrome_json.to_string_lossy().to_string());
            }
        }

        // Firefox
        if let Ok((key, _)) = hkcu.create_subkey("Software\\Mozilla\\NativeMessagingHosts\\com.yourtube.client") {
            let _ = key.set_value("", &firefox_json.to_string_lossy().to_string());
        }
    }

    #[cfg(not(windows))]
    {
        let home = dirs::home_dir().unwrap_or_default();
        
        let chrome_dirs = vec![
            home.join(".config/google-chrome/NativeMessagingHosts"),
            home.join(".config/chromium/NativeMessagingHosts"),
            home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
            #[cfg(target_os = "macos")]
            home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        ];

        for dir in chrome_dirs {
            if dir.parent().map(|p| p.exists()).unwrap_or(false) {
                fs::create_dir_all(&dir)?;
                fs::write(dir.join("com.yourtube.client.json"), &chrome_manifest)?;
            }
        }

        let firefox_dirs = vec![
            home.join(".mozilla/native-messaging-hosts"),
            #[cfg(target_os = "macos")]
            home.join("Library/Application Support/Mozilla/NativeMessagingHosts"),
        ];

        for dir in firefox_dirs {
            fs::create_dir_all(&dir)?;
            fs::write(dir.join("com.yourtube.client.json"), &firefox_manifest)?;
        }
    }

    Ok(())
}
