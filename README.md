# Meal Duo 🍽️🐾

**Meal Duo** è una Progressive Web App mobile-first per gestire i **piani alimentari settimanali** di tutta la famiglia e generare in automatico una **lista della spesa condivisa**.

- Ogni membro ha il proprio piano (Lunedì → Domenica, pasti e alimenti con quantità e unità).
- Un **catalogo alimenti condiviso** con autocompletamento intelligente evita i duplicati («Pollo» vs «Petto di pollo») così la spesa somma con precisione.
- La **spesa** aggrega i piani, mostra il totale e il **dettaglio per membro** (`Riso basmati — 840 g · Emilio: 560g · Sara: 280g`) e si può filtrare escludendo persone o giorni.
- I dati vivono in **un solo file JSON su Google Drive** (`meal-duo-db.json`), letto e scritto da tutti i familiari. Nessun backend: tutto client-side (Google Identity Services + Drive API v3).
- Funziona **offline** (cache locale + service worker) e si sincronizza da sola.
- Stile **Liquid Glass** come da `DESIGN_SYSTEM.md` (temi Mochi chiaro / Zenitsu scuro).

> **Modalità demo:** al primo avvio l'app contiene i dati di esempio di due persone (Emilio e Sara) e funziona subito, senza login Google.

---

## Indice

