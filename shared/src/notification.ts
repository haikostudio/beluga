/**
 * Le texte d'une notification.
 *
 * Une alerte arrive sur un téléphone verrouillé, souvent au milieu d'autres :
 * elle doit dire DE QUEL PROJET elle parle et CE DONT il s'agit, sans qu'on
 * ouvre l'application. D'où deux lignes : le projet en tête du titre, et le
 * corps qui donne le titre de la carte puis sa description.
 *
 * Règle pure : aucune base, aucun disque — donc rejouable telle quelle.
 */

/** Ce qu'on sait de la carte au moment d'écrire l'alerte. */
export interface CarteNotifiee {
  title?: string;
  description?: string;
}

/** Au-delà, une notification est coupée par le système : autant couper proprement. */
const LONGUEUR_CORPS = 180;

/**
 * Le titre : « HaikoDev — Tâche terminée ». Le nom du projet vient EN TÊTE,
 * parce que c'est la première chose lue et la seule qui reste visible quand
 * le système raccourcit.
 */
export function titreNotification(evenement: string, projet?: string): string {
  const nom = (projet ?? '').trim();
  if (!nom) return evenement;
  // Un titre qui nomme déjà le projet ne le répète pas.
  if (evenement.toLowerCase().startsWith(`${nom.toLowerCase()} `)) return evenement;
  return `${nom} — ${evenement}`;
}

/** Coupe à la longueur voulue sans laisser un mot à moitié. */
function couper(texte: string, limite: number): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  if (propre.length <= limite) return propre;
  const tronque = propre.slice(0, limite);
  const espace = tronque.lastIndexOf(' ');
  return `${(espace > limite * 0.6 ? tronque.slice(0, espace) : tronque).trimEnd()}…`;
}

/**
 * Le corps : le titre de la carte, puis sa description en dessous. La
 * description n'est reprise que si elle apporte autre chose que le titre —
 * répéter la même phrase deux fois ferait perdre les deux lignes disponibles.
 */
export function corpsNotification(corps: string, carte?: CarteNotifiee): string {
  // Chaque ligne est raccourcie SÉPARÉMENT : le retour à la ligne entre le
  // titre de la carte et sa description doit survivre au raccourcissement.
  const premiere = couper((corps ?? '').trim() || (carte?.title ?? ''), LONGUEUR_CORPS);
  const description = (carte?.description ?? '').replace(/\s+/g, ' ').trim();
  if (!description) return premiere;

  const deja = premiere.toLowerCase();
  const brute = description.toLowerCase();
  // Répéter la même phrase deux fois ferait perdre les deux lignes disponibles.
  if (deja && (deja.includes(brute) || brute.startsWith(deja.replace(/…$/, '')))) return premiere;

  const reste = LONGUEUR_CORPS - premiere.length - 1;
  if (reste < 24) return premiere;
  return premiere ? `${premiere}\n${couper(description, reste)}` : couper(description, LONGUEUR_CORPS);
}
