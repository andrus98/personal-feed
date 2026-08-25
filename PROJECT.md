# PROJECT.md — Personal News Aggregator

> Documento di riferimento persistente per lo sviluppo con Claude Code.
> Tenerlo nella root del repo e aggiornarlo man mano che il progetto evolve.

---

## 1. Obiettivo

App personale (single-user, uso esclusivo del proprietario) che aggrega automaticamente
notizie da un set curato di fonti RSS, organizzate per categoria, con possibilità di
consultare uno storico ricercabile e salvare articoli di interesse. Ispirazione: Column AI.

**Non-obiettivi espliciti** (per tenere lo scope stretto in v1):
- Nessuna gestione multi-utente / autenticazione complessa
- Nessuna deduplica automatica tra fonti
- Nessuna categorizzazione automatica via AI/LLM
- Nessuna modalità offline
- Nessuno scraping HTML custom o API a pagamento — solo RSS
- Nessuna fonte con paywall (vedi sezione 4bis)

### Modello di lettura: anteprima + tap-through (non full-text nel DB)

Vincolo esplicito: solo fonti gratuite, senza paywall. Va però chiarito un punto tecnico
che ridefinisce cosa significa "leggere l'articolo nell'app":

- Un feed RSS fornisce quasi sempre **titolo + estratto** (summary/description), non il
  testo integrale dell'articolo. Questo vale anche per le testate gratuite: pochissimi
  feed pubblicano il full-text via RSS (per motivi editoriali, non di paywall).
- Storare nel DB solo il full-text richiederebbe scraping della pagina HTML di ogni
  articolo, un'area grigia rispetto ai termini di servizio della maggior parte degli
  editori anche quando l'accesso è gratuito. Non è nello scope di v1.
- **Modello adottato**: la home mostra titolo + anteprima (estratto dal feed) per ogni
  articolo. Il tap apre l'articolo in una WebView/iframe interno all'app (o browser in-app)
  puntando all'URL originale — l'utente resta "dentro" l'esperienza dell'app senza uscire
  su Safari/Chrome, ma il contenuto pieno arriva comunque dal sito della testata in tempo
  reale. Questo è lo stesso modello usato da Column AI, Feedly, Inoreader e la generalità
  degli aggregatori seri.
- Il criterio "no paywall" garantisce che il tap-through sia sempre leggibile per intero,
  non che il testo integrale sia duplicato nel tuo DB.

---

## 2. Architettura

Tutto vive dentro GitHub: codice, dati, esecuzione schedulata e hosting. Nessun servizio
esterno, nessun backend, nessun dominio da pagare. Costo di esercizio: zero.

```
┌──────────────────────────────┐   cron ~10'   ┌──────────────────────────────┐
│  GitHub Actions              │──────────────▶│  personal-feed-data          │
│  (nel repo personal-feed)    │  commit via   │  (repo pubblico, solo JSON)  │
│  ingest.py + feedparser      │  deploy key   │   data/YYYY/MM/DD/HH.json    │
│  legge sources.json          │  SSH          │   data/YYYY/YYYY-MM.json     │
└──────────────────────────────┘               │   data/index.json            │
                                               │   state.json                 │
                                               └───────────────┬──────────────┘
                                                               │
                     lettura  →  raw.githubusercontent.com  (nessun token, CORS *)
                     scrittura stato  →  api.github.com  (PAT nel localStorage)
                                                               │
                                                               ▼
                                               ┌──────────────────────────────┐
                                               │  PWA vanilla JS              │
                                               │  GitHub Pages                │
                                               │  andrus98.github.io/…        │
                                               │  (repo personal-feed)        │
                                               └──────────────────────────────┘
```

**Decisioni chiave:**

- **L'ingestion gira su GitHub Actions, non nel browser.** Non è una preferenza di design:
  le testate non espongono header CORS sui propri feed, quindi un `fetch()` verso
  `ilsole24ore.com/rss/...` fatto dal client viene bloccato dal browser. Serve per forza un
  runtime fuori dal browser, e su GitHub quel runtime è Actions — gratuito e senza limite di
  minuti sui repo pubblici. È questo il rimpiazzo di n8n.

