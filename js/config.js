// Costanti dell'app. Qui non ci sono segreti: il repo dati e' pubblico e in
// lettura non serve alcun token.

export const APP_VERSION = '1.0.0';

const DATA_OWNER = 'andrus98';
const DATA_REPO = 'personal-feed-data';
const DATA_BRANCH = 'main';

export const DATA_BASE =
  `https://raw.githubusercontent.com/${DATA_OWNER}/${DATA_REPO}/${DATA_BRANCH}/data`;

/** sources.json vive nel repo del codice: stessa origine, nessuna richiesta esterna. */
export const SOURCES_URL = './sources.json';

/** Articoli renderizzati per volta. Il resto arriva scorrendo. */
export const PAGE_SIZE = 30;

/** Quanti articoli tenere in localStorage per la partenza a freddo. */
export const WARM_CACHE_MAX = 400;

export const LS_STATE = 'pf.state.v1';
export const LS_FEED_CACHE = 'pf.feed.v1';
