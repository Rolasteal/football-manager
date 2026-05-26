# BETTING_SPEC.md — Sistema Scommesse Sportive

> **Versione:** 1.0.1 — 2026-05-26
> **Owner:** Roberto Ramazio
> **Scope:** Modulo sportsbook (stile Bet365) integrato nel gestionale Football Manager (Svelte 5 + TS + IndexedDB)
> **Audience:** chat che sta sviluppando il gioco — questo è il contratto autoritativo

> ### 🚧 Direzione futura: multiplayer-ready
> Il gioco potrà supportare in futuro più manager sulla stessa lega (offline collegati o online).
> L'architettura V1 è **già preparata**: ogni `Career` ha il proprio `BettingCareerData` privato (wallet, bollette, stats),
> mentre i `MatchOddsBoard` sono "pubblici per lega" (quote uguali per tutti i manager della stessa lega → seed-deterministico via `seed.ts`).
> Per il multiplayer V2 servirà aggiungere un layer di sincronizzazione `LeagueBettingShared` con i board condivisi,
> ma **nessuna API V1 dovrà rompersi**. Vedi sez. 15.3.

> ### ⚖️ Regola di integrità sportiva
> **Vietato scommettere su partite della propria squadra.** Replica le regole UEFA/FIFA reali.
> Implementato hard nell'orchestratore (`placeBet` rifiuta) e morbido in UI (selezioni disabilitate + tooltip).
> Helper esportato: `isOwnTeamFixture(career, fixtureId)`. Vedi sez. 9.4.

---

## 0. TL;DR

Un modulo `src/engine/betting/` che, dato il `Career` del gestionale:

1. Genera **quote AI** realistiche per ogni partita programmata (~25-30 mercati a partita) usando un modello **Poisson bivariato (Dixon-Coles)** alimentato dai rating dei giocatori, forma, morale, fattore casa.
2. Espone uno **sportsbook UI** in stile Bet365 (Home → Match Detail → BetSlip → My Bets) coerente col design system gold+onyx.
3. Supporta **live betting** sfruttando il replay minuto-per-minuto del match engine come event stream: quote si aggiornano dopo gol/espulsioni/minuto, mercati si sospendono per 8s su eventi critici.
4. Gestisce **bolletta singola, multipla, sistema** con bonus multipla, **cash out** e **quote boost**.
5. Attinge dal **`Team.balance` del club** del manager (modalità autorizzata dal product owner), con safeguard anti-overdraft e narrative di "scandalo scommesse" se si esagera.
6. Risolve automaticamente le bollette al **full_time** con settlement engine che gestisce tutti i casi (push, half-loss handicap asiatico, void).
7. Persiste tutto in IndexedDB nel save corrente — zero backend.

**Effort stimato:** ~6-8 giorni di sviluppo full-time per V1 completo. MVP funzionante in 3 giorni.

---

## 1. Architettura

### 1.1 Struttura cartelle (rispetta convenzioni esistenti)

```
src/
├── engine/
│   └── betting/
│       ├── types.ts                  # Interfacce pubbliche
│       ├── oddsEngine.ts             # Modello probabilistico (Dixon-Coles)
│       ├── marketsGenerator.ts       # Genera tutti i mercati per fixture
│       ├── overround.ts              # Applica margine bookmaker
│       ├── liveOddsUpdater.ts        # Ricalcolo quote live durante replay
│       ├── betSlip.ts                # Logica schedina (single/multi/sistema)
│       ├── settlement.ts             # Risolve bollette a fine partita
│       ├── bankroll.ts               # Hook col club balance + safeguard
│       ├── cashout.ts                # Calcola valore cash out
│       └── seed.ts                   # RNG seeded per coerenza save
│
├── state/
│   └── betting.svelte.ts             # Store Svelte 5 ($state runes)
│
├── lib/
│   └── betting/
│       ├── SportsbookShell.svelte    # Layout (header + tabs + betslip drawer)
│       ├── MatchCard.svelte          # Card partita con quote 1X2 in evidenza
│       ├── MarketGroup.svelte        # Gruppo mercati espandibile
│       ├── OddsButton.svelte         # Pulsante quota animato
│       ├── BetSlip.svelte            # Schedina sticky
│       ├── BetSlipRow.svelte         # Riga selezione
│       ├── MyBetsList.svelte         # Lista bollette
│       ├── BetReceipt.svelte         # Ricevuta post-piazzamento
│       ├── LiveBadge.svelte          # Badge "LIVE" pulsante
│       └── CashOutButton.svelte      # Pulsante cash out animato
│
├── routes/
│   ├── Betting.svelte                # /betting — home
│   ├── BettingMatch.svelte           # /betting/match/:id
│   ├── BettingMyBets.svelte          # /betting/my-bets
│   └── BettingStats.svelte           # /betting/stats
│
└── storage/
    └── db.ts                         # (estendere con stores betting)
```

### 1.2 Flusso dati

```
┌──────────────┐    fixture     ┌─────────────────┐
│   Career     │───────────────▶│  oddsEngine     │
│  (teams,     │                │  (Dixon-Coles)  │
│  players,    │                └────────┬────────┘
│  fixtures)   │                         │ probMatrix
└──────────────┘                         ▼
                                ┌─────────────────┐
                                │ marketsGenerator│  ◀── overround.ts
                                └────────┬────────┘
                                         │ Market[]
                                         ▼
                                ┌─────────────────┐
                                │ bettingStore    │  (Svelte 5 $state)
                                │ - markets       │
                                │ - openBets      │
                                │ - settledBets   │
                                │ - bankroll      │
                                └────────┬────────┘
                                         │
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                    SportsbookUI    liveOddsUpdater  settlement
                                    (durante replay) (a full_time)
```

### 1.3 Cicli di vita

| Momento gestionale | Azione betting |
|---|---|
| Nuovo savegame creato | Genera quote per tutta la prima giornata |
| Avanza giornata | Settle bollette aperte della giornata precedente + genera quote per la prossima |
| Inizio replay match | Quote pre-match diventano "live", primo aggiornamento al minuto 0 |
| Evento durante replay (gol, espulsione, ecc.) | Ricalcolo quote, sospensione 8s mercati impattati |
| Full time replay | Settle automatico bollette di quella partita |
| Cambio di stagione | Reset statistiche scommesse stagionali (mantieni history) |

---

## 2. Modello dati TypeScript (interfacce pubbliche)

Tutte le interfacce vivono in `src/engine/betting/types.ts`.

```typescript
import type { EntityId } from "$engine/types";

// ============================================================
// 2.1 — MERCATI E SELEZIONI
// ============================================================

export type MarketCategory =
  | "main"           // 1X2, U/O 2.5, GG/NG, Doppia Chance
  | "goals"          // Tutti gli U/O, GG/NG variabili
  | "handicap"       // Europeo + Asiatico
  | "scorers"        // Marcatori
  | "exact"          // Risultato esatto
  | "halves"         // Primo/Secondo tempo
  | "combo"          // 1X2 + GG, 1X2 + U/O
  | "specials";      // Cartellini, corner, primo gol

export type MarketKind =
  // Main
  | "1X2"
  | "double_chance"
  | "draw_no_bet"
  // Goals
  | "over_under"           // line: 0.5 / 1.5 / 2.5 / 3.5 / 4.5 / 5.5
  | "btts"                 // both teams to score (GG/NG)
  | "team_over_under"      // line per squadra: home_over_1.5 ecc.
  | "total_goals_bands"    // 0-1 / 2-3 / 4-6 / 7+
  // Handicap
  | "asian_handicap"       // line: -2 / -1.5 / -1 / -0.5 / 0 / +0.5 ...
  | "european_handicap"    // -1 / -2 / +1 / +2 (3 esiti: 1 X 2 con handicap)
  // Scorers
  | "anytime_scorer"
  | "first_scorer"
  | "last_scorer"
  | "scorer_2plus"
  | "scorer_hattrick"
  | "no_goalscorer"
  // Exact
  | "correct_score"
  | "halftime_correct_score"
  // Halves
  | "halftime_1X2"
  | "halftime_fulltime"          // 9 combinazioni
  | "halftime_over_under"        // line 0.5 / 1.5
  | "halftime_btts"
  | "half_with_most_goals"       // 1H / 2H / pari
  // Combo
  | "1X2_and_btts"               // 6 combinazioni (1+GG, 1+NG, X+GG, ...)
  | "1X2_and_over_under"         // line 2.5 default
  | "btts_and_over_under"        // line 2.5
  // Specials
  | "total_cards_over_under"     // line 3.5 / 4.5 / 5.5
  | "total_corners_over_under"   // line 8.5 / 9.5 / 10.5
  | "first_goal_team"            // 1 / 2 / no goal
  | "first_card_team"
  | "red_card_match"             // yes/no
  | "penalty_awarded";           // yes/no

export interface Selection {
  id: string;                    // unique within market
  label: string;                 // "Casa", "Over 2.5", "Lautaro Martinez", ecc.
  probability: number;           // 0..1 — probabilità "vera" calcolata
  odds: number;                  // quota con margine applicato (decimal, 1.01+)
  // optional metadata per settlement
  meta?: {
    side?: "home" | "away";
    line?: number;               // handicap / over-under line
    score?: { home: number; away: number };
    playerId?: EntityId;
    htScore?: { home: number; away: number };
    ftResult?: "1" | "X" | "2";
  };
}

export interface Market {
  id: string;                    // "fixture-123:over_under:2.5"
  fixtureId: EntityId;
  kind: MarketKind;
  category: MarketCategory;
  label: string;                 // "Over/Under 2.5"
  selections: Selection[];
  status: "open" | "suspended" | "closed" | "settled";
  isLive: boolean;
  margin: number;                // overround applicato (es. 0.06 = 6%)
  updatedAt: number;             // timestamp ms
  // optional: cosa è cambiato all'ultimo aggiornamento (per animazioni UI)
  lastDelta?: Record<string, number>;  // selectionId -> delta quota
}

export interface MatchOddsBoard {
  fixtureId: EntityId;
  matchday: number;
  homeId: EntityId;
  awayId: EntityId;
  kickoff: string;               // ISO
  markets: Market[];
  generatedAt: number;
  state: "pre_match" | "live" | "ht" | "settled" | "void";
  liveMinute?: number;
  liveScore?: { home: number; away: number };
}

// ============================================================
// 2.2 — SCHEDINA E BOLLETTE
// ============================================================

export type BetSlipMode = "single" | "multiple" | "system";

export interface BetSelection {
  fixtureId: EntityId;
  marketId: string;
  selectionId: string;
  // snapshot al momento dell'aggiunta (quota può cambiare poi → conferma utente)
  snapshotOdds: number;
  snapshotLabel: string;         // "Inter vs Milan — Over 2.5"
  isLive: boolean;
  addedAt: number;
}

export interface BetSlipDraft {
  mode: BetSlipMode;
  selections: BetSelection[];
  stake: number;                 // singola → uguale per ogni; multipla → totale; sistema → unitaria per combinazione
  systemSize?: number;           // per sistema: k in C(n,k); es. n=5 k=3
  acceptOddsChange: "always" | "higher_only" | "never";
}

export interface PlacedBet {
  id: string;                    // uuid
  careerId: EntityId;
  matchday: number;
  placedAt: number;
  mode: BetSlipMode;
  selections: PlacedSelection[];
  systemSize?: number;
  stake: number;                 // totale debittato
  combinedOdds: number;          // quota finale (singola/multipla) o media ponderata (sistema)
  potentialWin: number;          // max vincita teorica
  status: "open" | "won" | "lost" | "void" | "half_won" | "half_lost" | "cashed_out";
  settlementAt?: number;
  actualPayout?: number;
  cashOutValue?: number;         // se utente fa cash out
  cashOutAt?: number;
}

export interface PlacedSelection {
  fixtureId: EntityId;
  marketId: string;
  marketKind: MarketKind;
  selectionId: string;
  selectionLabel: string;        // "Over 2.5"
  selectionMeta?: Selection["meta"];
  oddsAtPlacement: number;
  isLive: boolean;
  status: "pending" | "won" | "lost" | "void" | "half_won" | "half_lost";
}

// ============================================================
// 2.3 — BANKROLL E STATS
// ============================================================

export interface BettingWallet {
  // Punta al Team.balance del club (debit/credit atomici)
  clubId: EntityId;
  // Limiti opzionali impostati dall'utente
  caps: {
    maxStakePerBet?: number;
    maxStakePerMatchday?: number;
    maxLossPerMatchday?: number;
    cooldownAfterLossStreak?: number;  // bets di stop dopo N perdite consecutive
  };
  // Tracking giornaliero
  matchdayState: {
    matchday: number;
    totalStaked: number;
    totalReturned: number;
    netProfit: number;
    lossStreak: number;
  };
}

export interface BettingStats {
  totalBets: number;
  wonBets: number;
  lostBets: number;
  voidBets: number;
  totalStaked: number;
  totalReturned: number;
  netProfit: number;
  roi: number;                   // (return - stake) / stake
  yield: number;                 // netProfit / totalStaked
  longestWinStreak: number;
  longestLossStreak: number;
  biggestWin: number;
  favouriteMarket: MarketKind | null;
  // per stagione
  bySeason: Record<number, Omit<BettingStats, "bySeason">>;
}

// ============================================================
// 2.4 — STATO PERSISTENTE
// ============================================================

export interface BettingCareerData {
  wallet: BettingWallet;
  oddsBoards: Record<EntityId, MatchOddsBoard>;  // fixtureId → board
  openBets: PlacedBet[];
  settledBets: PlacedBet[];                      // capped a 500 più recenti, archivia il resto
  stats: BettingStats;
  // promozioni attive (quote boost del giorno, ecc.)
  promotions: Promotion[];
  // scandali / eventi narrativi triggered
  narrativeFlags: {
    debtIncidentTriggered: boolean;
    bigWinIncidentTriggered: boolean;
  };
}

export interface Promotion {
  id: string;
  type: "odds_boost" | "free_bet" | "accumulator_bonus";
  fixtureId?: EntityId;
  marketKind?: MarketKind;
  selectionId?: string;
  multiplier?: number;           // odds_boost: es. 1.25 → quota × 1.25
  freeBetAmount?: number;
  minSelections?: number;        // accumulator_bonus: minimo selezioni
  bonusPercent?: number;         // accumulator_bonus: es. 5%
  validUntil: string;            // ISO
}
```

