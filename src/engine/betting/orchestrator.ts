/**
 * Orchestratore high-level: wiring tra Career, match engine e modulo betting.
 * Espone le funzioni che la UI/altra chat chiamerà direttamente.
 *
 * Vedi BETTING_SPEC.md sez. 12.
 */

import type { Career } from '$engine/career/types'
import type { Fixture, MatchResult } from '$engine/competition/types'
import type { MatchEvent } from '$engine/match/types'
import type { Player, Team } from '$engine/types'

import type {
  MatchOddsBoard,
  BetSlipDraft,
  PlacedBet,
  LiveContext,
  BettingCareerData,
  Promotion,
} from './types'

import {
  buildMatchProbabilityModel,
  buildTeamInput,
} from './oddsEngine'
import { buildOddsBoard } from './marketsGenerator'
import { topMatchFactorFromReputation } from './overround'
import {
  debit,
  refund,
  rolloverMatchday,
  refreshCapsFromTeam,
  maxPayoutForTeam,
} from './bankroll'
import { validateSlip, priceSlip, buildPlacedBet } from './betSlip'
import { settleFixture } from './settlement'
import {
  applyEvent,
  recomputeMarkets,
  resumeMarkets,
  suspensionMs,
  marketsAffectedBy,
} from './liveOddsUpdater'
import { computeCashOut, applyCashOut } from './cashout'
import { initBettingCareerData } from './init'
import { resolveLeagueConfigByTier } from './config'
import type { LeagueBettingConfig } from './types'
import { generateDailyPromotions, ensureAccumulatorPromotion, clearExpiredPromotions } from './promotions'

const MAX_SETTLED_HISTORY = 500

// ============================================================
// INIZIALIZZAZIONE
// ============================================================

export function ensureBettingData(career: Career): BettingCareerData {
  if (!career.bettingCareerData) {
    career.bettingCareerData = initBettingCareerData({
      clubId: career.manager.teamId ?? '',
      matchday: career.season.currentMatchday,
    })
    // Inizializza i cap dinamici basati sul Team del manager
    const team = career.manager.teamId ? career.teams[career.manager.teamId] : undefined
    if (team) refreshCapsFromTeam(career.bettingCareerData.wallet, team)
  }
  return career.bettingCareerData
}

/** Risolve la LeagueBettingConfig per una fixture, leggendo dalla Career. */
export function resolveLeagueConfig(career: Career, leagueId: string): LeagueBettingConfig {
  const league = career.leagues[leagueId]
  if (!league) return resolveLeagueConfigByTier(1)
  return resolveLeagueConfigByTier(league.tier, league.name)
}

/**
 * Ritorna true se la fixture coinvolge la squadra del manager corrente.
 * La UI usa questo helper per disabilitare le selezioni (con tooltip)
 * e l'orchestratore lo usa per rifiutare le bollette.
 */
export function isOwnTeamFixture(career: Career, fixtureId: string): boolean {
  const ownTeamId = career.manager.teamId
  if (!ownTeamId) return false
  const fix = career.fixtures.find(f => f.id === fixtureId)
  if (!fix) return false
  return fix.homeId === ownTeamId || fix.awayId === ownTeamId
}

// ============================================================
// GENERAZIONE QUOTE PRE-MATCH
// ============================================================

export interface LineupResolver {
  /** Ritorna gli 11 titolari attesi per la squadra in quella fixture. */
  resolve(career: Career, teamId: string, fixture: Fixture): Player[]
}

export interface FormResolver {
  /** Ritorna l'indice di forma (-0.30..+0.30) della squadra alle ultime N partite. */
  resolve(career: Career, teamId: string, fixture: Fixture, lastN?: number): number
}

export interface GenerateOddsOptions {
  career: Career
  matchday: number
  lineupResolver: LineupResolver
  formResolver: FormResolver
  derbyDetector?: (career: Career, fixture: Fixture) => boolean
}

