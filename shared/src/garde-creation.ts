/**
 * DANS UNE CARTE DE CRÉATION, TOUT SE FABRIQUE PAR L'OUTIL « REALISER » —
 * kie.ai, OpenRouter, et depuis le 11/11/2026 fal.ai et Higgsfield (rallumés à
 * côté de kie.ai) — règle PURE, rejouée par le garde posé devant chaque
 * commande de l'agent (`server/garde-demon.mjs`). « realiser » fait un devis à
 * prix et attend le clic de l'utilisateur : c'est la seule voie. Un appel
 * DIRECT (curl…) à fal.ai, Higgsfield, Replicate, OpenAI Images ou Gemini reste
 * refusé, puisqu'il dépenserait sans devis.
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
  /* MESHY, POUR LA 3D SEULEMENT (01/11/2026) : le personnage 3D passe par « studio » action « modele3d » (devis, clic,
     fabrication par le démon) ; un appel DIRECT de l'agent, qui dépenserait sans devis, est refusé. */
  { motif: /api\.meshy\.ai\/openapi\/v\d+\/(image-to-3d|text-to-3d|multi-image-to-3d|rigging|animations|retexture|remesh)\b/i, nom: 'un appel direct à Meshy (la 3D passe par « studio » action « modele3d »)' },
  { motif: /generativelanguage\.googleapis\.com\/[^\s'"]*(imagen|image|veo)/i, nom: 'Gemini (image ou vidéo)' },
];

export interface VerdictDeCreation {
  refusee: boolean;
  nom?: string;
}

/** Une commande qui fabriquerait un média hors de l'outil « realiser » ? */
export function commandeFabriqueHorsDeKie(commande: string): VerdictDeCreation {
  const c = String(commande ?? '');
  const trouve = FABRIQUES_INTERDITES.find((f) => f.motif.test(c));
  return trouve ? { refusee: true, nom: trouve.nom } : { refusee: false };
}

/** Le texte rendu à l'agent : la règle, et la seule issue. */
export function refusDeCreation(verdict: VerdictDeCreation): string {
  return `Refusé : dans une carte de création, rien ne se fabrique par ${verdict.nom ?? 'ce chemin'}. Toute image, vidéo, voix ou musique passe par l’outil « realiser » (kie.ai, fal.ai, Higgsfield, ou OpenRouter quand sa clé est au coffre — le service se choisit avec l’utilisateur) : « devis » puis « lot » — le bouton « Générer · prix » part dans le fil et le clic de l’utilisateur lance la génération. Un personnage 3D passe par l’outil « studio » action « modele3d » (Meshy, devis puis clic). Ne cherche pas d’autre chemin.`;
}

/** Les compétences jamais servies à l'agent d'une carte de création : elles fabriquent hors de l'outil « realiser ». */
export const COMPETENCES_ECARTEES_D_UNE_CREATION: ReadonlySet<string> = new Set(['images-par-codex-avec-modeles-et-gabarit', 'generer-medias-gemini']);
