/**
 * Tipi del match engine.
 *
 * DESIGN CRITICO — vedi memoria [[project-match-view-2d-topdown]]:
 * il simulation engine produce uno stream di eventi che includono
 * coordinate spaziali (x, y) di palla e giocatori. Questo permette
 * di aggiungere in futuro un renderer 2D top-down completo senza
 * dover toccare l'engine. Il renderer "semplificato" iniziale userà
 * solo gli eventi chiave (gol, tiri, falli), ma i dati spaziali
 * sono già nello stream.
 */

import type { EntityId } from '$engine/types'

/** Coordinate normalizzate sul campo, origine in basso a sinistra.
 *  x: 0 (linea di porta home) → 1 (linea di porta away)
 *  y: 0 (fascia bassa) → 1 (fascia alta) */
export interface PitchPoint {
  x: number
  y: number
}

export type MatchEventKind =
  | 'kickoff'
  | 'half_time'
  | 'full_time'
  | 'pass'
  | 'dribble'
  | 'tackle'
  | 'shot'
  | 'shot_on_target'
  | 'goal'
  | 'save'
  | 'foul'
  | 'yellow_card'
  | 'red_card'
  | 'corner'
  | 'throw_in'
  | 'free_kick'
  | 'penalty'
  | 'substitution'
  | 'injury'

export type Side = 'home' | 'away'

/** Sotto-tipo del kind, per discriminare esiti specifici di rigori, espulsioni, ecc.
 *  Tutti i note con prefisso `pen_` qualificano l'evento come esito di un rigore. */
export type MatchEventNote =
  // Rigore MANCATO (palla non in porta)
  | 'pen_miss_high'        // alto sopra la traversa
  | 'pen_miss_wide_left'   // largo a sinistra
  | 'pen_miss_wide_right'  // largo a destra
  | 'pen_miss_post'        // palo
  | 'pen_miss_crossbar'    // traversa
  // Rigore PARATO dal portiere
  | 'pen_saved_left'       // parato a sinistra
  | 'pen_saved_center'     // parato al centro
  | 'pen_saved_right'      // parato a destra
  // Rigore SEGNATO (stile gol)
  | 'pen_goal_top_left'    // incrocio sinistro
  | 'pen_goal_top_right'   // incrocio destro
  | 'pen_goal_low_left'    // rasoterra a sinistra
  | 'pen_goal_low_right'   // rasoterra a destra
  | 'pen_goal_chip'        // cucchiaio centrale
  // Espulsione: distinzione per fanta-bonus
  | 'direct'               // rosso diretto (brutto fallo)
  | 'second_yellow'        // doppia ammonizione

export interface MatchEvent {
  /** Minuto simulato 0-90 (+ recupero) */
  minute: number
  /** Secondo del minuto 0-59, per ordinamento fine */
  second: number
  kind: MatchEventKind
  side: Side | null
  /** Coordinate palla al momento dell'evento (sempre presenti, anche se la view semplificata non le usa) */
  ballPosition: PitchPoint
  /** ID giocatore principale coinvolto (es. tiratore, falloso) */
  playerId?: EntityId
  /** ID giocatore secondario (es. assist man, fallato) */
  secondaryPlayerId?: EntityId
  /** Commentario testuale generato (può essere null se semplice movimento) */
  commentary?: string
  /** Sotto-tipo discriminante per esiti specifici (rigore sbagliato dove, red diretto, ecc.) */
  note?: MatchEventNote
}

export interface MatchSnapshot {
  homeId: EntityId
  awayId: EntityId
  minute: number
  second: number
  homeScore: number
  awayScore: number
  /** Posizioni di tutti i giocatori al tick attuale, key = playerId */
  positions: Map<EntityId, PitchPoint>
  /** Posizione palla */
  ballPosition: PitchPoint
}

/**
 * Interfaccia che ogni renderer della partita deve implementare.
 * Permette di intercambiare il renderer "semplificato" attuale
 * con un futuro renderer 2D top-down completo senza modificare l'engine.
 */
export interface MatchRenderer {
  /** Inizializza il renderer (DOM mount, setup canvas, ecc.) */
  init(container: HTMLElement): Promise<void> | void
  /** Chiamato a ogni nuovo evento del simulation engine */
  onEvent(event: MatchEvent): void
  /** Chiamato a ogni tick di simulazione (anche senza evento, per posizioni continue) */
  onTick(snapshot: MatchSnapshot): void
  /** Smonta il renderer, libera risorse */
  destroy(): void
}
