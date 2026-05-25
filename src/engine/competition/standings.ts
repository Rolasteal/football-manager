/**
 * Calcolo classifica da fixture giocati.
 */

import type { EntityId } from '$engine/types'
import type { Fixture, StandingsRow } from './types'

export function computeStandings(fixtures: Fixture[], teamIds: EntityId[]): StandingsRow[] {
  const rows = new Map<EntityId, StandingsRow>()
  for (const tid of teamIds) {
    rows.set(tid, {
      teamId: tid,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [],
    })
  }

  // Considera solo le partite giocate (status 'played'), in ordine cronologico
  const played = fixtures
    .filter(f => f.status === 'played' && f.result)
    .sort((a, b) => a.date.localeCompare(b.date) || a.matchday - b.matchday)

  for (const f of played) {
    const r = f.result!
    const home = rows.get(f.homeId)
    const away = rows.get(f.awayId)
    if (!home || !away) continue

    home.played++; away.played++
    home.goalsFor += r.homeScore; home.goalsAgainst += r.awayScore
    away.goalsFor += r.awayScore; away.goalsAgainst += r.homeScore

    if (r.homeScore > r.awayScore) {
      home.won++; home.points += 3; home.form.unshift('W')
      away.lost++; away.form.unshift('L')
    } else if (r.homeScore < r.awayScore) {
      away.won++; away.points += 3; away.form.unshift('W')
      home.lost++; home.form.unshift('L')
    } else {
      home.drawn++; home.points += 1; home.form.unshift('D')
      away.drawn++; away.points += 1; away.form.unshift('D')
    }
    if (home.form.length > 5) home.form.length = 5
    if (away.form.length > 5) away.form.length = 5
  }

  for (const r of rows.values()) r.goalDiff = r.goalsFor - r.goalsAgainst

  return Array.from(rows.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
    return a.teamId.localeCompare(b.teamId)
  })
}
