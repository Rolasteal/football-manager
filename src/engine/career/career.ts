/**
 * API alto livello per la gestione di una Career (savegame).
 *
 * createCareer() → genera mondo + calendario + manager + lineup default
 * advanceMatchday() → simula tutte le partite della giornata corrente,
 *                     aggiorna fixture, news, currentMatchday
 */

import type {
  EntityId, Player, Team, Season
} from '$engine/types'
import type { Fixture } from '$engine/competition/types'
import type { Career, Manager, ClubState, NewsItem } from './types'
import type { Lineup, Tactics, FormationName, Formation, FormationSlot } from '$engine/tactics/types'
import type { Position } from '$engine/types'

import { createRng, generateId, randomSeed, type Rng } from '$engine/gen/rng'
import { createWorld } from '$engine/gen/world'
import { buildAllSchedules } from '$engine/gen/schedule'
import { simulateMatch } from '$engine/match/engine'
import { calcOverall } from '$engine/gen/player'
import { initClubFinances, weeklyTick as financesWeeklyTick, applyMatchdayGate } from './finances'
import { initManagerAccount, tickManagerWeekly } from './manager'
import { ensureAllPlayersContracts, refreshMyClubWageBudget } from './contracts'
import { tickTransferOffers, tickAIToAITransfers } from './transfers'
import { ensureMarketValuesCalibrated } from './aging'

// ====== Formazioni standard ======

export const FORMATIONS: Record<FormationName, Formation> = {
  '4-4-2': {
    name: '4-4-2',
    slots: [
      { position: 'GK', x: 0.05, y: 0.5 },
      { position: 'RB', x: 0.22, y: 0.85 },
      { position: 'CB', x: 0.18, y: 0.62 },
      { position: 'CB', x: 0.18, y: 0.38 },
      { position: 'LB', x: 0.22, y: 0.15 },
      { position: 'RM', x: 0.50, y: 0.85 },
      { position: 'CM', x: 0.45, y: 0.62 },
      { position: 'CM', x: 0.45, y: 0.38 },
      { position: 'LM', x: 0.50, y: 0.15 },
      { position: 'ST', x: 0.78, y: 0.60 },
      { position: 'ST', x: 0.78, y: 0.40 },
    ],
  },
  '4-3-3': {
    name: '4-3-3',
    slots: [
      { position: 'GK', x: 0.05, y: 0.5 },
      { position: 'RB', x: 0.22, y: 0.85 },
      { position: 'CB', x: 0.18, y: 0.62 },
      { position: 'CB', x: 0.18, y: 0.38 },
      { position: 'LB', x: 0.22, y: 0.15 },
      { position: 'CM', x: 0.45, y: 0.70 },
      { position: 'DM', x: 0.40, y: 0.50 },
      { position: 'CM', x: 0.45, y: 0.30 },
      { position: 'RW', x: 0.75, y: 0.85 },
      { position: 'ST', x: 0.80, y: 0.50 },
      { position: 'LW', x: 0.75, y: 0.15 },
    ],
  },
  '4-2-3-1': {
    name: '4-2-3-1',
    slots: [
      { position: 'GK', x: 0.05, y: 0.5 },
      { position: 'RB', x: 0.22, y: 0.85 },
      { position: 'CB', x: 0.18, y: 0.62 },
      { position: 'CB', x: 0.18, y: 0.38 },
      { position: 'LB', x: 0.22, y: 0.15 },
      { position: 'DM', x: 0.40, y: 0.60 },
      { position: 'DM', x: 0.40, y: 0.40 },
      { position: 'RM', x: 0.62, y: 0.85 },
      { position: 'AM', x: 0.65, y: 0.50 },
      { position: 'LM', x: 0.62, y: 0.15 },
      { position: 'ST', x: 0.82, y: 0.50 },
    ],
  },
  '3-5-2': {
    name: '3-5-2',
    slots: [
      { position: 'GK', x: 0.05, y: 0.5 },
      { position: 'CB', x: 0.18, y: 0.75 },
      { position: 'CB', x: 0.16, y: 0.50 },
      { position: 'CB', x: 0.18, y: 0.25 },
      { position: 'RM', x: 0.50, y: 0.92 },
      { position: 'CM', x: 0.45, y: 0.65 },
      { position: 'DM', x: 0.40, y: 0.50 },
      { position: 'CM', x: 0.45, y: 0.35 },
      { position: 'LM', x: 0.50, y: 0.08 },
      { position: 'ST', x: 0.78, y: 0.60 },
      { position: 'ST', x: 0.78, y: 0.40 },
    ],
  },
  '5-3-2': {
    name: '5-3-2',
    slots: [
      { position: 'GK', x: 0.05, y: 0.5 },
      { position: 'WB', x: 0.25, y: 0.90 },
      { position: 'CB', x: 0.18, y: 0.70 },
      { position: 'CB', x: 0.16, y: 0.50 },
      { position: 'CB', x: 0.18, y: 0.30 },
      { position: 'WB', x: 0.25, y: 0.10 },
      { position: 'CM', x: 0.48, y: 0.65 },
      { position: 'CM', x: 0.45, y: 0.50 },
      { position: 'CM', x: 0.48, y: 0.35 },
      { position: 'ST', x: 0.78, y: 0.58 },
      { position: 'ST', x: 0.78, y: 0.42 },
    ],
  },
  '4-5-1': {
    name: '4-5-1',
    slots: [
      { position: 'GK', x: 0.05, y: 0.5 },
      { position: 'RB', x: 0.22, y: 0.85 },
      { position: 'CB', x: 0.18, y: 0.62 },
      { position: 'CB', x: 0.18, y: 0.38 },
      { position: 'LB', x: 0.22, y: 0.15 },
      { position: 'RM', x: 0.55, y: 0.90 },
      { position: 'CM', x: 0.48, y: 0.65 },
      { position: 'DM', x: 0.42, y: 0.50 },
      { position: 'CM', x: 0.48, y: 0.35 },
      { position: 'LM', x: 0.55, y: 0.10 },
      { position: 'ST', x: 0.82, y: 0.50 },
    ],
  },
}

