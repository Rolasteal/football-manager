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

// Tipi base dominio
export type * from './types'
// Tipi match (eventi, snapshot, renderer interface)
export type * from './match/types'
// Tipi tattici
export type * from './tactics/types'
// Tipi competizione (fixture, risultati, classifica)
export type * from './competition/types'
// Tipi carriera (save container)
export type * from './career/types'
