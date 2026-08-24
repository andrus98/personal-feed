#!/usr/bin/env python3
"""Ingestion dei feed RSS di personal-feed.

Legge le fonti da sources.json, scarica ogni feed, normalizza gli item e scrive
gli articoli nuovi nel repo dati come shard orario append-only.

    python3 ingest/ingest.py --data-dir ../personal-feed-data

Lo script non parla mai con git: scrive solo file dentro --data-dir. Chi committa
e' il workflow (o tu, in locale). Cosi' e' testabile contro una cartella finta
senza toccare GitHub.
"""

import argparse
import hashlib
import html as html_module
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser

USER_AGENT = "personal-feed/1.0 (+https://github.com/andrus98/personal-feed)"
FETCH_TIMEOUT = 20          # secondi per fonte
SUMMARY_LIMIT = 600         # caratteri, poi si tronca a fine parola
SEEN_DAYS = 30              # finestra di deduplica
RECENT_DAYS = 3             # giorni di shard elencati in index.json
FULL_MIN_CHARS = 1000       # sotto questa soglia il content non e' un full-text

# Parametri di tracciamento da togliere prima di calcolare l'id: lo stesso
# articolo ripreso con una utm diversa deve restare lo stesso articolo.
TRACKING_PREFIXES = ("utm_", "at_")
TRACKING_PARAMS = {
    "fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src",
    "spm", "cmpid", "ncid", "srnd", "sref", "cx_testId", "cx_testVariant",
}

TAG_RE = re.compile(r"<[^>]+>")
# Gli spazi unicode vanno collassati insieme a quelli normali: &nbsp; e simili
# sopravvivrebbero dentro titoli e summary, invisibili a occhio ma capaci di far
# fallire una ricerca per "sà bene" scritta con lo spazio della tastiera.
WS_RE = re.compile(r"[ \t\r\f\v\u00a0\u2002\u2003\u2007\u2009\u202f]+")
ZERO_WIDTH_RE = re.compile(r"[\u00ad\u200b\u200c\u200d\ufeff]")
SCRIPT_RE = re.compile(r"(?is)<(script|style)\b.*?</\1>")
BREAK_RE = re.compile(r"(?i)</p\s*>|<br\s*/?>|</div\s*>|</li\s*>")
IMG_RE = re.compile(r"""(?i)<img[^>]+src\s*=\s*["']([^"']+)["']""")


# --------------------------------------------------------------------------
# utilita' di base
# --------------------------------------------------------------------------

def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (IOError, OSError, ValueError):
        return default


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp, path)


def html_to_text(raw, keep_breaks=False):
    """Toglie i tag. Con keep_breaks conserva i capoversi, per il full-text."""
    if not raw:
        return ""
    text = SCRIPT_RE.sub(" ", raw)
    if keep_breaks:
        text = BREAK_RE.sub("\n", text)
    text = TAG_RE.sub(" ", text)
    text = html_module.unescape(text)
    text = ZERO_WIDTH_RE.sub("", text)
    text = WS_RE.sub(" ", text)
    if keep_breaks:
        text = re.sub(r"\s*\n\s*", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    else:
        text = text.replace("\n", " ")
        text = WS_RE.sub(" ", text)
    return text.strip()


def truncate(text, limit=SUMMARY_LIMIT):
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" .,;:–-") + "…"


def normalize_link(url):
    """Forma canonica del link, usata solo per calcolare l'id.

    Il link mostrato in UI resta quello originale del feed.
    """
    url = (url or "").strip()
    if not url:
        return ""
    parts = urlsplit(url)
    if not parts.netloc:
        return ""
    query = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(TRACKING_PREFIXES) and k.lower() not in TRACKING_PARAMS
    ]
    netloc = parts.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = parts.path.rstrip("/") or "/"
    # lo schema si normalizza a https: http e https dello stesso articolo
    # non devono produrre due id diversi
    return urlunsplit(("https", netloc, path, urlencode(query), ""))


