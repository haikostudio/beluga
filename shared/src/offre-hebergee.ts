/**
 * L'OFFRE HÉBERGÉE N'EST PAS UNE INSTALLATION SUR SON PROPRE SERVEUR.
 *
 * Sur son propre serveur, l'administrateur retrouve le projet « Beluga Build » sur
 * son tableau : c'est de là qu'il modifie l'outil. Sur l'offre hébergée, l'outil
 * est commun à tous les abonnés : personne n'en modifie le code, et ce projet
 * n'y paraît jamais.
 *
 * LA MACHINE LE DIT PAR SON ENVIRONNEMENT, comme le super administrateur
 * (`studio-reserve.ts`) : une variable du démon, posée à l'installation de la
 * machine par qui la prépare, relue à chaque appel, qu'aucun écran ne modifie.
 * Absente — le cas de toute installation faite par son propriétaire —, la
 * machine est sur SON PROPRE SERVEUR.
 */

/** La variable du démon qui déclare la machine « offre hébergée ». */
export const VARIABLE_OFFRE = 'BELUGA_OFFRE';

/** Les valeurs qui déclarent l'offre hébergée (insensibles à la casse et aux accents). */
const VALEURS_HEBERGEES = ['hebergee', 'heberge', 'hosted'];

/** Cette valeur brute d'environnement déclare-t-elle l'offre hébergée ? */
export function estOffreHebergee(brut: string | undefined | null): boolean {
  const valeur = (brut ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return VALEURS_HEBERGEES.includes(valeur);
}
