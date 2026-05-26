# Guida integrazione — Sistema Scommesse

> Step-by-step concreti per attivare il modulo `src/engine/betting/` nel gioco.
> Per il **perché** delle scelte tecniche vedi [BETTING_SPEC.md](./BETTING_SPEC.md).

---

## Step 1 — Implementare i due resolver mancanti

Il modulo è agnostico rispetto a "come si decide chi gioca titolare" e "come si calcola la forma". Servono due funzioni adapter che già conoscono il gestionale.

### 1.1 LineupResolver

Crea `src/engine/betting/resolvers.ts` (o equivalente) e implementa:

```typescript
import type { Career, Player, Fixture } from '$engine/types' // o tipi corretti
import type { LineupResolver } from '$engine/betting/orchestrator'

export const defaultLineupResolver: LineupResolver = {
  resolve(career, teamId, fixture) {
    // 1. Se l'utente è il manager della squadra, usa career.club.lineup
    if (career.club.teamId === teamId) {
      return career.club.lineup.starters
        .map(id => career.players[id])
        .filter(Boolean)
    }
    // 2. Altrimenti scegli gli 11 migliori per ruolo dalla rosa
    const roster = Object.values(career.players).filter(p => p.teamId === teamId)
    return pickBestLineup(roster, /*formation*/ '4-3-3')
  }
}

function pickBestLineup(players: Player[], formation: string): Player[] {
  // 1 GK + N CB + ... in base alla formation
  // Per ogni slot, prendi il giocatore con overall più alto disponibile
  // Filtra fitness >= 60 (chi è troppo stanco resta in panchina)
  // ...
}
```

**Note:**
- Se hai già una funzione `expectedLineup(team, formation)` nel gioco, usala.
- Per V1 va bene anche "tutti gli 11 con fitness più alto per ruolo".
- L'algoritmo non deve essere perfetto: il modello probabilistico tollera errori del ±5%.

### 1.2 FormResolver

```typescript
import type { FormResolver } from '$engine/betting/orchestrator'

export const defaultFormResolver: FormResolver = {
  resolve(career, teamId, fixture, lastN = 5) {
    // Ultime N partite *giocate* (status === 'played') prima della fixture
    const past = career.fixtures
      .filter(f =>
        f.status === 'played' &&
        (f.homeId === teamId || f.awayId === teamId) &&
        f.date < fixture.date
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, lastN)

    if (past.length === 0) return 0

    let score = 0
    for (const f of past) {
      const isHome = f.homeId === teamId
      const myGoals = isHome ? f.result!.homeScore : f.result!.awayScore
      const oppGoals = isHome ? f.result!.awayScore : f.result!.homeScore
      if (myGoals > oppGoals) score += 0.10
      else if (myGoals === oppGoals) score += 0
      else score -= 0.08
    }
    // Normalizza nell'intervallo -0.30..+0.30
    return Math.max(-0.30, Math.min(0.30, score / past.length * 3))
  }
}
```

### 1.3 DerbyDetector (opzionale)

```typescript
export function isDerby(career: Career, fixture: Fixture): boolean {
  const a = career.teams[fixture.homeId]
  const b = career.teams[fixture.awayId]
  return a?.city === b?.city
}
```

---

## Step 2 — Wiring in entry point del gioco

