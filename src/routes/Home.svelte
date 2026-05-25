<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount, onDestroy } from 'svelte'
  import { hasAnySave } from '$storage/db'

  type RectHitbox = {
    id: string
    tag: string
    kind: 'rect'
    x: number
    y: number
    w: number
    h: number
    onclick?: () => void
    disabled?: boolean
    aria: string
    title: string
  }
  type RoundHitbox = {
    id: string
    tag: string
    kind: 'round'
    cx: number
    cy: number
    size: number
    onclick?: () => void
    aria: string
    title: string
  }
  type Hitbox = RectHitbox | RoundHitbox

  let hasSave = $state(false)
  let debug = $state(false)
  let editor = $state(false)
  let selectedId = $state<string | null>(null)
  let frameEl: HTMLDivElement | undefined = $state()

  function startNew() { push('/new-career') }
  function openSettings() { push('/settings') }
  function continueGame() {
    if (!hasSave) return
    push('/dashboard')
  }

  // ====== Hitbox definitions (valori di default) ======
  const DEFAULT_HITBOXES: Hitbox[] = [
    { id: 'gift', tag: '1·GIFT', kind: 'round', cx: 86, cy: 5.4, size: 4.2,
      aria: 'Novità e regali', title: 'Novità (presto disponibile)' },
    { id: 'cloud', tag: '2·CLOUD', kind: 'round', cx: 91, cy: 5.4, size: 4.2,
      aria: 'Sincronizzazione cloud', title: 'Cloud sync (presto disponibile)' },
    { id: 'settings', tag: '3·SETTINGS', kind: 'round', cx: 96, cy: 5.4, size: 4.2,
      onclick: openSettings, aria: 'Impostazioni', title: 'Impostazioni' },
    { id: 'modifica', tag: '4·MODIFICA CLUB', kind: 'rect', x: 86.5, y: 15.3, w: 11, h: 4.2,
      disabled: true, aria: 'Modifica club (dopo aver creato una carriera)', title: 'Disponibile dopo aver creato una carriera' },
    { id: 'nuova', tag: '5·NUOVA CARRIERA', kind: 'rect', x: 23, y: 60.5, w: 21.5, h: 8.5,
      onclick: startNew, aria: 'Nuova Carriera', title: 'Inizia una nuova carriera' },
    { id: 'nessun', tag: '6·NESSUN SALV.', kind: 'rect', x: 45, y: 60.5, w: 21.5, h: 8.5,
      onclick: continueGame, aria: 'Nessun salvataggio', title: 'Nessun salvataggio trovato' }
  ]

  let hitboxes = $state<Hitbox[]>(structuredClone(DEFAULT_HITBOXES))

  const LS_KEY = 'fm.hitbox-editor.v1'

  function saveToLocal() {
    try {
      const slim = hitboxes.map(h => h.kind === 'rect'
        ? { id: h.id, kind: 'rect', x: h.x, y: h.y, w: h.w, h: h.h }
        : { id: h.id, kind: 'round', cx: h.cx, cy: h.cy, size: h.size })
      localStorage.setItem(LS_KEY, JSON.stringify(slim))
    } catch {}
  }

  function loadFromLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const arr = JSON.parse(raw) as Array<{ id: string } & Record<string, number | string>>
      for (const saved of arr) {
        const live = hitboxes.find(h => h.id === saved.id)
        if (!live) continue
        if (live.kind === 'rect' && saved.kind === 'rect') {
          live.x = +saved.x; live.y = +saved.y; live.w = +saved.w; live.h = +saved.h
        } else if (live.kind === 'round' && saved.kind === 'round') {
          live.cx = +saved.cx; live.cy = +saved.cy; live.size = +saved.size
        }
      }
    } catch {}
  }

  function resetHitboxes() {
    if (!confirm('Ripristinare le coordinate originali? Perderai le modifiche locali.')) return
    hitboxes = structuredClone(DEFAULT_HITBOXES)
    saveToLocal()
  }

  async function copyConfig() {
    const lines: string[] = []
    lines.push('// Hitbox calibrate ' + new Date().toISOString())
    for (const h of hitboxes) {
      if (h.kind === 'round') {
        lines.push(`${h.tag}  →  --cx: ${fmt(h.cx)}%; --cy: ${fmt(h.cy)}%; size: ${fmt(h.size)}%`)
      } else {
        lines.push(`${h.tag}  →  --x: ${fmt(h.x)}%; --y: ${fmt(h.y)}%; --w: ${fmt(h.w)}%; --h: ${fmt(h.h)}%`)
      }
    }
    const txt = lines.join('\n')
    try {
      await navigator.clipboard.writeText(txt)
      copyFeedback = 'Copiato negli appunti ✓ — incollalo nella chat'
    } catch {
      copyFeedback = 'Copia manuale qui sotto ↓'
    }
    setTimeout(() => copyFeedback = '', 4000)
  }

  let copyFeedback = $state('')

  function fmt(n: number) {
    return (Math.round(n * 10) / 10).toFixed(1)
  }
  function round1(n: number) { return Math.round(n * 10) / 10 }

  // ====== Drag & resize ======
  type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'
  type DragState = {
    id: string
    mode: DragMode
    startCX: number  // client X
    startCY: number
    snap: { x: number; y: number; w: number; h: number; cx: number; cy: number; size: number }
  }
  let drag: DragState | null = null

  function startDrag(e: PointerEvent, hb: Hitbox, mode: DragMode) {
    if (!editor) return
    e.preventDefault()
    e.stopPropagation()
    selectedId = hb.id
    const snap = hb.kind === 'rect'
      ? { x: hb.x, y: hb.y, w: hb.w, h: hb.h, cx: 0, cy: 0, size: 0 }
      : { x: 0, y: 0, w: 0, h: 0, cx: hb.cx, cy: hb.cy, size: hb.size }
    drag = { id: hb.id, mode, startCX: e.clientX, startCY: e.clientY, snap }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || !frameEl) return
    const rect = frameEl.getBoundingClientRect()
    const dxPct = ((e.clientX - drag.startCX) / rect.width) * 100
    const dyPct = ((e.clientY - drag.startCY) / rect.height) * 100
    const hb = hitboxes.find(h => h.id === drag!.id)
    if (!hb) return

    if (hb.kind === 'round') {
      // round hitbox: solo move (resize via tasti)
      hb.cx = clamp(round1(drag.snap.cx + dxPct), 0, 100)
      hb.cy = clamp(round1(drag.snap.cy + dyPct), 0, 100)
    } else {
      const s = drag.snap
      switch (drag.mode) {
        case 'move':
          hb.x = clamp(round1(s.x + dxPct), 0, 100 - hb.w)
          hb.y = clamp(round1(s.y + dyPct), 0, 100 - hb.h)
          break
        case 'se':
          hb.w = Math.max(1, round1(s.w + dxPct))
          hb.h = Math.max(1, round1(s.h + dyPct))
          break
        case 'nw':
          hb.x = round1(s.x + dxPct)
          hb.y = round1(s.y + dyPct)
          hb.w = Math.max(1, round1(s.w - dxPct))
          hb.h = Math.max(1, round1(s.h - dyPct))
          break
        case 'ne':
          hb.y = round1(s.y + dyPct)
          hb.w = Math.max(1, round1(s.w + dxPct))
          hb.h = Math.max(1, round1(s.h - dyPct))
          break
        case 'sw':
          hb.x = round1(s.x + dxPct)
          hb.w = Math.max(1, round1(s.w - dxPct))
          hb.h = Math.max(1, round1(s.h + dyPct))
          break
      }
    }
    saveToLocal()
  }

  function onPointerUp(e: PointerEvent) {
    if (drag) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
    }
    drag = null
  }

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n))
  }

  // ====== Keyboard ======
  function onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea') return
    const noMods = !e.ctrlKey && !e.altKey && !e.metaKey

    // Toggle debug (D)
    if (e.key === 'd' && noMods && !e.shiftKey) { debug = !debug; return }
    // Toggle editor (E)
    if (e.key === 'e' && noMods && !e.shiftKey) {
      editor = !editor
      if (editor) debug = true   // editor implica debug visibile
      return
    }

    // Arrow nudge dell'hitbox selezionata
    if (editor && selectedId && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 0.5 : 0.1
      const hb = hitboxes.find(h => h.id === selectedId)
      if (!hb) return
      e.preventDefault()
      if (hb.kind === 'round') {
        if (e.key === 'ArrowLeft')  hb.cx = round1(hb.cx - step)
        if (e.key === 'ArrowRight') hb.cx = round1(hb.cx + step)
        if (e.key === 'ArrowUp')    hb.cy = round1(hb.cy - step)
        if (e.key === 'ArrowDown')  hb.cy = round1(hb.cy + step)
      } else {
        if (e.key === 'ArrowLeft')  hb.x = round1(hb.x - step)
        if (e.key === 'ArrowRight') hb.x = round1(hb.x + step)
        if (e.key === 'ArrowUp')    hb.y = round1(hb.y - step)
        if (e.key === 'ArrowDown')  hb.y = round1(hb.y + step)
      }
      saveToLocal()
    }
  }

  onMount(async () => {
    try { hasSave = await hasAnySave() } catch { hasSave = false }
    const url = window.location.href
    if (url.includes('debug')) debug = true
    if (url.includes('edit'))  { editor = true; debug = true }
    loadFromLocal()
    window.addEventListener('keydown', onKeydown)
  })

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
  })

  function clickHitbox(hb: Hitbox) {
    if (editor) { selectedId = hb.id; return }
    if (hb.kind === 'rect' && hb.disabled) return
    hb.onclick?.()
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

<div class="hero-container">
  <div class="hero-frame" class:debug class:editor bind:this={frameEl}>
    <img
      src="/assets/hero-mockup.png"
      alt="Football Manager"
      class="hero-image"
      draggable="false"
      fetchpriority="high"
    />

    {#each hitboxes as hb (hb.id)}
      {#if hb.kind === 'round'}
        <button
          class="hitbox-round"
          class:selected={selectedId === hb.id}
          data-tag={hb.tag}
          style="--cx: {hb.cx}%; --cy: {hb.cy}%; --size: {hb.size}%;"
          aria-label={hb.aria}
          title={hb.title}
          onpointerdown={(e) => editor ? startDrag(e, hb, 'move') : null}
          onclick={() => clickHitbox(hb)}
        ></button>
      {:else}
        <div
          class="hitbox-wrap"
          class:selected={selectedId === hb.id}
          style="--x: {hb.x}%; --y: {hb.y}%; --w: {hb.w}%; --h: {hb.h}%;"
        >
          <button
            class="hitbox"
            data-tag={hb.tag}
            disabled={hb.disabled && !editor}
            aria-label={hb.aria}
            title={hb.title}
            onpointerdown={(e) => editor ? startDrag(e, hb, 'move') : null}
            onclick={() => clickHitbox(hb)}
          ></button>
          {#if editor}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="handle nw" onpointerdown={(e) => startDrag(e, hb, 'nw')}></span>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="handle ne" onpointerdown={(e) => startDrag(e, hb, 'ne')}></span>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="handle sw" onpointerdown={(e) => startDrag(e, hb, 'sw')}></span>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="handle se" onpointerdown={(e) => startDrag(e, hb, 'se')}></span>
          {/if}
        </div>
      {/if}
    {/each}

    {#if debug && !editor}
      <div class="debug-banner">
        🐞 DEBUG MODE — premi <kbd>D</kbd> per uscire · <kbd>E</kbd> per editor
      </div>
    {/if}

    {#if editor}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="editor-panel" onpointerdown={(e) => e.stopPropagation()}>
        <div class="editor-head">
          <strong>🎯 Editor hitbox</strong>
          <span class="hint">Trascina le hitbox · maniglie agli angoli per ridimensionare · frecce per nudge ±0.1% (+Shift ±0.5%)</span>
          <button class="ed-btn primary" onclick={copyConfig}>📋 Copia coordinate</button>
          <button class="ed-btn" onclick={resetHitboxes}>↺ Reset</button>
          <button class="ed-btn ghost" onclick={() => { editor = false }}>✕ Esci editor</button>
        </div>
        {#if copyFeedback}
          <div class="copy-feedback">{copyFeedback}</div>
        {/if}
        <table class="coords">
          <thead>
            <tr><th>Hitbox</th><th>X / cX</th><th>Y / cY</th><th>W / size</th><th>H</th></tr>
          </thead>
          <tbody>
            {#each hitboxes as hb (hb.id)}
              <tr class:row-sel={selectedId === hb.id} onclick={() => selectedId = hb.id}>
                <td class="t">{hb.tag}</td>
                {#if hb.kind === 'round'}
                  <td>{fmt(hb.cx)}%</td>
                  <td>{fmt(hb.cy)}%</td>
                  <td>{fmt(hb.size)}%</td>
                  <td>—</td>
                {:else}
                  <td>{fmt(hb.x)}%</td>
                  <td>{fmt(hb.y)}%</td>
                  <td>{fmt(hb.w)}%</td>
                  <td>{fmt(hb.h)}%</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .hero-container {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #000;
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  .hero-frame {
    position: relative;
    aspect-ratio: 1536 / 1024;
    width: min(100vw, calc(100vh * 1.5));
    max-height: 100vh;
  }

  .hero-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    user-select: none;
    pointer-events: none;
    -webkit-user-drag: none;
  }

  /* === Rect hitbox === */
  .hitbox-wrap {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: var(--w);
    height: var(--h);
    z-index: 2;
  }
  .hitbox {
    position: absolute;
    inset: 0;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    border-radius: 14px;
    transition: background-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  }
  .hitbox:hover:not(:disabled) {
    background: rgba(252, 211, 77, 0.10);
    box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.35), 0 0 24px rgba(245, 158, 11, 0.25);
  }
  .hitbox:active:not(:disabled) { transform: translateY(1px); }
  .hitbox:disabled { cursor: not-allowed; }

  /* === Round hitbox === */
  .hitbox-round {
    position: absolute;
    left: var(--cx);
    top: var(--cy);
    transform: translate(-50%, -50%);
    width: var(--size);
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    transition: background-color 0.18s ease, box-shadow 0.18s ease;
    z-index: 2;
  }
  .hitbox-round:hover {
    background: rgba(252, 211, 77, 0.15);
    box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.5), 0 0 20px rgba(245, 158, 11, 0.3);
  }

  /* === DEBUG MODE === */
  .hero-frame.debug .hitbox {
    background: rgba(236, 72, 153, 0.45);
    box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.95), 0 0 30px rgba(236, 72, 153, 0.5);
  }
  .hero-frame.debug .hitbox-round {
    background: rgba(6, 182, 212, 0.55);
    box-shadow: 0 0 0 2px rgba(6, 182, 212, 1), 0 0 25px rgba(6, 182, 212, 0.6);
  }
  .hero-frame.debug .hitbox::after,
  .hero-frame.debug .hitbox-round::after {
    content: attr(data-tag);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #fff;
    font: 700 11px/1 ui-monospace, "JetBrains Mono", monospace;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
    white-space: nowrap;
    pointer-events: none;
  }
  .hero-frame.debug .hitbox-round::after { font-size: 9px; }

  /* === EDITOR MODE === */
  .hero-frame.editor .hitbox-wrap { cursor: move; }
  .hero-frame.editor .hitbox { cursor: move; }
  .hero-frame.editor .hitbox-round { cursor: move; }
  .hero-frame.editor .hitbox-wrap.selected .hitbox,
  .hero-frame.editor .hitbox-round.selected {
    outline: 2px dashed #fcd34d;
    outline-offset: 3px;
  }

  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    background: #fcd34d;
    border: 2px solid #1a1410;
    border-radius: 3px;
    z-index: 5;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  }
  .handle.nw { top: -7px;    left: -7px;   cursor: nwse-resize; }
  .handle.ne { top: -7px;    right: -7px;  cursor: nesw-resize; }
  .handle.sw { bottom: -7px; left: -7px;   cursor: nesw-resize; }
  .handle.se { bottom: -7px; right: -7px;  cursor: nwse-resize; }

  .debug-banner {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    border: 1px solid rgba(236, 72, 153, 0.8);
    color: #fce7f3;
    padding: 8px 16px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    z-index: 10;
    box-shadow: 0 4px 20px rgba(236, 72, 153, 0.3);
  }
  .debug-banner kbd {
    background: rgba(236, 72, 153, 0.25);
    border: 1px solid rgba(236, 72, 153, 0.6);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: inherit;
    font-size: 11px;
    margin: 0 2px;
  }

  /* === Editor panel === */
  .editor-panel {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: min(720px, 95%);
    background: rgba(10, 8, 6, 0.96);
    border: 1px solid rgba(252, 211, 77, 0.6);
    border-radius: 12px;
    padding: 12px 16px;
    color: #fef3c7;
    font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
    z-index: 20;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.8);
  }
  .editor-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .editor-head strong { color: #fcd34d; font-size: 13px; }
  .editor-head .hint { flex: 1; min-width: 200px; color: #d4cfc1; font-size: 11px; }

  .ed-btn {
    background: rgba(255, 255, 255, 0.06);
    color: #fef3c7;
    border: 1px solid rgba(252, 211, 77, 0.4);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .ed-btn:hover { background: rgba(252, 211, 77, 0.15); }
  .ed-btn.primary {
    background: linear-gradient(180deg, #fcd34d, #b45309);
    color: #1a1410;
    border-color: #fcd34d;
  }
  .ed-btn.primary:hover { filter: brightness(1.1); }
  .ed-btn.ghost { opacity: 0.7; }

  .copy-feedback {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.5);
    color: #bbf7d0;
    padding: 6px 10px;
    border-radius: 6px;
    margin-bottom: 8px;
    font-weight: 600;
  }

  .coords {
    width: 100%;
    border-collapse: collapse;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 11px;
  }
  .coords th {
    text-align: left;
    color: #fcd34d;
    border-bottom: 1px solid rgba(252, 211, 77, 0.3);
    padding: 4px 8px;
    font-weight: 600;
  }
  .coords td {
    padding: 3px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    color: #fef3c7;
  }
  .coords td.t { color: #fde68a; font-weight: 600; }
  .coords tr { cursor: pointer; }
  .coords tr:hover td { background: rgba(252, 211, 77, 0.08); }
  .coords tr.row-sel td {
    background: rgba(252, 211, 77, 0.18);
    color: #fff;
  }

  /* Focus accessibility */
  .hitbox:focus-visible,
  .hitbox-round:focus-visible {
    outline: 2px solid #fcd34d;
    outline-offset: 2px;
  }
</style>
