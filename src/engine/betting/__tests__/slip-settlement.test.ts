/**
 * Test schedina (pricing) + settlement (resolver per ogni mercato).
 */

import { describe, it, expect } from 'vitest'
import type { Market, BetSlipDraft, PlacedBet, PlacedSelection } from '../types'
import type { MatchResult } from '$engine/competition/types'
import { validateSlip, priceSlip, nCk, generateCombinations } from '../betSlip'
import { resolveSelection, settleBet } from '../settlement'

// Helper: market mock
function mkMarket(id: string, kind: any, selections: Array<{ id: string; odds: number; label?: string; meta?: any }>): Market {
  return {
    id, fixtureId: 'fix1', kind, category: 'main', label: kind,
    selections: selections.map(s => ({ id: s.id, label: s.label ?? s.id, probability: 1 / s.odds, odds: s.odds, meta: s.meta })),
    status: 'open', isLive: false, margin: 0, updatedAt: Date.now(),
  }
}

function mkResult(home: number, away: number, extras: Partial<MatchResult> = {}): MatchResult {
  return {
    homeScore: home, awayScore: away,
    events: [], stats: { home: emptyStats(), away: emptyStats() }, ratings: {}, scorers: [],
    ...extras,
  }
}
function emptyStats() {
  return { possession: 50, shots: 10, shotsOnTarget: 4, corners: 5, fouls: 12, yellowCards: 1, redCards: 0, passes: 350, passAccuracy: 80 }
}

// ============================================================
// COMBINATORICS
// ============================================================

describe('nCk', () => {
  it('valori base', () => {
    expect(nCk(5, 3)).toBe(10)
    expect(nCk(4, 2)).toBe(6)
    expect(nCk(10, 0)).toBe(1)
    expect(nCk(10, 10)).toBe(1)
    expect(nCk(5, 7)).toBe(0)
  })
})

describe('generateCombinations', () => {
  it('genera tutte le combinazioni C(n,k)', () => {
    const combos = generateCombinations(['a', 'b', 'c', 'd'], 2)
    expect(combos.length).toBe(6)
    expect(combos).toContainEqual(['a', 'b'])
    expect(combos).toContainEqual(['c', 'd'])
  })
})

// ============================================================
// VALIDATE SLIP
// ============================================================

describe('validateSlip', () => {
  const m = mkMarket('m1', '1X2', [{ id: '1', odds: 1.85 }, { id: 'X', odds: 3.4 }, { id: '2', odds: 4.2 }])
  const markets = { m1: m }

  it('singola valida', () => {
    const draft: BetSlipDraft = {
      mode: 'single',
      selections: [{ fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 1.85, snapshotLabel: 'Casa', isLive: false, addedAt: Date.now() }],
      stake: 10, acceptOddsChange: 'always',
    }
    expect(validateSlip(draft, markets).ok).toBe(true)
  })

  it('schedina vuota → errore', () => {
    const draft: BetSlipDraft = { mode: 'single', selections: [], stake: 10, acceptOddsChange: 'always' }
    expect(validateSlip(draft, markets).ok).toBe(false)
  })

  it('stake 0 → errore', () => {
    const draft: BetSlipDraft = {
      mode: 'single',
      selections: [{ fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 1.85, snapshotLabel: 'X', isLive: false, addedAt: Date.now() }],
      stake: 0, acceptOddsChange: 'always',
    }
    expect(validateSlip(draft, markets).ok).toBe(false)
  })

  it('multipla con 1 selezione → errore', () => {
    const draft: BetSlipDraft = {
      mode: 'multiple',
      selections: [{ fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 1.85, snapshotLabel: 'X', isLive: false, addedAt: Date.now() }],
      stake: 10, acceptOddsChange: 'always',
    }
    expect(validateSlip(draft, markets).ok).toBe(false)
  })

  it('2 selezioni stesso mercato → errore', () => {
    const draft: BetSlipDraft = {
      mode: 'multiple',
      selections: [
        { fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 1.85, snapshotLabel: 'A', isLive: false, addedAt: Date.now() },
        { fixtureId: 'fix1', marketId: 'm1', selectionId: 'X', snapshotOdds: 3.4, snapshotLabel: 'B', isLive: false, addedAt: Date.now() },
      ],
      stake: 10, acceptOddsChange: 'always',
    }
    expect(validateSlip(draft, markets).ok).toBe(false)
  })
})

// ============================================================
// PRICE SLIP
// ============================================================

