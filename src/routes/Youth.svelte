<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { calcOverall } from '$engine/gen/player'
  import { fmtMoney } from '$engine/career/finances'
  import { tierFromYouthPotential, type YouthTier } from '$engine/career/youth'
  import type { Player, Position } from '$engine/types'

  const store = careerStore()
  let career = $derived(store.career)
  let myTeam = $derived(career ? career.teams[career.club.teamId] : null)

  onMount(() => { if (!career) push('/') })

  // Filtri
  type Scope = 'mine' | 'all'
  let scope = $state<Scope>('mine')
  let filterClubId = $state<string>('all')
  let filterPotMin = $state<number>(60)
  let filterAgeMax = $state<number>(21)

  function playerAge(p: Player): number {
    const b = new Date(p.birthDate)
    const ref = career ? new Date(`${career.season.year}-07-01`) : new Date()
    let a = ref.getUTCFullYear() - b.getUTCFullYear()
    const m = ref.getUTCMonth() - b.getUTCMonth()
    if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) a--
    return a
  }

  // Ordinati per club (per dropdown)
  let teamsList = $derived(
    career ? Object.values(career.teams).sort((a, b) => a.name.localeCompare(b.name)) : []
  )

  /** Tutti i "giovani" della career che passano i filtri (age + potential) */
  let prospects = $derived<Player[]>(() => {
    if (!career) return []
    const all = Object.values(career.players)
    const myId = career.club.teamId
    return all
      .filter(p => {
        if (!p.teamId) return false                       // svincolati visibili in /transfers
        if (playerAge(p) > filterAgeMax) return false
        const pot = p.potential ?? calcOverall(p)
        if (pot < filterPotMin) return false
        if (scope === 'mine' && p.teamId !== myId) return false
        if (scope === 'all' && filterClubId !== 'all' && p.teamId !== filterClubId) return false
        return true
      })
      .sort((a, b) => (b.potential ?? 0) - (a.potential ?? 0))
      .slice(0, 80)
  })

  /** Set degli ID già in formazione del mio club (starters o bench) */
  let inLineupSet = $derived<Set<string>>(
    career
      ? new Set([...career.club.lineup.starters, ...career.club.lineup.bench])
      : new Set<string>()
  )

  function fmtPotential(p: Player): string {
    const pot = p.potential ?? calcOverall(p)
    return String(pot)
  }
  /** Classe CSS dal tier nominale (scarso/medio/normale/buono/ottimo) */
  function potClass(pot: number): string {
    const tier = tierFromYouthPotential(pot)
    return `pot-${tier}`
  }
  /** Label leggibile italiana */
  function tierLabel(tier: YouthTier): string {
    if (tier === 'ottimo')   return 'Ottimo'
    if (tier === 'buono')    return 'Buono'
    if (tier === 'normale')  return 'Normale'
    if (tier === 'medio')    return 'Medio'
    return 'Scarso'
  }
  function ovColor(ov: number): string {
    if (ov >= 80) return 'ov-elite'
    if (ov >= 70) return 'ov-good'
    if (ov >= 55) return 'ov-mid'
    return 'ov-low'
  }

  let promoteMsg = $state<string | null>(null)
  let promoteOk = $state(false)

  async function promoteToBench(p: Player) {
    if (!career) return
    if (inLineupSet.has(p.id)) {
      promoteOk = false
      promoteMsg = `${p.firstName} ${p.lastName} è già in formazione.`
      setTimeout(() => promoteMsg = null, 3000)
      return
    }
    if (career.club.lineup.bench.length >= 7) {
      promoteOk = false
      promoteMsg = 'Panchina piena (7/7). Rimuovi qualcuno prima.'
      setTimeout(() => promoteMsg = null, 3500)
      return
    }
    career.club.lineup.bench = [...career.club.lineup.bench, p.id]
    career.updatedAt = Date.now()
    await persistActiveCareer()
    promoteOk = true
    promoteMsg = `✓ ${p.firstName} ${p.lastName} aggiunto alla panchina.`
    setTimeout(() => promoteMsg = null, 3500)
  }

  function openPlayer(id: string) { push(`/player/${id}`) }

  function teamOf(p: Player) {
    if (!career || !p.teamId) return null
    return career.teams[p.teamId]
  }
</script>

