// Archivio: gli articoli salvati, raggruppati per categoria.
//
// Stessa scheda e stessa barra di ricerca del Feed. La differenza e' solo il
// raggruppamento: nel Feed conta il tempo, qui conta l'argomento, perche' un
// salvato lo si ricerca per "di cosa parlava", non per "quando e' uscito".

import { el, clear } from './ui.js';
import { articleCard, emptyState } from './card.js';
import { filterArticles, normalize } from './search.js';
import { savedArticles } from './store.js';

export function renderArchive(container, app) {
  clear(container);

  const saved = savedArticles();
  if (!saved.length) {
    container.append(emptyState(
      'Nessun articolo salvato',
      'Tocca "Salva" sotto un articolo del Feed e lo ritrovi qui.',
    ));
    return;
  }

  const list = filterArticles(saved, app.query, app.names.categories);

  if (normalize(app.query)) {
    container.append(el('p', {
      class: 'result-count',
      text: list.length === 1 ? '1 risultato' : `${list.length} risultati`,
    }));
  }

  if (!list.length) {
    container.append(emptyState('Nessun risultato', `Fra i salvati non c'è niente per "${app.query}".`));
    return;
  }

  // Le categorie seguono l'ordine di sources.json, non l'alfabeto: e' l'ordine
  // in cui le hai dichiarate tu, e resta stabile fra Feed e Archivio.
  const groups = new Map();
  for (const article of list) {
    if (!groups.has(article.category)) groups.set(article.category, []);
    groups.get(article.category).push(article);
  }

  const ordered = app.names.order.filter((slug) => groups.has(slug));
  for (const slug of groups.keys()) {
    if (!ordered.includes(slug)) ordered.push(slug);
  }

  for (const slug of ordered) {
    const articles = groups.get(slug);
    container.append(el('h2', { class: 'group-head', dataset: { cat: slug } }, [
      el('span', { class: 'group-name', text: app.names.categories.get(slug) ?? slug }),
      el('span', { class: 'group-count', text: String(articles.length) }),
    ]));
    const listEl = el('div', { class: 'list' });
    for (const article of articles) {
      // Togliere il salvataggio deve far sparire la scheda: e' l'unico posto
      // dove lasciarla sarebbe una bugia su cosa contiene l'Archivio.
      listEl.append(articleCard(article, app.names, (stillSaved) => {
        if (!stillSaved) app.rerender();
      }));
    }
    container.append(listEl);
  }
}
