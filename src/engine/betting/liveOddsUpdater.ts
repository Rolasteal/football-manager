/**
 * Live odds updater: ricalcola quote durante il replay del match.
 * Vedi BETTING_SPEC.md sez. 6.
 */

import type { MatchEvent, MatchEventKind } from '$engine/match/types'
import type {
  Market,
  MatchOddsBoard,
  LiveContext,
  MarketKind,
} from './types'
import {
  dixonColesMatrix,
  p1X2,
  pOver,
  pBtts,
  pCorrectScore,
} from './oddsEngine'
import { priceMarket } from './overround'

// ============================================================
// COSTANTI
// ============================================================

const MATCH_TOTAL_MINUTES = 95
const SUSPENSION_MS: Record<string, number> = {
  goal: 8000,
  own_goal: 8000,
  red_card: 12000,
  penalty: 15000,
  half_time: 999999,
  full_time: 999999,
}

const TIME_DECAY_MARKETS: MarketKind[] = [
  '1X2', 'double_chance', 'over_under', 'btts',
  'correct_score', 'asian_handicap', 'european_handicap',
  'team_over_under', 'total_goals_bands', 'first_goal_team',
]

const HT_KILL_MARKETS: MarketKind[] = [
  'halftime_1X2', 'halftime_over_under', 'halftime_btts',
  'halftime_correct_score', 'halftime_fulltime',
]

// ============================================================
// MERCATI IMPATTATI DA EVENTO
// ============================================================

export function marketsAffectedBy(kind: MatchEventKind): MarketKind[] {
  switch (kind) {
    case 'goal':
    case 'own_goal':
      return [...TIME_DECAY_MARKETS, 'first_scorer', 'last_scorer', 'anytime_scorer', 'scorer_2plus', 'scorer_hattrick', 'half_with_most_goals']
    case 'red_card':
      return TIME_DECAY_MARKETS
    case 'penalty':
      return ['1X2', 'over_under', 'correct_score', 'penalty_awarded', 'btts']
    case 'half_time':
      return HT_KILL_MARKETS
    case 'full_time':
      return [...TIME_DECAY_MARKETS, ...HT_KILL_MARKETS]
    case 'yellow_card':
      return ['total_cards_over_under', 'first_card_team']
    case 'corner':
      return ['total_corners_over_under']
    default:
      return []
  }
}

export function suspensionMs(kind: MatchEventKind): number {
  return SUSPENSION_MS[kind] ?? 0
}

// ============================================================
// LAMBDA RESIDUO
// ============================================================

export function residualLambdas(
  ctx: LiveContext,
  initialLambdaHome: number,
  initialLambdaAway: number,
): { lambdaHome: number; lambdaAway: number } {
  const minutesLeft = Math.max(1, MATCH_TOTAL_MINUTES - ctx.minute)
  const f = minutesLeft / MATCH_TOTAL_MINUTES

  let lh = initialLambdaHome * f
  let la = initialLambdaAway * f

  // Adjustment red card
  if (ctx.redCardsHome > ctx.redCardsAway) {
    const diff = ctx.redCardsHome - ctx.redCardsAway
    lh *= Math.pow(0.65, diff)
    la *= Math.pow(1.18, diff)
  } else if (ctx.redCardsAway > ctx.redCardsHome) {
    const diff = ctx.redCardsAway - ctx.redCardsHome
    la *= Math.pow(0.65, diff)
    lh *= Math.pow(1.18, diff)
  }

  // Adjustment lead (la squadra in vantaggio gestisce, l'altra spinge)
  const lead = ctx.homeScore - ctx.awayScore
  if (lead > 0) {
    lh *= Math.pow(0.92, Math.min(3, lead))
    la *= Math.pow(1.05, Math.min(3, lead))
  } else if (lead < 0) {
    la *= Math.pow(0.92, Math.min(3, -lead))
    lh *= Math.pow(1.05, Math.min(3, -lead))
  }

  return { lambdaHome: Math.max(0.01, lh), lambdaAway: Math.max(0.01, la) }
}

// ============================================================
// RICALCOLO MERCATI
// ============================================================

