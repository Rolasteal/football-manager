<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore } from '$state/career.svelte'
  import { computeStandings } from '$engine/competition/standings'

  const store = careerStore()
  let career = $derived(store.career)

  onMount(() => { if (!career) push('/') })

  let leagues = $derived(career ? Object.values(career.leagues).sort((a, b) => a.tier - b.tier) : [])
  let myLeagueId = $derived(
    career
      ? (Object.values(career.leagues).find(l => l.teamIds.includes(career!.club.teamId))?.id ?? leagues[0]?.id ?? '')
      : ''
  )
  let selectedLeagueId = $state<string>('')

  $effect(() => {
    if (!selectedLeagueId && myLeagueId) selectedLeagueId = myLeagueId
  })

  let activeLeague = $derived(career && selectedLeagueId ? career.leagues[selectedLeagueId] : null)
  let standings = $derived(
    career && activeLeague
      ? computeStandings(career.fixtures.filter(f => f.leagueId === activeLeague!.id), activeLeague.teamIds)
      : []
  )

  function teamName(id: string): string { return career?.teams[id]?.name ?? '???' }
  function teamShort(id: string): string { return career?.teams[id]?.shortName ?? '???' }
  function colors(id: string) {
    const t = career?.teams[id]
    return { c1: t?.primaryColor ?? '#444', c2: t?.secondaryColor ?? '#888' }
  }
</script>

<AppShell>
  {#if !career}
    <div class="loading"><div class="spinner"></div></div>
  {:else}
    <div class="head">
      <h1 class="text-gold title">Classifica</h1>
      <div class="tabs">
        {#each leagues as lg}
          <button
            class="tab"
            class:active={selectedLeagueId === lg.id}
            onclick={() => selectedLeagueId = lg.id}
          >
            {lg.name}
          </button>
        {/each}
      </div>
    </div>

    <div class="list card-gold anim-kickin">
      <div class="row head-row">
        <span class="c-pos">#</span>
        <span class="c-team">Squadra</span>
        <span>PG</span>
        <span>V</span>
        <span>N</span>
        <span>P</span>
        <span>GF</span>
        <span>GS</span>
        <span>DR</span>
        <span class="c-pts">PT</span>
        <span class="c-form">Forma</span>
      </div>
      {#each standings as r, i}
        {@const isMine = r.teamId === career.club.teamId}
        <div class="row" class:mine={isMine}>
          <span class="c-pos pos-{i + 1 <= 3 ? 'top' : i + 1 > standings.length - 3 ? 'bot' : 'mid'}">{i + 1}</span>
          <span class="c-team">
            <span class="crest-mini" style="--c1: {colors(r.teamId).c1}; --c2: {colors(r.teamId).c2};">{teamShort(r.teamId)}</span>
            <span class="t-name">{teamName(r.teamId)}</span>
          </span>
          <span>{r.played}</span>
          <span>{r.won}</span>
          <span>{r.drawn}</span>
          <span>{r.lost}</span>
          <span>{r.goalsFor}</span>
          <span>{r.goalsAgainst}</span>
          <span class:neg={r.goalDiff < 0} class:pos={r.goalDiff > 0}>{r.goalDiff > 0 ? '+' : ''}{r.goalDiff}</span>
          <span class="c-pts">{r.points}</span>
          <span class="c-form">
            {#each r.form as fr}
              <span class="form-pill f-{fr}">{fr}</span>
            {/each}
          </span>
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

  .tabs { display: flex; gap: 6px; }
  .tab {
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
  .tab:hover { color: #fef3c7; border-color: rgba(252, 211, 77, 0.45); }
  .tab.active {
    background: linear-gradient(180deg, #fde68a, #fbbf24, #d97706);
    color: #1a1410;
    border-color: #fcd34d;
  }

  .list { padding: 0; overflow: hidden; }
  .row {
    display: grid;
    grid-template-columns: 40px 1fr 40px 40px 40px 40px 50px 50px 50px 50px 130px;
    align-items: center;
    padding: 9px 14px;
    gap: 6px;
    font-size: 13px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.06);
    transition: background 0.15s;
    text-align: center;
  }
  .row:last-child { border-bottom: 0; }
  .row:not(.head-row):hover { background: rgba(252, 211, 77, 0.05); }
  .row.mine {
    background: rgba(252, 211, 77, 0.12);
    border-left: 3px solid #fcd34d;
    padding-left: 11px;
  }
  .head-row {
    background: rgba(0, 0, 0, 0.5);
    color: #fcd34d;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .c-pos {
    font-weight: 800;
    font-family: var(--font-mono, monospace);
  }
  .pos-top { color: #86efac; }
  .pos-bot { color: #fca5a5; }
  .pos-mid { color: #d4cfc1; }

  .c-team {
    display: flex; align-items: center; gap: 10px;
    text-align: left;
    min-width: 0;
  }
  .crest-mini {
    width: 26px; height: 26px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 10px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    flex-shrink: 0;
  }
  .t-name {
    color: #fef3c7;
    font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .c-pts { font-weight: 800; color: #fde68a; font-variant-numeric: tabular-nums; }
  .neg { color: #fca5a5; }
  .pos { color: #86efac; }

  .c-form { display: flex; gap: 3px; justify-content: flex-end; }
  .form-pill {
    width: 22px; height: 22px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 800;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .f-W { background: rgba(34, 197, 94, 0.35); color: #bbf7d0; }
  .f-D { background: rgba(252, 211, 77, 0.35); color: #fef3c7; }
  .f-L { background: rgba(220, 38, 38, 0.35); color: #fecaca; }

  .loading { display: grid; place-items: center; min-height: 50vh; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 900px) {
    .row {
      grid-template-columns: 32px 1fr 32px 50px 80px;
      gap: 8px;
    }
    .head-row { font-size: 9px; }
    .head-row span:nth-child(3),
    .head-row span:nth-child(4),
    .head-row span:nth-child(5),
    .head-row span:nth-child(7),
    .head-row span:nth-child(8),
    .head-row span:nth-child(9) { display: none; }
    .row:not(.head-row) span:nth-child(3),
    .row:not(.head-row) span:nth-child(4),
    .row:not(.head-row) span:nth-child(5),
    .row:not(.head-row) span:nth-child(7),
    .row:not(.head-row) span:nth-child(8),
    .row:not(.head-row) span:nth-child(9) { display: none; }
    .c-form { gap: 2px; }
    .form-pill { width: 18px; height: 18px; font-size: 9px; }
  }
</style>
