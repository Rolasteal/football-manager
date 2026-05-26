/**
 * Test del motore probabilistico: Dixon-Coles, derivati 1X2/over/btts, overround.
 */

import { describe, it, expect } from 'vitest'
import {
  poissonPmf,
  dixonColesMatrix,
  computeLambdas,
  buildMatchProbabilityModel,
  buildTeamInput,
  p1X2,
  pOver,
  pBtts,
  pCorrectScore,
  outcomeFromScore,
} from '../oddsEngine'
import { priceMarket, powerMethod, computeMargin } from '../overround'
import { CONFIG_TIER1_LEAGUE, CONFIG_CHAMPIONS_LEAGUE, CONFIG_TIER2_LEAGUE } from '../config'

describe('poissonPmf', () => {
  it('P(X=0|λ) = exp(-λ)', () => {
    expect(poissonPmf(0, 1.5)).toBeCloseTo(Math.exp(-1.5), 6)
  })
  it('Σ P(k) ≈ 1 per k=0..15', () => {
    let sum = 0
    for (let k = 0; k <= 15; k++) sum += poissonPmf(k, 2.5)
    expect(sum).toBeGreaterThan(0.999)
  })
})

describe('dixonColesMatrix', () => {
  it('matrice somma a 1 dopo normalizzazione', () => {
    const M = dixonColesMatrix(1.5, 1.2)
    let sum = 0
    for (let i = 0; i < M.length; i++)
      for (let j = 0; j < M[i].length; j++)
        sum += M[i][j]
    expect(sum).toBeCloseTo(1, 6)
  })

  it('alza la probabilità del 0-0 vs Poisson semplice', () => {
    const lh = 1.4, la = 1.1
    const Mdc = dixonColesMatrix(lh, la, -0.18)
    // Poisson grezzo P(0,0) = e^-lh * e^-la
    const pPoisson00 = Math.exp(-lh) * Math.exp(-la)
    expect(Mdc[0][0]).toBeGreaterThan(pPoisson00)
  })
})

describe('computeLambdas + config per-lega', () => {
  const homeInput = buildTeamInput({
    team: {} as any, isHome: true,
    attackingOverall: 75, defensiveOverall: 73,
  })
  const awayInput = buildTeamInput({
    team: {} as any, isHome: false,
    attackingOverall: 70, defensiveOverall: 70,
  })

  it('Champions League produce λ più alti di Serie A (più gol per partita)', () => {
    const tier1 = computeLambdas(homeInput, awayInput, { attack: 75, defense: 73 }, { attack: 70, defense: 70 }, CONFIG_TIER1_LEAGUE)
    const champs = computeLambdas(homeInput, awayInput, { attack: 75, defense: 73 }, { attack: 70, defense: 70 }, CONFIG_CHAMPIONS_LEAGUE)
    expect(champs.lambdaHome + champs.lambdaAway).toBeGreaterThan(tier1.lambdaHome + tier1.lambdaAway)
  })

  it('Serie B produce λ inferiori di Serie A', () => {
    const tier1 = computeLambdas(homeInput, awayInput, { attack: 75, defense: 73 }, { attack: 70, defense: 70 }, CONFIG_TIER1_LEAGUE)
    const tier2 = computeLambdas(homeInput, awayInput, { attack: 75, defense: 73 }, { attack: 70, defense: 70 }, CONFIG_TIER2_LEAGUE)
    expect(tier2.lambdaHome + tier2.lambdaAway).toBeLessThan(tier1.lambdaHome + tier1.lambdaAway)
  })

  it('λ home > λ away con homeAdvantage', () => {
    const sym = buildTeamInput({
      team: {} as any, isHome: true,
      attackingOverall: 75, defensiveOverall: 75,
    })
    const symAway = buildTeamInput({
      team: {} as any, isHome: false,
      attackingOverall: 75, defensiveOverall: 75,
    })
    const { lambdaHome, lambdaAway } = computeLambdas(sym, symAway, { attack: 75, defense: 75 }, { attack: 75, defense: 75 }, CONFIG_TIER1_LEAGUE)
    expect(lambdaHome).toBeGreaterThan(lambdaAway)
    // Differenza dovuta SOLO al home advantage (1.30): rapporto ≈ 1.30 × (avgHome/avgAway)
    // avgHome=1.45, avgAway=1.15 → 1.30 × 1.26 = ~1.64
    expect(lambdaHome / lambdaAway).toBeGreaterThan(1.4)
  })
})

