/**
 * LES COMPÉTENCES PROPOSÉES PAR BELUGA AU CADRAGE — les règles, sans base ni
 * disque.
 *
 * LE CONSTAT (05/10/2026, sept jours mesurés) : les agents écrivent des
 * compétences à chaque carte et ne les relisent presque jamais — 102 des 121
 * fiches servies au projet jamais ouvertes, 4 cadrages sur 300 qui en ont
 * proposé une. Deux causes : le briefing n'annonce que des NOMS, et la
 * proposition dépendait de la bonne volonté de l'agent.
 *
 * LA DÉCISION : ce n'est plus l'agent qui propose, c'est le DÉMON. À la
 * recherche de mémoire qu'un cadrage fait de toute façon à chaque tour, il
 * cherche les compétences qui parlent de la demande (la même recherche par le
 * sens que la mémoire), en garde TROIS AU PLUS, et pose pour chacune un encadré
 * violet dans le fil : un titre, ce qui correspond au besoin, « Utiliser » ou
 * « Pas utile ». L'appel d'outil ne rend la main qu'une fois TOUS les encadrés
 * tranchés — le même arrêt structurel que `ask_user`
 * (`shared/src/attente-question.ts`). Seules les compétences validées partent
 * avec l'agent d'exécution, et EN ENTIER : le texte de leur mode d'emploi, plus
 * seulement leur nom.
 *
 * Le va-et-vient (recherche, attente, écriture sur la carte) vit dans
 * `server/src/proposition-competences.ts` ; l'encadré dans
 * `web/src/components/encadre-competence.tsx`.
 */

import { z } from 'zod';

/** Au plus trois encadrés posés par une recherche : au-delà, on clique « Pas utile » par réflexe. */
export const PROPOSITIONS_PAR_RECHERCHE_MAX = 3;
/** Au plus six sur la vie d'une carte : une demande qui change de sujet peut en appeler d'autres. */
export const PROPOSITIONS_PAR_CARTE_MAX = 6;
/**
 * COMMENT SAVOIR QU'UNE COMPÉTENCE CORRESPOND, SANS MODÈLE POUR LE DIRE.
 *
 * Mesuré le 05/10/2026 sur dix demandes réelles et les ~150 fiches du pool :
 *  - le score pondéré de la recherche mêlée est un CLASSEMENT : la première
 *    vaut toujours ~0,80, qu'elle réponde à la demande ou non ;
 *  - le cosinus brut ne sépare pas non plus : 0,85 à 0,87 pour une fiche qui
 *    tombe pile, 0,85 à 0,87 aussi pour la moins mauvaise d'une demande qui
 *    n'en appelle aucune ;
 *  - le juge local de pertinence est éteint par défaut.
 * Ce qui sépare, c'est la SAILLANCE : une fiche qui correspond se DÉTACHE de la
 * foule des autres (0,014 à 0,025 au-dessus de la suivante), alors que sur une
 * demande sans compétence les premières se suivent à 0,001–0,009. On propose
 * donc ce qui précède une vraie marche dans les trois premières places — et
 * rien quand il n'y a pas de marche.
 */
export const ECART_DE_SAILLANCE = 0.012;
/**
 * …et les deux recherches doivent être D'ACCORD : une fiche saillante par le
 * sens doit aussi figurer parmi les premières compétences de la recherche
 * mêlée (mots + sens). Un seul signal ne suffit pas à déranger l'utilisateur.
 */
export const RANG_MELE_MAX = 5;
/** Sous ce nombre de fiches comparées, « se détacher de la foule » ne veut rien dire. */
export const FOULE_MINIMALE = 8;

export const REPONSE_UTILISER = 'Utiliser';
export const REPONSE_PAS_UTILE = 'Pas utile';

export const ETATS_DE_PROPOSITION = ['proposee', 'utilisee', 'ecartee'] as const;
export type EtatDeProposition = (typeof ETATS_DE_PROPOSITION)[number];

