#!/usr/bin/env python3
"""Test della logica di normalizzazione di ingest.py.

    python3 ingest/selftest.py

Niente rete e niente runner da riga di comando: le funzioni interessanti sono
pure, e quelle che toccano il disco girano su una cartella temporanea. Serve a
non dover aspettare che i giornali pubblichino il caso limite giusto per
accorgersi di una regressione.
"""

import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ingest import (  # noqa: E402
    archive_path, article_id, build_article, build_index, consolidate_month,
    day_dir, entry_datetime, entry_full_text, entry_image, html_to_text,
    load_seen, normalize_link, shard_path, truncate, write_json,
)

NOW = datetime(2026, 8, 24, 22, 0, 0, tzinfo=timezone.utc)

_passed = 0
_failed = []


def check(label, got, want):
    global _passed
    if got == want:
        _passed += 1
    else:
        _failed.append("%s\n      atteso: %r\n      ottenuto: %r" % (label, want, got))


def check_true(label, got):
    check(label, bool(got), True)


# --------------------------------------------------------------------------
# normalize_link e article_id
# --------------------------------------------------------------------------

def test_normalize_link():
    base = "https://ilsole24ore.com/art/abc-123"

    check("utm rimossi",
          normalize_link("https://www.ilsole24ore.com/art/abc-123?utm_source=rss&utm_medium=feed"),
          base)
    check("www rimosso", normalize_link("https://www.ilsole24ore.com/art/abc-123"), base)
    check("http diventa https", normalize_link("http://www.ilsole24ore.com/art/abc-123"), base)
    check("fragment rimosso", normalize_link("https://ilsole24ore.com/art/abc-123#commenti"), base)
    check("slash finale rimosso", normalize_link("https://ilsole24ore.com/art/abc-123/"), base)
    check("host normalizzato", normalize_link("https://ILSOLE24ORE.com/art/abc-123"), base)
    check("fbclid rimosso", normalize_link("https://ilsole24ore.com/art/abc-123?fbclid=xyz"), base)

    # I parametri veri restano: sono spesso l'unica cosa che distingue due pagine
    check("parametro utile conservato",
          normalize_link("https://ilsole24ore.com/art?id=42"),
          "https://ilsole24ore.com/art?id=42")

    check("link vuoto", normalize_link(""), "")
    check("link senza host", normalize_link("/art/abc-123"), "")
    check("spazi ai bordi", normalize_link("  https://ilsole24ore.com/art/abc-123  "), base)


def test_article_id():
    a = article_id(normalize_link("https://www.repubblica.it/x/y?utm_source=rss"))
    b = article_id(normalize_link("http://repubblica.it/x/y/"))
    check("id deterministico e stabile fra varianti", a, b)
    check("lunghezza id", len(a), 16)

    c = article_id(normalize_link("https://repubblica.it/x/z"))
    check_true("link diversi, id diversi", a != c)


# --------------------------------------------------------------------------
# pulizia del testo
# --------------------------------------------------------------------------

def test_html_to_text():
    check("tag rimossi", html_to_text("<p>Ciao <b>mondo</b></p>"), "Ciao mondo")
    check("entita' decodificate", html_to_text("Pi&ugrave; s&agrave;&nbsp;bene"), "Più sà bene")
    check("script buttato via", html_to_text("<script>alert(1)</script>testo"), "testo")
    check("style buttato via", html_to_text("<style>p{color:red}</style>testo"), "testo")
    check("spazi collassati", html_to_text("a  \t\n  b"), "a b")
    check("vuoto", html_to_text(""), "")
    check("None", html_to_text(None), "")

    con_capoversi = html_to_text("<p>Primo</p><p>Secondo</p>", keep_breaks=True)
    check("capoversi conservati", con_capoversi, "Primo\nSecondo")
    check("capoversi ignorati di default", html_to_text("<p>Primo</p><p>Secondo</p>"),
          "Primo Secondo")


def test_truncate():
    check("sotto la soglia resta intatto", truncate("ciao", 10), "ciao")
    check("esattamente alla soglia", truncate("1234567890", 10), "1234567890")

    lungo = truncate("parola " * 200, 600)
    check_true("troncato entro la soglia", len(lungo) <= 601)
    check_true("finisce con i puntini", lungo.endswith("…"))
    check_true("non spezza a meta' parola", not lungo[:-1].endswith("paro"))

    # senza spazi utili non si puo' tagliare a fine parola: si taglia e basta
    check_true("stringa senza spazi", truncate("x" * 100, 10).endswith("…"))


