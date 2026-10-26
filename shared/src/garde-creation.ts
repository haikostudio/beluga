/**
 * DANS UNE CARTE DE CRÉATION, TOUT SE FABRIQUE PAR KIE.AI (décision de
 * l'utilisateur du 26/10/2026) — règle PURE, rejouée par le garde posé devant
 * chaque commande de l'agent (`server/garde-demon.mjs`).
 *
 * Une carte d'image avait été fabriquée par `codex exec` (gratuit, hors de
 * tout devis) : rien n'était passé par le bouton à prix, rien n'était rangé
 * comme média de la carte, la conversation ne montrait pas les essais. Le
 * garde refuse donc, pour l'agent d'une carte caméra SEULEMENT, toute commande
 * qui ferait fabriquer une image, une vidéo ou un son par un autre chemin que
 * l'outil « realiser » : `codex exec`, et les appels directs aux générateurs
 * (OpenAI Images, fal.ai, Higgsfield, Replicate, Gemini en image). Le MOTEUR
 * Codex lui-même n'est jamais visé : la variable n'est posée que pour les
 * agents d'une création de média.
 */

/** La variable d'environnement posée par le démon pour l'agent d'une carte caméra. */
export const VARIABLE_DE_CREATION_DE_MEDIA = 'BELUGA_CREATION_DE_MEDIA';

const FABRIQUES_INTERDITES: readonly { motif: RegExp; nom: string }[] = [
  { motif: /(^|[\s;&|(`$])codex\s+(exec|e)\b/i, nom: 'codex exec' },
  { motif: /api\.openai\.com\/v1\/images/i, nom: 'OpenAI Images' },
  { motif: /\b(queue\.)?fal\.run\//i, nom: 'fal.ai' },
  { motif: /platform\.higgsfield\.ai|api\.higgsfield\.ai/i, nom: 'Higgsfield' },
  { motif: /api\.replicate\.com\/v1\/(predictions|models)/i, nom: 'Replicate' },
  { motif: /generativelanguage\.googleapis\.com\/[^\s'"]*(imagen|image|veo)/i, nom: 'Gemini (image ou vidéo)' },
];

export interface VerdictDeCreation {
  refusee: boolean;
  nom?: string;
}

/** Une commande qui fabriquerait un média hors de kie.ai ? */
export function commandeFabriqueHorsDeKie(commande: string): VerdictDeCreation {
  const c = String(commande ?? '');
  const trouve = FABRIQUES_INTERDITES.find((f) => f.motif.test(c));
  return trouve ? { refusee: true, nom: trouve.nom } : { refusee: false };
}

/** Le texte rendu à l'agent : la règle, et la seule issue. */
export function refusDeCreation(verdict: VerdictDeCreation): string {
  return `Refusé : dans une carte de création, rien ne se fabrique par ${verdict.nom ?? 'ce chemin'}. Toute image, vidéo, voix ou musique passe par l’outil « realiser » (kie.ai) : « devis » puis « lot » — le bouton « Générer · prix » part dans le fil et le clic de l’utilisateur lance la génération. Ne cherche pas d’autre chemin.`;
}

/** Les compétences jamais servies à l'agent d'une carte de création : elles fabriquent hors de kie.ai. */
export const COMPETENCES_ECARTEES_D_UNE_CREATION: ReadonlySet<string> = new Set(['images-par-codex-avec-modeles-et-gabarit', 'generer-medias-gemini']);
