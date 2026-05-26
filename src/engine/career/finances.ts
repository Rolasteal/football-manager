/**
 * Finanze club — Fase 3.1.
 *
 * Modulo pure functions per gestire la cassa, monte ingaggi, sponsor, premi
 * e storico movimenti del club del giocatore.
 *
 * Pattern:
 * - `initClubFinances(team)`: valori iniziali calibrati su reputation
 * - `ensureClubFinances(career)`: backward-compat per save legacy
 * - `weeklyTick(career)`: applica ricavi/spese settimanali, log in history
 *
 * Sincronia con Team.balance:
 *   `career.clubFinances.cash` <-> `career.teams[career.club.teamId].balance`
 * Le funzioni qui dentro mantengono l'invariante: ogni volta che mutano `cash`,
 * aggiornano anche `team.balance`.
 *
 * Per le AI team (tutti i team che NON sono `career.club.teamId`) usiamo
 * direttamente `team.balance` con tick semplificato basato su reputation.
 */

import type { Team } from '$engine/types'
import type { Career, ClubFinances, FinanceEntry } from './types'

/** Numero massimo di voci di history conservate (memory cap + dashboard trend) */
const HISTORY_CAP = 30

// ====== Calibrazione su reputation ======

/**
 * Calcola le finanze iniziali di un club in base alla sua reputation 1-100.
 *
 * Bande (rep 30-49 piccolo, 50-69 medio, 70-100 top):
 * - rep 30: cassa €3M, sponsor €1.5M/anno, monte ingaggi €300k/mese
 * - rep 50: cassa €10M, sponsor €5M/anno, monte ingaggi €800k/mese
 * - rep 70: cassa €30M, sponsor €15M/anno, monte ingaggi €2M/mese
 * - rep 90: cassa €60M, sponsor €25M/anno, monte ingaggi €4M/mese
 *
 * Le formule sono lineari a tratti per evitare picchi esponenziali e tenere
 * tutti i numeri leggibili in Dashboard.
 */
function calibrateForRep(rep: number): {
  cash: number
  sponsorAnnual: number
  monthlyWageBudget: number
  transferBudget: number
} {
  const r = Math.max(1, Math.min(100, rep))
  // Curva: cassa = 0.3M + (rep-20)^1.5 * 80k circa
  const cash = Math.round(300_000 + Math.pow(Math.max(0, r - 20), 1.5) * 75_000)
  // Sponsor annuale: cresce più aggressivamente con la reputation
  const sponsorAnnual = Math.round(500_000 + Math.pow(Math.max(0, r - 20), 1.6) * 45_000)
  // Monte ingaggi mensile: ~1/3 dello sponsor annuo / 12 + base
  const monthlyWageBudget = Math.round(120_000 + Math.pow(Math.max(0, r - 20), 1.45) * 5_000)
  // Budget mercato: ~40% della cassa iniziale, mai oltre 25M alla prima stagione
  const transferBudget = Math.min(25_000_000, Math.round(cash * 0.4))
  return { cash, sponsorAnnual, monthlyWageBudget, transferBudget }
}

// ====== Init ======

/**
 * Crea le finanze iniziali per il club del giocatore.
 * Usa `team.balance` esistente (impostata dal world generator) come `cash`,
 * gli altri valori (sponsor/monte ingaggi/budget mercato) si calibrano su
 * `team.reputation` via calibrateForRep.
 */
export function initClubFinances(team: Team): ClubFinances {
  const cal = calibrateForRep(team.reputation)
  // Cash = team.balance dal world generator (più realistico, già scalato per lega/tier)
  // Fallback a cal.cash se balance non popolata (safety, non dovrebbe accadere)
  const cash = team.balance > 0 ? team.balance : cal.cash

  // Stime settimanali:
  // - Ricavi: sponsor pro-rata + piccola componente fissa
  //   (in 3.2 il gate diventerà variabile su capienza/occupazione stadio)
  // - Spese: stipendi/4.33 + overhead fisso (manutenzione + scouting + staff)
  const weeklyIncome = Math.round(cal.sponsorAnnual / 52 + 30_000)
  const weeklyExpenses = Math.round(cal.monthlyWageBudget / 4.33 + 50_000)

  return {
    cash,
    monthlyWageBudget: cal.monthlyWageBudget,
    sponsorAnnual: cal.sponsorAnnual,
    prizeMoneyEarned: 0,
    transferBudget: cal.transferBudget,
    weeklyIncome,
    weeklyExpenses,
    history: [],
  }
}

