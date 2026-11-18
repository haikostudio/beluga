/**
 * LE SEUL BOUTON DU STUDIO : « METTRE EN PRODUCTION », EN BAS DE LA CONVERSATION
 * (demande du 01/11/2026, capture #e4f3). Le Studio n'a plus d'étapes : l'agent
 * pose ses questions, construit une première version gratuite, puis propose
 * chaque passage au payant par un devis. Le bouton du bas s'allume dès qu'UNE
 * VERSION SE LIT — au moins une piste visuelle visible porte un segment de durée
 * non nulle — et qu'aucune fabrication de la création n'est en cours (un plan,
 * un personnage 3D) : exporter pendant qu'un média arrive livrerait un film
 * sans lui. Éteint, il DIT pourquoi (règle « un bouton éteint dit pourquoi »).
 *
 * La voix finale et les exports ne l'éteignent PAS : leur avancement s'affiche
 * SUR le bouton (MEM-4467), qui rouvre la fenêtre de sortie.
 *
 * Règle PURE : l'écran (`studio.tsx`) l'applique, `server/src/test/
 * studio-production.test.ts` la verrouille.
 */

import { pisteVisuelle, type Composition, type DepenseStudio } from './studio.js';

export interface EtatDuBoutonDeProduction {
  pret: boolean;
  /** La phrase dite quand il est éteint (texte français, traduit à l'écran). */
  raison: string | null;
}

export const RAISON_PREMIERE_VERSION = 'L’agent prépare une première version : le bouton s’allume dès qu’elle se lit.';
export const RAISON_FABRICATION_EN_COURS = 'Une fabrication est en cours : le bouton s’allume dès qu’elle est posée.';
export const RAISON_AGENT_TRAVAILLE = 'L’agent travaille : le bouton s’allume dès qu’il rend la main.';

/** Une version se lit-elle ? Au moins un segment de durée non nulle sur une piste visuelle visible. */
export function uneVersionSeLit(composition: Pick<Composition, 'pistes'> | null | undefined): boolean {
  return !!composition?.pistes.some((p) => pisteVisuelle(p.genre) && !p.masquee && p.segments.some((s) => Number(s.duree) > 0 && !s.masque));
}

/** Les fabrications validées d'un clic et pas encore soldées, hors voix finale (elle a son avancement sur le bouton). */
export function fabricationsEnCours(depenses: readonly Pick<DepenseStudio, 'etat' | 'genre'>[]): number {
  return depenses.filter((d) => d.etat === 'validee' && d.genre !== 'voix').length;
}

export function etatDuBoutonDeProduction(e: {
  composition: Pick<Composition, 'pistes'> | null | undefined;
  depenses: readonly Pick<DepenseStudio, 'etat' | 'genre'>[];
  agentTravaille?: boolean;
}): EtatDuBoutonDeProduction {
  if (!uneVersionSeLit(e.composition)) return { pret: false, raison: RAISON_PREMIERE_VERSION };
  if (fabricationsEnCours(e.depenses) > 0) return { pret: false, raison: RAISON_FABRICATION_EN_COURS };
  if (e.agentTravaille) return { pret: false, raison: RAISON_AGENT_TRAVAILLE };
  return { pret: true, raison: null };
}

/**
 * LA CONSTRUCTION SUIT LE MÉDIA (carte du 12/11/2026, capture #3e3a). La fenêtre « Construction » s'ouvrait toujours
 * sur « Voix finale · étape 1 sur 3 », même pour une vidéo sans aucune voix : on y lisait « Aucune voix : ajoutez un
 * segment Voix » et un choix de voix inutile. Les étapes se déduisent désormais de ce que la composition contient :
 * « voix » seulement quand une piste visible porte au moins un segment de VOIX (un son posé sur la piste des voix n'en
 * est pas un : la voix finale ne fabrique que les segments « voix »), puis « formats » et « fichiers », toujours.
 */
export type EtapeDeConstruction = 'voix' | 'formats' | 'fichiers';

/** La composition porte-t-elle une voix à fabriquer ? Un segment « voix » visible, sur une piste visible. */
export function compositionAUneVoix(composition: Pick<Composition, 'pistes'> | null | undefined): boolean {
  return !!composition?.pistes.some((p) => !p.masquee && p.segments.some((s) => s.genre === 'voix' && !s.masque));
}

/** Les étapes de la fenêtre « Construction », dans l'ordre. */
export function etapesDeConstruction(composition: Pick<Composition, 'pistes'> | null | undefined): EtapeDeConstruction[] {
  return compositionAUneVoix(composition) ? ['voix', 'formats', 'fichiers'] : ['formats', 'fichiers'];
}

/** L'étape où la fenêtre s'ouvre : les fichiers si un export se fabrique, sinon la première étape. */
export function etapeDeDepartDeConstruction(etapes: readonly EtapeDeConstruction[], exportEnFabrication: boolean): EtapeDeConstruction {
  return exportEnFabrication ? 'fichiers' : etapes[0] ?? 'formats';
}
