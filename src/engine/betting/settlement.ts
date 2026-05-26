/**
 * Settlement engine: risolve le bollette aperte di una fixture al full_time.
 * Vedi BETTING_SPEC.md sez. 8.
 */

import type { MatchResult, Scorer } from '$engine/competition/types'
import type { MatchEvent } from '$engine/match/types'
import type { Team } from '$engine/types'
import type {
  PlacedBet,
  PlacedSelection,
  SelectionStatus,
  BettingWallet,
  BettingStats,
  Outcome1X2,
} from './types'
import { credit, recordLoss, recordWin } from './bankroll'
import { generateCombinations } from './betSlip'

// ============================================================
// HELPERS
// ============================================================

function outcomeFromScore(home: number, away: number): Outcome1X2 {
  if (home > away) return '1'
  if (home < away) return '2'
  return 'X'
}

function calcScoreAtMinute(events: MatchEvent[], minute: number): { home: number; away: number } {
  let h = 0, a = 0
  for (const e of events) {
    if (e.minute > minute) break
    if (e.kind === 'goal') {
      if (e.side === 'home') h++
      else if (e.side === 'away') a++
    } else if (e.kind === 'own_goal') {
      // own goal contro la propria squadra (segna l'altra)
      if (e.side === 'home') a++
      else if (e.side === 'away') h++
    }
  }
  return { home: h, away: a }
}

function realScorers(scorers: Scorer[], excludeOwnGoals: boolean = true): Scorer[] {
  return scorers.filter(s => !excludeOwnGoals || s.note !== 'autogol')
}

function countGoalsByPlayer(scorers: Scorer[], playerId: string): number {
  return scorers.filter(s => s.playerId === playerId && s.note !== 'autogol').length
}

// ============================================================
// RESOLVER SINGOLA SELEZIONE
// ============================================================

