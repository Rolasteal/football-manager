<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { calcOverall } from '$engine/gen/player'
  import { ensurePlayerFMAttributes } from '$engine/gen/playerCompat'
  import {
    ensurePlayerContract,
    proposeRenewal,
    estimateFairWage,
    type RenewalOutcome,
  } from '$engine/career/contracts'
  import { fmtMoney } from '$engine/career/finances'
  import type { Player, Position, PlayerAttributes } from '$engine/types'

  interface Props { params?: { id?: string } }
  let { params = {} }: Props = $props()

  const store = careerStore()
  let career = $derived(store.career)
  let player = $derived<Player | null>(
    career && params?.id ? career.players[params.id] ?? null : null
  )
  let team = $derived(player && player.teamId && career ? career.teams[player.teamId] : null)

  // Backward-compat lazy: popola attributi FM e contratto mancanti su save legacy.
  // Idempotente, side-effect su player (chiamato in $effect per non mutare
  // durante il rendering del template).
  $effect(() => {
    if (player) {
      ensurePlayerFMAttributes(player)
      if (career && team) ensurePlayerContract(player, team, career.season.year, career.seed)
    }
  })

  onMount(() => { if (!career) push('/') })

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
  /** Colorazione barra attributo scala 1-20 (stile FM). */
  function attrClass(v: number): string {
    if (v >= 16) return 'a-top'
    if (v >= 13) return 'a-good'
    if (v >= 10) return 'a-mid'
    if (v >= 7)  return 'a-low'
    return 'a-bad'
  }
  function ovClass(ov: number): string {
    if (ov >= 80) return 'ov-elite'
    if (ov >= 70) return 'ov-good'
    if (ov >= 55) return 'ov-mid'
    return 'ov-low'
  }
  function footLabel(f: 'left' | 'right' | 'both'): string {
    return f === 'left' ? 'Sinistro' : f === 'right' ? 'Destro' : 'Ambidestro'
  }
  const POSITION_LABEL: Record<Position, string> = {
    GK: 'Portiere',
    CB: 'Difensore centrale', LB: 'Terzino sinistro', RB: 'Terzino destro', WB: 'Quinto',
    DM: 'Mediano', CM: 'Centrocampista', AM: 'Trequartista',
    LM: 'Mezzala sinistra', RM: 'Mezzala destra',
    LW: 'Ala sinistra', RW: 'Ala destra', CF: 'Seconda punta', ST: 'Punta',
  }

  interface AttrGroup { label: string; keys: Array<{ key: keyof PlayerAttributes; label: string }> }

  /** Tecnici FM (14 attributi, outfield) — alfabetico italiano */
  const TECH: AttrGroup = {
    label: 'Tecnici',
    keys: [
      { key: 'corners',       label: 'Calci d\'angolo' },
      { key: 'heading',       label: 'Colpo di testa' },
      { key: 'tackling',      label: 'Contrasto' },
      { key: 'crossing',      label: 'Cross' },
      { key: 'dribbling',     label: 'Dribbling' },
      { key: 'finishing',     label: 'Finalizzazione' },
      { key: 'marking',       label: 'Marcatura' },
      { key: 'passing',       label: 'Passaggio' },
      { key: 'firstTouch',    label: 'Primo controllo' },
      { key: 'penaltyTaking', label: 'Rigori' },
      { key: 'longThrows',    label: 'Rimesse lunghe' },
      { key: 'longShots',     label: 'Tiro da fuori' },
      { key: 'freeKicks',     label: 'Punizioni' },
      { key: 'technique',     label: 'Tecnica' },
    ],
  }

  /** Goalkeeping FM (11 attributi, GK) — alfabetico italiano */
  const GK_ATTR: AttrGroup = {
    label: 'Portiere',
    keys: [
      { key: 'aerialReach',         label: 'Allungo' },
      { key: 'commandOfArea',       label: 'Comando area' },
      { key: 'communication',       label: 'Comunicazione' },
      { key: 'eccentricity',        label: 'Eccentricità' },
      { key: 'oneOnOnes',           label: 'Faccia a faccia' },
      { key: 'reflexes',            label: 'Riflessi' },
      { key: 'rushingOutTendency',  label: 'Tendenza a uscire' },
      { key: 'punchingTendency',    label: 'Tendenza a respingere' },
      { key: 'kicking',             label: 'Tiro (rilancio)' },
      { key: 'handling',            label: 'Presa' },
      { key: 'throwing',            label: 'Rilancio mano' },
    ],
  }

  /** Mentali FM (14 attributi, shared) — alfabetico italiano */
  const MENT: AttrGroup = {
    label: 'Mentali',
    keys: [
      { key: 'aggression',     label: 'Aggressività' },
      { key: 'anticipation',   label: 'Anticipo' },
      { key: 'concentration',  label: 'Concentrazione' },
      { key: 'flair',          label: 'Creatività' },
      { key: 'decisions',      label: 'Decisioni' },
      { key: 'determination',  label: 'Determinazione' },
      { key: 'leadership',     label: 'Leadership' },
      { key: 'offTheBall',     label: 'Movimento senza palla' },
      { key: 'bravery',        label: 'Coraggio' },
      { key: 'positioning',    label: 'Posizionamento' },
      { key: 'composure',      label: 'Freddezza' },
      { key: 'teamwork',       label: 'Gioco di squadra' },
      { key: 'vision',         label: 'Visione di gioco' },
      { key: 'workRate',       label: 'Intensità' },
    ],
  }

  /** Fisici FM (8 attributi, shared) — alfabetico italiano */
  const PHYS: AttrGroup = {
    label: 'Fisici',
    keys: [
      { key: 'acceleration',   label: 'Accelerazione' },
      { key: 'agility',        label: 'Agilità' },
      { key: 'balance',        label: 'Equilibrio' },
      { key: 'strength',       label: 'Forza' },
      { key: 'jumpingReach',   label: 'Elevazione' },
      { key: 'naturalFitness', label: 'Forma naturale' },
      { key: 'stamina',        label: 'Resistenza' },
      { key: 'pace',           label: 'Velocità' },
    ],
  }

  function back() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      push('/squad')
    }
  }

  // ====== Rinnovo contratto (Fase 3.G.3) ======
  let isMine = $derived(!!(player && career && player.teamId === career.club.teamId))
  let fairWage = $derived(player && career && isMine ? estimateFairWage(career, player) : 0)

  let showRenewModal = $state(false)
  let renewYears = $state<number>(3)
  let renewWage = $state<number>(0)
  let renewMsg = $state<string | null>(null)
  let renewOutcome = $state<RenewalOutcome | null>(null)
  let renewOk = $state(false)

  function openRenew() {
    if (!player) return
    renewYears = 3
    renewWage = Math.round(fairWage / 500) * 500
    renewMsg = null
    renewOutcome = null
    showRenewModal = true
  }
  function closeRenew() {
    showRenewModal = false
    renewMsg = null
    renewOutcome = null
  }
  function setWagePct(pct: number) {
    renewWage = Math.round(fairWage * (1 + pct / 100) / 500) * 500
  }
  async function handleRenew() {
    if (!career || !player) return
    const res = proposeRenewal(career, player.id, renewYears, renewWage)
    renewOk = res.ok
    renewMsg = res.message ?? res.reason ?? null
    renewOutcome = res.outcome ?? null
    if (res.ok && res.outcome === 'accepted') {
      await persistActiveCareer()
      setTimeout(() => closeRenew(), 2200)
    } else if (res.ok && res.outcome === 'countered' && res.counterWage) {
      // Pre-imposta la counter per il prossimo tentativo
      setTimeout(() => {
        if (res.counterWage) renewWage = res.counterWage
      }, 100)
    }
  }
