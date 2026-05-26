/**
 * Mercato giocatori — Fase 3.G.1 (passive mode).
 *
 * In questa prima iterazione gestiamo SOLO offerte AI → MIO club:
 * - Finestre mercato deterministiche su matchday (estate 1-3, inverno 19-21)
 * - tick periodico durante la finestra: ogni team AI con balance sufficiente
 *   ha una piccola prob/MD di fare un'offerta su un mio giocatore
 * - Valutazione realistica: marketValue * (rep buyer) * (premio giovani) ± jitter
 * - Accept/reject muta finanze (clubFinances.cash) + sposta player.teamId +
 *   pulisce lineup mio club dal giocatore venduto + log history + news
 * - Auto-expire delle offerte dopo 2 matchday
 *
 * Le offerte MIE verso AI e gli scambi AI↔AI arriveranno in Fase 3.G.2.
 * Svincoli/rinnovi automatici a fine stagione arriveranno in Fase 3.G.3.
 *
 * Pattern coerente con resto della Fase 3:
 * - Determinismo rigoroso: rng dedicato per ogni tick (seed ^ md ^ magic)
 * - Backward-compat: ensureTransferState() per save legacy
 * - Sincronia clubFinances.cash ↔ team.balance per il mio club
 */

import type { EntityId, Player, Team } from '$engine/types'
import type {
  Career, TransferOffer, CompletedTransfer, TransferOfferStatus, NewsItem
} from './types'
import { createRng, generateId, type Rng } from '$engine/gen/rng'
import { calcOverall } from '$engine/gen/player'
import { ensureClubFinances } from './finances'

/** Cap history trasferimenti completati */
const HISTORY_CAP = 30
/** Cap offerte tracked (pending + recenti chiuse) prima del pruning */
const OFFERS_TRACKED_CAP = 50
/** Durata default offerta in matchday (settimane) */
const OFFER_VALIDITY_MD = 2

// ====== Finestra mercato ======

export type TransferWindow = 'summer' | 'winter' | 'closed'

/**
 * Finestre deterministiche dal matchday corrente.
 * - Estate (tail mercato estivo IT): MD 1-3 (~22 Ago → 5 Set)
 * - Inverno (gennaio IT): MD 19-21 (~1-21 Gen)
 * Il resto della stagione è 'closed' (nessuna offerta generata).
 */
export function currentTransferWindow(matchday: number): TransferWindow {
  if (matchday >= 1 && matchday <= 3) return 'summer'
  if (matchday >= 19 && matchday <= 21) return 'winter'
  return 'closed'
}

export function isTransferWindowOpen(career: Career): boolean {
  return currentTransferWindow(career.season.currentMatchday) !== 'closed'
}

/** Quante giornate restano della finestra corrente (0 se chiusa) */
export function transferWindowRemainingMd(career: Career): number {
  const md = career.season.currentMatchday
  if (md >= 1 && md <= 3) return 3 - md + 1
  if (md >= 19 && md <= 21) return 21 - md + 1
  return 0
}

/** Quante giornate alla prossima apertura della finestra (0 se già aperta) */
export function matchdaysToNextWindow(career: Career): number {
  const md = career.season.currentMatchday
  if (currentTransferWindow(md) !== 'closed') return 0
  if (md < 19) return 19 - md
  // se md >= 22, prossima finestra è MD 1 della stagione seguente
  return 38 - md + 1
}

// ====== Ensure state (backward-compat) ======

export function ensureTransferState(career: Career): {
  offers: TransferOffer[]
  history: CompletedTransfer[]
} {
  if (!career.transferOffers) career.transferOffers = []
  if (!career.transferHistory) career.transferHistory = []
  return { offers: career.transferOffers, history: career.transferHistory }
}

// ====== Helpers ======

function ageFromBirth(birthDate: string, refYear: number): number {
  const b = new Date(birthDate)
  const ref = new Date(`${refYear}-07-01`)
  let a = ref.getUTCFullYear() - b.getUTCFullYear()
  const m = ref.getUTCMonth() - b.getUTCMonth()
  if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) a--
  return a
}

