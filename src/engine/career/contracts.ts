/**
 * Contratti giocatori — Fase 3.D.
 *
 * Ogni giocatore (non svincolato) ha un PlayerContract con:
 * - startYear: anno di inizio
 * - endYear: anno di scadenza (fine giugno)
 * - weeklyWage: stipendio settimanale in €
 *
 * Calibrazione stipendi su Serie A 2024:
 * - Top player (overall 80+) in top club: €100k-300k/sett
 * - Titolari top club (overall 70-79): €50k-100k/sett
 * - Titolari medi (overall 65-74): €20k-50k/sett
 * - Riserve / piccoli club (overall 55-64): €5k-20k/sett
 * - Giovani (16-19): €1k-5k/sett (rookie deal scaling con potential)
 * - Mediocri (overall <55): €1k-3k/sett
 *
 * Durata contratto:
 * - Vecchi (30+): 1-2 anni
 * - Titolari 24-29: 3-4 anni
 * - Giovani (<24): 4-5 anni
 *
 * Le scadenze effettive (svincolo, rinnovi) saranno gestite in Fase 3.G mercato.
 * In 3.D ci limitiamo a creare i contratti, mostrarli in UI e ricalcolare il
 * monte ingaggi reale del club.
 */

import type { EntityId, Player, Team, PlayerContract } from '$engine/types'
import type { Rng } from '$engine/gen/rng'
import type { Career, NewsItem } from './types'
import { calcOverall } from '$engine/gen/player'
import { createRng, generateId } from '$engine/gen/rng'
import { ensureClubFinances, fmtMoney } from './finances'

/** Età alla data di riferimento (1° luglio del refYear) */
function ageAt(birthDate: string, refYear: number): number {
  const b = new Date(birthDate)
  const ref = new Date(`${refYear}-07-01`)
  let a = ref.getUTCFullYear() - b.getUTCFullYear()
  const m = ref.getUTCMonth() - b.getUTCMonth()
  if (m < 0 || (m === 0 && ref.getUTCDate() < b.getUTCDate())) a--
  return a
}

// ====== Calibrazione stipendio ======

/**
 * Stipendio settimanale calibrato in €.
 * base ≈ (overall - 40)^2.5 × 5 (curva power per separare top da medi)
 * modulato da:
 * - team reputation (top paga di più: rep 30 = ×0.5, rep 90 = ×1.4)
 * - età (giovani sotto i 22 anni in rookie deal, veterani 33+ lieve sconto)
 *
 * Esempi:
 * - ATT overall 85, 27 anni, club rep 80 → ~€85k/sett
 * - DEF overall 70, 25 anni, club rep 65 → ~€25k/sett
 * - 17enne potential 75 overall 60, club rep 75 → ~€5k/sett
 * - Riserva 23 anni overall 58, club rep 55 → ~€6k/sett
 */
export function weeklyWageFor(player: Player, team: Team, refYear?: number): number {
  const overall = calcOverall(player)
  const age = ageAt(player.birthDate, refYear ?? new Date().getUTCFullYear())

  // Base: curva power su overall (i top costano sproporzionalmente)
  let base = Math.pow(Math.max(0, overall - 40), 2.5) * 5

  // Età modulatori
  if (age <= 19) base *= 0.5      // rookie giovanissimo
  else if (age <= 21) base *= 0.7  // giovane in crescita
  else if (age >= 35) base *= 0.7  // veterano fine carriera
  else if (age >= 33) base *= 0.85 // 33-34 lieve sconto

  // Team multiplier su reputation: 30 = 0.5, 70 = 1.1, 90 = 1.4
  const teamMul = 0.5 + (Math.max(1, Math.min(100, team.reputation)) - 30) * 0.015

  return Math.max(1_000, Math.round(base * teamMul))
}

// ====== Durata contratto ======

/**
 * Durata contratto in anni, derivata dall'età. Random ±1 per varietà.
 *
 * - <24: 4-5 anni (carriera lunga davanti)
 * - 24-29: 3-4 anni
 * - 30-32: 2-3 anni
 * - 33+: 1-2 anni
 */