</script>

<svelte:window onkeydown={(e) => {
  if (e.key === 'Escape' && showRenewModal) closeRenew()
}} />

<AppShell>
  {#if !career}
    <div class="loading"><div class="spinner"></div></div>
  {:else if !player}
    <div class="empty">
      <h1 class="text-gold">Giocatore non trovato</h1>
      <p>Il giocatore richiesto non esiste in questa carriera.</p>
      <button class="btn-gold" onclick={() => push('/squad')}>↩ Torna alla Rosa</button>
    </div>
  {:else}
    <div class="pd-top">
      <button class="btn-back" onclick={back}>← Indietro</button>
    </div>

    <header class="pd-head card-gold anim-kickin">
      <div class="pd-shirt">
        <span class="pd-shirt-num">{player.shirtNumber ?? '—'}</span>
      </div>

      <div class="pd-id">
        <h1 class="pd-name">
          <span class="pd-first">{player.firstName}</span>
          <span class="pd-last">{player.lastName}</span>
        </h1>
        <div class="pd-sub">
          <span class="pos-chip">{player.position}</span>
          <span>{POSITION_LABEL[player.position]}</span>
          <span class="dot">·</span>
          <span class="flag" title={player.nationality}>{player.nationality}</span>
          <span class="dot">·</span>
          <span>{age(player.birthDate)} anni</span>
          <span class="dot">·</span>
          <span>Piede {footLabel(player.foot)}</span>
        </div>
        {#if team}
          <div class="pd-team">
            <span class="crest-sm" style="--c1: {team.primaryColor}; --c2: {team.secondaryColor};">{team.shortName}</span>
            <span>{team.name}</span>
          </div>
        {/if}
      </div>

      <div class="pd-meta">
        <div class="meta-cell">
          <span class="meta-l">Overall</span>
          <span class="ov-badge {ovClass(calcOverall(player))}">{calcOverall(player)}</span>
        </div>
        <div class="meta-cell">
          <span class="meta-l">Valore</span>
          <span class="meta-v">{fmtValue(player.marketValue)}</span>
        </div>
        <div class="meta-cell">
          <span class="meta-l">Morale</span>
          <div class="bar bar-thin">
            <div class="bar-fill bar-mor" style="width: {player.morale}%"></div>
          </div>
          <span class="meta-v meta-v-sm">{player.morale}</span>
        </div>
        <div class="meta-cell">
          <span class="meta-l">Fitness</span>
          <div class="bar bar-thin">
            <div class="bar-fill bar-fit" style="width: {player.fitness}%"></div>
          </div>
          <span class="meta-v meta-v-sm">{player.fitness}</span>
        </div>
      </div>
    </header>

    <section class="attr-grid">
      {#each [(player.position === 'GK' ? GK_ATTR : TECH), MENT, PHYS] as group (group.label)}
        <div class="attr-card card-gold anim-kickin">
          <h3 class="attr-h">{group.label}</h3>
          <ul class="attr-list">
            {#each group.keys as item (item.key)}
              {@const raw = player.attributes[item.key]}
              {@const v = typeof raw === 'number' ? raw : 1}
              <li class="attr-row">
                <span class="attr-label">{item.label}</span>
                <div class="bar">
                  <div class="bar-fill {attrClass(v)}" style="width: {(v / 20) * 100}%"></div>
                </div>
                <span class="attr-val {attrClass(v)}">{v}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </section>

    {#if player.contract}
      {@const yearsLeft = player.contract.endYear - (career?.season.year ?? 0)}
      <section class="card-gold contract-card anim-kickin">
        <div class="contract-head">
          <h3 class="attr-h">Contratto</h3>
          {#if isMine}
            <button class="btn-renew" onclick={openRenew} title="Rinnova il contratto del giocatore">
              📝 Rinnova
            </button>
          {/if}
        </div>
        <div class="contract-grid">
          <div class="contract-cell">
            <span class="contract-l">Scadenza</span>
            <span class="contract-v">Giugno {player.contract.endYear}</span>
            <span class="contract-sub" class:warn={yearsLeft <= 1} class:expire={yearsLeft <= 0}>
              {#if yearsLeft <= 0}
                In scadenza
              {:else if yearsLeft === 1}
                Ultima stagione
              {:else}
                {yearsLeft} anni rimanenti
              {/if}
            </span>
          </div>
          <div class="contract-cell">
            <span class="contract-l">Stipendio</span>
            <span class="contract-v text-gold">{fmtMoney(player.contract.weeklyWage)}/sett</span>
            <span class="contract-sub">{fmtMoney(player.contract.weeklyWage * 52)}/anno</span>
          </div>
          <div class="contract-cell">
            <span class="contract-l">Firmato</span>
            <span class="contract-v">{player.contract.startYear}</span>
            <span class="contract-sub">{player.contract.endYear - player.contract.startYear} anni totali</span>
          </div>
        </div>
      </section>
    {:else if isMine}
      <section class="card-gold contract-card anim-kickin">
        <div class="contract-head">
          <h3 class="attr-h">Contratto</h3>
        </div>
        <p class="contract-empty">
          Questo giocatore non ha un contratto attivo (svincolato). Va firmato da
          <button class="link-btn" onclick={() => push('/transfers')}>Mercato → Cerca giocatori</button>.
        </p>
      </section>
    {/if}

    {#if player.secondaryPositions && player.secondaryPositions.length > 0}
      <section class="card-gold sec-pos anim-kickin">
        <h3 class="attr-h">Ruoli alternativi</h3>
        <div class="sec-pos-list">
          {#each player.secondaryPositions as sp (sp)}
            <span class="pos-chip">{sp}</span>
            <span class="sec-label">{POSITION_LABEL[sp]}</span>
          {/each}
        </div>
      </section>
    {/if}

    <!-- ====== Modale Rinnovo Contratto (Fase 3.G.3) ====== -->
    {#if showRenewModal && isMine}
      <div
        class="modal-backdrop"
        onclick={closeRenew}
        onkeydown={(e) => { if (e.key === 'Escape') closeRenew() }}
        role="presentation"
        tabindex="-1"
      >
        <div
          class="modal-renew card-gold"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-renew-title"
          tabindex="-1"
        >
          <header class="modal-head">
            <div>
              <h3 class="modal-title" id="modal-renew-title">Rinnovo contratto</h3>
              <div class="modal-sub">
                Per <strong>{player.firstName} {player.lastName}</strong> · {player.position} · OVR {calcOverall(player)}
              </div>
            </div>
            <button class="modal-close" onclick={closeRenew} aria-label="Chiudi">✗</button>
          </header>

          <div class="modal-stats">
            <div class="stat">
              <span class="stat-l">Stipendio attuale</span>
              <span class="stat-v">{player.contract ? fmtMoney(player.contract.weeklyWage) + '/sett' : '—'}</span>
            </div>
            <div class="stat">
              <span class="stat-l">Stipendio equo (riferimento)</span>
              <span class="stat-v text-gold">{fmtMoney(fairWage)}/sett</span>
            </div>
            <div class="stat">
              <span class="stat-l">Scadenza attuale</span>
              <span class="stat-v">{player.contract ? `Giu ${player.contract.endYear}` : '—'}</span>
            </div>
          </div>

          <div class="modal-form">
            <label class="renew-row">
              <span>Durata contratto (anni)</span>
              <input type="number" class="renew-input small" bind:value={renewYears} min="1" max="5" />
            </label>
            <label class="renew-row">
              <span>Stipendio settimanale proposto</span>
              <div class="counter-input-wrap">
                <span class="counter-prefix">€</span>
                <input type="number" class="renew-input" bind:value={renewWage} min="500" step="500" />
              </div>
            </label>
            <div class="counter-presets">
              <button class="preset-btn" onclick={() => setWagePct(-10)}>-10%</button>
              <button class="preset-btn" onclick={() => setWagePct(0)}>Equo</button>
              <button class="preset-btn" onclick={() => setWagePct(10)}>+10%</button>
              <button class="preset-btn" onclick={() => setWagePct(25)}>+25%</button>
            </div>
            <div class="form-hint">
              <strong>Tip:</strong> il giocatore accetta dal -8% allo +∞ rispetto al fair wage.
              Sotto il -25% rifiuta categoricamente e si offende. La durata 1-5 anni non
              influenza l'accettazione (semplificazione 3.G.3).
            </div>
          </div>

          {#if renewMsg}
            <div class="negotiate-result"
              class:ok={renewOk && renewOutcome === 'accepted'}
              class:warn={renewOk && renewOutcome === 'countered'}
              class:err={!renewOk || renewOutcome === 'rejected'}>
              {renewMsg}
            </div>
          {/if}

          <div class="modal-actions">
            <button class="btn-renew modal-submit" onclick={handleRenew} disabled={renewYears < 1 || renewYears > 5 || renewWage <= 0}>
              📝 Proponi rinnovo
            </button>
            <button class="btn-reject modal-reject" onclick={closeRenew}>
              Chiudi
            </button>
          </div>
        </div>
      </div>
    {/if}
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

  .empty {
    text-align: center;
    padding: 40px 20px;
  }
  .empty p { color: #a8a29e; margin: 12px 0 24px; }

  .pd-top {
    margin-bottom: 14px;
  }
  .btn-back {
    background: none;
    border: 1px solid rgba(252, 211, 77, 0.30);
    color: #fcd34d;
    padding: 8px 14px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-back:hover {
    background: rgba(252, 211, 77, 0.08);
    border-color: rgba(252, 211, 77, 0.55);
  }

  /* ===== HEADER ===== */
  .pd-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 28px;
    align-items: center;
    padding: 24px 28px;
    margin-bottom: 18px;
  }
  .pd-shirt {
    width: 110px;
    height: 110px;
    border-radius: 16px;
    background:
      radial-gradient(ellipse at 30% 30%, rgba(252, 211, 77, 0.22), transparent 70%),
      linear-gradient(180deg, #1a1410, #0a0805);
    border: 1.5px solid rgba(252, 211, 77, 0.45);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 24px rgba(252, 211, 77, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pd-shirt-num {
    font-size: 60px;
    font-weight: 900;
    color: transparent;
    background: linear-gradient(180deg, #fde68a 0%, #fcd34d 50%, #b45309 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 2px 8px rgba(252, 211, 77, 0.4));
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .pd-id { min-width: 0; }
  .pd-name {
    margin: 0;
    font-size: 28px;
    font-weight: 800;
    color: #fef3c7;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: baseline;
    line-height: 1.1;
  }
  .pd-first {
    color: #d4cfc1;
    font-weight: 600;
    font-size: 20px;
  }
  .pd-last {
    color: #fef3c7;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .pd-sub {
    margin-top: 8px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    color: #b8b0a0;
    font-size: 13px;
  }
  .pd-sub .dot { color: rgba(252, 211, 77, 0.35); }
  .pos-chip {
    background: rgba(252, 211, 77, 0.12);
    color: #fcd34d;
    border: 1px solid rgba(252, 211, 77, 0.4);
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.05em;
  }
  .flag {
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    color: #fcd34d;
    letter-spacing: 0.1em;
  }
  .pd-team {
    margin-top: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #d4cfc1;
    font-size: 13px;
  }
  .crest-sm {
    width: 26px; height: 26px;
    border-radius: 5px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff;
    font-weight: 800;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  }

  .pd-meta {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px 22px;
    min-width: 260px;
  }
  .meta-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    font-variant-numeric: tabular-nums;
  }
  .meta-v-sm { font-size: 13px; }

  .ov-badge {
    display: inline-block;
    min-width: 48px;
    text-align: center;
    padding: 4px 10px;
    border-radius: 6px;
    font-weight: 900;
    font-size: 18px;
  }
  .ov-elite { background: linear-gradient(180deg, #fde68a, #b45309); color: #1a1410; }
  .ov-good  { background: rgba(34, 197, 94, 0.22); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.45); }
  .ov-mid   { background: rgba(148, 163, 184, 0.18); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.35); }
  .ov-low   { background: rgba(220, 38, 38, 0.16); color: #fca5a5; border: 1px solid rgba(220, 38, 38, 0.35); }

  .bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.5);
    overflow: hidden;
    border: 1px solid rgba(252, 211, 77, 0.10);
  }
  .bar-thin { height: 5px; }
  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s ease;
  }
  .bar-mor { background: linear-gradient(90deg, #fcd34d, #fde68a); }
  .bar-fit { background: linear-gradient(90deg, #4ade80, #86efac); }

  /* ===== ATTRIBUTI ===== */
  .attr-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 18px;
  }
  .attr-card {
    padding: 16px 18px;
  }
  .attr-h {
    margin: 0 0 14px 0;
    font-size: 12px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #fcd34d;
    border-bottom: 1px solid rgba(252, 211, 77, 0.20);
    padding-bottom: 8px;
  }
  .attr-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .attr-row {
    display: grid;
    grid-template-columns: minmax(100px, 1.4fr) minmax(60px, 1fr) 32px;
    align-items: center;
    gap: 10px;
  }
  .attr-label {
    color: #d4cfc1;
    font-size: 12.5px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attr-val {
    text-align: right;
    font-weight: 800;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    padding: 2px 6px;
    border-radius: 4px;
    min-width: 32px;
  }
  .a-top  { color: #fde68a; background: rgba(252, 211, 77, 0.18); border: 1px solid rgba(252, 211, 77, 0.40); }
  .a-good { color: #86efac; background: rgba(34, 197, 94, 0.18);  border: 1px solid rgba(34, 197, 94, 0.35); }
  .a-mid  { color: #cbd5e1; background: rgba(148, 163, 184, 0.15); border: 1px solid rgba(148, 163, 184, 0.30); }
  .a-low  { color: #fdba74; background: rgba(251, 146, 60, 0.16); border: 1px solid rgba(251, 146, 60, 0.35); }
  .a-bad  { color: #fca5a5; background: rgba(220, 38, 38, 0.15);  border: 1px solid rgba(220, 38, 38, 0.35); }
  .bar-fill.a-top  { background: linear-gradient(90deg, #b45309, #fde68a); }
  .bar-fill.a-good { background: linear-gradient(90deg, #16a34a, #86efac); }
  .bar-fill.a-mid  { background: linear-gradient(90deg, #64748b, #cbd5e1); }
  .bar-fill.a-low  { background: linear-gradient(90deg, #c2410c, #fdba74); }
  .bar-fill.a-bad  { background: linear-gradient(90deg, #7f1d1d, #fca5a5); }

  /* ===== Contratto (Fase 3.D + 3.G.3) ===== */
  .contract-card {
    padding: 16px 22px;
    margin-bottom: 18px;
  }
  .contract-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .contract-head .attr-h { margin: 0 0 8px 0; border-bottom: 0; padding-bottom: 0; }
  .contract-empty {
    color: #b8b0a0;
    font-size: 13px;
    margin: 6px 0 0;
  }
  .link-btn {
    background: none; border: 0;
    color: #fcd34d;
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
    font-size: inherit;
    padding: 0 2px;
  }
  .link-btn:hover { color: #fde68a; }
  .btn-renew {
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 700;
    font-family: inherit;
    color: #fff;
    background: linear-gradient(135deg, #4338ca, #6366f1 60%, #4338ca);
    border: 1px solid rgba(99, 102, 241, 0.55);
    border-radius: 8px;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 2px 8px rgba(99, 102, 241, 0.18);
    transition: transform 0.1s, box-shadow 0.15s;
    letter-spacing: 0.02em;
  }
  .btn-renew:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 4px 14px rgba(99, 102, 241, 0.36);
  }
  .btn-renew:disabled { opacity: 0.50; cursor: not-allowed; }

  .contract-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px 28px;
  }
  .contract-cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .contract-l {
    color: #a8a29e;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .contract-v {
    color: #fef3c7;
    font-weight: 800;
    font-size: 17px;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .contract-sub {
    color: #918778;
    font-size: 11px;
    margin-top: 1px;
  }
  .contract-sub.warn { color: #fdba74; }
  .contract-sub.expire { color: #fca5a5; font-weight: 700; }
  @media (max-width: 700px) {
    .contract-grid { grid-template-columns: 1fr 1fr; }
  }

  /* ===== Ruoli alternativi ===== */
  .sec-pos { padding: 16px 22px; margin-bottom: 18px; }
  .sec-pos-list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .sec-label {
    color: #b8b0a0;
    font-size: 13px;
    margin-right: 12px;
  }

  @media (max-width: 1180px) {
    .attr-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 900px) {
    .pd-head { grid-template-columns: auto 1fr; }
    .pd-meta { grid-column: 1 / -1; }
    .attr-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .pd-head { grid-template-columns: 1fr; text-align: center; }
    .pd-shirt { margin: 0 auto; }
    .pd-sub, .pd-name { justify-content: center; }
    .attr-row { grid-template-columns: minmax(90px, 1.5fr) minmax(50px, 1fr) 32px; }
  }

  /* ===== Modale Rinnovo (Fase 3.G.3) ===== */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.74);
    backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    z-index: 100;
    padding: 16px;
  }
  .modal-renew {
    width: min(540px, 100%);
    padding: 22px 26px 18px;
    max-height: 92vh;
    overflow-y: auto;
    animation: modal-in 0.22s ease;
  }
  @keyframes modal-in {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to { opacity: 1; transform: none; }
  }
  .modal-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.16);
    padding-bottom: 14px;
    margin-bottom: 14px;
  }
  .modal-title { margin: 0; color: #fef3c7; font-size: 17px; font-weight: 800; }
  .modal-sub { color: #b8b0a0; font-size: 12px; margin-top: 3px; }
  .modal-sub strong { color: #fef3c7; }
  .modal-close {
    background: none; border: 0;
    color: #b8b0a0;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }
  .modal-close:hover { background: rgba(252, 211, 77, 0.10); color: #fef3c7; }

  .modal-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 10px 0 14px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.10);
    margin-bottom: 14px;
  }
  .modal-stats .stat { display: flex; flex-direction: column; gap: 3px; }
  .modal-stats .stat-l { color: #918778; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .modal-stats .stat-v { color: #fef3c7; font-weight: 800; font-size: 16px; font-variant-numeric: tabular-nums; }

  .modal-form { margin-bottom: 14px; }
  .renew-row {
    display: flex; flex-direction: column; gap: 6px;
    color: #d4cfc1;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .renew-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(252, 211, 77, 0.3);
    color: #fef3c7;
    border-radius: 8px;
    padding: 11px 14px 11px 32px;
    font-size: 17px;
    font-weight: 800;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    transition: border 0.15s;
  }
  .renew-input.small {
    padding: 10px 14px;
    font-size: 16px;
  }
  .renew-input:focus {
    outline: none;
    border-color: rgba(252, 211, 77, 0.6);
    box-shadow: 0 0 0 3px rgba(252, 211, 77, 0.12);
  }
  .counter-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .counter-prefix {
    position: absolute;
    left: 12px;
    color: #fcd34d;
    font-weight: 800;
    font-size: 17px;
    z-index: 1;
  }
  .counter-presets {
    display: flex;
    gap: 8px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .preset-btn {
    background: rgba(252, 211, 77, 0.08);
    color: #fde68a;
    border: 1px solid rgba(252, 211, 77, 0.28);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.12s;
  }
  .preset-btn:hover {
    background: rgba(252, 211, 77, 0.18);
    border-color: rgba(252, 211, 77, 0.5);
  }
  .form-hint {
    margin-top: 10px;
    padding: 10px 12px;
    background: rgba(99, 102, 241, 0.08);
    border: 1px solid rgba(99, 102, 241, 0.22);
    color: #c7d2fe;
    border-radius: 6px;
    font-size: 11.5px;
    line-height: 1.5;
  }
  .form-hint strong { color: #e0e7ff; }
  .negotiate-result {
    margin-bottom: 14px;
    padding: 11px 14px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.4;
    font-weight: 600;
  }
  .negotiate-result.ok {
    background: rgba(34, 197, 94, 0.14);
    color: #86efac;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }
  .negotiate-result.warn {
    background: rgba(252, 211, 77, 0.12);
    color: #fde68a;
    border: 1px solid rgba(252, 211, 77, 0.4);
  }
  .negotiate-result.err {
    background: rgba(220, 38, 38, 0.14);
    color: #fca5a5;
    border: 1px solid rgba(220, 38, 38, 0.4);
  }
  .modal-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .modal-submit { grid-column: 1 / -1; padding: 11px 16px; font-size: 14px; }
  .modal-reject { padding: 10px 14px; font-size: 13px; }
  .btn-reject {
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 700;
    font-family: inherit;
    color: #fff;
    background: linear-gradient(135deg, #b91c1c, #ef4444 60%, #b91c1c);
    border: 1px solid rgba(239, 68, 68, 0.5);
    border-radius: 8px;
    cursor: pointer;
    transition: transform 0.1s;
  }
  .btn-reject:hover { transform: translateY(-1px); }
</style>