export function generateOddsForMatchday(opts: GenerateOddsOptions): MatchOddsBoard[] {
  const { career, matchday, lineupResolver, formResolver } = opts
  const data = ensureBettingData(career)

  const fixtures = career.fixtures.filter(f => f.matchday === matchday && f.status === 'scheduled')
  const boards: MatchOddsBoard[] = []

  for (const fix of fixtures) {
    const homeTeam = career.teams[fix.homeId]
    const awayTeam = career.teams[fix.awayId]
    if (!homeTeam || !awayTeam) continue

    const homePlayers = lineupResolver.resolve(career, fix.homeId, fix)
    const awayPlayers = lineupResolver.resolve(career, fix.awayId, fix)
    if (homePlayers.length < 7 || awayPlayers.length < 7) continue

    const homeAvg = aggregateOverall(homePlayers)
    const awayAvg = aggregateOverall(awayPlayers)
    const isDerby = opts.derbyDetector?.(career, fix) ?? false

    const homeInput = buildTeamInput({
      team: homeTeam,
      isHome: true,
      attackingOverall: homeAvg.attack,
      defensiveOverall: homeAvg.defense,
      formIndex: formResolver.resolve(career, fix.homeId, fix),
      fitnessAvg: avgFitness(homePlayers),
      moraleAvg: avgMorale(homePlayers),
      injuredKeyPlayers: 0,
      suspendedPlayers: 0,
      isDerby,
      aggressivenessFactor: aggressFactor(homePlayers),
      styleFactor: 1.0,
      refereeStrictness: 1.0,
    })
    const awayInput = buildTeamInput({
      team: awayTeam,
      isHome: false,
      attackingOverall: awayAvg.attack,
      defensiveOverall: awayAvg.defense,
      formIndex: formResolver.resolve(career, fix.awayId, fix),
      fitnessAvg: avgFitness(awayPlayers),
      moraleAvg: avgMorale(awayPlayers),
      injuredKeyPlayers: 0,
      suspendedPlayers: 0,
      isDerby,
      aggressivenessFactor: aggressFactor(awayPlayers),
      styleFactor: 1.0,
      refereeStrictness: 1.0,
    })

    const homeRoster = { attack: homeAvg.attack, defense: homeAvg.defense }
    const awayRoster = { attack: awayAvg.attack, defense: awayAvg.defense }

    const leagueConfig = resolveLeagueConfig(career, fix.leagueId)
    const tmf = topMatchFactorFromReputation(homeTeam.reputation, awayTeam.reputation, leagueConfig.refReputation)
    const model = buildMatchProbabilityModel(homeInput, awayInput, homeRoster, awayRoster, tmf, leagueConfig)

    const board = buildOddsBoard({
      fixtureId: fix.id,
      matchday: fix.matchday,
      homeId: fix.homeId,
      awayId: fix.awayId,
      kickoff: fix.date,
      homePlayers,
      awayPlayers,
      homeReputation: homeTeam.reputation,
      awayReputation: awayTeam.reputation,
      model,
      leagueConfig,
    })

    data.oddsBoards[fix.id] = board
    boards.push(board)
  }

  return boards
}

function aggregateOverall(players: Player[]): { attack: number; defense: number } {
  const attackPositions = new Set(['ST', 'CF', 'LW', 'RW', 'AM'])
  const defensePositions = new Set(['GK', 'CB', 'LB', 'RB', 'WB', 'DM'])
  let aSum = 0, aCnt = 0, dSum = 0, dCnt = 0
  for (const p of players) {
    const o = playerOverall(p)
    if (attackPositions.has(p.position)) { aSum += o; aCnt++ }
    else if (defensePositions.has(p.position)) { dSum += o; dCnt++ }
    else {
      // centrocampisti generici: half/half
      aSum += o * 0.4; aCnt += 0.4
      dSum += o * 0.4; dCnt += 0.4
    }
  }
  return {
    attack: aCnt > 0 ? aSum / aCnt : 70,
    defense: dCnt > 0 ? dSum / dCnt : 70,
  }
}

function playerOverall(p: Player): number {
  // V1: media semplice degli attributi (replica logica gen/player se serve)
  const a = p.attributes
  const tech = (a.passing + a.shooting + a.dribbling + a.finishing + a.crossing + a.tackling + a.heading) / 7
  const phys = (a.pace + a.stamina + a.strength) / 3
  const ment = (a.vision + a.composure + a.workRate) / 3
  let base = (tech * 0.5 + phys * 0.25 + ment * 0.25)
  if (p.position === 'GK') {
    base = (a.reflexes + a.handling) / 2 * 0.7 + ment * 0.3
  }
  return base * 5   // scala 1-20 → ~5-100
}

