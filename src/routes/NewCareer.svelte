<script lang="ts">
  import { push } from 'svelte-spa-router'
  import {
    generateWorldPreview, buildCareerFromPreview,
    type PreviewWorld
  } from '$engine/career/career'
  import { saveCareer } from '$storage/db'
  import { setActiveCareer } from '$state/career.svelte'
  import type { League, Team } from '$engine/types'

  type Step = 1 | 2 | 3 | 'creating'

  let step = $state<Step>(1)
  let managerName = $state('')
  let selectedLeagueId = $state<string | null>(null)
  let selectedTeamId = $state<string | null>(null)
  let preview = $state<PreviewWorld | null>(null)
  let creating = $state(false)
  let errorMsg = $state<string | null>(null)

  // Genera mondo all'ingresso step 2 (deterministico e veloce).
  function ensureWorld() {
    if (preview) return
    try {
      preview = generateWorldPreview()
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
    }
  }

  let leagues = $derived<League[]>(
    preview ? Object.values(preview.world.leagues).sort((a, b) => a.tier - b.tier) : []
  )

  let teamsOfLeague = $derived<Team[]>(
    preview && selectedLeagueId
      ? (preview.world.leagues[selectedLeagueId]?.teamIds ?? [])
          .map(id => preview!.world.teams[id])
          .filter((t): t is Team => !!t)
          .sort((a, b) => b.reputation - a.reputation)
      : []
  )

  let selectedTeam = $derived<Team | null>(
    preview && selectedTeamId ? (preview.world.teams[selectedTeamId] ?? null) : null
  )

  function canAdvance(): boolean {
    if (step === 1) return managerName.trim().length >= 2
    if (step === 2) return !!selectedLeagueId
    if (step === 3) return !!selectedTeamId
    return false
  }

  function back() {
    if (step === 2) { step = 1; return }
    if (step === 3) { selectedTeamId = null; step = 2; return }
    push('/')
  }

  function next() {
    if (!canAdvance()) return
    if (step === 1) { ensureWorld(); step = 2; return }
    if (step === 2) { step = 3; return }
    if (step === 3) confirm()
  }

  async function confirm() {
    if (!preview || !selectedTeamId || creating) return
    creating = true
    step = 'creating'
    errorMsg = null
    try {
      const career = buildCareerFromPreview(preview, {
        managerName: managerName.trim(),
        teamId: selectedTeamId,
      })
      await saveCareer(career)
      setActiveCareer(career)
      push('/dashboard')
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
      creating = false
      step = 3
    }
  }

  function formatBalance(eur: number): string {
    if (eur >= 1_000_000) return `€ ${(eur / 1_000_000).toFixed(1)}M`
    if (eur >= 1_000) return `€ ${(eur / 1_000).toFixed(0)}k`
    return `€ ${eur}`
  }

  function tierLabel(t: number): string {
    return t === 1 ? 'PRIMA DIVISIONE' : t === 2 ? 'SECONDA DIVISIONE' : `T${t}`
  }
</script>

