<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount } from 'svelte'
  import AppShell from '$lib/AppShell.svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { fmtMoney, ensureClubFinances } from '$engine/career/finances'
  import {
    currentTransferWindow,
    transferWindowRemainingMd,
    matchdaysToNextWindow,
    ensureTransferState,
    pendingOffersForMyClub,
    acceptOffer,
    rejectOffer,
  } from '$engine/career/transfers'
  import { calcOverall } from '$engine/gen/player'
  import type { TransferOffer, CompletedTransfer } from '$engine/career/types'

  const store = careerStore()
  let career = $derived(store.career)
  let myTeam = $derived(career ? career.teams[career.club.teamId] : null)
  let finances = $derived(career ? ensureClubFinances(career) : null)

  let window = $derived(career ? currentTransferWindow(career.season.currentMatchday) : 'closed')
  let windowRemaining = $derived(career ? transferWindowRemainingMd(career) : 0)
  let mdToNext = $derived(career ? matchdaysToNextWindow(career) : 0)

  let pendingOffers = $derived.by<TransferOffer[]>(() => {
    if (!career) return []
    ensureTransferState(career)
    return pendingOffersForMyClub(career)
  })

  let history = $derived.by<CompletedTransfer[]>(() => {
    if (!career) return []
    ensureTransferState(career)
    return career.transferHistory ?? []
  })

  // Plusvalenze stagione corrente (somma profitLoss su cessioni in questa season)
  let seasonProfit = $derived.by(() => {
    if (!career) return 0
    const ts = career.transferHistory ?? []
    return ts.filter(t => t.isMineSold).reduce((s, t) => s + t.profitLoss, 0)
  })

  let actionMsg = $state<string | null>(null)
  let actionOk = $state(false)

  onMount(() => { if (!career) push('/') })

  function playerOfOffer(o: TransferOffer) {
    return career?.players[o.playerId] ?? null
  }
  function teamOfOffer(o: TransferOffer) {
    return career?.teams[o.fromTeamId] ?? null
  }

  async function handleAccept(o: TransferOffer) {
    if (!career) return
    const res = acceptOffer(career, o.id)
    if (res.ok && res.completedTransfer) {
      actionOk = true
      const ct = res.completedTransfer
      actionMsg = `✅ ${ct.playerName} ceduto al ${ct.toTeamName} per ${fmtMoney(ct.amount)} (plus/minusvalenza ${fmtMoney(ct.profitLoss)}).`
      await persistActiveCareer()
    } else {
      actionOk = false
      actionMsg = res.reason ?? 'Operazione non riuscita.'
    }
    setTimeout(() => { actionMsg = null }, 5500)
  }

  async function handleReject(o: TransferOffer) {
    if (!career) return
    const res = rejectOffer(career, o.id)
    if (res.ok) {
      actionOk = true
      const p = playerOfOffer(o)
      actionMsg = `Offerta rifiutata${p ? ` per ${p.firstName} ${p.lastName}` : ''}.`
      await persistActiveCareer()
    } else {
      actionOk = false
      actionMsg = res.reason ?? 'Operazione non riuscita.'
    }
    setTimeout(() => { actionMsg = null }, 3500)
  }

  function windowLabel(w: 'summer' | 'winter' | 'closed'): string {
    if (w === 'summer') return 'Aperta — Mercato estivo'
    if (w === 'winter') return 'Aperta — Mercato di gennaio'
    return 'Chiusa'
  }

  function openPlayer(id: string) { push(`/player/${id}`) }
</script>

