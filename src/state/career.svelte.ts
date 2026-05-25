/**
 * Store reattivo globale della Career attiva.
 * Svelte 5 runes: lo stato vive qui, le route lo leggono e mutano via API esposte.
 *
 * Pattern: carichiamo da IndexedDB una volta sola all'avvio (o all'ingresso in dashboard),
 * tutte le mutazioni (advanceMatchday, save tattica, ecc.) modificano lo stato in memoria
 * + persistono async su IndexedDB.
 */

import type { Career } from '$engine/career/types'
import { loadCareer, saveCareer } from '$storage/db'

interface CareerStore {
  career: Career | null
  loading: boolean
  error: string | null
}

const store = $state<CareerStore>({
  career: null,
  loading: false,
  error: null,
})

export function careerStore() {
  return store
}

/** Mette in memoria una career appena creata (senza ricaricare da disco). */
export function setActiveCareer(career: Career) {
  store.career = career
  store.error = null
}

export async function loadActiveCareer(id: string): Promise<Career | null> {
  store.loading = true
  store.error = null
  try {
    const c = await loadCareer(id)
    store.career = c
    return c
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e)
    return null
  } finally {
    store.loading = false
  }
}

export async function persistActiveCareer(): Promise<void> {
  if (!store.career) return
  try {
    await saveCareer(store.career)
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e)
  }
}

export function clearActiveCareer() {
  store.career = null
}
