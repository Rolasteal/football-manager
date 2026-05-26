/**
 * Motore probabilistico: Dixon-Coles bivariata su 8x8 + derivati per ogni mercato gol-based.
 * Vedi BETTING_SPEC.md sez. 3.
 */

import type { Player, Team } from '$engine/types'
import type { Fixture } from '$engine/competition/types'
import type {
  MatchProbabilityModel,
  TeamStrengthInput,
  Outcome1X2,
  LeagueBettingConfig,
} from './types'
import { CONFIG_TIER1_LEAGUE } from './config'

// ============================================================
// COSTANTI MODELLO
// ============================================================

export const LEAGUE_AVG_GOALS_HOME = 1.45
export const LEAGUE_AVG_GOALS_AWAY = 1.15
export const DIXON_COLES_RHO = -0.18
export const HT_GOAL_SHARE = 0.42
export const MATRIX_SIZE = 8

// Reference attack/defense overall: ricalcolare a inizio stagione su tutta la lega
export const REF_ATTACK_OVERALL = 70
export const REF_DEFENSE_OVERALL = 70

// ============================================================
// POISSON HELPERS
// ============================================================

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  // log-space per stabilità su lambda alti
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 2; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

export function poissonCdf(kMax: number, lambda: number): number {
  let s = 0
  for (let k = 0; k <= kMax; k++) s += poissonPmf(k, lambda)
  return s
}

// ============================================================
// DIXON-COLES MATRIX
// ============================================================

function dcTau(i: number, j: number, lh: number, la: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lh * la * rho
  if (i === 0 && j === 1) return 1 + lh * rho
  if (i === 1 && j === 0) return 1 + la * rho
  if (i === 1 && j === 1) return 1 - rho
  return 1
}

export function dixonColesMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number = DIXON_COLES_RHO,
  size: number = MATRIX_SIZE,
): number[][] {
  const m: number[][] = []
  let total = 0
  for (let i = 0; i < size; i++) {
    m[i] = []
    for (let j = 0; j < size; j++) {
      const p = poissonPmf(i, lambdaHome) * poissonPmf(j, lambdaAway)
      const adj = p * dcTau(i, j, lambdaHome, lambdaAway, rho)
      m[i][j] = adj
      total += adj
    }
  }
  // normalizza (la correzione introduce errore residuo + troncamento a size)
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) m[i][j] /= total
  return m
}

// ============================================================
// TEAM STRENGTH → LAMBDAS
// ============================================================

export interface ComputeLambdaInput {
  attack: number              // overall attaccanti
  defense: number             // overall difesa
  refAttack?: number
  refDefense?: number
}

export function computeLambdas(
  home: TeamStrengthInput,
  away: TeamStrengthInput,
  homeRoster: ComputeLambdaInput,
  awayRoster: ComputeLambdaInput,
  config: LeagueBettingConfig = CONFIG_TIER1_LEAGUE,
): { lambdaHome: number; lambdaAway: number } {
  const rAtt = homeRoster.refAttack ?? REF_ATTACK_OVERALL
  const rDef = homeRoster.refDefense ?? REF_DEFENSE_OVERALL

  const attackHome = homeRoster.attack / rAtt
  const defenseAway = awayRoster.defense / rDef
  const attackAway = awayRoster.attack / rAtt
  const defenseHome = homeRoster.defense / rDef

  const modHome = modulator(home)
  const modAway = modulator(away)

  const lambdaHome =
    config.avgGoalsHome *
    attackHome *
    (1 / Math.max(0.5, defenseAway)) *
    home.homeAdvantage *
    modHome

  const lambdaAway =
    config.avgGoalsAway *
    attackAway *
    (1 / Math.max(0.5, defenseHome)) *
    modAway

  return {
    lambdaHome: clamp(lambdaHome, 0.25, 5.5),
    lambdaAway: clamp(lambdaAway, 0.20, 5.0),
  }
}

function modulator(t: TeamStrengthInput): number {
  let m = 1
  m += t.formIndex                                  // ±0.30
  m += (t.fitnessAvg - 50) / 200                    // ±0.25
  m += (t.moraleAvg - 50) / 333                     // ±0.15
  m -= t.injuredKeyPlayers * 0.06
  m -= t.suspendedPlayers * 0.04
  m += t.motivationFactor                           // ±0.10
  m -= t.fatigueFactor                              // 0..0.15
  if (t.isDerby) m += 0.03
  return clamp(m, 0.50, 1.70)
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

// ============================================================
// PROBABILITÀ DERIVATE DALLA MATRICE
// ============================================================

export function p1X2(M: number[][]): { home: number; draw: number; away: number } {
  let h = 0, d = 0, a = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      if (i > j) h += M[i][j]
      else if (i === j) d += M[i][j]
      else a += M[i][j]
    }
  }
  return { home: h, draw: d, away: a }
}

export function pOver(M: number[][], line: number): number {
  let p = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      if (i + j > line) p += M[i][j]
    }
  }
  return p
}

export function pUnder(M: number[][], line: number): number {
  return 1 - pOver(M, line)
}