// ====== Backward-compat per save legacy ======

/**
 * Se la career è stata creata prima della Fase 3.1, popola `clubFinances`
 * al volo. Idempotente: se già presente, non fa nulla.
 */
export function ensureClubFinances(career: Career): ClubFinances {
  if (career.clubFinances) return career.clubFinances
  const myTeam = career.teams[career.club.teamId]
  const finances = initClubFinances(myTeam)
  // Allinea team.balance con la cash inizializzata
  myTeam.balance = finances.cash
  career.clubFinances = finances
  return finances
}

// ====== Tick settimanale ======

/**
 * Avanza le finanze di 1 settimana in-game (1 giornata di campionato).
 * Va chiamato dentro `advanceMatchday` dopo l'incremento di currentMatchday.
 *
 * Per il MIO club: calcola delta = weeklyIncome - weeklyExpenses, applica a
 * `clubFinances.cash`, logga 2 entries in history (ricavo + spesa), sincronizza
 * `team.balance`.
 *
 * Per le AI team: applica un delta semplificato direttamente a `team.balance`
 * basato su reputation (i top club guadagnano, i piccoli appena pareggiano).
 */
export function weeklyTick(career: Career, matchday: number): void {
  const myTeamId = career.club.teamId

  // ----- Mio club -----
  const finances = ensureClubFinances(career)
  const myTeam = career.teams[myTeamId]

  // Ricavo settimanale: sponsor pro-rata + piccola componente variabile
  // (in 3.2 questa diventerà gate variabile su risultato/capienza stadio)
  const incomeJitter = 0.9 + Math.random() * 0.2 // ±10%
  const weekIncome = Math.round(finances.weeklyIncome * incomeJitter)
  finances.cash += weekIncome
  finances.history.unshift({
    matchday,
    label: 'Sponsor + merch',
    amount: weekIncome,
    balanceAfter: finances.cash,
  })

  // Spesa settimanale: stipendi + overhead
  const weekExpenses = -finances.weeklyExpenses
  finances.cash += weekExpenses
  finances.history.unshift({
    matchday,
    label: 'Stipendi + overhead',
    amount: weekExpenses,
    balanceAfter: finances.cash,
  })

  // Cap history
  if (finances.history.length > HISTORY_CAP) {
    finances.history.length = HISTORY_CAP
  }

  // Sincronizza Team.balance del mio club
  myTeam.balance = finances.cash

  // ----- AI team -----
  for (const t of Object.values(career.teams)) {
    if (t.id === myTeamId) continue
    // Delta basato su reputation: i top guadagnano ~50-100k/sett, i piccoli quasi 0
    const repNorm = (Math.max(1, Math.min(100, t.reputation)) - 20) / 80 // 0..1
    const baseDelta = Math.round(repNorm * 70_000 - 10_000) // -10k a +60k
    const jitter = 0.85 + Math.random() * 0.3 // ±15%
    const delta = Math.round(baseDelta * jitter)
    t.balance = Math.max(0, t.balance + delta)
  }
}

// ====== Helpers per UI ======

/** Formatter € italiano: "€ 12,5 M" / "€ 850k" / "€ 320" */
export function fmtMoney(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}€ ${(abs / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (abs >= 1_000) return `${sign}€ ${Math.round(abs / 1_000)}k`
  return `${sign}€ ${Math.round(abs)}`
}

/**
 * Calcola il trend cassa degli ultimi N matchday distinti (default 4).
 * Ritorna array di { matchday, balance } in ordine cronologico.
 */
export function cashTrend(finances: ClubFinances, lastN = 4): { matchday: number; balance: number }[] {
  const byMatchday = new Map<number, number>()
  // history è in ordine inverso (più recente prima); per ogni matchday tieni
  // il `balanceAfter` dell'ENTRY PIÙ RECENTE = saldo a fine settimana
  for (const e of finances.history) {
    if (!byMatchday.has(e.matchday)) {
      byMatchday.set(e.matchday, e.balanceAfter)
    }
  }
  return Array.from(byMatchday.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(-lastN)
    .map(([matchday, balance]) => ({ matchday, balance }))
}

/** Variazione % cassa tra primo e ultimo punto del trend. 0 se trend < 2 punti. */
export function cashTrendPct(finances: ClubFinances, lastN = 4): number {
  const trend = cashTrend(finances, lastN)
  if (trend.length < 2) return 0
  const first = trend[0].balance
  const last = trend[trend.length - 1].balance
  if (first === 0) return 0
  return ((last - first) / Math.abs(first)) * 100
}