describe('priceSlip', () => {
  it('singola: potentialWin = stake × odds', () => {
    const m = mkMarket('m1', '1X2', [{ id: '1', odds: 2.50 }])
    const draft: BetSlipDraft = {
      mode: 'single',
      selections: [{ fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 2.50, snapshotLabel: 'X', isLive: false, addedAt: Date.now() }],
      stake: 100, acceptOddsChange: 'always',
    }
    const pricing = priceSlip(draft, { m1: m })
    expect(pricing.potentialWin).toBeCloseTo(250, 2)
  })

  it('multipla: combina le quote con prodotto', () => {
    const m1 = mkMarket('m1', '1X2', [{ id: '1', odds: 2.0 }])
    const m2 = mkMarket('m2', '1X2', [{ id: '1', odds: 3.0 }])
    const m3 = mkMarket('m3', '1X2', [{ id: '1', odds: 2.5 }])
    const draft: BetSlipDraft = {
      mode: 'multiple',
      selections: [
        { fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 2.0, snapshotLabel: 'A', isLive: false, addedAt: Date.now() },
        { fixtureId: 'fix2', marketId: 'm2', selectionId: '1', snapshotOdds: 3.0, snapshotLabel: 'B', isLive: false, addedAt: Date.now() },
        { fixtureId: 'fix3', marketId: 'm3', selectionId: '1', snapshotOdds: 2.5, snapshotLabel: 'C', isLive: false, addedAt: Date.now() },
      ],
      stake: 10, acceptOddsChange: 'always',
    }
    const pricing = priceSlip(draft, { m1, m2, m3 })
    // Quota = 2.0 * 3.0 * 2.5 = 15.0
    expect(pricing.combinedOdds).toBeCloseTo(15.0, 1)
    // Vincita 150 (no bonus per 3 selezioni)
    expect(pricing.potentialWin).toBeCloseTo(150, 1)
  })

  it('multipla 4+ selezioni: bonus accumulator applicato', () => {
    const ms = [2.0, 2.0, 2.0, 2.0].map((o, i) =>
      mkMarket(`m${i}`, '1X2', [{ id: '1', odds: o }])
    )
    const map: Record<string, Market> = Object.fromEntries(ms.map(m => [m.id, m]))
    const draft: BetSlipDraft = {
      mode: 'multiple',
      selections: ms.map((m, i) => ({
        fixtureId: `fix${i}`, marketId: m.id, selectionId: '1',
        snapshotOdds: 2.0, snapshotLabel: 'X', isLive: false, addedAt: Date.now(),
      })),
      stake: 10, acceptOddsChange: 'always',
    }
    const pricing = priceSlip(draft, map)
    // Quota base 16, bonus 5% → vincita 168
    expect(pricing.bonusApplied).toBeGreaterThan(0.04)
    expect(pricing.potentialWin).toBeGreaterThan(160)
  })

  it('sistema 3 su 5: 10 combinazioni, totalStake = 10 × stake', () => {
    const ms = [1.8, 2.0, 2.2, 1.9, 2.1].map((o, i) =>
      mkMarket(`m${i}`, '1X2', [{ id: '1', odds: o }])
    )
    const map: Record<string, Market> = Object.fromEntries(ms.map(m => [m.id, m]))
    const draft: BetSlipDraft = {
      mode: 'system', systemSize: 3,
      selections: ms.map((m, i) => ({
        fixtureId: `fix${i}`, marketId: m.id, selectionId: '1',
        snapshotOdds: 2.0, snapshotLabel: 'X', isLive: false, addedAt: Date.now(),
      })),
      stake: 5, acceptOddsChange: 'always',
    }
    const pricing = priceSlip(draft, map)
    expect(pricing.totalStake).toBeCloseTo(50, 1)   // 10 combos × 5
    expect(pricing.potentialWin).toBeGreaterThan(50)
  })

  it('cap massimo vincita applicato', () => {
    const m1 = mkMarket('m1', '1X2', [{ id: '1', odds: 100 }])
    const draft: BetSlipDraft = {
      mode: 'single',
      selections: [{ fixtureId: 'fix1', marketId: 'm1', selectionId: '1', snapshotOdds: 100, snapshotLabel: 'A', isLive: false, addedAt: Date.now() }],
      stake: 50_000, acceptOddsChange: 'always',
    }
    const pricing = priceSlip(draft, { m1 }, undefined, 1_000_000)
    expect(pricing.potentialWin).toBe(1_000_000)
    expect(pricing.capHit).toBe(true)
  })
})

// ============================================================
// RESOLVE SELECTION
// ============================================================

