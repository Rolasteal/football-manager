/**
 * Generazione singolo giocatore.
 * Gli attributi sono bilanciati per ruolo e per "tier" della squadra
 * (top / medio / basso) → media e dispersione differenti.
 */

import type { Player, PlayerAttributes, Position, Foot, EntityId } from '$engine/types'
import type { Rng } from './rng'
import { generateId } from './rng'
import { randomFullName } from './names'

export type TeamTier = 'top' | 'mid' | 'low'

const POSITION_ROLE: Record<Position, 'GK' | 'DEF' | 'MID' | 'ATT'> = {
  GK: 'GK',
  CB: 'DEF', LB: 'DEF', RB: 'DEF', WB: 'DEF',
  DM: 'MID', CM: 'MID', AM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT',
}

const TIER_BASE: Record<TeamTier, number> = {
  top: 14,
  mid: 11,
  low: 8.5,
}

const TIER_STD: Record<TeamTier, number> = {
  top: 1.8,
  mid: 1.9,
  low: 2.0,
}

/** Bias di attributo per ruolo: quanto un attributo sale o scende rispetto alla base */
const ATTR_BIAS: Record<'GK' | 'DEF' | 'MID' | 'ATT', Partial<Record<keyof PlayerAttributes, number>>> = {
  GK: {
    reflexes: +5, handling: +5,
    passing: -3, shooting: -6, finishing: -6, dribbling: -5, crossing: -5,
    heading: -2, tackling: -3, pace: -2, vision: -1, strength: +1,
  },
  DEF: {
    tackling: +3, heading: +2, strength: +2, stamina: +1,
    finishing: -3, shooting: -3, dribbling: -2, crossing: -1,
    reflexes: -8, handling: -8,
  },
  MID: {
    passing: +2, vision: +2, stamina: +2, workRate: +2,
    tackling: +0, heading: -1, finishing: -1, crossing: +1,
    reflexes: -8, handling: -8,
  },
  ATT: {
    finishing: +3, shooting: +3, dribbling: +2, pace: +2, composure: +1,
    tackling: -3, heading: 0, strength: 0,
    reflexes: -8, handling: -8,
  }
}

const ALL_POSITIONS: Position[] = [
  'GK', 'CB', 'LB', 'RB', 'WB',
  'DM', 'CM', 'AM', 'LM', 'RM',
  'LW', 'RW', 'CF', 'ST'
]

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function clampAttr(n: number) {
  return clamp(Math.round(n), 1, 20)
}

export function generateAttributes(rng: Rng, position: Position, tier: TeamTier): PlayerAttributes {
  const role = POSITION_ROLE[position]
  const base = TIER_BASE[tier]
  const std = TIER_STD[tier]
  const bias = ATTR_BIAS[role]

  const a = (key: keyof PlayerAttributes) => clampAttr(rng.gauss(base + (bias[key] ?? 0), std))

  return {
    passing: a('passing'),
    shooting: a('shooting'),
    dribbling: a('dribbling'),
    finishing: a('finishing'),
    crossing: a('crossing'),
    tackling: a('tackling'),
    heading: a('heading'),
    pace: a('pace'),
    stamina: a('stamina'),
    strength: a('strength'),
    vision: a('vision'),
    composure: a('composure'),
    workRate: a('workRate'),
    reflexes: a('reflexes'),
    handling: a('handling'),
  }
}

/** Overall sintetico 1-99 per visualizzazione UI (media pesata per ruolo) */
export function calcOverall(player: Player): number {
  const a = player.attributes
  const role = POSITION_ROLE[player.position]
  let v: number
  switch (role) {
    case 'GK':
      v = a.reflexes * 0.35 + a.handling * 0.30 + a.composure * 0.10 + a.pace * 0.05
        + a.strength * 0.10 + a.vision * 0.10
      break
    case 'DEF':
      v = a.tackling * 0.25 + a.heading * 0.15 + a.strength * 0.15 + a.pace * 0.12
        + a.passing * 0.12 + a.composure * 0.10 + a.stamina * 0.06 + a.workRate * 0.05
      break
    case 'MID':
      v = a.passing * 0.22 + a.vision * 0.18 + a.dribbling * 0.12 + a.tackling * 0.10
        + a.stamina * 0.10 + a.workRate * 0.10 + a.shooting * 0.08 + a.composure * 0.10
      break
    default: // ATT
      v = a.finishing * 0.24 + a.shooting * 0.18 + a.dribbling * 0.16 + a.pace * 0.14
        + a.composure * 0.10 + a.heading * 0.08 + a.crossing * 0.05 + a.strength * 0.05
      break
  }
  // Scala 1-20 → 30-99 (più leggibile UI)
  return clamp(Math.round(30 + (v / 20) * 69), 30, 99)
}

/** Data di nascita ISO da età, riferita all'anno di stagione (1° luglio cutoff) */
function birthDateFromAge(age: number, seasonYear: number, rng: Rng): string {
  const year = seasonYear - age
  const month = rng.int(1, 12)
  const day = rng.int(1, 28)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface GenPlayerOptions {
  position: Position
  tier: TeamTier
  teamId: EntityId | null
  seasonYear: number
  nationality?: string
  shirtNumber?: number | null
}

export function generatePlayer(rng: Rng, opts: GenPlayerOptions): Player {
  const { firstName, lastName } = randomFullName(rng)
  // Distribuzione età realistica (mediana ~25, peak 22-28)
  const ageRoll = clamp(Math.round(rng.gauss(25, 4.5)), 17, 37)
  const attrs = generateAttributes(rng, opts.position, opts.tier)
  // Valore di mercato grezzo da overall e età (Fase 2: rivedere)
  const overallProxy =
    (attrs.passing + attrs.shooting + attrs.dribbling + attrs.finishing
      + attrs.tackling + attrs.pace + attrs.stamina + attrs.vision
      + attrs.composure + attrs.reflexes + attrs.handling) / 11
  const ageFactor = opts.position === 'GK'
    ? (ageRoll < 32 ? 1 : Math.max(0.3, 1 - (ageRoll - 32) * 0.15))
    : (ageRoll < 29 ? 1 : Math.max(0.2, 1 - (ageRoll - 29) * 0.15))
  const marketValue = Math.round(Math.pow(overallProxy, 3.2) * 1000 * ageFactor)

  const foot: Foot = rng.chance(0.78) ? 'right' : rng.chance(0.85) ? 'left' : 'both'

  // Secondary positions: 30% prob di averne una compatibile col ruolo
  const sec: Position[] = []
  if (rng.chance(0.3)) {
    const sameRole = ALL_POSITIONS.filter(p => POSITION_ROLE[p] === POSITION_ROLE[opts.position] && p !== opts.position)
    if (sameRole.length > 0) sec.push(rng.pick(sameRole))
  }

  return {
    id: generateId(rng),
    firstName,
    lastName,
    nationality: opts.nationality ?? 'IT',
    birthDate: birthDateFromAge(ageRoll, opts.seasonYear, rng),
    position: opts.position,
    secondaryPositions: sec,
    foot,
    attributes: attrs,
    marketValue,
    morale: rng.int(55, 85),
    fitness: rng.int(85, 100),
    teamId: opts.teamId,
    shirtNumber: opts.shirtNumber ?? null,
  }
}