export function resolveSelection(sel: PlacedSelection, result: MatchResult): SelectionStatus {
  const { homeScore, awayScore, events, scorers } = result

  switch (sel.marketKind) {
    case '1X2': {
      const out = outcomeFromScore(homeScore, awayScore)
      return sel.selectionMeta?.outcome === out ? 'won' : 'lost'
    }

    case 'double_chance': {
      const out = outcomeFromScore(homeScore, awayScore)
      return sel.selectionId.includes(out) ? 'won' : 'lost'
    }

    case 'draw_no_bet': {
      const out = outcomeFromScore(homeScore, awayScore)
      if (out === 'X') return 'void'
      return sel.selectionMeta?.outcome === out ? 'won' : 'lost'
    }

    case 'over_under': {
      const line = sel.selectionMeta!.line!
      const total = homeScore + awayScore
      const isOver = sel.selectionId.startsWith('over')
      return (isOver ? total > line : total < line) ? 'won' : 'lost'
    }

    case 'team_over_under': {
      const line = sel.selectionMeta!.line!
      const side = sel.selectionMeta!.side!
      const teamGoals = side === 'home' ? homeScore : awayScore
      const isOver = sel.selectionId.includes('over')
      return (isOver ? teamGoals > line : teamGoals < line) ? 'won' : 'lost'
    }

    case 'btts': {
      const btts = homeScore > 0 && awayScore > 0
      const wantsYes = sel.selectionId === 'yes'
      return (wantsYes ? btts : !btts) ? 'won' : 'lost'
    }

    case 'total_goals_bands': {
      const total = homeScore + awayScore
      const id = sel.selectionId
      if (id === '0-1') return total <= 1 ? 'won' : 'lost'
      if (id === '2-3') return total >= 2 && total <= 3 ? 'won' : 'lost'
      if (id === '4-6') return total >= 4 && total <= 6 ? 'won' : 'lost'
      if (id === '7+') return total >= 7 ? 'won' : 'lost'
      return 'lost'
    }

    case 'european_handicap': {
      const line = sel.selectionMeta!.line!
      const adjHome = homeScore + line
      const out = outcomeFromScore(adjHome, awayScore)
      return sel.selectionMeta?.outcome === out ? 'won' : 'lost'
    }

    case 'asian_handicap': {
      const line = sel.selectionMeta!.line!
      const side = sel.selectionMeta!.side!
      return resolveAsianHandicap(homeScore, awayScore, side, line)
    }

    case 'correct_score':
    case 'halftime_correct_score': {
      const target = sel.selectionId === 'other_home' || sel.selectionId === 'other_away' || sel.selectionId === 'other_draw'
        ? sel.selectionMeta?.outcome
        : null
      const score = sel.marketKind === 'correct_score'
        ? { home: homeScore, away: awayScore }
        : calcScoreAtMinute(events, 45)
      if (target) {
        // selezione "altro" cattura tutti i risultati con quel outcome E almeno una delle squadre ha segnato >= 5
        const out = outcomeFromScore(score.home, score.away)
        const isHighScore = score.home >= 5 || score.away >= 5
        return out === target && isHighScore ? 'won' : 'lost'
      }
      const expected = sel.selectionMeta?.score
      if (!expected) return 'lost'
      return expected.home === score.home && expected.away === score.away ? 'won' : 'lost'
    }

    case 'halftime_1X2': {
      const ht = calcScoreAtMinute(events, 45)
      const out = outcomeFromScore(ht.home, ht.away)
      return sel.selectionMeta?.outcome === out ? 'won' : 'lost'
    }

    case 'halftime_over_under': {
      const ht = calcScoreAtMinute(events, 45)
      const total = ht.home + ht.away
      const line = sel.selectionMeta!.line!
      const isOver = sel.selectionId.startsWith('over')
      return (isOver ? total > line : total < line) ? 'won' : 'lost'
    }

    case 'halftime_btts': {
      const ht = calcScoreAtMinute(events, 45)
      const btts = ht.home > 0 && ht.away > 0
      const wantsYes = sel.selectionId === 'yes'
      return (wantsYes ? btts : !btts) ? 'won' : 'lost'
    }

    case 'halftime_fulltime': {
      const ht = calcScoreAtMinute(events, 45)
      const htOut = outcomeFromScore(ht.home, ht.away)
      const ftOut = outcomeFromScore(homeScore, awayScore)
      return sel.selectionMeta?.htOutcome === htOut && sel.selectionMeta?.ftOutcome === ftOut ? 'won' : 'lost'
    }

    case 'half_with_most_goals': {
      const ht = calcScoreAtMinute(events, 45)
      const h1 = ht.home + ht.away
      const h2 = (homeScore + awayScore) - h1
      const id = sel.selectionId
      if (id === 'h1') return h1 > h2 ? 'won' : 'lost'
      if (id === 'h2') return h2 > h1 ? 'won' : 'lost'
      if (id === 'equal') return h1 === h2 ? 'won' : 'lost'
      return 'lost'
    }

    case 'anytime_scorer': {
      const pid = sel.selectionMeta?.playerId
      if (!pid) return 'lost'
      return realScorers(scorers).some(s => s.playerId === pid) ? 'won' : 'lost'
    }

    case 'first_scorer': {
      if (sel.selectionId === 'first_none') {
        return realScorers(scorers).length === 0 ? 'won' : 'lost'
      }
      const pid = sel.selectionMeta?.playerId
      if (!pid) return 'lost'
      const first = realScorers(scorers)[0]
      return first?.playerId === pid ? 'won' : 'lost'
    }

    case 'last_scorer': {
      if (sel.selectionId === 'last_none') {
        return realScorers(scorers).length === 0 ? 'won' : 'lost'
      }
      const pid = sel.selectionMeta?.playerId
      if (!pid) return 'lost'
      const arr = realScorers(scorers)
      const last = arr[arr.length - 1]
      return last?.playerId === pid ? 'won' : 'lost'
    }

    case 'scorer_2plus': {
      const pid = sel.selectionMeta?.playerId
      if (!pid) return 'lost'
      return countGoalsByPlayer(scorers, pid) >= 2 ? 'won' : 'lost'
    }

    case 'scorer_hattrick': {
      const pid = sel.selectionMeta?.playerId
      if (!pid) return 'lost'
      return countGoalsByPlayer(scorers, pid) >= 3 ? 'won' : 'lost'
    }

    case '1X2_and_btts': {
      const out = outcomeFromScore(homeScore, awayScore)
      const btts = homeScore > 0 && awayScore > 0
      const [outId, bttsId] = sel.selectionId.split('_')
      return outId === out && (bttsId === 'yes' ? btts : !btts) ? 'won' : 'lost'
    }

    case '1X2_and_over_under': {
      const line = sel.selectionMeta!.line!
      const out = outcomeFromScore(homeScore, awayScore)
      const isOver = (homeScore + awayScore) > line
      const parts = sel.selectionId.split('_')
      const outId = parts[0]
      const ouId = parts[1]
      return outId === out && (ouId === 'over' ? isOver : !isOver) ? 'won' : 'lost'
    }

    case 'btts_and_over_under': {
      const line = sel.selectionMeta!.line!
      const btts = homeScore > 0 && awayScore > 0
      const isOver = (homeScore + awayScore) > line
      const parts = sel.selectionId.split('_')
      const bttsId = parts[0]
      const ouId = parts[1]
      const wantBtts = bttsId === 'yes'
      const wantOver = ouId === 'over'
      return (btts === wantBtts) && (isOver === wantOver) ? 'won' : 'lost'
    }

    case 'total_cards_over_under': {
      // yellow = 1, red diretto = 1, doppia gialla = già 1 (la 2a non si conta)
      const yellows = events.filter(e => e.kind === 'yellow_card').length
      const directReds = events.filter(e => e.kind === 'red_card' && e.note === 'direct').length
      const cards = yellows + directReds
      const line = sel.selectionMeta!.line!
      const isOver = sel.selectionId.startsWith('over')
      return (isOver ? cards > line : cards < line) ? 'won' : 'lost'
    }

    case 'total_corners_over_under': {
      const corners = events.filter(e => e.kind === 'corner').length
      const line = sel.selectionMeta!.line!
      const isOver = sel.selectionId.startsWith('over')
      return (isOver ? corners > line : corners < line) ? 'won' : 'lost'
    }

    case 'first_goal_team': {
      const firstGoal = events.find(e => e.kind === 'goal' || e.kind === 'own_goal')
      if (!firstGoal) return sel.selectionId === 'none' ? 'won' : 'lost'
      // own_goal: il "team che segna" è l'opposto del side
      const scoringSide = firstGoal.kind === 'own_goal'
        ? (firstGoal.side === 'home' ? 'away' : 'home')
        : firstGoal.side
      if (sel.selectionId === 'home') return scoringSide === 'home' ? 'won' : 'lost'
      if (sel.selectionId === 'away') return scoringSide === 'away' ? 'won' : 'lost'
      if (sel.selectionId === 'none') return 'lost'
      return 'lost'
    }

    case 'red_card_match': {
      const hasRed = events.some(e => e.kind === 'red_card')
      return (sel.selectionId === 'yes' ? hasRed : !hasRed) ? 'won' : 'lost'
    }

    case 'penalty_awarded': {
      const hasPen = events.some(e => e.kind === 'penalty')
      return (sel.selectionId === 'yes' ? hasPen : !hasPen) ? 'won' : 'lost'
    }

    case 'no_goalscorer': {
      return realScorers(scorers).length === 0 ? 'won' : 'lost'
    }

    case 'first_card_team': {
      const firstCard = events.find(e => e.kind === 'yellow_card' || e.kind === 'red_card')
      if (!firstCard) return sel.selectionId === 'none' ? 'won' : 'lost'
      if (sel.selectionId === 'home') return firstCard.side === 'home' ? 'won' : 'lost'
      if (sel.selectionId === 'away') return firstCard.side === 'away' ? 'won' : 'lost'
      return 'lost'
    }

    default:
      console.warn(`[settlement] resolver mancante per ${sel.marketKind}`)
      return 'void'
  }
}

