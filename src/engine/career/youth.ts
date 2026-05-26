/**
 * Generazione giovani annuale — Fase 3.C.
 *
 * Ogni inizio stagione, ogni club promuove 2-5 giovani 16-19 anni dal vivaio.
 * La distribuzione del potential è realistica:
 * - 1% fenomeni (pot 80-88) — 1 ogni ~100 giovani, generazionale (Yamal, Endrick)
 * - 4% molto promettenti (pot 70-79) — top player futuro
 * - 15% buoni (pot 60-69) — titolare buona squadra
 * - 35% medi (pot 50-59) — riserva Serie A, titolare Serie B
 * - 45% mediocri/scarsi (pot 35-49) — mai sfondano oltre dilettanti
 *
 * Numero giovani per club basato su reputation:
 * - Top club (rep 70+): 4-5 / stagione
 * - Medi (rep 50-69): 3-4
 * - Piccoli (rep <50): 2-3
 *
 * Il current overall è scalato dall'età: 16enne ha attributi ~65% del peak,
 * 19enne ~86%. La curva aging (Fase 3.B) li porterà al potential nei prossimi
 * 4-8 anni.
 */

import type { Player, Position, Team } from '$engine/types'
import type { Rng } from '$engine/gen/rng'
import type { Career } from './types'
import { generatePlayer, type TeamTier } from '$engine/gen/player'
import { ensurePlayerFMAttributes } from '$engine/gen/playerCompat'

// ====== Distribuzione potential ======

/**
 * Rolla un potential 30-88 secondo la distribuzione realistica. Deterministic
 * dato l'rng. Il risultato è un overall MASSIMO che il giovane potrà raggiungere
 * — non l'attuale.
 */
export function rollYouthPotential(rng: Rng): number {
  const r = rng.next()
  if (r < 0.01) return rng.int(80, 88)        //  1% fenomeni
  if (r < 0.05) return rng.int(70, 79)        //  4% molto promettenti
  if (r < 0.20) return rng.int(60, 69)        // 15% buoni
  if (r < 0.55) return rng.int(50, 59)        // 35% medi
  return rng.int(30, 49)                       // 45% scarsi
}

/** Rolla età 16-19 con peso: più probabile 16-17 (giovani dal vivaio "fresco"). */
function rollYouthAge(rng: Rng): number {
  const r = rng.next()
  if (r < 0.35) return 16
  if (r < 0.65) return 17
  if (r < 0.85) return 18
  return 19
}

/** Tier per generateAttributes derivato dal potential del giovane. */
function tierFromPotential(potential: number): TeamTier {
  if (potential >= 72) return 'top'
  if (potential >= 56) return 'mid'
  return 'low'
}

// ====== Scaling attributi per giovani ======

/**
 * Scala tutti gli attributi del player per simulare "underdeveloped".
 * Factor < 1 abbassa, factor > 1 alza. Clampa 1-20.
 *
 * Per i giovani usiamo factor 0.65 (16enne) → 0.86 (19enne) — attributi più
 * bassi del peak che cresceranno con la curva aging.
 */
function scaleAttributes(player: Player, factor: number): void {
  const a = player.attributes as unknown as Record<string, number>
  for (const key of Object.keys(a)) {
    const v = a[key]
    if (typeof v !== 'number') continue
    a[key] = Math.max(1, Math.min(20, Math.round(v * factor)))
  }
}

// ====== Birth date helper ======

