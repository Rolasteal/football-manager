/**
 * Genera tutti i mercati Bet365-tier per una fixture, dato il MatchProbabilityModel.
 * Vedi BETTING_SPEC.md sez. 4 e 12.1.
 */

import type { Player } from '$engine/types'
import type {
  Market,
  Selection,
  MarketKind,
  MatchProbabilityModel,
  MatchOddsBoard,
} from './types'
import {
  p1X2,
  pOver,
  pUnder,
  pBtts,
  pCorrectScore,
  pTeamOver,
  pGoalsBand,
  pEuropeanHandicap,
  pAsianHandicap,
  computeScorerProbabilities,
  poissonCdf,
  outcomeFromScore,
  type ScorerInput,
} from './oddsEngine'
import { priceMarket, topMatchFactorFromReputation } from './overround'

// ============================================================
// HELPERS
// ============================================================

function buildMarket(
  fixtureId: string,
  kind: MarketKind,
  category: Market['category'],
  label: string,
  selections: Selection[],
  topMatchFactor: number,
  marginJitter: number = 0,
  isLive: boolean = false,
  leagueMarginFactor: number = 1.0,
): Market {
  const trueProbs = selections.map(s => s.probability)
  const odds = priceMarket(trueProbs, kind, topMatchFactor, marginJitter, leagueMarginFactor)
  const priced = selections.map((s, i) => ({ ...s, odds: odds[i] }))
  const margin = priced.reduce((acc, s) => acc + 1 / s.odds, 0) - 1
  return {
    id: `${fixtureId}:${kind}:${selections.map(s => s.id).join('|').slice(0, 32)}`,
    fixtureId,
    kind,
    category,
    label,
    selections: priced,
    status: 'open',
    isLive,
    margin: Math.max(0, margin),
    updatedAt: Date.now(),
  }
}

// ============================================================
// MERCATI MAIN
// ============================================================

export function build1X2(fixtureId: string, M: number[][], tmf: number): Market {
  const { home, draw, away } = p1X2(M)
  const selections: Selection[] = [
    { id: '1', label: '1', probability: home, odds: 0, meta: { outcome: '1' } },
    { id: 'X', label: 'X', probability: draw, odds: 0, meta: { outcome: 'X' } },
    { id: '2', label: '2', probability: away, odds: 0, meta: { outcome: '2' } },
  ]
  return buildMarket(fixtureId, '1X2', 'main', 'Esito finale (1X2)', selections, tmf)
}

export function buildDoubleChance(fixtureId: string, M: number[][], tmf: number): Market {
  const { home, draw, away } = p1X2(M)
  const selections: Selection[] = [
    { id: '1X', label: '1X', probability: home + draw, odds: 0 },
    { id: '12', label: '12', probability: home + away, odds: 0 },
    { id: 'X2', label: 'X2', probability: draw + away, odds: 0 },
  ]
  return buildMarket(fixtureId, 'double_chance', 'main', 'Doppia chance', selections, tmf)
}

export function buildDrawNoBet(fixtureId: string, M: number[][], tmf: number): Market {
  const { home, draw, away } = p1X2(M)
  const denom = Math.max(1e-6, 1 - draw)
  const selections: Selection[] = [
    { id: 'home', label: 'Casa', probability: home / denom, odds: 0, meta: { outcome: '1' } },
    { id: 'away', label: 'Trasferta', probability: away / denom, odds: 0, meta: { outcome: '2' } },
  ]
  return buildMarket(fixtureId, 'draw_no_bet', 'main', 'Pareggio rimborsa', selections, tmf)
}

export function buildOverUnder(fixtureId: string, M: number[][], tmf: number, line: number): Market {
  const over = pOver(M, line)
  const under = pUnder(M, line)
  const selections: Selection[] = [
    { id: `over_${line}`, label: `Over ${line}`, probability: over, odds: 0, meta: { line } },
    { id: `under_${line}`, label: `Under ${line}`, probability: under, odds: 0, meta: { line } },
  ]
  return buildMarket(fixtureId, 'over_under', 'goals', `Over/Under ${line}`, selections, tmf)
}

