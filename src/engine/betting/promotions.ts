/**
 * Generatore di promozioni seedato (1 quote boost/giorno + 1 free bet/settimana).
 * Deterministico sul savegame → coerente per multiplayer V2.
 *
 * Vedi BETTING_SPEC.md sez. 7.4 e 7.5.
 */

import type { Career } from '$engine/career/types'
import type { Team } from '$engine/types'
import type { Promotion, MatchOddsBoard, Market } from './types'
import { rngFromString, pickWeighted, jitter } from './seed'

const QUOTE_BOOST_MULTIPLIER_RANGE: [number, number] = [1.15, 1.50]
const FREE_BET_BALANCE_PCT = 0.001     // 0.1% del balance
const FREE_BET_MIN = 5
const FREE_BET_MAX = 10000
const ACCUMULATOR_MIN_SELECTIONS = 4
const ACCUMULATOR_BONUS_PERCENT = 0.05   // +5% accumulator V1

/**
 * Top mercati eleggibili al quote boost (escludendo correct_score e marcatori
 * dove un boost sarebbe troppo pesante in valore atteso).
 */
const BOOSTABLE_KINDS = new Set([
  '1X2', 'over_under', 'btts', 'double_chance',
  'asian_handicap', 'european_handicap',
  '1X2_and_btts', '1X2_and_over_under', 'btts_and_over_under',
])

export interface GeneratePromotionsInput {
  career: Career
  /** Giorno di riferimento (ISO date, no time). Se omesso usa oggi. */
  day?: string
  /** Boards disponibili per quel giorno (usati per scegliere il boost). */
  boards?: MatchOddsBoard[]
}

/**
 * Genera le promozioni del giorno. Idempotente: chiamato due volte stesso day → stesse promo.
 * L'orchestratore può chiamarla all'apertura della sezione scommesse.
 */
export function generateDailyPromotions(inp: GeneratePromotionsInput): Promotion[] {
  const { career } = inp
  const day = inp.day ?? new Date().toISOString().slice(0, 10)
  const seedString = `${career.seed}-${career.id}-${day}`
  const rng = rngFromString(seedString)
  const promotions: Promotion[] = []

  // ===== 1. Quote boost giornaliero =====
  const boards = inp.boards ?? []
  if (boards.length > 0) {
    const candidates = collectBoostCandidates(boards, career)
    if (candidates.length > 0) {
      // Pesa per "interesse" (quote 2.00-4.00 sono ideali per boost)
      const weighted = candidates.map(c => ({
        value: c,
        weight: oddsAttractiveness(c.odds),
      }))
      const choice = pickWeighted(rng, weighted)
      const multiplier = jitter(rng, (QUOTE_BOOST_MULTIPLIER_RANGE[0] + QUOTE_BOOST_MULTIPLIER_RANGE[1]) / 2, 0.20)
      const clamped = Math.max(QUOTE_BOOST_MULTIPLIER_RANGE[0], Math.min(QUOTE_BOOST_MULTIPLIER_RANGE[1], multiplier))
      const validUntil = endOfDayISO(day)
      promotions.push({
        id: `boost-${day}-${choice.fixtureId}`,
        type: 'odds_boost',
        fixtureId: choice.fixtureId,
        marketKind: choice.marketKind,
        selectionId: choice.selectionId,
        multiplier: Math.round(clamped * 100) / 100,
        validUntil,
      })
    }
  }

  // ===== 2. Free bet settimanale (lunedì) =====
  const dayOfWeek = new Date(day).getDay()   // 1 = lunedì
  if (dayOfWeek === 1) {
    const team = career.manager.teamId ? career.teams[career.manager.teamId] : undefined
    if (team) {
      const amount = freeBetAmountForTeam(team)
      const validUntil = addDaysISO(day, 7)
      promotions.push({
        id: `freebet-${day}`,
        type: 'free_bet',
        freeBetAmount: amount,
        validUntil,
      })
    }
  }

  // ===== 3. Accumulator bonus permanente =====
  // V1: sempre attivo, generato all'inizio della stagione e rinnovato ogni 30 giorni
  // (non lo emettiamo qui per evitare duplicazioni; vedi `ensureAccumulatorPromotion`)

  return promotions
}

/** Promo accumulator: sempre attiva, generata una volta. */
export function ensureAccumulatorPromotion(career: Career): Promotion {
  return {
    id: 'accumulator-permanent',
    type: 'accumulator_bonus',
    minSelections: ACCUMULATOR_MIN_SELECTIONS,
    bonusPercent: ACCUMULATOR_BONUS_PERCENT,
    validUntil: addDaysISO(new Date().toISOString().slice(0, 10), 365),
  }
}

// ============================================================
// HELPERS
// ============================================================

interface BoostCandidate {
  fixtureId: string
  marketKind: import('./types').MarketKind
  selectionId: string
  odds: number
}

function collectBoostCandidates(boards: MatchOddsBoard[], career: Career): BoostCandidate[] {
  const out: BoostCandidate[] = []
  const ownTeamId = career.manager.teamId
  for (const board of boards) {
    // Niente boost su match propria squadra
    if (board.homeId === ownTeamId || board.awayId === ownTeamId) continue
    for (const m of board.markets) {
      if (!BOOSTABLE_KINDS.has(m.kind)) continue
      if (m.status !== 'open') continue
      for (const s of m.selections) {
        if (s.odds < 1.50 || s.odds > 5.00) continue   // sweet spot per boost
        out.push({ fixtureId: board.fixtureId, marketKind: m.kind, selectionId: s.id, odds: s.odds })
      }
    }
  }
  return out
}

/** Score "appetibilità" di una quota per il boost giornaliero. */
function oddsAttractiveness(odds: number): number {
  // Curva a campana centrata su 2.5
  const d = odds - 2.5
  return Math.max(0.05, Math.exp(-(d * d) / 2))
}

function freeBetAmountForTeam(team: Team): number {
  const raw = team.balance * FREE_BET_BALANCE_PCT
  const clamped = Math.max(FREE_BET_MIN, Math.min(FREE_BET_MAX, raw))
  // Arrotonda a 5/10/25/50/100/250/500/1000 più vicino
  const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  let best = buckets[0]
  let minDelta = Math.abs(clamped - best)
  for (const b of buckets) {
    const d = Math.abs(clamped - b)
    if (d < minDelta) { best = b; minDelta = d }
  }
  return best
}

function endOfDayISO(day: string): string {
  return `${day}T23:59:59.999Z`
}

function addDaysISO(day: string, days: number): string {
  const d = new Date(day)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

// ============================================================
// PRUNING
// ============================================================

export function clearExpiredPromotions(promotions: Promotion[]): Promotion[] {
  const now = Date.now()
  return promotions.filter(p => {
    if (p.type === 'accumulator_bonus') return true
    return new Date(p.validUntil).getTime() > now
  })
}
