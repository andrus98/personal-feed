// Lettura dei dati dal repo pubblico. Nessun token: raw.githubusercontent
// risponde con access-control-allow-origin: *, quindi il browser puo' leggere
// direttamente e un dispositivo nuovo funziona senza alcun setup.

import { DATA_BASE, SOURCES_URL, WARM_CACHE_MAX, LS_FEED_CACHE } from './config.js';

/**
 * `no-store` salta la cache del browser, non quella della CDN di GitHub, che
 * tiene i file per qualche minuto. E' il motivo per cui subito dopo un run
 * dell'ingestion il refresh puo' ancora non vedere gli articoli nuovi.
 */
async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status} su ${url}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

let sourcesCache = null;

/** Nomi leggibili delle fonti e delle categorie, dal repo del codice. */
export async function loadSources() {
  if (sourcesCache) return sourcesCache;
  const config = await getJson(SOURCES_URL);
  const categories = new Map(config.categories.map((c) => [c.slug, c.name]));
  const sources = new Map(config.sources.map((s) => [s.id, s.name]));
  sourcesCache = { categories, sources, order: config.categories.map((c) => c.slug) };
  return sourcesCache;
}

function dedupeAndSort(articles) {
  const byId = new Map();
  for (const article of articles) {
    if (article?.id) byId.set(article.id, article);
  }
  return [...byId.values()]
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}

/**
 * Il feed recente: index.json elenca gli shard degli ultimi giorni, che si
 * scaricano in parallelo. Uno shard che fallisce non fa fallire il resto —
 * meglio un feed parziale di una schermata di errore.
 */
export async function loadFeed() {
  const index = await getJson(`${DATA_BASE}/index.json`);
  const shards = await Promise.allSettled(
    (index.recent ?? []).map((path) => getJson(`${DATA_BASE}/${path}`)),
  );
  const articles = [];
  for (const result of shards) {
    if (result.status === 'fulfilled') articles.push(...(result.value.articles ?? []));
  }
  const merged = dedupeAndSort(articles);
  saveWarmCache(index, merged);
  return { articles: merged, updatedAt: index.updated_at ?? null, partial: shards.some((s) => s.status === 'rejected') };
}

/**
 * Copia ridotta dell'ultimo feed riuscito. Serve a due cose: la schermata e'
 * piena all'istante invece di mostrare uno spinner a ogni apertura, e senza
 * rete resta consultabile quello che si era gia' scaricato.
 */
function saveWarmCache(index, articles) {
  try {
    localStorage.setItem(LS_FEED_CACHE, JSON.stringify({
      updated_at: index.updated_at ?? null,
      cached_at: new Date().toISOString(),
      articles: articles.slice(0, WARM_CACHE_MAX),
    }));
  } catch {
    // Quota piena: si perde solo la partenza a caldo.
  }
}

export function readWarmCache() {
  try {
    const raw = localStorage.getItem(LS_FEED_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.articles) || !parsed.articles.length) return null;
    return { articles: parsed.articles, updatedAt: parsed.updated_at ?? null, cached: true };
  } catch {
    return null;
  }
}
