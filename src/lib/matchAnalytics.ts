/**
 * Analytics post-match: funzioni pure per derivare voti, fanta-bonus,
 * statistiche, marcatori e badge dai MatchEvent[] di una partita.
 *
 * Usato sia da Match.svelte (replay live, `shown[]`) sia da MatchReport.svelte
 * (archive di partite passate, `result.events` intero). Tutte le funzioni
 * sono pure — i contesti che dipendono da career/lineup vanno passati come
 * parametro esplicito.
 *
 * Per il dettaglio spec dei voti vedi memoria [[project-voti-fantacalcio]].
 */

import type { MatchEvent, MatchEventNote } from '$engine/match/types'
import type { TeamMatchStats } from '$engine/competition/types'
import type { EntityId, Player, Position } from '$engine/types'
import type { Lineup } from '$engine/tactics/types'

export type MacroRole = 'GK' | 'DEF' | 'MID' | 'ATT'

export interface PlayerBadges {
  goals: number
  assists: number
  ownGoals: number
  yellow: boolean
  red: boolean
  subIn: boolean
  subOut: boolean
}

/** Voto base "anonimo" V2 (era 6.0 in V1). Vedi memoria voti. */
export const BASE_RATING = 5.5

// ====================================================================
// HELPER PURI
// ====================================================================

export function emptyBadges(): PlayerBadges {
  return { goals: 0, assists: 0, ownGoals: 0, yellow: false, red: false, subIn: false, subOut: false }
}

export function emptyTeamStats(): TeamMatchStats {
  return { possession: 50, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, passes: 0, passAccuracy: 0 }
}

/** Macro-ruolo a partire dalla Position specifica (CB→DEF, AM→MID, ST→ATT, ecc.).
 *  Replica `role(p)` privato dell'engine per non leakare l'import. */
export function macroRole(position: Position): MacroRole {
  switch (position) {
    case 'GK': return 'GK'
    case 'CB': case 'LB': case 'RB': case 'WB': return 'DEF'
    case 'DM': case 'CM': case 'AM': case 'LM': case 'RM': return 'MID'
    default: return 'ATT'
  }
}

/** True se il `note` qualifica l'evento come esito specifico di un rigore
 *  (segnato/parato/mancato). Trigger discriminato per overlay penalty_outcome. */
export function isPenaltyOutcomeNote(n: MatchEventNote | undefined): n is MatchEventNote {
  return !!n && (n === 'pen_goal_top_left' || n === 'pen_goal_top_right' || n === 'pen_goal_low_left'
    || n === 'pen_goal_low_right' || n === 'pen_goal_chip'
    || n === 'pen_saved_left' || n === 'pen_saved_center' || n === 'pen_saved_right'
    || n === 'pen_miss_high' || n === 'pen_miss_wide_left' || n === 'pen_miss_wide_right'
    || n === 'pen_miss_post' || n === 'pen_miss_crossbar')
}

/** Mappa il sotto-tipo di esito rigore alla PNG cinematografica corrispondente. */
export function penaltyAsset(n: MatchEventNote | undefined): string {
  switch (n) {
    case 'pen_goal_top_left':   return '/assets/match/Rigore_segnato_incrocio.png'
    case 'pen_goal_top_right':  return '/assets/match/Rigore_gol_destra.png'
    case 'pen_goal_low_left':   return '/assets/match/Rigore_segnato_sx.png'
    case 'pen_goal_low_right':  return '/assets/match/Rigore_segnato_destra.png'
    case 'pen_goal_chip':       return '/assets/match/Rigore_segnato_cucchiaio.png'
    case 'pen_saved_left':      return '/assets/match/Rigore_parato_sx.png'
    case 'pen_saved_center':    return '/assets/match/Rigore_parato_centro.png'
    case 'pen_saved_right':     return '/assets/match/Rigore_parato_dx.png'
    case 'pen_miss_high':       return '/assets/match/Rigore_sbagliato_alto.png'
    case 'pen_miss_wide_left':  return '/assets/match/Rigore_sbagliato_fuori.png'
    case 'pen_miss_wide_right': return '/assets/match/Rigore_sbagliato_fuori2.png'
    case 'pen_miss_post':       return '/assets/match/Rigore_sbagliato_palo.png'
    case 'pen_miss_crossbar':   return '/assets/match/Rigore_sbagliato_traversa.png'
    default:                    return '/assets/match/Gol.png'
  }
}

