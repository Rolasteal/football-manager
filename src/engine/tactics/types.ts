/**
 * Tipi tattici: formazione, lineup, istruzioni squadra.
 * Tutti serializzabili in JSON (live nei salvataggi carriera).
 */

import type { EntityId, Position } from '$engine/types'

/** Schemi tattici disponibili in Fase 1 MVP. Aggiunte in Fase 2. */
export type FormationName =
  | '4-4-2'
  | '4-3-3'
  | '4-2-3-1'
  | '3-5-2'
  | '5-3-2'
  | '4-5-1'

/** Slot di una formazione: ruolo + posizione sul campo (coord normalizzate 0-1) */
export interface FormationSlot {
  position: Position
  /** x 0-1 (0 = propria porta, 1 = porta avversaria) */
  x: number
  /** y 0-1 (0 = fascia bassa, 1 = fascia alta) */
  y: number
}

export interface Formation {
  name: FormationName
  slots: FormationSlot[]  // sempre 11
}

/** Mentalità globale della squadra in partita */
export type Mentality = 'very_defensive' | 'defensive' | 'balanced' | 'attacking' | 'very_attacking'

/** Ritmo di gioco */
export type Tempo = 'slow' | 'normal' | 'fast'

/** Pressing */
export type Pressing = 'low' | 'mid' | 'high'

export interface Tactics {
  formation: FormationName
  mentality: Mentality
  tempo: Tempo
  pressing: Pressing
  /** ID giocatore capitano (deve essere in lineup) */
  captainId?: EntityId
  /** ID giocatore rigorista */
  penaltyTakerId?: EntityId
}

/** 11 titolari (ordinati per slot della formazione) + panchina (max 7) */
export interface Lineup {
  formation: FormationName
  starters: EntityId[]   // length === 11, indice == slot della formazione
  bench: EntityId[]      // length 0..7
}