1. [Avvio in locale](#1-avvio-in-locale)
2. [Struttura del progetto](#2-struttura-del-progetto)
3. [Setup Google Cloud Console](#3-setup-google-cloud-console-client-id--drive-api)
4. [Condividere il database con i familiari](#4-condividere-il-database-con-i-familiari)
5. [Sincronizzazione, offline e conflitti](#5-sincronizzazione-offline-e-conflitti)
6. [Import / export del piano in JSON](#6-import--export-del-piano-in-json)
7. [Deploy su GitHub Pages](#7-deploy-su-github-pages)
8. [Icona dell'app](#8-icona-dellapp)
9. [Test](#9-test)
10. [Decisioni di progetto](#10-decisioni-di-progetto)
11. [Checklist Design System](#11-checklist-design-system-appendice-b)
12. [Limiti noti](#12-limiti-noti)

---

## 1. Avvio in locale

Richiede Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # test del motore di spesa, merge, import/export, sync
npm run build      # typecheck + build di produzione in dist/
npm run preview    # serve la build su http://localhost:4173
```

Variabili opzionali (vedi `.env.example`), utili per non reinserire i valori ad ogni dispositivo:

| Variabile | Significato |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth (valore pubblico, non è un segreto) |
| `VITE_GOOGLE_API_KEY` | API Key, solo per il Google Picker |
| `VITE_GOOGLE_APP_ID` | Numero del progetto Cloud, solo per il Google Picker |

In alternativa si inseriscono dall'app: **Famiglia → Google Drive & Sync**.

---

## 2. Struttura del progetto

```
src/
├─ types.ts                      Member, FoodCatalogItem, MealItem, Meal, DayPlan, WeeklyPlan,
│                                ShoppingCheckState, AppDatabase …
├─ data/demo.ts                  dati di esempio (Emilio e Sara)
├─ services/
│  ├─ googleDriveService.ts      GIS (OAuth token client) + Drive v3 + Picker
│  ├─ syncEngine.ts              sync con controllo di revisione e merge
│  ├─ merge.ts                   merge last-write-wins per record (con tombstone)
│  ├─ shoppingListEngine.ts      aggregazione e filtri della spesa (funzioni pure)
│  ├─ dbOps.ts                   tutte le mutazioni (immutabili) del database
│  ├─ dbSchema.ts                validazione del DB letto da Drive / localStorage
│  └─ planIO.ts                  import/export JSON del piano
├─ lib/                          foodMatch (fuzzy), units, theme, files, ids
├─ state/                        store (DB + cache + sync), ui, overlay
├─ components/                   ui (Sheet, Segmented…), Chrome (nav, FAB, toast…), Mascots, Sheets…
└─ views/                        TodayView, WeekView, ShoppingView, FamilyView
public/icons/                    icone PWA (segnaposto → vedi §8)
public/cats/                     mascotte (segnaposto SVG → vedi §10)
scripts/generate_icons.py        genera le icone PWA da assets/icon-source.png
.github/workflows/deploy.yml     build + deploy su GitHub Pages
```

---

## 3. Setup Google Cloud Console (Client ID + Drive API)

L'app non ha un backend: ogni utente accede con il proprio account Google e l'app parla direttamente con Drive. Serve **un solo** progetto Google Cloud (lo crea chi pubblica l'app).

1. Vai su <https://console.cloud.google.com/> e **crea un progetto** (es. «Meal Duo»).
2. **API e servizi → Libreria** → abilita **Google Drive API**.
   (Per il Picker abilita anche **Google Picker API**.)
3. **API e servizi → Schermata consenso OAuth**
   - Tipo utente: **Esterno**.
   - Nome app, email di assistenza, email sviluppatore.
   - **Ambiti (scope)**: aggiungi `https://www.googleapis.com/auth/drive.file` (è uno scope *non sensibile*: non richiede la verifica di Google).
   - **Utenti di prova**: finché l'app resta in stato «Test» aggiungi gli indirizzi Gmail di **tutti i familiari** (massimo 100). In alternativa premi «Pubblica app»: per `drive.file` non serve la verifica.
4. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**
   - Tipo di applicazione: **Applicazione web**.
   - **Origini JavaScript autorizzate** (solo schema + dominio, **senza percorso**):
     - `http://localhost:5173` (sviluppo)
     - `https://<tuo-utente>.github.io` (produzione su GitHub Pages)
   - **URI di reindirizzamento**: non servono (si usa il token client GIS con popup).
   - Copia il **Client ID** (`123456-abc.apps.googleusercontent.com`).
5. *(Facoltativo, solo per «Scegli da Drive»)*
   - **Credenziali → Crea credenziali → Chiave API**, limitala a *Google Picker API* e alle origini HTTP sopra.
   - **App ID** = *numero del progetto* (Dashboard del progetto → «Numero progetto»).
6. In Meal Duo apri **Famiglia → Google Drive & Sync**, incolla il Client ID (ed eventualmente API Key e App ID) e premi **Accedi con Google**.

> Lo scope `drive.file` dà accesso **solo** ai file creati dall'app o che l'utente le ha aperto esplicitamente: Meal Duo non può leggere nient'altro del tuo Drive.

---

## 4. Condividere il database con i familiari

Il database è **un file** `meal-duo-db.json` che appartiene a chi lo crea.

### Chi crea la casa (utente principale)
1. **Famiglia → Google Drive & Sync → Accedi con Google**.
2. **Crea casa su Drive** (scegli se partire da zero o caricare i dati demo).
3. Nella stessa scheda, sotto «Invita un familiare», inserisci la sua **email Google** e premi invio: l'app assegna il ruolo **Editor** sul file via Drive API (Drive manda l'email di invito).
   In alternativa copia l'**ID del database** e condividilo.

### Chi si unisce (secondo membro)
1. Apre l'app, inserisce lo **stesso Client ID** e preme **Accedi con Google**.
2. Preme **Scegli da Drive** e seleziona `meal-duo-db.json` → l'app concede a sé stessa l'accesso a quel file e si collega.
3. Da quel momento entrambi leggono e scrivono sullo stesso JSON.

### ⚠️ Perché serve il Picker (e non basta l'ID)
Con lo scope `drive.file`, Drive nega l'accesso (`404`) a file creati da altri **anche se condivisi con te**, finché l'utente non li ha «aperti» con quell'app. Il **Google Picker** è il modo ufficiale per farlo con un solo gesto. Il campo «Collega ID» funziona quando il file è già stato aperto/creato con quell'account (es. secondo dispositivo dello stesso utente); in caso contrario l'app mostra un messaggio che indirizza al Picker. Per il Picker servono API Key e App ID (passo 5 sopra).

---

## 5. Sincronizzazione, offline e conflitti

**Cache locale.** Ogni modifica viene salvata subito in `localStorage`; l'app è sempre utilizzabile offline.

**Quando si sincronizza:** all'apertura, ~1 s dopo ogni modifica, quando l'app torna visibile o online, ogni 30 s e dal pulsante **Sync** (pillola in alto a destra di ogni schermata).

**Controllo di versione.** Ogni sync legge la revisione del file su Drive (`headRevisionId`, o `version` se assente):

1. se è cambiata dall'ultima sync → scarica il remoto e lo **fonde** con lo stato locale;
2. se il risultato differisce dal remoto → **ricontrolla la revisione** subito prima di scrivere (se nel frattempo è cambiata, ripete da 1) e poi carica.

**Merge senza perdite.** Il merge lavora per **record** con regola *last-write-wins* su `updatedAt` e *tombstone* per le cancellazioni: giorni di piano (per membro), alimenti del catalogo, membri, spunte, voci extra. Se Emilio spunta il riso mentre Sara aggiunge «Carta forno», **entrambe** le modifiche sopravvivono. Il merge è commutativo e idempotente (coperto da test), quindi i dispositivi convergono sempre allo stesso stato.

> Limite onesto: Drive non offre un «if-match» sulla scrittura, quindi resta una finestra di millisecondi tra l'ultimo controllo e l'upload. Anche lì non si perde nulla in modo permanente: l'altro dispositivo conserva le proprie modifiche in locale e, alla sync successiva (revisione cambiata), le ri-fonde e le ricarica.

Stati della pillola: *Locale* (non collegato) · *Sync…* · *Sincronizzato* · *Da inviare* · *Offline* · *Accedi* (token scaduto: tocca per rientrare) · *Errore*.

---

## 6. Import / export del piano in JSON

Nella schermata **Settimana → Piano in JSON**:

| Azione | Cosa fa |
|---|---|
| **Esporta piano** | scarica il piano attuale del membro selezionato |
| **Tracciato vuoto** | tutti i giorni e i pasti standard, nessun alimento (da compilare esternamente) |
| **Esempio** | stesso tracciato con alcuni alimenti di esempio |
| **Importa piano** | carica un `.json` o incolla il testo, **valida** lo schema, mostra un'**anteprima** (alimenti associati al catalogo / nuovi) e sostituisce il piano del membro scelto |

Formato (`meal-duo-plan` v1):

```json
{
  "format": "meal-duo-plan",
  "version": 1,
  "member": "Emilio",
  "days": [
    {
      "day": "Lunedì",
      "meals": [
        {
          "name": "Colazione",
          "items": [
            { "name": "Yogurt greco", "quantity": 170, "unit": "g" },
            { "name": "Fiocchi d'avena", "quantity": 40, "unit": "g" }
          ]
        }
      ]
    }
  ]
}
```

- `days` può essere un array (`day`: «Lunedì», «lun», «monday»…) oppure un oggetto indicizzato per nome del giorno. I giorni mancanti restano vuoti.
- `quantity`: numero > 0 (accetta anche `"1,5"`). `unit`: `g`, `kg`, `ml`, `l`, `pz`, `cucchiaio`… (se manca → `g` con avviso).
- Gli errori indicano il percorso preciso (`days[2].meals[1].items[0]: …`).
- **Normalizzazione dei nomi:** l'import associa i nomi al catalogo solo quando la corrispondenza è inequivocabile (stesso nome, plurale/singolare, ordine delle parole, alias, typo di 1 lettera, o un solo alimento che contiene tutte le parole). «Pollo» con due alimenti «Petto di pollo» e «Cosce di pollo» è ambiguo → viene creato come nuovo; l'anteprima mostra sempre cosa verrà associato o creato, e **Famiglia → Catalogo** permette di unire i duplicati in un secondo momento.

---

## 7. Deploy su GitHub Pages

Il workflow `.github/workflows/deploy.yml` esegue **test → build → deploy** ad ogni push su `main`.

1. Nel repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. *(Facoltativo)* **Settings → Secrets and variables → Actions → Variables**: crea `VITE_GOOGLE_CLIENT_ID` (e `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`) per precompilare le impostazioni.
3. Fai push (o merge) su `main`. L'app sarà su `https://<utente>.github.io/<repo>/`.
4. Aggiungi `https://<utente>.github.io` alle **Origini JavaScript autorizzate** del Client ID (§3).

**Base path dinamico:** `vite.config.ts` ricava `base` così: `VITE_BASE` (se impostata, es. `/` per un dominio custom) → altrimenti, in GitHub Actions, `/<nome-repo>/` da `GITHUB_REPOSITORY` → altrimenti `/`. Anche `start_url` e `scope` del manifest seguono il `base`.

**Installazione:** su iOS → Safari → Condividi → *Aggiungi a Home*; su Android → menu → *Installa app*.

---

## 8. Icona dell'app

Attualmente `public/icons/*` e `public/favicon.png` / `apple-touch-icon.png` sono **segnaposto** (piatto e posate). Per sostituirli con l'icona definitiva:

1. Salva l'immagine quadrata (ideale ≥ 1024 px) come **`assets/icon-source.png`**.
2. Esegui:
   ```bash
   npm run icons      # richiede Python 3 + Pillow (pip install pillow)
   ```
   Genera `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png` (contenuto nell'80 % centrale = safe zone), `apple-touch-icon.png` (180) e `favicon.png`.
3. Nient'altro da toccare: manifest (`vite.config.ts`) e `index.html` puntano già a questi file.

---

## 9. Test

`npm test` esegue 54 test (Vitest) che coprono:

- **Motore della spesa:** somme tra membri/giorni, conversione kg→g e l→ml, unità incompatibili su righe separate, errori di virgola mobile, esclusione di membri e giorni (singoli e combinati), tombstone, immutabilità dell'input, spunte stabili al cambio filtri, «Nuova spesa», progresso.
- **Fuzzy matching** (`pollo` → `Petto di pollo`, plurali, typo, alias, ambiguità) e unione dei duplicati con ridirezione delle voci dei piani.
- **Merge** (commutatività, idempotenza, modifiche concorrenti su record diversi, tombstone).
- **Import/export** (validazione con percorsi, round-trip export → import identico sulla spesa).
- **Sync** con Drive simulato: nessuna operazione se invariato, push, merge bidirezionale, **race condition** (scrittura altrui tra lettura e scrittura), permessi di sola lettura.

> L'integrazione reale con Google (OAuth, Drive, Picker) richiede un Client ID e **non** è coperta da test automatici: è verificata contro un Drive simulato; la prova end-to-end va fatta con il proprio progetto Cloud (§3).

---

## 10. Decisioni di progetto

Dove `DESIGN_SYSTEM.md` non copriva un caso, si è scelta la soluzione più vicina allo stile esistente, senza nuovi colori o ombre.

- **Mascotte segnaposto.** Il documento descrive PNG di MoneyDuo (con fessura da salvadanaio, inadatti). Finché non arrivano le immagini definitive, `public/cats/{mochi,zenitsu,pair}.svg` sono SVG neutri nello stesso stile (occhi chiusi sorridenti, collarino con campanellino). Per sostituirle: copiare i PNG con lo stesso nome e cambiare le estensioni in `src/components/Mascots.tsx` (`FILE`).
- **Portal per fogli e FAB** tramite un contesto (`state/overlay.tsx`): le pagine animate usano `filter: blur()` e creano un containing block (§2.2); i fogli `fixed` montati dentro la pagina non si ancoravano al fondo dello schermo (bug trovato e corretto durante la verifica).
- **Colori membro**: tavolozza di 8 colori caldi/neutri presi dalle palette membro e stanza del documento; usati solo come dato scelto dall'utente (§0.2). I badge per-membro sulla spesa usano testo `ink` su `bg-bg` con un puntino colorato (mai testo colorato su fondo colorato).
- **Celebrazione** a stelle (§3.3) al completamento della spesa, con haptic dove disponibile.
- **`prefers-reduced-motion`** gestito (blob, shine, `MotionConfig reducedMotion="user"`): è la raccomandazione dell'Appendice C per i nuovi progetti.
- **Chip dei filtri** «escluso» = `opacity-70` + icona ✕ (lo stato non dipende dal solo colore).
- **FAB:** su *Oggi* aggiunge un alimento, su *Spesa* una voce extra.
- **Nessun router**, stato di navigazione in contesto React (§2.6).
- **Persistenza:** `localStorage` per DB (cache), filtri e membro selezionato; per un DB molto grande si può passare a IndexedDB senza cambiare le API dello store.

## 11. Checklist Design System (Appendice B)

Verificata con Playwright (iPhone 14, tema chiaro e scuro) e ispezione del codice:

- [x] Nessun `dark:` e nessun colore hex nei componenti (solo eccezioni di §0.2: colori membro, riquadri anteprima tema, fallback avatar)
- [x] Token dichiarati nei **tre** blocchi (`:root`, `@media` scuro, `[data-theme='dark']`)
- [x] Script del tema nel `<head>` + due `theme-color` con `media`
- [x] `backdrop-filter` solo in `.glass` / `.glass-strong` / scrim dei fogli; nessuna card di vetro; nessun annidamento
- [x] Fallback `@supports` e `prefers-reduced-transparency`
- [x] Sfondo = 3 blob animati solo con `transform`
- [x] `viewport-fit=cover`, safe-area su scroll, nav, FAB, fogli, toast
- [x] Un solo contenitore di scroll, scrollbar nascosta, `overscroll-behavior: none`, `touch-action: pan-y pinch-zoom`
- [x] Input a 16 px su touch (verificato: `16px`), nessuno scroll orizzontale
- [x] Nav `absolute inset-x-4 bottom-4` con indicatore `layoutId` (molla 420/30/0,9) fuori dal contenitore animato
- [x] FAB in portal su `#shell-overlay`; foglio `fixed` su mobile / `md:absolute` su desktop; scala z-index §2.3
- [x] Cornice telefono `max-w-md` + `rounded-[2.75rem]` su desktop
- [x] Fogli chiudibili con Esc, scrim e trascinamento dalla maniglia (120 px / 600)
- [x] Feedback al tocco su tutti gli elementi tappabili; aree ≥ 40 px
- [x] Mascotte: `alt=""`, `draggable={false}`, un solo capolino per schermata, destra Mochi / sinistra Zenitsu, coppia in Famiglia

## 12. Limiti noti

- Integrazione Google non verificabile senza credenziali: provata solo con Drive simulato (§9).
- Con `drive.file` il secondo membro deve usare il Picker (§4).
- Mascotte e icona sono segnaposto in attesa delle immagini definitive.
- I token GIS durano ~1 ora: se scade e il rinnovo silenzioso è bloccato dal browser, la pillola mostra «Accedi» e basta un tocco.
- `headRevisionId`/`version` rilevano le modifiche altrui ma non c'è locking: vedi la nota sulla finestra di race in §5.
