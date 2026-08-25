// Guscio dell'app: barra in alto con ricerca, due schermate, tab bar in basso.

import { el, clear, toast, humanError, relativeTime } from './ui.js';
import { ICON } from './icons.js';
import { loadSources, loadFeed, readWarmCache } from './data.js';
import { renderFeed, resetPaging } from './screen-feed.js';
import { renderArchive } from './screen-archive.js';
import { subscribe } from './store.js';

const TABS = [
  { id: 'feed', label: 'Feed', icon: 'feed' },
  { id: 'archive', label: 'Archivio', icon: 'archive' },
];

const app = {
  tab: 'feed',
  query: '',
  category: null,
  articles: [],
  names: { categories: new Map(), sources: new Map(), order: [] },
  updatedAt: null,
  loading: true,
  rerender: () => {},
};

const screenEl = document.getElementById('screen');
const topbarEl = document.getElementById('topbar');
const tabbarEl = document.getElementById('tabbar');
let searchInput = null;
let pullEl = null;

// --------------------------------------------------------------------------
// guscio
// --------------------------------------------------------------------------

function buildTopbar() {
  const title = el('h1', { class: 'brand', text: app.tab === 'feed' ? 'Feed' : 'Archivio' });

  const stamp = el('span', {
    class: 'stamp',
    text: app.updatedAt ? `agg. ${relativeTime(app.updatedAt)}` : '',
  });

  const refreshBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': 'Aggiorna',
    html: ICON.refresh,
    onclick: () => refresh(true),
  });

  const clearBtn = el('button', {
    class: 'search-clear',
    type: 'button',
    'aria-label': 'Cancella ricerca',
    html: ICON.close,
    hidden: !app.query,
    onclick: () => setQuery('', { blur: true }),
  });

  searchInput = el('input', {
    class: 'search-input',
    type: 'search',
    // enterkeyhint mette "Cerca" sul tasto invio dell'iPhone invece di "A capo".
    enterkeyhint: 'search',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: app.tab === 'feed' ? 'Cerca per titolo o categoria' : 'Cerca fra i salvati',
    'aria-label': 'Cerca per titolo o categoria',
    value: app.query,
  });

  searchInput.addEventListener('input', (event) => {
    const value = event.target.value;
    // Svuotare il campo a mano equivale a uscire dalla ricerca, tastiera
    // compresa: e' la richiesta esplicita, e su iPhone una tastiera che resta
    // aperta su una lista intera copre meta' schermo per niente.
    setQuery(value, { blur: value === '' });
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); searchInput.blur(); }
  });

  clear(topbarEl);
  topbarEl.append(
    el('div', { class: 'topbar-row' }, [title, el('div', { class: 'topbar-right' }, [stamp, refreshBtn])]),
    el('div', { class: 'searchbar' }, [
      el('span', { class: 'search-ico', html: ICON.search }),
      searchInput,
      clearBtn,
    ]),
  );
  // Il filtro per categoria vale solo nel Feed: nell'Archivio le categorie
  // sono gia' i titoli dei gruppi, e filtrarle sarebbe dire due volte la
  // stessa cosa.
  if (app.tab === 'feed') topbarEl.append(buildCategoryBar());
}

function buildCategoryBar() {
  const bar = el('div', { class: 'catbar' });

  const makeChip = (slug, label) => el('button', {
    class: `cat-chip${app.category === slug ? ' is-active' : ''}`,
    type: 'button',
    dataset: slug ? { cat: slug } : {},
    text: label,
    onclick: () => setCategory(slug),
  });

  bar.append(makeChip(null, 'Tutte'));
  for (const slug of app.names.order) {
    bar.append(makeChip(slug, app.names.categories.get(slug) ?? slug));
  }
  return bar;
}

function buildTabbar() {
  clear(tabbarEl);
  for (const tab of TABS) {
    tabbarEl.append(el('button', {
      class: `tab${app.tab === tab.id ? ' is-active' : ''}`,
      type: 'button',
      'aria-current': app.tab === tab.id ? 'page' : null,
      onclick: () => setTab(tab.id),
    }, [
      el('span', { class: 'tab-ico', html: ICON[tab.icon] }),
      el('span', { class: 'tab-label', text: tab.label }),
    ]));
  }
}

// --------------------------------------------------------------------------
// stato
// --------------------------------------------------------------------------

