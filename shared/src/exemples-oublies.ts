/**
 * AUCUN EXEMPLE FABRIQUÉ NE DISPARAÎT DE LA QUESTION (décision du 04/11/2026,
 * capture #f4b2, carte Jb2o).
 *
 * Un agent avait fabriqué quatre images (A à D) par « exemple_de_choix », jugé
 * deux d'entre elles ratées, et reposé sa question avec deux images et deux
 * choix décrits en mots : l'utilisateur voyait quatre images dans le fil et
 * deux cases vides dans la question. L'utilisateur a tranché : CHAQUE pièce du
 * dernier lot devient un choix de la question qui le reprend — l'agent peut la
 * déconseiller dans sa description, jamais la retirer. L'outil « ask_user »
 * refuse donc une question qui reprend une partie du lot et en oublie le reste.
 *
 * Une question qui ne reprend AUCUNE pièce du lot passe (question
 * intermédiaire, piste abandonnée) : le lot attend la suivante. Une question
 * qui le reprend en entier le consomme.
 */

/** Une pièce du dernier lot d'exemples d'un agent. */
export interface PieceDUnLotDExemples {
  /** Identifiant de la pièce jointe. */
  id: string;
  /** Sa lettre de piste (A, B, C, D). */
  lettre: string;
  /** Le titre de sa piste. */
  titre: string;
  /** Sa référence courte (« 3ec7 »), quand elle est connue. */
  alias?: string | null;
}

/** Ce que dit une question sur un lot : il n'est pas concerné, il est repris en entier, ou il en manque. */
export type VerdictDuLot =
  | { etat: 'sans-rapport' }
  | { etat: 'complet' }
  | { etat: 'incomplet'; oublies: PieceDUnLotDExemples[] };

/** Les pièces du lot reprises — ou non — par les options d'une question (champ « image » ou « media »). */
export function verdictDuLot(
  lot: readonly PieceDUnLotDExemples[],
  options: readonly { image?: string | null; media?: string | null }[],
): VerdictDuLot {
  if (!lot.length) return { etat: 'sans-rapport' };
  const reprises = new Set<string>();
  for (const o of options) {
    if (o.image) reprises.add(o.image);
    if (o.media) reprises.add(o.media);
  }
  const oublies = lot.filter((p) => !reprises.has(p.id));
  if (oublies.length === lot.length) return { etat: 'sans-rapport' };
  return oublies.length ? { etat: 'incomplet', oublies } : { etat: 'complet' };
}

/** Le refus rendu à l'agent : ce qui manque, et comment s'en sortir. */
export function refusDExemplesOublies(oublies: readonly PieceDUnLotDExemples[], champ: 'image' | 'media', maxOptions: number): string {
  const lignes = oublies.map((p) => `- ${p.lettre}${p.alias ? ` (#${p.alias.replace(/^#/, '')})` : ''} — ${p.titre} : pièce « ${p.id} »`);
  return [
    `Question refusée : ${oublies.length > 1 ? 'ces exemples fabriqués manquent' : 'cet exemple fabriqué manque'} dans tes options.`,
    ...lignes,
    `Chaque exemple fabriqué devient un choix, avec son identifiant dans « ${champ} » — même un exemple que tu juges raté : dis-le dans sa « description » et recommande une autre piste, mais ne le retire jamais (l'utilisateur l'a vu dans le fil). ` +
      `Les choix sans exemple s'ajoutent à côté (${maxOptions} options au plus). Repose la question.`,
  ].join('\n');
}
