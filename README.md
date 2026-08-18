# YourTube

YourTube is a personal YouTube downloader with a browser extension and a Rust backend. Click download on any YouTube video, pick your quality and format, and it handles the rest using yt-dlp. Clean, fast, and runs entirely on your machine — no servers, no ads, no nonsense.

## Prerequisites

- **Rust/Cargo**: To build the native backend client.
- **curl**: To download the latest version of `yt-dlp`.
- **zip**: To package the browser extension.

## Installation

The included `run.sh` script automates the entire setup process. It will build the Rust client, download `yt-dlp`, register the native messaging host for your browsers, and package the browser extension.

1. **Run the installer:**
   ```bash
   ./run.sh
   ```

2. **Load the Extension:**
   - The installer creates a `yourtube-extension.zip` in the root folder.
   - For **Firefox**: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and select the `yourtube-extension.zip` file. (Alternatively, run `./run.sh --ext` to launch a new Firefox instance with it loaded).
   - For **Chrome/Brave/Edge**: Extract the zip, go to `chrome://extensions`, enable "Developer mode", and click "Load unpacked" then select the extracted `extension` folder.

## Usage

- Navigate to any YouTube video.
- You will see a new "Download" button injected into the page.
- Choose your preferred quality and hit download!
- Downloads are saved to your `~/Videos` directory by default.

### Advanced Usage

- `./run.sh --tui`: Launches a Terminal User Interface to monitor active downloads and view download history.