// ====== Lineup automatica ======

const POS_GROUP: Record<Position, 'GK' | 'DEF' | 'MID' | 'ATT'> = {
  GK: 'GK',
  CB: 'DEF', LB: 'DEF', RB: 'DEF', WB: 'DEF',
  DM: 'MID', CM: 'MID', AM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'ATT', RW: 'ATT', CF: 'ATT', ST: 'ATT',
}

/** Assegna giocatori agli 11 slot di una formazione: best-fit per ruolo, ordinato per overall. */
export function autoLineup(formation: Formation, squad: Player[]): Lineup {
  const used = new Set<EntityId>()
  const starters: EntityId[] = []

  // Pool ordinato per overall desc
  const sortedByOv = [...squad].sort((a, b) => calcOverall(b) - calcOverall(a))

  for (const slot of formation.slots) {
    // 1. Match esatto sulla posizione richiesta
    let pick = sortedByOv.find(p => !used.has(p.id) && p.position === slot.position)
    // 2. Stesso gruppo (DEF/MID/ATT/GK)
    if (!pick) {
      pick = sortedByOv.find(p => !used.has(p.id) && POS_GROUP[p.position] === POS_GROUP[slot.position])
    }
    // 3. Qualsiasi non usato (fallback)
    if (!pick) {
      pick = sortedByOv.find(p => !used.has(p.id))
    }
    if (pick) {
      used.add(pick.id)
      starters.push(pick.id)
    }
  }

  // Bench: 7 giocatori distribuiti per ruolo come da spec Roberto —
  // 1 GK + 2 DEF + 2 MID + 2 ATT. All'interno di ogni gruppo si pesca
  // per overall desc. Se un gruppo non ha abbastanza giocatori liberi,
  // si riempie con i migliori rimasti (qualsiasi ruolo) come fallback
  // così la panchina ha sempre 7 elementi.
  const BENCH_QUOTA: Array<{ group: 'GK' | 'DEF' | 'MID' | 'ATT'; count: number }> = [
    { group: 'GK',  count: 1 },
    { group: 'DEF', count: 2 },
    { group: 'MID', count: 2 },
    { group: 'ATT', count: 2 },
  ]
  const bench: EntityId[] = []
  const benchUsed = new Set<EntityId>()
  for (const { group, count } of BENCH_QUOTA) {
    const picks = sortedByOv.filter(p =>
      !used.has(p.id) && !benchUsed.has(p.id) && POS_GROUP[p.position] === group
    ).slice(0, count)
    for (const p of picks) {
      benchUsed.add(p.id)
      bench.push(p.id)
    }
  }
  // Riempi fino a 7 se qualche quota non era soddisfatta
  if (bench.length < 7) {
    const remaining = sortedByOv.filter(p => !used.has(p.id) && !benchUsed.has(p.id))
    for (const p of remaining) {
      if (bench.length >= 7) break
      benchUsed.add(p.id)
      bench.push(p.id)
    }
  }

  return {
    formation: formation.name,
    starters,
    bench,
  }
}

export const DEFAULT_TACTICS: Tactics = {
  formation: '4-3-3',
  mentality: 'balanced',
  tempo: 'normal',
  pressing: 'mid',
}

// ====== Career creation ======

export interface CreateCareerOptions {
  managerName: string
  /** ID squadra scelta dal giocatore */
  teamId: EntityId
  /** Anno stagione (es. 2026 per 2026/27). Default = anno corrente UTC. */
  seasonYear?: number
  /** Seed deterministico. Se omesso, casuale. */
  seed?: number
  /** Nome dello slot di salvataggio */
  saveName?: string
}

