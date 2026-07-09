<script>
  // A small right-click menu positioned at (x, y). `items` is a list of
  //   { label, action?, disabled?, sep? }
  let { x = 0, y = 0, items = [], onclose = () => {} } = $props();

  let menuEl;
  // Clamp within the viewport once the size is known.
  let pos = $state({ left: x, top: y });
  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    const pad = 6;
    let left = x;
    let top = y;
    if (typeof window !== "undefined") {
      if (left + r.width + pad > window.innerWidth) left = window.innerWidth - r.width - pad;
      if (top + r.height + pad > window.innerHeight) top = window.innerHeight - r.height - pad;
    }
    pos = { left: Math.max(pad, left), top: Math.max(pad, top) };
  });

  function run(item) {
    if (!item || item.disabled || item.sep) return;
    onclose();
    item.action?.();
  }
  function onWindowClick() {
    onclose();
  }
  function onWindowKey(e) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window onclick={onWindowClick} oncontextmenu={onWindowClick} onkeydown={onWindowKey} />

<div
  bind:this={menuEl}
  class="ctx"
  role="menu"
  style="left: {pos.left}px; top: {pos.top}px"
  onclick={(e) => e.stopPropagation()}
  oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
>
  {#each items as item, i (item.label ?? `sep-${i}`)}
    {#if item.sep}
      <div class="sep"></div>
    {:else}
      <button class="item" class:disabled={item.disabled} disabled={item.disabled} role="menuitem" onclick={() => run(item)}>
        <span class="label">{item.label}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctx {
    position: fixed;
    z-index: 90;
    min-width: 184px;
    background: var(--menu-bg);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    padding: 4px;
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13px;
    cursor: default;
    white-space: nowrap;
  }
  .item:hover:not(.disabled) {
    background: var(--accent-soft);
  }
  .item.disabled {
    opacity: 0.4;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 4px 6px;
  }
</style>