export function buildBtts(fixtureId: string, M: number[][], tmf: number): Market {
  const yes = pBtts(M)
  const selections: Selection[] = [
    { id: 'yes', label: 'Goal', probability: yes, odds: 0 },
    { id: 'no', label: 'No Goal', probability: 1 - yes, odds: 0 },
  ]
  return buildMarket(fixtureId, 'btts', 'goals', 'Goal/No Goal', selections, tmf)
}

export function buildTeamOverUnder(
  fixtureId: string, M: number[][], tmf: number,
  side: 'home' | 'away', line: number,
): Market {
  const over = pTeamOver(M, side, line)
  const label = side === 'home' ? 'Casa' : 'Trasferta'
  const selections: Selection[] = [
    { id: `${side}_over_${line}`, label: `${label} Over ${line}`, probability: over, odds: 0, meta: { side, line } },
    { id: `${side}_under_${line}`, label: `${label} Under ${line}`, probability: 1 - over, odds: 0, meta: { side, line } },
  ]
  return buildMarket(fixtureId, 'team_over_under', 'goals', `${label} Over/Under ${line}`, selections, tmf)
}

export function buildTotalGoalsBands(fixtureId: string, M: number[][], tmf: number): Market {
  const selections: Selection[] = [
    { id: '0-1', label: '0-1 gol', probability: pGoalsBand(M, 0, 1), odds: 0 },
    { id: '2-3', label: '2-3 gol', probability: pGoalsBand(M, 2, 3), odds: 0 },
    { id: '4-6', label: '4-6 gol', probability: pGoalsBand(M, 4, 6), odds: 0 },
    { id: '7+', label: '7+ gol', probability: pGoalsBand(M, 7, 99), odds: 0 },
  ]
  return buildMarket(fixtureId, 'total_goals_bands', 'goals', 'Fasce gol totali', selections, tmf)
}

// ============================================================
// HANDICAP
// ============================================================

export function buildEuropeanHandicap(fixtureId: string, M: number[][], tmf: number, lineForHome: number): Market {
  const { home, draw, away } = pEuropeanHandicap(M, lineForHome)
  const sign = lineForHome >= 0 ? `+${lineForHome}` : `${lineForHome}`
  const selections: Selection[] = [
    { id: `home_${sign}`, label: `Casa (${sign})`, probability: home, odds: 0, meta: { outcome: '1', line: lineForHome } },
    { id: `draw_${sign}`, label: `Pareggio (${sign})`, probability: draw, odds: 0, meta: { outcome: 'X', line: lineForHome } },
    { id: `away_${sign}`, label: `Trasferta (${sign})`, probability: away, odds: 0, meta: { outcome: '2', line: lineForHome } },
  ]
  return buildMarket(fixtureId, 'european_handicap', 'handicap', `Handicap europeo ${sign}`, selections, tmf)
}

export function buildAsianHandicap(fixtureId: string, M: number[][], tmf: number, lineForHome: number): Market {
  // Per .5 lines: no push. Per .0 lines: c'è push → quota su (winProb / (winProb + lossProb))
  const { homeWin, push, awayWin } = pAsianHandicap(M, lineForHome)
  let pHome: number, pAway: number
  if (push > 0) {
    // push: stake refund. Probabilità "efficace" = winProb + push * 0.5 (perché push = pareggio scommessa)
    // Per il pricing trattiamo push come void. Usiamo prob = winProb / (winProb + lossProb) cioè rinormalizzata escludendo il push.
    const denom = Math.max(1e-6, homeWin + awayWin)
    pHome = homeWin / denom
    pAway = awayWin / denom
  } else {
    pHome = homeWin
    pAway = awayWin
  }
  const sign = lineForHome >= 0 ? `+${lineForHome}` : `${lineForHome}`
  const signOpp = -lineForHome >= 0 ? `+${-lineForHome}` : `${-lineForHome}`
  const selections: Selection[] = [
    { id: `home_${sign}`, label: `Casa (${sign})`, probability: pHome, odds: 0, meta: { side: 'home', line: lineForHome } },
    { id: `away_${signOpp}`, label: `Trasferta (${signOpp})`, probability: pAway, odds: 0, meta: { side: 'away', line: -lineForHome } },
  ]
  return buildMarket(fixtureId, 'asian_handicap', 'handicap', `Handicap asiatico ${sign}`, selections, tmf)
}