/** Calcola la data in-game approssimativa per un matchday (MD1 = season.year-08-22) */
function inGameDate(career: Career, matchday: number): string {
  const start = new Date(`${career.season.year}-08-22T00:00:00Z`)
  const ms = start.getTime() + (matchday - 1) * 7 * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Formatter € inline per news/UI: "€12,5M" / "€850k" */
function fmtMoneyInline(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (abs >= 1_000) return `${sign}€${Math.round(abs / 1_000)}k`
  return `${sign}€${Math.round(abs)}`
}

// ====== Valutazione offerta ======

/**
 * Importo plausibile per un'offerta — realismo Serie A. Base = marketValue.
 *
 * Modulatori:
 * - Reputation buyer: rep 50 = ×1.00, rep 90 = ×1.25 (top club pagano di più)
 * - Bias top player: OVR ≥ 80 → ×1.15-1.30 (i big sono contesi, prezzi gonfi)
 * - Premio sviluppo: giovane 18-22 con potential ≥ 75 → +20%
 * - Lowball occasionale (10% delle volte): buyer prova un'offerta -15% sotto MV
 *   per testare la disponibilità del venditore
 * - Jitter: ±12% deterministic dal rng
 * - Minimo standard: 80% del marketValue (escluso lowball che va a 0.85 * 0.85 ≈ 72%)
 * - Arrotondamento a 100k per leggibilità
 */
export function computeOfferAmount(
  player: Player,
  buyerTeam: Team,
  refYear: number,
  rng: Rng,
  playerOverall?: number
): number {
  const mv = player.marketValue
  const ovr = playerOverall ?? calcOverall(player)
  let amount = mv

  // Reputation buyer
  const buyerRepFactor = 1 + Math.max(0, buyerTeam.reputation - 50) / 160
  amount *= buyerRepFactor

  // Bias top player (i campioni sono pagati sopra prezzo)
  if (ovr >= 85) amount *= 1.30
  else if (ovr >= 80) amount *= 1.18
  else if (ovr >= 75) amount *= 1.08

  // Premio sviluppo
  const age = ageFromBirth(player.birthDate, refYear)
  const pot = player.potential ?? 70
  if (age >= 18 && age <= 22 && pot >= 75) {
    amount *= 1.20
  }

  // Lowball: 10% chance buyer prova un'offerta esplorativa bassa
  const isLowball = rng.next() < 0.10
  if (isLowball) {
    amount = mv * 0.85
  } else {
    amount *= 0.88 + rng.next() * 0.24  // ±12%
    amount = Math.max(amount, mv * 0.80)
  }

  return Math.round(amount / 100_000) * 100_000
}

/**
 * Livello di interesse del buyer in base al rapporto amount/marketValue.
 * Usato per UI badge.
 */
export type InterestLevel = 'esplorativo' | 'concreto' | 'forte'

export function computeInterestLevel(offerAmount: number, marketValue: number): InterestLevel {
  if (marketValue <= 0) return 'concreto'
  const ratio = offerAmount / marketValue
  if (ratio < 0.95) return 'esplorativo'  // sotto MV = sondaggio
  if (ratio >= 1.18) return 'forte'        // sopra MV +18% = vogliono davvero
  return 'concreto'                         // intorno a MV = serio
}

// ====== AI buyer ======

/**
 * Probabilità che un buyer AI generi una nuova offerta in un dato matchday,
 * scalata su reputation. Calibrazione realistica Serie A:
 * - rep ≥ 80 (top): 25%/MD - i big sono molto attivi sul mercato
 * - rep 65-79 (upper-mid): 16%/MD
 * - rep 50-64 (mid): 9%/MD
 * - rep < 50 (low): 4%/MD - club piccoli scoutano poco fuori dai loro player
 */
function offerProbForReputation(rep: number): number {
  if (rep >= 80) return 0.25
  if (rep >= 65) return 0.16
  if (rep >= 50) return 0.09
  return 0.04
}

/**
 * Cerca un giocatore del MIO club che `buyer` potrebbe voler comprare.
 * Strategia: buyer cerca upgrade — overall del target > overall medio rosa
 * buyer + 2 — affordable (≤ 35% del balance del buyer) e NON il mio capitano.
 * Esclude giocatori già oggetto di un'offerta pending da QUESTO buyer.
 *
 * Picking pesato: la prob di essere scelto cresce con (ovr - threshold)^2.
 * I top player vengono presi di mira molto più spesso (realismo: tutti
 * vorrebbero quelli forti, pochi vogliono quelli mediocri).
 */
function pickMyPlayerToTarget(
  career: Career,
  buyer: Team,
  existingPendingByBuyer: Set<EntityId>,
  rng: Rng
): { player: Player; overall: number } | null {
  const myTeamId = career.club.teamId
  const myPlayers = Object.values(career.players).filter(p => p.teamId === myTeamId)
  if (myPlayers.length === 0) return null

  const buyerRoster = Object.values(career.players).filter(p => p.teamId === buyer.id)
  if (buyerRoster.length === 0) return null
  const buyerAvgOvr = buyerRoster.reduce((s, p) => s + calcOverall(p), 0) / buyerRoster.length

  const captainId = career.club.tactics.captainId
  const maxAffordable = buyer.balance * 0.35
  const threshold = buyerAvgOvr + 2

  // Pre-calcola overall per ogni candidato (evita double-compute)
  type Cand = { player: Player; overall: number; weight: number }
  const candidates: Cand[] = []
  for (const p of myPlayers) {
    if (p.id === captainId) continue
    if (existingPendingByBuyer.has(p.id)) continue
    if (p.marketValue > maxAffordable) continue
    const ovr = calcOverall(p)
    if (ovr <= threshold) continue
    const weight = Math.pow(ovr - threshold, 2)  // bias quadratico sui top
    candidates.push({ player: p, overall: ovr, weight })
  }
  if (candidates.length === 0) return null

  // Weighted random pick
  const total = candidates.reduce((s, c) => s + c.weight, 0)
  let r = rng.next() * total
  for (const c of candidates) {
    r -= c.weight
    if (r <= 0) return { player: c.player, overall: c.overall }
  }
  // Fallback (numeric drift)
  const last = candidates[candidates.length - 1]
  return { player: last.player, overall: last.overall }
}

// ====== Tick offerte ======

/**
 * Genera offerte AI verso il MIO club durante la finestra di mercato.
 * Indipendentemente dalla finestra, marca le offerte 'pending' scadute.
 *
 * Determinismo: rng dedicato per matchday.
 *
 * Da chiamare in advanceMatchday DOPO l'incremento di currentMatchday e DOPO
 * il weekly tick finanze. Quindi `matchday` ricevuto è il matchday APPENA
 * GIOCATO (= il currentMatchday letto prima dell'incremento).
 */
export function tickTransferOffers(career: Career, matchday: number): void {
  ensureTransferState(career)
  // Scadenze prima di tutto (anche con window chiusa)
  expireOldOffers(career, matchday)

  const window = currentTransferWindow(matchday)
  if (window === 'closed') return

  const { offers } = ensureTransferState(career)
  const myTeamId = career.club.teamId
  const refYear = career.season.year
  const rng = createRng((career.seed ^ matchday ^ 0x71A45F) >>> 0)
  const newsDate = inGameDate(career, matchday)

  // Itera tutti gli AI buyer in ordine deterministico (per id)
  const aiBuyers = Object.values(career.teams)
    .filter(t => t.id !== myTeamId)
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const buyer of aiBuyers) {
    if (buyer.balance < 5_000_000) continue
    // Probabilità tiered su reputation (vedi offerProbForReputation)
    if (!rng.chance(offerProbForReputation(buyer.reputation))) continue

    // Set dei giocatori per cui questo buyer ha già un'offerta pending
    const existingByBuyer = new Set(
      offers
        .filter(o => o.fromTeamId === buyer.id && o.status === 'pending')
        .map(o => o.playerId)
    )
    const pick = pickMyPlayerToTarget(career, buyer, existingByBuyer, rng)
    if (!pick) continue
    const target = pick.player

    const amount = computeOfferAmount(target, buyer, refYear, rng, pick.overall)
    // Affordability double-check (50% balance hard cap)
    if (amount > buyer.balance * 0.5) continue

    const offer: TransferOffer = {
      id: generateId(rng),
      fromTeamId: buyer.id,
      toTeamId: target.teamId!,
      playerId: target.id,
      amount,
      originalAmount: amount,
      createdMd: matchday,
      expiresMd: matchday + OFFER_VALIDITY_MD,
      status: 'pending',
      negotiationsCount: 0,
    }
    offers.push(offer)

    // News al feed con livello interesse
    const interest = computeInterestLevel(amount, target.marketValue)
    const interestTxt =
      interest === 'forte' ? 'forte interesse' :
      interest === 'esplorativo' ? 'sondaggio esplorativo' :
      'offerta concreta'
    career.news.unshift({
      id: generateId(rng),
      date: newsDate,
      kind: 'transfer',
      title: `${buyer.shortName} su ${target.lastName} — ${fmtMoneyInline(amount)}`,
      body: `${buyer.name} presenta un'${interestTxt} per ${target.firstName} ${target.lastName} (${target.position}, OVR ${pick.overall}). Risposta entro ${OFFER_VALIDITY_MD} settimane.`,
      read: false,
    })
  }

  if (career.news.length > 50) career.news.length = 50

  // Pruning: limita le offerte tracked
  pruneOffers(career)
}