- **Due repo, con ruoli separati.** `personal-feed` contiene il codice dell'app e il workflow
  di ingestion; `personal-feed-data` contiene solo JSON. La separazione non è estetica: il PAT
  che il browser tiene in `localStorage` per salvare lo stato di lettura è limitato al repo
  dati, quindi non può in nessun caso riscrivere il codice dell'app servita da Pages. I PAT
  fine-grained si scopano per repository, non per branch: tenere i dati in un branch dello
  stesso repo darebbe a quel token anche il permesso di riscrivere `main`.

- **L'Action si autentica con una deploy key SSH**, con permesso di scrittura sul solo
  `personal-feed-data`, salvata come secret del repo `personal-feed`. A differenza di un PAT
  non ha scadenza: nessuna rotazione annuale da ricordare.

- **Leggere non richiede alcun token.** I dati sono pubblici, quindi la PWA li scarica da
  `raw.githubusercontent.com`, che risponde con `access-control-allow-origin: *` e sta dietro
  CDN (cache di qualche minuto, irrilevante per un feed aggiornato ogni ora). Un dispositivo
  nuovo apre l'URL e funziona: il token serve solo a chi vuole *scrivere* lo stato
  letto/salvato.

- **Il refresh in home non triggera l'Action.** Rilegge soltanto ciò che l'Action ha già
  committato, esattamente come prima non triggerava n8n.

- **Layout dati append-only.** Ogni run scrive file nuovi e non riscrive quelli vecchi (vedi
  sezione 4). È la differenza principale rispetto a `spese-app`, dove il file di un mese viene
  riscritto a ogni operazione: lì le scritture sono poche e manuali, qui sono ~24 al giorno per
  sempre, e riscrivere ogni ora un file che a fine mese pesa qualche MB gonfierebbe la history
  del repo di centinaia di MB l'anno.

- **La history del repo dati non è preziosa.** In `spese-app` la history git *è* il backup del
  registro contabile e non si tocca. Qui gli articoli sono un archivio di notizie pubbliche: se
  il repo dati diventasse troppo pesante, la history si può schiacciare senza perdite di
  sostanza.

- **PWA installabile, nessun build step.** Come `spese-app`: HTML/CSS/JS vanilla serviti
  direttamente da Pages, `.nojekyll`, nessun bundler e nessun Node lato progetto. Un frontend
  React/Next.js richiederebbe un build step più un'Action di deploy, cioè l'opposto della
  semplicità che rende `spese-app` manutenibile.

---

## 3. Stack tecnico

| Layer | Tecnologia | Note |
|---|---|---|
| Frontend | HTML/CSS/JS vanilla, PWA | Nessun bundler, nessun build step |
| Hosting | GitHub Pages (repo `personal-feed`) | `andrus98.github.io/personal-feed/`, HTTPS incluso, nessun dominio |
| Database | File JSON nel repo `personal-feed-data` | Letti dal client via `raw.githubusercontent.com` |
| Ingestion/ETL | GitHub Actions + Python 3 (`feedparser`) | Sostituisce n8n. Cron ogni 10', ma vedi sezione 8: lo scheduler gratuito ne onora circa uno su cinque. `feedparser` è la libreria più tollerante verso feed sporchi |
| Auth Action → dati | Deploy key SSH (secret `DATA_DEPLOY_KEY`) | Scrittura sul solo repo dati, senza scadenza |
| Auth browser → dati | PAT fine-grained su `personal-feed-data`, Contents: Read and write | Solo per lo stato letto/salvato. Lo inserisce l'utente, resta in `localStorage` |
| Ricerca | Client-side sui file mensili scaricati on demand | Sostituisce la full-text search di Postgres |
| Versionamento | GitHub | Codice e dati in due repo, entrambi pubblici |

---

## 4. Modello dati (file JSON su GitHub)

Non c'è un database relazionale: i dati sono un albero di file JSON versionati. Le entità del
vecchio schema Postgres restano, ma cambiano forma.

### `sources.json` — repo `personal-feed`

La lista delle fonti con la loro categoria. Sostituisce **entrambe** le tabelle `sources` e
`categories`: le categorie sono un elenco dichiarato in testa al file, non un'entità con id
propri. Si modifica con un commit invece che da un table editor. Vive nel repo del codice
perché serve sia all'Action sia al frontend (che lo carica dalla propria origine, senza
richieste esterne).