<AppShell>
  {#if !career || !myTeam}
    <div class="loading"><div class="spinner"></div></div>
  {:else}
    <header class="yt-head card-gold anim-kickin">
      <div class="head-l">
        <div class="yt-icon">🌱</div>
        <div>
          <h1 class="yt-name">Settore giovanile</h1>
          <div class="yt-sub">Esplora i prospect del tuo vivaio e dei rivali · Stagione {career.season.year}/{(career.season.year + 1).toString().slice(2)}</div>
        </div>
      </div>
      <div class="head-r">
        <div class="meta-tile">
          <span class="meta-l">Risultati</span>
          <span class="meta-v text-gold">{prospects().length}</span>
          <span class="meta-sub">prospect (max 80)</span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">In panchina</span>
          <span class="meta-v">{career.club.lineup.bench.length}/7</span>
          <span class="meta-sub">slot disponibili</span>
        </div>
      </div>
    </header>

    {#if promoteMsg}
      <div class="action-banner" class:ok={promoteOk} class:err={!promoteOk}>
        {promoteMsg}
      </div>
    {/if}

    <div class="tabs" role="tablist">
      <button class="tab" class:active={scope === 'mine'} onclick={() => scope = 'mine'} role="tab" aria-selected={scope === 'mine'}>
        🏠 Mio vivaio
      </button>
      <button class="tab" class:active={scope === 'all'} onclick={() => scope = 'all'} role="tab" aria-selected={scope === 'all'}>
        🌍 Tutti i club
      </button>
    </div>

    <div class="filters card-gold">
      <div class="filter-row">
        {#if scope === 'all'}
          <label class="filter-l">
            Club
            <select bind:value={filterClubId} class="filter-select">
              <option value="all">Tutti</option>
              {#each teamsList as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="filter-l">
          Potential minimo
          <input type="number" bind:value={filterPotMin} min="30" max="99" class="filter-input" />
        </label>
        <label class="filter-l">
          Età massima
          <input type="number" bind:value={filterAgeMax} min="16" max="25" class="filter-input" />
        </label>
        <div class="filter-hint">
          Mostriamo solo i giovani con <strong>età ≤ {filterAgeMax}</strong> e <strong>potential ≥ {filterPotMin}</strong>.
        </div>
      </div>
    </div>

    {#if prospects().length === 0}
      <div class="empty card-gold">
        <span class="empty-icon">🚫</span>
        <p>Nessun prospect trovato con questi filtri. Prova ad abbassare il potential o alzare l'età massima.</p>
      </div>
    {:else}
      <div class="prospects card-gold">
        <div class="prow head-row">
          <span class="c-pos">Pos</span>
          <span class="c-name">Nome</span>
          <span class="c-age">Età</span>
          <span class="c-ov">OVR</span>
          <span class="c-pot">Pot</span>
          <span class="c-club">Club</span>
          {#if scope === 'mine'}
            <span class="c-status">Status</span>
            <span class="c-action">Azione</span>
          {:else}
            <span class="c-val">Valore</span>
          {/if}
        </div>
        {#each prospects() as p (p.id)}
          {@const ovr = calcOverall(p)}
          {@const pot = p.potential ?? ovr}
          {@const team = teamOf(p)}
          {@const isInLineup = inLineupSet.has(p.id)}
          <div class="prow">
            <span class="c-pos"><span class="pos-chip">{p.position}</span></span>
            <button class="c-name name-btn" onclick={() => openPlayer(p.id)}>
              {p.firstName} <strong>{p.lastName}</strong>
            </button>
            <span class="c-age">{playerAge(p)}</span>
            <span class="c-ov"><span class="ov-badge {ovColor(ovr)}">{ovr}</span></span>
            <span class="c-pot">
              <span class="pot-badge {potClass(pot)}" title={tierLabel(tierFromYouthPotential(pot))}>
                {pot}
              </span>
              <span class="pot-tier-label {potClass(pot)}">{tierLabel(tierFromYouthPotential(pot))}</span>
            </span>
            <span class="c-club">
              {#if team}
                <span class="crest small" style="--c1: {team.primaryColor}; --c2: {team.secondaryColor};">{team.shortName}</span>
                <span class="team-name">{team.name}</span>
              {/if}
            </span>
            {#if scope === 'mine'}
              <span class="c-status">
                {#if isInLineup}
                  <span class="status-chip in">In rosa attiva</span>
                {:else}
                  <span class="status-chip out">Fuori rosa</span>
                {/if}
              </span>
              <span class="c-action">
                {#if !isInLineup}
                  <button class="btn-gold promote-btn" onclick={() => promoteToBench(p)} title="Aggiungi in panchina">
                    ⬆ Promuovi
                  </button>
                {:else}
                  <span class="muted">—</span>
                {/if}
              </span>
            {:else}
              <span class="c-val">{fmtMoney(p.marketValue)}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <section class="info-note">
      <p>
        I <strong>giovani</strong> entrano nel vivaio a ogni inizio stagione (Fase 3.C). Reputazione club determina
        quanti se ne aggiungono (2-5 per squadra). 5 fasce di potential:
        <strong class="pot-tier-label pot-scarso">Scarso</strong> 30-49 (50%),
        <strong class="pot-tier-label pot-medio">Medio</strong> 50-59 (30%),
        <strong class="pot-tier-label pot-normale">Normale</strong> 60-69 (15%),
        <strong class="pot-tier-label pot-buono">Buono</strong> 70-79 (4%),
        <strong class="pot-tier-label pot-ottimo">Ottimo</strong> 80-95 (1% — crack generazionale).
        Partono con OVR <strong>molto basso</strong> (16enni ~40-50), crescono col tempo verso il loro potential.
      </p>
      <p>
        <strong>Promuovi</strong> li aggiunge alla tua panchina (max 7 slot). Da lì compaiono nei convocati e possono entrare
        in match come sostituzioni. Da PlayerDetail puoi anche <strong>rinnovarli</strong> a stipendio basso prima che il loro
        contratto scada.
      </p>
    </section>
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

  /* ===== HEADER ===== */
  .yt-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    align-items: center;
    padding: 22px 28px;
    margin-bottom: 16px;
  }
  .head-l { display: flex; align-items: center; gap: 18px; }
  .yt-icon {
    font-size: 52px;
    line-height: 1;
    filter: drop-shadow(0 4px 12px rgba(34, 197, 94, 0.35));
  }
  .yt-name { margin: 0; font-size: 26px; font-weight: 800; color: #fef3c7; }
  .yt-sub { color: #b8b0a0; font-size: 13px; margin-top: 4px; }

  .head-r {
    display: grid;
    grid-template-columns: repeat(2, auto);
    gap: 18px 24px;
  }
  .meta-tile {
    display: flex; flex-direction: column;
    gap: 2px; min-width: 110px;
  }
  .meta-l {
    color: #a8a29e;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .meta-v {
    color: #fef3c7;
    font-weight: 800;
    font-size: 18px;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
  }
  .meta-sub { color: #918778; font-size: 11px; }

  .action-banner {
    margin-bottom: 14px;
    padding: 12px 18px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
  }
  .action-banner.ok {
    background: rgba(34, 197, 94, 0.14);
    color: #86efac;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }
  .action-banner.err {
    background: rgba(220, 38, 38, 0.14);
    color: #fca5a5;
    border: 1px solid rgba(220, 38, 38, 0.4);
  }

  /* ===== TABS ===== */
  .tabs {
    display: flex;
    gap: 6px;
    margin: 14px 0 14px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
  }
  .tab {
    background: none;
    border: 0;
    color: #b8b0a0;
    font-family: inherit;
    font-weight: 700;
    font-size: 13px;
    padding: 10px 16px;
    cursor: pointer;
    position: relative;
    transition: color 0.15s;
    letter-spacing: 0.02em;
  }
  .tab:hover { color: #fef3c7; }
  .tab.active { color: #fcd34d; }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 12px; right: 12px; bottom: -1px;
    height: 2px;
    background: linear-gradient(90deg, #b45309, #fcd34d, #fde68a);
    border-radius: 2px 2px 0 0;
  }

  /* ===== FILTERS ===== */
  .filters {
    padding: 14px 18px;
    margin-bottom: 14px;
  }
  .filter-row {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .filter-l {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #d4cfc1;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    min-width: 130px;
  }
  .filter-select,
  .filter-input {
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(252, 211, 77, 0.28);
    color: #fef3c7;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .filter-select:focus,
  .filter-input:focus {
    outline: none;
    border-color: rgba(252, 211, 77, 0.6);
    box-shadow: 0 0 0 3px rgba(252, 211, 77, 0.12);
  }
  .filter-hint {
    align-self: center;
    color: #918778;
    font-size: 11.5px;
    line-height: 1.4;
    max-width: 280px;
  }
  .filter-hint strong { color: #fde68a; }

  /* ===== EMPTY ===== */
  .empty {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 22px;
    color: #b8b0a0;
  }
  .empty-icon { font-size: 30px; opacity: 0.8; }
  .empty p { margin: 0; font-size: 13px; line-height: 1.5; }

  /* ===== PROSPECTS TABLE ===== */
  .prospects {
    padding: 6px 8px;
    margin-bottom: 18px;
  }
  .prow {
    display: grid;
    grid-template-columns: 60px minmax(180px, 1.4fr) 50px 70px 70px minmax(160px, 1fr) 130px 130px;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.07);
    font-size: 13px;
  }
  .prow:last-child { border-bottom: 0; }
  .prow.head-row {
    color: #918778;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
    margin-bottom: 4px;
  }
  .pos-chip {
    background: rgba(252, 211, 77, 0.14);
    color: #fcd34d;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 800;
    font-size: 11px;
    letter-spacing: 0.05em;
  }
  .name-btn {
    background: none; border: 0;
    color: #fef3c7;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 13px;
    padding: 0;
  }
  .name-btn:hover { color: #fde68a; text-decoration: underline; }
  .name-btn strong { font-weight: 800; }

  .ov-badge, .pot-badge {
    display: inline-block;
    min-width: 36px;
    text-align: center;
    padding: 3px 8px;
    border-radius: 5px;
    font-weight: 900;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .ov-elite { background: linear-gradient(180deg, #fde68a, #b45309); color: #1a1410; }
  .ov-good  { background: rgba(34, 197, 94, 0.22); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.45); }
  .ov-mid   { background: rgba(148, 163, 184, 0.18); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.35); }
  .ov-low   { background: rgba(220, 38, 38, 0.16); color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.35); }

  /* 5 fasce ufficiali (scarso/medio/normale/buono/ottimo) */
  .pot-ottimo  { background: linear-gradient(180deg, #f0abfc, #a21caf); color: #fff; border: 1px solid rgba(232, 121, 249, 0.5); }
  .pot-buono   { background: rgba(168, 85, 247, 0.22); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.45); }
  .pot-normale { background: rgba(34, 197, 94, 0.18); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.4); }
  .pot-medio   { background: rgba(252, 211, 77, 0.16); color: #fde68a; border: 1px solid rgba(252, 211, 77, 0.35); }
  .pot-scarso  { background: rgba(120, 113, 108, 0.18); color: #a8a29e; border: 1px solid rgba(120, 113, 108, 0.3); }

  .c-pot {
    display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  }
  .pot-tier-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0 4px;
    border-radius: 3px;
  }
  .pot-tier-label.pot-ottimo  { color: #f0abfc; }
  .pot-tier-label.pot-buono   { color: #d8b4fe; }
  .pot-tier-label.pot-normale { color: #86efac; }
  .pot-tier-label.pot-medio   { color: #fde68a; }
  .pot-tier-label.pot-scarso  { color: #a8a29e; }

  .c-club { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .crest {
    width: 28px; height: 28px;
    border-radius: 5px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff;
    font-weight: 800; font-size: 10px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .crest.small { width: 24px; height: 24px; font-size: 9px; }
  .team-name {
    color: #d4cfc1;
    font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .c-val { color: #fef3c7; font-weight: 700; font-variant-numeric: tabular-nums; }

  .status-chip {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .status-chip.in {
    background: rgba(34, 197, 94, 0.16);
    color: #86efac;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }
  .status-chip.out {
    background: rgba(120, 113, 108, 0.16);
    color: #d4cfc1;
    border: 1px solid rgba(120, 113, 108, 0.3);
  }
  .muted { color: #918778; font-size: 13px; }

  .promote-btn {
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 6px;
  }

  /* ===== INFO ===== */
  .info-note {
    padding: 14px 18px;
    background: rgba(252, 211, 77, 0.04);
    border: 1px solid rgba(252, 211, 77, 0.14);
    border-radius: 8px;
    color: #b8b0a0;
    font-size: 12.5px;
    line-height: 1.55;
  }
  .info-note p { margin: 0 0 6px; }
  .info-note p:last-child { margin: 0; }

  @media (max-width: 1100px) {
    .prow { grid-template-columns: 50px 1.5fr 50px 60px 60px 130px; row-gap: 6px; }
    .prow .c-status, .prow .c-action, .prow .c-val { grid-column: 1 / -1; text-align: right; }
  }
  @media (max-width: 700px) {
    .yt-head { grid-template-columns: 1fr; }
    .head-r { grid-template-columns: repeat(2, 1fr); }
  }
</style>
