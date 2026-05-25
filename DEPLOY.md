# Deploy del progetto online — guida per Roberto

Obiettivo: avere il gioco **live su un URL pubblico**, con auto-deploy ogni volta che facciamo modifiche. Costo: **0€/mese**.

Stack: **GitHub** (codice) → **Cloudflare Pages** (hosting). Tutto da browser, **zero terminale**.

---

## Step 1 — Account GitHub (se non ne hai uno)

1. Vai su https://github.com/signup
2. Usa la tua email `roberto.ramazio@gmail.com` (o un'altra, non importa)
3. Scegli uno username (es. `roberto-ramazio`)
4. Verifica l'email

> Se hai già un account GitHub, salta questo step.

---

## Step 2 — Crea un repository su GitHub

1. Vai su https://github.com/new (devi essere loggato)
2. Compila i campi così:
   - **Repository name:** `football-manager`
   - **Description:** `Manageriale calcistico online, gratis e completo`
   - **Visibility:** `Public` (consigliato — Cloudflare Pages free funziona anche con private, ma public è più semplice e ti fa apparire il progetto su GitHub)
   - **NON spuntare** "Add a README file", "Add .gitignore", "Add license" (li abbiamo già nel progetto)
3. Clicca **Create repository**

GitHub ti mostrerà una pagina con istruzioni. **Copiami l'URL del repo** — appare in alto, qualcosa tipo:
```
https://github.com/TUO-USERNAME/football-manager.git
```

---

## Step 3 — Push del codice (lo faccio io)

Una volta che mi dai l'URL del repo, eseguo io i comandi di push. La prima volta git ti chiederà di autenticarti — partirà automaticamente una finestra del browser per il login GitHub. Devi solo:
1. Cliccare **Authorize** quando appare la pagina di autorizzazione
2. Tornare qui

> Se la finestra non parte automaticamente, ti dirò io cosa fare.

---

## Step 4 — Account Cloudflare (se non ne hai uno)

1. Vai su https://dash.cloudflare.com/sign-up
2. Email + password (puoi usare la stessa di GitHub)
3. Verifica l'email
4. **Salta il setup del dominio** (puoi sempre aggiungere un dominio dopo, gratis basta cloudflare-pages.dev)

---

## Step 5 — Collega Cloudflare Pages al tuo repo GitHub

1. Loggato su Cloudflare, vai su https://dash.cloudflare.com/?to=/:account/workers-and-pages
2. Clicca **Create application** → tab **Pages** → **Connect to Git**
3. Clicca **Connect GitHub** → si apre una finestra dove autorizzi Cloudflare a leggere i tuoi repo
   - Puoi scegliere "All repositories" o solo `football-manager`
4. Torni alla pagina Cloudflare → **seleziona il repo `football-manager`** → **Begin setup**
5. Configurazione build — usa esattamente questi valori:

   | Campo | Valore |
   |-------|--------|
   | Project name | `football-manager` |
   | Production branch | `main` |
   | Framework preset | `Svelte` (se non c'è scegli `None`) |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | (lascia vuoto) |
   | Environment variables | (nessuna per ora) |

6. Clicca **Save and Deploy**

Cloudflare comincerà la build. Dopo ~2 minuti vedrai un URL tipo:
```
https://football-manager.pages.dev
```

**Quello è il tuo gioco online**. 🎉

---

## Cosa succede dopo

Ogni volta che facciamo modifiche al codice, io committo e pusho su GitHub. Cloudflare Pages **rileva il push e ribuilda automaticamente in ~2 minuti**. Tu non devi fare nulla.

Se vuoi un dominio personalizzato (tipo `iltuogioco.it`):
- Lo registri su Cloudflare Domains (costa il prezzo del dominio, niente fee aggiuntivi — circa 8-12€/anno per `.com` o `.it`)
- Lo colleghi a Pages in 2 click

---

## Limiti free tier Cloudflare Pages

- **500 build/mese** (più che sufficienti — circa 16 deploy al giorno)
- **Bandwidth illimitato** (sì, davvero)
- **Numero richieste illimitato** sui file statici
- Domini personalizzati gratuiti
- HTTPS automatico

In sostanza: il gioco potrebbe avere 100.000 utenti al mese e continueremmo a stare gratis. Se mai dovessimo crescere fuori dai limiti free, parliamo di euro singoli al mese.
