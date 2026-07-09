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
    onselect = () => {},
    onseek = () => {},
    oncontext = () => {},
    autoExpandDepth = 2,
    nonce = 0,
  } = $props();

  const noMatches = $derived(
    !!search?.active && search.filter && search.matchPaths.size === 0
  );
</script>

<div class="tree" class:stale role="tree" aria-label="JSON tree">
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
        {onselect}
        {onseek}
        {oncontext}
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
    font-size: 12.5px;
    padding: 14px 12px;
  }
</style>
