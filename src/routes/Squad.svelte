<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore } from '$state/career.svelte'
  import { calcOverall } from '$engine/gen/player'
  import type { Player, Position } from '$engine/types'

  const store = careerStore()
  let career = $derived(store.career)

  onMount(() => { if (!career) push('/') })

  let squad = $derived<Player[]>(
    career
      ? Object.values(career.players)
          .filter(p => p.teamId === career!.club.teamId)
      : []
  )

  type Group = { label: string; key: 'GK' | 'DEF' | 'MID' | 'ATT'; players: Player[] }
  const POS_ROLE: Record<Position, 'GK' | 'DEF' | 'MID' | 'ATT'> = {
    GK: 'GK',
    CB: 'DEF', LB: 'DEF', RB: 'DEF', WB: 'DEF',
    DM: 'MID', CM: 'MID', AM: 'MID', LM: 'MID', RM: 'MID',
    LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT',
  }

  let groups = $derived<Group[]>([
    { label: 'Portieri',       key: 'GK',  players: squad.filter(p => POS_ROLE[p.position] === 'GK')
        .sort((a, b) => calcOverall(b) - calcOverall(a)) },
    { label: 'Difensori',      key: 'DEF', players: squad.filter(p => POS_ROLE[p.position] === 'DEF')
        .sort((a, b) => calcOverall(b) - calcOverall(a)) },
    { label: 'Centrocampisti', key: 'MID', players: squad.filter(p => POS_ROLE[p.position] === 'MID')
        .sort((a, b) => calcOverall(b) - calcOverall(a)) },
    { label: 'Attaccanti',     key: 'ATT', players: squad.filter(p => POS_ROLE[p.position] === 'ATT')
        .sort((a, b) => calcOverall(b) - calcOverall(a)) },
  ])

  function age(birthDate: string): number {
    const b = new Date(birthDate)
    const now = career ? new Date(`${career.season.year}-08-01`) : new Date()
    let a = now.getFullYear() - b.getFullYear()
    const m = now.getMonth() - b.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
    return a
  }

  function fmtValue(v: number): string {
    if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`
    if (v >= 1_000) return `€${Math.round(v / 1_000)}k`
    return `€${v}`
  }

  function ovColor(ov: number): string {
    if (ov >= 80) return 'ov-elite'
    if (ov >= 70) return 'ov-good'
    if (ov >= 55) return 'ov-mid'
    return 'ov-low'
  }
</script>

<AppShell>
  {#if !career}
    <div class="loading"><div class="spinner"></div></div>
  {:else}
    <div class="head">
      <h1 class="text-gold title">Rosa</h1>
      <span class="chip-gold">{squad.length} giocatori</span>
    </div>

    {#each groups as g}
      <section class="group anim-kickin">
        <h2 class="g-label">{g.label} <span class="g-count">· {g.players.length}</span></h2>
        <div class="table card-gold">
          <div class="row head-row">
            <span class="c-shirt">#</span>
            <span class="c-name">Nome</span>
            <span class="c-pos">Pos</span>
            <span class="c-age">Età</span>
            <span class="c-ov">OV</span>
            <span class="c-val">Valore</span>
            <span class="c-mor">Mor</span>
            <span class="c-fit">Fit</span>
          </div>
          {#each g.players as p}
            <div class="row">
              <span class="c-shirt">{p.shirtNumber ?? '—'}</span>
              <span class="c-name">{p.firstName} {p.lastName}</span>
              <span class="c-pos">{p.position}</span>
              <span class="c-age">{age(p.birthDate)}</span>
              <span class="c-ov"><span class="ov-badge {ovColor(calcOverall(p))}">{calcOverall(p)}</span></span>
              <span class="c-val">{fmtValue(p.marketValue)}</span>
              <span class="c-mor">{p.morale}</span>
              <span class="c-fit">{p.fitness}</span>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</AppShell>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }
  .title { font-size: 32px; font-weight: 800; margin: 0; }

  .group { margin-bottom: 26px; }
  .g-label {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: #fcd34d;
    font-weight: 700;
  }
  .g-count { color: #918778; font-weight: 500; letter-spacing: 0.05em; }

  .table { padding: 0; overflow: hidden; }
  .row {
    display: grid;
    grid-template-columns: 50px 1fr 60px 50px 60px 100px 50px 50px;
    align-items: center;
    padding: 10px 16px;
    gap: 8px;
    font-size: 13px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.06);
    transition: background 0.15s;
  }
  .row:last-child { border-bottom: 0; }
  .row:not(.head-row):hover { background: rgba(252, 211, 77, 0.05); }
  .head-row {
    background: rgba(0, 0, 0, 0.5);
    color: #fcd34d;
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .c-name { color: #fef3c7; font-weight: 600; }
  .c-pos { color: #d4cfc1; font-family: var(--font-mono, monospace); }
  .c-age, .c-mor, .c-fit, .c-shirt { color: #b8b0a0; text-align: center; }
  .c-val { color: #fde68a; font-variant-numeric: tabular-nums; }

  .ov-badge {
    display: inline-block;
    min-width: 36px;
    text-align: center;
    padding: 4px 8px;
    border-radius: 6px;
    font-weight: 800;
    font-size: 13px;
  }
  .ov-elite { background: linear-gradient(180deg, #fde68a, #b45309); color: #1a1410; }
  .ov-good  { background: rgba(34, 197, 94, 0.25); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.4); }
  .ov-mid   { background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.35); }
  .ov-low   { background: rgba(220, 38, 38, 0.18); color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.35); }

  .loading { display: grid; place-items: center; min-height: 50vh; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 760px) {
    .row {
      grid-template-columns: 40px 1fr 50px 40px 50px;
    }
    .c-val, .c-mor, .c-fit { display: none; }
  }
</style>