export function contractLengthFor(age: number, rng: Rng): number {
  if (age < 24) return rng.int(4, 5)
  if (age < 30) return rng.int(3, 4)
  if (age < 33) return rng.int(2, 3)
  return rng.int(1, 2)
}

// ====== Init contratto ======

/**
 * Crea un PlayerContract da assegnare a un giocatore.
 * `currentYear` è l'anno di inizio (di solito career.season.year).
 * La scadenza viene jitterata: alcuni contratti hanno appena iniziato (full
 * length), altri sono già "consumati" (1-2 anni in mezzo) per non avere tutti
 * i contratti che scadono nello stesso anno.
 */
export function initContract(
  player: Player,
  team: Team,
  currentYear: number,
  rng: Rng,
  opts?: { fullLength?: boolean }
): PlayerContract {
  const age = ageAt(player.birthDate, currentYear)
  const length = contractLengthFor(age, rng)
  // Jitter: alcuni contratti partono "già in corso" (-0..2 anni), altri freschi
  const yearsConsumed = opts?.fullLength ? 0 : rng.int(0, Math.max(0, length - 1))
  const startYear = currentYear - yearsConsumed
  const endYear = startYear + length
  const weeklyWage = weeklyWageFor(player, team, currentYear)
  return { startYear, endYear, weeklyWage }
}

// ====== Backward-compat per save legacy ======

/**
 * Se il giocatore non ha contratto, glielo crea al volo deterministicamente.
 * Usa l'rng derivato da seed + playerId per riproducibilità.
 *
 * Returns: il contratto (esistente o appena creato).
 */
export function ensurePlayerContract(
  player: Player,
  team: Team,
  currentYear: number,
  careerSeed: number
): PlayerContract | undefined {
  if (player.contract) return player.contract
  if (!player.teamId) return undefined  // svincolato, niente contratto

  // Rng deterministic dal seed + idChar (no random non-seedato)
  const rng = createRng((careerSeed ^ player.id.charCodeAt(0) ^ player.id.charCodeAt(1) ^ 0xC047) >>> 0)
  player.contract = initContract(player, team, currentYear, rng)
  return player.contract
}

/**
 * Batch ensure per tutti i giocatori della career. Idempotente.
 */
export function ensureAllPlayersContracts(career: Career): void {
  for (const p of Object.values(career.players)) {
    if (!p.teamId) continue
    const team = career.teams[p.teamId]
    if (!team) continue
    ensurePlayerContract(p, team, career.season.year, career.seed)
  }
}

// ====== Monte ingaggi reale ======

/**
 * Calcola il monte ingaggi MENSILE reale di un team dalla sua rosa.
 * weeklyWage × 4.33 settimane/mese × numero_giocatori.
 *
 * Per il MIO club: questo sostituisce `clubFinances.monthlyWageBudget` calibrato
 * (init via reputation) con il valore vero della rosa.
 *
 * Returns: € al mese.
 */
export function clubMonthlyWageFromSquad(career: Career, teamId: string): number {
  let totalWeekly = 0
  for (const p of Object.values(career.players)) {
    if (p.teamId !== teamId) continue
    if (!p.contract) continue
    totalWeekly += p.contract.weeklyWage
  }
  return Math.round(totalWeekly * 4.33)
}

/**
 * Aggiorna `clubFinances.monthlyWageBudget` e `weeklyExpenses` per il MIO club
 * con i numeri reali della rosa. Da chiamare:
 * - Dopo aver creato i contratti iniziali (buildCareerFromPreview)
 * - A ogni inizio stagione (startNewSeason, dopo i nuovi contratti dei giovani)
 * - Quando un giocatore viene comprato/venduto/rinnovato (Fase 3.G)
 */
