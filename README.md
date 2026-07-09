<div align="center">

# JSON Cove

**A tiny, fast desktop JSON & JSONL viewer and editor for small files.**

[![Release](https://img.shields.io/github/v/release/markwu123454/json-cove?sort=semver)](https://github.com/markwu123454/json-cove/releases)
[![Downloads](https://img.shields.io/github/downloads/markwu123454/json-cove/total)](https://github.com/markwu123454/json-cove/releases)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0a7bbb)](https://github.com/markwu123454/json-cove/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)

Opens in under a second, shows JSON in a clean dual view — a formatted editor on
one side, a collapsible tree on the other — and lets you read, tweak a value,
and save without friction.

</div>

---

Built for the everyday case of opening a config file or an API response,
reading it, changing something, and moving on. **Not** built for gigabyte data
dumps.

## Download & install

Grab the latest installer from the
[**Releases**](https://github.com/markwu123454/json-cove/releases) page:

| File | What it is |
| --- | --- |
| `JSON Cove_x.y.z_x64-setup.exe` | Windows installer (NSIS) — recommended |
| `JSON Cove_x.y.z_x64_en-US.msi` | Windows installer (MSI) — for managed/enterprise setups |

The build isn't code-signed, so Windows SmartScreen may warn on first run —
click **More info → Run anyway**. The app is a few MB and needs the WebView2
runtime, which ships with current Windows.

After installing you can double-click any `.json` / `.jsonl` file, or use
**Open with → JSON Cove**.

## Features

- **Dual view** — a CodeMirror 6 editor with JSON highlighting, folding, bracket
  matching, and auto-closing brackets, beside a lightweight collapsible tree.
- **Open by drag-and-drop or double-click** — drop a file on the window, use the
  File menu, or set JSON Cove as the default app and double-click.
- **Auto-format on load** — valid JSON is pretty-printed the moment it opens.
- **JSON Lines (JSONL / NDJSON)** — `.jsonl` / `.ndjson` files (or any file whose
  every line is a JSON record) open in JSONL mode: each record is validated on
  its own line and the tree shows them as an array.
- **Live validation, all errors at once** — every syntax error is underlined and
  marked in the gutter (not just the first); the status bar shows the count and
  the first error's line, and clicking it jumps there.
- **Duplicate-key warnings** — valid JSON that repeats an object key (where the
  last value silently wins) is flagged in the gutter and status bar.
- **Unified search (`Ctrl+F`)** — one search box drives both panes: the tree
  filters to matching keys/values (with the route to each hit revealed) while the
  editor highlights every hit and jumps to the current one. Toggle **Key** /
  **Value** / **case-sensitive** matching, step with `Enter` / `Shift+Enter`, or
  switch **Filter** off to dim non-matches instead of hiding them. The app
  captures `Ctrl+F` so the webview's own find never appears.
- **Right-click a tree node** — a Chrome-style menu to copy the **value** (raw),
  **value as JSON**, **key**, **`"key": value`**, **path**, or **path in bracket
  notation**, jump to the value, or expand/collapse the whole subtree.
- **Editor ↔ tree sync** — click a tree node to jump the editor there, and moving
  the editor cursor highlights the matching node back in the tree.
- **Change tracking** — edited lines get a git-style bar in the gutter (green =
  added, blue = modified, red = deleted) mirrored on the scrollbar, diffed
  against the last saved version and cleared on save.
- **Click-to-copy JSON path** — click any tree node to copy its path
  (e.g. `$.window.width`) to the clipboard.
- **Jump to value** — double-click (or Ctrl-click) a tree node to move the editor
  cursor to that value and select it.
- **Menu bar** — a classic File / Edit / Format / View / Help menu with recent
  files, undo/redo, find, go-to-line, sort-keys, copy-as-minified/formatted,
  word-wrap, zoom, and expand/collapse-all.
- **Sort keys** — recursively reorder object keys A→Z (works in JSONL too).
- **Word wrap + zoom** — toggle soft-wrapping and change the editor font size
  (`Ctrl +` / `-` / `0`); both persist between launches.
- **Node stats & record count** — selecting a container shows its child count and
  depth in the status bar; JSONL files show the record count.
- **External-change detection** — if the open file is changed by another program,
  JSON Cove offers to reload it (desktop app only).
- **Save protection** — closing with unsaved changes prompts Save / Don't Save /
  Cancel; saving malformed JSON asks for confirmation first (a soft warning,
  never a hard block).
- **Sensible undo** — opening a file resets the undo history, so Ctrl+Z stops at
  the loaded document instead of wiping the editor.
- **Format / minify** — one click each, with keyboard shortcuts.
- **OS-following dark mode** — light and dark themes track the system setting,
  live.
- **Recent files + window memory** — remembers recent files and restores window
  size and position between launches.

## Scope

Optimized for files up to a few hundred KB, in either JSON or JSONL form. There
is no streaming, virtualization, or large-file handling — that omission is
deliberate and is what keeps the codebase small and startup near-instant.

## Keyboard shortcuts

| Action                 | Shortcut                  |
| ---------------------- | ------------------------- |
| New                    | `Ctrl+N`                  |
| Open                   | `Ctrl+O`                  |
| Save                   | `Ctrl+S`                  |
| Save As                | `Ctrl+Shift+S`            |
| Format                 | `Ctrl+Shift+F`            |
| Minify                 | `Ctrl+Shift+M`            |
| Search (tree + editor) | `Ctrl+F`                  |
| Next / previous match  | `Enter` / `Shift+Enter`   |
| Go to line             | `Ctrl+G`                  |
| Zoom in / out / reset  | `Ctrl+ +` / `-` / `0`     |
| Undo / Redo            | `Ctrl+Z` / `Ctrl+Y`       |

In the tree: **click** a node to copy its path, **double-click** or
**Ctrl-click** to jump the editor cursor to that value, and **right-click** for
copy/jump/expand actions.

## Stack

| Layer      | Choice                                                    |
| ---------- | --------------------------------------------------------- |
| Shell      | [Tauri 2](https://tauri.app) (Rust backend, OS webview)   |
| Editor     | [CodeMirror 6](https://codemirror.net)                    |
| Tree       | Custom Svelte component                                   |
| UI         | [Svelte 5](https://svelte.dev) + [Vite](https://vite.dev) |

The result is a few-MB binary that launches almost instantly.

## Build from source

Prerequisites: [Node.js](https://nodejs.org) 18+, the
[Rust toolchain](https://rustup.rs), and the platform dependencies from the
[Tauri prerequisites](https://tauri.app/start/prerequisites/). On Windows that
means the Visual Studio C++ Build Tools and the WebView2 runtime (bundled with
current Windows).

```bash
git clone https://github.com/markwu123454/json-cove
cd json-cove
npm install          # install frontend dependencies

npm run app:dev      # run the desktop app with hot reload
npm run app:build    # produce an optimized installer + binary

npm run dev          # run just the frontend in a browser (shows sample data)
npm run build        # build just the frontend bundle
```

`npm run app:build` writes the binary and installers under
`src-tauri/target/release/` (the `.exe`) and
`src-tauri/target/release/bundle/` (the `.msi` and NSIS `-setup.exe`).

### Where things live

```
src/                     Frontend (Svelte)
  App.svelte             Layout, menus, actions, OS integration, status bar
  lib/
    MenuBar.svelte       Classic dropdown menu bar
    SearchBar.svelte     Unified tree + editor search bar
    ContextMenu.svelte   Right-click copy/jump menu for tree nodes
    Editor.svelte        CodeMirror wrapper: highlighting, folding, linting, search, path seek
    editor-theme.js      Light/dark CodeMirror theme + syntax colors
    change-gutter.js     Git-style change tracking (gutter + scrollbar overview)
    Tree.svelte          Tree container
    TreeNode.svelte      Recursive, collapsible tree node (search filter + highlight)
    json.js              Pure JSON helpers (paths, previews, sizes, search)
    tauri.js             Bridge to the backend (degrades gracefully in a browser)
src-tauri/               Backend (Rust / Tauri)
  src/lib.rs             Commands (read/write/initial file) + plugin setup
  tauri.conf.json        Window, bundle, and file-association config
  capabilities/          Tauri permission grants for the main window
```

## License

[GNU Affero General Public License v3.0 or later](LICENSE) © Mark Wu.
