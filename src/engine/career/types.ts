/**
 * Tipi carriera: il contenitore di tutto lo stato di gioco serializzato.
 * Una Career == un savegame.
 */

import type { EntityId, Team, Player, Stadium, League, Season } from '$engine/types'
import type { Fixture } from '$engine/competition/types'
import type { Tactics, Lineup } from '$engine/tactics/types'
import type { BettingCareerData } from '$engine/betting/types'

// ====== Finanze club (Fase 3.1) ======

/** Voce singola di movimento finanziario, per history/trend in Dashboard */
export interface FinanceEntry {
  /** Giornata di campionato in cui è avvenuto il movimento */
  matchday: number
  /** Etichetta breve (es. "Sponsor", "Stipendi", "Gate", "Premi") */
  label: string
  /** Importo in € (positivo = ricavo, negativo = spesa) */
  amount: number
  /** Saldo cassa DOPO questo movimento */
  balanceAfter: number
}

/**
 * Finanze dettagliate del club del giocatore.
 * Solo per `career.club.teamId`. Per le AI usiamo direttamente `team.balance`.
 *
 * Sincronia con Team.balance:
 * - `cash` è la single source of truth per il MIO club
 * - dopo ogni mutation, `teams[myTeamId].balance` viene allineato a `cash`
 * - in questo modo il resto del codice che legge `team.balance` (es. mercato AI futuro)
 *   funziona uniformemente per tutti i team
 */
export interface ClubFinances {
  /** Cassa attuale in € (allineata a team.balance del mio club) */
  cash: number
  /** Monte ingaggi mensile in € (somma stipendi rosa) */
  monthlyWageBudget: number
  /** Sponsor maglia annuale in € — pagato pro-rata settimanale */
  sponsorAnnual: number
  /** Premi competizioni accumulati nella stagione corrente in € */
  prizeMoneyEarned: number
  /** Budget mercato disponibile in € — usato in Fase 3.4 */
  transferBudget: number
  /** Ricavi medi settimanali stimati in € (gate + sponsor pro-rata + merch) */
  weeklyIncome: number
  /** Spese medie settimanali stimate in € (stipendi/4 + manutenzione + scouting) */
  weeklyExpenses: number
  /** Ultimi ~30 movimenti per grafico trend / log finanze */
  history: FinanceEntry[]
}

export interface Manager {
  id: EntityId
  name: string
  /** ID squadra allenata; null se senza squadra (Fase 2+: free agent) */
  teamId: EntityId | null
  /** Reputazione 1-100 */
  reputation: number
  /** Stagioni completate con la squadra attuale */
  seasonsAtClub: number
}

/** Stato squadra del giocatore (tattica salvata + lineup correnti) */
export interface ClubState {
  teamId: EntityId
  tactics: Tactics
  lineup: Lineup
}

/** Notizia/evento in feed dashboard (rosa, partite, mercato, board) */
export interface NewsItem {
  id: EntityId
  /** Data ISO della news */
  date: string
  kind: 'match_result' | 'matchday_advance' | 'transfer' | 'board' | 'injury' | 'generic'
  title: string
  body?: string
  /** Letta dall'utente */
  read: boolean
}

// ====== Mercato (Fase 3.G) ======

/**
 * Stato di un'offerta di trasferimento. Gli stati finali (accepted/rejected/
 * expired) restano nell'array per la history, finché non vengono potati
 * dopo qualche giornata. Le 'pending' sono quelle attive.
 */
export type TransferOfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired'

/**
 * Offerta di trasferimento tra due club per un singolo giocatore.
 * In Fase 3.G.1 sono solo offerte AI → MIO club. In 3.G.2 si aggiungono le
 * mie offerte verso AI e gli scambi AI↔AI di sottofondo.
 */