export function penaltyOutcomeTitle(n: MatchEventNote | undefined): string {
  if (!n) return ''
  if (n.startsWith('pen_goal_'))  return 'RIGORE SEGNATO'
  if (n.startsWith('pen_saved_')) return 'RIGORE PARATO'
  if (n.startsWith('pen_miss_'))  return 'RIGORE SBAGLIATO'
  return ''
}

/** Hash deterministico stringa → float [0,1). Usato per jitter ±0.5 sui sub IN
 *  che restano al voto base esatto (5.5) — voti differenziati 5.0-6.0 stabili
 *  tra reload. */
export function hashFloat(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((h % 1000) + 1000) % 1000 / 1000
}

// ====================================================================
// COMPUTE FUNCTIONS — pure su MatchEvent[]
// ====================================================================

/** Voto BASE prestazione 4.0-10.0 V2 calcolato sugli eventi. Default 5.5
 *  (anonimo). Sub IN che restano alla base esatta ricevono un jitter
 *  deterministic ±0.5 sull'id così non sono tutti uguali. */
export function computeLiveRatings(events: MatchEvent[]): Record<EntityId, number> {
  const r: Record<EntityId, number> = {}
  const subIn = new Set<EntityId>()
  const adj = (id: EntityId | undefined, delta: number) => {
    if (!id) return
    if (r[id] === undefined) r[id] = BASE_RATING
    r[id] = Math.max(4, Math.min(10, r[id] + delta))
  }
  const touch = (id: EntityId | undefined) => {
    if (id && r[id] === undefined) r[id] = BASE_RATING
  }
  for (const ev of events) {
    touch(ev.playerId)
    touch(ev.secondaryPlayerId)
    if (ev.kind === 'substitution' && ev.secondaryPlayerId) {
      subIn.add(ev.secondaryPlayerId)
    }
    switch (ev.kind) {
      case 'shot_on_target': adj(ev.playerId, +0.1); break
      case 'save':           adj(ev.playerId, +0.3); break
      case 'shot':           adj(ev.playerId, -0.05); break
      case 'foul':           adj(ev.playerId, -0.05); break
      case 'pass':           adj(ev.playerId, +0.02); break
    }
  }
  for (const id of subIn) {
    if (r[id] === undefined || r[id] === BASE_RATING) {
      const bias = (hashFloat(id) - 0.5) * 1.0
      r[id] = Math.max(4, Math.min(10, BASE_RATING + Math.round(bias * 10) / 10))
    }
  }
  return r
}

export function computePlayerBadges(events: MatchEvent[]): Record<EntityId, PlayerBadges> {
  const r: Record<EntityId, PlayerBadges> = {}
  const ensure = (id: EntityId) => {
    if (!r[id]) r[id] = emptyBadges()
    return r[id]
  }
  for (const ev of events) {
    if (ev.kind === 'goal' && ev.playerId) {
      ensure(ev.playerId).goals++
      if (ev.secondaryPlayerId) ensure(ev.secondaryPlayerId).assists++
    }
    if (ev.kind === 'own_goal' && ev.playerId) ensure(ev.playerId).ownGoals++
    if (ev.kind === 'yellow_card' && ev.playerId) ensure(ev.playerId).yellow = true
    if (ev.kind === 'red_card' && ev.playerId) ensure(ev.playerId).red = true
    if (ev.kind === 'substitution') {
      if (ev.playerId) ensure(ev.playerId).subOut = true
      if (ev.secondaryPlayerId) ensure(ev.secondaryPlayerId).subIn = true
    }
  }
  return r
}