def article_id(normalized_link):
    return hashlib.sha256(normalized_link.encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------
# estrazione dai singoli item del feed
# --------------------------------------------------------------------------

def entry_datetime(entry):
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def entry_image(entry):
    for media in entry.get("media_content") or []:
        if media.get("url"):
            return media["url"]
    for thumb in entry.get("media_thumbnail") or []:
        if thumb.get("url"):
            return thumb["url"]
    for enc in entry.get("enclosures") or []:
        if (enc.get("type") or "").startswith("image/") and enc.get("href"):
            return enc["href"]
    for block in entry.get("content") or []:
        match = IMG_RE.search(block.get("value") or "")
        if match:
            return match.group(1)
    match = IMG_RE.search(entry.get("summary") or "")
    return match.group(1) if match else None


def entry_full_text(entry, summary_text):
    """Il testo integrale, se il feed lo espone in content:encoded.

    Non tutti i feed che riempiono <content> ci mettono l'articolo intero: molti
    ci ripetono l'estratto. La soglia distingue i due casi senza dover elencare
    a mano quali fonti hanno il full-text.
    """
    best = ""
    for block in entry.get("content") or []:
        text = html_to_text(block.get("value") or "", keep_breaks=True)
        if len(text) > len(best):
            best = text
    if len(best) >= FULL_MIN_CHARS and len(best) >= len(summary_text) * 2:
        return best
    return ""


def build_article(entry, source, now):
    link = (entry.get("link") or "").strip()
    normalized = normalize_link(link)
    if not normalized:
        return None, None

    title = html_to_text(entry.get("title") or "")
    if not title:
        return None, None

    summary = truncate(html_to_text(entry.get("summary") or ""))
    published = entry_datetime(entry)
    # un articolo datato nel futuro sballerebbe l'ordinamento della home
    if published and published > now + timedelta(hours=12):
        published = now

    article = {
        "id": article_id(normalized),
        "source": source["id"],
        "category": source["category"],
        "title": title,
        "link": link,
        "summary": summary or None,
        "published_at": iso(published) if published else iso(now),
        "image_url": entry_image(entry),
        "has_full": False,
    }
    full_text = entry_full_text(entry, summary)
    if full_text:
        article["has_full"] = True
    return article, full_text


# --------------------------------------------------------------------------
# layout del repo dati
# --------------------------------------------------------------------------

def data_root(data_dir):
    return os.path.join(data_dir, "data")


def day_dir(data_dir, dt):
    return os.path.join(data_root(data_dir), "%04d" % dt.year, "%02d" % dt.month, "%02d" % dt.day)


def shard_path(data_dir, dt):
    return os.path.join(day_dir(data_dir, dt), "%02d.json" % dt.hour)


def archive_path(data_dir, year, month):
    return os.path.join(data_root(data_dir), "%04d" % year, "%04d-%02d.json" % (year, month))


def rel_path(data_dir, path):
    return os.path.relpath(path, data_root(data_dir)).replace(os.sep, "/")


def load_seen(data_dir, now, days=SEEN_DAYS):
    """Gli id gia' visti nella finestra di deduplica.

    Ricostruito in memoria dagli shard invece che da un file 'seen' persistito:
    un file del genere andrebbe riscritto a ogni run, che e' esattamente il
    churn che il layout append-only serve a evitare.
    """
    seen = set()
    months_done = set()
    for delta in range(days + 1):
        day = now - timedelta(days=delta)
        ddir = day_dir(data_dir, day)
        if os.path.isdir(ddir):
            for name in sorted(os.listdir(ddir)):
                if name.endswith(".json"):
                    for art in (read_json(os.path.join(ddir, name), {}) or {}).get("articles", []):
                        seen.add(art.get("id"))
            continue
        # giorno assente: forse il mese e' gia' stato consolidato
        key = (day.year, day.month)
        if key in months_done:
            continue
        months_done.add(key)
        archive = archive_path(data_dir, day.year, day.month)
        if os.path.isfile(archive):
            for art in (read_json(archive, {}) or {}).get("articles", []):
                seen.add(art.get("id"))
    seen.discard(None)
    return seen


def consolidate_month(data_dir, year, month):
    """Unisce gli shard di un mese in un unico archivio e cancella gli shard."""
    month_dir = os.path.join(data_root(data_dir), "%04d" % year, "%02d" % month)
    if not os.path.isdir(month_dir):
        return None

    articles = {}
    target = archive_path(data_dir, year, month)
    for art in (read_json(target, {}) or {}).get("articles", []):
        articles[art["id"]] = art
    for day in sorted(os.listdir(month_dir)):
        ddir = os.path.join(month_dir, day)
        if not os.path.isdir(ddir):
            continue
        for name in sorted(os.listdir(ddir)):
            if name.endswith(".json"):
                for art in (read_json(os.path.join(ddir, name), {}) or {}).get("articles", []):
                    articles[art["id"]] = art

    ordered = sorted(articles.values(), key=lambda a: a.get("published_at") or "", reverse=True)
    write_json(target, {
        "month": "%04d-%02d" % (year, month),
        "count": len(ordered),
        "articles": ordered,
    })
    shutil.rmtree(month_dir)
    return target


def build_index(data_dir, now):
    root = data_root(data_dir)
    recent = []
    for delta in range(RECENT_DAYS + 1):
        day = now - timedelta(days=delta)
        ddir = day_dir(data_dir, day)
        if not os.path.isdir(ddir):
            continue
        for name in sorted(os.listdir(ddir), reverse=True):
            if name.endswith(".json"):
                recent.append(rel_path(data_dir, os.path.join(ddir, name)))

    months = []
    if os.path.isdir(root):
        for year in sorted(os.listdir(root), reverse=True):
            ydir = os.path.join(root, year)
            if not (year.isdigit() and os.path.isdir(ydir)):
                continue
            for name in sorted(os.listdir(ydir), reverse=True):
                if re.fullmatch(r"\d{4}-\d{2}\.json", name):
                    path = os.path.join(ydir, name)
                    payload = read_json(path, {}) or {}
                    months.append({
                        "path": rel_path(data_dir, path),
                        "count": payload.get("count", len(payload.get("articles", []))),
                        "bytes": os.path.getsize(path),
                    })
    return {"updated_at": iso(now), "recent": recent, "months": months}


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------

def fetch(url, cached=None, timeout=FETCH_TIMEOUT):
    """Scarica il feed, ma solo se e' cambiato.

    Rimandando indietro l'ETag e il Last-Modified ricevuti la volta scorsa, un
    feed immutato risponde 304 senza spedire il corpo: poche centinaia di byte
    di intestazioni invece di qualche centinaio di KB di XML. E' cio' che rende
    accettabile alzare la frequenza dei run senza pesare sugli editori.

    Ritorna (bytes, validatori) oppure (None, validatori) se non e' cambiato.
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
    }
    if cached:
        if cached.get("etag"):
            headers["If-None-Match"] = cached["etag"]
        if cached.get("last_modified"):
            headers["If-Modified-Since"] = cached["last_modified"]

    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            validators = {}
            if response.headers.get("ETag"):
                validators["etag"] = response.headers["ETag"]
            if response.headers.get("Last-Modified"):
                validators["last_modified"] = response.headers["Last-Modified"]
            return response.read(), validators
    except urllib.error.HTTPError as err:
        if err.code == 304:
            return None, cached
        raise


def load_sources(path):
    config = read_json(path)
    if not config:
        raise SystemExit("sources.json illeggibile o assente: %s" % path)

    slugs = {c["slug"] for c in config.get("categories", [])}
    ids = set()
    active = []
    for source in config.get("sources", []):
        if source["id"] in ids:
            raise SystemExit("id fonte duplicato in sources.json: %s" % source["id"])
        ids.add(source["id"])
        if source["category"] not in slugs:
            raise SystemExit("fonte %s: categoria sconosciuta '%s'" % (source["id"], source["category"]))
        if source.get("active", True):
            active.append(source)
    return active


def run(args):
    now = datetime.now(timezone.utc) if not args.now else \
        datetime.strptime(args.now, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)

    sources = load_sources(args.sources)
    seen = load_seen(args.data_dir, now)
    cache = {} if args.ignore_cache else (read_json(args.cache, {}) or {})
    print("fonti attive: %d — id noti negli ultimi %d giorni: %d — validatori in cache: %d"
          % (len(sources), SEEN_DAYS, len(seen), len(cache)))

    fresh = []
    full_texts = {}
    batch = set()
    failed = []
    unchanged = 0
    validators = dict(cache)

    for source in sources:
        try:
            raw, source_validators = fetch(source["feed_url"], cache.get(source["id"]))
        except (urllib.error.URLError, OSError) as err:
            failed.append(source["id"])
            print("  %-38s ERRORE  %s" % (source["id"], err))
            continue

        if raw is None:
            unchanged += 1
            print("  %-38s  304, non modificato" % source["id"])
            continue
        if source_validators:
            validators[source["id"]] = source_validators

        parsed = feedparser.parse(raw)
        skip_patterns = source.get("skip_url_contains") or []
        added = 0
        skipped = 0
        for entry in parsed.entries:
            # Varianti dello stesso pezzo pubblicate dalla fonte su un URL diverso:
            # Repubblica duplica ogni notizia in versione /audio/. Link diverso,
            # quindi id diverso, quindi la deduplica da sola non le prende.
            link = entry.get("link") or ""
            if any(pattern in link for pattern in skip_patterns):
                skipped += 1
                continue
            article, full_text = build_article(entry, source, now)
            if not article:
                continue
            if article["id"] in seen or article["id"] in batch:
                continue
            batch.add(article["id"])
            fresh.append(article)
            if full_text:
                full_texts[article["id"]] = full_text
            added += 1

        flag = "  (feed malformato, letto comunque)" if parsed.bozo and not parsed.entries else ""
        note = ", %d scartati" % skipped if skipped else ""
        print("  %-38s %3d item, %3d nuovi%s%s"
              % (source["id"], len(parsed.entries), added, note, flag))

    if failed and len(failed) == len(sources):
        print("\nTutte le fonti hanno fallito: non scrivo nulla.", file=sys.stderr)
        return 1

    fresh.sort(key=lambda a: a.get("published_at") or "", reverse=True)
    print("\ntotale articoli nuovi: %d (di cui %d con testo integrale) — %d feed non modificati"
          % (len(fresh), len(full_texts), unchanged))

    if args.dry_run:
        print("dry-run: nessun file scritto.")
        for article in fresh[:10]:
            print("  [%s] %s" % (article["category"], article["title"][:88]))
        return 0

    if fresh:
        path = shard_path(args.data_dir, now)
        existing = (read_json(path, {}) or {}).get("articles", [])
        merged = {a["id"]: a for a in existing}
        for article in fresh:
            merged[article["id"]] = article
        ordered = sorted(merged.values(), key=lambda a: a.get("published_at") or "", reverse=True)
        write_json(path, {"run_at": iso(now), "count": len(ordered), "articles": ordered})
        print("scritto %s (%d articoli)" % (rel_path(args.data_dir, path), len(ordered)))

        for article_key, text in full_texts.items():
            full_path = os.path.join(
                data_root(args.data_dir), "full",
                "%04d" % now.year, "%02d" % now.month, "%s.json" % article_key,
            )
            write_json(full_path, {"id": article_key, "text": text})
        if full_texts:
            print("scritti %d file di testo integrale in data/full/" % len(full_texts))
    else:
        print("nessun articolo nuovo: nessuno shard scritto.")

    # consolidamento del mese precedente, al primo run del mese nuovo
    previous = (now.replace(day=1) - timedelta(days=1))
    if now.day == 1 or args.consolidate:
        target = consolidate_month(args.data_dir, previous.year, previous.month)
        if target:
            print("consolidato %s" % rel_path(args.data_dir, target))

    index_path = os.path.join(data_root(args.data_dir), "index.json")
    write_json(index_path, build_index(args.data_dir, now))
    print("aggiornato data/index.json")

    # I validatori si salvano solo adesso, a scrittura avvenuta: se il run
    # fosse morto prima, al giro successivo un 304 ci farebbe perdere per
    # sempre gli articoli di questa finestra.
    write_json(args.cache, validators)
    return 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Ingestion RSS di personal-feed")
    parser.add_argument("--sources", default=os.path.join(here, os.pardir, "sources.json"),
                        help="percorso di sources.json")
    parser.add_argument("--data-dir", default=os.path.join(here, os.pardir, os.pardir, "personal-feed-data"),
                        help="radice del repo dati (quella che contiene data/)")
    parser.add_argument("--cache", default=os.path.join(here, os.pardir, ".cache", "http-cache.json"),
                        help="file con gli ETag per le richieste condizionali")
    parser.add_argument("--ignore-cache", action="store_true",
                        help="ignora gli ETag e riscarica tutti i feed")
    parser.add_argument("--dry-run", action="store_true",
                        help="scarica e normalizza ma non scrive niente")
    parser.add_argument("--consolidate", action="store_true",
                        help="forza il consolidamento del mese precedente")
    parser.add_argument("--now", default=None,
                        help="istante del run in UTC (YYYY-MM-DDTHH:MM:SSZ), per i test")
    args = parser.parse_args()
    args.data_dir = os.path.abspath(args.data_dir)
    args.sources = os.path.abspath(args.sources)
    args.cache = os.path.abspath(args.cache)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
