/**
 * Match engine Fase 1 MVP: simulazione tick-based a granularità di minuto.
 *
 * Approccio:
 *  - Calcola "team strength" da media overall dei giocatori (tutti)
 *  - Boost casa (+5%)
 *  - Numero tiri attesi proporzionale a forza relativa
 *  - Probabilità gol per tiro funzione di overall ATT vs DEF
 *  - Eventi minori (passaggi/falli/corner) inframezzati per ritmo
 *  - Commentari da template italiani con sostituzione placeholder
 *
 * Output: MatchResult con tutti gli eventi, stats, ratings, scorers.
 * La live view UI riproduce gli eventi a velocità configurabile.
 *
 * NB: usa Player.attributes già definito. Non simula posizioni continue
 * (le coordinate sono solo approssimative sull'evento). Il futuro engine
 * 2D top-down userà la stessa interfaccia di output ma con tick continui.
 */

import type { EntityId, Player, Team } from '$engine/types'
import type {
  MatchEvent, MatchEventKind, Side, PitchPoint
} from './types'
import type {
  MatchResult, MatchStats, TeamMatchStats, Scorer
} from '$engine/competition/types'
import type { Rng } from '$engine/gen/rng'
import { calcOverall } from '$engine/gen/player'
import { TPL, type TplKey } from './commentary'

// ====== Helpers ======

function tpl(rng: Rng, key: TplKey, vars: Record<string, string | number> = {}): string {
  const pool = TPL[key] as readonly string[]
  let s: string = pool[Math.floor(rng.next() * pool.length)]
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return s
}