function resolveAsianHandicap(homeScore: number, awayScore: number, side: 'home' | 'away', line: number): SelectionStatus {
  // Linee con .25 / .75 → split su due semi-linee
  const quarter = Math.abs(line * 4) % 2 !== 0
  if (quarter) {
    const half = line >= 0 ? Math.floor(line * 2) / 2 : Math.ceil(line * 2) / 2
    const other = line >= 0 ? half + 0.5 : half - 0.5
    const r1 = resolveAsianHandicap(homeScore, awayScore, side, half)
    const r2 = resolveAsianHandicap(homeScore, awayScore, side, other)
    if (r1 === 'won' && r2 === 'won') return 'won'
    if (r1 === 'lost' && r2 === 'lost') return 'lost'
    if (r1 === 'won' && r2 === 'void') return 'half_won'
    if (r1 === 'void' && r2 === 'won') return 'half_won'
    if (r1 === 'lost' && r2 === 'void') return 'half_lost'
    if (r1 === 'void' && r2 === 'lost') return 'half_lost'
    return 'void'
  }

  const adjHome = side === 'home' ? homeScore + line : homeScore - line
  const diff = adjHome - awayScore   // positivo = home wins handicap (per side=home)
  // Per side='away' la logica è già coperta dall'aggiustamento di adjHome (line viene applicato all'away virtualmente)
  // ATTENZIONE: convenzione qui è line positiva = vantaggio per la side scelta
  if (side === 'away') {
    // Riapplichiamo: away ottiene +|line|, valutiamo away vs home
    const adjAway = awayScore + line
    const d = adjAway - homeScore
    if (d > 0) return 'won'
    if (d === 0) return 'void'
    return 'lost'
  }

  if (diff > 0) return 'won'
  if (diff === 0) return 'void'
  return 'lost'
}

