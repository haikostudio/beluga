/**
 * Les messages d'information passagers (les « toasts ») s'empilent en HAUT AU
 * CENTRE, en liste plate, `web/src/components/toasts.tsx`. `heureEtDate` et
 * `DUREE_MESSAGE_MS` ci-dessous sont leur affaire.
 */

/**
 * L'heure puis la date d'un message, en une ligne courte posée sous son texte :
 * « 14:32 · 04.08.2026 ». On donne les deux, toujours : un message resté à
 * l'écran depuis la veille ne doit pas se lire comme s'il venait d'arriver.
 */
export function heureEtDate(at?: number): string {
  if (!at) return '';
  const date = new Date(at);
  const heure = date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  const jour = date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${heure} · ${jour}`;
}

/**
 * Le temps qu'un message d'information passager reste à l'écran avant de se
 * fermer seul, sa barre de progression comprise — pour TOUS les niveaux, une
 * erreur y compris : 10 secondes au maximum, mise en pause tant qu'on le
 * survole ou le touche (`pauseToasts` / `resumeToasts`), reprise ensuite là
 * où elle en était.
 */
export const DUREE_MESSAGE_MS = 10000;

/* ------------------------------------------------------------------ */
/* LE MESSAGE QUI RESTE TANT QUE SA CAUSE DURE                         */
/* ------------------------------------------------------------------ */

/**
 * UN MESSAGE PERSISTANT N'EST PAS UN MESSAGE DE PLUS : C'EST UN ÉTAT.
 *
 * Les messages ordinaires racontent un fait déjà passé — une tâche finie, un
 * refus — et s'effacent au bout de `DUREE_MESSAGE_MS`. Un état, lui, dure :
 * tant que le lien avec le serveur est coupé, la phrase doit rester à l'écran,
 * et disparaître d'elle-même à la seconde où la cause disparaît.
 *
 * D'où une CLÉ plutôt qu'un identifiant tiré au hasard : la pile ne porte
 * jamais qu'un seul message par clé. Le texte peut changer (« reconnexion »
 * devient « état en cours de récupération ») sans que le message soit remplacé
 * par un nouveau — il garde sa PLACE et son HEURE d'arrivée, ce qui permet de
 * dire depuis quand l'état dure.
 *
 * Un état se lit AVANT ce qui s'est passé : le message persistant se pose donc
 * en TÊTE de pile, et les messages passagers s'empilent dessous.
 */
export interface EntreeDeLaPile {
  /** Ce qui identifie l'entrée dans la pile — tiré au hasard pour un passager. */
  id: string;
  /** La clé d'un message persistant. Absente sur un message passager. */
  cle?: string;
  /** Quand le message est arrivé : c'est cette heure qui est affichée. */
  at: number;
}

/**
 * La pile mise à jour pour porter — ou ne plus porter — le message persistant
 * d'une clé donnée.
 *
 * - `message` vaut `null` : toute entrée de cette clé est retirée ;
 * - une entrée de cette clé est déjà là : elle est remplacée EN PLACE, en
 *   gardant son `id` et son `at` d'origine (rien ne clignote, l'heure ne
 *   remonte pas) ;
 * - sinon le message entre en TÊTE de pile.
 *
 * Règle pure : elle ne connaît ni minuteur, ni React, ni le contenu affiché.
 */
export function pileAvecMessagePersistant<M extends EntreeDeLaPile>(
  pile: readonly M[],
  cle: string,
  message: M | null,
): M[] {
  const sansLaCle = pile.filter((entree) => entree.cle !== cle);
  if (!message) return sansLaCle.length === pile.length ? [...pile] : sansLaCle;
  const deja = pile.find((entree) => entree.cle === cle);
  const aPoser = deja ? { ...message, id: deja.id, at: deja.at } : message;
  if (!deja) return [aPoser, ...sansLaCle];
  return pile.map((entree) => (entree.cle === cle ? aPoser : entree));
}

/**
 * LE PLAFOND NE S'APPLIQUE QU'AUX MESSAGES PASSAGERS.
 *
 * La pile ne garde que les derniers messages passagers : six d'affilée et les
 * premiers s'en vont. Un message persistant, lui, ne se compte pas dans ce
 * plafond et ne peut pas en être chassé — il dit un état en cours, pas une
 * nouvelle. Sans cette séparation, six erreurs de suite effaçaient la phrase
 * qui explique pourquoi plus rien ne part.
 */
export const MESSAGES_PASSAGERS_GARDES = 5;

export function pileAvecMessage<M extends EntreeDeLaPile>(pile: readonly M[], message: M): M[] {
  const persistants = pile.filter((entree) => entree.cle);
  const passagers = pile.filter((entree) => !entree.cle).slice(-MESSAGES_PASSAGERS_GARDES);
  return [...persistants, ...passagers, message];
}
