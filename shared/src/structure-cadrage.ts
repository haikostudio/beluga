/**
 * LE BLOC DE STRUCTURE DU CADRAGE NE S'AFFICHE JAMAIS EN CLAIR.
 *
 * Un agent de cadrage a pu rendre, en fin de réponse, un bloc de données
 * « ```cadrage { … } ``` ». Le texte affiché le retire toujours, même quand il
 * n'est pas refermé : un tour qui écrit encore ne doit pas montrer du JSON en
 * cours de frappe.
 *
 * Règle PURE : ni base, ni disque, ni moteur. Elle se rejoue seule.
 */

/** Le nom du bloc que l'agent écrit. Une seule orthographe, ici et dans la consigne. */
export const BALISE_STRUCTURE_CADRAGE = 'cadrage';

/* ------------------------------------------------------------------ */
/* Repérer le bloc dans le texte                                       */
/* ------------------------------------------------------------------ */

/** Où commence le bloc de structure, et où il finit. `null` s'il n'y en a pas. */
function repererLeBloc(texte: string): { debut: number; finBalise: number; fin: number; ferme: boolean } | null {
  const lignes = (texte ?? '').split(/\r?\n/);
  let position = 0;
  let debut = -1;
  let finBalise = 0;
  for (let i = 0; i < lignes.length; i += 1) {
    const longueur = lignes[i].length + 1;
    const nu = lignes[i].trim().toLowerCase();
    if (debut < 0) {
      /* UNE SEULE BALISE, ET ELLE EST À NOUS. Accepter ```json ferait
         disparaître de l'écran le premier exemple de code venu, écrit dans une
         réponse ordinaire : le bloc de structure porte son propre nom. */
      if (nu === '```' + BALISE_STRUCTURE_CADRAGE || nu === '~~~' + BALISE_STRUCTURE_CADRAGE) {
        debut = position;
        finBalise = position + longueur;
      }
    } else if (nu === '```' || nu === '~~~') {
      return { debut, finBalise, fin: position + longueur, ferme: true };
    }
    position += longueur;
  }
  if (debut < 0) return null;
  /* UN BLOC NON REFERMÉ EST UN BLOC EN COURS D'ÉCRITURE : il se retire quand
     même du texte affiché, sinon on regarde le modèle taper du JSON. */
  return { debut, finBalise, fin: texte.length, ferme: false };
}

/**
 * Le même texte, SANS son bloc de structure. Il s'applique aussi à un bloc
 * encore ouvert : pendant que le tour écrit, on ne montre pas ses accolades.
 */
export function retirerLaStructureDeCadrage(texte: string): string {
  const repere = repererLeBloc(texte ?? '');
  if (!repere) return (texte ?? '').trim();
  return `${(texte ?? '').slice(0, repere.debut)}\n${(texte ?? '').slice(repere.fin)}`.trim();
}

