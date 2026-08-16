/**
 * LA RECHERCHE DANS LA DOCUMENTATION, CÔTÉ RÈGLES PURES.
 *
 * La mémoire d'un projet vit déjà par sujet (`memoire.ts`, `regles.ts`) et ne
 * part plus en bloc. Il restait pourtant un choix fait À LA MAIN : c'est l'agent
 * qui devine quel sujet demander, et il reçoit d'abord un INDEX de toute la
 * mémoire pour s'en douter. Ce module rend ce choix AUTOMATIQUE : la demande de
 * la carte sert de question, et on ne remonte que les PASSAGES qui y répondent.
 *
 * Trois décisions vivent ici, et nulle part ailleurs :
 *
 *  1. LE DÉCOUPAGE — une section, une règle, une fiche = UN passage. Jamais un
 *     fichier entier : c'est précisément ce qu'on cherche à ne plus envoyer.
 *  2. L'EMPREINTE DE REPLI — un vecteur calculé SUR PLACE, par hachage des mots.
 *     Ce n'est plus la façon normale de chercher : le SENS vient désormais d'un
 *     vrai modèle de vectorisation (`vecteurs-doc.ts`, façon RAG). L'empreinte
 *     de mots reste le filet quand la clé manque ou que l'index n'est pas encore
 *     vectorisé — sans elle, un projet sans clé n'aurait plus de recherche.
 *  3. LE SCORE MIXTE — le sens SEUL rate les noms exacts (un nom de colonne, un
 *     nom de fichier, un mot rare). On additionne donc la proximité de sens ET
 *     la présence LITTÉRALE des termes rares de la question. Les deux poids
 *     changent selon le mode : le sens pèse plus lourd quand il est vrai.
 *
 * Et un garde-fou : ce qu'on remonte tient sous un PLAFOND de jetons, et ne doit
 * jamais peser plus lourd que l'index qu'il remplace — sinon la recherche est
 * refusée et l'index reprend sa place (`rechercheRentable`).
 *
 * Aucun disque, aucune base : le serveur lit les fichiers et tient l'index
 * (`server/src/passages.ts`), ce module décide. Il se teste donc seul.
 */

import { jetonsApproches } from './couches-tokens.js';

/* ------------------------------------------------------------------ */
/* Ce qu'est un passage                                                */
/* ------------------------------------------------------------------ */

/**
 * La PRIORITÉ d'un passage : à score égal, ce qui se réutilise d'une tâche à
 * l'autre passe devant. Les fiches de mécaniques (« ajouter un outil »,
 * « ajouter une colonne ») sont écrites pour être resservies : elles portent la
 * priorité haute.
 *
 * Le CODE, lui, passe DERRIÈRE tout le reste : un fichier montre comment, une
 * règle dit pourquoi — et c'est le pourquoi qu'on envoie en premier.
 */
export const PRIORITE = { code: -1, normale: 0, regle: 1, mecanique: 2 } as const;

/** Un morceau de documentation, tel qu'on l'indexe et tel qu'on le rend. */
export interface PassageDoc {
  /** Le fichier d'où il vient, relatif à la racine du projet. */
  source: string;
  /** Le fil des titres qui mène à lui : « Cartes › Une carte naît dans Planifié ». */
  titre: string;
  /** Le sujet de rangement, quand le fichier en porte un (`cartes`, `voix`…). */
  sujet: string;
  priorite: number;
  texte: string;
}

/** Un passage retenu par une recherche, avec ce qui l'a fait retenir. */
export interface PassageClasse extends PassageDoc {
  /** Le score mixte, entre 0 et 1 environ. */
  score: number;
  /** La part de SENS (proximité des empreintes). */
  sens: number;
  /** La part de MOTS EXACTS (termes rares de la question retrouvés tels quels). */
  mots: number;
  /** Ce que ce passage coûte, en jetons estimés. */
  jetons: number;
}

/* ------------------------------------------------------------------ */
/* 1. Le découpage                                                     */
/* ------------------------------------------------------------------ */

/** Au-delà, un passage cesse d'être un passage : il est recoupé aux paragraphes. */
export const PLAFOND_PASSAGE_SIGNES = 1800;