// ============================================================
// MARCATORI
// ============================================================

export function buildScorerMarkets(
  fixtureId: string,
  homePlayers: Player[],
  awayPlayers: Player[],
  model: MatchProbabilityModel,
  tmf: number,
): Market[] {
  const inputs: ScorerInput[] = [
    ...homePlayers.map(p => ({ player: p, isHome: true })),
    ...awayPlayers.map(p => ({ player: p, isHome: false })),
  ]
  const probs = computeScorerProbabilities(inputs, model.lambdaHome, model.lambdaAway, model.probMatrix)

  // Filtra: solo giocatori con pAnytime > 4% (quote massime ~30-40, in linea con Bet365).
  // Sotto questa soglia un giocatore "marcatore" non ha mercato sportsbook reale.
  const eligible = probs.filter(p => p.pAnytime > 0.04)

  // Mappa playerId → player (per label)
  const playerMap = new Map<string, Player>()
  for (const p of [...homePlayers, ...awayPlayers]) playerMap.set(p.id, p)
  const labelOf = (id: string) => {
    const p = playerMap.get(id)
    return p ? `${p.lastName}${p.shirtNumber ? ' #' + p.shirtNumber : ''}` : id
  }

  // Anytime
  const anytimeSelections: Selection[] = eligible.map(p => ({
    id: p.playerId,
    label: labelOf(p.playerId),
    probability: p.pAnytime,
    odds: 0,
    meta: { playerId: p.playerId },
  }))
  const anytimeMarket = buildMarket(fixtureId, 'anytime_scorer', 'scorers', 'Marcatore (qualsiasi momento)', anytimeSelections, tmf)
  // Post-filter: i bookmaker reali non offrono marcatori a quote >50 (improbabili e poco interessanti)
  anytimeMarket.selections = anytimeMarket.selections.filter(s => s.odds <= 50)

  // First scorer (include "no goalscorer")
  const pNoGoal = model.probMatrix[0][0]
  const firstSelections: Selection[] = [
    ...eligible.map(p => ({
      id: `first_${p.playerId}`,
      label: labelOf(p.playerId),
      probability: p.pFirst,
      odds: 0,
      meta: { playerId: p.playerId } as const,
    })),
    { id: 'first_none', label: 'Nessun marcatore', probability: pNoGoal, odds: 0 },
  ]
  const firstMarket = buildMarket(fixtureId, 'first_scorer', 'scorers', 'Primo marcatore', firstSelections, tmf)

  // Last scorer (approssimazione = first)
  const lastSelections: Selection[] = [
    ...eligible.map(p => ({
      id: `last_${p.playerId}`,
      label: labelOf(p.playerId),
      probability: p.pLast,
      odds: 0,
      meta: { playerId: p.playerId } as const,
    })),
    { id: 'last_none', label: 'Nessun marcatore', probability: pNoGoal, odds: 0 },
  ]
  const lastMarket = buildMarket(fixtureId, 'last_scorer', 'scorers', 'Ultimo marcatore', lastSelections, tmf)

  // 2+ scorer
  const twoPlusSelections: Selection[] = eligible
    .filter(p => p.p2plus > 0.005)
    .map(p => ({
      id: p.playerId,
      label: labelOf(p.playerId),
      probability: p.p2plus,
      odds: 0,
      meta: { playerId: p.playerId },
    }))
  const twoPlusMarket = buildMarket(fixtureId, 'scorer_2plus', 'scorers', 'Marcatore 2+ gol', twoPlusSelections, tmf)
  // Limite quote alto per 2+ (più rare di anytime)
  twoPlusMarket.selections = twoPlusMarket.selections.filter(s => s.odds <= 100)

  // Hat-trick
  const hattrickSelections: Selection[] = eligible
    .filter(p => p.pHattrick > 0.001)
    .map(p => ({
      id: p.playerId,
      label: labelOf(p.playerId),
      probability: p.pHattrick,
      odds: 0,
      meta: { playerId: p.playerId },
    }))
  const hattrickMarket = hattrickSelections.length > 0
    ? buildMarket(fixtureId, 'scorer_hattrick', 'scorers', 'Tripletta', hattrickSelections, tmf)
    : null

  return [anytimeMarket, firstMarket, lastMarket, twoPlusMarket, ...(hattrickMarket ? [hattrickMarket] : [])]
}