export function computeLiveStats(events: MatchEvent[]): { home: TeamMatchStats; away: TeamMatchStats } {
  const home = emptyTeamStats()
  const away = emptyTeamStats()
  for (const ev of events) {
    const t = ev.side === 'home' ? home : ev.side === 'away' ? away : null
    if (!t) continue
    switch (ev.kind) {
      case 'shot':           t.shots++; break
      case 'shot_on_target': t.shots++; t.shotsOnTarget++; break
      case 'goal':           t.shots++; t.shotsOnTarget++; break
      case 'own_goal':       t.shots++; t.shotsOnTarget++; break
      case 'corner':         t.corners++; break
      case 'foul':           t.fouls++; break
      case 'yellow_card':    t.yellowCards++; break
      case 'red_card':       t.redCards++; break
    }
  }
  // Possesso approssimato dai passaggi
  const homePasses = events.filter(e => e.kind === 'pass' && e.side === 'home').length
  const awayPasses = events.filter(e => e.kind === 'pass' && e.side === 'away').length
  const totalPasses = homePasses + awayPasses
  if (totalPasses > 0) {
    home.possession = Math.round((homePasses / totalPasses) * 100)
    away.possession = 100 - home.possession
    home.passes = homePasses
    away.passes = awayPasses
  }
  return { home, away }
}

/** Context per il calcolo dei fanta-bonus: serve sapere chi è il GK in campo
 *  per ciascun side, chi è il capitano (se di nostra proprietà), e la mappa
 *  player→position per derivare macroRole dei difensori durante clean sheet. */
export interface FantaBonusCtx {
  homeLineup: Lineup | null
  awayLineup: Lineup | null
  homeGkId?: EntityId
  awayGkId?: EntityId
  captainId?: EntityId
  /** Mappa playerId → Player (di solito `career.players`) per macroRole */
  players: Record<EntityId, Player>
}

export function computeFantaBonus(events: MatchEvent[], ctx: FantaBonusCtx): Record<EntityId, number> {
  const r: Record<EntityId, number> = {}
  const { homeLineup, awayLineup, homeGkId, awayGkId, captainId, players } = ctx
  const adj = (id: EntityId | undefined, delta: number) => {
    if (!id) return
    r[id] = (r[id] ?? 0) + delta
  }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.kind === 'goal') {
      adj(ev.playerId, +3)
      if (ev.secondaryPlayerId) adj(ev.secondaryPlayerId, +1)
      adj(ev.side === 'home' ? awayGkId : homeGkId, -1)
    } else if (ev.kind === 'own_goal') {
      adj(ev.playerId, -3)
      adj(ev.side === 'home' ? awayGkId : homeGkId, -1)
    } else if (ev.kind === 'yellow_card') {
      adj(ev.playerId, -0.5)
    } else if (ev.kind === 'red_card') {
      // 2° giallo: niente bonus extra (i 2 gialli da -0.5 fanno -1 totale).
      // Rosso diretto: -1.5 secco.
      if (ev.note !== 'second_yellow') {
        adj(ev.playerId, -1.5)
      }
    } else if (ev.kind === 'penalty') {
      // Esito del rigore nei prossimi 5 eventi entro lo stesso minuto
      for (let j = i + 1; j < Math.min(i + 5, events.length); j++) {
        const next = events[j]
        if (next.minute !== ev.minute) break
        if (next.kind === 'save' && next.side !== ev.side) {
          adj(next.playerId, +3)
          adj(next.secondaryPlayerId, -3)
          break
        }
        if (next.kind === 'shot' && next.side === ev.side) {
          adj(next.playerId, -3)
          break
        }
        if (next.kind === 'goal' && next.side === ev.side) {
          break
        }
      }
    }
  }

  // V2: bonus capitano +0.2
  if (captainId && (homeLineup?.starters.includes(captainId) || awayLineup?.starters.includes(captainId))) {
    adj(captainId, +0.2)
  }

  // V2: clean sheet GK +0.5 / DEF +0.3 a fine partita se 0 gol subiti
  const isFinished = events.some(e => e.kind === 'full_time')
  if (isFinished) {
    let homeConceded = 0
    let awayConceded = 0
    const subInSet = new Set<EntityId>()
    for (const ev of events) {
      if (ev.kind === 'goal' || ev.kind === 'own_goal') {
        if (ev.side === 'away') homeConceded++
        if (ev.side === 'home') awayConceded++
      }
      if (ev.kind === 'substitution' && ev.secondaryPlayerId) subInSet.add(ev.secondaryPlayerId)
    }
    const applyCleanSheet = (lineup: Lineup | null, conceded: number) => {
      if (!lineup || conceded > 0) return
      const apply = (pid: EntityId) => {
        const p = players[pid]
        if (!p) return
        const macro = macroRole(p.position)
        if (macro === 'GK')  adj(pid, +0.5)
        else if (macro === 'DEF') adj(pid, +0.3)
      }
      for (const pid of lineup.starters) apply(pid)
      for (const pid of lineup.bench) if (subInSet.has(pid)) apply(pid)
    }
    applyCleanSheet(homeLineup, homeConceded)
    applyCleanSheet(awayLineup, awayConceded)
  }

  return r
}