/** En deçà, ce n'est pas un passage mais un titre esseulé : on ne l'indexe pas. */
export const PLANCHER_PASSAGE_SIGNES = 90;

/** Le titre d'une puce de règle : son amorce en gras, sinon sa première ligne. */
function titreDeLaPuce(texte: string): string {
  const gras = texte.match(/^-\s+\*\*(.+?)\*\*/s);
  const brut = gras ? gras[1] : texte.replace(/^-\s+/, '').split('\n')[0];
  return brut.replace(/\s+/g, ' ').replace(/[*`_]/g, '').trim().slice(0, 120);
}

/**
 * Un texte coupé en morceaux qui tiennent SOUS le plafond, en descendant à la
 * coupe la plus fine seulement quand il le faut : les paragraphes d'abord, les
 * lignes ensuite, le mot en dernier recours.
 *
 * Les deux derniers niveaux ne sont pas du zèle : certaines règles de
 * `docs/regles/` sont écrites d'un seul tenant, sur cent lignes sans une seule
 * ligne vide. Coupées aux seuls paragraphes, elles restaient indivisibles — un
 * passage de 11 000 signes, soit à lui seul plus que le plafond de toute la
 * recherche.
 */
function recouper(texte: string, plafond: number): string[] {
  if (texte.length <= plafond) return [texte];
  const morceaux: string[] = [];
  let courant = '';
  const pousser = () => {
    if (courant.trim()) morceaux.push(courant.trim());
    courant = '';
  };
  const ajouter = (bout: string, liant: string) => {
    if (courant && courant.length + bout.length + liant.length > plafond) pousser();
    courant += (courant ? liant : '') + bout;
  };

  for (const paragraphe of texte.split(/\n{2,}/)) {
    if (paragraphe.length <= plafond) {
      ajouter(paragraphe, '\n\n');
      continue;
    }
    pousser();
    for (const ligne of paragraphe.split('\n')) {
      if (ligne.length <= plafond) {
        ajouter(ligne, '\n');
        continue;
      }
      pousser();
      for (const bout of couperAuMot(ligne, plafond)) morceaux.push(bout);
    }
    pousser();
  }
  pousser();
  return morceaux;
}

/** Une ligne plus longue que le plafond, coupée sur un mot entier. */
function couperAuMot(ligne: string, plafond: number): string[] {
  const bouts: string[] = [];
  let reste = ligne;
  while (reste.length > plafond) {
    const tranche = reste.slice(0, plafond);
    const espace = tranche.lastIndexOf(' ');
    const coupe = espace > plafond / 2 ? espace : plafond;
    bouts.push(reste.slice(0, coupe).trim());
    reste = reste.slice(coupe).trim();
  }
  if (reste) bouts.push(reste);
  return bouts;
}

/**
 * LE DÉCOUPAGE D'UN FICHIER MARKDOWN EN PASSAGES.
 *
 * Une SECTION (un titre `##`, `###`…) fait un passage ; mais dans les fichiers
 * de règles, chaque puce `- **…**` est un invariant qui se tient debout tout
 * seul — c'est donc ELLE le passage, pas la section qui la contient. Sans cela,
 * `docs/regles/cartes.md` rendrait deux blocs de 18 000 signes et la recherche
 * n'aurait rien affiné du tout.
 */
export function decouperEnPassages(
  source: string,
  texte: string,
  options: { sujet?: string; priorite?: number; plafond?: number } = {},
): PassageDoc[] {
  const sujet = options.sujet ?? '';
  const priorite = options.priorite ?? PRIORITE.normale;
  const plafond = options.plafond ?? PLAFOND_PASSAGE_SIGNES;

  const lignes = texte.split('\n');
  const passages: PassageDoc[] = [];
  /** Le fil des titres en cours, par niveau. */
  const fil: string[] = [];
  let corps: string[] = [];
  let dansUnBloc = false;

  const filCourant = () => fil.filter(Boolean).join(' › ');

  const vider = () => {
    const brut = corps.join('\n').trim();
    corps = [];
    if (!brut) return;

    /*
     * Une section se lit en BLOCS : une puce avec sa suite, ou un paragraphe.
     * Une puce LONGUE (un invariant de `docs/regles/`, un fait de la mémoire)
     * se tient debout toute seule et fait un passage ; les courtes se groupent,
     * sinon la moitié de `docs/verifications.md` — une ligne par contrôle —
     * disparaîtrait sous le plancher.
     */
    let groupe: string[] = [];
    const viderLeGroupe = () => {
      const texteGroupe = groupe.join('\n').trim();
      groupe = [];
      if (texteGroupe.length < PLANCHER_PASSAGE_SIGNES) return;
      for (const morceau of recouper(texteGroupe, plafond)) {
        passages.push({ source, titre: filCourant(), sujet, priorite, texte: morceau });
      }
    };

    for (const bloc of decouperBlocs(brut)) {
      const solo = /^-\s/.test(bloc) && bloc.length >= PLANCHER_PUCE_SOLO_SIGNES;
      if (!solo) {
        if (groupe.length && groupe.join('\n').length + bloc.length > plafond) viderLeGroupe();
        groupe.push(bloc);
        continue;
      }
      viderLeGroupe();
      const titre = [filCourant(), titreDeLaPuce(bloc)].filter(Boolean).join(' › ');
      for (const morceau of recouper(bloc.trim(), plafond)) {
        passages.push({ source, titre, sujet, priorite, texte: morceau });
      }
    }
    viderLeGroupe();
  };

  for (const ligne of lignes) {
    // Un bloc de code peut contenir des « # » : ils ne sont pas des titres.
    if (/^\s*```/.test(ligne)) dansUnBloc = !dansUnBloc;
    const titre = !dansUnBloc && ligne.match(/^(#{1,6})\s+(.*)$/);
    if (titre) {
      vider();
      const niveau = titre[1].length;
      fil.length = Math.min(fil.length, niveau - 1);
      fil[niveau - 1] = titre[2].replace(/[*`]/g, '').trim();
      continue;
    }
    corps.push(ligne);
  }
  vider();

  return passages;
}

/**
 * Au-delà, une puce n'est plus un élément de liste : c'est un invariant (une
 * règle de `docs/regles/`, un fait de la mémoire) qui mérite son propre passage.
 */
export const PLANCHER_PUCE_SOLO_SIGNES = 160;

/**
 * Les BLOCS d'une section : une puce avec sa suite indentée, ou un paragraphe.
 * C'est l'unité la plus fine qu'on sache découper sans couper une phrase.
 */
export function decouperBlocs(texte: string): string[] {
  const blocs: string[] = [];
  let courant: string[] = [];
  const vider = () => {
    const brut = courant.join('\n').replace(/\s+$/, '');
    courant = [];
    if (brut.trim()) blocs.push(brut);
  };
  for (const ligne of texte.split('\n')) {
    const nouvellePuce = /^[-*]\s+/.test(ligne);
    const ligneVide = !ligne.trim();
    // Une puce ouvre un bloc ; une ligne vide ferme un paragraphe, mais pas une
    // puce dont la suite est indentée (les règles s'écrivent sur plusieurs
    // paragraphes sous la même puce).
    if (nouvellePuce) {
      vider();
      courant.push(ligne);
      continue;
    }
    if (ligneVide && courant.length && !/^[-*]\s+/.test(courant[0])) {
      vider();
      continue;
    }
    if (ligneVide && !courant.length) continue;
    courant.push(ligne);
  }
  vider();
  return blocs;
}

/* ------------------------------------------------------------------ */
/* 2. L'empreinte : le SENS, calculé sur place                         */
/* ------------------------------------------------------------------ */

/**
 * La taille du vecteur. 192 dimensions suffisent pour quelques centaines de
 * passages et tiennent en un kilo-octet par passage une fois arrondies.
 */
export const DIMENSIONS_EMPREINTE = 192;

/**
 * Les mots qui apparaissent PARTOUT ne disent rien du sujet d'un passage : les
 * garder, c'est rapprocher deux textes parce qu'ils sont écrits en français.
 */
const MOTS_VIDES = new Set([
  'alors', 'apres', 'aucun', 'aucune', 'aussi', 'autre', 'autres', 'avait', 'avant', 'avec', 'avoir',
  'bien', 'cela', 'celle', 'celui', 'cette', 'ceux', 'chaque', 'comme', 'dans', 'depuis', 'deux',
  'doit', 'donc', 'dont', 'elle', 'elles', 'encore', 'entre', 'etait', 'etre', 'faire', 'fait',
  'jamais', 'leur', 'leurs', 'mais', 'meme', 'moins', 'nest', 'notre', 'nous', 'para', 'parce',
  'pour', 'pourquoi', 'plus', 'quand', 'quelle', 'quelles', 'quels', 'sans', 'sera', 'seulement',
  'sont', 'sous', 'suis', 'tout', 'toute', 'toutes', 'tous', 'trop', 'very', 'vers', 'votre', 'vous',
  'ainsi', 'chez', 'deja', 'faut', 'lors', 'lorsque', 'pendant', 'peut', 'puis', 'selon', 'sinon',
  'toujours', 'quel', 'quels', 'quelque', 'quelques', 'ceci', 'cest', 'etc',
  // Trois lettres, mais partout : les garder rapprochait deux textes parce
  // qu'ils étaient écrits en français, pas parce qu'ils parlaient du même sujet.
  'les', 'des', 'une', 'est', 'que', 'qui', 'par', 'sur', 'aux', 'ses', 'son',
  'ces', 'pas', 'ont', 'the', 'and', 'for', 'are', 'not', 'its',
  'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'when', 'then', 'than',
]);

/** Le texte réduit à ce qui se compare : minuscules, sans accents ni ponctuation. */
export function normaliserPourRecherche(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/._-]+/g, ' ')
    .trim();
}

