<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { fmtMoney, ensureClubFinances } from '$engine/career/finances'
  import {
    STADIUM_WORK_CATALOG,
    startStadiumWork,
    workProgress,
    getStadiumWorkSpec,
  } from '$engine/career/stadium'
  import type { StadiumWorkType } from '$engine/types'

  const store = careerStore()
  let career = $derived(store.career)
  let myTeam = $derived(career ? career.teams[career.club.teamId] : null)
  let stadium = $derived(career && myTeam ? career.stadiums[myTeam.stadiumId] : null)
  let finances = $derived(career ? ensureClubFinances(career) : null)
  let activeWork = $derived(stadium?.activeWork ?? null)
  let activeSpec = $derived(activeWork ? getStadiumWorkSpec(activeWork.type) : null)

  let actionMsg = $state<string | null>(null)
  let actionOk = $state(false)

  onMount(() => { if (!career) push('/') })

  async function handleStart(type: StadiumWorkType) {
    if (!career) return
    const res = startStadiumWork(career, type)
    if (res.ok) {
      actionOk = true
      actionMsg = 'Lavori avviati. Rata settimanale attiva al prossimo matchday.'
      await persistActiveCareer()
    } else {
      actionOk = false
      actionMsg = res.reason ?? 'Operazione non riuscita.'
    }
    setTimeout(() => { actionMsg = null }, 4500)
  }

  function canAfford(cost: number): boolean {
    return (finances?.cash ?? 0) >= cost * 0.30
  }

  function pitchClass(q: number): string {
    if (q >= 90) return 'a-top'
    if (q >= 75) return 'a-good'
    if (q >= 55) return 'a-mid'
    if (q >= 40) return 'a-low'
    return 'a-bad'
  }

  function fmtWeeks(n: number): string {
    if (n < 4) return `${n} sett.`
    return `${Math.round(n / 4.33)} mesi (${n} sett.)`
  }
</script>

