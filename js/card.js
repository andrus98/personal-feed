// La scheda di un articolo: un post, non una riga di lista.
//
// Copertina larga quanto la scheda, titolo con l'effetto evidenziatore, testo,
// barra di azioni in fondo. Identica nel Feed e nell'Archivio: e' cio' che
// tiene coerenti le due sezioni senza doverle allineare a mano.

import { el, relativeTime, toast } from './ui.js';
import { ICON } from './icons.js';
import { isSaved, isRead, toggleSave, markRead } from './store.js';

function openLink(article, card) {
  markRead(article.id);
  card.classList.add('is-read');
}

async function share(article) {
  const payload = { title: article.title, url: article.link };
  try {
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
    await navigator.clipboard.writeText(article.link);
    toast('Link copiato');
  } catch (err) {
    // L'utente che annulla il foglio di condivisione non e' un errore.
    if (err?.name !== 'AbortError') toast('Condivisione non riuscita', 'ko');
  }
}

/**
 * Copertina tipografica per gli articoli che il feed manda senza immagine.
 *
 * Circa un quarto delle notizie non ne ha una: recuperarla vorrebbe dire
 * aprire la pagina di ogni articolo per leggerne l'og:image, cioe' scraping
 * HTML, che il PROJECT.md esclude e che aggiungerebbe centinaia di richieste
 * a ogni run. Questa invece e' costruita dal colore della categoria, non
 * scarica niente e non lascia mai un buco al posto della copertina.
 */
function generatedCover(categoryName) {
  return el('span', { class: 'cover-gen' }, [
    el('span', { class: 'cover-word', text: categoryName }),
  ]);
}

export function articleCard(article, names, onToggle) {
  const categoryName = names.categories.get(article.category) ?? article.category;
  const sourceName = names.sources.get(article.source) ?? article.source;

  const cover = el('a', {
    class: 'cover',
    href: article.link,
    target: '_blank',
    rel: 'noopener noreferrer',
    tabindex: '-1',
    'aria-hidden': 'true',
    onclick: () => openLink(article, card),
  }, [el('span', { class: 'chip', text: categoryName })]);

  if (article.image_url) {
    const img = el('img', {
      class: 'cover-img',
      src: article.image_url,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
      // Un'immagine che non arriva non deve lasciare un rettangolo vuoto:
      // si sostituisce con la copertina tipografica, come se non ci fosse
      // mai stata.
      onerror: () => { img.replaceWith(generatedCover(categoryName)); },
    });
    cover.prepend(img);
  } else {
    cover.prepend(generatedCover(categoryName));
  }

  const meta = el('div', { class: 'post-meta' }, [
    el('span', { class: 'meta-ico', html: ICON.clock }),
    el('span', { text: relativeTime(article.published_at) }),
    el('span', { class: 'dot', text: '·' }),
    el('span', { class: 'meta-source', text: sourceName }),
  ]);

  const title = el('a', {
    class: 'post-title',
    href: article.link,
    target: '_blank',
    rel: 'noopener noreferrer',
    onclick: () => openLink(article, card),
    // Lo span interno e' indispensabile: l'evidenziatore riga per riga si
    // ottiene con box-decoration-break su un elemento inline, non sul blocco.
  }, [el('span', { class: 'hl', text: article.title })]);

  const body = article.summary
    ? el('div', { class: 'post-body' }, [
        el('p', { class: 'post-summary', text: article.summary }),
        el('a', {
          class: 'post-more',
          href: article.link,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Leggi di più',
          onclick: () => openLink(article, card),
        }),
      ])
    // Quando il feed non espone l'estratto (MarketWatch Bulletins) si mostra il
    // solo titolo: niente riassunti inventati.
    : null;

  const saveButton = el('button', {
    class: 'act',
    type: 'button',
    'aria-label': 'Salva',
    'aria-pressed': isSaved(article.id) ? 'true' : 'false',
    html: isSaved(article.id) ? ICON.bookmarkFilled : ICON.bookmark,
  });
  saveButton.addEventListener('click', () => {
    const saved = toggleSave(article);
    saveButton.setAttribute('aria-pressed', saved ? 'true' : 'false');
    saveButton.innerHTML = saved ? ICON.bookmarkFilled : ICON.bookmark;
    onToggle?.(saved, article);
  });

  const shareButton = el('button', {
    class: 'act',
    type: 'button',
    'aria-label': 'Condividi',
    html: ICON.share,
    onclick: () => share(article),
  });

  const card = el('article', {
    class: `post${isRead(article.id) ? ' is-read' : ''}`,
    dataset: { cat: article.category },
  }, [
    cover,
    meta,
    title,
    body,
    el('footer', { class: 'post-actions' }, [saveButton, shareButton]),
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
