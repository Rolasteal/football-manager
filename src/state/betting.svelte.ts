/**
 * Store Svelte 5 ($state runes) per il modulo betting.
 *
 * Pattern coerente con $state/career.svelte.ts:
 * - Mutazioni in-place del Career.bettingCareerData
 * - Reattività via runes
 * - Persistenza affidata a careerStore.persistActiveCareer()
 *
 * Vedi BETTING_SPEC.md sez. 12 e 11.
 */

import type { MatchEvent } from '$engine/match/types'
import type { MatchResult } from '$engine/competition/types'
import type {
  BettingCareerData,
  BetSelection,
  BetSlipDraft,
  BetSlipMode,
  MatchOddsBoard,
  PlacedBet,
  LiveContext,
  Market,
} from '$engine/betting'
import {
  ensureBettingData,
  isOwnTeamFixture,
  generateOddsForMatchday,
  placeBet,
  onMatchEvent,
  settleMatch,
  executeCashOut,
  onMatchdayAdvance,
  type LineupResolver,
  type FormResolver,
} from '$engine/betting/orchestrator'
import { priceSlip, validateSlip } from '$engine/betting/betSlip'
import { computeCashOut } from '$engine/betting/cashout'
import { careerStore, persistActiveCareer } from '$state/career.svelte'

// ============================================================
// SLIP DRAFT (lo stato della schedina in costruzione)
// ============================================================

interface SlipState {
  mode: BetSlipMode
  selections: BetSelection[]
  stake: number
  systemSize: number
  acceptOddsChange: 'always' | 'higher_only' | 'never'
  promotionId?: string
}

interface RecentSettlement {
  bet: PlacedBet
  at: number
}

interface BettingStore {
  draft: SlipState
  data: BettingCareerData | null
  /** Bollette appena risolte (per toast/animazioni), TTL 5s gestito dal consumer. */
  recentSettlements: RecentSettlement[]
  /** Flash messages (es. validation errors, promo applicate). */
  flash: { kind: 'info' | 'warn' | 'error' | 'success'; msg: string; at: number } | null
}

const _store = $state<BettingStore>({
  draft: emptyDraft(),
  data: null,
  recentSettlements: [],
  flash: null,
})

function emptyDraft(): SlipState {
  return {
    mode: 'single',
    selections: [],
    stake: 10,
    systemSize: 2,
    acceptOddsChange: 'higher_only',
  }
}

// ============================================================
// API
// ============================================================

export function bettingStore() {
  return _store
}

export function bindBettingToCareer(): void {
  const c = careerStore().career
  if (!c) {
    _store.data = null
    return
  }
  _store.data = ensureBettingData(c)
}

// ============================================================
// GENERAZIONE QUOTE
// ============================================================

export interface BettingHooks {
  lineupResolver: LineupResolver
  formResolver: FormResolver
  derbyDetector?: (career: any, fixture: any) => boolean
}

let _hooks: BettingHooks | null = null
export function setBettingHooks(hooks: BettingHooks): void {
  _hooks = hooks
}

export function generateOdds(matchday?: number): MatchOddsBoard[] {
  const career = careerStore().career
  if (!career || !_hooks) return []
  const md = matchday ?? career.season.currentMatchday
  // Skip se già generate per quella giornata
  const data = ensureBettingData(career)
  const existing = Object.values(data.oddsBoards).filter(b => b.matchday === md)
  if (existing.length > 0) return existing
  const boards = generateOddsForMatchday({
    career,
    matchday: md,
    lineupResolver: _hooks.lineupResolver,
    formResolver: _hooks.formResolver,
    derbyDetector: _hooks.derbyDetector,
  })
  _store.data = data
  persistActiveCareer()
  return boards
}

// ============================================================
// SCHEDINA
// ============================================================

export function addToSlip(sel: BetSelection): void {
  // Se modalità singola e abbiamo già una selezione, sostituisci
  const draft = _store.draft
  if (draft.mode === 'single' && draft.selections.length > 0) {
    draft.selections = [sel]
    return
  }
  // Se stesso mercato/fixture già presente, rimpiazza la selezione
  const idx = draft.selections.findIndex(s => s.fixtureId === sel.fixtureId && s.marketId === sel.marketId)
  if (idx >= 0) {
    draft.selections[idx] = sel
    return
  }
  draft.selections.push(sel)
  // Se ora abbiamo >=2 selezioni e siamo in single, passa a multipla
  if (draft.mode === 'single' && draft.selections.length >= 2) {
    draft.mode = 'multiple'
  }
}

export function removeFromSlip(marketId: string): void {
  _store.draft.selections = _store.draft.selections.filter(s => s.marketId !== marketId)
  if (_store.draft.selections.length === 0) _store.draft.mode = 'single'
}

export function clearSlip(): void {
  _store.draft = emptyDraft()
}

export function setSlipMode(mode: BetSlipMode): void {
  _store.draft.mode = mode
}

export function setSlipStake(stake: number): void {
  _store.draft.stake = Math.max(0, stake)
}

