/**
 * Wrapper IndexedDB per salvataggi locali del giocatore.
 * Single-player offline-first: tutti i save vivono qui, sul device dell'utente.
 *
 * Struttura DB:
 *  - saves: chiave = id univoco salvataggio, valore = SaveBlob (snapshot gioco serializzato)
 *  - meta: chiave/valore per impostazioni globali (lingua, audio, ecc.)
 */

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'football-manager'
const DB_VERSION = 1

export interface SaveBlob {
  id: string
  name: string
  teamName: string
  managerName: string
  seasonYear: number
  matchday: number
  createdAt: number
  updatedAt: number
  /** Snapshot completo dello stato di gioco (serializzato JSON) */
  state: unknown
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

export async function listSaves(): Promise<SaveBlob[]> {
  const db = await getDb()
  const all = await db.getAll('saves')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function hasAnySave(): Promise<boolean> {
  const db = await getDb()
  const count = await db.count('saves')
  return count > 0
}

export async function getSave(id: string): Promise<SaveBlob | undefined> {
  const db = await getDb()
  return db.get('saves', id)
}

export async function putSave(save: SaveBlob): Promise<void> {
  const db = await getDb()
  await db.put('saves', { ...save, updatedAt: Date.now() })
}

export async function deleteSave(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('saves', id)
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDb()
  return db.get('meta', key)
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('meta', value, key)
}
