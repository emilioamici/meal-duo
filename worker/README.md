# Server delle notifiche push (Cloudflare Worker)

Piccolo server che permette di ricevere le notifiche **anche con l'app chiusa**. Gira gratis su Cloudflare Workers.

## Come funziona
- Ogni dispositivo che attiva le notifiche si **iscrive** al server (indirizzo del servizio di push del browser + chiavi di cifratura).
- Quando qualcuno aggiunge una transazione o un conto, **la sua app dice al server a chi inviare la notifica** (le regole sono quelle delle notifiche nell'app). Il server cifra il messaggio e lo spedisce al servizio di push di Google/Apple/Mozilla, che lo consegna al telefono.
- Il server **non ha mai accesso a Drive** e, per le sole notifiche, non conserva token Google (con l'accesso persistente facoltativo conserva invece un token di rinnovo cifrato: vedi sotto). A ogni richiesta controlla il token Google di chi scrive: deve essere valido e avere accesso al file del database della famiglia. Salva solo gli iscritti, sotto chiave `id del database + email`.
- Il messaggio è cifrato fino al dispositivo (RFC 8291). Il testo però passa dal server: nella notifica ci sono il nome di chi ha fatto la modifica e il nome dell'articolo.

## Cosa serve
- Un account Cloudflare gratuito: <https://dash.cloudflare.com/sign-up> (non serve carta di credito).
- Node 20 o successivo sul tuo computer.

I limiti del piano gratuito bastano di gran lunga per una famiglia: 100.000 richieste al giorno, e le scritture sull'archivio KV (1.000 al giorno) avvengono solo quando un dispositivo si iscrive o si rinnova.

## Installazione (una volta sola)
Dalla cartella del progetto:

1. **Chiavi VAPID** (identificano il tuo server presso i servizi di push):
   ```bash
   node worker/scripts/generate-vapid.mjs
   ```
   Stampa `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. Copiale da qualche parte. **La privata non va mai condivisa né committata.**

2. **Configurazione**:
   ```bash
   cd worker
   cp wrangler.example.toml wrangler.toml
   ```
   Apri `wrangler.toml` e sostituisci `<utente>` con il tuo nome utente GitHub (`ALLOWED_ORIGINS` deve essere esattamente l'origine del sito, per esempio `https://emilioamici.github.io`, **senza** `/meal-duo` e senza `/` finale). `wrangler.toml` è ignorato da Git.

3. **Accesso a Cloudflare**:
   ```bash
   npx wrangler login
   ```
   Si apre il browser: accedi e autorizza.

4. **Archivio degli iscritti (KV)**:
   ```bash
   npx wrangler kv namespace create SUBS
   ```
   Il comando stampa un `id`. Incollalo in `wrangler.toml` al posto di `INSERISCI_QUI_L_ID_DEL_KV`.

5. **Segreti** (ti viene chiesto di incollare il valore):
   ```bash
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_PUBLIC_KEY
   ```

6. **Pubblicazione**:
   ```bash
   npx wrangler deploy
   ```
   Alla fine stampa l'indirizzo, per esempio `https://mealduo-push.tuo-nome.workers.dev`. Aprendo `…/health` nel browser deve comparire `{"ok":true}`.

## Collegare l'app
In GitHub, *Settings → Secrets and variables → Actions → Variables*, crea `VITE_PUSH_URL` (indirizzo del server, senza `/` finale) e `VITE_VAPID_PUBLIC_KEY` (la chiave pubblica). Poi rilancia il deploy (*Actions → Deploy → Run workflow*). Sono valori pubblici e vengono inseriti nell'app alla pubblicazione: nessun utente deve inserire nulla. Non c'è più un campo nell'app per modificarli.

## Attivarle sui dispositivi
Su ogni telefono o computer: *Impostazioni → Notifiche → Attiva notifiche* (un solo interruttore: attiva sia le notifiche del dispositivo sia, se il server è configurato, il push anche con l'app chiusa), poi concedi il permesso. Premi *Invia una notifica di prova* per verificare. Chi aveva già le notifiche attive viene iscritto al server da solo alla prima apertura dopo la configurazione; se il server non risponde compare «Riprova ad attivarle anche con l'app chiusa».

- **iPhone:** serve iOS 16.4 o successivo e l'app **aggiunta alla schermata Home** (Safari → Condividi → Aggiungi a Home). Dalle semplici pagine di Safari il push non funziona.
- **Android e computer:** funziona anche da browser.

## Accesso persistente (facoltativo)
Il token di accesso di Google dura 1 ora, e un sito statico non può rinnovarlo da solo: dopo un'ora, o a ogni riapertura, serve un tocco su «Riconnetti». Con questo server l'accesso diventa **persistente**: il Worker conserva il token di rinnovo e l'app ottiene token freschi da sola, senza popup e **anche in background**, quindi le notifiche non si fermano.

**Prima di attivarlo, due cose da sapere**
- Il Worker custodirà un token di rinnovo con **accesso completo a Google Drive** per ogni persona che lo attiva, oltre al **client secret** dell'app. È cifrato (AES-GCM, chiave `SESSION_KEY` nei segreti di Cloudflare) e non esce mai dal Worker, ma chi controllasse il tuo account Cloudflare potrebbe usarlo. Usa un account Cloudflare protetto da verifica in due passaggi.
- Sul dispositivo resta un identificativo di sessione casuale (in `localStorage`): chi lo ottenesse potrebbe farsi dare token d'accesso dal Worker. Se sul tuo `<utente>.github.io` pubblichi anche altri siti, valuta un dominio dedicato.

**1. Google Cloud Console**
1. **Pubblica l'app.** Vai su *Google Auth Platform → Pubblico* (o *Schermata consenso OAuth*) e premi **Pubblica app** (stato *In produzione*). Il pulsante resta grigio finché in *Branding* non compili nome dell'app, email di assistenza, home page (`https://<utente>.github.io/meal-duo/`) e informativa sulla privacy (`https://<utente>.github.io/meal-duo/privacy.html`, inclusa nell'app). Se resta in *Testing*, Google fa scadere i token di rinnovo dopo **7 giorni**. In produzione senza verifica, Google mostra «app non verificata» al primo accesso: *Avanzate → Vai a Meal Duo*. Per uso personale va bene (limite di 100 utenti).
2. **Aggiungi l'URI di reindirizzamento.** In *Client → il tuo ID client OAuth → URI di reindirizzamento autorizzati* aggiungi l'indirizzo del Worker seguito da `/auth/callback`, per esempio `https://mealduo-push.tuo-nome.workers.dev/auth/callback`.
3. **Copia il client secret** dalla stessa pagina del client. Non incollarlo in chat né nel repository: lo inserirai tra poco nel terminale.

**2. Worker**
```bash
node worker/scripts/generate-session-key.mjs        # stampa SESSION_KEY: copiala
cd worker
```
Poi:
- in `wrangler.toml` togli il `#` davanti a `GOOGLE_CLIENT_ID` e inserisci l'ID del client (è pubblico);
- imposta i due segreti (ti viene chiesto di incollare il valore):
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  npx wrangler secret put SESSION_KEY
  npx wrangler deploy
  ```
- apri `…/health` nel browser: deve comparire `{"ok":true,"auth":true}`.

**3. App**
Non serve altro (l'app usa lo stesso indirizzo del server delle notifiche). Sulle nuove installazioni «Accedi con Google» passa dal Worker. Dove sei già dentro: *Impostazioni → Sincronizzazione e account → Attiva l'accesso persistente*. Dopo il consenso su Google l'app ricompare con «Accesso persistente attivo».

**Come si gestisce**
- *Esci* elimina la sessione **di quel dispositivo**. Il token di rinnovo non viene revocato su Google, perché scollegherebbe anche gli altri dispositivi.
- Per revocare tutto: <https://myaccount.google.com/permissions> → Meal Duo → Rimuovi accesso. Al rinnovo successivo il Worker se ne accorge, cancella la sessione e l'app chiede un nuovo accesso.
- Se cambi o perdi `SESSION_KEY`, le sessioni esistenti non sono più leggibili: basta rifare l'accesso.
- Le sessioni scadono dopo 180 giorni di inattività.

**Se qualcosa non va**
- **«Google non ha rilasciato il token di rinnovo»:** l'app era già autorizzata. Rimuovi l'accesso su myaccount.google.com/permissions e riprova.
- **Errore `redirect_uri_mismatch` su Google:** l'URI nel punto 1.2 non coincide con l'indirizzo del Worker (compreso `https://` e `/auth/callback`).
- **Dopo 7 giorni chiede di nuovo l'accesso:** l'app è ancora in *Testing*; vedi il punto 1.1.
- **«Origine non autorizzata»:** `ALLOWED_ORIGINS` deve contenere l'origine dell'app (per esempio `https://emilioamici.github.io`, senza percorso).

## Il ponte: condivisione del database tra account Google

Con il permesso minimo `drive.file` un'app vede solo i file che ha creato o che l'utente ha aperto con il Selettore di Google: un file creato da A **non** è accessibile da B, nemmeno se condiviso su Drive. Il Worker fa da ponte: legge e scrive il file con l'accesso di chi ha creato la famiglia, ma solo per gli account autorizzati. Il database è un file JSON nel Drive del proprietario; il Worker non lo conserva né lo registra.

**Endpoint** (tutti `POST`, solo da `ALLOWED_ORIGINS`, con `Authorization: Bearer <token Google>`):

| Rotta | Chi | Cosa fa |
|---|---|---|
| `/house/register {fileId, session}` | solo il proprietario del file | affida al Worker il collegamento (token di rinnovo **cifrato** in KV `house:<fileId>`); verifica che la sessione sia dello stesso account; indicizza in `inv:<email>` gli account già presenti tra le condivisioni |
| `/house/join {fileId}` | chiunque presenti il codice | il **codice è l'ID del file**: il Worker, con l'accesso del proprietario, aggiunge l'account tra gli scrittori (`sendNotificationEmail=false`). Max 20 account. Chi ha già un permesso (anche di sola lettura) non viene toccato; ripetere non duplica |
| `/house/mine` | un invitato | i file condivisi con l'account e collegati al ponte (inviti ricevuti senza codice) |
| `/db/meta`, `/db/read`, `/db/write {fileId, db, expectedVersion}` | chi è tra le condivisioni (per scrivere: ruolo writer/owner) | legge/scrive con l'accesso del proprietario. La scrittura avviene solo se la versione di Drive coincide con `expectedVersion` (altrimenti `409`, l'app rilegge e rifà il merge); la forma del database è validata (`400`); corpo massimo ~6 MB |
| `/subscribe`, `/unsubscribe`, `/notify` | idem | notifiche push: accettano anche chi passa dal ponte |

**Modello di sicurezza**
- L'unica fonte di autorizzazione è la **condivisione del file su Drive**: nel Worker non c'è un elenco di membri. Invitare = `permissions.create` (writer), togliere = `permissions.delete`. A ogni chiamata il Worker rilegge i permessi con l'accesso del proprietario (non si mettono in cache): togliere un account chiude subito il ponte per lui.
- Il client non è creduto sulla parola: ogni richiesta porta un token Google che il Worker verifica con `tokeninfo` (emesso per **il tuo** Client ID, e con il solo permesso `drive.file`) e da cui ricava l'email con `drive/v3/about`. Un token emesso per un'altra app o con un permesso più ampio riceve `401`. Il token non si salva mai; in memoria restano per al più 60 secondi solo l'impronta del token e l'email.
- Se Google revoca l'accesso del proprietario (`invalid_grant`) il collegamento `house:<fileId>` si cancella e le chiamate rispondono `410`: chi ha creato la famiglia deve riaprire l'app.
- Il refresh token del proprietario e quelli di sessione sono cifrati con AES-GCM (`SESSION_KEY`); i segreti si impostano solo con `npx wrangler secret put`.

**⚠ Il codice è un segreto condiviso.** Chi conosce l'ID famiglia può entrare con `/house/join`, e l'ID non si può cambiare. Per togliere una persona la si rimuove dalla condivisione su Drive (l'accesso si chiude subito), ma se ha ancora il codice può rientrare. Se il codice trapela, crea una nuova famiglia. Se vuoi che entrino solo persone invitate per email, non distribuire il codice: l'invito con email e il link `#join` funzionano comunque, ma il link contiene lo stesso codice.

**Senza Worker** l'app funziona lo stesso: si invita per email e chi entra conferma il file con il Selettore di Google (ristretto a quel file). Ogni funzione del server si attiva solo se `GET /health` la dichiara: `{ ok, auth, push, bridge }` (`auth`: accesso persistente configurato; `push`: chiavi VAPID presenti; `bridge`: ponte attivo, richiede l'accesso persistente). Un Worker più vecchio non ha `/house/join`: l'app prosegue con il Selettore.

**Pubblicare** (dopo ogni modifica al Worker, a mano; GitHub Pages si aggiorna da solo, il Worker no):
```bash
cd worker
npx wrangler deploy
```

**Checklist Google Cloud**
1. *Google Auth Platform → Branding/Pubblico*: pubblica l'app in **Produzione** (con il solo `drive.file` non serve la verifica). In *Testing* il token di rinnovo scade dopo 7 giorni e l'accesso persistente non è davvero persistente.
2. *Credenziali → ID client OAuth (Applicazione web)*: **Origini JavaScript autorizzate** = `https://<utente>.github.io` (schema + dominio, senza percorso); **URI di reindirizzamento** = `https://<tuo-worker>.workers.dev/auth/callback`.
3. Client ID e segreto del Worker (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) dello **stesso progetto**; `GOOGLE_CLIENT_ID` coincide con `VITE_GOOGLE_CLIENT_ID` dell'app. Il Worker chiede sempre e solo il permesso `drive.file`: chi aveva una sessione creata con un permesso più ampio riceve `401` e deve rifare l'accesso una volta.
4. API abilitate: **Google Drive API** e **Google Picker API** (il Selettore serve solo come ripiego).

**«The API developer key is invalid» (Selettore)**
- La chiave API è una **Variable** di GitHub (*Settings → Secrets and variables → Actions → Variables*, `VITE_GOOGLE_API_KEY`), **non** un Secret: i Secret non arrivano alla build dell'app.
- Chiave API e Client ID devono essere dello **stesso progetto** Google Cloud; `VITE_GOOGLE_APP_ID` è il *numero del progetto*.
- Abilita *Google Picker API* e *Google Drive API*; limita la chiave solo a *Google Picker API*.
- *Restrizioni delle applicazioni → Siti web*: `https://<utente>.github.io/*` (**origine senza percorso**: il Selettore gira in un iframe di Google e il browser invia solo l'origine; con `…/meal-duo/*` si ottiene proprio questo errore).
- Con il ponte attivo e il codice, il Selettore non serve: un errore sulla chiave non impedisce di entrare.

## Promemoria dei pasti (a orario o a evento)

Da *Impostazioni → Promemoria pasti* ogni persona può ricevere una notifica «è ora di Pranzo», con gli alimenti del proprio piano, anche con l'app chiusa. Serve il Worker aggiornato e le notifiche attive su quel dispositivo.

**A un orario.** Le regole (pasto, orario, giorni) e il fuso orario del dispositivo stanno nel KV del Worker (`rem:<file>:<email>`): una PWA chiusa non può programmarsi le notifiche, quindi le invia il server. Un **Cron Trigger** si sveglia ogni 5 minuti e invia i promemoria arrivati all'orario (nel fuso dell'utente, calcolato con `Intl` a ogni giro: regge l'ora legale). Se un giro salta, il promemoria parte al successivo (finestra di 10 minuti); un segno per regola e per giorno evita doppioni. Sulla notte del cambio all'ora legale, un orario compreso nell'ora che non esiste (02:00–02:59) quel giorno non scatta.

> **⚠ Dopo aver aggiornato il Worker devi aggiungere il cron a mano.** `wrangler.toml` è una copia locale ignorata da Git: copia queste righe da `wrangler.example.toml` e ripubblica (`npx wrangler deploy`). Senza, gli orari **non partono mai**:
> ```toml
> [triggers]
> crons = ["*/5 * * * *"]
> ```
> Il cron scrive un battito (al massimo ogni ora) e l'app avvisa «il server non sta eseguendo gli orari» se non lo vede da 3 ore.

**A un evento** (come Apple Wallet in MoneyDuo). Un'automazione dell'app Comandi dell'iPhone chiama un indirizzo personale: `POST|GET /reminder/in/<token>?meal=Pranzo`. Si crea dalla scheda; il token si vede una sola volta (sul server resta solo l'hash), si rigenera con «Nuovo indirizzo» e si disattiva. Il pasto è un parametro, quindi con lo stesso indirizzo si fanno più automazioni (`?meal=Cena`). La chiamata non porta credenziali del browser né `Origin`; è limitata a 12 all'ora per indirizzo (poi `429`) e risponde **solo con numeri** (`sent`, `failed`, `removed`): l'indirizzo non permette di leggere il piano.
Quali eventi si possono usare come innesco dipende da iOS e dalle app (non ho verificato che esista un innesco «notifica di Strava»): l'indirizzo funziona con qualsiasi automazione che possa fare «Ottieni contenuti dell'URL».

| Rotta | Chi | Cosa fa |
|---|---|---|
| `/reminders/get`, `/reminders/save` | account con accesso al file (token Google) | legge/salva le regole (max 12) |
| `/reminders/token`, `/reminders/revoke` | idem | crea/rigenera/disattiva l'indirizzo per gli eventi |
| `/reminders/test` | idem | invia subito il promemoria ai propri dispositivi, con anteprima del testo |
| `/reminder/in/<token>` | l'automazione dell'iPhone | scatena il promemoria (solo numeri nella risposta) |

**Sicurezza e privacy.** Il cron e l'indirizzo non portano un token Google: prima di mettere il contenuto di un pasto in una notifica il Worker **riverifica con l'accesso di chi ha creato la famiglia** che l'account sia ancora tra le condivisioni del file; se non lo è, non invia nulla e cancella orari e indirizzo. Il piano non si copia mai in KV: si legge dal database solo quando un promemoria scatta. Se la famiglia non è collegata al ponte il testo è generico («Apri Meal Duo…»). Nel KV restano: orari, giorni, fuso orario, testi delle notifiche, l'hash del token e i segni «già inviato oggi» (2 giorni).

**Limiti del piano gratuito.** Il lavoro di ogni giro è limitato (al massimo 40 account e circa 45 operazioni tra KV e rete, sotto il limite di sottorichieste del piano gratuito); se ci sono tanti promemoria insieme, il resto parte al giro successivo. Il cron usa ~290 letture di elenco al giorno e poche scritture (battito orario, un segno per promemoria inviato). Controlla i limiti correnti di Cloudflare per KV e Workers prima di fare affidamento su numeri più alti.

## Se qualcosa non va
- **«Origine non autorizzata» (403):** `ALLOWED_ORIGINS` non coincide con l'indirizzo del sito. Correggi `wrangler.toml` e rifai `npx wrangler deploy`.
- **«Sessione Google non valida» (401):** il token Google è scaduto; tocca *Riconnetti* nell'app e riprova.
- **«Nessun accesso al database» (403):** l'account non ha accesso al file del database della famiglia.
- **La prova non arriva:** controlla che il permesso notifiche non sia bloccato nelle impostazioni del browser per il sito, e che l'app sia in background (con l'app aperta la notifica compare nella campanella). Per vedere i log: `npx wrangler tail`.
- **Un dispositivo non riceve più nulla:** riattiva l'interruttore (il server elimina le iscrizioni non più valide).

## Limiti
- La notifica parte solo per le modifiche **fatte dall'app** (non per quelle fatte a mano sul file in Drive).
- **La notifica parte quando i dati arrivano su Drive**, non quando tocchi: così chi la riceve trova subito la spesa aggiornata. Se sei offline, le notifiche restano in coda sul dispositivo (fino a 24 ore, max 100) e partono dopo l'invio dei dati; se il server push non risponde si riprova al ciclo successivo. Se nel frattempo elimini la voce extra, la notifica viene scartata. In quel momento serve una sessione Google valida.
- Anche con l'app in primo piano il push mostra la notifica di sistema (Safari non ammette push silenziose) e l'app sincronizza subito. Le spunte successive dello stesso autore **sostituiscono** la notifica precedente (stesso `tag`), per non riempire il telefono mentre qualcuno fa la spesa.

## Sviluppo e test
```bash
npm test                      # include i test del server (cifratura RFC 8291, VAPID, endpoint)
node worker/scripts/generate-vapid.mjs
```
Il Worker usa solo API standard (WebCrypto, fetch): gira anche in Node 20+. È stato provato anche sul runtime Cloudflare in locale (`wrangler dev`).

## Permesso ristretto
Meal Duo usa sempre il permesso ristretto `drive.file`: l'app chiama `/auth/start?scope=file`: il token di rinnovo copre solo i file dell'app. Ripubblica il Worker e riattiva l'accesso persistente sui dispositivi.