/** Marca 'expired' le pending oltre la scadenza */
export function expireOldOffers(career: Career, matchday: number): void {
  const { offers } = ensureTransferState(career)
  for (const o of offers) {
    if (o.status === 'pending' && o.expiresMd <= matchday) {
      o.status = 'expired'
    }
  }
}

/** Limita il numero di offerte tenute in memoria. Pending non vengono mai potate. */
function pruneOffers(career: Career): void {
  const { offers } = ensureTransferState(career)
  if (offers.length <= OFFERS_TRACKED_CAP) return
  const pending = offers.filter(o => o.status === 'pending')
  const closed = offers.filter(o => o.status !== 'pending')
  // Tieni le più recenti chiuse (ordinate per createdMd desc)
  closed.sort((a, b) => b.createdMd - a.createdMd)
  const keepClosed = closed.slice(0, OFFERS_TRACKED_CAP - pending.length)
  career.transferOffers = [...pending, ...keepClosed]
}

// ====== executeTransfer (helper condiviso) ======

/**
 * Finalizza il trasferimento di `player` da `seller` a `buyer` per `amount` €
 * al matchday `md`. Usato sia da `acceptOffer` (offerte ricevute pending) che
 * da `submitMyOffer` (mie offerte accettate al volo) che dai trasferimenti
 * AI↔AI di sottofondo (Fase 3.G.2.b).
 *
 * Esegue:
 * - Cassa venditore (riceve) — sync clubFinances ↔ team.balance per mio club
 * - Cassa compratore (paga) — idem
 * - player.teamId = buyer.id
 * - Pulisce lineup mio club se è una mia cessione (anche capitano se necessario)
 * - Aggiunge `CompletedTransfer` a transferHistory
 * - News al feed (verbosity scalata: `silent=true` per AI↔AI di massa per non
 *   spammare; comunque l'entry in history c'è per cronologia /transfers)
 */