export function pBtts(M: number[][]): number {
  let p = 0
  for (let i = 1; i < M.length; i++) {
    for (let j = 1; j < M[i].length; j++) {
      p += M[i][j]
    }
  }
  return p
}

export function pCorrectScore(M: number[][], h: number, a: number): number {
  if (h < 0 || a < 0 || h >= M.length || a >= M.length) return 0
  return M[h][a]
}

export function pTeamOver(M: number[][], side: 'home' | 'away', line: number): number {
  let p = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      const teamGoals = side === 'home' ? i : j
      if (teamGoals > line) p += M[i][j]
    }
  }
  return p
}

export function pGoalsBand(M: number[][], lo: number, hi: number): number {
  let p = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      const s = i + j
      if (s >= lo && s <= hi) p += M[i][j]
    }
  }
  return p
}

// Handicap europeo (3 esiti con linea intera applicata al casa)
export function pEuropeanHandicap(M: number[][], lineForHome: number):
  { home: number; draw: number; away: number } {
  let h = 0, d = 0, a = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      const adj = i + lineForHome
      if (adj > j) h += M[i][j]
      else if (adj === j) d += M[i][j]
      else a += M[i][j]
    }
  }
  return { home: h, draw: d, away: a }
}

// Asian Handicap (single line, half line: no push)
// Per quarter lines (es. -0.75) chiamare due volte con -0.5 e -1 e mediare lo stake.
export function pAsianHandicap(
  M: number[][],
  lineForHome: number,
): { homeWin: number; push: number; awayWin: number } {
  let hw = 0, push = 0, aw = 0
  for (let i = 0; i < M.length; i++) {
    for (let j = 0; j < M[i].length; j++) {
      const adj = i + lineForHome
      if (adj > j) hw += M[i][j]
      else if (adj === j) push += M[i][j]
      else aw += M[i][j]
    }
  }
  return { homeWin: hw, push, awayWin: aw }
}

// ============================================================
// MARCATORI
// ============================================================

const ROLE_SHARE: Record<string, number> = {
  ST: 0.30, CF: 0.30,
  LW: 0.15, RW: 0.15, AM: 0.18,
  LM: 0.10, RM: 0.10, CM: 0.06, DM: 0.03,
  WB: 0.04, LB: 0.02, RB: 0.02, CB: 0.02,
  GK: 0,
}

const BASE_CONVERSION = 0.105

export interface ScorerInput {
  player: Player
  isHome: boolean
}

export function computeScorerProbabilities(
  scorers: ScorerInput[],
  lambdaHome: number,
  lambdaAway: number,
  M: number[][],
): Array<{ playerId: string; pAnytime: number; p2plus: number; pHattrick: number; pFirst: number; pLast: number; expectedGoals: number }> {
  // 1. share di tiri per squadra
  const teamShots = {
    home: 12 + (lambdaHome - 1.3) * 3,
    away: 12 + (lambdaAway - 1.3) * 3,
  }

  // 2. weights per player
  const weightOf = (p: Player) => {
    const baseShare = ROLE_SHARE[p.position] ?? 0.03
    return baseShare * (p.attributes.shooting / 14) * (p.attributes.composure / 14)
  }

  const weightsByTeam: Record<'home' | 'away', number> = { home: 0, away: 0 }
  for (const s of scorers) {
    weightsByTeam[s.isHome ? 'home' : 'away'] += weightOf(s.player)
  }

  // 3. xG per giocatore
  const results = scorers.map(s => {
    const team = s.isHome ? 'home' : 'away'
    const teamShotsCount = Math.max(1, teamShots[team])
    const w = weightOf(s.player)
    const sumW = Math.max(0.001, weightsByTeam[team])
    const playerShots = teamShotsCount * (w / sumW)

    const fitnessMod = 0.7 + 0.6 * (s.player.fitness / 100)
    const moraleMod = 0.85 + 0.30 * (s.player.morale / 100)
    const conv = BASE_CONVERSION
      * (s.player.attributes.finishing / 14)
      * (s.player.attributes.composure / 14)
      * fitnessMod * moraleMod

    const eg = Math.max(0, playerShots * conv)

    const pAnytime = 1 - Math.exp(-eg)
    const pNone = Math.exp(-eg)
    const pOne = eg * Math.exp(-eg)
    const pTwo = (eg * eg / 2) * Math.exp(-eg)
    const p2plus = 1 - pNone - pOne
    const pHattrick = 1 - pNone - pOne - pTwo

    return { playerId: s.player.id, eg, pAnytime, p2plus: Math.max(0, p2plus), pHattrick: Math.max(0, pHattrick) }
  })

  // 4. First scorer / Last scorer
  const sumEg = Math.max(0.001, results.reduce((s, r) => s + r.eg, 0))
  const pNoGoal = M[0][0]

  return results.map(r => ({
    playerId: r.playerId,
    pAnytime: r.pAnytime,
    p2plus: r.p2plus,
    pHattrick: r.pHattrick,
    pFirst: (r.eg / sumEg) * (1 - pNoGoal),
    pLast: (r.eg / sumEg) * (1 - pNoGoal),
    expectedGoals: r.eg,
  }))
}

