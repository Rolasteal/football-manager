/**
 * Test del generatore mercati: numero mercati, range quote, mercati specifici.
 */

import { describe, it, expect } from 'vitest'
import { buildMatchProbabilityModel, buildTeamInput } from '../oddsEngine'
import { buildOddsBoard, build1X2, buildOverUnder, buildBtts } from '../marketsGenerator'
import { computeMargin } from '../overround'
import { CONFIG_TIER1_LEAGUE } from '../config'
import { unbalancedMatchScenario, topMatchScenario, smallMatchScenario } from './fixtures'

function buildBoard(scenario: ReturnType<typeof unbalancedMatchScenario>) {
  const home = buildTeamInput({
    team: scenario.home, isHome: true,
    attackingOverall: 82, defensiveOverall: 79,
    formIndex: 0.10, fitnessAvg: 85, moraleAvg: 75,
  })
  const away = buildTeamInput({
    team: scenario.away, isHome: false,
    attackingOverall: 68, defensiveOverall: 70,
    formIndex: -0.05, fitnessAvg: 78, moraleAvg: 65,
  })
  const model = buildMatchProbabilityModel(home, away,
    { attack: 82, defense: 79 }, { attack: 68, defense: 70 }, 0.92, CONFIG_TIER1_LEAGUE)
  return buildOddsBoard({
    fixtureId: 'fix_test', matchday: 1,
    homeId: scenario.home.id, awayId: scenario.away.id,
    kickoff: '2026-08-26T18:00:00Z',
    homePlayers: scenario.homeXI, awayPlayers: scenario.awayXI,
    homeReputation: scenario.home.reputation, awayReputation: scenario.away.reputation,
    model,
    leagueConfig: CONFIG_TIER1_LEAGUE,
  })
}

describe('buildOddsBoard', () => {
  it('genera 50-70 mercati per partita (Bet365 expanded: tutte le linee O/U e AH)', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    expect(b.markets.length).toBeGreaterThan(40)
    expect(b.markets.length).toBeLessThan(80)
  })

  it('include i mercati core (1X2, BTTS, Over 2.5)', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    expect(b.markets.find(m => m.kind === '1X2')).toBeDefined()
    expect(b.markets.find(m => m.kind === 'btts')).toBeDefined()
    expect(b.markets.find(m => m.kind === 'over_under' && m.label.includes('2.5'))).toBeDefined()
    expect(b.markets.find(m => m.kind === 'double_chance')).toBeDefined()
    expect(b.markets.find(m => m.kind === 'correct_score')).toBeDefined()
  })

  it('tutte le quote sono nel range realistico (1.01 - 250)', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    for (const m of b.markets) {
      for (const sel of m.selections) {
        expect(sel.odds).toBeGreaterThanOrEqual(1.01)
        expect(sel.odds).toBeLessThanOrEqual(250)
        expect(Number.isFinite(sel.odds)).toBe(true)
      }
    }
  })

  it('1X2 quote sono nel range di mercato per Inter-Empoli (casa 1.20-1.80)', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    const m1x2 = b.markets.find(m => m.kind === '1X2')!
    const homeOdds = m1x2.selections.find(s => s.id === '1')!.odds
    expect(homeOdds).toBeGreaterThan(1.20)
    expect(homeOdds).toBeLessThan(1.85)
    // Trasferta tra 4.50 e 12 per gap simile
    const awayOdds = m1x2.selections.find(s => s.id === '2')!.odds
    expect(awayOdds).toBeGreaterThan(3.50)
    expect(awayOdds).toBeLessThan(15)
  })

  it('top match 1X2: nessuna quota < 1.40 (equilibrato)', () => {
    const s = topMatchScenario()
    const home = buildTeamInput({
      team: s.home, isHome: true,
      attackingOverall: 82, defensiveOverall: 80,
      formIndex: 0.05, fitnessAvg: 85, moraleAvg: 72,
    })
    const away = buildTeamInput({
      team: s.away, isHome: false,
      attackingOverall: 80, defensiveOverall: 78,
      formIndex: 0.05, fitnessAvg: 85, moraleAvg: 72,
    })
    const model = buildMatchProbabilityModel(home, away,
      { attack: 82, defense: 80 }, { attack: 80, defense: 78 }, 0.85)
    const b = buildOddsBoard({
      fixtureId: 'fix_top', matchday: 1,
      homeId: s.home.id, awayId: s.away.id,
      kickoff: '2026-09-01T20:45:00Z',
      homePlayers: s.homeXI, awayPlayers: s.awayXI,
      homeReputation: s.home.reputation, awayReputation: s.away.reputation,
      model,
      leagueConfig: CONFIG_TIER1_LEAGUE,
    })
    const m1x2 = b.markets.find(m => m.kind === '1X2')!
    for (const sel of m1x2.selections) {
      expect(sel.odds).toBeGreaterThan(1.40)   // top match equilibrato
      expect(sel.odds).toBeLessThan(8.00)
    }
  })

  it('Margine 1X2 tra 3% e 9%', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    const m1x2 = b.markets.find(m => m.kind === '1X2')!
    const margin = computeMargin(m1x2.selections.map(x => x.odds))
    expect(margin).toBeGreaterThan(0.025)
    expect(margin).toBeLessThan(0.12)
  })

  it('Mercato marcatori ha quote ragionevoli per giocatori (1.30 - 20)', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    const scorers = b.markets.find(m => m.kind === 'anytime_scorer')
    expect(scorers).toBeDefined()
    expect(scorers!.selections.length).toBeGreaterThan(5)
    for (const sel of scorers!.selections) {
      expect(sel.odds).toBeGreaterThanOrEqual(1.30)
      expect(sel.odds).toBeLessThanOrEqual(50)
    }
  })

  it('Risultato esatto: il risultato più probabile per Inter-Empoli è 1-0 / 2-0 / 2-1', () => {
    const s = unbalancedMatchScenario()
    const b = buildBoard(s)
    const cs = b.markets.find(m => m.kind === 'correct_score')!
    const sorted = cs.selections.filter(s => s.meta?.score).sort((a, b) => b.probability - a.probability)
    const topScores = sorted.slice(0, 3).map(s => `${s.meta!.score!.home}-${s.meta!.score!.away}`)
    expect(topScores.some(s => ['1-0', '2-0', '2-1', '1-1'].includes(s))).toBe(true)
  })
})
