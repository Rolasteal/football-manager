/**
 * Tipi competizione: partite programmate, risultati, classifica.
 * Tutti serializzabili in JSON.
 */

import type { EntityId } from '$engine/types'
import type { MatchEvent } from '$engine/match/types'

export type FixtureStatus = 'scheduled' | 'in_progress' | 'played' | 'postponed'

/** Una partita del calendario stagione */
export interface Fixture {
  id: EntityId
  leagueId: EntityId
  matchday: number  // 1..38
  /** Data ISO della partita */
  date: string
  homeId: EntityId
  awayId: EntityId
  status: FixtureStatus
  result?: MatchResult
}

/** Risultato di una partita giocata */
export interface MatchResult {
  homeScore: number
  awayScore: number
  /** Stream completo eventi (per replay/cronistoria); può essere ridotto agli highlight in versioni light */
  events: MatchEvent[]
  /** Statistiche aggregate squadra */
  stats: MatchStats
  /** Voti giocatori 1.0-10.0 (key = playerId) */
  ratings: Record<EntityId, number>
  /** Marcatori in ordine (per cronistoria veloce) */
  scorers: Scorer[]
}

export interface MatchStats {
  home: TeamMatchStats
  away: TeamMatchStats
}

export interface TeamMatchStats {
  possession: number  // 0-100
  shots: number
  shotsOnTarget: number
  corners: number
  fouls: number
  yellowCards: number
  redCards: number
  passes: number
  passAccuracy: number  // 0-100
}

export interface Scorer {
  playerId: EntityId
  teamId: EntityId
  minute: number
  /** Es. "rigore", "autogol", "punizione" */
  note?: string
}

/** Riga di classifica calcolata */
export interface StandingsRow {
  teamId: EntityId
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  /** Forma ultime 5 partite, dalla più recente: W/D/L */
  form: ('W' | 'D' | 'L')[]
}
