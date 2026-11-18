/**
 * LA CAPACITÉ DU POINTEUR : survol à la souris, appui au doigt (`web/src/lib/pointeur.ts`).
 * (Les règles d'ouverture de l'ancien module de voix — `gesteDOuverture`, `pileApres` — ont disparu avec lui le
 * 16/11/2026 : Jarvis au bord s'ouvre d'un toucher ou d'un tirage.)
 *
 * D'origine : comment la pile des messages courts, en bas à droite, s'OUVRE.
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
