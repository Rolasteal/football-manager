/**
 * Premi finanziari di fine stagione — Fase 3.F.
 *
 * Tre componenti, applicati TUTTI a fine stagione (chiamata da startNewSeason
 * come primo step, PRIMA dell'aging e PRIMA di rigenerare i fixture, perché
 * serve la classifica della stagione appena conclusa):
 *
 * 1. **Premi piazzamento campionato** — Serie A reale 2023-24. Tutti i team
 *    ricevono qualcosa tranne le ultime 3 posizioni (retrocessione). Per
 *    tier 2 i valori sono scalati al 30%.
 *
 * 2. **Premi UEFA simulati** — solo tier 1: top 4 in Champions, 5°-6° in
 *    Europa League, 7° in Conference. Nessuna competizione reale simulata
 *    ancora (Fase 5+): qui paghiamo solo la qualificazione come bonus secco.
 *
 * 3. **Sponsor rinegoziazione** — solo MIO club. La posizione finale modifica
 *    `clubFinances.sponsorAnnual` (e di conseguenza `weeklyIncome`).
 *    - Top 4 tier 1: +30%
 *    - Pos 16-17 tier 1: -15%
 *    - Retrocessi tier 1 (ultimi 3): -40%
 *    - Promossi tier 2 (top 3): +40%
 *    - Ultimi 3 tier 2: -20%
 *    - Tutti gli altri: invariato
 *
 * Per le AI team i premi sommano direttamente a `team.balance`. La
 * rinegoziazione sponsor non viene applicata alle AI perché i loro ricavi
 * sono già astratti via tick semplificato (`finances.weeklyTick`).
 */

import type { Career } from './types'
import { computeStandings } from '$engine/competition/standings'
import { ensureClubFinances } from './finances'

// ====== Tabelle premi (calibrate su Serie A 2023-24) ======

/**
 * Premi piazzamento Serie A in €.
 * Index 1..20 = posizione finale, index 0 = padding (unused).
 * Pos 18-20 = retrocessione = €0.
 *
 * Riferimento reale 2023-24 (montepremi distribuiti via diritti TV scalati per
 * piazzamento): scudetto ~€20M, 4° ~€11M, 10° ~€4M, 17° ~€1.1M.
 */
const LEAGUE_PRIZE_TIER1: number[] = [
  0,            // padding
  20_000_000,   //  1°  Scudetto
  16_500_000,   //  2°
  13_500_000,   //  3°
  11_000_000,   //  4°
  9_000_000,    //  5°
  7_500_000,    //  6°
  6_000_000,    //  7°
  5_000_000,    //  8°
  4_500_000,    //  9°
  4_000_000,    // 10°
  3_500_000,    // 11°
  3_000_000,    // 12°
  2_500_000,    // 13°
  2_000_000,    // 14°
  1_700_000,    // 15°
  1_400_000,    // 16°
  1_100_000,    // 17°
  0,            // 18°  ↓ retrocessione
  0,            // 19°  ↓ retrocessione
  0,            // 20°  ↓ retrocessione
]

/** Fattore di scala tier 2 (Serie B) sui premi piazzamento */
const LEAGUE_PRIZE_TIER2_FACTOR = 0.30

// ====== Premi UEFA simulati (solo tier 1) ======

export type UefaCompetition = 'UCL' | 'UEL' | 'UECL'

export interface UefaPrize {
  competition: UefaCompetition
  amount: number
}

/** Champions League: top4 qualificato. Premio realistico cumulativo gironi+fase a eliminazione media. */
const UEFA_PRIZE_UCL = 60_000_000
/** Europa League: 5°-6° */
const UEFA_PRIZE_UEL = 20_000_000
/** Conference League: 7° */
const UEFA_PRIZE_UECL = 8_000_000

