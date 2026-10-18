/**
 * LE CAHIER DES CHARGES VIVANT D'UNE CARTE (décision du 17/10/2026).
 *
 * Le cahier n'apparaissait qu'avec le plan, réécrit en entier à chaque version
 * — un long document d'un coup, après coup. Il se REMPLIT désormais au fil des
 * réponses : chaque compréhension rendue (`rendre_comprehension`) peut porter
 * les rubriques que ses échanges ont touchées, et le démon les FUSIONNE dans le
 * cahier de la carte (`ComprehensionDeCarte.cahierDesCharges`) — une rubrique
 * de même titre remplace l'ancienne, les autres restent. Le plan compact le
 * reprend tel quel quand il ne redonne pas le sien (`lirePlanRendu`).
 *
 * Règle pure, éprouvée dans `server/src/test/cahier-vivant.test.ts`.
 */

export interface RubriqueDuCahier {
  titre: string;
  contenu: string;
}

/** Relit une liste de rubriques venue d'un outil : titre et contenu non vides, sans doublon de titre. */
export function lireLesRubriques(brut: unknown): RubriqueDuCahier[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const rubriques: RubriqueDuCahier[] = [];
  for (const element of brut) {
    const titre = String((element as any)?.titre ?? '').replace(/\s+/g, ' ').trim();
    const contenu = String((element as any)?.contenu ?? '').trim();
    if (!titre || !contenu) continue;
    const cle = cleDeRubrique(titre);
    if (vus.has(cle)) continue;
    vus.add(cle);
    rubriques.push({ titre, contenu });
  }
  return rubriques;
}

/** Deux titres qui ne diffèrent que par la casse, les accents ou la ponctuation sont la même rubrique. */
function cleDeRubrique(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * LA FUSION : l'ordre de l'ancien cahier est gardé, une rubrique reprise y
 * prend sa nouvelle place de contenu, une rubrique neuve s'ajoute à la fin.
 */
export function fusionnerLeCahier(
  ancien: readonly RubriqueDuCahier[] | undefined,
  nouveau: readonly RubriqueDuCahier[] | undefined,
): RubriqueDuCahier[] {
  const resultat = (ancien ?? []).map((r) => ({ ...r }));
  for (const rubrique of nouveau ?? []) {
    const cle = cleDeRubrique(rubrique.titre);
    const index = resultat.findIndex((r) => cleDeRubrique(r.titre) === cle);
    if (index >= 0) resultat[index] = { titre: rubrique.titre, contenu: rubrique.contenu };
    else resultat.push({ titre: rubrique.titre, contenu: rubrique.contenu });
  }
  return resultat;
}

/** Le cahier en texte, tel qu'il est redonné au cadrage suivant. */
export function cahierEnTexte(cahier: readonly RubriqueDuCahier[] | undefined): string {
  if (!cahier?.length) return '';
  return cahier.map((r) => `### ${r.titre}\n${r.contenu}`).join('\n\n');
}

/** La phrase commune aux consignes : ce que le cadrage fait du cahier vivant. */
export const CONSIGNE_DU_CAHIER_VIVANT =
  "« cahierDesCharges » (facultatif) : LE CAHIER DES CHARGES VIVANT de la carte. N'y mets QUE les rubriques que les derniers échanges ont créées ou changées, chacune avec un « titre » et son « contenu » ENTIER, en mots courants : une rubrique de même titre remplace l'ancienne, les autres restent telles quelles. Rubriques usuelles, dans cet ordre : « Contexte et objectifs », « Pour qui », « Périmètre » (compris ET exclu), « Fonctionnalités attendues », « Règles et contraintes », « Critères de réussite ». Chaque réponse de l'utilisateur y est reportée là où elle compte ; une précision qui ne change rien n'appelle aucune rubrique.";

/**
 * LE CAHIER SORTI DU TEXTE D'UN PLAN, pour que l'écran le replie : le bloc
 * « ## Cahier des charges » jusqu'au titre de niveau 2 suivant, découpé en
 * rubriques « ### ». Un plan sans ce bloc rend son texte tel quel.
 */
export function detacherLeCahier(texte: string): { reste: string; rubriques: RubriqueDuCahier[] } {
  const lignes = (texte ?? '').split('\n');
  const debut = lignes.findIndex((ligne) => /^##\s+cahier des charges\s*$/i.test(ligne.trim()));
  if (debut < 0) return { reste: texte, rubriques: [] };
  let fin = lignes.findIndex((ligne, index) => index > debut && /^#{1,2}\s/.test(ligne) && !/^###/.test(ligne));
  if (fin < 0) fin = lignes.length;
  const rubriques: RubriqueDuCahier[] = [];
  let courante: RubriqueDuCahier | null = null;
  for (const ligne of lignes.slice(debut + 1, fin)) {
    const titre = ligne.match(/^###\s+(.+?)\s*$/);
    if (titre) {
      courante = { titre: titre[1]!, contenu: '' };
      rubriques.push(courante);
    } else if (courante) courante.contenu += `${courante.contenu ? '\n' : ''}${ligne}`;
  }
  const propres = rubriques.map((r) => ({ titre: r.titre, contenu: r.contenu.trim() })).filter((r) => r.contenu);
  const reste = [...lignes.slice(0, debut), ...lignes.slice(fin)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { reste, rubriques: propres };
}
