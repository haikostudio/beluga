import type { EtatDuPoint } from '@beluga/shared';

/*
 * LE DESSIN DES FLUX À POINTS, PARTAGÉ.
 *
 * Le fil d'une carte (`flux-en-points.tsx`) et le suivi d'une mise en ligne
 * (`volet-publication.tsx`) se lisent de la même façon : un GRAND ROND par
 * point, une ligne verticale continue centrée sur les ronds, la phrase sous
 * le titre. Les mesures et les teintes vivent donc ici, une seule fois : un
 * pixel changé pour l'un vaut pour l'autre.
 */

/** Les teintes de chaque état, en jetons de thème. */
export const TON_DE_L_ETAT: Record<EtatDuPoint, { rond: string; icone: string; titre: string }> = {
  avenir: { rond: 'border-faint/40', icone: 'text-faint', titre: 'text-faint' },
  encours: { rond: 'border-en-cours bg-en-cours/10', icone: 'text-en-cours', titre: 'text-text' },
  fait: { rond: 'border-termine bg-termine/10', icone: 'text-termine', titre: 'text-text' },
  question: { rond: 'border-warning bg-warning/10', icone: 'text-warning', titre: 'text-text' },
  erreur: { rond: 'border-danger bg-danger/10', icone: 'text-danger', titre: 'text-text' },
};

/**
 * LES MESURES DU FLUX, PLUS SERRÉES SUR TÉLÉPHONE. Le flux compte maintenant
 * un point PAR ITÉRATION : il s'allonge vite, et le grand rond de 40 px avec
 * son décalage de 56 px mangeait la largeur d'un écran de 390 px. Sur
 * téléphone le rond descend à 32 px et le décalage à 44 px ; sur ordinateur,
 * rien ne bouge d'un pixel. La ligne verticale reste centrée sur les ronds.
 */
export const MESURES_DU_FLUX = {
  ordinateur: {
    rond: 'h-10 w-10',
    icone: 'h-5 w-5',
    decalage: 'pl-14',
    ligne: 'left-[19px]',
    sousFlux: 'pl-8',
    petitRond: 'left-[6px]',
    ligneDuSousFlux: 'left-[13.5px]',
    /* LE DEUXIÈME NIVEAU SUR L'AXE DU GRAND ROND. Le contenu d'un point ouvert
       recule de « decalage » (-ml-14 = -pl-14), le texte d'un sous-point
       reprend « decalage » pour démarrer sous le titre du point, et son rond
       de 24 px se centre sur celui de 40 px : 20 − 12 = 8 px. */
    retraitDuContenu: '-ml-14',
    texteDuSousPoint: 'pl-14',
    rondDuSousPoint: 'left-[8px]',
  },
  telephone: {
    rond: 'h-8 w-8',
    icone: 'h-4 w-4',
    decalage: 'pl-11',
    ligne: 'left-[15px]',
    sousFlux: 'pl-7',
    petitRond: 'left-[5px]',
    ligneDuSousFlux: 'left-[12.5px]',
    /* Rond de 32 px : son centre est à 16 px, soit 16 − 12 = 4 px. */
    retraitDuContenu: '-ml-11',
    texteDuSousPoint: 'pl-11',
    rondDuSousPoint: 'left-[4px]',
  },
} as const;

export type MesuresDuFlux = { [K in keyof (typeof MESURES_DU_FLUX)['ordinateur']]: string };
