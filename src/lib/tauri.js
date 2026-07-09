// Thin wrapper around Tauri APIs. Everything degrades gracefully when running
// in a plain browser (e.g. `vite dev` preview) so the UI is still explorable.

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let _dialog, _store, _event, _core, _win, _updater, _process;

async function dialog() {
  return (_dialog ??= await import("@tauri-apps/plugin-dialog"));
}
async function event() {
  return (_event ??= await import("@tauri-apps/api/event"));
}
async function core() {
  return (_core ??= await import("@tauri-apps/api/core"));
}
async function win() {
  return (_win ??= await import("@tauri-apps/api/window"));
}
async function store() {
  if (_store) return _store;
  const { Store } = await import("@tauri-apps/plugin-store");
  _store = await Store.load("recent.json");
  return _store;
}
async function updater() {
  return (_updater ??= await import("@tauri-apps/plugin-updater"));
}
async function process() {
  return (_process ??= await import("@tauri-apps/plugin-process"));
}

/** Show the native open dialog, return an absolute path or null. */
export async function pickOpenPath() {
  if (!isTauri) return null;
  const d = await dialog();
  const selected = await d.open({
    multiple: false,
    filters: [
      { name: "JSON", extensions: ["json", "jsonc", "json5", "geojson", "map", "webmanifest"] },
      { name: "JSON Lines", extensions: ["jsonl", "ndjson", "ldjson"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

/** Show the native save dialog, return an absolute path or null. */
export async function pickSavePath(defaultName = "untitled.json") {
  if (!isTauri) return null;
  const d = await dialog();
  const selected = await d.save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Read a UTF-8 text file at an absolute path (via a Rust command). */
export async function readTextFile(path) {
  if (!isTauri) throw new Error("File reads require the desktop app.");
  const c = await core();
  return await c.invoke("read_file", { path });
}

/** Write a UTF-8 text file at an absolute path (via a Rust command). */
export async function writeTextFile(path, contents) {
  if (!isTauri) throw new Error("File writes require the desktop app.");
  const c = await core();
  await c.invoke("write_file", { path, contents });
}

/** Copy text to the system clipboard. */
export async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard blocked; caller still shows the path */
  }
  return false;
}

/** Read text from the system clipboard (null if unavailable/blocked). */
export async function readClipboard() {
  try {
    if (navigator?.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    /* clipboard read not permitted */
  }
  return null;
}

// ---- Recent files (persisted via the store plugin) --------------------------

const RECENT_KEY = "recentFiles";
const RECENT_MAX = 12;

export async function getRecentFiles() {
  if (!isTauri) {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      return [];
    }
  }
  const s = await store();
  return (await s.get(RECENT_KEY)) || [];
}

export async function pushRecentFile(path) {
  if (!path) return [];
  let list = await getRecentFiles();
  list = [path, ...list.filter((p) => p !== path)].slice(0, RECENT_MAX);
  if (!isTauri) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    return list;
  }
  const s = await store();
  await s.set(RECENT_KEY, list);
  await s.save();
  return list;
}

export async function clearRecentFiles() {
  if (!isTauri) {
    localStorage.removeItem(RECENT_KEY);
    return;
  }
  const s = await store();
  await s.set(RECENT_KEY, []);
  await s.save();
}

// ---- OS integration: drag-drop + file opened from CLI/association ------------

/**
 * Subscribe to files dropped onto the window. Returns an unlisten fn.
 * @param {(path: string) => void} onFile
 */
export async function onFileDrop(onFile) {
  if (!isTauri) return () => {};
  const w = await win();
  const current = w.getCurrentWindow();
  const unlisten = await current.onDragDropEvent((e) => {
    if (e.payload.type === "drop" && e.payload.paths?.length) {
      onFile(e.payload.paths[0]);
    }
  });
  return unlisten;
}

/**
 * Ask the backend for a file path passed on the command line (double-click /
 * "Open with"). Also listens for subsequent open events from a second launch.
 * @param {(path: string) => void} onFile
 */
export async function onOpenWithFile(onFile) {
  if (!isTauri) return () => {};
  const c = await core();
  // Initial argument captured by the Rust side at startup.
  try {
    const initial = await c.invoke("initial_file");
    if (initial) onFile(initial);
  } catch {
    /* command may be unavailable; ignore */
  }
  const ev = await event();
  const unlisten = await ev.listen("open-file", (e) => {
    if (typeof e.payload === "string" && e.payload) onFile(e.payload);
  });
  return unlisten;
}

// ---- Auto-update: check GitHub, download in background, install on exit ------

/**
 * Ask the update endpoint (latest GitHub release) whether a newer version
 * exists and, if so, start downloading it in the background immediately.
 *
 * Resolves to `null` when there's no update, we're not in the desktop app, or
 * anything goes wrong (offline, missing manifest) — callers can ignore those.
 * On success, resolves to a handle:
 *   { version, currentVersion, notes, whenReady(), isReady(), install() }
 *
 * @param {(fraction: number) => void} [onProgress] download progress, 0..1
 */
export async function checkForUpdate(onProgress) {
  if (!isTauri) return null;
  let update;
  try {
    const u = await updater();
    update = await u.check();
  } catch {
    return null; // offline, no manifest, signature mismatch, etc.
  }
  if (!update) return null;

  let ready = false;
  let total = 0;
  let received = 0;
  // Kick the download off now; the returned promise settles when bytes are in.
  const downloadPromise = update
    .download((event) => {
      if (event.event === "Started") total = event.data.contentLength || 0;
      else if (event.event === "Progress") {
        received += event.data.chunkLength || 0;
        if (total) onProgress?.(Math.min(1, received / total));
      } else if (event.event === "Finished") onProgress?.(1);
    })
    .then(() => {
      ready = true;
    })
    .catch(() => {
      ready = false;
    });

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body || "",
    /** Await the background download; true once the bytes are ready to install. */
    whenReady: () => downloadPromise.then(() => ready),
    isReady: () => ready,
    /**
     * Install the downloaded update. `relaunch: true` restarts into the new
     * version; otherwise the app exits (installer finishes in the background).
     * No-op returning false if the download hasn't finished.
     */
    async install({ relaunch = false } = {}) {
      await downloadPromise;
      if (!ready) return false;
      await update.install();
      try {
        const p = await process();
        if (relaunch) await p.relaunch();
        else await p.exit(0);
      } catch {
        /* installer/OS may already be handling the restart */
      }
      return true;
    },
  };
}

/**
 * Intercept window-close requests. `shouldClose()` returns true to allow the
 * close, or false to veto it (e.g. to show a save prompt first).
 * Returns an unlisten fn.
 */
export async function onCloseRequested(shouldClose) {
  if (!isTauri) return () => {};
  const w = await win();
  const unlisten = await w.getCurrentWindow().onCloseRequested((event) => {
    if (!shouldClose()) event.preventDefault();
  });
  return unlisten;
}

/** Force the window to close, bypassing the close-request handler. */
export async function closeWindow() {
  if (!isTauri) return;
  const w = await win();
  await w.getCurrentWindow().destroy();
}

/** Set the native window title (no-op in a plain browser). */
export async function setWindowTitle(title) {
  if (!isTauri) {
    if (typeof document !== "undefined") document.title = title;
    return;
  }
  try {
    const w = await win();
    await w.getCurrentWindow().setTitle(title);
  } catch {
    /* set-title not permitted or window unavailable; ignore */
  }
}

/** Base filename from an absolute path (handles both slash styles). */
export function baseName(path) {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
