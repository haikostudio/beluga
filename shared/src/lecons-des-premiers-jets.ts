/**
 * LES LEÇONS DES PREMIERS JETS — règles pures du passage de nuit (carte « Parcours peu fluide et one-shots modèles »,
 * 26/11/2026). Côté démon : `server/src/lecons-des-premiers-jets.ts`.
 *
 * Décision de l'utilisateur : ce qu'il a dû faire REPRENDRE après un premier jet (une vitrine faite d'un seul jet, la
 * première version d'une application) devient une consigne COMMUNE pour les prochains projets — la vitrine iMiel en
 * premier (premier jet 1b3f35f9, refonte 47b098da), puis tous les projets. Chaque nuit, AUTOMATIQUEMENT et sans
 * validation, un agent d'analyse relit les cartes de reprise des dernières vingt-quatre heures et complète la
 * compétence commune `lecons-des-premiers-jets` par la porte d'écriture du pool ; le matin, une carte de RÉSUMÉ, visible
 * dans Beluga Build, dit ce qui a été appris et de quel projet ; on retire une leçon en écrivant à cette carte.
 *
 * Ce module ne lit ni base ni disque : il reconnaît une carte de reprise, écrit la consigne de l'agent, lit son bilan
 * et rédige la carte du matin.
 */

/** La compétence commune qui porte les leçons (écrite par la porte du pool, jamais à la main par la routine). */
export const COMPETENCE_DES_LECONS = 'lecons-des-premiers-jets';
/** La compétence commune des vitrines faites d'un seul jet : exigences, modèles en images, contrôle. */
export const COMPETENCE_DE_LA_VITRINE = 'vitrine-de-produit-d-un-seul-jet';
/** L'étiquette de la carte du matin. */
export const LABEL_LECONS_DES_PREMIERS_JETS = 'leçons des premiers jets';
export const TITRE_DU_PASSAGE_DES_LECONS = 'Leçons des premiers jets : relecture de la nuit';
export const DESCRIPTION_DU_PASSAGE_DES_LECONS =
  'Relit les reprises demandées après un premier jet, sur tous les projets, et complète les consignes communes des prochains projets.';

/** L'heure : après le ménage des compétences (5 h), avant le réveil. */
export const HEURE_DES_LECONS = 6;
export const FENETRE_DES_LECONS_HEURES = 3;
/** Au plus tant de cartes nommées dans la consigne : au-delà, les plus récentes. */
export const REPRISES_NOMMEES_MAX = 30;
const EXTRAIT_MAX = 700;

/** Une carte, réduite à ce qui permet de reconnaître une reprise. */
export interface CarteRelue {
  id: string;
  projet: string;
  titre: string;
  /** La demande (description) puis ce que le cadrage a compris, à plat. */
  texte: string;
  creeeLe: number;
}

/** Une reprise retenue pour la consigne de la nuit. */
export interface Reprise {
  id: string;
  projet: string;
  titre: string;
  extrait: string;
  creeeLe: number;
}

/**
 * CE QUI DIT « REPRENDRE CE QUI A ÉTÉ LIVRÉ ». Comparé sans accents ni majuscules. Une demande de fonctionnalité neuve
 * n'en porte aucun ; une retouche en porte presque toujours un (« refonte », « toujours pas », « sur téléphone »…).
 */
const MOTS_DE_REPRISE = [
  'refonte',
  'refaire',
  'refais',
  'corrige',
  'corriger',
  'corrections',
  'retouche',
  'fidele',
  'ne ressemble pas',
  'toujours pas',
  'pas du tout',
  'pas concluant',
  'reprendre',
  'finition',
  'aerer',
  'trop serre',
  'trop petit',
  'trop grand',
  'trop charge',
  'version telephone',
  'sur telephone',
  'sur mobile',
  'theme sombre',
  'mode sombre',
  'deborde',
  'illisible',
  'generique',
  'amateur',
  'premier jet',
  'one shot',
  'one-shot',
  'oneshot',
];