function executeTransfer(
  career: Career,
  player: Player,
  seller: Team,
  buyer: Team,
  amount: number,
  md: number,
  opts: { silent?: boolean } = {}
): CompletedTransfer {
  const { history } = ensureTransferState(career)
  const myTeamId = career.club.teamId
  const date = inGameDate(career, md)
  const profitLoss = amount - player.marketValue

  // ----- Cassa venditore (riceve) -----
  if (seller.id === myTeamId) {
    const finances = ensureClubFinances(career)
    finances.cash += amount
    finances.history.unshift({
      matchday: md,
      label: `Cessione ${player.lastName} → ${buyer.shortName}`,
      amount,
      balanceAfter: finances.cash,
    })
    if (finances.history.length > 30) finances.history.length = 30
    seller.balance = finances.cash
  } else {
    seller.balance += amount
  }

  // ----- Cassa compratore (paga) -----
  if (buyer.id === myTeamId) {
    const finances = ensureClubFinances(career)
    finances.cash -= amount
    finances.history.unshift({
      matchday: md,
      label: `Acquisto ${player.lastName} ← ${seller.shortName}`,
      amount: -amount,
      balanceAfter: finances.cash,
    })
    if (finances.history.length > 30) finances.history.length = 30
    buyer.balance = finances.cash
  } else {
    buyer.balance = Math.max(0, buyer.balance - amount)
  }

  // ----- Trasferimento -----
  player.teamId = buyer.id

  // ----- Pulisci lineup mio club se vendo io -----
  if (seller.id === myTeamId) {
    const starters = career.club.lineup.starters
    const bench = career.club.lineup.bench
    career.club.lineup.starters = starters.filter(id => id !== player.id)
    career.club.lineup.bench = bench.filter(id => id !== player.id)
    if (career.club.tactics.captainId === player.id) {
      career.club.tactics.captainId = career.club.lineup.starters[0]
    }
  }

  // ----- History -----
  const completed: CompletedTransfer = {
    id: generateId(createRng((career.seed ^ md ^ 0x71A461 ^ player.id.charCodeAt(0)) >>> 0)),
    matchday: md,
    date,
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    position: player.position,
    fromTeamId: seller.id,
    fromTeamName: seller.shortName,
    toTeamId: buyer.id,
    toTeamName: buyer.shortName,
    amount,
    profitLoss,
    isMineSold: seller.id === myTeamId,
    isMineBought: buyer.id === myTeamId,
  }
  history.unshift(completed)
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP

  // ----- News -----
  if (!opts.silent) {
    const rngNews = createRng((career.seed ^ md ^ 0x71A460 ^ player.id.charCodeAt(0)) >>> 0)
    const isMineInvolved = seller.id === myTeamId || buyer.id === myTeamId
    const title = isMineInvolved
      ? `Trasferimento ufficiale: ${completed.playerName} → ${buyer.shortName}`
      : `Mercato: ${completed.playerName} dal ${seller.shortName} al ${buyer.shortName}`
    career.news.unshift({
      id: generateId(rngNews),
      date,
      kind: 'transfer',
      title,
      body: `${completed.playerName} (${player.position}) passa dal ${seller.name} al ${buyer.name} per ${fmtMoneyInline(amount)}.`,
      read: false,
    })
    if (career.news.length > 50) career.news.length = 50
  }

  career.updatedAt = Date.now()
  return completed
}

// ====== Accept / Reject ======

export interface TransferActionResult {
  ok: boolean
  reason?: string
  completedTransfer?: CompletedTransfer
}

/**
 * Accetta un'offerta pending. Funziona sia per offerte AI→me (cessione) sia
 * me→AI (acquisto, tipicamente dopo una controproposta dell'AI accettata).
 *
 * Esegue il transfer + marca 'accepted' + auto-reject delle altre pending per
 * stesso player. Tutto il money/lineup/history/news è dentro `executeTransfer`.
 */
export function acceptOffer(career: Career, offerId: EntityId): TransferActionResult {
  const { offers } = ensureTransferState(career)
  const offer = offers.find(o => o.id === offerId)
  if (!offer) return { ok: false, reason: 'Offerta non trovata.' }
  if (offer.status !== 'pending') return { ok: false, reason: 'Offerta non più valida.' }

  const player = career.players[offer.playerId]
  const buyer = career.teams[offer.fromTeamId]
  const seller = career.teams[offer.toTeamId]
  if (!player || !buyer || !seller) return { ok: false, reason: 'Dati incompleti.' }

  // Safety check buyer cash (per offerte mie già esistenti, evita di andare a -€)
  const myTeamId = career.club.teamId
  if (buyer.id === myTeamId) {
    const finances = ensureClubFinances(career)
    if (finances.cash < offer.amount) {
      return { ok: false, reason: `Cassa insufficiente: servono ${fmtMoneyInline(offer.amount)}, in cassa ${fmtMoneyInline(finances.cash)}.` }
    }
  }

  const completed = executeTransfer(career, player, seller, buyer, offer.amount, career.season.currentMatchday)

  // Marca offer + auto-reject delle altre pending per stesso player
  offer.status = 'accepted'
  for (const o of offers) {
    if (o.id !== offer.id && o.playerId === offer.playerId && o.status === 'pending') {
      o.status = 'rejected'
    }
  }

  return { ok: true, completedTransfer: completed }
}

