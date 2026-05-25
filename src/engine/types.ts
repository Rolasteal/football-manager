/**
 * Tipi base del dominio calcistico — condivisi tra engine, UI e storage.
 * Tutti i tipi qui dentro devono essere serializzabili in JSON
 * perché finiscono nei salvataggi su IndexedDB.
 */

export type EntityId = string

export type Position =
  | 'GK'  // portiere
  | 'CB' | 'LB' | 'RB' | 'WB'  // difensori
  | 'DM' | 'CM' | 'AM' | 'LM' | 'RM'  // centrocampisti
  | 'LW' | 'RW' | 'CF' | 'ST'  // attaccanti

export type Foot = 'left' | 'right' | 'both'

/** Attributi giocatore scala 1-20 stile FM */
export interface PlayerAttributes {
  // Tecnici
  passing: number
  shooting: number
  dribbling: number
  finishing: number
  crossing: number
  tackling: number
  heading: number
  // Fisici
  pace: number
  stamina: number
  strength: number
  // Mentali
  vision: number
  composure: number
  workRate: number
  // Specifici portiere
  reflexes: number
  handling: number
}

export interface Player {
  id: EntityId
  firstName: string
  lastName: string
  nationality: string  // ISO alpha-2
  birthDate: string  // ISO date
  position: Position
  secondaryPositions: Position[]
  foot: Foot
  attributes: PlayerAttributes
  /** Valore di mercato in euro */
  marketValue: number
  /** Morale 0-100 */
  morale: number
  /** Forma fisica 0-100 */
  fitness: number
  /** Squadra attuale, null se svincolato */
  teamId: EntityId | null
  /** Numero di maglia, null se non assegnato */
  shirtNumber: number | null
}

export interface Team {
  id: EntityId
  name: string
  shortName: string  // 3 lettere es. "JUV"
  city: string
  country: string  // ISO alpha-2
  founded: number
  /** Colori principali (per UI/match view) */
  primaryColor: string
  secondaryColor: string
  /** Riferimento allo stadio */
  stadiumId: EntityId
  /** Reputazione globale 1-100 (influenza appeal mercato, sponsor) */
  reputation: number
  /** Cassa club in euro */
  balance: number
}

export interface Stadium {
  id: EntityId
  name: string
  capacity: number
  /** Qualità campo 1-100 (influenza infortuni / spettacolo) */
  pitchQuality: number
  /** Settori — per costruzione/espansione (Fase 3) */
  sectors?: StadiumSector[]
}

export interface StadiumSector {
  id: EntityId
  name: string
  capacity: number
  ticketPrice: number
}

export interface League {
  id: EntityId
  name: string
  country: string
  tier: number  // 1 = serie A, 2 = serie B...
  teamIds: EntityId[]
}

export interface Season {
  year: number  // es. 2026 per stagione 2026/27
  currentMatchday: number
  totalMatchdays: number
}
