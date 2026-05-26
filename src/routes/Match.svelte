<script lang="ts">
  import { push } from 'svelte-spa-router'
  import { onMount, onDestroy, tick } from 'svelte'
  import { careerStore, persistActiveCareer } from '$state/career.svelte'
  import { advanceMatchday, autoLineup, FORMATIONS } from '$engine/career/career'
  import type { Fixture, MatchResult, TeamMatchStats } from '$engine/competition/types'
  import type { MatchEvent } from '$engine/match/types'
  import type { Lineup } from '$engine/tactics/types'
  import type { EntityId, Player } from '$engine/types'

  const store = careerStore()
  let career = $derived(store.career)

  type OverlayKind = 'goal' | 'yellow' | 'red' | 'half_time' | 'full_time' | 'kickoff' | 'second_half' | 'penalty' | 'penalty_miss' | 'mvp'
  type PenaltyMissKind = 'high' | 'wide_left' | 'wide_right' | 'post' | 'crossbar'
  interface OverlayPayload {
    kind: OverlayKind
    side?: 'home' | 'away' | null
    playerName?: string
    teamName?: string
    /** Tipo di "rigore sbagliato" — per scegliere la PNG fra le 5 di Roberto */
    missKind?: PenaltyMissKind
    // MVP fields
    mvpId?: EntityId
    mvpRating?: number
    mvpBonus?: number
    mvpTotal?: number
  }

  let myFixture = $state<Fixture | null>(null)
  let result = $state<MatchResult | null>(null)
  let homeLineup = $state<Lineup | null>(null)
  let awayLineup = $state<Lineup | null>(null)
  let shown = $state<MatchEvent[]>([])
  let currentIdx = $state(0)
  let homeScore = $state(0)
  let awayScore = $state(0)
  /** Tempo simulato corrente in SECONDI (0 a ~95*60). Cresce fluido tra eventi. */
  let clockSec = $state(0)
  let playing = $state(true)
  let finished = $state(false)
  let speed = $state(1)  // 0.5, 1, 2, 4, 8
  let goalFlash = $state(false)
  let overlay = $state<OverlayPayload | null>(null)
  let errorMsg = $state<string | null>(null)
  let streamEl: HTMLDivElement | undefined = $state()
  let timer: ReturnType<typeof setTimeout> | null = null
  let overlayTimer: ReturnType<typeof setTimeout> | null = null

  // ====== CRONOMETRO ANIMATO ======
  // Tra un evento e l'altro avanziamo il clock con requestAnimationFrame
  // in modo che minuti:secondi scorrano fluidi; quando arriva l'evento
  // (overlay/suspense) il clock si ferma sul valore corrente.
  let rafId = 0
  let clockStartWall = 0
  let clockStartSim = 0
  let clockTargetSim = 0
  let clockDurMs = 0
  let clockRunning = false

  function startClockAnim(fromSec: number, toSec: number, durMs: number) {
    stopClockAnim()
    if (toSec <= fromSec || durMs <= 16) {
      clockSec = toSec
      return
    }
    clockStartWall = performance.now()
    clockStartSim = fromSec
    clockTargetSim = toSec
    clockDurMs = durMs
    clockRunning = true
    rafId = requestAnimationFrame(clockLoop)
  }
  function clockLoop() {
    if (!clockRunning) return
    const t = Math.min(1, (performance.now() - clockStartWall) / clockDurMs)
    clockSec = clockStartSim + (clockTargetSim - clockStartSim) * t
    if (t < 1) rafId = requestAnimationFrame(clockLoop)
    else clockRunning = false
  }
  function stopClockAnim() {
    clockRunning = false
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  }

  function fmtClock(sec: number): string {
    const total = Math.max(0, Math.floor(sec))
    const mm = Math.floor(total / 60)
    const ss = total % 60
    return `${mm}'${String(ss).padStart(2, '0')}"`
  }

  function eventDelay(): number {
    // Default 5000ms/evento (cinematografico); 0.5x = ultra-lento, 2x/4x/8x = veloce
    const baseMs = 5000
    return Math.max(80, baseMs / speed)
  }

  // Durata overlay drammatici (NEUTRA rispetto a speed: la "pausa narrativa" è fissa)
  const OVERLAY_MS: Record<OverlayKind, number> = {
    goal: 4200,
    yellow: 2200,
    red: 3000,
    half_time: 5000,
    full_time: 5500,
    kickoff: 5000,
    second_half: 5000,
    penalty: 2600,
    penalty_miss: 3500,
    mvp: 6500,
  }

  // Pre-evento "suspense": qualcosa sta per accadere
  type SuspenseKind = 'goal' | 'yellow' | 'red' | 'penalty'
  let suspense = $state<SuspenseKind | null>(null)
  let suspenseTimer: ReturnType<typeof setTimeout> | null = null

  const SUSPENSE_MS: Record<SuspenseKind, number> = {
    goal: 2000,
    yellow: 1400,
    red: 1900,
    penalty: 2200,
  }

  function suspenseKindOf(ev: MatchEvent): SuspenseKind | null {
    if (ev.kind === 'goal') return 'goal'
    if (ev.kind === 'yellow_card') return 'yellow'
    if (ev.kind === 'red_card') return 'red'
    if (ev.kind === 'penalty') return 'penalty'
    return null
  }

  function nameOf(playerId?: string): string {
    if (!playerId || !career) return ''
    const p = career.players[playerId]
    if (!p) return ''
    return `${p.firstName} ${p.lastName}`
  }
  function teamOfSide(side: 'home' | 'away' | null | undefined): string {
    if (!myFixture || !side) return ''
    return teamName(side === 'home' ? myFixture.homeId : myFixture.awayId)
  }

  // ====== LINEUP + VOTI LIVE (fantacalcio v1) ======
  // NB: la versione "definitiva" dei voti la rifineremo dopo (vedi
  // memoria [[project-voti-fantacalcio]]).
  function getPlayer(id: EntityId): Player | null {
    return career?.players[id] ?? null
  }
  function lastNameOf(id: EntityId): string {
    return getPlayer(id)?.lastName ?? '—'
  }
  function shirtOf(id: EntityId): string {
    const n = getPlayer(id)?.shirtNumber
    return n == null ? '—' : String(n)
  }

  /**
   * Voto BASE prestazione 4.0-10.0 calcolato sugli eventi mostrati.
   * NON include gol/assist/cartellini/rigori — quelli sono fanta-bonus
   * separati (vedi computeFantaBonus) e vengono sommati per il voto
   * finale mostrato. Qui solo metriche di "pagella" tipo FM.
   */
  function computeLiveRatings(events: MatchEvent[]): Record<EntityId, number> {
    const r: Record<EntityId, number> = {}
    const adj = (id: EntityId | undefined, delta: number) => {
      if (!id) return
      if (r[id] === undefined) r[id] = 6.0
      r[id] = Math.max(4, Math.min(10, r[id] + delta))
    }
    const touch = (id: EntityId | undefined) => {
      if (id && r[id] === undefined) r[id] = 6.0
    }
    for (const ev of events) {
      touch(ev.playerId)
      touch(ev.secondaryPlayerId)
      switch (ev.kind) {
        case 'shot_on_target': adj(ev.playerId, +0.1); break
        case 'save':           adj(ev.playerId, +0.3); break
        case 'shot':           adj(ev.playerId, -0.05); break
        case 'foul':           adj(ev.playerId, -0.05); break
      }
    }
    return r
  }

  let liveRatings = $derived(computeLiveRatings(shown))

  function rating(id: EntityId): number {
    const v = liveRatings[id]
    return v === undefined ? 6.0 : v
  }
  function ratingClass(v: number): string {
    if (v >= 7.5) return 'r-top'
    if (v >= 6.5) return 'r-ok'
    if (v >= 5.5) return 'r-mid'
    return 'r-low'
  }
  function fmtRating(v: number): string {
    return v.toFixed(1)
  }

  // ====== FANTA-BONUS (separato dal voto base) ======
  // Roberto's spec:
  //   +3 gol segnato,  -3 rigore sbagliato,  -1 espulsione,
  //   -0.5 giallo,  +3 GK para rigore,  -1 GK gol subito.
  /** GK in campo = primo starter con position='GK' nella lineup.
   *  Usa la lineup invece di "primo GK della rosa" — altrimenti su
   *  team con 2 portieri si beccava sempre il #1 anche se in panchina. */
  function gkOfLineup(lineup: Lineup | null): EntityId | undefined {
    if (!career || !lineup) return undefined
    return lineup.starters.find(id => career.players[id]?.position === 'GK')
  }
  let homeGkId = $derived(gkOfLineup(homeLineup))
  let awayGkId = $derived(gkOfLineup(awayLineup))

  function computeFantaBonus(events: MatchEvent[]): Record<EntityId, number> {
    const r: Record<EntityId, number> = {}
    const adj = (id: EntityId | undefined, delta: number) => {
      if (!id) return
      r[id] = (r[id] ?? 0) + delta
    }
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (ev.kind === 'goal') {
        adj(ev.playerId, +3)
        if (ev.secondaryPlayerId) adj(ev.secondaryPlayerId, +1)  // assist
        // -1 al portiere avversario per gol subito
        adj(ev.side === 'home' ? awayGkId : homeGkId, -1)
      } else if (ev.kind === 'yellow_card') {
        adj(ev.playerId, -0.5)
      } else if (ev.kind === 'red_card') {
        // Spec Roberto: 2° giallo → malus TOTALE -1 (cioè i 2 gialli da
        // -0.5 sono sufficienti, il rosso 'second_yellow' non aggiunge nulla).
        // Rosso DIRETTO → -1.5 secco (niente giallo prima).
        if (ev.note !== 'second_yellow') {
          adj(ev.playerId, -1.5)
        }
      } else if (ev.kind === 'penalty') {
        // Esito del rigore: cerca nei prossimi eventi
        for (let j = i + 1; j < Math.min(i + 5, events.length); j++) {
          const next = events[j]
          if (next.minute !== ev.minute) break
          if (next.kind === 'save' && next.side !== ev.side) {
            // Parato: GK +3, taker -3
            adj(next.playerId, +3)
            adj(next.secondaryPlayerId, -3)
            break
          }
          if (next.kind === 'shot' && next.side === ev.side) {
            // Sbagliato (fuori): taker -3
            adj(next.playerId, -3)
            break
          }
          if (next.kind === 'goal' && next.side === ev.side) {
            // Segnato — il +3 è già stato applicato dal goal handler sopra
            break
          }
        }
      }
    }
    return r
  }

  let fantaBonus = $derived(computeFantaBonus(shown))

  // ====== BADGES ICONE accanto al nome (pallone gol, giallo, rosso, sub in/out) ======
  interface PlayerBadges { goals: number; yellow: boolean; red: boolean; subIn: boolean; subOut: boolean }
  function computePlayerBadges(events: MatchEvent[]): Record<EntityId, PlayerBadges> {
    const r: Record<EntityId, PlayerBadges> = {}
    const ensure = (id: EntityId) => {
      if (!r[id]) r[id] = { goals: 0, yellow: false, red: false, subIn: false, subOut: false }
      return r[id]
    }
    for (const ev of events) {
      if (ev.kind === 'goal' && ev.playerId) ensure(ev.playerId).goals++
      if (ev.kind === 'yellow_card' && ev.playerId) ensure(ev.playerId).yellow = true
      if (ev.kind === 'red_card' && ev.playerId) ensure(ev.playerId).red = true
      if (ev.kind === 'substitution') {
        // playerId = chi esce, secondaryPlayerId = chi entra
        if (ev.playerId) ensure(ev.playerId).subOut = true
        if (ev.secondaryPlayerId) ensure(ev.secondaryPlayerId).subIn = true
      }
    }
    return r
  }
  let badges = $derived(computePlayerBadges(shown))
  function badgeOf(id: EntityId): PlayerBadges {
    return badges[id] ?? { goals: 0, yellow: false, red: false, subIn: false, subOut: false }
  }

  // ====== STATISTICHE LIVE (da shown[], non da result.stats che è il totale finale) ======
  function emptyTeamStats(): TeamMatchStats {
    return { possession: 50, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0, passes: 0, passAccuracy: 0 }
  }
  function computeLiveStats(events: MatchEvent[]): { home: TeamMatchStats; away: TeamMatchStats } {
    const home = emptyTeamStats()
    const away = emptyTeamStats()
    for (const ev of events) {
      const t = ev.side === 'home' ? home : ev.side === 'away' ? away : null
      if (!t) continue
      switch (ev.kind) {
        case 'shot':           t.shots++; break
        case 'shot_on_target': t.shots++; t.shotsOnTarget++; break
        case 'goal':           t.shots++; t.shotsOnTarget++; break
        case 'corner':         t.corners++; break
        case 'foul':           t.fouls++; break
        case 'yellow_card':    t.yellowCards++; break
        case 'red_card':       t.redCards++; break
      }
    }
    // Possesso: dato "di partita" — uso quello dell'engine come stima media
    // (non è derivabile da eventi discreti senza simulare il tempo di palla)
    if (result?.stats) {
      home.possession = result.stats.home.possession
      away.possession = result.stats.away.possession
    }
    return { home, away }
  }
  let liveStats = $derived(computeLiveStats(shown))

  function bonusOf(id: EntityId): number {
    return fantaBonus[id] ?? 0
  }
  function totalOf(id: EntityId): number {
    return rating(id) + bonusOf(id)
  }
  function fmtBonus(v: number): string {
    if (v === 0) return ''
    return v > 0 ? `+${v.toFixed(1).replace(/\.0$/, '')}` : v.toFixed(1).replace(/\.0$/, '')
  }

  // ====== MVP (miglior fanta-punteggio tra tutti i 22 titolari) ======
  function computeMvp(): { id: EntityId; rating: number; bonus: number; total: number; side: 'home' | 'away' } | null {
    if (!homeLineup || !awayLineup) return null
    let best: { id: EntityId; rating: number; bonus: number; total: number; side: 'home' | 'away' } | null = null
    const consider = (id: EntityId, side: 'home' | 'away') => {
      const rt = rating(id)
      const bn = bonusOf(id)
      const tt = rt + bn
      if (!best || tt > best.total) best = { id, rating: rt, bonus: bn, total: tt, side }
    }
    for (const id of homeLineup.starters) consider(id, 'home')
    for (const id of awayLineup.starters) consider(id, 'away')
    return best
  }

  onMount(async () => {
    if (!career) { push('/'); return }
    // Preload asset overlay per evitare lag al primo trigger
    const PRELOAD = [
      '/assets/match/Gol.png',
      '/assets/match/Cartellino_giallo.png',
      '/assets/match/Cartellino_rosso.png',
      '/assets/match/Inizio_partita.png',
      '/assets/match/Fine_primo_tempo.png',
      '/assets/match/Inizio_secondo_tempo.png',
      '/assets/match/Fine_partita.png',
      '/assets/match/MVP.png',
      '/assets/match/Rigore_sbagliato_alto.png',
      '/assets/match/Rigore_sbagliato_fuori.png',
      '/assets/match/Rigore_sbagliato_fuori2.png',
      '/assets/match/Rigore_sbagliato_palo.png',
      '/assets/match/Rigore_sbagliato_traversa.png',
    ]
    // Preload BLOCCANTE: aspetta che le PNG siano in cache prima di mostrare
    // l'overlay kickoff (altrimenti il primo overlay è nero senza immagine).
    await Promise.all(PRELOAD.map(src => new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => resolve()  // file mancante → continua comunque
      img.src = src
    })))
    try {
      // Avanza la giornata (simula tutte le partite, trova la mia)
      const adv = advanceMatchday(career)
      myFixture = adv.myFixture
      if (!myFixture || !myFixture.result) {
        errorMsg = 'Nessuna partita per la tua squadra in questa giornata.'
        finished = true
        await persistActiveCareer()
        return
      }
      result = myFixture.result
      // Lineup: ora le legge dal result (calcolate in advanceMatchday e
      // usate dall'engine — così gli eventi sono coerenti coi titolari).
      // Fallback su autoLineup per save vecchi senza i campi nuovi.
      if (result.homeLineup && result.awayLineup) {
        homeLineup = result.homeLineup
        awayLineup = result.awayLineup
      } else {
        const myTeamId = career.club.teamId
        const homePlayers = Object.values(career.players).filter(p => p.teamId === myFixture!.homeId)
        const awayPlayers = Object.values(career.players).filter(p => p.teamId === myFixture!.awayId)
        const fallbackFormation = FORMATIONS[career.club.tactics.formation] ?? FORMATIONS['4-3-3']
        if (myFixture.homeId === myTeamId) {
          homeLineup = career.club.lineup
          awayLineup = autoLineup(fallbackFormation, awayPlayers)
        } else {
          homeLineup = autoLineup(fallbackFormation, homePlayers)
          awayLineup = career.club.lineup
        }
      }
      // Persistenza fuori dal critical path
      persistActiveCareer()
      // Slide INIZIO PARTITA immediata: consumo il primo evento (kickoff a min 0)
      // senza aspettare i 5s del primo tick così l'overlay appare subito.
      const firstEv = result.events[0]
      if (firstEv && firstEv.kind === 'kickoff' && firstEv.minute === 0) {
        consumeEvent(firstEv)
      } else {
        tickReplay()
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
    }
  })

  onDestroy(() => {
    if (timer) { clearTimeout(timer); timer = null }
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null }
    if (suspenseTimer) { clearTimeout(suspenseTimer); suspenseTimer = null }
    stopClockAnim()
  })

  function maybeOpenOverlay(ev: MatchEvent): boolean {
    let payload: OverlayPayload | null = null
    if (ev.kind === 'goal') {
      payload = { kind: 'goal', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (ev.kind === 'yellow_card') {
      payload = { kind: 'yellow', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (ev.kind === 'red_card') {
      payload = { kind: 'red', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (ev.kind === 'penalty') {
      payload = { kind: 'penalty', side: ev.side, playerName: nameOf(ev.playerId), teamName: teamOfSide(ev.side) }
    } else if (
      ev.kind === 'shot' &&
      (ev.note === 'high' || ev.note === 'wide_left' || ev.note === 'wide_right' || ev.note === 'post' || ev.note === 'crossbar')
    ) {
      // Rigore sbagliato: trigger overlay con la PNG specifica del tipo
      payload = {
        kind: 'penalty_miss',
        side: ev.side,
        playerName: nameOf(ev.playerId),
        teamName: teamOfSide(ev.side),
        missKind: ev.note,
      }
    } else if (ev.kind === 'half_time') {
      payload = { kind: 'half_time' }
    } else if (ev.kind === 'full_time') {
      payload = { kind: 'full_time' }
    } else if (ev.kind === 'kickoff') {
      // L'engine emette 2 kickoff: minuto 0 = inizio partita, minuto 46 = inizio 2° tempo
      payload = ev.minute === 0 ? { kind: 'kickoff' } : { kind: 'second_half' }
    }
    if (!payload) return false
    overlay = payload
    stopClockAnim()
    const ms = OVERLAY_MS[payload.kind]
    overlayTimer = setTimeout(() => {
      overlay = null
      overlayTimer = null
      if (playing && !finished) tickReplay()
    }, ms)
    return true
  }

  /**
   * Tick principale: avvia il cronometro animato da clockSec fino al
   * minuto:second del prossimo evento, e dopo eventDelay() lo consuma.
   */
  function triggerMvpOverlay() {
    const m = computeMvp()
    if (!m) return
    overlay = {
      kind: 'mvp',
      side: m.side,
      mvpId: m.id,
      mvpRating: m.rating,
      mvpBonus: m.bonus,
      mvpTotal: m.total,
    }
    overlayTimer = setTimeout(() => {
      overlay = null
      overlayTimer = null
    }, OVERLAY_MS.mvp)
  }

  function tickReplay() {
    if (!result || !playing) return
    if (overlay || suspense) return  // blocchi attivi: aspetta che si liberino
    if (currentIdx >= result.events.length) {
      stopClockAnim()
      finished = true
      playing = false
      triggerMvpOverlay()
      return
    }
    const ev = result.events[currentIdx]
    const targetSec = ev.minute * 60 + ev.second
    const delay = eventDelay()
    // Animazione cronometro: scorre fluido fino al prossimo evento
    startClockAnim(clockSec, targetSec, delay)
    // Quando scade il delay, arriva l'evento
    timer = setTimeout(() => {
      stopClockAnim()
      clockSec = targetSec
      // Se è un evento saliente, prima fase suspense
      const sKind = suspenseKindOf(ev)
      if (sKind) {
        suspense = sKind
        suspenseTimer = setTimeout(() => {
          suspense = null
          suspenseTimer = null
          if (playing && !finished) consumeEvent(ev)
        }, SUSPENSE_MS[sKind])
        return
      }
      consumeEvent(ev)
    }, delay)
  }

  function consumeEvent(ev: MatchEvent) {
    shown = [...shown, ev]
    currentIdx++
    clockSec = ev.minute * 60 + ev.second
    if (ev.kind === 'goal') {
      if (ev.side === 'home') homeScore++
      if (ev.side === 'away') awayScore++
      goalFlash = true
      setTimeout(() => goalFlash = false, 800)
    }
    autoscroll()
    if (maybeOpenOverlay(ev)) return
    // Subito al prossimo tick (sarà lui ad avviare il cronometro)
    tickReplay()
  }

  async function autoscroll() {
    await tick()
    if (streamEl) streamEl.scrollTop = streamEl.scrollHeight
    // Doppio frame per sicurezza: il primo applica il DOM, il secondo
    // garantisce che scroll-position sia aggiornata dopo layout.
    requestAnimationFrame(() => {
      if (streamEl) streamEl.scrollTop = streamEl.scrollHeight
    })
  }

  function togglePause() {
    if (finished) return
    playing = !playing
    if (playing) tickReplay()
    else {
      if (timer) { clearTimeout(timer); timer = null }
      stopClockAnim()
    }
  }

  function skipToEnd() {
    if (!result) return
    if (timer) { clearTimeout(timer); timer = null }
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null }
    if (suspenseTimer) { clearTimeout(suspenseTimer); suspenseTimer = null }
    stopClockAnim()
    overlay = null
    suspense = null
    // Applica tutti gli eventi rimanenti
    for (let i = currentIdx; i < result.events.length; i++) {
      const ev = result.events[i]
      if (ev.kind === 'goal') {
        if (ev.side === 'home') homeScore++
        if (ev.side === 'away') awayScore++
      }
    }
    shown = [...result.events]
    currentIdx = result.events.length
    const last = result.events[result.events.length - 1]
    clockSec = last ? last.minute * 60 + last.second : 90 * 60
    finished = true
    playing = false
    autoscroll()
    triggerMvpOverlay()
  }

  function setSpeed(s: number) {
    speed = s
    if (playing && !finished && !overlay && !suspense) {
      if (timer) { clearTimeout(timer); timer = null }
      stopClockAnim()
      tickReplay()
    }
  }

  function backToDashboard() {
    push('/dashboard')
  }

  function teamName(id: string): string { return career?.teams[id]?.name ?? '???' }
  function teamShort(id: string): string { return career?.teams[id]?.shortName ?? '???' }
  function colors(id: string) {
    const t = career?.teams[id]
    return { c1: t?.primaryColor ?? '#444', c2: t?.secondaryColor ?? '#888' }
  }

  /** Mappa il sotto-tipo di rigore mancato → PNG asset specifica.
   *  Roberto distingue "fuori sinistra" e "fuori destra" → 2 PNG separate. */
  function penaltyMissAsset(k: PenaltyMissKind): string {
    switch (k) {
      case 'high':       return '/assets/match/Rigore_sbagliato_alto.png'
      case 'wide_left':  return '/assets/match/Rigore_sbagliato_fuori.png'
      case 'wide_right': return '/assets/match/Rigore_sbagliato_fuori2.png'
      case 'post':       return '/assets/match/Rigore_sbagliato_palo.png'
      case 'crossbar':   return '/assets/match/Rigore_sbagliato_traversa.png'
    }
  }

  function eventClass(ev: MatchEvent): string {
    if (ev.kind === 'goal') return 'ev-goal'
    if (ev.kind === 'yellow_card') return 'ev-yellow'
    if (ev.kind === 'red_card') return 'ev-red'
    if (ev.kind === 'kickoff' || ev.kind === 'half_time' || ev.kind === 'full_time') return 'ev-break'
    if (ev.kind === 'shot_on_target' || ev.kind === 'shot' || ev.kind === 'save') return 'ev-action'
    if (ev.kind === 'substitution') return 'ev-sub'
    return ''
  }
</script>

<div class="page stadium-bg" class:flash={goalFlash}>
  {#if errorMsg}
    <div class="error">
      <p>{errorMsg}</p>
      <button class="btn-gold" onclick={backToDashboard}>Torna alla Dashboard</button>
    </div>
  {:else if !myFixture || !result}
    <div class="loading">
      <div class="spinner"></div>
      <p>Simulazione partite in corso…</p>
    </div>
  {:else}
    <header class="match-head">
      <div class="team-side home" style="--c1: {colors(myFixture.homeId).c1}; --c2: {colors(myFixture.homeId).c2};">
        <div class="crest-big">{teamShort(myFixture.homeId)}</div>
        <div class="team-name">{teamName(myFixture.homeId)}</div>
      </div>

      <div class="score-center">
        <div class="score-big">
          <span class="s-home">{homeScore}</span>
          <span class="dash">–</span>
          <span class="s-away">{awayScore}</span>
        </div>
        <div class="minute">
          <span class="min-num">{fmtClock(clockSec)}</span>
          {#if !finished}
            <span class="live-dot"></span>
            <span class="live-label">LIVE</span>
          {:else}
            <span class="ft-label">FT</span>
          {/if}
        </div>
      </div>

      <div class="team-side away" style="--c1: {colors(myFixture.awayId).c1}; --c2: {colors(myFixture.awayId).c2};">
        <div class="crest-big">{teamShort(myFixture.awayId)}</div>
        <div class="team-name">{teamName(myFixture.awayId)}</div>
      </div>
    </header>

    {#if suspense}
      <div class="suspense" class:s-red={suspense === 'red'} class:s-goal={suspense === 'goal'} class:s-pen={suspense === 'penalty'}>
        <div class="susp-pulse"></div>
        <div class="susp-text">
          {#if suspense === 'goal'}OCCASIONE…{/if}
          {#if suspense === 'yellow'}FALLO PERICOLOSO…{/if}
          {#if suspense === 'red'}INTERVENTO DURO…{/if}
          {#if suspense === 'penalty'}CONTATTO IN AREA…{/if}
        </div>
      </div>
    {/if}

    {#if overlay}
      <div
        class="overlay"
        class:o-goal={overlay.kind === 'goal'}
        class:o-card={overlay.kind === 'yellow' || overlay.kind === 'red'}
        class:o-red={overlay.kind === 'red'}
        class:o-pen={overlay.kind === 'penalty'}
        class:o-mvp={overlay.kind === 'mvp'}
        class:o-break={overlay.kind === 'half_time' || overlay.kind === 'full_time' || overlay.kind === 'kickoff' || overlay.kind === 'second_half' || overlay.kind === 'penalty_miss'}
      >
        {#if overlay.kind === 'goal'}
          <img class="ov-goal-img" src="/assets/match/Gol.png" alt="Gol" />
          <div class="ov-goal-text">GOOOOOL!</div>
          {#if overlay.playerName}
            <div class="ov-scorer">{overlay.playerName}</div>
          {/if}
          {#if overlay.teamName}
            <div class="ov-team">{overlay.teamName}</div>
          {/if}
          <div class="ov-score">{homeScore} – {awayScore}</div>
        {:else if overlay.kind === 'yellow'}
          <img class="ov-ref-img" src="/assets/match/Cartellino_giallo.png" alt="Cartellino giallo" />
          <div class="ov-card-text">AMMONIZIONE</div>
          {#if overlay.playerName}<div class="ov-player">{overlay.playerName}</div>{/if}
        {:else if overlay.kind === 'red'}
          <img class="ov-ref-img" src="/assets/match/Cartellino_rosso.png" alt="Cartellino rosso" />
          <div class="ov-card-text big">ESPULSIONE!</div>
          {#if overlay.playerName}<div class="ov-player">{overlay.playerName}</div>{/if}
        {:else if overlay.kind === 'kickoff'}
          <div class="ov-break-fallback">INIZIO PARTITA</div>
          <img class="ov-break-img" src="/assets/match/Inizio_partita.png" alt="Inizio partita" decoding="async" />
          <div class="ov-break-sub">{teamName(myFixture.homeId)} · {teamName(myFixture.awayId)}</div>
        {:else if overlay.kind === 'half_time'}
          <div class="ov-break-fallback">FINE PRIMO TEMPO</div>
          <img class="ov-break-img" src="/assets/match/Fine_primo_tempo.png" alt="Fine primo tempo" decoding="async" />
          <div class="ov-break-sub">Parziale: <strong>{homeScore} – {awayScore}</strong></div>
        {:else if overlay.kind === 'second_half'}
          <div class="ov-break-fallback">INIZIO SECONDO TEMPO</div>
          <img class="ov-break-img" src="/assets/match/Inizio_secondo_tempo.png" alt="Inizio secondo tempo" decoding="async" />
          <div class="ov-break-sub">{homeScore} – {awayScore}</div>
        {:else if overlay.kind === 'full_time'}
          <div class="ov-break-fallback">FINE PARTITA</div>
          <img class="ov-break-img" src="/assets/match/Fine_partita.png" alt="Fine partita" decoding="async" />
          <div class="ov-break-sub">Risultato finale: <strong>{homeScore} – {awayScore}</strong></div>
        {:else if overlay.kind === 'penalty'}
          <div class="ov-pen-badge">⚖️</div>
          <div class="ov-pen-text">RIGORE!</div>
          {#if overlay.teamName}
            <div class="ov-pen-sub">per il <strong>{overlay.teamName}</strong></div>
          {/if}
        {:else if overlay.kind === 'penalty_miss' && overlay.missKind}
          <div class="ov-break-fallback">RIGORE SBAGLIATO</div>
          <img class="ov-break-img" src={penaltyMissAsset(overlay.missKind)} alt="Rigore sbagliato" decoding="async" />
          {#if overlay.playerName}
            <div class="ov-break-sub"><strong>{overlay.playerName}</strong></div>
          {/if}
        {:else if overlay.kind === 'mvp'}
          <img class="ov-break-img" src="/assets/match/MVP.png" alt="MVP" />
          {#if overlay.mvpId}
            <div class="ov-mvp-info">
              <div class="ov-mvp-name">{lastNameOf(overlay.mvpId)}</div>
              <div class="ov-mvp-team">{teamName(overlay.side === 'home' ? myFixture.homeId : myFixture.awayId)}</div>
              <div class="ov-mvp-stats">
                <div class="mv-cell">
                  <span class="mv-l">Voto</span>
                  <span class="mv-v">{(overlay.mvpRating ?? 6).toFixed(1)}</span>
                </div>
                <div class="mv-cell">
                  <span class="mv-l">Bonus</span>
                  <span class="mv-v" class:plus={(overlay.mvpBonus ?? 0) > 0} class:minus={(overlay.mvpBonus ?? 0) < 0}>{fmtBonus(overlay.mvpBonus ?? 0) || '—'}</span>
                </div>
                <div class="mv-cell mv-total">
                  <span class="mv-l">Fanta-pt</span>
                  <span class="mv-v">{(overlay.mvpTotal ?? 6).toFixed(1)}</span>
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <main class="match-body">
      {#if homeLineup && awayLineup}
        <section class="formations-pane card-gold">
          <div class="lineups-head">
            <h3 class="lp-title">Formazioni</h3>
          </div>
          <div class="lineups-grid">
            <!-- HOME -->
            <div class="team-col">
              <div class="team-head" style="--c1: {colors(myFixture.homeId).c1}; --c2: {colors(myFixture.homeId).c2};">
                <span class="crest-sm">{teamShort(myFixture.homeId)}</span>
                <span class="th-name">{teamName(myFixture.homeId)}</span>
                <span class="th-form">{homeLineup.formation}</span>
              </div>
              <ul class="lp-list">
                {#each homeLineup.starters as pid (pid)}
                  <li class="lp-row">
                    <span class="shirt">{shirtOf(pid)}</span>
                    <span class="pname">
                      {lastNameOf(pid)}
                      {#each Array(badgeOf(pid).goals) as _, gi (gi)}<span class="badge-ball" title="Gol">⚽</span>{/each}
                      {#if badgeOf(pid).yellow}<span class="badge-yellow" title="Ammonito">🟨</span>{/if}
                      {#if badgeOf(pid).red}<span class="badge-red" title="Espulso">🟥</span>{/if}
                      {#if badgeOf(pid).subOut}<span class="sub-arrow sub-out" title="Sostituito">▼</span>{/if}
                      {#if badgeOf(pid).subIn}<span class="sub-arrow sub-in" title="Entrato in campo">▲</span>{/if}
                      {#if bonusOf(pid) !== 0}<span class="bonus-chip" class:b-plus={bonusOf(pid) > 0}>{fmtBonus(bonusOf(pid))}</span>{/if}
                    </span>
                    <span class="rate {ratingClass(totalOf(pid))}">{fmtRating(totalOf(pid))}</span>
                  </li>
                {/each}
                {#if homeLineup.bench.length}
                  <li class="lp-sep">A disposizione</li>
                  {#each homeLineup.bench as pid (pid)}
                    <li class="lp-row sub">
                      <span class="shirt">{shirtOf(pid)}</span>
                      <span class="pname">
                        {lastNameOf(pid)}
                        {#if badgeOf(pid).subIn}<span class="sub-arrow sub-in" title="Entrato in campo">▲</span>{/if}
                        {#each Array(badgeOf(pid).goals) as _, gi (gi)}<span class="badge-ball" title="Gol">⚽</span>{/each}
                        {#if badgeOf(pid).yellow}<span class="badge-yellow" title="Ammonito">🟨</span>{/if}
                        {#if badgeOf(pid).red}<span class="badge-red" title="Espulso">🟥</span>{/if}
                        {#if bonusOf(pid) !== 0}<span class="bonus-chip" class:b-plus={bonusOf(pid) > 0}>{fmtBonus(bonusOf(pid))}</span>{/if}
                      </span>
                      <span class="rate {ratingClass(totalOf(pid))}">{fmtRating(totalOf(pid))}</span>
                    </li>
                  {/each}
                {/if}
              </ul>
            </div>
            <!-- AWAY -->
            <div class="team-col away">
              <div class="team-head" style="--c1: {colors(myFixture.awayId).c1}; --c2: {colors(myFixture.awayId).c2};">
                <span class="crest-sm">{teamShort(myFixture.awayId)}</span>
                <span class="th-name">{teamName(myFixture.awayId)}</span>
                <span class="th-form">{awayLineup.formation}</span>
              </div>
              <ul class="lp-list">
                {#each awayLineup.starters as pid (pid)}
                  <li class="lp-row">
                    <span class="rate {ratingClass(totalOf(pid))}">{fmtRating(totalOf(pid))}</span>
                    <span class="pname">
                      {lastNameOf(pid)}
                      {#each Array(badgeOf(pid).goals) as _, gi (gi)}<span class="badge-ball" title="Gol">⚽</span>{/each}
                      {#if badgeOf(pid).yellow}<span class="badge-yellow" title="Ammonito">🟨</span>{/if}
                      {#if badgeOf(pid).red}<span class="badge-red" title="Espulso">🟥</span>{/if}
                      {#if badgeOf(pid).subOut}<span class="sub-arrow sub-out" title="Sostituito">▼</span>{/if}
                      {#if badgeOf(pid).subIn}<span class="sub-arrow sub-in" title="Entrato in campo">▲</span>{/if}
                      {#if bonusOf(pid) !== 0}<span class="bonus-chip" class:b-plus={bonusOf(pid) > 0}>{fmtBonus(bonusOf(pid))}</span>{/if}
                    </span>
                    <span class="shirt">{shirtOf(pid)}</span>
                  </li>
                {/each}
                {#if awayLineup.bench.length}
                  <li class="lp-sep">A disposizione</li>
                  {#each awayLineup.bench as pid (pid)}
                    <li class="lp-row sub">
                      <span class="rate {ratingClass(totalOf(pid))}">{fmtRating(totalOf(pid))}</span>
                      <span class="pname">
                        {lastNameOf(pid)}
                        {#if badgeOf(pid).subIn}<span class="sub-arrow sub-in" title="Entrato in campo">▲</span>{/if}
                        {#each Array(badgeOf(pid).goals) as _, gi (gi)}<span class="badge-ball" title="Gol">⚽</span>{/each}
                        {#if badgeOf(pid).yellow}<span class="badge-yellow" title="Ammonito">🟨</span>{/if}
                        {#if badgeOf(pid).red}<span class="badge-red" title="Espulso">🟥</span>{/if}
                        {#if bonusOf(pid) !== 0}<span class="bonus-chip" class:b-plus={bonusOf(pid) > 0}>{fmtBonus(bonusOf(pid))}</span>{/if}
                      </span>
                      <span class="shirt">{shirtOf(pid)}</span>
                    </li>
                  {/each}
                {/if}
              </ul>
            </div>
          </div>
        </section>
      {/if}

      <section class="right-pane">
        <div class="card-gold stream-card">
          <h3 class="side-h">Cronaca</h3>
          <div class="stream" bind:this={streamEl}>
            {#each shown as ev, i (i)}
              <div class="ev {eventClass(ev)}" class:home={ev.side === 'home'} class:away={ev.side === 'away'}>
                <span class="ev-min">{ev.minute}'</span>
                <span class="ev-text">{ev.commentary ?? ''}</span>
              </div>
            {/each}
          </div>
        </div>

        <aside class="card-gold side-stats">
          <h3 class="side-h">Statistiche</h3>
          <div class="stat-row">
            <span class="sv">{liveStats.home.possession}%</span>
            <span class="sl">Possesso</span>
            <span class="sv">{liveStats.away.possession}%</span>
          </div>
          <div class="stat-row">
            <span class="sv">{liveStats.home.shots}</span>
            <span class="sl">Tiri</span>
            <span class="sv">{liveStats.away.shots}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{liveStats.home.shotsOnTarget}</span>
            <span class="sl">in porta</span>
            <span class="sv">{liveStats.away.shotsOnTarget}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{liveStats.home.corners}</span>
            <span class="sl">Corner</span>
            <span class="sv">{liveStats.away.corners}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{liveStats.home.fouls}</span>
            <span class="sl">Falli</span>
            <span class="sv">{liveStats.away.fouls}</span>
          </div>
          <div class="stat-row">
            <span class="sv">{liveStats.home.yellowCards}</span>
            <span class="sl">Gialli</span>
            <span class="sv">{liveStats.away.yellowCards}</span>
          </div>
          {#if liveStats.home.redCards > 0 || liveStats.away.redCards > 0}
            <div class="stat-row">
              <span class="sv">{liveStats.home.redCards}</span>
              <span class="sl">Rossi</span>
              <span class="sv">{liveStats.away.redCards}</span>
            </div>
          {/if}
        </aside>
      </section>
    </main>

    <footer class="controls">
      {#if !finished}
        <button class="ctrl" onclick={togglePause}>{playing ? '⏸ Pausa' : '▶ Riprendi'}</button>
        <div class="speed">
          <span class="speed-l">Velocità</span>
          {#each [0.5, 1, 2, 4, 8] as s}
            <button class="speed-btn" class:active={speed === s} onclick={() => setSpeed(s)}>{s}x</button>
          {/each}
        </div>
        <button class="ctrl skip" onclick={skipToEnd}>⏭ Salta al risultato</button>
      {:else}
        <button class="btn-gold" onclick={backToDashboard}>✓ Torna alla Dashboard</button>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .page {
    height: 100vh;
    max-height: 100vh;
    width: 100vw;
    color: #fef3c7;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    isolation: isolate;
    transition: background 0.3s;
  }
  .page.flash::after {
    content: '';
    position: fixed; inset: 0;
    background: radial-gradient(circle at center, rgba(252, 211, 77, 0.25), transparent 70%);
    pointer-events: none;
    animation: goalflash 0.8s ease-out;
  }
  @keyframes goalflash {
    0% { opacity: 0; }
    20% { opacity: 1; }
    100% { opacity: 0; }
  }

  .match-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 20px;
    align-items: center;
    padding: 14px clamp(16px, 4vw, 56px);
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
    flex-shrink: 0;
  }
  .team-side {
    display: flex; align-items: center; gap: 14px;
  }
  .team-side.away { flex-direction: row-reverse; }
  .crest-big {
    width: 52px; height: 52px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff; font-weight: 800; font-size: 14px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }
  .team-name {
    font-weight: 800; font-size: 16px;
    max-width: 220px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .score-center {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    min-width: 160px;
  }
  .score-big {
    display: flex; align-items: center; gap: 14px;
    font-size: 44px;
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .s-home, .s-away {
    background: linear-gradient(180deg, #fef3c7 0%, #fcd34d 50%, #b45309 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    filter: drop-shadow(0 4px 16px rgba(245, 158, 11, 0.5));
  }
  .dash { color: rgba(252, 211, 77, 0.5); font-weight: 400; }
  .minute {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px;
    letter-spacing: 0.15em;
    color: #fcd34d;
    font-weight: 700;
  }
  .min-num { font-size: 16px; font-family: var(--font-mono, monospace); }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #dc2626;
    box-shadow: 0 0 12px #dc2626;
    animation: livepulse 1.2s ease-in-out infinite;
  }
  @keyframes livepulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .live-label { color: #fca5a5; }
  .ft-label {
    color: #1a1410;
    background: linear-gradient(180deg, #fde68a, #fbbf24, #d97706);
    padding: 3px 10px;
    border-radius: 4px;
  }

  /* ========== MATCH BODY: formazioni SX | cronaca+stats DX ========== */
  .match-body {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(420px, 0.95fr) minmax(0, 1.05fr);
    gap: 14px;
    padding: 14px clamp(16px, 4vw, 56px);
    overflow: hidden;
    min-height: 0;
  }
  .formations-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px;
  }
  .right-pane {
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 14px;
    min-height: 0;
  }
  .stream-card {
    display: flex;
    flex-direction: column;
    padding: 14px 18px 6px;
    min-height: 0;
    overflow: hidden;
  }
  .stream-card .side-h { margin-bottom: 10px; }
  .stream {
    overflow-y: auto;
    padding: 0 4px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    flex: 1;
  }
  .ev {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.4;
    border-left: 3px solid transparent;
    animation: slideIn 0.25s ease;
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ev-min {
    color: #fcd34d;
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    min-width: 36px;
    font-size: 12px;
  }
  .ev-text { color: #d4cfc1; flex: 1; }
  .ev.ev-goal {
    background: rgba(252, 211, 77, 0.15);
    border-left-color: #fcd34d;
  }
  .ev.ev-goal .ev-text {
    color: #fef3c7;
    font-weight: 700;
  }
  .ev.ev-yellow { border-left-color: #fbbf24; }
  .ev.ev-red    { border-left-color: #dc2626; background: rgba(220, 38, 38, 0.08); }
  .ev.ev-break {
    background: rgba(0, 0, 0, 0.4);
    border-left-color: #918778;
    color: #fcd34d;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 12px;
  }
  .ev.ev-break .ev-text { color: #fcd34d; }
  .ev.ev-action { border-left-color: rgba(252, 211, 77, 0.3); }
  .ev.ev-sub { border-left-color: rgba(6, 182, 212, 0.5); }

  .side-stats {
    padding: 12px 16px 14px;
    flex-shrink: 0;
  }
  .side-h {
    margin: 0 0 10px;
    color: #fcd34d;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-weight: 700;
  }
  .stat-row {
    display: grid;
    grid-template-columns: 50px 1fr 50px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 13px;
  }
  .stat-row:last-child { border-bottom: 0; }
  .sv {
    text-align: center;
    font-weight: 700;
    color: #fef3c7;
    font-variant-numeric: tabular-nums;
  }
  .sl {
    text-align: center;
    color: #918778;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px clamp(16px, 4vw, 56px);
    background: rgba(0, 0, 0, 0.6);
    border-top: 1px solid rgba(252, 211, 77, 0.15);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .ctrl {
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(252, 211, 77, 0.3);
    color: #fef3c7;
    padding: 10px 18px;
    font: 600 13px/1 inherit;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .ctrl:hover { border-color: #fcd34d; background: rgba(252, 211, 77, 0.1); }
  .ctrl.skip { margin-left: auto; }

  .speed {
    display: flex; align-items: center; gap: 6px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(252, 211, 77, 0.2);
    padding: 6px 10px;
    border-radius: 8px;
  }
  .speed-l {
    font-size: 10px;
    color: #fcd34d;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 700;
    margin-right: 4px;
  }
  .speed-btn {
    background: none;
    border: 1px solid transparent;
    color: #c8bfa8;
    padding: 4px 10px;
    font: 600 12px/1 inherit;
    border-radius: 5px;
    cursor: pointer;
  }
  .speed-btn:hover { color: #fef3c7; }
  .speed-btn.active {
    background: linear-gradient(180deg, #fde68a, #fbbf24);
    color: #1a1410;
    border-color: #fcd34d;
  }

  .loading {
    flex: 1;
    display: grid; place-items: center;
    gap: 16px;
    color: #d4cfc1;
    text-align: center;
  }
  .spinner {
    width: 48px; height: 48px;
    border: 3px solid rgba(252, 211, 77, 0.2);
    border-top-color: #fcd34d;
    border-radius: 50%;
    margin: 0 auto;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error {
    flex: 1;
    display: grid; place-items: center;
    gap: 18px;
    padding: 40px;
  }
  .error p {
    background: rgba(220, 38, 38, 0.15);
    border: 1px solid rgba(220, 38, 38, 0.5);
    color: #fecaca;
    padding: 12px 20px;
    border-radius: 8px;
  }

  /* ========== SUSPENSE PRE-EVENTO ========== */
  .suspense {
    position: fixed;
    bottom: 110px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid rgba(252, 211, 77, 0.55);
    color: #fef3c7;
    padding: 12px 22px;
    border-radius: 999px;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 30px rgba(252, 211, 77, 0.18);
    animation: suspenseIn 0.3s ease-out;
  }
  .suspense.s-red {
    border-color: rgba(220, 38, 38, 0.7);
    color: #fecaca;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 30px rgba(220, 38, 38, 0.35);
  }
  .suspense.s-goal {
    border-color: rgba(252, 211, 77, 0.85);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 40px rgba(245, 158, 11, 0.45);
  }
  .suspense.s-pen {
    border-color: rgba(220, 38, 38, 0.9);
    color: #fecaca;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7), 0 0 35px rgba(220, 38, 38, 0.5);
  }
  .suspense.s-pen .susp-pulse {
    background: #ef4444;
    box-shadow: 0 0 12px #ef4444;
  }
  @keyframes suspenseIn {
    from { opacity: 0; transform: translate(-50%, 14px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  .susp-pulse {
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #fcd34d;
    box-shadow: 0 0 12px #fcd34d;
    animation: suspPulse 0.7s ease-in-out infinite;
  }
  .suspense.s-red .susp-pulse {
    background: #ef4444;
    box-shadow: 0 0 12px #ef4444;
  }
  @keyframes suspPulse {
    0%, 100% { transform: scale(1); opacity: 0.7; }
    50%      { transform: scale(1.5); opacity: 1; }
  }
  .susp-text { font-family: var(--font-mono, monospace); }

  /* ========== OVERLAY DRAMMATICI ========== */
  .overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    inset: 0;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.88) 30%, rgba(0, 0, 0, 0.98) 100%);
    backdrop-filter: blur(8px);
    color: #fef3c7;
    animation: overlayFadeIn 0.25s ease-out;
  }
  @keyframes overlayFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* --- GOAL --- */
  .overlay.o-goal {
    background:
      radial-gradient(ellipse 80% 60% at 50% 50%, rgba(245, 158, 11, 0.35), transparent 60%),
      radial-gradient(ellipse at center, rgba(0, 0, 0, 0.92) 40%, rgba(0, 0, 0, 0.98) 100%);
  }
  .ov-goal-img {
    width: clamp(240px, 36vw, 420px);
    height: auto;
    filter: drop-shadow(0 20px 60px rgba(245, 158, 11, 0.55));
    animation: goalImg 1.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes goalImg {
    0%   { transform: scale(0.4) translateY(-30px); opacity: 0; }
    50%  { transform: scale(1.12) translateY(0); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }
  .ov-goal-text {
    font-size: clamp(64px, 12vw, 140px);
    font-weight: 900;
    letter-spacing: 0.02em;
    background: linear-gradient(180deg, #fef3c7 0%, #fcd34d 30%, #f59e0b 60%, #b45309 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    filter: drop-shadow(0 8px 50px rgba(245, 158, 11, 0.65));
    animation: bigZoom 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    text-align: center;
    line-height: 1;
  }
  @keyframes bigZoom {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  .ov-scorer {
    font-size: 28px;
    font-weight: 800;
    color: #fef3c7;
    margin-top: 6px;
    animation: fadeUp 0.5s 0.4s both;
  }
  .ov-team {
    font-size: 14px;
    color: #fcd34d;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    animation: fadeUp 0.5s 0.55s both;
  }
  .ov-score {
    margin-top: 18px;
    font-size: 40px;
    font-weight: 900;
    color: #fde68a;
    padding: 8px 28px;
    border: 1px solid rgba(252, 211, 77, 0.4);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.5);
    font-variant-numeric: tabular-nums;
    animation: fadeUp 0.5s 0.7s both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* --- CARTELLINI (arbitro PNG) --- */
  .overlay.o-card { gap: 18px; }
  .overlay.o-red {
    background:
      radial-gradient(ellipse 60% 60% at 50% 50%, rgba(220, 38, 38, 0.20), transparent 70%),
      radial-gradient(ellipse at center, rgba(0, 0, 0, 0.92) 30%, rgba(0, 0, 0, 0.99) 100%);
    animation: overlayFadeIn 0.25s ease-out, shakeIt 0.5s 0.45s ease-in-out 2;
  }
  @keyframes shakeIt {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-10px); }
    50%      { transform: translateX(10px); }
    75%      { transform: translateX(-6px); }
  }
  .ov-ref-img {
    width: clamp(220px, 30vw, 340px);
    height: auto;
    filter: drop-shadow(0 20px 50px rgba(0, 0, 0, 0.8));
    animation: refRise 1.0s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .overlay.o-red .ov-ref-img {
    filter: drop-shadow(0 20px 60px rgba(220, 38, 38, 0.55));
  }
  @keyframes refRise {
    0%   { transform: scale(0.6) translateY(40px); opacity: 0; }
    60%  { transform: scale(1.05) translateY(0); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }
  .ov-card-text {
    font-size: 48px;
    font-weight: 900;
    letter-spacing: 0.1em;
    color: #fcd34d;
    animation: fadeUp 0.5s 0.3s both;
  }
  .ov-card-text.big {
    font-size: 60px;
    color: #fca5a5;
    text-shadow: 0 4px 24px rgba(220, 38, 38, 0.6);
  }
  .ov-player {
    font-size: 22px;
    font-weight: 700;
    color: #fef3c7;
    animation: fadeUp 0.5s 0.5s both;
  }

  /* --- BREAK (kickoff / half_time / second_half / full_time) ---
     L'immagine PNG occupa lo schermo come backdrop (object-fit cover),
     il sottotitolo dinamico (score) si posiziona in basso. */
  .overlay.o-break {
    padding: 0;
    background: #000;
    gap: 0;
  }
  .ov-break-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: breakImgIn 0.7s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 2;
  }
  /* Fallback testuale dietro l'img (z-index 1 vs img 2): se la PNG
     non carica, vedi comunque un titolo gigante centrato in oro su
     fondo nero solido (l'overlay copre tutta la viewport). */
  .ov-break-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8vw;
    text-align: center;
    font-size: clamp(56px, 10vw, 140px);
    font-weight: 900;
    letter-spacing: 0.03em;
    line-height: 1.05;
    background:
      radial-gradient(ellipse 80% 60% at 50% 50%, rgba(245, 158, 11, 0.18), transparent 60%),
      radial-gradient(ellipse at center, rgba(0, 0, 0, 0.96), rgba(0, 0, 0, 0.99));
    color: #fcd34d;
    text-shadow: 0 6px 30px rgba(245, 158, 11, 0.5);
    z-index: 1;
  }
  @keyframes breakImgIn {
    0%   { transform: scale(1.08); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  .overlay.o-break .ov-break-sub {
    position: absolute;
    bottom: 8%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(252, 211, 77, 0.45);
    padding: 10px 24px;
    border-radius: 12px;
    font-size: clamp(16px, 2vw, 22px);
    color: #fef3c7;
    font-weight: 700;
    letter-spacing: 0.05em;
    animation: fadeUp 0.5s 0.5s both;
    z-index: 2;
  }
  .overlay.o-break .ov-break-sub strong {
    color: #fcd34d;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }

  /* --- PENALTY (assegnazione rigore) --- */
  .overlay.o-pen {
    background:
      radial-gradient(ellipse 60% 60% at 50% 50%, rgba(220, 38, 38, 0.25), transparent 70%),
      radial-gradient(ellipse at center, rgba(0, 0, 0, 0.92) 30%, rgba(0, 0, 0, 0.99) 100%);
    gap: 10px;
  }
  .ov-pen-badge {
    font-size: clamp(80px, 14vw, 160px);
    filter: drop-shadow(0 12px 40px rgba(220, 38, 38, 0.55));
    animation: penBadge 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes penBadge {
    0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
    60%  { transform: scale(1.15) rotate(2deg); opacity: 1; }
    100% { transform: scale(1) rotate(0); opacity: 1; }
  }
  .ov-pen-text {
    font-size: clamp(56px, 10vw, 120px);
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #fca5a5;
    text-shadow: 0 6px 24px rgba(220, 38, 38, 0.55);
    animation: bigZoom 0.5s 0.1s both;
    line-height: 1;
  }
  .ov-pen-sub {
    font-size: 20px;
    color: #fef3c7;
    animation: fadeUp 0.5s 0.35s both;
  }
  .ov-pen-sub strong { color: #fcd34d; }

  /* --- MVP ---
     La PNG è in formato VERTICALE (portrait): la mostro con object-fit
     contain così si vede per intero senza tagli, centrata nello schermo,
     con padding nero ai lati orizzontali. Info card SOTTO la PNG (flex). */
  .overlay.o-mvp {
    padding: 24px 0;
    background:
      radial-gradient(ellipse 70% 50% at 50% 40%, rgba(245, 158, 11, 0.12), transparent 70%),
      radial-gradient(ellipse at center, #050505, #000);
    gap: 18px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .overlay.o-mvp .ov-break-img {
    position: static;
    width: auto;
    height: auto;
    max-height: 68vh;
    max-width: 92vw;
    object-fit: contain;
    border-radius: 8px;
    filter: drop-shadow(0 16px 50px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 30px rgba(245, 158, 11, 0.18));
    animation: breakImgIn 0.7s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .ov-mvp-info {
    position: static;
    width: min(640px, 92vw);
    background: rgba(0, 0, 0, 0.82);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(252, 211, 77, 0.55);
    border-radius: 14px;
    padding: 14px 22px;
    text-align: center;
    z-index: 2;
    animation: fadeUp 0.5s 0.5s both;
    box-shadow: 0 14px 50px rgba(0, 0, 0, 0.7), 0 0 35px rgba(245, 158, 11, 0.25);
  }
  .ov-mvp-name {
    font-size: clamp(28px, 4vw, 42px);
    font-weight: 900;
    letter-spacing: 0.02em;
    background: linear-gradient(180deg, #fef3c7 0%, #fcd34d 40%, #f59e0b 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    line-height: 1;
  }
  .ov-mvp-team {
    margin-top: 4px;
    font-size: 12px;
    color: #fcd34d;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-weight: 700;
  }
  .ov-mvp-stats {
    margin-top: 14px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
  }
  .mv-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 4px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 8px;
    border: 1px solid rgba(252, 211, 77, 0.15);
  }
  .mv-cell.mv-total {
    background: linear-gradient(180deg, rgba(252, 211, 77, 0.25), rgba(245, 158, 11, 0.1));
    border-color: rgba(252, 211, 77, 0.55);
  }
  .mv-l {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #918778;
    font-weight: 700;
  }
  .mv-v {
    font-size: 22px;
    font-weight: 900;
    color: #fef3c7;
    font-variant-numeric: tabular-nums;
  }
  .mv-v.plus { color: #6ee7b7; }
  .mv-v.minus { color: #fca5a5; }
  .mv-cell.mv-total .mv-v {
    background: linear-gradient(180deg, #fef3c7, #fcd34d);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
  }

  /* Bonus chip inline accanto al nome nel pannello formazioni */
  .bonus-chip {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    background: rgba(220, 38, 38, 0.22);
    color: #fca5a5;
    border: 1px solid rgba(220, 38, 38, 0.4);
    vertical-align: middle;
  }
  .bonus-chip.b-plus {
    background: rgba(34, 197, 94, 0.22);
    color: #86efac;
    border-color: rgba(34, 197, 94, 0.45);
  }
  .badge-ball, .badge-yellow, .badge-red {
    display: inline-block;
    margin-left: 4px;
    font-size: 12px;
    vertical-align: middle;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .badge-ball + .badge-ball { margin-left: 1px; }

  /* Frecce sostituzione: verde ▲ per chi entra, rossa ▼ per chi esce.
     L'uscito resta nella sezione titolari (con freccia rossa), l'entrato
     resta nella sezione panchina (con freccia verde) — niente swap. */
  .sub-arrow {
    display: inline-block;
    margin-left: 4px;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    vertical-align: middle;
    padding: 1px 3px;
    border-radius: 3px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .sub-arrow.sub-in {
    color: #4ade80;
    background: rgba(34, 197, 94, 0.18);
    border: 1px solid rgba(34, 197, 94, 0.5);
  }
  .sub-arrow.sub-out {
    color: #f87171;
    background: rgba(220, 38, 38, 0.18);
    border: 1px solid rgba(220, 38, 38, 0.5);
  }

  /* ========== PANNELLO FORMAZIONI + VOTI LIVE ========== */
  .lineups-head {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .lp-title {
    margin: 0;
    color: #fcd34d;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-weight: 800;
  }
  .lineups-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .team-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .team-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0.6), rgba(252, 211, 77, 0.06));
    border: 1px solid rgba(252, 211, 77, 0.18);
    border-radius: 8px;
  }
  .team-col.away .team-head {
    flex-direction: row-reverse;
    background: linear-gradient(270deg, rgba(0, 0, 0, 0.6), rgba(252, 211, 77, 0.06));
  }
  .crest-sm {
    width: 32px; height: 32px;
    border-radius: 6px;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    color: #fff;
    font-weight: 800;
    font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    flex: 0 0 auto;
  }
  .th-name {
    flex: 1;
    color: #fef3c7;
    font-weight: 700;
    font-size: 14px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .th-form {
    color: #fcd34d;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    background: rgba(0, 0, 0, 0.5);
    padding: 2px 8px;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
  }
  .lp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .lp-row {
    display: grid;
    grid-template-columns: 28px 1fr 40px;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: 5px;
    font-size: 12px;
    transition: background 0.15s;
  }
  .team-col.away .lp-row {
    grid-template-columns: 40px 1fr 28px;
  }
  .lp-row:hover { background: rgba(252, 211, 77, 0.06); }
  .lp-row.sub {
    opacity: 0.7;
    font-size: 11px;
  }
  .lp-row .shirt {
    text-align: center;
    color: #1a1410;
    background: linear-gradient(180deg, #fde68a, #fbbf24);
    border-radius: 4px;
    font-weight: 800;
    padding: 2px 0;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .lp-row.sub .shirt {
    background: linear-gradient(180deg, #d4cfc1, #918778);
    color: #1a1410;
  }
  .lp-row .pname {
    color: #d4cfc1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-weight: 600;
  }
  .team-col.away .lp-row .pname { text-align: right; }
  .lp-row .rate {
    text-align: center;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 13px;
    border: 1px solid transparent;
  }
  .rate.r-top {
    background: linear-gradient(180deg, #fde68a, #fbbf24);
    color: #1a1410;
    border-color: #fcd34d;
    box-shadow: 0 0 8px rgba(252, 211, 77, 0.35);
  }
  .rate.r-ok {
    background: rgba(252, 211, 77, 0.18);
    color: #fef3c7;
    border-color: rgba(252, 211, 77, 0.4);
  }
  .rate.r-mid {
    background: rgba(255, 255, 255, 0.06);
    color: #d4cfc1;
  }
  .rate.r-low {
    background: rgba(220, 38, 38, 0.18);
    color: #fca5a5;
    border-color: rgba(220, 38, 38, 0.4);
  }
  .lp-sep {
    margin-top: 8px;
    padding: 4px 8px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #918778;
    font-weight: 800;
    border-top: 1px dashed rgba(252, 211, 77, 0.18);
    padding-top: 8px;
  }
  .team-col.away .lp-sep { text-align: right; }

  @media (max-width: 900px) {
    .match-body {
      grid-template-columns: 1fr;
      padding: 10px 12px;
      gap: 10px;
      overflow-y: auto;
    }
    .formations-pane { max-height: 50vh; }
    .right-pane { grid-template-rows: minmax(220px, 1fr) auto; }
    .team-name { display: none; }
    .score-big { font-size: 36px; }
    .controls { gap: 8px; }
    .ctrl.skip { margin-left: 0; }
    .ov-card-text { font-size: 36px; }
    .lineups-grid { grid-template-columns: 1fr; gap: 12px; }
  }
</style>
