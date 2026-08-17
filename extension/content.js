(() => {
  const OVERLAY_ID = "yourtube-overlay";
  const HOOK_BTN_ID = "yourtube-hook-btn";
  const TOAST_ID = "yourtube-toast";

  function isVideoPage() {
    return /\/watch\?v=/.test(location.href);
  }

  function getVideoUrl() {
    return location.href;
  }

  function getVideoId() {
    const m = location.href.match(/[?&]v=([^&]+)/);
    return m ? m[1] : null;
  }

  // ── Toast ──
  function ensureToast() {
    if (document.getElementById(TOAST_ID)) return;
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.innerHTML = `
      <div class="toast-title"></div>
      <div class="toast-progress"><div class="toast-bar"></div></div>
      <div class="toast-details">
        <span class="toast-pct"></span>
        <span class="toast-speed"></span>
        <span class="toast-eta"></span>
      </div>
    `;
    document.body.appendChild(toast);
  }

  function showToast(title) {
    ensureToast();
    const t = document.getElementById(TOAST_ID);
    t.querySelector(".toast-title").textContent = title;
    t.querySelector(".toast-bar").style.width = "0%";
    t.classList.add("visible");
  }

  function updateToast(pct, speed, eta) {
    const t = document.getElementById(TOAST_ID);
    if (!t) return;
    t.querySelector(".toast-bar").style.width = pct + "%";
    t.querySelector(".toast-pct").textContent = pct.toFixed(1) + "%";
    if (speed) t.querySelector(".toast-speed").textContent = speed;
    if (eta) t.querySelector(".toast-eta").textContent = "ETA " + eta;
  }

  function hideToast() {
    const t = document.getElementById(TOAST_ID);
    if (t) t.classList.remove("visible");
  }

  // ── Overlay ──
  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div id="yourtube-popup">
        <div class="yt-header">
          <h2>Download</h2>
          <button class="yt-close">&times;</button>
        </div>
        <div class="yt-body">
          <div class="yt-video-info">
            <img class="yt-thumb" src="" alt="">
            <div class="yt-meta">
              <div class="yt-title"></div>
              <div class="yt-detail"></div>
            </div>
          </div>

          <div class="yt-section">
            <label>Download As</label>
            <div class="yt-radios">
              <label>
                <input type="radio" name="yt_type" value="video_audio" checked>
                <span>Both</span>
              </label>
              <label>
                <input type="radio" name="yt_type" value="video_only">
                <span>Video</span>
              </label>
              <label>
                <input type="radio" name="yt_type" value="audio_only">
                <span>Audio</span>
              </label>
            </div>
          </div>

          <div class="yt-section">
            <label>Quality</label>
            <select class="yt-quality">
              <option value="2160">2160p (4K)</option>
              <option value="1440">1440p (2K)</option>
              <option value="1080" selected>1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </div>

          <div class="yt-section">
            <label class="yt-checkbox">
              <input type="checkbox" class="yt-playlist-check">
              <span>Download playlist</span>
            </label>
          </div>

          <div class="yt-section">
            <label>Time Range (optional)</label>
            <div class="yt-time-range">
              <input type="text" class="yt-start" placeholder="00:00:00">
              <span>to</span>
              <input type="text" class="yt-end" placeholder="end">
            </div>
          </div>

          <div class="yt-section">
            <label>Save to</label>
            <input type="text" class="yt-path" value="/home/mori/Videos">
          </div>

          <button class="yt-download-btn">Download</button>
          <div class="yt-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector(".yt-close").addEventListener("click", () => {
      overlay.classList.remove("visible");
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("visible");
    });

    overlay.querySelector(".yt-download-btn").addEventListener("click", handleDownload);
  }

  async function handleDownload() {
    const overlay = document.getElementById(OVERLAY_ID);
    const status = overlay.querySelector(".yt-status");
    const btn = overlay.querySelector(".yt-download-btn");

    const url = getVideoUrl();
    const downloadType = overlay.querySelector('input[name="yt_type"]:checked').value;
    const quality = overlay.querySelector(".yt-quality").value;
    const playlist = overlay.querySelector(".yt-playlist-check").checked;
    const startTime = overlay.querySelector(".yt-start").value || null;
    const endTime = overlay.querySelector(".yt-end").value || null;
    const outputDir = overlay.querySelector(".yt-path").value.trim();

    btn.disabled = true;

    // Step 1: fetch metadata
    status.className = "yt-status visible loading";
    status.textContent = "Fetching video info...";

    const meta = await chrome.runtime.sendMessage({ type: "fetch_metadata", url });

    if (!meta || meta.type === "error") {
      status.className = "yt-status visible error";
      status.textContent = (meta && meta.message) || "Failed to connect";
      btn.disabled = false;
      return;
    }

    // Step 2: start download via background
    status.className = "yt-status visible loading";
    status.textContent = "Starting download...";
    showToast(meta.title || "Downloading...");

    await chrome.runtime.sendMessage({
      type: "download_start",
      url,
      download_type: downloadType,
      quality,
      output_dir: outputDir,
      playlist,
      start_time: startTime,
      end_time: endTime,
    });

    btn.disabled = false;
  }

  // Listen for progress from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "download_progress") {
      const pct = msg.percent != null ? msg.percent : 0;
      updateToast(pct, msg.speed, msg.eta);

      const status = document.querySelector("#yourtube-overlay .yt-status");
      if (status) {
        const parts = [pct.toFixed(1) + "%"];
        if (msg.speed) parts.push(msg.speed);
        if (msg.eta) parts.push("ETA " + msg.eta);
        if (msg.downloaded && msg.total_size) parts.push(msg.downloaded + " / " + msg.total_size);
        status.className = "yt-status visible loading";
        status.textContent = parts.join("  |  ");
      }

      if (msg.status === "finished" || msg.status === "completed") {
        if (status) {
          status.className = "yt-status visible success";
          status.textContent = "Done! " + (msg.total_size || "");
        }
        hideToast();
      } else if (msg.type === "error") {
        if (status) {
          status.className = "yt-status visible error";
          status.textContent = msg.message || "Failed";
        }
        hideToast();
      }
    }
  });

  // ── Hook ──
  function hookDownloadButton() {
    if (!isVideoPage()) return;
    if (document.getElementById(HOOK_BTN_ID)) return;

    const actionsRow =
      document.querySelector("#above-the-fold #menu-container") ||
      document.querySelector("ytd-watch-metadata #above-the-fold") ||
      document.querySelector("#actions ytd-menu-renderer");

    if (!actionsRow) return;

    const btn = document.createElement("button");
    btn.id = HOOK_BTN_ID;
    btn.textContent = "Download";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ensureOverlay();
      const vid = getVideoId();
      if (vid) {
        document.querySelector(".yt-thumb").src = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      }
      const titleEl = document.querySelector(
        "h1.ytd-watch-metadata, #above-the-fold #title yt-formatted-string"
      );
      if (titleEl) {
        document.querySelector(".yt-title").textContent = titleEl.textContent.trim();
      }
      const durationEl = document.querySelector(".ytp-time-duration");
      if (durationEl) {
        document.querySelector(".yt-detail").textContent = durationEl.textContent;
      }
      document.getElementById(OVERLAY_ID).classList.add("visible");
    });

    actionsRow.appendChild(btn);
  }

  const observer = new MutationObserver(() => {
    if (isVideoPage()) {
      hookDownloadButton();
    } else {
      const btn = document.getElementById(HOOK_BTN_ID);
      if (btn) btn.remove();
      const overlay = document.getElementById(OVERLAY_ID);
      if (overlay) overlay.classList.remove("visible");
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  hookDownloadButton();
})();
