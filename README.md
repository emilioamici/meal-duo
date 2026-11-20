# Meal Duo 🍽️🐾

**Meal Duo** è una Progressive Web App mobile-first per gestire i **piani alimentari settimanali** di tutta la famiglia e generare in automatico una **lista della spesa condivisa**.

- Ogni membro ha il proprio piano (Lunedì → Domenica, pasti e alimenti con quantità e unità).
- Un **catalogo alimenti condiviso** con autocompletamento intelligente evita i duplicati («Pollo» vs «Petto di pollo») così la spesa somma con precisione.
- La **spesa** aggrega i piani, mostra il totale e il **dettaglio per membro** (`Riso basmati — 840 g · Emilio: 560g · Sara: 280g`) e si può filtrare escludendo persone o giorni.
- I dati vivono in **un solo file JSON su Google Drive** (`meal-duo-db.json`), letto e scritto da tutti i familiari. Nessun backend: tutto client-side (Google Identity Services + Drive API v3).
- Funziona **offline** (cache locale + service worker) e si sincronizza da sola.
- Stile **Liquid Glass** come da `DESIGN_SYSTEM.md` (temi Mochi chiaro / Zenitsu scuro).

> **Primo avvio:** come in MoneyDuo si parte dal **Gate** (accesso con Google → la casa viene trovata o creata). Chi vuole solo provare l'app può toccare **«Prova senza account»**: contiene i dati di esempio di due persone (Emilio e Sara) e funziona subito, senza login Google.
>
> **Lingue:** italiano e inglese (automatico dal dispositivo, cambiabile da Impostazioni → Aspetto).

---

## Indice

