<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore } from '$state/career.svelte'
  import * as MA from '$lib/matchAnalytics'
  import type { Fixture } from '$engine/competition/types'
  import type { EntityId } from '$engine/types'
  import type { Lineup } from '$engine/tactics/types'

  interface Props { params?: { fixtureId?: string } }
  let { params = {} }: Props = $props()

  const store = careerStore()
  let career = $derived(store.career)

  onMount(() => { if (!career) push('/') })

  let fixture = $derived<Fixture | null>(
    career && params?.fixtureId
      ? career.fixtures.find(f => f.id === params.fixtureId) ?? null
      : null
  )

  let result = $derived(fixture?.result ?? null)
  let homeLineup = $derived<Lineup | null>(result?.homeLineup ?? null)
  let awayLineup = $derived<Lineup | null>(result?.awayLineup ?? null)
  let events = $derived(result?.events ?? [])

  // Derivati dalle pure functions del modulo (riusano la stessa logica di Match.svelte)
  let liveRatings = $derived(MA.computeLiveRatings(events))
  let badges = $derived(MA.computePlayerBadges(events))
  let liveStats = $derived(MA.computeLiveStats(events))
  let homeGkId = $derived(homeLineup && career ? MA.gkOfLineup(homeLineup, career.players) : undefined)
  let awayGkId = $derived(awayLineup && career ? MA.gkOfLineup(awayLineup, career.players) : undefined)
  let fantaBonus = $derived(MA.computeFantaBonus(events, {
    homeLineup,
    awayLineup,
    homeGkId,
    awayGkId,
    captainId: career?.club?.tactics?.captainId,
    players: career?.players ?? {},
  }))
  let scorerList = $derived(MA.getScorerList(events))

  // Helpers
  function nameOf(id?: EntityId): string {
    if (!id || !career) return ''
    const p = career.players[id]
    return p ? `${p.firstName} ${p.lastName}` : ''
  }
  function lastNameOf(id: EntityId): string {
    return career?.players[id]?.lastName ?? '—'
  }
  function teamName(id: string): string { return career?.teams[id]?.name ?? '???' }
  function teamShort(id: string): string { return career?.teams[id]?.shortName ?? '???' }
  function teamOfSide(side: 'home' | 'away'): string {
    if (!fixture) return ''
    return teamName(side === 'home' ? fixture.homeId : fixture.awayId)
  }
  function colors(id: string) {
    const t = career?.teams[id]
    return { c1: t?.primaryColor ?? '#444', c2: t?.secondaryColor ?? '#888' }
  }
  function badgeOf(id: EntityId): MA.PlayerBadges {
    return badges[id] ?? MA.emptyBadges()
  }
  function rating(id: EntityId): number {
    // Allinea ai voti engine (più affidabili) per partite passate
    const fromEngine = result?.ratings?.[id]
    if (fromEngine !== undefined) return Math.max(1, Math.min(10, fromEngine))
    return liveRatings[id] ?? MA.BASE_RATING
  }
  function bonusOf(id: EntityId): number { return fantaBonus[id] ?? 0 }
  function totalOf(id: EntityId): number { return rating(id) + bonusOf(id) }

  function roleLabel(id: EntityId): string {
    const p = career?.players[id]
    if (!p) return '—'
    const r = MA.macroRole(p.position)
    if (r === 'GK')  return 'P'
    if (r === 'DEF') return 'D'
    if (r === 'MID') return 'C'
    return 'A'
  }

  function allPlayersOf(lineup: Lineup | null): EntityId[] {
    if (!lineup) return []
    const all = [...lineup.starters, ...lineup.bench]
    const order = (id: EntityId) => {
      const p = career?.players[id]
      if (!p) return 99
      const r = MA.macroRole(p.position)
      if (r === 'GK')  return 0
      if (r === 'DEF') return 1
      if (r === 'MID') return 2
      return 3
    }
    return all.slice().sort((a, b) => order(a) - order(b))
  }

  function teamAvgRating(lineup: Lineup | null): number {
    if (!lineup) return 0
    const ids: EntityId[] = [...lineup.starters]
    for (const pid of lineup.bench) if (badgeOf(pid).subIn) ids.push(pid)
    if (ids.length === 0) return 0
    const sum = ids.reduce((acc, id) => acc + totalOf(id), 0)
    return sum / ids.length
  }

  function back() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      push('/fixtures')
    }
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { return iso }
  }