// ============================================================
// SETTLEMENT BOLLETTA
// ============================================================

export interface SettlementInput {
  bet: PlacedBet
  resultsByFixture: Record<string, MatchResult>
}

export function settleBet(input: SettlementInput): PlacedBet {
  const { bet, resultsByFixture } = input

  // Risolvi ogni selezione
  const resolved: PlacedSelection[] = bet.selections.map(sel => {
    const result = resultsByFixture[sel.fixtureId]
    if (!result) return sel   // partita non ancora giocata → resta pending
    return { ...sel, status: resolveSelection(sel, result) }
  })

  // Se alcune selezioni sono ancora pending, la bolletta resta open
  if (resolved.some(s => s.status === 'pending')) {
    return { ...bet, selections: resolved }
  }

  if (bet.mode === 'single' || bet.mode === 'multiple') {
    // Bolletta lost se almeno una selezione persa
    const hasLost = resolved.some(s => s.status === 'lost')
    if (hasLost) {
      return {
        ...bet,
        selections: resolved,
        status: 'lost',
        actualPayout: 0,
        settledAt: Date.now(),
      }
    }

    let multiplier = 1
    let allVoid = true
    for (const s of resolved) {
      if (s.status === 'won') { multiplier *= s.oddsAtPlacement; allVoid = false }
      else if (s.status === 'void') multiplier *= 1
      else if (s.status === 'half_won') { multiplier *= (s.oddsAtPlacement + 1) / 2; allVoid = false }
      else if (s.status === 'half_lost') { multiplier *= 0.5; allVoid = false }
    }

    const payout = bet.stake * multiplier
    let status: PlacedBet['status']
    if (allVoid) status = 'void'
    else if (multiplier === 1) status = 'void'
    else if (multiplier > 1) status = 'won'
    else status = 'half_won'   // multiplier in (0..1)

    return {
      ...bet,
      selections: resolved,
      status,
      actualPayout: payout,
      settledAt: Date.now(),
    }
  }

  if (bet.mode === 'system') {
    // Per ogni combinazione di systemSize selezioni
    const k = bet.systemSize!
    const stakePerCombo = bet.stake / Math.max(1, nCkLocal(resolved.length, k))
    const combos = generateCombinations(resolved, k)
    let totalPayout = 0
    for (const c of combos) {
      // Combinazione vinta se tutti won o void; void contribuisce con quota 1
      let mult = 1
      let lost = false
      for (const s of c) {
        if (s.status === 'lost') { lost = true; break }
        if (s.status === 'won') mult *= s.oddsAtPlacement
        else if (s.status === 'void') mult *= 1
        else if (s.status === 'half_won') mult *= (s.oddsAtPlacement + 1) / 2
        else if (s.status === 'half_lost') mult *= 0.5
      }
      if (!lost) totalPayout += stakePerCombo * mult
    }
    return {
      ...bet,
      selections: resolved,
      status: totalPayout > 0 ? 'won' : 'lost',
      actualPayout: totalPayout,
      settledAt: Date.now(),
    }
  }

  throw new Error(`Mode non supportata in settlement: ${bet.mode}`)
}

