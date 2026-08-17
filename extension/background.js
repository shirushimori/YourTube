(() => {
  const HOST = "com.yourtube.client";
  const api = typeof browser !== "undefined" ? browser : chrome;
  let nativePort = null;
  let pendingResolve = null;
  let downloadCallback = null;

  function connectNative() {
    if (nativePort) return nativePort;
    nativePort = api.runtime.connectNative(HOST);
    nativePort.onMessage.addListener((msg) => {
      if (downloadCallback) {
        downloadCallback(msg);
      } else if (pendingResolve) {
        pendingResolve(msg);
        pendingResolve = null;
      }
    });
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      if (pendingResolve) {
        pendingResolve({ type: "error", message: "Disconnected" });
        pendingResolve = null;
      }
    });
    return nativePort;
  }

  function sendAndWait(msg, timeoutMs) {
    return new Promise((resolve) => {
      pendingResolve = resolve;
      const port = connectNative();
      port.postMessage(msg);
      setTimeout(() => {
        if (pendingResolve === resolve) {
          pendingResolve = null;
          resolve({ type: "error", message: "Timeout" });
        }
      }, timeoutMs || 30000);
    });
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "fetch_metadata") {
      sendAndWait(msg, 20000).then(sendResponse);
      return true;
    }

    if (msg.type === "download_start") {
      downloadCallback = (progressMsg) => {
        api.tabs.sendMessage(sender.tab.id, {
          type: "download_progress",
          ...progressMsg,
        });
      };

      const port = connectNative();
      port.postMessage(msg);

      sendResponse({ ok: true });
      return true;
    }
  });
})();