</script>

<AppShell>
  {#if !career}
    <div class="loading"><div class="spinner"></div></div>
  {:else if !fixture}
    <div class="empty">
      <h1 class="text-gold">Partita non trovata</h1>
      <p>La partita richiesta non esiste in questa carriera.</p>
      <button class="btn-gold" onclick={() => push('/fixtures')}>↩ Torna al Calendario</button>
    </div>
  {:else if fixture.status !== 'played' || !result}
    <div class="empty">
      <h1 class="text-gold">Partita non ancora giocata</h1>
      <p>Giornata {fixture.matchday} · {fmtDate(fixture.date)}</p>
      <button class="btn-gold" onclick={() => push('/fixtures')}>↩ Torna al Calendario</button>
    </div>
  {:else}
    <div class="mr-top">
      <button class="btn-back" onclick={back}>← Indietro</button>
      <span class="md-chip">Giornata {fixture.matchday} · {fmtDate(fixture.date)}</span>
    </div>

    <!-- HERO: scoreline grande -->
    <header class="mr-hero card-gold anim-kickin">
      <div class="hero-team home" style="--c1: {colors(fixture.homeId).c1}; --c2: {colors(fixture.homeId).c2};">
        <div class="crest-big">{teamShort(fixture.homeId)}</div>
        <div class="ht-name">{teamName(fixture.homeId)}</div>
      </div>
      <div class="hero-score">
        <span class="s-home">{result.homeScore}</span>
        <span class="s-dash">–</span>
        <span class="s-away">{result.awayScore}</span>
        <div class="ft-label">FT</div>
      </div>
      <div class="hero-team away" style="--c1: {colors(fixture.awayId).c1}; --c2: {colors(fixture.awayId).c2};">
        <div class="crest-big">{teamShort(fixture.awayId)}</div>
        <div class="ht-name">{teamName(fixture.awayId)}</div>
      </div>
    </header>

    <div class="mr-body">
      <!-- Marcatori -->
      <section class="card-gold mr-scorers anim-kickin">
        <h3 class="mr-h">Marcatori</h3>
        {#if scorerList.length === 0}
          <div class="rep-empty">Nessun gol in questa partita</div>
        {:else}
          <ul class="rep-scorer-list">
            {#each scorerList as s (s.minute + ':' + s.playerId)}
              <li class="rep-scorer" class:home={s.side === 'home'} class:away={s.side === 'away'}>
                <span class="rs-min">{s.minute}'</span>
                <span class="rs-icon">⚽</span>
                <span class="rs-name">{nameOf(s.playerId)}</span>
                {#if s.note === 'autogol'}<span class="rs-note rs-own">aut</span>{/if}
                {#if s.note === 'rigore'}<span class="rs-note rs-pen">rig</span>{/if}
                <span class="rs-team">{teamOfSide(s.side)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- Stats finali -->
      <section class="card-gold mr-stats anim-kickin">
        <h3 class="mr-h">Statistiche finali</h3>
        <div class="rep-stats-grid">
          <div class="rep-stat-row">
            <span class="rsv">{liveStats.home.possession}%</span>
            <span class="rsl">Possesso</span>
            <span class="rsv">{liveStats.away.possession}%</span>
          </div>
          <div class="rep-stat-row">
            <span class="rsv">{liveStats.home.shots}</span>
            <span class="rsl">Tiri</span>
            <span class="rsv">{liveStats.away.shots}</span>
          </div>
          <div class="rep-stat-row">
            <span class="rsv">{liveStats.home.shotsOnTarget}</span>
            <span class="rsl">in porta</span>
            <span class="rsv">{liveStats.away.shotsOnTarget}</span>
          </div>
          <div class="rep-stat-row">
            <span class="rsv">{liveStats.home.corners}</span>
            <span class="rsl">Corner</span>
            <span class="rsv">{liveStats.away.corners}</span>
          </div>
          <div class="rep-stat-row">
            <span class="rsv">{liveStats.home.fouls}</span>
            <span class="rsl">Falli</span>
            <span class="rsv">{liveStats.away.fouls}</span>
          </div>
          <div class="rep-stat-row">
            <span class="rsv">{liveStats.home.yellowCards}</span>
            <span class="rsl">Gialli</span>
            <span class="rsv">{liveStats.away.yellowCards}</span>
          </div>
          {#if liveStats.home.redCards > 0 || liveStats.away.redCards > 0}
            <div class="rep-stat-row">
              <span class="rsv">{liveStats.home.redCards}</span>
              <span class="rsl">Rossi</span>
              <span class="rsv">{liveStats.away.redCards}</span>
            </div>
          {/if}
        </div>
      </section>

      <!-- Pagelle -->
      <section class="card-gold mr-ratings anim-kickin">
        <h3 class="mr-h">Pagelle</h3>
        {#if !homeLineup || !awayLineup}
          <div class="rep-empty">Pagelle non disponibili per questa partita (save legacy senza lineup nel risultato).</div>
        {:else}
          <div class="rep-ratings-grid">
            <div class="rep-team-col">
              <header class="rep-team-head" style="--c1: {colors(fixture.homeId).c1}; --c2: {colors(fixture.homeId).c2};">
                <span class="crest-sm">{teamShort(fixture.homeId)}</span>
                <span class="rt-name">{teamName(fixture.homeId)}</span>
                <span class="rt-avg {MA.ratingClass(teamAvgRating(homeLineup))}" title="Voto medio squadra">⌀ {MA.fmtRating(teamAvgRating(homeLineup))}</span>
              </header>
              <ul class="rep-rate-list">
                {#each allPlayersOf(homeLineup) as pid (pid)}
                  <li class="rep-rate-row" class:is-bench={homeLineup.bench.includes(pid)}>
                    <span class="rr-role">{roleLabel(pid)}</span>
                    <button type="button" class="rr-name rr-name-btn" onclick={() => push(`/player/${pid}`)} title="Apri dettaglio giocatore">
                      {lastNameOf(pid)}
                      {#if career?.club?.tactics?.captainId === pid}<span class="badge-captain" title="Capitano">C</span>{/if}
                      {#each Array(badgeOf(pid).goals) as _, gi (gi)}<span class="badge-ball" title="Gol">⚽</span>{/each}
                      {#each Array(badgeOf(pid).assists) as _, ai (ai)}<span class="badge-tag tag-assist" title="Assist">Ass.</span>{/each}
                      {#each Array(badgeOf(pid).ownGoals) as _, oi (oi)}<span class="badge-tag tag-own" title="Autogol">Aut</span>{/each}
                      {#if badgeOf(pid).yellow}<span class="badge-yellow" title="Ammonito">🟨</span>{/if}
                      {#if badgeOf(pid).red}<span class="badge-red" title="Espulso">🟥</span>{/if}
                      {#if badgeOf(pid).subOut}<span class="sub-arrow sub-out" title="Sostituito">▼</span>{/if}
                      {#if badgeOf(pid).subIn}<span class="sub-arrow sub-in" title="Entrato in campo">▲</span>{/if}
                    </button>
                    <span class="rr-rate {MA.ratingClass(rating(pid))}">{MA.fmtRating(rating(pid))}</span>
                    <span class="rr-bonus" class:b-plus={bonusOf(pid) > 0} class:b-minus={bonusOf(pid) < 0}>{MA.fmtBonus(bonusOf(pid)) || '—'}</span>
                    <span class="rr-total {MA.ratingClass(totalOf(pid))}">{MA.fmtRating(totalOf(pid))}</span>
                  </li>
                {/each}
              </ul>
            </div>
            <div class="rep-team-col">
              <header class="rep-team-head" style="--c1: {colors(fixture.awayId).c1}; --c2: {colors(fixture.awayId).c2};">
                <span class="crest-sm">{teamShort(fixture.awayId)}</span>
                <span class="rt-name">{teamName(fixture.awayId)}</span>
                <span class="rt-avg {MA.ratingClass(teamAvgRating(awayLineup))}" title="Voto medio squadra">⌀ {MA.fmtRating(teamAvgRating(awayLineup))}</span>
              </header>
              <ul class="rep-rate-list">
                {#each allPlayersOf(awayLineup) as pid (pid)}
                  <li class="rep-rate-row" class:is-bench={awayLineup.bench.includes(pid)}>
                    <span class="rr-role">{roleLabel(pid)}</span>
                    <button type="button" class="rr-name rr-name-btn" onclick={() => push(`/player/${pid}`)} title="Apri dettaglio giocatore">
                      {lastNameOf(pid)}
                      {#if career?.club?.tactics?.captainId === pid}<span class="badge-captain" title="Capitano">C</span>{/if}
                      {#each Array(badgeOf(pid).goals) as _, gi (gi)}<span class="badge-ball" title="Gol">⚽</span>{/each}
                      {#each Array(badgeOf(pid).assists) as _, ai (ai)}<span class="badge-tag tag-assist" title="Assist">Ass.</span>{/each}
                      {#each Array(badgeOf(pid).ownGoals) as _, oi (oi)}<span class="badge-tag tag-own" title="Autogol">Aut</span>{/each}
                      {#if badgeOf(pid).yellow}<span class="badge-yellow" title="Ammonito">🟨</span>{/if}
                      {#if badgeOf(pid).red}<span class="badge-red" title="Espulso">🟥</span>{/if}
                      {#if badgeOf(pid).subOut}<span class="sub-arrow sub-out" title="Sostituito">▼</span>{/if}
                      {#if badgeOf(pid).subIn}<span class="sub-arrow sub-in" title="Entrato in campo">▲</span>{/if}
                    </button>
                    <span class="rr-rate {MA.ratingClass(rating(pid))}">{MA.fmtRating(rating(pid))}</span>
                    <span class="rr-bonus" class:b-plus={bonusOf(pid) > 0} class:b-minus={bonusOf(pid) < 0}>{MA.fmtBonus(bonusOf(pid)) || '—'}</span>
                    <span class="rr-total {MA.ratingClass(totalOf(pid))}">{MA.fmtRating(totalOf(pid))}</span>
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
      </section>

      <!-- Cronaca completa -->
      <section class="card-gold mr-events anim-kickin">
        <h3 class="mr-h">Cronaca</h3>
        <div class="ev-stream">
          {#each events as ev, i (i)}
            {#if ev.commentary}
              <div class="ev-row" class:home={ev.side === 'home'} class:away={ev.side === 'away'} class:ev-goal={ev.kind === 'goal' || ev.kind === 'own_goal'} class:ev-yellow={ev.kind === 'yellow_card'} class:ev-red={ev.kind === 'red_card'}>
                <span class="ev-min">{ev.minute}'</span>
                <span class="ev-text">{ev.commentary}</span>
              </div>
            {/if}
          {/each}
        </div>
      </section>
    </div>
  {/if}
</AppShell>

<style>
  .loading { display: grid; place-items: center; min-height: 50vh; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .empty { text-align: center; padding: 40px 20px; }
  .empty p { color: #a8a29e; margin: 12px 0 24px; }

  .mr-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    gap: 12px;
  }
  .btn-back {
    background: none;
    border: 1px solid rgba(252, 211, 77, 0.30);
    color: #fcd34d;
    padding: 8px 14px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-back:hover {
    background: rgba(252, 211, 77, 0.08);
    border-color: rgba(252, 211, 77, 0.55);
  }
  .md-chip {
    color: #fcd34d;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 6px 12px;
    background: rgba(252, 211, 77, 0.08);
    border: 1px solid rgba(252, 211, 77, 0.25);
    border-radius: 6px;
  }

  /* ===== HERO ===== */
  .mr-hero {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
    padding: 28px;
    margin-bottom: 18px;
  }
  .hero-team {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
  }
  .hero-team.away { flex-direction: row-reverse; }
  .crest-big {
    width: 64px; height: 64px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
    flex-shrink: 0;
  }
  .ht-name {
    font-weight: 800;
    font-size: 18px;
    color: #fef3c7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hero-score {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 56px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    color: #fef3c7;
    position: relative;
    padding: 0 8px;
  }
  .s-dash { color: #fcd34d; opacity: 0.6; }
  .ft-label {
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: #fcd34d;
    letter-spacing: 0.18em;
    font-weight: 800;
    background: rgba(0, 0, 0, 0.6);
    padding: 2px 10px;
    border-radius: 4px;
    border: 1px solid rgba(252, 211, 77, 0.4);
  }

  /* ===== BODY ===== */
  .mr-body {
    display: grid;
    grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
    grid-template-rows: auto auto auto;
    grid-template-areas:
      "scorers stats"
      "ratings ratings"
      "events events";
    gap: 14px;
  }
  .mr-scorers { grid-area: scorers; padding: 16px 22px; }
  .mr-stats   { grid-area: stats; padding: 16px 22px; }
  .mr-ratings { grid-area: ratings; padding: 16px 22px; }
  .mr-events  { grid-area: events; padding: 16px 22px; }

  .mr-h {
    margin: 0 0 12px 0;
    font-size: 12px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #fcd34d;
    border-bottom: 1px solid rgba(252, 211, 77, 0.20);
    padding-bottom: 8px;
  }

  /* --- Marcatori --- */
  .rep-empty {
    color: #a8a29e;
    font-style: italic;
    padding: 18px 6px;
    text-align: center;
  }
  .rep-scorer-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .rep-scorer {
    display: grid;
    grid-template-columns: 40px 20px 1fr auto auto;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.35);
    border-left: 3px solid transparent;
    font-size: 14px;
  }
  .rep-scorer.home { border-left-color: rgba(252, 211, 77, 0.6); }
  .rep-scorer.away { border-left-color: rgba(252, 211, 77, 0.3); }
  .rs-min { color: #fcd34d; font-weight: 700; font-variant-numeric: tabular-nums; }
  .rs-icon { font-size: 14px; }
  .rs-name { font-weight: 700; color: #fef3c7; }
  .rs-team {
    color: #a8a29e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    max-width: 120px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rs-note {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
    background: rgba(252, 211, 77, 0.12);
    color: #fcd34d;
    border: 1px solid rgba(252, 211, 77, 0.35);
  }
  .rs-note.rs-own {
    background: rgba(220, 38, 38, 0.12);
    color: #fca5a5;
    border-color: rgba(220, 38, 38, 0.4);
  }

  /* --- Stats --- */
  .rep-stats-grid { display: flex; flex-direction: column; gap: 4px; }
  .rep-stat-row {
    display: grid;
    grid-template-columns: 60px 1fr 60px;
    align-items: center;
    padding: 8px 4px;
    border-bottom: 1px dashed rgba(252, 211, 77, 0.10);
  }
  .rep-stat-row:last-child { border-bottom: none; }
  .rsv { font-weight: 700; font-size: 16px; color: #fef3c7; text-align: center; font-variant-numeric: tabular-nums; }
  .rsl { text-align: center; color: #a8a29e; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }

  /* --- Pagelle --- */
  .rep-ratings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .rep-team-col { display: flex; flex-direction: column; min-width: 0; }
  .rep-team-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0.4), transparent);
    border-radius: 6px;
    margin-bottom: 8px;
  }
  .rep-team-head .crest-sm {
    width: 28px; height: 28px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 10px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  }
  .rt-name {
    font-weight: 800; font-size: 13px; color: #fef3c7;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .rt-avg {
    font-weight: 800; font-size: 13px;
    padding: 2px 8px;
    border-radius: 6px;
    font-variant-numeric: tabular-nums;
    border: 1px solid rgba(252, 211, 77, 0.30);
    background: rgba(0, 0, 0, 0.35);
  }
  .rep-rate-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 2px;
  }
  .rep-rate-row {
    display: grid;
    grid-template-columns: 22px 1fr 46px 44px 50px;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    background: rgba(0, 0, 0, 0.20);
  }
  .rep-rate-row:nth-child(odd) { background: rgba(0, 0, 0, 0.30); }
  .rep-rate-row.is-bench { opacity: 0.72; }
  .rr-role {
    color: #fcd34d; font-weight: 800;
    font-size: 10px; text-align: center;
    border: 1px solid rgba(252, 211, 77, 0.35);
    border-radius: 4px; padding: 2px 0;
    background: rgba(252, 211, 77, 0.08);
  }
  .rr-name {
    color: #fef3c7; font-weight: 600;
    display: flex; align-items: center; gap: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
  }
  .rr-name-btn {
    background: transparent;
    border: none;
    padding: 2px 4px;
    margin: -2px -4px;
    cursor: pointer;
    font: inherit;
    text-align: left;
    border-radius: 4px;
    transition: background 0.12s, color 0.12s;
  }
  .rr-name-btn:hover { background: rgba(252, 211, 77, 0.10); color: #fde68a; }
  .rr-name-btn:focus-visible { outline: 1px solid rgba(252, 211, 77, 0.6); }
  .rr-rate, .rr-total {
    font-weight: 700; font-variant-numeric: tabular-nums;
    text-align: center;
    padding: 3px 0;
    border-radius: 4px;
    font-size: 13px;
  }
  .rr-total {
    background: rgba(252, 211, 77, 0.08);
    border: 1px solid rgba(252, 211, 77, 0.25);
    font-size: 14px;
  }
  .rr-bonus {
    text-align: center; font-weight: 700;
    font-size: 12px;
    color: #a8a29e;
    font-variant-numeric: tabular-nums;
  }
  .rr-bonus.b-plus  { color: #4ade80; }
  .rr-bonus.b-minus { color: #f87171; }

  /* Rating colors */
  :global(.r-top)  { color: #fde68a; }
  :global(.r-ok)   { color: #86efac; }
  :global(.r-mid)  { color: #cbd5e1; }
  :global(.r-low)  { color: #fca5a5; }

  /* Badge */
  :global(.badge-ball) { font-size: 12px; }
  :global(.badge-tag) {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 5px;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.05em;
    line-height: 1.2;
    vertical-align: middle;
    border-radius: 3px;
    background: transparent;
  }
  :global(.badge-tag.tag-assist) { color: #fcd34d; border: 1px solid rgba(252, 211, 77, 0.7); }
  :global(.badge-tag.tag-own) { color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.7); }
  :global(.badge-captain) {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; margin-left: 4px;
    border-radius: 50%;
    background: linear-gradient(135deg, #fcd34d, #b45309);
    color: #1c1917;
    font-size: 9px; font-weight: 900; line-height: 1;
    vertical-align: middle;
    box-shadow: 0 1px 4px rgba(252, 211, 77, 0.4);
  }
  :global(.badge-yellow), :global(.badge-red) { font-size: 11px; margin-left: 2px; }
  :global(.sub-arrow) { font-size: 11px; margin-left: 3px; font-weight: 800; }
  :global(.sub-arrow.sub-in) { color: #86efac; }
  :global(.sub-arrow.sub-out) { color: #fca5a5; }

  /* --- Cronaca --- */
  .ev-stream {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 420px;
    overflow-y: auto;
  }
  .ev-row {
    display: grid;
    grid-template-columns: 40px 1fr;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 13px;
    align-items: baseline;
    background: rgba(0, 0, 0, 0.20);
  }
  .ev-row:nth-child(odd) { background: rgba(0, 0, 0, 0.30); }
  .ev-row.ev-goal { border-left: 2px solid #fcd34d; }
  .ev-row.ev-yellow { border-left: 2px solid #fde047; }
  .ev-row.ev-red { border-left: 2px solid #ef4444; }
  .ev-min {
    color: #fcd34d; font-weight: 700;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .ev-text { color: #d4cfc1; }

  @media (max-width: 1100px) {
    .mr-body {
      grid-template-columns: 1fr;
      grid-template-areas: "scorers" "stats" "ratings" "events";
    }
    .rep-ratings-grid { grid-template-columns: 1fr; gap: 12px; }
  }
  @media (max-width: 700px) {
    .mr-hero { grid-template-columns: 1fr; gap: 14px; }
    .hero-team.away { flex-direction: row; }
    .hero-score { font-size: 42px; }
  }
</style>
