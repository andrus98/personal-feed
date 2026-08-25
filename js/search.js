// Ricerca unica su titolo e categoria, come da specifica: si scrive una cosa
// sola e matcha l'una o l'altra.

/**
 * Minuscole e senza accenti, cosi' "perche" trova "perché" e "Politica" trova
 * "politica". NFD spezza la lettera accentata in lettera + segno, e la classe
 * unicode dei segni diacritici li toglie.
 */
export const normalize = (value) => (value ?? '')
  .toString()
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .trim();

/**
 * Tutti i termini devono comparire da qualche parte, in qualunque ordine:
 * "roma dybala" trova un titolo che li contiene entrambi anche distanti.
 */
export function matches(article, query, categoryNames) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalize(
    `${article.title} ${categoryNames.get(article.category) ?? article.category}`,
  );
  return terms.every((term) => haystack.includes(term));
}

export function filterArticles(articles, query, categoryNames) {
  if (!normalize(query)) return articles;
  return articles.filter((article) => matches(article, query, categoryNames));
}