describe('resolveSelection — mercati gol', () => {
  function mkSel(kind: any, selectionId: string, meta?: any): PlacedSelection {
    return {
      fixtureId: 'fix1', marketId: 'm1', marketKind: kind,
      selectionId, selectionLabel: selectionId, selectionMeta: meta,
      oddsAtPlacement: 2.0, isLive: false, status: 'pending',
    }
  }

  it('1X2 Casa: home win → won', () => {
    expect(resolveSelection(mkSel('1X2', '1', { outcome: '1' }), mkResult(2, 1))).toBe('won')
    expect(resolveSelection(mkSel('1X2', '1', { outcome: '1' }), mkResult(0, 1))).toBe('lost')
    expect(resolveSelection(mkSel('1X2', 'X', { outcome: 'X' }), mkResult(1, 1))).toBe('won')
  })

  it('Over 2.5: 3+ gol → won', () => {
    expect(resolveSelection(mkSel('over_under', 'over_2.5', { line: 2.5 }), mkResult(2, 1))).toBe('won')
    expect(resolveSelection(mkSel('over_under', 'over_2.5', { line: 2.5 }), mkResult(1, 1))).toBe('lost')
    expect(resolveSelection(mkSel('over_under', 'under_2.5', { line: 2.5 }), mkResult(0, 1))).toBe('won')
  })

  it('BTTS: entrambe segnano → yes won', () => {
    expect(resolveSelection(mkSel('btts', 'yes'), mkResult(2, 1))).toBe('won')
    expect(resolveSelection(mkSel('btts', 'no'), mkResult(2, 1))).toBe('lost')
    expect(resolveSelection(mkSel('btts', 'no'), mkResult(2, 0))).toBe('won')
  })

  it('Double chance 1X: home win o draw → won', () => {
    expect(resolveSelection(mkSel('double_chance', '1X'), mkResult(2, 0))).toBe('won')
    expect(resolveSelection(mkSel('double_chance', '1X'), mkResult(1, 1))).toBe('won')
    expect(resolveSelection(mkSel('double_chance', '1X'), mkResult(0, 1))).toBe('lost')
  })

  it('Draw No Bet: pareggio → void', () => {
    expect(resolveSelection(mkSel('draw_no_bet', 'home', { outcome: '1' }), mkResult(1, 1))).toBe('void')
    expect(resolveSelection(mkSel('draw_no_bet', 'home', { outcome: '1' }), mkResult(2, 1))).toBe('won')
  })

  it('Correct score 2-1: solo 2-1 → won', () => {
    expect(resolveSelection(mkSel('correct_score', '2-1', { score: { home: 2, away: 1 } }), mkResult(2, 1))).toBe('won')
    expect(resolveSelection(mkSel('correct_score', '2-1', { score: { home: 2, away: 1 } }), mkResult(3, 1))).toBe('lost')
  })

  it('Asian Handicap -0.5: home win → won, X o away → lost', () => {
    expect(resolveSelection(mkSel('asian_handicap', 'home_-0.5', { side: 'home', line: -0.5 }), mkResult(1, 0))).toBe('won')
    expect(resolveSelection(mkSel('asian_handicap', 'home_-0.5', { side: 'home', line: -0.5 }), mkResult(1, 1))).toBe('lost')
  })

  it('Asian Handicap 0 (linea pari): pareggio → void', () => {
    expect(resolveSelection(mkSel('asian_handicap', 'home_0', { side: 'home', line: 0 }), mkResult(1, 1))).toBe('void')
    expect(resolveSelection(mkSel('asian_handicap', 'home_0', { side: 'home', line: 0 }), mkResult(2, 1))).toBe('won')
  })

  it('Total goals bands: 2-3 gol → 2-3 won', () => {
    expect(resolveSelection(mkSel('total_goals_bands', '2-3'), mkResult(1, 1))).toBe('won')
    expect(resolveSelection(mkSel('total_goals_bands', '2-3'), mkResult(1, 2))).toBe('won')
    expect(resolveSelection(mkSel('total_goals_bands', '2-3'), mkResult(2, 2))).toBe('lost')
    expect(resolveSelection(mkSel('total_goals_bands', '4-6'), mkResult(2, 2))).toBe('won')
  })

  it('Anytime scorer: il giocatore segna → won', () => {
    const result = mkResult(2, 0, { scorers: [
      { playerId: 'pX', teamId: 'tA', minute: 30 },
      { playerId: 'pY', teamId: 'tA', minute: 70 },
    ]})
    expect(resolveSelection(mkSel('anytime_scorer', 'pX', { playerId: 'pX' }), result)).toBe('won')
    expect(resolveSelection(mkSel('anytime_scorer', 'pZ', { playerId: 'pZ' }), result)).toBe('lost')
  })

  it('First scorer: autogol non conta, il primo "vero" gol conta', () => {
    const result = mkResult(2, 1, { scorers: [
      { playerId: 'pOG', teamId: 'tA', minute: 10, note: 'autogol' },
      { playerId: 'pX', teamId: 'tA', minute: 30 },
    ]})
    expect(resolveSelection(mkSel('first_scorer', 'first_pX', { playerId: 'pX' }), result)).toBe('won')
    expect(resolveSelection(mkSel('first_scorer', 'first_none'), result)).toBe('lost')
  })
})

