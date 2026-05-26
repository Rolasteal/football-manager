/**
 * Calcola il valore di cash out per una bolletta aperta.
 * Vedi BETTING_SPEC.md sez. 6.5.
 */

import type { Market, PlacedBet, PlacedSelection } from './types'

export const CASH_OUT_FACTOR = 0.92         // 8% margine bookmaker sul cash out
const MIN_CASH_OUT = 0.50                    // valore minimo proposto

export interface CashOutQuote {
  available: boolean
  value: number
  reason?: string
}

export function computeCashOut(bet: PlacedBet, currentMarkets: Record<string, Market>): CashOutQuote {
  if (bet.status !== 'open') {
    return { available: false, value: 0, reason: 'Bolletta non aperta' }
  }
  if (bet.mode === 'system') {
    return { available: false, value: 0, reason: 'Cash out non disponibile su sistema' }
  }

  let liveCombined = 1
  for (const sel of bet.selections) {
    if (sel.status === 'lost') {
      return { available: false, value: 0, reason: 'Selezione persa' }
    }
    if (sel.status === 'won') {
      liveCombined *= sel.oddsAtPlacement
      continue
    }
    if (sel.status === 'half_won') {
      liveCombined *= (sel.oddsAtPlacement + 1) / 2
      continue
    }
    if (sel.status === 'half_lost') {
      liveCombined *= 0.5
      continue
    }
    if (sel.status === 'void') {
      liveCombined *= 1
      continue
    }
    // pending: serve quota live
    const liveOdds = findLiveOdds(currentMarkets, sel)
    if (!liveOdds || !Number.isFinite(liveOdds)) {
      return { available: false, value: 0, reason: 'Quota live non disponibile' }
    }
    // Mercato sospeso → no cash out
    const market = currentMarkets[sel.marketId]
    if (market?.status === 'suspended') {
      return { available: false, value: 0, reason: 'Mercato sospeso' }
    }
    liveCombined *= liveOdds
  }

  // Valore fair = stake * combinedOdds / liveCombined (perché potentialWin / liveCombined = stake fair attuale per ottenere lo stesso payout)
  const fair = (bet.stake * bet.combinedOdds) / Math.max(1e-6, liveCombined)
  const value = Math.max(0, fair * CASH_OUT_FACTOR)
  if (value < MIN_CASH_OUT) return { available: false, value: 0, reason: 'Valore troppo basso' }
  return { available: true, value: Math.round(value * 100) / 100 }
}

function findLiveOdds(markets: Record<string, Market>, sel: PlacedSelection): number | null {
  const m = markets[sel.marketId]
  if (!m) return null
  const s = m.selections.find(x => x.id === sel.selectionId)
  return s?.odds ?? null
}

export function applyCashOut(bet: PlacedBet, cashOutValue: number): PlacedBet {
  return {
    ...bet,
    status: 'cashed_out',
    actualPayout: cashOutValue,
    cashOutValue,
    cashOutAt: Date.now(),
    settledAt: Date.now(),
  }
}
