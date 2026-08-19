use std::path::PathBuf;
use std::fs;
use anyhow::{Context, Result};

#[cfg(windows)]
use winreg::{enums::*, RegKey};

fn get_target_homes() -> Vec<PathBuf> {
    let mut homes = Vec::new();

    // Check SUDO_USER if run via sudo
    if let Ok(sudo_user) = std::env::var("SUDO_USER") {
        let sudo_user = sudo_user.trim();
        if !sudo_user.is_empty() && sudo_user != "root" {
            #[cfg(target_os = "macos")]
            homes.push(PathBuf::from(format!("/Users/{}", sudo_user)));
            #[cfg(not(target_os = "macos"))]
            homes.push(PathBuf::from(format!("/home/{}", sudo_user)));
        }
    }

    if let Some(h) = dirs::home_dir() {
        if !homes.contains(&h) {
            homes.push(h);
        }
    }

    homes
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

    let target_homes = get_target_homes();
    let client_exe = std::env::current_exe().context("Failed to get current executable path")?;
    let bin_ext = get_binary_extension();
    let yt_dlp_name = format!("yt-dlp{}", bin_ext);
    let client_name = format!("yourtube-client{}", bin_ext);

    let mut installed_bin_paths = Vec::new();

    #[cfg(windows)]
    {
        let install_dir = dirs::data_local_dir().unwrap_or_default().join("YourTube");
        fs::create_dir_all(&install_dir)?;

        let target_client = install_dir.join(&client_name);
        println!("Copying client to {:?}", target_client);
        fs::copy(&client_exe, &target_client)?;

        let target_yt_dlp = install_dir.join(&yt_dlp_name);
        println!("Downloading {}...", yt_dlp_name);
        download_yt_dlp(&target_yt_dlp).await?;

        installed_bin_paths.push(target_client);
    }

    #[cfg(not(windows))]
    {
        for home in &target_homes {
            let install_dir = home.join(".local").join("bin");
            let _ = fs::create_dir_all(&install_dir);

            let target_client = install_dir.join(&client_name);
            println!("Copying client to {:?}", target_client);
            if fs::copy(&client_exe, &target_client).is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&target_client, fs::Permissions::from_mode(0o755));
                }
                installed_bin_paths.push(target_client.clone());
            }

            let target_yt_dlp = install_dir.join(&yt_dlp_name);
            println!("Downloading {} to {:?}...", yt_dlp_name, target_yt_dlp);
            if download_yt_dlp(&target_yt_dlp).await.is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&target_yt_dlp, fs::Permissions::from_mode(0o755));
                }
            }
        }

        // Also if root, install to /usr/local/bin for global accessibility
        if let Ok(uid) = std::env::var("UID") {
            if uid == "0" || std::env::var("SUDO_USER").is_ok() {
                let usr_local_bin = PathBuf::from("/usr/local/bin");
                if usr_local_bin.is_dir() {
                    let global_client = usr_local_bin.join(&client_name);
                    let _ = fs::copy(&client_exe, &global_client);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&global_client, fs::Permissions::from_mode(0o755));
                    }
                    installed_bin_paths.push(global_client);
                }
            }
        }
    }

    let primary_bin = installed_bin_paths.first()
        .cloned()
        .unwrap_or_else(|| PathBuf::from(format!("yourtube-client{}", bin_ext)));

    let manifest_path = primary_bin.to_string_lossy().to_string();
    let manifest_path = manifest_path.replace("\\", "\\\\");

    println!("Installing browser manifests for: {}", manifest_path);
    install_browser_manifests(&manifest_path, &target_homes)?;

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

fn install_browser_manifests(binary_path: &str, target_homes: &[PathBuf]) -> Result<()> {
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
        let manifest_dir = dirs::data_local_dir().unwrap_or_default().join("YourTube");
        let chrome_json = manifest_dir.join("com.yourtube.client.chrome.json");
        let firefox_json = manifest_dir.join("com.yourtube.client.firefox.json");

        fs::write(&chrome_json, chrome_manifest)?;
        fs::write(&firefox_json, firefox_manifest)?;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let browsers = ["Google\\Chrome", "Chromium", "BraveSoftware\\Brave-Browser", "Microsoft\\Edge"];
        for browser in browsers {
            let path = format!("Software\\{}\\NativeMessagingHosts\\com.yourtube.client", browser);
            if let Ok((key, _)) = hkcu.create_subkey(&path) {
                let _ = key.set_value("", &chrome_json.to_string_lossy().to_string());
            }
        }

        if let Ok((key, _)) = hkcu.create_subkey("Software\\Mozilla\\NativeMessagingHosts\\com.yourtube.client") {
            let _ = key.set_value("", &firefox_json.to_string_lossy().to_string());
        }
    }

    #[cfg(not(windows))]
    {
        for home in target_homes {
            let chrome_dirs = vec![
                home.join(".config/google-chrome/NativeMessagingHosts"),
                home.join(".config/chromium/NativeMessagingHosts"),
                home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
                #[cfg(target_os = "macos")]
                home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"),
            ];

            for dir in chrome_dirs {
                let _ = fs::create_dir_all(&dir);
                let _ = fs::write(dir.join("com.yourtube.client.json"), &chrome_manifest);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(dir.join("com.yourtube.client.json"), fs::Permissions::from_mode(0o644));
                }
            }

            let firefox_dirs = vec![
                home.join(".mozilla/native-messaging-hosts"),
                #[cfg(target_os = "macos")]
                home.join("Library/Application Support/Mozilla/NativeMessagingHosts"),
            ];

            for dir in firefox_dirs {
                let _ = fs::create_dir_all(&dir);
                let _ = fs::write(dir.join("com.yourtube.client.json"), &firefox_manifest);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(dir.join("com.yourtube.client.json"), fs::Permissions::from_mode(0o644));
                }
            }
        }
    }

    Ok(())
}
