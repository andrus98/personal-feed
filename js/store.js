// Stato dell'utente: articoli salvati e articoli gia' aperti.
//
// Per ora vive solo su questo dispositivo, in localStorage. La sincronizzazione
// su GitHub (state.json nel repo dati) e' la fase successiva del PROJECT.md e
// richiede un token in scrittura: il formato qui sotto e' gia' quello che
// finira' nel file, cosi' aggiungere la sincronizzazione non impone di
// migrare nulla.

import { LS_STATE } from './config.js';

const EMPTY = { updated_at: null, read: [], saved: [] };

function load() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      updated_at: parsed.updated_at ?? null,
      read: Array.isArray(parsed.read) ? parsed.read : [],
      saved: Array.isArray(parsed.saved) ? parsed.saved : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

let state = load();
const listeners = new Set();

function persist() {
  state.updated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  try {
    localStorage.setItem(LS_STATE, JSON.stringify(state));
  } catch {
    // Quota piena: lo stato resta in memoria per questa sessione. Meglio
    // un'app che continua a funzionare di un'eccezione a ogni salvataggio.
  }
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isSaved = (id) => state.saved.some((item) => item.id === id);
export const isRead = (id) => state.read.includes(id);

/** In ordine di salvataggio, dal piu' recente. */
export const savedArticles = () =>
  [...state.saved].sort((a, b) => (b.saved_at ?? '').localeCompare(a.saved_at ?? ''));

export const savedCount = () => state.saved.length;

/**
 * Il salvato porta con se' una copia dell'articolo. E' voluto: quando lo shard
 * viene consolidato nell'archivio mensile, un salvato deve restare leggibile
 * senza dover scaricare un file da diversi MB per mostrare una riga.
 */
export function toggleSave(article) {
  const index = state.saved.findIndex((item) => item.id === article.id);
  if (index >= 0) {
    state.saved.splice(index, 1);
    persist();
    return false;
  }
  state.saved.push({
    id: article.id,
    saved_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    title: article.title,
    link: article.link,
    source: article.source,
    category: article.category,
    summary: article.summary ?? null,
    image_url: article.image_url ?? null,
    published_at: article.published_at,
  });
  persist();
  return true;
}

export function markRead(id) {
  if (state.read.includes(id)) return;
  state.read.push(id);
  // La lista non puo' crescere all'infinito: un articolo di mesi fa non ha
  // bisogno di essere ricordato come letto, e non e' piu' nel feed.
  if (state.read.length > 3000) state.read = state.read.slice(-2000);
  persist();
}