// ============================================================
// RISULTATO ESATTO
// ============================================================

export function buildCorrectScore(fixtureId: string, M: number[][], tmf: number, kind: MarketKind = 'correct_score'): Market {
  const main: Selection[] = []
  // 0-0...4-4
  for (let h = 0; h <= 4; h++) {
    for (let a = 0; a <= 4; a++) {
      main.push({
        id: `${h}-${a}`,
        label: `${h}-${a}`,
        probability: pCorrectScore(M, h, a),
        odds: 0,
        meta: { score: { home: h, away: a } },
      })
    }
  }
  // Altri raggruppati
  let pHomeOther = 0, pAwayOther = 0, pDrawOther = 0
  for (let h = 0; h < M.length; h++) {
    for (let a = 0; a < M[h].length; a++) {
      if (h <= 4 && a <= 4) continue
      if (h > a) pHomeOther += M[h][a]
      else if (h < a) pAwayOther += M[h][a]
      else pDrawOther += M[h][a]
    }
  }
  main.push({ id: 'other_home', label: 'Altro Casa', probability: pHomeOther, odds: 0, meta: { outcome: '1' } })
  main.push({ id: 'other_draw', label: 'Altro Pareggio', probability: pDrawOther, odds: 0, meta: { outcome: 'X' } })
  main.push({ id: 'other_away', label: 'Altro Trasferta', probability: pAwayOther, odds: 0, meta: { outcome: '2' } })

  return buildMarket(fixtureId, kind, 'exact',
    kind === 'correct_score' ? 'Risultato esatto' : 'Risultato esatto 1° tempo',
    main, tmf)
}

// ============================================================
// HALFTIME
// ============================================================

export function buildHalftime1X2(fixtureId: string, MHT: number[][], tmf: number): Market {
  const { home, draw, away } = p1X2(MHT)
  const selections: Selection[] = [
    { id: '1', label: '1', probability: home, odds: 0, meta: { outcome: '1' } },
    { id: 'X', label: 'X', probability: draw, odds: 0, meta: { outcome: 'X' } },
    { id: '2', label: '2', probability: away, odds: 0, meta: { outcome: '2' } },
  ]
  return buildMarket(fixtureId, 'halftime_1X2', 'halves', '1° tempo - Esito', selections, tmf)
}

export function buildHalftimeOverUnder(fixtureId: string, MHT: number[][], tmf: number, line: number): Market {
  const over = pOver(MHT, line)
  const selections: Selection[] = [
    { id: `over_${line}`, label: `Over ${line}`, probability: over, odds: 0, meta: { line } },
    { id: `under_${line}`, label: `Under ${line}`, probability: 1 - over, odds: 0, meta: { line } },
  ]
  return buildMarket(fixtureId, 'halftime_over_under', 'halves', `1° tempo Over/Under ${line}`, selections, tmf)
}

export function buildHalftimeBtts(fixtureId: string, MHT: number[][], tmf: number): Market {
  const yes = pBtts(MHT)
  const selections: Selection[] = [
    { id: 'yes', label: 'Goal', probability: yes, odds: 0 },
    { id: 'no', label: 'No Goal', probability: 1 - yes, odds: 0 },
  ]
  return buildMarket(fixtureId, 'halftime_btts', 'halves', '1° tempo Goal/No Goal', selections, tmf)
}

