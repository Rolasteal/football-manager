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
 * Importo plausibile per un'offerta. Base = marketValue del player. Modulato:
 * - Reputation buyer: rep 50 = ×1.0, rep 90 = ×1.20 (top club paga di più)
 * - Premio sviluppo: giovane 18-22 con potential ≥ 75 → +20%
 * - Jitter: ±15% deterministic dal rng passato
 * - Minimo: 85% del marketValue (no lowball estremo)
 * - Arrotondamento a 100k per leggibilità
 */
export function computeOfferAmount(
  player: Player,
  buyerTeam: Team,
  refYear: number,
  rng: Rng
): number {
  let amount = player.marketValue
  const buyerRepFactor = 1 + Math.max(0, buyerTeam.reputation - 50) / 200
  amount *= buyerRepFactor
  const age = ageFromBirth(player.birthDate, refYear)
  const pot = player.potential ?? 70
  if (age >= 18 && age <= 22 && pot >= 75) {
    amount *= 1.20
  }
  amount *= 0.85 + rng.next() * 0.30  // ±15%
  amount = Math.max(amount, player.marketValue * 0.85)
  return Math.round(amount / 100_000) * 100_000
}

// ====== AI buyer ======

/**
 * Cerca un giocatore del MIO club che `buyer` potrebbe voler comprare.
 * Strategia: buyer cerca upgrade — overall del target > overall medio rosa
 * buyer + 2 — affordable (≤ 35% del balance del buyer) e NON il mio capitano.
 * Esclude anche giocatori già oggetto di un'offerta pending da QUESTO buyer.
 */