export interface RecomputeInput {
  board: MatchOddsBoard
  ctx: LiveContext
  topMatchFactor: number
}

export function recomputeMarkets(input: RecomputeInput): Market[] {
  const { board, ctx, topMatchFactor } = input
  const { lambdaHome, lambdaAway } = residualLambdas(ctx, ctx.initialLambdaHome, ctx.initialLambdaAway)
  const M = dixonColesMatrix(lambdaHome, lambdaAway)
  const currentHome = ctx.homeScore
  const currentAway = ctx.awayScore

  return board.markets.map(m => {
    if (m.status === 'settled' || m.status === 'closed') return m
    if (!TIME_DECAY_MARKETS.includes(m.kind) && !HT_KILL_MARKETS.includes(m.kind) && !['anytime_scorer', 'first_scorer', 'last_scorer'].includes(m.kind)) {
      return m   // mercati non impattati dal tempo (cards, corners) restano (idealmente ricalcolati altrove)
    }

    return recomputeMarket(m, M, currentHome, currentAway, ctx, topMatchFactor)
  })
}

function recomputeMarket(
  market: Market,
  M: number[][],
  curH: number,
  curA: number,
  ctx: LiveContext,
  tmf: number,
): Market {
  const oldOdds = new Map(market.selections.map(s => [s.id, s.odds]))
  let newSelections = market.selections.map(s => ({ ...s }))

  switch (market.kind) {
    case '1X2': {
      // P_home_live = Σ M[i][j] for (curH+i) > (curA+j)
      let pH = 0, pD = 0, pA = 0
      for (let i = 0; i < M.length; i++) {
        for (let j = 0; j < M[i].length; j++) {
          const fh = curH + i
          const fa = curA + j
          if (fh > fa) pH += M[i][j]
          else if (fh === fa) pD += M[i][j]
          else pA += M[i][j]
        }
      }
      newSelections[0].probability = pH
      newSelections[1].probability = pD
      newSelections[2].probability = pA
      break
    }

    case 'double_chance': {
      let pH = 0, pD = 0, pA = 0
      for (let i = 0; i < M.length; i++) {
        for (let j = 0; j < M[i].length; j++) {
          const fh = curH + i, fa = curA + j
          if (fh > fa) pH += M[i][j]
          else if (fh === fa) pD += M[i][j]
          else pA += M[i][j]
        }
      }
      newSelections = market.selections.map(s => {
        let p = 0
        if (s.id === '1X') p = pH + pD
        else if (s.id === '12') p = pH + pA
        else if (s.id === 'X2') p = pD + pA
        return { ...s, probability: p }
      })
      break
    }

    case 'over_under': {
      const line = market.selections[0].meta?.line ?? 2.5
      const currentTotal = curH + curA
      if (currentTotal > line) {
        // Over già vinto: prob 1
        newSelections[0].probability = 0.999
        newSelections[1].probability = 0.001
      } else {
        // residuo: serve > (line - currentTotal) gol
        const need = line - currentTotal
        const pOverResidual = pOver(M, Math.floor(need * 2) / 2)   // round to half
        newSelections[0].probability = pOverResidual
        newSelections[1].probability = 1 - pOverResidual
      }
      break
    }

    case 'btts': {
      if (curH > 0 && curA > 0) {
        newSelections[0].probability = 0.999
        newSelections[1].probability = 0.001
      } else if (curH === 0 && curA === 0) {
        const yes = pBtts(M)
        newSelections[0].probability = yes
        newSelections[1].probability = 1 - yes
      } else {
        // una sola ha segnato: serve almeno 1 gol dell'altra
        const needSide = curH === 0 ? 'home' : 'away'
        let p1plus = 0
        for (let i = 0; i < M.length; i++) {
          for (let j = 0; j < M[i].length; j++) {
            if (needSide === 'home' && i >= 1) p1plus += M[i][j]
            if (needSide === 'away' && j >= 1) p1plus += M[i][j]
          }
        }
        newSelections[0].probability = p1plus
        newSelections[1].probability = 1 - p1plus
      }
      break
    }

    case 'correct_score': {
      newSelections = market.selections.map(s => {
        const target = s.meta?.score
        if (!target) {
          // selezione "altro" — semplifichiamo a basso peso
          return { ...s, probability: 0.05 }
        }
        const deltaH = target.home - curH
        const deltaA = target.away - curA
        if (deltaH < 0 || deltaA < 0) return { ...s, probability: 0 }
        return { ...s, probability: pCorrectScore(M, deltaH, deltaA) }
      })
      break
    }

    // Per gli altri mercati gol-based (asian/european handicap, team_over_under, first_goal_team)
    // applichiamo la stessa logica residuale; per brevità in V1 trattiamo solo i principali.
    default:
      return market
  }

  // Re-applica margine
  const trueProbs = newSelections.map(s => s.probability)
  const newOdds = priceMarket(trueProbs, market.kind, tmf)
  newSelections = newSelections.map((s, i) => ({ ...s, odds: newOdds[i] }))

  // Calcola delta per animazioni UI
  const lastDelta: Record<string, number> = {}
  for (const s of newSelections) {
    const old = oldOdds.get(s.id)
    if (old !== undefined) lastDelta[s.id] = s.odds - old
  }

  const newMargin = newSelections.reduce((acc, s) => acc + 1 / s.odds, 0) - 1

  return {
    ...market,
    selections: newSelections,
    isLive: true,
    margin: Math.max(0, newMargin),
    updatedAt: Date.now(),
    lastDelta,
  }
}

