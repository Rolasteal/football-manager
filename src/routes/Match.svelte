<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount, onDestroy, tick } from 'svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { advanceMatchday } from '$engine/career/career'
  import type { Fixture, MatchResult } from '$engine/competition/types'
  import type { MatchEvent } from '$engine/match/types'

  const store = careerStore()
  let career = $derived(store.career)

  let myFixture = $state<Fixture | null>(null)
  let result = $state<MatchResult | null>(null)
  let shown = $state<MatchEvent[]>([])
  let currentIdx = $state(0)
  let homeScore = $state(0)
  let awayScore = $state(0)
  let minute = $state(0)
  let playing = $state(true)
  let finished = $state(false)
  let speed = $state(1)  // 1, 2, 5
  let goalFlash = $state(false)
  let errorMsg = $state<string | null>(null)
  let streamEl: HTMLDivElement | undefined = $state()
  let timer: ReturnType<typeof setTimeout> | null = null

  // Velocità: ms per evento (tipico match ~250-400 eventi)
  $effect(() => {
    // Forza re-trigger se speed cambia ma il loop è già attivo
    void speed
  })

  function eventDelay(): number {
    const baseMs = 220
    return Math.max(40, baseMs / speed)
  }

  onMount(async () => {
    if (!career) { push('/'); return }
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
  })

  function tickReplay() {
    if (!result || !playing) return
    if (currentIdx >= result.events.length) {
      finished = true
      playing = false
      return
    }
    const ev = result.events[currentIdx]
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
          {#each [1, 2, 5] as s}
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

  @media (max-width: 900px) {
    .stream-wrap { grid-template-columns: 1fr; }
    .side-stats { order: -1; }
    .team-name { display: none; }
    .score-big { font-size: 44px; }
    .controls { gap: 8px; }
    .ctrl.skip { margin-left: 0; }
  }
</style>
