<script>
  import { untrack } from "svelte";
  import Editor from "./lib/Editor.svelte";
  import Tree from "./lib/Tree.svelte";
  import MenuBar from "./lib/MenuBar.svelte";
  import SearchBar from "./lib/SearchBar.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import { formatBytes, searchJson, pathToString, pathToBracket } from "./lib/json.js";
  import {
    isTauri,
    pickOpenPath,
    pickSavePath,
    readTextFile,
    writeTextFile,
    copyToClipboard,
    getRecentFiles,
    pushRecentFile,
    clearRecentFiles,
    onFileDrop,
    onOpenWithFile,
    onCloseRequested,
    closeWindow,
    setWindowTitle,
    baseName,
  } from "./lib/tauri.js";

  const SAMPLE = JSON.stringify(
    {
      name: "json-cove",
      version: "0.1.0",
      description: "A tiny, fast desktop JSON viewer and editor.",
      features: ["dual view", "tree navigation", "format / minify", "dark mode", "jsonl"],
      window: { width: 1000, height: 680, remember: true },
      limits: { maxSizeKB: 500, streaming: false },
      author: null,
    },
    null,
    2
  );

  // ---- Core document state --------------------------------------------------
  let text = $state("");
  let lastSaved = $state("");
  let filePath = $state(null);
  let editorApi = $state(null);
  let docMode = $state("json"); // "json" | "jsonl"

  // ---- Parse / status state -------------------------------------------------
  let status = $state({
    valid: true,
    errorCount: 0,
    firstError: null,
    cursorLine: 1,
    cursorCol: 1,
    lines: 1,
    mode: "json",
  });
  let parsed = $state(undefined); // last successfully parsed value
  let parsedValid = $state(true); // is `parsed` derived from the CURRENT text?
  let selectedPath = $state("");
  let selectedValue = $state(undefined); // value at selectedPath (for node stats)
  let caretPath = $state(""); // path of the value under the editor cursor (sync)

  // ---- UI state -------------------------------------------------------------
  let recent = $state([]);
  let toast = $state(null);
  let toastTimer;
  let dragOver = $state(false);
  let splitRatio = $state(loadRatio());
  let dragging = $state(false);
  let busy = $state(false);
  let treeNonce = $state(0); // bump to remount the tree (reset expand state)
  let treeExpandDepth = $state(2); // depth auto-expanded on (re)mount
  let showShortcuts = $state(false);
  let closePrompt = $state(false); // unsaved-changes confirmation on close
  let invalidSavePrompt = $state(null); // { errors, resolve } when saving broken JSON
  let gotoPrompt = $state(false); // Go-to-line dialog
  let gotoValue = $state("");
  let reloadPrompt = $state(false); // file-changed-on-disk prompt

  // ---- Search state ---------------------------------------------------------
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let searchOpts = $state({ key: true, value: true, caseSensitive: false, filter: true });
  let searchResult = $state({ matches: [], matchPaths: new Set(), ancestorPaths: new Set() });
  let searchIndex = $state(-1); // 0-based current match
  let searchFocusNonce = $state(0);
  let replaceOpen = $state(false); // replace row visible (Ctrl+R)
  let replaceQuery = $state("");
  let replaceFocusNonce = $state(0);
  let textCount = $state(0); // literal-match count (replace mode)
  let textIndex = $state(-1); // current literal match (replace mode)

  // ---- Context menu + subtree commands --------------------------------------
  let ctxMenu = $state(null); // { x, y, path, segments, value, keyLabel }
  let subtreeCmd = $state(null); // { path, open, n } broadcast to the tree

  // ---- View preferences (persisted) -----------------------------------------
  let wrap = $state(loadBool("wrap", true));
  let fontSize = $state(loadNum("fontSize", 13, 9, 24));

  // On-disk snapshot of the current file, to detect external changes.
  let diskSnapshot = null;

  const dirty = $derived(text !== lastSaved);
  const title = $derived(filePath ? baseName(filePath) : "untitled.json");
  const byteSize = $derived(new TextEncoder().encode(text).length);

  // Replace mode drives the editor with a literal-text search instead of the
  // structural tree search, so hits map 1:1 to replaceable text.
  const replaceMode = $derived(searchOpen && replaceOpen);

  // Search object handed to the tree (matches + reveal/filter info). The tree
  // stays passive in replace mode — replace is an editor-text operation.
  const searchActive = $derived(searchOpen && !replaceMode && searchQuery.trim() !== "");
  const treeSearch = $derived({
    active: searchActive,
    filter: searchOpts.filter,
    query: searchQuery,
    opts: searchOpts,
    matchPaths: searchResult.matchPaths,
    ancestorPaths: searchResult.ancestorPaths,
    currentPath: searchResult.matches[searchIndex]?.path ?? "",
  });

  // Stats for the selected container node (shown in the status bar).
  const nodeStats = $derived.by(() => {
    const v = selectedValue;
    if (v === null || typeof v !== "object") return null;
    const n = Array.isArray(v) ? v.length : Object.keys(v).length;
    return { array: Array.isArray(v), n, depth: valueDepth(v) };
  });

  // JSONL record count (non-empty lines).
  const recordCount = $derived.by(() => {
    if (docMode !== "jsonl") return null;
    let n = 0;
    for (const l of text.split(/\r?\n/)) if (l.trim() !== "") n++;
    return n;
  });

  // Right-click menu items, built from the node the menu was opened on.
  const ctxItems = $derived.by(() => (ctxMenu ? buildCtxItems(ctxMenu) : []));

  // Reflect the document + dirty state in the native window title.
  $effect(() => {
    setWindowTitle(`${dirty ? "● " : ""}${title} — JSON Cove`);
  });

  // Menu-bar definition. Derived so recent files / disabled states stay live.
  const menus = $derived([
    {
      label: "File",
      items: [
        { label: "New", shortcut: "Ctrl+N", action: newDoc },
        { label: "Open…", shortcut: "Ctrl+O", action: openDialog },
        {
          label: "Open Recent",
          emptyLabel: "No recent files",
          submenu:
            recent.length === 0
              ? []
              : [
                  ...recent.map((p) => ({
                    label: baseName(p),
                    title: p,
                    action: () => openRecent(p),
                  })),
                  { sep: true },
                  { label: "Clear Recent", action: clearRecent },
                ],
        },
        { sep: true },
        { label: "Save", shortcut: "Ctrl+S", action: save, disabled: !dirty && !!filePath },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", action: saveAs },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => editorApi?.undo() },
        { label: "Redo", shortcut: "Ctrl+Y", action: () => editorApi?.redo() },
        { sep: true },
        { label: "Find…", shortcut: "Ctrl+F", action: openSearch },
        { label: "Replace…", shortcut: "Ctrl+R", action: openReplace },
        { label: "Go to Line…", shortcut: "Ctrl+G", action: openGoto },
        { label: "Copy Selected Path", action: copySelectedPath, disabled: !selectedPath },
      ],
    },
    {
      label: "Format",
      items: [
        { label: "Format / Prettify", shortcut: "Ctrl+Shift+F", action: format },
        { label: "Minify", shortcut: "Ctrl+Shift+M", action: minify },
        { label: "Sort Keys (A→Z)", action: sortKeys },
        { sep: true },
        { label: "Copy as Minified", action: copyAsMinified },
        { label: "Copy as Formatted", action: copyAsFormatted },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Expand All", action: expandAll },
        { label: "Collapse All", action: collapseAll },
        { sep: true },
        { label: `Word Wrap${wrap ? "  ✓" : ""}`, action: toggleWrap },
        { sep: true },
        { label: "Zoom In", shortcut: "Ctrl++", action: () => zoom(1) },
        { label: "Zoom Out", shortcut: "Ctrl+-", action: () => zoom(-1) },
        { label: "Reset Zoom", shortcut: "Ctrl+0", action: () => zoom(0) },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard Shortcuts…", action: () => (showShortcuts = true) },
        { label: "About JSON Cove", action: showAbout },
      ],
    },
  ]);

  const SHORTCUTS = [
    ["New", "Ctrl+N"],
    ["Open", "Ctrl+O"],
    ["Save", "Ctrl+S"],
    ["Save As", "Ctrl+Shift+S"],
    ["Format", "Ctrl+Shift+F"],
    ["Minify", "Ctrl+Shift+M"],
    ["Search (tree + editor)", "Ctrl+F"],
    ["Next / previous match", "Enter / Shift+Enter"],
    ["Go to line", "Ctrl+G"],
    ["Zoom in / out / reset", "Ctrl+ +  /  -  /  0"],
    ["Undo / Redo", "Ctrl+Z / Ctrl+Y"],
    ["Copy node path", "Click a tree node"],
    ["Jump to value", "Double-click / Ctrl-click node"],
    ["More node actions", "Right-click a tree node"],
  ];

  // ---- Debounced parse of the current text ---------------------------------
  let parseTimer;
  $effect(() => {
    const current = text;
    const m = docMode;
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      if (current.trim() === "") {
        parsed = undefined;
        parsedValid = true;
        return;
      }
      if (m === "jsonl") {
        // Build an array from the parseable records; flag if any line is bad.
        const arr = [];
        let ok = true;
        for (const raw of current.split(/\r?\n/)) {
          if (raw.trim() === "") continue;
          try {
            arr.push(JSON.parse(raw));
          } catch {
            ok = false;
          }
        }
        parsed = arr;
        parsedValid = ok;
      } else {
        try {
          parsed = JSON.parse(current);
          parsedValid = true;
        } catch {
          parsedValid = false; // keep last good `parsed`, mark tree as stale
        }
      }
    }, 140);
    return () => clearTimeout(parseTimer);
  });

  // ---- Recompute search matches when query / options / document change ------
  $effect(() => {
    const q = searchQuery;
    const key = searchOpts.key;
    const val = searchOpts.value;
    const cs = searchOpts.caseSensitive;
    const rmode = replaceMode;
    const data = parsed;
    const doc = text; // literal search re-runs when the document changes (e.g. after a replace)
    const active = searchOpen && q.trim() !== "";

    if (!active) {
      searchResult = { matches: [], matchPaths: new Set(), ancestorPaths: new Set() };
      searchIndex = -1;
      textCount = 0;
      textIndex = -1;
      editorApi?.clearSearch?.();
      editorApi?.clearTextSearch?.();
      return;
    }

    if (rmode) {
      // Replace mode: literal editor-text search.
      editorApi?.clearSearch?.();
      searchResult = { matches: [], matchPaths: new Set(), ancestorPaths: new Set() };
      searchIndex = -1;
      const r = editorApi?.findText?.(q, { caseSensitive: cs }) ?? { count: 0, index: -1 };
      textCount = r.count;
      textIndex = r.index;
      return;
    }

    // Find mode: structural key/value search over the parsed tree.
    editorApi?.clearTextSearch?.();
    textCount = 0;
    textIndex = -1;
    if (data === undefined) {
      searchResult = { matches: [], matchPaths: new Set(), ancestorPaths: new Set() };
      searchIndex = -1;
      editorApi?.clearSearch?.();
      return;
    }
    const res = searchJson(data, q, { key, value: val, caseSensitive: cs });
    searchResult = res;
    const prev = untrack(() => searchIndex);
    const idx = res.matches.length ? Math.min(Math.max(prev, 0), res.matches.length - 1) : -1;
    searchIndex = idx;
    editorApi?.setSearchMatches?.(res.matches, idx);
  });

  // ---- Startup: OS integration + recent files ------------------------------
  $effect(() => {
    let unlistenDrop = () => {};
    let unlistenOpen = () => {};
    let unlistenClose = () => {};
    (async () => {
      recent = await getRecentFiles();
      unlistenDrop = await onFileDrop((p) => openPath(p));
      unlistenOpen = await onOpenWithFile((p) => openPath(p));
      // Veto the window close when there are unsaved edits; prompt instead.
      unlistenClose = await onCloseRequested(() => {
        if (dirty && !closePrompt) {
          closePrompt = true;
          return false;
        }
        return !dirty;
      });
      if (!isTauri && text === "") {
        // Browser preview: show sample content so the UI is explorable.
        setText(SAMPLE, { markSaved: true, resetHistory: true });
      }
    })();
    return () => {
      unlistenDrop();
      unlistenOpen();
      unlistenClose();
    };
  });

  // Capture-phase hotkeys the webview would otherwise swallow (find, zoom).
  $effect(() => {
    const onCapture = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
      } else if (k === "r" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        openReplace();
      } else if (k === "g" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        openGoto();
      } else if (k === "=" || k === "+") {
        e.preventDefault();
        e.stopPropagation();
        zoom(1);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        e.stopPropagation();
        zoom(-1);
      } else if (k === "0") {
        e.preventDefault();
        e.stopPropagation();
        zoom(0);
      }
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  });

  // Detect edits made to the open file by another program; offer a reload.
  $effect(() => {
    if (!isTauri) return;
    const onFocus = () => checkExternalChange();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  async function checkExternalChange() {
    if (!filePath || diskSnapshot === null || reloadPrompt) return;
    try {
      const onDisk = await readTextFile(filePath);
      if (onDisk !== diskSnapshot) reloadPrompt = true;
    } catch {
      /* file may be gone/locked; ignore */
    }
  }
  async function reloadFromDisk() {
    reloadPrompt = false;
    if (filePath) await openPath(filePath);
  }
  function keepMine() {
    reloadPrompt = false;
    // Adopt the on-disk content as the new baseline so we stop nagging.
    if (filePath) readTextFile(filePath).then((d) => (diskSnapshot = d)).catch(() => {});
  }

  // ---- Unsaved-changes close prompt ----------------------------------------
  async function closeSave() {
    closePrompt = false;
    await save();
    if (!dirty) await closeWindow();
  }
  async function closeDiscard() {
    closePrompt = false;
    lastSaved = text; // mark clean so the veto lets us through
    await closeWindow();
  }
  function closeCancel() {
    closePrompt = false;
  }

  // ---- Helpers --------------------------------------------------------------
  // `resetHistory` loads the text as a fresh document so Ctrl+Z can't undo past
  // it (used for open / new); otherwise the change is a normal undoable edit.
  function setText(next, { markSaved = false, resetHistory = false } = {}) {
    text = next;
    if (markSaved) lastSaved = next;
    if (resetHistory) editorApi?.setDocument(next, docMode);
    else editorApi?.setValue(next);
  }

  // Detect JSON vs JSONL from the extension, falling back to content sniffing.
  function detectMode(path, content) {
    const p = (path || "").toLowerCase();
    if (p.endsWith(".jsonl") || p.endsWith(".ndjson")) return "jsonl";
    if (p.endsWith(".json")) return "json";
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      try {
        JSON.parse(content);
        return "json";
      } catch {
        const everyLineOk = lines.every((l) => {
          try {
            JSON.parse(l);
            return true;
          } catch {
            return false;
          }
        });
        if (everyLineOk) return "jsonl";
      }
    }
    return "json";
  }

  // Normalize JSONL: one compact record per line; unparseable lines kept as-is.
  function normalizeJsonl(content) {
    return content
      .split(/\r?\n/)
      .map((l) => {
        if (l.trim() === "") return null;
        try {
          return JSON.stringify(JSON.parse(l));
        } catch {
          return l;
        }
      })
      .filter((l) => l !== null)
      .join("\n");
  }

  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 1800);
  }

  function onEditorChange(next) {
    text = next;
  }

  function onEditorStatus(s) {
    status = s;
  }

  function prettyOf(str) {
    return JSON.stringify(JSON.parse(str), null, 2);
  }

  // ---- File actions ---------------------------------------------------------
  async function openPath(path) {
    if (!path) return;
    busy = true;
    try {
      const raw = await readTextFile(path);
      const m = detectMode(path, raw);
      let content = raw;
      try {
        // Auto-format on load: pretty-print JSON, normalize JSONL records.
        content = m === "jsonl" ? normalizeJsonl(raw) : prettyOf(raw);
      } catch {
        /* invalid: load as-is so the error is visible */
      }
      filePath = path;
      docMode = m;
      diskSnapshot = raw;
      setText(content, { markSaved: true, resetHistory: true });
      selectedPath = "";
      selectedValue = undefined;
      resetTree(2);
      recent = await pushRecentFile(path);
      flash(`Opened ${baseName(path)}${m === "jsonl" ? " (JSONL)" : ""}`);
    } catch (e) {
      flash(`Could not open: ${e.message || e}`);
    } finally {
      busy = false;
    }
  }

  async function openDialog() {
    if (!isTauri) {
      flash("Open works in the desktop app. Drag a file in, or paste JSON here.");
      return;
    }
    const path = await pickOpenPath();
    if (path) await openPath(path);
  }

  // Synchronous, accurate validity check (the status flag is debounced).
  function currentErrorCount() {
    if (text.trim() === "") return 0;
    if (docMode === "jsonl") {
      let n = 0;
      for (const l of text.split(/\r?\n/)) {
        if (l.trim() === "") continue;
        try {
          JSON.parse(l);
        } catch {
          n++;
        }
      }
      return n;
    }
    try {
      JSON.parse(text);
      return 0;
    } catch {
      return 1;
    }
  }

  // Resolve true to proceed with the write, false to abort. When the document
  // has errors, ask first (a soft warning — never a hard block).
  function confirmSaveIfInvalid() {
    const errors = currentErrorCount();
    if (errors === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      invalidSavePrompt = { errors, resolve };
    });
  }
  function invalidSaveProceed() {
    const r = invalidSavePrompt?.resolve;
    invalidSavePrompt = null;
    r?.(true);
  }
  function invalidSaveCancel() {
    const r = invalidSavePrompt?.resolve;
    invalidSavePrompt = null;
    r?.(false);
  }

  async function save() {
    if (!isTauri) {
      flash("Saving works in the desktop app.");
      return;
    }
    if (!filePath) return saveAs();
    if (!(await confirmSaveIfInvalid())) return;
    try {
      await writeTextFile(filePath, text);
      lastSaved = text;
      diskSnapshot = text;
      recent = await pushRecentFile(filePath);
      flash(`Saved ${baseName(filePath)}`);
    } catch (e) {
      flash(`Save failed: ${e.message || e}`);
    }
  }

  async function saveAs() {
    if (!isTauri) {
      flash("Saving works in the desktop app.");
      return;
    }
    if (!(await confirmSaveIfInvalid())) return;
    const path = await pickSavePath(title);
    if (!path) return;
    try {
      await writeTextFile(path, text);
      filePath = path;
      lastSaved = text;
      diskSnapshot = text;
      recent = await pushRecentFile(path);
      flash(`Saved ${baseName(path)}`);
    } catch (e) {
      flash(`Save failed: ${e.message || e}`);
    }
  }

  function newDoc() {
    filePath = null;
    docMode = "json";
    diskSnapshot = null;
    setText("", { markSaved: true, resetHistory: true });
    selectedPath = "";
    selectedValue = undefined;
    resetTree(2);
    editorApi?.focus();
  }

  // ---- Tree expand/collapse (remount with a chosen auto-expand depth) -------
  function resetTree(depth) {
    treeExpandDepth = depth;
    treeNonce++;
  }
  function expandAll() {
    resetTree(99);
    flash("Expanded all");
  }
  function collapseAll() {
    resetTree(1);
    flash("Collapsed all");
  }

  // ---- Seek: jump the editor cursor to a tree node's value -----------------
  function onSeekNode(path, segments, value) {
    selectedPath = path;
    if (value !== undefined) selectedValue = value;
    if (!editorApi?.goToPath) return;
    const ok = editorApi.goToPath(segments);
    flash(ok ? `Jumped to  ${path}` : `Not found in current text: ${path}`);
  }

  // ---- Editor → tree sync: highlight the node under the cursor -------------
  function onCaret(segments) {
    caretPath = pathToString(segments);
  }

  function copySelectedPath() {
    if (selectedPath) onSelectNode(selectedPath);
  }
  function showAbout() {
    flash("JSON Cove 0.1.0 — a tiny, fast JSON editor");
  }

  // ---- Unified search -------------------------------------------------------
  function openSearch() {
    searchOpen = true;
    replaceOpen = false; // Ctrl+F collapses to the single find row
    searchFocusNonce++; // (re)focus + select the input
  }
  function openReplace() {
    if (searchOpen && replaceOpen) {
      replaceFocusNonce++; // already showing replace — just focus it
      return;
    }
    searchOpen = true;
    replaceOpen = true;
    // Focus the find field first if we still need a query, else the replace field.
    if (searchQuery.trim() === "") searchFocusNonce++;
    else replaceFocusNonce++;
  }
  function toggleReplace() {
    replaceOpen = !replaceOpen;
    if (replaceOpen) replaceFocusNonce++;
    else searchFocusNonce++;
  }
  function closeSearch() {
    searchOpen = false;
    replaceOpen = false;
    editorApi?.clearSearch?.();
    editorApi?.clearTextSearch?.();
  }
  function searchStep(delta) {
    if (replaceMode) {
      const r = editorApi?.stepText?.(delta);
      if (r) {
        textCount = r.count;
        textIndex = r.index;
      }
      return;
    }
    const n = searchResult.matches.length;
    if (!n) return;
    const idx = searchIndex < 0 ? 0 : (searchIndex + delta + n) % n;
    searchIndex = idx;
    editorApi?.setSearchCurrent?.(idx);
  }
  function searchNext() {
    searchStep(1);
  }
  function searchPrev() {
    searchStep(-1);
  }
  function toggleSearchOpt(name) {
    searchOpts = { ...searchOpts, [name]: !searchOpts[name] };
    if (replaceMode) replaceFocusNonce++;
    else searchFocusNonce++; // keep focus in the field after clicking a toggle
  }
  function replaceOne() {
    if (!replaceMode) return;
    // The document change re-runs the search effect, refreshing count + current.
    editorApi?.replaceCurrent?.(searchQuery, replaceQuery, { caseSensitive: searchOpts.caseSensitive });
  }
  function replaceAllNow() {
    if (!replaceMode) return;
    const n = editorApi?.replaceAllText?.(searchQuery, replaceQuery, { caseSensitive: searchOpts.caseSensitive }) ?? 0;
    flash(n ? `Replaced ${n} occurrence${n === 1 ? "" : "s"}` : "Nothing to replace");
  }

  // ---- Go to line -----------------------------------------------------------
  function openGoto() {
    gotoValue = String(status.cursorLine || 1);
    gotoPrompt = true;
  }
  function submitGoto() {
    const n = parseInt(gotoValue, 10);
    gotoPrompt = false;
    if (!Number.isNaN(n)) editorApi?.goToLine(n);
  }

  // ---- View: zoom + word wrap ----------------------------------------------
  function zoom(dir) {
    const next = dir === 0 ? 13 : Math.min(24, Math.max(9, fontSize + dir));
    fontSize = next;
    localStorage.setItem("fontSize", String(next));
  }
  function toggleWrap() {
    wrap = !wrap;
    localStorage.setItem("wrap", wrap ? "1" : "0");
  }

  // ---- Format: sort keys + copy-as helpers ----------------------------------
  function sortDeep(v) {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
      return out;
    }
    return v;
  }
  function sortKeys() {
    try {
      if (docMode === "jsonl") {
        const sorted = text
          .split(/\r?\n/)
          .map((l) => (l.trim() === "" ? null : JSON.stringify(sortDeep(JSON.parse(l)))))
          .filter((l) => l !== null)
          .join("\n");
        setText(sorted);
      } else {
        setText(JSON.stringify(sortDeep(JSON.parse(text)), null, 2));
      }
      flash("Sorted keys A→Z");
    } catch {
      flash("Can't sort — fix the error first");
      if (status.firstError?.line) editorApi?.goToLine(status.firstError.line);
    }
  }
  async function copyAsMinified() {
    try {
      const out = docMode === "jsonl" ? normalizeJsonl(text) : JSON.stringify(JSON.parse(text));
      flash((await copyToClipboard(out)) ? "Copied minified" : "Copy failed");
    } catch {
      flash("Can't copy — fix the error first");
    }
  }
  async function copyAsFormatted() {
    try {
      const out = docMode === "jsonl" ? normalizeJsonl(text) : prettyOf(text);
      flash((await copyToClipboard(out)) ? "Copied formatted" : "Copy failed");
    } catch {
      flash("Can't copy — fix the error first");
    }
  }

  // ---- Tree right-click context menu ----------------------------------------
  function onTreeContext(info) {
    // Clamp roughly; ContextMenu fine-tunes once it knows its size.
    ctxMenu = info;
  }
  function closeCtx() {
    ctxMenu = null;
  }
  function rawValueString(v) {
    if (typeof v === "string") return v;
    if (v === null) return "null";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  }
  async function copyText(t, label) {
    const ok = await copyToClipboard(t);
    flash(ok ? label : "Copy failed");
  }
  function buildCtxItems(info) {
    const { value, keyLabel, segments, path } = info;
    const container = value !== null && typeof value === "object";
    const hasKey = keyLabel !== null && keyLabel !== undefined;
    return [
      { label: "Copy value", action: () => copyText(rawValueString(value), "Copied value") },
      { label: "Copy value as JSON", action: () => copyText(JSON.stringify(value, null, 2), "Copied JSON") },
      { label: "Copy key", disabled: !hasKey, action: () => copyText(String(keyLabel), "Copied key") },
      {
        label: 'Copy "key": value',
        disabled: !hasKey,
        action: () => copyText(`${JSON.stringify(String(keyLabel))}: ${JSON.stringify(value)}`, "Copied entry"),
      },
      { sep: true },
      { label: "Copy path", action: () => copyText(path, "Copied path") },
      { label: "Copy path (brackets)", action: () => copyText(pathToBracket(segments), "Copied path") },
      { sep: true },
      { label: "Jump to value", action: () => onSeekNode(path, segments, value) },
      ...(container
        ? [
            { sep: true },
            { label: "Expand subtree", action: () => (subtreeCmd = { path, open: true, n: (subtreeCmd?.n || 0) + 1 }) },
            { label: "Collapse subtree", action: () => (subtreeCmd = { path, open: false, n: (subtreeCmd?.n || 0) + 1 }) },
          ]
        : []),
    ];
  }

  // ---- Transform actions ----------------------------------------------------
  function format() {
    try {
      setText(docMode === "jsonl" ? normalizeJsonl(text) : prettyOf(text));
      flash(docMode === "jsonl" ? "Normalized" : "Formatted");
    } catch {
      flash("Can't format — fix the error first");
      if (status.firstError?.line) editorApi?.goToLine(status.firstError.line);
    }
  }

  function minify() {
    try {
      setText(docMode === "jsonl" ? normalizeJsonl(text) : JSON.stringify(JSON.parse(text)));
      flash("Minified");
    } catch {
      flash("Can't minify — fix the error first");
      if (status.firstError?.line) editorApi?.goToLine(status.firstError.line);
    }
  }

  async function onSelectNode(path, segments, value) {
    selectedPath = path;
    if (value !== undefined) selectedValue = value;
    const ok = await copyToClipboard(path);
    flash(ok ? `Copied  ${path}` : path);
  }

  async function openRecent(path) {
    await openPath(path);
  }

  async function clearRecent() {
    await clearRecentFiles();
    recent = [];
  }

  function jumpToError() {
    if (status.firstError?.line) editorApi?.goToLine(status.firstError.line);
  }

  // ---- Small helpers --------------------------------------------------------
  function valueDepth(v) {
    if (v === null || typeof v !== "object") return 0;
    let d = 0;
    for (const k in v) d = Math.max(d, valueDepth(v[k]));
    return d + 1;
  }
  function loadBool(key, dflt) {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === "1";
  }
  function loadNum(key, dflt, lo, hi) {
    const v = Number(localStorage.getItem(key));
    return v >= lo && v <= hi ? v : dflt;
  }

  // ---- Split divider --------------------------------------------------------
  function loadRatio() {
    const v = Number(localStorage.getItem("splitRatio"));
    return v >= 0.2 && v <= 0.8 ? v : 0.52;
  }
  function startDrag(e) {
    dragging = true;
    e.preventDefault();
    const move = (ev) => {
      const host = document.querySelector(".split");
      if (!host) return;
      const r = host.getBoundingClientRect();
      let ratio = (ev.clientX - r.left) / r.width;
      ratio = Math.min(0.8, Math.max(0.2, ratio));
      splitRatio = ratio;
    };
    const up = () => {
      dragging = false;
      localStorage.setItem("splitRatio", String(splitRatio));
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  function onDividerKey(e) {
    let next = splitRatio;
    if (e.key === "ArrowLeft") next -= 0.02;
    else if (e.key === "ArrowRight") next += 0.02;
    else return;
    e.preventDefault();
    splitRatio = Math.min(0.8, Math.max(0.2, next));
    localStorage.setItem("splitRatio", String(splitRatio));
  }

  // ---- Keyboard shortcuts ---------------------------------------------------
  function onKeydown(e) {
    if (e.key === "Escape") {
      if (ctxMenu) {
        closeCtx();
        return;
      }
      if (showShortcuts) {
        showShortcuts = false;
        return;
      }
      if (invalidSavePrompt) {
        invalidSaveCancel();
        return;
      }
      if (gotoPrompt) {
        gotoPrompt = false;
        return;
      }
      if (closePrompt) {
        closePrompt = false;
        return;
      }
      if (searchOpen) {
        closeSearch();
        return;
      }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "o") {
      e.preventDefault();
      openDialog();
    } else if (k === "s") {
      e.preventDefault();
      e.shiftKey ? saveAs() : save();
    } else if (k === "n") {
      e.preventDefault();
      newDoc();
    } else if (e.shiftKey && k === "f") {
      e.preventDefault();
      format();
    } else if (e.shiftKey && k === "m") {
      e.preventDefault();
      minify();
    }
  }

  // Fallback drag/drop for browser preview (Tauri handles it natively).
  function onDrop(e) {
    dragOver = false;
    if (isTauri) return; // native handler covers the app
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      filePath = file.name;
      let content = String(reader.result);
      const m = detectMode(file.name, content);
      docMode = m;
      try {
        content = m === "jsonl" ? normalizeJsonl(content) : prettyOf(content);
      } catch {}
      setText(content, { markSaved: true, resetHistory: true });
      resetTree(2);
    };
    reader.readAsText(file);
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="app">
  <!-- Menu bar -->
  <header class="topbar">
    <MenuBar {menus} />
    <span class="doc-indicator" title={filePath || title}>
      {title}{#if dirty}<span class="dot" title="Unsaved changes"> ●</span>{/if}
    </span>
  </header>

  <!-- Main split -->
  <main
    class="split"
    class:dragover={dragOver}
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
    role="application"
  >
    <section class="pane editor-pane" style="flex-basis: {splitRatio * 100}%">
      <div class="pane-head">
        <span class="pane-label">Editor</span>
        <span class="pane-meta">{formatBytes(byteSize)}</span>
      </div>
      <div class="pane-body">
        <Editor
          value={text}
          mode={docMode}
          baseline={lastSaved}
          {wrap}
          {fontSize}
          onchange={onEditorChange}
          onstatus={onEditorStatus}
          onready={(api) => (editorApi = api)}
          oncaret={onCaret}
        />
      </div>
    </section>

    <div
      class="divider"
      class:dragging
      role="slider"
      aria-label="Resize editor and tree panels"
      aria-orientation="vertical"
      aria-valuemin="20"
      aria-valuemax="80"
      aria-valuenow={Math.round(splitRatio * 100)}
      tabindex="0"
      onmousedown={startDrag}
      onkeydown={onDividerKey}
    ></div>

    <section class="pane tree-pane" style="flex-basis: {(1 - splitRatio) * 100}%">
      <div class="pane-head">
        <span class="pane-label">Tree</span>
        <span class="pane-meta">{selectedPath || "click: copy path · dbl/ctrl-click: jump"}</span>
      </div>
      <div class="pane-body">
        <Tree
          data={parsed}
          valid={parsedValid}
          stale={!parsedValid}
          {selectedPath}
          {caretPath}
          search={treeSearch}
          {subtreeCmd}
          onselect={onSelectNode}
          onseek={onSeekNode}
          oncontext={onTreeContext}
          autoExpandDepth={treeExpandDepth}
          nonce={treeNonce}
        />
      </div>
    </section>

    {#if searchOpen}
      <div class="search-overlay">
        <SearchBar
          query={searchQuery}
          count={replaceMode ? textCount : searchResult.matches.length}
          index={replaceMode ? textIndex : searchIndex}
          opts={searchOpts}
          focusSignal={searchFocusNonce}
          replace={replaceOpen}
          {replaceQuery}
          replaceFocusSignal={replaceFocusNonce}
          onquery={(v) => (searchQuery = v)}
          onnext={searchNext}
          onprev={searchPrev}
          ontoggle={toggleSearchOpt}
          onclose={closeSearch}
          ontogglereplace={toggleReplace}
          onreplacequery={(v) => (replaceQuery = v)}
          onreplaceone={replaceOne}
          onreplaceall={replaceAllNow}
        />
      </div>
    {/if}

    {#if dragOver}
      <div class="drop-hint"><div class="drop-inner">Drop a JSON file to open</div></div>
    {/if}
  </main>

  <!-- Status bar -->
  <footer class="statusbar">
    {#if status.valid}
      <span class="stat ok"><span class="pip ok"></span> Valid {docMode === "jsonl" ? "JSONL" : "JSON"}</span>
    {:else}
      <button class="stat err" onclick={jumpToError} title="Jump to first error">
        <span class="pip err"></span>
        {status.errorCount} error{status.errorCount === 1 ? "" : "s"}{status.firstError?.line ? ` · first on line ${status.firstError.line}` : ""}{status.firstError?.message ? ` · ${status.firstError.message}` : ""}
      </button>
    {/if}

    {#if status.warnCount}
      <button class="stat warn" onclick={() => status.firstWarning?.line && editorApi?.goToLine(status.firstWarning.line)} title="Jump to first warning">
        <span class="pip warn"></span>
        {status.warnCount} warning{status.warnCount === 1 ? "" : "s"}{status.firstWarning?.message ? ` · ${status.firstWarning.message}` : ""}
      </button>
    {/if}

    <span class="sep"></span>
    <span class="stat muted">Ln {status.cursorLine}, Col {status.cursorCol}</span>
    <span class="stat muted">{status.lines} lines</span>
    {#if recordCount !== null}
      <span class="stat muted">{recordCount} record{recordCount === 1 ? "" : "s"}</span>
    {/if}
    <span class="stat muted">{formatBytes(byteSize)}</span>
    <span class="stat muted badge">{docMode === "jsonl" ? "JSONL" : "JSON"}</span>

    <span class="spacer"></span>
    {#if nodeStats}
      <span class="stat muted" title="Selected node">
        {nodeStats.array ? `[${nodeStats.n} item${nodeStats.n === 1 ? "" : "s"}]` : `{${nodeStats.n} key${nodeStats.n === 1 ? "" : "s"}}`} · depth {nodeStats.depth}
      </span>
    {/if}
    {#if selectedPath}
      <button class="stat path" onclick={() => onSelectNode(selectedPath)} title="Copy path">
        {selectedPath}
      </button>
    {/if}
    <span class="stat muted mode">{isTauri ? "desktop" : "preview"}</span>
  </footer>

  {#if toast}
    <div class="toast">{toast}</div>
  {/if}

  {#if busy}
    <div class="busy"></div>
  {/if}

  {#if showShortcuts}
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="Keyboard shortcuts">
        <div class="dialog-head">
          <span>Keyboard shortcuts</span>
          <button class="x" onclick={() => (showShortcuts = false)} aria-label="Close">✕</button>
        </div>
        <div class="dialog-body">
          {#each SHORTCUTS as [name, keys]}
            <div class="sc-row">
              <span class="sc-name">{name}</span>
              <span class="sc-keys">{keys}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if closePrompt}
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="Unsaved changes">
        <div class="dialog-head">
          <span>Unsaved changes</span>
        </div>
        <div class="dialog-body">
          <p class="confirm-text">
            Save changes to <strong>{title}</strong> before closing?
          </p>
          <div class="confirm-actions">
            <button class="cbtn primary" onclick={closeSave}>Save</button>
            <button class="cbtn danger" onclick={closeDiscard}>Don't Save</button>
            <button class="cbtn" onclick={closeCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if invalidSavePrompt}
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="Invalid JSON">
        <div class="dialog-head">
          <span>Document has errors</span>
        </div>
        <div class="dialog-body">
          <p class="confirm-text">
            This {docMode === "jsonl" ? "JSONL" : "JSON"} has
            <strong>{invalidSavePrompt.errors} error{invalidSavePrompt.errors === 1 ? "" : "s"}</strong>
            and won't parse. Save it anyway?
          </p>
          <div class="confirm-actions">
            <button class="cbtn primary" onclick={invalidSaveProceed}>Save Anyway</button>
            <button class="cbtn" onclick={invalidSaveCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if gotoPrompt}
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="Go to line">
        <div class="dialog-head">
          <span>Go to line</span>
          <button class="x" onclick={() => (gotoPrompt = false)} aria-label="Close">✕</button>
        </div>
        <div class="dialog-body">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="goto-input"
            type="number"
            min="1"
            max={status.lines}
            autofocus
            bind:value={gotoValue}
            onkeydown={(e) => { if (e.key === "Enter") submitGoto(); }}
            aria-label="Line number"
          />
          <div class="confirm-actions">
            <button class="cbtn primary" onclick={submitGoto}>Go</button>
            <button class="cbtn" onclick={() => (gotoPrompt = false)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if reloadPrompt}
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="File changed on disk">
        <div class="dialog-head">
          <span>File changed on disk</span>
        </div>
        <div class="dialog-body">
          <p class="confirm-text">
            <strong>{title}</strong> was modified by another program.
            {#if dirty}Reloading will discard your unsaved changes.{/if}
          </p>
          <div class="confirm-actions">
            <button class="cbtn primary" onclick={reloadFromDisk}>Reload</button>
            <button class="cbtn" onclick={keepMine}>Keep Mine</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if ctxMenu}
    <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onclose={closeCtx} />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--bg);
  }

  /* Menu bar */
  .topbar {
    height: var(--toolbar-h);
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px;
    background: var(--menu-bar-bg);
    border-bottom: 1px solid var(--border);
  }
  .doc-indicator {
    margin-left: auto;
    padding-right: 6px;
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }
  .dot {
    color: var(--accent);
    font-size: 10px;
  }

  /* Shortcuts dialog */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    width: 380px;
    max-width: 90vw;
    background: var(--menu-bg);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    font-weight: 600;
    font-size: 13.5px;
    border-bottom: 1px solid var(--border);
  }
  .x {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .x:hover {
    background: var(--menu-hover);
    color: var(--text);
  }
  .dialog-body {
    padding: 8px 16px 14px;
  }
  .sc-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 0;
    font-size: 12.5px;
  }
  .sc-name {
    color: var(--text);
  }
  .sc-keys {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .confirm-text {
    margin: 4px 0 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text);
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .cbtn {
    height: 30px;
    padding: 0 14px;
    font-size: 12.5px;
    font-family: var(--font-ui);
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    cursor: pointer;
  }
  .cbtn:hover {
    background: var(--bg-elevated);
  }
  .cbtn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .cbtn.primary:hover {
    filter: brightness(1.08);
  }
  .cbtn.danger {
    color: var(--danger);
    border-color: var(--danger);
    background: transparent;
  }
  .cbtn.danger:hover {
    background: var(--danger-soft);
  }
  .badge {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 10px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 1px 5px;
  }

  /* Split */
  .split {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .editor-pane {
    border-right: none;
  }
  .pane-head {
    height: 26px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
  }
  .pane-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-faint);
    font-weight: 600;
  }
  .pane-meta {
    font-size: 11px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 70%;
  }
  .pane-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .divider {
    flex: none;
    width: 6px;
    cursor: col-resize;
    background: var(--border);
    position: relative;
  }
  .divider::after {
    content: "";
    position: absolute;
    inset: 0 2px;
    background: transparent;
  }
  .divider:hover,
  .divider.dragging {
    background: var(--accent);
  }

  .search-overlay {
    position: absolute;
    top: 8px;
    right: 14px;
    z-index: 40;
  }

  .goto-input {
    width: 100%;
    height: 32px;
    margin: 4px 0 14px;
    padding: 0 10px;
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    outline: none;
  }
  .goto-input:focus {
    border-color: var(--accent);
  }

  .drop-hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    z-index: 30;
    pointer-events: none;
  }
  .drop-inner {
    padding: 22px 34px;
    border: 2px dashed var(--accent);
    border-radius: 12px;
    color: var(--accent);
    font-size: 15px;
    font-weight: 600;
    background: var(--bg);
  }

  /* Status bar */
  .statusbar {
    height: var(--status-h);
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 10px;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    overflow: hidden;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    font-family: var(--font-mono);
    background: transparent;
    border: none;
    color: var(--text-muted);
    padding: 0;
  }
  .stat.muted {
    color: var(--text-faint);
  }
  .stat.ok {
    color: var(--ok);
  }
  .stat.err {
    color: var(--danger);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60%;
  }
  .stat.path {
    color: var(--accent);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 44%;
  }
  .stat.path:hover,
  .stat.err:hover {
    text-decoration: underline;
  }
  .pip {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
  }
  .pip.ok {
    background: var(--ok);
  }
  .pip.err {
    background: var(--danger);
  }
  .stat.warn {
    color: var(--number);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40%;
  }
  .stat.warn:hover {
    text-decoration: underline;
  }
  .pip.warn {
    background: var(--number);
  }
  .sep {
    width: 1px;
    height: 14px;
    background: var(--border-strong);
  }
  .spacer {
    flex: 1;
  }
  .mode {
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 10px;
  }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 38px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: var(--bg);
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    font-family: var(--font-mono);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    z-index: 60;
    pointer-events: none;
    animation: toast-in 0.14s ease;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }
  .busy {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    background-size: 40% 100%;
    animation: busy 0.9s linear infinite;
    z-index: 70;
  }
  @keyframes busy {
    from {
      background-position: -40% 0;
    }
    to {
      background-position: 140% 0;
    }
  }
</style>
