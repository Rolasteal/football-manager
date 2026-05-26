<script lang="ts">
  /**
   * Pannello demo interattivo del modulo betting.
   * Accedi via /#/betting-demo nell'app (npm run dev).
   *
   * Genera un mondo finto isolato (4 partite, 8 squadre), non tocca i savegame reali.
   * Per provare: clicca su una quota → si aggiunge alla schedina → piazza → simula la partita → vedi settlement.
   */

  import { onMount } from 'svelte'
  import type { Career, Manager, ClubState, NewsItem } from '$engine/career/types'
  import type { Team, Player, Stadium, League, Position } from '$engine/types'
  import type { Fixture, MatchResult } from '$engine/competition/types'
  import type { Tactics, Lineup, FormationName } from '$engine/tactics/types'
  import type { BetSelection, BetSlipMode, MatchOddsBoard, Market, Selection } from '$engine/betting'
  import {
    ensureBettingData,
    isOwnTeamFixture,
    generateOddsForMatchday,
    placeBet,
    settleMatch,
    executeCashOut,
    onMatchdayAdvance,
    refreshPromotions,
    validateSlip,
    priceSlip,
    computeCashOut,
    resolveLeagueConfig,
    refreshCapsFromTeam,
    type LineupResolver,
    type FormResolver,
  } from '$engine/betting'
  import { initBettingCareerData } from '$engine/betting/init'

  // ============================================================
  // 1. MONDO DEMO
  // ============================================================

  function mkAttr(overall: number) {
    const base = Math.max(1, Math.min(20, overall / 5))
    const j = () => Math.max(1, Math.min(20, base + (Math.random() - 0.5) * 1.5))
    return {
      passing: j(), shooting: j(), dribbling: j(), finishing: j(),
      crossing: j(), tackling: j(), heading: j(),
      pace: j(), stamina: j(), strength: j(),
      vision: j(), composure: j(), workRate: j(),
      reflexes: j(), handling: j(),
    }
  }

  function mkPlayer(opts: { position: Position; overall: number; teamId: string; lastName: string; shirt: number }): Player {
    return {
      id: `p_${opts.teamId}_${opts.shirt}`,
      firstName: 'D',
      lastName: opts.lastName,
      nationality: 'IT',
      birthDate: '1998-01-01',
      position: opts.position,
      secondaryPositions: [],
      foot: 'right',
      attributes: mkAttr(opts.overall),
      marketValue: opts.overall * 500_000,
      morale: 70 + Math.floor(Math.random() * 20),
      fitness: 80 + Math.floor(Math.random() * 15),
      teamId: opts.teamId,
      shirtNumber: opts.shirt,
    }
  }

  function mkTeam(id: string, name: string, rep: number, balance: number, color: string): Team {
    return {
      id, name, shortName: name.slice(0, 3).toUpperCase(),
      city: name, country: 'IT',
      founded: 1900, primaryColor: color, secondaryColor: '#000000',
      stadiumId: `s_${id}`, reputation: rep, balance,
    }
  }

  function mkStartingXI(teamId: string, namePrefix: string, avgOverall: number): Player[] {
    const slots: { pos: Position; off: number; shirt: number; name: string }[] = [
      { pos: 'GK',  off:  0, shirt:  1, name: 'Bianchi' },
      { pos: 'RB',  off: -2, shirt:  2, name: 'Verdi' },
      { pos: 'CB',  off: -1, shirt:  4, name: 'Rossi' },
      { pos: 'CB',  off: -1, shirt:  5, name: 'Neri' },
      { pos: 'LB',  off: -2, shirt:  3, name: 'Gialli' },
      { pos: 'DM',  off:  0, shirt:  6, name: 'Blu' },
      { pos: 'CM',  off:  1, shirt:  8, name: 'Viola' },
      { pos: 'CM',  off:  0, shirt: 10, name: 'Marrone' },
      { pos: 'RW',  off:  2, shirt:  7, name: 'Oro' },
      { pos: 'ST',  off:  3, shirt:  9, name: 'Argento' },
      { pos: 'LW',  off:  2, shirt: 11, name: 'Smeraldo' },
    ]
    return slots.map(s => mkPlayer({
      position: s.pos,
      overall: avgOverall + s.off,
      teamId,
      lastName: `${s.name} ${namePrefix}`,
      shirt: s.shirt,
    }))
  }

  function buildDemoCareer(): Career {
    // 8 squadre: 4 grandi + 4 medie/piccole
    const teams: Record<string, Team> = {}
    const players: Record<string, Player> = {}
    const stadiums: Record<string, Stadium> = {}

    const setup: { id: string; name: string; rep: number; balance: number; avgOvr: number; color: string }[] = [
      { id: 't_inter',     name: 'Inter Demo',     rep: 88, balance: 200_000_000, avgOvr: 82, color: '#0066cc' },
      { id: 't_juve',      name: 'Juve Demo',      rep: 86, balance: 180_000_000, avgOvr: 81, color: '#000000' },
      { id: 't_milan',     name: 'Milan Demo',     rep: 84, balance: 140_000_000, avgOvr: 80, color: '#cc0000' },
      { id: 't_napoli',    name: 'Napoli Demo',    rep: 82, balance: 110_000_000, avgOvr: 79, color: '#0099cc' },
      { id: 't_roma',      name: 'Roma Demo',      rep: 75, balance:  90_000_000, avgOvr: 76, color: '#990000' },
      { id: 't_lazio',     name: 'Lazio Demo',     rep: 72, balance:  70_000_000, avgOvr: 74, color: '#66ccff' },
      { id: 't_torino',    name: 'Torino Demo',    rep: 58, balance:  35_000_000, avgOvr: 70, color: '#660000' },
      { id: 't_empoli',    name: 'Empoli Demo',    rep: 48, balance:  18_000_000, avgOvr: 67, color: '#3366ff' },
    ]
    for (const s of setup) {
      teams[s.id] = mkTeam(s.id, s.name, s.rep, s.balance, s.color)
      stadiums[`s_${s.id}`] = {
        id: `s_${s.id}`, name: `Stadio ${s.name}`, capacity: 40000, pitchQuality: 80,
      }
      const xi = mkStartingXI(s.id, s.name.split(' ')[0], s.avgOvr)
      for (const p of xi) players[p.id] = p
      // Aggiungi panchina (5 ulteriori)
      for (let i = 12; i <= 16; i++) {
        const p = mkPlayer({ position: 'ST', overall: s.avgOvr - 5, teamId: s.id, lastName: `Riserva ${i}`, shirt: i })
        players[p.id] = p
      }
    }

    // 1 lega tier 1
    const leagueId = 'l_demo'
    const leagues: Record<string, League> = {
      [leagueId]: { id: leagueId, name: 'Lega Pro Stelle', country: 'IT', tier: 1, teamIds: Object.keys(teams) },
    }

    // 4 fixtures della giornata 1
    const fixtures: Fixture[] = [
      { id: 'f1', leagueId, matchday: 1, date: '2026-08-26T18:00:00Z', homeId: 't_inter',  awayId: 't_empoli',  status: 'scheduled' },
      { id: 'f2', leagueId, matchday: 1, date: '2026-08-26T20:45:00Z', homeId: 't_juve',   awayId: 't_roma',    status: 'scheduled' },
      { id: 'f3', leagueId, matchday: 1, date: '2026-08-27T15:00:00Z', homeId: 't_milan',  awayId: 't_napoli',  status: 'scheduled' },
      { id: 'f4', leagueId, matchday: 1, date: '2026-08-27T18:00:00Z', homeId: 't_lazio',  awayId: 't_torino',  status: 'scheduled' },
    ]

    // Manager dell'Inter (così puoi vedere il blocco "no propria squadra" su Inter-Empoli)
    const manager: Manager = {
      id: 'mgr_demo', name: 'Tu (Demo)', teamId: 't_inter', reputation: 60, seasonsAtClub: 1,
    }

    const tactics: Tactics = { formation: '4-3-3', mentality: 'balanced', tempo: 'normal', pressing: 'mid' }
    const interXI = Object.values(players).filter(p => p.teamId === 't_inter').slice(0, 11)
    const lineup: Lineup = {
      formation: '4-3-3',
      starters: interXI.map(p => p.id),
      bench: Object.values(players).filter(p => p.teamId === 't_inter').slice(11, 16).map(p => p.id),
    }
    const club: ClubState = { teamId: 't_inter', tactics, lineup }

    const career: Career = {
      schemaVersion: 1,
      id: 'demo_career',
      name: 'Demo Carriera',
      seed: 12345,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      manager,
      season: { year: 2026, currentMatchday: 1, totalMatchdays: 38 },
      teams, players, stadiums, leagues,
      fixtures,
      club,
      news: [] as NewsItem[],
    }
    // Inizializza bettingCareerData PRIMA che entri nel $state (così i $derived non
    // devono mutarla lazy — Svelte 5 vieta mutazioni dentro $derived).
    career.bettingCareerData = initBettingCareerData({
      clubId: manager.teamId!,
      matchday: 1,
    })
    refreshCapsFromTeam(career.bettingCareerData.wallet, teams[manager.teamId!])
    return career
  }

  // ============================================================
  // 2. RESOLVERS (lineup + form)
  // ============================================================

  const lineupResolver: LineupResolver = {
    resolve(career, teamId) {
      const roster = Object.values(career.players).filter(p => p.teamId === teamId)
      // Per ogni ruolo standard, prendi il migliore disponibile
      const slots: Position[] = ['GK', 'RB', 'CB', 'CB', 'LB', 'DM', 'CM', 'CM', 'RW', 'ST', 'LW']
      const used = new Set<string>()
      const lineup: Player[] = []
      for (const pos of slots) {
        const candidates = roster.filter(p => !used.has(p.id) && (p.position === pos || p.secondaryPositions.includes(pos)))
          .sort((a, b) => playerOverall(b) - playerOverall(a))
        if (candidates.length > 0) {
          lineup.push(candidates[0])
          used.add(candidates[0].id)
        } else {
          // fallback: il prossimo qualunque
          const next = roster.find(p => !used.has(p.id))
          if (next) { lineup.push(next); used.add(next.id) }
        }
      }
      return lineup
    },
  }

  const formResolver: FormResolver = {
    resolve() { return 0 },   // tutte le squadre in forma neutra per la demo
  }

  function playerOverall(p: Player): number {
    const a = p.attributes
    const tech = (a.passing + a.shooting + a.dribbling + a.finishing + a.crossing + a.tackling + a.heading) / 7
    const phys = (a.pace + a.stamina + a.strength) / 3
    const ment = (a.vision + a.composure + a.workRate) / 3
    let base = (tech * 0.5 + phys * 0.25 + ment * 0.25)
    if (p.position === 'GK') base = (a.reflexes + a.handling) / 2 * 0.7 + ment * 0.3
    return base * 5
  }

  // ============================================================
  // 3. STATE
  // ============================================================

  let career = $state<Career>(buildDemoCareer())
  let selectedFixtureId = $state<string | null>(null)
  let slipMode = $state<BetSlipMode>('single')
  let slipSelections = $state<BetSelection[]>([])
  let slipStake = $state<number>(50)
  let systemSize = $state<number>(2)
  let flash = $state<{ kind: 'info' | 'warn' | 'error' | 'success'; msg: string } | null>(null)
  let showAllMarkets = $state(false)

  // Derived — niente side effect dentro (Svelte 5 li vieta).
  // bettingCareerData è già inizializzato in buildDemoCareer.
  const data = $derived(career.bettingCareerData!)
  const myTeam = $derived(career.teams[career.manager.teamId!])
  const balance = $derived(myTeam.balance)
  const boards = $derived(Object.values(data.oddsBoards) as MatchOddsBoard[])
  const matchdayBoards = $derived(boards.filter(b => b.matchday === career.season.currentMatchday))
  const selectedBoard = $derived(
    selectedFixtureId ? boards.find(b => b.fixtureId === selectedFixtureId) ?? null : null
  )
  const allMarketsMap = $derived.by<Record<string, Market>>(() => {
    const map: Record<string, Market> = {}
    for (const b of boards) for (const m of b.markets) map[m.id] = m
    return map
  })

  const slipPreview = $derived.by(() => {
    if (slipSelections.length === 0) return null
    const validation = validateSlip(
      { mode: slipMode, selections: slipSelections, stake: slipStake, systemSize, acceptOddsChange: 'always' },
      allMarketsMap,
    )
    const pricing = priceSlip(
      { mode: slipMode, selections: slipSelections, stake: slipStake, systemSize, acceptOddsChange: 'always' },
      allMarketsMap,
    )
    return { validation, pricing }
  })

  // ============================================================
  // 4. INIT
  // ============================================================

  onMount(() => {
    // Genera quote per la prima giornata
    generateOddsForMatchday({
      career,
      matchday: career.season.currentMatchday,
      lineupResolver,
      formResolver,
    })
    refreshPromotions(career)
    showFlash('success', 'Quote generate per la giornata 1. Buon divertimento!')
  })

  // ============================================================
  // 5. AZIONI
  // ============================================================

  function teamName(id: string): string {
    return career.teams[id]?.name ?? id
  }

  function showFlash(kind: 'info' | 'warn' | 'error' | 'success', msg: string) {
    flash = { kind, msg }
    setTimeout(() => flash = null, 4000)
  }

  function isBlocked(board: MatchOddsBoard): boolean {
    return isOwnTeamFixture(career, board.fixtureId)
  }

  function addSelection(board: MatchOddsBoard, market: Market, selection: Selection) {
    if (isBlocked(board)) {
      showFlash('error', `Vietato scommettere sulla propria squadra (${myTeam.name})`)
      return
    }
    const sel: BetSelection = {
      fixtureId: board.fixtureId,
      marketId: market.id,
      selectionId: selection.id,
      snapshotOdds: selection.odds,
      snapshotLabel: `${teamName(board.homeId)} vs ${teamName(board.awayId)} — ${market.label}: ${selection.label}`,
      isLive: market.isLive,
      addedAt: Date.now(),
    }
    // Se modalità singola e già c'è qualcosa, sostituisci
    if (slipMode === 'single' && slipSelections.length > 0) {
      slipSelections = [sel]
      return
    }
    // Sostituisci se esiste già stesso mercato/fixture
    const idx = slipSelections.findIndex(s => s.fixtureId === sel.fixtureId && s.marketId === sel.marketId)
    if (idx >= 0) {
      slipSelections[idx] = sel
      return
    }
    slipSelections = [...slipSelections, sel]
    // Auto-promote a multipla
    if (slipMode === 'single' && slipSelections.length >= 2) slipMode = 'multiple'
  }

  function removeSelection(marketId: string) {
    slipSelections = slipSelections.filter(s => s.marketId !== marketId)
    if (slipSelections.length === 0) slipMode = 'single'
  }

  function clearSlip() {
    slipSelections = []
    slipMode = 'single'
  }

  function placeSlip() {
    if (slipSelections.length === 0) {
      showFlash('warn', 'Schedina vuota')
      return
    }
    const result = placeBet({
      career,
      draft: { mode: slipMode, selections: slipSelections, stake: slipStake, systemSize, acceptOddsChange: 'always' },
    })
    if (!result.ok) {
      showFlash('error', result.errors.join(' • '))
      return
    }
    showFlash('success', `Scommessa piazzata: €${slipStake.toFixed(2)} → potenziale €${result.bet.potentialWin.toFixed(2)}`)
    clearSlip()
  }

  function simulateFixture(board: MatchOddsBoard) {
    // Simulazione random ma realistica basata sui λ del modello
    const homeRoster = lineupResolver.resolve(career, board.homeId, career.fixtures.find(f => f.id === board.fixtureId)!)
    const awayRoster = lineupResolver.resolve(career, board.awayId, career.fixtures.find(f => f.id === board.fixtureId)!)
    // Per fare facile: rng Poisson da quote 1X2
    const m1x2 = board.markets.find(m => m.kind === '1X2')!
    const pHome = 1 / m1x2.selections[0].odds
    const pDraw = 1 / m1x2.selections[1].odds
    const r = Math.random()
    let homeScore = 0, awayScore = 0
    if (r < pHome / (pHome + pDraw + 1/m1x2.selections[2].odds)) {
      homeScore = 1 + Math.floor(Math.random() * 3)
      awayScore = Math.floor(Math.random() * homeScore)
    } else if (r < (pHome + pDraw) / (pHome + pDraw + 1/m1x2.selections[2].odds)) {
      const x = Math.floor(Math.random() * 3)
      homeScore = x; awayScore = x
    } else {
      awayScore = 1 + Math.floor(Math.random() * 3)
      homeScore = Math.floor(Math.random() * awayScore)
    }

    const scorers: any[] = []
    for (let i = 0; i < homeScore; i++) {
      const p = homeRoster.filter(p => p.position !== 'GK')[Math.floor(Math.random() * 10)]
      scorers.push({ playerId: p.id, teamId: board.homeId, minute: 10 + Math.floor(Math.random() * 80) })
    }
    for (let i = 0; i < awayScore; i++) {
      const p = awayRoster.filter(p => p.position !== 'GK')[Math.floor(Math.random() * 10)]
      scorers.push({ playerId: p.id, teamId: board.awayId, minute: 10 + Math.floor(Math.random() * 80) })
    }
    scorers.sort((a, b) => a.minute - b.minute)

    const events: any[] = scorers.map(s => ({
      minute: s.minute, second: 0, kind: 'goal',
      side: s.teamId === board.homeId ? 'home' : 'away',
      ballPosition: { x: 0.5, y: 0.5 },
      playerId: s.playerId,
    }))
    // Qualche cartellino e corner random
    for (let i = 0; i < 4; i++) {
      events.push({ minute: 20 + i * 15, second: 0, kind: 'yellow_card', side: Math.random() > 0.5 ? 'home' : 'away', ballPosition: { x: 0.5, y: 0.5 } })
    }
    for (let i = 0; i < 8; i++) {
      events.push({ minute: 5 + i * 10, second: 0, kind: 'corner', side: Math.random() > 0.5 ? 'home' : 'away', ballPosition: { x: 0.95, y: 0.5 } })
    }
    events.sort((a, b) => a.minute - b.minute)

    const result: MatchResult = {
      homeScore, awayScore,
      events,
      stats: {
        home: { possession: 55, shots: 12, shotsOnTarget: 4, corners: 5, fouls: 12, yellowCards: 2, redCards: 0, passes: 400, passAccuracy: 82 },
        away: { possession: 45, shots: 8, shotsOnTarget: 3, corners: 3, fouls: 14, yellowCards: 2, redCards: 0, passes: 320, passAccuracy: 78 },
      },
      ratings: {},
      scorers,
    }

    // Marca fixture come played
    const fix = career.fixtures.find(f => f.id === board.fixtureId)!
    fix.status = 'played'
    fix.result = result

    // Settle bollette
    const settled = settleMatch({ career, fixtureId: board.fixtureId, result })
    showFlash('info', `${teamName(board.homeId)} ${homeScore} - ${awayScore} ${teamName(board.awayId)}${settled.length > 0 ? ` • ${settled.length} bolletta/e risolta/e` : ''}`)
    // Force reactivity
    career = career
  }

  function advanceMatchday() {
    // Simula tutte le partite non ancora giocate della giornata corrente
    const unplayed = matchdayBoards.filter(b => career.fixtures.find(f => f.id === b.fixtureId)?.status === 'scheduled')
    for (const b of unplayed) simulateFixture(b)

    // Avanza giornata
    career.season.currentMatchday += 1
    onMatchdayAdvance(career, career.season.currentMatchday)

    // Genera nuove fixtures e quote per la prossima giornata: ri-shuffliamo gli accoppiamenti
    const teamIds = Object.keys(career.teams)
    const shuffled = [...teamIds].sort(() => Math.random() - 0.5)
    const newFixtures: Fixture[] = []
    for (let i = 0; i < shuffled.length; i += 2) {
      newFixtures.push({
        id: `f${career.season.currentMatchday}_${i / 2 + 1}`,
        leagueId: 'l_demo',
        matchday: career.season.currentMatchday,
        date: new Date(Date.now() + i * 3_600_000).toISOString(),
        homeId: shuffled[i],
        awayId: shuffled[i + 1],
        status: 'scheduled',
      })
    }
    career.fixtures = [...career.fixtures, ...newFixtures]

    generateOddsForMatchday({
      career, matchday: career.season.currentMatchday, lineupResolver, formResolver,
    })
    refreshPromotions(career)
    selectedFixtureId = null
    showFlash('success', `Giornata ${career.season.currentMatchday} — nuove quote generate`)
    career = career
  }

  function resetDemo() {
    career = buildDemoCareer()
    selectedFixtureId = null
    clearSlip()
    generateOddsForMatchday({
      career, matchday: career.season.currentMatchday, lineupResolver, formResolver,
    })
    refreshPromotions(career)
    showFlash('info', 'Demo resettata')
  }

  function doCashOut(betId: string) {
    const r = executeCashOut({ career, betId })
    if (!r.ok) { showFlash('error', r.reason); return }
    showFlash('success', `Cash out €${r.value.toFixed(2)}`)
    career = career
  }

  function getMarketsGroupedByCategory(board: MatchOddsBoard) {
    const groups: Record<string, Market[]> = {}
    for (const m of board.markets) {
      if (!groups[m.category]) groups[m.category] = []
      groups[m.category].push(m)
    }
    return groups
  }

  const CATEGORY_LABELS: Record<string, string> = {
    main: 'Principali',
    goals: 'Gol',
    handicap: 'Handicap',
    scorers: 'Marcatori',
    exact: 'Risultato esatto',
    halves: 'Tempi',
    combo: 'Combo',
    specials: 'Speciali',
  }

  function fmtEuro(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
  }
  function isSelectionInSlip(marketId: string, selectionId: string): boolean {
    return slipSelections.some(s => s.marketId === marketId && s.selectionId === selectionId)
  }