# --------------------------------------------------------------------------
# estrazione dagli item
# --------------------------------------------------------------------------

def test_entry_datetime():
    check("published_parsed",
          entry_datetime({"published_parsed": (2026, 8, 24, 13, 52, 0, 0, 0, 0)}),
          datetime(2026, 8, 24, 13, 52, tzinfo=timezone.utc))
    check("fallback su updated_parsed",
          entry_datetime({"updated_parsed": (2026, 1, 2, 3, 4, 5, 0, 0, 0)}),
          datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc))
    check("nessuna data", entry_datetime({}), None)
    check("data malformata", entry_datetime({"published_parsed": (99999, 99, 99, 0, 0, 0, 0, 0, 0)}),
          None)


def test_entry_image():
    check("media_content", entry_image({"media_content": [{"url": "http://x/a.jpg"}]}),
          "http://x/a.jpg")
    check("media_thumbnail", entry_image({"media_thumbnail": [{"url": "http://x/t.jpg"}]}),
          "http://x/t.jpg")
    check("enclosure immagine",
          entry_image({"enclosures": [{"type": "image/jpeg", "href": "http://x/e.jpg"}]}),
          "http://x/e.jpg")
    check("enclosure non immagine ignorata",
          entry_image({"enclosures": [{"type": "audio/mpeg", "href": "http://x/e.mp3"}]}),
          None)
    check("img dentro il content",
          entry_image({"content": [{"value": "<p><img src='http://x/c.jpg'></p>"}]}),
          "http://x/c.jpg")
    check("nessuna immagine", entry_image({}), None)


def test_entry_full_text():
    breve = {"content": [{"value": "<p>" + "corto " * 20 + "</p>"}]}
    check("content troppo corto non e' full-text", entry_full_text(breve, ""), "")

    lungo = {"content": [{"value": "<p>" + "parola " * 400 + "</p>"}]}
    check_true("content lungo e' full-text", len(entry_full_text(lungo, "")) > 1000)

    # il caso insidioso: il feed ripete l'estratto dentro <content>
    estratto = "frase " * 250
    ripetuto = {"content": [{"value": "<p>%s</p>" % estratto}]}
    check("estratto ripetuto non conta come full-text",
          entry_full_text(ripetuto, estratto), "")

    check("nessun content", entry_full_text({}, ""), "")


# --------------------------------------------------------------------------
# build_article
# --------------------------------------------------------------------------

SOURCE = {"id": "test-src", "category": "finanza"}


def test_build_article():
    entry = {
        "title": "Titolo <b>con</b> tag",
        "link": "https://www.example.com/art/1?utm_source=rss",
        "summary": "<p>Estratto &amp; roba</p>",
        "published_parsed": (2026, 8, 24, 13, 52, 0, 0, 0, 0),
        "media_content": [{"url": "https://example.com/i.jpg"}],
    }
    art, full = build_article(entry, SOURCE, NOW)
    check("titolo ripulito", art["title"], "Titolo con tag")
    check("summary ripulito", art["summary"], "Estratto & roba")
    check("link originale conservato", art["link"], entry["link"])
    check("categoria dalla fonte", art["category"], "finanza")
    check("fonte", art["source"], "test-src")
    check("data", art["published_at"], "2026-08-24T13:52:00Z")
    check("immagine", art["image_url"], "https://example.com/i.jpg")
    check("has_full", art["has_full"], False)
    check("niente full text", full, "")

    check("senza titolo si scarta", build_article({"link": "https://x.com/a"}, SOURCE, NOW)[0], None)
    check("senza link si scarta", build_article({"title": "T"}, SOURCE, NOW)[0], None)

    vuoto = build_article(
        {"title": "T", "link": "https://x.com/a", "summary": ""}, SOURCE, NOW)[0]
    check("summary vuoto diventa None", vuoto["summary"], None)
    check("senza data si usa l'ora del run", vuoto["published_at"], "2026-08-24T22:00:00Z")

    futuro = build_article({
        "title": "T", "link": "https://x.com/b",
        "published_parsed": (2027, 1, 1, 0, 0, 0, 0, 0, 0),
    }, SOURCE, NOW)[0]
    check("data nel futuro riportata a adesso", futuro["published_at"], "2026-08-24T22:00:00Z")

    con_full = build_article({
        "title": "T", "link": "https://x.com/c",
        "content": [{"value": "<p>" + "parola " * 400 + "</p>"}],
    }, SOURCE, NOW)
    check("has_full acceso", con_full[0]["has_full"], True)
    check_true("full text restituito", len(con_full[1]) > 1000)


