/**
 * Tipi pubblici del modulo betting. Tutti serializzabili in JSON
 * (entrano nei salvataggi via Career.bettingCareerData).
 * Vedi docs/specs/betting/BETTING_SPEC.md sez. 2.
 */

import type { EntityId } from '$engine/types'

// ============================================================
// MERCATI
// ============================================================

export type MarketCategory =
  | 'main'
  | 'goals'
  | 'handicap'
  | 'scorers'
  | 'exact'
  | 'halves'
  | 'combo'
  | 'specials'

export type MarketKind =
  | '1X2'
  | 'double_chance'
  | 'draw_no_bet'
  | 'over_under'
  | 'btts'
  | 'team_over_under'
  | 'total_goals_bands'
  | 'asian_handicap'
  | 'european_handicap'
  | 'anytime_scorer'
  | 'first_scorer'
  | 'last_scorer'
  | 'scorer_2plus'
  | 'scorer_hattrick'
  | 'no_goalscorer'
  | 'correct_score'
  | 'halftime_correct_score'
  | 'halftime_1X2'
  | 'halftime_fulltime'
  | 'halftime_over_under'
  | 'halftime_btts'
  | 'half_with_most_goals'
  | '1X2_and_btts'
  | '1X2_and_over_under'
  | 'btts_and_over_under'
  | 'total_cards_over_under'
  | 'total_corners_over_under'
  | 'first_goal_team'
  | 'first_card_team'
  | 'red_card_match'
  | 'penalty_awarded'

export type Outcome1X2 = '1' | 'X' | '2'

export interface SelectionMeta {
  side?: 'home' | 'away'
  outcome?: Outcome1X2
  line?: number
  score?: { home: number; away: number }
  playerId?: EntityId
  htOutcome?: Outcome1X2
  ftOutcome?: Outcome1X2
}

export interface Selection {
  id: string
  label: string
  probability: number   // 0..1, "vera"
  odds: number          // decimal, con margine, >= 1.01
  meta?: SelectionMeta
}

export type MarketStatus = 'open' | 'suspended' | 'closed' | 'settled'

export interface Market {
  id: string
  fixtureId: EntityId
  kind: MarketKind
  category: MarketCategory
  label: string
  selections: Selection[]
  status: MarketStatus
  isLive: boolean
  margin: number
  updatedAt: number
  lastDelta?: Record<string, number>
}

export type BoardState = 'pre_match' | 'live' | 'ht' | 'settled' | 'void'

export interface MatchOddsBoard {
  fixtureId: EntityId
  matchday: number
  homeId: EntityId
  awayId: EntityId
  kickoff: string
  markets: Market[]
  generatedAt: number
  state: BoardState
  liveMinute?: number
  liveScore?: { home: number; away: number }
}

// ============================================================
// SCHEDINA / BOLLETTE
// ============================================================

export type BetSlipMode = 'single' | 'multiple' | 'system'
export type AcceptOddsChange = 'always' | 'higher_only' | 'never'

export interface BetSelection {
  fixtureId: EntityId
  marketId: string
  selectionId: string
  snapshotOdds: number
  snapshotLabel: string
  isLive: boolean
  addedAt: number
}

export interface BetSlipDraft {
  mode: BetSlipMode
  selections: BetSelection[]
  stake: number
  systemSize?: number
  acceptOddsChange: AcceptOddsChange
}

export type BetStatus =
  | 'open'
  | 'won'
  | 'lost'
  | 'void'
  | 'half_won'
  | 'half_lost'
  | 'cashed_out'

export type SelectionStatus = 'pending' | 'won' | 'lost' | 'void' | 'half_won' | 'half_lost'

export interface PlacedSelection {
  fixtureId: EntityId
  marketId: string
  marketKind: MarketKind
  selectionId: string
  selectionLabel: string
  selectionMeta?: SelectionMeta
  oddsAtPlacement: number
  isLive: boolean
  status: SelectionStatus
}

export interface PlacedBet {
  id: string
  careerId: EntityId
  matchday: number
  placedAt: number
  mode: BetSlipMode
  selections: PlacedSelection[]
  systemSize?: number
  stake: number
  combinedOdds: number
  potentialWin: number
  status: BetStatus
  settledAt?: number
  actualPayout?: number
  cashOutValue?: number
  cashOutAt?: number
  // promozione applicata
  promotionId?: string
}

// ============================================================
// BANKROLL / STATS
// ============================================================

export interface WalletCaps {
  maxStakePerBet?: number
  maxStakePerMatchday?: number
  maxLossPerMatchday?: number
  cooldownAfterLossStreak?: number
}

