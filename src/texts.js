/**
 * What the component says out loud, in one place so that a translation is one
 * edit. These sit alongside the labels already written in Danish in both
 * versions — "Søgeresultater", "Søg adresse".
 */
export const texts = {
  /** Announced when a search returns suggestions. */
  results: (count) => `${count} forslag`,
  /** Announced when a search returns nothing. */
  noResults: "Ingen adresser fundet",
  /** Shown and announced when a search fails. */
  searchFailed: "Adressesøgningen kunne ikke gennemføres. Prøv igen.",
};
