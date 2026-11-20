# Meal Duo — Autenticazione, sincronizzazione Drive, Worker e notifiche

Documento tecnico e operativo. Spiega come Meal Duo gestisce l'accesso con Google, la sincronizzazione del database condiviso su Google Drive, il Worker Cloudflare (accesso persistente + notifiche push) e la condivisione tra i membri della casa. L'architettura è la stessa di **MoneyDuo** (repo `money-duo`); dove Meal Duo si discosta è indicato nel §10.

---

## 1. Visione d'insieme

```
┌───────────────────────┐        OAuth (popup GIS)  ┌────────────────────┐
│  PWA (GitHub Pages)   │ ────────────────────────► │  Google Identity   │
│                       │                           └────────────────────┘
│  React + IndexedDB    │        Drive REST v3      ┌────────────────────┐
│  SyncEngine           │ ◄───────────────────────► │  Google Drive      │
│  service worker       │                           │  meal-duo-db.json  │
└──────────┬────────────┘                           └────────────────────┘
           │ sessione persistente / push
           ▼
┌───────────────────────┐   Web Push (RFC 8291)     ┌────────────────────┐
│ Cloudflare Worker     │ ────────────────────────► │ FCM / APNs / Mozilla│
│ (broker OAuth + push) │                           └────────────────────┘
│ KV: sessioni, iscritti│
└───────────────────────┘
```

Principi:
- **Nessun backend proprietario per i dati.** Il database è **un file JSON su Drive** del proprietario della casa; tutti i membri lo leggono e scrivono con il proprio account Google.
- **Il Worker è facoltativo.** Senza, l'app funziona (sessione a popup da 1 h, notifiche solo ad app aperta/in background). Con il Worker: accesso persistente senza popup e push ad app chiusa.
- **Il Worker non vede mai i dati della casa.** Verifica il token Google di chi scrive e che abbia accesso al file; conserva solo token di rinnovo (cifrati) e iscrizioni push.
- **Offline-first.** Il DB vive in memoria con copia in IndexedDB; Drive è la fonte di verità condivisa.

---

## 2. Modello dati e identità

Un solo file `meal-duo-db.json` (`schema: "meal-duo-db"`, `version: 1`) contiene: `houseName`, `members[]`, `foodCatalog[]`, `plans{memberId → WeeklyPlan}`, `shopping{checks, extras, resetAt}`, `lastUpdated`.