export function buildHalftimeFulltime(fixtureId: string, model: MatchProbabilityModel, tmf: number): Market {
  // P(HT outcome × FT outcome) via product approx con lambda 2° tempo
  const lambdaH2 = model.lambdaHome * (1 - 0.42)
  const lambdaA2 = model.lambdaAway * (1 - 0.42)
  // 9 combinazioni
  const labels: Array<[string, string, string]> = [
    ['1-1', '1°T Casa / Casa', '11'],
    ['1-X', '1°T Casa / Pareggio', '1X'],
    ['1-2', '1°T Casa / Trasferta', '12'],
    ['X-1', '1°T Pari / Casa', 'X1'],
    ['X-X', '1°T Pari / Pari', 'XX'],
    ['X-2', '1°T Pari / Trasferta', 'X2'],
    ['2-1', '1°T Trasf / Casa', '21'],
    ['2-X', '1°T Trasf / Pari', '2X'],
    ['2-2', '1°T Trasf / Trasf', '22'],
  ]

  const selections: Selection[] = labels.map(([id, label, code]) => {
    const ht = code[0] as 'X' | '1' | '2'
    const ft = code[1] as 'X' | '1' | '2'
    let p = 0
    // sum over (h1, a1, h2, a2) tale che h1+h2 vs a1+a2 dà ft, h1 vs a1 dà ht
    for (let h1 = 0; h1 < 6; h1++) {
      for (let a1 = 0; a1 < 6; a1++) {
        const htOut = outcomeFromScore(h1, a1)
        if (htOut !== ht) continue
        const pHT = model.probMatrixHT[h1] && model.probMatrixHT[h1][a1] !== undefined ? model.probMatrixHT[h1][a1] : 0
        for (let h2 = 0; h2 < 6; h2++) {
          for (let a2 = 0; a2 < 6; a2++) {
            const ftOut = outcomeFromScore(h1 + h2, a1 + a2)
            if (ftOut !== ft) continue
            const pH2 = poissonPmfLocal(h2, lambdaH2)
            const pA2 = poissonPmfLocal(a2, lambdaA2)
            p += pHT * pH2 * pA2
          }
        }
      }
    }
    return {
      id,
      label,
      probability: p,
      odds: 0,
      meta: { htOutcome: ht, ftOutcome: ft },
    }
  })

  return buildMarket(fixtureId, 'halftime_fulltime', 'halves', 'Primo / Finale', selections, tmf)
}

