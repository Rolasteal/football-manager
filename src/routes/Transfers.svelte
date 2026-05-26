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
    acceptOffer,
    rejectOffer,
    negotiateOffer,
    submitMyOffer,
    withdrawMyOffer,
    computeInterestLevel,
    type InterestLevel,
    type NegotiateOutcome,
    type MyOfferOutcome,
  } from '$engine/career/transfers'
  import { calcOverall } from '$engine/gen/player'
  import { ensureMarketValuesCalibrated } from '$engine/career/aging'
  import type { TransferOffer, CompletedTransfer, NewsItem } from '$engine/career/types'
  import type { Player, Position } from '$engine/types'

  const store = careerStore()
  let career = $derived(store.career)
  let myTeam = $derived(career ? career.teams[career.club.teamId] : null)
  let finances = $derived(career ? ensureClubFinances(career) : null)

  let window = $derived(career ? currentTransferWindow(career.season.currentMatchday) : 'closed')
  let windowRemaining = $derived(career ? transferWindowRemainingMd(career) : 0)
  let mdToNext = $derived(career ? matchdaysToNextWindow(career) : 0)

  // Lettura difensiva: i campi possono essere undefined per save legacy fino al
  // primo advanceMatchday. Per nuove career sono già inizializzati a [] in
  // buildCareerFromPreview. Onmount li forza per i legacy.
  let pendingOffers = $derived<TransferOffer[]>(
    !career
      ? []
      : (career.transferOffers ?? []).filter(o => o.status === 'pending' && o.toTeamId === career.club.teamId)
  )

  // 3.G.2: offerte pending dove SONO IO il buyer (counter dell'AI a mie submission)
  let myOffers = $derived<TransferOffer[]>(
    !career
      ? []
      : (career.transferOffers ?? []).filter(o => o.status === 'pending' && o.fromTeamId === career.club.teamId)
  )

  let history = $derived<CompletedTransfer[]>(career?.transferHistory ?? [])

  // Plusvalenze stagione corrente (somma profitLoss su cessioni in questa season)
  let seasonProfit = $derived(
    (career?.transferHistory ?? [])
      .filter(t => t.isMineSold)
      .reduce((s, t) => s + t.profitLoss, 0)
  )

  let actionMsg = $state<string | null>(null)
  let actionOk = $state(false)

  // ====== Tabs ======
  type Tab = 'received' | 'mine' | 'search' | 'history'
  let activeTab = $state<Tab>('received')

  // ====== Stato modale trattativa ======
  let negotiatingOffer = $state<TransferOffer | null>(null)
  let counterAmount = $state<number>(0)
  let negotiateMsg = $state<string | null>(null)
  let negotiateOk = $state(false)
  let negotiateOutcome = $state<NegotiateOutcome | null>(null)

  // ====== Stato modale "Fai offerta" (3.G.2) ======
  let offerPlayerTarget = $state<Player | null>(null)
  let offerAmount = $state<number>(0)
  let offerMsg = $state<string | null>(null)
  let offerOk = $state(false)
  let offerOutcome = $state<MyOfferOutcome | null>(null)
  let replaceOfferId = $state<string | undefined>(undefined)

  // ====== Filtri ricerca giocatori (3.G.2) ======
  type RoleFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT'
  let filterRole = $state<RoleFilter>('ALL')
  let filterOvrMin = $state<number>(70)
  let filterAgeMax = $state<number>(34)
  let filterBudgetMax = $state<number>(0)  // 0 = no cap (calcolato da finances)
  let searchActive = $state(false)
  let searchResults = $state<Player[]>([])

  const POSITION_GROUP: Record<Position, 'GK' | 'DEF' | 'MID' | 'ATT'> = {
    GK: 'GK',
    CB: 'DEF', LB: 'DEF', RB: 'DEF', WB: 'DEF',
    DM: 'MID', CM: 'MID', AM: 'MID', LM: 'MID', RM: 'MID',
    LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT',
  }

  function playerAge(p: Player): number {
    const b = new Date(p.birthDate)
    const ref = career ? new Date(`${career.season.year}-07-01`) : new Date()
    let a = ref.getUTCFullYear() - b.getUTCFullYear()
    const m = ref.getUTCMonth() - b.getUTCMonth()
    if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) a--
    return a
  }

  onMount(() => {
    if (!career) {
      push('/')
      return
    }
    // Backfill per save legacy creati prima di Fase 3.G.1 (mutazione safe in onMount)
    ensureTransferState(career)
    // Migrazione marketValue per save creati prima di Fase 3.G fix-values
    // (formula vecchia dava OVR 92 = €2M. Recalcola tutti con calibrazione Serie A 2024).
    ensureMarketValuesCalibrated(career)
  })

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

  function openNegotiate(o: TransferOffer) {
    negotiatingOffer = o
    // Pre-imposta una controproposta sensata: 15% sopra l'offerta corrente,
    // arrotondata a 100k
    counterAmount = Math.round(o.amount * 1.15 / 100_000) * 100_000
    negotiateMsg = null
    negotiateOutcome = null
  }

  function closeNegotiate() {
    negotiatingOffer = null
    counterAmount = 0
    negotiateMsg = null
    negotiateOutcome = null
  }

  function setCounterPct(o: TransferOffer, pct: number) {
    counterAmount = Math.round(o.amount * (1 + pct / 100) / 100_000) * 100_000
  }

  async function handleNegotiate() {
    if (!career || !negotiatingOffer) return
    const res = negotiateOffer(career, negotiatingOffer.id, counterAmount)
    negotiateOk = res.ok
    negotiateMsg = res.message ?? res.reason ?? null
    negotiateOutcome = res.outcome ?? null
    if (res.ok) {
      await persistActiveCareer()
      // Se l'AI ha accettato o rilanciato, l'offerta è ancora pending con il
      // nuovo amount — manteniamo la modale aperta per mostrare il risultato e
      // permettere all'utente di accettare/rilanciare ancora. Se rejected,
      // chiudiamo dopo 2.5s.
      if (res.outcome === 'rejected') {
        setTimeout(() => closeNegotiate(), 2500)
      } else {
        // Aggiorna la controproposta suggerita al nuovo amount (+10%)
        const updatedOffer = career.transferOffers?.find(o => o.id === negotiatingOffer!.id)
        if (updatedOffer) {
          negotiatingOffer = updatedOffer
          counterAmount = Math.round(updatedOffer.amount * 1.10 / 100_000) * 100_000
        }
      }
    }
  }

  // ====== Mercato attivo (3.G.2) ======

  async function handleWithdraw(o: TransferOffer) {
    if (!career) return
    const res = withdrawMyOffer(career, o.id)
    if (res.ok) {
      actionOk = true
      const p = playerOfOffer(o)
      actionMsg = `Offerta ritirata${p ? ` per ${p.firstName} ${p.lastName}` : ''}.`
      await persistActiveCareer()
    } else {
      actionOk = false
      actionMsg = res.reason ?? 'Operazione non riuscita.'
    }
    setTimeout(() => { actionMsg = null }, 3500)
  }

  function openMakeOffer(player: Player, replaceId?: string) {
    offerPlayerTarget = player
    // Default: 5% sopra MV per partire competitivi
    offerAmount = Math.round(player.marketValue * 1.05 / 100_000) * 100_000
    offerMsg = null
    offerOutcome = null
    replaceOfferId = replaceId
  }

  function closeMakeOffer() {
    offerPlayerTarget = null
    offerAmount = 0
    offerMsg = null
    offerOutcome = null
    replaceOfferId = undefined
  }

  function setOfferPct(pct: number) {
    if (!offerPlayerTarget) return
    offerAmount = Math.round(offerPlayerTarget.marketValue * (1 + pct / 100) / 100_000) * 100_000
  }

  async function handleSubmitMyOffer() {
    if (!career || !offerPlayerTarget) return
    const res = submitMyOffer(career, offerPlayerTarget.id, offerAmount, replaceOfferId)
    offerOk = res.ok
    offerMsg = res.message ?? res.reason ?? null
    offerOutcome = res.outcome ?? null
    if (res.ok) {
      await persistActiveCareer()
      // accepted = trasferimento fatto → chiudi dopo 3s
      // countered = AI ha contropreposto, offer pending → chiudi dopo 4s, l'offerta appare in "Le mie offerte"
      // rejected = AI ha rifiutato → chiudi dopo 3s
      const delay = res.outcome === 'rejected' ? 2800 : 3500
      setTimeout(() => closeMakeOffer(), delay)
    }
  }

  function runSearch() {
    if (!career) return
    const myId = career.club.teamId
    const all = Object.values(career.players)
    const budget = filterBudgetMax > 0 ? filterBudgetMax : (finances?.cash ?? 0)
    const results = all.filter(p => {
      if (!p.teamId || p.teamId === myId) return false
      if (calcOverall(p) < filterOvrMin) return false
      if (playerAge(p) > filterAgeMax) return false
      if (p.marketValue > budget) return false
      if (filterRole !== 'ALL' && POSITION_GROUP[p.position] !== filterRole) return false
      return true
    })
    // Ordina per OVR desc, limita a 30 per non sovraccaricare UI
    results.sort((a, b) => calcOverall(b) - calcOverall(a))
    searchResults = results.slice(0, 30)
    searchActive = true
  }

  function clearSearch() {
    searchResults = []
    searchActive = false
  }

  function interestColor(level: InterestLevel): string {
    if (level === 'forte') return 'interest-strong'
    if (level === 'esplorativo') return 'interest-low'
    return 'interest-mid'
  }

  function interestLabel(level: InterestLevel): string {
    if (level === 'forte') return 'Forte interesse'
    if (level === 'esplorativo') return 'Sondaggio'
    return 'Concreta'
  }

  function windowLabel(w: 'summer' | 'winter' | 'closed'): string {
    if (w === 'summer') return 'Aperta — Mercato estivo'
    if (w === 'winter') return 'Aperta — Mercato di gennaio'
    return 'Chiusa'
  }

  function openPlayer(id: string) { push(`/player/${id}`) }
