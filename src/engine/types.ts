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

/**
 * Attributi giocatore scala 1-20 stile Football Manager (Sega/SI Games).
 *
 * Struttura piatta (no nested) per coerenza con l'engine match esistente che
 * legge `attributes.passing` ecc. I 15 attributi LEGACY (Fase 1-2) restano in
 * cima e continuano a essere usati dall'engine; i nuovi attributi FM (Fase 3.A)
 * sono opzionali per backward-compat con save legacy. Vengono popolati su nuovi
 * giocatori dal generator e su save vecchi tramite `ensurePlayerFMAttributes`.
 *
 * Totale attributi FM (Fase 3.A):
 * - 14 Tecnici (outfield only)
 * - 14 Mentali (shared GK+outfield)
 * - 8 Fisici (shared)
 * - 11 Goalkeeping (GK only)
 *
 * Hidden attributes (consistency, injury proneness, professionalism, ecc.)
 * saranno aggiunti in step futuro.
 */
export interface PlayerAttributes {
  // ===== LEGACY (Fase 1-2) — usati dall'engine match, restano =====
  passing: number
  shooting: number
  dribbling: number
  finishing: number
  crossing: number
  tackling: number
  heading: number
  pace: number
  stamina: number
  strength: number
  vision: number
  composure: number
  workRate: number
  reflexes: number
  handling: number

  // ===== TECHNICAL FM (outfield, opzionali per save legacy) =====
  corners?: number
  firstTouch?: number
  freeKicks?: number
  longShots?: number
  longThrows?: number
  marking?: number
  penaltyTaking?: number
  technique?: number

  // ===== MENTAL FM (shared, opzionali) =====
  aggression?: number
  anticipation?: number
  bravery?: number
  concentration?: number
  decisions?: number
  determination?: number
  flair?: number
  leadership?: number
  offTheBall?: number
  positioning?: number
  teamwork?: number

  // ===== PHYSICAL FM (shared, opzionali) =====
  acceleration?: number
  agility?: number
  balance?: number
  jumpingReach?: number
  naturalFitness?: number

  // ===== GOALKEEPING FM (GK only, opzionali) =====
  aerialReach?: number
  commandOfArea?: number
  communication?: number
  eccentricity?: number
  kicking?: number
  oneOnOnes?: number
  punchingTendency?: number
  rushingOutTendency?: number
  throwing?: number
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
  /**
   * Potential overall nascosto 30-99 — overall massimo che il giocatore può
   * raggiungere durante la sua carriera. Assegnato alla generazione, immutabile.
   * Usato dalla curva di crescita/declino in Fase 3.B (endOfSeason ageTick).
   * Opzionale per backward-compat con save legacy: se mancante,
   * `ensurePlayerFMAttributes` lo deduce come `currentOverall + bonus` per dare
   * margine di crescita ai giovani.
   */
  potential?: number

  /**
   * Contratto col club attuale (Fase 3.D). Opzionale per backward-compat con
   * save legacy: se mancante, `ensurePlayerContract` lo inizializza al volo
   * (durata 1-5 anni, stipendio calibrato su overall+team rep).
   * Null se svincolato (teamId null).
   */
  contract?: PlayerContract
}

/**
 * Contratto giocatore-club. Stipendio settimanale + finestra temporale.
 * Fase 3.D foundation; le scadenze effettive (svincolo, rinnovi) entrano in
 * Fase 3.G (mercato).
 */
export interface PlayerContract {
  /** Anno di inizio contratto (stagione X = es. 2026) */
  startYear: number
  /** Anno di scadenza contratto (fine giugno endYear) */
  endYear: number
  /** Stipendio settimanale in € */
  weeklyWage: number
  /** Bonus alla firma in € (per rinnovi futuri) */
  signingBonus?: number
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
