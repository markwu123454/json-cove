<script>
  import { untrack } from "svelte";
  import { EditorView, Decoration, ViewPlugin, WidgetType, hoverTooltip, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, dropCursor } from "@codemirror/view";
  import { EditorState, StateField, StateEffect, Compartment } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
  import { json } from "@codemirror/lang-json";
  import { bracketMatching, foldGutter, foldKeymap, foldable, foldEffect, unfoldAll, indentOnInput, indentUnit, syntaxTree } from "@codemirror/language";
  import { lintGutter, linter } from "@codemirror/lint";
  import { highlightSelectionMatches, SearchCursor } from "@codemirror/search";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import { themeExtension } from "./editor-theme.js";
  import { changeTracking, setBaseline } from "./change-gutter.js";

  // ---- Search-match decorations (driven from the app's unified search) ------
  const setSearchEffect = StateEffect.define();
  const searchField = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setSearchEffect)) deco = e.value;
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const hitMark = Decoration.mark({ class: "cm-search-hit" });
  const currentMark = Decoration.mark({ class: "cm-search-hit cm-search-current" });

  // ---- Color swatches: a small chip before any #rgb / #rrggbb literal -------
  const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  class ColorWidget extends WidgetType {
    constructor(color) {
      super();
      this.color = color;
    }
    eq(other) {
      return other.color === this.color;
    }
    toDOM() {
      const s = document.createElement("span");
      s.className = "cm-color-swatch";
      s.style.backgroundColor = this.color;
      return s;
    }
    ignoreEvent() {
      return true;
    }
  }
  function buildColorDecos(view) {
    const decos = [];
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      HEX_RE.lastIndex = 0;
      let m;
      while ((m = HEX_RE.exec(text))) {
        decos.push(
          Decoration.widget({ widget: new ColorWidget(m[0]), side: -1 }).range(from + m.index)
        );
      }
    }
    return Decoration.set(decos, true);
  }
  const colorSwatches = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildColorDecos(view);
      }
      update(u) {
        if (u.docChanged || u.viewportChanged) this.decorations = buildColorDecos(u.view);
      }
    },
    { decorations: (v) => v.decorations }
  );

  // ---- Epoch-timestamp hover: decode plausible unix times to a readable date -
  function epochToDate(n) {
    if (!Number.isFinite(n)) return null;
    let ms;
    if (n >= 1e8 && n < 1e11) ms = n * 1000; // seconds  (1973 … 5138)
    else if (n >= 1e11 && n < 1e14) ms = n; // milliseconds
    else return null;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace("T", " ").replace(/\.000Z$/, " UTC");
  }
  const epochHover = hoverTooltip((view, pos) => {
    let node = syntaxTree(view.state).resolveInner(pos, 0);
    while (node && node.name !== "Number") node = node.parent;
    if (!node) return null;
    const raw = view.state.sliceDoc(node.from, node.to);
    const label = epochToDate(Number(raw));
    if (!label) return null;
    return {
      pos: node.from,
      end: node.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-epoch-tooltip";
        dom.textContent = label;
        return { dom };
      },
    };
  });

  let {
    value = "",
    mode = "json", // "json" | "jsonl"
    baseline = "", // last-saved text, for the change gutter
    wrap = true, // soft-wrap long lines
    fontSize = 13, // editor font size in px
    onchange = () => {},
    onstatus = () => {},
    onready = () => {},
    oncaret = () => {}, // (segments) — path of the value under the cursor
  } = $props();

  let host;
  /** @type {EditorView} */
  let view;
  let applyingExternal = false;
  // svelte-ignore state_referenced_locally
  let activeMode = mode; // current linting mode; updated on setDocument
  let lastDiagnostics = [];
  let searchRanges = []; // resolved editor ranges for the current search matches
  let lastCaretPath = null; // last path reported to oncaret (dedupe)
  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const fontCompartment = new Compartment();

  const fontTheme = (px) => EditorView.theme({ "&": { fontSize: `${px}px` } });

  const prefersDark = () =>
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  function cleanMessage(err) {
    return String(err?.message || err).replace(/^JSON\.parse:\s*/, "");
  }

  // Map a JSON.parse error to a document offset across JS engines.
  function errorOffset(text, err, doc) {
    const msg = String(err?.message || "");
    let m = msg.match(/position\s+(\d+)/i); // V8 / Chromium
    if (m) return Math.max(0, Math.min(Number(m[1]), doc.length));
    m = msg.match(/at line (\d+) column (\d+)/i); // SpiderMonkey
    if (m) {
      const line = doc.line(Math.min(Number(m[1]), doc.lines));
      return Math.min(line.from + Number(m[2]) - 1, line.to);
    }
    return 0;
  }

  // ---- JSON mode: collect EVERY syntax error from the Lezer parse tree ------
  function jsonErrors(state) {
    const text = state.doc.toString();
    if (text.trim() === "") return [];
    const diags = [];
    const seen = new Set();
    syntaxTree(state).cursor().iterate((node) => {
      if (!node.type.isError) return;
      if (seen.has(node.from)) return;
      seen.add(node.from);
      let to = node.to;
      if (to <= node.from) to = Math.min(node.from + 1, state.doc.length);
      diags.push({ from: node.from, to, severity: "error", message: "Unexpected or missing token" });
    });
    diags.sort((a, b) => a.from - b.from);
    // Give the earliest error a precise message via JSON.parse.
    try {
      JSON.parse(text);
      // Parses fine but tree flagged errors → trust the parser, clear them.
      if (diags.length) return [];
    } catch (e) {
      if (diags.length) {
        diags[0].message = cleanMessage(e);
      } else {
        // Tree found nothing but parse failed: add a single marker.
        const off = errorOffset(text, e, state.doc);
        diags.push({ from: off, to: Math.min(off + 1, state.doc.length), severity: "error", message: cleanMessage(e) });
      }
    }
    return diags;
  }

  // ---- JSONL mode: lint each line independently (reports all bad lines) -----
  function jsonlErrors(state) {
    const diags = [];
    const doc = state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.trim() === "") continue;
      try {
        JSON.parse(line.text);
      } catch (e) {
        const off = line.from + errorOffsetInLine(line.text, e);
        diags.push({
          from: Math.min(off, line.to),
          to: line.to,
          severity: "error",
          message: cleanMessage(e),
        });
      }
    }
    return diags;
  }

  function errorOffsetInLine(text, err) {
    const m = String(err?.message || "").match(/position\s+(\d+)/i);
    if (m) return Math.max(0, Math.min(Number(m[1]), text.length));
    return 0;
  }

  // ---- Duplicate object keys: valid JSON, but the last value silently wins ---
  function duplicateKeyWarnings(state) {
    const diags = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "Object") return;
        const seen = new Set();
        let c = node.node.firstChild;
        while (c) {
          if (c.name === "Property") {
            const nameNode = c.getChild("PropertyName");
            if (nameNode) {
              const raw = state.sliceDoc(nameNode.from, nameNode.to);
              let key;
              try {
                key = JSON.parse(raw);
              } catch {
                key = raw.replace(/^"|"$/g, "");
              }
              if (seen.has(key)) {
                diags.push({
                  from: nameNode.from,
                  to: nameNode.to,
                  severity: "warning",
                  message: `Duplicate key "${key}" — the last value wins`,
                });
              } else {
                seen.add(key);
              }
            }
          }
          c = c.nextSibling;
        }
      },
    });
    return diags;
  }

  function lintDoc(viewRef) {
    if (activeMode === "jsonl") {
      lastDiagnostics = jsonlErrors(viewRef.state);
    } else {
      const errs = jsonErrors(viewRef.state);
      // Only surface duplicate-key warnings on otherwise-valid JSON.
      lastDiagnostics = errs.some((d) => d.severity === "error")
        ? errs
        : errs.concat(duplicateKeyWarnings(viewRef.state));
    }
    reportStatus(viewRef);
    return lastDiagnostics;
  }

  function reportStatus(viewRef) {
    const diags = lastDiagnostics;
    const doc = viewRef.state.doc;
    const head = viewRef.state.selection.main.head;
    const line = doc.lineAt(head);
    const errs = diags.filter((d) => d.severity !== "warning");
    const warns = diags.filter((d) => d.severity === "warning");
    let firstError = null;
    if (errs.length) {
      const d = errs[0];
      firstError = { line: doc.lineAt(d.from).number, message: d.message };
    }
    let firstWarning = null;
    if (warns.length) {
      const d = warns[0];
      firstWarning = { line: doc.lineAt(d.from).number, message: d.message };
    }
    onstatus({
      valid: errs.length === 0,
      errorCount: errs.length,
      warnCount: warns.length,
      firstError,
      firstWarning,
      cursorLine: line.number,
      cursorCol: head - line.from + 1,
      lines: doc.lines,
      mode: activeMode,
    });
  }

  function makeState(doc, m, base) {
    activeMode = m ?? activeMode;
    lastDiagnostics = [];
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        ...changeTracking(base ?? baseline),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        history(),
        indentOnInput(),
        indentUnit.of("  "),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        searchField,
        colorSwatches,
        epochHover,
        json(),
        lintGutter(),
        linter(lintDoc, { delay: 200 }),
        // Font compartment before the base theme so its font-size wins
        // (earlier extensions take precedence in CodeMirror).
        fontCompartment.of(fontTheme(fontSize)),
        themeCompartment.of(themeExtension(prefersDark())),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !applyingExternal) {
            onchange(u.state.doc.toString());
          }
          if (u.docChanged || u.selectionSet) {
            reportStatus(u.view);
            reportCaret(u.view);
          }
        }),
      ],
    });
  }

  // ---- Editor → tree sync: report the JSON path under the cursor ------------
  function reportCaret(viewRef) {
    if (activeMode === "jsonl") return; // per-line records: path is ambiguous
    const pos = viewRef.state.selection.main.head;
    const segments = offsetToSegments(viewRef.state, pos);
    const key = segments.join("\u0000");
    if (key === lastCaretPath) return;
    lastCaretPath = key;
    oncaret(segments);
  }

  // Walk from the root to the deepest container whose child range holds `pos`.
  function offsetToSegments(state, pos) {
    const tree = syntaxTree(state);
    let node = firstValueChild(tree.topNode);
    const segments = [];
    while (node) {
      if (node.name === "Object") {
        let next = null;
        let c = node.firstChild;
        while (c) {
          if (c.name === "Property" && pos >= c.from && pos <= c.to) {
            const nameNode = c.getChild("PropertyName");
            let key = null;
            if (nameNode) {
              const raw = state.sliceDoc(nameNode.from, nameNode.to);
              try {
                key = JSON.parse(raw);
              } catch {
                key = raw.replace(/^"|"$/g, "");
              }
            }
            segments.push(key);
            next = propertyValue(c);
            break;
          }
          c = c.nextSibling;
        }
        if (!next) break;
        node = next;
      } else if (node.name === "Array") {
        const items = arrayItems(node);
        let next = null;
        for (let i = 0; i < items.length; i++) {
          if (pos >= items[i].from && pos <= items[i].to) {
            segments.push(i);
            next = items[i];
            break;
          }
        }
        if (!next) break;
        node = next;
      } else {
        break; // leaf value
      }
    }
    return segments;
  }

  // Create the editor exactly once. `value` and the callback props are read
  // untracked so typing (which flows out via onchange) never rebuilds the view
  // and resets the cursor. External updates arrive through setValue() instead.
  $effect(() => {
    if (!host) return;
    untrack(() => {
      view = new EditorView({ state: makeState(value, mode, baseline), parent: host });
      onready({
        setValue,
        setDocument,
        getValue: () => view.state.doc.toString(),
        focus: () => view.focus(),
        goToLine,
        goToPath,
        undo: () => undo(view),
        redo: () => redo(view),
        setSearchMatches,
        setSearchCurrent,
        clearSearch,
        replaceCurrent,
        replaceAllText,
        setValueAtPath,
        foldToLevel,
        unfoldAllEditor: () => view && unfoldAll(view),
        getSelectionText,
        replaceSelection,
        selectAll,
      });
    });
    return () => view?.destroy();
  });

  // React to word-wrap and font-size prop changes without rebuilding the view.
  $effect(() => {
    const w = wrap;
    if (view) view.dispatch({ effects: wrapCompartment.reconfigure(w ? EditorView.lineWrapping : []) });
  });
  $effect(() => {
    const px = fontSize;
    if (view) view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(px)) });
  });

  // Keep the change-gutter baseline in sync with the last-saved text.
  $effect(() => {
    const b = baseline;
    if (view) view.dispatch({ effects: setBaseline.of(b) });
  });

  // React to OS theme changes live.
  $effect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () =>
      view?.dispatch({
        effects: themeCompartment.reconfigure(themeExtension(mq.matches)),
      });
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  // Push an external value as an UNDOABLE edit (format / minify).
  export function setValue(next) {
    if (!view) return;
    if (next === view.state.doc.toString()) return;
    applyingExternal = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: Math.min(view.state.selection.main.anchor, next.length) },
    });
    applyingExternal = false;
  }

  // Load a fresh document (open / new). Replaces the whole state, which RESETS
  // the undo history — so Ctrl+Z can never wind back past the loaded file.
  export function setDocument(next, m) {
    if (!view) return;
    applyingExternal = true;
    // A freshly loaded document is its own baseline (no changes shown yet).
    view.setState(makeState(next, m, next));
    applyingExternal = false;
    reportStatus(view);
  }

  export function goToLine(line) {
    if (!view) return;
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const lineObj = view.state.doc.line(n);
    view.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: "center" }),
    });
    view.focus();
  }

  // ---- Locate a value by its JSON path and select it in the editor ---------
  const VALUE_TYPES = new Set([
    "Object", "Array", "String", "Number", "True", "False", "Null",
  ]);

  function firstValueChild(node) {
    let c = node?.firstChild;
    while (c) {
      if (VALUE_TYPES.has(c.name)) return c;
      c = c.nextSibling;
    }
    return null;
  }

  function arrayItems(arrayNode) {
    const out = [];
    let c = arrayNode.firstChild;
    while (c) {
      if (VALUE_TYPES.has(c.name)) out.push(c);
      c = c.nextSibling;
    }
    return out;
  }

  function propertyValue(propNode) {
    // A Property is: PropertyName ":" value. The value is the sole value-typed
    // child (PropertyName has its own node name, so it is not matched here).
    let c = propNode.firstChild;
    while (c) {
      if (VALUE_TYPES.has(c.name)) return c;
      c = c.nextSibling;
    }
    return null;
  }

  function findProperty(objNode, key, state) {
    let c = objNode.firstChild;
    while (c) {
      if (c.name === "Property") {
        const nameNode = c.getChild("PropertyName");
        if (nameNode) {
          const raw = state.sliceDoc(nameNode.from, nameNode.to);
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw.replace(/^"|"$/g, "");
          }
          if (parsed === key) return propertyValue(c);
        }
      }
      c = c.nextSibling;
    }
    return null;
  }

  /**
   * Move the cursor to (and select) the value at a JSON path.
   * @param {(string|number)[]} segments
   * @returns {boolean} whether the path was located in the current text
   */
  export function goToPath(segments) {
    if (!view) return false;
    const node = valueNodeAtPath(view.state, segments);
    if (!node) return false;
    const from = node.from;
    const to = Math.min(node.to, view.state.doc.length);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    view.focus();
    return true;
  }

  // Resolve the value node at a path (null if the path doesn't exist here).
  function valueNodeAtPath(state, segments) {
    const tree = syntaxTree(state);
    let node = firstValueChild(tree.topNode);
    for (const seg of segments) {
      if (!node) return null;
      if (typeof seg === "number") {
        if (node.name !== "Array") return null;
        node = arrayItems(node)[seg] || null;
      } else {
        if (node.name !== "Object") return null;
        node = findProperty(node, seg, state);
      }
    }
    return node;
  }

  // Replace the value at a JSON path with new raw text (used by tree editing).
  export function setValueAtPath(segments, insertText) {
    if (!view) return false;
    const node = valueNodeAtPath(view.state, segments);
    if (!node) return false;
    const from = node.from;
    const to = Math.min(node.to, view.state.doc.length);
    view.dispatch({
      changes: { from, to, insert: insertText },
      selection: { anchor: from + insertText.length },
    });
    return true;
  }

  // ---- Fold the editor to a given nesting level ----------------------------
  function foldWalk(node, depth, level, effects, state) {
    if (!node) return;
    const container = node.name === "Object" || node.name === "Array";
    if (container && depth >= level) {
      const line = state.doc.lineAt(node.from);
      const range = foldable(state, line.from, line.to);
      if (range) effects.push(foldEffect.of(range));
      return; // folded — its children are hidden, no need to recurse
    }
    if (node.name === "Object") {
      let c = node.firstChild;
      while (c) {
        if (c.name === "Property") foldWalk(propertyValue(c), depth + 1, level, effects, state);
        c = c.nextSibling;
      }
    } else if (node.name === "Array") {
      for (const it of arrayItems(node)) foldWalk(it, depth + 1, level, effects, state);
    }
  }

  export function foldToLevel(level) {
    if (!view) return;
    unfoldAll(view); // start from a fully expanded state
    const state = view.state;
    const root = firstValueChild(syntaxTree(state).topNode);
    const effects = [];
    foldWalk(root, 0, Math.max(1, level), effects, state);
    if (effects.length) view.dispatch({ effects });
  }

  // Resolve the PropertyName (key token) node for the last segment of a path.
  function keyNodeAtPath(state, segments) {
    if (!segments.length || typeof segments[segments.length - 1] !== "string") return null;
    const parent = valueNodeAtPath(state, segments.slice(0, -1));
    if (!parent || parent.name !== "Object") return null;
    const key = segments[segments.length - 1];
    let c = parent.firstChild;
    while (c) {
      if (c.name === "Property") {
        const nameNode = c.getChild("PropertyName");
        if (nameNode) {
          const raw = state.sliceDoc(nameNode.from, nameNode.to);
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw.replace(/^"|"$/g, "");
          }
          if (parsed === key) return nameNode;
        }
      }
      c = c.nextSibling;
    }
    return null;
  }

  // ---- Unified-search decorations ------------------------------------------
  // Resolve each match to an editor range, then paint hits + the current one.
  export function setSearchMatches(list, current) {
    if (!view) return;
    const state = view.state;
    searchRanges = (list || []).map((m) => {
      const node =
        m.part === "key"
          ? keyNodeAtPath(state, m.segments) || valueNodeAtPath(state, m.segments)
          : valueNodeAtPath(state, m.segments);
      return node ? { from: node.from, to: Math.min(node.to, state.doc.length) } : null;
    });
    paintSearch(current ?? -1, true);
  }

  export function setSearchCurrent(current) {
    paintSearch(current ?? -1, true);
  }

  export function clearSearch() {
    searchRanges = [];
    if (view) view.dispatch({ effects: setSearchEffect.of(Decoration.none) });
  }

  function paintSearch(current, scroll) {
    paintRanges(searchRanges, current, scroll);
  }

  // Paint a set of ranges as search hits, marking the current one and
  // (optionally) scrolling/selecting it. Shared by semantic + literal search.
  function paintRanges(ranges, current, scroll) {
    if (!view) return;
    const decos = [];
    ranges.forEach((r, i) => {
      if (!r || r.to <= r.from) return;
      decos.push((i === current ? currentMark : hitMark).range(r.from, r.to));
    });
    decos.sort((a, b) => a.from - b.from || a.startSide - b.startSide);
    const effects = [setSearchEffect.of(Decoration.set(decos, true))];
    const cur = ranges[current];
    const spec = { effects };
    if (cur && cur.to > cur.from) {
      // Select the current hit (so it stays put when search closes) but keep
      // focus in the search box — don't call view.focus() here.
      spec.selection = { anchor: cur.from, head: cur.to };
      if (scroll) effects.push(EditorView.scrollIntoView(cur.from, { y: "center" }));
    }
    view.dispatch(spec);
  }

  // ---- Replace within the current structural matches -----------------------
  // Find keeps its full key/value/filter semantics; Replace only rewrites text
  // inside the ranges the structural search already resolved (searchRanges), so
  // it never touches unmatched keys/values.
  function textCursor(query, cs, from, to) {
    const norm = cs ? (s) => s : (s) => s.toLowerCase();
    return new SearchCursor(view.state.doc, query, from ?? 0, to ?? view.state.doc.length, norm);
  }

  function replaceInRange(query, replacement, from, to, cs) {
    const changes = [];
    if (!query) return changes;
    const cur = textCursor(query, cs, from, to);
    while (!cur.next().done) {
      changes.push({ from: cur.value.from, to: cur.value.to, insert: replacement });
    }
    return changes;
  }

  // Replace occurrences of `query` inside the current match's range.
  export function replaceCurrent(query, replacement, current, opts) {
    if (!view || !query) return 0;
    const r = searchRanges[current];
    if (!r) return 0;
    const changes = replaceInRange(query, replacement, r.from, r.to, !!opts?.caseSensitive);
    if (!changes.length) return 0;
    view.dispatch({ changes });
    return changes.length;
  }

  // Replace occurrences of `query` inside every current match, in one edit.
  export function replaceAllText(query, replacement, opts) {
    if (!view || !query) return 0;
    const cs = !!opts?.caseSensitive;
    let all = [];
    for (const r of searchRanges) {
      if (!r) continue;
      all = all.concat(replaceInRange(query, replacement, r.from, r.to, cs));
    }
    if (!all.length) return 0;
    all.sort((a, b) => a.from - b.from);
    view.dispatch({ changes: all });
    return all.length;
  }

  // ---- Selection helpers (for the editor's custom context menu) -------------
  export function getSelectionText() {
    if (!view) return "";
    const s = view.state.selection.main;
    return view.state.sliceDoc(s.from, s.to);
  }

  export function replaceSelection(insert) {
    if (!view) return;
    const s = view.state.selection.main;
    view.dispatch({
      changes: { from: s.from, to: s.to, insert },
      selection: { anchor: s.from + insert.length },
    });
    view.focus();
  }

  export function selectAll() {
    if (!view) return;
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    view.focus();
  }
</script>

<div class="editor-host" bind:this={host}></div>

<style>
  .editor-host {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  .editor-host :global(.cm-editor) {
    height: 100%;
  }
  .editor-host :global(.cm-color-swatch) {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    margin-right: 0.35em;
    border: 1px solid rgba(128, 128, 128, 0.5);
    border-radius: 2px;
    vertical-align: baseline;
    box-sizing: border-box;
  }
  .editor-host :global(.cm-epoch-tooltip) {
    padding: 3px 7px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text);
  }
</style>