export interface MatchdayWalletState {
  matchday: number
  totalStaked: number
  totalReturned: number
  netProfit: number
  lossStreak: number
}

export interface BettingWallet {
  clubId: EntityId
  caps: WalletCaps
  matchdayState: MatchdayWalletState
}

export interface BettingStatsSnapshot {
  totalBets: number
  wonBets: number
  lostBets: number
  voidBets: number
  totalStaked: number
  totalReturned: number
  netProfit: number
  roi: number
  yield: number
  longestWinStreak: number
  longestLossStreak: number
  currentStreak: { kind: 'W' | 'L' | 'N'; count: number }
  biggestWin: number
  favouriteMarket: MarketKind | null
}

export interface BettingStats extends BettingStatsSnapshot {
  bySeason: Record<number, BettingStatsSnapshot>
}

// ============================================================
// PROMOZIONI
// ============================================================

export type PromotionType = 'odds_boost' | 'free_bet' | 'accumulator_bonus'

export interface Promotion {
  id: string
  type: PromotionType
  fixtureId?: EntityId
  marketKind?: MarketKind
  selectionId?: string
  multiplier?: number
  freeBetAmount?: number
  minSelections?: number
  bonusPercent?: number
  validUntil: string
}

// ============================================================
// NARRATIVE
// ============================================================

export interface NarrativeFlags {
  debtIncidentTriggered: boolean
  bigWinIncidentTriggered: boolean
  excessiveBettingWarned: boolean
}

// ============================================================
// CONTENITORE PER Career
// ============================================================

export interface BettingCareerData {
  wallet: BettingWallet
  oddsBoards: Record<EntityId, MatchOddsBoard>
  openBets: PlacedBet[]
  settledBets: PlacedBet[]
  stats: BettingStats
  promotions: Promotion[]
  narrativeFlags: NarrativeFlags
}

// ============================================================
// CONFIG PER-LEGA
// ============================================================

/**
 * Parametri del modello probabilistico e del bookmaker calibrati per competizione.
 * Diverse competizioni hanno gol medi, fattore casa e dinamiche margine differenti.
 *
 * Lookup: `getLeagueBettingConfig(leagueId)` in $engine/betting/config.
 */
export interface LeagueBettingConfig {
  /** ID o nome canonico ('serie_a', 'champions_league', ecc.) */
  id: string
  /** Nome visibile */
  label: string
  /** Gol attesi medi per partita - squadra di casa */
  avgGoalsHome: number
  /** Gol attesi medi per partita - squadra in trasferta */
  avgGoalsAway: number
  /** Moltiplicatore vantaggio casa (1.0 = neutro, 1.30 default Serie A) */
  homeAdvantage: number
  /** Correzione Dixon-Coles, in [-0.20, -0.10] */
  dixonColesRho: number
  /** Frazione di gol attesi nel 1° tempo (~0.42 standard) */
  htGoalShare: number
  /** Moltiplicatore margine bookmaker (1.0 = standard; <1 = mercati "larghi"; >1 = stretti) */
  marginFactor: number
  /** Reputation media delle squadre di lega (per calibrare il topMatchFactor) */
  refReputation: number
}

// ============================================================
// INPUT MODELLO PROBABILISTICO (interno engine)
// ============================================================

export interface TeamStrengthInput {
  attackingStrength: number
  defensiveStrength: number
  homeAdvantage: number
  formIndex: number
  fitnessAvg: number
  moraleAvg: number
  injuredKeyPlayers: number
  suspendedPlayers: number
  isDerby: boolean
  motivationFactor: number
  fatigueFactor: number
  refereeStrictness: number
  aggressivenessFactor: number
  styleFactor: number
}

export interface MatchProbabilityModel {
  lambdaHome: number
  lambdaAway: number
  lambdaHomeHT: number
  lambdaAwayHT: number
  probMatrix: number[][]         // [home][away], 8x8
  probMatrixHT: number[][]       // 1° tempo
  lambdaCards: number
  lambdaCorners: number
  lambdaRedCards: number
  lambdaPenalties: number
  topMatchFactor: number         // 0.8..1.2 per modulare margine
}

// ============================================================
// LIVE CONTEXT
// ============================================================

export interface LiveContext {
  fixtureId: EntityId
  minute: number
  second: number
  homeScore: number
  awayScore: number
  redCardsHome: number
  redCardsAway: number
  yellowCardsHome: number
  yellowCardsAway: number
  cornersHome: number
  cornersAway: number
  scorers: EntityId[]
  halfTimePassed: boolean
  // riferimento ai parametri pre-match per ricalcolo residuo
  initialLambdaHome: number
  initialLambdaAway: number
}
