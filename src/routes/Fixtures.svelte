<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore } from '$state/career.svelte'
  import type { Fixture } from '$engine/competition/types'

  const store = careerStore()
  let career = $derived(store.career)

  onMount(() => { if (!career) push('/') })

  type FilterMode = 'all' | 'home' | 'away'
  let filter = $state<FilterMode>('all')

  let myId = $derived(career?.club.teamId ?? '')

  let myFixtures = $derived<Fixture[]>(
    career
      ? career.fixtures
          .filter(f => f.homeId === myId || f.awayId === myId)
          .filter(f => filter === 'all' || (filter === 'home' ? f.homeId === myId : f.awayId === myId))
          .sort((a, b) => a.matchday - b.matchday)
      : []
  )

  function teamName(id: string): string { return career?.teams[id]?.name ?? '???' }
  function teamShort(id: string): string { return career?.teams[id]?.shortName ?? '???' }
  function colors(id: string) {
    const t = career?.teams[id]
    return { c1: t?.primaryColor ?? '#444', c2: t?.secondaryColor ?? '#888' }
  }

  function verdict(f: Fixture): 'win' | 'loss' | 'draw' | null {
    if (f.status !== 'played' || !f.result) return null
    const isHome = f.homeId === myId
    const my = isHome ? f.result.homeScore : f.result.awayScore
    const opp = isHome ? f.result.awayScore : f.result.homeScore
    if (my > opp) return 'win'
    if (my < opp) return 'loss'
    return 'draw'
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
    } catch { return iso }
  }
</script>

<AppShell>
  {#if !career}
    <div class="loading"><div class="spinner"></div></div>
  {:else}
    <div class="head">
      <h1 class="text-gold title">Calendario</h1>
      <div class="filters">
        <button class="filter" class:active={filter === 'all'} onclick={() => filter = 'all'}>Tutte</button>
        <button class="filter" class:active={filter === 'home'} onclick={() => filter = 'home'}>Casa</button>
        <button class="filter" class:active={filter === 'away'} onclick={() => filter = 'away'}>Trasferta</button>
      </div>
    </div>

    <div class="list card-gold anim-kickin">
      {#each myFixtures as f, i}
        {@const isHome = f.homeId === myId}
        {@const oppId = isHome ? f.awayId : f.homeId}
        {@const v = verdict(f)}
        <div
          class="row"
          class:current={f.matchday === career.season.currentMatchday}
          class:played={f.status === 'played'}
        >
          <span class="md">G{f.matchday}</span>
          <span class="date">{fmtDate(f.date)}</span>
          <span class="venue">{isHome ? 'CASA' : 'TRAS'}</span>
          <span class="opp">
            <span class="crest-mini" style="--c1: {colors(oppId).c1}; --c2: {colors(oppId).c2};">{teamShort(oppId)}</span>
            <span class="opp-name">{teamName(oppId)}</span>
          </span>
          {#if f.status === 'played' && f.result}
            <span class="score">{f.result.homeScore} - {f.result.awayScore}</span>
            <span class="verdict v-{v}">{v === 'win' ? 'V' : v === 'loss' ? 'P' : 'N'}</span>
          {:else}
            <span class="score muted">—</span>
            <span class="verdict v-pending">–</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</AppShell>

<style>
  .head {
    display: flex; align-items: center; gap: 20px;
    margin-bottom: 24px; flex-wrap: wrap;
  }
  .title { font-size: 32px; font-weight: 800; margin: 0; }

  .filters { display: flex; gap: 6px; }
  .filter {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(252, 211, 77, 0.2);
    color: #c8bfa8;
    padding: 8px 14px;
    border-radius: 8px;
    font: 600 12px/1 inherit;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: all 0.15s;
  }
  .filter:hover { color: #fef3c7; border-color: rgba(252, 211, 77, 0.45); }
  .filter.active {
    background: linear-gradient(180deg, #fde68a, #fbbf24, #d97706);
    color: #1a1410;
    border-color: #fcd34d;
  }

  .list { padding: 0; overflow: hidden; }
  .row {
    display: grid;
    grid-template-columns: 40px 70px 60px 1fr 80px 40px;
    align-items: center;
    padding: 12px 18px;
    gap: 12px;
    font-size: 13px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.06);
    transition: background 0.15s;
  }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: rgba(252, 211, 77, 0.05); }
  .row.current {
    background: rgba(252, 211, 77, 0.10);
    border-left: 3px solid #fcd34d;
    padding-left: 15px;
  }
  .row.played { color: #d4cfc1; }

  .md {
    color: #fcd34d;
    font-weight: 700;
    font-family: var(--font-mono, monospace);
    text-align: center;
    font-size: 12px;
  }
  .date { color: #918778; font-size: 12px; }
  .venue {
    color: #c8bfa8;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    padding: 3px 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    text-align: center;
  }
  .opp { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .crest-mini {
    width: 28px; height: 28px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 10px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    flex-shrink: 0;
  }
  .opp-name {
    color: #fef3c7;
    font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .score { text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
  .muted { color: #555; }
  .verdict {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    border-radius: 6px;
    font-weight: 800; font-size: 11px;
  }
  .v-win  { background: rgba(34, 197, 94, 0.2); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.5); }
  .v-loss { background: rgba(220, 38, 38, 0.2); color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.5); }
  .v-draw { background: rgba(252, 211, 77, 0.2); color: #fde68a; border: 1px solid rgba(252, 211, 77, 0.5); }
  .v-pending { background: transparent; color: #555; border: 1px dashed rgba(255, 255, 255, 0.1); }

  .loading { display: grid; place-items: center; min-height: 50vh; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 600px) {
    .row { grid-template-columns: 36px 60px 1fr 60px 32px; }
    .venue { display: none; }
  }
</style>
