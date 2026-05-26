/**
 * Public API del modulo betting.
 * Vedi docs/specs/betting/BETTING_SPEC.md per il riferimento completo.
 */

export type {
  // Mercati
  Market, MarketKind, MarketCategory, MarketStatus, BoardState,
  Selection, SelectionMeta, MatchOddsBoard, Outcome1X2,
  // Schedina
  BetSelection, BetSlipDraft, BetSlipMode, AcceptOddsChange,
  PlacedBet, PlacedSelection, BetStatus, SelectionStatus,
  // Bankroll/Stats
  BettingWallet, WalletCaps, MatchdayWalletState,
  BettingStats, BettingStatsSnapshot,
  // Promozioni
  Promotion, PromotionType,
  // Narrative
  NarrativeFlags,
  // Container
  BettingCareerData,
  // Modello
  TeamStrengthInput, MatchProbabilityModel,
  // Live
  LiveContext,
} from './types'

export {
  // Engine probabilistico
  buildMatchProbabilityModel,
  buildTeamInput,
  computeLambdas,
  dixonColesMatrix,
  p1X2, pOver, pUnder, pBtts, pCorrectScore, pTeamOver, pGoalsBand,
  pEuropeanHandicap, pAsianHandicap,
  computeScorerProbabilities,
  computeAuxLambdas,
  outcomeFromScore,
  LEAGUE_AVG_GOALS_HOME, LEAGUE_AVG_GOALS_AWAY, DIXON_COLES_RHO,
} from './oddsEngine'

export {
  priceMarket,
  powerMethod,
  computeMargin,
  fairProbsFromOdds,
  topMatchFactorFromReputation,
  MARGIN_TABLE,
} from './overround'

export {
  buildOddsBoard,
  build1X2, buildDoubleChance, buildDrawNoBet,
  buildOverUnder, buildBtts, buildTeamOverUnder, buildTotalGoalsBands,
  buildEuropeanHandicap, buildAsianHandicap,
  buildScorerMarkets,
  buildCorrectScore,
  buildHalftime1X2, buildHalftimeOverUnder, buildHalftimeBtts,
  buildHalftimeFulltime, buildHalfWithMostGoals,
  build1X2AndBtts, build1X2AndOverUnder, buildBttsAndOverUnder,
  buildCardsOverUnder, buildCornersOverUnder,
  buildFirstGoalTeam, buildRedCardMatch, buildPenaltyAwarded,
} from './marketsGenerator'

export {
  initWallet, emptyMatchdayState, rolloverMatchday,
  debit, credit, refund, recordLoss, recordWin,
} from './bankroll'

export {
  validateSlip, detectCorrelations,
  priceSlip, buildPlacedBet,
  nCk, generateCombinations,
} from './betSlip'

export {
  resolveSelection, settleBet, settleFixture, updateStats,
} from './settlement'

export {
  applyEvent, recomputeMarkets, residualLambdas,
  marketsAffectedBy, suspensionMs,
  suspendMarkets, resumeMarkets, closeMarkets,
} from './liveOddsUpdater'

export {
  computeCashOut, applyCashOut, CASH_OUT_FACTOR,
} from './cashout'

export {
  mulberry32, rngFromString, jitter, pickWeighted,
} from './seed'

export {
  ensureBettingData,
  isOwnTeamFixture,
  resolveLeagueConfig,
  generateOddsForMatchday,
  placeBet,
  onMatchEvent,
  settleMatch,
  executeCashOut,
  onMatchdayAdvance,
  refreshPromotions,
  type LineupResolver,
  type FormResolver,
  type PlaceBetInput,
  type PlaceBetResult,
  type CashOutInput,
  type CashOutResult,
  type GenerateOddsOptions,
} from './orchestrator'

export {
  ALL_LEAGUE_CONFIGS,
  CONFIG_TIER1_LEAGUE,
  CONFIG_TIER2_LEAGUE,
  CONFIG_CHAMPIONS_LEAGUE,
  CONFIG_EUROPA_LEAGUE,
  CONFIG_CONFERENCE_LEAGUE,
  CONFIG_NATIONAL_TEAMS,
  getLeagueBettingConfig,
  resolveLeagueConfigByTier,
} from './config'

export {
  generateDailyPromotions,
  ensureAccumulatorPromotion,
  clearExpiredPromotions,
} from './promotions'

export {
  defaultCapsForTeam,
  maxPayoutForTeam,
  refreshCapsFromTeam,
  CAP_STAKE_PER_BET_PCT,
  CAP_STAKE_PER_MATCHDAY_PCT,
  CAP_LOSS_PER_MATCHDAY_PCT,
  CAP_PAYOUT_PCT,
  CAP_PAYOUT_ABSOLUTE,
} from './bankroll'
