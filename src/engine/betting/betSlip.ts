/**
 * Pricing schedina (singola / multipla / sistema). Vedi BETTING_SPEC.md sez. 7.
 */

import type {
  BetSelection,
  BetSlipDraft,
  Market,
  PlacedBet,
  PlacedSelection,
  Promotion,
} from './types'

// ============================================================
// COSTANTI
// ============================================================

const MAX_SELECTIONS = 20
const MIN_MULTIPLE_SELECTIONS = 2
const MAX_PAYOUT_CAP = 1_000_000        // cap vincita per bolletta (default)
const CORRELATION_TAX_FACTOR = 0.92     // se selezioni correlate
const ACCUMULATOR_BONUSES: Array<[number, number]> = [  // [minSelections, bonus%]
  [4, 0.05],
  [5, 0.08],
  [6, 0.12],
  [7, 0.18],
  [8, 0.25],
  [10, 0.40],
]

// ============================================================
// VALIDAZIONE
// ============================================================

export interface SlipValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export function validateSlip(draft: BetSlipDraft, markets: Record<string, Market>): SlipValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (draft.selections.length === 0) errors.push('Schedina vuota')
  if (draft.selections.length > MAX_SELECTIONS) errors.push(`Massimo ${MAX_SELECTIONS} selezioni`)
  if (draft.stake <= 0) errors.push('Stake non valido')

  if (draft.mode === 'single' && draft.selections.length !== 1) {
    errors.push('Singola richiede esattamente 1 selezione')
  }
  if (draft.mode === 'multiple' && draft.selections.length < MIN_MULTIPLE_SELECTIONS) {
    errors.push(`Multipla richiede almeno ${MIN_MULTIPLE_SELECTIONS} selezioni`)
  }
  if (draft.mode === 'system') {
    if (!draft.systemSize || draft.systemSize < 1 || draft.systemSize > draft.selections.length) {
      errors.push('Sistema: k non valido')
    }
    if (draft.selections.length < 3) {
      errors.push('Sistema richiede almeno 3 selezioni')
    }
  }

  // No 2 selezioni stesso mercato
  const marketKey = (s: BetSelection) => `${s.fixtureId}:${s.marketId}`
  const seen = new Map<string, BetSelection>()
  for (const s of draft.selections) {
    const k = marketKey(s)
    if (seen.has(k)) errors.push(`Due selezioni sullo stesso mercato (${k})`)
    seen.set(k, s)
  }

  // Mercato esiste e non chiuso
  for (const s of draft.selections) {
    const m = markets[s.marketId]
    if (!m) {
      errors.push(`Mercato non trovato: ${s.marketId}`)
      continue
    }
    if (m.status === 'closed' || m.status === 'settled') {
      errors.push(`Mercato chiuso: ${m.label}`)
    }
    if (m.status === 'suspended') {
      warnings.push(`Mercato sospeso: ${m.label}`)
    }
    const sel = m.selections.find(x => x.id === s.selectionId)
    if (!sel) errors.push(`Selezione non trovata: ${s.selectionId}`)
  }

  // Selezioni correlate (multipla)
  if (draft.mode === 'multiple') {
    const corr = detectCorrelations(draft.selections)
    if (corr.blocking.length > 0) {
      errors.push(`Selezioni totalmente correlate: ${corr.blocking.join(', ')}`)
    }
    if (corr.taxApplied.length > 0) {
      warnings.push(`Quota ridotta del 8% per selezioni correlate: ${corr.taxApplied.join(', ')}`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

interface CorrelationResult {
  blocking: string[]    // descrizioni
  taxApplied: string[]
  taxFactor: number     // moltiplicativo
}

export function detectCorrelations(sels: BetSelection[]): CorrelationResult {
  const blocking: string[] = []
  const taxApplied: string[] = []
  let taxFactor = 1

  // Raggruppa per fixture
  const byFixture = new Map<string, BetSelection[]>()
  for (const s of sels) {
    const arr = byFixture.get(s.fixtureId) ?? []
    arr.push(s)
    byFixture.set(s.fixtureId, arr)
  }

  for (const [, group] of byFixture) {
    if (group.length < 2) continue
    // Più selezioni stesso match → applichiamo correlation tax una volta
    taxFactor *= CORRELATION_TAX_FACTOR
    taxApplied.push(`${group.length} selezioni stessa partita`)

    // Pattern blocking specifici (V1: ne controlliamo i più ovvi)
    const marketKinds = group.map(g => extractMarketKind(g.marketId))
    if (marketKinds.includes('correct_score') && marketKinds.includes('1X2')) {
      // Score esatto include già 1X2 → blocco
      blocking.push('Risultato esatto + 1X2 stessa partita')
    }
    if (marketKinds.includes('correct_score') && marketKinds.includes('over_under')) {
      blocking.push('Risultato esatto + Over/Under stessa partita')
    }
  }

  return { blocking, taxApplied, taxFactor }
}

function extractMarketKind(marketId: string): string {
  const parts = marketId.split(':')
  return parts[1] ?? ''
}

// ============================================================
// PRICING
// ============================================================

export interface SlipPricing {
  combinedOdds: number
  totalStake: number
  potentialWin: number
  bonusApplied: number          // 0 o frazione bonus multipla
  promotionApplied?: string     // id promo
  capHit: boolean               // vincita cappata
  warnings: string[]
}

export function priceSlip(
  draft: BetSlipDraft,
  markets: Record<string, Market>,
  promotion?: Promotion,
  maxPayoutCap: number = MAX_PAYOUT_CAP,
): SlipPricing {
  const liveOdds = draft.selections.map(s => {
    const m = markets[s.marketId]
    const sel = m?.selections.find(x => x.id === s.selectionId)
    return sel?.odds ?? s.snapshotOdds
  })

  const warnings: string[] = []

  if (draft.mode === 'single') {
    let odds = liveOdds[0]
    if (promotion?.type === 'odds_boost' && promotion.multiplier) {
      odds = odds * promotion.multiplier
    }
    const totalStake = draft.stake
    const potentialWin = Math.min(maxPayoutCap, totalStake * odds)
    return {
      combinedOdds: odds,
      totalStake,
      potentialWin,
      bonusApplied: 0,
      promotionApplied: promotion?.id,
      capHit: totalStake * odds > maxPayoutCap,
      warnings,
    }
  }

  if (draft.mode === 'multiple') {
    let combined = liveOdds.reduce((p, o) => p * o, 1)
    const corr = detectCorrelations(draft.selections)
    combined *= corr.taxFactor
    const bonus = multipleBonusFor(draft.selections.length)
    let totalStake = draft.stake
    let potential = totalStake * combined * (1 + bonus)
    // accumulator bonus promo?
    if (promotion?.type === 'accumulator_bonus' && promotion.minSelections && draft.selections.length >= promotion.minSelections) {
      potential *= 1 + (promotion.bonusPercent ?? 0)
    }
    const capped = Math.min(maxPayoutCap, potential)
    return {
      combinedOdds: combined,
      totalStake,
      potentialWin: capped,
      bonusApplied: bonus,
      promotionApplied: promotion?.id,
      capHit: potential > maxPayoutCap,
      warnings: [...warnings, ...corr.taxApplied.length > 0 ? ['Correlation tax applicata'] : []],
    }
  }

  if (draft.mode === 'system') {
    const n = draft.selections.length
    const k = draft.systemSize!
    const combos = nCk(n, k)
    const totalStake = draft.stake * combos
    // Max win = "tutte vincono": somma di tutti i payout per combinazione
    let maxWin = 0
    const combosList = generateCombinations(liveOdds, k)
    for (const c of combosList) {
      const odds = c.reduce((p, o) => p * o, 1)
      maxWin += draft.stake * odds
    }
    const capped = Math.min(maxPayoutCap, maxWin)
    const combinedOdds = totalStake > 0 ? capped / totalStake : 0
    return {
      combinedOdds,
      totalStake,
      potentialWin: capped,
      bonusApplied: 0,
      capHit: maxWin > maxPayoutCap,
      warnings: [`Sistema ${k}/${n}: ${combos} combinazioni`],
    }
  }

  throw new Error(`Mode non supportata: ${draft.mode}`)
}

function multipleBonusFor(n: number): number {
  let bonus = 0
  for (const [min, b] of ACCUMULATOR_BONUSES) {
    if (n >= min) bonus = b
  }
  return bonus
}

export function nCk(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let r = 1
  k = Math.min(k, n - k)
  for (let i = 0; i < k; i++) {
    r = (r * (n - i)) / (i + 1)
  }
  return Math.round(r)
}

export function generateCombinations<T>(items: T[], k: number): T[][] {
  const result: T[][] = []
  const n = items.length
  if (k < 1 || k > n) return result
  const indices = Array.from({ length: k }, (_, i) => i)
  while (true) {
    result.push(indices.map(i => items[i]))
    let i = k - 1
    while (i >= 0 && indices[i] === n - k + i) i--
    if (i < 0) break
    indices[i]++
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1
  }
  return result
}

// ============================================================
// COSTRUTTORE PlacedBet
// ============================================================

export function buildPlacedBet(
  draft: BetSlipDraft,
  markets: Record<string, Market>,
  careerId: string,
  matchday: number,
  pricing: SlipPricing,
): PlacedBet {
  const placedSelections: PlacedSelection[] = draft.selections.map(s => {
    const m = markets[s.marketId]
    const sel = m?.selections.find(x => x.id === s.selectionId)
    return {
      fixtureId: s.fixtureId,
      marketId: s.marketId,
      marketKind: m?.kind ?? '1X2',
      selectionId: s.selectionId,
      selectionLabel: s.snapshotLabel,
      selectionMeta: sel?.meta,
      oddsAtPlacement: sel?.odds ?? s.snapshotOdds,
      isLive: s.isLive,
      status: 'pending',
    }
  })

  return {
    id: cryptoRandomId(),
    careerId,
    matchday,
    placedAt: Date.now(),
    mode: draft.mode,
    systemSize: draft.systemSize,
    selections: placedSelections,
    stake: pricing.totalStake,
    combinedOdds: pricing.combinedOdds,
    potentialWin: pricing.potentialWin,
    status: 'open',
    promotionId: pricing.promotionApplied,
  }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'bet_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36)
}