/**
 * STEP A: genera solo il mondo (per il wizard, così l'utente può
 * scegliere la squadra). Si chiama prima di createCareer().
 */
export interface PreviewWorld {
  seed: number
  seasonYear: number
  world: ReturnType<typeof createWorld>
}

export function generateWorldPreview(seasonYear?: number, seed?: number): PreviewWorld {
  const actualSeed = seed ?? randomSeed()
  const rng = createRng(actualSeed)
  const year = seasonYear ?? new Date().getUTCFullYear()
  const world = createWorld(rng, { seasonYear: year })
  return { seed: actualSeed, seasonYear: year, world }
}

/**
 * STEP B: dato un preview e la scelta utente, costruisce la Career completa
 * (calendario + manager + lineup + news iniziale).
 */
export function buildCareerFromPreview(preview: PreviewWorld, opts: Omit<CreateCareerOptions, 'seed' | 'seasonYear'>): Career {
  const { world, seed, seasonYear } = preview
  const { managerName, teamId, saveName } = opts

  // Trova lega del team scelto
  const leagues = Object.values(world.leagues)
  const myLeague = leagues.find(l => l.teamIds.includes(teamId))
  if (!myLeague) throw new Error(`Team ${teamId} non appartiene a nessuna lega.`)

  const myTeam = world.teams[teamId]
  if (!myTeam) throw new Error(`Team ${teamId} non trovato nel mondo generato.`)

  // Calendario: usa un nuovo rng derivato per non collidere con la generazione mondo
  const rngSched = createRng((seed ^ 0xCA1E_DA20) >>> 0)
  const startIso = `${seasonYear}-08-22`  // sabato indicativo metà agosto
  const fixtures = buildAllSchedules(rngSched, leagues, startIso)

  // Manager
  const manager: Manager = {
    id: generateId(rngSched),
    name: managerName.trim() || 'Mister',
    teamId,
    reputation: 30,
    seasonsAtClub: 0,
    // Fase 4.A: conto personale del manager, calibrato sulla reputation del club
    // (stipendio settimanale + bonus di benvenuto €50k).
    account: initManagerAccount(myTeam),
  }

  // Squadra del giocatore: lineup automatica
  const mySquad = Object.values(world.players).filter(p => p.teamId === teamId)
  const formation = FORMATIONS[DEFAULT_TACTICS.formation]
  const lineup = autoLineup(formation, mySquad)
  const tactics: Tactics = {
    ...DEFAULT_TACTICS,
    captainId: lineup.starters[5],  // mediano come capitano di default
  }
  const club: ClubState = { teamId, tactics, lineup }

  const season: Season = {
    year: seasonYear,
    currentMatchday: 1,
    totalMatchdays: 38,
  }

  const now = Date.now()
  const initialNews: NewsItem[] = [
    {
      id: generateId(rngSched),
      date: startIso,
      kind: 'board',
      title: `Benvenuto al ${myTeam.name}, ${manager.name}!`,
      body: `Il consiglio si aspetta una stagione tranquilla. Buona fortuna in panchina.`,
      read: false,
    }
  ]

  const career: Career = {
    schemaVersion: 1,
    id: generateId(rngSched),
    name: saveName ?? `Carriera ${myTeam.name}`,
    seed,
    createdAt: now,
    updatedAt: now,
    manager,
    season,
    teams: world.teams,
    players: world.players,
    stadiums: world.stadiums,
    leagues: world.leagues,
    fixtures,
    club,
    news: initialNews,
    // Fase 3.1: finanze club ricche per il mio club
    clubFinances: initClubFinances(myTeam),
    // Fase 3.G.1: stato mercato vuoto pronto (le offerte si generano in
    // advanceMatchday via tickTransferOffers). Init esplicito evita che
    // la UI /transfers debba mutare i campi dentro $derived (fix black page).
    transferOffers: [],
    transferHistory: [],
  }
  // Fase 3.D: contratti iniziali per tutta la rosa di tutti i club +
  // monte ingaggi del MIO club aggiornato dalla rosa reale.
  ensureAllPlayersContracts(career)
  refreshMyClubWageBudget(career)
  // Fase 3.G fix-values: marca i marketValue come già calibrati (sono stati
  // generati con la formula corretta in computeInitialMarketValue).
  career.marketValuesV2 = true
  // Fix giovani v2 (2026-05-27): generatePlayer ora applica youthScaleForAge per
  // age ≤ 21, quindi i player iniziali sono già scalati correttamente. Marca
  // come migrato per evitare doppio scaling al primo /youth visit.
  career.youthRescaledV2 = true
  return career
}

