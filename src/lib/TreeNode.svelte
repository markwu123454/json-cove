<script>
  import { untrack } from "svelte";
  import Self from "./TreeNode.svelte";
  import { valueType, isContainer, childCount, previewValue, pathToString, highlightParts } from "./json.js";

  let {
    keyLabel = null,
    value,
    segments = [],
    depth = 0,
    autoExpandDepth = 1,
    selectedPath = "",
    caretPath = "",
    search = null, // { active, filter, query, opts, matchPaths, ancestorPaths, currentPath }
    insideMatch = false, // true when an ancestor node itself matched
    subtreeCmd = null, // { path, open, n } — expand/collapse a subtree
    editCmd = null, // { path, n } — request to start editing a specific node
    editable = false, // inline value editing allowed (JSON mode)
    onselect = () => {},
    onseek = () => {},
    oncontext = () => {},
    onedit = () => {},
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(depth < autoExpandDepth);
  let editing = $state(false);
  let draft = $state("");
  let inputEl = $state(null);
  const container = $derived(isContainer(value));
  const canEdit = $derived(editable && !isContainer(value) && segments.length > 0);
  const type = $derived(valueType(value));
  const count = $derived(childCount(value));
  const path = $derived(pathToString(segments));
  const selected = $derived(selectedPath === path);

  // ---- Search state --------------------------------------------------------
  const sActive = $derived(!!search?.active);
  const isMatch = $derived(sActive && search.matchPaths.has(path));
  const isAncestor = $derived(sActive && search.ancestorPaths.has(path));
  const isCurrent = $derived(sActive && search.currentPath === path);
  const childInside = $derived(insideMatch || isMatch);
  // Root ("$") is never pruned, so the tree keeps a stable anchor.
  const hidden = $derived(
    sActive && search.filter && path !== "$" && !(isMatch || isAncestor || insideMatch)
  );
  const dimmed = $derived(
    sActive && !search.filter && !(isMatch || isAncestor || insideMatch)
  );
  // While searching, force-reveal the route to every hit.
  const displayOpen = $derived(sActive ? (isAncestor || isMatch || insideMatch || open) : open);

  // Editor→tree caret sync. The caret path may point into a collapsed subtree
  // whose exact node isn't rendered — in that case the nearest *visible*
  // ancestor (this collapsed container) stands in for it. So a row is the caret
  // target when it IS the caret node, or it's a collapsed container holding it.
  const caretUnder = $derived(caretPath !== "" && isUnderPath(caretPath, path));
  const isCaretTarget = $derived(
    caretPath !== "" &&
      (caretPath === path || (container && !displayOpen && caretUnder))
  );

  const showKeyHighlight = $derived(
    sActive && search.opts.key && typeof keyLabel === "string"
  );
  const showValueHighlight = $derived(sActive && search.opts.value && !container);
  const keyParts = $derived(
    showKeyHighlight ? highlightParts(keyLabel, search.query, search.opts.caseSensitive) : null
  );
  const valueParts = $derived(
    showValueHighlight ? highlightParts(previewValue(value), search.query, search.opts.caseSensitive) : null
  );

  // Stable, ordered list of [key, childValue] pairs for containers.
  const entries = $derived(
    type === "array"
      ? value.map((v, i) => [i, v])
      : type === "object"
        ? Object.entries(value)
        : []
  );

  // Apply expand/collapse-subtree commands aimed at this node or its subtree.
  $effect(() => {
    const cmd = subtreeCmd;
    if (!cmd) return;
    const p = untrack(() => path);
    if (p === cmd.path || isUnderPath(p, cmd.path)) {
      untrack(() => (open = cmd.open));
    }
  });

  // Scroll the current search hit / caret-synced node into view.
  let rowEl = $state(null);
  $effect(() => {
    if ((isCurrent || isCaretTarget) && rowEl) {
      rowEl.scrollIntoView({ block: "nearest" });
    }
  });

  function isUnderPath(child, parent) {
    if (parent === "$") return child !== "$";
    if (!child.startsWith(parent)) return false;
    const next = child[parent.length];
    return next === "." || next === "[";
  }

  function toggle(e) {
    e.stopPropagation();
    if (container) open = !open;
  }

  // ---- Inline value editing ------------------------------------------------
  // Respond to an "Edit value" request aimed at this node (from the menu).
  $effect(() => {
    const cmd = editCmd;
    if (!cmd) return;
    const p = untrack(() => path);
    if (cmd.path === p && untrack(() => canEdit)) untrack(() => startEdit());
  });

  function startEdit() {
    if (!canEdit) return;
    // Strings edit as their raw content; scalars edit as their literal token.
    draft = typeof value === "string" ? value : previewValue(value);
    editing = true;
  }
  function commitEdit() {
    if (!editing) return;
    editing = false;
    onedit(segments, value, draft);
  }
  function cancelEdit() {
    editing = false;
  }
  $effect(() => {
    if (editing && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  function onRowClick(e) {
    // Ctrl/Cmd-click seeks the editor to this value; a plain click copies path.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onseek(path, segments, value);
    } else {
      onselect(path, segments, value);
    }
  }

  function onRowDblClick(e) {
    e.preventDefault();
    // Double-click edits an editable leaf; otherwise it seeks the editor.
    if (canEdit) startEdit();
    else onseek(path, segments, value);
  }

  function onEditKeydown(e) {
    e.stopPropagation(); // don't let tree nav / fold shortcuts fire while editing
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    oncontext({ x: e.clientX, y: e.clientY, path, segments, value, keyLabel });
  }

  function onKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter seeks; Shift+Enter (or Space) copies the path.
      if (e.shiftKey) onselect(path, segments, value);
      else onseek(path, segments, value);
    } else if (e.key === " ") {
      e.preventDefault();
      onselect(path, segments, value);
    } else if (e.key === "ArrowRight" && container && !open) {
      open = true;
    } else if (e.key === "ArrowLeft" && container && open) {
      open = false;
    }
  }
</script>

{#if !hidden}
  <div class="node">
    <div
      bind:this={rowEl}
      class="row"
      class:selected
      class:current={isCurrent}
      class:caret={isCaretTarget && !isCurrent}
      class:dimmed
      style="padding-left: {depth * 14 + 6}px"
      role="treeitem"
      aria-expanded={container ? displayOpen : undefined}
      aria-selected={selected}
      tabindex="0"
      onclick={onRowClick}
      ondblclick={onRowDblClick}
      oncontextmenu={onContextMenu}
      onkeydown={onKeydown}
      title={`${path}\nClick: copy path · ${canEdit ? "Double-click: edit" : "Double-click: jump"} · Ctrl-click: jump · Right-click: more`}
    >
      <span class="twist" class:open={displayOpen} class:leaf={!container} onclick={toggle} role="presentation">
        {#if container}▸{/if}
      </span>

      {#if keyLabel !== null}
        <span class="key" class:index={typeof keyLabel === "number"}>
          {#if keyParts}{#each keyParts as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}{:else}{keyLabel}{/if}
        </span>
        <span class="colon">:</span>
      {:else}
        <span class="key root">$</span>
      {/if}

      {#if container}
        <span class="bracket">{type === "array" ? "[" : "{"}</span>
        {#if !displayOpen}
          <span class="count">{count}</span><span class="bracket">{type === "array" ? "]" : "}"}</span>
        {/if}
      {:else if editing}
        <input
          class="edit {type}"
          bind:this={inputEl}
          bind:value={draft}
          spellcheck="false"
          onkeydown={onEditKeydown}
          onblur={commitEdit}
          onclick={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
        />
      {:else}
        <span class="value {type}">
          {#if valueParts}{#each valueParts as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}{:else}{previewValue(value)}{/if}
        </span>
      {/if}
    </div>

    {#if container && displayOpen}
      <div class="children" role="group">
        {#each entries as [k, v] (k)}
          <Self
            keyLabel={k}
            value={v}
            segments={[...segments, k]}
            depth={depth + 1}
            {autoExpandDepth}
            {selectedPath}
            {caretPath}
            {search}
            insideMatch={childInside}
            {subtreeCmd}
            {editCmd}
            {editable}
            {onselect}
            {onseek}
            {oncontext}
            {onedit}
          />
        {/each}
        <div class="closing" style="padding-left: {depth * 14 + 6}px">
          <span class="bracket">{type === "array" ? "]" : "}"}</span>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .node {
    font-family: var(--font-mono);
    font-size: inherit; /* inherits the tree container's (zoomable) size */
    line-height: 1.6;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 3px;
    padding: 1px 8px 1px 0;
    cursor: pointer;
    white-space: nowrap;
    border-radius: 4px;
    outline: none;
  }
  .row:hover {
    background: var(--bg-elevated);
  }
  .row.selected {
    background: var(--accent-soft);
  }
  .row.caret {
    background: var(--bg-elevated);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  /* When the caret target is also the click-selected row, keep the selected
     tint but still show the blue caret bracket. */
  .row.selected.caret {
    background: var(--accent-soft);
  }
  .row.current {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .row.dimmed {
    opacity: 0.4;
  }
  .row:focus-visible {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .row mark {
    background: var(--search-hit);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  .row.current mark {
    background: var(--search-current);
  }
  .twist {
    display: inline-block;
    width: 12px;
    text-align: center;
    color: var(--text-faint);
    transition: transform 0.1s ease;
    flex: none;
    cursor: pointer;
    user-select: none;
  }
  .twist.open {
    transform: rotate(90deg);
  }
  .twist.leaf {
    cursor: default;
  }
  .key {
    color: var(--key);
    font-weight: 500;
  }
  .key.index {
    color: var(--text-faint);
    font-weight: 400;
  }
  .key.root {
    color: var(--text-muted);
  }
  .colon {
    color: var(--text-faint);
    margin-right: 2px;
  }
  .bracket {
    color: var(--text-faint);
  }
  .count {
    color: var(--text-faint);
    font-style: italic;
    margin: 0 3px;
    opacity: 0.8;
  }
  .closing {
    color: var(--text-faint);
    padding-top: 0;
  }
  .value.string {
    color: var(--string);
  }
  .value.number {
    color: var(--number);
  }
  .value.boolean {
    color: var(--boolean);
  }
  .value.null {
    color: var(--null);
    font-style: italic;
  }
  .edit {
    font-family: var(--font-mono);
    font-size: inherit;
    padding: 0 3px;
    min-width: 60px;
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--accent);
    border-radius: 3px;
    outline: none;
  }
  .edit.string {
    color: var(--string);
  }
  .edit.number {
    color: var(--number);
  }
  .edit.boolean {
    color: var(--boolean);
  }
</style>
