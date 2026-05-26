/**
 * Stadium upgrades user-built — Fase 3.E.
 *
 * Roberto decide quando avviare un lavoro infrastrutturale (NO auto-espansioni).
 * Ogni lavoro:
 * - costa una somma totale rateizzata mensilmente (drenata in weeklyTick)
 * - dura N matchday/settimane prima di completare
 * - quando completa, applica gli effetti allo Stadium (capacity / premium / pitch)
 *
 * Vincoli:
 * - 1 solo lavoro alla volta per stadio (semplicità 3.E)
 * - serve cassa sufficiente per avviare (rifiuto se cash < totalCost * 0.3 = first installment + buffer)
 * - se durante il lavoro la cassa va in rosso, il lavoro NON si ferma (per ora;
 *   Fase 3.F penalty board / interesse banca)
 */

import type { Career } from './types'
import type { Stadium, StadiumWork, StadiumWorkType } from '$engine/types'
import { generateId, createRng } from '$engine/gen/rng'

// ====== Catalogo lavori ======

export interface StadiumWorkSpec {
  type: StadiumWorkType
  name: string
  description: string
  totalCost: number
  durationMatchdays: number
  capacityDelta?: number
  premiumPriceDelta?: number
  pitchQualityDelta?: number
  /** Icona per UI (emoji-like) */
  icon: string
}

/**
 * Catalogo dei lavori disponibili. Numeri calibrati per gameplay accessibile
 * a club di Serie A media: i grandi lavori richiedono 1+ stagione e mordono
 * seriamente la cassa.
 *
 * Durata in matchday = settimane reali (1 stagione = 38 matchday).
 */
export const STADIUM_WORK_CATALOG: StadiumWorkSpec[] = [
  {
    type: 'expand_small',
    name: 'Espansione gradinata',
    description: 'Aggiunge 5.000 posti alle gradinate distinti. Lavori da 6 mesi.',
    totalCost: 7_500_000,
    durationMatchdays: 26,
    capacityDelta: 5_000,
    icon: '🏟️',
  },
  {
    type: 'expand_large',
    name: 'Espansione completa',
    description: 'Aggiunge 12.000 posti distribuiti su 2 settori. Cantiere di 1 stagione.',
    totalCost: 15_000_000,
    durationMatchdays: 52,
    capacityDelta: 12_000,
    icon: '🏗️',
  },
  {
    type: 'premium_sector',
    name: 'Settore Premium / Sky-box',
    description: 'Box e tribuna VIP. +€3 al prezzo medio biglietto. 4 mesi di lavori.',
    totalCost: 4_000_000,
    durationMatchdays: 17,
    premiumPriceDelta: 3,
    icon: '💎',
  },
  {
    type: 'pitch_quality',
    name: 'Rifacimento manto erboso',
    description: 'Drenaggio + erba ibrida. Qualità campo +10 (max 100). 2 mesi.',
    totalCost: 1_500_000,
    durationMatchdays: 9,
    pitchQualityDelta: 10,
    icon: '🌱',
  },
]

/** Lookup catalogo da tipo */
export function getStadiumWorkSpec(type: StadiumWorkType): StadiumWorkSpec | undefined {
  return STADIUM_WORK_CATALOG.find(w => w.type === type)
}

// ====== Validazione + avvio ======

export interface StartWorkResult {
  ok: boolean
  reason?: string
  work?: StadiumWork
}

/**
 * Avvia un lavoro sullo stadio del MIO club.
 * Valida:
 * - Nessun lavoro attivo
 * - Cassa sufficiente (almeno 30% del costo per coprire le prime rate + buffer)
 *
 * NB: il pagamento avviene rateizzato in weeklyTick, non sottrae nulla qui.
 * La validazione cassa è solo per evitare di avviare lavori che il club non
 * potrebbe sostenere.
 *
 * Returns: { ok, work? } o { ok: false, reason: string }.
 */