/**
 * One-shot: crea preview + career. Comodo per test, l'UI userà
 * generateWorldPreview() + buildCareerFromPreview() per separare gli step.
 */
export function createCareer(opts: CreateCareerOptions): Career {
  const preview = generateWorldPreview(opts.seasonYear, opts.seed)
  return buildCareerFromPreview(preview, {
    managerName: opts.managerName,
    teamId: opts.teamId,
    saveName: opts.saveName,
  })
}

// ====== Avanzamento giornata ======

export interface AdvanceMatchdayResult {
  matchdayPlayed: number
  fixturesPlayed: number
  myFixture: Fixture | null
  seasonOver: boolean
}

/**
 * Simula tutte le partite della giornata corrente in batch.
 * NB: questa funzione MUTA la career (status fixture + currentMatchday + news).
 * La UI deve invocarla dopo (o intorno a) il replay live della propria partita.
 */
export function advanceMatchday(career: Career): AdvanceMatchdayResult {
  const md = career.season.currentMatchday
  if (md > career.season.totalMatchdays) {
    return { matchdayPlayed: md, fixturesPlayed: 0, myFixture: null, seasonOver: true }
  }

  const rng = createRng((career.seed ^ md ^ 0x9E37) >>> 0)
  const myFixture = career.fixtures.find(f =>
    f.matchday === md && (f.homeId === career.club.teamId || f.awayId === career.club.teamId)
  ) ?? null

  // Fase 3.2: incasso gate dei match di casa, PRIMA delle simulazioni.
  // Così la `recentForm` letta da computeStandings non include il risultato
  // della partita corrente (tifosi comprano il biglietto in anticipo).
  applyMatchdayGate(career, md)

  let count = 0
  for (const f of career.fixtures) {
    if (f.matchday !== md) continue
    if (f.status === 'played') continue
    const home = career.teams[f.homeId]
    const away = career.teams[f.awayId]
    const homeRoster = Object.values(career.players).filter(p => p.teamId === f.homeId)
    const awayRoster = Object.values(career.players).filter(p => p.teamId === f.awayId)

    // Lineup: la mia da club.lineup, le altre con autoLineup deterministico
    const isMyHome = f.homeId === career.club.teamId
    const isMyAway = f.awayId === career.club.teamId
    const fallback = FORMATIONS[career.club.tactics.formation] ?? FORMATIONS['4-3-3']
    const homeLineup = isMyHome ? career.club.lineup : autoLineup(fallback, homeRoster)
    const awayLineup = isMyAway ? career.club.lineup : autoLineup(fallback, awayRoster)

    // 11 titolari + 7 panchina vanno all'engine. Le sostituzioni live
    // pescano dal bench (max 5/squadra, ruolo-compatibili).
    const homeStarters = homeLineup.starters.map(id => career.players[id]).filter(Boolean)
    const awayStarters = awayLineup.starters.map(id => career.players[id]).filter(Boolean)
    const homeBench    = homeLineup.bench.map(id => career.players[id]).filter(Boolean)
    const awayBench    = awayLineup.bench.map(id => career.players[id]).filter(Boolean)

    const result = simulateMatch({
      home, away,
      homePlayers: homeStarters, awayPlayers: awayStarters,
      homeBench, awayBench,
      rng,
    })
    result.homeLineup = homeLineup
    result.awayLineup = awayLineup
    f.status = 'played'
    f.result = result
    count++

    // News se è la mia squadra
    if (myFixture && f.id === myFixture.id) {
      career.news.unshift({
        id: generateId(rng),
        date: f.date,
        kind: 'match_result',
        title: `${home.name} ${result.homeScore} - ${result.awayScore} ${away.name}`,
        body: `Giornata ${md} di campionato.`,
        read: false,
      })
    }
  }

  career.season.currentMatchday++
  career.updatedAt = Date.now()

  // Fase 3.1: tick settimanale finanze (ricavi/spese del mio club + AI teams).
  // Si appoggia a ensureClubFinances per save legacy.
  financesWeeklyTick(career, md)

  // Fase 4.A: stipendio settimanale manager (separato dalla cassa club).
  // ensureManagerAccount popola il conto al volo per save legacy.
  tickManagerWeekly(career, md)

  // Fase 3.G.1: tick mercato (genera offerte AI verso mio club se window aperta,
  // scade le pending vecchie). md = matchday APPENA giocato.
  tickTransferOffers(career, md)

  // Fase 3.G.2.b: scambi AI↔AI di sottofondo (max 4 finalize/MD, solo durante
  // window. News condensate per non spammare).
  tickAIToAITransfers(career, md)

  // Mantieni news a max 50
  if (career.news.length > 50) career.news.length = 50

  return {
    matchdayPlayed: md,
    fixturesPlayed: count,
    myFixture,
    seasonOver: career.season.currentMatchday > career.season.totalMatchdays,
  }
}