// ====== Trattativa (controproposta) ======

export type NegotiateOutcome = 'accepted' | 'countered' | 'rejected'

export interface NegotiateResult {
  ok: boolean
  reason?: string
  outcome?: NegotiateOutcome
  /** Importo finale dell'offerta dopo la trattativa */
  newAmount?: number
  /** Messaggio human-readable da mostrare nella UI */
  message?: string
}

/**
 * Tetto massimo che l'AI buyer è disposto a pagare per il player.
 * Calibrato su reputation buyer + bias top player + premio giovani.
 *
 * Realismo: un top club paga 50% sopra MV un top player; un club piccolo
 * fa fatica anche solo a stare a MV.
 */
function buyerWillingnessCeiling(
  player: Player,
  buyer: Team,
  playerOverall: number,
  refYear: number
): number {
  const mv = player.marketValue
  let ceiling = mv

  if (buyer.reputation >= 80) ceiling *= 1.50
  else if (buyer.reputation >= 65) ceiling *= 1.30
  else if (buyer.reputation >= 50) ceiling *= 1.15
  else ceiling *= 1.05

  // Top player premium (gli stessi player che hanno offerte alte sopportano rilanci più alti)
  if (playerOverall >= 85) ceiling *= 1.15
  else if (playerOverall >= 80) ceiling *= 1.08

  // Premio giovani con potential alto
  const age = ageFromBirth(player.birthDate, refYear)
  const pot = player.potential ?? 70
  if (age >= 18 && age <= 22 && pot >= 80) ceiling *= 1.20

  // Hard cap: mai oltre 60% del balance del buyer (sennò fallirebbe)
  ceiling = Math.min(ceiling, buyer.balance * 0.60)
  return ceiling
}

/**
 * Avvia una trattativa: l'utente propone un nuovo importo `counterAmount`
 * all'AI buyer. Risposte possibili:
 *
 * 1. **accepted**: counter ≤ ceiling → AI accetta, `offer.amount = counter`,
 *    status resta 'pending' (l'utente DEVE ancora accettare formalmente)
 * 2. **countered**: counter ≤ ceiling × 1.15 → AI rilancia al punto medio
 *    tra l'offerta corrente e il ceiling. status resta 'pending'
 * 3. **rejected**: counter troppo alto → AI ritira l'offerta, status = 'rejected'
 *
 * Limiti:
 * - Max 2 trattative per offerta (`negotiationsCount`). Alla 3ª l'AI chiude.
 * - counter > offer.amount (rilancio reale, no sconto)
 * - counter ≥ marketValue (no svendita)
 *
 * Determinismo: rng dedicato dal seed + offer.id (per il "punto medio" jitter).
 */
export function negotiateOffer(
  career: Career,
  offerId: EntityId,
  counterAmount: number
): NegotiateResult {
  const { offers } = ensureTransferState(career)
  const offer = offers.find(o => o.id === offerId)
  if (!offer) return { ok: false, reason: 'Offerta non trovata.' }
  if (offer.status !== 'pending') return { ok: false, reason: 'Offerta non più valida.' }

  const negCount = offer.negotiationsCount ?? 0
  if (negCount >= 2) {
    return { ok: false, reason: 'Hai esaurito i tentativi di trattativa per questa offerta.' }
  }

  const player = career.players[offer.playerId]
  const buyer = career.teams[offer.fromTeamId]
  if (!player || !buyer) return { ok: false, reason: 'Dati incompleti.' }

  if (counterAmount <= offer.amount) {
    return { ok: false, reason: 'La controproposta deve essere superiore all\'offerta corrente.' }
  }
  if (counterAmount < player.marketValue) {
    return { ok: false, reason: 'La controproposta non può essere inferiore al valore di mercato.' }
  }

  const ovr = calcOverall(player)
  const ceiling = buyerWillingnessCeiling(player, buyer, ovr, career.season.year)
  // Arrotonda counter a 100k per coerenza
  const counter = Math.round(counterAmount / 100_000) * 100_000

  // Caso 1: AI accetta direttamente
  if (counter <= ceiling) {
    offer.amount = counter
    offer.negotiationsCount = negCount + 1
    return {
      ok: true,
      outcome: 'accepted',
      newAmount: counter,
      message: `${buyer.name} ha accettato la tua controproposta di ${fmtMoneyInline(counter)}. Conferma l'accordo per finalizzare.`,
    }
  }

  // Caso 2: AI rilancia al punto medio
  const stretch = ceiling * 1.15
  if (counter <= stretch) {
    const aiCounter = Math.round((offer.amount + ceiling) / 2 / 100_000) * 100_000
    offer.amount = aiCounter
    offer.negotiationsCount = negCount + 1
    return {
      ok: true,
      outcome: 'countered',
      newAmount: aiCounter,
      message: `${buyer.name} non arriva a ${fmtMoneyInline(counter)} ma rilancia a ${fmtMoneyInline(aiCounter)}.`,
    }
  }

  // Caso 3: AI rifiuta e si ritira
  offer.status = 'rejected'
  offer.negotiationsCount = negCount + 1
  return {
    ok: true,
    outcome: 'rejected',
    message: `${buyer.name} considera ${fmtMoneyInline(counter)} fuori budget e si ritira dalla trattativa.`,
  }
}

