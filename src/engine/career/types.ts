/**
 * Tipi carriera: il contenitore di tutto lo stato di gioco serializzato.
 * Una Career == un savegame.
 */

import type { EntityId, Team, Player, Stadium, League, Season } from '$engine/types'
import type { Fixture } from '$engine/competition/types'
import type { Tactics, Lineup } from '$engine/tactics/types'
import type { BettingCareerData } from '$engine/betting/types'

export interface Manager {
  id: EntityId
  name: string
  /** ID squadra allenata; null se senza squadra (Fase 2+: free agent) */
  teamId: EntityId | null
  /** Reputazione 1-100 */
  reputation: number
  /** Stagioni completate con la squadra attuale */
  seasonsAtClub: number
}

/** Stato squadra del giocatore (tattica salvata + lineup correnti) */
export interface ClubState {
  teamId: EntityId
  tactics: Tactics
  lineup: Lineup
}

/** Notizia/evento in feed dashboard (rosa, partite, mercato, board) */
export interface NewsItem {
  id: EntityId
  /** Data ISO della news */
  date: string
  kind: 'match_result' | 'matchday_advance' | 'transfer' | 'board' | 'injury' | 'generic'
  title: string
  body?: string
  /** Letta dall'utente */
  read: boolean
}

/**
 * Container completo di una carriera salvata.
 * Tutto qui dentro viene serializzato e finisce in IndexedDB.
 */
export interface Career {
  /** Schema version per future migrazioni */
  schemaVersion: 1
  /** ID univoco della carriera (savegame) */
  id: EntityId
  /** Nome dello slot di salvataggio (es. "Carriera 1") */
  name: string
  /** Seed deterministico usato per generare il mondo */
  seed: number
  createdAt: number
  updatedAt: number

  manager: Manager
  season: Season

  /** Tutte le entità del mondo */
  teams: Record<EntityId, Team>
  players: Record<EntityId, Player>
  stadiums: Record<EntityId, Stadium>
  leagues: Record<EntityId, League>

  /** Calendario di tutte le competizioni (Fase 1: solo 2 leghe nazionali) */
  fixtures: Fixture[]

  /** Stato della squadra del giocatore */
  club: ClubState

  /** Feed news (max ~50, vecchie auto-purged) */
  news: NewsItem[]

  /**
   * Dati del modulo scommesse sportive. Opzionale per backward-compat con save legacy:
   * se mancante, ensureBettingData() in $engine/betting/orchestrator lo inizializza al volo.
   * Vedi docs/specs/betting/BETTING_SPEC.md.
   */
  bettingCareerData?: BettingCareerData
}
