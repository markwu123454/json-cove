// CodeMirror theme + syntax highlighting for light and dark, wired to the same
// palette as the rest of the app. Exposed as extensions swapped via a Compartment.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

function baseTheme(dark) {
  const c = dark
    ? {
        bg: "#1b1d21",
        gutterBg: "#1b1d21",
        gutterFg: "#5b616b",
        gutterActive: "#c3c8cf",
        caret: "#4f8cff",
        selection: "rgba(79, 140, 255, 0.28)",
        activeLine: "rgba(255,255,255,0.035)",
        activeGutter: "rgba(255,255,255,0.05)",
        text: "#e6e8eb",
        border: "#33373d",
        matchBg: "rgba(79,140,255,0.22)",
        searchHit: "rgba(250,204,21,0.26)",
        searchCur: "rgba(250,204,21,0.5)",
        searchCurBorder: "rgba(250,204,21,0.9)",
      }
    : {
        bg: "#ffffff",
        gutterBg: "#ffffff",
        gutterFg: "#b3b9c2",
        gutterActive: "#5b616b",
        caret: "#2563eb",
        selection: "rgba(37, 99, 235, 0.16)",
        activeLine: "rgba(0,0,0,0.025)",
        activeGutter: "rgba(0,0,0,0.035)",
        text: "#1c2024",
        border: "#e3e6ea",
        matchBg: "rgba(37,99,235,0.16)",
        searchHit: "rgba(245,158,11,0.30)",
        searchCur: "rgba(245,158,11,0.5)",
        searchCurBorder: "rgba(217,119,6,0.9)",
      };

  return EditorView.theme(
    {
      "&": {
        color: c.text,
        backgroundColor: c.bg,
        height: "100%",
        fontSize: "13px",
      },
      ".cm-scroller": {
        fontFamily:
          '"SFMono-Regular", "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace',
        lineHeight: "1.55",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-content": { caretColor: c.caret, padding: "6px 0" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: c.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: c.selection },
      ".cm-activeLine": { backgroundColor: c.activeLine },
      ".cm-gutters": {
        backgroundColor: c.gutterBg,
        color: c.gutterFg,
        border: "none",
        borderRight: `1px solid ${c.border}`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: c.activeGutter,
        color: c.gutterActive,
      },
      ".cm-foldGutter .cm-gutterElement": { cursor: "pointer", padding: "0 4px" },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 10px" },
      ".cm-selectionMatch": { backgroundColor: c.matchBg },
      ".cm-search-hit": { backgroundColor: c.searchHit, borderRadius: "2px" },
      ".cm-search-current": {
        backgroundColor: c.searchCur,
        borderRadius: "2px",
        boxShadow: `0 0 0 1px ${c.searchCurBorder}`,
      },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: c.matchBg,
        outline: "none",
      },
      ".cm-tooltip": {
        border: `1px solid ${c.border}`,
        backgroundColor: dark ? "#24272c" : "#ffffff",
        color: c.text,
        borderRadius: "6px",
      },
      ".cm-panels": {
        backgroundColor: dark ? "#24272c" : "#f6f7f9",
        color: c.text,
      },
    },
    { dark }
  );
}

function highlight(dark) {
  const p = dark
    ? {
        key: "#4dd0e1",
        string: "#7ee2a8",
        number: "#ffb073",
        bool: "#c4a7ff",
        null: "#8b93a0",
        punct: "#8b93a0",
      }
    : {
        key: "#0b7285",
        string: "#0a7d3c",
        number: "#b4530b",
        bool: "#6f42c1",
        null: "#8b93a0",
        punct: "#8b93a0",
      };

  return HighlightStyle.define([
    { tag: [t.propertyName], color: p.key },
    { tag: [t.string], color: p.string },
    { tag: [t.number], color: p.number },
    { tag: [t.bool, t.keyword], color: p.bool },
    { tag: [t.null], color: p.null },
    { tag: [t.punctuation, t.separator, t.brace, t.bracket], color: p.punct },
    { tag: [t.invalid], color: dark ? "#f87171" : "#dc2626" },
  ]);
}

/** Full theme extension for a given mode. */
export function themeExtension(dark) {
  return [baseTheme(dark), syntaxHighlighting(highlight(dark))];
}