export function uefaPrizeForPosition(position: number, leagueTier: number): UefaPrize | null {
  if (leagueTier !== 1) return null
  if (position >= 1 && position <= 4) return { competition: 'UCL', amount: UEFA_PRIZE_UCL }
  if (position === 5 || position === 6) return { competition: 'UEL', amount: UEFA_PRIZE_UEL }
  if (position === 7) return { competition: 'UECL', amount: UEFA_PRIZE_UECL }
  return null
}

// ====== Premio piazzamento ======

export function leaguePrizeForPosition(
  position: number,
  leagueTier: number,
  totalTeams: number
): number {
  if (position < 1 || position > totalTeams) return 0
  // Le ultime 3 posizioni sono sempre retrocessione → €0
  if (position > totalTeams - 3) return 0
  const idx = Math.min(20, position)
  const base = LEAGUE_PRIZE_TIER1[idx] ?? 0
  return leagueTier === 1 ? base : Math.round(base * LEAGUE_PRIZE_TIER2_FACTOR)
}

// ====== Sponsor rinegoziazione (solo mio club) ======

export interface SponsorRenegotiationResult {
  /** Moltiplicatore applicato (es. 1.30 = +30%, 0.60 = -40%, 1.00 = invariato) */
  factor: number
  /** Valore sponsor annuale PRIMA della rinegoziazione */
  previousAnnual: number
  /** Valore sponsor annuale DOPO la rinegoziazione */
  newAnnual: number
  /** Etichetta umana del motivo (per news) */
  reason: 'top4_ucl' | 'top_relegated' | 'bottom_two_top_league' | 'promoted_b' | 'bottom_b' | 'stable'
}

export function renegotiateSponsors(
  career: Career,
  myFinalPosition: number,
  myLeagueTier: number,
  totalTeams: number
): SponsorRenegotiationResult {
  const finances = ensureClubFinances(career)
  const previousAnnual = finances.sponsorAnnual

  let factor = 1.0
  let reason: SponsorRenegotiationResult['reason'] = 'stable'

  if (myLeagueTier === 1) {
    if (myFinalPosition >= 1 && myFinalPosition <= 4) {
      factor = 1.30                                                  // top4 UCL → +30%
      reason = 'top4_ucl'
    } else if (myFinalPosition > totalTeams - 3) {
      factor = 0.60                                                  // retrocesso → -40%
      reason = 'top_relegated'
    } else if (myFinalPosition > totalTeams - 5) {
      factor = 0.85                                                  // 16°-17° → -15%
      reason = 'bottom_two_top_league'
    }
  } else {
    // tier 2
    if (myFinalPosition <= 3) {
      factor = 1.40                                                  // promosso → +40%
      reason = 'promoted_b'
    } else if (myFinalPosition > totalTeams - 3) {
      factor = 0.80                                                  // ultimi 3 → -20%
      reason = 'bottom_b'
    }
  }

  const newAnnual = Math.round(previousAnnual * factor)
  finances.sponsorAnnual = newAnnual
  // Allinea weeklyIncome: stesso ratio di initClubFinances (sponsor/52 + 30k merch)
  finances.weeklyIncome = Math.round(newAnnual / 52 + 30_000)

  return { factor, previousAnnual, newAnnual, reason }
}

// ====== Orchestratore end-of-season ======

export interface PrizeEntry {
  teamId: string
  position: number
  leaguePrize: number
  uefaPrize: UefaPrize | null
}

export interface EndOfSeasonPrizesReport {
  /** Posizione finale del mio club nella sua lega (1-based) */
  myFinalPosition: number
  /** Tier della lega del mio club (1 o 2) */
  myLeagueTier: number
  /** Numero totale squadre nella lega del mio club */
  myLeagueTeams: number
  /** Premio piazzamento erogato al mio club */
  myLeaguePrize: number
  /** Premio UEFA (null se non qualificato) */
  myUefaPrize: UefaPrize | null
  /** Risultato rinegoziazione sponsor */
  sponsor: SponsorRenegotiationResult
  /** Totale € distribuiti a tutti i team (per debug/news AI) */
  totalDistributed: number
  /** Per ogni team, dettaglio premi (utile per UI future / debug) */
  perTeam: PrizeEntry[]
}

