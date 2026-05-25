/**
 * Wrapper IndexedDB per salvataggi locali del giocatore.
 * Single-player offline-first: tutti i save vivono qui, sul device dell'utente.
 *
 * Struttura DB:
 *  - saves  → carriere salvate (keyPath: id, indici: updatedAt)
 *  - meta   → impostazioni globali (lingua, audio, last opened save id, ecc.)
 *
 * Il "valore" salvato per ogni carriera è l'intero oggetto Career (schemaVersion 1).
 * Per economia/migrazioni future si possono aggiungere campi di indice.
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { Career } from '$engine/career/types'

const DB_NAME = 'football-manager'
const DB_VERSION = 1

/** Struttura riassuntiva di una carriera per liste/UI (no payload pesante) */
export interface CareerSummary {
  id: string
  name: string
  teamName: string
  managerName: string
  seasonYear: number
  matchday: number
  createdAt: number
  updatedAt: number
}

/** Record persistito su disco: la Career stessa + alcuni indici per ricerca veloce */
export interface PersistedCareer {
  /** keyPath */
  id: string
  /** Nome del salvataggio */
  name: string
  /** Indici denormalizzati per non leggere l'intero blob in list */
  teamName: string
  managerName: string
  seasonYear: number
  matchday: number
  createdAt: number
  updatedAt: number
  /** Intero stato carriera serializzato */
  career: Career
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('saves')) {
          const store = db.createObjectStore('saves', { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta')
        }
      },
    })
  }
  return dbPromise
}

// ====== Carriere ======

function summaryOf(p: PersistedCareer): CareerSummary {
  return {
    id: p.id, name: p.name, teamName: p.teamName, managerName: p.managerName,
    seasonYear: p.seasonYear, matchday: p.matchday,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  }
}

function persistedOf(career: Career): PersistedCareer {
  const myTeam = career.teams[career.club.teamId]
  return {
    id: career.id,
    name: career.name,
    teamName: myTeam?.name ?? '???',
    managerName: career.manager.name,
    seasonYear: career.season.year,
    matchday: career.season.currentMatchday,
    createdAt: career.createdAt,
    updatedAt: Date.now(),
    career,
  }
}

export async function listCareers(): Promise<CareerSummary[]> {
  const db = await getDb()
  const all = (await db.getAll('saves')) as PersistedCareer[]
  return all
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summaryOf)
}

export async function hasAnySave(): Promise<boolean> {
  const db = await getDb()
  const count = await db.count('saves')
  return count > 0
}

export async function loadCareer(id: string): Promise<Career | null> {
  const db = await getDb()
  const rec = (await db.get('saves', id)) as PersistedCareer | undefined
  return rec?.career ?? null
}

export async function saveCareer(career: Career): Promise<void> {
  const db = await getDb()
  const rec = persistedOf(career)
  career.updatedAt = rec.updatedAt
  // IndexedDB usa structured clone, che fallisce sui Proxy di Svelte 5 $state.
  // JSON round-trip restituisce un POJO puro serializzabile (tutto il nostro
  // schema è già JSON-safe per design — niente Map/Set/Date/funzioni).
  const pojo = JSON.parse(JSON.stringify(rec)) as PersistedCareer
  await db.put('saves', pojo)
}

export async function deleteCareer(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('saves', id)
}

// ====== Meta ======

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDb()
  return db.get('meta', key)
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('meta', value, key)
}

// ====== Backward-compat shim ======
// La Home/landing usa hasAnySave() che è invariata.
// Le vecchie API listSaves/getSave/putSave/deleteSave non sono più usate
// e sono state rimpiazzate dalle "Career" sopra.
