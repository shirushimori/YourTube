(() => {
  const HOST = "com.yourtube.client";
  const api = typeof browser !== "undefined" ? browser : chrome;
  let nativePort = null;
  let activeTabId = null;

  // Request/Response callback maps
  let pendingMetaCallback = null;
  let pendingListCallback = null;
  let pendingServeCallback = null;

  function safeClone(data) {
    try {
      return JSON.parse(JSON.stringify(data));
    } catch {
      return { type: "error", message: "Clone error" };
    }
  }

  function getNativePort() {
    if (nativePort) return nativePort;
    try {
      nativePort = api.runtime.connectNative(HOST);
    } catch (e) {
      nativePort = null;
      return null;
    }

    nativePort.onMessage.addListener((rawMsg) => {
      const msg = safeClone(rawMsg);
      if (msg.type === "metadata" && pendingMetaCallback) {
        const cb = pendingMetaCallback;
        pendingMetaCallback = null;
        try { cb(msg); } catch (_) {}
      } else if (msg.type === "downloads_list" && pendingListCallback) {
        const cb = pendingListCallback;
        pendingListCallback = null;
        try { cb(msg); } catch (_) {}
      } else if (msg.type === "file_served" && pendingServeCallback) {
        const cb = pendingServeCallback;
        pendingServeCallback = null;
        try { cb(msg); } catch (_) {}
      } else {
        // Broadcast progress/status events to active tabs
        if (activeTabId) {
          api.tabs.sendMessage(activeTabId, msg).catch(() => {});
        }
        api.tabs.query({ active: true }, (tabs) => {
          if (tabs) {
            for (const t of tabs) {
              if (t.id && t.id !== activeTabId) {
                api.tabs.sendMessage(t.id, msg).catch(() => {});
              }
            }
          }
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      nativePort = null;
      const errMsg = safeClone({
        type: "error",
        message: err ? err.message : "Client disconnected",
      });

      if (pendingMetaCallback) {
        const cb = pendingMetaCallback;
        pendingMetaCallback = null;
        try { cb(errMsg); } catch (_) {}
      }
      if (pendingListCallback) {
        const cb = pendingListCallback;
        pendingListCallback = null;
        try { cb(errMsg); } catch (_) {}
      }
      if (pendingServeCallback) {
        const cb = pendingServeCallback;
        pendingServeCallback = null;
        try { cb(errMsg); } catch (_) {}
      }

      if (activeTabId) {
        api.tabs.sendMessage(activeTabId, errMsg).catch(() => {});
        activeTabId = null;
      }
    });

    return nativePort;
  }

  // ── IndexedDB ──
  const DB_NAME = "yourtube_downloads";
  const DB_VERSION = 2;
  const STORE_NAME = "downloads";
  const PLAYLIST_STORE = "playlists";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
          store.createIndex("url", "url", { unique: false });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("type", "type", { unique: false });
        }
        if (!db.objectStoreNames.contains(PLAYLIST_STORE)) {
          const ps = db.createObjectStore(PLAYLIST_STORE, { keyPath: "id", autoIncrement: true });
          ps.createIndex("name", "name", { unique: false });
          ps.createIndex("created", "created", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDownload(entry) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).add(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getDownloads() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).index("timestamp").getAll();
      req.onsuccess = () => resolve(req.result.reverse());
      req.onerror = () => reject(req.error);
    });
  }

  async function updateDownloadByUrl(url, updates) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index("url");
      const req = idx.openCursor(IDBKeyRange.only(url));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          store.put({ ...cursor.value, ...updates });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Playlists ──
  async function savePlaylist(playlist) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLIST_STORE, "readwrite");
      tx.objectStore(PLAYLIST_STORE).add(playlist);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getPlaylists() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLIST_STORE, "readonly");
      const req = tx.objectStore(PLAYLIST_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function deletePlaylist(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLIST_STORE, "readwrite");
      tx.objectStore(PLAYLIST_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Message dispatcher
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === "fetch_metadata") {
      const port = getNativePort();
      if (!port) {
        sendResponse({ type: "error", message: "Failed to connect to native client" });
        return false;
      }
      pendingMetaCallback = sendResponse;
      port.postMessage({ type: "fetch_metadata", url: msg.url });
      return true;
    }

    if (msg.type === "download_start") {
      activeTabId = sender.tab ? sender.tab.id : null;
      const port = getNativePort();
      if (!port) {
        sendResponse({ ok: false, error: "Native client disconnected" });
        return false;
      }

      port.postMessage({
        type: "download",
        url: msg.url,
        download_type: msg.download_type || "video_audio",
        quality: msg.quality || "1080",
        audio_format: msg.audio_format || "mp3",
        audio_bitrate: msg.audio_bitrate || "192",
        output_dir: msg.output_dir,
        start_time: msg.start_time,
        end_time: msg.end_time,
        download_metadata: msg.download_metadata,
      });

      saveDownload({
        url: msg.url,
        title: msg.title || "",
        description: msg.description || "",
        thumbnail: msg.thumbnail || "",
        channel: msg.channel || "",
        view_count: msg.view_count || 0,
        like_count: msg.like_count || 0,
        upload_date: msg.upload_date || "",
        source: msg.source || "",
        duration: msg.duration || 0,
        output_dir: msg.output_dir || "~/Videos",
        quality: msg.quality || "1080",
        download_type: msg.download_type || "video_audio",
        file_path: "",
        timestamp: Date.now(),
        status: "downloading",
      }).catch(() => {});

      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "list_downloads") {
      const port = getNativePort();
      if (!port) {
        sendResponse({ type: "downloads_list", directory: msg.directory || "~/Videos", files: [] });
        return false;
      }
      const dir = msg.directory || "~/Videos";
      pendingListCallback = sendResponse;
      port.postMessage({ type: "list_downloads", directory: dir });
      return true;
    }

    if (msg.type === "serve_file") {
      const port = getNativePort();
      if (!port) {
        sendResponse({ type: "error", message: "Native client disconnected" });
        return false;
      }
      pendingServeCallback = sendResponse;
      port.postMessage({ type: "serve_file", path: msg.path });
      return true;
    }

    if (msg.type === "get_tracked_downloads") {
      getDownloads().then((downloads) => {
        sendResponse({ type: "tracked_downloads", downloads: safeClone(downloads) });
      }).catch(() => {
        sendResponse({ type: "tracked_downloads", downloads: [] });
      });
      return true;
    }

    if (msg.type === "download_complete") {
      updateDownloadByUrl(msg.url, {
        status: "completed",
        file_path: msg.file_path || "",
      }).catch(() => {});
      return false;
    }

    if (msg.type === "get_playlists") {
      getPlaylists().then((playlists) => {
        sendResponse({ type: "playlists_list", playlists: safeClone(playlists) });
      }).catch(() => {
        sendResponse({ type: "playlists_list", playlists: [] });
      });
      return true;
    }

    if (msg.type === "save_playlist") {
      savePlaylist({
        name: msg.name,
        items: msg.items || [],
        created: Date.now(),
      }).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    if (msg.type === "delete_playlist") {
      deletePlaylist(msg.id).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    if (msg.type === "get_settings") {
      api.storage.local.get("settings", (result) => {
        sendResponse({ settings: safeClone(result.settings || {}) });
      });
      return true;
    }

    if (msg.type === "save_settings") {
      api.storage.local.set({ settings: safeClone(msg.settings) }, () => {
        sendResponse({ ok: true });
      });
      return true;
    }
  });
})();