export function refreshMyClubWageBudget(career: Career): void {
  if (!career.clubFinances) return
  const myWeekly = clubMonthlyWageFromSquad(career, career.club.teamId) / 4.33
  career.clubFinances.monthlyWageBudget = Math.round(myWeekly * 4.33)
  // weeklyExpenses = stipendi/sett + overhead fisso (manutenzione, scouting)
  career.clubFinances.weeklyExpenses = Math.round(myWeekly + 50_000)
}

// ====== Fase 3.G.3: scadenze contratti a fine stagione ======

/**
 * Risultato del processo end-of-season su contratti per news/UI.
 */
export interface ContractEndOfSeasonReport {
  /** Player rinnovati automaticamente (solo AI) — id + new contract */
  aiRenewed: { playerId: EntityId; teamId: EntityId; newEndYear: number; newWeeklyWage: number }[]
  /** Player svincolati (sia miei che AI). Vengono spostati a teamId=null */
  released: { playerId: EntityId; previousTeamId: EntityId; playerName: string; position: string }[]
  /** Player MIEI svincolati specificamente (sottoinsieme di `released`) per news mirate */
  myReleased: { playerId: EntityId; playerName: string; position: string; overall: number }[]
}

/**
 * Hookato in startNewSeason DOPO endOfSeasonAgeTick (quindi `career.season.year`
 * è già la nuova stagione: anno N+1). I contratti con `endYear <= N+1 - 1`
 * (cioè endYear era N, scadevano a giugno N → ora è luglio N+1) sono scaduti.
 *
 * Logica:
 * 1. **AI teams**: per ogni player con contratto scaduto, decide se auto-rinnovare:
 *    - Se OVR > avg roster del team + 3 AND age < 32 → auto-rinnova (importante)
 *    - Se OVR > avg roster + 1 AND age < 30 → 50% prob rinnovo (mid-tier)
 *    - Altrimenti svincola (player.teamId = null, contract = undefined)
 *    - Nuovo contratto: 2-4 anni, wage = fairWage × 1.05 (premio fedeltà)
 * 2. **MIO team**: nessun auto-rinnovo. I miei player con contract scaduto
 *    diventano svincolati a meno che io non li abbia rinnovati manualmente
 *    PRIMA della nuova stagione (UI PlayerDetail). Per ognuno svincolato,
 *    una news mi avvisa.
 *
 * Determinismo: rng dedicato `seed ^ newYear ^ 0xC047A2`.
 */