<AppShell>
  {#if !career || !myTeam || !finances}
    <div class="loading"><div class="spinner"></div></div>
  {:else}
    <header class="tx-head card-gold anim-kickin">
      <div class="head-l">
        <div class="tx-icon">💰</div>
        <div>
          <h1 class="tx-name">Mercato</h1>
          <div class="tx-sub">Trattative del {myTeam.name} · Stagione {career.season.year}/{(career.season.year + 1).toString().slice(2)}</div>
        </div>
      </div>
      <div class="head-r">
        <div class="meta-tile">
          <span class="meta-l">Finestra</span>
          <span class="meta-v" class:wopen={window !== 'closed'} class:wclosed={window === 'closed'}>{windowLabel(window)}</span>
          <span class="meta-sub">
            {#if window !== 'closed'}
              Restano {windowRemaining} giornat{windowRemaining === 1 ? 'a' : 'e'}
            {:else}
              Riapre tra {mdToNext} giornat{mdToNext === 1 ? 'a' : 'e'}
            {/if}
          </span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">Cassa</span>
          <span class="meta-v text-gold">{fmtMoney(finances.cash)}</span>
          <span class="meta-sub">disponibile</span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">Plus/Minus stag.</span>
          <span class="meta-v" class:profit={seasonProfit > 0} class:loss={seasonProfit < 0}>{fmtMoney(seasonProfit)}</span>
          <span class="meta-sub">su cessioni</span>
        </div>
        <div class="meta-tile">
          <span class="meta-l">Offerte attive</span>
          <span class="meta-v text-gold">{pendingOffers.length}</span>
          <span class="meta-sub">in attesa</span>
        </div>
      </div>
    </header>

    {#if actionMsg}
      <div class="action-banner" class:ok={actionOk} class:err={!actionOk}>
        {actionMsg}
      </div>
    {/if}

    <section>
      <h2 class="section-h">Offerte ricevute</h2>
      {#if pendingOffers.length === 0}
        <div class="empty card-gold">
          <span class="empty-icon">📭</span>
          <p>
            {#if window === 'closed'}
              Nessuna offerta in arrivo. La prossima finestra di mercato apre tra <strong>{mdToNext} giornat{mdToNext === 1 ? 'a' : 'e'}</strong>.
            {:else}
              Per ora nessuna squadra ha presentato un'offerta per i tuoi giocatori. Avanza qualche giornata.
            {/if}
          </p>
        </div>
      {:else}
        <div class="offers-list">
          {#each pendingOffers as o (o.id)}
            {@const p = playerOfOffer(o)}
            {@const buyer = teamOfOffer(o)}
            {#if p && buyer}
              {@const ovr = calcOverall(p)}
              {@const expIn = o.expiresMd - career.season.currentMatchday}
              <article class="offer-card card-gold">
                <div class="offer-buyer">
                  <span class="crest" style="--c1: {buyer.primaryColor}; --c2: {buyer.secondaryColor};">{buyer.shortName}</span>
                  <div class="offer-buyer-info">
                    <div class="buyer-name">{buyer.name}</div>
                    <div class="buyer-meta">Reputation {buyer.reputation} · Cassa {fmtMoney(buyer.balance)}</div>
                  </div>
                </div>
                <div class="offer-arrow">→</div>
                <button class="offer-player" onclick={() => openPlayer(p.id)} title="Vedi scheda giocatore">
                  <div class="player-pos">{p.position}</div>
                  <div class="player-name-wrap">
                    <div class="player-name">{p.firstName} <strong>{p.lastName}</strong></div>
                    <div class="player-meta">OVR {ovr} · Valore {fmtMoney(p.marketValue)}</div>
                  </div>
                </button>
                <div class="offer-amount-wrap">
                  <div class="amount-l">Offerta</div>
                  <div class="amount-v text-gold">{fmtMoney(o.amount)}</div>
                  <div class="amount-delta" class:up={o.amount > p.marketValue} class:down={o.amount < p.marketValue}>
                    {o.amount > p.marketValue ? '+' : ''}{fmtMoney(o.amount - p.marketValue)} vs valore
                  </div>
                </div>
                <div class="offer-actions">
                  <div class="expire-chip" class:urgent={expIn <= 1}>Scade in {expIn} g.</div>
                  <button class="btn-gold accept-btn" onclick={() => handleAccept(o)}>✓ Accetta</button>
                  <button class="btn-ghost reject-btn" onclick={() => handleReject(o)}>✗ Rifiuta</button>
                </div>
              </article>
            {/if}
          {/each}
        </div>
      {/if}
    </section>

    <section class="history-sec">
      <h2 class="section-h">Storico trasferimenti</h2>
      {#if history.length === 0}
        <div class="empty card-gold">
          <span class="empty-icon">📒</span>
          <p>Ancora nessun trasferimento concluso.</p>
        </div>
      {:else}
        <div class="history-list card-gold">
          {#each history.slice(0, 12) as t (t.id)}
            <div class="hist-row">
              <div class="hist-date">G.{t.matchday}</div>
              <button class="hist-name" onclick={() => openPlayer(t.playerId)} title="Vedi scheda giocatore">
                <span class="hpos">{t.position}</span> {t.playerName}
              </button>
              <div class="hist-flow">
                <span class="hfrom">{t.fromTeamName}</span>
                <span class="harr">→</span>
                <span class="hto">{t.toTeamName}</span>
              </div>
              <div class="hist-amount text-gold">{fmtMoney(t.amount)}</div>
              <div class="hist-tag">
                {#if t.isMineSold}
                  <span class="tag sold" class:profit={t.profitLoss > 0} class:loss={t.profitLoss < 0}>
                    Ceduto {t.profitLoss > 0 ? '+' : ''}{fmtMoney(t.profitLoss)}
                  </span>
                {:else if t.isMineBought}
                  <span class="tag bought">Acquistato</span>
                {:else}
                  <span class="tag ai">AI</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="info-note">
      <p>
        Le <strong>finestre di mercato</strong> sono attive nelle giornate <strong>1-3</strong> (coda mercato estivo) e <strong>19-21</strong> (gennaio).
        Fuori da questi periodi nessuna squadra può fare nuove offerte.
      </p>
      <p>
        Le offerte ricevute hanno validità di <strong>2 giornate</strong>: oltre quel termine scadono automaticamente.
        Accettando, il giocatore lascia immediatamente la rosa e l'incasso entra in cassa.
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
  .tx-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    align-items: center;
    padding: 22px 28px;
    margin-bottom: 16px;
  }
  .head-l { display: flex; align-items: center; gap: 18px; }
  .tx-icon {
    font-size: 52px;
    line-height: 1;
    filter: drop-shadow(0 4px 12px rgba(252, 211, 77, 0.35));
  }
  .tx-name { margin: 0; font-size: 26px; font-weight: 800; color: #fef3c7; }
  .tx-sub { color: #b8b0a0; font-size: 13px; margin-top: 4px; }

  .head-r {
    display: grid;
    grid-template-columns: repeat(4, auto);
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
  .meta-v.wopen { color: #86efac; }
  .meta-v.wclosed { color: #cbd5e1; }
  .meta-v.profit { color: #86efac; }
  .meta-v.loss { color: #fca5a5; }
  .meta-sub { color: #918778; font-size: 11px; }

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

  /* ===== SECTION HEADER ===== */
  .section-h {
    color: #fcd34d;
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-weight: 700;
    margin: 18px 0 12px;
  }

  /* ===== EMPTY ===== */
  .empty {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 22px;
    color: #b8b0a0;
  }
  .empty-icon { font-size: 30px; opacity: 0.8; }
  .empty p { margin: 0; font-size: 13px; line-height: 1.5; }

  /* ===== OFFER CARDS ===== */
  .offers-list { display: flex; flex-direction: column; gap: 12px; }
  .offer-card {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto minmax(220px, 1fr) auto auto;
    gap: 18px;
    align-items: center;
    padding: 16px 20px;
  }
  .offer-buyer { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .crest {
    width: 42px; height: 42px; flex-shrink: 0;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff;
    font-weight: 800; font-size: 12px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
  .offer-buyer-info { min-width: 0; }
  .buyer-name {
    color: #fef3c7;
    font-weight: 700;
    font-size: 14px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .buyer-meta { color: #918778; font-size: 11px; margin-top: 2px; }
  .offer-arrow { color: #fcd34d; font-size: 22px; font-weight: 700; }

  .offer-player {
    display: flex; align-items: center; gap: 12px;
    background: none; border: 0;
    color: inherit; cursor: pointer;
    font-family: inherit; text-align: left;
    padding: 6px 10px;
    border-radius: 8px;
    transition: background 0.15s;
  }
  .offer-player:hover { background: rgba(252, 211, 77, 0.08); }
  .player-pos {
    background: rgba(252, 211, 77, 0.18);
    color: #fcd34d;
    font-weight: 800;
    padding: 4px 9px;
    border-radius: 6px;
    font-size: 11px;
    letter-spacing: 0.05em;
  }
  .player-name { color: #fef3c7; font-size: 14px; font-weight: 500; }
  .player-name strong { font-weight: 800; }
  .player-meta { color: #918778; font-size: 11px; margin-top: 2px; }

  .offer-amount-wrap { text-align: right; }
  .amount-l { color: #918778; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .amount-v { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .amount-delta { font-size: 11px; color: #918778; }
  .amount-delta.up { color: #86efac; }
  .amount-delta.down { color: #fca5a5; }

  .offer-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: stretch;
    min-width: 140px;
  }
  .expire-chip {
    background: rgba(252, 211, 77, 0.12);
    color: #fde68a;
    border: 1px solid rgba(252, 211, 77, 0.3);
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 10.5px;
    text-align: center;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .expire-chip.urgent {
    background: rgba(220, 38, 38, 0.14);
    color: #fca5a5;
    border-color: rgba(220, 38, 38, 0.5);
  }
  .accept-btn { padding: 8px 14px; font-size: 13px; }
  .reject-btn { padding: 8px 14px; font-size: 13px; }

  /* ===== HISTORY ===== */
  .history-sec { margin-top: 8px; }
  .history-list { padding: 8px 4px; }
  .hist-row {
    display: grid;
    grid-template-columns: 50px minmax(200px, 1.5fr) minmax(180px, 1fr) 120px 160px;
    gap: 14px;
    align-items: center;
    padding: 9px 16px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.08);
    font-size: 13px;
  }
  .hist-row:last-child { border-bottom: 0; }
  .hist-date { color: #918778; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; }
  .hist-name {
    background: none; border: 0;
    color: #fef3c7;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 13px;
    padding: 4px 0;
  }
  .hist-name:hover { color: #fde68a; text-decoration: underline; }
  .hpos {
    color: #fcd34d;
    background: rgba(252, 211, 77, 0.14);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 800;
    margin-right: 6px;
  }
  .hist-flow { color: #b8b0a0; font-size: 12px; }
  .hfrom { color: #d4cfc1; font-weight: 600; }
  .harr { color: #fcd34d; margin: 0 6px; }
  .hto { color: #d4cfc1; font-weight: 600; }
  .hist-amount { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  .hist-tag { text-align: right; }
  .tag {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .tag.sold {
    background: rgba(252, 211, 77, 0.16);
    color: #fde68a;
    border: 1px solid rgba(252, 211, 77, 0.3);
  }
  .tag.sold.profit { background: rgba(34, 197, 94, 0.14); color: #86efac; border-color: rgba(34, 197, 94, 0.4); }
  .tag.sold.loss { background: rgba(220, 38, 38, 0.14); color: #fca5a5; border-color: rgba(220, 38, 38, 0.4); }
  .tag.bought {
    background: rgba(99, 102, 241, 0.14);
    color: #c7d2fe;
    border: 1px solid rgba(99, 102, 241, 0.4);
  }
  .tag.ai {
    background: rgba(120, 113, 108, 0.18);
    color: #d4cfc1;
    border: 1px solid rgba(120, 113, 108, 0.4);
  }

  /* ===== INFO NOTE ===== */
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

  @media (max-width: 1180px) {
    .tx-head { grid-template-columns: 1fr; }
    .head-r { grid-template-columns: repeat(2, 1fr); }
    .offer-card { grid-template-columns: 1fr; gap: 10px; }
    .offer-arrow { display: none; }
    .offer-amount-wrap { text-align: left; }
    .offer-actions { flex-direction: row; align-items: center; }
    .hist-row { grid-template-columns: 50px 1fr; row-gap: 4px; }
    .hist-flow, .hist-amount, .hist-tag { grid-column: 2; text-align: left; }
  }
</style>
