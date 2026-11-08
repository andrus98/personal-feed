# personal-feed

PWA personale che aggrega notizie da un set curato di fonti RSS, organizzate per
categoria, con storico ricercabile e articoli salvati. Sul dispositivo si chiama
**Feed**.

**App:** <https://andrus98.github.io/personal-feed/>

Questo repo contiene il codice e l'hosting dell'app. **L'ingestion non gira
più qui**: dall'8 novembre 2026 vive in `personal-feed-data`, cioè nel repo che
scrive, dove basta il `GITHUB_TOKEN` del run e la deploy key non serve più.
A svegliarla ogni 20 minuti è un Worker di Cloudflare, perché gli eventi
`schedule` di GitHub prima hanno smesso di arrivare e poi hanno spento il
workflow per inattività. Nessun dominio, costo zero — la storia per intero,
con le date e le prove, è in [PROJECT.md](PROJECT.md), sezione 8.

Architettura, modello dati e fasi di sviluppo: **[PROJECT.md](PROJECT.md)**.

## Sviluppo

Non serve Node. L'ingestion è Python con una sola dipendenza:

```bash
python3 -m venv .venv && .venv/bin/pip install -r ingest/requirements.txt
```

Provala senza scrivere niente e senza usare gli ETag in cache:

```bash
.venv/bin/python ingest/ingest.py --data-dir /tmp/finta --dry-run --ignore-cache
```

Lo script non parla mai con git: scrive solo dentro `--data-dir`, quindi lo puoi
lanciare contro una cartella qualsiasi senza toccare il repo dati.

### Test

```bash
.venv/bin/python ingest/selftest.py
```

Copre normalizzazione dei link, pulizia del testo, estrazione dagli item RSS e
layout su disco. Non usa la rete: i casi limite sono scritti a mano invece di
aspettare che sia un giornale a produrli. Gira anche nel workflow, prima
dell'ingestion, così una regressione non arriva mai a scrivere sul repo dati.