function birthDateFromAge(age: number, seasonYear: number, rng: Rng): string {
  const year = seasonYear - age
  const month = rng.int(1, 12)
  const day = rng.int(1, 28)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ====== Distribuzione posizioni dei giovani ======

/**
 * Pool posizioni con peso. Riflette la realtà dei vivai: pochi GK, molti
 * difensori centrali e centrocampisti, pochi specialisti (AM/CF puri).
 */
const YOUTH_POSITION_POOL: { pos: Position; weight: number }[] = [
  { pos: 'GK', weight: 1 },
  { pos: 'CB', weight: 3 }, { pos: 'LB', weight: 2 }, { pos: 'RB', weight: 2 },
  { pos: 'DM', weight: 2 }, { pos: 'CM', weight: 3 }, { pos: 'AM', weight: 1 },
  { pos: 'LM', weight: 1 }, { pos: 'RM', weight: 1 },
  { pos: 'LW', weight: 1 }, { pos: 'RW', weight: 1 },
  { pos: 'CF', weight: 1 }, { pos: 'ST', weight: 2 },
]

function pickYouthPosition(rng: Rng): Position {
  const total = YOUTH_POSITION_POOL.reduce((s, p) => s + p.weight, 0)
  const r = rng.int(1, total)
  let acc = 0
  for (const { pos, weight } of YOUTH_POSITION_POOL) {
    acc += weight
    if (r <= acc) return pos
  }
  return 'CM'
}

// ====== Generazione singolo giovane ======

/**
 * Genera un giovane 16-19 anni promosso dal vivaio. Lo crea via `generatePlayer`
 * (riusando tutta la logica del world generator) e poi:
 * - Override `birthDate` per età 16-19
 * - Override `potential` con il roll specifico
 * - Scala gli attributi del fattore età (under-developed)
 * - Ricalcola valore mercato sul nuovo overall
 */
export function generateYouthPlayer(
  rng: Rng,
  opts: {
    teamId: string
    position?: Position
    seasonYear: number
  }
): Player {
  const potential = rollYouthPotential(rng)
  const age = rollYouthAge(rng)
  const position = opts.position ?? pickYouthPosition(rng)
  const tier = tierFromPotential(potential)

  const player = generatePlayer(rng, {
    position,
    tier,
    teamId: opts.teamId,
    seasonYear: opts.seasonYear,
  })

  // Override demografici per garantire età 16-19
  player.birthDate = birthDateFromAge(age, opts.seasonYear, rng)

  // Override potential con il roll giovane
  player.potential = potential

  // Scala attributi: 16=0.65, 17=0.72, 18=0.79, 19=0.86
  // Crescita aging li riporterà al peak entro 24-26 anni
  const scaleFactor = 0.65 + (age - 16) * 0.07
  scaleAttributes(player, scaleFactor)

  // Backward-compat: assicura attributi FM popolati
  ensurePlayerFMAttributes(player)

  // Numero maglia: i giovani prendono numeri alti (24-99) per non collidere
  // con la rosa principale. Sarà rivisto in 3.D quando ci saranno contratti.
  player.shirtNumber = rng.int(24, 99)

  return player
}

// ====== Generazione pool stagionale per tutta la career ======

/**
 * Determina quanti giovani genera ogni club in base alla reputation:
 * - Top (rep 70+): 4-5
 * - Mid (rep 50-69): 3-4
 * - Low (rep <50): 2-3
 */
function youthCountForTeam(team: Team, rng: Rng): number {
  if (team.reputation >= 70) return rng.int(4, 5)
  if (team.reputation >= 50) return rng.int(3, 4)
  return rng.int(2, 3)
}

/**
 * Genera il pool giovani di tutta la career per la nuova stagione e li
 * aggiunge ai vivai delle squadre. Modifica `career.players` in-place.
 *
 * Returns: info riepilogativa per news/UI.
 */
export interface YouthIntakeReport {
  totalGenerated: number
  topProspects: { name: string; teamName: string; potential: number; position: Position }[]
}

export function generateYouthPoolForSeason(career: Career, rng: Rng): YouthIntakeReport {
  let total = 0
  const candidates: { player: Player; teamName: string }[] = []

  for (const team of Object.values(career.teams)) {
    const count = youthCountForTeam(team, rng)
    for (let i = 0; i < count; i++) {
      const youth = generateYouthPlayer(rng, {
        teamId: team.id,
        seasonYear: career.season.year,
      })
      career.players[youth.id] = youth
      candidates.push({ player: youth, teamName: team.name })
      total++
    }
  }

  // Top 3 prospect per news (highest potential, jitter su pari)
  const topProspects = candidates
    .sort((a, b) => (b.player.potential ?? 0) - (a.player.potential ?? 0))
    .slice(0, 3)
    .map(c => ({
      name: `${c.player.firstName} ${c.player.lastName}`,
      teamName: c.teamName,
      potential: c.player.potential ?? 0,
      position: c.player.position,
    }))

  return { totalGenerated: total, topProspects }
}
