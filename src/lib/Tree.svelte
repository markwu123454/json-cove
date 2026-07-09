<script>
  import TreeNode from "./TreeNode.svelte";

  let {
    data,
    valid = true,
    stale = false,
    selectedPath = "",
    caretPath = "",
    search = null,
    subtreeCmd = null,
    editCmd = null,
    editable = false,
    fontSize = 12.5,
    onselect = () => {},
    onseek = () => {},
    oncontext = () => {},
    onedit = () => {},
    autoExpandDepth = 2,
    nonce = 0,
  } = $props();

  const noMatches = $derived(
    !!search?.active && search.filter && search.matchPaths.size === 0
  );

  let treeEl;
  // Up/Down (and Home/End) move focus between visible rows; Left/Right/Enter are
  // handled per-node (fold / seek). Ignored while an inline editor is focused.
  function onTreeKey(e) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const cur = document.activeElement;
    if (cur && (cur.tagName === "INPUT" || cur.tagName === "TEXTAREA")) return;
    const rows = [...treeEl.querySelectorAll(".row")];
    if (!rows.length) return;
    e.preventDefault();
    let i = rows.indexOf(cur);
    if (e.key === "Home") i = 0;
    else if (e.key === "End") i = rows.length - 1;
    else if (e.key === "ArrowDown") i = i < 0 ? 0 : Math.min(rows.length - 1, i + 1);
    else i = i < 0 ? 0 : Math.max(0, i - 1);
    rows[i]?.focus();
  }
</script>

<div class="tree" class:stale role="tree" aria-label="JSON tree" style="font-size: {fontSize}px" bind:this={treeEl} onkeydown={onTreeKey}>
  {#if data === undefined}
    <div class="empty">Nothing to show yet.</div>
  {:else}
    {#if noMatches}
      <div class="empty">No matches for “{search.query}”.</div>
    {/if}
    <!-- Keyed on `nonce` (not `data`) so live edits update nodes in place and
         keep their expand state; only an explicit reset remounts the tree. -->
    {#key nonce}
      <TreeNode
        value={data}
        segments={[]}
        depth={0}
        {autoExpandDepth}
        {selectedPath}
        {caretPath}
        {search}
        insideMatch={false}
        {subtreeCmd}
        {editCmd}
        {editable}
        {onselect}
        {onseek}
        {oncontext}
        {onedit}
      />
    {/key}
  {/if}
</div>

<style>
  .tree {
    height: 100%;
    overflow: auto;
    padding: 6px 4px 40px 4px;
    background: var(--bg-panel);
    transition: opacity 0.15s ease;
  }
  .tree.stale {
    opacity: 0.45;
  }
  .empty {
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: inherit;
    padding: 14px 12px;
  }
</style>