function poissonPmfLocal(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 2; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

export function buildHalfWithMostGoals(fixtureId: string, model: MatchProbabilityModel, tmf: number): Market {
  // P(more goals in H1) vs P(more in H2) vs P(equal)
  const lambdaH1 = model.lambdaHomeHT + model.lambdaAwayHT
  const lambdaH2 = (model.lambdaHome + model.lambdaAway) * (1 - 0.42)
  // P(N_H1 > N_H2): approx via somma su 0..8
  let pH1 = 0, pH2 = 0, pEq = 0
  for (let n1 = 0; n1 <= 10; n1++) {
    const p1 = poissonPmfLocal(n1, lambdaH1)
    for (let n2 = 0; n2 <= 10; n2++) {
      const p2 = poissonPmfLocal(n2, lambdaH2)
      const j = p1 * p2
      if (n1 > n2) pH1 += j
      else if (n1 < n2) pH2 += j
      else pEq += j
    }
  }
  const selections: Selection[] = [
    { id: 'h1', label: '1° tempo', probability: pH1, odds: 0 },
    { id: 'h2', label: '2° tempo', probability: pH2, odds: 0 },
    { id: 'equal', label: 'Pari', probability: pEq, odds: 0 },
  ]
  return buildMarket(fixtureId, 'half_with_most_goals', 'halves', 'Tempo con più gol', selections, tmf)
}

// ============================================================
// COMBO
// ============================================================

export function build1X2AndBtts(fixtureId: string, M: number[][], tmf: number): Market {
  // P(home & btts), etc.
  let pH_BTTS = 0, pX_BTTS = 0, pA_BTTS = 0
  let pH_NO = 0, pX_NO = 0, pA_NO = 0
  for (let h = 0; h < M.length; h++) {
    for (let a = 0; a < M[h].length; a++) {
      const btts = h > 0 && a > 0
      const cell = M[h][a]
      if (h > a) btts ? (pH_BTTS += cell) : (pH_NO += cell)
      else if (h === a) btts ? (pX_BTTS += cell) : (pX_NO += cell)
      else btts ? (pA_BTTS += cell) : (pA_NO += cell)
    }
  }
  const selections: Selection[] = [
    { id: '1_yes', label: '1 & Goal', probability: pH_BTTS, odds: 0 },
    { id: '1_no', label: '1 & No Goal', probability: pH_NO, odds: 0 },
    { id: 'X_yes', label: 'X & Goal', probability: pX_BTTS, odds: 0 },
    { id: 'X_no', label: 'X & No Goal', probability: pX_NO, odds: 0 },
    { id: '2_yes', label: '2 & Goal', probability: pA_BTTS, odds: 0 },
    { id: '2_no', label: '2 & No Goal', probability: pA_NO, odds: 0 },
  ]
  return buildMarket(fixtureId, '1X2_and_btts', 'combo', '1X2 + Goal/No Goal', selections, tmf)
}

export function build1X2AndOverUnder(fixtureId: string, M: number[][], tmf: number, line: number = 2.5): Market {
  let pH_O = 0, pX_O = 0, pA_O = 0, pH_U = 0, pX_U = 0, pA_U = 0
  for (let h = 0; h < M.length; h++) {
    for (let a = 0; a < M[h].length; a++) {
      const tot = h + a
      const isOver = tot > line
      const cell = M[h][a]
      if (h > a) isOver ? (pH_O += cell) : (pH_U += cell)
      else if (h === a) isOver ? (pX_O += cell) : (pX_U += cell)
      else isOver ? (pA_O += cell) : (pA_U += cell)
    }
  }
  const selections: Selection[] = [
    { id: `1_over_${line}`, label: `1 & Over ${line}`, probability: pH_O, odds: 0, meta: { line } },
    { id: `1_under_${line}`, label: `1 & Under ${line}`, probability: pH_U, odds: 0, meta: { line } },
    { id: `X_over_${line}`, label: `X & Over ${line}`, probability: pX_O, odds: 0, meta: { line } },
    { id: `X_under_${line}`, label: `X & Under ${line}`, probability: pX_U, odds: 0, meta: { line } },
    { id: `2_over_${line}`, label: `2 & Over ${line}`, probability: pA_O, odds: 0, meta: { line } },
    { id: `2_under_${line}`, label: `2 & Under ${line}`, probability: pA_U, odds: 0, meta: { line } },
  ]
  return buildMarket(fixtureId, '1X2_and_over_under', 'combo', `1X2 + Over/Under ${line}`, selections, tmf)
}

export function buildBttsAndOverUnder(fixtureId: string, M: number[][], tmf: number, line: number = 2.5): Market {
  let pBTTS_O = 0, pBTTS_U = 0, pNO_O = 0, pNO_U = 0
  for (let h = 0; h < M.length; h++) {
    for (let a = 0; a < M[h].length; a++) {
      const tot = h + a
      const btts = h > 0 && a > 0
      const isOver = tot > line
      const cell = M[h][a]
      if (btts && isOver) pBTTS_O += cell
      else if (btts && !isOver) pBTTS_U += cell
      else if (!btts && isOver) pNO_O += cell
      else pNO_U += cell
    }
  }
  const selections: Selection[] = [
    { id: `yes_over_${line}`, label: `Goal & Over ${line}`, probability: pBTTS_O, odds: 0, meta: { line } },
    { id: `yes_under_${line}`, label: `Goal & Under ${line}`, probability: pBTTS_U, odds: 0, meta: { line } },
    { id: `no_over_${line}`, label: `No Goal & Over ${line}`, probability: pNO_O, odds: 0, meta: { line } },
    { id: `no_under_${line}`, label: `No Goal & Under ${line}`, probability: pNO_U, odds: 0, meta: { line } },
  ]
  return buildMarket(fixtureId, 'btts_and_over_under', 'combo', `Goal/No Goal + Over/Under ${line}`, selections, tmf)
}

// ============================================================
// SPECIALS
// ============================================================

export function buildCardsOverUnder(fixtureId: string, lambdaCards: number, tmf: number, line: number): Market {
  const cdf = poissonCdf(Math.floor(line), lambdaCards)
  const over = 1 - cdf
  const selections: Selection[] = [
    { id: `over_${line}`, label: `Over ${line}`, probability: over, odds: 0, meta: { line } },
    { id: `under_${line}`, label: `Under ${line}`, probability: 1 - over, odds: 0, meta: { line } },
  ]
  return buildMarket(fixtureId, 'total_cards_over_under', 'specials', `Cartellini Over/Under ${line}`, selections, tmf)
}

export function buildCornersOverUnder(fixtureId: string, lambdaCorners: number, tmf: number, line: number): Market {
  const cdf = poissonCdf(Math.floor(line), lambdaCorners)
  const over = 1 - cdf
  const selections: Selection[] = [
    { id: `over_${line}`, label: `Over ${line}`, probability: over, odds: 0, meta: { line } },
    { id: `under_${line}`, label: `Under ${line}`, probability: 1 - over, odds: 0, meta: { line } },
  ]
  return buildMarket(fixtureId, 'total_corners_over_under', 'specials', `Corner Over/Under ${line}`, selections, tmf)
}

export function buildFirstGoalTeam(fixtureId: string, M: number[][], tmf: number): Market {
  // P(home segna prima) ≈ λ_h / (λ_h + λ_a) × P(at least 1 goal)
  // Approssimazione corretta: somma celle dove team segna prima.
  // Per semplicità: sotto Poisson indipendenti, P(home segna prima | almeno 1 gol) = λ_h/(λ_h+λ_a)
  const pNoGoal = M[0][0]
  const pGoal = 1 - pNoGoal
  // Stima λ da matrice
  let sumH = 0, sumA = 0, total = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      sumH += i * M[i][j]
      sumA += j * M[i][j]
      total += M[i][j]
    }
  }
  const lh = sumH / total
  const la = sumA / total
  const ratio = lh + la > 0 ? lh / (lh + la) : 0.5
  const pHomeFirst = pGoal * ratio
  const pAwayFirst = pGoal * (1 - ratio)
  const selections: Selection[] = [
    { id: 'home', label: 'Casa', probability: pHomeFirst, odds: 0, meta: { side: 'home' } },
    { id: 'away', label: 'Trasferta', probability: pAwayFirst, odds: 0, meta: { side: 'away' } },
    { id: 'none', label: 'Nessun gol', probability: pNoGoal, odds: 0 },
  ]
  return buildMarket(fixtureId, 'first_goal_team', 'specials', 'Quale squadra segna prima', selections, tmf)
}

