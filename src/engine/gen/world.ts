/**
 * World generator: crea mondo iniziale di una nuova carriera.
 *  - 2 leghe (Serie A + Serie B) da 20 squadre ciascuna
 *  - ~25 giocatori per squadra (3 GK + 8 DEF + 8 MID + 6 ATT)
 *  - Stadi unici per squadra
 *  - Tier squadra (top/mid/low) calibrato per realismo
 *
 * Output: mondo come dizionari di entità, pronto per essere messo dentro Career.
 */

import type {
  EntityId, Team, Player, Stadium, League, Position
} from '$engine/types'
import type { Rng } from './rng'
import { generateId } from './rng'
import { randomTeamName, randomTeamColors, randomStadiumName, randomCity } from './names'
import { generatePlayer, type TeamTier } from './player'

export interface GeneratedWorld {
  teams: Record<EntityId, Team>
  players: Record<EntityId, Player>
  stadiums: Record<EntityId, Stadium>
  leagues: Record<EntityId, League>
}

interface LeagueSpec {
  name: string
  tier: 1 | 2
  teamsCount: number
  /** Distribuzione tier squadre: top/mid/low (somma = teamsCount) */
  tierMix: { top: number; mid: number; low: number }
  /** Range capacità stadio */
  stadiumCap: [number, number]
  /** Range budget club */
  balance: [number, number]
  /** Range reputazione squadra */
  reputation: [number, number]
}

const LEAGUE_SPECS: LeagueSpec[] = [
  {
    name: 'Lega Pro Stelle',
    tier: 1,
    teamsCount: 20,
    tierMix: { top: 6, mid: 10, low: 4 },
    stadiumCap: [25_000, 75_000],
    balance: [10_000_000, 200_000_000],
    reputation: [55, 90],
  },
  {
    name: 'Serie d\'Argento',
    tier: 2,
    teamsCount: 20,
    tierMix: { top: 3, mid: 11, low: 6 },
    stadiumCap: [8_000, 30_000],
    balance: [2_000_000, 30_000_000],
    reputation: [30, 60],
  },
]

/** Quante "righe" di giocatori per ruolo (~25 totali) */
const SQUAD_TEMPLATE: { position: Position; count: number }[] = [
  { position: 'GK', count: 3 },
  // Difensori (8)
  { position: 'CB', count: 4 },
  { position: 'LB', count: 2 },
  { position: 'RB', count: 2 },
  // Centrocampisti (8)
  { position: 'DM', count: 2 },
  { position: 'CM', count: 3 },
  { position: 'AM', count: 1 },
  { position: 'LM', count: 1 },
  { position: 'RM', count: 1 },
  // Attaccanti (6)
  { position: 'LW', count: 1 },
  { position: 'RW', count: 1 },
  { position: 'CF', count: 1 },
  { position: 'ST', count: 3 },
]

function generateStadium(rng: Rng, city: string, cap: [number, number]): Stadium {
  return {
    id: generateId(rng),
    name: randomStadiumName(rng, city),
    capacity: rng.int(cap[0], cap[1]),
    pitchQuality: rng.int(60, 95),
  }
}

function generateTeam(
  rng: Rng,
  spec: LeagueSpec,
  tier: TeamTier
): { team: Team; stadium: Stadium } {
  const tn = randomTeamName(rng)
  const colors = randomTeamColors(rng)
  const stadium = generateStadium(rng, tn.city, spec.stadiumCap)
  // Reputazione modulata da tier
  const baseRep = rng.int(spec.reputation[0], spec.reputation[1])
  const repBoost = tier === 'top' ? 8 : tier === 'mid' ? 0 : -8
  const reputation = Math.max(1, Math.min(100, baseRep + repBoost))
  // Bilancio modulato da tier
  const baseBal = rng.int(spec.balance[0], spec.balance[1])
  const balMul = tier === 'top' ? 1.8 : tier === 'mid' ? 1.0 : 0.45
  const balance = Math.round(baseBal * balMul)

  const team: Team = {
    id: generateId(rng),
    name: tn.name,
    shortName: tn.shortName,
    city: tn.city,
    country: 'IT',
    founded: rng.int(1898, 1985),
    primaryColor: colors.primary,
    secondaryColor: colors.secondary,
    stadiumId: stadium.id,
    reputation,
    balance,
  }
  return { team, stadium }
}

function generateSquad(
  rng: Rng,
  teamId: EntityId,
  tier: TeamTier,
  seasonYear: number
): Player[] {
  const squad: Player[] = []
  let shirt = 1
  for (const slot of SQUAD_TEMPLATE) {
    for (let i = 0; i < slot.count; i++) {
      const p = generatePlayer(rng, {
        position: slot.position,
        tier,
        teamId,
        seasonYear,
        shirtNumber: shirt++,
      })
      squad.push(p)
    }
  }
  return squad
}

/** Genera una città unica, ritentando fino a maxRetry per evitare duplicati */
function uniqueCity(rng: Rng, used: Set<string>, maxRetry = 25): string {
  for (let i = 0; i < maxRetry; i++) {
    const c = randomCity(rng)
    if (!used.has(c)) {
      used.add(c)
      return c
    }
  }
  // Fallback: aggiungi suffisso numerico
  const c = `${randomCity(rng)} ${rng.int(2, 99)}`
  used.add(c)
  return c
}

export interface CreateWorldOptions {
  seasonYear: number
}

export function createWorld(rng: Rng, opts: CreateWorldOptions): GeneratedWorld {
  const teams: Record<EntityId, Team> = {}
  const players: Record<EntityId, Player> = {}
  const stadiums: Record<EntityId, Stadium> = {}
  const leagues: Record<EntityId, League> = {}
  const usedCities = new Set<string>()

  for (const spec of LEAGUE_SPECS) {
    const leagueId = generateId(rng)
    const teamIds: EntityId[] = []

    // Espande il mix in array di tier (es. ['top','top',...,'mid',...])
    const tierPool: TeamTier[] = []
    for (let i = 0; i < spec.tierMix.top; i++) tierPool.push('top')
    for (let i = 0; i < spec.tierMix.mid; i++) tierPool.push('mid')
    for (let i = 0; i < spec.tierMix.low; i++) tierPool.push('low')
    rng.shuffle(tierPool)

    for (let i = 0; i < spec.teamsCount; i++) {
      const tier = tierPool[i] ?? 'mid'
      const city = uniqueCity(rng, usedCities)
      // Sostituisci la generazione città nel team con quella unica:
      const { team, stadium } = generateTeam(rng, spec, tier)
      // Forza la città unica
      team.city = city
      team.shortName = city.replace(/[^A-Za-zàèéìòù]/g, '').slice(0, 3).toUpperCase()
      // Rigenera nome basato sulla città unica
      const tn = randomTeamName(rng, city)
      team.name = tn.name

      teams[team.id] = team
      stadiums[stadium.id] = stadium
      teamIds.push(team.id)

      // Squadra
      const squad = generateSquad(rng, team.id, tier, opts.seasonYear)
      for (const p of squad) players[p.id] = p
    }

    leagues[leagueId] = {
      id: leagueId,
      name: spec.name,
      country: 'IT',
      tier: spec.tier,
      teamIds,
    }
  }

  return { teams, players, stadiums, leagues }
}
