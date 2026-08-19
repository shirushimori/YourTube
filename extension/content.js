(() => {
  const OVERLAY_ID = "yourtube-overlay";
  const HOOK_BTN_ID = "yourtube-hook-btn";
  const TOAST_ID = "yourtube-toast";
  const HUB_ID = "yourtube-hub";
  const HUB_BTN_ID = "yourtube-hub-btn";
  const VIDEO_POPUP_ID = "yourtube-video-popup";

  // ── Page detection ──
  function isVideoPage() { return /\/watch\?v=/.test(location.href); }
  function isDownloadsPage() { return /\/feed\/downloads/.test(location.href); }
  function getVideoUrl() { return location.href; }
  function getVideoId() { const m = location.href.match(/[?&]v=([^&]+)/); return m ? m[1] : null; }

  function setSafeHtml(el, html) {
    el.replaceChildren();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.append(...doc.body.childNodes);
  }

  // ── Helpers ──
  function escapeHtml(str) {
    const d = document.createElement("div"); d.textContent = str || ""; return d.innerHTML;
  }
  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  }
  function formatNumber(n) {
    if (!n) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }
  function formatDuration(secs) {
    if (!secs) return "";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${m}:${String(s).padStart(2,"0")}`;
  }
  function formatDate(d) {
    if (!d || d.length < 8) return "";
    return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  }
  function getFileIcon(ext) {
    if (!ext) return "🎬";
    const e = ext.toLowerCase();
    if (["mp4","webm","mkv","avi","mov","flv"].includes(e)) return "🎬";
    if (["mp3","wav","flac","aac","ogg","opus","m4a"].includes(e)) return "🎵";
    return "📁";
  }
  function getMediaType(ext) {
    if (!ext) return "other";
    const e = ext.toLowerCase();
    if (["mp4","webm","mkv","avi","mov","flv"].includes(e)) return "video";
    if (["mp3","wav","flac","aac","ogg","opus","m4a"].includes(e)) return "audio";
    return "other";
  }

  // ── Settings ──
  let hubSettings = { fullscreen: false, showThumbnails: true, defaultFolder: "~/Videos" };

  async function loadSettings() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "get_settings" });
      if (r?.settings) hubSettings = { ...hubSettings, ...r.settings };
    } catch {}
  }

  async function saveSettings() {
    try {
      await chrome.runtime.sendMessage({ type: "save_settings", settings: hubSettings });
    } catch {}
  }

  loadSettings();

  // ── Toast notification ──
  function ensureToast() {
    if (document.getElementById(TOAST_ID)) return;
    const t = document.createElement("div");
    t.id = TOAST_ID;
    setSafeHtml(t, `
      <div class="toast-title"></div>
      <div class="toast-progress"><div class="toast-bar"></div></div>
      <div class="toast-details"><span class="toast-pct">0%</span><span class="toast-speed"></span><span class="toast-eta"></span></div>
    `);
    document.body.appendChild(t);
  }

  function showToast(title) {
    ensureToast();
    const t = document.getElementById(TOAST_ID);
    t.querySelector(".toast-title").textContent = title;
    t.querySelector(".toast-bar").style.width = "0%";
    t.querySelector(".toast-pct").textContent = "Starting...";
    t.querySelector(".toast-speed").textContent = "";
    t.querySelector(".toast-eta").textContent = "";
    t.classList.add("visible");
  }

  function updateToast(pct, speed, eta) {
    const t = document.getElementById(TOAST_ID);
    if (!t || !t.classList.contains("visible")) return;
    t.querySelector(".toast-bar").style.width = `${pct}%`;
    t.querySelector(".toast-pct").textContent = `${pct.toFixed(1)}%`;
    if (speed) t.querySelector(".toast-speed").textContent = speed;
    if (eta) t.querySelector(".toast-eta").textContent = `ETA ${eta}`;
  }

  function hideToast() {
    const t = document.getElementById(TOAST_ID);
    if (t) setTimeout(() => t.classList.remove("visible"), 3000);
  }

  // ── Overlay (Download popup on video page) ──
  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    const o = document.createElement("div");
    o.id = OVERLAY_ID;
    setSafeHtml(o, `
      <div id="yourtube-popup">
        <div class="yt-header"><h2>Download Video</h2><button class="yt-close">&times;</button></div>
        <div class="yt-body">
          <div class="yt-video-info">
            <img class="yt-thumb" src="" alt="">
            <div class="yt-meta">
              <div class="yt-title">Loading...</div>
              <div class="yt-detail"></div>
            </div>
          </div>
          <div class="yt-section"><label>Download Type</label>
            <div class="yt-radios">
              <label><input type="radio" name="yt_type" value="video_audio" checked><span>Both (Video+Audio)</span></label>
              <label><input type="radio" name="yt_type" value="video_only"><span>Video</span></label>
              <label><input type="radio" name="yt_type" value="audio_only"><span>Audio</span></label>
            </div>
          </div>
          <div class="yt-section yt-video-quality-section"><label>Video Quality</label>
            <select class="yt-quality">
              <option value="2160">2160p (4K Ultra HD)</option>
              <option value="1440">1440p (2K Quad HD)</option>
              <option value="1080" selected>1080p (Full HD - Recommended)</option>
              <option value="720">720p (HD)</option>
              <option value="480">480p (Standard)</option>
              <option value="360">360p</option>
            </select>
          </div>
          <div class="yt-section yt-audio-options-section" style="display:none">
            <label>Audio Format</label>
            <select class="yt-audio-format">
              <option value="mp3" selected>MP3 (Universal)</option>
              <option value="m4a">M4A (AAC)</option>
              <option value="opus">Opus (High Quality)</option>
              <option value="wav">WAV (Lossless)</option>
              <option value="flac">FLAC (Lossless)</option>
            </select>
            <label style="margin-top:10px;display:block">Audio Quality / Bitrate</label>
            <select class="yt-audio-quality">
              <option value="320">320 kbps (Studio Quality)</option>
              <option value="256">256 kbps (High Quality)</option>
              <option value="192" selected>192 kbps (Standard Quality)</option>
              <option value="128">128 kbps (Medium Quality)</option>
              <option value="96">96 kbps</option>
            </select>
          </div>
          <div class="yt-section">
            <label class="yt-checkbox"><input type="checkbox" class="yt-playlist-check"><span>Download as playlist / album</span></label>
          </div>
          <div class="yt-section yt-playlist-folder-section" style="display:none">
            <label>Playlist Folder Name</label>
            <input type="text" class="yt-playlist-folder" placeholder="Folder name for playlist items">
          </div>
          <div class="yt-section"><label>Time Range (Optional)</label>
            <div class="yt-time-range"><input type="text" class="yt-start" placeholder="00:00:00"><span>to</span><input type="text" class="yt-end" placeholder="end"></div>
          </div>
          <div class="yt-section"><label>Save Destination</label>
            <div class="yt-path-row"><input type="text" class="yt-path" value="${hubSettings.defaultFolder}"><button class="yt-browse-btn" type="button">Change</button></div>
          </div>
          <button class="yt-download-btn">Start Download</button>
          <div class="yt-status"></div>
        </div>
      </div>
    `);
    document.body.appendChild(o);

    o.querySelector(".yt-close").addEventListener("click", () => o.classList.remove("visible"));
    o.addEventListener("click", (e) => { if (e.target === o) o.classList.remove("visible"); });
    o.querySelector(".yt-download-btn").addEventListener("click", handleDownload);

    o.querySelector(".yt-browse-btn").addEventListener("click", () => {
      const pathInput = o.querySelector(".yt-path");
      const newPath = prompt("Enter download folder path:", pathInput.value);
      if (newPath !== null && newPath.trim()) {
        pathInput.value = newPath.trim();
        hubSettings.defaultFolder = newPath.trim();
        saveSettings();
      }
    });

    // Toggle quality vs audio options
    o.querySelectorAll('input[name="yt_type"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const isAudio = radio.value === "audio_only";
        o.querySelector(".yt-video-quality-section").style.display = isAudio ? "none" : "";
        o.querySelector(".yt-audio-options-section").style.display = isAudio ? "" : "none";
      });
    });

    // Toggle playlist folder input
    const plCheck = o.querySelector(".yt-playlist-check");
    const plSec = o.querySelector(".yt-playlist-folder-section");
    plCheck.addEventListener("change", () => {
      plSec.style.display = plCheck.checked ? "" : "none";
    });
  }

  async function handleDownload() {
    const overlay = document.getElementById(OVERLAY_ID);
    const status = overlay.querySelector(".yt-status");
    const btn = overlay.querySelector(".yt-download-btn");
    const url = getVideoUrl();
    const downloadType = overlay.querySelector('input[name="yt_type"]:checked').value;
    const quality = overlay.querySelector(".yt-quality").value;
    const audioFormat = overlay.querySelector(".yt-audio-format").value;
    const audioBitrate = overlay.querySelector(".yt-audio-quality").value;
    const isPlaylist = overlay.querySelector(".yt-playlist-check").checked;
    const playlistFolder = overlay.querySelector(".yt-playlist-folder").value.trim();
    const startTime = overlay.querySelector(".yt-start").value || null;
    const endTime = overlay.querySelector(".yt-end").value || null;
    let outputDir = overlay.querySelector(".yt-path").value.trim();

    if (isPlaylist && playlistFolder) {
      outputDir = outputDir.replace(/\/+$/, "") + "/" + playlistFolder;
    }

    btn.disabled = true;
    status.className = "yt-status visible loading";
    status.textContent = "Fetching video info...";

    try {
      const meta = await chrome.runtime.sendMessage({ type: "fetch_metadata", url });
      if (!meta || meta.type === "error") {
        status.className = "yt-status visible error";
        status.textContent = (meta && meta.message) || "Failed to connect to native client";
        btn.disabled = false;
        return;
      }

      status.className = "yt-status visible loading";
      status.textContent = "Starting download in highest quality...";
      showToast(meta.title || "Downloading...");

      chrome.runtime.sendMessage({
        type: "download_start",
        url,
        title: meta.title || "",
        description: meta.description || "",
        thumbnail: meta.thumbnail || "",
        channel: meta.channel || "",
        view_count: meta.view_count || 0,
        like_count: meta.like_count || 0,
        upload_date: meta.upload_date || "",
        source: meta.source || "",
        duration: meta.duration || 0,
        download_type: downloadType,
        quality: quality,
        audio_format: audioFormat,
        audio_bitrate: audioBitrate,
        output_dir: outputDir,
        start_time: startTime,
        end_time: endTime,
      });
    } catch (err) {
      status.className = "yt-status visible error";
      status.textContent = "Error: " + (err.message || "Unknown error");
    }

    btn.disabled = false;
  }

  // ── Progress listener ──
  chrome.runtime.onMessage.addListener((msg) => {
    const status = document.querySelector("#yourtube-overlay .yt-status");
    if (msg.type === "download_progress") {
      const pct = msg.percent != null ? msg.percent : 0;
      updateToast(pct, msg.speed, msg.eta);
      if (status) {
        const parts = [pct.toFixed(1) + "%"];
        if (msg.speed) parts.push(msg.speed);
        if (msg.eta) parts.push("ETA " + msg.eta);
        if (msg.downloaded && msg.total_size) parts.push(msg.downloaded + " / " + msg.total_size);
        status.className = "yt-status visible loading";
        status.textContent = parts.join("  |  ");
      }
      if (msg.status === "finished" || msg.status === "completed") {
        if (status) { status.className = "yt-status visible success"; status.textContent = "Done! Download complete."; }
        hideToast();
      }
    } else if (msg.type === "error") {
      if (status) { status.className = "yt-status visible error"; status.textContent = msg.message || "Failed"; }
      hideToast();
    }
  });

  // ══════════════════════════════════════════
  // ── Downloads Hub (YouTube Homepage Style)
  // ══════════════════════════════════════════
  let hubFilter = "all";
  let hubTracked = [];
  let hubFileList = [];
  let hubSearchQuery = "";

  function ensureHub() {
    if (document.getElementById(HUB_ID)) return;
    const hub = document.createElement("div");
    hub.id = HUB_ID;
    setSafeHtml(hub, `
      <div class="yt-hub-panel">
        <div class="yt-hub-header">
          <h2><span>YourTube</span> Downloads Hub</h2>
          <div class="yt-hub-header-actions">
            <button class="yt-hub-close">&times;</button>
          </div>
        </div>
        <div class="yt-hub-settings">
          <div class="yt-hub-folder">
            <input type="text" class="yt-hub-path" value="${hubSettings.defaultFolder}" placeholder="Download folder path">
            <button class="yt-hub-refresh">Refresh</button>
          </div>
          <input type="text" class="yt-hub-search-box" placeholder="🔍 Search downloads...">
        </div>
        <div class="yt-hub-tabs">
          <button class="yt-hub-tab active" data-tab="all">All</button>
          <button class="yt-hub-tab" data-tab="video">Videos</button>
          <button class="yt-hub-tab" data-tab="audio">Audio</button>
          <button class="yt-hub-tab" data-tab="tracked">Tracked</button>
        </div>
        <div class="yt-hub-content">
          <div class="yt-hub-grid" id="yt-hub-grid"></div>
          <div class="yt-hub-empty hidden">No downloads found</div>
        </div>
      </div>
    `);
    document.body.appendChild(hub);

    hub.querySelector(".yt-hub-close").addEventListener("click", () => hub.classList.remove("visible"));
    hub.addEventListener("click", (e) => { if (e.target === hub) hub.classList.remove("visible"); });

    // Filter tabs
    hub.querySelectorAll(".yt-hub-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        hub.querySelectorAll(".yt-hub-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        hubFilter = tab.dataset.tab;
        renderFileLists();
      });
    });

    hub.querySelector(".yt-hub-refresh").addEventListener("click", () => loadHubFiles());
    hub.querySelector(".yt-hub-path").addEventListener("change", () => {
      hubSettings.defaultFolder = hub.querySelector(".yt-hub-path").value.trim();
      saveSettings();
      loadHubFiles();
    });

    hub.querySelector(".yt-hub-search-box").addEventListener("input", (e) => {
      hubSearchQuery = e.target.value.toLowerCase().trim();
      renderFileLists();
    });

    loadHubFiles();
    loadTrackedDownloads();
  }

  async function loadHubFiles() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const dir = hub.querySelector(".yt-hub-path").value.trim() || hubSettings.defaultFolder;
    const grid = hub.querySelector("#yt-hub-grid");
    const empty = hub.querySelector(".yt-hub-empty");

    setSafeHtml(grid, '<div class="yt-hub-loading">Loading downloaded media...</div>');
    empty.classList.add("hidden");

    try {
      const result = await chrome.runtime.sendMessage({ type: "list_downloads", directory: dir });
      if (!result || result.type === "error") {
        setSafeHtml(grid, `<div class="yt-hub-error">${(result && result.message) || "Failed to load. Make sure YourTube native client is installed."}</div>`);
        return;
      }

      hubFileList = result.files || [];
      renderFileLists();
    } catch (err) {
      setSafeHtml(grid, `<div class="yt-hub-error">Connection error: ${err.message || "Native client not found"}</div>`);
    }
  }

  function renderFileLists() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const grid = hub.querySelector("#yt-hub-grid");
    const empty = hub.querySelector(".yt-hub-empty");

    let files = hubFileList;

    if (hubFilter === "video") {
      files = files.filter((f) => getMediaType(f.ext) === "video");
    } else if (hubFilter === "audio") {
      files = files.filter((f) => getMediaType(f.ext) === "audio");
    } else if (hubFilter === "tracked") {
      renderTrackedList();
      return;
    }

    if (hubSearchQuery) {
      files = files.filter((f) => f.name.toLowerCase().includes(hubSearchQuery));
    }

    if (files.length === 0) {
      setSafeHtml(grid, "");
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    setSafeHtml(grid, renderCardsHtml(files));

    // Attach click handlers
    grid.querySelectorAll(".yt-hub-card").forEach((card) => {
      card.addEventListener("click", () => handleCardClick(card));
    });
  }

  function renderCardsHtml(files) {
    return files.map((f) => {
      const isVideo = getMediaType(f.ext) === "video";
      const vid = guessVideoId(f.name);
      const thumbUrl = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "";

      return `
        <div class="yt-hub-card" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}" data-ext="${escapeHtml(f.ext || "")}" data-vid="${escapeHtml(vid)}">
          <div class="yt-hub-card-thumb">
            ${thumbUrl ? `<img src="${thumbUrl}" alt="">` : `<div class="yt-card-icon">${getFileIcon(f.ext)}</div>`}
            <span class="yt-card-badge">${escapeHtml(f.ext?.toUpperCase() || "FILE")}</span>
          </div>
          <div class="yt-hub-card-body">
            <div class="yt-hub-card-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
            <div class="yt-hub-card-meta">
              <span>${formatSize(f.size)}</span>
              <span>${escapeHtml(f.modified)}</span>
            </div>
            <div class="yt-hub-card-actions">
              <button class="yt-hub-card-play-btn">▶ Watch in Player</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function guessVideoId(name) {
    const m = name.match(/\[([a-zA-Z0-9_-]{11})\]/);
    if (m) return m[1];
    const m2 = name.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
    if (m2) return m2[1];
    return "";
  }

  function handleCardClick(card) {
    const path = card.dataset.path;
    const name = card.dataset.name;
    const vid = card.dataset.vid;

    // Match metadata from tracked downloads
    const tracked = hubTracked.find((t) => {
      if (!t.file_path) return false;
      return path.includes(t.file_path) || t.file_path.includes(path) || (vid && t.url?.includes(vid));
    });

    const meta = tracked ? {
      title: tracked.title,
      description: tracked.description,
      channel: tracked.channel,
      view_count: tracked.view_count,
      like_count: tracked.like_count,
      upload_date: tracked.upload_date,
      source: tracked.source || (vid ? `https://www.youtube.com/watch?v=${vid}` : ""),
      quality: tracked.quality,
      download_type: tracked.download_type,
      thumbnail: tracked.thumbnail || (vid ? `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg` : ""),
    } : {
      title: name.replace(/\.[^.]+$/, ""),
      thumbnail: vid ? `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg` : "",
      source: vid ? `https://www.youtube.com/watch?v=${vid}` : "",
    };

    serveAndPlay(path, name, meta, card);
  }

  async function serveAndPlay(path, name, meta, card) {
    const playBtn = card?.querySelector(".yt-hub-card-play-btn");
    if (playBtn) { playBtn.disabled = true; playBtn.textContent = "Loading..."; }

    try {
      const result = await chrome.runtime.sendMessage({ type: "serve_file", path });
      if (playBtn) { playBtn.disabled = false; playBtn.textContent = "▶ Watch in Player"; }
      if (!result || result.type === "error") {
        alert("Failed to stream file: " + (result?.message || "Unknown"));
        return;
      }

      openCustomPlayerTab(result.url, name, meta);
    } catch (err) {
      if (playBtn) { playBtn.disabled = false; playBtn.textContent = "▶ Watch in Player"; }
      alert("Error: " + err.message);
    }
  }

  // ══════════════════════════════════════════
  // ── Custom Video Player Tab
  // ══════════════════════════════════════════
  function openCustomPlayerTab(streamUrl, name, meta) {
    const title = escapeHtml(meta?.title || name);
    const channel = meta?.channel ? escapeHtml(meta.channel) : "Local Video";
    const desc = meta?.description ? escapeHtml(meta.description) : "Downloaded locally via YourTube.";
    const thumb = meta?.thumbnail || "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - YourTube Player</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f0f;color:#f1f1f1;font-family:"Roboto",Arial,sans-serif;overflow-x:hidden}
.topbar{background:#0f0f0f;padding:12px 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #222;position:sticky;top:0;z-index:100}
.logo{font-size:20px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;text-decoration:none}
.logo span{color:#ff4444}
.meta-btn{padding:8px 16px;border-radius:20px;border:1px solid #333;background:rgba(255,255,255,0.08);color:#fff;font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.15s}
.meta-btn:hover{background:rgba(255,255,255,0.18)}

.watch-container{max-width:1440px;margin:0 auto;padding:24px;display:grid;grid-template-columns:1fr 380px;gap:24px}
@media(max-width:1080px){.watch-container{grid-template-columns:1fr;}}

.player-wrapper{position:relative;background:#000;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.8)}
video{width:100%;display:block;max-height:76vh;background:#000;outline:none}

/* Idle Paused Overlay */
.idle-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);display:flex;flex-direction:column;justify-content:center;align-items:center;opacity:0;pointer-events:none;transition:opacity 0.4s ease}
.idle-overlay.visible{opacity:1;pointer-events:auto}
.idle-thumb{width:360px;max-width:80%;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.9);margin-bottom:16px}
.idle-title{font-size:18px;font-weight:600;color:#fff;text-align:center;padding:0 20px;max-width:600px}
.idle-resume-btn{margin-top:16px;padding:10px 24px;border-radius:24px;background:#ff4444;color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer}

.video-info{padding:18px 0}
.video-title{font-size:20px;font-weight:600;line-height:1.4;margin-bottom:12px}
.channel-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #222}
.channel-info{display:flex;align-items:center;gap:12px}
.channel-avatar{width:42px;height:42px;border-radius:50%;background:#ff4444;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#fff}
.channel-name{font-size:16px;font-weight:600}
.channel-sub{font-size:12px;color:#aaa}

.desc-card{background:#222;border-radius:12px;padding:16px;margin-top:16px;line-height:1.6;font-size:14px}
.desc-meta{font-weight:600;font-size:13px;margin-bottom:8px;color:#ddd}
.desc-text{color:#ccc;white-space:pre-wrap;max-height:160px;overflow-y:auto}

.sidebar-card{background:#181818;border-radius:14px;padding:20px;border:1px solid #262626;height:fit-content}
.sidebar-card h3{font-size:15px;font-weight:600;margin-bottom:16px;color:#fff;border-bottom:1px solid #282828;padding-bottom:10px}
.detail-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #222;font-size:13px}
.detail-row span:first-child{color:#888}
.detail-row span:last-child{color:#fff;font-weight:500;text-align:right}

/* Metadata Modal Popup */
.meta-modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:none;justify-content:center;align-items:center;z-index:999}
.meta-modal.visible{display:flex}
.modal-content{background:#222;border-radius:16px;width:520px;max-width:92vw;padding:24px;box-shadow:0 16px 50px rgba(0,0,0,0.9);color:#fff}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;border-bottom:1px solid #333;padding-bottom:12px}
.modal-header h2{font-size:18px}
.modal-close{background:none;border:none;color:#aaa;font-size:24px;cursor:pointer}
</style>
</head>
<body>
<div class="topbar">
  <a class="logo" href="#">Your<span>Tube</span> Player</a>
  <button class="meta-btn" id="open-meta-btn">📊 Video Metadata</button>
</div>

<div class="watch-container">
  <div>
    <div class="player-wrapper">
      <video id="vid-player" controls autoplay src="${streamUrl}"></video>
      <div class="idle-overlay" id="idle-overlay">
        ${thumb ? `<img class="idle-thumb" src="${thumb}" alt="">` : ""}
        <div class="idle-title">${title}</div>
        <button class="idle-resume-btn" id="resume-btn">▶ Click to Resume</button>
      </div>
    </div>
    <div class="video-info">
      <h1 class="video-title">${title}</h1>
      <div class="channel-row">
        <div class="channel-info">
          <div class="channel-avatar">${channel.charAt(0).toUpperCase()}</div>
          <div>
            <div class="channel-name">${channel}</div>
            <div class="channel-sub">Local Playback</div>
          </div>
        </div>
      </div>
      <div class="desc-card">
        <div class="desc-meta">${meta?.upload_date ? formatDate(meta.upload_date) + " • " : ""}${meta?.view_count ? formatNumber(meta.view_count) + " views" : "Offline Media"}</div>
        <div class="desc-text">${desc}</div>
      </div>
    </div>
  </div>

  <div>
    <div class="sidebar-card">
      <h3>File Details</h3>
      <div class="detail-row"><span>File Name</span><span>${escapeHtml(name)}</span></div>
      ${meta?.quality ? `<div class="detail-row"><span>Quality</span><span>${escapeHtml(meta.quality)}</span></div>` : ""}
      ${meta?.download_type ? `<div class="detail-row"><span>Type</span><span>${escapeHtml(meta.download_type)}</span></div>` : ""}
      ${meta?.upload_date ? `<div class="detail-row"><span>Upload Date</span><span>${formatDate(meta.upload_date)}</span></div>` : ""}
      ${meta?.view_count ? `<div class="detail-row"><span>Views</span><span>${formatNumber(meta.view_count)}</span></div>` : ""}
      ${meta?.like_count ? `<div class="detail-row"><span>Likes</span><span>${formatNumber(meta.like_count)}</span></div>` : ""}
      ${meta?.source ? `<div class="detail-row"><span>Source URL</span><span><a href="${escapeHtml(meta.source)}" style="color:#4da6ff;text-decoration:none" target="_blank">Open YouTube</a></span></div>` : ""}
    </div>
  </div>
</div>

<div class="meta-modal" id="meta-modal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>📊 Video Metadata</h2>
      <button class="modal-close" id="close-meta-btn">&times;</button>
    </div>
    <div class="detail-row"><span>Title</span><span>${title}</span></div>
    <div class="detail-row"><span>Channel</span><span>${channel}</span></div>
    <div class="detail-row"><span>File</span><span>${escapeHtml(name)}</span></div>
    ${meta?.quality ? `<div class="detail-row"><span>Resolution/Quality</span><span>${escapeHtml(meta.quality)}</span></div>` : ""}
    ${meta?.upload_date ? `<div class="detail-row"><span>Uploaded</span><span>${formatDate(meta.upload_date)}</span></div>` : ""}
    ${meta?.view_count ? `<div class="detail-row"><span>View Count</span><span>${formatNumber(meta.view_count)}</span></div>` : ""}
    ${meta?.like_count ? `<div class="detail-row"><span>Like Count</span><span>${formatNumber(meta.like_count)}</span></div>` : ""}
  </div>
</div>

<script>
const video = document.getElementById("vid-player");
const overlay = document.getElementById("idle-overlay");
const resumeBtn = document.getElementById("resume-btn");
const metaBtn = document.getElementById("open-meta-btn");
const metaModal = document.getElementById("meta-modal");
const closeMeta = document.getElementById("close-meta-btn");

let idleTimer = null;

function resetIdle() {
  overlay.classList.remove("visible");
  clearTimeout(idleTimer);
  if (video.paused && !video.ended) {
    idleTimer = setTimeout(() => overlay.classList.add("visible"), 2500);
  }
}

video.addEventListener("pause", resetIdle);
video.addEventListener("play", () => {
  overlay.classList.remove("visible");
  clearTimeout(idleTimer);
});
video.addEventListener("mousemove", resetIdle);
resumeBtn.addEventListener("click", () => video.play());

metaBtn.addEventListener("click", () => metaModal.classList.add("visible"));
closeMeta.addEventListener("click", () => metaModal.classList.remove("visible"));
metaModal.addEventListener("click", (e) => { if (e.target === metaModal) metaModal.classList.remove("visible"); });

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  if (e.code === "KeyF") { if (document.fullscreenElement) document.exitFullscreen(); else video.requestFullscreen(); }
  if (e.code === "KeyM") { video.muted = !video.muted; }
  if (e.code === "ArrowLeft") { video.currentTime = Math.max(0, video.currentTime - 5); }
  if (e.code === "ArrowRight") { video.currentTime = Math.min(video.duration, video.currentTime + 5); }
});
</script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  // ── Tracked downloads ──
  async function loadTrackedDownloads() {
    try {
      const result = await chrome.runtime.sendMessage({ type: "get_tracked_downloads" });
      hubTracked = result?.downloads || [];
    } catch {}
  }

  function renderTrackedList() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const grid = hub.querySelector("#yt-hub-grid");
    const empty = hub.querySelector(".yt-hub-empty");

    if (hubTracked.length === 0) {
      setSafeHtml(grid, "");
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    const html = hubTracked.map((d) => `
      <div class="yt-hub-card" data-path="${escapeHtml(d.file_path || "")}" data-name="${escapeHtml(d.title || "Video")}">
        <div class="yt-hub-card-thumb">
          ${d.thumbnail ? `<img src="${escapeHtml(d.thumbnail)}" alt="">` : `<div class="yt-card-icon">🎬</div>`}
          <span class="yt-card-badge">${escapeHtml(d.quality || "HD")}</span>
        </div>
        <div class="yt-hub-card-body">
          <div class="yt-hub-card-title">${escapeHtml(d.title || "Video")}</div>
          <div class="yt-hub-card-meta">
            <span>${escapeHtml(d.channel || "YouTube")}</span>
            <span>${d.status || "completed"}</span>
          </div>
        </div>
      </div>
    `).join("");

    setSafeHtml(grid, html);
  }

  // ── Hook: Download button on video page ──
  function hookDownloadButton() {
    if (!isVideoPage()) return;
    const existing = document.getElementById(HOOK_BTN_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    // Find the exact like button container or actions row
    const likeBtn = document.querySelector("segmented-like-dislike-button-view-model, #segmented-like-button, ytd-segmented-like-dislike-button-renderer");
    const topButtons = document.querySelector("#top-level-buttons-computed, ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed, #menu-container #top-level-buttons-computed");
    const actionsRow = document.querySelector("ytd-watch-metadata #actions ytd-menu-renderer, #above-the-fold #actions, #above-the-fold #menu-container");

    let targetParent = null;
    let insertBeforeEl = null;

    if (likeBtn && likeBtn.parentElement) {
      targetParent = likeBtn.parentElement;
      insertBeforeEl = likeBtn;
    } else if (topButtons) {
      targetParent = topButtons;
      insertBeforeEl = topButtons.firstChild;
    } else if (actionsRow) {
      targetParent = actionsRow;
      insertBeforeEl = actionsRow.firstChild;
    }

    if (!targetParent) return;

    const btn = document.createElement("button");
    btn.id = HOOK_BTN_ID;
    setSafeHtml(btn, `<svg viewBox="0 0 24 24" width="20" height="20" style="fill: currentColor; margin-right: 6px;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>Download`);
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      ensureOverlay();
      const vid = getVideoId();
      if (vid) document.querySelector(".yt-thumb").src = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      const titleEl = document.querySelector("h1.ytd-watch-metadata, #above-the-fold #title yt-formatted-string, #above-the-fold h1 yt-formatted-string");
      if (titleEl) document.querySelector(".yt-title").textContent = titleEl.textContent.trim();
      const dur = document.querySelector(".ytp-time-duration");
      if (dur) document.querySelector(".yt-detail").textContent = dur.textContent;
      document.getElementById(OVERLAY_ID).classList.add("visible");
    });

    targetParent.insertBefore(btn, insertBeforeEl);
  }

  // ── Hook: Hub button in sidebar ──
  function hookHubButton() {
    const existing = document.getElementById(HUB_BTN_ID);
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    const nav = document.querySelector("#guide-inner-content ytd-guide-entry-renderer:last-child, #sections ytd-guide-entry-renderer:last-child");
    if (!nav) return;

    const btn = document.createElement("div");
    btn.id = HUB_BTN_ID;
    setSafeHtml(btn, `<a class="yt-simple-endpoint style-scope ytd-guide-entry-renderer" tabindex="0"><tp-yt-paper-item class="style-scope ytd-guide-entry-renderer" tabindex="0"><div class="guide-entry-maker style-scope ytd-guide-entry-renderer" title="Downloads Hub"><yt-formatted-string class="style-scope ytd-guide-entry-renderer">⬇ Hub</yt-formatted-string></div></tp-yt-paper-item></a>`);
    btn.style.cursor = "pointer";
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      ensureHub();
      document.getElementById(HUB_ID).classList.add("visible");
    });
    nav.parentNode.insertBefore(btn, nav.nextSibling);
  }

  // ── Observer & Listeners ──
  const observer = new MutationObserver(() => {
    if (isVideoPage()) { hookDownloadButton(); }
    hookHubButton();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("yt-navigate-finish", () => {
    setTimeout(() => {
      hookDownloadButton();
      hookHubButton();
    }, 500);
  });

  hookDownloadButton();
  hookHubButton();
})();