export function buildRedCardMatch(fixtureId: string, lambdaRed: number, tmf: number): Market {
  const pNoRed = Math.exp(-lambdaRed)
  const selections: Selection[] = [
    { id: 'yes', label: 'Sì espulsione', probability: 1 - pNoRed, odds: 0 },
    { id: 'no', label: 'No espulsione', probability: pNoRed, odds: 0 },
  ]
  return buildMarket(fixtureId, 'red_card_match', 'specials', 'Espulsione nella partita', selections, tmf)
}

export function buildPenaltyAwarded(fixtureId: string, lambdaPen: number, tmf: number): Market {
  const pNoPen = Math.exp(-lambdaPen)
  const selections: Selection[] = [
    { id: 'yes', label: 'Sì rigore', probability: 1 - pNoPen, odds: 0 },
    { id: 'no', label: 'No rigore', probability: pNoPen, odds: 0 },
  ]
  return buildMarket(fixtureId, 'penalty_awarded', 'specials', 'Rigore assegnato', selections, tmf)
}

// ============================================================
// ENTRY POINT: BOARD COMPLETA
// ============================================================

export interface BoardBuildInput {
  fixtureId: string
  matchday: number
  homeId: string
  awayId: string
  kickoff: string
  homePlayers: Player[]      // titolari (11)
  awayPlayers: Player[]
  homeReputation: number
  awayReputation: number
  model: MatchProbabilityModel
  /** Config della lega di questa fixture (modula avg goals, home advantage, margine bookmaker). */
  leagueConfig?: import('./types').LeagueBettingConfig
}

