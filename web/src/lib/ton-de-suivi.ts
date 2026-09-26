import type { TonDeSuivi } from '@beluga/shared';

/**
 * LE DESSIN DE CHAQUE TON DE LA FRISE ET DE LA BARRE D'ÉTAPES (`TonDeSuivi`,
 * `shared/src/frise-de-suivi.ts`) — une seule table pour les deux, qui ne
 * peuvent donc plus diverger. Jaune qui SCINTILLE pendant le travail, bleu qui
 * CLIGNOTE quand c'est fini et qu'un geste est attendu, bleu fixe sinon — y
 * compris ce qui est validé (plus de vert : retour au bleu « terminé »).
 */
export const ROND_DU_TON: Record<TonDeSuivi, string> = {
  valide: 'bg-termine',
  fini: 'bg-termine',
  a_voir: 'bg-termine animate-clignote',
  travail: 'bg-travail animate-scintille',
  erreur: 'bg-danger',
  neutre: 'bg-text',
  avenir: 'bg-faint/40',
};

/** Le trait qui MÈNE à un rond : sa couleur, sans le mouvement. Un trait qui porte une information : `--faint`, jamais `--border`. */
export const TRAIT_DU_TON: Record<TonDeSuivi, string> = {
  valide: 'bg-termine/70',
  fini: 'bg-termine/70',
  a_voir: 'bg-termine/70',
  travail: 'bg-travail/70',
  erreur: 'bg-danger/70',
  neutre: 'bg-faint/35',
  avenir: 'bg-faint/35',
};

/** Le halo autour du rond mis en avant. */
export const ANNEAU_DU_TON: Record<TonDeSuivi, string> = {
  valide: 'ring-termine/25',
  fini: 'ring-termine/25',
  a_voir: 'ring-termine/25',
  travail: 'ring-travail/25',
  erreur: 'ring-danger/25',
  neutre: 'ring-faint/25',
  avenir: 'ring-faint/25',
};
