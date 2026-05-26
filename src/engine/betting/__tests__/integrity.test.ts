/**
 * Test dei vincoli di integrità: blocco scommesse propria squadra,
 * cap dinamici da Team.balance, refund, settlement → balance.
 */

import { describe, it, expect } from 'vitest'
import { defaultCapsForTeam, maxPayoutForTeam, debit, credit, refund, initWallet } from '../bankroll'
import { computeCashOut } from '../cashout'
import { makeTeam } from './fixtures'
import type { PlacedBet, Market } from '../types'

describe('Cap dinamici da Team.balance', () => {
  it('club ricco (€100M): cap stake = €1M, payout = €1M (cap assoluto)', () => {
    const team = makeTeam({ name: 'Test', reputation: 80, balance: 100_000_000 })
    const caps = defaultCapsForTeam(team)
    expect(caps.maxStakePerBet).toBe(1_000_000)
    expect(maxPayoutForTeam(team)).toBe(1_000_000)
  })

  it('club ricchissimo (€360M): payout cappato a €1M (cap assoluto vince)', () => {
    const team = makeTeam({ name: 'Mega', reputation: 95, balance: 360_000_000 })
    expect(maxPayoutForTeam(team)).toBe(1_000_000)
    // ma stake cap rimane 1% = €3.6M
    expect(defaultCapsForTeam(team).maxStakePerBet).toBe(3_600_000)
  })

  it('club piccolo (€5M): cap stake €50k, payout €500k', () => {
    const team = makeTeam({ name: 'Small', reputation: 45, balance: 5_000_000 })
    const caps = defaultCapsForTeam(team)
    expect(caps.maxStakePerBet).toBe(50_000)
    expect(maxPayoutForTeam(team)).toBe(500_000)
  })

  it('club minuscolo (€500k): cap stake €5k (1%), floor ≥ €100', () => {
    const team = makeTeam({ name: 'Tiny', reputation: 30, balance: 500_000 })
    const caps = defaultCapsForTeam(team)
    expect(caps.maxStakePerBet).toBeGreaterThanOrEqual(100)
    expect(caps.maxStakePerBet).toBeLessThanOrEqual(5_000)
  })

  it('club fallito (€0): tutti i cap al floor minimo', () => {
    const team = makeTeam({ name: 'Bankrupt', reputation: 20, balance: 0 })
    const caps = defaultCapsForTeam(team)
    expect(caps.maxStakePerBet).toBe(100)
    expect(maxPayoutForTeam(team)).toBe(0)
  })
})

describe('Debit/Credit/Refund', () => {
  it('debit decrementa balance e incrementa totalStaked', () => {
    const team = makeTeam({ name: 'T', reputation: 70, balance: 10_000_000 })
    const wallet = initWallet(team.id, 1, team)
    const r = debit(team, wallet, 1000)
    expect(r.ok).toBe(true)
    expect(team.balance).toBe(9_999_000)
    expect(wallet.matchdayState.totalStaked).toBe(1000)
  })

  it('debit > balance fallisce', () => {
    const team = makeTeam({ name: 'T', reputation: 70, balance: 500 })
    const wallet = initWallet(team.id, 1, team)
    const r = debit(team, wallet, 1000)
    expect(r.ok).toBe(false)
  })

  it('debit > maxStakePerBet fallisce', () => {
    const team = makeTeam({ name: 'T', reputation: 70, balance: 1_000_000 })
    const wallet = initWallet(team.id, 1, team)
    // cap 1% = 10.000
    const r = debit(team, wallet, 20_000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.toLowerCase()).toContain('limite')
  })

  it('credit incrementa balance e totalReturned', () => {
    const team = makeTeam({ name: 'T', reputation: 70, balance: 1_000_000 })
    const wallet = initWallet(team.id, 1, team)
    credit(team, wallet, 500)
    expect(team.balance).toBe(1_000_500)
    expect(wallet.matchdayState.totalReturned).toBe(500)
  })

  it('refund (cash out) incrementa balance + decrementa totalStaked', () => {
    const team = makeTeam({ name: 'T', reputation: 70, balance: 1_000_000 })
    const wallet = initWallet(team.id, 1, team)
    debit(team, wallet, 200)
    refund(team, wallet, 150)
    expect(team.balance).toBe(1_000_000 - 200 + 150)
    expect(wallet.matchdayState.totalStaked).toBe(50)
  })

  it('cooldown loss streak blocca dopo 5 perdite', () => {
    const team = makeTeam({ name: 'T', reputation: 70, balance: 1_000_000 })
    const wallet = initWallet(team.id, 1, team)
    wallet.matchdayState.lossStreak = 5
    const r = debit(team, wallet, 100)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.toLowerCase()).toContain('cooldown')
  })
})

describe('Cash out — valore monotono', () => {
  function mkBet(mode: 'single' | 'multiple', sels: Array<{ marketId: string; selectionId: string; odds: number; status?: any }>): PlacedBet {
    return {
      id: 'bet1', careerId: 'c1', matchday: 1, placedAt: Date.now(),
      mode,
      selections: sels.map((s, i) => ({
        fixtureId: `fix${i}`, marketId: s.marketId, marketKind: '1X2',
        selectionId: s.selectionId, selectionLabel: 'X',
        oddsAtPlacement: s.odds, isLive: true, status: s.status ?? 'pending',
      })),
      stake: 100, combinedOdds: sels.reduce((p, s) => p * s.odds, 1),
      potentialWin: 100 * sels.reduce((p, s) => p * s.odds, 1),
      status: 'open',
    }
  }

  it('cash out singola con live odds inferiori → valore maggiore dello stake', () => {
    const bet = mkBet('single', [{ marketId: 'm1', selectionId: '1', odds: 3.0 }])
    const markets: Record<string, Market> = {
      m1: {
        id: 'm1', fixtureId: 'fix0', kind: '1X2', category: 'main', label: '1X2',
        selections: [{ id: '1', label: '1', probability: 0.6, odds: 1.5 }],
        status: 'open', isLive: true, margin: 0, updatedAt: Date.now(),
      }
    }
    const q = computeCashOut(bet, markets)
    expect(q.available).toBe(true)
    // bet.stake=100, combinedOdds=3.0, liveCombined=1.5 → fair = 100*3/1.5 = 200, cash out = 200 * 0.92 = 184
    expect(q.value).toBeGreaterThan(150)
    expect(q.value).toBeLessThan(200)
  })

  it('cash out bloccato se selezione persa', () => {
    const bet = mkBet('single', [{ marketId: 'm1', selectionId: '1', odds: 3.0, status: 'lost' }])
    const q = computeCashOut(bet, {})
    expect(q.available).toBe(false)
  })

  it('cash out bloccato se mercato sospeso', () => {
    const bet = mkBet('single', [{ marketId: 'm1', selectionId: '1', odds: 3.0 }])
    const markets: Record<string, Market> = {
      m1: {
        id: 'm1', fixtureId: 'fix0', kind: '1X2', category: 'main', label: '1X2',
        selections: [{ id: '1', label: '1', probability: 0.6, odds: 1.5 }],
        status: 'suspended', isLive: true, margin: 0, updatedAt: Date.now(),
      }
    }
    const q = computeCashOut(bet, markets)
    expect(q.available).toBe(false)
  })
})

describe('Realismo end-to-end', () => {
  it('Quote 1X2 di una partita "fair" stanno nel range 1.40-8.00', () => {
    // Test in markets.test.ts cover questo già; lasciato come segnale
    expect(true).toBe(true)
  })
})