</script>

<div class="min-h-screen bg-onyx-950 text-gold-100">
  <!-- HEADER -->
  <header class="border-b border-gold-500/20 bg-onyx-900/80 backdrop-blur sticky top-0 z-10">
    <div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h1 class="text-gold-400 font-bold text-xl tracking-wider">🎯 SPORTSBOOK DEMO</h1>
        <span class="text-onyx-400 text-sm">Giornata {career.season.currentMatchday}</span>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-right">
          <div class="text-xs text-onyx-400">Saldo {myTeam.name}</div>
          <div class="text-gold-300 font-mono font-bold text-lg">{fmtEuro(balance)}</div>
        </div>
        <button onclick={advanceMatchday} class="px-3 py-2 bg-gold-500 text-onyx-950 rounded-lg font-semibold hover:bg-gold-400 transition">
          Avanza giornata →
        </button>
        <button onclick={resetDemo} class="px-3 py-2 border border-gold-500/30 text-gold-300 rounded-lg hover:bg-onyx-800 transition text-sm">
          Reset
        </button>
      </div>
    </div>
    {#if flash}
      <div class="border-t" class:border-emerald-500={flash.kind === 'success'} class:border-amber-500={flash.kind === 'warn'} class:border-red-500={flash.kind === 'error'} class:border-blue-500={flash.kind === 'info'}>
        <div class="max-w-7xl mx-auto px-6 py-2 text-sm font-medium"
             class:text-emerald-300={flash.kind === 'success'}
             class:text-amber-300={flash.kind === 'warn'}
             class:text-red-300={flash.kind === 'error'}
             class:text-blue-300={flash.kind === 'info'}>
          {flash.msg}
        </div>
      </div>
    {/if}
  </header>

  <main class="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
    <!-- LEFT: matches list / detail -->
    <section>
      {#if !selectedBoard}
        <h2 class="text-gold-400 font-semibold mb-4 text-lg">Partite della giornata</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each matchdayBoards as board (board.fixtureId)}
            {@const m1x2 = board.markets.find(m => m.kind === '1X2')}
            {@const mou25 = board.markets.find(m => m.kind === 'over_under' && m.label.includes('2.5'))}
            {@const mbtts = board.markets.find(m => m.kind === 'btts')}
            {@const blocked = isBlocked(board)}
            {@const played = career.fixtures.find(f => f.id === board.fixtureId)?.status === 'played'}
            <div class="rounded-2xl border border-gold-500/15 bg-onyx-800/60 backdrop-blur-xl p-4 {blocked ? 'opacity-70' : ''}">
              <div class="flex items-baseline justify-between mb-3">
                <div class="font-semibold text-gold-100">{teamName(board.homeId)} <span class="text-onyx-400">vs</span> {teamName(board.awayId)}</div>
                {#if blocked}<span class="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-500/40">propria squadra</span>{/if}
                {#if played}<span class="text-xs px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-500/40">giocata {career.fixtures.find(f => f.id === board.fixtureId)?.result?.homeScore}-{career.fixtures.find(f => f.id === board.fixtureId)?.result?.awayScore}</span>{/if}
              </div>
              {#if m1x2 && !played}
                <div class="grid grid-cols-3 gap-2 mb-2">
                  {#each m1x2.selections as sel}
                    {@const inSlip = isSelectionInSlip(m1x2.id, sel.id)}
                    <button
                      onclick={() => addSelection(board, m1x2, sel)}
                      disabled={blocked || m1x2.status !== 'open'}
                      class={`px-2 py-3 rounded-lg border transition text-center disabled:cursor-not-allowed disabled:opacity-50 ${inSlip ? 'bg-gold-500 text-onyx-950 border-gold-500' : 'bg-onyx-700 border-gold-500/30 hover:border-gold-500'}`}
                    >
                      <div class={`text-xs ${inSlip ? 'text-onyx-900' : 'text-onyx-300'}`}>{sel.label}</div>
                      <div class="font-mono font-bold">{sel.odds.toFixed(2)}</div>
                    </button>
                  {/each}
                </div>
              {/if}
              <div class="flex gap-2 mt-2">
                {#if mou25 && !played}
                  {#each mou25.selections as sel}
                    {@const inSlip = isSelectionInSlip(mou25.id, sel.id)}
                    <button
                      onclick={() => addSelection(board, mou25, sel)}
                      disabled={blocked}
                      class={`flex-1 px-2 py-2 rounded-lg border text-xs disabled:opacity-50 disabled:cursor-not-allowed ${inSlip ? 'bg-gold-500 text-onyx-950 border-gold-500' : 'bg-onyx-700 border-gold-500/20'}`}
                    >
                      <span class={inSlip ? 'text-onyx-900' : 'text-onyx-400'}>{sel.label}</span>
                      <span class="font-mono ml-1">{sel.odds.toFixed(2)}</span>
                    </button>
                  {/each}
                {/if}
                {#if mbtts && !played}
                  {#each mbtts.selections as sel}
                    {@const inSlip = isSelectionInSlip(mbtts.id, sel.id)}
                    <button
                      onclick={() => addSelection(board, mbtts, sel)}
                      disabled={blocked}
                      class={`flex-1 px-2 py-2 rounded-lg border text-xs disabled:opacity-50 disabled:cursor-not-allowed ${inSlip ? 'bg-gold-500 text-onyx-950 border-gold-500' : 'bg-onyx-700 border-gold-500/20'}`}
                    >
                      <span class={inSlip ? 'text-onyx-900' : 'text-onyx-400'}>{sel.label}</span>
                      <span class="font-mono ml-1">{sel.odds.toFixed(2)}</span>
                    </button>
                  {/each}
                {/if}
              </div>
              <div class="flex justify-between mt-3 text-xs">
                <button onclick={() => selectedFixtureId = board.fixtureId} class="text-gold-400 hover:text-gold-300 underline">
                  Tutti i {board.markets.length} mercati →
                </button>
                {#if !played}
                  <button onclick={() => simulateFixture(board)} class="text-onyx-400 hover:text-gold-300">
                    ⚡ Simula
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <!-- DETAIL -->
        <button onclick={() => selectedFixtureId = null} class="text-gold-400 mb-3 text-sm hover:underline">← Torna alle partite</button>
        <h2 class="text-gold-400 font-bold text-2xl mb-2">
          {teamName(selectedBoard.homeId)} <span class="text-onyx-400">vs</span> {teamName(selectedBoard.awayId)}
        </h2>
        <div class="text-xs text-onyx-400 mb-4">
          Lega: {resolveLeagueConfig(career, career.fixtures.find(f => f.id === selectedBoard.fixtureId)?.leagueId ?? '').label}
          {#if isBlocked(selectedBoard)} • <span class="text-red-400">Vietato scommettere (propria squadra)</span>{/if}
        </div>

        {#each Object.entries(getMarketsGroupedByCategory(selectedBoard)) as [cat, markets]}
          <div class="mb-6">
            <h3 class="text-gold-300 font-semibold mb-2 text-sm uppercase tracking-wider">
              {CATEGORY_LABELS[cat] ?? cat} <span class="text-onyx-500">({markets.length})</span>
            </h3>
            <div class="space-y-3">
              {#each markets as m}
                <div class="rounded-xl border border-gold-500/10 bg-onyx-800/40 p-3">
                  <div class="text-xs text-onyx-300 mb-2 flex justify-between">
                    <span>{m.label}</span>
                    <span class="text-onyx-500">margine {(m.margin * 100).toFixed(1)}%</span>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    {#each m.selections as sel}
                      {@const inSlip = isSelectionInSlip(m.id, sel.id)}
                      <button
                        onclick={() => addSelection(selectedBoard, m, sel)}
                        disabled={isBlocked(selectedBoard) || m.status !== 'open'}
                        class={`px-3 py-2 rounded-lg border text-sm disabled:opacity-50 disabled:cursor-not-allowed ${inSlip ? 'bg-gold-500 text-onyx-950 border-gold-500' : 'bg-onyx-700 border-gold-500/30 hover:border-gold-500'}`}
                      >
                        <span class={inSlip ? 'text-onyx-900' : 'text-onyx-300'}>{sel.label}</span>
                        <span class="font-mono font-bold ml-2">{sel.odds.toFixed(2)}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}

      <!-- MY BETS -->
      {#if data.openBets.length > 0 || data.settledBets.length > 0}
        <div class="mt-10 pt-6 border-t border-gold-500/10">
          <h2 class="text-gold-400 font-semibold mb-4 text-lg">Le mie bollette</h2>
          {#if data.openBets.length > 0}
            <h3 class="text-onyx-300 text-sm uppercase tracking-wider mb-2">Aperte ({data.openBets.length})</h3>
            <div class="space-y-2 mb-6">
              {#each data.openBets as bet (bet.id)}
                {@const cashQuote = computeCashOut(bet, allMarketsMap)}
                <div class="rounded-xl border border-gold-500/15 bg-onyx-800/40 p-3 flex justify-between items-center">
                  <div>
                    <div class="text-xs text-onyx-400">{new Date(bet.placedAt).toLocaleString('it-IT')} • {bet.mode}</div>
                    <div class="text-sm text-gold-100">{bet.selections.length} selezione/i • stake {fmtEuro(bet.stake)} • potenziale {fmtEuro(bet.potentialWin)}</div>
                    <div class="text-xs text-onyx-500 mt-1">{bet.selections.map(s => s.selectionLabel).join(' • ')}</div>
                  </div>
                  {#if cashQuote.available}
                    <button onclick={() => doCashOut(bet.id)} class="px-3 py-2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-sm font-semibold">
                      Cash out {fmtEuro(cashQuote.value)}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if data.settledBets.length > 0}
            <h3 class="text-onyx-300 text-sm uppercase tracking-wider mb-2">Risolte ({data.settledBets.length})</h3>
            <div class="space-y-2">
              {#each data.settledBets.slice(0, 10) as bet (bet.id)}
                <div class={`rounded-xl border p-3 text-sm ${
                  bet.status === 'won' ? 'border-emerald-500/30 bg-emerald-950/20' :
                  bet.status === 'lost' ? 'border-red-500/30 bg-red-950/20' :
                  bet.status === 'cashed_out' ? 'border-amber-500/30 bg-amber-950/20' :
                  'border-onyx-700'
                }`}>
                  <div class="flex justify-between">
                    <span class="font-semibold">
                      {bet.status === 'won' ? '✓ Vinta' : bet.status === 'lost' ? '✗ Persa' : bet.status === 'cashed_out' ? '◐ Cash out' : '○ ' + bet.status}
                    </span>
                    <span class="font-mono">
                      {bet.actualPayout ? '+' + fmtEuro(bet.actualPayout - bet.stake) : '-' + fmtEuro(bet.stake)}
                    </span>
                  </div>
                  <div class="text-xs text-onyx-400 mt-1">Stake {fmtEuro(bet.stake)} • payout {fmtEuro(bet.actualPayout ?? 0)} • {bet.selections.length} sel.</div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- RIGHT: BETSLIP -->
    <aside class="lg:sticky lg:top-24 lg:self-start">
      <div class="rounded-2xl border border-gold-500/20 bg-onyx-800/80 backdrop-blur-xl p-4">
        <div class="flex justify-between items-center mb-3">
          <h3 class="text-gold-400 font-bold">SCHEDINA</h3>
          {#if slipSelections.length > 0}
            <button onclick={clearSlip} class="text-onyx-400 hover:text-red-400 text-sm">Svuota</button>
          {/if}
        </div>

        <!-- Mode tabs -->
        <div class="grid grid-cols-3 gap-1 mb-3 bg-onyx-950 rounded-lg p-1 text-xs">
          {#each ['single', 'multiple', 'system'] as const as mode}
            <button
              onclick={() => slipMode = mode}
              disabled={mode === 'single' && slipSelections.length > 1}
              class={`py-1 rounded font-semibold capitalize ${slipMode === mode ? 'bg-gold-500 text-onyx-950' : 'text-onyx-400'}`}
            >{mode === 'single' ? 'Singola' : mode === 'multiple' ? 'Multipla' : 'Sistema'}</button>
          {/each}
        </div>

        {#if slipMode === 'system' && slipSelections.length >= 3}
          <div class="mb-3">
            <label for="sysSize" class="text-xs text-onyx-400">Sistema {systemSize}/{slipSelections.length}</label>
            <input id="sysSize" type="range" min={1} max={slipSelections.length} bind:value={systemSize} class="w-full" />
          </div>
        {/if}

        {#if slipSelections.length === 0}
          <div class="text-center py-8 text-onyx-500 text-sm">
            Clicca una quota per aggiungerla
          </div>
        {:else}
          <div class="space-y-2 mb-4 max-h-96 overflow-auto">
            {#each slipSelections as sel}
              <div class="bg-onyx-900 rounded-lg p-2 text-xs relative">
                <button onclick={() => removeSelection(sel.marketId)} class="absolute top-1 right-1 text-onyx-500 hover:text-red-400">×</button>
                <div class="text-onyx-300 pr-4">{sel.snapshotLabel}</div>
                <div class="font-mono text-gold-300 mt-1">@ {sel.snapshotOdds.toFixed(2)}</div>
              </div>
            {/each}
          </div>

          <div class="mb-3">
            <label for="stake" class="text-xs text-onyx-400">Stake</label>
            <div class="flex gap-1 mt-1">
              <input
                id="stake" type="number" min="1" step="1" bind:value={slipStake}
                class="flex-1 bg-onyx-900 border border-gold-500/20 rounded px-2 py-1 text-gold-100 font-mono"
              />
              {#each [10, 50, 100, 500] as v}
                <button onclick={() => slipStake = v} class="px-2 bg-onyx-700 hover:bg-onyx-600 rounded text-xs">{v}</button>
              {/each}
            </div>
          </div>

          {#if slipPreview}
            <div class="mb-3 text-sm space-y-1">
              <div class="flex justify-between">
                <span class="text-onyx-400">Quota combinata</span>
                <span class="font-mono text-gold-200">{slipPreview.pricing.combinedOdds.toFixed(2)}</span>
              </div>
              {#if slipPreview.pricing.bonusApplied > 0}
                <div class="flex justify-between text-emerald-300">
                  <span>+ Bonus multipla</span>
                  <span>{(slipPreview.pricing.bonusApplied * 100).toFixed(0)}%</span>
                </div>
              {/if}
              <div class="flex justify-between text-lg">
                <span class="text-gold-300 font-semibold">Vincita</span>
                <span class="font-mono text-gold-300 font-bold">{fmtEuro(slipPreview.pricing.potentialWin)}</span>
              </div>
              {#if slipPreview.pricing.capHit}
                <div class="text-amber-300 text-xs">⚠ Cap vincita raggiunto</div>
              {/if}
              {#if slipPreview.pricing.warnings.length > 0}
                <div class="text-amber-300 text-xs">{slipPreview.pricing.warnings.join(' • ')}</div>
              {/if}
              {#if !slipPreview.validation.ok}
                <div class="text-red-400 text-xs">{slipPreview.validation.errors.join(' • ')}</div>
              {/if}
            </div>
          {/if}

          <button
            onclick={placeSlip}
            disabled={!slipPreview?.validation.ok}
            class="w-full py-3 bg-gold-500 text-onyx-950 rounded-lg font-bold hover:bg-gold-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            PIAZZA SCOMMESSA
          </button>
        {/if}
      </div>

      <!-- Cap info -->
      <div class="mt-3 text-xs text-onyx-500 px-2">
        <div>Cap stake: {fmtEuro(data.wallet.caps.maxStakePerBet ?? 0)}</div>
        <div>Cap perdita settimanale: {fmtEuro(data.wallet.caps.maxLossPerMatchday ?? 0)}</div>
        <div>Settimana: staked {fmtEuro(data.wallet.matchdayState.totalStaked)} • net {fmtEuro(data.wallet.matchdayState.netProfit)}</div>
      </div>

      <!-- Promozioni -->
      {#if data.promotions.length > 0}
        <div class="mt-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3">
          <div class="text-amber-300 font-semibold text-sm mb-2">🎁 Promozioni attive</div>
          {#each data.promotions as p}
            <div class="text-xs text-amber-100 mb-1">
              {#if p.type === 'odds_boost'}
                Quote boost ×{p.multiplier} su mercato
              {:else if p.type === 'free_bet'}
                Free bet {fmtEuro(p.freeBetAmount ?? 0)}
              {:else if p.type === 'accumulator_bonus'}
                Bonus multipla +{((p.bonusPercent ?? 0) * 100).toFixed(0)}% da {p.minSelections} sel.
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </aside>
  </main>
</div>
