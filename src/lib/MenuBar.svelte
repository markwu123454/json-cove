<script>
  // A classic desktop menu bar. `menus` is an array of:
  //   { label, items: [ {label, shortcut?, action?, disabled?, sep?, submenu?, emptyLabel?} ] }
  let { menus = [] } = $props();

  let openIndex = $state(-1);
  let openSubKey = $state(null);

  function toggle(i) {
    openIndex = openIndex === i ? -1 : i;
    openSubKey = null;
  }
  function hoverTop(i) {
    // Once a menu is open, sliding across the bar switches menus (native feel).
    if (openIndex !== -1 && openIndex !== i) {
      openIndex = i;
      openSubKey = null;
    }
  }
  function close() {
    openIndex = -1;
    openSubKey = null;
  }
  function run(item) {
    if (!item || item.disabled || item.sep || item.submenu) return;
    close();
    item.action?.();
  }
  function onWindowClick(e) {
    if (openIndex === -1) return;
    if (!e.target.closest(".menubar")) close();
  }
  function onWindowKey(e) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKey} />

<div class="menubar" role="menubar">
  {#each menus as menu, i (menu.label)}
    <div class="top" class:open={openIndex === i}>
      <button
        class="top-btn"
        class:active={openIndex === i}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={openIndex === i}
        onclick={(e) => { e.stopPropagation(); toggle(i); }}
        onmouseenter={() => hoverTop(i)}
      >
        <span class="mn">{menu.label.slice(0, 1)}</span>{menu.label.slice(1)}
      </button>

      {#if openIndex === i}
        <div class="dropdown" role="menu">
          {#each menu.items as item, j (item.label ?? `sep-${j}`)}
            {#if item.sep}
              <div class="sep"></div>
            {:else if item.submenu}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="item has-sub"
                class:disabled={item.disabled}
                role="menuitem"
                tabindex="-1"
                onmouseenter={() => (openSubKey = item.label)}
              >
                <span class="label">{item.label}</span>
                <span class="arrow">▸</span>
                {#if openSubKey === item.label}
                  <div class="dropdown submenu" role="menu">
                    {#if !item.submenu.length}
                      <div class="empty">{item.emptyLabel ?? "Empty"}</div>
                    {:else}
                      {#each item.submenu as sub, k (sub.label ?? `sep-${k}`)}
                        {#if sub.sep}
                          <div class="sep"></div>
                        {:else}
                          <button
                            class="item"
                            role="menuitem"
                            title={sub.title}
                            onclick={(e) => { e.stopPropagation(); run(sub); }}
                          >
                            <span class="label">{sub.label}</span>
                          </button>
                        {/if}
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <button
                class="item"
                class:disabled={item.disabled}
                disabled={item.disabled}
                role="menuitem"
                onclick={(e) => { e.stopPropagation(); run(item); }}
                onmouseenter={() => (openSubKey = null)}
              >
                <span class="label">{item.label}</span>
                {#if item.shortcut}<span class="shortcut">{item.shortcut}</span>{/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .menubar {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 100%;
  }
  .top {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
  }
  .top-btn {
    height: 26px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    font-family: var(--font-ui);
    font-size: 13px;
    color: var(--text);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: default;
    white-space: nowrap;
    user-select: none;
  }
  .top-btn:hover,
  .top-btn.active {
    background: var(--menu-hover);
  }
  .mn {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    z-index: 60;
    min-width: 210px;
    max-width: 460px;
    background: var(--menu-bg);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    padding: 4px;
  }
  .submenu {
    top: -5px;
    left: 100%;
    margin-left: 2px;
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 26px;
    width: 100%;
    text-align: left;
    padding: 6px 9px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13px;
    cursor: default;
    white-space: nowrap;
    position: relative;
  }
  .item:hover:not(.disabled) {
    background: var(--accent-soft);
  }
  .item.disabled {
    opacity: 0.4;
    cursor: default;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .shortcut {
    color: var(--text-faint);
    font-size: 11px;
    font-family: var(--font-mono);
    flex: none;
  }
  .arrow {
    color: var(--text-faint);
    font-size: 11px;
  }
  .has-sub .label {
    flex: 1;
  }
  .sep {
    height: 1px;
    background: var(--border);
    margin: 4px 6px;
  }
  .empty {
    padding: 8px 10px;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