```json
{
  "categories": [
    { "slug": "finanza",            "name": "Finanza" },
    { "slug": "economia-business",  "name": "Economia e business" },
    { "slug": "politica",           "name": "Politica interna e internazionale" },
    { "slug": "cronaca",            "name": "Cronaca interna" },
    { "slug": "ai",                 "name": "AI" },
    { "slug": "pagamenti",          "name": "News settore pagamenti e agentic ecommerce" },
    { "slug": "serie-a-roma",       "name": "Serie A e AS Roma" }
  ],
  "sources": [
    {
      "id": "sole-economia",
      "name": "Il Sole 24 Ore – Economia",
      "feed_url": "https://www.ilsole24ore.com/rss/economia.xml",
      "category": "economia-business",
      "active": true
    }
  ]
}
```

`id` è uno slug stabile scelto a mano, non un uuid: serve a ritrovare la fonte nei file degli
articoli e deve restare leggibile in un diff. `active: false` disattiva una fonte senza
cancellarla, come previsto dallo schema originale. Due campi facoltativi: `note`, per annotare
le stranezze di un feed accanto al feed stesso, e `skip_url_contains`, una lista di frammenti
di URL da scartare in ingestion (vedi la nota su Repubblica in 4bis).

### Shard di ingestion — `data/YYYY/MM/DD/HH.json`

Prodotto da un singolo run e **mai riscritto**. Contiene solo gli articoli *nuovi* di quel run.

```json
{
  "run_at": "2026-08-24T14:07:31Z",
  "articles": [
    {
      "id": "a1b2c3d4e5f60718",
      "source": "sole-economia",
      "category": "economia-business",
      "title": "…",
      "link": "https://www.ilsole24ore.com/art/…",
      "summary": "…",
      "published_at": "2026-08-24T13:52:00Z",
      "image_url": "https://…",
      "has_full": false
    }
  ]
}
```

- **`id`** = primi 16 caratteri esadecimali dello SHA-256 del `link` normalizzato. Sostituisce
  l'uuid della tabella `articles`: è deterministico, quindi lo stesso articolo produce sempre lo
  stesso id senza bisogno di un database che glielo assegni, ed è la chiave a cui si aggancia lo
  stato letto/salvato.
- **`summary`** viene troncato a ~600 caratteri e ripulito dall'HTML. Quando è vuoto (caso
  MarketWatch Bulletins) resta `null` e la UI mostra il solo titolo — vedi le note in 4bis.
- **`fetched_at`** dello schema originale non serve più come campo: è implicito nel percorso
  del file e in `run_at`.
- **`category`** è ereditata dalla fonte al momento dell'ingestion, come previsto.

### `data/index.json`

Il manifesto che il client legge per primo. Piccolo (qualche KB), riscritto a ogni run — è
l'unico file la cui riscrittura frequente è accettabile proprio perché resta minuscolo.

Essendo l'unica cosa che cambia in un run a vuoto, `index.json` decide da solo quanti commit
finiscono nel repo dati. Viene riscritto se sono arrivati articoli nuovi o se c'è stato un
consolidamento; altrimenti **solo se l'ultimo aggiornamento risale a più di 45 minuti**.

Il compromesso è fra due esigenze opposte. Riscriverlo sempre significherebbe un commit ogni
dieci minuti anche di notte: la cronologia si riempirebbe di commit identici e smetterebbe di
dire quando sono arrivate notizie. Non riscriverlo mai a vuoto renderebbe impossibile
distinguere "non è successo niente" da "l'ingestion è morta tre giorni fa". Il battito ogni
tre quarti d'ora tiene entrambe: i commit tornano a significare "notizie", e l'app può
comunque dire "ultimo controllo alle 14:47".

```json
{
  "updated_at": "2026-08-24T14:07:31Z",
  "recent": ["2026/08/24/14.json", "2026/08/24/13.json", "…"],
  "months": [{ "path": "2026/2026-07.json", "count": 14231, "bytes": 6114233 }]
}
```

`recent` elenca gli shard degli ultimi ~3 giorni, che il client scarica in parallelo per
costruire la home. `months` elenca gli archivi consolidati, che servono solo alla ricerca
storica.

### Archivi mensili — `data/YYYY/YYYY-MM.json`