/**
 * La RACINE grossière d'un mot : les pluriels et les terminaisons les plus
 * courantes tombent, pour que « carte » et « cartes », « publier » et
 * « publication » se retrouvent. Ce n'est pas une analyse grammaticale, c'est
 * juste assez pour ne pas rater un mot au singulier.
 */
export function raciniser(mot: string): string {
  let racine = mot;
  for (const fin of ['ements', 'ement', 'ations', 'ation', 'ences', 'ence', 'ants', 'ant']) {
    if (racine.length - fin.length >= 4 && racine.endsWith(fin)) {
      racine = racine.slice(0, racine.length - fin.length);
      break;
    }
  }
  // Le pluriel d'abord, la marque du féminin ensuite : « cartes » → « carte »
  // → « cart », que « carte » atteint aussi. Sans cet ordre, les deux formes
  // d'un même mot ne se rejoignaient jamais.
  if (racine.length > 4 && /[sx]$/.test(racine)) racine = racine.slice(0, -1);
  if (racine.length > 4 && /e$/.test(racine)) racine = racine.slice(0, -1);
  return racine;
}

/** Les mots comptables d'un texte : plus de deux lettres, jamais un mot vide. */
export function motsDuTexte(texte: string): string[] {
  return normaliserPourRecherche(texte)
    .split(/\s+/)
    .filter((mot) => mot.length > 2 && !MOTS_VIDES.has(mot));
}

