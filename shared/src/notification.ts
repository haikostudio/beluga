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
export const LONGUEUR_CORPS = 180;

/**
 * Le titre : « ✅ HaikoDev — Refondre les notifications ». Un emoji ouvre le
 * titre selon le genre de nouvelle — c'est le SEUL repère visuel qui survit sur
 * un téléphone, où le système impose l'icône de l'application. Vient ensuite le
 * nom du projet, puis l'action elle-même (le titre réel de la carte), parce que
 * c'est ce qu'on lit d'un coup d'œil quand le système raccourcit.
 */
export function titreNotification(evenement: string, projet?: string, emoji?: string): string {
  const tete = (emoji ?? '').trim();
  const prefixe = tete ? `${tete} ` : '';
  const nom = (projet ?? '').trim();
  if (!nom) return `${prefixe}${evenement}`;
  // Un titre qui nomme déjà le projet ne le répète pas.
  if (evenement.toLowerCase().startsWith(`${nom.toLowerCase()} `)) return `${prefixe}${evenement}`;
  return `${prefixe}${nom} — ${evenement}`;
}

/** Coupe à la longueur voulue sans laisser un mot à moitié. */
export function couperTexte(texte: string, limite: number): string {
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
 *
 * `actionDuTitre` est ce que le titre porte DÉJÀ (l'action, souvent le titre de
 * la carte) : quand la première ligne du corps le redirait mot pour mot, on la
 * saute et la description prend toute la place — elle seule illustre la tâche.
 */
export function corpsNotification(corps: string, carte?: CarteNotifiee, actionDuTitre?: string): string {
  // Chaque ligne est raccourcie SÉPARÉMENT : le retour à la ligne entre le
  // titre de la carte et sa description doit survivre au raccourcissement.
  const premiereSource = ((corps ?? '').trim() || (carte?.title ?? '')).replace(/\s+/g, ' ').trim();
  const description = (carte?.description ?? '').replace(/\s+/g, ' ').trim();

  // Le titre nomme déjà l'action : inutile de la répéter en tête du corps.
  const action = (actionDuTitre ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (action && premiereSource.toLowerCase() === action && description) {
    return couperTexte(description, LONGUEUR_CORPS);
  }

  const premiere = couperTexte(premiereSource, LONGUEUR_CORPS);
  if (!description) return premiere;

  const deja = premiere.toLowerCase();
  const brute = description.toLowerCase();
  // Répéter la même phrase deux fois ferait perdre les deux lignes disponibles.
  if (deja && (deja.includes(brute) || brute.startsWith(deja.replace(/…$/, '')))) return premiere;

  const reste = LONGUEUR_CORPS - premiere.length - 1;
  if (reste < 24) return premiere;
  return premiere ? `${premiere}\n${couperTexte(description, reste)}` : couperTexte(description, LONGUEUR_CORPS);
}
