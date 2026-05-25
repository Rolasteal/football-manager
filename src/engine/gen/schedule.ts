/**
 * Generazione calendario stagione (round-robin andata + ritorno).
 *
 * Per N squadre pari → N-1 turni di andata, ognuno con N/2 partite,
 * più N-1 turni di ritorno. Totale partite = N * (N-1).
 * Per N=20 → 19+19 = 38 giornate, 380 partite per lega.
 *
 * Algoritmo: "circle method" classico, con rotazione e fix del primo.
 * Casa/trasferta alternato per evitare lunghe serie consecutive.
 */

import type { EntityId, League } from '$engine/types'
import type { Fixture } from '$engine/competition/types'
import type { Rng } from './rng'
import { generateId } from './rng'

const MS_PER_DAY = 86_400_000
const MATCHDAYS_GAP_DAYS = 7  // una giornata a settimana

interface RoundPair { home: EntityId; away: EntityId }

/** Round-robin: ritorna array di "round", ognuno = lista di accoppiamenti */
function buildRoundRobin(teamIds: EntityId[], rng: Rng): RoundPair[][] {
  if (teamIds.length % 2 !== 0) {
    throw new Error(`Round-robin richiede numero squadre pari, ricevuto ${teamIds.length}`)
  }
  const n = teamIds.length
  const ids = [...teamIds]
  rng.shuffle(ids)  // randomizza posizione iniziale per varietà

  const rounds: RoundPair[][] = []
  for (let r = 0; r < n - 1; r++) {
    const round: RoundPair[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]
      const b = ids[n - 1 - i]
      // Alterna casa/trasferta in base al round per equilibrio
      if ((r + i) % 2 === 0) {
        round.push({ home: a, away: b })
      } else {
        round.push({ home: b, away: a })
      }
    }
    rounds.push(round)
    // Rotazione: tieni ids[0] fisso, ruota gli altri di 1 a destra
    const last = ids.pop()!
    ids.splice(1, 0, last)
  }
  return rounds
}

export interface BuildScheduleOptions {
  league: League
  /** Data ISO del primo turno (sabato/domenica) */
  startDate: string
}

export function buildSchedule(rng: Rng, opts: BuildScheduleOptions): Fixture[] {
  const { league, startDate } = opts
  const start = Date.parse(startDate)
  if (isNaN(start)) throw new Error(`Invalid startDate: ${startDate}`)

  const firstHalf = buildRoundRobin(league.teamIds, rng)
  const totalRounds = firstHalf.length * 2  // 19 + 19 = 38

  const fixtures: Fixture[] = []

  // Girone andata
  firstHalf.forEach((round, idx) => {
    const matchday = idx + 1
    const date = new Date(start + idx * MATCHDAYS_GAP_DAYS * MS_PER_DAY).toISOString().slice(0, 10)
    for (const pair of round) {
      fixtures.push({
        id: generateId(rng),
        leagueId: league.id,
        matchday,
        date,
        homeId: pair.home,
        awayId: pair.away,
        status: 'scheduled',
      })
    }
  })

  // Girone ritorno: stesse coppie, casa/trasferta invertite, offset N-1 turni
  firstHalf.forEach((round, idx) => {
    const matchday = firstHalf.length + idx + 1
    const date = new Date(start + (firstHalf.length + idx) * MATCHDAYS_GAP_DAYS * MS_PER_DAY).toISOString().slice(0, 10)
    for (const pair of round) {
      fixtures.push({
        id: generateId(rng),
        leagueId: league.id,
        matchday,
        date,
        homeId: pair.away,   // invertito
        awayId: pair.home,
        status: 'scheduled',
      })
    }
  })

  // Verifica integrità
  if (fixtures.length !== league.teamIds.length * (league.teamIds.length - 1)) {
    throw new Error(`Schedule integrity check failed: got ${fixtures.length} fixtures`)
  }
  // Verifica numero giornate
  const maxMd = Math.max(...fixtures.map(f => f.matchday))
  if (maxMd !== totalRounds) {
    throw new Error(`Schedule integrity: max matchday ${maxMd}, expected ${totalRounds}`)
  }

  return fixtures
}

/** Genera calendari per tutte le leghe (parte da una stessa startDate) */
export function buildAllSchedules(
  rng: Rng,
  leagues: League[],
  startDate: string
): Fixture[] {
  const all: Fixture[] = []
  for (const league of leagues) {
    all.push(...buildSchedule(rng, { league, startDate }))
  }
  return all
}
