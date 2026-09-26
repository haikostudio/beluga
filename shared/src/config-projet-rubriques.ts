/**
 * LES RUBRIQUES DE LA CONFIGURATION D'UN PROJET.
 *
 * La configuration d'un projet était UNE colonne de 1150 lignes qu'il fallait
 * dérouler de bout en bout : le nom, le moteur, l'apparence, les dossiers, le
 * déploiement, la mise en production, le client, puis l'archivage et la
 * suppression, tout à la suite. On la découpe comme les réglages généraux
 * (`reglages-arborescence.ts`) : un menu de rubriques à gauche, le contenu de
 * la seule rubrique choisie à droite.
 *
 * La liste vit ICI, dans le socle partagé, pour les mêmes trois raisons que
 * l'arborescence des réglages :
 *
 * 1. les titres sont des CLÉS DU DICTIONNAIRE, passées à `t()` au moment de
 *    l'affichage et jamais avant ;
 * 2. la CLÉ d'une rubrique vit dans l'ADRESSE du navigateur
 *    (« #projet/<id>/config/<rubrique> ») et ne se traduit donc jamais ;
 * 3. une structure sans base ni disque se teste seule.
 *
 * L'écran n'ajoute que ce qui ne peut pas vivre ici : l'icône de chaque
 * rubrique et le bloc de réglages qu'elle affiche.
 */

/** Une rubrique de la configuration, telle que le menu la voit. */
export interface RubriqueDeConfig {
  /** La clé : elle vit dans l'adresse et ne se traduit jamais. */
  cle: string;
  /** Le titre, en français : c'est la CLÉ du dictionnaire, pas le texte final. */
  titre: string;
  /** Ce que la rubrique regroupe, en une ligne — clé du dictionnaire aussi. */
  resume: string;
  /**
   * Une rubrique ÉCARTÉE du reste : les gestes irréversibles (archiver,
   * effacer). Elle reste atteignable, mais le menu la pose à part pour qu'on
   * ne tombe pas dessus en parcourant les autres.
   */
  apart?: boolean;
}

/** Le déploiement : la rubrique qu'ouvre le raccourci de la colonne « À déployer ». */
export const RUBRIQUE_DEPLOIEMENT = 'deploiement';

/** La mise en production : celle qu'ouvre le bandeau bas du tableau. */
export const RUBRIQUE_PRODUCTION = 'production';

export const RUBRIQUES_CONFIG_PROJET: readonly RubriqueDeConfig[] = [
  {
    cle: 'general',
    titre: 'L’essentiel',
    resume: 'Le nom du projet et le moteur sur lequel ses cartes partent.',
  },
  {
    cle: 'apparence',
    titre: 'Apparence',
    resume: 'Une ambiance propre à ce projet, ou le réglage général.',
  },
  {
    cle: 'dossiers',
    titre: 'Dossiers et dépôts',
    resume: 'Où le projet vit sur le serveur, ses dépôts, ses copies de travail.',
  },
  {
    cle: RUBRIQUE_DEPLOIEMENT,
    titre: 'Déploiement',
    resume: 'Rafraîchir la version de travail de ce projet, sur ce serveur.',
  },
  {
    cle: RUBRIQUE_PRODUCTION,
    titre: 'Mise en production',
    resume: 'Envoyer le résultat là où le public le voit, souvent ailleurs.',
  },
  {
    cle: 'facturation',
    titre: 'Client et tarif',
    resume: 'Le client facturé, son tarif horaire, le document par défaut.',
  },
  {
    cle: 'retrait',
    titre: 'Mettre de côté',
    resume: 'Retirer ce projet de la colonne de gauche, sans rien perdre.',
    apart: true,
  },
];

/** La première rubrique : celle sur laquelle la fenêtre s'ouvre par défaut. */
export const RUBRIQUE_CONFIG_PAR_DEFAUT = RUBRIQUES_CONFIG_PROJET[0].cle;

/**
 * La rubrique désignée par une clé. Une clé INCONNUE — un vieux lien, une
 * rubrique renommée — retombe sur la première : un écran vide passerait pour
 * une panne, alors que l'adresse est simplement périmée.
 */
export function rubriqueDeConfig(cle: string | undefined | null): RubriqueDeConfig {
  const trouvee = RUBRIQUES_CONFIG_PROJET.find((rubrique) => rubrique.cle === cle);
  return trouvee ?? RUBRIQUES_CONFIG_PROJET[0];
}

/** Cette clé désigne-t-elle une rubrique qui existe vraiment ? */
export function rubriqueConnue(cle: string | undefined | null): boolean {
  return RUBRIQUES_CONFIG_PROJET.some((rubrique) => rubrique.cle === cle);
}