export function rejectOffer(career: Career, offerId: EntityId): TransferActionResult {
  const { offers } = ensureTransferState(career)
  const offer = offers.find(o => o.id === offerId)
  if (!offer) return { ok: false, reason: 'Offerta non trovata.' }
  if (offer.status !== 'pending') return { ok: false, reason: 'Offerta non più valida.' }
  offer.status = 'rejected'
  career.updatedAt = Date.now()
  return { ok: true }
}

// ====== Mercato attivo: io faccio offerte (Fase 3.G.2) ======

/**
 * Prezzo "richiesta" del seller AI per cedere `player`. È il dual di
 * `buyerWillingnessCeiling`: sotto questa cifra il seller non vende, sopra
 * accetta diretto, in fascia intermedia controfferta.
 *
 * Realismo: un top club vende un big SOLO se gli arriva una proposta gonfia
 * (×1.50 MV); un piccolo club molla con una proposta vicino al MV.
 */
function sellerAskingPrice(
  player: Player,
  seller: Team,
  playerOverall: number,
  refYear: number
): number {
  const mv = player.marketValue
  let asking = mv

  // Reputation seller: più è grande il club, più alza il prezzo
  if (seller.reputation >= 80) asking *= 1.50
  else if (seller.reputation >= 65) asking *= 1.30
  else if (seller.reputation >= 50) asking *= 1.15
  else asking *= 1.05

  // Top player premium (i big sono ancora più strategici)
  if (playerOverall >= 85) asking *= 1.25
  else if (playerOverall >= 80) asking *= 1.12

  // Premio giovani con potential alto (talenti sono tenuti stretti)
  const age = ageFromBirth(player.birthDate, refYear)
  const pot = player.potential ?? 70
  if (age >= 18 && age <= 22 && pot >= 80) asking *= 1.30

  return asking
}

export type MyOfferOutcome = 'accepted' | 'countered' | 'rejected'

export interface MyOfferResult {
  ok: boolean
  reason?: string
  outcome?: MyOfferOutcome
  /** Counter proposto dall'AI (se outcome === 'countered'). Nuova offer in pending. */
  counterAmount?: number
  /** Trasferimento completato (se outcome === 'accepted'). */
  completedTransfer?: CompletedTransfer
  /** Offer id creato (se outcome === 'countered'). Permette UI di metterla in evidenza. */
  offerId?: EntityId
  /** Messaggio human-readable per la UI */
  message?: string
}

/**
 * Sottometto una mia offerta verso un giocatore AI. AI seller valuta SUBITO:
 *
 * - **accepted**: amount ≥ askingPrice → transfer immediato (no offer pending)
 * - **countered**: amount ≥ askingPrice × 0.85 → AI ti controffre al 95% dell'asking,
 *   crea offer pending con `fromTeamId = mio` e `amount = counter`. Devo poi
 *   decidere se accettare/rifiutare/rilanciare via `submitMyOffer` di nuovo
 * - **rejected**: amount troppo basso → nessuna offer creata, messaggio
 *
 * Se `replaceOfferId` è passato, marca la vecchia offerta come 'rejected'
 * (usato in UI per "rilancia": chiudi vecchia, apri nuova).
 */
