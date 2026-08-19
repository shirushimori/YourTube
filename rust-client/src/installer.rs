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
        if !homes.contains(&h) && h != PathBuf::from("/root") {
            homes.push(h);
        } else if homes.is_empty() {
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

        let manifest_path = target_client.to_string_lossy().to_string().replace("\\", "\\\\");
        install_browser_manifests(&manifest_path, &target_homes)?;
    }

    #[cfg(not(windows))]
    {
        // Clean up any stale/broken root manifests in /usr/lib
        let stale_system_manifests = [
            PathBuf::from("/usr/lib/mozilla/native-messaging-hosts/com.yourtube.client.json"),
            PathBuf::from("/usr/lib64/mozilla/native-messaging-hosts/com.yourtube.client.json"),
            PathBuf::from("/etc/opt/chrome/native-messaging-hosts/com.yourtube.client.json"),
            PathBuf::from("/etc/chromium/native-messaging-hosts/com.yourtube.client.json"),
        ];
        for stale in &stale_system_manifests {
            let _ = fs::remove_file(stale);
        }

        // Install to user directories
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

            let bin_path_str = target_client.to_string_lossy().to_string();
            install_single_home_manifests(&bin_path_str, home)?;
        }

        // Also if running with sudo/root, copy to /usr/local/bin so any user can run it globally
        let usr_local_bin = PathBuf::from("/usr/local/bin");
        if usr_local_bin.is_dir() {
            let global_client = usr_local_bin.join(&client_name);
            if fs::copy(&client_exe, &global_client).is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&global_client, fs::Permissions::from_mode(0o755));
                }
            }

            if let Some(first_home) = target_homes.first() {
                let user_yt_dlp = first_home.join(".local").join("bin").join(&yt_dlp_name);
                if user_yt_dlp.is_file() {
                    let global_yt_dlp = usr_local_bin.join(&yt_dlp_name);
                    let _ = fs::copy(&user_yt_dlp, &global_yt_dlp);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&global_yt_dlp, fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
    }

    println!("\nInstallation complete! You can now use the YourTube extension.");
    Ok(())
}

async fn download_yt_dlp(target_path: &PathBuf) -> Result<()> {
    let url = if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp"
    };

    let response = reqwest::get(url).await?.error_for_status()?;
    let bytes = response.bytes().await?;
    tokio::fs::write(target_path, &bytes).await?;

    Ok(())
}

#[cfg(not(windows))]
fn install_single_home_manifests(binary_path: &str, home: &PathBuf) -> Result<()> {
    let chrome_manifest = format!(
        r#"{{
  "name": "com.yourtube.client",
  "description": "YourTube yt-dlp client",
  "path": "{}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/",
    "chrome-extension://*/*"
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

    let chrome_dirs = vec![
        home.join(".config/google-chrome/NativeMessagingHosts"),
        home.join(".config/chromium/NativeMessagingHosts"),
        home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
        #[cfg(target_os = "macos")]
        home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"),
    ];

    for dir in chrome_dirs {
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("com.yourtube.client.json");
        let _ = fs::write(&target, &chrome_manifest);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o644));
        }
    }

    let firefox_dirs = vec![
        home.join(".mozilla/native-messaging-hosts"),
        home.join(".config/mozilla/firefox/native-messaging-hosts"),
        #[cfg(target_os = "macos")]
        home.join("Library/Application Support/Mozilla/NativeMessagingHosts"),
    ];

    for dir in firefox_dirs {
        let _ = fs::create_dir_all(&dir);
        let target = dir.join("com.yourtube.client.json");
        let _ = fs::write(&target, &firefox_manifest);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o644));
        }
    }

    Ok(())
}

#[cfg(windows)]
fn install_browser_manifests(binary_path: &str, target_homes: &[PathBuf]) -> Result<()> {
    let manifest_dir = dirs::data_local_dir().unwrap_or_default().join("YourTube");
    let chrome_json = manifest_dir.join("com.yourtube.client.chrome.json");
    let firefox_json = manifest_dir.join("com.yourtube.client.firefox.json");

    let chrome_manifest = format!(
        r#"{{
  "name": "com.yourtube.client",
  "description": "YourTube yt-dlp client",
  "path": "{}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/",
    "chrome-extension://*/*"
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

    Ok(())
}
