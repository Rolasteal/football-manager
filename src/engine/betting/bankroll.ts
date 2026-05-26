/**
 * Wallet/bankroll: hook col Team.balance del club. Vedi BETTING_SPEC.md sez. 9.
 */

import type { Team } from '$engine/types'
import type { BettingWallet, MatchdayWalletState, WalletCaps } from './types'

export type DebitResult = { ok: true } | { ok: false; reason: string }

// ============================================================
// COSTANTI CAP DINAMICI
// ============================================================

/**
 * Cap espressi come frazione del Team.balance iniziale.
 * Calibrati per resistere a stagioni intere di scommesse senza bancarotta
 * (con balance statico — vedi src/engine/gen/world.ts, niente income/salari ora).
 *
 * Esempio: balance €100M
 *  - maxStakePerBet = €1.0M (1%)
 *  - maxStakePerMatchday = €3.0M (3%)
 *  - maxLossPerMatchday = €5.0M (5%)
 *  - cooldown dopo 5 sconfitte consecutive
 */
export const CAP_STAKE_PER_BET_PCT = 0.01           // 1% del balance
export const CAP_STAKE_PER_MATCHDAY_PCT = 0.03      // 3% del balance
export const CAP_LOSS_PER_MATCHDAY_PCT = 0.05       // 5% del balance
export const CAP_PAYOUT_PCT = 0.10                  // 10% del balance
export const CAP_PAYOUT_ABSOLUTE = 1_000_000        // €1M assoluto
export const COOLDOWN_LOSS_STREAK = 5
/** Stake minimo assoluto per non far diventare 0 i cap per club piccoli */
export const MIN_STAKE_FLOOR = 100

export function defaultCapsForTeam(team: Team): WalletCaps {
  const b = Math.max(0, team.balance)
  return {
    maxStakePerBet: Math.max(MIN_STAKE_FLOOR, Math.round(b * CAP_STAKE_PER_BET_PCT)),
    maxStakePerMatchday: Math.max(MIN_STAKE_FLOOR * 3, Math.round(b * CAP_STAKE_PER_MATCHDAY_PCT)),
    maxLossPerMatchday: Math.max(MIN_STAKE_FLOOR * 5, Math.round(b * CAP_LOSS_PER_MATCHDAY_PCT)),
    cooldownAfterLossStreak: COOLDOWN_LOSS_STREAK,
  }
}

export function maxPayoutForTeam(team: Team): number {
  const b = Math.max(0, team.balance)
  return Math.min(CAP_PAYOUT_ABSOLUTE, Math.round(b * CAP_PAYOUT_PCT))
}

// ============================================================
// INIT
// ============================================================

export function initWallet(clubId: string, matchday: number, team?: Team): BettingWallet {
  return {
    clubId,
    caps: team ? defaultCapsForTeam(team) : {},
    matchdayState: emptyMatchdayState(matchday),
  }
}

/** Ricalcola i cap quando il balance cambia (es. inizio stagione). */
export function refreshCapsFromTeam(wallet: BettingWallet, team: Team): void {
  wallet.caps = defaultCapsForTeam(team)
}

export function emptyMatchdayState(matchday: number): MatchdayWalletState {
  return {
    matchday,
    totalStaked: 0,
    totalReturned: 0,
    netProfit: 0,
    lossStreak: 0,
  }
}

export function rolloverMatchday(wallet: BettingWallet, newMatchday: number): void {
  // Mantieni lossStreak (continua tra giornate); azzera i totali settimanali
  const ls = wallet.matchdayState.lossStreak
  wallet.matchdayState = emptyMatchdayState(newMatchday)
  wallet.matchdayState.lossStreak = ls
}

export function debit(team: Team, wallet: BettingWallet, amount: number): DebitResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Importo non valido' }
  if (amount > team.balance) return { ok: false, reason: 'Saldo club insufficiente' }

  const caps = wallet.caps
  if (caps.maxStakePerBet && amount > caps.maxStakePerBet) {
    return { ok: false, reason: `Limite singola scommessa: ${formatEuro(caps.maxStakePerBet)}` }
  }
  if (caps.maxStakePerMatchday) {
    if (wallet.matchdayState.totalStaked + amount > caps.maxStakePerMatchday) {
      return { ok: false, reason: `Limite settimanale scommesse: ${formatEuro(caps.maxStakePerMatchday)}` }
    }
  }
  if (caps.maxLossPerMatchday) {
    const projectedLoss = wallet.matchdayState.totalStaked - wallet.matchdayState.totalReturned + amount
    if (projectedLoss > caps.maxLossPerMatchday) {
      return { ok: false, reason: 'Limite perdite settimanali raggiunto' }
    }
  }
  if (caps.cooldownAfterLossStreak && wallet.matchdayState.lossStreak >= caps.cooldownAfterLossStreak) {
    return { ok: false, reason: `Cooldown attivo dopo ${wallet.matchdayState.lossStreak} sconfitte consecutive` }
  }

  team.balance -= amount
  wallet.matchdayState.totalStaked += amount
  return { ok: true }
}

export function credit(team: Team, wallet: BettingWallet, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  team.balance += amount
  wallet.matchdayState.totalReturned += amount
  wallet.matchdayState.netProfit = wallet.matchdayState.totalReturned - wallet.matchdayState.totalStaked
}

export function refund(team: Team, wallet: BettingWallet, amount: number): void {
  // Refund = restituisco lo stake (es. void su singola, cash out). Decremento totalStaked.
  if (!Number.isFinite(amount) || amount <= 0) return
  team.balance += amount
  wallet.matchdayState.totalStaked = Math.max(0, wallet.matchdayState.totalStaked - amount)
}

export function recordLoss(wallet: BettingWallet): void {
  wallet.matchdayState.lossStreak++
  wallet.matchdayState.netProfit = wallet.matchdayState.totalReturned - wallet.matchdayState.totalStaked
}

export function recordWin(wallet: BettingWallet): void {
  wallet.matchdayState.lossStreak = 0
  wallet.matchdayState.netProfit = wallet.matchdayState.totalReturned - wallet.matchdayState.totalStaked
}

function formatEuro(n: number): string {
  return `€${Math.round(n).toLocaleString('it-IT')}`
}