export function submitMyOffer(
  career: Career,
  playerId: EntityId,
  amount: number,
  replaceOfferId?: EntityId
): MyOfferResult {
  if (!isTransferWindowOpen(career)) {
    return { ok: false, reason: 'Finestra di mercato chiusa.' }
  }
  const player = career.players[playerId]
  if (!player) return { ok: false, reason: 'Giocatore non trovato.' }
  if (player.teamId === career.club.teamId) {
    return { ok: false, reason: 'Non puoi fare offerte per un tuo giocatore.' }
  }
  if (!player.teamId) return { ok: false, reason: 'Giocatore svincolato (non ancora gestibile).' }

  const seller = career.teams[player.teamId]
  const buyer = career.teams[career.club.teamId]
  if (!seller || !buyer) return { ok: false, reason: 'Dati squadra incompleti.' }

  // Validazioni amount
  if (amount <= 0) return { ok: false, reason: 'Importo non valido.' }
  amount = Math.round(amount / 100_000) * 100_000

  // Verifica cassa (con buffer 5% sicurezza)
  const finances = ensureClubFinances(career)
  if (amount > finances.cash) {
    return { ok: false, reason: `Cassa insufficiente: in cassa ${fmtMoneyInline(finances.cash)}.` }
  }
  if (amount > finances.cash * 0.85) {
    return { ok: false, reason: 'Non puoi spendere più dell\'85% della cassa in una singola offerta (margine sicurezza).' }
  }

  const { offers } = ensureTransferState(career)

  // Replace vecchia (rilancio): marca come rejected, prossima sostituisce
  if (replaceOfferId) {
    const old = offers.find(o => o.id === replaceOfferId)
    if (old && old.status === 'pending') old.status = 'rejected'
  }

  const md = career.season.currentMatchday
  const ovr = calcOverall(player)
  const asking = sellerAskingPrice(player, seller, ovr, career.season.year)
  const rng = createRng((career.seed ^ md ^ playerId.charCodeAt(0) ^ 0x71A462) >>> 0)

  // 1) Accetta diretto
  if (amount >= asking) {
    const completed = executeTransfer(career, player, seller, buyer, amount, md)
    return {
      ok: true,
      outcome: 'accepted',
      completedTransfer: completed,
      message: `${seller.name} ha accettato la tua offerta di ${fmtMoneyInline(amount)}. ${player.firstName} ${player.lastName} è ufficialmente tuo.`,
    }
  }

  // 2) Counter: AI propone il 92-98% dell'asking (jitter per realismo)
  if (amount >= asking * 0.85) {
    const counterPct = 0.92 + rng.next() * 0.06
    const counter = Math.round(asking * counterPct / 100_000) * 100_000
    const offer: TransferOffer = {
      id: generateId(rng),
      fromTeamId: buyer.id,
      toTeamId: seller.id,
      playerId: player.id,
      amount: counter,
      originalAmount: amount,
      createdMd: md,
      expiresMd: md + OFFER_VALIDITY_MD,
      status: 'pending',
      negotiationsCount: 0,
    }
    offers.push(offer)
    pruneOffers(career)

    // News al feed
    career.news.unshift({
      id: generateId(rng),
      date: inGameDate(career, md),
      kind: 'transfer',
      title: `${seller.shortName} contropropone ${fmtMoneyInline(counter)} per ${player.lastName}`,
      body: `${seller.name} valuta ${player.firstName} ${player.lastName} (${player.position}, OVR ${ovr}) almeno ${fmtMoneyInline(counter)}. Decisione richiesta entro ${OFFER_VALIDITY_MD} settimane.`,
      read: false,
    })
    if (career.news.length > 50) career.news.length = 50

    career.updatedAt = Date.now()
    return {
      ok: true,
      outcome: 'countered',
      counterAmount: counter,
      offerId: offer.id,
      message: `${seller.name} non accetta ${fmtMoneyInline(amount)} ma controffre a ${fmtMoneyInline(counter)}. Trovi l'offerta nella sezione "Le mie offerte".`,
    }
  }

  // 3) Rifiutata (offerta troppo bassa)
  career.updatedAt = Date.now()
  return {
    ok: true,
    outcome: 'rejected',
    message: `${seller.name} considera ${fmtMoneyInline(amount)} troppo bassa per ${player.lastName} e rifiuta categoricamente.`,
  }
}

/**
 * Ritira una mia offerta pending (status='pending' e fromTeamId=mio club).
 * Marca come 'rejected'. Nessuna penalità (semplificazione 3.G.2).
 */
export function withdrawMyOffer(career: Career, offerId: EntityId): TransferActionResult {
  const { offers } = ensureTransferState(career)
  const offer = offers.find(o => o.id === offerId)
  if (!offer) return { ok: false, reason: 'Offerta non trovata.' }
  if (offer.status !== 'pending') return { ok: false, reason: 'Offerta non più valida.' }
  if (offer.fromTeamId !== career.club.teamId) {
    return { ok: false, reason: 'Puoi ritirare solo le tue offerte.' }
  }
  offer.status = 'rejected'
  career.updatedAt = Date.now()
  return { ok: true }
}

// ====== Scambi AI ↔ AI di sottofondo (Fase 3.G.2.b) ======

/**
 * Cerca un player appartenente ad un AI seller diverso da `buyer` che il buyer
 * potrebbe voler comprare. Stessa logica di `pickMyPlayerToTarget` ma sull'intero
 * pool di player AI (escluso mio club, escluso roster del buyer stesso).
 *
 * Esclude target sotto i 5 per roster del seller (no auto-distruzione AI):
 * il seller deve avere almeno 18 player dopo la cessione.
 */
