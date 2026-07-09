// A lightweight "git-like" change tracker for CodeMirror 6. Diffs the document
// against a baseline (the last saved / opened text) and marks changed lines with
// a colored bar in a gutter and a matching mark on the scrollbar overview:
//   green  = added line, blue = modified line, red triangle = a deletion.
import { EditorView, gutter, GutterMarker, ViewPlugin } from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";

/** Dispatch to change the diff baseline (e.g. after a save). */
export const setBaseline = StateEffect.define();

class ChangeMarker extends GutterMarker {
  constructor(type) {
    super();
    this.type = type;
  }
  eq(other) {
    return other.type === this.type;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-change-mark cm-change-" + this.type;
    return el;
  }
}

/**
 * Classify each current line as added / modified, and note where deletions
 * happened. Uses common prefix/suffix trimming + an LCS on the changed middle,
 * which stays cheap for the typical case of editing a few lines.
 * @returns {Map<number, "added"|"modified"|"deleted">} keyed by 0-based line index
 */
function classify(baseText, curText) {
  const map = new Map();
  if (baseText === curText) return map;

  const a = baseText.length ? baseText.split("\n") : [];
  const b = curText.length ? curText.split("\n") : [];
  const aLen = a.length;
  const bLen = b.length;

  let start = 0;
  const maxPre = Math.min(aLen, bLen);
  while (start < maxPre && a[start] === b[start]) start++;

  let aEnd = aLen;
  let bEnd = bLen;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }

  const set = (idx, type) => {
    const clamped = Math.max(0, Math.min(idx, Math.max(0, bLen - 1)));
    const prev = map.get(clamped);
    if (prev === "modified") return;
    if (prev === "added" && type === "deleted") return;
    map.set(clamped, type);
  };

  const aMid = a.slice(start, aEnd);
  const bMid = b.slice(start, bEnd);

  if (aMid.length === 0) {
    for (let i = start; i < bEnd; i++) set(i, "added");
    return map;
  }
  if (bMid.length === 0) {
    set(start, "deleted");
    return map;
  }

  const n = aMid.length;
  const m = bMid.length;
  // Guard against a pathological full-rewrite: just mark the region modified.
  if (n * m > 400000) {
    for (let i = start; i < bEnd; i++) set(i, "modified");
    return map;
  }

  // LCS table (row-major, filled from the end).
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        aMid[i] === bMid[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aMid[i] === bMid[j]) {
      ops.push({ t: "s", b: start + j });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push({ t: "d" });
      i++;
    } else {
      ops.push({ t: "i", b: start + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: "d" });
    i++;
  }
  while (j < m) {
    ops.push({ t: "i", b: start + j });
    j++;
  }

  // Group runs of del/ins between anchors: ins+del => modified, ins => added,
  // del alone => a deletion marker on the following line.
  let del = 0;
  let ins = [];
  const flush = (markerLine) => {
    if (ins.length && del > 0) ins.forEach((bi) => set(bi, "modified"));
    else if (ins.length) ins.forEach((bi) => set(bi, "added"));
    else if (del > 0) set(markerLine, "deleted");
    del = 0;
    ins = [];
  };
  for (const op of ops) {
    if (op.t === "s") flush(op.b);
    else if (op.t === "d") del++;
    else ins.push(op.b);
  }
  flush(bEnd);

  return map;
}

function build(state, baseline) {
  const doc = state.doc;
  const raw = classify(baseline, doc.toString());

  // Collapse to one entry per (clamped) line, honoring priority.
  const byLine = new Map();
  for (const [idx, type] of raw) {
    const ln = Math.min(idx + 1, doc.lines);
    const prev = byLine.get(ln);
    if (prev === "modified") continue;
    if (prev === "added" && type === "deleted") continue;
    byLine.set(ln, type);
  }

  const entries = [...byLine.entries()].sort((x, y) => x[0] - y[0]); // [lineNo, type]
  const builder = new RangeSetBuilder();
  for (const [ln, type] of entries) {
    const from = doc.line(ln).from;
    builder.add(from, from, new ChangeMarker(type));
  }
  return { baseline, markers: builder.finish(), entries, total: doc.lines };
}

const changeTheme = EditorView.theme({
  "&": { position: "relative" },
  ".cm-changeGutter": { width: "3px", padding: "0" },
  ".cm-changeGutter .cm-gutterElement": { padding: "0" },
  ".cm-change-mark": { width: "3px", height: "100%", boxSizing: "border-box" },
  ".cm-change-added": { background: "var(--ok)" },
  ".cm-change-modified": { background: "var(--accent)" },
  ".cm-change-deleted": {
    width: "0",
    height: "0",
    marginTop: "1px",
    borderLeft: "4px solid var(--danger)",
    borderTop: "3px solid transparent",
    borderBottom: "3px solid transparent",
  },
  ".cm-change-overview": {
    position: "absolute",
    top: "0",
    right: "0",
    width: "4px",
    height: "100%",
    pointerEvents: "none",
    zIndex: "4",
  },
  ".cm-change-overview .cm-ov": {
    position: "absolute",
    right: "0",
    width: "4px",
    minHeight: "2px",
    borderRadius: "1px",
  },
  ".cm-ov-added": { background: "var(--ok)" },
  ".cm-ov-modified": { background: "var(--accent)" },
  ".cm-ov-deleted": { background: "var(--danger)" },
});

/** Build the change-tracking extensions for an editor state. */
export function changeTracking(initialBaseline) {
  const field = StateField.define({
    create(state) {
      return build(state, initialBaseline ?? "");
    },
    update(value, tr) {
      let baseline = value.baseline;
      let baselineChanged = false;
      for (const e of tr.effects) {
        if (e.is(setBaseline)) {
          baseline = e.value;
          baselineChanged = true;
        }
      }
      if (tr.docChanged || baselineChanged) return build(tr.state, baseline);
      return value;
    },
  });

  const changeGutter = gutter({
    class: "cm-changeGutter",
    markers: (view) => view.state.field(field).markers,
  });

  const overview = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.dom = document.createElement("div");
        this.dom.className = "cm-change-overview";
        view.dom.appendChild(this.dom);
        this.render(view);
      }
      update(u) {
        if (
          u.docChanged ||
          u.geometryChanged ||
          u.startState.field(field) !== u.state.field(field)
        ) {
          this.render(u.view);
        }
      }
      render(view) {
        const { entries, total } = view.state.field(field);
        const t = Math.max(1, total);
        this.dom.textContent = "";
        for (const [ln, type] of entries) {
          const d = document.createElement("div");
          d.className = "cm-ov cm-ov-" + type;
          d.style.top = ((ln - 1) / t) * 100 + "%";
          d.style.height = Math.max(0.5, (1 / t) * 100) + "%";
          this.dom.appendChild(d);
        }
      }
      destroy() {
        this.dom.remove();
      }
    }
  );

  return [field, changeGutter, overview, changeTheme];
}
