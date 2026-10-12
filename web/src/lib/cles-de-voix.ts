/**
 * La clé qui affiche le module vocal flottant. Cachée par défaut (`false`) :
 * au premier chargement, personne n'a encore choisi de le montrer.
 *
 * Elle vit ICI, dans un fichier sans dépendance, parce que d'autres écrans la
 * lisent (la colonne du projet n'affiche « Écouter le point » que si le module
 * est affiché) sans devoir charger le module de voix lui-même — il se télécharge
 * à la demande (DEC-050).
 */
export const CLE_VOIX_VISIBLE = 'voix.visible';