function avgFitness(players: Player[]): number {
  if (players.length === 0) return 80
  return players.reduce((s, p) => s + p.fitness, 0) / players.length
}
function avgMorale(players: Player[]): number {
  if (players.length === 0) return 70
  return players.reduce((s, p) => s + p.morale, 0) / players.length
}
function aggressFactor(players: Player[]): number {
  // proxy: tackling alto → più cartellini
  if (players.length === 0) return 0
  const avgT = players.reduce((s, p) => s + p.attributes.tackling, 0) / players.length
  return (avgT - 10) / 40   // -0.25..+0.25
}

// ============================================================
// PIAZZAMENTO BOLLETTA
// ============================================================

export interface PlaceBetInput {
  career: Career
  draft: BetSlipDraft
  promotionId?: string
}

export type PlaceBetResult =
  | { ok: true; bet: PlacedBet }
  | { ok: false; errors: string[] }

export function placeBet(input: PlaceBetInput): PlaceBetResult {
  const { career, draft } = input
  const data = ensureBettingData(career)
  const team = career.teams[data.wallet.clubId]
  if (!team) return { ok: false, errors: ['Squadra del manager non trovata'] }

  // Regola anti-conflitto di interessi: niente scommesse su fixture della propria squadra.
  // È una regola sportiva reale (UEFA/FIFA) e protegge dall'integrity issue narrative.
  const ownTeamId = career.manager.teamId
  if (ownTeamId) {
    const ownTeamSelections = draft.selections.filter(s => isOwnTeamFixture(career, s.fixtureId))
    if (ownTeamSelections.length > 0) {
      return {
        ok: false,
        errors: [`Vietato scommettere su partite della propria squadra (${team.name})`],
      }
    }
  }

  const marketsMap = collectMarkets(data)
  const validation = validateSlip(draft, marketsMap)
  if (!validation.ok) return { ok: false, errors: validation.errors }

  const promo = input.promotionId ? data.promotions.find(p => p.id === input.promotionId) : undefined
  // Cap vincita dinamico basato sul Team.balance corrente
  const dynamicPayoutCap = maxPayoutForTeam(team)
  const pricing = priceSlip(draft, marketsMap, promo, dynamicPayoutCap)

  // Debit
  const debResult = debit(team, data.wallet, pricing.totalStake)
  if (!debResult.ok) return { ok: false, errors: [debResult.reason] }

  const placed = buildPlacedBet(draft, marketsMap, career.id, career.season.currentMatchday, pricing)
  data.openBets.push(placed)
  return { ok: true, bet: placed }
}

function collectMarkets(data: BettingCareerData): Record<string, import('./types').Market> {
  const map: Record<string, import('./types').Market> = {}
  for (const board of Object.values(data.oddsBoards)) {
    for (const m of board.markets) map[m.id] = m
  }
  return map
}

// ============================================================
// LIVE EVENT HOOK (chiamato dal MatchView durante il replay)
// ============================================================

export interface OnMatchEventInput {
  career: Career
  fixtureId: string
  event: MatchEvent
  ctx: LiveContext
}

export function onMatchEvent(input: OnMatchEventInput): void {
  const { career, fixtureId, event, ctx } = input
  const data = ensureBettingData(career)
  const board = data.oddsBoards[fixtureId]
  if (!board) return

  const homeTeam = career.teams[board.homeId]
  const awayTeam = career.teams[board.awayId]
  if (!homeTeam || !awayTeam) return
  const tmf = topMatchFactorFromReputation(homeTeam.reputation, awayTeam.reputation)

  const updated = applyEvent({ board, event, ctx, topMatchFactor: tmf })
  data.oddsBoards[fixtureId] = updated

  // Schedula riapertura mercati dopo finestra di sospensione
  const sus = suspensionMs(event.kind)
  if (sus > 0 && sus < 60000) {
    const affected = marketsAffectedBy(event.kind)
    setTimeout(() => {
      const b = data.oddsBoards[fixtureId]
      if (b && b.state !== 'settled') {
        data.oddsBoards[fixtureId] = resumeMarkets(b, affected)
      }
    }, sus)
  }
}

// ============================================================
// SETTLEMENT POST-MATCH
// ============================================================

export interface SettleMatchInput {
  career: Career
  fixtureId: string
  result: MatchResult
}