function nCkLocal(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let r = 1
  k = Math.min(k, n - k)
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

// ============================================================
// SETTLEMENT BATCH PER FIXTURE
// ============================================================

export interface SettleFixtureContext {
  team: Team
  wallet: BettingWallet
  stats: BettingStats
  openBets: PlacedBet[]
  settledBets: PlacedBet[]
  resultsByFixture: Record<string, MatchResult>
  maxSettledHistory: number
}

export function settleFixture(ctx: SettleFixtureContext): { settled: PlacedBet[]; stillOpen: PlacedBet[] } {
  const settled: PlacedBet[] = []
  const stillOpen: PlacedBet[] = []

  for (const bet of ctx.openBets) {
    const updated = settleBet({ bet, resultsByFixture: ctx.resultsByFixture })
    if (updated.status === 'open' || updated.selections.some(s => s.status === 'pending')) {
      stillOpen.push(updated)
      continue
    }

    // Bolletta risolta: applica payout
    if (updated.actualPayout && updated.actualPayout > 0) {
      credit(ctx.team, ctx.wallet, updated.actualPayout)
    }
    if (updated.status === 'won') recordWin(ctx.wallet)
    else if (updated.status === 'lost') recordLoss(ctx.wallet)

    updateStats(ctx.stats, updated)
    settled.push(updated)
  }

  // Aggiorna liste
  const newSettled = [...settled, ...ctx.settledBets].slice(0, ctx.maxSettledHistory)
  return { settled: newSettled, stillOpen }
}

// ============================================================
// STATS UPDATE
// ============================================================

export function updateStats(stats: BettingStats, bet: PlacedBet): void {
  stats.totalBets++
  stats.totalStaked += bet.stake
  const payout = bet.actualPayout ?? 0
  stats.totalReturned += payout
  stats.netProfit = stats.totalReturned - stats.totalStaked
  stats.roi = stats.totalStaked > 0 ? (stats.totalReturned - stats.totalStaked) / stats.totalStaked : 0
  stats.yield = stats.totalStaked > 0 ? stats.netProfit / stats.totalStaked : 0

  if (bet.status === 'won') {
    stats.wonBets++
    if (stats.currentStreak.kind === 'W') stats.currentStreak.count++
    else stats.currentStreak = { kind: 'W', count: 1 }
    stats.longestWinStreak = Math.max(stats.longestWinStreak, stats.currentStreak.count)
    stats.biggestWin = Math.max(stats.biggestWin, payout - bet.stake)
  } else if (bet.status === 'lost') {
    stats.lostBets++
    if (stats.currentStreak.kind === 'L') stats.currentStreak.count++
    else stats.currentStreak = { kind: 'L', count: 1 }
    stats.longestLossStreak = Math.max(stats.longestLossStreak, stats.currentStreak.count)
  } else if (bet.status === 'void') {
    stats.voidBets++
  }
}
