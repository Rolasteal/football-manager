/**
 * Funzioni di generazione nomi (giocatori, squadre, città, stadi).
 * Tutte deterministiche dato un Rng.
 */

import type { Rng } from './rng'
import {
  FIRST_NAMES, LAST_NAMES, CITY_PREFIXES, CITY_ROOTS,
  TEAM_PREFIXES, TEAM_SUFFIXES, TEAM_PREFIX_PROB, TEAM_SUFFIX_PROB,
  TEAM_COLORS, STADIUM_TYPES, STADIUM_DEDICATEES
} from './data'

export function randomFirstName(rng: Rng): string {
  return rng.pick(FIRST_NAMES)
}

export function randomLastName(rng: Rng): string {
  return rng.pick(LAST_NAMES)
}

export function randomFullName(rng: Rng): { firstName: string; lastName: string } {
  return { firstName: randomFirstName(rng), lastName: randomLastName(rng) }
}

export function randomCity(rng: Rng): string {
  // ~50% solo radice, ~50% prefisso + radice
  const root = rng.pick(CITY_ROOTS)
  return rng.chance(0.5) ? `${rng.pick(CITY_PREFIXES)} ${root}` : root
}

/** Sigla 3 lettere dalla città (per shortName squadra) */
export function shortFromCity(city: string): string {
  const clean = city.replace(/[^A-Za-zàèéìòù]/g, '')
  return clean.slice(0, 3).toUpperCase()
}

export interface GeneratedTeamName {
  name: string
  shortName: string
  city: string
}

export function randomTeamName(rng: Rng, cityOverride?: string): GeneratedTeamName {
  const city = cityOverride ?? randomCity(rng)
  const parts: string[] = []
  if (rng.chance(TEAM_PREFIX_PROB)) parts.push(rng.pick(TEAM_PREFIXES))
  parts.push(city)
  if (rng.chance(TEAM_SUFFIX_PROB)) {
    const suffix = rng.pick(TEAM_SUFFIXES)
    if (suffix) parts.push(suffix)
  }
  // Evita "FC X FC" o ridondanze stupide
  const dedup = Array.from(new Set(parts))
  const name = dedup.join(' ').replace(/\s+/g, ' ').trim()
  return {
    name,
    shortName: shortFromCity(city),
    city
  }
}

export function randomTeamColors(rng: Rng): { primary: string; secondary: string } {
  const [primary, secondary] = rng.pick(TEAM_COLORS)
  return { primary, secondary }
}

export function randomStadiumName(rng: Rng, city: string): string {
  const type = rng.pick(STADIUM_TYPES)
  // 60% intitolato a persona, 40% al nome città
  if (rng.chance(0.6)) {
    return `${type} ${rng.pick(STADIUM_DEDICATEES)}`
  }
  return `${type} di ${city}`
}