/** Marcatori in ordine cronologico, distingue rigori (note pen_goal_*) e
 *  autogol (kind own_goal). Per autogol side è già del team beneficiario
 *  (engine inverte); playerId è il difensore (team opposto). */
export interface ScorerEntry {
  side: 'home' | 'away'
  minute: number
  playerId: EntityId
  note: 'rigore' | 'autogol' | null
}
export function getScorerList(events: MatchEvent[]): ScorerEntry[] {
  const out: ScorerEntry[] = []
  for (const ev of events) {
    if (ev.kind !== 'goal' && ev.kind !== 'own_goal') continue
    if (!ev.side || !ev.playerId) continue
    out.push({
      side: ev.side,
      minute: ev.minute,
      playerId: ev.playerId,
      note: ev.kind === 'own_goal'
        ? 'autogol'
        : (ev.note && ev.note.startsWith('pen_goal_') ? 'rigore' : null),
    })
  }
  return out
}

/** GK in campo = primo starter con position='GK' della lineup. */
export function gkOfLineup(lineup: Lineup | null, players: Record<EntityId, Player>): EntityId | undefined {
  if (!lineup) return undefined
  return lineup.starters.find(id => players[id]?.position === 'GK')
}

/** MVP della partita: highest total (rating + bonus) tra i titolari delle due squadre. */
export function computeMvp(
  homeLineup: Lineup | null,
  awayLineup: Lineup | null,
  ratings: Record<EntityId, number>,
  bonus: Record<EntityId, number>,
): { id: EntityId; rating: number; bonus: number; total: number; side: 'home' | 'away' } | null {
  if (!homeLineup || !awayLineup) return null
  let best: { id: EntityId; rating: number; bonus: number; total: number; side: 'home' | 'away' } | null = null
  const consider = (id: EntityId, side: 'home' | 'away') => {
    const rt = ratings[id] ?? BASE_RATING
    const bn = bonus[id] ?? 0
    const tt = rt + bn
    if (!best || tt > best.total) best = { id, rating: rt, bonus: bn, total: tt, side }
  }
  for (const id of homeLineup.starters) consider(id, 'home')
  for (const id of awayLineup.starters) consider(id, 'away')
  return best
}

// ====================================================================
// HELPER UI
// ====================================================================

export function ratingClass(v: number): string {
  if (v >= 7.5) return 'r-top'
  if (v >= 6.5) return 'r-ok'
  if (v >= 5.5) return 'r-mid'
  return 'r-low'
}

export function fmtRating(v: number): string {
  return v.toFixed(1)
}

export function fmtBonus(v: number): string {
  if (v === 0) return ''
  return v > 0 ? `+${v.toFixed(1).replace(/\.0$/, '')}` : v.toFixed(1).replace(/\.0$/, '')
}