<AppShell>
  {#if !career || !myTeam || !stadium || !finances}
    <div class="loading"><div class="spinner"></div></div>
  {:else}
    <header class="stad-head card-gold anim-kickin">
      <div class="head-l">
        <div class="stad-icon">🏟️</div>
        <div>
          <h1 class="stad-name">{stadium.name}</h1>
          <div class="stad-sub">{myTeam.city} · Casa del {myTeam.name}</div>
        </div>
      </div>
      <div class="head-r">
        <div class="meta-tile">
          <span class="meta-l">Capacità</span>
          <span class="meta-v text-gold">{stadium.capacity.toLocaleString('it-IT')}</span>
          <span class="meta-sub">posti</span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">Qualità campo</span>
          <span class="meta-v {pitchClass(stadium.pitchQuality)}">{stadium.pitchQuality}/100</span>
          <span class="meta-sub">{stadium.pitchQuality >= 85 ? 'Eccellente' : stadium.pitchQuality >= 70 ? 'Buona' : stadium.pitchQuality >= 55 ? 'Discreta' : 'Da rifare'}</span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">Bonus Premium</span>
          <span class="meta-v">+€{stadium.premiumPriceBonus ?? 0}</span>
          <span class="meta-sub">su prezzo biglietto</span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">Cassa club</span>
          <span class="meta-v text-gold">{fmtMoney(finances.cash)}</span>
          <span class="meta-sub">disponibile</span>
        </div>
      </div>
    </header>

    {#if actionMsg}
      <div class="action-banner" class:ok={actionOk} class:err={!actionOk}>
        {actionMsg}
      </div>
    {/if}

    {#if activeWork && activeSpec}
      {@const progress = workProgress(activeWork)}
      <section class="card-gold work-active anim-kickin">
        <div class="work-active-head">
          <span class="work-icon">{activeSpec.icon}</span>
          <div>
            <h3 class="work-active-title">{activeSpec.name}</h3>
            <div class="work-active-desc">{activeSpec.description}</div>
          </div>
          <div class="work-active-status">In corso</div>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar">
            <div class="progress-fill" style="width: {progress * 100}%"></div>
          </div>
          <div class="progress-meta">
            <span><strong>{Math.round(progress * 100)}%</strong> completato</span>
            <span>{activeWork.remainingMatchdays} settimane rimanenti</span>
          </div>
        </div>
        <div class="work-active-stats">
          <div class="stat">
            <span class="stat-l">Pagato finora</span>
            <span class="stat-v text-gold">{fmtMoney(activeWork.paidSoFar)}</span>
          </div>
          <div class="stat">
            <span class="stat-l">Costo totale</span>
            <span class="stat-v">{fmtMoney(activeWork.totalCost)}</span>
          </div>
          <div class="stat">
            <span class="stat-l">Rata settimanale</span>
            <span class="stat-v">{fmtMoney(Math.round(activeWork.totalCost / activeWork.durationMatchdays))}</span>
          </div>
        </div>
      </section>
    {/if}

    <section class="works-grid">
      <h2 class="section-h">{activeWork ? 'Catalogo lavori (1 alla volta)' : 'Lavori disponibili'}</h2>
      <div class="works-list">
        {#each STADIUM_WORK_CATALOG as spec (spec.type)}
          {@const afford = canAfford(spec.totalCost)}
          {@const disabled = !!activeWork || !afford}
          <article class="work-card card-gold" class:disabled>
            <div class="work-card-head">
              <span class="work-icon">{spec.icon}</span>
              <h4 class="work-card-title">{spec.name}</h4>
            </div>
            <p class="work-card-desc">{spec.description}</p>
            <div class="work-card-meta">
              <div class="meta-row">
                <span class="meta-l">Costo totale</span>
                <span class="meta-v text-gold">{fmtMoney(spec.totalCost)}</span>
              </div>
              <div class="meta-row">
                <span class="meta-l">Durata</span>
                <span class="meta-v">{fmtWeeks(spec.durationMatchdays)}</span>
              </div>
              <div class="meta-row">
                <span class="meta-l">Rata settimanale</span>
                <span class="meta-v">{fmtMoney(Math.round(spec.totalCost / spec.durationMatchdays))}</span>
              </div>
              {#if spec.capacityDelta}
                <div class="meta-row eff">
                  <span class="meta-l">Effetto</span>
                  <span class="meta-v text-gold">+{spec.capacityDelta.toLocaleString('it-IT')} posti</span>
                </div>
              {/if}
              {#if spec.pitchQualityDelta}
                <div class="meta-row eff">
                  <span class="meta-l">Effetto</span>
                  <span class="meta-v text-gold">+{spec.pitchQualityDelta} qualità campo</span>
                </div>
              {/if}
              {#if spec.premiumPriceDelta}
                <div class="meta-row eff">
                  <span class="meta-l">Effetto</span>
                  <span class="meta-v text-gold">+€{spec.premiumPriceDelta} prezzo biglietto</span>
                </div>
              {/if}
            </div>
            <button
              class="btn-gold work-start-btn"
              {disabled}
              onclick={() => handleStart(spec.type)}
            >
              {#if activeWork}
                Cantiere occupato
              {:else if !afford}
                Cassa insufficiente (servono ≥{fmtMoney(spec.totalCost * 0.30)})
              {:else}
                ▶ Avvia lavori
              {/if}
            </button>
          </article>
        {/each}
      </div>
    </section>

    <section class="info-note">
      <p>
        I lavori sullo stadio si pagano <strong>rateizzati ogni settimana</strong> (1 matchday).
        Quando il cantiere termina, gli effetti si applicano <strong>immediatamente</strong>:
        l'incasso da gate ai prossimi match casalinghi rifletterà la nuova capacità o il nuovo
        prezzo medio biglietto.
      </p>
      <p>
        Per avviare un lavoro serve avere almeno <strong>il 30% del costo</strong> in cassa
        (così copri le prime rate e mantieni un buffer per gli stipendi).
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
  .stad-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    align-items: center;
    padding: 22px 28px;
    margin-bottom: 16px;
  }
  .head-l { display: flex; align-items: center; gap: 18px; }
  .stad-icon {
    font-size: 52px;
    line-height: 1;
    filter: drop-shadow(0 4px 12px rgba(252, 211, 77, 0.35));
  }
  .stad-name {
    margin: 0;
    font-size: 26px;
    font-weight: 800;
    color: #fef3c7;
  }
  .stad-sub { color: #b8b0a0; font-size: 13px; margin-top: 4px; }

  .head-r {
    display: grid;
    grid-template-columns: repeat(4, auto);
    gap: 18px 24px;
  }
  .meta-tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 90px;
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
    font-size: 20px;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .meta-sub { color: #918778; font-size: 11px; }

  .a-top  { color: #fde68a; }
  .a-good { color: #86efac; }
  .a-mid  { color: #cbd5e1; }
  .a-low  { color: #fdba74; }
  .a-bad  { color: #fca5a5; }

  /* ===== ACTION BANNER ===== */
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

  /* ===== WORK ATTIVO ===== */
  .work-active {
    padding: 20px 24px;
    margin-bottom: 18px;
  }
  .work-active-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 16px;
    align-items: center;
    margin-bottom: 14px;
  }
  .work-icon { font-size: 32px; line-height: 1; }
  .work-active-title { margin: 0; font-size: 18px; color: #fef3c7; font-weight: 800; }
  .work-active-desc { color: #b8b0a0; font-size: 13px; margin-top: 3px; }
  .work-active-status {
    background: rgba(252, 211, 77, 0.16);
    color: #fcd34d;
    border: 1px solid rgba(252, 211, 77, 0.45);
    padding: 4px 12px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .progress-wrap { margin: 6px 0 14px; }
  .progress-bar {
    height: 12px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.45);
    overflow: hidden;
    border: 1px solid rgba(252, 211, 77, 0.18);
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #b45309, #fcd34d, #fde68a);
    transition: width 0.4s ease;
  }
  .progress-meta {
    display: flex; justify-content: space-between;
    color: #d4cfc1; font-size: 12px;
    margin-top: 6px;
  }
  .work-active-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(252, 211, 77, 0.14);
  }
  .stat { display: flex; flex-direction: column; gap: 3px; }
  .stat-l { color: #918778; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .stat-v { color: #fef3c7; font-weight: 800; font-size: 16px; }

  /* ===== WORKS GRID ===== */
  .section-h {
    color: #fcd34d;
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-weight: 700;
    margin: 6px 0 14px;
  }
  .works-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  .work-card {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: opacity 0.2s, transform 0.15s;
  }
  .work-card.disabled { opacity: 0.55; }
  .work-card:hover:not(.disabled) { transform: translateY(-2px); }

  .work-card-head { display: flex; align-items: center; gap: 12px; }
  .work-card-title { margin: 0; color: #fef3c7; font-size: 16px; font-weight: 800; }
  .work-card-desc { margin: 0; color: #b8b0a0; font-size: 13px; line-height: 1.45; }

  .work-card-meta {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px 0;
    border-top: 1px solid rgba(252, 211, 77, 0.12);
    border-bottom: 1px solid rgba(252, 211, 77, 0.12);
  }
  .meta-row { display: flex; justify-content: space-between; font-size: 12px; }
  .meta-row .meta-l { font-size: 11px; }
  .meta-row .meta-v { font-size: 13px; font-weight: 700; }
  .meta-row.eff .meta-v { color: #fde68a; }

  .work-start-btn { width: 100%; }
  .work-start-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .info-note {
    margin-top: 22px;
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
    .stad-head { grid-template-columns: 1fr; }
    .head-r { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 700px) {
    .works-list { grid-template-columns: 1fr; }
    .work-active-stats { grid-template-columns: 1fr; }
    .head-r { grid-template-columns: 1fr 1fr; }
  }
</style>