---

## 3. Modello probabilistico ("AI" odds engine)

L'engine è in `src/engine/betting/oddsEngine.ts`. Calcola **probabilità vere** dei mercati. Il margine bookmaker si applica DOPO in `overround.ts`.

### 3.1 Input — `TeamStrengthInput`

Estratto da `Career` per ogni fixture:

```typescript
interface TeamStrengthInput {
  // base
  attackingStrength: number;     // 0.5 .. 2.0 (1.0 = media lega)
  defensiveStrength: number;     // 0.5 .. 2.0 (1.0 = media lega; ALTO = subisce molti gol)
  homeAdvantage: number;         // default 1.30 (1.0 = neutro)

  // modulazione
  formIndex: number;             // -0.3 .. +0.3 (ultime 5 partite)
  fitnessAvg: number;            // 0..100 → applica fattore (fitness-50)/100
  moraleAvg: number;             // 0..100 → fattore (morale-50)/100 × 0.15

  // contesto
  injuredKeyPlayers: number;     // count titolari mancanti (>75 overall)
  suspendedPlayers: number;
  isDerby: boolean;
  motivationFactor: number;      // -0.10 .. +0.10 (lotta salvezza, scudetto)
  fatigueFactor: number;         // 0..0.15 (giorni dall'ultima partita)
}
```

### 3.2 Calcolo expected goals (xG attesi)

Per ogni fixture si calcolano due **lambda** (gol attesi):

```
λ_home = LEAGUE_AVG_GOALS_HOME * attack_home * defense_away * home_adv * mod_home
λ_away = LEAGUE_AVG_GOALS_AWAY * attack_away * defense_home * mod_away
```

Dove:

```
LEAGUE_AVG_GOALS_HOME = 1.45   // Serie A reale ~1.42
LEAGUE_AVG_GOALS_AWAY = 1.15   // Serie A reale ~1.12

mod = 1
    + form_index                                  // -0.3 .. +0.3
    + (fitness_avg - 50) / 200                    // ±0.25
    + (morale_avg - 50) / 333                     // ±0.15
    - injured_key_players × 0.06                  // ogni big out = -6%
    - suspended_players × 0.04
    + motivation_factor                           // ±0.10
    - fatigue_factor                              // 0..0.15

mod = clamp(mod, 0.50, 1.70)
```

**attack_home / defense_away** si derivano dal rating dei giocatori in formazione tipo:

```
attack_team = avg(overall_attaccanti_e_trequartisti) / 70
defense_team = avg(overall_difensori_e_portiere) / 70

// Inversione semantica: defense_team ALTO = difesa forte = subisce pochi gol
// nella formula λ uso (1 / defense_away) per simmetria con attack
```

Riformulazione corretta:

```
attack_home = avg_attacking_overall_home / LEAGUE_AVG_ATTACK_OVERALL
defense_away = avg_defending_overall_away / LEAGUE_AVG_DEFENSE_OVERALL
λ_home = BASE_HOME × attack_home × (1 / defense_away) × home_adv × mod_home
```

`LEAGUE_AVG_ATTACK_OVERALL` e `LEAGUE_AVG_DEFENSE_OVERALL` si calcolano una volta a inizio stagione su tutti i giocatori dei team della lega.

### 3.3 Distribuzione gol — Dixon-Coles

Calcolo la matrice `P(home_goals = i, away_goals = j)` per `i, j ∈ {0..7}` (8×8 = 64 celle).

**Poisson base:**

```
P(X = k | λ) = (λ^k × e^(-λ)) / k!
P(home=i, away=j) = P(i | λ_home) × P(j | λ_away)
```

**Correzione Dixon-Coles** per i risultati a basso punteggio (0-0, 1-0, 0-1, 1-1) — la Poisson sottostima X e sovrastima 0-0:

```
τ(i, j, λ_h, λ_a) =
  (1 - λ_h × λ_a × ρ)     se i=0, j=0
  (1 + λ_h × ρ)            se i=0, j=1
  (1 + λ_a × ρ)            se i=1, j=0
  (1 - ρ)                  se i=1, j=1
  1                        altrimenti

ρ = -0.18   // valore empirico Serie A; in [-0.20, -0.15]

P_corrected(i, j) = P_poisson(i, j) × τ(i, j, λ_h, λ_a)
```

Normalizzare la matrice dopo la correzione (somma celle = 1).

### 3.4 Da matrice → tutti i mercati

Una volta calcolata `M[i][j]` con i,j ∈ [0..7], **ogni mercato gol-based** è una somma di celle:

```typescript
// 1X2
P_home = Σ M[i][j] for i > j
P_draw = Σ M[i][j] for i = j
P_away = Σ M[i][j] for i < j

// Over/Under k.5
P_over_k = Σ M[i][j] for i+j > k
P_under_k = 1 - P_over_k

// BTTS
P_btts_yes = Σ M[i][j] for i > 0 and j > 0
P_btts_no = 1 - P_btts_yes

// Correct Score
P_score(h, a) = M[h][a]
// per i risultati >7 raggruppa in "Altro casa" / "Altro pareggio" / "Altro trasferta"

// Doppia chance
P_1X = P_home + P_draw
P_12 = P_home + P_away
P_X2 = P_draw + P_away

// Draw No Bet (DNB): scommessa torna se X, altrimenti normale 1 o 2
// quota DNB_1 = 1 / (P_home / (1 - P_draw))

// Handicap Europeo -1 sul casa: casa deve vincere con 2+ gol scarto
P_home_h(-1) = Σ M[i][j] for i - j > 1
P_draw_h(-1) = Σ M[i][j] for i - j = 1
P_away_h(-1) = Σ M[i][j] for i - j < 1

// Handicap Asiatico (single line, no draw)
// AH -0.5: casa vince → win, X o casa perde → loss
// AH -1.0: casa vince con 2+ → win, casa vince 1-0 → push, X o casa perde → loss
// AH -1.5: casa vince con 2+ → win, altro → loss
// AH split (es. -0.75 = -0.5 e -1.0 metà stake ciascuno) → si calcolano separatamente
P_AH_home(-0.5) = Σ M[i][j] for i > j   // = P_home
P_AH_home(-1.0)_win = Σ M[i][j] for i - j >= 2
P_AH_home(-1.0)_push = Σ M[i][j] for i - j = 1
P_AH_home(-1.0)_loss = Σ M[i][j] for i - j <= 0

// Total Goals Bands
P_0_1 = M[0][0] + M[0][1] + M[1][0]
P_2_3 = Σ M[i][j] for i+j in {2,3}
P_4_6 = Σ M[i][j] for i+j in {4,5,6}
P_7plus = Σ M[i][j] for i+j >= 7
```

### 3.5 Probabilità marcatori (modello shots × conversion)

Per ogni giocatore in formazione (escluso portiere):

```typescript
// 1. Tiri attesi dal giocatore in partita
shotsExpected(p) =
  team_shots_expected(p.teamId) × shareOfShots(p)

team_shots_expected(team) = 12 + (lambda_team - 1.3) × 3
// es. λ=1.5 → 12.6 tiri; λ=2.5 → 15.6 tiri

shareOfShots(p):
  // 60% dei tiri ai ruoli attaccanti, 30% trequartisti/esterni, 10% centrocampisti, 0% difesa
  base_share = ROLE_SHARE[p.position]
  weight = base_share × (p.attributes.shooting / 14) × (p.attributes.composure / 14)
  return weight / sum(weights_of_team)

// ROLE_SHARE
const ROLE_SHARE = {
  ST: 0.30, CF: 0.30,
  LW: 0.15, RW: 0.15, AM: 0.18,
  LM: 0.10, RM: 0.10, CM: 0.06, DM: 0.03,
  WB: 0.04, LB: 0.02, RB: 0.02, CB: 0.02,
  GK: 0
};

// 2. Conversion rate del giocatore
conversionRate(p) =
  BASE_CONVERSION × (p.attributes.finishing / 14) × (p.attributes.composure / 14)

BASE_CONVERSION = 0.105   // ~10% serie A

// fitness e morale modulano
conversionRate(p) *= (0.7 + 0.6 × fitness/100)   // 0.7..1.3
conversionRate(p) *= (0.85 + 0.30 × morale/100)  // 0.85..1.15

// 3. Probabilità giocatore segni almeno 1 gol
expected_goals(p) = shotsExpected(p) × conversionRate(p)

// Modello Poisson per il singolo giocatore
P_anytime(p) = 1 - exp(-expected_goals(p))
P_2plus(p) = 1 - exp(-eg) - eg × exp(-eg)
P_hattrick(p) = 1 - P_0(eg) - P_1(eg) - P_2(eg)

// 4. First scorer / Last scorer
// First: probabilità che p segni il primo gol = (eg_p / Σ eg) × P(at least 1 goal in match)
P_first(p) = (eg_p / sum_eg_all_players) × (1 - M[0][0])
P_no_goalscorer = M[0][0]   // (oppure include autogol nella nicchia "no goalscorer")

// Last scorer: in approssimazione = stesso P_first (asintoticamente vero per Poisson)
```