<div class="page stadium-bg">
  <div class="topbar">
    <button class="btn-ghost back" onclick={back} aria-label="Indietro" title={step === 1 ? 'Torna alla home' : 'Indietro'}>
      ←
    </button>
    <div class="stepper">
      <div class="step" class:done={step !== 1 && step !== 'creating'} class:current={step === 1}>1 · Manager</div>
      <div class="sep"></div>
      <div class="step" class:done={step === 3} class:current={step === 2}>2 · Lega</div>
      <div class="sep"></div>
      <div class="step" class:current={step === 3}>3 · Squadra</div>
    </div>
    <span class="grow"></span>
  </div>

  {#if errorMsg}
    <div class="error">{errorMsg}</div>
  {/if}

  <div class="content">
    {#if step === 1}
      <section class="card-gold pane anim-kickin">
        <h1 class="title text-gold">Inizia la tua carriera</h1>
        <p class="lead">Scegli il tuo nome da allenatore. Sarà mostrato nelle news del club, nelle interviste, sui giornali.</p>
        <label class="label" for="mgr-input">Nome del mister</label>
        <input
          id="mgr-input"
          class="input"
          type="text"
          maxlength="32"
          placeholder="Es. Roberto Ramazio"
          bind:value={managerName}
          onkeydown={(e) => { if (e.key === 'Enter' && canAdvance()) next() }}
        />
        <p class="hint">Almeno 2 caratteri.</p>
      </section>
    {:else if step === 2}
      <section class="anim-kickin">
        <h1 class="title text-gold">Scegli la lega</h1>
        <p class="lead">Due divisioni: la massima serie con i club più ricchi e blasonati, oppure la cadetteria con squadre più tascabili ma da scalare.</p>
        <div class="leagues">
          {#each leagues as lg}
            <button
              class="card-gold league-card card-gold-hover"
              class:selected={selectedLeagueId === lg.id}
              onclick={() => { selectedLeagueId = lg.id; selectedTeamId = null }}
            >
              <span class="chip-gold">{tierLabel(lg.tier)}</span>
              <h2 class="lg-name text-metallic">{lg.name}</h2>
              <p class="lg-desc">
                {lg.teamIds.length} squadre · campionato a girone unico, andata e ritorno
              </p>
            </button>
          {/each}
        </div>
      </section>
    {:else if step === 3}
      <section class="anim-kickin">
        <h1 class="title text-gold">Scegli la tua squadra</h1>
        <p class="lead">
          Ogni club ha reputazione, budget e rosa diversi.
          Scegli quella che vuoi allenare per la stagione {preview?.seasonYear}/{(preview?.seasonYear ?? 2026) + 1}.
        </p>
        <div class="teams">
          {#each teamsOfLeague as team}
            <button
              class="card-gold team-card card-gold-hover"
              class:selected={selectedTeamId === team.id}
              onclick={() => selectedTeamId = team.id}
              title={team.name}
            >
              <span class="crest" style="--c1: {team.primaryColor}; --c2: {team.secondaryColor};">{team.shortName}</span>
              <div class="team-info">
                <div class="t-name">{team.name}</div>
                <div class="t-meta">{team.city} · fondato {team.founded}</div>
                <div class="t-stats">
                  <span class="stat"><span class="stat-l">REP</span> {team.reputation}</span>
                  <span class="stat"><span class="stat-l">BUDGET</span> {formatBalance(team.balance)}</span>
                </div>
              </div>
            </button>
          {/each}
        </div>
      </section>
    {:else if step === 'creating'}
      <section class="creating anim-kickin">
        <div class="spinner"></div>
        <h2 class="text-gold">Costruzione carriera…</h2>
        <p>Stiamo generando rosa, calendario e federazioni. Un attimo.</p>
      </section>
    {/if}
  </div>

  {#if step !== 'creating'}
    <div class="footer">
      {#if selectedTeam && step === 3}
        <div class="picked">
          <span class="picked-l">SELEZIONATA:</span>
          <strong>{selectedTeam.name}</strong>
        </div>
      {/if}
      <button class="btn-outline-gold" onclick={back}>Indietro</button>
      <button class="btn-gold" disabled={!canAdvance()} onclick={next}>
        {step === 3 ? 'Conferma e inizia' : 'Avanti'} →
      </button>
    </div>
  {/if}
</div>

<style>
  .page {
    min-height: 100vh;
    width: 100vw;
    padding: 24px clamp(16px, 4vw, 56px) 100px;
    box-sizing: border-box;
    color: #fef3c7;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
  }
  .grow { flex: 1; }
  .back { font-size: 18px; font-weight: 700; }

  .stepper {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    font-weight: 600;
    color: rgba(252, 211, 77, 0.45);
  }
  .step {
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid rgba(252, 211, 77, 0.15);
    background: rgba(0, 0, 0, 0.4);
    transition: all 0.2s ease;
  }
  .step.current {
    color: #1a1410;
    background: linear-gradient(180deg, #fde68a, #fbbf24, #d97706);
    border-color: #fcd34d;
    box-shadow: 0 0 24px rgba(245, 158, 11, 0.4);
  }
  .step.done {
    color: #fcd34d;
    border-color: rgba(252, 211, 77, 0.5);
  }
  .sep { width: 18px; height: 1px; background: rgba(252, 211, 77, 0.2); }

  .content { max-width: 1200px; margin: 0 auto; }

  .pane {
    padding: 40px 48px;
    max-width: 600px;
    margin: 32px auto;
  }
  .title {
    font-size: clamp(28px, 4vw, 44px);
    font-weight: 800;
    margin: 0 0 12px;
    line-height: 1.1;
  }
  .lead {
    color: #d4cfc1;
    font-size: 15px;
    line-height: 1.5;
    margin: 0 0 28px;
  }
  .label {
    display: block;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-size: 11px;
    font-weight: 700;
    color: #fcd34d;
    margin: 0 0 8px;
  }
  .input {
    width: 100%;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(252, 211, 77, 0.3);
    color: #fef3c7;
    font-size: 17px;
    padding: 14px 16px;
    border-radius: 10px;
    font-family: inherit;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .input:focus {
    outline: none;
    border-color: #fcd34d;
    box-shadow: 0 0 0 3px rgba(252, 211, 77, 0.2);
  }
  .hint { color: #918778; font-size: 12px; margin: 8px 0 0; }

  .leagues {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
    margin-top: 24px;
  }
  .league-card {
    padding: 28px 24px;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    border: 1px solid rgba(252, 211, 77, 0.15);
  }
  .league-card.selected {
    border-color: #fcd34d;
    box-shadow: 0 0 0 2px rgba(252, 211, 77, 0.5), 0 20px 60px -15px rgba(245, 158, 11, 0.4);
  }
  .lg-name { font-size: 24px; margin: 14px 0 8px; font-weight: 800; }
  .lg-desc { color: #b8b0a0; font-size: 13px; margin: 0; }

  .teams {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
    margin-top: 20px;
  }
  .team-card {
    display: flex;
    gap: 14px;
    padding: 14px;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    align-items: center;
  }
  .team-card.selected {
    border-color: #fcd34d;
    box-shadow: 0 0 0 2px rgba(252, 211, 77, 0.5);
  }
  .crest {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    justify-content: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .team-info { flex: 1; min-width: 0; }
  .t-name {
    font-weight: 700;
    color: #fef3c7;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t-meta { color: #918778; font-size: 11px; margin-top: 2px; }
  .t-stats { display: flex; gap: 14px; margin-top: 6px; font-size: 11px; color: #d4cfc1; }
  .stat-l { color: #fcd34d; font-weight: 700; letter-spacing: 0.1em; margin-right: 4px; }

  .footer {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.85) 30%, rgba(0, 0, 0, 0.95));
    backdrop-filter: blur(8px);
    padding: 20px clamp(16px, 4vw, 56px);
    display: flex;
    align-items: center;
    gap: 14px;
    z-index: 5;
    border-top: 1px solid rgba(252, 211, 77, 0.15);
  }
  .picked { margin-right: auto; font-size: 13px; color: #d4cfc1; }
  .picked-l {
    color: #fcd34d;
    font-weight: 700;
    letter-spacing: 0.1em;
    margin-right: 8px;
    font-size: 11px;
    text-transform: uppercase;
  }

  .error {
    max-width: 800px;
    margin: 0 auto 20px;
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.5);
    color: #fecaca;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 13px;
  }

  .creating { text-align: center; padding: 60px 20px; }
  .spinner {
    width: 48px;
    height: 48px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    margin: 0 auto 20px;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
