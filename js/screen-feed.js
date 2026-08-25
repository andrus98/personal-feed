// Feed: gli articoli piu' recenti, con ricerca e caricamento progressivo.

import { el, clear } from './ui.js';
import { PAGE_SIZE } from './config.js';
import { articleCard, emptyState } from './card.js';
import { filterArticles, normalize } from './search.js';

// Il limite vive fuori dalla funzione perche' deve sopravvivere ai re-render
// (un salvataggio ridisegna la lista e non deve riportarti in cima).
const paging = { limit: PAGE_SIZE, key: null };

export function resetPaging() {
  paging.limit = PAGE_SIZE;
  paging.key = null;
}

export function renderFeed(container, app) {
  const query = app.query;
  // Cambiare filtro o ricerca riparte dall'inizio; un salvataggio invece
  // ridisegna la lista e non deve riportarti in cima.
  const key = `${app.category ?? ''}|${query}`;
  if (paging.key !== key) {
    paging.key = key;
    paging.limit = PAGE_SIZE;
  }

  clear(container);

  if (!app.articles.length) {
    container.append(app.loading
      ? el('div', { class: 'empty', text: 'Carico gli articoli…' })
      : emptyState('Nessun articolo', 'Il repo dati è vuoto, oppure la prima ingestion non è ancora passata.'));
    return;
  }

  const inCategory = app.category
    ? app.articles.filter((article) => article.category === app.category)
    : app.articles;
  const list = filterArticles(inCategory, query, app.names.categories);

  if (normalize(query) || app.category) {
    container.append(el('p', {
      class: 'result-count',
      text: list.length === 1 ? '1 articolo' : `${list.length} articoli`,
    }));
  }

  if (!list.length) {
    container.append(emptyState(
      'Nessun risultato',
      normalize(query)
        ? `Niente che corrisponda a "${query}".`
        : 'Questa categoria non ha articoli nella finestra recente.',
    ));
    return;
  }

  const listEl = el('div', { class: 'list' });
  container.append(listEl);

  const sentinel = el('div', { class: 'sentinel' });

  const appendSlice = () => {
    const to = Math.min(paging.limit, list.length);
    for (let i = listEl.childElementCount; i < to; i += 1) {
      listEl.append(articleCard(list[i], app.names));
    }
    if (to >= list.length) sentinel.remove();
  };

  appendSlice();

  if (list.length > paging.limit) {
    container.append(sentinel);
    // rootMargin generoso: la pagina successiva arriva prima che il fondo sia
    // davvero visibile, cosi' lo scorrimento non si interrompe mai.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      paging.limit += PAGE_SIZE;
      appendSlice();
      if (paging.limit >= list.length) observer.disconnect();
    }, { root: container, rootMargin: '600px' });
    observer.observe(sentinel);
  }
}