**Validazione:** la somma di `P_first` su tutti i giocatori + `P_no_goalscorer` deve essere ≈ 1. Se discrepa di >2% normalizza.

### 3.6 Cartellini, corner, halftime

**Cartellini totali (Poisson):**

```
λ_cards = 4.2
       × (1 + aggressivenessFactor_home + aggressivenessFactor_away)
       × (1 + 0.20 if isDerby)
       × refereeStrictness     // 0.80 (lasco) .. 1.25 (severo)

aggressivenessFactor(team) =
  (avg_aggression_attribute - 10) / 40
  // gioca 0..1.0 attorno alla media

P_cards_over(k.5) = 1 - Σ Poisson(i, λ_cards) for i <= k
```

**Corner (Poisson):**

```
λ_corners = 9.5
          × (attack_home / 1) × (attack_away / 1)
          × style_factor   // squadre offensive +20%
```

**Half-time:**

Si applica lo stesso modello con `λ_ht = λ_full × 0.42` (empiricamente i gol del 1° tempo sono il ~42% del totale).

```
λ_h_ht = λ_h × 0.42
λ_a_ht = λ_a × 0.42

// Matrice 1° tempo M_ht[i][j] con stessa Dixon-Coles
// HT/FT (9 combinazioni): si fa la matrice 2D di P(score_HT, score_FT)
// approssimazione: P(HT=ht, FT=ft) = M_ht[ht.h][ht.a] × M_2h[ft.h - ht.h][ft.a - ht.a]
// dove M_2h è la matrice del 2° tempo con λ × 0.58 e i,j >= 0 (gol del 2° tempo non negativi)
```

### 3.7 Tabella riassuntiva fattori di influenza

| Fattore | Range | Impatto su λ | Note |
|---|---|---|---|
| Attack/Defense rating | ±50% | Diretto via formula | Base del modello |
| Home advantage | ×1.30 | Solo su λ_home | Default Serie A |
| Form (ultime 5) | ±0.3 | Modulo | Vittoria=+0.10, pari=0, sconfitta=-0.08 (vs avversario di pari rank) |
| Fitness media | ±0.25 | Modulo | Rosa stanca = meno xG |
| Morale | ±0.15 | Modulo | |
| Big player out | -6% per giocatore | Modulo | Solo overall ≥75 |
| Squalifica | -4% per giocatore | Modulo | |
| Derby | +0.20 su λ_cards, var su xG | Vari | xG leggermente più imprevedibile |
| Motivazione (lotta) | ±0.10 | Modulo | Salvezza ultime 5gg = +max |
| Fatica | -0..0.15 | Modulo | 3 gg = 0, 7+ gg = 0 |

---

## 4. Catalogo mercati completo

Per ogni mercato: kind, label visibile, n. selezioni, formula prob, margine target.

| Kind | Label | Selezioni | Margine target | Formula prob |
|---|---|---|---|---|
| `1X2` | Esito finale | 3 (1, X, 2) | 5-6% | P_home, P_draw, P_away |
| `double_chance` | Doppia chance | 3 (1X, X2, 12) | 4-5% | Somma 2 esiti |
| `draw_no_bet` | Pareggio rimborsa | 2 (1, 2) | 4% | P_home / (1 - P_draw), idem |
| `over_under` (×6 linee) | Over/Under 0.5/1.5/.../5.5 | 2 (O, U) | 4-5% | Σ celle matrice |
| `btts` | Goal/No Goal | 2 (GG, NG) | 5-6% | Σ celle i>0 ∧ j>0 |
| `team_over_under` (×4 per squadra) | Home Over 1.5, ecc. | 2 | 5% | Marginale su una squadra |
| `total_goals_bands` | Fasce gol (0-1, 2-3, 4-6, 7+) | 4 | 7-8% | Σ celle per fascia |
| `asian_handicap` (×7 linee) | AH -2 / -1.5 / -1 / -0.5 / 0 / +0.5 / +1 | 2 | 3-4% | Vedi 3.4 |
| `european_handicap` (×4) | Handicap -1, -2, +1, +2 | 3 | 6-7% | Vedi 3.4 |
| `anytime_scorer` | Marcatore (qualsiasi momento) | N giocatori in formazione | 12-15% | P_anytime(p) |
| `first_scorer` | Primo marcatore | N+1 (giocatori + "no goal") | 14-16% | P_first(p) |
| `last_scorer` | Ultimo marcatore | N+1 | 14-16% | P_last(p) ≈ P_first(p) |
| `scorer_2plus` | Marcatore 2+ gol | N | 18-20% | P_2plus(p) |
| `scorer_hattrick` | Tripletta | N | 22-25% | P_hattrick(p) |
| `correct_score` | Risultato esatto | 20 (0-0...4-4 + "altro casa/X/trasferta") | 18-22% | M[h][a] |
| `halftime_correct_score` | Risultato esatto 1° tempo | 16 | 18-20% | M_ht[h][a] |
| `halftime_1X2` | Esito 1° tempo | 3 | 5-6% | Da M_ht |
| `halftime_fulltime` | Primo/Finale | 9 | 18-22% | Vedi 3.6 |
| `halftime_over_under` (×2) | 1°T Over 0.5/1.5 | 2 | 5% | Σ M_ht |
| `halftime_btts` | 1°T Goal | 2 | 8% | |
| `half_with_most_goals` | Tempo con più gol | 3 (1°T, 2°T, pari) | 8-10% | |
| `1X2_and_btts` | 1X2 + GG/NG | 6 | 10-12% | Sub-matrice |
| `1X2_and_over_under` | 1X2 + Over 2.5 | 6 | 10-12% | Sub-matrice |
| `btts_and_over_under` | GG + Over 2.5 | 4 (GG+O, GG+U, NG+O, NG+U) | 10% | |
| `total_cards_over_under` (×3) | Cartellini O/U 3.5/4.5/5.5 | 2 | 8-10% | Poisson cartellini |
| `total_corners_over_under` (×3) | Corner O/U 8.5/9.5/10.5 | 2 | 8-10% | Poisson corner |
| `first_goal_team` | Quale squadra segna prima | 3 (1, 2, no goal) | 8% | Vedi 3.5 |
| `red_card_match` | Espulsione sì/no | 2 | 12% | Poisson rossi λ=0.18 base |
| `penalty_awarded` | Rigore assegnato | 2 | 12% | Poisson rigori λ=0.30 |

**Totale mercati a partita: ~55-65** (con tutte le linee O/U espanse, AH 11 linee, scorer 5 mercati, halftime 6 varianti, combo 3, specials 8+). Validato dal test `markets.test.ts > genera 50-70 mercati per partita`. Per il top match si possono aggiungere "Anytime assist", "Player shots", ecc. (V2).

**Limite UI:** non mostrare tutti i 28 mercati nella card della home; mostrare solo `1X2`, `over_under 2.5`, `btts`. Gli altri sono nel Match Detail.

---

## 5. Margine bookmaker (overround)

Si parte dalle probabilità "vere" e si genera la quota finale.

### 5.1 Power method (preferito, default)

Trova `k > 1` tale che `Σ p_i^(1/k) = 1 + margin`. Più accurato del proporzionale per quote alte (es. marcatori).

```typescript
function applyPowerMargin(probs: number[], targetMargin: number): number[] {
  // Σ p_i = 1 prima (le probabilità vere sommano a 1)
  // Vogliamo Σ p_i^(1/k) = 1 + margin
  // → quota_i = 1 / p_i^(1/k)
  // Σ 1/quota_i = 1 + margin

  let k = 1.0;
  // Bisezione
  let lo = 0.5, hi = 2.0;
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const sum = probs.reduce((s, p) => s + Math.pow(p, 1 / mid), 0);
    if (sum > 1 + targetMargin) lo = mid;
    else hi = mid;
  }
  k = (lo + hi) / 2;
  return probs.map(p => Math.pow(p, 1 / k));   // = 1/odds, da invertire
}

function probsToOdds(adjustedProbs: number[]): number[] {
  return adjustedProbs.map(p => 1 / p);
}
```

### 5.2 Margine target per mercato

| Mercato | Margin target | Note |
|---|---|---|
| `1X2` (top match) | 5% | Inter-Juve |
| `1X2` (medio) | 6% | |
| `1X2` (piccolo) | 7% | Empoli-Salernitana |
| `over_under 2.5` | 4% | |
| `btts` | 5.5% | |
| `asian_handicap -0.5` | 3% | |
| `european_handicap` | 6.5% | |
| `correct_score` | 20% | |
| `anytime_scorer` | 13% | |
| `first_scorer` | 15% | |
| `scorer_hattrick` | 24% | |
| `combo 1X2+btts` | 11% | |
| `cards / corners` | 9% | |

**Variabilità:** il margine effettivo si jitter di ±10% per simulare differenze tra bookmaker (un giocatore esperto noterà che certe partite sono "più larghe" di altre).

### 5.3 Implementazione

```typescript
// src/engine/betting/overround.ts
import { applyPowerMargin, probsToOdds } from "./oddsEngine";

export function priceMarket(
  trueProbs: number[],
  marketKind: MarketKind,
  topMatchFactor: number = 1.0  // 0.8 (top) .. 1.2 (small)
): number[] {
  const baseMargin = MARGIN_TABLE[marketKind];
  const margin = baseMargin * topMatchFactor;
  const adjusted = applyPowerMargin(trueProbs, margin);
  const odds = probsToOdds(adjusted);
  // Arrotonda a 2 decimali, mai sotto 1.01
  return odds.map(o => Math.max(1.01, Math.round(o * 100) / 100));
}
```

---

## 6. Live betting engine

### 6.1 Premessa architetturale

Il match engine attuale (`src/engine/match/engine.ts`) calcola TUTTO il `MatchResult` subito, poi la UI fa il replay con timing configurabile. Dal punto di vista del giocatore questo È live betting:

- Il giocatore vede minuti che passano, gol che entrano
- Può piazzare scommesse durante il replay
- L'esito finale è già deciso ma a lui non importa (a lui interessa l'esperienza)
- Settlement avviene a `full_time` come pre-match

### 6.2 LiveContext

Durante il replay, manteniamo un `LiveContext`:

```typescript
interface LiveContext {
  fixtureId: EntityId;
  minute: number;
  second: number;
  homeScore: number;
  awayScore: number;
  redCardsHome: number;
  redCardsAway: number;
  scorers: EntityId[];           // giocatori che hanno già segnato
  recentEvents: MatchEvent[];     // ultimi 5
}
```

### 6.3 Ricalcolo quote (trigger-based)

`liveOddsUpdater.ts` espone una funzione `recomputeMarkets(board, ctx)` che si chiama:

- All'inizio del replay (transizione `pre_match` → `live`)
- Su ogni evento di tipo: `goal`, `own_goal`, `red_card`, `penalty`, `half_time`, `full_time`
- Ogni 5 minuti di gioco (decay temporale per O/U, marcatori, ecc.)

**Logica per i mercati gol-based:**

```
Tempo rimanente (in minuti): minutes_left = max(1, 95 - ctx.minute)
Frazione: f = minutes_left / 95

// xG residuo
λ_home_residual = λ_home_initial × f × adjustments
λ_away_residual = λ_away_initial × f × adjustments

adjustments (red card):
  if redCardsHome > redCardsAway: λ_home *= 0.65, λ_away *= 1.20
  if redCardsAway > redCardsHome: λ_away *= 0.65, λ_home *= 1.20
  if 2 rossi vs 0: ulteriore aggressivo

adjustments (score leading):
  // squadra in vantaggio "gestisce" → -10% xG sua, +5% xG avversaria
  if home_lead > 0: λ_home *= 0.92, λ_away *= 1.05
  ...

// Per ogni mercato gol-based, ricalcola matrice 8×8 sul tempo rimanente
// SHIFTA: il mercato "Over 2.5 full time" = "Over (2.5 - already_scored) sul resto"
//   es. 1-0 al 60': Over 2.5 FT diventa "almeno 2 gol in 35min residui"
```

**Mercati che muoiono:**

- `1X2 1° tempo` → si chiude (settled) al fischio fine 1° tempo
- `first_scorer` → si chiude al primo gol
- `correct_score` → resta aperto ma con probabilità che cambiano drasticamente
- `over_under k.5` dove `k.5 < current_total` → settled YES istantaneamente
- `over_under k.5` dove `k.5 ≥ current_total + 6` → di fatto morto (quota >50)

### 6.4 Sospensione mercati (suspension window)

Quando avviene un evento "scuotente":

```
Evento → status mercati impattati = "suspended" (UI: lock icon + sfondo grigio)
Durata sospensione:
  - goal: 8 secondi
  - red_card: 12 secondi
  - penalty: 15 secondi (intera sequenza fino esito)
  - half_time / full_time: indefinita (settlement)
Dopo sospensione: status → "open" con nuove quote
```

**Bet acceptance:** se l'utente clicca su una quota e nel frattempo il mercato si è sospeso (race condition), mostra modale "Quota cambiata, accetti?" rispettando `acceptOddsChange`.

### 6.5 Cash out

`cashout.ts` calcola il valore residuo della bolletta:

```typescript
function computeCashOut(bet: PlacedBet, currentMarkets: Record<string, Market>): number {
  // Calcola la quota attuale "live" per ogni selezione ancora aperta
  // Quota cash out = stake × (combinedOddsOriginal / combinedOddsLive) × cashOutFactor
  // cashOutFactor = 0.92 (8% margine del bookmaker sul cash out)

  let liveCombined = 1.0;
  for (const sel of bet.selections) {
    if (sel.status === "won") {
      // selezione già vinta → contribuisce con la quota piazzata
      liveCombined *= sel.oddsAtPlacement;
      continue;
    }
    if (sel.status === "lost") return 0;   // bolletta morta
    const liveOdds = findLiveOdds(currentMarkets, sel.marketId, sel.selectionId);
    if (!liveOdds) return 0;
    liveCombined *= liveOdds;
  }

  const fairValue = bet.stake × bet.combinedOdds / liveCombined;
  return Math.max(0, fairValue × CASH_OUT_FACTOR);
}

const CASH_OUT_FACTOR = 0.92;
```

**Casi:**

- Multipla con 1 selezione già vinta + altre live → cash out parziale alto (la già vinta contribuisce)
- Multipla con 1 selezione persa → cash out = 0
- Cash out disponibile solo se TUTTE le partite hanno quote live disponibili
- Cash out non disponibile durante suspension (race protection)

---

## 7. Schedina (singola / multipla / sistema)

### 7.1 Singola

```
combinedOdds = selection.odds
potentialWin = stake × combinedOdds
```

### 7.2 Multipla

```
combinedOdds = Π selection.odds   (prodotto)

bonusMultipla (opzionale):
  N selezioni vincenti: 5%
  N = 6: 8%
  N = 7: 12%
  N = 8+: 18%
potentialWin = stake × combinedOdds × (1 + bonus)
```

**Vincoli:**

- Min 2 selezioni, max 20
- Non si possono includere 2 selezioni dallo **stesso mercato** della stessa partita (es. 1 e X)
- Selezioni **correlate** (es. "Over 2.5" e "BTTS Sì" stesso match) → ammesse ma con `correlation tax` (quota combinata × 0.92)
- Selezioni totalmente correlate (es. "Marcatore: Lautaro" e "Inter vince 2-0 e Lautaro segna") → bloccate

### 7.3 Sistema

Sistema `k su n`: piazza tutte le C(n,k) combinazioni di k selezioni tra n.

```typescript
// n = 5 selezioni, k = 3 → C(5,3) = 10 combinazioni
// stake "per combinazione" = stakePerCombo
// stake totale = stakePerCombo × 10
```

**Vincita:**

```
Per ogni combinazione vinta (tutte k vinte): payout = stakePerCombo × Π odds
Vincita totale = somma di tutti i payout vincenti

NOTA: se delle n selezioni m sono perse e n-m >= k, ci sono ancora C(n-m, k) combinazioni potenzialmente vincenti.
```

**Tipi sistema offerti:**

- `n=3, k=2` → "Trixie" (3 combinazioni)
- `n=4, k=3` → "Patent" (4 combinazioni)
- `n=4, k=2` → 6 doppie
- `n=5, k=3` → 10 triple
- `n=5, k=4` → 5 quartine
- Generico: l'utente sceglie k da `1..n`

### 7.4 Quote boost (V2)

`Promotion.type = "odds_boost"`: quando si aggiunge una selezione boostata, la quota in schedina è `originalOdds × multiplier`. Si applica una sola promozione per scommessa.

### 7.5 Free bet (V2)

`Promotion.type = "free_bet"`: l'utente può usare un free bet di X€ su una selezione qualunque. La vincita è `(odds - 1) × X` (non si restituisce lo stake del free bet).

### 7.6 Modello pricing schedina

```typescript
function priceBetSlip(draft: BetSlipDraft, markets: Record<string, Market>): {
  combinedOdds: number;
  potentialWin: number;
  totalStake: number;
  warnings: string[];
} {
  const selectionsLive = draft.selections.map(s => {
    const market = markets[s.marketId];
    const sel = market.selections.find(x => x.id === s.selectionId);
    return { ...s, currentOdds: sel?.odds ?? s.snapshotOdds };
  });

  if (draft.mode === "single") {
    const odds = selectionsLive[0].currentOdds;
    return { combinedOdds: odds, totalStake: draft.stake, potentialWin: draft.stake * odds, warnings: [] };
  }

  if (draft.mode === "multiple") {
    let combined = selectionsLive.reduce((p, s) => p * s.currentOdds, 1);
    // applica correlation tax
    const correlation = detectCorrelation(selectionsLive);
    combined *= correlation.taxFactor;
    const bonus = multipleBonus(selectionsLive.length);
    const potential = draft.stake * combined * (1 + bonus);
    return { combinedOdds: combined, totalStake: draft.stake, potentialWin: potential, warnings: correlation.warnings };
  }

  if (draft.mode === "system") {
    const n = selectionsLive.length;
    const k = draft.systemSize!;
    const combos = combinations(n, k);
    const totalStake = draft.stake * combos;
    // potenzialWin = caso "tutte vinte": tutte le combos pagano
    const allWonPayout = combos * draft.stake *
      selectionsLive.slice(0, k).reduce((p, s) => p * s.currentOdds, 1);
    // più realisticamente, mostriamo la "max possible win" (tutte n vincono)
    const maxWin = sumAllCombinationsPayouts(selectionsLive, k, draft.stake);
    return { combinedOdds: maxWin / totalStake, totalStake, potentialWin: maxWin, warnings: [] };
  }
}
```

---

## 8. Settlement engine

`src/engine/betting/settlement.ts` riceve il `MatchResult` al `full_time` (o emit pubblicato) e risolve tutte le bollette aperte che contengono selezioni di quella fixture.

### 8.1 Resolver per mercato

