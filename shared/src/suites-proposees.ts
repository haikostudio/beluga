/**
 * LES SUITES POSSIBLES D'UNE RÉPONSE — DEUX OU TROIS PASTILLES DÉCRITES.
 *
 * Le compte rendu de fin listait ses « Évolutions possibles » en puces dans le
 * texte. Devenu un message de discussion (`message-court.ts`), il ne les porte
 * plus : l'agent les pose par l'outil « proposer_suites », et l'écran les montre
 * sous la réponse, chacune avec une phrase qui dit ce qu'elle apporterait. Un
 * clic dépose la suite dans la barre d'écriture, comme les idées d'avant.
 *
 * « D'AUTRES IDÉES » NE PASSE PLUS PAR L'AGENT (17/10/2026). Le bouton ne dépose
 * plus de demande dans le champ : le démon fait chercher trois suites NOUVELLES
 * à part, par le même moteur et le même modèle que la carte, sans session ni
 * tour (`server/src/autres-idees.ts`), et les AJOUTE sous les existantes, sur le
 * message ET sur le jalon de la réponse. Ici : la demande envoyée au moteur
 * (`demandeDeSuitesEnPlus`), la lecture tolérante de sa sortie
 * (`lireLesSuitesDuModele`) et la fusion sans doublon, bornée
 * (`ajouterDesSuites`).
 *
 * Règle pure, éprouvée dans `server/src/test/suites-proposees.test.ts`.
 */

export interface SuiteProposee {
  titre: string;
  description: string;
}

export const TITRE_MAX_D_UNE_SUITE = 60;
export const DESCRIPTION_MAX_D_UNE_SUITE = 160;
export const SUITES_MIN = 2;
export const SUITES_MAX = 3;

export type LectureDesSuites = { ok: true; suites: SuiteProposee[] } | { ok: false; raison: string };

/** Relit les arguments de « proposer_suites » : 2 à 3 suites, chacune titrée et décrite, sans doublon. */
export function lireLesSuites(brut: unknown): LectureDesSuites {
  const liste = Array.isArray(brut) ? brut : [];
  const suites: SuiteProposee[] = [];
  const vus = new Set<string>();
  for (const element of liste) {
    const titre = String((element as any)?.titre ?? '').replace(/\s+/g, ' ').trim();
    const description = String((element as any)?.description ?? '').replace(/\s+/g, ' ').trim();
    if (!titre) continue;
    const cle = titre.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    suites.push({ titre, description });
  }
  const trop = suites.filter((s) => s.titre.length > TITRE_MAX_D_UNE_SUITE || s.description.length > DESCRIPTION_MAX_D_UNE_SUITE);
  if (suites.length < SUITES_MIN || suites.length > SUITES_MAX)
    return { ok: false, raison: `Donne entre ${SUITES_MIN} et ${SUITES_MAX} suites distinctes (reçu : ${suites.length}). Rien n'a été enregistré.` };
  if (suites.some((s) => !s.description))
    return { ok: false, raison: 'Chaque suite porte une « description » : une phrase qui dit ce qu’elle apporterait. Rien n’a été enregistré.' };
  if (trop.length)
    return {
      ok: false,
      raison: `Trop long : un « titre » tient en ${TITRE_MAX_D_UNE_SUITE} signes, une « description » en ${DESCRIPTION_MAX_D_UNE_SUITE} (à raccourcir : ${trop.map((s) => `« ${s.titre} »`).join(', ')}). Rien n'a été enregistré.`,
    };
  return { ok: true, suites };
}

/** Combien de suites une recherche « D'autres idées » demande, et le total qu'une réponse peut porter. */
export const SUITES_PAR_RECHERCHE = 3;
export const SUITES_MAX_APRES_AJOUTS = 15;

