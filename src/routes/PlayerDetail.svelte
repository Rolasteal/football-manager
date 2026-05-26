<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore } from '$state/career.svelte'
  import { calcOverall } from '$engine/gen/player'
  import type { Player, Position, PlayerAttributes } from '$engine/types'

  interface Props { params?: { id?: string } }
  let { params = {} }: Props = $props()

  const store = careerStore()
  let career = $derived(store.career)
  let player = $derived<Player | null>(
    career && params?.id ? career.players[params.id] ?? null : null
  )
  let team = $derived(player && player.teamId && career ? career.teams[player.teamId] : null)

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
  const TECH: AttrGroup = {
    label: 'Tecnici',
    keys: [
      { key: 'passing',   label: 'Passaggio' },
      { key: 'shooting',  label: 'Tiro' },
      { key: 'dribbling', label: 'Dribbling' },
      { key: 'finishing', label: 'Finalizzazione' },
      { key: 'crossing',  label: 'Cross' },
      { key: 'tackling',  label: 'Contrasto' },
      { key: 'heading',   label: 'Colpo di testa' },
    ],
  }
  const PHYS: AttrGroup = {
    label: 'Fisici',
    keys: [
      { key: 'pace',     label: 'Velocità' },
      { key: 'stamina',  label: 'Resistenza' },
      { key: 'strength', label: 'Forza' },
    ],
  }
  const MENT: AttrGroup = {
    label: 'Mentali',
    keys: [
      { key: 'vision',    label: 'Visione' },
      { key: 'composure', label: 'Freddezza' },
      { key: 'workRate',  label: 'Intensità' },
    ],
  }
  const GK_ATTR: AttrGroup = {
    label: 'Portiere',
    keys: [
      { key: 'reflexes', label: 'Riflessi' },
      { key: 'handling', label: 'Presa' },
    ],
  }

  function back() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      push('/squad')
    }
  }
</script>

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
      {#each [TECH, PHYS, MENT, ...(player.position === 'GK' ? [GK_ATTR] : [])] as group (group.label)}
        <div class="attr-card card-gold anim-kickin">
          <h3 class="attr-h">{group.label}</h3>
          <ul class="attr-list">
            {#each group.keys as item (item.key)}
              {@const v = player.attributes[item.key]}
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
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 18px;
  }
  .attr-card {
    padding: 18px 22px;
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
    grid-template-columns: 130px 1fr 32px;
    align-items: center;
    gap: 12px;
  }
  .attr-label {
    color: #d4cfc1;
    font-size: 13px;
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

  @media (max-width: 900px) {
    .pd-head { grid-template-columns: auto 1fr; }
    .pd-meta { grid-column: 1 / -1; }
    .attr-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .pd-head { grid-template-columns: 1fr; text-align: center; }
    .pd-shirt { margin: 0 auto; }
    .pd-sub, .pd-name { justify-content: center; }
    .attr-row { grid-template-columns: 100px 1fr 32px; }
  }
</style>