/** Ce que la carte garde d'une compétence proposée. */
export const CompetenceProposee = z.object({
  /** Le nom de la fiche dans le pool (`data/competences/<nom>`). */
  nom: z.string(),
  /** Son nom lisible, celui de l'encadré. */
  titre: z.string(),
  /** Ce qui correspond au besoin — la phrase de l'encadré. */
  correspondance: z.string(),
  /** La question qui porte l'encadré dans le fil. */
  questionId: z.string(),
  /** L'agent de cadrage dans le fil duquel elle a été posée. */
  agentId: z.string().optional(),
  etat: z.enum(ETATS_DE_PROPOSITION),
  proposeeLe: z.number(),
  trancheeLe: z.number().optional(),
});
export type CompetenceProposee = z.infer<typeof CompetenceProposee>;

/** « capacitor-ecrans-a-distance » → « Capacitor ecrans a distance » : un titre, pas un identifiant. */
export function titreLisibleDeCompetence(nom: string): string {
  const mots = (nom ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return mots ? mots.charAt(0).toUpperCase() + mots.slice(1) : '';
}

const CORRESPONDANCE_MAX = 320;

/**
 * CE QUI CORRESPOND AU BESOIN, tiré de la description de la fiche — qui dit
 * justement QUAND s'en servir. On garde ses premières phrases, coupées
 * proprement : l'encadré se lit d'un coup d'œil, il ne déroule pas la fiche.
 */
export function correspondanceDeLaCompetence(description: string): string {
  const propre = (description ?? '').replace(/\s+/g, ' ').trim();
  if (propre.length <= CORRESPONDANCE_MAX) return propre;
  const coupe = propre.slice(0, CORRESPONDANCE_MAX);
  const finDePhrase = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf(' : '), coupe.lastIndexOf('» '));
  if (finDePhrase > CORRESPONDANCE_MAX * 0.5) return coupe.slice(0, finDePhrase + 1).trim();
  return `${coupe.slice(0, coupe.lastIndexOf(' ')).trim()}…`;
}

export interface CandidateDeProposition {
  nom: string;
  /** Le cosinus brut entre la demande et la fiche (`proximitesParLeSens`). */
  proximite: number;
  /** Sa place parmi les compétences de la recherche mêlée, à partir de 0 ; absente = `Infinity`. */
  rang: number;
}

/**
 * LE TRI ET LE PLAFOND. Parmi TOUTES les fiches servies au projet (la foule),
 * on cherche la dernière vraie marche dans les trois premières places : ce qui
 * la précède est saillant. Ne sont proposées que les saillantes que la
 * recherche mêlée classe aussi en tête, qui n'ont JAMAIS été proposées sur
 * cette carte (quelle qu'ait été la réponse), dans la limite de trois par
 * recherche et de six par carte. Pas de marche : rien.
 */
export function retenirLesPropositions<T extends CandidateDeProposition>(
  candidates: readonly T[],
  dejaProposees: readonly string[],
  plafonds: { parRecherche?: number; parCarte?: number; ecart?: number; rangMax?: number; fouleMin?: number } = {},
): T[] {
  const parRecherche = plafonds.parRecherche ?? PROPOSITIONS_PAR_RECHERCHE_MAX;
  const parCarte = plafonds.parCarte ?? PROPOSITIONS_PAR_CARTE_MAX;
  const ecart = plafonds.ecart ?? ECART_DE_SAILLANCE;
  const rangMax = plafonds.rangMax ?? RANG_MELE_MAX;
  const fouleMin = plafonds.fouleMin ?? FOULE_MINIMALE;
  const deja = new Set(dejaProposees);
  const place = Math.min(parRecherche, parCarte - deja.size);
  if (place <= 0) return [];
  const classees = [...candidates]
    .filter((c) => c.nom && Number.isFinite(c.proximite))
    .sort((a, b) => b.proximite - a.proximite);
  if (classees.length < fouleMin) return [];
  let coupure = 0;
  for (let i = 1; i <= parRecherche && i < classees.length; i += 1) {
    if (classees[i - 1]!.proximite - classees[i]!.proximite >= ecart) coupure = i;
  }
  return classees
    .slice(0, coupure)
    .filter((c) => c.rang < rangMax && !deja.has(c.nom))
    .slice(0, place);
}

