// La scheda di un articolo, usata identica nel Feed e nell'Archivio: e' cio'
// che tiene coerenti le due sezioni senza doverle allineare a mano.

import { el, relativeTime } from './ui.js';
import { ICON } from './icons.js';
import { isSaved, isRead, toggleSave, markRead } from './store.js';

/**
 * @param onToggle callback dopo il salva/rimuovi. L'Archivio la usa per far
 *        sparire la scheda quando l'articolo viene tolto dai salvati.
 */
export function articleCard(article, names, onToggle) {
  const categoryName = names.categories.get(article.category) ?? article.category;
  const sourceName = names.sources.get(article.source) ?? article.source;

  const thumb = article.image_url
    ? el('img', {
        class: 'card-thumb',
        src: article.image_url,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer',
        // Un'anteprima rotta lascerebbe un rettangolo vuoto storto: meglio
        // che la scheda si richiuda sul testo come se l'immagine non ci fosse.
        onerror: (event) => event.target.remove(),
      })
    : null;

  const body = el('a', {
    class: 'card-main',
    href: article.link,
    target: '_blank',
    rel: 'noopener noreferrer',
    onclick: () => { markRead(article.id); card.classList.add('is-read'); },
  }, [
    el('div', { class: 'card-text' }, [
      el('span', { class: 'chip', text: categoryName }),
      el('h2', { class: 'card-title', text: article.title }),
      // Quando il feed non espone l'estratto (MarketWatch Bulletins) si mostra
      // il solo titolo: niente riassunti inventati.
      article.summary ? el('p', { class: 'card-summary', text: article.summary }) : null,
    ]),
    thumb,
  ]);

  const saveButton = el('button', {
    class: 'save-btn',
    type: 'button',
    'aria-pressed': isSaved(article.id) ? 'true' : 'false',
  }, [
    el('span', { class: 'save-ico', html: isSaved(article.id) ? ICON.bookmarkFilled : ICON.bookmark }),
    el('span', { class: 'save-label', text: isSaved(article.id) ? 'Salvato' : 'Salva' }),
  ]);

  saveButton.addEventListener('click', () => {
    const saved = toggleSave(article);
    saveButton.setAttribute('aria-pressed', saved ? 'true' : 'false');
    saveButton.querySelector('.save-ico').innerHTML = saved ? ICON.bookmarkFilled : ICON.bookmark;
    saveButton.querySelector('.save-label').textContent = saved ? 'Salvato' : 'Salva';
    onToggle?.(saved, article);
  });

  const card = el('article', {
    class: `card${isRead(article.id) ? ' is-read' : ''}`,
    dataset: { cat: article.category },
  }, [
    body,
    el('footer', { class: 'card-foot' }, [
      saveButton,
      el('span', { class: 'card-meta' }, [
        el('span', { text: sourceName }),
        el('span', { class: 'dot', text: '·' }),
        el('span', { text: relativeTime(article.published_at) }),
      ]),
    ]),
  ]);

  return card;
}

export function emptyState(title, detail) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-ico', html: ICON.empty }),
    el('p', { class: 'empty-title', text: title }),
    detail ? el('p', { class: 'empty-detail', text: detail }) : null,
  ]);
}