</script>

<svelte:window onkeydown={(e) => {
  if (e.key !== 'Escape') return
  if (negotiatingOffer) closeNegotiate()
  else if (offerPlayerTarget) closeMakeOffer()
}} />

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

    <!-- ====== Tabs ====== -->
    <div class="tabs" role="tablist">
      <button
        class="tab"
        class:active={activeTab === 'received'}
        onclick={() => activeTab = 'received'}
        role="tab"
        aria-selected={activeTab === 'received'}
      >
        📥 Ricevute
        {#if pendingOffers.length > 0}<span class="tab-badge">{pendingOffers.length}</span>{/if}
      </button>
      <button
        class="tab"
        class:active={activeTab === 'mine'}
        onclick={() => activeTab = 'mine'}
        role="tab"
        aria-selected={activeTab === 'mine'}
      >
        📤 Le mie
        {#if myOffers.length > 0}<span class="tab-badge mine">{myOffers.length}</span>{/if}
      </button>
      <button
        class="tab"
        class:active={activeTab === 'search'}
        onclick={() => activeTab = 'search'}
        role="tab"
        aria-selected={activeTab === 'search'}
      >
        🔍 Cerca giocatori
      </button>
      <button
        class="tab"
        class:active={activeTab === 'history'}
        onclick={() => activeTab = 'history'}
        role="tab"
        aria-selected={activeTab === 'history'}
      >
        📒 Storico
      </button>
    </div>

    {#if activeTab === 'received'}
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
              {@const interest = computeInterestLevel(o.amount, p.marketValue)}
              {@const negLeft = 2 - (o.negotiationsCount ?? 0)}
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
                  <span class="interest-chip {interestColor(interest)}">{interestLabel(interest)}</span>
                </div>
                <div class="offer-actions">
                  <div class="expire-chip" class:urgent={expIn <= 1}>Scade in {expIn} g.</div>
                  <button class="btn-gold accept-btn" onclick={() => handleAccept(o)}>✓ Accetta</button>
                  <button
                    class="btn-trattativa"
                    onclick={() => openNegotiate(o)}
                    disabled={negLeft <= 0}
                    title={negLeft > 0 ? `Apri una controproposta (${negLeft} rimaste)` : 'Hai esaurito i tentativi'}
                  >
                    💬 Trattativa{negLeft < 2 ? ` (${negLeft})` : ''}
                  </button>
                  <button class="btn-reject" onclick={() => handleReject(o)}>✗ Rifiuta</button>
                </div>
              </article>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
    {/if}

    {#if activeTab === 'mine'}
    <section>
      <h2 class="section-h">Le mie offerte</h2>
      {#if myOffers.length === 0}
        <div class="empty card-gold">
          <span class="empty-icon">📤</span>
          <p>
            Non hai offerte in corso verso giocatori AI. Vai su <button class="link-btn" onclick={() => activeTab = 'search'}>Cerca giocatori</button> per fare la tua prima proposta.
          </p>
        </div>
      {:else}
        <div class="offers-list">
          {#each myOffers as o (o.id)}
            {@const p = career.players[o.playerId]}
            {@const seller = career.teams[o.toTeamId]}
            {#if p && seller}
              {@const ovr = calcOverall(p)}
              {@const expIn = o.expiresMd - career.season.currentMatchday}
              {@const interest = computeInterestLevel(o.amount, p.marketValue)}
              <article class="offer-card card-gold">
                <div class="offer-buyer">
                  <span class="crest" style="--c1: {seller.primaryColor}; --c2: {seller.secondaryColor};">{seller.shortName}</span>
                  <div class="offer-buyer-info">
                    <div class="buyer-name">{seller.name}</div>
                    <div class="buyer-meta">Controproposta da loro · Reputation {seller.reputation}</div>
                  </div>
                </div>
                <div class="offer-arrow">↩</div>
                <button class="offer-player" onclick={() => openPlayer(p.id)} title="Vedi scheda giocatore">
                  <div class="player-pos">{p.position}</div>
                  <div class="player-name-wrap">
                    <div class="player-name">{p.firstName} <strong>{p.lastName}</strong></div>
                    <div class="player-meta">OVR {ovr} · Valore {fmtMoney(p.marketValue)}</div>
                  </div>
                </button>
                <div class="offer-amount-wrap">
                  <div class="amount-l">Loro richiedono</div>
                  <div class="amount-v text-gold">{fmtMoney(o.amount)}</div>
                  {#if o.originalAmount && o.originalAmount !== o.amount}
                    <div class="amount-delta">Tu offrivi {fmtMoney(o.originalAmount)}</div>
                  {/if}
                  <span class="interest-chip {interestColor(interest)}">{interestLabel(interest)}</span>
                </div>
                <div class="offer-actions">
                  <div class="expire-chip" class:urgent={expIn <= 1}>Scade in {expIn} g.</div>
                  <button class="btn-gold accept-btn" onclick={() => handleAccept(o)}>✓ Accetta</button>
                  <button class="btn-trattativa" onclick={() => openMakeOffer(p, o.id)}>
                    💬 Rilancia
                  </button>
                  <button class="btn-reject" onclick={() => handleWithdraw(o)}>✗ Ritira</button>
                </div>
              </article>
            {/if}
          {/each}
        </div>
      {/if}
    </section>
    {/if}

    {#if activeTab === 'search'}
    <section>
      <h2 class="section-h">Cerca giocatori sul mercato</h2>
      <div class="search-filters card-gold">
        <div class="filter-row">
          <label class="filter-l">
            Ruolo
            <select bind:value={filterRole} class="filter-select">
              <option value="ALL">Tutti</option>
              <option value="GK">Portieri</option>
              <option value="DEF">Difensori</option>
              <option value="MID">Centrocampisti</option>
              <option value="ATT">Attaccanti</option>
            </select>
          </label>
          <label class="filter-l">
            OVR minimo
            <input type="number" bind:value={filterOvrMin} min="40" max="99" class="filter-input" />
          </label>
          <label class="filter-l">
            Età massima
            <input type="number" bind:value={filterAgeMax} min="16" max="40" class="filter-input" />
          </label>
          <label class="filter-l">
            Budget max (€, 0=cassa)
            <input type="number" bind:value={filterBudgetMax} min="0" step="500000" class="filter-input" />
          </label>
          <button class="btn-gold filter-btn" onclick={runSearch}>🔍 Cerca</button>
          {#if searchActive}
            <button class="btn-reject filter-btn" onclick={clearSearch}>Reset</button>
          {/if}
        </div>
        {#if window === 'closed'}
          <div class="filter-warn">⚠ Finestra di mercato chiusa. Puoi cercare ma non inviare offerte.</div>
        {/if}
      </div>

      {#if searchActive}
        {#if searchResults.length === 0}
          <div class="empty card-gold">
            <span class="empty-icon">🚫</span>
            <p>Nessun giocatore trovato con questi filtri. Prova ad allargare i criteri (OVR più basso o budget più alto).</p>
          </div>
        {:else}
          <div class="search-results card-gold">
            <div class="search-summary">{searchResults.length} risultati (top 30 per OVR)</div>
            {#each searchResults as p (p.id)}
              {@const team = p.teamId ? career.teams[p.teamId] : null}
              {@const ovr = calcOverall(p)}
              <div class="search-row">
                <button class="search-player" onclick={() => openPlayer(p.id)} title="Vedi scheda giocatore">
                  <span class="hpos">{p.position}</span>
                  <span class="search-name">{p.firstName} <strong>{p.lastName}</strong></span>
                  <span class="search-age">{playerAge(p)} anni</span>
                </button>
                <div class="search-team">
                  {#if team}
                    <span class="crest small" style="--c1: {team.primaryColor}; --c2: {team.secondaryColor};">{team.shortName}</span>
                    <span class="search-team-name">{team.name}</span>
                  {/if}
                </div>
                <div class="search-stat">
                  <span class="stat-l">OVR</span>
                  <span class="stat-v text-gold">{ovr}</span>
                </div>
                <div class="search-stat">
                  <span class="stat-l">Valore</span>
                  <span class="stat-v">{fmtMoney(p.marketValue)}</span>
                </div>
                <button
                  class="btn-trattativa search-offer-btn"
                  onclick={() => openMakeOffer(p)}
                  disabled={window === 'closed'}
                  title={window === 'closed' ? 'Mercato chiuso' : 'Fai un\'offerta'}
                >
                  💰 Fai offerta
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="empty card-gold">
          <span class="empty-icon">🔍</span>
          <p>Imposta i filtri e premi <strong>Cerca</strong> per esplorare i giocatori sul mercato. Solo player di altri club sono mostrati.</p>
        </div>
      {/if}
    </section>
    {/if}

    {#if activeTab === 'history'}
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
    {/if}

    <section class="info-note">
      <p>
        Le <strong>finestre di mercato</strong> sono attive nelle giornate <strong>1-3</strong> (coda mercato estivo) e <strong>19-21</strong> (gennaio).
        Fuori da questi periodi nessuna squadra può fare nuove offerte.
      </p>
      <p>
        Le offerte hanno validità di <strong>2 giornate</strong>. Accettando, il giocatore cambia squadra
        immediatamente e i soldi si muovono. Le <strong>controproposte AI</strong> alle tue offerte compaiono
        nella tab "Le mie". I trasferimenti tra altre squadre (AI↔AI) vengono mostrati nello "Storico" e nelle news.
      </p>
    </section>

    <!-- ====== Modale Trattativa ====== -->
    {#if negotiatingOffer}
      {@const p = playerOfOffer(negotiatingOffer)}
      {@const buyer = teamOfOffer(negotiatingOffer)}
      {#if p && buyer}
        <div
          class="modal-backdrop"
          onclick={closeNegotiate}
          onkeydown={(e) => { if (e.key === 'Escape') closeNegotiate() }}
          role="presentation"
          tabindex="-1"
        >
          <div
            class="modal-trattativa card-gold"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title-trattativa"
            tabindex="-1"
          >
            <header class="modal-head">
              <div class="modal-h-l">
                <span class="crest" style="--c1: {buyer.primaryColor}; --c2: {buyer.secondaryColor};">{buyer.shortName}</span>
                <div>
                  <h3 class="modal-title" id="modal-title-trattativa">Trattativa con {buyer.name}</h3>
                  <div class="modal-sub">Per <strong>{p.firstName} {p.lastName}</strong> · {p.position} · OVR {calcOverall(p)} · Valore {fmtMoney(p.marketValue)}</div>
                </div>
              </div>
              <button class="modal-close" onclick={closeNegotiate} aria-label="Chiudi">✗</button>
            </header>

            <div class="modal-stats">
              <div class="stat">
                <span class="stat-l">Offerta originale</span>
                <span class="stat-v">{fmtMoney(negotiatingOffer.originalAmount ?? negotiatingOffer.amount)}</span>
              </div>
              <div class="stat">
                <span class="stat-l">Offerta corrente</span>
                <span class="stat-v text-gold">{fmtMoney(negotiatingOffer.amount)}</span>
              </div>
              <div class="stat">
                <span class="stat-l">Tentativi rimasti</span>
                <span class="stat-v">{2 - (negotiatingOffer.negotiationsCount ?? 0)} / 2</span>
              </div>
            </div>

            <div class="modal-form">
              <label class="counter-label">
                <span>La tua controproposta</span>
                <div class="counter-input-wrap">
                  <span class="counter-prefix">€</span>
                  <input
                    type="number"
                    class="counter-input"
                    bind:value={counterAmount}
                    min={Math.max(p.marketValue, negotiatingOffer.amount + 100_000)}
                    step="100000"
                  />
                </div>
              </label>
              <div class="counter-presets">
                <button class="preset-btn" onclick={() => setCounterPct(negotiatingOffer, 10)}>+10%</button>
                <button class="preset-btn" onclick={() => setCounterPct(negotiatingOffer, 20)}>+20%</button>
                <button class="preset-btn" onclick={() => setCounterPct(negotiatingOffer, 30)}>+30%</button>
                <button class="preset-btn" onclick={() => setCounterPct(negotiatingOffer, 50)}>+50%</button>
              </div>
            </div>

            {#if negotiateMsg}
              <div class="negotiate-result" class:ok={negotiateOk && negotiateOutcome === 'accepted'} class:warn={negotiateOk && negotiateOutcome === 'countered'} class:err={!negotiateOk || negotiateOutcome === 'rejected'}>
                {negotiateMsg}
              </div>
            {/if}

            <div class="modal-actions">
              <button class="btn-trattativa modal-submit" onclick={handleNegotiate} disabled={(negotiatingOffer.negotiationsCount ?? 0) >= 2 || counterAmount <= negotiatingOffer.amount}>
                💬 Invia controproposta
              </button>
              <button class="btn-gold modal-accept" onclick={async () => { await handleAccept(negotiatingOffer); closeNegotiate() }}>
                ✓ Accetta {fmtMoney(negotiatingOffer.amount)}
              </button>
              <button class="btn-reject modal-reject" onclick={async () => { await handleReject(negotiatingOffer); closeNegotiate() }}>
                ✗ Chiudi trattativa
              </button>
            </div>
          </div>
        </div>
      {/if}
    {/if}

    <!-- ====== Modale Fai offerta (3.G.2) ====== -->
    {#if offerPlayerTarget}
      {@const p = offerPlayerTarget}
      {@const seller = p.teamId ? career.teams[p.teamId] : null}
      {#if seller}
        <div
          class="modal-backdrop"
          onclick={closeMakeOffer}
          onkeydown={(e) => { if (e.key === 'Escape') closeMakeOffer() }}
          role="presentation"
          tabindex="-1"
        >
          <div
            class="modal-trattativa card-gold"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title-offerta"
            tabindex="-1"
          >
            <header class="modal-head">
              <div class="modal-h-l">
                <span class="crest" style="--c1: {seller.primaryColor}; --c2: {seller.secondaryColor};">{seller.shortName}</span>
                <div>
                  <h3 class="modal-title" id="modal-title-offerta">
                    {replaceOfferId ? 'Rilancia offerta' : 'Fai un\'offerta'}
                  </h3>
                  <div class="modal-sub">
                    Per <strong>{p.firstName} {p.lastName}</strong> · {p.position} · OVR {calcOverall(p)} · Valore {fmtMoney(p.marketValue)} · Club: {seller.name}
                  </div>
                </div>
              </div>
              <button class="modal-close" onclick={closeMakeOffer} aria-label="Chiudi">✗</button>
            </header>

            <div class="modal-stats">
              <div class="stat">
                <span class="stat-l">Valore mercato</span>
                <span class="stat-v">{fmtMoney(p.marketValue)}</span>
              </div>
              <div class="stat">
                <span class="stat-l">Tua cassa</span>
                <span class="stat-v text-gold">{fmtMoney(finances.cash)}</span>
              </div>
              <div class="stat">
                <span class="stat-l">Età</span>
                <span class="stat-v">{playerAge(p)} anni</span>
              </div>
            </div>

            <div class="modal-form">
              <label class="counter-label">
                <span>La tua offerta</span>
                <div class="counter-input-wrap">
                  <span class="counter-prefix">€</span>
                  <input
                    type="number"
                    class="counter-input"
                    bind:value={offerAmount}
                    min="100000"
                    step="100000"
                  />
                </div>
              </label>
              <div class="counter-presets">
                <button class="preset-btn" onclick={() => setOfferPct(-5)}>-5% MV</button>
                <button class="preset-btn" onclick={() => setOfferPct(0)}>MV</button>
                <button class="preset-btn" onclick={() => setOfferPct(10)}>+10%</button>
                <button class="preset-btn" onclick={() => setOfferPct(25)}>+25%</button>
                <button class="preset-btn" onclick={() => setOfferPct(50)}>+50%</button>
              </div>
              <div class="form-hint">
                <strong>Tip:</strong> il prezzo di richiesta del club venditore dipende dalla sua reputation, dall'OVR del giocatore
                e dall'età. I top club non vendono i big sotto il +50% del valore. Offerte molto basse vengono rifiutate senza
                trattativa.
              </div>
            </div>

            {#if offerMsg}
              <div class="negotiate-result"
                class:ok={offerOk && offerOutcome === 'accepted'}
                class:warn={offerOk && offerOutcome === 'countered'}
                class:err={!offerOk || offerOutcome === 'rejected'}>
                {offerMsg}
              </div>
            {/if}

            <div class="modal-actions">
              <button
                class="btn-trattativa modal-submit"
                onclick={handleSubmitMyOffer}
                disabled={window === 'closed' || offerAmount <= 0 || offerAmount > finances.cash * 0.85}
              >
                {#if window === 'closed'}🚫 Mercato chiuso{:else}💰 Invia offerta{/if}
              </button>
              <button class="btn-reject modal-reject" onclick={closeMakeOffer}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</AppShell>

<style>
  /* ===== TABS (3.G.2) ===== */
  .tabs {
    display: flex;
    gap: 6px;
    margin: 14px 0 18px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
    overflow-x: auto;
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
    white-space: nowrap;
    letter-spacing: 0.02em;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tab:hover { color: #fef3c7; }
  .tab.active {
    color: #fcd34d;
  }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 12px; right: 12px; bottom: -1px;
    height: 2px;
    background: linear-gradient(90deg, #b45309, #fcd34d, #fde68a);
    border-radius: 2px 2px 0 0;
  }
  .tab-badge {
    background: rgba(252, 211, 77, 0.20);
    color: #fde68a;
    border: 1px solid rgba(252, 211, 77, 0.4);
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .tab-badge.mine {
    background: rgba(99, 102, 241, 0.20);
    color: #c7d2fe;
    border-color: rgba(99, 102, 241, 0.45);
  }

  /* ===== SEARCH FILTERS ===== */
  .search-filters {
    padding: 16px 18px;
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
    min-width: 110px;
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
  .filter-btn {
    padding: 9px 16px;
    font-size: 13px;
    height: fit-content;
  }
  .filter-warn {
    margin-top: 10px;
    padding: 8px 12px;
    background: rgba(220, 38, 38, 0.10);
    color: #fca5a5;
    border: 1px solid rgba(220, 38, 38, 0.35);
    border-radius: 6px;
    font-size: 12px;
  }

  /* ===== SEARCH RESULTS ===== */
  .search-results { padding: 6px 8px; }
  .search-summary {
    padding: 8px 12px;
    color: #918778;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-bottom: 1px solid rgba(252, 211, 77, 0.10);
    margin-bottom: 4px;
  }
  .search-row {
    display: grid;
    grid-template-columns: minmax(240px, 1fr) minmax(180px, 1fr) 80px 110px 130px;
    gap: 14px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(252, 211, 77, 0.06);
    font-size: 13px;
  }
  .search-row:last-child { border-bottom: 0; }
  .search-player {
    background: none; border: 0;
    cursor: pointer;
    text-align: left;
    color: #fef3c7;
    font-family: inherit;
    font-size: 13px;
    padding: 4px 0;
    display: flex; align-items: center; gap: 10px;
  }
  .search-player:hover { color: #fde68a; }
  .search-player:hover .search-name { text-decoration: underline; }
  .search-name strong { font-weight: 800; }
  .search-age { color: #918778; font-size: 11px; font-weight: 600; }
  .search-team {
    display: flex; align-items: center; gap: 8px;
    color: #d4cfc1;
    font-size: 12px;
  }
  .search-team-name {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 180px;
  }
  .crest.small { width: 28px; height: 28px; font-size: 10px; }
  .search-stat { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
  .search-stat .stat-l { color: #918778; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
  .search-stat .stat-v { color: #fef3c7; font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; }
  .search-offer-btn { padding: 7px 12px; font-size: 12px; }

  /* ===== LINK BTN inline ===== */
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

  /* ===== FORM HINT ===== */
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

  /* Bottone Rifiuta: stesso shape di Accetta ma rosso pieno */
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
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 2px 8px rgba(220, 38, 38, 0.18);
    transition: transform 0.1s, box-shadow 0.15s;
    letter-spacing: 0.02em;
  }
  .btn-reject:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 4px 14px rgba(220, 38, 38, 0.32);
  }
  .btn-reject:active:not(:disabled) { transform: translateY(0); }
  .btn-reject:disabled { opacity: 0.55; cursor: not-allowed; }

  /* Bottone Trattativa: blu/indaco simile a forma di accetta */
  .btn-trattativa {
    padding: 8px 14px;
    font-size: 13px;
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
  .btn-trattativa:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 4px 14px rgba(99, 102, 241, 0.36);
  }
  .btn-trattativa:active:not(:disabled) { transform: translateY(0); }
  .btn-trattativa:disabled { opacity: 0.50; cursor: not-allowed; }

  /* Chip "livello interesse" sotto importo */
  .interest-chip {
    display: inline-block;
    margin-top: 4px;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .interest-strong {
    background: rgba(34, 197, 94, 0.18);
    color: #86efac;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }
  .interest-mid {
    background: rgba(252, 211, 77, 0.15);
    color: #fde68a;
    border: 1px solid rgba(252, 211, 77, 0.4);
  }
  .interest-low {
    background: rgba(120, 113, 108, 0.18);
    color: #d4cfc1;
    border: 1px solid rgba(120, 113, 108, 0.4);
  }

  /* ===== MODALE TRATTATIVA ===== */
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
  .modal-trattativa {
    width: min(560px, 100%);
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
  .modal-h-l { display: flex; gap: 12px; align-items: center; }
  .modal-title { margin: 0; color: #fef3c7; font-size: 17px; font-weight: 800; }
  .modal-sub { color: #b8b0a0; font-size: 12px; margin-top: 3px; }
  .modal-sub strong { color: #fef3c7; }
  .modal-close {
    background: none;
    border: 0;
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
  .counter-label {
    display: flex; flex-direction: column; gap: 6px;
    color: #d4cfc1;
    font-size: 13px;
    font-weight: 600;
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
    font-size: 18px;
  }
  .counter-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(252, 211, 77, 0.3);
    color: #fef3c7;
    border-radius: 8px;
    padding: 12px 14px 12px 32px;
    font-size: 18px;
    font-weight: 800;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    transition: border 0.15s;
  }
  .counter-input:focus {
    outline: none;
    border-color: rgba(252, 211, 77, 0.6);
    box-shadow: 0 0 0 3px rgba(252, 211, 77, 0.12);
  }

  .counter-presets {
    display: flex;
    gap: 8px;
    margin-top: 8px;
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
  .modal-accept { padding: 10px 14px; font-size: 13px; }
  .modal-reject { padding: 10px 14px; font-size: 13px; }

  @media (max-width: 600px) {
    .modal-stats { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .modal-stats .stat-v { font-size: 13px; }
    .modal-actions { grid-template-columns: 1fr; }
    .modal-submit { grid-column: auto; }
  }

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
    .search-row { grid-template-columns: 1fr 1fr; row-gap: 6px; }
    .search-team, .search-stat, .search-offer-btn { grid-column: auto; }
  }
</style>
