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
 *
 * DEUX NOMS, UN SEUL SENS — C'EST UN CONTRAT AVEC L'AGENT D'HÔTE DU CENTRAL.
 * L'agent qui monte un serveur Beluga Cloud (`central/src/hote/agent.py` du dépôt
 * belugabuild, `installer_version`) pose `BELUGA_HEBERGE=1` dans
 * `/etc/beluga.env`, et le retire quand le client récupère son installation.
 * Ce démon lisait seulement `BELUGA_OFFRE` : tout serveur Beluga Cloud se
 * déclarait donc « open source » au relais. Les deux noms sont acceptés, aucun
 * ne se retire d'un seul côté.
 */

/** La variable du démon qui déclare la machine « offre hébergée ». */
export const VARIABLE_OFFRE = 'BELUGA_OFFRE';

/** La marque posée par l'agent d'hôte du central sur un serveur Beluga Cloud. */
export const VARIABLE_HEBERGE = 'BELUGA_HEBERGE';

/** Les valeurs qui déclarent l'offre hébergée (insensibles à la casse et aux accents). */
const VALEURS_HEBERGEES = ['hebergee', 'heberge', 'hosted'];

/** Les valeurs « oui » de la marque de l'agent d'hôte. */
const VALEURS_OUI = ['1', 'true', 'oui', 'yes'];

function normaliser(brut: string | undefined | null): string {
  return (brut ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Cette valeur brute d'environnement déclare-t-elle l'offre hébergée ? */
export function estOffreHebergee(brut: string | undefined | null): boolean {
  return VALEURS_HEBERGEES.includes(normaliser(brut));
}

/**
 * Cet environnement déclare-t-il l'offre hébergée, par l'un OU l'autre nom ?
 * `BELUGA_OFFRE=hebergee` (écrit à la main ou par les essais) ou
 * `BELUGA_HEBERGE=1` (posé par l'agent d'hôte du central).
 */
export function estMachineHebergee(env: Record<string, string | undefined>): boolean {
  return estOffreHebergee(env[VARIABLE_OFFRE]) || VALEURS_OUI.includes(normaliser(env[VARIABLE_HEBERGE]));
}