function pickMyPlayerToTarget(
  career: Career,
  buyer: Team,
  existingPendingByBuyer: Set<EntityId>,
  rng: Rng
): Player | null {
  const myTeamId = career.club.teamId
  const myPlayers = Object.values(career.players).filter(p => p.teamId === myTeamId)
  if (myPlayers.length === 0) return null

  const buyerRoster = Object.values(career.players).filter(p => p.teamId === buyer.id)
  if (buyerRoster.length === 0) return null
  const buyerAvgOvr = buyerRoster.reduce((s, p) => s + calcOverall(p), 0) / buyerRoster.length

  const captainId = career.club.tactics.captainId
  const maxAffordable = buyer.balance * 0.35

  const candidates = myPlayers.filter(p => {
    if (p.id === captainId) return false
    if (existingPendingByBuyer.has(p.id)) return false
    if (p.marketValue > maxAffordable) return false
    return calcOverall(p) > buyerAvgOvr + 2
  })

  if (candidates.length === 0) return null
  return candidates[Math.floor(rng.next() * candidates.length)]
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
    // Top club (rep ≥ 75) più attivi sul mercato
    const baseProb = buyer.reputation >= 75 ? 0.15 : 0.08
    if (!rng.chance(baseProb)) continue

    // Set dei giocatori per cui questo buyer ha già un'offerta pending
    const existingByBuyer = new Set(
      offers
        .filter(o => o.fromTeamId === buyer.id && o.status === 'pending')
        .map(o => o.playerId)
    )
    const target = pickMyPlayerToTarget(career, buyer, existingByBuyer, rng)
    if (!target) continue

    const amount = computeOfferAmount(target, buyer, refYear, rng)
    // Affordability double-check (50% balance hard cap)
    if (amount > buyer.balance * 0.5) continue

    const offer: TransferOffer = {
      id: generateId(rng),
      fromTeamId: buyer.id,
      toTeamId: target.teamId!,
      playerId: target.id,
      amount,
      createdMd: matchday,
      expiresMd: matchday + OFFER_VALIDITY_MD,
      status: 'pending',
    }
    offers.push(offer)

    // News al feed
    career.news.unshift({
      id: generateId(rng),
      date: newsDate,
      kind: 'transfer',
      title: `Offerta in arrivo: ${buyer.shortName} per ${target.firstName} ${target.lastName}`,
      body: `${buyer.name} offre ${fmtMoneyInline(amount)} per ${target.firstName} ${target.lastName} (${target.position}). Risposta richiesta entro ${OFFER_VALIDITY_MD} settimane.`,
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

// ====== Accept / Reject ======

export interface TransferActionResult {
  ok: boolean
  reason?: string
  completedTransfer?: CompletedTransfer
}

/**
 * Accetta un'offerta pending. Esegue:
 * 1. Sposta player.teamId al buyer
 * 2. Aggiorna cassa club venditore (mio = clubFinances.cash; AI = team.balance)
 * 3. Detrae cassa club compratore (idem)
 * 4. Aggiunge CompletedTransfer alla history
 * 5. Marca 'accepted' l'offerta + auto-reject delle altre pending per stesso player
 * 6. Pulisce il lineup mio club se è una mia cessione (rimuove ID giocatore venduto)
 * 7. News al feed
 */
export function acceptOffer(career: Career, offerId: EntityId): TransferActionResult {
  const { offers, history } = ensureTransferState(career)
  const offer = offers.find(o => o.id === offerId)
  if (!offer) return { ok: false, reason: 'Offerta non trovata.' }
  if (offer.status !== 'pending') return { ok: false, reason: 'Offerta non più valida.' }

  const player = career.players[offer.playerId]
  const buyer = career.teams[offer.fromTeamId]
  const seller = career.teams[offer.toTeamId]
  if (!player || !buyer || !seller) return { ok: false, reason: 'Dati incompleti.' }

  const myTeamId = career.club.teamId
  const md = career.season.currentMatchday
  const date = inGameDate(career, md)
  const profitLoss = offer.amount - player.marketValue

  // ----- Cassa venditore (riceve) -----
  if (seller.id === myTeamId) {
    const finances = ensureClubFinances(career)
    finances.cash += offer.amount
    finances.history.unshift({
      matchday: md,
      label: `Cessione ${player.lastName} → ${buyer.shortName}`,
      amount: offer.amount,
      balanceAfter: finances.cash,
    })
    if (finances.history.length > 30) finances.history.length = 30
    seller.balance = finances.cash
  } else {
    seller.balance += offer.amount
  }

  // ----- Cassa compratore (paga) -----
  if (buyer.id === myTeamId) {
    const finances = ensureClubFinances(career)
    finances.cash -= offer.amount
    finances.history.unshift({
      matchday: md,
      label: `Acquisto ${player.lastName} ← ${seller.shortName}`,
      amount: -offer.amount,
      balanceAfter: finances.cash,
    })
    if (finances.history.length > 30) finances.history.length = 30
    buyer.balance = finances.cash
  } else {
    buyer.balance = Math.max(0, buyer.balance - offer.amount)
  }

  // ----- Trasferimento -----
  player.teamId = buyer.id

  // ----- Pulisci lineup mio club se vendo io -----
  if (seller.id === myTeamId) {
    const starters = career.club.lineup.starters
    const bench = career.club.lineup.bench
    career.club.lineup.starters = starters.filter(id => id !== player.id)
    career.club.lineup.bench = bench.filter(id => id !== player.id)
    // Capitano venduto? Sposto su prossimo titolare disponibile
    if (career.club.tactics.captainId === player.id) {
      career.club.tactics.captainId = career.club.lineup.starters[0]
    }
  }

  // ----- Status update + auto-reject doppi -----
  offer.status = 'accepted'
  for (const o of offers) {
    if (o.id !== offer.id && o.playerId === offer.playerId && o.status === 'pending') {
      o.status = 'rejected'
    }
  }

  // ----- History -----
  const completed: CompletedTransfer = {
    id: offer.id,
    matchday: md,
    date,
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    position: player.position,
    fromTeamId: seller.id,
    fromTeamName: seller.shortName,
    toTeamId: buyer.id,
    toTeamName: buyer.shortName,
    amount: offer.amount,
    profitLoss,
    isMineSold: seller.id === myTeamId,
    isMineBought: buyer.id === myTeamId,
  }
  history.unshift(completed)
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP

  // ----- News -----
  const rngNews = createRng((career.seed ^ md ^ 0x71A460 ^ player.id.charCodeAt(0)) >>> 0)
  const newsItem: NewsItem = {
    id: generateId(rngNews),
    date,
    kind: 'transfer',
    title: `Trasferimento ufficiale: ${completed.playerName} → ${buyer.shortName}`,
    body: `${completed.playerName} (${player.position}) passa al ${buyer.name} per ${fmtMoneyInline(offer.amount)}.`,
    read: false,
  }
  career.news.unshift(newsItem)
  if (career.news.length > 50) career.news.length = 50

  career.updatedAt = Date.now()

  return { ok: true, completedTransfer: completed }
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

// ====== Helpers per UI ======

/** Offerte pending verso il mio club (per inbox) */
export function pendingOffersForMyClub(career: Career): TransferOffer[] {
  const { offers } = ensureTransferState(career)
  const myId = career.club.teamId
  return offers.filter(o => o.status === 'pending' && o.toTeamId === myId)
}