export function applyContractEndOfSeason(career: Career): ContractEndOfSeasonReport {
  const report: ContractEndOfSeasonReport = {
    aiRenewed: [],
    released: [],
    myReleased: [],
  }
  const newYear = career.season.year  // già avanzato da endOfSeasonAgeTick
  const myTeamId = career.club.teamId
  const rng = createRng((career.seed ^ newYear ^ 0xC047A2) >>> 0)

  // Pre-calcola avg overall per ogni team (per decisione AI auto-rinnovi)
  const teamAvgOvr = new Map<EntityId, number>()
  for (const team of Object.values(career.teams)) {
    const roster = Object.values(career.players).filter(p => p.teamId === team.id)
    if (roster.length === 0) { teamAvgOvr.set(team.id, 60); continue }
    const sum = roster.reduce((s, p) => s + calcOverall(p), 0)
    teamAvgOvr.set(team.id, sum / roster.length)
  }

  // Iterazione deterministic per id
  const players = Object.values(career.players).sort((a, b) => a.id.localeCompare(b.id))

  for (const player of players) {
    if (!player.teamId) continue                       // già svincolato
    if (!player.contract) continue                     // niente contratto (sarà popolato da ensure)
    if (player.contract.endYear > newYear) continue    // contratto ancora valido

    const team = career.teams[player.teamId]
    if (!team) continue

    const isMine = player.teamId === myTeamId
    const ovr = calcOverall(player)
    const age = ageAt(player.birthDate, newYear)
    const avgOvr = teamAvgOvr.get(player.teamId) ?? 60

    if (isMine) {
      // Mio club: svincolo (non ho rinnovato in tempo). UI mostrerà la news.
      releasePlayer(player)
      report.released.push({
        playerId: player.id,
        previousTeamId: team.id,
        playerName: `${player.firstName} ${player.lastName}`,
        position: player.position,
      })
      report.myReleased.push({
        playerId: player.id,
        playerName: `${player.firstName} ${player.lastName}`,
        position: player.position,
        overall: ovr,
      })
      continue
    }

    // AI club: decisione auto-rinnovo
    let willRenew = false
    if (ovr > avgOvr + 3 && age < 32) {
      willRenew = true  // top del roster, sicuramente rinnovo
    } else if (ovr > avgOvr + 1 && age < 30) {
      willRenew = rng.chance(0.5)  // mid-tier, 50% prob
    } else if (age < 28 && ovr >= avgOvr - 2) {
      willRenew = rng.chance(0.30)  // giovane medio, 30% prob (potrebbe crescere)
    }
    // else: vecchio o scarso → svincolo automatico

    if (willRenew) {
      const newWage = Math.round(weeklyWageFor(player, team, newYear) * 1.05)
      const length = contractLengthFor(age, rng)
      const newContract: PlayerContract = {
        startYear: newYear,
        endYear: newYear + length,
        weeklyWage: newWage,
      }
      player.contract = newContract
      report.aiRenewed.push({
        playerId: player.id,
        teamId: team.id,
        newEndYear: newContract.endYear,
        newWeeklyWage: newWage,
      })
    } else {
      releasePlayer(player)
      report.released.push({
        playerId: player.id,
        previousTeamId: team.id,
        playerName: `${player.firstName} ${player.lastName}`,
        position: player.position,
      })
    }
  }

  // Se ho svincolato qualcuno dal mio club, aggiorna monte ingaggi
  if (report.myReleased.length > 0) {
    refreshMyClubWageBudget(career)
  }

  career.updatedAt = Date.now()
  return report
}

/**
 * Rilascia un giocatore: lo rimuove dal roster del team e dal lineup, e
 * pulisce il contratto. teamId → null.
 */
function releasePlayer(player: Player): void {
  player.teamId = null
  player.contract = undefined
  // Nota: il lineup del mio club viene pulito separatamente in startNewSeason
  // (cleanMyLineupAfterReleases) per non importare $engine/tactics qui.
}

/**
 * Pulisce il lineup del mio club dai giocatori svincolati a fine stagione.
 * Chiamato da startNewSeason DOPO applyContractEndOfSeason.
 * Se il capitano è stato svincolato, ne assegna uno nuovo (primo starter rimasto).
 */
export function cleanMyLineupAfterReleases(career: Career, releasedIds: EntityId[]): void {
  if (releasedIds.length === 0) return
  const idSet = new Set(releasedIds)
  career.club.lineup.starters = career.club.lineup.starters.filter(id => !idSet.has(id))
  career.club.lineup.bench = career.club.lineup.bench.filter(id => !idSet.has(id))
  if (career.club.tactics.captainId && idSet.has(career.club.tactics.captainId)) {
    career.club.tactics.captainId = career.club.lineup.starters[0]
  }
}

// ====== Fase 3.G.3: rinnovo manuale del mio player ======

export type RenewalOutcome = 'accepted' | 'countered' | 'rejected'

export interface RenewalResult {
  ok: boolean
  reason?: string
  outcome?: RenewalOutcome
  /** Wage suggerito dall'AI quando outcome === 'countered' */
  counterWage?: number
  /** Wage "equo" usato come riferimento (fair value) */
  fairWage?: number
  /** Messaggio leggibile per UI */
  message?: string
}

