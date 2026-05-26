/**
 * Config di betting per ogni competizione.
 *
 * I valori sono calibrati su statistiche reali (Opta/FBref) ma vanno ritoccati
 * con il fine-tuning man mano che il gestionale produce dati simulati di stagioni
 * intere. Vedi __tests__/odds.realism.test.ts per la validazione che mantiene
 * le quote nei range di mercato (1X2 tra 1.05 e 25.00).
 *
 * Aggiungere qui la config quando arrivano nuove competizioni.
 */

import type { LeagueBettingConfig } from './types'

// ============================================================
// COMPETIZIONI ESISTENTI NEL CODEBASE
// ============================================================

/**
 * "Lega Pro Stelle" = Serie A equivalent (tier 1).
 * Riferimento reale: Serie A 2022-23, 2.55 gol/match (1.42 casa, 1.12 trasferta).
 */
export const CONFIG_TIER1_LEAGUE: LeagueBettingConfig = {
  id: 'tier1_league',
  label: 'Lega Pro Stelle',
  avgGoalsHome: 1.45,
  avgGoalsAway: 1.15,
  homeAdvantage: 1.30,
  dixonColesRho: -0.18,
  htGoalShare: 0.42,
  marginFactor: 1.0,
  refReputation: 72,
}

/**
 * "Serie d'Argento" = Serie B equivalent (tier 2).
 * Riferimento reale: campionati cadetti -10% gol vs top tier, fattore casa +5%.
 */
export const CONFIG_TIER2_LEAGUE: LeagueBettingConfig = {
  id: 'tier2_league',
  label: "Serie d'Argento",
  avgGoalsHome: 1.32,
  avgGoalsAway: 1.05,
  homeAdvantage: 1.33,
  dixonColesRho: -0.16,
  htGoalShare: 0.42,
  marginFactor: 1.10,   // mercati meno liquidi → margine più alto
  refReputation: 45,
}

// ============================================================
// COMPETIZIONI FUTURE (V2 — quando l'altra chat le aggiungerà)
// Lasciate qui come stub calibrato. Riferimenti reali UEFA 2022-23.
// ============================================================

/**
 * Champions League (Stelle d'Europa equivalent).
 * Group stage: più gol, gap qualitativo minore tra top.
 * Knockout: tatticismo elevato, leggermente meno gol.
 * In V1 trattata come unica config; in V2 splittare per fase.
 */
export const CONFIG_CHAMPIONS_LEAGUE: LeagueBettingConfig = {
  id: 'champions_league',
  label: 'Stelle d\'Europa',
  avgGoalsHome: 1.55,
  avgGoalsAway: 1.35,
  homeAdvantage: 1.22,
  dixonColesRho: -0.17,
  htGoalShare: 0.40,
  marginFactor: 0.90,   // top competition, mercati molto larghi
  refReputation: 82,
}

/** Europa League. */
export const CONFIG_EUROPA_LEAGUE: LeagueBettingConfig = {
  id: 'europa_league',
  label: 'Coppa Continentale',
  avgGoalsHome: 1.50,
  avgGoalsAway: 1.30,
  homeAdvantage: 1.25,
  dixonColesRho: -0.17,
  htGoalShare: 0.41,
  marginFactor: 0.95,
  refReputation: 70,
}

/** Conference League — gap qualitativo maggiore, più gol "facili". */
export const CONFIG_CONFERENCE_LEAGUE: LeagueBettingConfig = {
  id: 'conference_league',
  label: 'Coppa delle Stelle Minori',
  avgGoalsHome: 1.65,
  avgGoalsAway: 1.45,
  homeAdvantage: 1.27,
  dixonColesRho: -0.15,
  htGoalShare: 0.42,
  marginFactor: 1.0,
  refReputation: 58,
}

/** Nazionali (V2+, qualificazioni e tornei). Più gol, meno fattore casa neutralizzato. */
export const CONFIG_NATIONAL_TEAMS: LeagueBettingConfig = {
  id: 'national_teams',
  label: 'Nazionali',
  avgGoalsHome: 1.55,
  avgGoalsAway: 1.20,
  homeAdvantage: 1.20,   // su campo neutro spesso
  dixonColesRho: -0.16,
  htGoalShare: 0.40,
  marginFactor: 0.95,
  refReputation: 75,
}

// ============================================================
// REGISTRO + LOOKUP
// ============================================================

export const ALL_LEAGUE_CONFIGS: LeagueBettingConfig[] = [
  CONFIG_TIER1_LEAGUE,
  CONFIG_TIER2_LEAGUE,
  CONFIG_CHAMPIONS_LEAGUE,
  CONFIG_EUROPA_LEAGUE,
  CONFIG_CONFERENCE_LEAGUE,
  CONFIG_NATIONAL_TEAMS,
]

/**
 * Lookup per ID lega. Se la lega non è registrata, ritorna la config di default (tier 1).
 * Il mapping da League ID del Career a config id può essere fatto dall'orchestratore
 * con una funzione `resolveLeagueConfig(career, leagueId)`.
 */
export function getLeagueBettingConfig(configId: string): LeagueBettingConfig {
  return ALL_LEAGUE_CONFIGS.find(c => c.id === configId) ?? CONFIG_TIER1_LEAGUE
}

/**
 * Resolver automatico per leghe del codebase corrente.
 * Mappa il tier della League ai config esistenti.
 * Quando l'altra chat aggiungerà Champions/EL/Conference, estendere questa funzione
 * con i nuovi mapping.
 */
export function resolveLeagueConfigByTier(tier: number, name?: string): LeagueBettingConfig {
  // Match per nome (più affidabile se aggiunte coppe europee)
  if (name) {
    const lower = name.toLowerCase()
    if (lower.includes('champion') || lower.includes('stelle d\'europa')) return CONFIG_CHAMPIONS_LEAGUE
    if (lower.includes('europa') || lower.includes('continental')) return CONFIG_EUROPA_LEAGUE
    if (lower.includes('conference') || lower.includes('stelle minori')) return CONFIG_CONFERENCE_LEAGUE
    if (lower.includes('nazional')) return CONFIG_NATIONAL_TEAMS
  }
  // Fallback per tier
  if (tier === 1) return CONFIG_TIER1_LEAGUE
  if (tier === 2) return CONFIG_TIER2_LEAGUE
  return CONFIG_TIER1_LEAGUE
}
