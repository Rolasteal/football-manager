# Sistema Scommesse Sportive — Spec & Modulo

> **Status:** v1.0.0 — pronto per integrazione
> **Owner:** Roberto Ramazio
> **Stack:** Svelte 5 + TypeScript + IndexedDB (zero backend)

## Indice documenti

| File | Cosa contiene |
|---|---|
| **[BETTING_SPEC.md](./BETTING_SPEC.md)** | **Documento maestro.** Architettura, formule complete, 28 mercati, live engine, schedina, settlement, mockup UI, esempi numerici, contratto integrazione. **Leggi questo prima di tutto.** |
| **[IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)** | Guida operativa step-by-step per integrare il modulo nel gioco: hook necessari, routing, componenti UI da creare, fine-tuning. |

## Cosa è stato consegnato

### Codice TypeScript (compilabile, zero errori)

```
src/engine/betting/
├── types.ts                 Interfacce pubbliche del dominio
├── seed.ts                  RNG deterministico (mulberry32)
├── oddsEngine.ts            Dixon-Coles bivariata + derivati
├── overround.ts             Margine bookmaker (power method)
├── marketsGenerator.ts      Builder dei 28 mercati Bet365-tier
├── bankroll.ts              Wallet col Team.balance + safeguard
├── betSlip.ts               Schedina singola/multipla/sistema
├── settlement.ts            Resolver per ogni mercato, payout
├── liveOddsUpdater.ts       Ricalcolo quote durante replay match
├── cashout.ts               Valore cash out anticipato
├── init.ts                  Factory BettingCareerData
├── orchestrator.ts          API high-level (placeBet, settleMatch, ...)
└── index.ts                 Public API (import { ... } from '$engine/betting')

src/state/
└── betting.svelte.ts        Store Svelte 5 con $state runes
```

### Modifiche al codebase esistente

- **`src/engine/career/types.ts`** — aggiunto campo opzionale `bettingCareerData?: BettingCareerData` su `Career`. Backward-compatibile coi save vecchi (l'orchestrator inizializza al volo).

### Cosa il modulo fa già

1. **Genera quote AI** per qualsiasi fixture data una formazione (modello Dixon-Coles + 18 attributi giocatore, forma, fitness, morale, fattore casa).
2. **Produce 28 mercati** per partita: 1X2, U/O multipli, BTTS, doppia chance, handicap europeo + asiatico (11 linee), marcatori (anytime/primo/ultimo/2+/hat-trick), risultato esatto, primo/secondo tempo, combo, cartellini, corner, rigori, espulsioni.
3. **Applica margine bookmaker** con power method, margini target per mercato (es. 5% su 1X2, 13% su marcatori), modulazione top/small match.
4. **Aggiorna quote live** durante il replay del match: residual xG + adjustment red card + lead control. Sospende mercati impattati per 8-15s su goal/red/penalty.
5. **Schedina** singola/multipla/sistema con correlation tax, bonus multipla (4-25%), validazione conflitti.
6. **Risolve bollette** con resolver per ogni mercato (gestisce push, half-loss handicap asiatico, void).
7. **Cash out** anticipato (8% margine bookmaker).
8. **Bankroll** integrato col `Team.balance` con limiti opzionali (max stake, max loss, cooldown).
9. **Stats** del giocatore (ROI, yield, streak, mercato preferito).
10. **Persistenza** nel `Career` blob, serializzabile JSON, niente extra IndexedDB store.

### Cosa serve dall'altra chat

Per attivare il modulo serve solo wiring lato gioco — vedi [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md):

- **Lineup resolver** (gli 11 attesi per ogni fixture)
- **Form resolver** (indice forma -0.3..+0.3)
- **Hook nel match replay** per emettere `MatchEvent` al modulo betting
- **4 route Svelte** (`/betting`, `/betting/match/:id`, `/betting/my-bets`, `/betting/stats`)
- **Voce sidebar** "Scommesse" in `AppShell.svelte`
- **Componenti UI** (mockup completo in `BETTING_SPEC.md` sez. 10)

## Decisioni di design chiave

| Decisione | Scelta | Motivazione |
|---|---|---|
| **Mercati** | Top-tier (~28 per partita) | Bet365-like, differenziante vs altri gestionali |
| **Live betting** | Sì, sfruttando il replay come event stream | Spettacolare durante match cinematografico |
| **Bankroll** | Stessa cassa del club | Scelta del product owner: realismo + rischio |
| **Schedina** | Singola + Multipla + Sistema | Standard italiano completo |
| **Persistenza** | Tutto in `Career` blob (no store separato) | Coerente col pattern esistente |
| **Modello prob.** | Dixon-Coles 8x8 con ρ=-0.18 | Standard accademico, migliore di Poisson semplice sui risultati bassi |
| **Margine** | Power method | Più accurato del proporzionale per quote alte |

## Per testare il modulo isolatamente

```typescript
import {
  buildMatchProbabilityModel,
  buildTeamInput,
  buildOddsBoard,
  p1X2,
  priceMarket,
} from '$engine/betting'

const home = buildTeamInput({
  team: someTeam,
  isHome: true,
  attackingOverall: 82,
  defensiveOverall: 79,
  formIndex: 0.15,
  fitnessAvg: 88,
  moraleAvg: 75,
})
const away = buildTeamInput({
  team: otherTeam,
  isHome: false,
  attackingOverall: 68,
  defensiveOverall: 70,
  formIndex: -0.05,
  fitnessAvg: 75,
  moraleAvg: 60,
  injuredKeyPlayers: 1,
})

const model = buildMatchProbabilityModel(home, away,
  { attack: 82, defense: 79 },
  { attack: 68, defense: 70 },
  0.92)

const probs = p1X2(model.probMatrix)
// probs = { home: 0.66, draw: 0.20, away: 0.14 }

const odds = priceMarket([probs.home, probs.draw, probs.away], '1X2', 0.92)
// odds ≈ [1.51, 4.39, 6.65]
```

## Riferimenti

- Spec maestra: [BETTING_SPEC.md](./BETTING_SPEC.md) (1300+ righe, riferimento autoritativo)
- Guida integrazione: [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
- Bibliografia formule: Dixon & Coles (1997), "Modelling association football scores and inefficiencies in the football betting market"
