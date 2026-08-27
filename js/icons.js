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

  // Anello centrato esatto su (12,12) con raggio 8, e la punta appoggiata
  // dov'e' finito l'arco. I numeri non sono arrotondati a occhio: (12,4) e
  // (16.8,5.6) distano entrambi 8 dal centro - 4.8/6.4/8 e' una terna
  // pitagorica - quindi l'arco non ha bisogno di essere riadattato dal browser
  // e il centro non scivola. Conta perche' e' questa l'icona che gira: se il
  // centro dell'anello non coincide con quello del riquadro, la rotazione
  // traballa invece di girare sul posto.
  // La versione precedente aveva la punta come barra da 6.2 unita' che
  // arrivava fin quasi al centro: il riquadro risultava centrato, ma tutto quel
  // peso d'inchiostro a destra si leggeva storto.
  refresh: wrap('<path d="M12 4a8 8 0 1 0 4.8 1.6"/><path d="M19.6 5.6H16.8V8.4"/>'),

  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),

  close: wrap('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),

  empty: wrap('<path d="M4 7h10M4 12h10M4 17h6"/><rect x="16.5" y="6" width="3.5" height="12" rx="1"/>', 'stroke-width="1.2"'),

  clock: wrap('<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 1.8"/>'),

  share: wrap('<path d="M20.5 3.5L10.8 13.2"/><path d="M20.5 3.5l-6.2 17-3.5-7.3-7.3-3.5z"/>'),
};
