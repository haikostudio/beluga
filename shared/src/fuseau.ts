/**
 * L'heure du produit, et non celle de la machine.
 *
 * Les repères de quota — « remise à zéro à 12:59 », « épuisé mercredi vers
 * 21 h », le creux de la nuit — sont lus par une personne à Zurich, alors que
 * le serveur, lui, tourne en UTC. `new Date(...).getHours()` répond donc selon
 * le fuseau de la MACHINE : sur le serveur, la nuit creuse est décalée de deux
 * heures et l'heure affichée est fausse d'autant.
 *
 * Tout ce qui découpe ou nomme une heure passe donc par ici, et parle le
 * fuseau de référence.
 *
 * La règle vit ici, sans réseau ni base : elle se teste seule.
 */

/** Le fuseau dans lequel le produit se lit, quelle que soit la machine. */
export const FUSEAU = 'Europe/Zurich';

const decoupe = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Le décalage du fuseau de référence, en millisecondes. Il ne change qu'aux
 * changements d'heure, qui tombent sur un bord d'heure : le retenir par heure
 * suffit, et évite de rappeler `Intl` des milliers de fois sur un historique.
 */
const decalages = new Map<number, number>();

export function decalageFuseau(at: number): number {
  const heure = Math.floor(at / 3_600_000);
  const connu = decalages.get(heure);
  if (connu !== undefined) return connu;
  const base = heure * 3_600_000;
  const parts: Record<string, string> = {};
  for (const part of decoupe.formatToParts(base)) parts[part.type] = part.value;
  const calcule =
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    ) - base;
  // Un historique de plusieurs mois tient largement ; au-delà, on repart à neuf
  // plutôt que de laisser la table grossir sans fin.
  if (decalages.size > 200_000) decalages.clear();
  decalages.set(heure, calcule);
  return calcule;
}

/**
 * Une date dont les lectures UTC (`getUTCHours`, `getUTCDay`…) rendent l'heure
 * du fuseau de référence. Aucun autre usage : elle ne désigne pas le bon
 * instant, seulement les bons chiffres.
 */
export function dateLocale(at: number): Date {
  return new Date(at + decalageFuseau(at));
}

/** L'heure du jour, de 0 à 23, dans le fuseau de référence. */
export function heureLocale(at: number): number {
  return dateLocale(at).getUTCHours();
}

/** Le jour de la semaine, dimanche = 0, dans le fuseau de référence. */
export function jourDeSemaineLocal(at: number): number {
  return dateLocale(at).getUTCDay();
}

/** Les minutes de l'heure, dans le fuseau de référence. */
export function minutesLocales(at: number): number {
  return dateLocale(at).getUTCMinutes();
}

/** Le jour, « 2026-08-04 », dans le fuseau de référence. */
export function jourLocal(at: number): string {
  const date = dateLocale(at);
  const deuxChiffres = (valeur: number) => String(valeur).padStart(2, '0');
  return `${date.getUTCFullYear()}-${deuxChiffres(date.getUTCMonth() + 1)}-${deuxChiffres(date.getUTCDate())}`;
}

/** Minuit, dans le fuseau de référence, du jour « 2026-08-04 ». */
export function debutDuJour(jour: string): number {
  const [annee, mois, jourDuMois] = jour.split('-').map((part) => Number(part));
  const brut = Date.UTC(annee, (mois || 1) - 1, jourDuMois || 1);
  // Le décalage se lit sur l'instant obtenu : au changement d'heure, la
  // première lecture peut viser la veille, la seconde retombe juste.
  const premier = brut - decalageFuseau(brut);
  return brut - decalageFuseau(premier);
}

/**
 * Le bord de l'heure suivante. Sur le fuseau de référence les bords d'heure
 * sont ceux d'UTC, mais le calcul reste écrit en heure locale : un fuseau à la
 * demi-heure ne casserait pas le découpage.
 */
export function prochaineHeure(at: number): number {
  const decalage = decalageFuseau(at);
  const bord = (Math.floor((at + decalage) / 3_600_000) + 1) * 3_600_000;
  const instant = bord - decalageFuseau(bord - decalage);
  return instant > at ? instant : bord - decalage;
}