// ============================================================
// SETTLE BET
// ============================================================

describe('settleBet', () => {
  function mkBet(mode: 'single' | 'multiple' | 'system', sels: Array<{ kind: any; id: string; odds: number; meta?: any }>, stake = 100, systemSize?: number): PlacedBet {
    return {
      id: 'bet1', careerId: 'c1', matchday: 1, placedAt: Date.now(),
      mode, systemSize,
      selections: sels.map((s, i) => ({
        fixtureId: `fix${i}`, marketId: `m${i}`, marketKind: s.kind,
        selectionId: s.id, selectionLabel: s.id, selectionMeta: s.meta,
        oddsAtPlacement: s.odds, isLive: false, status: 'pending',
      })),
      stake, combinedOdds: sels.reduce((p, s) => p * s.odds, 1),
      potentialWin: stake * sels.reduce((p, s) => p * s.odds, 1),
      status: 'open',
    }
  }

  it('singola vinta: payout = stake × odds', () => {
    const bet = mkBet('single', [{ kind: '1X2', id: '1', odds: 2.0, meta: { outcome: '1' } }], 100)
    const settled = settleBet({ bet, resultsByFixture: { fix0: mkResult(2, 0) } })
    expect(settled.status).toBe('won')
    expect(settled.actualPayout).toBeCloseTo(200, 2)
  })

  it('singola persa: payout = 0', () => {
    const bet = mkBet('single', [{ kind: '1X2', id: '1', odds: 2.0, meta: { outcome: '1' } }], 100)
    const settled = settleBet({ bet, resultsByFixture: { fix0: mkResult(0, 1) } })
    expect(settled.status).toBe('lost')
    expect(settled.actualPayout).toBe(0)
  })

  it('multipla tutta vinta', () => {
    const bet = mkBet('multiple', [
      { kind: '1X2', id: '1', odds: 2.0, meta: { outcome: '1' } },
      { kind: 'btts', id: 'yes', odds: 1.7 },
    ], 50)
    const settled = settleBet({ bet, resultsByFixture: {
      fix0: mkResult(2, 1),
      fix1: mkResult(2, 1),
    }})
    expect(settled.status).toBe('won')
    expect(settled.actualPayout).toBeCloseTo(50 * 2.0 * 1.7, 1)
  })

  it('multipla con 1 persa → lost, payout 0', () => {
    const bet = mkBet('multiple', [
      { kind: '1X2', id: '1', odds: 2.0, meta: { outcome: '1' } },
      { kind: 'btts', id: 'yes', odds: 1.7 },
    ], 50)
    const settled = settleBet({ bet, resultsByFixture: {
      fix0: mkResult(2, 1),
      fix1: mkResult(2, 0),  // NO BTTS
    }})
    expect(settled.status).toBe('lost')
    expect(settled.actualPayout).toBe(0)
  })

  it('sistema 2 su 3 con 3 vincite: 3 combinazioni paganti', () => {
    const bet = mkBet('system', [
      { kind: '1X2', id: '1', odds: 2.0, meta: { outcome: '1' } },
      { kind: '1X2', id: '1', odds: 2.5, meta: { outcome: '1' } },
      { kind: '1X2', id: '1', odds: 3.0, meta: { outcome: '1' } },
    ], 30, 2)
    // totalStake 30, 3 combinazioni: stake per combo ≈ 10
    const settled = settleBet({ bet, resultsByFixture: {
      fix0: mkResult(2, 0),
      fix1: mkResult(2, 0),
      fix2: mkResult(2, 0),
    }})
    expect(settled.status).toBe('won')
    // Combinazioni 2 su 3 con tutte vinte: (2.0*2.5) + (2.0*3.0) + (2.5*3.0) = 5+6+7.5 = 18.5
    // Per combo stake ≈ 10, payout totale ≈ 185
    expect(settled.actualPayout!).toBeGreaterThan(150)
  })
})