A inizio mese l'Action consolida gli shard del mese precedente in un unico file e cancella gli
shard originali. Il client li scarica solo quando la ricerca copre un periodo che non ha già in
memoria. Stima con le 23 fonti attuali: ~5-10 MB per mese (misurati ~630 byte per articolo).

### Testo integrale — `data/full/YYYY/MM/<id>.json`

Solo per le fonti che espongono `content:encoded` (ForzaRoma.info e Giallorossi.net). Tenuto
**fuori** dai file del feed: pesa 5-20 KB per articolo e, se stesse negli shard, rallenterebbe
il caricamento della home anche per tutti gli articoli che il full-text non ce l'hanno. Il campo
`has_full: true` dice al client che il file esiste e può essere caricato al tap.

### `state.json` — repo dati, scritto dal browser

Sostituisce `user_article_state`. Un file solo, nessun `user_id` perché single-user.

```json
{
  "updated_at": "2026-08-24T14:20:00Z",
  "read": ["a1b2c3d4e5f60718", "…"],
  "saved": [
    { "id": "…", "saved_at": "…", "title": "…", "link": "…", "source": "…", "published_at": "…" }
  ]
}
```

- Gli id in `read` vengono potati quando escono dalla finestra recente: un articolo di sei mesi
  fa non ha bisogno di essere ricordato come letto, e la lista crescerebbe all'infinito.
- Gli elementi in `saved` **portano con sé una copia dei campi dell'articolo**. È voluto: un
  salvato deve restare leggibile anche dopo che il suo shard è stato consolidato, e senza dover
  scaricare un archivio mensile da 8 MB per mostrare una riga.
- **Scritture batch, non una per tap.** Un commit a ogni toggle produrrebbe centinaia di commit
  al giorno: le modifiche si accumulano e si flushano con debounce, riusando il pattern outbox
  già collaudato in `spese-app` (che copre anche il caso offline).
- **Conflitti tra dispositivi**: prima di scrivere si rilegge lo `sha` corrente e si fa merge
  come unione degli insiemi. È l'unico punto in cui due dispositivi possono pestarsi i piedi.
- **`state.json` è pubblico**, essendo pubblico il repo dati: chi conosce l'URL vede quali
  articoli hai salvato. Scelta accettata consapevolmente — sono notizie pubbliche.

### Deduplica

Il `link` viene normalizzato (rimozione di parametri UTM e del fragment) prima dell'hash, quindi
lo stesso articolo ripreso a ogni run del feed produce lo stesso `id`. L'Action ricostruisce in
memoria l'insieme degli id degli ultimi 30 giorni leggendo gli shard recenti già presenti nel
checkout, e scarta gli item già visti. Sostituisce l'`on conflict (link) do nothing` di Postgres
**senza introdurre un file `seen` da riscrivere ogni ora**, che sarebbe esattamente il tipo di
churn che il layout append-only vuole evitare.

Questo cattura il caso normale — lo stesso articolo ripreso a ogni run del feed — ma non quello
in cui è la fonte stessa a pubblicare due volte lo stesso pezzo su URL diversi: lì l'hash è
legittimamente diverso e serve una regola esplicita, `skip_url_contains` sulla fonte.

Il checkout del repo dati nell'Action è shallow (`fetch-depth: 1`), quindi il tempo di run non
cresce con la history. Cresce però con la dimensione dell'archivio: quando i file mensili
accumulati renderanno il checkout lento, si passerà a uno sparse checkout limitato a
`index.json` e agli ultimi ~40 giorni di shard. Non è stato fatto subito perché con un archivio
ancora vuoto non porta alcun beneficio e introduce interazioni delicate fra sparse checkout,
consolidamento mensile e `git add`.

### Ricerca

Client-side, su titolo e `summary`, come nello schema originale. Gli shard recenti sono già in
memoria per la home; per lo storico il client scarica gli archivi mensili del periodo cercato e
li tiene in cache (Cache API). Nessun indice precalcolato in v1: con questi volumi un filtro su
stringhe normalizzate è sufficiente, e un indice invertito sarebbe complessità non ancora
giustificata.

---

## 4bis. Elenco fonti selezionate (v1)