export function startStadiumWork(career: Career, type: StadiumWorkType): StartWorkResult {
  const spec = getStadiumWorkSpec(type)
  if (!spec) return { ok: false, reason: 'Tipo di lavoro sconosciuto.' }

  const myTeam = career.teams[career.club.teamId]
  if (!myTeam) return { ok: false, reason: 'Team del giocatore non trovato.' }

  const stadium = career.stadiums[myTeam.stadiumId]
  if (!stadium) return { ok: false, reason: 'Stadio del club non trovato.' }

  if (stadium.activeWork) {
    return { ok: false, reason: 'C\'è già un lavoro in corso. Aspetta che termini prima di avviarne un altro.' }
  }

  const cash = career.clubFinances?.cash ?? myTeam.balance
  if (cash < spec.totalCost * 0.30) {
    return {
      ok: false,
      reason: `Cassa insufficiente: servono almeno il 30% del costo (€${(spec.totalCost * 0.30 / 1_000_000).toFixed(1)}M) per coprire le prime rate.`,
    }
  }

  // Crea il work
  const rng = createRng((career.seed ^ career.season.currentMatchday ^ type.charCodeAt(0) ^ 0x57AD10) >>> 0)
  const work: StadiumWork = {
    id: generateId(rng),
    type: spec.type,
    startedAtMatchday: career.season.currentMatchday,
    totalCost: spec.totalCost,
    paidSoFar: 0,
    durationMatchdays: spec.durationMatchdays,
    remainingMatchdays: spec.durationMatchdays,
    capacityDelta: spec.capacityDelta,
    premiumPriceDelta: spec.premiumPriceDelta,
    pitchQualityDelta: spec.pitchQualityDelta,
  }
  stadium.activeWork = work

  // News
  career.news.unshift({
    id: generateId(rng),
    date: new Date().toISOString().slice(0, 10),
    kind: 'board',
    title: `${spec.icon} Avviati lavori: ${spec.name}`,
    body: `Il club ha avviato i lavori "${spec.name}". Costo totale €${(spec.totalCost / 1_000_000).toFixed(1)}M rateizzato su ${spec.durationMatchdays} settimane.`,
    read: false,
  })

  career.updatedAt = Date.now()
  return { ok: true, work }
}

// ====== Tick settimanale + completamento ======

/**
 * Applicato a ogni weeklyTick (Fase 3.1): paga la rata settimanale, decrementa
 * remainingMatchdays. Quando arriva a 0, completa il lavoro e applica gli effetti.
 *
 * Ritorna l'importo drenato dalla cassa questa settimana (per logging history).
 * 0 se nessun lavoro attivo.
 */
export function applyStadiumWorkTick(career: Career, matchday: number): { drained: number; completed?: StadiumWork } {
  const myTeam = career.teams[career.club.teamId]
  if (!myTeam) return { drained: 0 }
  const stadium = career.stadiums[myTeam.stadiumId]
  if (!stadium || !stadium.activeWork) return { drained: 0 }

  const work = stadium.activeWork
  const rate = Math.round(work.totalCost / work.durationMatchdays)
  work.paidSoFar += rate
  work.remainingMatchdays = Math.max(0, work.remainingMatchdays - 1)

  let completed: StadiumWork | undefined
  if (work.remainingMatchdays === 0) {
    // Allinea paidSoFar al totalCost (gestisce arrotondamenti)
    const finalRate = Math.max(0, work.totalCost - (work.paidSoFar - rate))
    work.paidSoFar = work.totalCost
    completed = { ...work, paidSoFar: work.totalCost, remainingMatchdays: 0 }

    // Applica effetti allo stadium
    if (work.capacityDelta) stadium.capacity += work.capacityDelta
    if (work.pitchQualityDelta) {
      stadium.pitchQuality = Math.min(100, stadium.pitchQuality + work.pitchQualityDelta)
    }
    if (work.premiumPriceDelta) {
      stadium.premiumPriceBonus = (stadium.premiumPriceBonus ?? 0) + work.premiumPriceDelta
    }

    // News completamento
    const spec = getStadiumWorkSpec(work.type)
    career.news.unshift({
      id: generateId(createRng((career.seed ^ matchday ^ 0x57AC0E) >>> 0)),
      date: new Date().toISOString().slice(0, 10),
      kind: 'board',
      title: `${spec?.icon ?? '🏟️'} Completati lavori: ${spec?.name ?? work.type}`,
      body: `${spec?.description ?? ''} Effetti applicati immediatamente allo stadio.`,
      read: false,
    })

    // Libera lo slot lavori
    stadium.activeWork = undefined

    return { drained: finalRate, completed }
  }

  return { drained: rate }
}

// ====== Helpers UI ======

/**
 * Progress 0..1 di un lavoro in corso (1 = quasi completato).
 */
export function workProgress(work: StadiumWork): number {
  return 1 - (work.remainingMatchdays / work.durationMatchdays)
}