/**
 * Proposta di rinnovo per un MIO player. Valuta accettazione in base al
 * rapporto wage proposta vs fairWage:
 *
 * - **accepted**: proposedWage >= fairWage × 0.92 (entro 8% sotto = il player accetta)
 * - **countered**: proposedWage >= fairWage × 0.75 → AI risponde con counter al fairWage
 * - **rejected**: proposedWage < fairWage × 0.75 → player offeso, no contratto
 *
 * Validazioni:
 * - player è mio
 * - years 1-5
 * - proposedWage > 0 e arrotondato a 500€
 *
 * Quando accepted, il nuovo contratto sostituisce quello esistente PARTENDO
 * DALL'ANNO CORRENTE (career.season.year), con endYear = startYear + years.
 * Il monte ingaggi e la news vengono aggiornati.
 *
 * Idempotente: l'UI può chiamarla più volte (es. per testare). Solo `outcome=='accepted'`
 * applica modifiche di stato.
 */
export function proposeRenewal(
  career: Career,
  playerId: EntityId,
  years: number,
  proposedWage: number
): RenewalResult {
  const player = career.players[playerId]
  if (!player) return { ok: false, reason: 'Giocatore non trovato.' }
  if (player.teamId !== career.club.teamId) {
    return { ok: false, reason: 'Puoi rinnovare solo i tuoi giocatori.' }
  }
  if (years < 1 || years > 5) {
    return { ok: false, reason: 'La durata deve essere tra 1 e 5 anni.' }
  }
  const team = career.teams[player.teamId]
  if (!team) return { ok: false, reason: 'Dati squadra incompleti.' }
  if (proposedWage <= 0) return { ok: false, reason: 'Stipendio non valido.' }

  // Arrotonda a 500€ per leggibilità
  proposedWage = Math.round(proposedWage / 500) * 500

  const fairWage = weeklyWageFor(player, team, career.season.year)
  const ratio = proposedWage / fairWage

  const playerFullName = `${player.firstName} ${player.lastName}`

  // 1) Accettata
  if (ratio >= 0.92) {
    const startYear = career.season.year
    player.contract = {
      startYear,
      endYear: startYear + years,
      weeklyWage: proposedWage,
    }
    refreshMyClubWageBudget(career)
    // News al feed
    const rng = createRng((career.seed ^ startYear ^ player.id.charCodeAt(0) ^ 0xC047A3) >>> 0)
    career.news.unshift({
      id: generateId(rng),
      date: `${startYear}-${String(8 + Math.floor(career.season.currentMatchday / 4) % 4).padStart(2, '0')}-15`,
      kind: 'transfer',
      title: `Rinnovo: ${playerFullName} firma fino al ${startYear + years}`,
      body: `${playerFullName} (${player.position}) ha rinnovato il contratto con ${team.name} per ${years} ann${years === 1 ? 'o' : 'i'} a ${fmtMoney(proposedWage)}/settimana.`,
      read: false,
    })
    if (career.news.length > 50) career.news.length = 50
    career.updatedAt = Date.now()
    return {
      ok: true,
      outcome: 'accepted',
      fairWage,
      message: `${playerFullName} ha firmato il rinnovo fino al ${startYear + years} per ${fmtMoney(proposedWage)}/sett.`,
    }
  }

  // 2) Counter: AI chiede il fairWage
  if (ratio >= 0.75) {
    const counter = Math.round(fairWage / 500) * 500
    return {
      ok: true,
      outcome: 'countered',
      counterWage: counter,
      fairWage,
      message: `${playerFullName} ritiene ${fmtMoney(proposedWage)}/sett troppo basso. Chiede almeno ${fmtMoney(counter)}/sett.`,
    }
  }

  // 3) Rifiutato (troppo basso, player offeso)
  return {
    ok: true,
    outcome: 'rejected',
    fairWage,
    message: `${playerFullName} si è offeso per l'offerta di ${fmtMoney(proposedWage)}/sett e ha rifiutato categoricamente.`,
  }
}

// ====== Fase 3.G.3: firma free agent ======

export type SignFreeAgentOutcome = 'accepted' | 'countered' | 'rejected'

export interface SignFreeAgentResult {
  ok: boolean
  reason?: string
  outcome?: SignFreeAgentOutcome
  counterWage?: number
  fairWage?: number
  message?: string
}

