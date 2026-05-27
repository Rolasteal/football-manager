/**
 * Conto Manager — Fase 4.A.
 *
 * Layer 2 della visione (vedi project-visione-prodotto): il MANAGER ha un suo
 * conto bancario separato dalla cassa del club. Guadagna uno stipendio settimanale
 * dall'ingaggio firmato col club (calibrato su reputation team), accumula bonus
 * performance end-of-season (Fase 4.B), e questi soldi sono SUOI — finanziano
 * collezione (Fase 5), fanta-lega (6), scommesse (7).
 *
 * Pattern coerente con Fase 3:
 * - `initManagerAccount(team)`: valori iniziali calibrati su reputation
 * - `ensureManagerAccount(career)`: backward-compat lazy per save legacy
 * - `tickManagerWeekly(career, matchday)`: hookato in `advanceMatchday`
 *
 * NB: il conto manager NON ha sincronia con team.balance o clubFinances.cash.
 * Sono entità distinte. Il manager NON può pagare giocatori col proprio conto
 * (regola di design: il club è un'azienda separata, il manager è un dipendente).
 */

import type { Team } from '$engine/types'
import type { Career, ManagerAccount, ManagerAccountEntry } from './types'

/** Cap history movimenti manager (memory + UI Dashboard trend) */
const HISTORY_CAP = 30

/** Bonus di benvenuto alla firma del contratto manager (Fase 4.A) */
const WELCOME_BONUS = 50_000

// ====== Calibrazione stipendio ======

/**
 * Stipendio settimanale del manager in € basato sulla reputation del club allenato.
 *
 * Formula calibrata su Serie A 2024 (Allegri ~€7M/anno = €135k/sett, Inzaghi
 * ~€6.5M, Allegri Juve ~€6.5M; allenatori mid €1.5-2M = €30-40k/sett;
 * Serie B €500k-1M = €10-20k/sett):
 *
 *   weeklyWage = max(10_000, round(5_000 + rep^1.55 × 90))
 *
 * Esempi (rep → wage):
 *   30 (Serie B medio):   €22k/sett — €1.1M/anno
 *   50 (Serie A salvezza): €42k/sett — €2.2M/anno
 *   70 (Top metà):        €67k/sett — €3.5M/anno
 *   80 (Top4 contender):  €81k/sett — €4.2M/anno
 *   90 (Big club):        €97k/sett — €5.0M/anno
 *  100 (Juve/Inter peak): €115k/sett — €6.0M/anno
 */
export function weeklyWageForManager(team: Team): number {
  const rep = Math.max(1, Math.min(100, team.reputation))
  const wage = 5_000 + Math.pow(rep, 1.55) * 90
  return Math.max(10_000, Math.round(wage / 500) * 500)
}

// ====== Init ======

/**
 * Crea il conto manager iniziale per il club allenato. Saldo parte da un
 * bonus di benvenuto + log della firma in history.
 */
export function initManagerAccount(team: Team): ManagerAccount {
  const weeklyWage = weeklyWageForManager(team)
  return {
    cash: WELCOME_BONUS,
    weeklyWage,
    totalEarned: WELCOME_BONUS,
    history: [
      {
        matchday: 0,
        label: 'Bonus alla firma',
        amount: WELCOME_BONUS,
        balanceAfter: WELCOME_BONUS,
      },
    ],
  }
}

// ====== Backward-compat per save legacy ======

/**
 * Se la career è stata creata prima della Fase 4 (manager.account assente),
 * popola il conto al volo. Idempotente: se già presente, no-op.
 */
export function ensureManagerAccount(career: Career): ManagerAccount {
  if (career.manager.account) return career.manager.account
  const myTeam = career.teams[career.club.teamId]
  const account = initManagerAccount(myTeam)
  career.manager.account = account
  career.updatedAt = Date.now()
  return account
}

// ====== Tick settimanale ======

/**
 * Avanza il conto manager di 1 settimana in-game. Accredita lo stipendio
 * settimanale, logga in history.
 *
 * Da chiamare in `advanceMatchday` DOPO `financesWeeklyTick` (l'ordine è
 * logico: prima il club paga le sue spese, poi il manager riceve il suo
 * stipendio). Determinismo: nessun jitter sullo stipendio fisso (foundation
 * 4.A; in 4.B i bonus performance potranno introdurre variabilità).
 */
export function tickManagerWeekly(career: Career, matchday: number): void {
  const account = ensureManagerAccount(career)
  const wage = account.weeklyWage
  account.cash += wage
  account.totalEarned += wage
  account.history.unshift({
    matchday,
    label: 'Stipendio settimanale',
    amount: wage,
    balanceAfter: account.cash,
  })
  if (account.history.length > HISTORY_CAP) {
    account.history.length = HISTORY_CAP
  }
}

// ====== Helpers per UI ======

/**
 * Restituisce il trend del saldo manager negli ultimi N matchday distinti.
 * Stessa logica di `cashTrend(finances)` in finances.ts.
 */
export function managerCashTrend(account: ManagerAccount, lastN = 4): { matchday: number; balance: number }[] {
  const byMatchday = new Map<number, number>()
  for (const e of account.history) {
    if (!byMatchday.has(e.matchday)) {
      byMatchday.set(e.matchday, e.balanceAfter)
    }
  }
  return Array.from(byMatchday.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(-lastN)
    .map(([matchday, balance]) => ({ matchday, balance }))
}

/** Variazione % saldo manager tra primo e ultimo punto del trend (lastN turni). */
export function managerCashTrendPct(account: ManagerAccount, lastN = 4): number {
  const trend = managerCashTrend(account, lastN)
  if (trend.length < 2) return 0
  const first = trend[0].balance
  const last = trend[trend.length - 1].balance
  if (first === 0) return 0
  return ((last - first) / Math.abs(first)) * 100
}
