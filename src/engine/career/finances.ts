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

import type { Team, Stadium, League } from '$engine/types'
import type { Career, ClubFinances, FinanceEntry } from './types'
import { computeStandings } from '$engine/competition/standings'

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

// ====== Gate revenue / Stadio (Fase 3.2) ======

/**
 * Calcola occupazione stadio 0..1 per un match di casa.
 *
 * Componenti:
 * - **base** dalla reputation del team di casa: rep 30 = 55%, rep 50 = 75%,
 *   rep 70 = 95%, rep 90 = 100% (curva linear con clamp).
 * - **boost forma** sugli ultimi 3 match: ogni W = +3%, ogni L = -3%, D neutro.
 *   Una serie di vittorie riempie lo stadio, una serie di sconfitte lo svuota.
 * - **boost importanza** se siamo nelle ultime 5 giornate della stagione
 *   (corsa al titolo / lotta salvezza): +5%.
 * - **jitter** deterministic dal seed + matchday + teamId: ±4% per non avere
 *   numeri identici settimana dopo settimana.
 *
 * Clamp finale 0.45-1.00 (sotto 45% non si scende mai, mantiene incassi minimi).
 */
export function computeOccupancy(
  homeTeam: Team,
  recentForm: ('W' | 'D' | 'L')[],
  currentMatchday: number,
  totalMatchdays: number,
  jitterSeed: number
): number {
  // Base su reputation: rep 30 → 0.55, rep 70 → 0.95
  const r = Math.max(1, Math.min(100, homeTeam.reputation))
  let occ = 0.40 + r * 0.0075

  // Boost forma ultimi 3
  const last3 = recentForm.slice(0, 3)
  for (const f of last3) {
    if (f === 'W') occ += 0.03
    else if (f === 'L') occ -= 0.03
  }

  // Boost ultime 5 giornate (run-in finale)
  if (currentMatchday >= totalMatchdays - 4) {
    occ += 0.05
  }

  // Jitter deterministic ±0.04
  const j = ((jitterSeed * 2654435761) >>> 0) / 0xFFFFFFFF
  occ += (j - 0.5) * 0.08

  return Math.max(0.45, Math.min(1.0, occ))
}

/**
 * Prezzo medio biglietto in € per uno stadio. Dipende da:
 * - tier lega (1 = top, 2 = lower) → base price
 * - reputation team di casa → premium top club
 *
 * Range realistico: €10 (piccola Serie B) → €55 (top Serie A).
 */
export function avgTicketPrice(homeTeam: Team, leagueTier: number): number {
  const basePrice = leagueTier === 1 ? 18 : 10
  const repPremium = Math.max(0, homeTeam.reputation - 30) * 0.45
  return Math.round(basePrice + repPremium)
}

/**
 * Incasso gate di un singolo match di casa.
 * gate = capacity * occupancy * avgTicketPrice.
 *
 * NB: occupancy include già il boost forma/importanza/jitter — qui solo math.
 */
export function computeGateRevenue(
  stadium: Stadium,
  occupancy: number,
  ticketPrice: number
): number {
  return Math.round(stadium.capacity * occupancy * ticketPrice)
}

/**
 * Applica l'incasso gate di tutti i match della giornata corrente.
 * Va chiamato in `advanceMatchday` PRIMA della simulazione delle partite,
 * così la `recentForm` letta da computeStandings non include il risultato
 * della partita stessa (tifosi comprano il biglietto in anticipo).
 *
 * Per il mio club: aggiunge a `clubFinances.cash` + log "Gate vs X" in history.
 * Per le AI: aggiunge direttamente a `team.balance`.
 */
export function applyMatchdayGate(career: Career, matchday: number): void {
  const myTeamId = career.club.teamId
  const finances = ensureClubFinances(career)

  // Pre-calcola le classifiche di ogni lega 1 volta sola (form lookup veloce)
  const formByTeam = new Map<string, ('W' | 'D' | 'L')[]>()
  for (const league of Object.values(career.leagues)) {
    const leagueFixtures = career.fixtures.filter(f => f.leagueId === league.id)
    const standings = computeStandings(leagueFixtures, league.teamIds)
    for (const row of standings) {
      formByTeam.set(row.teamId, row.form)
    }
  }

  // Helper per trovare la lega di un team
  function leagueOfTeam(teamId: string): League | undefined {
    return Object.values(career.leagues).find(l => l.teamIds.includes(teamId))
  }

  // Itera i match della giornata corrente (solo non ancora giocati)
  for (const f of career.fixtures) {
    if (f.matchday !== matchday) continue
    if (f.status === 'played') continue

    const homeTeam = career.teams[f.homeId]
    const awayTeam = career.teams[f.awayId]
    if (!homeTeam || !awayTeam) continue

    const stadium = career.stadiums[homeTeam.stadiumId]
    if (!stadium) continue

    const league = leagueOfTeam(homeTeam.id)
    const tier = league?.tier ?? 1
    const totalMd = career.season.totalMatchdays

    const form = formByTeam.get(homeTeam.id) ?? []
    // Jitter seed deterministic dal career seed + md + team
    const jitterSeed = (career.seed ^ matchday ^ homeTeam.id.charCodeAt(0)) >>> 0
    const occupancy = computeOccupancy(homeTeam, form, matchday, totalMd, jitterSeed)
    const ticket = avgTicketPrice(homeTeam, tier)
    const gate = computeGateRevenue(stadium, occupancy, ticket)

    if (homeTeam.id === myTeamId) {
      finances.cash += gate
      finances.history.unshift({
        matchday,
        label: `Gate vs ${awayTeam.shortName}`,
        amount: gate,
        balanceAfter: finances.cash,
      })
      if (finances.history.length > HISTORY_CAP) {
        finances.history.length = HISTORY_CAP
      }
      homeTeam.balance = finances.cash
    } else {
      homeTeam.balance += gate
    }
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
