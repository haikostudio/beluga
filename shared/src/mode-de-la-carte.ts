/**
 * LE MODE D'UNE CARTE SE CHOISIT PAR L'AGENT (décision de l'utilisateur du 12/11/2026, carte « Communication et
 * Studio : série de retouches », DEC-513). Au premier tour, l'agent de cadrage juge ce que la demande appelle et POSE
 * le mode lui-même (`board_update_card`, champ « mode ») dès qu'il en est raisonnablement sûr (~70-80 %), en
 * l'annonçant en une ligne ; il ne pose une question « ask_user » que dans le VRAI doute. Défaut : aucun mode (cadrage
 * simple) ; gros chantier → Plan ; média à fabriquer → Studio avec son type. Le champ ne montre qu'une ÉTIQUETTE d'un
 * mot, avec son info-bulle — informative, non cliquable.
 *
 * LE MODE « CRÉATION » (plusieurs modèles + juge) EST RETIRÉ : trop proche du Studio. Une carte ancienne qui porte
 * encore `parcours.creationSouhaitee` n'affiche plus d'étiquette et suit le chemin ordinaire.
 */
import { CHOIX_DE_DEPART, DESCRIPTIONS_TYPES_DE_MEDIA_DE_REALISATION, LIBELLES_TYPES_DE_MEDIA_DE_REALISATION, TYPES_DE_MEDIA_DE_REALISATION, type TypeDeMediaDeRealisation } from './mode-realisation.js';

export const MODES_DE_LA_CARTE = ['plan', 'studio', 'aucun'] as const;
export type ModeDeLaCarte = (typeof MODES_DE_LA_CARTE)[number];

export function estModeDeLaCarte(v: unknown): v is ModeDeLaCarte {
  return typeof v === 'string' && (MODES_DE_LA_CARTE as readonly string[]).includes(v);
}

export function estTypeDeMedia(v: unknown): v is TypeDeMediaDeRealisation {
  return typeof v === 'string' && (TYPES_DE_MEDIA_DE_REALISATION as readonly string[]).includes(v);
}

/** Ce que l'étiquette lit sur la carte. */
export interface EtatDuModeLu {
  parcours?: { planSouhaite?: boolean; realisationSouhaitee?: boolean } | null;
  realisation?: { medias?: readonly string[] } | null;
}

/**
 * L'ÉTIQUETTE DU MODE : un mot, et la phrase de son info-bulle. Studio passe avant Plan (une création de média n'a
 * ni cahier ni plan) ; aucun mode : `null`, rien ne s'affiche.
 */
export function etiquetteDuMode(
  carte: EtatDuModeLu,
): { mode: Exclude<ModeDeLaCarte, 'aucun'>; mot: string; detail: string; media?: string } | null {
  const p = carte.parcours;
  if (p?.realisationSouhaitee) {
    const media = carte.realisation?.medias?.find(estTypeDeMedia);
    /* Le DÉTAIL est un texte du dictionnaire, à trou : l'écran le traduit puis y pose le type, traduit lui aussi. */
    return media
      ? { mode: 'studio', mot: 'Studio', detail: DETAIL_STUDIO_AVEC_TYPE, media: LIBELLES_TYPES_DE_MEDIA_DE_REALISATION[media] }
      : { mode: 'studio', mot: 'Studio', detail: DETAIL_STUDIO };
  }
  if (p?.planSouhaite) return { mode: 'plan', mot: 'Plan', detail: DETAIL_PLAN };
  return null;
}

const DETAIL_STUDIO_AVEC_TYPE = 'Mode Studio — {media} : l’agent réalise ce média dans le Studio, version gratuite d’abord ; chaque génération payante attend votre clic.';
const DETAIL_STUDIO = 'Mode Studio : l’agent réalise un média dans le Studio, version gratuite d’abord ; chaque génération payante attend votre clic.';
const DETAIL_PLAN = 'Mode Plan : le cadrage rend un cahier des charges et un plan complet avec sa compréhension, à relire avant de lancer.';

/**
 * LE CHOIX DU MODE, joint au PREMIER tour de cadrage d'une carte qui n'a ni mode ni compréhension. L'agent CHOISIT
 * lui-même ; la question n'est qu'un recours dans le vrai doute. `complexe` : le juge de complexité
 * (`demande-complexe.ts`) penche pour le plan — un indice, jamais un interrupteur allumé d'office.
 */
export function consigneDeLaQuestionDeMode(complexe?: { raisons: readonly string[] } | null): string {
  return [
    'LE MODE DE CETTE CARTE, C’EST TOI QUI LE CHOISIS (il n’y a pas de boutons de mode dans le champ d’écriture, et l’utilisateur ne veut PAS qu’on le lui demande à chaque carte).',
    'Après ta lecture de la mémoire et AVANT ta compréhension, juge ce que la demande appelle :',
    '- par DÉFAUT, aucun mode : un cadrage simple, question-réponse ;',
    '- « plan » : un GROS travail — demande longue, à plusieurs volets ou structurante — qui mérite un cahier des charges et un plan complet ;',
    `- « studio » : un MÉDIA à fabriquer, avec son type (« media ») parmi : ${CHOIX_DE_DEPART.map((m) => `${LIBELLES_TYPES_DE_MEDIA_DE_REALISATION[m]} = ${DESCRIPTIONS_TYPES_DE_MEDIA_DE_REALISATION[m]}`).join(' ; ')}.`,
    'Sûr à 70-80 % : pose-le TOI-MÊME par « board_update_card » avec « mode » (plan | studio | aucun) et, pour studio, « media », puis annonce-le en UNE ligne dans ta réponse (« Je prends le mode Plan : … »). Aucune question.',
    'Seulement dans le VRAI doute (deux modes également plausibles et le choix change le résultat) : une question « ask_user », ton mode recommandé en premier.',
    complexe?.raisons.length ? `INDICE : la demande est jugée complexe (${complexe.raisons.join(', ')}) — le Plan est probable, sauf si c’est un média à réaliser.` : '',
    'La consigne du mode posé te revient dans la réponse de l’outil : suis-la dans CE MÊME tour. Un message qui n’est qu’une question se répond sans choisir de mode.',
  ]
    .filter(Boolean)
    .join('\n');
}