/**
 * UN SEUL ENCADRÉ PAR SUJET. Une fiche propre qui ÉTEND une commune (en-tête
 * `etend`) n'est jamais proposée seule quand sa commune est dans la foule : elle
 * se fond dans la commune, qui prend la MEILLEURE proximité et le meilleur rang
 * des deux, et note la nuance. Valider la commune emporte alors sa nuance au
 * lancement (`briefingDesCompetencesValidees`). Une commune absente de la foule
 * laisse la fiche propre seule, comme avant. À appeler AVANT
 * `retenirLesPropositions`, pour que la saillance compare des sujets, pas des
 * fiches.
 */
export function rattacherLesNuances<T extends CandidateDeProposition>(
  candidates: readonly T[],
  communeDe: (nom: string) => string | undefined,
): (T & { nuances: string[] })[] {
  const parNom = new Map<string, T & { nuances: string[] }>();
  for (const c of candidates) parNom.set(c.nom, { ...c, nuances: [] });
  for (const c of candidates) {
    const commune = communeDe(c.nom);
    const cible = commune && commune !== c.nom ? parNom.get(commune) : undefined;
    if (!cible) continue;
    parNom.set(commune!, {
      ...cible,
      proximite: Math.max(cible.proximite, c.proximite),
      rang: Math.min(cible.rang, c.rang),
      nuances: [...cible.nuances, c.nom],
    });
    parNom.delete(c.nom);
  }
  return [...parNom.values()];
}

/** La phrase de l'encadré d'une commune qui porte la nuance du projet. */
export function correspondanceAvecNuance(correspondance: string, projet: string, nuances: readonly string[]): string {
  if (!nuances.length) return correspondance;
  return `${correspondance} — Le modèle commun, avec la nuance propre à « ${projet} » (${nuances.join(', ')}).`;
}

/** La question qui porte un encadré : deux choix, aucun texte libre. */
export function questionDeCompetence(
  id: string,
  competence: { nom: string; titre: string; correspondance: string },
): {
  id: string;
  question: string;
  description: string;
  kind: 'single';
  options: { id: string; label: string }[];
  allowFreeText: false;
  competence: { nom: string; titre: string };
} {
  return {
    id,
    question: `Utiliser la compétence « ${competence.titre} » ?`,
    description: competence.correspondance,
    kind: 'single',
    options: [
      { id: 'o0', label: REPONSE_UTILISER },
      { id: 'o1', label: REPONSE_PAS_UTILE },
    ],
    allowFreeText: false,
    competence: { nom: competence.nom, titre: competence.titre },
  };
}

/** « Utiliser » valide ; tout le reste — « Pas utile », une fermeture — écarte. */
export function etatApresReponse(reponse: string | undefined): Exclude<EtatDeProposition, 'proposee'> {
  return (reponse ?? '').trim() === REPONSE_UTILISER ? 'utilisee' : 'ecartee';
}

/** Les compétences VALIDÉES d'une carte, dans l'ordre où elles ont été proposées. */
export function competencesValidees(proposees: readonly CompetenceProposee[] | undefined): CompetenceProposee[] {
  return (proposees ?? []).filter((p) => p.etat === 'utilisee');
}

/**
 * CE QUE LA RECHERCHE REND À L'AGENT DE CADRAGE : le résultat de mémoire qu'il
 * attendait, puis les compétences retenues d'office (et, pour un ancien
 * encadré, ce que l'utilisateur en a décidé). L'agent n'a plus à poser la question lui-même — il
 * RECOPIE les compétences validées dans le détail technique de sa
 * compréhension, et laisse tomber les autres.
 */