Criterio di selezione applicato: **solo fonti gratuite, senza paywall**, con feed RSS che
espone almeno titolo + estratto. Ogni feed è marcato con uno stato di affidabilità — è
fondamentale verificarli tutti a mano prima di metterli in `sources.json`, perché gli URL RSS
cambiano nel tempo e i pattern trovati tramite ricerca non sono garanzie.

**Legenda stato:** ✅ confermato da fonte diretta o indipendente · ⚠️ pattern plausibile,
da verificare manualmente sul sito · ❌ scartato, con motivo.

| Categoria | Fonte | Feed URL | Stato |
|---|---|---|---|
| Finanza | MarketWatch – Bulletins | `https://feeds.content.dowjones.io/public/rss/mw_bulletins` | ✅ Verificato, aggiornato in tempo reale. `description` sempre vuota nel feed (niente anteprima testuale in home per questi articoli), ma il tap-through apre l'articolo completo, no paywall |
| Economia e business | Il Sole 24 Ore – Economia | `https://www.ilsole24ore.com/rss/economia.xml` | ✅ Confermato dall'utente (XML con date recenti) |
| Economia e business | Il Sole 24 Ore – Italia, Attualità | `https://www.ilsole24ore.com/rss/italia--attualita.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | Il Sole 24 Ore – Italia, Politica | `https://www.ilsole24ore.com/rss/italia--politica.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | Il Sole 24 Ore – Italia, Politica economica | `https://www.ilsole24ore.com/rss/italia--politica-economica.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | Il Sole 24 Ore – Mondo, Europa | `https://www.ilsole24ore.com/rss/mondo--europa.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | Il Sole 24 Ore – Mondo, USA | `https://www.ilsole24ore.com/rss/mondo--usa.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | Il Sole 24 Ore – Mondo, Medio Oriente | `https://www.ilsole24ore.com/rss/mondo--medio-oriente.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | Il Sole 24 Ore – Mondo, Asia e Oceania | `https://www.ilsole24ore.com/rss/mondo--asia-e-oceania.xml` | ✅ Confermato dall'utente |
| Finanza | Il Sole 24 Ore – Finanza, Business | `https://www.ilsole24ore.com/rss/finanza--business.xml` | ✅ Confermato dall'utente |
| Finanza | Il Sole 24 Ore – Finanza personale, Investimenti | `https://www.ilsole24ore.com/rss/finanza-personale--investimenti.xml` | ✅ Confermato dall'utente |
| News settore pagamenti e agentic ecommerce | Il Sole 24 Ore – Finanza, Fintech e startup | `https://www.ilsole24ore.com/rss/finanza--fintech-e-startup.xml` | ✅ Confermato dall'utente |
| News settore pagamenti e agentic ecommerce | Il Sole 24 Ore – Tecnologia, Fintech | `https://www.ilsole24ore.com/rss/tecnologia--fintech.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | La Repubblica – Politica | `http://www.repubblica.it/rss/politica/rss2.0.xml` | ✅ Confermato dall'utente |
| Politica interna e internazionale | La Repubblica – Esteri | `http://www.repubblica.it/rss/esteri/rss2.0.xml` | ✅ Confermato dall'utente |
| Cronaca interna | La Repubblica – Cronaca | `http://www.repubblica.it/rss/cronaca/rss2.0.xml` | ✅ Confermato dall'utente |
| Cronaca interna | ANSA – Cronaca | `https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml` | ✅ Verificato: aggiornato in tempo reale, description sempre presente, no paywall |
| AI | TechCrunch – AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | ✅ Confermato da più fonti indipendenti. Gratuito. |
| AI | MIT Technology Review – AI | `https://www.technologyreview.com/topic/artificial-intelligence/feed/` | ✅ Confermato da più fonti indipendenti. Gratuito (meter leggero). |
| Serie A e AS Roma | La Repubblica – Sport, Calcio | `https://www.repubblica.it/rss/sport/calcio/rss2.0.xml` | ✅ Confermato dall'utente |
| Serie A e AS Roma | La Repubblica – Sport, Serie A | `https://www.repubblica.it/rss/sport/serie-a/rss2.0.xml` | ✅ Confermato dall'utente |
| Serie A e AS Roma | ForzaRoma.info | `https://www.forzaroma.info/feed` | ✅ Verificato: aggiornatissimo, description sempre presente, no paywall. Bonus: il feed include anche `content:encoded` con il testo integrale dell'articolo, non solo l'estratto |
| Serie A e AS Roma | Giallorossi.net | `https://www.giallorossi.net/feed/` | ✅ Verificato: aggiornatissimo, description sempre presente, no paywall. Stesso bonus del full-text nel feed |

