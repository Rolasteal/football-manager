/**
 * Applicazione margine bookmaker (overround) via power method.
 * Vedi BETTING_SPEC.md sez. 5.
 */

import type { MarketKind } from './types'

export const MARGIN_TABLE: Record<MarketKind, number> = {
  '1X2': 0.06,
  'double_chance': 0.045,
  'draw_no_bet': 0.04,
  'over_under': 0.045,
  'btts': 0.055,
  'team_over_under': 0.05,
  'total_goals_bands': 0.075,
  'asian_handicap': 0.035,
  'european_handicap': 0.065,
  'anytime_scorer': 0.13,
  'first_scorer': 0.15,
  'last_scorer': 0.15,
  'scorer_2plus': 0.19,
  'scorer_hattrick': 0.24,
  'no_goalscorer': 0.13,
  'correct_score': 0.20,
  'halftime_correct_score': 0.19,
  'halftime_1X2': 0.06,
  'halftime_fulltime': 0.20,
  'halftime_over_under': 0.05,
  'halftime_btts': 0.08,
  'half_with_most_goals': 0.09,
  '1X2_and_btts': 0.11,
  '1X2_and_over_under': 0.11,
  'btts_and_over_under': 0.10,
  'total_cards_over_under': 0.09,
  'total_corners_over_under': 0.09,
  'first_goal_team': 0.08,
  'first_card_team': 0.08,
  'red_card_match': 0.12,
  'penalty_awarded': 0.12,
}

const MIN_ODDS = 1.01
/**
 * Cap massimo quota. 250 è coerente con i bookmaker reali (Bet365/Pinnacle
 * raramente offrono >200 sui mercati standard; correct_score estremi possono
 * arrivare a 500 ma non sono "core").
 */
const MAX_ODDS = 250

/**
 * Trova k tale che Σ p_i^(1/k) = 1 + margin.
 * Restituisce array di "probabilità implicite" (= 1/odds).
 */
export function powerMethod(probs: number[], targetMargin: number): number[] {
  if (probs.length === 0) return []
  // Normalizza assicurandoti che le prob sommino a ~1 (se non lo fanno per arrotondamento)
  const sum = probs.reduce((s, p) => s + p, 0)
  const normalized = sum > 0 ? probs.map(p => p / sum) : probs

  // sum(p^(1/k)) è funzione CRESCENTE di k per p ∈ (0,1):
  //   k=1 → sum = 1 (probs sommano a 1)
  //   k→∞ → sum → n (cardinalità)
  // Cerchiamo k tale che sum = 1 + margin (margin piccolo positivo).
  let lo = 1.0
  let hi = 8.0
  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2
    const s = normalized.reduce((acc, p) => acc + Math.pow(p, 1 / mid), 0)
    if (s > 1 + targetMargin) hi = mid   // k troppo grande → riduci
    else lo = mid                         // k troppo piccolo → alza
    if (hi - lo < 1e-7) break
  }
  const k = (lo + hi) / 2
  return normalized.map(p => Math.pow(p, 1 / k))
}

/**
 * Converte un array di probabilità "vere" in quote decimali con margine applicato.
 * topMatchFactor: 0.8 (top match, margine ridotto) .. 1.2 (partita minore, margine alto).
 */
export function priceMarket(
  trueProbs: number[],
  marketKind: MarketKind,
  topMatchFactor: number = 1.0,
  marginJitter: number = 0,
  leagueMarginFactor: number = 1.0,
): number[] {
  const baseMargin = MARGIN_TABLE[marketKind] ?? 0.08
  const margin = Math.max(0.01, baseMargin * topMatchFactor * leagueMarginFactor + marginJitter)
  const implied = powerMethod(trueProbs, margin)
  return implied.map(p => {
    if (p <= 0) return MAX_ODDS
    const o = 1 / p
    return Math.max(MIN_ODDS, Math.min(MAX_ODDS, Math.round(o * 100) / 100))
  })
}

/** Margine effettivo di un array di quote (== overround). */
export function computeMargin(odds: number[]): number {
  return odds.reduce((s, o) => s + 1 / o, 0) - 1
}

/** Inverte: dato un array di quote, restituisce le probabilità implicite normalizzate (senza margine). */
export function fairProbsFromOdds(odds: number[]): number[] {
  const implied = odds.map(o => 1 / o)
  const sum = implied.reduce((s, p) => s + p, 0)
  return implied.map(p => p / sum)
}

/**
 * Calcola topMatchFactor in base alla reputazione delle squadre relativa alla lega.
 * "Top match" della Champions League ha rep più alta del "top match" di Serie B,
 * ma per il bookmaker entrambi sono "top per quella competizione".
 *
 * Top match (entrambe rep alte vs avg lega) → 0.85 (margine ridotto, partita "larga")
 * Match piccolo (entrambe rep basse vs avg) → 1.15 (margine alto)
 */
export function topMatchFactorFromReputation(
  homeRep: number,
  awayRep: number,
  refReputation: number = 70,
): number {
  const avg = (homeRep + awayRep) / 2
  const relative = avg / refReputation
  if (relative >= 1.15) return 0.85
  if (relative >= 1.05) return 0.92
  if (relative >= 0.92) return 1.0
  if (relative >= 0.78) return 1.08
  return 1.15
}