export function texteDIssueDesPropositions(
  texteMemoire: string,
  tranchees: readonly { nom: string; etat: EtatDeProposition; chemin?: string }[],
  options: { interrompue?: boolean } = {},
): string {
  const validees = tranchees.filter((t) => t.etat === 'utilisee');
  const ecartees = tranchees.filter((t) => t.etat === 'ecartee');
  const sansReponse = tranchees.filter((t) => t.etat === 'proposee');
  const lignes: string[] = [
    texteMemoire.trim(),
    '',
    'COMPÉTENCES RETENUES PAR BELUGA BUILD POUR CETTE DEMANDE (retenues d’office ; l’utilisateur peut en écarter une d’une croix avant le lancement — ne lui repose pas la question) :',
  ];
  if (validees.length) {
    lignes.push('VALIDÉES — elles partiront EN ENTIER avec l’agent d’exécution ; cite-les par leur nom dans « partieTechnique.faits », et ouvre leur mode d’emploi si ton cadrage en dépend :');
    for (const v of validees) lignes.push(`- ${v.nom}${v.chemin ? ` — ${v.chemin}` : ''}`);
  }
  if (ecartees.length) {
    lignes.push('ÉCARTÉES — ne les propose pas et ne t’appuie pas dessus :');
    for (const e of ecartees) lignes.push(`- ${e.nom}`);
  }
  if (sansReponse.length) {
    lignes.push(
      options.interrompue
        ? 'RESTÉES SANS RÉPONSE (l’utilisateur a écrit autre chose entre-temps, son message t’arrive à la suite) — tiens-les pour non retenues :'
        : 'RESTÉES SANS RÉPONSE — tiens-les pour non retenues :',
    );
    for (const s of sansReponse) lignes.push(`- ${s.nom}`);
  }
  lignes.push('Poursuis ton cadrage à partir de là.');
  return lignes.join('\n');
}

/** Le plafond d'UN mode d'emploi dans le briefing : une fiche démesurée ne mange pas le contexte. */
export const SIGNES_PAR_COMPETENCE_VALIDEE_MAX = 14_000;

/**
 * LE BLOC DU BRIEFING D'EXÉCUTION : le mode d'emploi ENTIER de chaque
 * compétence validée au cadrage. C'est toute la différence avec la liste de
 * noms du socle — l'agent n'a plus à deviner laquelle ouvrir.
 */
export function texteDesCompetencesValidees(
  fiches: readonly {
    nom: string;
    chemin: string;
    texte: string;
    /** Les fiches PROPRES au projet qui précisent cette commune : servies juste après elle. */
    nuances?: readonly { nom: string; chemin: string; texte: string }[];
  }[],
  projet?: string,
): string {
  if (!fiches.length) return '';
  const borner = (texte: string) => {
    const propre = texte.trim();
    return propre.length > SIGNES_PAR_COMPETENCE_VALIDEE_MAX
      ? `${propre.slice(0, SIGNES_PAR_COMPETENCE_VALIDEE_MAX).trimEnd()}\n\n(…la suite est dans le fichier ci-dessus.)`
      : propre;
  };
  const blocs = fiches.map((fiche) => {
    const nuances = (fiche.nuances ?? []).map((nuance) =>
      [
        `#### Nuance propre à ${projet?.trim() ? `« ${projet.trim()} »` : 'ce projet'} — ${nuance.nom}`,
        `Fichier : ${nuance.chemin}`,
        '',
        borner(nuance.texte),
      ].join('\n'),
    );
    return [`### ${fiche.nom}`, `Fichier : ${fiche.chemin}`, '', borner(fiche.texte), ...nuances.map((n) => `\n${n}`)].join('\n');
  });
  const avecNuance = fiches.some((fiche) => fiche.nuances?.length);
  return [
    `COMPÉTENCES VALIDÉES PAR L'UTILISATEUR AU CADRAGE (${fiches.length}) — il a cliqué « Utiliser » sur chacune. Leur mode d'emploi est ci-dessous EN ENTIER : SUIS-LE pour cette tâche, sans le rouvrir ni reposer la question. Leurs fichiers de détail (annexes, scripts) vivent dans le même dossier que le fichier indiqué. En fin de tâche, dis avec l'outil « competences », action « retour », si chacune t'a réellement servi.` +
      (avecNuance
        ? ` Une compétence suivie d'une « Nuance propre » est COMMUNE à plusieurs projets : elle est le MODÈLE, et la nuance ne fait que la préciser pour ce projet (noms, données, stockage) — elle ne la remplace pas.`
        : ''),
    '',
    blocs.join('\n\n---\n\n'),
  ].join('\n');
}
