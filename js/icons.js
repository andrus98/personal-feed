// Icone inline come stringhe SVG. Sono costanti nostre, quindi passano da
// `html` in el() senza rischi: nessun dato esterno finisce qui dentro.

const wrap = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${opts}>${body}</svg>`;

export const ICON = {
  feed: wrap('<path d="M4 6h11M4 12h11M4 18h7"/><rect x="17" y="5" width="3" height="14" rx="1"/>'),

  archive: wrap('<path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z"/>'),

  // Segnalibro vuoto e pieno: il pieno usa fill, cosi' lo stato "salvato" si
  // legge a colpo d'occhio senza dover leggere l'etichetta.
  bookmark: wrap('<path d="M6.5 4h11a.5.5 0 0 1 .5.5v15.2a.3.3 0 0 1-.46.26L12 16.4l-5.54 3.56A.3.3 0 0 1 6 19.7V4.5a.5.5 0 0 1 .5-.5z"/>'),
  bookmarkFilled: wrap('<path d="M6.5 4h11a.5.5 0 0 1 .5.5v15.2a.3.3 0 0 1-.46.26L12 16.4l-5.54 3.56A.3.3 0 0 1 6 19.7V4.5a.5.5 0 0 1 .5-.5z" fill="currentColor"/>'),

  refresh: wrap('<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 4.5V11h-6.2"/>'),

  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),

  close: wrap('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),

  empty: wrap('<path d="M4 7h10M4 12h10M4 17h6"/><rect x="16.5" y="6" width="3.5" height="12" rx="1"/>', 'stroke-width="1.2"'),
};