```typescript
type SelectionOutcome = "won" | "lost" | "void" | "half_won" | "half_lost";

function resolveSelection(
  sel: PlacedSelection,
  result: MatchResult
): SelectionOutcome {
  const { homeScore, awayScore, events, scorers } = result;

  switch (sel.marketKind) {
    case "1X2":
      const winner = homeScore > awayScore ? "1" : homeScore < awayScore ? "2" : "X";
      return sel.selectionMeta?.side === winner ? "won" : "lost";
      // (Il sel.selectionMeta.side è la mia code per "1"/"X"/"2")

    case "over_under":
      const total = homeScore + awayScore;
      const line = sel.selectionMeta!.line!;
      const isOver = sel.selectionId.startsWith("over");
      return (isOver ? total > line : total < line) ? "won" : "lost";

    case "btts":
      const btts = homeScore > 0 && awayScore > 0;
      const wantsYes = sel.selectionId === "yes";
      return (wantsYes ? btts : !btts) ? "won" : "lost";

    case "double_chance":
      // selectionId: "1X" | "12" | "X2"
      const outcome = homeScore > awayScore ? "1" : homeScore < awayScore ? "2" : "X";
      return sel.selectionId.includes(outcome) ? "won" : "lost";

    case "asian_handicap": {
      const line = sel.selectionMeta!.line!;
      const side = sel.selectionMeta!.side!;
      // Aggiusta gol con handicap
      const adjustedHome = side === "home" ? homeScore + line : homeScore - line;
      const adjustedAway = awayScore;
      const diff = adjustedHome - adjustedAway;

      // Quarter lines (es. -0.75) si gestiscono splittando in 2 half-stakes
      if (Math.abs(line * 4) % 2 !== 0) {
        // Quarter line: split logic, restituisci half_won/half_lost
        const lines = quarterLineSplit(line);  // es. -0.75 → [-0.5, -1.0]
        const outcomes = lines.map(l => resolveAHSingle(homeScore, awayScore, side, l));
        // entrambe won → won; entrambe lost → lost; mix → half
        if (outcomes.every(o => o === "won")) return "won";
        if (outcomes.every(o => o === "lost")) return "lost";
        if (outcomes.includes("won") && outcomes.includes("push")) return "half_won";
        return "half_lost";
      }

      if (diff > 0) return "won";
      if (diff < 0) return "lost";
      return "void";  // push (handicap esatto)
    }

    case "european_handicap": {
      const line = sel.selectionMeta!.line!;
      const adjustedHome = homeScore + line;
      const result1X2 = adjustedHome > awayScore ? "1" : adjustedHome < awayScore ? "2" : "X";
      return sel.selectionMeta?.side === result1X2 ? "won" : "lost";
    }

    case "correct_score": {
      const score = sel.selectionMeta!.score!;
      return (score.home === homeScore && score.away === awayScore) ? "won" : "lost";
    }

    case "anytime_scorer": {
      const playerId = sel.selectionMeta!.playerId!;
      return scorers.some(s => s.playerId === playerId && s.note !== "autogol") ? "won" : "lost";
    }

    case "first_scorer": {
      if (sel.selectionId === "no_goalscorer") {
        return scorers.length === 0 ? "won" : "lost";
      }
      const playerId = sel.selectionMeta!.playerId!;
      const firstReal = scorers.find(s => s.note !== "autogol");
      // First scorer rules: autogol NON conta come primo, il prossimo gol "regolare" è il primo
      return firstReal?.playerId === playerId ? "won" : "lost";
    }

    case "scorer_2plus": {
      const playerId = sel.selectionMeta!.playerId!;
      const goals = scorers.filter(s => s.playerId === playerId && s.note !== "autogol").length;
      return goals >= 2 ? "won" : "lost";
    }

    case "scorer_hattrick": {
      const playerId = sel.selectionMeta!.playerId!;
      const goals = scorers.filter(s => s.playerId === playerId && s.note !== "autogol").length;
      return goals >= 3 ? "won" : "lost";
    }

    case "halftime_1X2":
    case "halftime_correct_score":
    case "halftime_over_under":
    case "halftime_btts": {
      // Calcola score al 45° dagli events
      const htScore = calcScoreAtMinute(events, 45);
      return resolveAsHTMarket(sel, htScore);
    }

    case "halftime_fulltime": {
      const htScore = calcScoreAtMinute(events, 45);
      const ht = htScore.home > htScore.away ? "1" : htScore.home < htScore.away ? "2" : "X";
      const ft = homeScore > awayScore ? "1" : homeScore < awayScore ? "2" : "X";
      return sel.selectionId === `${ht}${ft}` ? "won" : "lost";
    }

    case "total_cards_over_under": {
      const cards = events.filter(e => e.kind === "yellow_card" || e.kind === "red_card").length;
      // red = 2 cartellini per convenzione (oppure 1, decisione di progetto: usiamo 1)
      const line = sel.selectionMeta!.line!;
      const isOver = sel.selectionId.startsWith("over");
      return (isOver ? cards > line : cards < line) ? "won" : "lost";
    }

    case "total_corners_over_under": {
      const corners = events.filter(e => e.kind === "corner").length;
      const line = sel.selectionMeta!.line!;
      const isOver = sel.selectionId.startsWith("over");
      return (isOver ? corners > line : corners < line) ? "won" : "lost";
    }

    case "red_card_match":
      const hasRed = events.some(e => e.kind === "red_card");
      return (sel.selectionId === "yes" ? hasRed : !hasRed) ? "won" : "lost";

    case "penalty_awarded":
      const hasPen = events.some(e => e.kind === "penalty");
      return (sel.selectionId === "yes" ? hasPen : !hasPen) ? "won" : "lost";

    case "1X2_and_btts":
    case "1X2_and_over_under":
    case "btts_and_over_under":
      // combo: entrambi must hold
      const parts = splitComboSelection(sel.selectionId);
      const sub = parts.map(p => resolveSelection({ ...sel, marketKind: p.kind, selectionId: p.id }, result));
      return sub.every(o => o === "won") ? "won" : "lost";

    // ... (gli altri seguono lo stesso pattern)

    default:
      throw new Error(`Resolver mancante per ${sel.marketKind}`);
  }
}
```

### 8.2 Resolver bolletta

```typescript
function settleBet(bet: PlacedBet, results: Record<EntityId, MatchResult>): SettledBet {
  // Risolvi ogni selezione
  const resolved = bet.selections.map(sel => ({
    ...sel,
    status: resolveSelection(sel, results[sel.fixtureId])
  }));

  if (bet.mode === "single" || bet.mode === "multiple") {
    // void: stake torna (quota 1.0 quella selezione)
    const allLost = resolved.some(s => s.status === "lost");
    if (allLost) return { ...bet, selections: resolved, status: "lost", actualPayout: 0 };

    // calcola payout: il void è quota 1.0; half_won è quota * 0.5 + 0.5; half_lost è 0.5 * stake refund
    let multiplier = 1;
    for (const s of resolved) {
      switch (s.status) {
        case "won": multiplier *= s.oddsAtPlacement; break;
        case "void": multiplier *= 1; break;
        case "half_won": multiplier *= (s.oddsAtPlacement + 1) / 2; break;
        case "half_lost": multiplier *= 0.5; break;  // metà stake refund
      }
    }
    return {
      ...bet,
      selections: resolved,
      status: multiplier > 1 ? "won" : multiplier === 1 ? "void" : "half_won",
      actualPayout: bet.stake * multiplier
    };
  }

  if (bet.mode === "system") {
    // Per ogni combinazione di k selezioni, calcola payout
    const combos = generateCombinations(resolved, bet.systemSize!);
    let totalPayout = 0;
    for (const combo of combos) {
      const allWon = combo.every(s => s.status === "won");
      if (allWon) {
        const odds = combo.reduce((p, s) => p * s.oddsAtPlacement, 1);
        totalPayout += bet.stake * odds;
      }
      // (per semplicità V1: non gestiamo half_won nel sistema; trattalo come won)
    }
    return {
      ...bet,
      selections: resolved,
      status: totalPayout > 0 ? "won" : "lost",
      actualPayout: totalPayout
    };
  }

  throw new Error(`Mode non supportata: ${bet.mode}`);
}
```

### 8.3 Aggiornamento bankroll e stats

Dopo `settleBet`:

```typescript
function applySettlement(bet: SettledBet, wallet: BettingWallet, team: Team, stats: BettingStats): void {
  if (bet.actualPayout > 0) {
    team.balance += bet.actualPayout;   // credit
  }
  wallet.matchdayState.totalReturned += bet.actualPayout;
  wallet.matchdayState.netProfit = wallet.matchdayState.totalReturned - wallet.matchdayState.totalStaked;
  if (bet.status === "lost") {
    wallet.matchdayState.lossStreak++;
  } else if (bet.status === "won") {
    wallet.matchdayState.lossStreak = 0;
  }
  updateStats(stats, bet);
  checkNarrativeTriggers(bet, stats, team);
}
```

---

## 9. Bankroll integrato col club

### 9.1 Hook

```typescript
// src/engine/betting/bankroll.ts
import type { Team } from "$engine/types";
import type { BettingWallet, PlacedBet } from "./types";

export function debit(team: Team, wallet: BettingWallet, amount: number): { ok: boolean; reason?: string } {
  if (amount <= 0) return { ok: false, reason: "Importo non valido" };
  if (amount > team.balance) return { ok: false, reason: "Saldo insufficiente" };

  const caps = wallet.caps;
  if (caps.maxStakePerBet && amount > caps.maxStakePerBet) {
    return { ok: false, reason: `Limite singola scommessa: ${caps.maxStakePerBet}` };
  }
  if (caps.maxStakePerMatchday) {
    const cum = wallet.matchdayState.totalStaked + amount;
    if (cum > caps.maxStakePerMatchday) {
      return { ok: false, reason: `Limite settimanale: ${caps.maxStakePerMatchday}` };
    }
  }
  if (caps.maxLossPerMatchday) {
    const projectedLoss = wallet.matchdayState.totalStaked - wallet.matchdayState.totalReturned + amount;
    if (projectedLoss > caps.maxLossPerMatchday) {
      return { ok: false, reason: "Limite perdite raggiunto" };
    }
  }
  if (caps.cooldownAfterLossStreak && wallet.matchdayState.lossStreak >= caps.cooldownAfterLossStreak) {
    return { ok: false, reason: "Cooldown attivo dopo serie negativa" };
  }

  // OK
  team.balance -= amount;
  wallet.matchdayState.totalStaked += amount;
  return { ok: true };
}

export function credit(team: Team, wallet: BettingWallet, amount: number): void {
  team.balance += amount;
  wallet.matchdayState.totalReturned += amount;
}
```

### 9.2 Safeguard "scandalo scommesse"

Trigger narrative (in `narrativeFlags`):

| Condizione | Evento narrativo | Conseguenze |
|---|---|---|
| `team.balance < 0` per 3 giornate consecutive | "Il club è in rosso, il presidente chiede chiarimenti" | News board, possibile licenziamento se persiste |
| `totalStaked stagione > balance iniziale × 2` | "Il manager scommette troppo" | Reputation -10, ammonimento federazione |
| `single win > balance iniziale × 0.5` | "Vincita milionaria — sospetti sul match" | Indagine sportiva (RNG-driven) |

**Trigger via `checkNarrativeTriggers()`** in `settlement.ts`, scrive su `Career.news`.

### 9.3 Modalità responsabili

Da Settings, l'utente può attivare:

- **Self-exclusion temporanea**: blocca scommesse per N giornate
- **Limiti hard**: maxStakePerBet, maxLossPerMatchday
- **Reality check**: ogni 10 scommesse, modale con riepilogo netProfit

(Featuring marketing dei bookmaker reali per realismo + responsabilità).

### 9.4 Vincolo di integrità: niente scommesse propria squadra

**Decisione product:** il manager **non può** scommettere su partite in cui la propria squadra è coinvolta (home o away). È coerente con le regole UEFA/FIFA reali e protegge l'integrità sportiva (vero anche in un single-player narrativo).

**Implementazione duale:**

1. **Hard block** nell'orchestratore. `placeBet()` rifiuta con errore esplicito se anche **una sola** selezione della schedina è su una fixture proibita:

```typescript
const ownTeamSelections = draft.selections.filter(s =>
  isOwnTeamFixture(career, s.fixtureId)
)
if (ownTeamSelections.length > 0) {
  return { ok: false, errors: [`Vietato scommettere su partite della propria squadra (${team.name})`] }
}
```

2. **Soft block** nella UI. Le fixture proibite restano **visibili** (il manager può leggere le quote, controllare il mercato) ma le `OddsButton` sono disabilitate con tooltip "Vietato propria squadra". Helper Svelte esportato dallo store:

```typescript
import { isMyTeamMatch } from '$state/betting.svelte'
// In MatchCard.svelte:
const blocked = isMyTeamMatch(match.fixtureId)
```

**Rationale:** mostrarle ma bloccarle è meglio che nasconderle:
- il manager vede comunque le quote per orientarsi sul prossimo avversario
- non incentiva il workaround (alt-account, ecc.)
- è esattamente quello che fanno i bookmaker veri con i player-bet (dove vietato)

**Estensione V2:** se servirà supportare anche regole più severe (es. blocco scommesse su squadre dello stesso paese, su giocatori della propria nazionale, ecc.) si aggiunge `IntegrityPolicy` configurabile.

---

## 10. UI/UX sportsbook

### 10.1 Navigation

Aggiungi al sidebar di `AppShell.svelte`:

```
🏠 Dashboard
👥 Rosa
📅 Calendario
🏆 Classifica
⚽ Match
─────────────
🎯 Scommesse        ← NUOVO
   ├ Sportsbook    (/betting)
   ├ Le mie bollette (/betting/my-bets)
   └ Statistiche   (/betting/stats)
─────────────
⚙ Impostazioni
```

Badge "LIVE" pulsante sulla voce "Scommesse" quando c'è un match in corso col replay attivo.

### 10.2 Schermata Home `/betting`

Layout 3 colonne (desktop) / stack (mobile):

```
┌────────────────────────────────────────────────────────────────────┐
│  HEADER: Logo gold "BOOK" + Saldo club: €12.450.000 + LIVE badge   │
├──────────────┬─────────────────────────────────────┬───────────────┤
│              │  TABS: [Tutte] [Top match] [Live] [Stasera]         │
│ SIDEBAR      ├─────────────────────────────────────┤   BETSLIP     │
│ FILTRI       │                                     │   (sticky)    │
│              │  ┌─────────────────────────────┐    │               │
│ Categorie    │  │ MatchCard: Inter vs Milan   │    │  ┌──────────┐ │
│ ☑ Tutte      │  │  Sab 20:45 — San Siro       │    │  │ EMPTY    │ │
│ ☐ 1X2        │  │                              │    │  │ Aggiungi │ │
│ ☐ Marcatori  │  │  1   X   2     U2.5 O2.5    │    │  │ quote    │ │
│              │  │ 1.85 3.40 4.20  1.95  1.85  │    │  │ qui      │ │
│ Mercati      │  │ +24 mercati →                │    │  └──────────┘ │
│ ☐ Asian Hcap │  └─────────────────────────────┘    │               │
│ ☐ Combo      │                                     │  [Singola]    │
│              │  ┌─────────────────────────────┐    │  [Multipla]   │
│ Quote        │  │ MatchCard: Juve vs Roma     │    │  [Sistema]    │
│ ▶ Boost      │  │  Dom 18:00                  │    │               │
│   1 boost    │  │  1   X   2     ...          │    │  Stake: €___  │
│   disp.      │  │ ...                         │    │  Vincita: €0  │
│              │  └─────────────────────────────┘    │  [PIAZZA]     │
│              │                                     │               │
│              │  ┌─ LIVE NOW ──────────────────┐    │               │
│              │  │ 🔴 Napoli 1-0 Lazio • 67'   │    │               │
│              │  │  1.45 4.20 8.00  ...        │    │               │
│              │  │  [animazione pulsante]      │    │               │
│              │  └─────────────────────────────┘    │               │
└──────────────┴─────────────────────────────────────┴───────────────┘
```

**Componenti coinvolti:**

- `SportsbookShell.svelte` — layout + header
- `MatchCard.svelte` — singola partita con quote ridotte
- `LiveBadge.svelte` — animazione rosso pulsante
- `BetSlip.svelte` — schedina sticky a destra (slide-out su mobile)

### 10.3 Schermata Match Detail `/betting/match/:fixtureId`

```
┌────────────────────────────────────────────────────────────────────┐
│  ← back            INTER vs MILAN  •  Sab 20:45  •  Live: 23'      │
│                                                                    │
│   Stadio: San Siro     Vento: 5km/h   Arbitro: Doveri             │
│   ┌─ STAT ATTUALI (se live) ────────────────────────────────┐     │
│   │  Tiri 6-3  •  Possesso 62-38  •  Corner 4-1  •  Card 1Y │     │
│   └──────────────────────────────────────────────────────────┘     │
├────────────────────────────────────────────────────────────────────┤
│  CATEGORIE: [Principali][Gol][Handicap][Marcatori][Esatto][Combo]  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ▼ 1X2                                              ← collapse     │
│    [ Casa  1.85 ]  [ Pareggio  3.40 ]  [ Trasferta  4.20 ]        │
│                                                                    │
│  ▼ Over/Under                                                      │
│     U0.5 1.05 | O0.5 8.50                                          │
│     U1.5 1.35 | O1.5 3.10                                          │
│     U2.5 1.95 | O2.5 1.85    ← evidenziati i 2.5                  │
│     U3.5 2.85 | O3.5 1.45                                          │
│     U4.5 4.20 | O4.5 1.18                                          │
│                                                                    │
│  ▼ Goal/No Goal                                                    │
│     [ Goal  1.65 ]  [ No Goal  2.20 ]                              │
│                                                                    │
│  ▶ Handicap Asiatico (10 selezioni)                                │
│  ▶ Marcatori (28 selezioni)                                        │
│  ▶ Risultato esatto (20 selezioni)                                 │
│  ▶ ... (15 altri gruppi)                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Componenti:**

- `MarketGroup.svelte` — accordion espandibile, header con icona, count selezioni
- `OddsButton.svelte` — bottone quota; stati: open, selected (oro pieno), suspended (lock), boosted (lampada)

**Animazioni:**

- Quota cambiata: flash verde (su) / rosso (giù) per 800ms, freccia ▲▼
- Mercato sospeso: fade + lock icon, click disabilitato
- Live update: pulse oro sul bordo della card

### 10.4 BetSlip

```
┌──────────────────────────┐
│ SCHEDINA  (3)        × │
├──────────────────────────┤
│ [Singola][Multi][Sistema]│
│      ↑ selected          │
├──────────────────────────┤
│ Inter vs Milan          ×│
│  Over 2.5      1.85      │
│                          │
│ Juve vs Roma            ×│
│  1 Casa        2.10      │
│                          │
│ Napoli vs Lazio         ×│
│  Marc.: Osimhen 3.50     │
├──────────────────────────┤
│ Quota: 13.62             │
│ Bonus multi: +5%         │
│                          │
│ Stake: [   25,00 ]       │
│ Vincita: €357,28         │
│                          │
│ Cap. settim. €1000 /     │
│   utilizzato €125        │
│                          │
│ [ PIAZZA SCOMMESSA ]     │
└──────────────────────────┘
```

**Su mobile:** drawer da basso con `handle` per espandere.

### 10.5 My Bets `/betting/my-bets`

Tabs: `Aperte (3) | Risolte (47) | Cash Out (2)`

Per ogni bolletta:

```
┌──────────────────────────────────────────────────────────┐
│ 📅 Giornata 12 • 14 Nov 2025 • 18:42                     │
│ MULTIPLA — 3 selezioni                                   │
│                                                          │
│ ✅ Inter vs Milan — Over 2.5  @ 1.85  → 3-1 ✓            │
│ ⏳ Juve vs Roma — 1 Casa  @ 2.10  (in attesa)            │
│ ❌ Napoli vs Lazio — Osimhen marca  @ 3.50 → No gol      │
│                                                          │
│ Stake: €25,00  •  Quota: 13.62                           │
│ Stato: PERDENTE                                          │
│ Vincita: €0                                              │
│                                                          │
│ [💰 CASH OUT €18,40]     [Dettagli]                      │
└──────────────────────────────────────────────────────────┘
```

### 10.6 Stats `/betting/stats`

Dashboard con grafici (lightweight, SVG inline):

- Saldo nel tempo (line chart)
- ROI per mercato (bar chart)
- Profitto per giornata (sparkline)
- Streak (visualizzazione W L W W L)
- "Top mercato preferito": Over 2.5 (38% delle bet)

### 10.7 Animazioni / micro-interazioni

| Trigger | Animazione |
|---|---|
| Aggiunta selezione | Slide-in da destra, pulse oro |
| Rimozione selezione | Slide-out + collapse |
| Quote update live | Flash + freccia direzione |
| Bet placed | Confetti gold (1s) + receipt modale |
| Bet won | Sparkle gold + cash sound |
| Bet lost | Fade desaturato, X rossa |
| Cash out | Animazione moneta che cade nel saldo |
| Suspension | Lock icon + grey overlay |

### 10.8 Design tokens (riusa)

- Bg principale: `bg-onyx-950`
- Card: `bg-onyx-800/60 backdrop-blur-xl border border-gold-500/15 rounded-2xl`
- Quote button: `bg-onyx-700 border border-gold-500/30 hover:border-gold-500 text-gold-100`
- Quote selected: `bg-gold-500 text-onyx-950 font-bold`
- LIVE badge: `bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse`
- Win green: `text-emerald-400`
- Loss red: `text-red-400`

---

## 11. Persistence

### 11.1 IndexedDB stores (estendi `src/storage/db.ts`)

```typescript
// Aggiungere durante l'upgrade a v2:
db.createObjectStore("betting_boards", { keyPath: "fixtureId" });
db.createObjectStore("betting_placed", { keyPath: "id" });
db.createObjectStore("betting_settled", { keyPath: "id" });
// stats e wallet sono in Career.bettingCareerData
```

Alternativa più semplice: tutto dentro `Career.bettingCareerData` (BettingCareerData definita in 2.4), che si serializza/deserializza con `JSON.parse/stringify` come il resto.

**Raccomandazione:** tieni tutto nel `Career` blob. È coerente col pattern esistente (vedi `src/storage/db.ts` che ha un solo store `saves`). Spezza in stores separati solo se la dimensione del save eccede ~5MB.

### 11.2 Aggancio `Career`

Estendere il tipo `Career` in `src/engine/career/types.ts`:

```typescript
export interface Career {
  // ... campi esistenti
  bettingCareerData?: BettingCareerData;   // opzionale per backward compat con save vecchi
}
```

Al `loadCareer()`, se `bettingCareerData` mancante, inizializzalo:

```typescript
function initBetting(career: Career): BettingCareerData {
  return {
    wallet: {
      clubId: career.manager.teamId!,
      caps: {},
      matchdayState: { matchday: career.season.currentMatchday, totalStaked: 0, totalReturned: 0, netProfit: 0, lossStreak: 0 }
    },
    oddsBoards: {},
    openBets: [],
    settledBets: [],
    stats: emptyStats(),
    promotions: [],
    narrativeFlags: { debtIncidentTriggered: false, bigWinIncidentTriggered: false }
  };
}
```

---

## 12. Hooks col match engine

### 12.1 Pre-match: generazione quote

**Trigger:** quando `Career.season.currentMatchday` cambia, oppure al primo accesso a `/betting` se le quote del matchday corrente non esistono.

```typescript
// src/engine/betting/marketsGenerator.ts
export function generateOddsForMatchday(career: Career, matchday: number): MatchOddsBoard[] {
  const fixtures = career.fixtures.filter(f => f.matchday === matchday && f.status === "scheduled");
  return fixtures.map(fix => {
    const homeTeam = career.teams[fix.homeId];
    const awayTeam = career.teams[fix.awayId];
    const homePlayers = lineupOf(career, homeTeam, fix);
    const awayPlayers = lineupOf(career, awayTeam, fix);

    const homeInput = buildTeamInput(homeTeam, homePlayers, career, fix, /*isHome*/ true);
    const awayInput = buildTeamInput(awayTeam, awayPlayers, career, fix, /*isHome*/ false);

    const { lambdaHome, lambdaAway } = computeLambdas(homeInput, awayInput);
    const probMatrix = dixonColesMatrix(lambdaHome, lambdaAway);

    const markets = [
      buildMarket1X2(probMatrix, fix.id),
      buildMarketOverUnder(probMatrix, fix.id, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]),
      buildMarketBTTS(probMatrix, fix.id),
      buildMarketDoubleChance(probMatrix, fix.id),
      buildMarketAsianHandicap(probMatrix, fix.id, [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5]),
      buildMarketEuropeanHandicap(probMatrix, fix.id, [-2, -1, 1, 2]),
      buildMarketCorrectScore(probMatrix, fix.id),
      buildMarketHalftime(lambdaHome, lambdaAway, fix.id),
      buildMarketScorers(homePlayers, awayPlayers, lambdaHome, lambdaAway, fix.id),
      buildMarketCombo(probMatrix, fix.id),
      buildMarketCards(homeInput, awayInput, fix.id),
      buildMarketCorners(homeInput, awayInput, fix.id),
      buildMarketFirstGoalTeam(probMatrix, fix.id),
      buildMarketSpecials(probMatrix, fix.id)
    ].flat();

    return {
      fixtureId: fix.id,
      matchday: fix.matchday,
      homeId: fix.homeId,
      awayId: fix.awayId,
      kickoff: fix.date,
      markets,
      generatedAt: Date.now(),
      state: "pre_match"
    };
  });
}
```

### 12.2 Live: durante replay

Espone un **event bus** consumato da `MatchView`:

```typescript
// src/state/betting.svelte.ts
import { liveOddsUpdater } from "$engine/betting/liveOddsUpdater";