In `src/main.ts` (o dove si bootstrappa l'app) aggiungi:

```typescript
import { setBettingHooks, generateOdds, rolloverIfNeeded } from '$state/betting.svelte'
import { defaultLineupResolver, defaultFormResolver, isDerby } from '$engine/betting/resolvers'

setBettingHooks({
  lineupResolver: defaultLineupResolver,
  formResolver: defaultFormResolver,
  derbyDetector: isDerby,
})
```

Dopo `loadActiveCareer()` (in `src/state/career.svelte.ts` o dove avviene il load):

```typescript
import { bindBettingToCareer, generateOdds, rolloverIfNeeded } from '$state/betting.svelte'

// ... dopo che career è caricata:
bindBettingToCareer()
rolloverIfNeeded()
generateOdds()  // genera quote per il matchday corrente se mancanti
```

---

## Step 3 — Hook nel replay del match

In `src/routes/Match.svelte` (o dovunque avviene il replay), per ogni evento renderizzato chiama:

```svelte
<script lang="ts">
  import { reportMatchEvent, settleFixtureMatch } from '$state/betting.svelte'
  import type { LiveContext } from '$engine/betting'

  let liveCtx: LiveContext = {
    fixtureId,
    minute: 0, second: 0,
    homeScore: 0, awayScore: 0,
    redCardsHome: 0, redCardsAway: 0,
    yellowCardsHome: 0, yellowCardsAway: 0,
    cornersHome: 0, cornersAway: 0,
    scorers: [],
    halfTimePassed: false,
    initialLambdaHome: 0,  // ← popolarli dal model pre-match (vedi sotto)
    initialLambdaAway: 0,
  }

  // Inizializzazione: leggi i λ dal board pre-match
  import { getBoard } from '$state/betting.svelte'
  $effect(() => {
    const board = getBoard(fixtureId)
    if (board) {
      // I λ originali non sono salvati nel Board pubblico, ma li possiamo derivare
      // dalle probabilità 1X2 invertendo la formula. Per semplicità: salviamo i λ
      // come metadata nel board (estensione minore: aggiungi initialLambdaHome/Away al MatchOddsBoard).
    }
  })

  async function playEvent(event: MatchEvent) {
    // Aggiorna liveCtx in base all'evento
    if (event.kind === 'goal') {
      if (event.side === 'home') liveCtx.homeScore++
      else if (event.side === 'away') liveCtx.awayScore++
      if (event.playerId) liveCtx.scorers.push(event.playerId)
    }
    if (event.kind === 'own_goal') {
      if (event.side === 'home') liveCtx.awayScore++
      else if (event.side === 'away') liveCtx.homeScore++
    }
    if (event.kind === 'red_card') {
      if (event.side === 'home') liveCtx.redCardsHome++
      else if (event.side === 'away') liveCtx.redCardsAway++
    }
    if (event.kind === 'half_time') liveCtx.halfTimePassed = true
    liveCtx.minute = event.minute
    liveCtx.second = event.second

    // Notifica il modulo betting
    reportMatchEvent(fixtureId, event, liveCtx)

    // ... animazioni esistenti
  }

  // Al full_time
  function onMatchEnd(result: MatchResult) {
    settleFixtureMatch(fixtureId, result)
  }
</script>
```

**Estensione raccomandata su `MatchOddsBoard`** (in `types.ts`): aggiungere campi `initialLambdaHome` / `initialLambdaAway` snapshot dal modello, così il LiveContext li può leggere senza dover ricalcolare il modello.

---

## Step 4 — Routing

In `src/router.ts` (svelte-spa-router) aggiungi:

```typescript
import Betting from './routes/Betting.svelte'
import BettingMatch from './routes/BettingMatch.svelte'
import BettingMyBets from './routes/BettingMyBets.svelte'
import BettingStats from './routes/BettingStats.svelte'

export const routes = {
  // ... esistenti
  '/betting': Betting,
  '/betting/match/:fixtureId': BettingMatch,
  '/betting/my-bets': BettingMyBets,
  '/betting/stats': BettingStats,
}
```

---

## Step 5 — Sidebar

In `src/lib/AppShell.svelte`:

```svelte
<nav>
  <!-- ... voci esistenti -->
  <a href="#/betting" class="sidebar-link">
    <Trophy size={18} />
    Scommesse
    {#if hasLiveMatch}
      <span class="badge-live">LIVE</span>
    {/if}
  </a>
</nav>
```

---

## Step 6 — Componenti UI (struttura raccomandata)

I mockup ASCII completi sono in `BETTING_SPEC.md` sez. 10. Lo scheletro dei file:

```
src/lib/betting/
├── SportsbookShell.svelte    Layout: header + filtri + tabs + betslip drawer
├── MatchCard.svelte           Card partita: 1X2 in evidenza + link a detail
├── MarketGroup.svelte         Accordion espandibile per gruppo mercati
├── OddsButton.svelte          Pulsante quota animato (flash su update)
├── BetSlip.svelte             Schedina sticky con tabs single/multi/sistema
├── BetSlipRow.svelte          Riga selezione con X per rimuovere
├── MyBetsList.svelte          Lista bollette aperte/risolte
├── BetReceipt.svelte          Ricevuta post-piazzamento
├── LiveBadge.svelte           Badge LIVE pulsante
├── CashOutButton.svelte       Pulsante cash out con valore
└── OddsTicker.svelte          Componente fascia live con quote che cambiano

src/routes/
├── Betting.svelte             /betting — home sportsbook
├── BettingMatch.svelte        /betting/match/:fixtureId — detail tutti i mercati
├── BettingMyBets.svelte       /betting/my-bets
└── BettingStats.svelte        /betting/stats
```

### Esempio: OddsButton.svelte

```svelte
<script lang="ts">
  import type { Selection, Market } from '$engine/betting'
  import { addToSlip } from '$state/betting.svelte'

  let { market, selection }: { market: Market, selection: Selection } = $props()

  let isSelected = $state(false)
  let priceDelta = $state(0)
  let flashUp = $state(false)
  let flashDown = $state(false)

  // Animazione flash quando la quota cambia
  $effect(() => {
    if (market.lastDelta && market.lastDelta[selection.id] !== undefined) {
      const d = market.lastDelta[selection.id]
      priceDelta = d
      if (d > 0) { flashUp = true; setTimeout(() => flashUp = false, 800) }
      if (d < 0) { flashDown = true; setTimeout(() => flashDown = false, 800) }
    }
  })

  function onClick() {
    if (market.status !== 'open') return
    addToSlip({
      fixtureId: market.fixtureId,
      marketId: market.id,
      selectionId: selection.id,
      snapshotOdds: selection.odds,
      snapshotLabel: `${selection.label} @ ${selection.odds.toFixed(2)}`,
      isLive: market.isLive,
      addedAt: Date.now(),
    })
    isSelected = true
  }
</script>

<button
  onclick={onClick}
  disabled={market.status !== 'open'}
  class="odds-btn"
  class:selected={isSelected}
  class:flash-up={flashUp}
  class:flash-down={flashDown}
  class:suspended={market.status === 'suspended'}
>
  <span class="label">{selection.label}</span>
  <span class="odds">{selection.odds.toFixed(2)}</span>
  {#if priceDelta !== 0}
    <span class="delta">{priceDelta > 0 ? '▲' : '▼'}</span>
  {/if}
</button>

<style>
  .odds-btn {
    @apply px-3 py-2 rounded-xl bg-onyx-700 border border-gold-500/30
           text-gold-100 hover:border-gold-500 transition;
  }
  .selected { @apply bg-gold-500 text-onyx-950 font-bold border-gold-500; }
  .flash-up { @apply ring-2 ring-emerald-400; animation: flash 800ms; }
  .flash-down { @apply ring-2 ring-red-400; animation: flash 800ms; }
  .suspended { @apply opacity-50 cursor-not-allowed; }
  @keyframes flash { 0% { opacity: 0.6 } 100% { opacity: 1 } }
</style>
```

---

## Step 7 — Persistenza

Niente da fare: il `BettingCareerData` è dentro `Career` e viene già serializzato dal sistema di save esistente.

Verifica solo che `JSON.stringify(career)` non lanci errori (i tipi sono progettati JSON-safe, ma test rapidi sono saggi).

---

## Step 8 — Test rapidi

Crea uno smoke test in `src/engine/betting/__tests__/smoke.ts` (o esegui via console browser):

```typescript
import { buildMatchProbabilityModel, buildTeamInput, p1X2, priceMarket, computeMargin } from '$engine/betting'

// Esempio "Inter vs Empoli" (vedi BETTING_SPEC.md sez. 13.1)
const home = buildTeamInput({
  team: {} as any, isHome: true,
  attackingOverall: 82, defensiveOverall: 79,
  formIndex: 0.15, fitnessAvg: 88, moraleAvg: 75,
})
const away = buildTeamInput({
  team: {} as any, isHome: false,
  attackingOverall: 68, defensiveOverall: 70,
  formIndex: -0.05, fitnessAvg: 75, moraleAvg: 60,
  injuredKeyPlayers: 1,
})

const model = buildMatchProbabilityModel(home, away,
  { attack: 82, defense: 79 },
  { attack: 68, defense: 70 },
  0.92)

console.log('λ home:', model.lambdaHome.toFixed(2))
console.log('λ away:', model.lambdaAway.toFixed(2))

const probs = p1X2(model.probMatrix)
console.log('P(1):', probs.home.toFixed(3))
console.log('P(X):', probs.draw.toFixed(3))
console.log('P(2):', probs.away.toFixed(3))
console.log('Σ:', (probs.home + probs.draw + probs.away).toFixed(3))   // → ≈1.000

const odds = priceMarket([probs.home, probs.draw, probs.away], '1X2', 0.92)
console.log('Quote 1X2:', odds)
console.log('Overround:', (computeMargin(odds) * 100).toFixed(2), '%')   // → ≈5-6%
```

Risultato atteso:
- λ home ≈ 2.5-3.5
- λ away ≈ 0.7-1.2
- P(1) ≈ 0.60-0.70
- Overround ≈ 5-7%

Se i numeri sono lontani da questi, c'è un bug nel modello (più probabile nel mio codice che nella matematica — apri issue).

---

## Step 9 — Fine-tuning iterativo

Dopo la prima integrazione, è normale che le quote sembrino "strane" su alcuni casi. Variabili da tweakare:

| Sintomo | Variabile da toccare | Dove |
|---|---|---|
| Troppi pareggi | `DIXON_COLES_RHO` (più negativo = meno pareggi) | `oddsEngine.ts` |
| Casa troppo favorita | `homeAdvantage` default 1.30 → 1.25 | costruzione `TeamStrengthInput` |
| Marcatori con quote troppo alte | `BASE_CONVERSION` 0.105 → 0.115 | `oddsEngine.ts` |
| Margini troppo bassi/alti | `MARGIN_TABLE` per mercato | `overround.ts` |
| Live: quote post-gol non scendono abbastanza | adjustment `lead` in `residualLambdas` | `liveOddsUpdater.ts` |

Tutti i parametri sono costanti esportate o documentate in `BETTING_SPEC.md` sez. 3 e 5.

---

## Checklist finale prima di shippare

- [ ] `npm run typecheck` passa pulito
- [ ] Creo nuova carriera → `bettingCareerData` viene inizializzato
- [ ] Carico save vecchio → nessun crash, modulo si auto-inizializza
- [ ] Apro `/betting` → vedo lista partite con quote
- [ ] Apro match detail → vedo tutti i 28 mercati raggruppati
- [ ] Aggiungo selezione a schedina → appare in BetSlip
- [ ] Piazzo singola → `Team.balance` scende, bolletta in `/betting/my-bets`
- [ ] Avvio replay → quote diventano "live", flashano su gol
- [ ] Full time → bolletta auto-risolta, payout creditato se vincente
- [ ] Cash out → funziona durante il replay
- [ ] Avanza giornata → si genera nuovo board, vecchi settled puliti
- [ ] Save → reload → tutto preservato

---

## Domande aperte di product (da chiarire prima di V2)

Vedi anche `BETTING_SPEC.md` sez. 15.4:

1. Si possono scommettere partite di **altre leghe** (Champions, ecc.) o solo Serie A V1?
2. Cosa succede se utente scommette sulla **propria squadra**? Solo avviso o blocco?
3. Il **manager rivale AI** può scommettere a sua volta? (V2 narrative)
4. Quante e quali **promozioni** generare di default? RNG seeded sul savegame?

Fammi sapere e le aggiungo alla spec.