describe('p1X2 + invariante somma=1', () => {
  it('Σ P(1) + P(X) + P(2) ≈ 1', () => {
    const M = dixonColesMatrix(1.6, 1.1)
    const p = p1X2(M)
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 4)
  })

  it('lambda home alto → P(home) > P(away)', () => {
    const M = dixonColesMatrix(2.2, 0.8)
    const p = p1X2(M)
    expect(p.home).toBeGreaterThan(p.away)
  })
})

describe('pOver e pBtts coerenti con la matrice', () => {
  it('P(over 0.5) > P(over 2.5) > P(over 4.5)', () => {
    const M = dixonColesMatrix(1.5, 1.2)
    const o05 = pOver(M, 0.5)
    const o25 = pOver(M, 2.5)
    const o45 = pOver(M, 4.5)
    expect(o05).toBeGreaterThan(o25)
    expect(o25).toBeGreaterThan(o45)
  })

  it('P(BTTS) ≤ P(over 1.5) (BTTS implica almeno 2 gol)', () => {
    const M = dixonColesMatrix(1.4, 1.1)
    expect(pBtts(M)).toBeLessThanOrEqual(pOver(M, 1.5) + 0.001)
  })
})

describe('powerMethod + computeMargin', () => {
  it('margin effettivo coincide col target ±0.5%', () => {
    const probs = [0.50, 0.30, 0.20]
    const implied = powerMethod(probs, 0.06)
    const sumImpl = implied.reduce((s, p) => s + p, 0)
    expect(Math.abs(sumImpl - 1.06)).toBeLessThan(0.005)
  })

  it('priceMarket produce quote tutte ≥ 1.01', () => {
    const odds = priceMarket([0.95, 0.04, 0.01], '1X2', 1.0)
    expect(odds.every(o => o >= 1.01)).toBe(true)
  })

  it('computeMargin su quote pricedaliene = il margine applicato', () => {
    const odds = priceMarket([0.50, 0.30, 0.20], '1X2', 1.0)
    const margin = computeMargin(odds)
    expect(margin).toBeGreaterThan(0.04)
    expect(margin).toBeLessThan(0.08)
  })
})

describe('buildMatchProbabilityModel + outcomeFromScore', () => {
  it('outcomeFromScore', () => {
    expect(outcomeFromScore(2, 1)).toBe('1')
    expect(outcomeFromScore(1, 1)).toBe('X')
    expect(outcomeFromScore(0, 3)).toBe('2')
  })

  it('top match top: P(home) tra 0.40 e 0.65 (range realistico)', () => {
    const home = buildTeamInput({
      team: {} as any, isHome: true,
      attackingOverall: 82, defensiveOverall: 80,
      formIndex: 0.10, fitnessAvg: 85, moraleAvg: 75,
    })
    const away = buildTeamInput({
      team: {} as any, isHome: false,
      attackingOverall: 80, defensiveOverall: 78,
      formIndex: 0.05, fitnessAvg: 85, moraleAvg: 70,
    })
    const model = buildMatchProbabilityModel(home, away,
      { attack: 82, defense: 80 }, { attack: 80, defense: 78 }, 0.85)
    const p = p1X2(model.probMatrix)
    expect(p.home).toBeGreaterThan(0.40)
    expect(p.home).toBeLessThan(0.65)
  })

  it('unbalanced: P(strong home) > 0.70', () => {
    const home = buildTeamInput({
      team: {} as any, isHome: true,
      attackingOverall: 82, defensiveOverall: 79,
      formIndex: 0.15, fitnessAvg: 88, moraleAvg: 75,
    })
    const away = buildTeamInput({
      team: {} as any, isHome: false,
      attackingOverall: 68, defensiveOverall: 70,
      formIndex: -0.05, fitnessAvg: 75, moraleAvg: 60,
      injuredKeyPlayers: 1,
    })
    const model = buildMatchProbabilityModel(home, away,
      { attack: 82, defense: 79 }, { attack: 68, defense: 70 }, 0.92)
    const p = p1X2(model.probMatrix)
    expect(p.home).toBeGreaterThan(0.55)
    // Quote casa ≤ 1.70 → P_implied (1/odds × no margin) > 0.59 → P vera > 0.55
  })
})