/**
 * Eroga premi piazzamento + UEFA + rinegozia sponsor mio club.
 *
 * Va chiamato per PRIMO in `startNewSeason`, PRIMA di `endOfSeasonAgeTick`
 * (l'aging avanza `season.year` e resetta `currentMatchday`, qui ci serve
 * la classifica della stagione APPENA conclusa).
 *
 * Idempotenza: se la stagione non è conclusa (currentMatchday <= totalMatchdays)
 * ritorna null. NON va mai chiamato manualmente in altri punti.
 */
export function applyEndOfSeasonFinances(career: Career): EndOfSeasonPrizesReport | null {
  if (career.season.currentMatchday <= career.season.totalMatchdays) return null

  const myTeamId = career.club.teamId
  const myTeam = career.teams[myTeamId]
  if (!myTeam) return null

  const myLeague = Object.values(career.leagues).find(l => l.teamIds.includes(myTeamId))
  if (!myLeague) return null

  const finances = ensureClubFinances(career)
  const perTeam: PrizeEntry[] = []
  let totalDistributed = 0

  let myFinalPosition = 0
  let myLeagueTeamsCount = 0
  let myLeaguePrize = 0
  let myUefaPrize: UefaPrize | null = null

  // Itera ogni lega, calcola classifica finale, eroga premi
  for (const league of Object.values(career.leagues)) {
    const leagueFixtures = career.fixtures.filter(f => f.leagueId === league.id)
    const standings = computeStandings(leagueFixtures, league.teamIds)
    const totalTeams = standings.length

    for (let i = 0; i < standings.length; i++) {
      const row = standings[i]
      const position = i + 1
      const team = career.teams[row.teamId]
      if (!team) continue

      const leaguePrize = leaguePrizeForPosition(position, league.tier, totalTeams)
      const uefaPrize = uefaPrizeForPosition(position, league.tier)
      const total = leaguePrize + (uefaPrize?.amount ?? 0)

      perTeam.push({ teamId: team.id, position, leaguePrize, uefaPrize })

      if (team.id === myTeamId) {
        myFinalPosition = position
        myLeagueTeamsCount = totalTeams
        myLeaguePrize = leaguePrize
        myUefaPrize = uefaPrize

        // Erogazione al mio club via clubFinances
        if (leaguePrize > 0) {
          finances.cash += leaguePrize
          finances.prizeMoneyEarned += leaguePrize
          finances.history.unshift({
            matchday: career.season.totalMatchdays,
            label: `Premio piazzamento ${position}°`,
            amount: leaguePrize,
            balanceAfter: finances.cash,
          })
        }
        if (uefaPrize) {
          finances.cash += uefaPrize.amount
          finances.prizeMoneyEarned += uefaPrize.amount
          finances.history.unshift({
            matchday: career.season.totalMatchdays,
            label: `Qualificazione ${uefaPrize.competition}`,
            amount: uefaPrize.amount,
            balanceAfter: finances.cash,
          })
        }
        // Cap history (consistente con finances.ts HISTORY_CAP=30)
        if (finances.history.length > 30) finances.history.length = 30
        // Sincronizza Team.balance del mio club con clubFinances.cash
        myTeam.balance = finances.cash
      } else {
        // AI team: somma diretta a team.balance
        team.balance += total
      }

      totalDistributed += total
    }
  }

  // Rinegoziazione sponsor mio club (basata sulla sua lega)
  const sponsor = renegotiateSponsors(career, myFinalPosition, myLeague.tier, myLeagueTeamsCount)

  return {
    myFinalPosition,
    myLeagueTier: myLeague.tier,
    myLeagueTeams: myLeagueTeamsCount,
    myLeaguePrize,
    myUefaPrize,
    sponsor,
    totalDistributed,
    perTeam,
  }
}
