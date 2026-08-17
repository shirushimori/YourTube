use std::process::Command;

fn main() {
    // 1. List files inside the "binary" directory
    let output = Command::new("ls")
        .arg("-la")
        .current_dir("binary")
        .output()
        .expect("Failed to execute command");

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        println!("Command output:\n{}", stdout);
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("Command failed:\n{}", stderr);
    }

    // 2. Fix: Correctly pass 'chmod', '+x', and './yt-dlp' as separate arguments
    let output = Command::new("chmod")
        .arg("+x")
        .arg("./yt-dlp")
        .current_dir("binary")
        .output()
        .expect("Failed to execute command");

    if output.status.success() {
        println!("Successfully made ./yt-dlp executable!");
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("Chmod failed:\n{}", stderr);
    }
}
