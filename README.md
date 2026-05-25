# Football Manager

Un manageriale calcistico **completo, gratuito e online**. Costruisci il tuo club dal nulla: rosa, allenamenti, tattiche, mercato, stadio, sponsor, finanze.

> Stato: **Alpha — Fase 0** (scaffolding iniziale).

## Stack

- **Frontend:** [Svelte 5](https://svelte.dev/) + TypeScript + [Vite](https://vite.dev/)
- **UI:** [Tailwind CSS v4](https://tailwindcss.com/) + [Lucide icons](https://lucide.dev/)
- **Routing:** `svelte-spa-router` (hash-based, perfetto per SPA statica)
- **Render partite:** [PixiJS](https://pixijs.com/) (canvas/WebGL)
- **Persistenza locale:** IndexedDB via [`idb`](https://github.com/jakearchibald/idb)
- **Hosting (target):** [Cloudflare Pages](https://pages.cloudflare.com/) (gratis, CDN globale)

## Roadmap

- **Fase 0** — Setup, scaffolding, deploy iniziale ✅
- **Fase 1** — MVP core: DB giocatori generati, lega, calendario, engine partita testuale, salvataggio
- **Fase 2** — Profondità calcistica: mercato, allenamenti, tattiche, infortuni, morale
- **Fase 3** — Gestione club: finanze, sponsor, stadio, biglietti
- **Fase 4** — Multi-match live con interruzioni gol da altri campi
- **Fase 5** — Upgrade match view a 2D top-down completo con fisica
- **Fase 6+** — Fantacalcio integrato, scommesse sportive in-game, dinamiche FC26-like, multiplayer

## Sviluppo locale

```bash
npm install
npm run dev        # dev server su http://localhost:5173
npm run build      # build di produzione → dist/
npm run preview    # serve la build per testarla
npm run check      # type-check Svelte + TS
```

## Struttura del progetto

```
src/
├── routes/      # pagine (Home, NewCareer, Settings, NotFound)
├── lib/         # componenti UI riutilizzabili
├── engine/      # logica di gioco PURA (nessuna dipendenza DOM/UI)
│   ├── match/   # engine partita + tipi MatchEvent / MatchRenderer
│   └── data/    # generatori dati (giocatori, squadre, leghe)
├── storage/     # wrapper IndexedDB per i salvataggi
├── state/       # Svelte stores condivisi
├── app.css      # Tailwind import + tema personalizzato
├── App.svelte   # router shell
├── main.ts      # entry point
└── router.ts    # mappa rotte
```

### Architettura match engine

**Importante:** il simulation engine produce uno stream di `MatchEvent` con coordinate spaziali `(x, y)` di palla e giocatori. Il renderer attuale ("2D semplificato") consuma solo gli eventi chiave, ma i dati spaziali sono già nello stream — questo permetterà di aggiungere in futuro un **renderer 2D top-down completo** senza modificare l'engine. Vedi [`src/engine/match/types.ts`](src/engine/match/types.ts).

## Note legali

Nessun nome reale di giocatori, squadre o leghe è incluso (per evitare problemi con FIFPro e leghe). Il gioco usa nomi generati. È prevista una modalità "import database" per chi voglia caricare i propri dati.

## Licenza

TBD.