function pickAIPlayerToTarget(
  career: Career,
  buyer: Team,
  rng: Rng
): { player: Player; seller: Team; overall: number } | null {
  const myTeamId = career.club.teamId
  const buyerRoster = Object.values(career.players).filter(p => p.teamId === buyer.id)
  if (buyerRoster.length === 0) return null
  const buyerAvgOvr = buyerRoster.reduce((s, p) => s + calcOverall(p), 0) / buyerRoster.length
  const threshold = buyerAvgOvr + 2
  const maxAffordable = buyer.balance * 0.35

  // Conta roster size per seller (per evitare auto-distruzione)
  const rosterSizeByTeam = new Map<EntityId, number>()
  for (const p of Object.values(career.players)) {
    if (!p.teamId) continue
    rosterSizeByTeam.set(p.teamId, (rosterSizeByTeam.get(p.teamId) ?? 0) + 1)
  }

  type Cand = { player: Player; seller: Team; overall: number; weight: number }
  const candidates: Cand[] = []
  for (const p of Object.values(career.players)) {
    if (!p.teamId) continue
    if (p.teamId === myTeamId) continue          // no mio (gestito da pickMyPlayerToTarget)
    if (p.teamId === buyer.id) continue          // non da se stesso
    if ((rosterSizeByTeam.get(p.teamId) ?? 0) <= 18) continue  // seller troppo piccolo
    if (p.marketValue > maxAffordable) continue
    const ovr = calcOverall(p)
    if (ovr <= threshold) continue
    const seller = career.teams[p.teamId]
    if (!seller) continue
    candidates.push({ player: p, seller, overall: ovr, weight: Math.pow(ovr - threshold, 2) })
  }
  if (candidates.length === 0) return null

  const total = candidates.reduce((s, c) => s + c.weight, 0)
  let r = rng.next() * total
  for (const c of candidates) {
    r -= c.weight
    if (r <= 0) return { player: c.player, seller: c.seller, overall: c.overall }
  }
  const last = candidates[candidates.length - 1]
  return { player: last.player, seller: last.seller, overall: last.overall }
}

/**
 * Probabilità che un AI buyer tenti uno scambio AI↔AI in un dato matchday.
 * Tarata per ottenere ~2-3 trasferimenti completati per MD durante window
 * (39 buyers × ~0.18 prob × ~30% accept-rate ≈ 2 finalize/MD).
 *
 * Più contenuta della prob di offerta-verso-me perché qui ogni evento
 * genera SUBITO un trasferimento (non un'offerta che può essere rifiutata).
 */
function aiToAiProbForReputation(rep: number): number {
  if (rep >= 80) return 0.30
  if (rep >= 65) return 0.20
  if (rep >= 50) return 0.12
  return 0.05
}

/**
 * Tick scambi AI↔AI di sottofondo durante la finestra di mercato.
 * Ogni AI buyer ha prob di tentare un acquisto da un altro AI seller. Se
 * offer ≥ askingPrice → finalize immediato via executeTransfer (silenziato:
 * news condensata, no spam). Esiti negativi sono silenziosi (no news).
 *
 * Da chiamare DOPO `tickTransferOffers` in advanceMatchday.
 * Determinismo: rng dedicato da `seed ^ md ^ 0x71A463`.
 */
export function tickAIToAITransfers(career: Career, matchday: number): void {
  if (currentTransferWindow(matchday) === 'closed') return

  const rng = createRng((career.seed ^ matchday ^ 0x71A463) >>> 0)
  const myTeamId = career.club.teamId
  const refYear = career.season.year

  const aiBuyers = Object.values(career.teams)
    .filter(t => t.id !== myTeamId)
    .sort((a, b) => a.id.localeCompare(b.id))

  let finalizedThisTick = 0
  const MAX_PER_TICK = 4  // hard cap per non spammare news feed

  for (const buyer of aiBuyers) {
    if (finalizedThisTick >= MAX_PER_TICK) break
    if (buyer.balance < 5_000_000) continue
    if (!rng.chance(aiToAiProbForReputation(buyer.reputation))) continue

    const target = pickAIPlayerToTarget(career, buyer, rng)
    if (!target) continue

    const offerAmount = computeOfferAmount(target.player, buyer, refYear, rng, target.overall)
    if (offerAmount > buyer.balance * 0.5) continue

    const asking = sellerAskingPrice(target.player, target.seller, target.overall, refYear)
    // Per AI↔AI: niente trattativa, accetta solo se offerAmount ≥ asking
    if (offerAmount < asking) continue

    executeTransfer(career, target.player, target.seller, buyer, offerAmount, matchday)
    finalizedThisTick++
  }
}

// ====== Helpers per UI ======

/** Offerte pending verso il mio club (per inbox) */
export function pendingOffersForMyClub(career: Career): TransferOffer[] {
  const { offers } = ensureTransferState(career)
  const myId = career.club.teamId
  return offers.filter(o => o.status === 'pending' && o.toTeamId === myId)
}

/** Offerte pending dove SONO IO il buyer (counter dell'AI alle mie submission) */
export function pendingOffersFromMyClub(career: Career): TransferOffer[] {
  const { offers } = ensureTransferState(career)
  const myId = career.club.teamId
  return offers.filter(o => o.status === 'pending' && o.fromTeamId === myId)
}
