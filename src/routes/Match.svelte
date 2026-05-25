<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount, onDestroy, tick } from 'svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { advanceMatchday } from '$engine/career/career'
  import type { Fixture, MatchResult } from '$engine/competition/types'
  import type { MatchEvent } from '$engine/match/types'

  const store = careerStore()
  let career = $derived(store.career)

  type OverlayKind = 'goal' | 'yellow' | 'red' | 'half_time' | 'full_time' | 'kickoff'
  interface OverlayPayload {
    kind: OverlayKind
    side?: 'home' | 'away' | null
    playerName?: string
    teamName?: string
  }

  let myFixture = $state<Fixture | null>(null)
  let result = $state<MatchResult | null>(null)
  let shown = $state<MatchEvent[]>([])
  let currentIdx = $state(0)
  let homeScore = $state(0)
  let awayScore = $state(0)
  let minute = $state(0)
  let playing = $state(true)
  let finished = $state(false)
  let speed = $state(1)  // 0.5, 1, 2, 4
  let goalFlash = $state(false)
  let overlay = $state<OverlayPayload | null>(null)
  let errorMsg = $state<string | null>(null)
  let streamEl: HTMLDivElement | undefined = $state()
  let timer: ReturnType<typeof setTimeout> | null = null
  let overlayTimer: ReturnType<typeof setTimeout> | null = null

  function eventDelay(): number {
    // Default 5000ms/evento (cinematografico); 0.5x = ultra-lento, 2x/4x/8x = veloce
    const baseMs = 5000
    return Math.max(80, baseMs / speed)
  }

  // Durata overlay drammatici (NEUTRA rispetto a speed: la "pausa narrativa" è fissa)
  const OVERLAY_MS: Record<OverlayKind, number> = {
    goal: 4200,
    yellow: 2200,
    red: 3000,
    half_time: 2800,
    full_time: 3200,
    kickoff: 1800,
  }

  // Pre-evento "suspense": qualcosa sta per accadere
  type SuspenseKind = 'goal' | 'yellow' | 'red'
  let suspense = $state<SuspenseKind | null>(null)
  let suspenseTimer: ReturnType<typeof setTimeout> | null = null

  const SUSPENSE_MS: Record<SuspenseKind, number> = {
    goal: 2000,
    yellow: 1400,
    red: 1900,
  }

  function suspenseKindOf(ev: MatchEvent): SuspenseKind | null {
    if (ev.kind === 'goal') return 'goal'
    if (ev.kind === 'yellow_card') return 'yellow'
    if (ev.kind === 'red_card') return 'red'
    return null
  }

  function nameOf(playerId?: string): string {
    if (!playerId || !career) return ''
    const p = career.players[playerId]
    if (!p) return ''
    return `${p.firstName} ${p.lastName}`
  }
  function teamOfSide(side: 'home' | 'away' | null | undefined): string {
    if (!myFixture || !side) return ''
    return teamName(side === 'home' ? myFixture.homeId : myFixture.awayId)
  }

  onMount(async () => {
    if (!career) { push('/'); return }
    // Preload asset overlay per evitare lag al primo trigger
    for (const src of ['/assets/match/Gol.png', '/assets/match/Cartellino_giallo.png', '/assets/match/Cartellino_rosso.png']) {
      const img = new Image()
      img.src = src
    }
    try {
      // Avanza la giornata (simula tutte le partite, trova la mia)
      const adv = advanceMatchday(career)
      myFixture = adv.myFixture
      if (!myFixture || !myFixture.result) {
        errorMsg = 'Nessuna partita per la tua squadra in questa giornata.'
        finished = true
        await persistActiveCareer()
        return
      }
      result = myFixture.result
      // Persistenza fuori dal critical path
      persistActiveCareer()
      // Avvia replay
      tickReplay()
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
    }
  })

  onDestroy(() => {
    if (timer) { clearTimeout(timer); timer = null }
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null }
    if (suspenseTimer) { clearTimeout(suspenseTimer); suspenseTimer = null }
  })

  function maybeOpenOverlay(ev: MatchEvent): boolean {
    let payload: OverlayPayload | null = null
    if (ev.kind === 'goal') {
      payload = { kind: 'goal', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (ev.kind === 'yellow_card') {
      payload = { kind: 'yellow', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (ev.kind === 'red_card') {
      payload = { kind: 'red', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (ev.kind === 'half_time') {
      payload = { kind: 'half_time' }
    } else if (ev.kind === 'full_time') {
      payload = { kind: 'full_time' }
    } else if (ev.kind === 'kickoff' && minute === 0) {
      payload = { kind: 'kickoff' }
    }
    if (!payload) return false
    overlay = payload
    const ms = OVERLAY_MS[payload.kind]
    overlayTimer = setTimeout(() => {
      overlay = null
      overlayTimer = null
      if (playing && !finished) tickReplay()
    }, ms)
    return true
  }

  function tickReplay() {
    if (!result || !playing) return
    if (overlay || suspense) return  // blocchi attivi: aspetta che si liberino
    if (currentIdx >= result.events.length) {
      finished = true
      playing = false
      return
    }
    const ev = result.events[currentIdx]
    // Se è un evento saliente, prima fase suspense
    const sKind = suspenseKindOf(ev)
    if (sKind) {
      suspense = sKind
      suspenseTimer = setTimeout(() => {
        suspense = null
        suspenseTimer = null
        if (playing && !finished) consumeEvent(ev)
      }, SUSPENSE_MS[sKind])
      return
    }
    consumeEvent(ev)
  }

  function consumeEvent(ev: MatchEvent) {
    shown = [...shown, ev]
    currentIdx++
    minute = ev.minute
    if (ev.kind === 'goal') {
      if (ev.side === 'home') homeScore++
      if (ev.side === 'away') awayScore++
      goalFlash = true
      setTimeout(() => goalFlash = false, 800)
    }
    autoscroll()
    if (maybeOpenOverlay(ev)) return
    timer = setTimeout(tickReplay, eventDelay())
  }

  async function autoscroll() {
    await tick()
    if (streamEl) streamEl.scrollTop = streamEl.scrollHeight
  }

  function togglePause() {
    if (finished) return
    playing = !playing
    if (playing) tickReplay()
    else if (timer) { clearTimeout(timer); timer = null }
  }

  function skipToEnd() {
    if (!result) return
    if (timer) { clearTimeout(timer); timer = null }
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null }
    if (suspenseTimer) { clearTimeout(suspenseTimer); suspenseTimer = null }
    overlay = null
    suspense = null
    // Applica tutti gli eventi rimanenti
    for (let i = currentIdx; i < result.events.length; i++) {
      const ev = result.events[i]
      if (ev.kind === 'goal') {
        if (ev.side === 'home') homeScore++
        if (ev.side === 'away') awayScore++
      }
    }
    shown = [...result.events]
    currentIdx = result.events.length
    minute = result.events[result.events.length - 1]?.minute ?? 90
    finished = true
    playing = false
    autoscroll()
  }

  function setSpeed(s: number) {
    speed = s
    if (playing && !finished) {
      if (timer) { clearTimeout(timer); timer = null }
      tickReplay()
    }
  }

  function backToDashboard() {
    push('/dashboard')
  }

  function teamName(id: string): string { return career?.teams[id]?.name ?? '???' }
  function teamShort(id: string): string { return career?.teams[id]?.shortName ?? '???' }
  function colors(id: string) {
    const t = career?.teams[id]
    return { c1: t?.primaryColor ?? '#444', c2: t?.secondaryColor ?? '#888' }
  }

  function eventClass(ev: MatchEvent): string {
    if (ev.kind === 'goal') return 'ev-goal'
    if (ev.kind === 'yellow_card') return 'ev-yellow'
    if (ev.kind === 'red_card') return 'ev-red'
    if (ev.kind === 'kickoff' || ev.kind === 'half_time' || ev.kind === 'full_time') return 'ev-break'
    if (ev.kind === 'shot_on_target' || ev.kind === 'shot' || ev.kind === 'save') return 'ev-action'
    if (ev.kind === 'substitution') return 'ev-sub'
    return ''
  }
</script>

<div class="page stadium-bg" class:flash={goalFlash}>
  {#if errorMsg}
    <div class="error">
      <p>{errorMsg}</p>
      <button class="btn-gold" onclick={backToDashboard}>Torna alla Dashboard</button>
    </div>
  {:else if !myFixture || !result}
    <div class="loading">
      <div class="spinner"></div>
      <p>Simulazione partite in corso…</p>
    </div>
  {:else}
    <header class="match-head">
      <div class="team-side home" style="--c1: {colors(myFixture.homeId).c1}; --c2: {colors(myFixture.homeId).c2};">
        <div class="crest-big">{teamShort(myFixture.homeId)}</div>
        <div class="team-name">{teamName(myFixture.homeId)}</div>
      </div>

      <div class="score-center">
        <div class="score-big">
          <span class="s-home">{homeScore}</span>
          <span class="dash">–</span>
          <span class="s-away">{awayScore}</span>
        </div>
        <div class="minute">
          <span class="min-num">{minute}'</span>
          {#if !finished}
            <span class="live-dot"></span>
            <span class="live-label">LIVE</span>
          {:else}
            <span class="ft-label">FT</span>
          {/if}
        </div>
      </div>

      <div class="team-side away" style="--c1: {colors(myFixture.awayId).c1}; --c2: {colors(myFixture.awayId).c2};">
        <div class="crest-big">{teamShort(myFixture.awayId)}</div>
        <div class="team-name">{teamName(myFixture.awayId)}</div>
      </div>
    </header>

    {#if suspense}
      <div class="suspense" class:s-red={suspense === 'red'} class:s-goal={suspense === 'goal'}>
        <div class="susp-pulse"></div>
        <div class="susp-text">
          {#if suspense === 'goal'}OCCASIONE…{/if}
          {#if suspense === 'yellow'}FALLO PERICOLOSO…{/if}
          {#if suspense === 'red'}INTERVENTO DURO…{/if}
        </div>
      </div>
    {/if}

    {#if overlay}
      <div class="overlay" class:o-goal={overlay.kind === 'goal'} class:o-card={overlay.kind === 'yellow' || overlay.kind === 'red'} class:o-red={overlay.kind === 'red'} class:o-break={overlay.kind === 'half_time' || overlay.kind === 'full_time' || overlay.kind === 'kickoff'}>
        {#if overlay.kind === 'goal'}
          <img class="ov-goal-img" src="/assets/match/Gol.png" alt="Gol" />
          <div class="ov-goal-text">GOOOOOL!</div>
          {#if overlay.playerName}
            <div class="ov-scorer">{overlay.playerName}</div>
          {/if}
          {#if overlay.teamName}
            <div class="ov-team">{overlay.teamName}</div>
          {/if}
          <div class="ov-score">{homeScore} – {awayScore}</div>
        {:else if overlay.kind === 'yellow'}
          <img class="ov-ref-img" src="/assets/match/Cartellino_giallo.png" alt="Cartellino giallo" />
          <div class="ov-card-text">AMMONIZIONE</div>
          {#if overlay.playerName}<div class="ov-player">{overlay.playerName}</div>{/if}
        {:else if overlay.kind === 'red'}
          <img class="ov-ref-img" src="/assets/match/Cartellino_rosso.png" alt="Cartellino rosso" />
          <div class="ov-card-text big">ESPULSIONE!</div>
          {#if overlay.playerName}<div class="ov-player">{overlay.playerName}</div>{/if}
        {:else if overlay.kind === 'kickoff'}
          <div class="ov-break-text">FISCHIO D'INIZIO</div>
          <div class="ov-break-sub">{teamName(myFixture.homeId)} · {teamName(myFixture.awayId)}</div>
        {:else if overlay.kind === 'half_time'}
          <div class="ov-break-text">FINE PRIMO TEMPO</div>
          <div class="ov-break-sub">{homeScore} – {awayScore}</div>
        {:else if overlay.kind === 'full_time'}
          <div class="ov-break-text">FINE PARTITA</div>
          <div class="ov-break-sub">{homeScore} – {awayScore}</div>
        {/if}
      </div>
    {/if}

    <main class="stream-wrap">
      <div class="stream card-gold" bind:this={streamEl}>
        {#each shown as ev, i (i)}
          <div class="ev {eventClass(ev)}" class:home={ev.side === 'home'} class:away={ev.side === 'away'}>
            <span class="ev-min">{ev.minute}'</span>
            <span class="ev-text">{ev.commentary ?? ''}</span>
          </div>
        {/each}
      </div>

      <aside class="card-gold side-stats">
        <h3 class="side-h">Statistiche</h3>
        {#if result.stats}
          <div class="stat-row">
            <span class="sv">{result.stats.home.possession}%</span>
            <span class="sl">Possesso</span>
            <span class="sv">{result.stats.away.possession}%</span>
          </div>
          <div class="stat-row">
            <span class="sv">{result.stats.home.shots}</span>
            <span class="sl">Tiri</span>
            <span class="sv">{result.stats.away.shots}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{result.stats.home.shotsOnTarget}</span>
            <span class="sl">in porta</span>
            <span class="sv">{result.stats.away.shotsOnTarget}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{result.stats.home.corners}</span>
            <span class="sl">Corner</span>
            <span class="sv">{result.stats.away.corners}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{result.stats.home.fouls}</span>
            <span class="sl">Falli</span>
            <span class="sv">{result.stats.away.fouls}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{result.stats.home.yellowCards}</span>
            <span class="sl">🟨</span>
            <span class="sv">{result.stats.away.yellowCards}</span>
          </div>
        {/if}
      </aside>
    </main>

    <footer class="controls">
      {#if !finished}
        <button class="ctrl" onclick={togglePause}>{playing ? '⏸ Pausa' : '▶ Riprendi'}</button>
        <div class="speed">
          <span class="speed-l">Velocità</span>
          {#each [0.5, 1, 2, 4, 8] as s}
            <button class="speed-btn" class:active={speed === s} onclick={() => setSpeed(s)}>{s}x</button>
          {/each}
        </div>
        <button class="ctrl skip" onclick={skipToEnd}>⏭ Salta al risultato</button>
      {:else}
        <button class="btn-gold" onclick={backToDashboard}>✓ Torna alla Dashboard</button>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .page {
    min-height: 100vh;
    width: 100vw;
    color: #fef3c7;
    display: flex;
    flex-direction: column;
    transition: background 0.3s;
  }
  .page.flash::after {
    content: '';
    position: fixed; inset: 0;
    background: radial-gradient(circle at center, rgba(252, 211, 77, 0.25), transparent 70%);
    pointer-events: none;
    animation: goalflash 0.8s ease-out;
  }
  @keyframes goalflash {
    0% { opacity: 0; }
    20% { opacity: 1; }
    100% { opacity: 0; }
  }

  .match-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 20px;
    align-items: center;
    padding: 24px clamp(16px, 4vw, 56px);
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
  }
  .team-side {
    display: flex; align-items: center; gap: 14px;
  }
  .team-side.away { flex-direction: row-reverse; }
  .crest-big {
    width: 64px; height: 64px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }
  .team-name {
    font-weight: 800; font-size: 18px;
    max-width: 240px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .score-center {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    min-width: 200px;
  }
  .score-big {
    display: flex; align-items: center; gap: 16px;
    font-size: 56px;
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .s-home, .s-away {
    background: linear-gradient(180deg, #fef3c7 0%, #fcd34d 50%, #b45309 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    filter: drop-shadow(0 4px 16px rgba(245, 158, 11, 0.5));
  }
  .dash { color: rgba(252, 211, 77, 0.5); font-weight: 400; }
  .minute {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px;
    letter-spacing: 0.15em;
    color: #fcd34d;
    font-weight: 700;
  }
  .min-num { font-size: 16px; font-family: var(--font-mono, monospace); }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #dc2626;
    box-shadow: 0 0 12px #dc2626;
    animation: livepulse 1.2s ease-in-out infinite;
  }
  @keyframes livepulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .live-label { color: #fca5a5; }
  .ft-label {
    color: #1a1410;
    background: linear-gradient(180deg, #fde68a, #fbbf24, #d97706);
    padding: 3px 10px;
    border-radius: 4px;
  }

  .stream-wrap {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 18px;
    padding: 20px clamp(16px, 4vw, 56px);
    overflow: hidden;
    min-height: 0;
  }
  .stream {
    overflow-y: auto;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scroll-behavior: smooth;
  }
  .ev {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.4;
    border-left: 3px solid transparent;
    animation: slideIn 0.25s ease;
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ev-min {
    color: #fcd34d;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    min-width: 36px;
    font-size: 12px;
  }
  .ev-text { color: #d4cfc1; flex: 1; }
  .ev.ev-goal {
    background: rgba(252, 211, 77, 0.15);
    border-left-color: #fcd34d;
  }
  .ev.ev-goal .ev-text {
    color: #fef3c7;
    font-weight: 700;
  }
  .ev.ev-yellow { border-left-color: #fbbf24; }
  .ev.ev-red    { border-left-color: #dc2626; background: rgba(220, 38, 38, 0.08); }
  .ev.ev-break {
    background: rgba(0, 0, 0, 0.4);
    border-left-color: #918778;
    color: #fcd34d;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 12px;
  }
  .ev.ev-break .ev-text { color: #fcd34d; }
  .ev.ev-action { border-left-color: rgba(252, 211, 77, 0.3); }
  .ev.ev-sub { border-left-color: rgba(6, 182, 212, 0.5); }

  .side-stats { padding: 18px 20px; }
  .side-h {
    margin: 0 0 16px;
    color: #fcd34d;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-weight: 700;
  }
  .stat-row {
    display: grid;
    grid-template-columns: 50px 1fr 50px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 13px;
  }
  .stat-row:last-child { border-bottom: 0; }
  .sv {
    text-align: center;
    font-weight: 700;
    color: #fef3c7;
    font-variant-numeric: tabular-nums;
  }
  .sl {
    text-align: center;
    color: #918778;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px clamp(16px, 4vw, 56px);
    background: rgba(0, 0, 0, 0.6);
    border-top: 1px solid rgba(252, 211, 77, 0.15);
    flex-wrap: wrap;
  }
  .ctrl {
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(252, 211, 77, 0.3);
    color: #fef3c7;
    padding: 10px 18px;
    font: 600 13px/1 inherit;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .ctrl:hover { border-color: #fcd34d; background: rgba(252, 211, 77, 0.1); }
  .ctrl.skip { margin-left: auto; }

  .speed {
    display: flex; align-items: center; gap: 6px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(252, 211, 77, 0.2);
    padding: 6px 10px;
    border-radius: 8px;
  }
  .speed-l {
    font-size: 10px;
    color: #fcd34d;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 700;
    margin-right: 4px;
  }
  .speed-btn {
    background: none;
    border: 1px solid transparent;
    color: #c8bfa8;
    padding: 4px 10px;
    font: 600 12px/1 inherit;
    border-radius: 5px;
    cursor: pointer;
  }
  .speed-btn:hover { color: #fef3c7; }
  .speed-btn.active {
    background: linear-gradient(180deg, #fde68a, #fbbf24);
    color: #1a1410;
    border-color: #fcd34d;
  }

  .loading {
    flex: 1;
    display: grid; place-items: center;
    gap: 16px;
    color: #d4cfc1;
    text-align: center;
  }
  .spinner {
    width: 48px; height: 48px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    margin: 0 auto;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error {
    flex: 1;
    display: grid; place-items: center;
    gap: 18px;
    padding: 40px;
  }
  .error p {
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.5);
    color: #fecaca;
    padding: 12px 20px;
    border-radius: 8px;
  }

  /* ========== SUSPENSE PRE-EVENTO ========== */
  .suspense {
    position: fixed;
    bottom: 110px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid rgba(252, 211, 77, 0.55);
    color: #fef3c7;
    padding: 12px 22px;
    border-radius: 999px;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 30px rgba(252, 211, 77, 0.18);
    animation: suspenseIn 0.3s ease-out;
  }
  .suspense.s-red {
    border-color: rgba(220, 38, 38, 0.7);
    color: #fecaca;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 30px rgba(220, 38, 38, 0.35);
  }
  .suspense.s-goal {
    border-color: rgba(252, 211, 77, 0.85);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 40px rgba(245, 158, 11, 0.45);
  }
  @keyframes suspenseIn {
    from { opacity: 0; transform: translate(-50%, 14px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  .susp-pulse {
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #fcd34d;
    box-shadow: 0 0 12px #fcd34d;
    animation: suspPulse 0.7s ease-in-out infinite;
  }
  .suspense.s-red .susp-pulse {
    background: #ef4444;
    box-shadow: 0 0 12px #ef4444;
  }
  @keyframes suspPulse {
    0%, 100% { transform: scale(1); opacity: 0.7; }
    50%      { transform: scale(1.5); opacity: 1; }
  }
  .susp-text { font-family: var(--font-mono, monospace); }

  /* ========== OVERLAY DRAMMATICI ========== */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.88) 30%, rgba(0, 0, 0, 0.98) 100%);
    backdrop-filter: blur(8px);
    color: #fef3c7;
    animation: overlayFadeIn 0.25s ease-out;
  }
  @keyframes overlayFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* --- GOAL --- */
  .overlay.o-goal {
    background:
      radial-gradient(ellipse 80% 60% at 50% 50%, rgba(245, 158, 11, 0.35), transparent 60%),
      radial-gradient(ellipse at center, rgba(0, 0, 0, 0.92) 40%, rgba(0, 0, 0, 0.98) 100%);
  }
  .ov-goal-img {
    width: clamp(240px, 36vw, 420px);
    height: auto;
    filter: drop-shadow(0 20px 60px rgba(245, 158, 11, 0.55));
    animation: goalImg 1.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes goalImg {
    0%   { transform: scale(0.4) translateY(-30px); opacity: 0; }
    50%  { transform: scale(1.12) translateY(0); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }
  .ov-goal-text {
    font-size: clamp(64px, 12vw, 140px);
    font-weight: 900;
    letter-spacing: 0.02em;
    background: linear-gradient(180deg, #fef3c7 0%, #fcd34d 30%, #f59e0b 60%, #b45309 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    filter: drop-shadow(0 8px 50px rgba(245, 158, 11, 0.65));
    animation: bigZoom 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    text-align: center;
    line-height: 1;
  }
  @keyframes bigZoom {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  .ov-scorer {
    font-size: 28px;
    font-weight: 800;
    color: #fef3c7;
    margin-top: 6px;
    animation: fadeUp 0.5s 0.4s both;
  }
  .ov-team {
    font-size: 14px;
    color: #fcd34d;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    animation: fadeUp 0.5s 0.55s both;
  }
  .ov-score {
    margin-top: 18px;
    font-size: 40px;
    font-weight: 900;
    color: #fde68a;
    padding: 8px 28px;
    border: 1px solid rgba(252, 211, 77, 0.4);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.5);
    font-variant-numeric: tabular-nums;
    animation: fadeUp 0.5s 0.7s both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* --- CARTELLINI (arbitro PNG) --- */
  .overlay.o-card { gap: 18px; }
  .overlay.o-red {
    background:
      radial-gradient(ellipse 60% 60% at 50% 50%, rgba(220, 38, 38, 0.20), transparent 70%),
      radial-gradient(ellipse at center, rgba(0, 0, 0, 0.92) 30%, rgba(0, 0, 0, 0.99) 100%);
    animation: overlayFadeIn 0.25s ease-out, shakeIt 0.5s 0.45s ease-in-out 2;
  }
  @keyframes shakeIt {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-10px); }
    50%      { transform: translateX(10px); }
    75%      { transform: translateX(-6px); }
  }
  .ov-ref-img {
    width: clamp(220px, 30vw, 340px);
    height: auto;
    filter: drop-shadow(0 20px 50px rgba(0, 0, 0, 0.8));
    animation: refRise 1.0s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .overlay.o-red .ov-ref-img {
    filter: drop-shadow(0 20px 60px rgba(220, 38, 38, 0.55));
  }
  @keyframes refRise {
    0%   { transform: scale(0.6) translateY(40px); opacity: 0; }
    60%  { transform: scale(1.05) translateY(0); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }
  .ov-card-text {
    font-size: 48px;
    font-weight: 900;
    letter-spacing: 0.1em;
    color: #fcd34d;
    animation: fadeUp 0.5s 0.3s both;
  }
  .ov-card-text.big {
    font-size: 60px;
    color: #fca5a5;
    text-shadow: 0 4px 24px rgba(220, 38, 38, 0.6);
  }
  .ov-player {
    font-size: 22px;
    font-weight: 700;
    color: #fef3c7;
    animation: fadeUp 0.5s 0.5s both;
  }

  /* --- BREAK (KICKOFF / HALFTIME / FULLTIME) --- */
  .overlay.o-break .ov-break-text {
    font-size: clamp(40px, 7vw, 90px);
    font-weight: 900;
    letter-spacing: 0.08em;
    background: linear-gradient(180deg, #fef3c7 0%, #fcd34d 50%, #b45309 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    filter: drop-shadow(0 6px 40px rgba(245, 158, 11, 0.5));
    text-align: center;
    animation: bigZoom 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .ov-break-sub {
    margin-top: 12px;
    font-size: 22px;
    color: #d4cfc1;
    font-weight: 700;
    letter-spacing: 0.05em;
    animation: fadeUp 0.5s 0.3s both;
  }

  @media (max-width: 900px) {
    .stream-wrap { grid-template-columns: 1fr; }
    .side-stats { order: -1; }
    .team-name { display: none; }
    .score-big { font-size: 44px; }
    .controls { gap: 8px; }
    .ctrl.skip { margin-left: 0; }
    .ov-ball { font-size: 100px; }
    .ov-card-img { width: 100px; height: 140px; }
    .ov-card-text { font-size: 36px; }
  }
</style>