export function setSystemSize(k: number): void {
  _store.draft.systemSize = Math.max(1, Math.floor(k))
}

export function previewSlip() {
  const career = careerStore().career
  if (!career) return null
  const data = ensureBettingData(career)
  const marketsMap = collectMarkets(data)
  const draftAsBetSlipDraft: BetSlipDraft = {
    mode: _store.draft.mode,
    selections: _store.draft.selections,
    stake: _store.draft.stake,
    systemSize: _store.draft.systemSize,
    acceptOddsChange: _store.draft.acceptOddsChange,
  }
  const validation = validateSlip(draftAsBetSlipDraft, marketsMap)
  const promo = _store.draft.promotionId
    ? data.promotions.find(p => p.id === _store.draft.promotionId)
    : undefined
  const pricing = priceSlip(draftAsBetSlipDraft, marketsMap, promo)
  return { validation, pricing }
}

export function placeSlip(): boolean {
  const career = careerStore().career
  if (!career) return false
  const draft: BetSlipDraft = {
    mode: _store.draft.mode,
    selections: _store.draft.selections,
    stake: _store.draft.stake,
    systemSize: _store.draft.systemSize,
    acceptOddsChange: _store.draft.acceptOddsChange,
  }
  const result = placeBet({ career, draft, promotionId: _store.draft.promotionId })
  if (!result.ok) {
    _store.flash = { kind: 'error', msg: result.errors.join(' • '), at: Date.now() }
    return false
  }
  _store.flash = { kind: 'success', msg: 'Scommessa piazzata', at: Date.now() }
  clearSlip()
  persistActiveCareer()
  return true
}

// ============================================================
// LIVE
// ============================================================

export function reportMatchEvent(fixtureId: string, event: MatchEvent, ctx: LiveContext): void {
  const career = careerStore().career
  if (!career) return
  onMatchEvent({ career, fixtureId, event, ctx })
}

export function settleFixtureMatch(fixtureId: string, result: MatchResult): void {
  const career = careerStore().career
  if (!career) return
  const recent = settleMatch({ career, fixtureId, result })
  _store.recentSettlements = [
    ...recent.map(b => ({ bet: b, at: Date.now() })),
    ..._store.recentSettlements,
  ].slice(0, 20)
  persistActiveCareer()
}

// ============================================================
// CASH OUT
// ============================================================

export function previewCashOut(betId: string) {
  const career = careerStore().career
  if (!career) return { available: false as const, value: 0 }
  const data = ensureBettingData(career)
  const bet = data.openBets.find(b => b.id === betId)
  if (!bet) return { available: false as const, value: 0 }
  return computeCashOut(bet, collectMarkets(data))
}

export function doCashOut(betId: string): boolean {
  const career = careerStore().career
  if (!career) return false
  const r = executeCashOut({ career, betId })
  if (!r.ok) {
    _store.flash = { kind: 'error', msg: r.reason, at: Date.now() }
    return false
  }
  _store.flash = { kind: 'success', msg: `Cash out €${r.value.toFixed(2)}`, at: Date.now() }
  persistActiveCareer()
  return true
}

// ============================================================
// MATCHDAY ROLLOVER
// ============================================================

export function rolloverIfNeeded(): void {
  const career = careerStore().career
  if (!career) return
  const data = ensureBettingData(career)
  if (data.wallet.matchdayState.matchday !== career.season.currentMatchday) {
    onMatchdayAdvance(career, career.season.currentMatchday)
    persistActiveCareer()
  }
}

// ============================================================
// HELPERS
// ============================================================

function collectMarkets(data: BettingCareerData): Record<string, Market> {
  const map: Record<string, Market> = {}
  for (const board of Object.values(data.oddsBoards)) {
    for (const m of board.markets) map[m.id] = m
  }
  return map
}

// ============================================================
// SELECTORS UTILITY
// ============================================================

export function getBoardsForMatchday(matchday: number): MatchOddsBoard[] {
  const career = careerStore().career
  if (!career) return []
  const data = ensureBettingData(career)
  return Object.values(data.oddsBoards).filter(b => b.matchday === matchday)
}

export function getBoard(fixtureId: string): MatchOddsBoard | null {
  const career = careerStore().career
  if (!career) return null
  const data = ensureBettingData(career)
  return data.oddsBoards[fixtureId] ?? null
}

export function getOpenBets(): PlacedBet[] {
  const career = careerStore().career
  if (!career) return []
  const data = ensureBettingData(career)
  return data.openBets
}

export function getSettledBets(): PlacedBet[] {
  const career = careerStore().career
  if (!career) return []
  const data = ensureBettingData(career)
  return data.settledBets
}

export function getStats() {
  const career = careerStore().career
  if (!career) return null
  const data = ensureBettingData(career)
  return data.stats
}

/**
 * Helper per la UI: true se la fixture coinvolge la squadra del manager.
 * Da usare per disabilitare le OddsButton con tooltip "Vietato propria squadra".
 */
export function isMyTeamMatch(fixtureId: string): boolean {
  const career = careerStore().career
  if (!career) return false
  return isOwnTeamFixture(career, fixtureId)
}