export function onMatchEvent(fixtureId: EntityId, event: MatchEvent, currentState: LiveContext): void {
  const store = bettingStore();
  const board = store.boards[fixtureId];
  if (!board) return;

  // 1. Aggiorna contesto live
  board.liveMinute = event.minute;
  board.liveScore = { home: currentState.homeScore, away: currentState.awayScore };
  board.state = event.kind === "kickoff" ? "live"
              : event.kind === "half_time" ? "ht"
              : event.kind === "full_time" ? "settled"
              : board.state;

  // 2. Sospendi mercati impattati
  const suspended = marketsAffectedBy(event.kind);
  suspendMarkets(board, suspended, suspensionDuration(event.kind));

  // 3. Ricalcola dopo finestra
  setTimeout(() => {
    const newMarkets = liveOddsUpdater.recompute(board, currentState);
    applyMarketUpdate(board, newMarkets);   // produce lastDelta per animazioni
  }, suspensionDuration(event.kind));
}
```

**Modifica richiesta a `MatchView.svelte`:** chiamare `onMatchEvent` ad ogni step del replay.

```svelte
<!-- src/routes/Match.svelte (esistente) -->
<script lang="ts">
  import { onMatchEvent } from "$state/betting.svelte";

  async function playEvent(event: MatchEvent, ctx: LiveContext) {
    // ... animazioni esistenti
    onMatchEvent(fixtureId, event, ctx);    // ← NUOVO
  }
</script>
```

### 12.3 Post-match: settlement

Al `full_time` del replay (o subito se l'utente ha cliccato "Simula veloce"):

```typescript
import { settleBetsForFixture } from "$engine/betting/settlement";

function onMatchEnd(fixtureId: EntityId, result: MatchResult) {
  const career = careerStore().career!;
  settleBetsForFixture(career, fixtureId, result);
  persistActiveCareer();
}
```

---

## 13. Esempi numerici end-to-end

### 13.1 Esempio: Inter vs Empoli

**Input:**

- Inter — `attack_overall = 82`, `defense_overall = 79`, formIndex +0.15, fitness 88, morale 75, no infortuni, home
- Empoli — `attack_overall = 68`, `defense_overall = 70`, formIndex -0.05, fitness 75, morale 60, 1 infortuno chiave

**Lambda:**

```
attack_inter = 82 / 74 = 1.108
defense_empoli = 70 / 74 = 0.946
mod_inter = 1 + 0.15 + (88-50)/200 + (75-50)/333 = 1 + 0.15 + 0.19 + 0.075 = 1.415
λ_inter = 1.45 × 1.108 × (1/0.946) × 1.30 × 1.415 = 3.13

attack_empoli = 68/74 = 0.919
defense_inter = 79/74 = 1.068
mod_empoli = 1 + (-0.05) + (75-50)/200 + (60-50)/333 - 0.06 = 0.965
λ_empoli = 1.15 × 0.919 × (1/1.068) × 0.965 = 0.954
```

**Matrice Dixon-Coles** (parziale, valori normalizzati):

```
        Away→  0       1       2       3       4
Home↓
  0          0.017   0.025   0.014   0.005   0.001
  1          0.054   0.064   0.034   0.012   0.003
  2          0.085   0.099   0.052   0.018   0.004
  3          0.089   0.103   0.054   0.019   0.005
  4          0.070   0.081   0.042   0.015   0.004
  5          0.044   0.051   0.027   0.009   0.002
```

**Probabilità derivate:**

```
P_home (Inter wins) = 0.660
P_draw = 0.205
P_away = 0.135

P_over_2.5 = 0.62
P_btts = 0.49
P_correct_score(2-1) = 0.099
P_correct_score(2-0) = 0.085
```

**Quote (margine 5% su 1X2):**

```
sumProbsAdjusted = 1.05
quota_1 = 1 / 0.660^(1/1.073) ≈ 1.51
quota_X = 1 / 0.205^(1/1.073) ≈ 4.39
quota_2 = 1 / 0.135^(1/1.073) ≈ 6.65

