/**
 * LES ONGLETS DES TABLEAUX DE BORD SUR TÉLÉPHONE (décision de l'utilisateur du 17/11/2026, capture #b0b4) :
 * « Tâches » passe AVANT « À déployer » et « Production », et le dernier onglet touché est retenu.
 *
 * La mémoire est un réglage d'affichage en base (table `preferences`, commune à l'installation, donc partagée entre
 * appareils). Aucun éclair au rechargement : la barre n'existe qu'une fois les droits du compte reçus (`permis`), donc
 * avec les réglages du serveur — inutile de la mettre dans la copie locale (vérifié par le contrôle).
 * Sans préférence, ou avec une valeur inconnue, la page s'ouvre sur « Tâches » : l'ancien choix automatique du
 * premier onglet non vide (16/11/2026) est retiré.
 */
export const ONGLETS_DES_TABLEAUX_DE_BORD = ['taches', 'a-deployer', 'production'] as const;

export type OngletDesTableauxDeBord = (typeof ONGLETS_DES_TABLEAUX_DE_BORD)[number];

/** La clé de la préférence du compte. */
export const PREF_ONGLET_DES_TABLEAUX_DE_BORD = 'tableaux-de-bord.onglet-telephone';

/** L'onglet à montrer, d'après la préférence lue (quelle qu'elle soit). */
export function ongletDesTableauxDeBord(valeur: unknown): OngletDesTableauxDeBord {
  return (ONGLETS_DES_TABLEAUX_DE_BORD as readonly unknown[]).includes(valeur)
    ? (valeur as OngletDesTableauxDeBord)
    : 'taches';
}
