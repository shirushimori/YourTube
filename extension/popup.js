(() => {
  const HOST = "com.yourtube.client";
  const urlInput = document.getElementById("url");
  const goBtn = document.getElementById("go-btn");
  const statusDiv = document.getElementById("status");

  function showStatus(type, text) {
    statusDiv.className = type;
    statusDiv.textContent = text;
  }

  goBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    if (!url) {
      showStatus("error", "Enter a URL");
      return;
    }

    goBtn.disabled = true;

    const port = chrome.runtime.connectNative(HOST);

    port.onMessage.addListener((msg) => {
      if (msg.type === "metadata") {
        showStatus("success", "Title: " + (msg.title || "?") + "\nFormats: " + (msg.formats ? msg.formats.length : 0));

        // Start download
        const downloadType = document.querySelector('input[name="dl_type"]:checked').value;
        const quality = document.getElementById("quality").value;
        const outputDir = document.getElementById("output-dir").value.trim();

        showStatus("loading", "Downloading: " + (msg.title || url) + "...");
        port.postMessage({
          type: "download",
          url: url,
          download_type: downloadType,
          quality: quality,
          output_dir: outputDir,
        });
      } else if (msg.type === "download_progress") {
        const pct = msg.percent != null ? msg.percent.toFixed(1) + "%" : "?";
        const parts = [pct];
        if (msg.speed) parts.push(msg.speed);
        if (msg.eta) parts.push("ETA " + msg.eta);
        if (msg.downloaded && msg.total_size) parts.push(msg.downloaded + " / " + msg.total_size);
        showStatus("loading", parts.join("  |  "));

        if (msg.status === "finished" || msg.status === "completed") {
          showStatus("success", "Done! " + (msg.total_size || ""));
          goBtn.disabled = false;
          port.disconnect();
        }
      } else if (msg.type === "error") {
        showStatus("error", msg.message || "Unknown error");
        goBtn.disabled = false;
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err && err.message) {
        showStatus("error", err.message);
      }
      goBtn.disabled = false;
    });

    // Fetch metadata
    port.postMessage({ type: "fetch_metadata", url: url });
  });
})();