1. [Avvio in locale](#1-avvio-in-locale)
2. [Struttura del progetto](#2-struttura-del-progetto)
3. [Setup Google Cloud Console](#3-setup-google-cloud-console-client-id--drive-api)
4. [Accesso, condivisione e inviti](#4-accesso-condivisione-e-inviti)
5. [Sincronizzazione, offline e conflitti](#5-sincronizzazione-offline-e-conflitti) · [Worker e notifiche push](#5b-worker-e-notifiche-push-facoltativo)
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

In alternativa si inseriscono dall'app: **Impostazioni → Sincronizzazione e account**.

---

## 2. Struttura del progetto

```
src/
├─ types.ts                      Member, FoodCatalogItem, MealItem, Meal, DayPlan, WeeklyPlan,
│                                ShoppingCheckState, AppDatabase …
├─ data/demo.ts                  dati di esempio (Emilio e Sara)
├─ sync/                         tutto ciò che parla con Google e col Worker
│  ├─ google.ts                  Google Identity Services: token a popup (1 h) e scope
│  ├─ auth.ts                    accesso persistente: sessione sul Worker, rinnovo token senza popup
│  ├─ drive.ts                   Drive REST v3: ricerca/lettura/scrittura del file, inviti e revoche
│  ├─ picker.ts                  Google Picker (scelta del file/cartella con scope drive.file)
│  ├─ engine.ts                  motore di sync: versione remota, merge, ricontrollo, riconnessione
│  ├─ push.ts · pushQueue.ts     iscrizione push e coda delle notifiche da inviare
├─ services/
│  ├─ merge.ts                   merge last-write-wins per record (con tombstone)
│  ├─ shoppingListEngine.ts      aggregazione e filtri della spesa (funzioni pure)
│  ├─ dbOps.ts · dbSchema.ts     mutazioni immutabili e validazione del DB
│  └─ planIO.ts                  import/export JSON del piano
├─ lib/                          foodMatch (fuzzy), units, notifications (chi avvisare e cosa), theme, actor…
├─ i18n/                         t()/tb()/tp(), dizionario inglese (en.ts) e test di copertura
├─ state/                        store (DB + cache IndexedDB + notifiche), cache, ui, overlay
├─ components/                   ui, Chrome, Mascots, Sheets, Gate, ConnectSheet (flusso di collegamento), FolderPicker,
│                                IdentityGuard, SyncCard,
│                                NotificationsCard, Notifications …
└─ views/                        TodayView, WeekView, ShoppingView, SettingsView
worker/                          Cloudflare Worker: broker OAuth (accesso persistente) + push (vedi worker/README.md)
public/push-sw.js                gestori push/notificationclick caricati dal service worker di Workbox
public/icons/ · public/cats/     icone PWA (da assets/icon-source.png) e mascotte (PNG condivisi con le altre app)
scripts/generate_icons.py        genera le icone PWA
.github/workflows/deploy.yml     test + build + deploy su GitHub Pages
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
   - **Branding** (obbligatorio per pubblicare: senza, il pulsante *Pubblica app* resta grigio con il messaggio «devi inserire le informazioni mancanti»). In *Google Auth Platform → Branding* compila:
     - **Nome dell'app:** `Meal Duo`
     - **Email di assistenza** e **email di contatto dello sviluppatore:** il tuo indirizzo
     - **Home page dell'app:** `https://<utente>.github.io/<repo>/` (es. `https://emilioamici.github.io/meal-duo/`)
     - **Norme sulla privacy:** `https://<utente>.github.io/<repo>/privacy.html` (la pagina è inclusa nell'app: `public/privacy.html`)
     - *(facoltativi)* logo (puoi usare `assets/icon-source.png`) e condizioni di servizio.

     Prima di salvare apri i due indirizzi dal browser: l'app deve essere già pubblicata su GitHub Pages (merge + deploy), altrimenti rispondono 404. Se Google chiede i **domini autorizzati**, `github.io` non è un dominio tuo e potrebbe essere rifiutato: in quel caso serve un dominio personalizzato per Pages (con lo scope `drive.file` non è richiesta la verifica dell'app, ma i link devono essere validi).
     Poi, in *Pubblico*, premi **Pubblica app** (stato *In produzione*).
4. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**
   - Tipo di applicazione: **Applicazione web**.
   - **Origini JavaScript autorizzate** (solo schema + dominio, **senza percorso**):
     - `http://localhost:5173` (sviluppo)
     - `https://<tuo-utente>.github.io` (produzione su GitHub Pages)
   - **URI di reindirizzamento**: non servono (si usa il token client GIS con popup).
   - Copia il **Client ID** (`123456-abc.apps.googleusercontent.com`).
5. *(Facoltativo, solo per «Scegli da Drive»)*
   - **Credenziali → Crea credenziali → Chiave API**: in *Restrizioni delle API* limitala a **Google Picker API**; in *Restrizioni delle applicazioni → Siti web* usa l'**origine senza percorso**: `https://<utente>.github.io/*` (e `http://localhost:5173/*`). Il Picker gira in un iframe di Google e i browser inviano ai siti di terzi solo l'origine: con un percorso (`…/meal-duo/*`) la chiave viene rifiutata con «The API developer key is invalid».
   - **App ID** = *numero del progetto* (Dashboard del progetto → «Numero progetto»).
6. In Meal Duo apri **Impostazioni → Sincronizzazione e account**, incolla il Client ID (ed eventualmente API Key e App ID) e premi **Accedi con Google**.

> Lo scope `drive.file` dà accesso **solo** ai file creati dall'app o che l'utente le ha aperto esplicitamente: Meal Duo non può leggere nient'altro del tuo Drive.

---

## 4. Accesso, condivisione e inviti

**Gate.** Senza una casa collegata l'app mostra a schermo intero la schermata di accesso (come MoneyDuo): **Accedi con Google** → l'app cerca il database e lo collega, oppure propone di crearlo. «Prova senza account (dati demo)» è l'unica uscita: l'app resta in locale e la casa si può collegare in seguito da **Impostazioni → Sincronizzazione e account** (o dalla pillola «Locale»).

**Sessione scaduta.** Con una casa collegata, se la sessione Google non è più valida (e sei online) il Gate di riconnessione **copre tutta l'app** e i dati restano nascosti finché non accedi; l'app resta montata sotto, inerte, così quello che stavi scrivendo non si perde. Offline si resta sui dati locali.

**Cartella del database.** Alla creazione della casa e poi da *Sincronizzazione e account → Cartella del database → Sposta* (solo il proprietario) si sceglie dove sta il file: con il Picker attivo si usa il selettore di Google, altrimenti l'esplora-cartelle interno (cartelle del tuo Drive, «Nuova cartella qui»).

### Impostazioni

La quarta scheda della barra si chiama **Impostazioni** e ha la stessa struttura di Clean Duo (sezioni a scomparsa, con riepilogo da chiusa): **Aspetto** (sotto i due gattini: tema Mochi/Zenitsu/automatico con descrizione, e lingua), **Casa** (nome), **Membri della casa** (inviti), **Sincronizzazione e account**, **Notifiche**, **Catalogo alimenti** (con unione dei duplicati), **Piano alimentare (JSON)** e **Dati** (backup, ripristino, ricomincia da zero).

### Chi crea la casa (proprietario)
1. **Accedi con Google** → l'app cerca un database `meal-duo-db.json` che l'account può vedere.
2. Se non c'è: **Crea casa** (nome della casa, il tuo nome, cartella di Drive se il Picker è attivo). Il file ha il marcatore pubblico `properties.mealduo=db` e `writersCanShare=false`: **solo il proprietario può invitare o rimuovere persone**.
3. **Impostazioni → Membri della casa → Invita con Google Drive**: inserisci l'email del familiare (e se è una persona già presente nel piano, collegala a quel membro). L'app concede il ruolo **Editor** sul file via Drive API e Drive manda l'email di invito.

### Chi si unisce
1. Apre l'app → **Collega Google Drive** → accede con *il proprio* account Google.
2. Se l'app trova il file lo collega da sola. Altrimenti, nella schermata «Nessuna casa trovata», **Scegli il database della casa** (Picker): il file è in «Condivisi con me». Lo si fa una volta sola.
3. Se sul dispositivo ci sono dati propri l'app chiede se **unirli** al file o **usare solo il file**.
4. **Chi sei?** — l'account viene associato al membro (l'invito ha già salvato la sua email; se il file è stato condiviso a mano si sceglie il membro o ci si aggiunge).

Per **rimuovere** una persona: Membri → Modifica → *Rimuovi membro*: il proprietario revoca anche l'accesso al file su Drive.

### ⚠️ Perché serve il Picker (e non basta l'ID)
Con lo scope `drive.file`, Drive nega l'accesso (`404`) ai file creati da altri **anche se condivisi con te**, finché l'utente non li ha «aperti» con quell'app: il **Picker** è il modo ufficiale. Con API Key e App ID configurati (§3, passo 5) l'app chiede *solo* `drive.file`; senza, usa lo scope completo `drive` (vede i file condivisi, ma chiede un permesso molto più ampio). «Ho il link o l'ID» funziona solo con lo scope completo o se il file è già stato aperto con quell'account.

---

## 5. Sincronizzazione, offline e conflitti

**Cache locale.** Il database vive in memoria con una copia in **IndexedDB** (con la versione di Drive a cui corrisponde): l'app parte subito ed è sempre utilizzabile offline.

**Se la copia locale manca o è datata** (cache cancellata dal browser, altra versione) il motore **rilegge Drive prima di inviare qualsiasi cosa**: una copia vuota non può mai sovrascrivere il file.

**Quando si sincronizza:** all'apertura, ~2 s dopo ogni modifica, quando l'app torna visibile o online, ogni 2 minuti (anche in background) e dalla pillola in alto a destra.

**Controllo di versione.** Ogni ciclo legge la `version` del file su Drive:
1. se è cambiata → scarica il remoto e lo **fonde** con lo stato locale (record per record);
2. se il risultato differisce dal remoto → **ricontrolla la versione** subito prima di scrivere (se nel frattempo è cambiata, ripete da 1, max 3 volte) e poi carica.

**Merge senza perdite.** *Last-write-wins* su `updatedAt` per **record** con *tombstone* per le cancellazioni (giorni di piano per membro, alimenti, membri, spunte, voci extra): se Emilio spunta il riso mentre Sara aggiunge «Carta forno», **entrambe** le modifiche sopravvivono. Il merge è commutativo e idempotente (coperto da test).

> Limite onesto: Drive non offre un «if-match» sulla scrittura, quindi resta una finestra di millisecondi tra l'ultimo controllo e l'upload. Anche lì non si perde nulla in modo permanente: l'altro dispositivo conserva le proprie modifiche in locale e, alla sync successiva (versione cambiata), le ri-fonde e le ricarica.

**Sessione Google.** Due modalità:
- **A popup (senza Worker):** il token dura 1 ora; l'app lo rinnova in silenzio a ogni tocco nell'ultima ora. Se non è possibile compare «Accedi» (un tocco).
- **Persistente (con il Worker):** il Worker conserva il token di rinnovo (cifrato) e l'app ottiene token freschi da sola, anche in background: niente popup e le notifiche non si fermano. Dettagli e rischi in `worker/README.md`.

Stati della pillola: *Locale* · *Da inviare* · *Sync…* · *Sincronizzato* · *Offline* · *Accedi* · *Errore*.

---

## 5b. Worker e notifiche push (facoltativo)

`worker/` contiene un piccolo **Cloudflare Worker** (piano gratuito) che fa due cose: **accesso persistente** (broker OAuth) e **notifiche push anche con l'app chiusa**. Il Worker non ha mai accesso a Drive con i dati della casa: a ogni richiesta verifica il token Google di chi scrive e che abbia accesso al file; salva solo gli iscritti push (chiave `id database + email`).

Installazione passo passo: **`worker/README.md`**. In breve: `node worker/scripts/generate-vapid.mjs` → `wrangler.toml` → `wrangler kv namespace create SUBS` → `wrangler secret put …` → `wrangler deploy` → variabili GitHub `VITE_PUSH_URL` e `VITE_VAPID_PUBLIC_KEY` → rilancia il deploy.

**Cosa viene notificato** (agli altri membri con un account Google associato, mai a chi fa la modifica):

| Evento | Esempio |
|---|---|
| Voce extra aggiunta alla spesa | «Bruno ha aggiunto «Detersivo» alla spesa» |
| Articoli spuntati (chi fa la spesa si vede) | «Sara ha preso Latte» · oltre 3: «Sara ha spuntato 5 articoli» |
| Modifica del **tuo** piano da parte di un altro | «Emilio ha modificato il tuo piano · Martedì» |

Ogni notifica compare nella **campanella** dell'app (anche senza Worker, ricevuta alla sync), come avviso del telefono se l'app è in background e, con il Worker, come push ad app chiusa. Le notifiche push partono **dopo** che i dati sono arrivati su Drive (coda locale che sopravvive a offline e riavvii, scarto dopo 24 h o se la voce è stata eliminata); le spunte dello stesso autore **sostituiscono** la precedente (stesso `tag`). Si attivano da **Impostazioni → Notifiche**. Su iPhone servono iOS 16.4+ e l'app aggiunta alla Home.

---

## 6. Import / export del piano in JSON

Dalla schermata **Settimana → Piano in JSON** oppure da **Impostazioni → Piano alimentare (JSON)**:

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
- **Normalizzazione dei nomi:** l'import associa i nomi al catalogo solo quando la corrispondenza è inequivocabile (stesso nome, plurale/singolare, ordine delle parole, alias, typo di 1 lettera, o un solo alimento che contiene tutte le parole). «Pollo» con due alimenti «Petto di pollo» e «Cosce di pollo» è ambiguo → viene creato come nuovo; l'anteprima mostra sempre cosa verrà associato o creato, e **Impostazioni → Catalogo alimenti** permette di unire i duplicati in un secondo momento.

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

L'icona definitiva (i due gattini con le borse della spesa) è in `assets/icon-source.png`; da lì lo script genera tutte le icone PWA, riempiendo gli angoli bianchi con il verde menta. Per cambiarla in futuro:

1. Salva l'immagine quadrata (ideale ≥ 1024 px) come **`assets/icon-source.png`**.
2. Esegui:
   ```bash
   npm run icons      # richiede Python 3 + Pillow (pip install pillow)
   ```
   Genera `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png` (contenuto nell'80 % centrale = safe zone), `apple-touch-icon.png` (180) e `favicon.png`.
3. Nient'altro da toccare: manifest (`vite.config.ts`) e `index.html` puntano già a questi file.

---

## 9. Test

`npm test` esegue 151 test (Vitest) che coprono:

- **Motore della spesa:** somme tra membri/giorni, conversione kg→g e l→ml, unità incompatibili su righe separate, errori di virgola mobile, esclusione di membri e giorni (singoli e combinati), tombstone, immutabilità dell'input, spunte stabili al cambio filtri, «Nuova spesa», progresso.
- **Fuzzy matching** (`pollo` → `Petto di pollo`, plurali, typo, alias, ambiguità) e unione dei duplicati con ridirezione delle voci dei piani.
- **Merge** (commutatività, idempotenza, modifiche concorrenti su record diversi, tombstone).
- **Import/export** (validazione con percorsi, round-trip export → import identico sulla spesa).
- **Motore di sync** con Drive simulato: nessuna operazione se invariato, push, merge bidirezionale, **race condition** (scrittura altrui tra lettura e scrittura), sola lettura, offline, **copia locale persa/datata che non sovrascrive Drive**, creazione/collegamento della casa.
- **Notifiche** (chi avvisare e cosa, raggruppamenti, mai per le proprie modifiche) e **coda push** (ordine, scarti, retry).
- **i18n**: ogni testo usato nel codice ha la traduzione inglese, segnaposto e tag coerenti, nessun testo JSX lasciato fuori da `t()`; **Drive** (cartelle, spostamento, inviti, revoche, ricerca per marcatore); **membri duplicati** per email.
- **Worker**: cifratura RFC 8291, VAPID, endpoint subscribe/notify/auth (sessioni cifrate, rinnovo, revoca), service worker push.

> L'integrazione reale con Google (OAuth, Drive, Picker) richiede un Client ID e **non** è coperta da test automatici: è verificata contro un Drive e un Worker simulati (anche con due browser, inviti e notifiche inclusi); la prova con il proprio progetto Cloud va fatta a mano (§3).

---

## 9b. Lingue (it / en)

I testi sono in italiano nel codice: `t('Testo italiano {nome}', { nome })` restituisce il testo nella lingua in uso; in inglese lo cerca in `src/i18n/en.ts` (la chiave è il testo italiano) e, se manca, ripiega sull'italiano. `tb()` accetta `<b>` e `<code>`, `tp(n, singolare, plurale)` gestisce i plurali, `dayShort/dayLong` i giorni, `locale()` date e numeri. Lingua: *Automatico* (segue il browser: italiano se `it`, altrimenti inglese), *Italiano*, *English* — da **Impostazioni → Aspetto**; si applica subito, senza ricaricare.

**Aggiungere un testo:** scrivilo con `t('…')` e aggiungi la voce in `en.ts`; `npm test` fallisce se manca la traduzione, se i segnaposto non coincidono o se resta testo JSX fuori da `t()`.
**Non si traducono i dati dell'utente:** nomi di alimenti e pasti, nomi dei membri e della casa, e il formato JSON del piano (giorni in italiano; l'import accetta anche i nomi inglesi). Le notifiche push sono scritte nella lingua di chi fa la modifica.

---

## 10. Decisioni di progetto

Dove `DESIGN_SYSTEM.md` non copriva un caso, si è scelta la soluzione più vicina allo stile esistente, senza nuovi colori o ombre.

- **Mascotte uguali alle altre app.** `public/cats/{mochi,zenitsu,pair}.png` sono gli stessi file di Clean Duo e MoneyDuo (identici byte per byte). Hanno la fessura da salvadanaio sulla testa, nata per MoneyDuo; resta, come in Clean Duo, finché non ci sono varianti dedicate a Meal Duo (§4.5 del Design System).
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
- [x] Mascotte: `alt=""`, `draggable={false}`, un solo capolino per schermata, destra Mochi / sinistra Zenitsu, coppia in Impostazioni

## 12. Limiti noti

- Integrazione Google non verificabile senza credenziali: provata solo con Drive simulato (§9).
- Con `drive.file` il secondo membro deve usare il Picker (§4).
- L'accesso persistente richiede il Worker e un account Cloudflare protetto: custodisce un token di rinnovo con accesso a Drive (vedi `worker/README.md`).
- Il push ad app chiusa non è stato provato su dispositivi reali (iOS/Android): è coperto da test su cifratura, VAPID e service worker.
- Le mascotte sono quelle condivise con Clean Duo e MoneyDuo (con la fessura da salvadanaio); l'icona PWA è definitiva.
- I token GIS durano ~1 ora: se scade e il rinnovo silenzioso è bloccato dal browser, la pillola mostra «Accedi» e basta un tocco.
- `headRevisionId`/`version` rilevano le modifiche altrui ma non c'è locking: vedi la nota sulla finestra di race in §5.