function render() {
  buildTopbar();
  buildTabbar();
  // Il topbar cambia altezza fra Feed e Archivio, per via della fila delle
  // categorie: l'indicatore del pull va riallineato o resta a mezz'aria.
  if (pullEl) pullEl.style.top = `${topbarEl.offsetHeight + 12}px`;
  if (app.tab === 'feed') renderFeed(screenEl, app);
  else renderArchive(screenEl, app);
}

app.rerender = render;

function setTab(id) {
  if (app.tab === id) { screenEl.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  app.tab = id;
  // Ricerca e filtro non si portano dietro fra le due sezioni: cercare "Roma"
  // nel Feed e ritrovarsi l'Archivio filtrato sarebbe una sorpresa, non una
  // comodita'.
  app.query = '';
  app.category = null;
  resetPaging();
  render();
  screenEl.scrollTop = 0;
}

function setCategory(slug) {
  app.category = app.category === slug ? null : slug;
  render();
  screenEl.scrollTop = 0;
}

function setQuery(value, { blur = false } = {}) {
  app.query = value;
  const clearBtn = topbarEl.querySelector('.search-clear');
  if (clearBtn) clearBtn.hidden = !value;
  if (app.tab === 'feed') renderFeed(screenEl, app);
  else renderArchive(screenEl, app);
  if (blur) searchInput?.blur();
}

// --------------------------------------------------------------------------
// caricamento
// --------------------------------------------------------------------------

async function refresh(manual = false) {
  const button = topbarEl.querySelector('.icon-btn');
  button?.classList.add('spinning');
  try {
    const feed = await loadFeed();
    const before = app.articles.length;
    app.articles = feed.articles;
    app.updatedAt = feed.updatedAt;
    app.loading = false;
    resetPaging();
    render();
    if (manual) {
      const arrived = feed.articles.length - before;
      toast(arrived > 0 ? `${arrived} articoli nuovi` : 'Nessun articolo nuovo');
    }
    if (feed.partial) toast('Alcuni blocchi non sono arrivati', 'ko');
  } catch (err) {
    app.loading = false;
    render();
    toast(humanError(err), 'ko');
  } finally {
    button?.classList.remove('spinning');
  }
}

/**
 * Trascinamento verso il basso per aggiornare. L'indicatore vive fuori dalla
 * schermata perche' i re-render svuotano #screen e se lo cancellassero a meta'
 * gesto resterebbe un pull senza feedback.
 */
function setupPullToRefresh() {
  pullEl = el('div', { class: 'pull' }, [el('span', { class: 'pull-ico', html: ICON.refresh })]);
  document.querySelector('.app').append(pullEl);

  let startY = 0;
  let pulling = false;
  let travel = 0;
  const THRESHOLD = 62;

  const eased = (raw) => Math.min(raw * 0.5, 96);

  screenEl.addEventListener('touchstart', (event) => {
    pulling = screenEl.scrollTop <= 0 && app.tab === 'feed';
    startY = event.touches[0].clientY;
    travel = 0;
  }, { passive: true });

  screenEl.addEventListener('touchmove', (event) => {
    if (!pulling) return;
    travel = event.touches[0].clientY - startY;
    if (travel <= 0) { pullEl.style.setProperty('--pull', '0'); pullEl.classList.remove('ready'); return; }
    const offset = eased(travel);
    pullEl.style.setProperty('--pull', String(offset));
    pullEl.classList.toggle('ready', offset >= THRESHOLD);
  }, { passive: true });

  const release = () => {
    if (!pulling) return;
    pulling = false;
    const fire = eased(travel) >= THRESHOLD;
    pullEl.style.setProperty('--pull', '0');
    pullEl.classList.remove('ready');
    if (fire) refresh(true);
  };

  screenEl.addEventListener('touchend', release, { passive: true });
  screenEl.addEventListener('touchcancel', release, { passive: true });
}

// --------------------------------------------------------------------------

async function boot() {
  try {
    app.names = await loadSources();
  } catch {
    // Senza sources.json restano gli slug al posto dei nomi: brutto ma usabile.
    toast('Nomi delle fonti non caricati', 'ko');
  }

  // Partenza a caldo: quello che c'era l'ultima volta appare subito, poi la
  // rete lo sostituisce. Evita lo spinner a ogni apertura dell'app.
  const warm = readWarmCache();
  if (warm) {
    app.articles = warm.articles;
    app.updatedAt = warm.updatedAt;
    app.loading = false;
  }

  render();
  setupPullToRefresh();
  subscribe(() => {
    // Il conteggio dei salvati vive nella tab bar: va ridisegnata a ogni
    // salvataggio, anche quando avviene dall'altra schermata.
    buildTabbar();
  });
  await refresh(false);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