/**
 * Firma un giocatore svincolato (player.teamId === null). Nessun costo
 * trasferimento, solo stipendio. Più flessibile del rinnovo perché il
 * player è senza squadra:
 *
 * - **accepted**: proposedWage >= fairWage × 0.85 (player è più flessibile, accetta -15%)
 * - **countered**: proposedWage >= fairWage × 0.70 → counter al fairWage
 * - **rejected**: troppo basso
 *
 * Su accepted: player.teamId = mio, player.contract = nuovo, news, monte ingaggi.
 */
export function signFreeAgent(
  career: Career,
  playerId: EntityId,
  years: number,
  proposedWage: number
): SignFreeAgentResult {
  const player = career.players[playerId]
  if (!player) return { ok: false, reason: 'Giocatore non trovato.' }
  if (player.teamId) {
    return { ok: false, reason: 'Il giocatore non è svincolato.' }
  }
  if (years < 1 || years > 5) {
    return { ok: false, reason: 'La durata deve essere tra 1 e 5 anni.' }
  }
  if (proposedWage <= 0) return { ok: false, reason: 'Stipendio non valido.' }

  const myTeam = career.teams[career.club.teamId]
  if (!myTeam) return { ok: false, reason: 'Squadra non trovata.' }

  proposedWage = Math.round(proposedWage / 500) * 500
  const fairWage = weeklyWageFor(player, myTeam, career.season.year)
  const ratio = proposedWage / fairWage
  const playerFullName = `${player.firstName} ${player.lastName}`

  if (ratio >= 0.85) {
    const startYear = career.season.year
    player.teamId = myTeam.id
    player.contract = {
      startYear,
      endYear: startYear + years,
      weeklyWage: proposedWage,
    }
    refreshMyClubWageBudget(career)
    const rng = createRng((career.seed ^ startYear ^ player.id.charCodeAt(0) ^ 0xC047A4) >>> 0)
    career.news.unshift({
      id: generateId(rng),
      date: `${startYear}-${String(8 + Math.floor(career.season.currentMatchday / 4) % 4).padStart(2, '0')}-15`,
      kind: 'transfer',
      title: `Svincolato firmato: ${playerFullName} (${player.position})`,
      body: `${myTeam.name} ha firmato lo svincolato ${playerFullName} per ${years} ann${years === 1 ? 'o' : 'i'} a ${fmtMoney(proposedWage)}/settimana.`,
      read: false,
    })
    if (career.news.length > 50) career.news.length = 50
    career.updatedAt = Date.now()
    return {
      ok: true,
      outcome: 'accepted',
      fairWage,
      message: `${playerFullName} ha firmato a parametro zero con ${myTeam.name} fino al ${startYear + years}.`,
    }
  }

  if (ratio >= 0.70) {
    const counter = Math.round(fairWage / 500) * 500
    return {
      ok: true,
      outcome: 'countered',
      counterWage: counter,
      fairWage,
      message: `${playerFullName} (svincolato) chiede almeno ${fmtMoney(counter)}/sett. La tua offerta di ${fmtMoney(proposedWage)}/sett è troppo bassa.`,
    }
  }

  return {
    ok: true,
    outcome: 'rejected',
    fairWage,
    message: `${playerFullName} ha rifiutato ${fmtMoney(proposedWage)}/sett come fuori mercato.`,
  }
}

// ====== Helper UI ======

/** Tutti i free agent della career (teamId === null), ordinati per OVR desc */
export function listFreeAgents(career: Career): Player[] {
  return Object.values(career.players).filter(p => !p.teamId)
}

/** Wage "equo" stimato per un player nel mio club (per UI come default suggerito) */
export function estimateFairWage(career: Career, player: Player): number {
  const myTeam = career.teams[career.club.teamId]
  if (!myTeam) return 1000
  return weeklyWageFor(player, myTeam, career.season.year)
}