export function settleMatch(input: SettleMatchInput): PlacedBet[] {
  const { career, fixtureId, result } = input
  const data = ensureBettingData(career)
  const team = career.teams[data.wallet.clubId]
  if (!team) return []

  // Filtra le bollette che toccano questa fixture
  const touched = data.openBets.filter(b => b.selections.some(s => s.fixtureId === fixtureId))
  const untouched = data.openBets.filter(b => !b.selections.some(s => s.fixtureId === fixtureId))

  const { settled, stillOpen } = settleFixture({
    team,
    wallet: data.wallet,
    stats: data.stats,
    openBets: touched,
    settledBets: data.settledBets,
    resultsByFixture: { [fixtureId]: result },
    maxSettledHistory: MAX_SETTLED_HISTORY,
  })

  data.openBets = [...untouched, ...stillOpen]
  data.settledBets = settled

  // Marca il board come settled
  const board = data.oddsBoards[fixtureId]
  if (board) {
    data.oddsBoards[fixtureId] = { ...board, state: 'settled' }
  }

  return settled.filter(s => s.settledAt && Date.now() - s.settledAt < 5000)   // appena risolte
}

// ============================================================
// CASH OUT
// ============================================================

export interface CashOutInput {
  career: Career
  betId: string
}

export type CashOutResult =
  | { ok: true; bet: PlacedBet; value: number }
  | { ok: false; reason: string }

export function executeCashOut(input: CashOutInput): CashOutResult {
  const { career, betId } = input
  const data = ensureBettingData(career)
  const team = career.teams[data.wallet.clubId]
  if (!team) return { ok: false, reason: 'Team non trovato' }
  const bet = data.openBets.find(b => b.id === betId)
  if (!bet) return { ok: false, reason: 'Bolletta non trovata' }

  const markets = collectMarkets(data)
  const quote = computeCashOut(bet, markets)
  if (!quote.available) return { ok: false, reason: quote.reason ?? 'Cash out non disponibile' }

  const updated = applyCashOut(bet, quote.value)
  // Trasferisci a settledBets
  data.openBets = data.openBets.filter(b => b.id !== betId)
  data.settledBets = [updated, ...data.settledBets].slice(0, MAX_SETTLED_HISTORY)
  // Credit
  refund(team, data.wallet, quote.value)

  return { ok: true, bet: updated, value: quote.value }
}

// ============================================================
// AVANZAMENTO GIORNATA
// ============================================================

export function onMatchdayAdvance(career: Career, newMatchday: number): void {
  const data = ensureBettingData(career)
  rolloverMatchday(data.wallet, newMatchday)
  data.wallet.matchdayState.matchday = newMatchday
  // Cleanup boards delle giornate passate (mantieni solo settled boards recenti)
  for (const [fixId, board] of Object.entries(data.oddsBoards)) {
    if (board.state === 'settled' && board.matchday < newMatchday - 2) {
      delete data.oddsBoards[fixId]
    }
  }
  // Promozioni: pulisci scadute, genera per oggi
  data.promotions = clearExpiredPromotions(data.promotions)
  refreshPromotions(career)
}

/**
 * Ricalcola le promozioni del giorno (idempotente).
 * Da chiamare all'apertura della sezione scommesse o all'avanzamento giornata.
 */
export function refreshPromotions(career: Career): void {
  const data = ensureBettingData(career)
  const today = new Date().toISOString().slice(0, 10)
  // Rimuovi promo già scadute
  data.promotions = clearExpiredPromotions(data.promotions)
  // Accumulator: assicurati che esista
  if (!data.promotions.find(p => p.id === 'accumulator-permanent')) {
    data.promotions.push(ensureAccumulatorPromotion(career))
  }
  // Daily: solo se non già generate per oggi
  const hasTodayBoost = data.promotions.some(p => p.id.startsWith(`boost-${today}`))
  const hasTodayFreebet = data.promotions.some(p => p.id === `freebet-${today}`)
  if (hasTodayBoost && hasTodayFreebet) return

  const boards = Object.values(data.oddsBoards).filter(b => b.state === 'pre_match' || b.state === 'live')
  const generated = generateDailyPromotions({ career, day: today, boards })
  for (const p of generated) {
    if (!data.promotions.find(existing => existing.id === p.id)) {
      data.promotions.push(p)
    }
  }
}
