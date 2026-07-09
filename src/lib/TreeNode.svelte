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
    onselect = () => {},
    onseek = () => {},
    oncontext = () => {},
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(depth < autoExpandDepth);
  const container = $derived(isContainer(value));
  const type = $derived(valueType(value));
  const count = $derived(childCount(value));
  const path = $derived(pathToString(segments));
  const selected = $derived(selectedPath === path);
  const isCaret = $derived(caretPath !== "" && caretPath === path);

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
    if ((isCurrent || isCaret) && rowEl) {
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
    onseek(path, segments, value);
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
      class:caret={isCaret && !selected && !isCurrent}
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
      title={`${path}\nClick: copy path · Double-click or Ctrl-click: jump · Right-click: more`}
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
            {onselect}
            {onseek}
            {oncontext}
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
    font-size: 12.5px;
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
</style>