Verifica: 1/1.51 + 1/4.39 + 1/6.65 = 0.662 + 0.228 + 0.150 = 1.040 ≈ 1.04 (4% margin) ✓
```

### 13.2 Esempio scommessa live

**Stato al 60':** Inter 2-1 Empoli, no rossi.

**xG residuo (35 min):**

```
f = 35/95 = 0.368
λ_inter_residual = 3.13 × 0.368 × 0.92 (lead adjustment) = 1.059
λ_empoli_residual = 0.954 × 0.368 × 1.05 = 0.369
```

**Mercato Over 2.5 FT** = ora "almeno 1 gol nei restanti 35'":

```
P_no_goal_residual = exp(-(1.059 + 0.369)) = exp(-1.428) = 0.240
P_at_least_1 = 0.760
quota Over 2.5 (live) = 1 / 0.760^(1/1.05) = 1.336 ≈ 1.34
```

(Pre-match Over 2.5 era ~1.55, ora 1.34 perché di fatto vinto)

### 13.3 Esempio multipla

3 selezioni:

- Inter 1 Casa @ 1.51
- Juve-Roma Over 2.5 @ 1.85
- Napoli BTTS Sì @ 1.70

```
combinedOdds = 1.51 × 1.85 × 1.70 = 4.748
correlation tax = 1.0 (selezioni di partite diverse → no tax)
bonus 3 multipla = 0 (bonus parte da 4+)
potentialWin (stake €20) = 20 × 4.748 = €94.96
```

Se Inter vince, Juve-Roma finisce 3-2, Napoli-Lazio finisce 1-0 (no BTTS):

```
status = "lost"
payout = 0
```

### 13.4 Esempio sistema

5 selezioni, sistema 5×3 (terzine):

```
combinazioni = C(5,3) = 10
stakePerCombo = €5
totalStake = 5 × 10 = €50
```

Se 4 selezioni su 5 vincono (1 persa):

```
combinazioni vincenti = C(4,3) = 4
Per ognuna delle 4: payout = 5 × (Π 3 quote vincenti) ≈ 5 × 1.85^3 = 31.6
totalPayout = 4 × 31.6 = €126.40
profitto = 126.40 - 50 = +€76.40
```

---

## 14. Roadmap implementazione

### MVP (3 giorni)

- [ ] Types + folder structure
- [ ] Odds engine: Poisson + Dixon-Coles + 5 mercati base (1X2, U/O 2.5, BTTS, DC, AH -0.5)
- [ ] Overround
- [ ] Markets generator pre-match
- [ ] Store Svelte + persistence in Career
- [ ] UI: SportsbookHome con MatchCard, BetSlip singola
- [ ] Settlement engine per i 5 mercati
- [ ] Bankroll basic (debit/credit Team.balance)
- [ ] Route `/betting`

### V1 completa (5-7 giorni)

- [ ] Tutti i 28 mercati del catalogo
- [ ] Multipla con bonus + correlation
- [ ] Sistema
- [ ] Live odds updater integrato col replay
- [ ] My Bets page
- [ ] Stats page con grafici SVG
- [ ] Cash out
- [ ] Safeguard / narrative

### V2 (post-launch)

- [ ] Promotions (quote boost, free bet, accumulator bonus)
- [ ] Player props avanzati (anytime assist, player shots, ecc.)
- [ ] Bet builder (combina più selezioni same match con quota custom)
- [ ] Storico stagioni con leaderboard interna
- [ ] Notifiche push (browser) su settlement

---

## 15. Per l'altra chat: cosa serve / cosa chiedere

### 15.1 File `.md` da richiedere

Per lavorare allineato con l'app che state costruendo, **prima di iniziare l'implementazione** chiedi all'altra chat di generare:

1. **`ENGINE_CONTRACT.md`** — descrive l'interfaccia del match engine:
   - Firma esatta di `simulateMatch(fixture, career): MatchResult`
   - Lista completa `MatchEventKind` con condizioni di emissione
   - Come la UI riproduce gli eventi (timing, async, hooks disponibili)
   - Esiste un event bus? Se no, dove fare l'hook per ricevere ogni evento?

2. **`CAREER_CONTRACT.md`** — schema del Career:
   - Tutti i campi di `Team`, `Player`, `Fixture`, `MatchResult` (anche eventuali aggiunte recenti)
   - Come si serializza/deserializza
   - Versioning del save (per migrations)

3. **`UI_TOKENS.md`** — design system:
   - Tutte le classi/varianti Tailwind custom
   - Componenti base disponibili (Button, Card, Modal, Tabs)
   - Tipografia e spacing scale

4. **`PERSISTENCE.md`** — IndexedDB schema:
   - Stores esistenti
   - Pattern per estensioni (versione DB, migrations)

### 15.2 Punti di integrazione critici

**[A] Lineup generator** — l'odds engine ha bisogno della formazione tipo (chi giocherà titolare) per calcolare attack/defense team. Se il gestionale non ha già una funzione `expectedLineup(team, fixture): Player[]`, va creata.

**[B] Event hook** — il live updater richiede di essere chiamato ad ogni event del replay. La modifica al `Match.svelte` deve essere minimale e non rompere niente.

**[C] Settlement timing** — il settlement deve scattare al `full_time` ma SOLO dopo che il `MatchResult` è stato persistito. Race condition da evitare.

**[D] Modifica `Career`** — aggiungere `bettingCareerData` al tipo Career. Aggiornare logica di save/load per backward compat (se mancante, init).

**[E] Routing** — aggiungere 4 route in `src/router.ts`. Aggiungere voce sidebar in `AppShell.svelte`.

### 15.3 Domande aperte da chiarire con l'altra chat

- [ ] La formazione tipo è già "calcolabile" o sempre uguale alla titolare scelta dall'utente?
- [ ] Quando avanza la giornata, gli infortuni vengono risolti prima o dopo il match? (impatta sul timing di rigenerazione quote)
- [ ] Il `MatchResult` include `htScore` esplicitamente, o va calcolato dagli events?
- [ ] Esiste già una funzione `formIndex(team, lastN)` o va scritta?
- [ ] L'utente può "skippare" il replay e simulare istantaneamente? Se sì, le bet live aperte vanno chiuse PRIMA dello skip o si auto-settle al risultato finale?

### 15.4 Domande aperte di product

**✅ Decise da Roberto (2026-05-26):**
- ✅ **Propria squadra:** bloccata (hard + soft, vedi sez. 9.4). Tutti gli altri match liberi, qualsiasi mercato.
- ✅ **Multiplayer futuro:** sì, "tutti i giocatori che giocano quella lega insieme (online o offline collegati)" — V1 deve essere multiplayer-ready ma il sync vero arriva in V2.

**✅ Decise da Roberto (2026-05-26):**
- ✅ **Competizioni V1**: Serie A (tier 1) + Champions League + Europa League + Conference League. Nazionali in V2 (qualificazioni + tornei). Implementato via `LeagueBettingConfig` parametrico — vedi sez. 16.
- ✅ **Manager AI rivali**: NON in V1. Il multiplayer umano arriverà in V2 e movimenterà naturalmente la leaderboard. Niente lavoro inutile su AI fake.
- ✅ **Promozioni**: **1 quote boost/giorno** (mercato random tra quote 1.50-5.00, multiplier 1.15-1.50) + **1 free bet/settimana** (lunedì, importo = 0.1% balance arrotondato a buckets €5..€10k) + **accumulator bonus** permanente (+5% da 4 selezioni). Tutto seedato sul savegame → multiplayer-ready.
- ✅ **Cap vincita dinamico**: `min(€1M assoluto, 10% Team.balance)` — protegge automaticamente i club piccoli. Cap stake `1% balance`, cap loss settimanale `5% balance`, cooldown 5 sconfitte consecutive. Floor minimo €100 per club estremamente poveri.
- ✅ **Quote realistiche**: cap globale `MAX_ODDS = 250` (era 1000). Marcatori filtrati a quote ≤50 (post-prezzo). Test suite validati su 3 scenari (top match, sbilanciato, underdog).

---

## 15.5 Roadmap multiplayer V2 (non bloccante per V1)

Architettura prevista quando arriverà il multiplayer "tutti i giocatori sulla stessa lega":

```
┌─────────────────────────────────────────────────────────┐
│                  Lega condivisa (sync layer)             │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │ LeagueBettingShared (NEW V2)                  │       │
│  │  - oddsBoards (uguali per tutti i manager)    │       │
│  │  - fixtures (uguali)                          │       │
│  │  - results (sync al settlement)               │       │
│  │  - promotions (uguali per tutti)              │       │
│  │  - publicLeaderboard (ROI dei manager)        │       │
│  └──────────────────────────────────────────────┘       │
│                       ▲                                   │
│                       │ reads                             │
│  ┌────────────────────┴────────────────────────┐         │
│  │ Career (per-manager)                         │         │
│  │  - BettingCareerData (privato)               │         │
│  │     ├ wallet (privato)                       │         │
│  │     ├ openBets (private)                     │         │
│  │     ├ settledBets (private)                  │         │
│  │     ├ stats (private)                        │         │
│  │     └ narrativeFlags (private)               │         │
│  └──────────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────────┘
```

**Cosa diventa pubblico (per lega):** quote, fixture, risultati, promozioni, leaderboard ROI.
**Cosa resta privato (per manager):** bollette, wallet, stats, eventi narrativi.

**Implicazione V1:** già oggi i `MatchOddsBoard` sono pubblici-per-lega de facto, perché sono calcolati deterministicamente dal seed del savegame e dai dati delle squadre. Quando arriverà il sync multiplayer basterà spostarli da `BettingCareerData` (per-career) a `LeagueBettingShared` (per-lega) senza toccare il resto dell'API.

**Niente da fare ora**, solo non blindarsi su strutture che impediscano questa estensione (la spec già non lo fa).

---

## 16. Checklist di compatibilità

Prima di considerare l'integrazione "finita":

- [ ] `Team.balance` debit/credit funziona, anche durante avanzamento giornata (sync)
- [ ] `MatchResult.scorers` ha tutti i dati per resolver marcatori (playerId, note autogol)
- [ ] `MatchResult.events` ha tutti i kind richiesti dai resolver (yellow, red, corner, penalty)
- [ ] Save/load: scommessa piazzata → close gioco → riapri → ancora aperta nello stato corretto
- [ ] Avanza giornata: matchday N+1 ha tutte le quote, matchday N ha tutte le bollette settled
- [ ] Live: durante replay le quote cambiano almeno su gol e rossi
- [ ] Cash out: valore mostrato coerente con la sezione 6.5
- [ ] UI: nessuna regressione del design system gold+onyx
- [ ] Performance: generare 10 boards (10 partite) sotto i 200ms su mobile mid-range
- [ ] Persistence: save < 5MB anche con 500 bet settled

---

## 16. LeagueBettingConfig (parametri per-competizione)

Ogni competizione ha parametri Poisson e bookmaker diversi (Serie A non è Champions, Serie A non è Serie B). Il modulo li gestisce via `LeagueBettingConfig` esportato da `$engine/betting`.

### 16.1 Config disponibili V1

| Config ID | Label | avgGoalsHome | avgGoalsAway | homeAdv | ρ Dixon | marginFactor | refReputation |
|---|---|---|---|---|---|---|---|
| `tier1_league` | Lega Pro Stelle (=Serie A) | 1.45 | 1.15 | 1.30 | -0.18 | 1.00 | 72 |
| `tier2_league` | Serie d'Argento (=Serie B) | 1.32 | 1.05 | 1.33 | -0.16 | 1.10 | 45 |
| `champions_league` | Stelle d'Europa | 1.55 | 1.35 | 1.22 | -0.17 | 0.90 | 82 |
| `europa_league` | Coppa Continentale | 1.50 | 1.30 | 1.25 | -0.17 | 0.95 | 70 |
| `conference_league` | Coppa Stelle Minori | 1.65 | 1.45 | 1.27 | -0.15 | 1.00 | 58 |
| `national_teams` | Nazionali | 1.55 | 1.20 | 1.20 | -0.16 | 0.95 | 75 |

**Razionale calibrazione:**
- **Champions League** → più gol attesi (più qualità offensiva), home advantage ridotto (campioni si trovano dappertutto), margine bookmaker ridotto (mercati liquidi).
- **Serie B** → meno gol, home advantage leggermente maggiore (atmosfera campi minori), margine bookmaker più alto (meno liquidità).
- **Conference League** → più gol per gap qualitativo, ρ meno negativo (meno pareggi 0-0 rispetto top tier).

### 16.2 Lookup automatico

```typescript
import { resolveLeagueConfig } from '$engine/betting'

const config = resolveLeagueConfig(career, fixture.leagueId)
// Risolve via tier + nome lega. Quando l'altra chat aggiunge le coppe europee,
// il match avviene automaticamente sui name keywords ("champion", "europa", "conference").
```

### 16.3 Aggiungere nuove competizioni

Quando si aggiungono nuove leghe (es. Coppa Italia):

1. Crea config in `src/engine/betting/config.ts`:

```typescript
export const CONFIG_COPPA_ITALIA: LeagueBettingConfig = {
  id: 'coppa_italia',
  label: 'Coppa Italia',
  avgGoalsHome: 1.60,    // partite a eliminazione, più offensive
  avgGoalsAway: 1.30,
  homeAdvantage: 1.25,
  dixonColesRho: -0.17,
  htGoalShare: 0.40,
  marginFactor: 1.0,
  refReputation: 65,
}
```

2. Aggiungi al registry `ALL_LEAGUE_CONFIGS`.
3. Estendi `resolveLeagueConfigByTier()` con un keyword match sul nome.

### 16.4 Validazione realismo

Il test `engine.test.ts > computeLambdas + config per-lega` valida:
- Champions produce λ totali > Serie A
- Serie B produce λ totali < Serie A
- λ home > λ away in tutte le config (homeAdvantage > 1)

---

## 17. Glossario rapido

| Termine | Significato |
|---|---|
| **Quota decimale** | Formato europeo, es. 2.50. Vincita = stake × quota. |
| **Margine / Overround** | Σ(1/quote) − 1, di solito 4-10% per mercato. |
| **Probabilità "vera"** | Stima del modello, senza margine. |
| **Probabilità implicita** | 1/quota, include il margine. |
| **xG** | Expected goals, λ Poisson. |
| **AH** | Asian Handicap. |
| **DC** | Doppia Chance (1X, X2, 12). |
| **BTTS** | Both Teams To Score (Goal/No Goal). |
| **HT/FT** | Halftime/Fulltime. |
| **Push** | Pareggio in AH → stake refund. |
| **Half-loss** | In AH quarter line, metà stake persa, metà push. |
| **Cash out** | Chiusura anticipata bolletta a valore residuo. |
| **Correlation tax** | Riduzione quota combinata per selezioni correlate. |
| **Free bet** | Stake bonus, vincita = (odds−1) × stake. |

---

---

## 18. Test suite

Tutto è validato da `npm test` (vitest). 68 test su 4 file:

```
src/engine/betting/__tests__/
├── fixtures.ts              Player/Team/scenari riusabili (top, sbilanciato, underdog)
├── engine.test.ts (17 test) Dixon-Coles, p1X2, overround, lambda per-lega
├── markets.test.ts  (8 test) generatore mercati, range quote, scenari realistici
├── slip-settlement.test.ts (28 test) schedina + resolver settlement
└── integrity.test.ts (15 test) cap dinamici, debit/credit, cash out, integrità
```

**Script:**
- `npm test` — esegue una volta
- `npm run test:watch` — modalità watch
- `npm run test:ui` — UI grafica vitest

**Cose validate dai test:**
- Σ probabilità 1X2 = 1 (Dixon-Coles normalizzata)
- Lambda Champions > Serie A > Serie B (per-lega config)
- Quote 1X2 Inter-Empoli in range mercato (casa 1.20-1.85, trasferta 3.50-15)
- Top match: nessuna quota < 1.40 (equilibrio)
- Margine 1X2 in range 3-9%
- Tutte le quote tra 1.01 e 250
- Marcatori con quote 1.30-50 (post-filter)
- Sistema 3 su 5 genera 10 combinazioni
- Multipla con 1 selezione persa → bolletta lost
- Cash out bloccato se selezione persa o mercato sospeso
- Cap dinamici da Team.balance: €100M→€1M stake/payout, €500k→€5k stake
- AH 0 (linea pari): pareggio → void
- DNB (Draw No Bet) pareggio → void
- Autogol non conta per first scorer / anytime scorer
- Cooldown loss streak blocca dopo 5 perdite

---

**Fine BETTING_SPEC.md** — versione 1.0.2

**Cambi v1.0.0 → v1.0.2:**
- v1.0.1: regola integrità (no propria squadra), nota multiplayer V2
- v1.0.2: LeagueBettingConfig per-lega, cap dinamici da Team.balance, sistema promozioni seedato, MAX_ODDS 250, post-filter marcatori, 68 test vitest

Prossimi step per l'altra chat: vedi [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md).
