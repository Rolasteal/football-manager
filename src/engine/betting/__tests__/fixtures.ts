/**
 * Fixtures riusabili per i test del modulo betting.
 * Costruiscono Player/Team di esempio per i 3 scenari canonici:
 *  - Top match: Inter (top) vs Juve (top)
 *  - Sbilanciato: Inter (top) vs Empoli (low)
 *  - Underdog: Salernitana (low) vs Spal (low)
 */

import type { Player, Team, Position, PlayerAttributes } from '$engine/types'

let _counter = 0
function nid(prefix = 'id'): string {
  _counter += 1
  return `${prefix}_${_counter}`
}

export function makeAttributes(overall: number): PlayerAttributes {
  // Genera attributi mediamente attorno a overall/5 (scala 1-20)
  const base = Math.max(1, Math.min(20, overall / 5))
  const j = () => Math.max(1, Math.min(20, base + (Math.random() - 0.5) * 2))
  return {
    passing: j(), shooting: j(), dribbling: j(), finishing: j(),
    crossing: j(), tackling: j(), heading: j(),
    pace: j(), stamina: j(), strength: j(),
    vision: j(), composure: j(), workRate: j(),
    reflexes: j(), handling: j(),
  }
}

export function makePlayer(opts: {
  position: Position
  overall: number
  teamId: string
  fitness?: number
  morale?: number
  shirtNumber?: number
  lastName?: string
}): Player {
  return {
    id: nid('p'),
    firstName: 'Test',
    lastName: opts.lastName ?? `Player_${opts.position}`,
    nationality: 'IT',
    birthDate: '2000-01-01',
    position: opts.position,
    secondaryPositions: [],
    foot: 'right',
    attributes: makeAttributes(opts.overall),
    marketValue: 1_000_000,
    morale: opts.morale ?? 70,
    fitness: opts.fitness ?? 85,
    teamId: opts.teamId,
    shirtNumber: opts.shirtNumber ?? null,
  }
}

export function makeTeam(opts: {
  name: string
  reputation: number
  balance: number
  shortName?: string
}): Team {
  return {
    id: nid('t'),
    name: opts.name,
    shortName: opts.shortName ?? opts.name.slice(0, 3).toUpperCase(),
    city: 'Test City',
    country: 'IT',
    founded: 1900,
    primaryColor: '#000',
    secondaryColor: '#fff',
    stadiumId: 'stadium_test',
    reputation: opts.reputation,
    balance: opts.balance,
  }
}

/**
 * Genera una rosa standard di 11 titolari con overall medio specificato.
 */
export function makeStartingXI(teamId: string, avgOverall: number): Player[] {
  // 4-3-3 standard
  const slots: { pos: Position; offset: number; shirt: number }[] = [
    { pos: 'GK', offset: 0, shirt: 1 },
    { pos: 'LB', offset: -2, shirt: 3 },
    { pos: 'CB', offset: -3, shirt: 4 },
    { pos: 'CB', offset: -1, shirt: 5 },
    { pos: 'RB', offset: -2, shirt: 2 },
    { pos: 'DM', offset: 0, shirt: 6 },
    { pos: 'CM', offset: 1, shirt: 8 },
    { pos: 'CM', offset: 0, shirt: 10 },
    { pos: 'LW', offset: 2, shirt: 7 },
    { pos: 'ST', offset: 3, shirt: 9 },
    { pos: 'RW', offset: 2, shirt: 11 },
  ]
  return slots.map(s => makePlayer({
    position: s.pos,
    overall: avgOverall + s.offset,
    teamId,
    shirtNumber: s.shirt,
  }))
}

/**
 * Scenario top match: Inter (avg 82) vs Juve (avg 80).
 */
export function topMatchScenario() {
  const home = makeTeam({ name: 'Inter Test', reputation: 88, balance: 200_000_000 })
  const away = makeTeam({ name: 'Juve Test', reputation: 86, balance: 180_000_000 })
  return {
    home, away,
    homeXI: makeStartingXI(home.id, 82),
    awayXI: makeStartingXI(away.id, 80),
  }
}

/**
 * Scenario sbilanciato: Inter (avg 82) vs Empoli (avg 68).
 */
export function unbalancedMatchScenario() {
  const home = makeTeam({ name: 'Inter Test', reputation: 88, balance: 200_000_000 })
  const away = makeTeam({ name: 'Empoli Test', reputation: 50, balance: 25_000_000 })
  return {
    home, away,
    homeXI: makeStartingXI(home.id, 82),
    awayXI: makeStartingXI(away.id, 68),
  }
}

/**
 * Scenario underdog: due squadre piccole.
 */
export function smallMatchScenario() {
  const home = makeTeam({ name: 'Salernitana Test', reputation: 42, balance: 8_000_000 })
  const away = makeTeam({ name: 'Spal Test', reputation: 38, balance: 6_000_000 })
  return {
    home, away,
    homeXI: makeStartingXI(home.id, 64),
    awayXI: makeStartingXI(away.id, 62),
  }
}
