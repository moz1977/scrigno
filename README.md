# Scrigno – i tuoi video salvati

Web app installabile (PWA) per salvare i link a reel e video di Instagram, TikTok, YouTube, Facebook, X e altri siti, organizzarli in **bacheche**, aggiungere **tag** e **note**, e ritrovarli con la **ricerca**.

- **Dal PC:** copi il link e premi `Ctrl+V` nella pagina, oppure clicchi il bookmarklet **＋ Salva in Scrigno** nella barra dei preferiti mentre guardi il video.
- **Da Android:** installi l'app da Chrome; poi nelle app social premi *Condividi* → **Scrigno**.
- **Ricerca:** scrivi una parola qualsiasi (titolo, nota, bacheca) oppure `#tag`. Puoi filtrare anche per social.

Non servono librerie da installare né una fase di build: sono file HTML, CSS e JavaScript.

```
index.html            pagina dell'app
styles.css            grafica (con tema scuro automatico)
app.js                logica dell'interfaccia
store.js              salvataggio dati (locale o Supabase)
links.js              riconoscimento social, pulizia link, anteprime
config.js             ← qui inserisci le chiavi Supabase (facoltativo)
manifest.webmanifest  rende l'app installabile e la aggiunge al menu Condividi
sw.js                 service worker (installazione e uso offline)
supabase/schema.sql   tabelle per la sincronizzazione
supabase/functions/preview/index.ts   funzione per le anteprime (facoltativa)
icons/                icone dell'app
```

---

## 1. Provala subito sul PC (modalità locale)

Serve un piccolo server locale, perché i moduli JavaScript non funzionano aprendo il file con doppio clic.

```bash
cd scrigno
python -m http.server 8000
```

Poi apri <http://localhost:8000>. Con `config.js` vuoto i dati restano **solo in quel browser**.

> In alternativa, con Android Studio o VS Code: apri la cartella e usa un'estensione tipo *Live Server*.

## 2. Sincronizzare PC e telefono (Supabase, gratuito)

1. Crea un account su <https://supabase.com>, poi **New project** (scegli la regione *Europe* e una password qualsiasi).
2. Apri **SQL Editor → New query**, incolla il contenuto di `supabase/schema.sql` e premi **Run**.
3. Apri **Project Settings → API Keys** e copia:
   - l'indirizzo del progetto, nella forma `https://<id-progetto>.supabase.co` → in `config.js` alla voce `SUPABASE_URL`
   - la **Publishable key** (inizia con `sb_publishable_`, in *Settings → API Keys*) → in `config.js` alla voce `SUPABASE_ANON_KEY`. Va bene anche la vecchia chiave *anon public* (inizia con `eyJ`).
   (Queste chiavi possono stare nel codice pubblico: i dati sono protetti dalle regole RLS dello schema. **Non** usare mai la *Secret key* `sb_secret_…` né la vecchia `service_role`.)
4. Dopo aver pubblicato l'app (passo 3), vai su **Authentication → URL Configuration**:
   - *Site URL* = l'indirizzo dell'app, es. `https://tuonome.github.io/scrigno/`
   - aggiungi lo stesso indirizzo (e `http://localhost:8000/` per le prove) in *Redirect URLs*.

Quando apri l'app ti chiede l'email: ricevi un link e accedi senza password. Usa **la stessa email su PC e telefono**.
Se avevi già salvato video in modalità locale, vai in *Impostazioni → Caricali nel cloud*.

### 2a. Categorie e sottocategorie

Se hai creato le tabelle prima di questa funzione, esegui una volta in **SQL Editor**:

```sql
alter table public.boards add column if not exists parent_id uuid references public.boards(id) on delete set null;
```

Le categorie principali hanno un colore; le sottocategorie (es. *Viaggi › Cina*) lo ereditano. Toccando una categoria vedi le sue sottocategorie, ognuna con il proprio conteggio, e sotto tutti i video della categoria. Le vecchie bacheche chiamate «Viaggi\Cina» si convertono con il pulsante **Converti** che compare nella home.

### 2b. Anteprime anche per Instagram e Facebook (facoltativo)

Una piccola funzione su Supabase apre la pagina del video, ne legge l'immagine di anteprima e la salva in modo permanente.

1. **SQL Editor → New query**: esegui questa riga (è anche in fondo a `schema.sql`):
   `insert into storage.buckets (id, name, public) values ('thumbs', 'thumbs', true) on conflict (id) do nothing;`
2. **Edge Functions → Deploy a new function → Via Editor**.
3. Come nome scrivi esattamente `preview`, cancella il codice di esempio e incolla tutto il contenuto di `supabase/functions/preview/index.ts`. Premi **Deploy function**.
4. Apri la funzione → **Details** (o *Settings*) e **disattiva** "Verify JWT with legacy secret" / "Enforce JWT verification", poi salva. Il controllo di chi può usarla lo fa la funzione stessa.
5. Nell'app: *Impostazioni → Anteprime → Recupera anteprime* per i video già salvati. I nuovi la ricevono in automatico; nella scheda di un video c'è anche **↻ Riprova anteprima**.

Instagram e Facebook a volte rifiutano queste richieste: in quel caso resta il riquadro colorato e puoi riprovare più tardi.

## 3. Pubblicarla online (gratis, con GitHub Pages)

Il menu Condividi di Android e l'installazione funzionano solo se l'app è su **https**.

1. Crea un repository su GitHub (es. `scrigno`) e carica tutti i file di questa cartella.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, cartella `/ (root)` → **Save**.
3. Dopo un minuto l'app è su `https://<tuonome>.github.io/scrigno/`.

Vanno bene anche Netlify o Cloudflare Pages: trascini la cartella e basta.

## 4. Installare e usare

**Android (Chrome):** apri l'indirizzo → menu ⋮ → **Installa app**. Da Instagram, TikTok o YouTube premi *Condividi* → **Scrigno** (la prima volta potrebbe essere sotto "Altro"). Si apre la scheda di salvataggio con il link già compilato.

**PC (Chrome/Edge):** puoi installarla dall'icona nella barra degli indirizzi. Poi apri *Impostazioni* (⚙) e trascina **＋ Salva in Scrigno** nella barra dei preferiti (`Ctrl+Maiusc+B` per mostrarla). Mentre guardi un video, un clic sul preferito apre una finestrella con link e titolo già compilati.

**Scorciatoie:** `/` porta alla ricerca, `Ctrl+V` (fuori dai campi) salva il link copiato, `Esc` chiude.

## Limiti da conoscere

- **Anteprime:** senza la funzione `preview` (sezione 2b) titolo e miniatura arrivano solo per YouTube, TikTok e Vimeo, e quelle di TikTok possono scadere. Con la funzione arrivano anche per Instagram, Facebook e gli altri siti, salvate in modo permanente, ma non sempre: le piattaforme a volte bloccano la lettura.
- Il menu Condividi è disponibile su Android; su iPhone le PWA non lo supportano (lì si usa *Incolla*).

## Prossimi passi possibili

- Trasformarla in app Play Store con una *Trusted Web Activity* (Android Studio + Bubblewrap), mantenendo lo stesso codice web.