# --------------------------------------------------------------------------
# layout su disco
# --------------------------------------------------------------------------

def _articolo(aid, published="2026-08-24T10:00:00Z"):
    return {"id": aid, "source": "s", "category": "finanza", "title": "t",
            "link": "https://x.com/" + aid, "summary": None,
            "published_at": published, "image_url": None, "has_full": False}


def test_disco():
    tmp = tempfile.mkdtemp()
    try:
        check("percorso shard", shard_path(tmp, NOW).endswith("data/2026/08/24/22.json"), True)
        check("percorso archivio", archive_path(tmp, 2026, 7).endswith("data/2026/2026-07.json"), True)

        # load_seen legge gli shard nella finestra
        write_json(shard_path(tmp, NOW), {"articles": [_articolo("aaa"), _articolo("bbb")]})
        seen = load_seen(tmp, NOW)
        check("seen dagli shard", seen, {"aaa", "bbb"})

        # ...e ignora quelli fuori finestra
        vecchio = NOW - timedelta(days=90)
        write_json(shard_path(tmp, vecchio), {"articles": [_articolo("zzz")]})
        check("shard fuori finestra ignorato", "zzz" in load_seen(tmp, NOW), False)

        # load_seen pesca anche dagli archivi mensili consolidati
        write_json(archive_path(tmp, NOW.year, NOW.month - 1), {"articles": [_articolo("ccc")]})
        check("seen dall'archivio", "ccc" in load_seen(tmp, NOW), True)

        # index.json
        index = build_index(tmp, NOW)
        check("recent contiene lo shard di oggi", "2026/08/24/22.json" in index["recent"], True)
        check("months elencato", any(m["path"].endswith("2026-07.json") for m in index["months"]),
              True)
        check("updated_at", index["updated_at"], "2026-08-24T22:00:00Z")
    finally:
        shutil.rmtree(tmp)


def test_consolidamento():
    tmp = tempfile.mkdtemp()
    try:
        giorno1 = datetime(2026, 7, 3, 9, tzinfo=timezone.utc)
        giorno2 = datetime(2026, 7, 18, 14, tzinfo=timezone.utc)
        write_json(shard_path(tmp, giorno1),
                   {"articles": [_articolo("a1", "2026-07-03T09:00:00Z"),
                                 _articolo("a2", "2026-07-03T08:00:00Z")]})
        write_json(shard_path(tmp, giorno2),
                   {"articles": [_articolo("a3", "2026-07-18T14:00:00Z"),
                                 _articolo("a1", "2026-07-03T09:00:00Z")]})  # ripetuto

        target = consolidate_month(tmp, 2026, 7)
        import json
        with open(target) as fh:
            payload = json.load(fh)

        ids = [a["id"] for a in payload["articles"]]
        check("consolidato senza duplicati", sorted(ids), ["a1", "a2", "a3"])
        check("count coerente", payload["count"], 3)
        check("ordinato per data discendente", ids[0], "a3")
        check("mese", payload["month"], "2026-07")
        check("shard cancellati dopo il consolidamento",
              os.path.isdir(os.path.dirname(day_dir(tmp, giorno1))), False)

        check("mese inesistente non esplode", consolidate_month(tmp, 2020, 1), None)
    finally:
        shutil.rmtree(tmp)


# --------------------------------------------------------------------------

def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()

    if _failed:
        print("FALLITI %d test su %d\n" % (len(_failed), _passed + len(_failed)))
        for failure in _failed:
            print("  ✗ %s\n" % failure)
        return 1
    print("OK — %d verifiche passate" % _passed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
