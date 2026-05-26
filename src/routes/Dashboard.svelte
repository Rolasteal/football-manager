<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { computeStandings } from '$engine/competition/standings'
  import { calcOverall } from '$engine/gen/player'
  import { ensureClubFinances, fmtMoney, cashTrend, cashTrendPct } from '$engine/career/finances'
  import { endOfSeasonAgeTick } from '$engine/career/aging'
  import { generateId, createRng } from '$engine/gen/rng'
  import type { Fixture } from '$engine/competition/types'

  const store = careerStore()
  let career = $derived(store.career)

  onMount(() => {
    if (!career) push('/')
  })

  let myTeam = $derived(career ? career.teams[career.club.teamId] : null)
  let myLeague = $derived(
    career && myTeam
      ? Object.values(career.leagues).find(l => l.teamIds.includes(myTeam!.id)) ?? null
      : null
  )

  let nextFixture = $derived<Fixture | null>(
    career
      ? (career.fixtures
          .filter(f =>
            (f.homeId === career!.club.teamId || f.awayId === career!.club.teamId)
            && f.status === 'scheduled'
          )
          .sort((a, b) => a.matchday - b.matchday)[0] ?? null)
      : null
  )

  let lastFixture = $derived<Fixture | null>(
    career
      ? (career.fixtures
          .filter(f =>
            (f.homeId === career!.club.teamId || f.awayId === career!.club.teamId)
            && f.status === 'played'
          )
          .sort((a, b) => b.matchday - a.matchday)[0] ?? null)
      : null
  )

  let standings = $derived(
    career && myLeague ? computeStandings(career.fixtures.filter(f => f.leagueId === myLeague!.id), myLeague.teamIds) : []
  )
  let myPosition = $derived(
    career && standings.length > 0
      ? standings.findIndex(r => r.teamId === career!.club.teamId) + 1
      : 0
  )

  let topScorer = $derived(() => {
    if (!career) return null
    const squad = Object.values(career.players).filter(p => p.teamId === career.club.teamId)
    if (squad.length === 0) return null
    return [...squad].sort((a, b) => calcOverall(b) - calcOverall(a))[0]
  })

  let unreadNews = $derived(career ? career.news.filter(n => !n.read).slice(0, 4) : [])

  // Finanze club (Fase 3.1) — ensureClubFinances popola lazy per save legacy
  let finances = $derived(career ? ensureClubFinances(career) : null)
  let trend = $derived(finances ? cashTrend(finances, 4) : [])
  let trendPct = $derived(finances ? cashTrendPct(finances, 4) : 0)

  let advancing = $state(false)
  let startingNewSeason = $state(false)

  async function handleAdvance() {
    if (!career || advancing) return
    if (career.season.currentMatchday > career.season.totalMatchdays) return
    advancing = true
    try {
      // Naviga alla match view con flag "advance" che farà il replay + chiamerà advanceMatchday
      push('/match')
    } finally {
      advancing = false
    }
  }

  /**
   * Fase 3.B: avanza tutti i giocatori di 1 anno (aging + ricalc valore) e
   * prepara la nuova stagione. Chiama endOfSeasonAgeTick + persist.
   * NB: oggi NON rigenera il calendario per la nuova stagione (lo farà 3.C
   * insieme alla generazione giovani e al passaggio fixtures). Per ora la
   * dashboard mostrerà "Nessuna partita rimanente" — è atteso, è solo il
   * test della curva età.
   */
  async function handleStartNewSeason() {
    if (!career || startingNewSeason) return
    if (career.season.currentMatchday <= career.season.totalMatchdays) return
    startingNewSeason = true
    try {
      const prevYear = career.season.year
      const rngNews = createRng((career.seed ^ prevYear ^ 0x5EA50) >>> 0)
      const processed = endOfSeasonAgeTick(career)
      career.news.unshift({
        id: generateId(rngNews),
        date: `${career.season.year}-07-01`,
        kind: 'board',
        title: `Stagione ${prevYear}/${(prevYear + 1).toString().slice(2)} conclusa`,
        body: `Età avanzata per ${processed} giocatori. Calendario nuova stagione in arrivo (Fase 3.C).`,
        read: false,
      })
      await persistActiveCareer()
    } finally {
      startingNewSeason = false
    }
  }

  function teamName(id: string): string {
    return career?.teams[id]?.name ?? '???'
  }
  function teamShort(id: string): string {
    return career?.teams[id]?.shortName ?? '???'
  }
  function teamColors(id: string): { c1: string; c2: string } {
    const t = career?.teams[id]
    return { c1: t?.primaryColor ?? '#444', c2: t?.secondaryColor ?? '#888' }
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
  {:else}
    <div class="grid">
      <!-- Hero: prossima partita / CTA avanza -->
      <section class="card-gold hero anim-kickin">
        <div class="hero-l">
          <div class="chip-gold">Giornata {career.season.currentMatchday} / {career.season.totalMatchdays}</div>
          <h1 class="hero-title text-gold">
            {#if career.season.currentMatchday > career.season.totalMatchdays}
              Stagione conclusa
            {:else if nextFixture}
              Prossima partita
            {:else}
              In attesa
            {/if}
          </h1>
          {#if nextFixture}
            <div class="match-row">
              <div class="team-block right" style="--c1: {teamColors(nextFixture.homeId).c1}; --c2: {teamColors(nextFixture.homeId).c2};">
                <span class="crest-sm">{teamShort(nextFixture.homeId)}</span>
                <span class="t">{teamName(nextFixture.homeId)}</span>
              </div>
              <span class="vs">VS</span>
              <div class="team-block">
                <span class="crest-sm" style="--c1: {teamColors(nextFixture.awayId).c1}; --c2: {teamColors(nextFixture.awayId).c2};">{teamShort(nextFixture.awayId)}</span>
                <span class="t">{teamName(nextFixture.awayId)}</span>
              </div>
            </div>
            <div class="date">{fmtDate(nextFixture.date)}</div>
          {:else}
            <p class="muted">Nessuna partita rimanente in calendario.</p>
          {/if}
        </div>
        <div class="hero-r">
          {#if career.season.currentMatchday > career.season.totalMatchdays}
            <button
              class="btn-gold big"
              disabled={startingNewSeason}
              onclick={handleStartNewSeason}
              title="Avanza i giocatori di 1 anno (crescita/declino) e inizia la nuova stagione"
            >
              {startingNewSeason ? '...' : '▶ Inizia Nuova Stagione'}
            </button>
          {:else}
            <button
              class="btn-gold big"
              disabled={advancing || !nextFixture}
              onclick={handleAdvance}
            >
              ▶ Vai alla partita
            </button>
          {/if}
        </div>
      </section>

      <!-- Posizione classifica -->
      <section class="card-gold tile anim-kickin anim-delay-100">
        <div class="tile-l">POSIZIONE</div>
        <div class="tile-big text-gold">{myPosition || '—'}<span class="tile-small">/{myLeague?.teamIds.length ?? '?'}</span></div>
        <div class="tile-meta">{myLeague?.name ?? ''}</div>
      </section>

      <!-- Reputazione club -->
      <section class="card-gold tile anim-kickin anim-delay-200">
        <div class="tile-l">REPUTAZIONE</div>
        <div class="tile-big text-metallic">{myTeam?.reputation ?? '—'}<span class="tile-small">/100</span></div>
        <div class="tile-meta">{myTeam?.city}</div>
      </section>

      <!-- Top giocatore -->
      <section class="card-gold tile anim-kickin anim-delay-300">
        <div class="tile-l">TOP ROSA</div>
        {#if topScorer()}
          {@const tp = topScorer()!}
          <div class="tile-big text-gold">{calcOverall(tp)}</div>
          <div class="tile-meta">{tp.firstName} {tp.lastName} · {tp.position}</div>
        {:else}
          <div class="tile-big">—</div>
        {/if}
      </section>

      <!-- Bilancio club (Fase 3.1) -->
      {#if finances}
        <section class="card-gold tile tile-finances anim-kickin anim-delay-400">
          <div class="fin-head">
            <span class="tile-l">BILANCIO</span>
            {#if trend.length >= 2}
              {@const up = trendPct >= 0}
              <span class="fin-trend" class:up class:down={!up} title="Variazione cassa ultimi 4 turni">
                {up ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1).replace('.', ',')}%
              </span>
            {/if}
          </div>
          <div class="fin-cash text-gold">{fmtMoney(finances.cash)}</div>
          <div class="fin-meta-list">
            <div class="fin-row">
              <span class="fin-row-l">Sponsor</span>
              <span class="fin-row-v">{fmtMoney(finances.sponsorAnnual)}/anno</span>
            </div>
            <div class="fin-row">
              <span class="fin-row-l">Ingaggi</span>
              <span class="fin-row-v">{fmtMoney(finances.monthlyWageBudget)}/mese</span>
            </div>
            <div class="fin-row">
              <span class="fin-row-l">Mercato</span>
              <span class="fin-row-v">{fmtMoney(finances.transferBudget)}</span>
            </div>
          </div>
        </section>
      {/if}

      <!-- Ultimo risultato -->
      <section class="card-gold panel last-result anim-kickin anim-delay-400">
        <div class="panel-head">
          <h3>Ultimo risultato</h3>
        </div>
        {#if lastFixture && lastFixture.result}
          {@const isHome = lastFixture.homeId === career.club.teamId}
          {@const myGoals = isHome ? lastFixture.result.homeScore : lastFixture.result.awayScore}
          {@const oppGoals = isHome ? lastFixture.result.awayScore : lastFixture.result.homeScore}
          {@const oppId = isHome ? lastFixture.awayId : lastFixture.homeId}
          {@const verdict = myGoals > oppGoals ? 'win' : myGoals < oppGoals ? 'loss' : 'draw'}
          <button type="button" class="result-btn" onclick={() => push(`/match-report/${lastFixture!.id}`)} title="Apri report partita">
            <div class="result-row">
              <span class="verdict v-{verdict}">{verdict === 'win' ? 'V' : verdict === 'loss' ? 'P' : 'N'}</span>
              <span class="score">{lastFixture.result.homeScore} - {lastFixture.result.awayScore}</span>
              <span class="opp">{isHome ? 'vs' : '@'} {teamName(oppId)}</span>
              <span class="open-icon">→</span>
            </div>
            <div class="date small">Giornata {lastFixture.matchday} · {fmtDate(lastFixture.date)}</div>
          </button>
        {:else}
          <div class="muted">Nessuna partita ancora giocata.</div>
        {/if}
      </section>

      <!-- News -->
      <section class="card-gold panel news anim-kickin anim-delay-500">
        <div class="panel-head">
          <h3>News dal club</h3>
        </div>
        {#if unreadNews.length > 0}
          <ul class="news-list">
            {#each unreadNews as n}
              <li>
                <span class="news-dot"></span>
                <div>
                  <div class="news-title">{n.title}</div>
                  {#if n.body}<div class="news-body">{n.body}</div>{/if}
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="muted">Nessuna novità in bacheca.</div>
        {/if}
      </section>
    </div>
  {/if}
</AppShell>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
  }

  .hero {
    grid-column: 1 / -1;
    padding: 26px 30px;
    display: flex;
    align-items: center;
    gap: 24px;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .hero-l { flex: 1; min-width: 280px; }
  .hero-title { font-size: 28px; font-weight: 800; margin: 8px 0 18px; }
  .match-row {
    display: flex; align-items: center; gap: 16px;
    flex-wrap: wrap;
  }
  .team-block {
    display: flex; align-items: center; gap: 10px;
  }
  .team-block.right { flex-direction: row-reverse; text-align: right; }
  .crest-sm {
    width: 40px; height: 40px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  }
  .vs { color: #fcd34d; font-weight: 700; letter-spacing: 0.15em; font-size: 14px; }
  .t {
    font-size: 14px; font-weight: 700;
    max-width: 220px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .date { color: #918778; font-size: 12px; margin-top: 14px; letter-spacing: 0.05em; }
  .date.small { font-size: 11px; margin-top: 8px; }

  .big { font-size: 16px; padding: 16px 28px; }

  .tile {
    padding: 20px 22px;
    display: flex; flex-direction: column;
    gap: 6px;
  }
  .tile-l {
    color: #fcd34d;
    font-size: 10px;
    letter-spacing: 0.18em;
    font-weight: 700;
    text-transform: uppercase;
  }
  .tile-big {
    font-size: 42px;
    font-weight: 800;
    line-height: 1;
    margin: 4px 0;
  }
  .tile-small {
    font-size: 16px;
    color: #918778;
    margin-left: 4px;
  }
  .tile-meta {
    color: #b8b0a0;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Tile Bilancio — variante con header + 3 stat a piè card */
  .tile-finances {
    padding: 16px 18px;
    gap: 4px;
  }
  .fin-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .fin-trend {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 6px;
    letter-spacing: 0.04em;
  }
  .fin-trend.up   { color: #86efac; background: rgba(34, 197, 94, 0.14); border: 1px solid rgba(34, 197, 94, 0.4); }
  .fin-trend.down { color: #fca5a5; background: rgba(220, 38, 38, 0.14); border: 1px solid rgba(220, 38, 38, 0.4); }
  .fin-cash {
    font-size: 30px;
    font-weight: 800;
    line-height: 1.05;
    margin: 2px 0 10px;
    letter-spacing: -0.01em;
  }
  .fin-meta-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: auto;
    padding-top: 6px;
    border-top: 1px solid rgba(252, 211, 77, 0.12);
  }
  .fin-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    line-height: 1.4;
  }
  .fin-row-l { color: #918778; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
  .fin-row-v { color: #d4cfc1; font-weight: 600; }

  .panel { padding: 18px 22px; }
  .panel.last-result { grid-column: span 2; }
  .panel.news { grid-column: span 2; }
  .panel-head h3 {
    margin: 0 0 12px;
    color: #fcd34d;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-weight: 700;
  }

  .result-btn {
    background: transparent;
    border: 1px dashed transparent;
    border-radius: 8px;
    padding: 8px 10px;
    margin: -8px -10px;
    width: calc(100% + 20px);
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
    transition: all 0.15s;
  }
  .result-btn:hover {
    background: rgba(252, 211, 77, 0.06);
    border-color: rgba(252, 211, 77, 0.30);
  }
  .open-icon {
    margin-left: auto;
    color: #fcd34d;
    font-size: 18px;
    font-weight: 800;
    opacity: 0.5;
    transition: opacity 0.15s, transform 0.15s;
  }
  .result-btn:hover .open-icon {
    opacity: 1;
    transform: translateX(2px);
  }
  .result-row {
    display: flex; align-items: center; gap: 14px;
  }
  .verdict {
    width: 30px; height: 30px;
    border-radius: 8px;
    display: inline-flex; align-items: center; justify-content: center;
    font-weight: 800;
    font-size: 12px;
  }
  .v-win  { background: rgba(34, 197, 94, 0.2); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.5); }
  .v-loss { background: rgba(220, 38, 38, 0.2); color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.5); }
  .v-draw { background: rgba(252, 211, 77, 0.2); color: #fde68a; border: 1px solid rgba(252, 211, 77, 0.5); }
  .score { font-weight: 800; font-size: 20px; }
  .opp { color: #d4cfc1; font-size: 13px; }

  .news-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
  .news-list li { display: flex; gap: 10px; align-items: flex-start; }
  .news-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #fcd34d;
    box-shadow: 0 0 8px rgba(252, 211, 77, 0.6);
    margin-top: 6px;
    flex-shrink: 0;
  }
  .news-title { font-weight: 700; font-size: 13px; color: #fef3c7; }
  .news-body { color: #b8b0a0; font-size: 12px; margin-top: 2px; line-height: 1.4; }

  .muted { color: #918778; font-size: 13px; }

  .loading { display: grid; place-items: center; min-height: 50vh; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 980px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
    .hero { grid-column: 1 / -1; }
    .panel.last-result, .panel.news { grid-column: 1 / -1; }
  }
  @media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
