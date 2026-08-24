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

```
┌─────────────┐      schedulato (es. ogni 60')      ┌──────────────┐
│    n8n      │ ────────────────────────────────────▶│   Supabase   │
│  (workflow) │   legge RSS, normalizza, scrive DB    │  (Postgres)  │
└─────────────┘                                       └──────┬───────┘
                                                              │
                                                     SDK Supabase (REST/JS)
                                                              │
                                                              ▼
                                                     ┌──────────────────┐
                                                     │   Frontend PWA    │
                                                     │  (Claude Code)     │
                                                     │  hosted su Vercel  │
                                                     └──────────────────┘
```

**Decisioni chiave:**
- **Nessun backend custom.** Il frontend parla direttamente con Supabase via SDK client.
  Supabase *è* il backend (DB + API auto-generate + storage se serve).
- **n8n è disaccoppiato dal frontend.** Gira sul suo schedule indipendentemente da quando
  l'utente apre l'app. Il "refresh" in home NON triggera n8n: rilegge solo ciò che n8n ha
  già scritto su Supabase.
- **MCP è uno strumento di sviluppo, non un componente runtime.** Si usa per far parlare
  Claude Code/Desktop con GitHub e Supabase durante la costruzione. L'app in produzione
  comunica con Supabase via SDK/API standard, non via MCP.