// ============================================================
// SOSPENSIONE MERCATI
// ============================================================

export function suspendMarkets(board: MatchOddsBoard, marketKinds: MarketKind[]): MatchOddsBoard {
  const markets = board.markets.map(m =>
    marketKinds.includes(m.kind) && m.status === 'open'
      ? { ...m, status: 'suspended' as const, updatedAt: Date.now() }
      : m
  )
  return { ...board, markets }
}

export function resumeMarkets(board: MatchOddsBoard, marketKinds: MarketKind[]): MatchOddsBoard {
  const markets = board.markets.map(m =>
    marketKinds.includes(m.kind) && m.status === 'suspended'
      ? { ...m, status: 'open' as const, updatedAt: Date.now() }
      : m
  )
  return { ...board, markets }
}

export function closeMarkets(board: MatchOddsBoard, marketKinds: MarketKind[]): MatchOddsBoard {
  const markets = board.markets.map(m =>
    marketKinds.includes(m.kind) && (m.status === 'open' || m.status === 'suspended')
      ? { ...m, status: 'closed' as const, updatedAt: Date.now() }
      : m
  )
  return { ...board, markets }
}

// ============================================================
// REDUCER: applica un evento del replay al board
// ============================================================

export interface ApplyEventInput {
  board: MatchOddsBoard
  event: MatchEvent
  ctx: LiveContext
  topMatchFactor: number
}

export function applyEvent(input: ApplyEventInput): MatchOddsBoard {
  const { board, event, ctx, topMatchFactor } = input
  let b: MatchOddsBoard = {
    ...board,
    liveMinute: event.minute,
    liveScore: { home: ctx.homeScore, away: ctx.awayScore },
  }

  if (event.kind === 'kickoff') {
    b = { ...b, state: 'live' }
    return b
  }
  if (event.kind === 'half_time') {
    b = { ...b, state: 'ht' }
    b = closeMarkets(b, HT_KILL_MARKETS)
    return b
  }
  if (event.kind === 'full_time') {
    b = { ...b, state: 'settled' }
    b = closeMarkets(b, board.markets.map(m => m.kind))
    return b
  }

  // Su goal/red/penalty: sospendi + ricalcola
  const affected = marketsAffectedBy(event.kind)
  if (affected.length === 0) return b
  b = suspendMarkets(b, affected)

  // In ambiente reale: dopo suspensionMs(event.kind) si fa il recompute.
  // Qui restituiamo già il board con i mercati ricalcolati ma in stato "suspended";
  // sarà l'orchestratore (store) a riportare a "open" dopo il timeout.
  const newMarkets = recomputeMarkets({ board: b, ctx, topMatchFactor })
  b = { ...b, markets: newMarkets }
  return b
}
