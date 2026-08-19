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
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }
  function getFileIcon(ext) {
    if (!ext) return "&#128196;";
    const e = ext.toLowerCase();
    if (["mp4","webm","mkv","avi","mov","flv"].includes(e)) return "&#127909;";
    if (["mp3","wav","flac","aac","ogg","opus","m4a"].includes(e)) return "&#127925;";
    return "&#128196;";
  }
  function getMediaType(ext) {
    if (!ext) return "other";
    const e = ext.toLowerCase();
    if (["mp4","webm","mkv","avi","mov","flv"].includes(e)) return "video";
    if (["mp3","wav","flac","aac","ogg","opus","m4a"].includes(e)) return "audio";
    return "other";
  }

  // ── Settings ──
  let hubSettings = { fullscreen: false, showThumbnails: true, defaultFolder: "/home/mori/Videos" };

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

  // ── Toast ──
  function ensureToast() {
    if (document.getElementById(TOAST_ID)) return;
    const t = document.createElement("div");
    t.id = TOAST_ID;
    setSafeHtml(t, `<div class="toast-title"></div><div class="toast-progress"><div class="toast-bar"></div></div><div class="toast-details"><span class="toast-pct"></span><span class="toast-speed"></span><span class="toast-eta"></span></div>`);
    document.body.appendChild(t);
  }
  function showToast(title) {
    ensureToast();
    const t = document.getElementById(TOAST_ID);
    t.querySelector(".toast-title").textContent = title;
    t.querySelector(".toast-bar").style.width = "0%";
    t.classList.add("visible");
  }
  function updateToast(pct, speed, eta) {
    const t = document.getElementById(TOAST_ID); if (!t) return;
    t.querySelector(".toast-bar").style.width = pct + "%";
    t.querySelector(".toast-pct").textContent = pct.toFixed(1) + "%";
    if (speed) t.querySelector(".toast-speed").textContent = speed;
    if (eta) t.querySelector(".toast-eta").textContent = "ETA " + eta;
  }
  function hideToast() { const t = document.getElementById(TOAST_ID); if (t) t.classList.remove("visible"); }

  // ── Video Popup Player ──
  function openVideoPopup(src, meta) {
    const old = document.getElementById(VIDEO_POPUP_ID);
    if (old) old.remove();

    const popup = document.createElement("div");
    popup.id = VIDEO_POPUP_ID;
    setSafeHtml(popup, `
      <div class="yt-vp-panel">
        <div class="yt-vp-header">
          <div class="yt-vp-title">
            <span class="yt-vp-name">${escapeHtml(meta?.title || "Video")}</span>
            ${meta?.channel ? `<span class="yt-vp-channel">${escapeHtml(meta.channel)}</span>` : ""}
          </div>
          <button class="yt-vp-close">&times;</button>
        </div>
        <video controls autoplay src="${escapeHtml(src)}"></video>
        ${meta ? `
        <div class="yt-vp-meta">
          ${meta.description ? `<div class="yt-vp-desc">${escapeHtml(meta.description).substring(0, 300)}${meta.description.length > 300 ? "..." : ""}</div>` : ""}
          <div class="yt-vp-stats">
            ${meta.view_count ? `<span>&#128065; ${formatNumber(meta.view_count)}</span>` : ""}
            ${meta.like_count ? `<span>&#128077; ${formatNumber(meta.like_count)}</span>` : ""}
            ${meta.upload_date ? `<span>&#128197; ${formatDate(meta.upload_date)}</span>` : ""}
            ${meta.quality ? `<span>&#9881; ${escapeHtml(meta.quality)}</span>` : ""}
            ${meta.download_type ? `<span>${meta.download_type === "audio_only" ? "&#127925; Audio" : meta.download_type === "video_only" ? "&#127909; Video" : "&#128241; Both"}</span>` : ""}
          </div>
          ${meta.source ? `<div class="yt-vp-source"><a href="${escapeHtml(meta.source)}" target="_blank" rel="noopener">${escapeHtml(meta.source)}</a></div>` : ""}
        </div>` : ""}
      </div>
    `);
    document.body.appendChild(popup);

    popup.querySelector(".yt-vp-close").addEventListener("click", () => {
      popup.querySelector("video").pause(); popup.remove();
    });
    popup.addEventListener("click", (e) => {
      if (e.target === popup) { popup.querySelector("video").pause(); popup.remove(); }
    });
  }

  // ── Overlay (Download popup on video page) ──
  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    const o = document.createElement("div");
    o.id = OVERLAY_ID;
    setSafeHtml(o, `
      <div id="yourtube-popup">
        <div class="yt-header"><h2>Download</h2><button class="yt-close">&times;</button></div>
        <div class="yt-body">
          <div class="yt-video-info">
            <img class="yt-thumb" src="" alt="">
            <div class="yt-meta">
              <div class="yt-title"></div>
              <div class="yt-detail"></div>
            </div>
          </div>
          <div class="yt-section"><label>Download As</label>
            <div class="yt-radios">
              <label><input type="radio" name="yt_type" value="video_audio" checked><span>Both</span></label>
              <label><input type="radio" name="yt_type" value="video_only"><span>Video</span></label>
              <label><input type="radio" name="yt_type" value="audio_only"><span>Audio</span></label>
            </div>
          </div>
          <div class="yt-section"><label>Quality</label>
            <select class="yt-quality">
              <option value="2160">2160p (4K)</option>
              <option value="1440">1440p (2K)</option>
              <option value="1080" selected>1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </div>
          <div class="yt-section"><label class="yt-checkbox"><input type="checkbox" class="yt-playlist-check"><span>Download playlist</span></label></div>
          <div class="yt-section"><label>Time Range (optional)</label>
            <div class="yt-time-range"><input type="text" class="yt-start" placeholder="00:00:00"><span>to</span><input type="text" class="yt-end" placeholder="end"></div>
          </div>
          <div class="yt-section"><label>Save to</label><input type="text" class="yt-path" value="${hubSettings.defaultFolder}"></div>
          <button class="yt-download-btn">Download</button>
          <div class="yt-status"></div>
        </div>
      </div>
    `);
    document.body.appendChild(o);
    o.querySelector(".yt-close").addEventListener("click", () => o.classList.remove("visible"));
    o.addEventListener("click", (e) => { if (e.target === o) o.classList.remove("visible"); });
    o.querySelector(".yt-download-btn").addEventListener("click", handleDownload);
  }

  async function handleDownload() {
    const overlay = document.getElementById(OVERLAY_ID);
    const status = overlay.querySelector(".yt-status");
    const btn = overlay.querySelector(".yt-download-btn");
    const url = getVideoUrl();
    const downloadType = overlay.querySelector('input[name="yt_type"]:checked').value;
    const quality = overlay.querySelector(".yt-quality").value;
    const startTime = overlay.querySelector(".yt-start").value || null;
    const endTime = overlay.querySelector(".yt-end").value || null;
    const outputDir = overlay.querySelector(".yt-path").value.trim();

    btn.disabled = true;
    status.className = "yt-status visible loading";
    status.textContent = "Fetching video info...";

    const meta = await chrome.runtime.sendMessage({ type: "fetch_metadata", url });
    if (!meta || meta.type === "error") {
      status.className = "yt-status visible error";
      status.textContent = (meta && meta.message) || "Failed to connect";
      btn.disabled = false;
      return;
    }

    status.className = "yt-status visible loading";
    status.textContent = "Starting download...";
    showToast(meta.title || "Downloading...");

    await chrome.runtime.sendMessage({
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
      quality,
      output_dir: outputDir,
      start_time: startTime,
      end_time: endTime,
    });

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
        if (status) { status.className = "yt-status visible success"; status.textContent = "Done! " + (msg.total_size || ""); }
        hideToast();
      }
    } else if (msg.type === "error") {
      if (status) { status.className = "yt-status visible error"; status.textContent = msg.message || "Failed"; }
      hideToast();
    }
  });

  // ══════════════════════════════════════════
  // ── Downloads Hub ──
  // ══════════════════════════════════════════
  let hubOpenMode = "tab";
  let hubFilter = "all";
  let hubTracked = [];
  let hubFileList = [];

  function ensureHub() {
    if (document.getElementById(HUB_ID)) return;
    const hub = document.createElement("div");
    hub.id = HUB_ID;
    setSafeHtml(hub, `
      <div class="yt-hub-panel">
        <div class="yt-hub-header">
          <h2>Downloads Hub</h2>
          <div class="yt-hub-header-actions">
            <button class="yt-hub-close">&times;</button>
          </div>
        </div>
        <div class="yt-hub-settings">
          <label>Folder</label>
          <div class="yt-hub-folder">
            <input type="text" class="yt-hub-path" value="${hubSettings.defaultFolder}" placeholder="Download folder path">
            <button class="yt-hub-refresh">Refresh</button>
          </div>
        </div>
        <div class="yt-hub-tabs">
          <button class="yt-hub-tab active" data-tab="all">All</button>
          <button class="yt-hub-tab" data-tab="video">Video</button>
          <button class="yt-hub-tab" data-tab="audio">Audio</button>
          <button class="yt-hub-tab" data-tab="tracked">Tracked</button>
          <button class="yt-hub-tab" data-tab="playlists">Playlists</button>
        </div>
        <div class="yt-hub-content">
          <div class="yt-hub-list" id="yt-hub-all"></div>
          <div class="yt-hub-list hidden" id="yt-hub-video"></div>
          <div class="yt-hub-list hidden" id="yt-hub-audio"></div>
          <div class="yt-hub-list hidden" id="yt-hub-tracked"></div>
          <div class="yt-hub-list hidden" id="yt-hub-playlists"></div>
        </div>
        <div class="yt-hub-empty hidden">No downloads found</div>
      </div>
    `);
    document.body.appendChild(hub);

    // Fullscreen state
    if (hubSettings.fullscreen) hub.classList.add("fullscreen");

    hub.querySelector(".yt-hub-close").addEventListener("click", () => hub.classList.remove("visible"));
    hub.addEventListener("click", (e) => { if (e.target === hub) hub.classList.remove("visible"); });

    // Fullscreen toggle
    hub.querySelector(".yt-hub-fullscreen").addEventListener("click", () => {
      hubSettings.fullscreen = !hubSettings.fullscreen;
      hub.classList.toggle("fullscreen", hubSettings.fullscreen);
      saveSettings();
      if (hubSettings.fullscreen) loadHubFiles();
    });

    // Mode toggle
    hub.querySelectorAll(".yt-hub-mode").forEach((btn) => {
      btn.addEventListener("click", () => {
        hub.querySelectorAll(".yt-hub-mode").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        hubOpenMode = btn.dataset.mode;
      });
    });

    // Filter tabs
    hub.querySelectorAll(".yt-hub-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        hub.querySelectorAll(".yt-hub-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        hubFilter = tab.dataset.tab;
        applyFilter();
      });
    });

    hub.querySelector(".yt-hub-refresh").addEventListener("click", () => loadHubFiles());
    hub.querySelector(".yt-hub-path").addEventListener("change", () => {
      hubSettings.defaultFolder = hub.querySelector(".yt-hub-path").value.trim();
      saveSettings();
      loadHubFiles();
    });

    loadHubFiles();
    loadTrackedDownloads();
    loadPlaylists();
  }

  function applyFilter() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    ["all","video","audio","tracked","playlists"].forEach((f) => {
      const el = hub.querySelector(`#yt-hub-${f}`);
      if (el) el.classList.toggle("hidden", hubFilter !== f);
    });
    const empty = hub.querySelector(".yt-hub-empty");
    const visibleList = hub.querySelector(`#yt-hub-${hubFilter}`);
    const hasItems = visibleList && visibleList.children.length > 0;
    empty.classList.toggle("hidden", hasItems);
    if (!hasItems) {
      empty.textContent = hubFilter === "playlists" ? "No playlists yet" : "No downloads found";
    }
  }

  async function loadHubFiles() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const dir = hub.querySelector(".yt-hub-path").value.trim() || hubSettings.defaultFolder;
    const allList = hub.querySelector("#yt-hub-all");
    const empty = hub.querySelector(".yt-hub-empty");

    setSafeHtml(allList, '<div class="yt-hub-loading">Loading...</div>');
    empty.classList.add("hidden");

    const result = await chrome.runtime.sendMessage({ type: "list_downloads", directory: dir });
    if (!result || result.type === "error") {
      setSafeHtml(allList, `<div class="yt-hub-error">${(result && result.message) || "Failed to load"}</div>`);
      return;
    }

    hubFileList = result.files || [];
    renderFileLists();
  }

  function renderFileLists() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const allList = hub.querySelector("#yt-hub-all");
    const videoList = hub.querySelector("#yt-hub-video");
    const audioList = hub.querySelector("#yt-hub-audio");

    const videoFiles = hubFileList.filter((f) => getMediaType(f.ext) === "video");
    const audioFiles = hubFileList.filter((f) => getMediaType(f.ext) === "audio");

    setSafeHtml(allList, renderFileItems(hubFileList));
    setSafeHtml(videoList, renderFileItems(videoFiles));
    setSafeHtml(audioList, renderFileItems(audioFiles));

    // Attach click handlers
    [allList, videoList, audioList].forEach((list) => {
      list.querySelectorAll(".yt-hub-item").forEach((item) => {
        item.addEventListener("click", (e) => {
          if (e.target.closest(".yt-hub-play-btn")) return;
          handleFileItemClick(item);
        });
        const playBtn = item.querySelector(".yt-hub-play-btn");
        if (playBtn) {
          playBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleFileItemClick(item);
          });
        }
      });
    });

    applyFilter();
  }

  function renderFileItems(files) {
    if (files.length === 0) return '<div class="yt-hub-empty-inline">No files</div>';
    const thumb = hubSettings.fullscreen && hubSettings.showThumbnails;

    return files.map((f) => {
      const isVideo = getMediaType(f.ext) === "video";
      const thumbUrl = isVideo ? `https://i.ytimg.com/vi/${guessVideoId(f.name)}/hqdefault.jpg` : "";

      return `
        <div class="yt-hub-item ${isVideo ? "is-video" : "is-audio"}" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}" data-ext="${escapeHtml(f.ext || "")}" ${thumb && isVideo ? `style="background-image:url('${thumbUrl}')"` : ""}>
          <div class="yt-hub-item-inner">
            <div class="yt-hub-icon">${getFileIcon(f.ext)}</div>
            <div class="yt-hub-info">
              <div class="yt-hub-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
              <div class="yt-hub-meta">${formatSize(f.size)} &middot; ${escapeHtml(f.modified)}</div>
            </div>
            <button class="yt-hub-play-btn" title="Play">&#9654;</button>
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

  function handleFileItemClick(item) {
    const path = item.dataset.path;
    const name = item.dataset.name;
    const ext = item.dataset.ext;

    // Try to match against tracked downloads for metadata
    const tracked = hubTracked.find((t) => {
      if (!t.file_path) return false;
      return path.includes(t.file_path) || t.file_path.includes(path);
    });

    const meta = tracked ? {
      title: tracked.title,
      description: tracked.description,
      channel: tracked.channel,
      view_count: tracked.view_count,
      like_count: tracked.like_count,
      upload_date: tracked.upload_date,
      source: tracked.source,
      quality: tracked.quality,
      download_type: tracked.download_type,
    } : { title: name.replace(/\.[^.]+$/, "") };

    serveAndPlay(path, name, meta, item);
  }

  async function serveAndPlay(path, name, meta, item) {
    const playBtn = item?.querySelector(".yt-hub-play-btn");
    if (playBtn) { playBtn.disabled = true; playBtn.textContent = "..."; }

    const result = await chrome.runtime.sendMessage({ type: "serve_file", path });

    if (playBtn) { playBtn.disabled = false; setSafeHtml(playBtn, "&#9654;"); }
    if (!result || result.type === "error") { alert("Failed: " + (result?.message || "Unknown")); return; }

    if (hubOpenMode === "tab") {
      const html = `<!DOCTYPE html><html><head><title>${escapeHtml(meta?.title || name)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column}video{max-width:100%;max-height:80vh}.info{color:#f1f1f1;padding:16px;text-align:center;font-family:sans-serif}.info h2{font-size:18px;margin-bottom:8px}.info p{font-size:13px;color:#aaa}</style></head><body><video controls autoplay src="${result.url}"></video><div class="info"><h2>${escapeHtml(meta?.title || name)}</h2>${meta?.channel ? `<p>${escapeHtml(meta.channel)}</p>` : ""}${meta?.description ? `<p>${escapeHtml(meta.description).substring(0,200)}</p>` : ""}</div></body></html>`;
      const blob = new Blob([html], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
    } else {
      openVideoPopup(result.url, meta);
    }
  }

  // ── Tracked downloads ──
  async function loadTrackedDownloads() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const list = hub.querySelector("#yt-hub-tracked");
    try {
      const result = await chrome.runtime.sendMessage({ type: "get_tracked_downloads" });
      hubTracked = result?.downloads || [];
      renderTrackedList();
    } catch {
      setSafeHtml(list, '<div class="yt-hub-error">Failed to load</div>');
    }
  }

  function renderTrackedList() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const list = hub.querySelector("#yt-hub-tracked");

    const filtered = hubFilter === "all" ? hubTracked :
      hubTracked.filter((d) => {
        if (hubFilter === "video") return d.download_type !== "audio_only";
        if (hubFilter === "audio") return d.download_type === "audio_only";
        return true;
      });

    if (filtered.length === 0) { setSafeHtml(list, '<div class="yt-hub-empty-inline">No tracked downloads</div>'); applyFilter(); return; }

    setSafeHtml(list, filtered.map((d) => `
      <div class="yt-hub-item tracked ${d.status}" data-url="${escapeHtml(d.url)}" data-id="${d.id || ""}">
        <div class="yt-hub-item-inner">
          ${d.thumbnail ? `<img class="yt-hub-thumb" src="${escapeHtml(d.thumbnail)}" alt="">` : `<div class="yt-hub-icon">${d.status === "completed" ? "&#10003;" : "&#9654;"}</div>`}
          <div class="yt-hub-info">
            <div class="yt-hub-name" title="${escapeHtml(d.title || d.url)}">${escapeHtml(d.title || "Untitled")}</div>
            <div class="yt-hub-meta">
              ${d.channel ? `<span class="yt-hub-channel">${escapeHtml(d.channel)}</span>` : ""}
              ${d.quality ? `<span>${escapeHtml(d.quality)}p</span>` : ""}
              <span>${d.download_type === "audio_only" ? "&#127925; Audio" : d.download_type === "video_only" ? "&#127909; Video" : "&#128241; Both"}</span>
              <span>${d.status}</span>
              <span>${timeAgo(d.timestamp)}</span>
            </div>
            ${d.view_count || d.like_count ? `<div class="yt-hub-stats">${d.view_count ? "&#128065; " + formatNumber(d.view_count) : ""} ${d.like_count ? "&#128077; " + formatNumber(d.like_count) : ""}</div>` : ""}
          </div>
          <button class="yt-hub-play-btn" title="Open">&#8599;</button>
        </div>
      </div>
    `).join(""));

    list.querySelectorAll(".yt-hub-item.tracked").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.closest(".yt-hub-play-btn")) return;
        const d = filtered.find((x) => String(x.id) === item.dataset.id || x.url === item.dataset.url);
        if (d?.status === "completed" && d.file_path) {
          serveAndPlay(d.file_path, d.title || "video", d, item);
        } else {
          window.open(item.dataset.url, "_blank");
        }
      });
      const playBtn = item.querySelector(".yt-hub-play-btn");
      if (playBtn) {
        playBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const d = filtered.find((x) => String(x.id) === item.dataset.id || x.url === item.dataset.url);
          if (d?.status === "completed" && d.file_path) {
            serveAndPlay(d.file_path, d.title || "video", d, item);
          } else {
            window.open(item.dataset.url, "_blank");
          }
        });
      }
    });

    applyFilter();
  }

  // ── Playlists ──
  async function loadPlaylists() {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const list = hub.querySelector("#yt-hub-playlists");
    try {
      const result = await chrome.runtime.sendMessage({ type: "get_playlists" });
      const playlists = result?.playlists || [];
      renderPlaylists(playlists);
    } catch {
      setSafeHtml(list, '<div class="yt-hub-error">Failed to load playlists</div>');
    }
  }

  function renderPlaylists(playlists) {
    const hub = document.getElementById(HUB_ID); if (!hub) return;
    const list = hub.querySelector("#yt-hub-playlists");

    const header = `
      <div class="yt-hub-playlist-actions">
        <button class="yt-hub-create-playlist">+ New Playlist</button>
        <button class="yt-hub-import-playlist">Import</button>
      </div>
    `;

    if (playlists.length === 0) {
      setSafeHtml(list, header + '<div class="yt-hub-empty-inline">No playlists yet</div>');
      attachPlaylistHandlers([]);
      applyFilter();
      return;
    }

    setSafeHtml(list, header + playlists.map((pl) => `
      <div class="yt-hub-playlist-card" data-id="${pl.id}">
        <div class="yt-hub-playlist-header">
          <span class="yt-hub-playlist-name">${escapeHtml(pl.name)}</span>
          <span class="yt-hub-playlist-count">${pl.items?.length || 0} items</span>
          <div class="yt-hub-playlist-btns">
            <button class="yt-hub-pl-export" title="Export">&#8681;</button>
            <button class="yt-hub-pl-delete" title="Delete">&#128465;</button>
          </div>
        </div>
        <div class="yt-hub-playlist-items">
          ${(pl.items || []).slice(0, 5).map((item) => `
            <div class="yt-hub-playlist-item">
              <span class="yt-hub-pl-item-title">${escapeHtml(item.title || "Untitled")}</span>
              <span class="yt-hub-pl-item-meta">${escapeHtml(item.quality || "")}p &middot; ${item.download_type === "audio_only" ? "Audio" : item.download_type === "video_only" ? "Video" : "Both"}</span>
            </div>
          `).join("")}
          ${(pl.items || []).length > 5 ? `<div class="yt-hub-pl-more">+${pl.items.length - 5} more</div>` : ""}
        </div>
      </div>
    `).join(""));

    attachPlaylistHandlers(playlists);
    applyFilter();
  }

  function attachPlaylistHandlers(playlists) {
    const hub = document.getElementById(HUB_ID); if (!hub) return;

    hub.querySelector(".yt-hub-create-playlist")?.addEventListener("click", async () => {
      const name = prompt("Playlist name:");
      if (!name) return;
      await chrome.runtime.sendMessage({ type: "save_playlist", name, items: [] });
      loadPlaylists();
    });

    hub.querySelector(".yt-hub-import-playlist")?.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          await chrome.runtime.sendMessage({
            type: "save_playlist",
            name: data.name || "Imported Playlist",
            items: data.items || [],
          });
          loadPlaylists();
        } catch (err) {
          alert("Invalid playlist file");
        }
      });
      input.click();
    });

    hub.querySelectorAll(".yt-hub-pl-export").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const card = btn.closest(".yt-hub-playlist-card");
        const pl = playlists.find((p) => String(p.id) === card?.dataset.id);
        if (!pl) return;
        const blob = new Blob([JSON.stringify(pl, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${pl.name.replace(/[^a-z0-9]/gi, "_")}.json`;
        a.click(); URL.revokeObjectURL(url);
      });
    });

    hub.querySelectorAll(".yt-hub-pl-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this playlist?")) return;
        const card = btn.closest(".yt-hub-playlist-card");
        await chrome.runtime.sendMessage({ type: "delete_playlist", id: Number(card?.dataset.id) });
        loadPlaylists();
      });
    });

    // Add to playlist buttons on tracked items
    hub.querySelectorAll(".yt-hub-item.tracked").forEach((item) => {
      const existing = item.querySelector(".yt-hub-add-pl");
      if (existing) return;
      const btn = document.createElement("button");
      btn.className = "yt-hub-add-pl";
      btn.title = "Add to playlist";
      btn.textContent = "+";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const d = hubTracked.find((x) => String(x.id) === item.dataset.id);
        if (!d) return;
        if (playlists.length === 0) {
          alert("Create a playlist first");
          return;
        }
        const names = playlists.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
        const choice = prompt(`Add to playlist (enter number):\n${names}`);
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < playlists.length) {
          const pl = playlists[idx];
          pl.items = pl.items || [];
          pl.items.push({
            url: d.url, title: d.title, quality: d.quality,
            download_type: d.download_type, file_path: d.file_path,
          });
          await chrome.runtime.sendMessage({ type: "save_playlist", name: pl.name, items: pl.items });
          await chrome.runtime.sendMessage({ type: "delete_playlist", id: pl.id });
          loadPlaylists();
        }
      });
      item.querySelector(".yt-hub-item-inner")?.appendChild(btn);
    });
  }

  // ── Hook: Download button on video page ──
  function hookDownloadButton() {
    if (!isVideoPage()) return;
    if (document.getElementById(HOOK_BTN_ID)) return;
    const row = document.querySelector("#above-the-fold #menu-container") ||
      document.querySelector("ytd-watch-metadata #above-the-fold") ||
      document.querySelector("#actions ytd-menu-renderer");
    if (!row) return;

    const btn = document.createElement("button");
    btn.id = HOOK_BTN_ID;
    setSafeHtml(btn, `<svg viewBox="0 0 24 24" width="20" height="20" style="fill: currentColor; margin-right: 6px;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>Download`);
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      ensureOverlay();
      const vid = getVideoId();
      if (vid) document.querySelector(".yt-thumb").src = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      const titleEl = document.querySelector("h1.ytd-watch-metadata, #above-the-fold #title yt-formatted-string");
      if (titleEl) document.querySelector(".yt-title").textContent = titleEl.textContent.trim();
      const dur = document.querySelector(".ytp-time-duration");
      if (dur) document.querySelector(".yt-detail").textContent = dur.textContent;
      document.getElementById(OVERLAY_ID).classList.add("visible");
    });
    row.insertBefore(btn, row.firstChild);
  }

  // ── Hook: Hub button in sidebar ──
  function hookHubButton() {
    if (document.getElementById(HUB_BTN_ID)) return;
    const nav = document.querySelector("#guide-inner-content ytd-guide-entry-renderer:last-child");
    if (!nav) return;
    const btn = document.createElement("div");
    btn.id = HUB_BTN_ID;
    setSafeHtml(btn, `<a class="yt-simple-endpoint style-scope ytd-guide-entry-renderer" tabindex="0"><tp-yt-paper-item class="style-scope ytd-guide-entry-renderer" tabindex="0"><ytd-badge-supported-renderer class="style-scope ytd-guide-entry-renderer" style="display: none;"></ytd-badge-supported-renderer><div class="guide-entry-maker style-scope ytd-guide-entry-renderer" title="Downloads Hub"><span style="margin-right: 16px;">&#128229;</span><yt-formatted-string class="style-scope ytd-guide-entry-renderer">Downloads</yt-formatted-string></div></tp-yt-paper-item></a>`);
    btn.style.cursor = "pointer";
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      ensureHub();
      document.getElementById(HUB_ID).classList.add("visible");
    });
    nav.parentNode.insertBefore(btn, nav.nextSibling);
  }

  // ── Hook: YouTube downloads page section ──
  function hookDownloadsPageSection() {
    if (!isDownloadsPage()) return;
    if (document.getElementById("yourtube-dl-section")) return;
    const renderer = document.querySelector("ytd-browse, ytd-section-list-renderer, #contents");
    if (!renderer) return;

    const section = document.createElement("div");
    section.id = "yourtube-dl-section";
    section.className = "yourtube-dl-section";
    setSafeHtml(section, `
      <div class="yourtube-dl-header"><h2>YourTube</h2><button class="yourtube-dl-open-hub">Open Hub</button></div>
      <div class="yourtube-dl-body">
        <p>Download videos directly from YouTube using YourTube.</p>
        <div class="yourtube-dl-actions">
          <button class="yourtube-dl-overlay-btn">Quick Download</button>
          <button class="yourtube-dl-hub-btn">Browse Downloads</button>
        </div>
      </div>
    `);
    const contents = renderer.querySelector("#contents") || renderer;
    contents.insertBefore(section, contents.firstChild);

    section.querySelector(".yourtube-dl-overlay-btn").addEventListener("click", () => { ensureOverlay(); document.getElementById(OVERLAY_ID).classList.add("visible"); });
    section.querySelector(".yourtube-dl-hub-btn").addEventListener("click", () => { ensureHub(); document.getElementById(HUB_ID).classList.add("visible"); });
    section.querySelector(".yourtube-dl-open-hub").addEventListener("click", () => { ensureHub(); document.getElementById(HUB_ID).classList.add("visible"); });
  }

  // ── Observer ──
  const observer = new MutationObserver(() => {
    if (isVideoPage()) { hookDownloadButton(); }
    else {
      const btn = document.getElementById(HOOK_BTN_ID); if (btn) btn.remove();
      const o = document.getElementById(OVERLAY_ID); if (o) o.classList.remove("visible");
    }
    if (isDownloadsPage()) hookDownloadsPageSection();
    hookHubButton();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  hookDownloadButton();
  hookHubButton();
  hookDownloadsPageSection();
})();