// ============================================================
// CARTELLINI / CORNER / RIGORI / ROSSI
// ============================================================

export function computeAuxLambdas(home: TeamStrengthInput, away: TeamStrengthInput): {
  lambdaCards: number
  lambdaCorners: number
  lambdaRedCards: number
  lambdaPenalties: number
} {
  const aggressFactor = home.aggressivenessFactor + away.aggressivenessFactor
  const lambdaCards = 4.2
    * (1 + aggressFactor)
    * (home.isDerby ? 1.20 : 1)
    * ((home.refereeStrictness + away.refereeStrictness) / 2)

  const styleFactor = (home.styleFactor + away.styleFactor) / 2
  const lambdaCorners = 9.5
    * (home.attackingStrength / 1.0)
    * (away.attackingStrength / 1.0)
    * (1 + (styleFactor - 1) * 0.20)

  const lambdaRedCards = 0.18 * (1 + aggressFactor * 1.2) * (home.isDerby ? 1.4 : 1)
  const lambdaPenalties = 0.30 * (home.attackingStrength + away.attackingStrength) / 2

  return {
    lambdaCards: clamp(lambdaCards, 1.5, 9),
    lambdaCorners: clamp(lambdaCorners, 4, 16),
    lambdaRedCards: clamp(lambdaRedCards, 0.05, 0.8),
    lambdaPenalties: clamp(lambdaPenalties, 0.10, 0.80),
  }
}

// ============================================================
// MODELLO COMPLETO
// ============================================================

export function buildMatchProbabilityModel(
  home: TeamStrengthInput,
  away: TeamStrengthInput,
  homeRoster: ComputeLambdaInput,
  awayRoster: ComputeLambdaInput,
  topMatchFactor: number = 1.0,
  config: LeagueBettingConfig = CONFIG_TIER1_LEAGUE,
): MatchProbabilityModel {
  const { lambdaHome, lambdaAway } = computeLambdas(home, away, homeRoster, awayRoster, config)
  const probMatrix = dixonColesMatrix(lambdaHome, lambdaAway, config.dixonColesRho)
  const lambdaHomeHT = lambdaHome * config.htGoalShare
  const lambdaAwayHT = lambdaAway * config.htGoalShare
  const probMatrixHT = dixonColesMatrix(lambdaHomeHT, lambdaAwayHT, config.dixonColesRho)
  const aux = computeAuxLambdas(home, away)
  return {
    lambdaHome,
    lambdaAway,
    lambdaHomeHT,
    lambdaAwayHT,
    probMatrix,
    probMatrixHT,
    ...aux,
    topMatchFactor,
  }
}

// ============================================================
// COSTRUTTORE TeamStrengthInput dal Career
// ============================================================

export interface BuildInputDeps {
  team: Team
  homeAdvantageOverride?: number
  formIndex?: number               // calcolata da ultime partite
  fitnessAvg?: number
  moraleAvg?: number
  injuredKeyPlayers?: number
  suspendedPlayers?: number
  isDerby?: boolean
  motivationFactor?: number
  fatigueFactor?: number
  refereeStrictness?: number
  aggressivenessFactor?: number
  styleFactor?: number
  attackingOverall?: number
  defensiveOverall?: number
  isHome: boolean
}

export function buildTeamInput(deps: BuildInputDeps): TeamStrengthInput {
  return {
    attackingStrength: (deps.attackingOverall ?? REF_ATTACK_OVERALL) / REF_ATTACK_OVERALL,
    defensiveStrength: (deps.defensiveOverall ?? REF_DEFENSE_OVERALL) / REF_DEFENSE_OVERALL,
    homeAdvantage: deps.isHome ? (deps.homeAdvantageOverride ?? 1.30) : 1.0,
    formIndex: clamp(deps.formIndex ?? 0, -0.30, 0.30),
    fitnessAvg: clamp(deps.fitnessAvg ?? 80, 0, 100),
    moraleAvg: clamp(deps.moraleAvg ?? 70, 0, 100),
    injuredKeyPlayers: Math.max(0, deps.injuredKeyPlayers ?? 0),
    suspendedPlayers: Math.max(0, deps.suspendedPlayers ?? 0),
    isDerby: !!deps.isDerby,
    motivationFactor: clamp(deps.motivationFactor ?? 0, -0.10, 0.10),
    fatigueFactor: clamp(deps.fatigueFactor ?? 0, 0, 0.15),
    refereeStrictness: clamp(deps.refereeStrictness ?? 1.0, 0.80, 1.25),
    aggressivenessFactor: clamp(deps.aggressivenessFactor ?? 0, -0.30, 0.50),
    styleFactor: clamp(deps.styleFactor ?? 1.0, 0.60, 1.50),
  }
}

// ============================================================
// 1X2 outcome enum helper
// ============================================================

export function outcomeFromScore(home: number, away: number): Outcome1X2 {
  if (home > away) return '1'
  if (home < away) return '2'
  return 'X'
}
