(() => {
  const views = {
    loading: document.getElementById("view-loading"),
    metadata: document.getElementById("view-metadata"),
    progress: document.getElementById("view-progress"),
    error: document.getElementById("view-error"),
  };

  const els = {
    thumbnail: document.getElementById("thumbnail"),
    title: document.getElementById("title"),
    duration: document.getElementById("duration"),
    quality: document.getElementById("quality"),
    outputDir: document.getElementById("output-dir"),
    downloadBtn: document.getElementById("download-btn"),
    dlTitle: document.getElementById("dl-title"),
    progressBar: document.getElementById("progress-bar"),
    progressPercent: document.getElementById("progress-percent"),
    progressSize: document.getElementById("progress-size"),
    progressSpeed: document.getElementById("progress-speed"),
    progressEta: document.getElementById("progress-eta"),
    progressStatus: document.getElementById("progress-status"),
    errorMsg: document.getElementById("error-message"),
    retryBtn: document.getElementById("retry-btn"),
  };

  let currentTabUrl = "";
  let nativePort = null;

  function showView(name) {
    Object.values(views).forEach((v) => v.classList.remove("active"));
    views[name].classList.add("active");
  }

  function formatDuration(seconds) {
    if (!seconds) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function getSelectedDownloadType() {
    return document.querySelector('input[name="dl_type"]:checked').value;
  }

  function connectNative() {
    if (nativePort) return nativePort;
    nativePort = chrome.runtime.connectNative("com.yourtube.client");
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      if (!chrome.runtime.lastError) return;
    });
    return nativePort;
  }

  function sendNativeMessage(msg) {
    const port = connectNative();
    port.postMessage(msg);
  }

  function handleNativeMessage(msg) {
    if (msg.type === "metadata") {
      renderMetadata(msg);
    } else if (msg.type === "download_progress") {
      renderProgress(msg);
    } else if (msg.type === "error") {
      showError(msg.message);
    }
  }

  function renderMetadata(data) {
    els.thumbnail.src = data.thumbnail || "";
    els.thumbnail.style.display = data.thumbnail ? "block" : "none";
    els.title.textContent = data.title || "Unknown title";
    els.duration.textContent = formatDuration(data.duration);
    showView("metadata");
  }

  function renderProgress(data) {
    showView("progress");
    els.dlTitle.textContent = els.title.textContent;

    const pct = data.percent != null ? data.percent : 0;
    els.progressBar.style.width = pct + "%";
    els.progressPercent.textContent = pct.toFixed(1) + "%";
    els.progressSize.textContent =
      data.downloaded && data.total_size
        ? `${data.downloaded} / ${data.total_size}`
        : "";
    els.progressSpeed.textContent = data.speed || "";
    els.progressEta.textContent = data.eta ? `ETA ${data.eta}` : "";
    els.progressStatus.textContent = data.status || "";

    if (data.status === "finished" || data.status === "completed") {
      els.progressBar.style.width = "100%";
      els.progressPercent.textContent = "Done!";
      els.progressStatus.textContent = "Download complete";
      setTimeout(() => showView("metadata"), 2000);
    }
  }

  function showError(message) {
    els.errorMsg.textContent = message;
    showView("error");
  }

  function fetchMetadata(url) {
    showView("loading");
    sendNativeMessage({ type: "fetch_metadata", url: url });
  }

  function startDownload() {
    const url = currentTabUrl;
    const quality = els.quality.value;
    const outputDir = els.outputDir.value || "~/Videos";
    const startTime = document.getElementById("start-time").value || null;
    const endTime = document.getElementById("end-time").value || null;

    showView("progress");
    sendNativeMessage({
      type: "download",
      url: url,
      download_type: getSelectedDownloadType(),
      quality: quality,
      output_dir: outputDir,
      start_time: startTime,
      end_time: endTime,
    });
  }

  // Init
  els.downloadBtn.addEventListener("click", startDownload);
  els.retryBtn.addEventListener("click", () => fetchMetadata(currentTabUrl));

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    currentTabUrl = tabs[0]?.url || "";
    const isYt = /youtube\.com\/watch/.test(currentTabUrl);
    if (!isYt) {
      showError("Open a YouTube video to use YourTube");
      return;
    }
    fetchMetadata(currentTabUrl);
  });
})();
