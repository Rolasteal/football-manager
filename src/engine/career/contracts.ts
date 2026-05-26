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

import type { Player, Team, PlayerContract } from '$engine/types'
import type { Rng } from '$engine/gen/rng'
import type { Career } from './types'
import { calcOverall } from '$engine/gen/player'
import { createRng } from '$engine/gen/rng'

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

// ====== Decremento scadenze a fine stagione ======

/**
 * NON fa scadere i contratti (svincolo / rinnovi entrano in 3.G mercato).
 * Limita la finestra di scadenza a refYear+5 max per pulizia.
 *
 * In futuro 3.G: i contratti con endYear === refYear diventano svincolati
 * (teamId = null, contract = undefined) salvo offerta di rinnovo accettata.
 */
export function applyContractEndOfSeason(_career: Career): void {
  // Fase 3.D: no-op. Le scadenze si avvicinano naturalmente (refYear avanza,
  // endYear resta fisso). La UI mostra "scade tra X anni" → diminuisce di sé.
  // Fase 3.G implementerà: rinnovo automatico per AI / svincolo se non rinnovato.
}
