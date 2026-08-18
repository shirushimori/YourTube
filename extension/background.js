(() => {
  const HOST = "com.yourtube.client";
  const api = typeof browser !== "undefined" ? browser : chrome;
  let nativePort = null;
  let pendingMetaResolve = null;
  let pendingListResolve = null;
  let pendingServeResolve = null;
  let activeTabId = null;

  function getNativePort() {
    if (nativePort) return nativePort;
    nativePort = api.runtime.connectNative(HOST);
    nativePort.onMessage.addListener((msg) => {
      if (msg.type === "metadata" && pendingMetaResolve) {
        pendingMetaResolve(msg);
        pendingMetaResolve = null;
      } else if (msg.type === "downloads_list" && pendingListResolve) {
        pendingListResolve(msg);
        pendingListResolve = null;
      } else if (msg.type === "file_served" && pendingServeResolve) {
        pendingServeResolve(msg);
        pendingServeResolve = null;
      } else if (activeTabId) {
        api.tabs.sendMessage(activeTabId, msg).catch(() => {});
      }
    });
    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      nativePort = null;
      if (pendingMetaResolve) {
        pendingMetaResolve({ type: "error", message: err ? err.message : "Disconnected" });
        pendingMetaResolve = null;
      }
      if (pendingListResolve) {
        pendingListResolve({ type: "error", message: err ? err.message : "Disconnected" });
        pendingListResolve = null;
      }
      if (pendingServeResolve) {
        pendingServeResolve({ type: "error", message: err ? err.message : "Disconnected" });
        pendingServeResolve = null;
      }
      if (activeTabId) {
        api.tabs.sendMessage(activeTabId, { type: "error", message: err ? err.message : "Disconnected" }).catch(() => {});
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

  async function updateDownload(id, updates) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          store.put({ ...req.result, ...updates });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "fetch_metadata") {
      pendingMetaResolve = null;
      const port = getNativePort();
      pendingMetaResolve = sendResponse;
      port.postMessage({ type: "fetch_metadata", url: msg.url });
      return true;
    }

    if (msg.type === "download_start") {
      activeTabId = sender.tab.id;
      const port = getNativePort();
      port.postMessage({
        type: "download",
        url: msg.url,
        download_type: msg.download_type,
        quality: msg.quality,
        output_dir: msg.output_dir,
        start_time: msg.start_time,
        end_time: msg.end_time,
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
        output_dir: msg.output_dir || "/home/mori/Videos",
        quality: msg.quality || "1080",
        download_type: msg.download_type || "video_audio",
        file_path: "",
        timestamp: Date.now(),
        status: "downloading",
      }).catch(() => {});

      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "list_downloads") {
      const port = getNativePort();
      const dir = msg.directory || "/home/mori/Videos";
      pendingListResolve = sendResponse;
      port.postMessage({ type: "list_downloads", directory: dir });
      return true;
    }

    if (msg.type === "serve_file") {
      const port = getNativePort();
      pendingServeResolve = sendResponse;
      port.postMessage({ type: "serve_file", path: msg.path });
      return true;
    }

    if (msg.type === "get_tracked_downloads") {
      getDownloads().then((downloads) => {
        sendResponse({ type: "tracked_downloads", downloads });
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
    }

    if (msg.type === "get_playlists") {
      getPlaylists().then((playlists) => {
        sendResponse({ type: "playlists_list", playlists });
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
        sendResponse({ settings: result.settings || {} });
      });
      return true;
    }

    if (msg.type === "save_settings") {
      api.storage.local.set({ settings: msg.settings }, () => {
        sendResponse({ ok: true });
      });
      return true;
    }
  });
})();
