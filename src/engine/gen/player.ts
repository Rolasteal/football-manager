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

/**
 * Bias di attributo per ruolo: quanto un attributo sale o scende rispetto alla
 * base del tier. Copre l'intero set FM (Fase 3.A): tecnici, mentali, fisici,
 * goalkeeping. Stile FM Sega: GK ha attributi specifici tutti alti e tecnici
 * outfield tutti molto bassi; DEF marking/tackling/heading/jumping; MID
 * passing/vision/teamwork; ATT finishing/composure/offTheBall.
 */
const ATTR_BIAS: Record<'GK' | 'DEF' | 'MID' | 'ATT', Partial<Record<keyof PlayerAttributes, number>>> = {
  GK: {
    // Goalkeeping FM: tutti alti
    reflexes: +5, handling: +5, aerialReach: +4, commandOfArea: +4,
    communication: +3, kicking: +3, oneOnOnes: +4, throwing: +3,
    eccentricity: 0, punchingTendency: 0, rushingOutTendency: 0,
    // Outfield tecnici: praticamente assenti
    passing: -3, shooting: -6, finishing: -7, dribbling: -6, crossing: -6,
    heading: -3, tackling: -4, corners: -7, firstTouch: -3, freeKicks: -5,
    longShots: -7, longThrows: -2, marking: -3, penaltyTaking: -6, technique: -3,
    // Mentali specifici del portiere: alti concentration/anticipation/positioning
    concentration: +3, anticipation: +3, positioning: +3, decisions: +2,
    composure: +2, bravery: +2, leadership: +1,
    flair: -2, offTheBall: -5, teamwork: 0, workRate: -1, vision: 0,
    aggression: 0, determination: +1,
    // Fisici: strength e jumping discreti, pace e acceleration medi
    pace: -1, acceleration: -1, agility: +1, balance: +1, jumpingReach: +2,
    strength: +1, stamina: -1, naturalFitness: +1,
  },
  DEF: {
    // Tecnici difensivi alti, attaccanti bassi
    tackling: +3, marking: +4, heading: +2, longThrows: +1,
    finishing: -4, shooting: -4, dribbling: -2, crossing: -1, corners: -1,
    firstTouch: 0, freeKicks: -2, longShots: -3, penaltyTaking: -3,
    technique: -1, passing: 0,
    // Mentali: positioning/anticipation/concentration alti, flair basso
    positioning: +3, anticipation: +2, concentration: +2, bravery: +2,
    determination: +1, leadership: +1, aggression: +1, decisions: +1,
    teamwork: +1, workRate: +1, composure: 0,
    flair: -2, offTheBall: -2, vision: -1,
    // Fisici: strength, jumping, balance alti
    strength: +2, jumpingReach: +2, stamina: +1, balance: +1,
    pace: 0, acceleration: 0, agility: 0, naturalFitness: 0,
    // Goalkeeping: nulli
    reflexes: -8, handling: -8, aerialReach: -8, commandOfArea: -8,
    communication: -7, kicking: -7, oneOnOnes: -8, throwing: -7,
    eccentricity: -5, punchingTendency: -5, rushingOutTendency: -5,
  },
  MID: {
    // Tecnici: passing, technique, firstTouch alti; finishing/heading medi
    passing: +3, technique: +2, firstTouch: +2, freeKicks: +1, corners: +1,
    crossing: +1, longShots: +1, longThrows: 0, dribbling: +1,
    heading: -1, finishing: -1, marking: 0, tackling: 0, shooting: 0,
    penaltyTaking: 0,
    // Mentali: vision, decisions, teamwork, workRate alti
    vision: +3, decisions: +2, teamwork: +2, workRate: +2, anticipation: +2,
    positioning: +1, concentration: +1, composure: +1, determination: +1,
    flair: +1, offTheBall: +1, bravery: 0, leadership: 0, aggression: 0,
    // Fisici: stamina, naturalFitness, balance alti
    stamina: +2, naturalFitness: +2, balance: +1, agility: +1,
    pace: 0, acceleration: 0, jumpingReach: 0, strength: 0,
    // Goalkeeping: nulli
    reflexes: -8, handling: -8, aerialReach: -8, commandOfArea: -8,
    communication: -7, kicking: -7, oneOnOnes: -8, throwing: -7,
    eccentricity: -5, punchingTendency: -5, rushingOutTendency: -5,
  },
  ATT: {
    // Tecnici: finishing, dribbling, technique, firstTouch, longShots alti
    finishing: +4, shooting: +3, dribbling: +3, technique: +2, firstTouch: +2,
    longShots: +2, penaltyTaking: +1, crossing: 0, corners: 0, freeKicks: +1,
    heading: 0, longThrows: -1, marking: -3, tackling: -3, passing: -1,
    // Mentali: offTheBall, composure, anticipation, flair alti
    offTheBall: +3, composure: +2, anticipation: +2, flair: +2, decisions: +1,
    determination: +1, bravery: +1, concentration: +1, workRate: 0,
    aggression: 0, vision: +1, teamwork: 0, leadership: 0, positioning: 0,
    // Fisici: pace, acceleration, agility, balance alti
    pace: +2, acceleration: +2, agility: +2, balance: +1, jumpingReach: 0,
    strength: 0, stamina: 0, naturalFitness: 0,
    // Goalkeeping: nulli
    reflexes: -8, handling: -8, aerialReach: -8, commandOfArea: -8,
    communication: -7, kicking: -7, oneOnOnes: -8, throwing: -7,
    eccentricity: -5, punchingTendency: -5, rushingOutTendency: -5,
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
    // --- LEGACY (Fase 1-2, usati ancora dall'engine match) ---
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

    // --- TECHNICAL FM (Fase 3.A, outfield principalmente) ---
    corners: a('corners'),
    firstTouch: a('firstTouch'),
    freeKicks: a('freeKicks'),
    longShots: a('longShots'),
    longThrows: a('longThrows'),
    marking: a('marking'),
    penaltyTaking: a('penaltyTaking'),
    technique: a('technique'),

    // --- MENTAL FM (shared) ---
    aggression: a('aggression'),
    anticipation: a('anticipation'),
    bravery: a('bravery'),
    concentration: a('concentration'),
    decisions: a('decisions'),
    determination: a('determination'),
    flair: a('flair'),
    leadership: a('leadership'),
    offTheBall: a('offTheBall'),
    positioning: a('positioning'),
    teamwork: a('teamwork'),

    // --- PHYSICAL FM (shared) ---
    acceleration: a('acceleration'),
    agility: a('agility'),
    balance: a('balance'),
    jumpingReach: a('jumpingReach'),
    naturalFitness: a('naturalFitness'),

    // --- GOALKEEPING FM (GK principalmente) ---
    aerialReach: a('aerialReach'),
    commandOfArea: a('commandOfArea'),
    communication: a('communication'),
    eccentricity: a('eccentricity'),
    kicking: a('kicking'),
    oneOnOnes: a('oneOnOnes'),
    punchingTendency: a('punchingTendency'),
    rushingOutTendency: a('rushingOutTendency'),
    throwing: a('throwing'),
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
  // marketValue iniziale: PLACEHOLDER. Il valore finale viene calcolato sotto
  // dopo aver creato il Player, via recalculateMarketValue (formula unificata
  // Serie A 2024 in `$engine/career/aging.ts`). Fase 3.G fix-values.
  const marketValue = 0

  const foot: Foot = rng.chance(0.78) ? 'right' : rng.chance(0.85) ? 'left' : 'both'

  // Secondary positions: 30% prob di averne una compatibile col ruolo
  const sec: Position[] = []
  if (rng.chance(0.3)) {
    const sameRole = ALL_POSITIONS.filter(p => POSITION_ROLE[p] === POSITION_ROLE[opts.position] && p !== opts.position)
    if (sameRole.length > 0) sec.push(rng.pick(sameRole))
  }

  // Potential nascosto (Fase 3.A foundation per Fase 3.B):
  // - Giovane (<23): potential supera l'overall attuale di 5-18 punti → ha margine di crescita
  // - Picco (24-28): potential ≈ overall attuale ±2 → è al top o quasi
  // - Veterano (29+): potential = overall storico al picco, ora già in declino
  // Tutti i player vengono creati con un potential coerente al loro overall corrente.
  const player: Player = {
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
  const currentOvr = calcOverall(player)
  let growthRoom: number
  if (ageRoll < 20) growthRoom = rng.int(10, 18)       // giovanissimo, grossa crescita
  else if (ageRoll < 23) growthRoom = rng.int(5, 12)   // giovane, crescita media
  else if (ageRoll < 26) growthRoom = rng.int(1, 6)    // pre-picco, lieve
  else if (ageRoll <= 28) growthRoom = rng.int(0, 2)   // picco, quasi nulla
  else growthRoom = rng.int(-3, 0)                     // post-picco, potential = peak storico
  player.potential = clamp(currentOvr + growthRoom + (ageRoll >= 29 ? Math.round((ageRoll - 28) * 1.5) : 0), 30, 99)

  // Fase 3.G fix-values: marketValue calibrato Serie A 2024 via formula unificata.
  // Inline qui per evitare import circolare (aging.ts dipende da player.ts).
  // Stessa formula di `recalculateMarketValue` in career/aging.ts.
  player.marketValue = computeInitialMarketValue(player, opts.seasonYear)
  return player
}

/**
 * Calcola il valore di mercato iniziale di un giocatore appena generato.
 * Stessa formula di `recalculateMarketValue` in `$engine/career/aging.ts`,
 * duplicata qui per evitare l'import circolare (aging.ts importa da player.ts).
 *
 * Vedi commento in `recalculateMarketValue` per il dettaglio della calibrazione.
 */
function computeInitialMarketValue(player: Player, refYear: number): number {
  const overall = calcOverall(player)
  const b = new Date(player.birthDate)
  const ref = new Date(`${refYear}-07-01`)
  let realAge = ref.getUTCFullYear() - b.getUTCFullYear()
  const m = ref.getUTCMonth() - b.getUTCMonth()
  if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) realAge--
  const effAge = player.position === 'GK' ? Math.max(16, realAge - 3) : realAge

  let ageFactor: number
  if (effAge <= 17) ageFactor = 0.45
  else if (effAge <= 20) ageFactor = 0.65
  else if (effAge <= 23) ageFactor = 0.90
  else if (effAge <= 28) ageFactor = 1.00
  else if (effAge <= 30) ageFactor = 0.85
  else if (effAge <= 32) ageFactor = 0.60
  else if (effAge <= 34) ageFactor = 0.35
  else ageFactor = 0.15

  const base = Math.pow(1.85, (overall - 50) / 5) * 1_200_000
  const pot = player.potential ?? overall
  let potBonus = 1
  if (effAge <= 22) {
    const gap = pot - overall
    if (gap >= 10) potBonus = 1.5
    else if (gap >= 5) potBonus = 1.25
  }
  const raw = Math.max(100_000, base * ageFactor * potBonus)
  return Math.round(raw / 100_000) * 100_000
}
