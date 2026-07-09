// Pure JSON helpers shared by the editor and tree. No framework, no side effects.

/** A valid JS identifier can use dot notation in a path; otherwise use brackets. */
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Build a JSONPath-ish accessor string from a list of keys/indices.
 * Root is "$". Object keys use dot or ["..."] notation, array indices use [n].
 * @param {(string|number)[]} segments
 * @returns {string}
 */
export function pathToString(segments) {
  let out = "$";
  for (const seg of segments) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else if (IDENT.test(seg)) {
      out += `.${seg}`;
    } else {
      out += `[${JSON.stringify(seg)}]`;
    }
  }
  return out;
}

/** Classify a JSON value for styling and tree rendering. */
export function valueType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // "object" | "string" | "number" | "boolean"
}

/** True for containers that can be expanded in the tree. */
export function isContainer(v) {
  return v !== null && typeof v === "object";
}

/** Number of direct children of a container. */
export function childCount(v) {
  if (v === null || typeof v !== "object") return 0;
  return Array.isArray(v) ? v.length : Object.keys(v).length;
}

/** A short, non-expanded summary of a value for the tree. */
export function previewValue(v) {
  const t = valueType(v);
  switch (t) {
    case "string":
      return JSON.stringify(v);
    case "number":
    case "boolean":
      return String(v);
    case "null":
      return "null";
    case "array":
      return `[${v.length}]`;
    case "object":
      return `{${Object.keys(v).length}}`;
    default:
      return String(v);
  }
}

/**
 * Format bytes as a compact human string, e.g. "12 B", "3.4 KB".
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/**
 * Bracket-notation accessor for a path, e.g. `["a"]["b"][0]` (a JS-path style).
 * Root (no segments) is "$".
 * @param {(string|number)[]} segments
 */
export function pathToBracket(segments) {
  if (!segments.length) return "$";
  let out = "";
  for (const seg of segments) {
    out += typeof seg === "number" ? `[${seg}]` : `[${JSON.stringify(seg)}]`;
  }
  return out;
}

/** The string a value is matched against when searching (unquoted content). */
function valueSearchString(v) {
  if (v === null) return "null";
  return String(v); // string → itself, number → "12", boolean → "true"
}

/**
 * Search a parsed JSON value for nodes whose key or leaf value contains `query`.
 * Returns matches in document (pre-order) order, plus the set of matched paths
 * and the set of all ancestor paths (so a tree can reveal the route to each hit).
 *
 * @param {*} data parsed JSON value (root)
 * @param {string} query
 * @param {{key:boolean, value:boolean, caseSensitive:boolean}} opts
 * @returns {{matches: Array<{path:string, segments:(string|number)[], part:"key"|"value"}>, matchPaths:Set<string>, ancestorPaths:Set<string>}}
 */
export function searchJson(data, query, opts) {
  const matches = [];
  const matchPaths = new Set();
  const ancestorPaths = new Set();
  if (data === undefined || !query) return { matches, matchPaths, ancestorPaths };

  const needle = opts.caseSensitive ? query : query.toLowerCase();
  const test = (s) =>
    (opts.caseSensitive ? String(s) : String(s).toLowerCase()).includes(needle);

  function visit(value, segments, keyLabel) {
    const path = pathToString(segments);
    const leaf = value === null || typeof value !== "object";
    const mKey = opts.key && typeof keyLabel === "string" && test(keyLabel);
    const mVal = opts.value && leaf && test(valueSearchString(value));
    if (mKey || mVal) {
      matches.push({ path, segments: segments.slice(), part: mVal ? "value" : "key" });
      matchPaths.add(path);
      for (let i = 0; i < segments.length; i++) {
        ancestorPaths.add(pathToString(segments.slice(0, i)));
      }
    }
    if (!leaf) {
      const entries = Array.isArray(value)
        ? value.map((v, i) => [i, v])
        : Object.entries(value);
      for (const [k, v] of entries) visit(v, [...segments, k], k);
    }
  }
  visit(data, [], null);
  return { matches, matchPaths, ancestorPaths };
}

/**
 * Split `str` into runs, flagging the ones that match `query`, for highlighting.
 * @returns {Array<{text:string, hit:boolean}>}
 */
export function highlightParts(str, query, caseSensitive) {
  const s = String(str);
  if (!query) return [{ text: s, hit: false }];
  const hay = caseSensitive ? s : s.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [{ text: s, hit: false }];
  const parts = [];
  let i = 0;
  while (i <= s.length) {
    const idx = hay.indexOf(needle, i);
    if (idx === -1) {
      if (i < s.length) parts.push({ text: s.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ text: s.slice(i, idx), hit: false });
    parts.push({ text: s.slice(idx, idx + needle.length), hit: true });
    i = idx + needle.length;
  }
  return parts;
}