function sansAccents(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Le texte parle-t-il de reprendre un travail livré ? */
export function parleDeReprise(texte: string): boolean {
  const propre = sansAccents(texte).replace(/\s+/g, ' ');
  return MOTS_DE_REPRISE.some((mot) => propre.includes(mot));
}

/**
 * UNE CARTE DE REPRISE : elle parle de reprendre, ET son projet avait déjà une carte AVANT elle — la toute première
 * carte d'un projet est le premier jet lui-même, jamais sa reprise.
 */
export function estUneReprise(carte: CarteRelue, duProjet: readonly CarteRelue[]): boolean {
  if (!parleDeReprise(`${carte.titre}\n${carte.texte}`)) return false;
  return duProjet.some((autre) => autre.id !== carte.id && autre.creeeLe < carte.creeeLe);
}

/**
 * LES REPRISES À RELIRE CETTE NUIT : nées depuis `depuis`, hors projets exclus (Beluga Build lui-même : son travail
 * n'est pas un premier jet), les plus récentes d'abord, au plus `REPRISES_NOMMEES_MAX`.
 */
export function reprisesDepuis(cartes: readonly CarteRelue[], depuis: number, exclus: readonly string[] = []): Reprise[] {
  const parProjet = new Map<string, CarteRelue[]>();
  for (const c of cartes) parProjet.set(c.projet, [...(parProjet.get(c.projet) ?? []), c]);
  const ecartes = new Set(exclus.map((n) => n.toLowerCase()));
  return cartes
    .filter((c) => c.creeeLe >= depuis && !ecartes.has(c.projet.toLowerCase()))
    .filter((c) => estUneReprise(c, parProjet.get(c.projet) ?? []))
    .sort((a, b) => b.creeeLe - a.creeeLe)
    .slice(0, REPRISES_NOMMEES_MAX)
    .map((c) => ({ id: c.id, projet: c.projet, titre: c.titre, extrait: extrait(c.texte), creeeLe: c.creeeLe }));
}

function extrait(texte: string): string {
  const plat = texte.replace(/\s+/g, ' ').trim();
  return plat.length > EXTRAIT_MAX ? `${plat.slice(0, EXTRAIT_MAX - 1)}…` : plat;
}

/**
 * LA CONSIGNE DE L'AGENT D'ANALYSE. Il n'écrit QUE par l'outil « competences » (porte de qualité du pool) : la
 * compétence des leçons d'abord, celle de la vitrine si la leçon touche une vitrine. Il finit par un bloc json que la
 * routine lit pour la carte du matin.
 */
export function consigneDesLecons(entree: { reprises: readonly Reprise[] }): string {
  const liste = entree.reprises
    .map((r) => `- [${r.id.slice(0, 8)}] ${r.projet} — « ${r.titre} » : ${r.extrait}`)
    .join('\n');
  return `LEÇONS DES PREMIERS JETS — PASSAGE DE NUIT.

Tu es un agent d'ANALYSE : tu ne modifies aucun code. Ta seule écriture passe par l'outil « competences ».

Ces cartes, nées depuis le dernier passage, REPRENNENT un travail déjà livré (premier jet d'une vitrine ou d'une application, puis retouches demandées par l'utilisateur) :
${liste}

Ce que tu fais :
1. Ouvre la compétence commune « ${COMPETENCE_DES_LECONS} » (outil « competences », action « ouvrir ») et lis ses leçons numérotées. Ouvre aussi « ${COMPETENCE_DE_LA_VITRINE} » si une reprise touche une vitrine.
2. Pour chaque reprise, demande-toi ce qu'un premier jet aurait dû faire pour qu'elle n'ait pas lieu. Ne retiens que les leçons de QUALITÉ D'UN PREMIER JET (mise en page, aération, téléphone, thème sombre, éléments natifs, exemples inventés, fidélité aux références, animations, textes, états vides, langues…), jamais une fonctionnalité métier propre à un projet.
3. Une leçon déjà présente : RENFORCE-la (ajoute le projet et la carte en preuve), ne la recopie pas. Une leçon NOUVELLE n'entre que si elle vaut pour AU MOINS DEUX PROJETS (preuves comprises) ou si le défaut est GRAVE (une page cassée, illisible ou trompeuse) ; sinon, elle reste dans la fiche propre de son projet.
4. Réécris la compétence ENTIÈRE avec « ecrire » (relue, puis redonnée en entier, sections gardées) : numéros stables (L01, L02…, une nouvelle prend le numéro suivant), une règle impérative par leçon, son pourquoi, ses projets et cartes en preuve, et « mesurable : … » quand un navigateur peut la vérifier. Même chose pour la compétence de la vitrine si une exigence de vitrine change.
5. Rien de nouveau : n'écris rien.

Termine ta réponse par un bloc json, et rien après :
\`\`\`json
{"lecons": [{"id": "L19", "titre": "la règle en quelques mots", "projets": ["projetc", "ProjetB"], "nouvelle": true}]}
\`\`\`
« nouvelle » : vrai pour une leçon ajoutée, faux pour une leçon renforcée. Aucune leçon : {"lecons": []}.`;
}

/** Une leçon ajoutée ou renforcée cette nuit, telle que l'agent l'annonce. */
export interface LeconDeLaNuit {
  id: string;
  titre: string;
  projets: string[];
  nouvelle: boolean;
}

/** Lit le dernier bloc json de la réponse de l'agent ; une réponse illisible ne rend rien (jamais d'exception). */
export function lireLeBilanDesLecons(reponse: string | null | undefined): LeconDeLaNuit[] {
  if (!reponse) return [];
  const blocs = [...reponse.matchAll(/```json\s*([\s\S]*?)```/g)];
  const brut = blocs.length ? blocs[blocs.length - 1]![1]! : reponse.slice(reponse.lastIndexOf('{"lecons"'));
  let lu: unknown;
  try {
    lu = JSON.parse(brut.trim());
  } catch {
    return [];
  }
  const lecons = (lu as { lecons?: unknown })?.lecons;
  if (!Array.isArray(lecons)) return [];
  return lecons
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .map((l) => ({
      id: String(l.id ?? '').trim().slice(0, 12),
      titre: String(l.titre ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      projets: Array.isArray(l.projets) ? l.projets.map((p) => String(p).trim()).filter(Boolean).slice(0, 8) : [],
      nouvelle: l.nouvelle !== false,
    }))
    .filter((l) => l.id && l.titre);
}

/** Le titre de la carte du matin. */
export function titreDuResumeDesLecons(lecons: readonly LeconDeLaNuit[]): string {
  const nouvelles = lecons.filter((l) => l.nouvelle).length;
  const renforcees = lecons.length - nouvelles;
  const morceaux = [
    nouvelles ? `${nouvelles} leçon${nouvelles > 1 ? 's' : ''} apprise${nouvelles > 1 ? 's' : ''}` : '',
    renforcees ? `${renforcees} renforcée${renforcees > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return `Premiers jets : ${morceaux.join(', ')} cette nuit`;
}

/**
 * LA CARTE DU MATIN : ce qui a été appris, de quel projet, et comment retirer une leçon — en écrivant à cette carte,
 * dont l'agent de cadrage retire la ligne de la compétence.
 */
export function descriptionDuResumeDesLecons(lecons: readonly LeconDeLaNuit[]): string {
  const ligne = (l: LeconDeLaNuit) => `- ${l.id} — ${l.titre}${l.projets.length ? ` (vu sur ${l.projets.join(', ')})` : ''}`;
  const nouvelles = lecons.filter((l) => l.nouvelle);
  const renforcees = lecons.filter((l) => !l.nouvelle);
  const parties = [
    'Cette nuit, Beluga a relu les retouches demandées après un premier jet, et les prochains projets en tiendront compte dès leur premier essai.',
    nouvelles.length ? `Nouvelles consignes :\n${nouvelles.map(ligne).join('\n')}` : '',
    renforcees.length ? `Consignes confirmées par un nouveau projet :\n${renforcees.map(ligne).join('\n')}` : '',
    `Une leçon ne vaut que pour un seul projet ? Écrivez à cette carte, par exemple « retire ${lecons[0]?.id ?? 'L19'} » : elle sortira de la compétence « ${COMPETENCE_DES_LECONS} ».`,
  ].filter(Boolean);
  return parties.join('\n\n');
}

/**
 * REMISES D'OFFICE (carte « Parcours peu fluide et one-shots modèles ») : une carte qui construit une VITRINE reçoit
 * toujours « vitrine-de-produit-d-un-seul-jet » et les leçons ; une carte de PREMIER JET (construction d'un projet
 * neuf, « one-shot », application complète) reçoit les leçons — en tête de ses compétences proches, quel que soit le
 * classement par le sens.
 */
const MOTS_DE_VITRINE = ['vitrine', 'landing', 'page d accueil', 'site de presentation', 'page de presentation', 'site public'];
const MOTS_DE_PREMIER_JET = ['premier jet', 'one shot', 'one-shot', 'oneshot', 'construction de « ', 'construction de "', 'application complete', 'nouvelle application', 'cahier des charges'];

export function competencesImposeesAuTravail(travail: string): string[] {
  // Les apostrophes (droites ou typographiques) deviennent des espaces : « page d’accueil » = « page d accueil ».
  const propre = sansAccents(travail).replace(/['’]/g, ' ').replace(/\s+/g, ' ');
  if (MOTS_DE_VITRINE.some((mot) => propre.includes(mot))) return [COMPETENCE_DE_LA_VITRINE, COMPETENCE_DES_LECONS];
  if (MOTS_DE_PREMIER_JET.some((mot) => propre.includes(mot))) return [COMPETENCE_DES_LECONS];
  return [];
}

/** Les compétences proches d'une carte, les remises d'office en tête (sans doublon). */
export function avecLesCompetencesImposees(proches: readonly string[], travail: string): string[] {
  const imposees = competencesImposeesAuTravail(travail);
  return [...imposees, ...proches.filter((nom) => !imposees.includes(nom))];
}