function shortName(p: Player): string {
  return p.lastName
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function emptyStats(): TeamMatchStats {
  return {
    possession: 50, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0,
    yellowCards: 0, redCards: 0, passes: 0, passAccuracy: 0,
  }
}

interface TeamSide {
  team: Team
  /** Giocatori IN CAMPO — array mutabile, le sostituzioni togliere out e aggiungono in */
  players: Player[]
  /** Riserve disponibili — chi è già entrato esce da qui */
  bench: Player[]
  side: Side
  strength: number    // 30-99
  attStrength: number // media attaccanti
  defStrength: number // media difensori
  /** Sostituzioni già usate (max 5) */
  subsUsed: number
}

function role(p: Player): 'GK' | 'DEF' | 'MID' | 'ATT' {
  switch (p.position) {
    case 'GK': return 'GK'
    case 'CB': case 'LB': case 'RB': case 'WB': return 'DEF'
    case 'DM': case 'CM': case 'AM': case 'LM': case 'RM': return 'MID'
    default: return 'ATT'
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function buildSide(team: Team, players: Player[], bench: Player[], side: Side): TeamSide {
  const allOv = players.map(calcOverall)
  const strength = avg(allOv)
  const attStrength = avg(players.filter(p => role(p) === 'ATT').map(calcOverall))
  const defStrength = avg(players.filter(p => role(p) === 'DEF' || role(p) === 'GK').map(calcOverall))
  return { team, players, bench, side, strength, attStrength, defStrength, subsUsed: 0 }
}

/** Ricalcola attStrength/defStrength dopo che un giocatore esce e uno entra,
 *  oppure dopo un'espulsione (con `removed` non rimpiazzato). */
function recomputeStrengths(t: TeamSide) {
  const allOv = t.players.map(calcOverall)
  // Forza media generale (usata per il numero atteso di tiri iniziale —
  // non la ricalcoliamo perché expShots è già stato calcolato a inizio gara)
  t.attStrength = avg(t.players.filter(p => role(p) === 'ATT').map(calcOverall))
  t.defStrength = avg(t.players.filter(p => role(p) === 'DEF' || role(p) === 'GK').map(calcOverall))
  // Strength generale ricalcolata per coerenza (anche se non usata dopo init)
  t.strength = avg(allOv)
}

/** Penalità per la squadra che ha appena subito un'espulsione: meno forza
 *  d'attacco (-12%) e di difesa (-10%) — riflesso del giocatore in meno.
 *  Cumulativa: 2 espulsioni → 0.88² ≈ 0.77 attStrength residua. */
function applyRedHandicap(t: TeamSide) {
  t.attStrength *= 0.88
  t.defStrength *= 0.90
  t.strength    *= 0.90
}

function pickRoleWeighted(rng: Rng, players: Player[], roles: Array<'GK' | 'DEF' | 'MID' | 'ATT'>): Player {
  const pool = players.filter(p => roles.includes(role(p)))
  if (pool.length === 0) return players[Math.floor(rng.next() * players.length)]
  // Weighting per overall + fitness
  const weights = pool.map(p => calcOverall(p) * (p.fitness / 100))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

const ZONE_DEF: PitchPoint = { x: 0.2, y: 0.5 }
const ZONE_MID: PitchPoint = { x: 0.5, y: 0.5 }
const ZONE_ATT: PitchPoint = { x: 0.8, y: 0.5 }

function ballAt(side: Side, zone: PitchPoint, jitter: Rng): PitchPoint {
  // Inverti x per side away (la sua "porta" è x=0)
  const x = side === 'home' ? zone.x : 1 - zone.x
  return {
    x: clamp(x + (jitter.next() - 0.5) * 0.08, 0, 1),
    y: clamp(zone.y + (jitter.next() - 0.5) * 0.7, 0, 1),
  }
}

// ====== Simulazione ======

export interface SimulateMatchOptions {
  home: Team
  away: Team
  /** Titolari iniziali (11) — l'engine ne tiene traccia mutando l'array durante le sub */
  homePlayers: Player[]
  awayPlayers: Player[]
  /** Riserve disponibili (default: bench vuota) — opzionali per backward-compat */
  homeBench?: Player[]
  awayBench?: Player[]
  rng: Rng
}

export function simulateMatch(opts: SimulateMatchOptions): MatchResult {
  const { home, away, homePlayers, awayPlayers, rng } = opts
  // Copia gli array così le mutazioni (sub, sentOff) non leakano fuori
  const homeSide = buildSide(home, [...homePlayers], [...(opts.homeBench ?? [])], 'home')
  const awaySide = buildSide(away, [...awayPlayers], [...(opts.awayBench ?? [])], 'away')

  // Forza relativa con boost casa. Target: distribuzione casa/X/fuori
  // ~46/27/27% come Serie A storica → boost casa ~+9% sui parametri chiave.
  const HOME_BOOST = 1.09
  const fh = homeSide.strength * HOME_BOOST
  const fa = awaySide.strength
  const sumF = fh + fa
  const possHome = Math.round((fh / sumF) * 100)

  // Numero tiri attesi (~12 base, ±forza). La casa parte con +0.6 tiri di
  // baseline per riflettere pressione tifo / familiarità campo.
  const expShotsHome = clamp(8.6 + (fh - 50) * 0.16 + rng.gauss(0, 1.2), 4, 22)
  const expShotsAway = clamp(8.0 + (fa - 50) * 0.16 + rng.gauss(0, 1.2), 4, 22)

  const events: MatchEvent[] = []
  const stats: MatchStats = { home: emptyStats(), away: emptyStats() }
  const scorers: Scorer[] = []
  const ratings: Record<EntityId, number> = {}
  /** Conteggio gialli per playerId — secondo giallo = espulsione automatica */
  const yellowCounts: Record<EntityId, number> = {}
  /** Set giocatori già espulsi (skip eventi successivi per loro) */
  const sentOff = new Set<EntityId>()
  // Init ratings 6.0 per tutti (titolari + bench, così chi entra parte da 6.0)
  for (const p of [...homePlayers, ...awayPlayers, ...homeSide.bench, ...awaySide.bench]) {
    ratings[p.id] = 6.0
  }

  stats.home.possession = possHome
  stats.away.possession = 100 - possHome

  // Distribuisce minuti tiro
  function spreadShots(n: number): number[] {
    const minutes: number[] = []
    for (let i = 0; i < n; i++) {
      // peso seconda metà leggermente maggiore
      const m = Math.floor(Math.pow(rng.next(), 0.85) * 90) + 1
      minutes.push(clamp(m, 1, 90))
    }
    return minutes.sort((a, b) => a - b)
  }

  const homeShotMinutes = spreadShots(Math.round(expShotsHome))
  const awayShotMinutes = spreadShots(Math.round(expShotsAway))

  // Eventi kickoff
  events.push({
    minute: 0, second: 0, kind: 'kickoff', side: null,
    ballPosition: { x: 0.5, y: 0.5 },
    commentary: tpl(rng, 'kickoff'),
  })

  let homeScore = 0, awayScore = 0
  let halfTimeEmitted = false
  let secondHalfStarted = false

  function emitMinute(min: number) {
    if (!halfTimeEmitted && min === 45) {
      events.push({
        minute: 45, second: 0, kind: 'half_time', side: null,
        ballPosition: { x: 0.5, y: 0.5 },
        commentary: tpl(rng, 'half_time'),
      })
      halfTimeEmitted = true
    }
    if (!secondHalfStarted && min === 46) {
      events.push({
        minute: 46, second: 0, kind: 'kickoff', side: null,
        ballPosition: { x: 0.5, y: 0.5 },
        commentary: tpl(rng, 'second_half_start'),
      })
      secondHalfStarted = true
    }
  }

  function tryShot(side: TeamSide, opp: TeamSide, min: number) {
    const shooter = pickRoleWeighted(rng, side.players, ['ATT', 'MID'])
    const teamStats = side.side === 'home' ? stats.home : stats.away
    const oppStats = opp.side === 'home' ? stats.home : stats.away
    teamStats.shots++
    const finishing = shooter.attributes.finishing / 20
    const composure = shooter.attributes.composure / 20
    const defenseStrength = opp.defStrength / 99
    // Vantaggio casa: +0.02 di goalProb base (insieme al boost su expShots
    // e poss porta la distribuzione casa/X/fuori intorno a 46/27/27%).
    const homeAdv = side.side === 'home' ? 0.02 : 0
    const goalProb = clamp(0.30 * finishing + 0.10 * composure - 0.18 * defenseStrength + 0.05 + homeAdv, 0.04, 0.45)
    const onTargetProb = clamp(0.55 + 0.10 * finishing - 0.05 * defenseStrength, 0.30, 0.85)

    if (rng.chance(goalProb)) {
      // GOAL
      teamStats.shotsOnTarget++
      const hasAssist = rng.chance(0.55)
      let assistMan: Player | undefined
      if (hasAssist) {
        const candidates = side.players.filter(p => p.id !== shooter.id && (role(p) === 'MID' || role(p) === 'ATT'))
        if (candidates.length > 0) assistMan = candidates[Math.floor(rng.next() * candidates.length)]
      }
      const ev: MatchEvent = {
        minute: min, second: rng.int(0, 59), kind: 'goal',
        side: side.side, playerId: shooter.id, secondaryPlayerId: assistMan?.id,
        ballPosition: ballAt(side.side, ZONE_ATT, rng),
        commentary: assistMan
          ? tpl(rng, 'goal_with_assist', { p: shortName(shooter), p2: shortName(assistMan), min })
          : tpl(rng, 'goal', { p: shortName(shooter), min }),
      }
      events.push(ev)
      if (side.side === 'home') homeScore++; else awayScore++
      scorers.push({ playerId: shooter.id, teamId: side.team.id, minute: min })
      ratings[shooter.id] = clamp((ratings[shooter.id] ?? 6) + 1.0, 1, 10)
      if (assistMan) ratings[assistMan.id] = clamp((ratings[assistMan.id] ?? 6) + 0.6, 1, 10)
    } else if (rng.chance(onTargetProb)) {
      // Shot on target → save
      teamStats.shotsOnTarget++
      const gk = opp.players.find(p => p.position === 'GK')
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'shot_on_target',
        side: side.side, playerId: shooter.id,
        ballPosition: ballAt(side.side, ZONE_ATT, rng),
        commentary: tpl(rng, 'shot_on_target', { p: shortName(shooter) }),
      })
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'save',
        side: opp.side, playerId: gk?.id,
        ballPosition: ballAt(opp.side, { x: 0.05, y: 0.5 }, rng),
        commentary: tpl(rng, 'save', { p: shortName(shooter) }),
      })
      if (gk) ratings[gk.id] = clamp((ratings[gk.id] ?? 6) + 0.2, 1, 10)
      ratings[shooter.id] = clamp((ratings[shooter.id] ?? 6) + 0.1, 1, 10)
    } else {
      // Shot off
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'shot',
        side: side.side, playerId: shooter.id,
        ballPosition: ballAt(side.side, ZONE_ATT, rng),
        commentary: tpl(rng, 'shot_off', { p: shortName(shooter) }),
      })
      ratings[shooter.id] = clamp((ratings[shooter.id] ?? 6) - 0.05, 1, 10)
    }
  }

  /**
   * Esegue un rigore: emette evento 'penalty' (assegnazione) + esito.
   * Distribuzione tratta da stats reali (Premier League / Serie A):
   *   75% gol · 17% parato · 4% alto · 2% largo · 1% palo · 1% traversa
   * Tutti gli eventi-tiro derivati hanno `note: 'penalty'` per essere
   * riconosciuti dal calcolo fanta-bonus della UI senza re-scan eventi.
   */
  function tryPenalty(attSide: TeamSide, defSide: TeamSide, min: number, fouler: Player, fouled: Player) {
    const attStats = attSide.side === 'home' ? stats.home : stats.away
    // 1. Emit "rigore assegnato"
    events.push({
      minute: min, second: rng.int(0, 5), kind: 'penalty',
      side: attSide.side, playerId: fouled.id, secondaryPlayerId: fouler.id,
      ballPosition: ballAt(attSide.side, { x: 0.88, y: 0.5 }, rng),
      commentary: tpl(rng, 'penalty_awarded', { p: shortName(fouler), p2: shortName(fouled), t: attSide.team.name }),
    })

    // 2. Sceglie esecutore — miglior finisher in campo (escludendo espulsi)
    const onPitch = attSide.players.filter(p => !sentOff.has(p.id))
    const taker = [...onPitch].sort((a, b) => b.attributes.finishing - a.attributes.finishing)[0]
    const gk = defSide.players.find(p => p.position === 'GK' && !sentOff.has(p.id))
    if (!taker) return

    // 3. Esito — cumulative cutoffs su stats reali
    const roll = rng.next()
    const sec = rng.int(20, 50)
    attStats.shots++
    if (roll < 0.75) {
      // GOAL
      attStats.shotsOnTarget++
      events.push({
        minute: min, second: sec, kind: 'goal',
        side: attSide.side, playerId: taker.id,
        ballPosition: ballAt(attSide.side, { x: 0.95, y: 0.5 }, rng),
        commentary: tpl(rng, 'penalty_goal', { p: shortName(taker), min }),
        note: 'penalty',
      })
      if (attSide.side === 'home') homeScore++; else awayScore++
      scorers.push({ playerId: taker.id, teamId: attSide.team.id, minute: min, note: 'rigore' })
      ratings[taker.id] = clamp((ratings[taker.id] ?? 6) + 1.0, 1, 10)
    } else if (roll < 0.92) {
      // SAVED (paratona del portiere) — 17%
      attStats.shotsOnTarget++
      events.push({
        minute: min, second: sec, kind: 'save',
        side: defSide.side, playerId: gk?.id, secondaryPlayerId: taker.id,
        ballPosition: ballAt(defSide.side, { x: 0.05, y: 0.5 }, rng),
        commentary: tpl(rng, 'penalty_saved', { p: shortName(taker), p2: gk ? shortName(gk) : 'il portiere' }),
        note: 'penalty',
      })
      if (gk) ratings[gk.id] = clamp((ratings[gk.id] ?? 6) + 0.8, 1, 10)
      ratings[taker.id] = clamp((ratings[taker.id] ?? 6) - 0.3, 1, 10)
    } else {
      // MISSED — fuori dello specchio (8%) split in 5 esiti distinti:
      //   50%  alto    · 12.5% fuori-sinistra · 12.5% fuori-destra
      //   12.5% palo   · 12.5% traversa
      const sub = rng.next()
      let subNote: 'high' | 'wide_left' | 'wide_right' | 'post' | 'crossbar'
      let tplKey: 'penalty_high' | 'penalty_wide_left' | 'penalty_wide_right' | 'penalty_post' | 'penalty_crossbar'
      if      (sub < 0.50)  { subNote = 'high';       tplKey = 'penalty_high' }
      else if (sub < 0.625) { subNote = 'wide_left';  tplKey = 'penalty_wide_left' }
      else if (sub < 0.75)  { subNote = 'wide_right'; tplKey = 'penalty_wide_right' }
      else if (sub < 0.875) { subNote = 'post';       tplKey = 'penalty_post' }
      else                  { subNote = 'crossbar';   tplKey = 'penalty_crossbar' }
      events.push({
        minute: min, second: sec, kind: 'shot',
        side: attSide.side, playerId: taker.id,
        ballPosition: ballAt(attSide.side, { x: 0.99, y: 0.5 }, rng),
        commentary: tpl(rng, tplKey, { p: shortName(taker), min }),
        note: subNote,
      })
      ratings[taker.id] = clamp((ratings[taker.id] ?? 6) - 0.5, 1, 10)
    }
  }

  /**
   * Emette un cartellino giallo per il giocatore dato. Se è il SECONDO
   * giallo della partita, emette automaticamente anche il rosso.
   */
  function emitYellow(card: Player, defendingSide: TeamSide, min: number) {
    events.push({
      minute: min, second: rng.int(0, 59), kind: 'yellow_card',
      side: defendingSide.side, playerId: card.id,
      ballPosition: ballAt(defendingSide.side, ZONE_MID, rng),
      commentary: tpl(rng, 'yellow_card', { p: shortName(card) }),
    })
    if (defendingSide.side === 'home') stats.home.yellowCards++; else stats.away.yellowCards++
    ratings[card.id] = clamp((ratings[card.id] ?? 6) - 0.15, 1, 10)

    yellowCounts[card.id] = (yellowCounts[card.id] ?? 0) + 1
    if (yellowCounts[card.id] >= 2 && !sentOff.has(card.id)) {
      // Secondo giallo → espulsione (note: 'second_yellow' per fanta-bonus)
      sentOff.add(card.id)
      // Rimuove il giocatore dal pool in campo della propria squadra
      defendingSide.players = defendingSide.players.filter(p => p.id !== card.id)
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'red_card',
        side: defendingSide.side, playerId: card.id,
        ballPosition: ballAt(defendingSide.side, ZONE_MID, rng),
        commentary: tpl(rng, 'red_card_second_yellow', { p: shortName(card), t: defendingSide.team.name }),
        note: 'second_yellow',
      })
      if (defendingSide.side === 'home') stats.home.redCards++; else stats.away.redCards++
      ratings[card.id] = clamp((ratings[card.id] ?? 6) - 0.6, 1, 10)
      applyRedHandicap(defendingSide)
    }
  }

  /**
   * Espulsione DIRETTA (brutto fallo): la prob è bassissima — ~0.5%
   * dei falli (Serie A: ~0.13 dirette/match su ~25 falli/match).
   */
  function emitDirectRed(card: Player, defendingSide: TeamSide, min: number) {
    if (sentOff.has(card.id)) return
    sentOff.add(card.id)
    // Rimuove il giocatore dal pool in campo della propria squadra
    defendingSide.players = defendingSide.players.filter(p => p.id !== card.id)
    events.push({
      minute: min, second: rng.int(0, 59), kind: 'red_card',
      side: defendingSide.side, playerId: card.id,
      ballPosition: ballAt(defendingSide.side, ZONE_MID, rng),
      commentary: tpl(rng, 'red_card', { p: shortName(card) }),
      note: 'direct',
    })
    if (defendingSide.side === 'home') stats.home.redCards++; else stats.away.redCards++
    ratings[card.id] = clamp((ratings[card.id] ?? 6) - 0.8, 1, 10)
    applyRedHandicap(defendingSide)
  }

  /**
   * Sceglie un titolare da sostituire e una riserva ruolo-compatibile.
   * - outP: tra i NON-GK (a meno che il GK titolare non sia stato espulso)
   *         con rating più basso (così esce chi sta giocando peggio).
   * - inP:  dal bench, stesso gruppo (DEF/MID/ATT) di outP, miglior overall.
   *         Se non c'è ruolo-compatibile, prende il miglior overall residuo.
   * - GK:   se outP è il GK in campo (perché espulso), inP è scelto solo tra
   *         i GK del bench. Se non ci sono GK nel bench, salta la sub.
   */
  function trySubstitution(t: TeamSide, min: number) {
    if (t.subsUsed >= 5) return
    if (t.bench.length === 0) return

    const onPitch = t.players.filter(p => !sentOff.has(p.id))
    if (onPitch.length === 0) return

    // Candidato uscente: priorità a chi ha rating basso o è già stato sostituito (no)
    // Escludiamo GK in campo a meno che non sia già espulso (caso raro)
    const eligibleOut = onPitch.filter(p => p.position !== 'GK')
    let outP: Player | undefined
    let needsGk = false
    if (eligibleOut.length === 0) {
      // Solo GK in campo? Skip.
      return
    }
    // Sceglie out: il 30% delle volte rating più basso, altrimenti random
    if (rng.chance(0.3)) {
      outP = [...eligibleOut].sort((a, b) => (ratings[a.id] ?? 6) - (ratings[b.id] ?? 6))[0]
    } else {
      outP = eligibleOut[Math.floor(rng.next() * eligibleOut.length)]
    }
    if (!outP) return

    // Candidato entrante dal bench (stesso gruppo ruolo)
    const outGroup = role(outP)
    const benchByRole = t.bench.filter(p => role(p) === outGroup)
    const benchAny = t.bench.filter(p => p.position !== 'GK' || needsGk)
    let inP = benchByRole.length > 0
      ? [...benchByRole].sort((a, b) => calcOverall(b) - calcOverall(a))[0]
      : [...benchAny].sort((a, b) => calcOverall(b) - calcOverall(a))[0]
    if (!inP) return

    // Mutazione lineup in campo: out esce, in entra. Gli eventi successivi
    // pescano da t.players quindi outP non sarà più scelto automaticamente.
    t.bench = t.bench.filter(p => p.id !== inP!.id)
    t.players = [...t.players.filter(p => p.id !== outP!.id), inP]
    t.subsUsed++
    recomputeStrengths(t)

    events.push({
      minute: min, second: rng.int(0, 59), kind: 'substitution',
      side: t.side, playerId: outP.id, secondaryPlayerId: inP.id,
      ballPosition: ballAt(t.side, ZONE_MID, rng),
      commentary: tpl(rng, 'substitution', { p: shortName(outP), p2: shortName(inP) }),
    })
  }

  function tryMinorEvent(min: number) {
    // 30% prob filler, 25% fallo, 15% corner, 15% punizione, 10% giallo, 5% sub (solo dopo 60')
    const r = rng.next()
    const attackingSide = rng.chance(possHome / 100) ? homeSide : awaySide
    const defendingSide = attackingSide.side === 'home' ? awaySide : homeSide

    if (r < 0.30) {
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'pass',
        side: attackingSide.side,
        ballPosition: ballAt(attackingSide.side, ZONE_MID, rng),
        commentary: tpl(rng, 'filler', { t: attackingSide.team.name }),
      })
    } else if (r < 0.55) {
      // Fallo — ~7% probabilità che sia in area di rigore, ~0.5%
      // che sia brutto fallo da espulsione diretta (Serie A reale)
      const foulerPool = defendingSide.players.filter(p => !sentOff.has(p.id))
      if (foulerPool.length === 0) return
      const fouler = pickRoleWeighted(rng, foulerPool, ['DEF', 'MID'])
      const fouled = pickRoleWeighted(rng, attackingSide.players, ['ATT', 'MID'])
      if (defendingSide.side === 'home') stats.home.fouls++; else stats.away.fouls++
      ratings[fouler.id] = clamp((ratings[fouler.id] ?? 6) - 0.05, 1, 10)
      if (rng.chance(0.005)) {
        // ROSSO DIRETTO: emette PRIMA il fallo (così c'è contesto in cronaca),
        // poi il rosso. Senza rigore associato (non in area).
        events.push({
          minute: min, second: rng.int(0, 59), kind: 'foul',
          side: defendingSide.side, playerId: fouler.id, secondaryPlayerId: fouled.id,
          ballPosition: ballAt(defendingSide.side, ZONE_MID, rng),
          commentary: tpl(rng, 'foul', { p: shortName(fouler), p2: shortName(fouled) }),
        })
        emitDirectRed(fouler, defendingSide, min)
      } else if (rng.chance(0.07)) {
        // Rigore!
        tryPenalty(attackingSide, defendingSide, min, fouler, fouled)
      } else {
        events.push({
          minute: min, second: rng.int(0, 59), kind: 'foul',
          side: defendingSide.side, playerId: fouler.id, secondaryPlayerId: fouled.id,
          ballPosition: ballAt(defendingSide.side, ZONE_MID, rng),
          commentary: tpl(rng, 'foul', { p: shortName(fouler), p2: shortName(fouled) }),
        })
      }
    } else if (r < 0.70) {
      // Corner
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'corner',
        side: attackingSide.side,
        ballPosition: ballAt(attackingSide.side, { x: 0.95, y: rng.chance(0.5) ? 0.05 : 0.95 }, rng),
        commentary: tpl(rng, 'corner', { t: attackingSide.team.name }),
      })
      if (attackingSide.side === 'home') stats.home.corners++; else stats.away.corners++
    } else if (r < 0.85) {
      // Punizione
      events.push({
        minute: min, second: rng.int(0, 59), kind: 'free_kick',
        side: attackingSide.side,
        ballPosition: ballAt(attackingSide.side, ZONE_MID, rng),
        commentary: tpl(rng, 'free_kick', { t: attackingSide.team.name }),
      })
    } else if (r < 0.95) {
      // Cartellino giallo (esclude già espulsi); il secondo giallo
      // viene gestito da emitYellow() che emette anche il rosso.
      const pool = defendingSide.players.filter(p => !sentOff.has(p.id))
      const card = pickRoleWeighted(rng, pool.length ? pool : defendingSide.players, ['DEF', 'MID'])
      if (!sentOff.has(card.id)) emitYellow(card, defendingSide, min)
    }
    // NB: l'engine riceve solo gli 11 titolari (post-commit 81d6a98),
    // quindi non può più emettere eventi `substitution` coerenti — la
    // gestione delle sostituzioni live arriverà in Fase 2 (con accesso
    // al bench e regole ruolo-compatibili: GK↔GK, ecc.).
  }

  // Ciclo minuti 1..90
  const homeShotSet = new Set(homeShotMinutes)
  const awayShotSet = new Set(awayShotMinutes)

  for (let min = 1; min <= 90; min++) {
    emitMinute(min)
    if (homeShotSet.has(min)) tryShot(homeSide, awaySide, min)
    if (awayShotSet.has(min)) tryShot(awaySide, homeSide, min)
    // Eventi minori: ~50% prob ogni minuto in cui non c'è tiro
    if (!homeShotSet.has(min) && !awayShotSet.has(min) && rng.chance(0.55)) {
      tryMinorEvent(min)
    }
    // Sostituzioni: finestra 55'-88', ~7% chance per squadra per minuto
    // → ~2-3 sub a partita per team (max 5/team). Cresce dopo il 70'.
    if (min >= 55 && min <= 88) {
      const subProb = min >= 70 ? 0.10 : 0.06
      if (rng.chance(subProb)) trySubstitution(homeSide, min)
      if (rng.chance(subProb)) trySubstitution(awaySide, min)
    }
  }

  // Recupero (1-5 minuti, max 1 evento minore o tiro mancato)
  const stoppage = rng.int(1, 5)
  for (let s = 1; s <= stoppage; s++) {
    if (rng.chance(0.3)) tryMinorEvent(90 + s)
  }

  // Stats finali: passaggi e accuratezza casuali ragionevoli
  stats.home.passes = Math.round(300 + (possHome / 100) * 400 + rng.gauss(0, 30))
  stats.away.passes = Math.round(300 + ((100 - possHome) / 100) * 400 + rng.gauss(0, 30))
  stats.home.passAccuracy = clamp(Math.round(75 + (homeSide.strength - 70) * 0.4 + rng.gauss(0, 3)), 50, 95)
  stats.away.passAccuracy = clamp(Math.round(75 + (awaySide.strength - 70) * 0.4 + rng.gauss(0, 3)), 50, 95)

  // Full time
  events.push({
    minute: 90 + stoppage, second: 0, kind: 'full_time', side: null,
    ballPosition: { x: 0.5, y: 0.5 },
    commentary: tpl(rng, 'full_time'),
  })

  // Arrotonda ratings a 1 decimale
  for (const k of Object.keys(ratings)) {
    ratings[k] = Math.round(ratings[k] * 10) / 10
  }

  return {
    homeScore,
    awayScore,
    events,
    stats,
    ratings,
    scorers,
  }
}

/**
 * Re-export utility: dato un MatchResult, ritorna un generator-like
 * che itera gli eventi in ordine (per replay live).
 */
export function* replayEvents(result: MatchResult): Generator<MatchEvent> {
  for (const ev of result.events) yield ev
}
