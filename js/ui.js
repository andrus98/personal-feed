// Helper DOM minimi. Niente framework: l'app e' piccola e senza build step.

/**
 * Crea un elemento. `text` passa da textContent, mai da innerHTML: titoli e
 * anteprime arrivano dai feed delle testate, cioe' da fuori, e un titolo che
 * contiene `<` deve restare testo.
 * `html` esiste solo per le icone, che sono costanti nostre.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

const RTF = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
const DATE_FMT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

/**
 * "3 min fa", "2 ore fa", poi la data secca. Oltre la settimana il tempo
 * relativo smette di aiutare: "12 giorni fa" si legge peggio di "13 ago".
 */
export function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = (then.getTime() - Date.now()) / 1000;
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 1) return 'adesso';
  if (Math.abs(minutes) < 60) return RTF.format(Math.round(minutes), 'minute');
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) return RTF.format(Math.round(hours), 'hour');
  const days = hours / 24;
  if (Math.abs(days) < 7) return RTF.format(Math.round(days), 'day');
  return DATE_FMT.format(then);
}

/**
 * Da quante ore il feed non riceve niente, e come dirlo.
 *
 * Serve perche' l'ingestion gira sullo scheduler gratuito di Actions, che
 * salta la maggior parte degli slot e a volte smette del tutto: il 26 agosto
 * si e' fermato per diciotto ore dopo un incidente, senza un solo run fallito.
 * Con il solo "agg. 18 ore fa" in grigio, un feed morto e una giornata povera
 * di notizie si leggono uguale.
 *
 * Le soglie vengono dalla cadenza misurata, non da un numero tondo: quando la
 * catena e' sana fra un run che scrive e il successivo passano una o due ore,
 * di notte fino a quattro. Sotto le sei ore quindi non c'e' niente da dire, e
 * un avviso li' sarebbe solo il lupo al pascolo.
 */
const LATE_AFTER_H = 6;
const STALLED_AFTER_H = 12;

// Data e ora separate, non un solo formato con entrambe: quello di it-IT
// infila una virgola in mezzo ("26 ago, 16:25") e qui non serve.
const TIME_FMT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

export function staleness(iso) {
  const nothing = { level: 'unknown', label: '', detail: '' };
  if (!iso) return nothing;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return nothing;

  const hours = (Date.now() - then.getTime()) / 3600000;
  const exact = `Ultimo aggiornamento: ${DATE_FMT.format(then)} ${TIME_FMT.format(then)}`;

  if (hours >= STALLED_AFTER_H) {
    // Qui il tempo relativo va scritto a mano: "fermo da ieri" non e' una
    // misura, e con numeric: 'auto' e' quello che uscirebbe.
    const span = hours < 48
      ? `${Math.round(hours)} ore`
      : `${Math.round(hours / 24)} giorni`;
    return {
      level: 'stalled',
      label: `fermo da ${span}`,
      detail: `${exact}. L'ingestion e' ferma: controlla le Actions del repo.`,
    };
  }

  if (hours >= LATE_AFTER_H) {
    return {
      level: 'late',
      label: `agg. ${relativeTime(iso)}`,
      detail: `${exact}. Piu' del solito: di norma scrive ogni una o due ore.`,
    };
  }

  return { level: 'ok', label: `agg. ${relativeTime(iso)}`, detail: exact };
}

let toastTimer;
export function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: `toast ${kind}`.trim(), role: 'status', text: message });
  document.body.append(node);
  clearTimeout(toastTimer);
  setTimeout(() => node.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === 'ko' ? 4000 : 2200);
}

/** Messaggio leggibile, senza gergo HTTP. */
export function humanError(err) {
  if (err?.name === 'TypeError' || err?.kind === 'network') {
    return 'Nessuna connessione. Vedi gli articoli già scaricati.';
  }
  if (err?.status === 404) return 'Dati non trovati sul repo. L\'ingestion non ha ancora scritto?';
  return err?.message ?? 'Errore imprevisto';
}