### Fonti scartate rispetto alla tua lista iniziale, con motivo

| Fonte | Motivo di esclusione |
|---|---|
| The Wall Street Journal | Paywall (metered/hard a seconda della sezione) |
| The Economist | Paywall (contenuto in excerpt anche nel feed) |
| Reuters | Nessun feed RSS ufficiale — dismessi dall'azienda anni fa |
| Bloomberg | Paywall stretto (meter molto basso, spesso 0-5 articoli gratis/mese) |
| Associated Press | Nessun feed RSS ufficiale — dismessi dall'azienda |
| Sky Sport (sport.sky.it) | Nessun feed RSS ufficiale pubblico individuato per l'edizione italiana; il servizio è comunque legato a un brand pay-tv |
| Eurosport | Non ancora verificato in profondità — nessuna indicazione solida trovata di un feed RSS pubblico stabile |
| Gazzetta.it | Rimossa su decisione esplicita — sostituita dai feed sport/calcio e sport/serie-a de La Repubblica |
| PagamentiDigitali.it | Rimossa su decisione esplicita — categoria "News settore pagamenti" ora coperta dai feed Il Sole 24 Ore Finanza/Fintech e Tecnologia/Fintech |
| MarketWatch – Real-time Headlines | Rimossa dopo verifica sul campo: al primo run reale tutti e 10 gli item erano vecchi, il più datato di 909 giorni. Il feed non porta contenuti freschi e Bulletins copre già la stessa esigenza |

### Note di qualità sui feed verificati

- **MarketWatch Bulletins**: `description` sempre vuota nell'XML — decisione presa: quando
  `summary` è nullo in UI si mostra solo il titolo (senza anteprima testuale), nessuno
  scraping o riassunto automatico aggiuntivo. Il tap-through apre comunque l'articolo
  completo (no paywall). Questa è la regola generale da applicare in UI ogni volta che
  `summary` risulta vuoto per qualunque fonte, non solo per questa.
- **La Repubblica, sezioni sport**: ogni notizia viene pubblicata due volte, in versione testo
  (`/news/`) e in versione audio (`/audio/`), con titolo identico ma URL diverso. Essendo URL
  diversi la deduplica sul link non le riconosce come lo stesso articolo, e in home la notizia
  comparirebbe doppia. Le varianti `/audio/` vengono quindi scartate in ingestion tramite il
  campo `skip_url_contains` delle fonti Repubblica.
- **ANSA**: capita che due articoli distinti condividano lo stesso titolo, perché l'agenzia
  ripubblica un pezzo aggiornato su un URL nuovo. Sono notizie realmente diverse, non duplicati,
  e restano entrambe.
- **ForzaRoma.info e Giallorossi.net**: unici tra le fonti selezionate a includere il testo
  integrale dell'articolo nel campo `content:encoded` del feed, oltre al solito estratto in
  `description`. Il contenuto esteso viene salvato in file separati sotto `data/full/`
  (vedi sezione 4), non dentro gli shard del feed.

---

## 5. Requisiti funzionali (v1)

