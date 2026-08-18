NOTE : All setups, and docs are written by AI. still... it's good.

# 👋 Hey there, welcome to YourTube!

I built YourTube because I wanted a completely offline, ad-free, and tracker-free way to download YouTube videos directly from my browser. No shady websites, no slow servers—just a clean, native experience running right on your machine!

YourTube hooks seamlessly into your YouTube player, adding a sleek "Download" button. You just pick your quality, and the reliable `yt-dlp` engine handles the heavy lifting in the background.

## 🛠️ What do you need?

Before we get started, just make sure you have these installed on your machine:
- **Rust/Cargo**: This powers our lightning-fast native backend.
- **curl**: So we can automatically grab the latest `yt-dlp` for you.
- **zip**: To bundle up the browser extension for your browser.

## 🚀 Let's get it installed!

I've put together an automated installer script that handles literally everything for you. It builds the backend, downloads `yt-dlp`, configures your browsers, and packages the extension. 

1. **Clone and Run:**
   Just pop open your terminal and run:
   ```bash
   git clone https://github.com/shirushimori/YourTube.git
   cd YourTube
   ./run.sh
   ```

2. **Add it to your Browser:**
   Once the script finishes, you'll see a shiny new `yourtube-extension.zip` file in the folder.
   - **Using Firefox?** Head over to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and pick the zip file. (Or, just run `./run.sh --ext` to let the script open a new Firefox window with it loaded for you!)
   - **Using Chrome/Brave/Edge?** Unzip that file, go to `chrome://extensions`, turn on "Developer mode", click "Load unpacked", and select the extracted folder.

## 🎬 How to use it

It's super simple:
1. Go watch a video on YouTube.
2. Notice the sleek new "Download" button right next to the usual actions. Click it!
3. Pick whether you want just audio, video, or both, choose your quality, and hit download.
4. By default, everything saves straight to your `~/Videos` folder.

### 🤓 For the Power Users

Want to see all your downloads in one place? Just run:
```bash
./run.sh --tui
```
This opens up a cool Terminal User Interface (TUI) where you can manage your history and monitor active downloads. Enjoy!
