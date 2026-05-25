<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount, onDestroy } from 'svelte'
  import { hasAnySave } from '$storage/db'

  let hasSave = $state(false)
  let debug = $state(false)

  function onKeydown(e: KeyboardEvent) {
    // Toggle debug con tasto "D" (no modifiers, no focus su input)
    if (e.key === 'd' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      debug = !debug
    }
  }

  onMount(async () => {
    try { hasSave = await hasAnySave() } catch { hasSave = false }
    // Permettere anche ?debug nell'URL come fallback
    if (window.location.href.includes('debug')) debug = true
    window.addEventListener('keydown', onKeydown)
  })

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
  })

  function startNew() { push('/new-career') }
  function openSettings() { push('/settings') }
  function continueGame() {
    if (!hasSave) return
    push('/dashboard') // TODO Fase 1
  }
</script>

<!--
  La landing usa il mockup ufficiale come hero a tutto schermo.
  Sopra, hitbox HTML trasparenti gestiscono i click sui bottoni
  presenti nell'immagine. Le coordinate sono in % della frame
  (che ha la stessa aspect-ratio del PNG: 1536/1024 = 1.5).
  Premi "D" per attivare la modalità debug e visualizzare le hitbox.
-->
<div class="hero-container">
  <div class="hero-frame" class:debug>
    <img
      src="/assets/hero-mockup.png"
      alt="Football Manager"
      class="hero-image"
      draggable="false"
      fetchpriority="high"
    />

    <!-- ===== Nav icons in alto a destra ===== -->
    <button
      class="hitbox-round"
      data-tag="1·GIFT"
      style="--cx: 86%; --cy: 5.4%;"
      aria-label="Novità e regali"
      title="Novità (presto disponibile)"
    ></button>
    <button
      class="hitbox-round"
      data-tag="2·CLOUD"
      style="--cx: 91%; --cy: 5.4%;"
      aria-label="Sincronizzazione cloud"
      title="Cloud sync (presto disponibile)"
    ></button>
    <button
      class="hitbox-round"
      data-tag="3·SETTINGS"
      style="--cx: 96%; --cy: 5.4%;"
      onclick={openSettings}
      aria-label="Impostazioni"
      title="Impostazioni"
    ></button>

    <!-- ===== Modifica club (card MY CLUB a destra) ===== -->
    <button
      class="hitbox"
      data-tag="4·MODIFICA CLUB"
      style="--x: 86.5%; --y: 15.3%; --w: 11%; --h: 4.2%;"
      disabled
      aria-label="Modifica club (disponibile dopo aver creato una carriera)"
      title="Disponibile dopo aver creato una carriera"
    ></button>

    <!-- ===== Bottoni azione principali ===== -->
    <!-- Coordinate calibrate da screenshot debug 2026-05-25 -->
    <button
      class="hitbox"
      data-tag="5·NUOVA CARRIERA"
      style="--x: 23%; --y: 60.5%; --w: 21.5%; --h: 8.5%;"
      onclick={startNew}
      aria-label="Nuova Carriera"
      title="Inizia una nuova carriera"
    ></button>

    <button
      class="hitbox"
      data-tag="6·NESSUN SALV."
      style="--x: 45%; --y: 60.5%; --w: 21.5%; --h: 8.5%;"
      onclick={continueGame}
      disabled={!hasSave}
      aria-label={hasSave ? 'Continua partita salvata' : 'Nessun salvataggio disponibile'}
      title={hasSave ? 'Riprendi la tua partita' : 'Nessun salvataggio trovato'}
    ></button>

    {#if debug}
      <div class="debug-banner">
        🐞 DEBUG MODE — premi <kbd>D</kbd> per disattivare
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

  /* === Hitbox rettangolare (bottoni) === */
  .hitbox {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: var(--w);
    height: var(--h);
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    border-radius: 14px;
    transition: background-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
    z-index: 2;
  }
  .hitbox:hover:not(:disabled) {
    background: rgba(252, 211, 77, 0.10);
    box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.35), 0 0 24px rgba(245, 158, 11, 0.25);
  }
  .hitbox:active:not(:disabled) { transform: translateY(1px); }
  .hitbox:disabled { cursor: not-allowed; }

  /* === Hitbox circolare (nav icons) === */
  .hitbox-round {
    position: absolute;
    left: var(--cx);
    top: var(--cy);
    transform: translate(-50%, -50%);
    width: 4.2%;
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
  .hero-frame.debug .hitbox-round::after {
    font-size: 9px;
  }

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

  /* Focus accessibility (Tab keyboard) */
  .hitbox:focus-visible,
  .hitbox-round:focus-visible {
    outline: 2px solid #fcd34d;
    outline-offset: 2px;
  }
</style>