export interface TransferOffer {
  id: EntityId
  /** Team che fa l'offerta (compratore) */
  fromTeamId: EntityId
  /** Team che possiede il giocatore (venditore) */
  toTeamId: EntityId
  playerId: EntityId
  /** Importo offerto in € */
  amount: number
  /** Matchday di creazione */
  createdMd: number
  /** Matchday entro cui va accettata/rifiutata (poi diventa 'expired') */
  expiresMd: number
  status: TransferOfferStatus
  /**
   * Round di trattativa già consumati (default 0). Max 2 per offerta:
   * dopo il 2° rilancio l'AI accetta o chiude definitivamente.
   * Fase 3.G.1.
   */
  negotiationsCount?: number
  /**
   * Importo iniziale dell'offerta (immutabile dopo la creazione). amount può
   * cambiare via trattativa, originalAmount no — serve per UI/history.
   */
  originalAmount?: number
}

/**
 * Trasferimento completato (finalizzato dopo accept). Salvato in history per
 * UI/news/audit. La plusvalenza è calcolata vs `marketValue` al momento della
 * cessione (semplificazione del bookValue contabile).
 */
export interface CompletedTransfer {
  id: EntityId
  matchday: number
  date: string
  playerId: EntityId
  playerName: string
  position: string
  fromTeamId: EntityId
  fromTeamName: string
  toTeamId: EntityId
  toTeamName: string
  amount: number
  /** amount - marketValue al momento della cessione */
  profitLoss: number
  /** Era una cessione del mio club? */
  isMineSold: boolean
  /** Era un acquisto del mio club? (Fase 3.G.2) */
  isMineBought: boolean
}

/**
 * Container completo di una carriera salvata.
 * Tutto qui dentro viene serializzato e finisce in IndexedDB.
 */
export interface Career {
  /** Schema version per future migrazioni */
  schemaVersion: 1
  /** ID univoco della carriera (savegame) */
  id: EntityId
  /** Nome dello slot di salvataggio (es. "Carriera 1") */
  name: string
  /** Seed deterministico usato per generare il mondo */
  seed: number
  createdAt: number
  updatedAt: number

  manager: Manager
  season: Season

  /** Tutte le entità del mondo */
  teams: Record<EntityId, Team>
  players: Record<EntityId, Player>
  stadiums: Record<EntityId, Stadium>
  leagues: Record<EntityId, League>

  /** Calendario di tutte le competizioni (Fase 1: solo 2 leghe nazionali) */
  fixtures: Fixture[]

  /** Stato della squadra del giocatore */
  club: ClubState

  /** Feed news (max ~50, vecchie auto-purged) */
  news: NewsItem[]

  /**
   * Dati del modulo scommesse sportive. Opzionale per backward-compat con save legacy:
   * se mancante, ensureBettingData() in $engine/betting/orchestrator lo inizializza al volo.
   * Vedi docs/specs/betting/BETTING_SPEC.md.
   */
  bettingCareerData?: BettingCareerData

  /**
   * Finanze dettagliate del club del giocatore. Opzionale per backward-compat con
   * save legacy: se mancante, ensureClubFinances() in $engine/career/finances la
   * inizializza al volo dalla `reputation` del team. Fase 3.1.
   */
  clubFinances?: ClubFinances

  /**
   * Offerte di trasferimento attive (pending) e recenti (max ~50 con stati
   * finali, poi potate). Opzionale per backward-compat: se mancante
   * `ensureTransferState()` in transfers.ts lo inizializza al volo. Fase 3.G.
   */
  transferOffers?: TransferOffer[]

  /**
   * Trasferimenti completati (max ultimi 30). Per UI history + audit
   * plusvalenze. Opzionale per backward-compat (idem sopra).
   */
  transferHistory?: CompletedTransfer[]

  /**
   * Flag migration one-shot: i marketValue di tutti i player sono stati ricalibrati
   * con la formula corretta (Serie A 2024). Setato da `ensureMarketValuesCalibrated`.
   * Fase 3.G fix-values.
   */
  marketValuesV2?: boolean
}
