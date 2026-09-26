/**
 * « QUELQUE CHOSE TRAVAILLE ICI » — l'indicateur d'activité, en une règle.
 *
 * L'information était portée par un PERSONNAGE illustré en tête de colonne,
 * qui s'animait quand un agent travaillait. Les personnages ont été retirés au
 * profit d'une interface sobre ; l'INFORMATION, elle, ne se perd pas : un
 * point discret prend le relais, dessiné en code — jamais une image de plus à
 * télécharger.
 *
 * Et il s'ÉLARGIT. Deux colonnes seulement s'animaient parce qu'elles seules
 * avaient un personnage animé. Cette
 * limitation n'avait aucune raison d'être : un travail peut se lire partout où
 * une carte est tenue par un agent. L'indicateur paraît donc dans TOUTE
 * colonne qui compte au moins une carte au travail, et dans la conversation
 * d'une carte dont l'agent tient son tour.
 *
 * La règle ne regarde PAS l'avancement (`avancementDeLaColonne`) : un agent
 * qui n'a pas encore annoncé sa liste de tâches ne pèse rien dans ce
 * pourcentage, alors qu'il travaille bel et bien — l'indicateur s'éteindrait
 * sur un tableau pourtant occupé.
 *
 * Règle PURE : ni base, ni disque, ni DOM. Elle se rejoue seule
 * (`server/src/test/indicateur-activite.test.ts`).
 */

/**
 * CETTE COLONNE MONTRE-T-ELLE SON INDICATEUR ? Une seule condition, et elle
 * vaut pour toutes les colonnes : au moins une de ses cartes est tenue par un
 * agent au travail. Aucune colonne n'est privilégiée, aucune n'est exclue.
 */
export function colonneAuTravail(cartesAuTravail: number): boolean {
  return cartesAuTravail > 0;
}

/**
 * CE QUE FAIT L'INDICATEUR, à l'instant qu'on regarde. Deux états, et pas un
 * de plus :
 *
 *  - « eteint » — le cas de presque toutes les colonnes, presque tout le
 *    temps : RIEN ne s'affiche. C'est cette absence qui donne son sens au
 *    reste ;
 *  - « pulse » — le point bat doucement tant qu'un agent travaille.
 *
 * « Je préfère moins d'animations » ne fait pas disparaître l'indicateur : le
 * point reste POSÉ, il cesse seulement de battre. Perdre le signal serait
 * perdre l'information ; c'est le mouvement qu'on retire, pas le repère. La
 * feuille de style s'en charge seule (`prefers-reduced-motion`), le code n'a
 * donc rien à décider ici.
 */
export type EtatDeLIndicateur = 'eteint' | 'pulse';

export function etatDeLIndicateur(cartesAuTravail: number): EtatDeLIndicateur {
  return colonneAuTravail(cartesAuTravail) ? 'pulse' : 'eteint';
}