/** Un hachage entier stable, le même partout et d'une version à l'autre. */
function hacher(mot: string): number {
  let h = 2166136261;
  for (let i = 0; i < mot.length; i++) {
    h ^= mot.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * L'EMPREINTE SÉMANTIQUE d'un texte : un vecteur de longueur 1, calculé par
 * hachage des racines de ses mots. Aucun appel réseau, aucune clé facturée —
 * c'est une exigence du projet, et c'est ce qui permet de réindexer la
 * documentation entière en quelques millisecondes.
 *
 * Le poids d'un mot croît en logarithme de sa fréquence : un mot répété vingt
 * fois ne vaut pas vingt fois un mot dit une fois.
 */
export function empreinteSemantique(texte: string, dimensions = DIMENSIONS_EMPREINTE): number[] {
  const vecteur = new Array<number>(dimensions).fill(0);
  const comptes = new Map<string, number>();
  for (const mot of motsDuTexte(texte)) {
    const racine = raciniser(mot);
    comptes.set(racine, (comptes.get(racine) ?? 0) + 1);
  }
  for (const [racine, compte] of comptes) {
    const h = hacher(racine);
    const dim = h % dimensions;
    const signe = (h >>> 31) & 1 ? -1 : 1;
    vecteur[dim] += signe * (1 + Math.log(compte));
  }
  const norme = Math.sqrt(vecteur.reduce((total, v) => total + v * v, 0));
  if (!norme) return vecteur;
  return vecteur.map((v) => v / norme);
}

/**
 * La proximité de deux empreintes, entre -1 et 1. Rien de commun : 0.
 *
 * Elle accepte aussi un tableau de flottants 32 bits : les vrais vecteurs sont
 * rangés en base sous cette forme et se relisent SANS recopie, ce qui compte
 * quand on en compare des milliers à chaque recherche.
 */
export function cosinus(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

/* ------------------------------------------------------------------ */
/* 3. Le score mixte : le sens ET les mots exacts                      */
/* ------------------------------------------------------------------ */

/**
 * Ce que pèse chaque moitié. Une recherche purement vectorielle rate les noms
 * exacts — un nom de colonne SQL, un nom de fichier, un mot rare — et c'est
 * justement ce qu'un agent cherche le plus souvent. Les deux comptent donc
 * presque autant.
 */
export const POIDS_SENS = 0.55;
export const POIDS_MOTS = 0.45;

/** Ce qu'une priorité haute ajoute au score : de quoi départager, pas d'écraser. */
export const BONUS_PRIORITE = 0.04;

/**
 * Les TERMES RARES d'une question : ceux qu'on veut retrouver LITTÉRALEMENT.
 * Un identifiant (`carte-sql.ts`, `analyseDemandee`, `docs/regles`) compte
 * double : quand il est là, c'est de lui que la question parle.
 */
export function termesRares(question: string): { terme: string; poids: number }[] {
  const rares = new Map<string, number>();
  for (const brut of question.split(/\s+/)) {
    const identifiant = /[./_]|[a-z][A-Z]/.test(brut) && /[a-zA-Z]/.test(brut);
    const mot = normaliserPourRecherche(brut).replace(/\s+/g, '');
    if (mot.length <= 3 || MOTS_VIDES.has(mot)) continue;
    const poids = identifiant ? 2 : 1;
    rares.set(mot, Math.max(rares.get(mot) ?? 0, poids));
  }
  return [...rares].map(([terme, poids]) => ({ terme, poids }));
}

/**
 * La part de MOTS EXACTS : combien des termes rares de la question se retrouvent
 * tels quels (ou à la racine près) dans le passage, pondérés par leur poids.
 */
export function partDesMotsExacts(texte: string, termes: { terme: string; poids: number }[]): number {
  if (!termes.length) return 0;
  const cible = normaliserPourRecherche(texte);
  const racines = new Set(motsDuTexte(texte).map(raciniser));
  let touche = 0;
  let total = 0;
  for (const { terme, poids } of termes) {
    total += poids;
    if (cible.includes(terme) || racines.has(raciniser(terme))) touche += poids;
  }
  return total ? touche / total : 0;
}

/** Un passage tel qu'on le classe : son empreinte de repli, et son vrai vecteur s'il en a un. */
export interface PassageIndexe extends PassageDoc {
  empreinte: number[];
  /** Le vecteur de SENS rendu par le modèle de vectorisation, quand il existe. */
  vecteur?: ArrayLike<number>;
}

/** Les deux poids d'un classement : ils changent selon qu'on a du vrai sens ou non. */
export interface PoidsDuScore {
  sens: number;
  mots: number;
}

/** Le score d'un passage pour une question : le sens, les mots, la priorité. */
export function scoreDuPassage(
  passage: PassageIndexe,
  question: {
    empreinte: number[];
    termes: { terme: string; poids: number }[];
    /** Présent en mode vecteurs : c'est LUI qui sert alors, pas l'empreinte de mots. */
    vecteur?: ArrayLike<number>;
    poids?: PoidsDuScore;
  },
): PassageClasse {
  const poids = question.poids ?? { sens: POIDS_SENS, mots: POIDS_MOTS };
  /*
   * EN MODE VECTEURS, un passage encore sans vecteur n'est pas jugé à
   * l'empreinte de mots — les deux échelles ne se comparent pas. Il garde ses
   * mots exacts, et ne perd donc que la moitié de sa chance, jamais toutes.
   */
  const sens = question.vecteur
    ? passage.vecteur
      ? Math.max(0, cosinus(question.vecteur, passage.vecteur))
      : 0
    : Math.max(0, cosinus(question.empreinte, passage.empreinte));
  const mots = partDesMotsExacts(passage.texte + ' ' + passage.titre, question.termes);
  const score = poids.sens * sens + poids.mots * mots + BONUS_PRIORITE * passage.priorite;
  return {
    source: passage.source,
    titre: passage.titre,
    sujet: passage.sujet,
    priorite: passage.priorite,
    texte: passage.texte,
    score,
    sens,
    mots,
    jetons: jetonsApproches(passage.texte.length),
  };
}

/**
 * Les passages classés du plus pertinent au moins pertinent.
 *
 * Sans `vecteurQuestion`, on classe comme avant : empreinte de mots contre
 * empreinte de mots. Avec, on classe par le SENS RÉEL — et les poids qui vont
 * avec sont fournis par l'appelant (`vecteurs-doc.ts`), qui seul sait dans quel
 * mode on est.
 */
export function classerPassages(
  passages: PassageIndexe[],
  question: string,
  options: { vecteurQuestion?: ArrayLike<number>; poids?: PoidsDuScore } = {},
): PassageClasse[] {
  const empreinte = empreinteSemantique(question);
  const termes = termesRares(question);
  const contexte = { empreinte, termes, vecteur: options.vecteurQuestion, poids: options.poids };
  return passages
    .map((passage) => scoreDuPassage(passage, contexte))
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* 4. Le plafond : ce qui part vraiment                                */
/* ------------------------------------------------------------------ */

/** Ce que la recherche a le droit d'ajouter au lancement d'une carte. */
export const PLAFOND_PASSAGES_JETONS = 900;

/**
 * La part de l'index qu'on s'autorise au plus. Le plafond n'est pas seulement
 * un nombre fixe : il est BORNÉ PAR L'INDEX qu'il remplace, si bien que la
 * recherche est rentable PAR CONSTRUCTION et pas seulement par contrôle. Sur un
 * projet dont la mémoire tient en dix lignes, l'index reste le moins cher — et
 * la recherche s'efface d'elle-même.
 */
export const PART_MAX_DE_L_INDEX = 0.55;

/** Le plafond réellement applicable, connaissant le poids de l'index remplacé. */
export function plafondDeRecherche(jetonsIndex: number, plafond = PLAFOND_PASSAGES_JETONS): number {
  return Math.max(0, Math.min(plafond, Math.floor(jetonsIndex * PART_MAX_DE_L_INDEX)));
}

/** Combien de passages au plus. Au-delà, on relit un fichier, pas une réponse. */
export const PASSAGES_MAX = 7;

/** Combien de passages au plus depuis un MÊME fichier : sinon, un seul sujet gagne tout. */
export const PASSAGES_PAR_SOURCE_MAX = 3;

/** En deçà, un passage ne répond pas à la question : il la croise par hasard. */
export const SCORE_MINIMUM = 0.14;

/**
 * LA PART DU BUDGET QUE LE CODE A LE DROIT DE PRENDRE.
 *
 * Le code était déjà borné en NOMBRE (`PASSAGES_CODE_MAX`, 2 sur 7) — mais pas
 * en POIDS, et c'est le poids qui compte : un passage de code fait 1 592 signes
 * en moyenne contre 578 pour un passage de documentation. Deux morceaux de code
 * bien placés mangeaient donc les deux tiers du plafond, et l'agent recevait
 * DEUX fichiers source et UNE page de documentation.
 *
 * Constaté le 16/08/2026 sur « est-ce que le programme peut décider tout seul
 * d'envoyer le site chez le client ? » : deux scripts en tête (ils contiennent
 * la question, la recherche a raison), puis plus de place — `publication.md`,
 * classé juste derrière, ne rentrait plus. Le code sert à MONTRER où le
 * comportement est écrit ; ce qui fait travailler un agent, ce sont les règles.
 *
 * LE PREMIER PASSAGE DE CODE ÉCHAPPE À CETTE PART, et c'est voulu : une demande
 * qui NOMME un fichier (« la fonction X de server/src/passages.ts ») doit
 * remonter ce fichier, fût-il gros. C'est le SECOND qui commence à coûter cher,
 * et c'est lui que la part arrête.
 */
export const PART_MAX_DU_CODE = 0.35;

/** Ce qu'une recherche retient, et ce qu'elle a écarté. */
export interface ChoixDePassages {
  gardes: PassageClasse[];
  /** Combien de passages passaient le seuil sans tenir sous le plafond. */
  ecartes: number;
  jetons: number;
}

/**
 * LE CHOIX SOUS PLAFOND STRICT. On prend les mieux classés tant qu'on tient
 * sous le plafond de jetons, sans jamais laisser un seul fichier occuper toute
 * la place. Un passage sous le seuil n'entre pas, même s'il reste de la place :
 * remplir le plafond n'est pas un objectif.
 */
export function choisirPassages(
  classes: PassageClasse[],
  options: {
    plafond?: number;
    max?: number;
    parSource?: number;
    minimum?: number;
    /** Combien de passages de CODE au plus : le reste de la place va à la doc. */
    maxCode?: number;
    /**
     * Ce que le CODE a le droit de PESER, en jetons. Le compter en nombre ne
     * suffit pas : un passage de code est trois fois plus gros qu'une page de
     * documentation, et deux suffisaient à manger le plafond
     * (`PART_MAX_DU_CODE`).
     */
    plafondCode?: number;
  } = {},
): ChoixDePassages {
  const plafond = options.plafond ?? PLAFOND_PASSAGES_JETONS;
  const max = options.max ?? PASSAGES_MAX;
  const parSource = options.parSource ?? PASSAGES_PAR_SOURCE_MAX;
  const minimum = options.minimum ?? SCORE_MINIMUM;
  const maxCode = options.maxCode ?? Number.POSITIVE_INFINITY;
  const plafondCode = options.plafondCode ?? Math.floor(plafond * PART_MAX_DU_CODE);

  const gardes: PassageClasse[] = [];
  const vus = new Set<string>();
  const parFichier = new Map<string, number>();
  let jetons = 0;
  let ecartes = 0;
  let code = 0;
  let jetonsDuCode = 0;

  for (const passage of classes) {
    if (passage.score < minimum) continue;
    const cle = `${passage.source}#${passage.titre}#${passage.texte.slice(0, 60)}`;
    if (vus.has(cle)) continue;
    if (gardes.length >= max) {
      ecartes++;
      continue;
    }
    if (passage.priorite === PRIORITE.code) {
      // Le PREMIER passe sous le seul plafond général : une demande qui nomme un
      // fichier doit le remonter. À partir du second, la part s'applique.
      const tropLourd = code > 0 && jetonsDuCode + passage.jetons > plafondCode;
      if (code >= maxCode || tropLourd) {
        ecartes++;
        continue;
      }
    }
    if ((parFichier.get(passage.source) ?? 0) >= parSource) {
      ecartes++;
      continue;
    }
    if (jetons + passage.jetons > plafond) {
      ecartes++;
      continue;
    }
    vus.add(cle);
    parFichier.set(passage.source, (parFichier.get(passage.source) ?? 0) + 1);
    if (passage.priorite === PRIORITE.code) {
      code++;
      jetonsDuCode += passage.jetons;
    }
    gardes.push(passage);
    jetons += passage.jetons;
  }

  return { gardes, ecartes, jetons };
}

/**
 * LE GARDE-FOU. La recherche remplace l'index de la mémoire : si elle pèse plus
 * lourd que lui, elle n'a rien économisé et elle est REFUSÉE — l'index reprend
 * sa place. C'est ce que rejoue `scripts/mesure-jetons.mjs`.
 */
export function rechercheRentable(jetonsPassages: number, jetonsIndex: number): boolean {
  if (jetonsPassages <= 0) return false;
  return jetonsPassages < jetonsIndex;
}

/**
 * L'ÉCART MINIMUM entre le passage le mieux placé et le reste du corpus pour
 * dire que la recherche a trouvé quelque chose de NETTEMENT pertinent.
 *
 * Mesuré sur 120 cartes réelles (`docs/audit-memoire-rag.md`) : le score du
 * mieux placé vaut en moyenne 0,60, celui du dernier passage retenu 0,42 — et
 * une question hors sujet reçoit tout de même cinq à six passages entre 0,31
 * et 0,33. La recherche sert donc TOUJOURS le même volume, qu'elle soit
 * tombée juste ou qu'elle ait ramené le moins mauvais d'un lot médiocre, sans
 * qu'aucun signal ne le distingue à l'écran.
 */
export const ECART_PERTINENCE_MIN = 0.2;

/**
 * LA RECHERCHE A-T-ELLE TROUVÉ QUELQUE CHOSE DE CONVAINCANT ?
 *
 * Ne change ni le classement, ni le seuil, ni le plafond — elle rend un
 * défaut VISIBLE, elle ne le corrige pas. Compare le score du passage le
 * mieux placé à la MOYENNE de tout le reste du corpus classé pour cette
 * question : un écart net dit que la recherche a reconnu quelque chose de
 * particulier, un écart faible dit qu'elle a rendu le sommet d'un lot où
 * tout se vaut à peu près.
 *
 * `undefined` sans aucun passage classé (rien à comparer) ; `true` s'il n'y a
 * qu'un seul passage dans tout le corpus (rien à comparer non plus, mais ce
 * n'est pas un défaut de le dire).
 */
export function rechercheConvaincante(classes: { score: number }[]): boolean | undefined {
  if (!classes.length) return undefined;
  const [meilleur, ...reste] = classes.map((passage) => passage.score);
  if (!reste.length) return true;
  const moyenneDuReste = reste.reduce((total, score) => total + score, 0) / reste.length;
  return meilleur - moyenneDuReste >= ECART_PERTINENCE_MIN;
}

/**
 * LE BLOC ENVOYÉ AU MOTEUR. Il dit d'où vient chaque passage — un agent doit
 * pouvoir ouvrir le fichier — et il DIT qu'il ne montre pas tout : l'index
 * complet et les sujets restent à un appel de `project_memory`. Un plafond
 * silencieux se lirait comme une réponse complète.
 *
 * ET IL PORTE LE SOMMAIRE DES SUJETS (`texteDuSommaire`, shared/src/memoire.ts).
 * Sans lui, ce bloc invitait l'agent à demander « un sujet » sans jamais dire
 * lesquels existent : le sommaire coûte une ligne par sujet, l'index en coûtait
 * une par fait, et c'est lui qui rend l'outil réellement utilisable.
 */
export function texteDesPassages(passages: PassageClasse[], faits: number, sommaire = ''): string {
  if (!passages.length) return '';
  const corps = passages
    .map((passage) => `▸ ${passage.source}${passage.titre ? ` — ${passage.titre}` : ''}\n${passage.texte.trim()}`)
    .join('\n\n');
  const carte = sommaire.trim() ? `\n\n${sommaire.trim()}` : '';
  return (
    `MÉMOIRE DU PROJET — ${passages.length} passages retrouvés pour CETTE tâche ` +
    `(règles, faits, contrôles, mécaniques, fichiers du projet) :\n\n` +
    `${corps}\n\n` +
    `Ce sont les mieux placés, sous plafond de jetons — pas toute la mémoire (${faits} faits, ` +
    `plus les règles et les contrôles). Appelle « project_memory » dès que cela ne suffit pas : ` +
    `sans argument pour l'index complet, avec un sujet ou des mots-clés pour le reste.${carte}`
  );
}
