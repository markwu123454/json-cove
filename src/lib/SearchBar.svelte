<script>
  // Unified search bar. Drives both panes: the tree filters/highlights matches
  // and the editor jumps to the current one. Owned by App.svelte.
  let {
    query = "",
    count = 0,
    index = -1, // 0-based current match, -1 when none
    opts = { key: true, value: true, caseSensitive: false, filter: true },
    focusSignal = 0, // bump to (re)focus and select the input
    replace = false, // whether the replace row is shown
    replaceQuery = "",
    replaceFocusSignal = 0, // bump to (re)focus the replace input
    onquery = () => {},
    onnext = () => {},
    onprev = () => {},
    ontoggle = () => {},
    onclose = () => {},
    ontogglereplace = () => {},
    onreplacequery = () => {},
    onreplaceone = () => {},
    onreplaceall = () => {},
  } = $props();

  let inputEl;
  let replaceEl;

  $effect(() => {
    const n = focusSignal; // track re-focus requests
    if (n >= 0 && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  $effect(() => {
    const n = replaceFocusSignal; // track replace-focus requests
    if (n > 0 && replace && replaceEl) {
      replaceEl.focus();
      replaceEl.select();
    }
  });

  function onInput(e) {
    onquery(e.target.value);
  }

  function onKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.shiftKey ? onprev() : onnext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }

  function onReplaceInput(e) {
    onreplacequery(e.target.value);
  }

  function onReplaceKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.shiftKey ? onreplaceall() : onreplaceone();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    }
  }

  const counter = $derived(
    query.trim() === "" ? "" : count === 0 ? "0 results" : `${index + 1} / ${count}`
  );
</script>

<div class="searchwrap" role="search">
  <div class="searchbar">
    <button
      class="ibtn toggle"
      title={replace ? "Hide replace (Ctrl+R)" : "Show replace (Ctrl+R)"}
      aria-label="Toggle replace"
      aria-expanded={replace}
      onclick={ontogglereplace}>{replace ? "▾" : "▸"}</button>
    <span class="icon" aria-hidden="true">⌕</span>
    <input
      bind:this={inputEl}
      class="field"
      type="text"
      placeholder={replace ? "Find…" : "Search keys & values…"}
      spellcheck="false"
      value={query}
      oninput={onInput}
      onkeydown={onKeydown}
      aria-label="Search JSON"
    />

    <span class="counter" class:empty={count === 0 && query.trim() !== ""}>{counter}</span>

    <div class="nav">
      <button class="ibtn" title="Previous match (Shift+Enter)" onclick={onprev} disabled={count === 0} aria-label="Previous match">‹</button>
      <button class="ibtn" title="Next match (Enter)" onclick={onnext} disabled={count === 0} aria-label="Next match">›</button>
    </div>

    <span class="divider"></span>

    <div class="toggles">
      {#if !replace}
        <button class="tgl" class:on={opts.key} title="Match keys" onclick={() => ontoggle("key")}>Key</button>
        <button class="tgl" class:on={opts.value} title="Match values" onclick={() => ontoggle("value")}>Value</button>
      {/if}
      <button class="tgl mono" class:on={opts.caseSensitive} title="Case sensitive" onclick={() => ontoggle("caseSensitive")}>Aa</button>
      {#if !replace}
        <button class="tgl" class:on={opts.filter} title="Filter the tree to matches (off = dim non-matches)" onclick={() => ontoggle("filter")}>Filter</button>
      {/if}
    </div>

    <button class="ibtn close" title="Close (Esc)" onclick={onclose} aria-label="Close search">✕</button>
  </div>

  {#if replace}
    <div class="searchbar replacerow">
      <span class="ibtn toggle ghost" aria-hidden="true"></span>
      <span class="icon" aria-hidden="true">⤿</span>
      <input
        bind:this={replaceEl}
        class="field"
        type="text"
        placeholder="Replace…"
        spellcheck="false"
        value={replaceQuery}
        oninput={onReplaceInput}
        onkeydown={onReplaceKeydown}
        aria-label="Replace with"
      />
      <div class="rbtns">
        <button class="tgl" title="Replace current match (Enter)" onclick={onreplaceone} disabled={count === 0}>Replace</button>
        <button class="tgl" title="Replace all matches (Shift+Enter)" onclick={onreplaceall} disabled={count === 0}>Replace all</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .searchwrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 8px;
    background: var(--menu-bg);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  }
  .searchbar {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .toggle {
    font-size: 11px;
    color: var(--text-faint);
  }
  .toggle.ghost {
    pointer-events: none;
    background: transparent;
  }
  .replacerow .field {
    width: 190px;
  }
  .rbtns {
    display: flex;
    gap: 3px;
    margin-left: auto;
  }
  .icon {
    color: var(--text-faint);
    font-size: 15px;
    padding-left: 2px;
  }
  .field {
    width: 190px;
    height: 24px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13px;
  }
  .field::placeholder {
    color: var(--text-faint);
  }
  .counter {
    min-width: 46px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
    white-space: nowrap;
  }
  .counter.empty {
    color: var(--danger);
  }
  .nav {
    display: flex;
    gap: 2px;
  }
  .ibtn {
    height: 24px;
    min-width: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 15px;
    cursor: pointer;
    padding: 0 4px;
  }
  .ibtn:hover:not(:disabled) {
    background: var(--menu-hover);
    color: var(--text);
  }
  .ibtn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: var(--border-strong);
    margin: 0 1px;
  }
  .toggles {
    display: flex;
    gap: 3px;
  }
  .tgl {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
  }
  .tgl.mono {
    font-family: var(--font-mono);
  }
  .tgl:hover {
    background: var(--menu-hover);
  }
  .tgl.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .close {
    font-size: 12px;
  }
</style>
