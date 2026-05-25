<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import { hasAnySave } from '$storage/db'

  let hasSave = $state(false)

  onMount(async () => {
    try { hasSave = await hasAnySave() } catch { hasSave = false }
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
  Le hitbox restano allineate al pixel a qualsiasi dimensione di viewport
  grazie al container con aspect-ratio fisso e letterboxing nero.
-->
<div class="hero-container">
  <div class="hero-frame">
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
      style="--cx: 86%; --cy: 5.4%;"
      aria-label="Novità e regali"
      title="Novità (presto disponibile)"
    ></button>
    <button
      class="hitbox-round"
      style="--cx: 91%; --cy: 5.4%;"
      aria-label="Sincronizzazione cloud"
      title="Cloud sync (presto disponibile)"
    ></button>
    <button
      class="hitbox-round"
      style="--cx: 96%; --cy: 5.4%;"
      onclick={openSettings}
      aria-label="Impostazioni"
      title="Impostazioni"
    ></button>

    <!-- ===== Modifica club (card MY CLUB a destra) ===== -->
    <!-- Disabilitato finché non c'è una carriera reale, per ora puramente decorativo -->
    <button
      class="hitbox"
      style="--x: 86.5%; --y: 15.3%; --w: 11%; --h: 4.2%;"
      disabled
      aria-label="Modifica club (disponibile dopo aver creato una carriera)"
      title="Disponibile dopo aver creato una carriera"
    ></button>

    <!-- ===== Bottoni azione principali ===== -->
    <button
      class="hitbox"
      style="--x: 24.3%; --y: 58.7%; --w: 19.2%; --h: 6.5%;"
      onclick={startNew}
      aria-label="Nuova Carriera"
      title="Inizia una nuova carriera"
    ></button>

    <button
      class="hitbox"
      style="--x: 45.5%; --y: 58.7%; --w: 19.2%; --h: 6.5%;"
      onclick={continueGame}
      disabled={!hasSave}
      aria-label={hasSave ? 'Continua partita salvata' : 'Nessun salvataggio disponibile'}
      title={hasSave ? 'Riprendi la tua partita' : 'Nessun salvataggio trovato'}
    ></button>
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
    /* Mantiene la proporzione del PNG (1536x1024 = 3:2),
       letterboxing automatico se il viewport ha aspect ratio diverso */
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
    /* Sopra l'img: */
    z-index: 2;
  }
  .hitbox:hover:not(:disabled) {
    background: rgba(252, 211, 77, 0.10);
    box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.35), 0 0 24px rgba(245, 158, 11, 0.25);
  }
  .hitbox:active:not(:disabled) {
    transform: translateY(1px);
  }
  .hitbox:disabled {
    cursor: not-allowed;
  }

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

  /* Focus accessibility (Tab keyboard) */
  .hitbox:focus-visible,
  .hitbox-round:focus-visible {
    outline: 2px solid #fcd34d;
    outline-offset: 2px;
  }
</style>