Ogni record unibile ha `updatedAt`, un eventuale `deleted` (tombstone) e **`by`** (id del membro che ha fatto l'ultima modifica, impostato da `lib/actor.ts`). `by` serve alle notifiche («Sara ha preso il latte»).

**Chi sono io?** L'account Google è associato a un membro tramite l'**email** (`Member.email`). `me` = il membro la cui email coincide con quella dell'account. `IdentityGuard` gestisce i casi:
- invitato dal proprietario → il membro esiste già con la sua email;
- file condiviso a mano → «Chi sei?» (scegli un membro senza account) oppure ti aggiunge come nuovo membro (operazione idempotente, mai duplicati).

**Proprietà del file.** Creato dal proprietario con `properties.mealduo = "db"` (marcatore per ritrovarlo anche se rinominato) e `writersCanShare = false`: **solo il proprietario può invitare/rimuovere persone**. `canShare` e `ownerEmail` sono ricavati a ogni sync dai metadati del file.

---

## 3. Autenticazione

### 3.1 Due modalità

| | **A popup (senza Worker)** | **Persistente (con Worker)** |
|---|---|---|
| Come | Google Identity Services, *token model* | Il Worker fa da intermediario OAuth (code flow + refresh token) |
| Durata | Token d'accesso ~1 ora | Il Worker rinnova all'infinito (sessione 180 gg di inattività) |
| Rinnovo | Silenzioso (`prompt: 'none'`) a ogni tocco, nell'ultima ora | Automatico, anche in background, senza popup |
| Dove sta il segreto | Solo il token in `sessionStorage` | Refresh token **cifrato nel KV del Worker**; sul dispositivo solo un id di sessione casuale (`localStorage: mealduo:session`) |
| Se scade | Pillola «Accedi» (un tocco) | Solo se revocato su Google → «Accedi» |

Il motore sceglie da solo: se `GET {VITE_PUSH_URL}/health` risponde `{auth:true}` il login passa dal Worker (`brokerAvailable()`), altrimenti usa il popup.

### 3.2 Scope
- **Con Picker configurato** (`VITE_GOOGLE_API_KEY` + `VITE_GOOGLE_APP_ID`): solo `https://www.googleapis.com/auth/drive.file` (file creati dall'app o aperti con il Picker). Anche il Worker lo sa: `/auth/start?scope=file`.
- **Senza Picker**: `https://www.googleapis.com/auth/drive` (tutto Drive) — necessario per vedere file condivisi da altri senza Picker, ma è un permesso molto ampio.

### 3.3 Flusso del login persistente (broker)

1. L'app chiama `startBrokerLogin()` → `GET {worker}/auth/start?return=<url app>&hint=<email>&scope=file`.
2. Il Worker controlla che `return` sia in `ALLOWED_ORIGINS`, salva uno `state` monouso (TTL 10 min) e reindirizza a Google (`access_type=offline`, `prompt=consent`).
3. Google rimanda a `{worker}/auth/callback?code&state`. Il Worker scambia il codice (con il **client secret**), legge l'email dell'account, **cifra** `{refresh_token, email}` con AES-GCM (`SESSION_KEY`) e la salva in KV come `sess:<id>` (TTL 180 gg).
4. Reindirizza all'app con l'id di sessione nel **frammento** dell'URL (`#mealduo_session=<id>`, `Referrer-Policy: no-referrer`).
5. `consumeSessionFromUrl()` (in `main.tsx`) lo salva in `localStorage`, ripulisce la barra degli indirizzi e imposta `sessionStorage['mealduo:resume-connect']` così il foglio «Collega Google Drive» si riapre da solo.
6. Da quel momento `POST /auth/refresh` (header `Authorization: Bearer <id>`) restituisce `{access_token, expires_in, email}`: l'app li mette nella cache dei token (`setToken`).

`Esci` → `POST /auth/logout` elimina **la sessione di quel dispositivo** (non revoca il refresh token su Google, per non scollegare gli altri dispositivi). Revoca totale: <https://myaccount.google.com/permissions>.

### 3.4 Rinnovo del token (engine)
- Ogni minuto: se mancano < 10 min → `brokerRenew()` (solo con sessione persistente).
- Senza sessione: a ogni `pointerdown` (gesto utente, quindi popup consentito) → `renewIfNeeded()`: se restano < 15 min e l'ultimo tentativo è > 10 min fa, prova `requestToken({prompt:'none'})`.
- Se il Worker è irraggiungibile → si resta sui dati locali (stato *Offline*, nessuna schermata di accesso). Se la sessione è revocata/scaduta (401) → stato `auth` → pillola «Accedi».

---

## 4. Sincronizzazione con Drive

File: `src/sync/engine.ts` (motore), `drive.ts` (REST), `state/cache.ts` (IndexedDB), `services/merge.ts` (merge).

### 4.1 Stato persistente (`localStorage: mealduo:sync`)
`fileId, fileName, email, name, ownerEmail, canShare, remoteVersion, lastSyncAt, dirty`. Stati: `off · auth · pending · syncing · synced · offline · error`.

### 4.2 Ciclo `syncNow()` (max 3 tentativi)
1. `getMeta` del file → legge `version` (cambia a ogni scrittura), `owners`, `capabilities`.
2. Se `version ≠ remoteVersion` **oppure** la copia locale non è affidabile → scarica il remoto e lo **fonde** (`mergeDatabases`) con il locale (`applyDb(…, 'remote')` → da qui nascono le notifiche).
3. Se serve un upload (modifiche locali, o il merge ha prodotto qualcosa che il remoto non ha) → **secondo `getMeta`**: se la versione è cambiata nel frattempo, si ricomincia (race GET→PATCH).
4. `PATCH` del contenuto → nuova `version` → `dirty=false` (a meno che nel frattempo ci siano state altre modifiche: `dirtySeq`).
5. `afterSync()` → svuota la coda push (vedi §6).

Trigger: apertura, 2 s dopo ogni modifica (`markDirty`), ritorno online/visibile, ogni 2 min (anche in background), pillola in header. Un solo ciclo alla volta (`running`/`rerun`).

### 4.3 Merge (last-write-wins per record)
`mergeDatabases(a, b)`: per ogni record sceglie quello con `updatedAt` maggiore; a parità, scelta deterministica (confronto del JSON). Cancellazioni = **tombstone** (`deleted: true`), mai rimozione. I **giorni di piano** si fondono giorno per giorno; le **spunte** chiave per chiave (`foodId|unità`); le **voci extra** per id. Proprietà: commutativo, associativo, idempotente → due dispositivi convergono sempre. Nessuna modifica su record diversi va persa.

Unione di alimenti duplicati: i giorni toccati vengono ri-timbrati (`updatedAt` nuovo) e il vecchio alimento diventa tombstone, quindi la ridirezione si propaga.

### 4.4 Copia locale persa o datata (protezione dai danni)
All'avvio `checkCache(state)`:
- `missing` (IndexedDB vuota/cancellata) → `pullMode='replace'`: si **adotta Drive così com'è** e si scartano eventuali `dirty` (stavano nella copia persa);
- `stale` (la versione della copia ≠ `remoteVersion`) → `pullMode='merge'`;
- in entrambi i casi `reconciled=false` e `remoteVersion=null` finché non si è riletto Drive: **nessun upload è permesso** (`throw` «Copia locale non allineata…»). Una copia vuota non può mai sovrascrivere il file.

La cache scrive in IndexedDB (con ripiego su `localStorage`), con debounce 300 ms e flush su `visibilitychange`/`pagehide`. Se non riesce a salvare, `cacheOk=false` e la scheda Sincronizzazione avvisa.

### 4.5 Errori
| Errore | Comportamento |
|---|---|
| 401 / token scaduto | `clearToken`, stato `auth` («Accedi») |
| 404 con Picker | «scegli di nuovo il file con il selettore» (il file non è più accessibile all'app) |
| 404 senza Picker | «non hai più accesso al database» (rimosso o spostato) |
| 403 | «serve l'accesso in modifica al file» |
| Rete (`TypeError`) / offline | stato `offline`, si riprova |
| Sola lettura sul file | errore esplicito, nessun upload |
| Race ripetuta (3 tentativi) | errore transitorio, nuovo tentativo al ciclo successivo |

> **Limite noto:** Drive non ha un «if-match» sulla scrittura; resta una finestra di millisecondi dopo il secondo `getMeta`. Non è una perdita permanente: l'altro dispositivo conserva le sue modifiche in locale e, alla sync successiva (versione cambiata), le ri-fonde e le ricarica.

---

## 5. Condivisione del database tra i membri

### 5.1 Il proprietario
Al primo avvio il **Gate** (oppure, in modalità demo, `Impostazioni → Sincronizzazione e account → Collega Google Drive`) esegue il flusso `ConnectFlow`:
1. **Accedi con Google** (popup o broker).
2. `listCandidates()` cerca file con `properties mealduo=db` o nome `meal-duo…` accessibili all'app.
3. Nessuno trovato → **Crea casa**: `engine.createHouse()` crea il file (`createFile`, multipart, `writersCanShare:false`) con un DB nuovo che contiene il proprietario (con la sua email) — oppure con i dati già presenti se si sceglie «Porta con me i dati».
4. **Invita**: `Membri → Invita con Google Drive` → `drive.shareFile()` (`POST /files/{id}/permissions`, `role: writer`, `sendNotificationEmail=true`) e crea (o collega a un membro esistente) il membro con quell'email.

### 5.2 Chi si unisce
Accede con il proprio account → `ConnectSheet`:
- 1 casa trovata → collegata automaticamente (se ci sono dati locali non demo: scelta **unisci** / **usa solo il file**);
- più case → elenco;
- nessuna → «Hai ricevuto un invito?» → **Picker** (`pickDatabase`, vista «condivisi con me») → collegamento. Con `drive.file` questo gesto è ciò che concede all'app l'accesso a quel file.
- (senza Picker) campo «Ho il link o l'ID»: funziona solo con scope completo o file già aperto con quell'account.

Poi `IdentityGuard` associa l'account al membro (e, se per un ritardo dell'invito esistono due membri con la stessa email, li unifica tenendo quello con il piano). Dopo il collegamento il file è condiviso e il motore sincronizza come in §4.

### 5.3 Rimozione
Il proprietario: `Membri → Modifica → Rimuovi membro` → `drive.removeShare()` (revoca i permessi `writer` di quell'email) + tombstone del membro e del suo piano.

---

## 6. Notifiche

### 6.1 Cosa e a chi
`lib/notifications.ts → diffNotifications(prev, next, me)` (funzione pura) confronta il DB prima/dopo e produce per `me`:

| Tipo | Condizione | Titolo |
|---|---|---|
| `extra` | voce extra nuova con `by ≠ me` | «Bruno ha aggiunto «Detersivo» alla spesa» |
| `check` | articolo/extra spuntato da `by ≠ me` (solo alla prima spunta; ignora «Nuova spesa») | «Sara ha preso Latte» · oltre 3: «Sara ha spuntato 5 articoli» |
| `plan` | giorni del **mio** piano modificati da `by ≠ me` | «Emilio ha modificato il tuo piano» · oltre 3 giorni: «…ha aggiornato il tuo piano» |

Mai notificato per le proprie modifiche; le modifiche senza autore non generano nulla.

### 6.2 Ricezione (campanella + avvisi)
Quando arrivano dati **remoti** (`source:'remote'`) lo store calcola `diffNotifications(prev,next,me)`: le notifiche vanno nella campanella (persistite per casa+membro in `localStorage`), se l'app è in primo piano compare un avviso, se è in background e le notifiche di sistema sono attive → `registration.showNotification` (tag = `n.tag`, per sostituire invece di accumulare).

### 6.3 Invio ai familiari (push)
Dopo una modifica **locale** (`commit`) `queuePeers(prev,next,me)`: per ogni altro membro con email calcola `diffNotifications(prev,next,m.id)` e mette le voci nella **coda persistente** (`pushQueue`, `localStorage: mealduo:pushQueue`, max 100, scarto dopo 24 h, deduplicazione per `key`).

La coda viene svuotata **solo dopo che i dati sono arrivati su Drive** (`afterSync → flushPush`): chi riceve la notifica trova già il dato. Per ogni voce `POST /notify` al Worker; esiti: `ok` / `drop` (400/403/404/413 o voce eliminata nel frattempo) / `retry` (rete o 5xx: ci si ferma e si riprova al ciclo successivo).

### 6.4 Il service worker
`public/push-sw.js` (caricato da Workbox via `importScripts`):
- `push`: se c'è una finestra visibile **non mostra nulla** e manda `postMessage({type:'mealduo-push'})` → l'app sincronizza subito; altrimenti `showNotification(title, {body, tag, icon})`.
- `notificationclick`: porta in primo piano l'app o la apre.
Le chiamate cross-origin (Google) non vengono mai intercettate né messe in cache.

### 6.5 Attivazione sul dispositivo
`Impostazioni → Notifiche → Attiva notifiche`: richiede il permesso, `registration.pushManager.subscribe` con la chiave VAPID pubblica e `POST /subscribe {fileId, subscription}` (autenticato col token Google). Ogni apertura rinnova l'iscrizione (`refreshPush`). Pulsante «Invia una notifica di prova». **iPhone:** iOS 16.4+ e app aggiunta alla Home.

---

## 7. Il Worker (`worker/`)

| Endpoint | Metodo | Scopo |
|---|---|---|
| `/health` | GET | `{ok:true, auth:<broker configurato?>}` |
| `/auth/start` · `/auth/callback` | GET | login OAuth persistente (§3.3) |
| `/auth/refresh` · `/auth/logout` | POST | token fresco / chiusura sessione (Bearer = id sessione) |
| `/subscribe` · `/unsubscribe` | POST | iscrizione push del dispositivo (Bearer = token Google) |
| `/notify` | POST | invia una notifica ai dispositivi dei destinatari |

**Sicurezza**
- Chiamate dal browser solo da `ALLOWED_ORIGINS` (CORS + controllo `Origin`).
- Ogni richiesta autenticata verifica il token Google (`about`) e l'accesso al file (`files/{id}`): senza accesso al database → 403.
- Gli endpoint push accettati sono solo FCM / APNs / Mozilla / Windows (`PUSH_HOSTS`).
- Messaggio cifrato fino al dispositivo (RFC 8291, `aes128gcm`) e firmato VAPID (RFC 8292). **Il testo passa dal Worker** (nome di chi agisce e articolo).
- Refresh token cifrati a riposo (AES-GCM, `SESSION_KEY` di 32 byte nei *secret*). Chi controlla l'account Cloudflare potrebbe usarli: **proteggilo con la verifica in due passaggi**. Se perdi/cambi `SESSION_KEY` le sessioni vanno rifatte.
- KV (piano gratuito): scritture limitate (1000/giorno) → il Worker scrive solo quando serve (iscrizioni nuove/rinnovate dopo 30 gg, sessioni che invecchiano).
- Limiti: max 20 destinatari per richiesta, 5 dispositivi per utente, corpo ≤ 8 kB.

---

## 8. Setup completo (checklist)

### 8.1 Google Cloud Console
1. Crea un progetto; abilita **Google Drive API** (e **Google Picker API** per il Picker).
2. **Schermata consenso OAuth**: tipo *Esterno*, scope `.../auth/drive.file` (non sensibile → nessuna verifica). Per l'accesso persistente: **Pubblica l'app** (in *Testing* i refresh token scadono dopo 7 giorni). In produzione senza verifica compare «app non verificata»: *Avanzate → Vai a Meal Duo*.
   - **Branding** (obbligatorio per pubblicare: senza, il pulsante *Pubblica app* resta grigio con il messaggio «devi inserire le informazioni mancanti»). In *Google Auth Platform → Branding* compila:
     - **Nome dell'app:** `Meal Duo`
     - **Email di assistenza** e **email di contatto dello sviluppatore:** il tuo indirizzo
     - **Home page dell'app:** `https://<utente>.github.io/<repo>/` (es. `https://emilioamici.github.io/meal-duo/`)
     - **Norme sulla privacy:** `https://<utente>.github.io/<repo>/privacy.html` (la pagina è inclusa nell'app: `public/privacy.html`)
     - *(facoltativi)* logo (puoi usare `assets/icon-source.png`) e condizioni di servizio.

     Prima di salvare apri i due indirizzi dal browser: l'app deve essere già pubblicata su GitHub Pages (merge + deploy), altrimenti rispondono 404. Se Google chiede i **domini autorizzati**, `github.io` non è un dominio tuo e potrebbe essere rifiutato: in quel caso serve un dominio personalizzato per Pages (con lo scope `drive.file` non è richiesta la verifica dell'app, ma i link devono essere validi).
     Poi, in *Pubblico*, premi **Pubblica app** (stato *In produzione*).
3. **ID client OAuth → Applicazione web**:
   - Origini JS autorizzate: `http://localhost:5173`, `https://<utente>.github.io` (solo schema+dominio).
   - **URI di reindirizzamento** (solo con il Worker): `https://<worker>.workers.dev/auth/callback`.
   - Copia **Client ID** e (per il Worker) **client secret** (mai in chat né nel repo).
4. *(Picker)* **Chiave API**: *Restrizioni delle API* → solo **Google Picker API**; *Restrizioni delle applicazioni → Siti web* → `https://<utente>.github.io/*` (**origine senza percorso**: il Picker gira in un iframe di Google e il browser invia solo l'origine; con `…/meal-duo/*` si ottiene «The API developer key is invalid»). **App ID** = numero del progetto.

### 8.2 Worker (una volta sola)
```bash
node worker/scripts/generate-vapid.mjs        # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
node worker/scripts/generate-session-key.mjs  # SESSION_KEY (solo per l'accesso persistente)
cd worker && cp wrangler.example.toml wrangler.toml
# in wrangler.toml: ALLOWED_ORIGINS="https://<utente>.github.io,http://localhost:5173",
#                   VAPID_SUBJECT, GOOGLE_CLIENT_ID (se accesso persistente)
npx wrangler login
npx wrangler kv namespace create SUBS         # incolla l'id in wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put GOOGLE_CLIENT_SECRET  # solo accesso persistente
npx wrangler secret put SESSION_KEY           # solo accesso persistente
npx wrangler deploy                           # poi apri <url>/health → {"ok":true,"auth":true}
```

### 8.3 GitHub (Settings → Secrets and variables → Actions → **Variables**)
| Variabile | Valore |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Client ID OAuth |
| `VITE_GOOGLE_API_KEY` · `VITE_GOOGLE_APP_ID` | Picker (consigliato: abilita `drive.file`) |
| `VITE_PUSH_URL` | URL del Worker, senza `/` finale |
| `VITE_VAPID_PUBLIC_KEY` | chiave pubblica VAPID |

Poi **Settings → Pages → Source: GitHub Actions** e rilancia il deploy.

### 8.4 Sui dispositivi
1. Apri l'app → *Impostazioni → Sincronizzazione e account → Collega Google Drive* → accedi. (Con il Worker: «Attiva l'accesso persistente» se già dentro.)
2. Proprietario: *Crea casa* → *Invita con Google Drive*. Gli altri: accedono e scelgono il database (Picker).
3. *Impostazioni → Notifiche → Attiva notifiche* su ogni telefono; «Invia una notifica di prova».

---

## 9. Risoluzione problemi

| Sintomo | Causa / rimedio |
|---|---|
| `redirect_uri_mismatch` | l'URI in Google Cloud ≠ `https://<worker>/auth/callback` (schema e percorso inclusi) |
| *Pubblica app* grigio («devi inserire le informazioni mancanti») | compila *Branding*: nome, email di assistenza, home page e URL dell'informativa privacy (`…/privacy.html`) |
| «Google non ha rilasciato il token di rinnovo» | app già autorizzata: rimuovi l'accesso su myaccount.google.com/permissions e riprova |
| Dopo 7 giorni chiede di nuovo l'accesso | app ancora in *Testing*: pubblicala |
| «Origine non autorizzata» (403) | `ALLOWED_ORIGINS` deve essere l'origine esatta (`https://utente.github.io`, senza percorso) |
| «The API developer key is invalid» nel Picker | restrizione della chiave con percorso: usa `https://<utente>.github.io/*`; controlla anche che Picker API sia abilitata e inclusa nelle restrizioni della chiave |
| `404` aprendo il database (secondo membro) | con `drive.file` serve il **Picker**; oppure il file è stato spostato/non più condiviso |
| «Permesso negato: serve l'accesso in modifica» | il proprietario deve dare il ruolo Editor |
| La prova push non arriva | permesso notifiche bloccato per il sito; l'app deve essere in background (in primo piano compare la campanella). Log: `npx wrangler tail` |
| iPhone non riceve il push | serve iOS 16.4+ e l'app aperta dall'icona sulla Home |
| Un dispositivo non riceve più nulla | disattiva/riattiva «Attiva notifiche» (il Worker elimina le iscrizioni non più valide) |
| «Copia locale non allineata a Drive» | transitorio: al ciclo successivo si rilegge Drive; nessun dato viene sovrascritto |
| Stato «Accedi» in continuazione | sessione scaduta/revocata: un tocco sulla pillola (o «Riconnetti Google Drive») |

---

## 10. Allineamento con MoneyDuo

| Aspetto | MoneyDuo | Meal Duo |
|---|---|---|
| Avvio | **Gate** a schermo intero: senza `fileId` non si entra | **Uguale**: `Gate` (`components/Gate.tsx`). Unica aggiunta: «Prova senza account (dati demo)», perché la demo era un requisito di Meal Duo (`lib/localMode.ts`). Chi ha già dati locali non vede il Gate |
| Sessione scaduta con casa collegata | Overlay che blocca l'app finché non si rientra | **Uguale**: overlay `login-overlay` (z-100) con `Gate reconnect`; l'app resta montata sotto con `inert` |
| Selettore cartella | `FolderPicker` interno + Picker | **Uguale**: `FolderPicker` (esplora/crea cartelle) quando il Picker non è configurato, altrimenti Picker; in più «Sposta il database» (`engine.moveTo`) nella scheda Sincronizzazione |
| Lingue | catalogo it/en | **Uguale**: `src/i18n` (`t`, `tb`, `tp`, `dayShort/dayLong`, `locale`), `en.ts`, selettore Automatico/Italiano/English, test di copertura |
| Service worker | `public/sw.js` scritto a mano | Workbox (`vite-plugin-pwa`) + `public/push-sw.js` con gli stessi gestori `push`/`notificationclick` (stesso comportamento: niente notifica con l'app in primo piano, `postMessage` per sincronizzare subito). La differenza è solo nel *come* si fa il caching |
| Apple Wallet | sì (Worker `/wallet/*`) | **Non portato** (specifico di MoneyDuo) |

**Dove Meal Duo resta volutamente diverso** (non sono lacune da colmare):
- **Merge:** MoneyDuo ha il suo `mergeDb` sul modello transazioni/conti; Meal Duo ha un merge LWW per record con tombstone e `by` sul *suo* modello (piani, catalogo, spunte), con test di commutatività e idempotenza.
- **Concorrenza in scrittura:** MoneyDuo legge la versione e carica; Meal Duo fa **in più** un secondo `getMeta` prima del `PATCH` e ripete il merge (max 3 volte).
- **Notifiche:** gli eventi dipendono dal dominio (spese extra, spunte, modifica del proprio piano invece di transazioni e conti).
- **Membri duplicati per email:** `dedupeMembersByEmail` unifica chi accede prima che l'invito arrivi su Drive; l'invito viene inoltre caricato subito (`syncNow`).
- **Conferme distruttive:** pulsanti a due tocchi (regola del Design System) invece del dialogo `ask()`.

## 11. Mappa dei file

| Area | File |
|---|---|
| Token Google (popup) | `src/sync/google.ts` |
| Sessione persistente (client) | `src/sync/auth.ts` |
| Drive REST | `src/sync/drive.ts` |
| Picker | `src/sync/picker.ts` |
| Motore di sync | `src/sync/engine.ts` (+ `engine.test.ts`) |
| Push (client) | `src/sync/push.ts`, `pushQueue.ts` |
| Cache IndexedDB | `src/state/cache.ts` |
| Store, notifiche, coda | `src/state/store.tsx`, `src/lib/notifications.ts` |
| UI | `Gate`, `ConnectSheet` (flusso di collegamento), `FolderPicker`, `IdentityGuard`, `SyncCard`, `NotificationsCard`, `Notifications`, `Chrome` (pillola+campanella), `SettingsView` (impostazioni: membri/inviti, catalogo, piano JSON), `App.tsx` (`Root`: Gate / overlay di riconnessione) |
| Lingue | `src/i18n/{index,en,rich}.ts`, `src/lib/text.ts` |
| Merge / DB | `src/services/merge.ts`, `dbOps.ts`, `dbSchema.ts` |
| Service worker push | `public/push-sw.js`, `vite.config.ts` (`importScripts`) |
| Worker | `worker/src/{index,auth,webpush}.ts`, `worker/scripts/*.mjs`, `worker/wrangler.example.toml`, `worker/README.md` |
| Deploy | `.github/workflows/deploy.yml` |

## 12. Cosa è stato verificato (e cosa no)

**Verificato automaticamente (151 test):** merge (commutatività, idempotenza, tombstone), motore di sync con Drive simulato (push, merge bidirezionale, race GET→PATCH, sola lettura, offline, copia persa/datata, creazione/collegamento casa), notifiche, coda push, cifratura RFC 8291, VAPID, endpoint del Worker (subscribe/notify/auth), service worker push.

**Verificato in browser (Playwright, due dispositivi, Drive e Worker simulati):** Anna parte dal **Gate** e accede con sessione persistente → crea la casa → invita Bruno (permesso `writer` su Drive) → Bruno accede, la casa viene trovata e collegata da sola, nessun membro duplicato → Bruno aggiunge una voce extra → viene scritta su Drive con l'autore, il Worker riceve la richiesta di push per Anna → Anna sincronizza e vede la notifica nella campanella → la sua sessione viene revocata: compare l'**overlay di riconnessione** → ritorno dal login col Worker (sessione nel frammento dell'URL) e l'app riprende. In un altro test: primo avvio in inglese → «Prova senza account» → nessuna parola italiana nell'interfaccia → cambio lingua immediato.

**Non verificato:** OAuth e Drive reali con un Client ID (serve il tuo progetto Cloud), Picker reale, deploy reale del Worker su Cloudflare, push ricevuto su iOS/Android reali. Sono i primi passi da fare dopo il setup di §8.