export function buildOddsBoard(inp: BoardBuildInput): MatchOddsBoard {
  const { fixtureId, model } = inp
  const cfg = inp.leagueConfig
  const refRep = cfg?.refReputation ?? 70
  const marginFactor = cfg?.marginFactor ?? 1.0
  const tmf = topMatchFactorFromReputation(inp.homeReputation, inp.awayReputation, refRep) * marginFactor
  const M = model.probMatrix
  const MHT = model.probMatrixHT

  const markets: Market[] = []

  // Main
  markets.push(build1X2(fixtureId, M, tmf))
  markets.push(buildDoubleChance(fixtureId, M, tmf))
  markets.push(buildDrawNoBet(fixtureId, M, tmf))

  // Goals
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
    markets.push(buildOverUnder(fixtureId, M, tmf, line))
  }
  markets.push(buildBtts(fixtureId, M, tmf))
  for (const side of ['home', 'away'] as const) {
    for (const line of [0.5, 1.5, 2.5]) {
      markets.push(buildTeamOverUnder(fixtureId, M, tmf, side, line))
    }
  }
  markets.push(buildTotalGoalsBands(fixtureId, M, tmf))

  // Handicap
  for (const line of [-2, -1, 1, 2]) {
    markets.push(buildEuropeanHandicap(fixtureId, M, tmf, line))
  }
  for (const line of [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5]) {
    markets.push(buildAsianHandicap(fixtureId, M, tmf, line))
  }

  // Scorers
  markets.push(...buildScorerMarkets(fixtureId, inp.homePlayers, inp.awayPlayers, model, tmf))

  // Exact
  markets.push(buildCorrectScore(fixtureId, M, tmf, 'correct_score'))
  markets.push(buildCorrectScore(fixtureId, MHT, tmf, 'halftime_correct_score'))

  // Halves
  markets.push(buildHalftime1X2(fixtureId, MHT, tmf))
  markets.push(buildHalftimeOverUnder(fixtureId, MHT, tmf, 0.5))
  markets.push(buildHalftimeOverUnder(fixtureId, MHT, tmf, 1.5))
  markets.push(buildHalftimeBtts(fixtureId, MHT, tmf))
  markets.push(buildHalftimeFulltime(fixtureId, model, tmf))
  markets.push(buildHalfWithMostGoals(fixtureId, model, tmf))

  // Combo
  markets.push(build1X2AndBtts(fixtureId, M, tmf))
  markets.push(build1X2AndOverUnder(fixtureId, M, tmf, 2.5))
  markets.push(buildBttsAndOverUnder(fixtureId, M, tmf, 2.5))

  // Specials
  for (const line of [3.5, 4.5, 5.5]) {
    markets.push(buildCardsOverUnder(fixtureId, model.lambdaCards, tmf, line))
  }
  for (const line of [8.5, 9.5, 10.5]) {
    markets.push(buildCornersOverUnder(fixtureId, model.lambdaCorners, tmf, line))
  }
  markets.push(buildFirstGoalTeam(fixtureId, M, tmf))
  markets.push(buildRedCardMatch(fixtureId, model.lambdaRedCards, tmf))
  markets.push(buildPenaltyAwarded(fixtureId, model.lambdaPenalties, tmf))

  return {
    fixtureId,
    matchday: inp.matchday,
    homeId: inp.homeId,
    awayId: inp.awayId,
    kickoff: inp.kickoff,
    markets,
    generatedAt: Date.now(),
    state: 'pre_match',
  }
}