/** Le titre comme clé de doublon : casse et espaces écartés. */
function cleDUneSuite(titre: string): string {
  return titre.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Coupe un texte trop long au dernier mot qui tient, avec « … ». */
function bornerAuMot(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > max / 2 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * LA DEMANDE ENVOYÉE AU MOTEUR, À PART DE LA CONVERSATION. Elle porte ce qu'il
 * faut pour proposer des suites pertinentes — la carte, la réponse, les suites
 * déjà montrées à ne pas redonner — et exige une sortie JSON stricte.
 */
export function demandeDeSuitesEnPlus(entree: {
  titreDeLaCarte?: string;
  descriptionDeLaCarte?: string;
  reponse: string;
  dejaVues: readonly SuiteProposee[];
  nombre?: number;
}): string {
  const nombre = entree.nombre ?? SUITES_PAR_RECHERCHE;
  const lignes = [
    `Tu proposes ${nombre} suites possibles à la réponse d'un agent, que l'utilisateur pourra cocher pour les lui envoyer.`,
    'Chaque suite : un « titre » de quelques mots, formulé comme une demande actionnable qu’on pourrait envoyer à l’agent,',
    `et une « description » d'une phrase qui dit ce qu'elle apporterait. Titre : ${TITRE_MAX_D_UNE_SUITE} signes au plus. Description : ${DESCRIPTION_MAX_D_UNE_SUITE} signes au plus.`,
    'Écris dans la langue de la réponse, en mots courants. N’utilise aucun outil, ne lis aucun fichier.',
  ];
  if (entree.titreDeLaCarte?.trim()) lignes.push('', `Sujet de la carte : ${entree.titreDeLaCarte.trim()}`);
  if (entree.descriptionDeLaCarte?.trim()) lignes.push(`Description de la carte : ${bornerAuMot(entree.descriptionDeLaCarte.trim(), 1500)}`);
  lignes.push('', 'Réponse de l’agent :', bornerAuMot(entree.reponse.trim() || '(vide)', 4000));
  if (entree.dejaVues.length) {
    lignes.push('', 'Suites déjà proposées, à NE PAS redonner ni reformuler :');
    for (const s of entree.dejaVues) lignes.push(`- ${s.titre}`);
    lignes.push(`Propose ${nombre} suites NOUVELLES, vraiment différentes de celles-là.`);
  }
  lignes.push('', 'Réponds UNIQUEMENT par un tableau JSON, sans texte autour : [{"titre": "…", "description": "…"}]');
  return lignes.join('\n');
}

/**
 * RELIT LA SORTIE DU MOTEUR, AVEC TOLÉRANCE : un tableau JSON, éventuellement
 * entouré de texte ou d'une clôture ```. Les suites sans titre ou sans
 * description sont écartées, les trop longues coupées au mot, les doublons
 * retirés. Rend une liste, vide si rien n'est lisible — jamais une exception.
 */
export function lireLesSuitesDuModele(texte: string): SuiteProposee[] {
  const debut = texte.indexOf('[');
  const fin = texte.lastIndexOf(']');
  if (debut < 0 || fin <= debut) return [];
  let brut: unknown;
  try {
    brut = JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(brut)) return [];
  const suites: SuiteProposee[] = [];
  const vus = new Set<string>();
  for (const element of brut) {
    const titre = String((element as any)?.titre ?? '').replace(/\s+/g, ' ').trim();
    const description = String((element as any)?.description ?? '').replace(/\s+/g, ' ').trim();
    if (!titre || !description) continue;
    const cle = cleDUneSuite(titre);
    if (vus.has(cle)) continue;
    vus.add(cle);
    suites.push({ titre: bornerAuMot(titre, TITRE_MAX_D_UNE_SUITE), description: bornerAuMot(description, DESCRIPTION_MAX_D_UNE_SUITE) });
  }
  return suites;
}

/**
 * AJOUTE DES SUITES SOUS LES EXISTANTES : celles-ci gardent leur place et leur
 * ordre, un titre déjà présent (casse écartée) n'est pas redonné, et le total
 * reste sous `max`. Rend la liste entière et ce qui a réellement été ajouté.
 */
export function ajouterDesSuites(
  existantes: readonly SuiteProposee[],
  nouvelles: readonly SuiteProposee[],
  max: number = SUITES_MAX_APRES_AJOUTS,
): { suites: SuiteProposee[]; ajoutees: SuiteProposee[] } {
  const suites = [...existantes];
  const vus = new Set(existantes.map((s) => cleDUneSuite(s.titre)));
  const ajoutees: SuiteProposee[] = [];
  for (const suite of nouvelles) {
    if (suites.length >= max) break;
    const cle = cleDUneSuite(suite.titre);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    suites.push(suite);
    ajoutees.push(suite);
  }
  return { suites, ajoutees };
}
