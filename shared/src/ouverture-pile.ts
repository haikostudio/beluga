/**
 * Comment la pile des messages courts, en bas à droite, s'OUVRE.
 *
 * À la souris, on survole : la pile se déploie sous le curseur et se referme
 * dès qu'il s'en va. Au doigt, il n'y a pas de survol — la pile resterait
 * fermée pour toujours et les messages du dessous seraient inatteignables.
 * L'appui prend donc le relais : un appui déploie, un second referme, un appui
 * ailleurs sur l'écran referme aussi.
 *
 * Le choix se fait sur la CAPACITÉ DU POINTEUR, jamais sur la largeur de
 * l'écran : une tablette large n'a pas plus de survol qu'un téléphone, et un
 * ordinateur portable à petit écran en a.
 *
 * Tout est calculé ici, sans base ni disque : les règles sont donc rejouables
 * seules, et l'affichage n'a plus qu'à poser ce qu'elles rendent.
 */

/** La question posée au navigateur : ce pointeur sait-il survoler ? */
export const REQUETE_SURVOL = '(hover: hover) and (pointer: fine)';

/** Le geste qui ouvre la pile. */
export type GesteDOuverture = 'survol' | 'appui';

/** Ce qui vient d'arriver sur (ou à côté de) la pile. */
export type EvenementDePile = 'survol-entre' | 'survol-sort' | 'appui-dedans' | 'appui-dehors';

/** Le geste d'ouverture, d'après ce que le pointeur sait faire. */
export function gesteDOuverture(survolPossible: boolean): GesteDOuverture {
  return survolPossible ? 'survol' : 'appui';
}

/**
 * L'état de la pile après un événement.
 *
 * Un pointeur qui survole ignore l'appui d'ouverture — sinon un clic sur un
 * message rabattrait la pile sous le curseur, juste avant que le survol ne la
 * rouvre. Un pointeur sans survol, lui, ignore les événements de survol : les
 * navigateurs tactiles en fabriquent parfois de faux après un appui.
 */
export function pileApres(ouverte: boolean, evenement: EvenementDePile, geste: GesteDOuverture): boolean {
  // Un appui ailleurs referme toujours : c'est le geste de sortie commun.
  if (evenement === 'appui-dehors') return false;
  if (geste === 'survol') {
    if (evenement === 'survol-entre') return true;
    if (evenement === 'survol-sort') return false;
    return ouverte;
  }
  if (evenement === 'appui-dedans') return !ouverte;
  return ouverte;
}

