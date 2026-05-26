/**
 * Orchestratore "Inizia Nuova Stagione" — Fase 3.C.
 *
 * Esegue in sequenza:
 * 1. endOfSeasonAgeTick: aging giocatori + ricalc valore mercato
 * 2. generateYouthPoolForSeason: promuove giovani 16-19 dai vivai
 * 3. buildNewSeasonFixtures: cancella fixtures vecchi e ne genera di nuovi
 * 4. Reset stato season: currentMatchday → 1 (già fatto da ageTick), year +1
 * 5. News riepilogativa con top prospects
 *
 * Deterministic: stesso seed + stagione = stessa nuova stagione (test-safe).
 */

import type { Career } from './types'
import { createRng, generateId } from '$engine/gen/rng'
import { endOfSeasonAgeTick } from './aging'
import { generateYouthPoolForSeason, type YouthIntakeReport } from './youth'
import { buildAllSchedules } from '$engine/gen/schedule'
import { refreshMyClubWageBudget, applyContractEndOfSeason } from './contracts'

export interface NewSeasonReport {
  previousYear: number
  newYear: number
  playersAged: number
  youth: YouthIntakeReport
  fixturesGenerated: number
}

/**
 * Rimpiazza tutti i fixtures della career con il calendario della nuova stagione.
 * Determinismo: rng derivato da (seed ^ newYear ^ magic).
 */
function buildNewSeasonFixtures(career: Career, rng: ReturnType<typeof createRng>): number {
  career.fixtures.length = 0
  const leagues = Object.values(career.leagues)
  const startIso = `${career.season.year}-08-22`  // sabato indicativo metà agosto
  const fixtures = buildAllSchedules(rng, leagues, startIso)
  career.fixtures.push(...fixtures)
  return fixtures.length
}

/**
 * Avanza la career alla stagione successiva. Da chiamare quando l'utente
 * clicca "Inizia Nuova Stagione" (currentMatchday > totalMatchdays).
 *
 * Idempotenza: se chiamato a stagione non conclusa, no-op (ritorna null).
 */
export function startNewSeason(career: Career): NewSeasonReport | null {
  if (career.season.currentMatchday <= career.season.totalMatchdays) {
    return null  // stagione non conclusa
  }

  const previousYear = career.season.year

  // 1) Aging (avanza anche season.year e resetta currentMatchday)
  const playersAged = endOfSeasonAgeTick(career)
  const newYear = career.season.year  // ora è previousYear + 1

  // 2) Contratti scadenze (Fase 3.D: no-op; Fase 3.G implementerà rinnovi/svincoli)
  applyContractEndOfSeason(career)

  // 3) Pool giovani — rng deterministic separato. I giovani vengono creati con
  //    contratto fresco 4-5 anni (dentro generateYouthPlayer).
  const rngYouth = createRng((career.seed ^ newYear ^ 0xC014ED) >>> 0)
  const youth = generateYouthPoolForSeason(career, rngYouth)

  // 4) Aggiorna monte ingaggi del mio club con la rosa reale aggiornata
  //    (giovani aggiunti + eventuali svincolati rimossi in futuro)
  refreshMyClubWageBudget(career)

  // 5) Calendario nuova stagione — rng deterministic separato
  const rngFixtures = createRng((career.seed ^ newYear ^ 0xCA1E_DA21) >>> 0)
  const fixturesGenerated = buildNewSeasonFixtures(career, rngFixtures)

  // 4) Stagione finita di prepararsi — la season.currentMatchday è già a 1 dal tick

  // 5) News riepilogativa principale + 1 news per ogni top prospect
  const rngNews = createRng((career.seed ^ newYear ^ 0x5EA50) >>> 0)
  const newsDate = `${newYear}-07-01`
  career.news.unshift({
    id: generateId(rngNews),
    date: newsDate,
    kind: 'board',
    title: `Stagione ${previousYear}/${(previousYear + 1).toString().slice(2)} conclusa — benvenuti in ${newYear}/${(newYear + 1).toString().slice(2)}`,
    body: `Età avanzata per ${playersAged} giocatori. ${youth.totalGenerated} nuovi giovani promossi dai vivai. Calendario nuova stagione disponibile.`,
    read: false,
  })

  // News per i top 3 prospects (teasing scouting Fase 3.G futura)
  for (const prospect of youth.topProspects) {
    if (prospect.potential < 70) continue  // solo quelli "molto promettenti" o sopra
    career.news.unshift({
      id: generateId(rngNews),
      date: newsDate,
      kind: 'transfer',
      title: `Talento in vista: ${prospect.name} (${prospect.position})`,
      body: `Il giovane ${prospect.position} del ${prospect.teamName} è considerato uno dei prospetti più interessanti della nuova generazione.`,
      read: false,
    })
  }

  // Trim news (cap 50, come al solito)
  if (career.news.length > 50) career.news.length = 50

  career.updatedAt = Date.now()

  return {
    previousYear,
    newYear,
    playersAged,
    youth,
    fixturesGenerated,
  }
}
