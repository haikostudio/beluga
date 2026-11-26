/**
 * LA VALIDATION D'UN GESTE IMPORTANT, DANS LE FIL (26/11/2026, capture #6b90).
 *
 * Un agent personnalisé répondait « il te reste deux clics sur “Enregistrer” » : sa consigne lui interdisait de
 * publier ou d'enregistrer quoi que ce soit lui-même, même à la demande. L'utilisateur ne veut plus cliquer à la
 * place de l'agent : l'agent FAIT les gestes. Pour un geste important (publier, enregistrer une donnée publique,
 * envoyer à un client, payer, supprimer), il montre d'abord la donnée telle qu'elle partira — une ou plusieurs
 * captures — et demande « Valider » dans le fil (outil `ask_user`, champ `validation`) ; à « Valider », il le fait
 * lui-même et montre le résultat.
 *
 * Règle pure : la forme de la question (deux issues, captures bornées) et le sens de la réponse.
 */

/** La première issue : l'agent fait le geste lui-même, maintenant. */
export const REPONSE_VALIDER_LE_GESTE = 'Valider';
/** La seconde : rien ne part. */
export const REPONSE_REFUSER_LE_GESTE = 'Refuser';

/** Combien de captures une validation peut montrer (deux onglets, un avant/après…). */
export const MAX_CAPTURES_DE_VALIDATION = 4;

export interface ValidationDeGeste {
  /** Ce que l'agent fera à « Valider », en une phrase (« Cliquer “Enregistrer” dans les deux onglets LinkedIn »). */
  geste: string;
  /** Les identifiants des captures de la donnée, telles qu'elles partiront. */
  captures: string[];
}

/** Les deux issues de l'encart, dans l'ordre que l'écran lit : valider d'abord, refuser ensuite. */
export function optionsDeValidation(): { id: string; label: string; description: string }[] {
  return [
    { id: 'o0', label: REPONSE_VALIDER_LE_GESTE, description: 'L’agent fait ce geste lui-même, maintenant.' },
    { id: 'o1', label: REPONSE_REFUSER_LE_GESTE, description: 'Rien ne part.' },
  ];
}

/**
 * LE CHAMP « validation » D'UN `ask_user`, RELU : la phrase du geste (bornée), les captures d'IMAGE connues
 * (`estUneImage` dit si un identifiant désigne une image jointe), sans doublon, quatre au plus. Rend `null` quand le
 * champ est absent ou sans phrase : la question reste alors une question ordinaire.
 */
export function validationLue(brut: unknown, estUneImage: (id: string) => string | null): ValidationDeGeste | null {
  if (!brut || typeof brut !== 'object') return null;
  const v = brut as { geste?: unknown; captures?: unknown; capture?: unknown };
  const geste = typeof v.geste === 'string' ? v.geste.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!geste) return null;
  const brutes = [v.capture, ...(Array.isArray(v.captures) ? v.captures : [])];
  const captures: string[] = [];
  for (const valeur of brutes) {
    if (typeof valeur !== 'string' || !valeur.trim()) continue;
    const id = estUneImage(valeur.trim());
    if (id && !captures.includes(id)) captures.push(id);
    if (captures.length >= MAX_CAPTURES_DE_VALIDATION) break;
  }
  return { geste, captures };
}

/** La réponse donnée valide-t-elle le geste ? Seule la première issue le fait partir. */
export function validationAccordee(reponse: string | null | undefined, libelleDeValidation = REPONSE_VALIDER_LE_GESTE): boolean {
  return (reponse ?? '').trim().startsWith(libelleDeValidation);
}

/**
 * LA RÈGLE DITE À L'AGENT, dans la description d'`ask_user` et dans la consigne des agents qui agissent pour
 * l'utilisateur : il fait les gestes lui-même ; un geste important passe d'abord par la validation avec capture.
 */
export const REGLE_DE_LA_VALIDATION =
  'TU FAIS LES GESTES TOI-MÊME : ne demande JAMAIS à l’utilisateur de cliquer à ta place (« il te reste deux clics… » est interdit). ' +
  'Un geste IMPORTANT — publier, enregistrer une donnée visible du public (profil, page, fiche), envoyer à un client, payer, supprimer — ' +
  'se VALIDE d’abord : capture la donnée telle qu’elle partira (outil « chrome », geste « capturer », ou une pièce jointe image), ' +
  'puis ask_user avec « validation » : { geste: ce que tu feras, en une phrase ; captures: [identifiants des captures] } — ' +
  'l’écran montre les captures et deux boutons, « Valider » et « Refuser », et ton tour attend. ' +
  'À « Valider », fais le geste TOI-MÊME aussitôt, puis montre le résultat (une capture). À « Refuser », n’y touche pas et demande ce qu’il faut changer. ' +
  'Les gestes ordinaires (ouvrir, lire, remplir un champ, naviguer) se font sans rien demander.';
