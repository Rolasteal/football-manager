# Football Manager — Recap sessione (Fase 0 setup + redesign landing)

> **Come usare questo file:** incollalo come primo messaggio in una nuova chat
> Claude Code per ripartire esattamente da qui. La cartella di lavoro è già
> configurata su `W:\Claude\Football Manager` e Claude carica automaticamente
> la memoria persistente da `C:\Users\roberto.ramazio\.claude\projects\W--Claude-Football-Manager\memory\`.

---

## 🎯 Obiettivo generale

Sviluppare un **manageriale calcistico browser-based** ispirato a Football Manager:
- **Single-player offline-first** (poi multiplayer in fasi successive)
- **100% gratuito** per l'utente, hosting target 0€/mese
- Visualizzazione partite **"2D semplificato + commentario"**, ma engine **architettato per upgrade futuro a 2D top-down completo**
- Roadmap: Fase 0 setup ✅ → Fase 1 MVP core → Fase 2 profondità calcistica → Fase 3 club mgmt → Fase 4 multi-match live → Fase 5 match view 2D → Fase 6+ espansioni (fantacalcio, scommesse in-game, FC26-like, multiplayer)

### Ruoli
- **Roberto Ramazio** (`roberto.ramazio@gmail.com`) — proprietario/game designer, **non sviluppatore**. Decide feature e game design, non scrive codice.
- **Claude (assistant)** — fa tutto il lavoro tecnico: codice, setup, deploy, debug.

---

## ✅ Cosa abbiamo fatto in questa sessione

### Fase 0 — Setup completo
1. Scaffolding progetto Svelte 5 + TypeScript + Vite
2. Installato Tailwind CSS v4, PixiJS, `idb`, `svelte-spa-router`, `@lucide/svelte`
3. Path alias TS (`$lib`, `$engine`, `$routes`, `$storage`, `$state`)
4. Struttura cartelle definitiva (vedi sotto)
5. Engine types base + storage IndexedDB
6. Landing page **prima versione** (custom HTML/CSS verde+blu — poi cambiata)
7. Git init + 2 commit iniziali

### Setup deploy online (con Roberto interattivo via screenshot)
8. Repo creato: **https://github.com/Rolasteal/football-manager** (public)
9. Account Cloudflare Pages + connessione GitHub via app GitHub
10. Build settings: framework Svelte, build `npm run build`, output `dist`
11. Primo deploy fallito (binding `@rolldown/binding-win32-x64-msvc` in devDependencies → EBADPLATFORM su runner Linux)
12. **Fix:** spostato binding in `optionalDependencies` → deploy verde
13. **Sito live: https://football-manager-cam.pages.dev** — auto-deploy automatico ad ogni push su `main`

### Redesign landing (cambio identità visiva)
14. Roberto ha condiviso un mockup ChatGPT Image 2 con nuova identità: **nero profondo + oro caldo + bianco metallizzato**
15. Prima tentativo: ricostruito tutto in CSS/HTML con nuova palette gold/onyx — **bocciato** da Roberto (troppo diverso dal mockup, effetti 3D non replicabili in CSS)
16. **Decisione architetturale:** usare il **PNG del mockup come hero a tutto schermo** + hitbox HTML trasparenti sopra i bottoni dell'immagine. Pixel-perfect identico, click funzionano.
17. Container con `aspect-ratio: 1536/1024` e letterboxing nero per viewport con proporzioni diverse
18. Implementata **modalità debug** (tasto `D` o `?debug` in URL) che colora le hitbox in rosa/ciano per calibrazione visiva
19. Calibrazione iterativa dei bottoni "Nuova Carriera" e "Nessun Salvataggio" tramite screenshot

---

## 🏗️ Decisioni tecniche prese

| Aspetto | Decisione | Perché |
|---------|-----------|--------|
| Modalità gioco | Single-player offline-first | Più semplice, multiplayer aggiungibile dopo |
| Match view | 2D semplificato + commentario | Bello e fattibile; ENGINE pronto per upgrade futuro a 2D top-down completo |
| Stack frontend | Svelte 5 + TS + Vite + Tailwind v4 | Leggero, moderno, free tier ottimo |
| Routing | `svelte-spa-router` (hash-based) | Perfetto per static hosting Cloudflare Pages |
| Match rendering | PixiJS (installato, non ancora usato) | Standard de facto giochi 2D browser |
| Persistenza | IndexedDB via `idb` | Single-player offline-first |
| Hosting | Cloudflare Pages | Free tier più generoso del mercato |
| Backend futuro | Cloudflare Workers + D1 (SQLite) | 0€/mese fino a tanti utenti |
| Licenze | NESSUN nome reale di giocatori/squadre/leghe | Evitare problemi FIFPro/leghe; modalità "import database" futura |
| Landing approach | PNG hero full-screen + hitbox HTML | Replica 100% del mockup, no compromessi visivi |
| Architettura engine | Engine PURO separato dalla view | Permette upgrade renderer 2D senza toccare engine ([[project-match-view-2d-topdown]]) |

---

## 📁 File toccati — lista completa

### Repo path: `W:\Claude\Football Manager\`

#### Config
- `package.json` — deps + scripts; binding rolldown in **optionalDependencies** (regola chiave)
- `package-lock.json`
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — TS config + path alias
- `vite.config.ts` — Vite + Tailwind plugin + alias + `__APP_VERSION__` define
- `svelte.config.js`
- `index.html` — HTML root, preload Google Fonts + hero PNG, title in italiano
- `.gitignore` — node_modules, dist, .env, .claude/
- `.env.example`
- `README.md` — descrizione progetto + roadmap
- `DEPLOY.md` — guida completa deploy GitHub + Cloudflare (step-by-step browser-only)

#### `public/`
- `public/_redirects` — `/* /index.html 200` (SPA hash routing Cloudflare)
- `public/favicon.svg` — pallone da calcio stilizzato
- `public/assets/hero-mockup.png` — **mockup ufficiale 1536×1024, 1.9MB** (lo userà come hero della landing)

#### `src/` — struttura
- `src/main.ts` — entry, mount App
- `src/app.css` — Tailwind import + tema custom (palette gold + onyx + pitch + animazioni + componenti `.stadium-bg`, `.btn-gold`, `.card-gold`, `.text-metallic`, `.text-gold`...)
- `src/App.svelte` — router shell `<Router {routes} />`
- `src/router.ts` — route map
- `src/vite-env.d.ts` — declare `__APP_VERSION__`
- `src/assets/.gitkeep`

#### `src/routes/`
- `src/routes/Home.svelte` — **landing pixel-perfect**: hero PNG + hitbox HTML + debug mode tasto D
- `src/routes/NewCareer.svelte` — placeholder Fase 1
- `src/routes/Settings.svelte` — placeholder Fase 1
- `src/routes/NotFound.svelte` — 404 stilizzato gold

#### `src/lib/`
- `src/lib/TrophyOrnament.svelte` — SVG trofeo dorato (non usato attualmente, riserva)
- `src/lib/.gitkeep`

#### `src/engine/` (logica di gioco pura, no DOM)
- `src/engine/index.ts` — barrel exports
- `src/engine/types.ts` — `Player`, `PlayerAttributes`, `Team`, `Stadium`, `League`, `Season`, `Position`, `Foot`
- `src/engine/match/types.ts` — `MatchEvent` (con coordinate `PitchPoint`!), `MatchSnapshot`, **`MatchRenderer` interface** (pluggable per upgrade futuro 2D)
- `src/engine/.gitkeep`

#### `src/storage/`
- `src/storage/db.ts` — wrapper IndexedDB con `idb`: `listSaves()`, `hasAnySave()`, `getSave()`, `putSave()`, `deleteSave()`, `getMeta()`, `setMeta()`. Store: `saves`, `meta`.

#### `src/state/`
- `src/state/.gitkeep` (vuoto, riservato per Svelte stores condivisi)

### Memoria persistente: `C:\Users\roberto.ramazio\.claude\projects\W--Claude-Football-Manager\memory\`
- `MEMORY.md` — indice (max 200 righe)
- `user-roberto.md` — profilo utente
- `project-football-manager.md` — vision/roadmap
- `project-tech-stack.md` — stack scelto
- `project-deploy-url.md` — repo GitHub + URL live + setup CI
- `project-design-system.md` — palette + componenti + regole d'uso
- `project-asset-wishlist.md` — lista PNG da generare con ChatGPT Image 2
- `project-match-view-2d-topdown.md` — promemoria upgrade futuro 2D top-down
- `feedback-deploy-automatici.md` — Roberto non è dev, serve automazione
- `feedback-vite-rolldown-platform.md` — regola: binding nativi in `optionalDependencies`

---

## 🟢 Stato attuale

- **Branch:** `main`
- **Ultimo commit:** `de87e10` — *fix(landing): calibra hitbox bottoni azione dal debug screenshot*
- **Build:** ✅ passa, ~24 kB gzipped (escluso il PNG hero da 1.9 MB)
- **Type-check:** ✅ 0 errors, 0 warnings
- **Auto-deploy:** ✅ funzionante, ogni push su `main` deploya in 1-3 min
- **Modalità debug landing:** ATTIVA (rimossa più avanti quando hitbox confermate OK)
- **Sito live:** https://football-manager-cam.pages.dev
- **Git history:**
  ```
  de87e10 fix(landing): calibra hitbox bottoni azione dal debug screenshot
  3b324ae feat: debug mode su landing per allineare hitbox al mockup
  416004a design: landing pixel-perfect usando il mockup come hero
  e20c5ba design: nuova identità nero+oro come da brief Roberto
  0e78255 fix: sposta binding rolldown Windows in optionalDependencies
  e6dd1bc docs: aggiungi guida deploy GitHub + Cloudflare Pages
  200ca33 Fase 0: scaffolding iniziale Football Manager
  ```

---

## 🎯 Prossimi passi immediati

1. **Roberto verifica** la calibrazione hitbox dopo `de87e10`:
   - Refresh `https://football-manager-cam.pages.dev` (Ctrl+F5)
   - Premere `D` per attivare debug
   - Inviare screenshot
   - Se le 2 hitbox d'azione ("5·NUOVA CARRIERA" e "6·NESSUN SALV.") ora coincidono con i bottoni veri → ✅ chiuso
   - Altrimenti → ulteriori micro-aggiustamenti delle percentuali
2. **Rimuovere modalità debug** (o lasciarla solo via URL `?debug`, non tasto `D`) una volta confermata calibrazione
3. **Iniziare Fase 1 — MVP core** (~2-3 settimane). Stima moduli:
   - Generatore mondo (1000+ giocatori fittizi, 2 leghe da 20 squadre, attributi 1-20)
   - Calendario stagione + simulazione altre partite
   - Engine partita testuale (timer 1°-90', commento dinamico, eventi)
   - Schermate: Dashboard squadra / Rosa / Calendario / Classifica
   - Sistema salvataggio/caricamento automatico fine giornata
4. **Chiedere a Roberto** game design decisions Fase 1: 18 o 20 squadre per lega, sistema attributi, lingue, modalità mister/proprietario, ecc.

---

## 🟡 Problemi aperti / TBD

- ⚠️ **Hitbox d'azione (Nuova Carriera / Nessun Salv.)** — in calibrazione, attendere screenshot debug post-`de87e10` da Roberto
- 🎨 **Asset PNG da generare con ChatGPT Image 2** (vedi `project-asset-wishlist.md`):
  - **Alta priorità:** `trophy-ornament.png`, `stadium-night-bg.jpg`, `crest-placeholder.png`
  - **Media:** 4 icone feature (`feature-match-live.png`, `feature-market.png`, `feature-stadium.png`, `feature-finance.png`)
  - **Bassa:** `pitch-overhead.jpg`, set ritratti giocatori generici
  - Path destinazione: `W:\Claude\Football Manager\public\assets\`
  - Prompt suggeriti nel file `project-asset-wishlist.md`
- 🏟️ **Card "MY CLUB" hardcoded nel mockup** — quando ci sarà carriera attiva, dovrà essere ricostruita in HTML/CSS (dati dinamici). Per ora va bene così perché landing iniziale = no save.
- ⚙️ **Node.js 20.15.1 sul PC di Roberto** — Vite 8 vorrebbe 20.19+. Funziona uguale (warning ignorabile) ma upgrade consigliato a Node 22 LTS quando può.
- 🔗 **Cartella di lavoro su share di rete** `\\192.168.19.20\Dati\Claude\Football Manager` → richiesta una eccezione git `safe.directory` (già applicata globalmente)

---

## 📜 Vincoli e regole emerse (importanti!)

### Su Roberto / collaborazione
- **Non è sviluppatore** → Claude fa tutto tecnicamente; Roberto risponde a domande di game design
- **Niente terminale per Roberto** → deploy automatici obbligatori, ogni passo manuale via browser
- **Risposte in italiano**
- **Roberto preferisce widget interattivi** (AskUserQuestion) quando renderizzano correttamente
- **Mai destructive git operations** senza permesso esplicito
- **Git user.name/email configurato SOLO localmente** per questo repo (`Roberto Ramazio` / `roberto.ramazio@gmail.com`)

### Tecniche
- **0€/mese target** (fallback 5€/mese su Cloudflare); ogni libreria/servizio deve rispettare free tier
- **No nomi reali** giocatori/squadre/leghe/coppe (FIFPro). Soluzione: nomi generati + futuro "import database" utente
- **Engine separato dalla view**: niente import Svelte/PixiJS sotto `src/engine/`. Tutto serializzabile in JSON.
- **MatchEvent contiene già coordinate spaziali** anche se la view "semplificata" iniziale non le userà — promemoria forte: l'engine è pronto per upgrade futuro a 2D top-down completo.
- **Binding nativi platform-specific SEMPRE in `optionalDependencies`** (mai `dependencies` o `devDependencies`) — lezione appresa dal primo deploy fallito
- **Bundle target finale**: < 2 MB gzipped
- **Niente verde nelle UI generiche** (verde = riservato per `pitch-*`, esclusivamente futuro campo da calcio)
- **Niente blu acceso** nelle UI (ambient = solo gold/amber)

### Design system (palette ufficiale dal mockup Roberto)
- **Gold:** scala completa `--color-gold-50` → `--color-gold-950` (definita in `src/app.css` @theme)
- **Onyx:** scala completa `--color-onyx-50` → `--color-onyx-950` (sfondi, testi secondari)
- **Pitch:** verde campo, RISERVATO match view futura
- **Effetto titolo metallizzato:** classe `.text-metallic` (gradient bianco→grigio)
- **Effetto titolo oro:** classe `.text-gold` (gradient `#fef3c7 → #fcd34d → #f59e0b → #b45309`)
- **Componenti CSS riusabili:** `.btn-gold`, `.btn-outline-gold`, `.btn-ghost`, `.card-gold`, `.chip-gold`, `.stadium-bg`
- **Font:** Outfit (300-900) + JetBrains Mono (caricati da Google Fonts)
- **Modalità debug landing:** tasto `D` (toggle) + `?debug` in URL

---

## 🔍 Info non ovvie dal codice / contesto

- **Cloudflare Pages project:** nome `football-manager`, URL produzione `football-manager-cam.pages.dev` (suffisso `-cam` aggiunto da Cloudflare per uniqueness)
- **PixiJS installato ma NON usato** ancora — servirà per match renderer (Fase 5)
- **Lucide icons** installati come `@lucide/svelte` (non `lucide-svelte` deprecato) — usati nelle route NewCareer/Settings/NotFound, non sulla Home (la Home è solo PNG + hitbox)
- **Aspect ratio 1536/1024 = 1.5** è il vincolo del mockup; il container CSS della home usa `aspect-ratio` per letterboxing dinamico
- **Modalità debug** mostra etichette numeriche sopra le hitbox:
  - 1·GIFT, 2·CLOUD, 3·SETTINGS (cyan circles, top-right)
  - 4·MODIFICA CLUB (pink rect, MY CLUB card right)
  - 5·NUOVA CARRIERA, 6·NESSUN SALV. (pink rects, center)
- **Trofeo SVG `TrophyOrnament.svelte`** è preservato per eventuale fallback su altre route ma NON viene usato nella Home attuale (sostituito dal trofeo nel PNG)
- **Hot-reload Vite** funziona, ma `npm run dev` mostra warning Node 20.15.1 (innocuo)
- **Cloudflare runner** è Linux Node 22.16.0, npm 10.9.2 — molto più moderno del PC di Roberto
- **Cartella `.claude/`** nella root del progetto è metadata Claude Code (in `.gitignore`)

---

## 🚀 Per ripartire al volo da una nuova chat

1. Apri Claude Code nella cartella `W:\Claude\Football Manager`
2. Incolla questo recap come primo messaggio
3. Claude caricherà automaticamente la memoria persistente
4. Punto di partenza naturale: chiedi "**Roberto ha verificato la calibrazione hitbox?**" oppure "**Partiamo con Fase 1 MVP**"

---

*Recap generato il 2026-05-25, fine sessione "Football Manager — Fase 0 setup e redesign landing".*