- **PWA, non full-stack "pesante".** Frontend installabile (manifest + service worker
  minimo per l'installabilità), niente caching offline complesso dato che non è richiesto.

---

## 3. Stack tecnico

| Layer | Tecnologia | Note |
|---|---|---|
| Frontend | React/Next.js (PWA) | Costruito con Claude Code |
| Hosting frontend | Vercel | Deploy da GitHub, CI/CD automatico su push |
| Database | Supabase (Postgres) | Anche client SDK per query dirette dal frontend |
| Ingestion/ETL | n8n | Nodo RSS Feed Read nativo, schedulato |
| Versionamento | GitHub | Repo unico per frontend; workflow n8n esportati come JSON nello stesso repo o in cartella dedicata |
| Auth | Nessuna vera auth in v1 | Vedi sezione 7 (protezione minima) |

---

## 4. Schema database (Supabase / Postgres)

### Tabella `sources`
Le fonti RSS configurate. Popolata manualmente (da te), letta da n8n a ogni run.

| Colonna | Tipo | Note |
|---|---|---|
| id | uuid, PK | |
| name | text | Es. "Il Sole 24 Ore - Economia" |
| feed_url | text | URL del feed RSS |
| category | text | Categoria fissa assegnata a questa fonte (FK logica verso `categories`) |
| active | boolean | Per disattivare una fonte senza cancellarla |
| created_at | timestamptz | |

### Tabella `categories`
Le categorie che definisci tu (es. "Tech", "Economia", "Politica").

| Colonna | Tipo | Note |
|---|---|---|
| id | uuid, PK | |
| name | text, unique | |
| slug | text, unique | Per URL/filtri puliti |
| created_at | timestamptz | |

### Tabella `articles`
Gli articoli scrapati da n8n. Nessuna deduplica: ogni item RSS è una riga.

| Colonna | Tipo | Note |
|---|---|---|
| id | uuid, PK | |
| source_id | uuid, FK → sources | |
| category_id | uuid, FK → categories | Ereditata dalla fonte al momento dell'ingestion |
| title | text | |
| link | text, unique | URL originale — unique per evitare duplicati dello *stesso* item dallo stesso feed |
| summary | text, nullable | Estratto/description dal feed, se presente |
| full_content | text, nullable | Testo integrale, solo per le fonti il cui feed lo espone (es. `content:encoded` di ForzaRoma.info e Giallorossi.net). Nullo per tutte le altre fonti — in quel caso resta il modello anteprima + tap-through |
| published_at | timestamptz | Data di pubblicazione originale (dal feed) |
| fetched_at | timestamptz | Quando n8n l'ha scritto a DB |
| image_url | text, nullable | Se il feed espone un'immagine (media:content, enclosure) |

> Nota: `link` come `unique` è il meccanismo naturale per evitare che n8n reinserisca
> lo stesso articolo a ogni run (upsert con `on conflict do nothing` su `link`).

### Tabella `user_article_state`
Stato di lettura/salvataggio (single-user, quindi niente `user_id`: una riga per articolo).

| Colonna | Tipo | Note |
|---|---|---|
| article_id | uuid, PK, FK → articles | |
| is_read | boolean, default false | |
| is_saved | boolean, default false | |
| read_at | timestamptz, nullable | |
| saved_at | timestamptz, nullable | |

### Ricerca full-text
Postgres full-text search (`tsvector` su `title` + `summary`) è sufficiente per i volumi
previsti (5-10 fonti). Aggiungere colonna generata `search_vector` con indice GIN su
`articles` quando si implementa la ricerca. La ricerca copre titolo ed estratto, non il
testo integrale (che non è storato nel DB — vedi sezione 1, modello anteprima + tap-through).

---

## 4bis. Elenco fonti selezionate (v1)

Criterio di selezione applicato: **solo fonti gratuite, senza paywall**, con feed RSS che
espone almeno titolo + estratto. Ogni feed è marcato con uno stato di affidabilità — è
fondamentale verificarli tutti a mano prima di configurarli in n8n, perché gli URL RSS
cambiano nel tempo e i pattern trovati tramite ricerca non sono garanzie.

**Legenda stato:** ✅ confermato da fonte diretta o indipendente · ⚠️ pattern plausibile,
da verificare manualmente sul sito · ❌ scartato, con motivo.

| Categoria | Fonte | Feed URL | Stato |
|---|---|---|---|
| Finanza | MarketWatch – Real-time Headlines | `https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines` | ⚠️ XML valido ma date poco recenti/aggiornamento lento — verificato ma da tenere d'occhio |
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

### Note di qualità sui feed verificati

- **MarketWatch Bulletins**: `description` sempre vuota nell'XML — decisione presa: quando
  `summary` è nullo in UI si mostra solo il titolo (senza anteprima testuale), nessuno
  scraping o riassunto automatico aggiuntivo. Il tap-through apre comunque l'articolo
  completo (no paywall). Questa è la regola generale da applicare in UI ogni volta che
  `summary` risulta vuoto per qualunque fonte, non solo per questa.
- **MarketWatch Real-time Headlines**: tecnicamente valido ma con date di pubblicazione datate
  e sparse nel tempo — probabile aggiornamento poco frequente. Da monitorare una volta in
  produzione: se non porta contenuti freschi, va rimossa senza perdite (Bulletins la copre già).
- **ForzaRoma.info e Giallorossi.net**: unici tra le fonti selezionate a includere il testo
  integrale dell'articolo nel campo `content:encoded` del feed, oltre al solito estratto in
  `description`. Vale la pena, in fase di schema DB, prevedere un campo opzionale per questo
  contenuto esteso (vedi nota nella sezione 4, tabella `articles`).



## 5. Requisiti funzionali (v1)

1. **Home feed**: lista articoli più recenti, ordinati per `published_at` desc.
2. **Filtro per categoria**: tab o dropdown per vedere solo una categoria alla volta.
3. **Pull/pulsante di refresh**: ri-fetch da Supabase (non triggera n8n).
4. **Ricerca**: full-text su titolo e summary, su tutto lo storico salvato.
5. **Segna come letto**: automatico all'apertura o manuale (da decidere in UI).
6. **Salva articolo**: toggle salvataggio, con vista dedicata "Salvati".
7. **Gestione fonti**: almeno una vista/tabella per vedere le fonti attive (anche solo
   leggendo `sources` — la modifica può restare manuale su Supabase in v1).

## 6. Requisiti non funzionali

- **Installabilità PWA**: manifest.json + service worker minimo (solo per l'icona/installazione,
  no caching aggressivo).
- **Performance**: home feed deve caricare velocemente anche con storico che cresce
  (paginazione o infinite scroll obbligatori, non caricare tutta la tabella).
- **Costi**: restare nei tier free di Supabase e Vercel per v1 (volumi bassi lo permettono).

## 7. Protezione minima (no vera auth)

Dato che è single-user per sempre, opzioni più semplici di una vera auth:
- Vercel: protezione via password a livello di progetto (disponibile nei piani Pro), oppure
- Un semplice check lato client con una password/token in variabile d'ambiente, oppure
- Supabase Auth con un solo utente (email magica) se si vuole comunque un minimo di robustezza

Da decidere in fase di setup — non blocca l'inizio dello sviluppo del frontend.

---

## 8. Struttura n8n (workflow di ingestion)

1. **Trigger**: Schedule Trigger (es. ogni 60 minuti)
2. **Loop sulle fonti**: leggere `sources` da Supabase (nodo Supabase o HTTP Request)
   filtrando `active = true`
3. **Per ogni fonte**: nodo RSS Feed Read sull'URL del feed
4. **Normalizzazione**: mappare i campi RSS (title, link, description, pubDate, ...) sullo
   schema `articles`, assegnando `category_id` in base alla fonte
5. **Scrittura su Supabase**: upsert su `articles` con `on conflict (link) do nothing`

---

## 9. Fasi di sviluppo suggerite

1. **Setup Supabase**: creare progetto, creare le tabelle sopra, popolare `categories` e
   `sources` con le 5-10 fonti iniziali (manualmente, via SQL editor o table editor)
2. **Setup n8n**: costruire il workflow di ingestion, testarlo manualmente prima di schedularlo
3. **Verifica dati**: controllare che `articles` si popoli correttamente per un paio di run
4. **Frontend con Claude Code**: home feed + filtro categoria + connessione Supabase (sola
   lettura, in questa fase)
5. **Frontend — funzionalità utente**: salva/letto, vista salvati, ricerca
6. **PWA**: manifest + service worker per installabilità
7. **Deploy**: collegare repo GitHub a Vercel, env vars per Supabase, deploy
8. **Rifinitura**: protezione accesso, paginazione, eventuale UI per gestire fonti

---

## 10. Domande ancora aperte (da chiudere prima o durante lo sviluppo)

- Frequenza esatta dello schedule n8n
- Se "segna come letto" è automatico all'apertura dell'articolo o manuale
- Se serve un'icona/branding minimo per la PWA o va bene un placeholder iniziale
- Meccanismo tecnico esatto per il tap-through (WebView in-app vs browser esterno) —
  da decidere in fase di sviluppo frontend, impatta la scelta di libreria in React/Next.js
- Per ForzaRoma.info e Giallorossi.net: valutare in fase di frontend se mostrare il
  `full_content` direttamente in-app quando disponibile, invece del tap-through
