/**
 * Factory per inizializzare BettingCareerData su un savegame nuovo o legacy.
 */

import type {
  BettingCareerData,
  BettingStats,
  BettingStatsSnapshot,
} from './types'
import { initWallet } from './bankroll'

export function emptyStatsSnapshot(): BettingStatsSnapshot {
  return {
    totalBets: 0,
    wonBets: 0,
    lostBets: 0,
    voidBets: 0,
    totalStaked: 0,
    totalReturned: 0,
    netProfit: 0,
    roi: 0,
    yield: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
    currentStreak: { kind: 'N', count: 0 },
    biggestWin: 0,
    favouriteMarket: null,
  }
}

export function emptyStats(): BettingStats {
  return {
    ...emptyStatsSnapshot(),
    bySeason: {},
  }
}

export interface InitBettingDataInput {
  clubId: string
  matchday: number
}

export function initBettingCareerData(inp: InitBettingDataInput): BettingCareerData {
  return {
    wallet: initWallet(inp.clubId, inp.matchday),
    oddsBoards: {},
    openBets: [],
    settledBets: [],
    stats: emptyStats(),
    promotions: [],
    narrativeFlags: {
      debtIncidentTriggered: false,
      bigWinIncidentTriggered: false,
      excessiveBettingWarned: false,
    },
  }
}
