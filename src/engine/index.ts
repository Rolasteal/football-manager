/**
 * Entry point del game engine.
 * Tutta la logica di gioco vive sotto src/engine/ ed è completamente
 * disaccoppiata dalla view (UI Svelte) e dallo storage (IndexedDB).
 *
 * Regole architetturali:
 * - Funzioni pure, niente accesso al DOM
 * - Niente import di Svelte/PixiJS qui sotto
 * - Stati serializzabili in JSON per salvataggio
 */

export type * from './types'
export type * from './match/types'