1. **Home feed**: lista articoli più recenti, ordinati per `published_at` desc.
2. **Filtro per categoria**: tab o dropdown per vedere solo una categoria alla volta.
3. **Pull/pulsante di refresh**: rilegge `index.json` e gli shard nuovi (non triggera l'Action).
4. **Ricerca**: su titolo e summary, su tutto lo storico archiviato.
5. **Segna come letto**: automatico all'apertura o manuale (da decidere in UI).
6. **Salva articolo**: toggle salvataggio, con vista dedicata "Salvati".
7. **Gestione fonti**: almeno una vista/tabella per vedere le fonti attive (leggendo
   `sources.json` — la modifica resta un commit al repo in v1).

## 6. Requisiti non funzionali

- **Installabilità PWA**: manifest.json + service worker minimo (solo per l'icona/installazione,
  no caching offline aggressivo; la Cache API si usa però per gli archivi mensili scaricati).
- **Performance**: la home carica solo gli shard recenti elencati in `index.json`, mai
  l'archivio intero. Paginazione/infinite scroll obbligatori.
- **Costi**: zero. GitHub Pages e Actions sono gratuiti e senza limite di minuti sui repo
  pubblici; nessun dominio, nessun servizio a pagamento.
- **Tempo di run dell'ingestion**: sotto il minuto, grazie al checkout shallow+sparse.

## 7. Protezione dell'accesso

Su GitHub Pages **non esiste** protezione con password: era una feature di Vercel Pro e con
questa architettura non è più disponibile. Chiunque abbia l'URL vede l'app, e chiunque conosca
il repo dati vede gli articoli e `state.json`.

Considerato che il contenuto sono notizie pubbliche, l'unica cosa realmente esposta è *quali*
fonti segui e *cosa* salvi. Scelta accettata. Se un giorno servisse riservatezza, l'unica strada
coerente con questa architettura è il modello di `spese-app`: repo dati privato e cifratura
lato client con passphrase — cioè reintrodurre il setup del token su ogni dispositivo anche
solo per leggere.

Il PAT in scrittura è l'unico segreto in gioco: fine-grained, limitato a `personal-feed-data`,
permesso Contents Read and write, inserito dall'utente al primo setup e conservato in
`localStorage`. CSP senza `unsafe-inline` come in `spese-app`, che è ciò che impedisce a un
eventuale XSS di spedirlo altrove.

---

## 8. Ingestion su GitHub Actions (sostituisce n8n)

Workflow `.github/workflows/ingest.yml` nel repo `personal-feed`.

1. **Trigger**: `schedule` con cron ogni 10 minuti, più `workflow_dispatch` per lanciarlo a mano.
2. **Checkout**: il repo del codice (per `ingest/ingest.py` e `sources.json`) e il repo dati in
   shallow (`fetch-depth: 1`), quest'ultimo autenticato con la deploy key.
3. **Lettura fonti**: `sources.json`, filtrando `active: true`.
4. **Fetch dei feed**: richiesta condizionale su ogni `feed_url` (vedi sotto), con timeout per
   fonte ed errori isolati — una fonte irraggiungibile non deve far fallire il run delle altre.
   Gli errori finiscono nel log del workflow. Il parsing è di `feedparser`.
5. **Normalizzazione**: mappatura dei campi RSS (`title`, `link`, `description`/`content:encoded`,
   `pubDate`, `media:content`/`enclosure`) sullo schema della sezione 4, con `category` ereditata
   dalla fonte, `summary` ripulito e troncato, date normalizzate a UTC ISO-8601.
6. **Deduplica**: normalizzazione del link, hash, confronto con l'insieme degli id degli ultimi
   30 giorni ricostruito dagli shard.
7. **Scrittura**: nuovo shard `data/YYYY/MM/DD/HH.json` con i soli articoli nuovi, eventuali file
   sotto `data/full/`, aggiornamento di `index.json` alle condizioni della sezione 4, commit e
   push con la deploy key. Un run che non trova nulla e ha lasciato un battito da meno di 45
   minuti non produce alcun commit.
8. **Consolidamento mensile**: al primo run del mese, gli shard del mese precedente vengono
   uniti in `data/YYYY/YYYY-MM.json` e cancellati.

### Richieste condizionali

A ogni fonte si rimandano l'`ETag` e il `Last-Modified` ricevuti la volta precedente. Se il feed
non è cambiato il server risponde `304 Not Modified` senza spedire il corpo: poche centinaia di
byte di intestazioni invece di qualche centinaio di KB di XML, e il parsing si salta del tutto.

È ciò che rende sostenibile una cadenza di 30 minuti — e che renderebbe quasi gratuito un
eventuale refresh a chiamata dall'app. Misurato sulle fonti attuali: **17 feed su 23 rispondono
`304`**. I sei che non lo fanno (le quattro sezioni di Repubblica e ANSA) non espongono nessuno
dei due header e vanno riscaricati per forza.

I validatori vivono nella **cache di GitHub Actions**, non nel repo dati: sono metadati effimeri
e committarli a ogni run sarebbe churn puro. Se la cache si perde, il run successivo riscarica
tutto e la ricostruisce da sé. Vengono salvati solo **dopo** che lo shard è stato scritto: se il
run morisse a metà, un `304` al giro dopo farebbe perdere per sempre gli articoli di quella
finestra.

### Due caveat operativi di GitHub Actions

- **Lo scheduler gratuito salta la maggior parte degli slot.** Non è "slitta di qualche minuto":
  misurato sulle prime otto ore di esercizio, con cron a 30 minuti, GitHub ha onorato **3 slot
  su 15**, con buchi fino a 3h32m. È comportamento dichiarato — sui repo pubblici lo scheduler è
  *best effort* e viene deprioritizzato sotto carico — e non si aggira con la configurazione:
  i minuti erano già sfalsati dagli scatti tondi proprio per evitare le code.
  La contromisura è statistica: **sei occasioni all'ora invece di due**, così anche onorandone
  una su cinque resta un run ogni 45-60 minuti. Costa nulla (minuti illimitati sui repo
  pubblici), non pesa sugli editori (richieste condizionali) e non sporca il repo dati (un run
  a vuoto non produce commit). Il rimedio vero per avere notizie *adesso* resta il refresh a
  chiamata dall'app, vedi sezione 10.
- **I workflow schedulati vengono disattivati dopo 60 giorni di inattività del repo.** GitHub
  manda una mail e si riabilitano con un click. Va saputo prima, invece di scoprirlo con il feed
  fermo da due settimane.

---

## 9. Fasi di sviluppo suggerite

1. **Setup repo**: creare `personal-feed` (pubblico, Pages attivo) e `personal-feed-data`
   (pubblico); generare la deploy key SSH e registrarla come deploy key con scrittura sul repo
   dati e come secret `DATA_DEPLOY_KEY` sul repo codice.
2. **`sources.json`**: trascrivere le 23 fonti della sezione 4bis con le 7 categorie.
3. **`ingest/ingest.py`**: normalizzazione, dedup, scrittura degli shard. Testabile in locale
   contro una cartella `data/` finta, senza toccare GitHub.
4. **Workflow**: prima solo `workflow_dispatch`, verificando i commit prodotti; il cron si
   attiva quando un paio di run manuali sono puliti.
5. **Verifica dati**: controllare per qualche run che gli shard si popolino e che la dedup non
   lasci passare doppioni né scarti articoli nuovi.
6. **Frontend — lettura**: home feed + filtro categoria, leggendo `index.json` e gli shard.
   Nessun token in questa fase.
7. **Frontend — stato utente**: setup del PAT, `state.json`, outbox, letto/salvato, vista
   "Salvati".
8. **Ricerca**: sugli shard recenti, poi sugli archivi mensili scaricati on demand.
9. **PWA**: manifest + service worker per l'installabilità.
10. **Rifinitura**: paginazione, consolidamento mensile in produzione, vista fonti.

---

## 10. Domande ancora aperte (da chiudere prima o durante lo sviluppo)

Chiuse in fase di revisione architetturale: hosting (GitHub Pages), database (file JSON su repo
dedicato), ingestion (GitHub Actions + Python), stato utente (sincronizzato su `state.json`),
storico (tutto, consolidato per mese), protezione (nessuna, dati pubblici).

Restano aperte:

- Se "segna come letto" è automatico all'apertura dell'articolo o manuale
- Se serve un'icona/branding minimo per la PWA o va bene un placeholder iniziale
- Meccanismo tecnico esatto per il tap-through (WebView in-app vs browser esterno) — da decidere
  in fase di sviluppo frontend
- Per ForzaRoma.info e Giallorossi.net: se mostrare il contenuto di `data/full/` direttamente
  in-app quando disponibile, invece del tap-through
- Se aggiungere un refresh a chiamata dall'app: tecnicamente fattibile con un PAT fine-grained
  che abbia **solo** `Actions: Read and write` e non `Contents`, così il browser può far partire
  il workflow ma non può toccare il codice. Da decidere in fase di frontend, insieme a come
  presentarlo: fra il click e i dati nuovi passano ~30 secondi di run più la cache CDN, quindi
  non può essere lo stesso pulsante del refresh normale
- Se differenziare la frequenza per fonte (ANSA pubblica molto più spesso del Sole)
- Nome definitivo dei due repo
