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
import { PART_MAX_DES_COMPETENCES, estPassageDeCompetence } from './competences.js';

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

/* ------------------------------------------------------------------ */
/* 3 bis. LE REBOND : la documentation NOMME les fichiers               */
/* ------------------------------------------------------------------ */

/**
 * UN CHEMIN DE FICHIER CITÉ DANS UN TEXTE.
 *
 * On exige au moins un dossier (`server/src/passages.ts`, jamais « passages.ts »
 * tout seul) : un nom nu ne désigne rien de sûr dans un dépôt qui porte trois
 * `index.ts`, et il suffirait d'un mot de la langue suivi d'un point pour
 * inventer un fichier qui n'existe pas.
 */
const MOTIF_CHEMIN_CITE =
  /\b(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|mjs|cjs|js|jsx|md|json|css|sh|py|yml|yaml|toml|service|sql)\b/g;

/** Les fichiers qu'un texte NOMME, tels qu'ils s'écrivent depuis la racine du projet. */
export function cheminsCites(texte: string): string[] {
  const trouves = texte.match(MOTIF_CHEMIN_CITE);
  if (!trouves) return [];
  return [...new Set(trouves.map((chemin) => chemin.replace(/^\.\//, '')))];
}

/**
 * COMBIEN DE PASSAGES SERVENT DE GRAINE au rebond. Huit, mesuré : à trois, la
 * moitié des fichiers cités manque encore ; à douze, on ramasse les citations de
 * passages qui ne répondaient déjà plus à la question, et la pertinence redescend.
 */
export const GRAINES_DU_REBOND = 8;

/**
 * CE QUE VAUT UNE CITATION. Assez pour faire remonter un fichier nommé par la
 * règle qui répond à la question — un passage passe environ de la 20ᵉ place aux
 * sept premières —, pas assez pour couronner un fichier que rien d'autre ne
 * désigne : le score d'origine continue de départager.
 */
export const BONUS_FICHIER_CITE = 0.15;

/**
 * LE REBOND — LE SECOND PAS D'UNE RECHERCHE, ET IL VAUT ONZE POINTS SUR LES
 * 120 CARTES DE RÉFÉRENCE, VINGT-CINQ SUR LES 327 QU'ON SAIT REJOUER.
 *
 * Mesuré : la bonne page — celle d'un fichier que la carte allait vraiment
 * modifier — n'arrivait dans les sept servis que 67 fois sur 100, alors qu'elle
 * est dans les cent premiers 95 fois sur 100. Ce n'était donc pas le plafond qui
 * coupait trop tôt, c'était le classement qui ne voyait pas le rapport.
 *
 * Or ce rapport est ÉCRIT, et il l'est dans la documentation elle-même : ici,
 * toute règle NOMME les fichiers qui la portent (« `shared/src/demon.ts` »,
 * « Verrouillé par `server/src/test/…` »). Une demande retrouve donc très bien
 * la RÈGLE qui la concerne — c'est le fichier de CODE derrière cette règle
 * qu'elle ratait, faute de partager un seul mot avec la question.
 *
 * On fait donc un second pas : on lit les chemins cités par les meilleurs
 * passages de DOCUMENTATION (et par la question elle-même), et on relève d'un
 * cran tout passage venu de l'un de ces fichiers. Rien n'est écarté, rien n'est
 * ajouté au corpus : seul l'ordre change.
 *
 * RÉSULTAT : 67 % → 78 % de bonne page retrouvée sur les 120 cartes de
 * référence (63 % → 77 % en vérité stricte), 51 % → 76 % sur les 327 cartes qui
 * ont une vérité de terrain, 27 % → 39 % en conversation — et **pas un jeton de
 * plus**, puisque seul l'ordre change.
 *
 * Ce qui a été essayé et REFUSÉ, sur les mêmes cartes : peser le bonus au
 * nombre de citations (74 %), l'étendre aux fichiers de même nom de famille
 * (79 %, sans gain), aux fichiers dont le nom paraît dans la question (75 %),
 * cumuler ces trois-là (70 %), et refaire un second rebond sur le résultat du
 * premier (74 %). La forme la plus simple est la meilleure : 79 %.
 * Les réglages sont un PLATEAU : 6 à 8 graines, un bonus de 0,12 à 0,15 donnent
 * le même résultat ; on prend le centre. Relevé complet dans
 * `docs/audit-memoire-rag.md`, section 12.
 */
export function rebondSurLesFichiersCites(
  classes: PassageClasse[],
  question: string,
  options: { graines?: number; bonus?: number } = {},
): PassageClasse[] {
  const graines = options.graines ?? GRAINES_DU_REBOND;
  const bonus = options.bonus ?? BONUS_FICHIER_CITE;

  const cites = new Set(cheminsCites(question));
  let vus = 0;
  for (const passage of classes) {
    if (vus >= graines) break;
    /*
     * Les graines sont des passages de DOCUMENTATION. Un fichier de code cite
     * surtout ses propres dépendances (`import`), qui n'ont rien à voir avec la
     * question : c'est la documentation qui dit quel fichier porte quelle règle.
     */
    if (passage.priorite === PRIORITE.code) continue;
    for (const chemin of cheminsCites(`${passage.texte} ${passage.titre}`)) cites.add(chemin);
    vus += 1;
  }
  if (!cites.size) return classes;

  return classes
    .map((passage) => (cites.has(passage.source) ? { ...passage, score: passage.score + bonus } : passage))
    .sort((a, b) => b.score - a.score);
}

/**
 * Les passages classés du plus pertinent au moins pertinent.
 *
 * Sans `vecteurQuestion`, on classe comme avant : empreinte de mots contre
 * empreinte de mots. Avec, on classe par le SENS RÉEL — et les poids qui vont
 * avec sont fournis par l'appelant (`vecteurs-doc.ts`), qui seul sait dans quel
 * mode on est.
 *
 * Le classement se fait en DEUX PAS : la note de chaque passage, puis le REBOND
 * sur les fichiers que les meilleurs passages NOMMENT. Le second pas se coupe
 * (`rebond: false`) pour mesurer ce qu'il apporte, jamais en production.
 */
export function classerPassages(
  passages: PassageIndexe[],
  question: string,
  options: { vecteurQuestion?: ArrayLike<number>; poids?: PoidsDuScore; rebond?: boolean } = {},
): PassageClasse[] {
  const empreinte = empreinteSemantique(question);
  const termes = termesRares(question);
  const contexte = { empreinte, termes, vecteur: options.vecteurQuestion, poids: options.poids };
  const classes = passages
    .map((passage) => scoreDuPassage(passage, contexte))
    .sort((a, b) => b.score - a.score);
  return options.rebond === false ? classes : rebondSurLesFichiersCites(classes, question);
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
 * LE SEUIL RELATIF : CE QU'UN PASSAGE DOIT PESER FACE AU MIEUX PLACÉ.
 *
 * Un seuil ABSOLU seul ne peut pas trancher, parce qu'il doit servir deux cas
 * opposés. Sur une demande qui tombe pile, le mieux placé sort à 0,45 et le
 * septième à 0,15 : ce septième n'a plus rien à voir avec la question, mais il
 * passe. Sur une demande vague, tout le classement tient entre 0,16 et 0,20 :
 * relever le seuil absolu assez haut pour couper le premier cas viderait le
 * second, où les passages sont pourtant les meilleurs qu'on ait.
 *
 * On ajoute donc une seconde condition, SANS ÉCHELLE : un passage n'entre que
 * s'il pèse au moins cette part du MIEUX PLACÉ de son propre classement. Le
 * premier passe toujours — il est sa propre référence —, et ce sont les traînards
 * qui tombent, ceux dont le score dit qu'ils croisent la question au lieu d'y
 * répondre. C'est exactement le cas signalé : deux faits remontés, un seul en
 * rapport avec la demande.
 *
 * La valeur est MESURÉE, pas devinée. `scripts/audit-memoire-rag.mjs` la balaie
 * sur les DEUX terrains où elle s'applique, avec la vérité de terrain venue de
 * git — les fichiers que chaque carte a réellement modifiés. Relevé du
 * 19/08/2026, 120 cartes réelles au lancement (section 5 quater, par les MOTS) :
 *
 * | part du premier | bonne page retrouvée | passages servis |
 * | ---: | ---: | ---: |
 * | aucune | 55 % | 2,8 |
 * | 0,45 | 55 % | 2,4 |
 * | **0,50** | **55 %** | **2,2** |
 * | 0,55 | 53 % (2 cartes perdues) | 2,0 |
 *
 * De « aucune » à 0,50 la pertinence ne bouge pas d'une carte, et un passage sur
 * cinq disparaît : ce sont les traînards, rien d'autre. À 0,55, la première
 * carte tombe. On retient donc 0,50, la plus haute valeur à coût nul — et la
 * section 5 quinquies confirme qu'elle ne coûte rien non plus en CONVERSATION,
 * sur 100 vrais messages (tenable jusqu'à 0,65 sans en perdre un seul).
 */
export const PART_MINIMALE_DU_PREMIER = 0.5;

/**
 * Le seuil réellement appliqué à un classement : le plus exigeant des deux —
 * le plancher absolu, et la part du mieux placé. Un classement vide n'a pas de
 * référence : le plancher absolu décide seul.
 */
export function seuilAppliquable(
  classes: { score: number }[],
  minimum: number,
  part = PART_MINIMALE_DU_PREMIER,
): number {
  const meilleur = classes.reduce((haut, p) => Math.max(haut, p.score), 0);
  if (meilleur <= 0) return minimum;
  return Math.max(minimum, meilleur * part);
}

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
    /**
     * Ce que les COMPÉTENCES PARTAGÉES ont le droit de peser, en jetons. Même
     * mécanique que pour le code : une part réservée — le pool a droit à sa
     * place — mais plafonnée — il ne prend pas celle des règles du projet
     * (`PART_MAX_DES_COMPETENCES`, shared/src/competences.ts).
     */
    plafondCompetences?: number;
    /**
     * La part du MIEUX PLACÉ qu'un passage doit atteindre pour entrer
     * (`PART_MINIMALE_DU_PREMIER`). `0` la coupe — c'est ce dont le balayage a
     * besoin pour mesurer ce qu'elle apporte, jamais la production.
     */
    partDuPremier?: number;
  } = {},
): ChoixDePassages {
  const plafond = options.plafond ?? PLAFOND_PASSAGES_JETONS;
  const max = options.max ?? PASSAGES_MAX;
  const parSource = options.parSource ?? PASSAGES_PAR_SOURCE_MAX;
  /*
   * LE SEUIL APPLIQUÉ EST LE PLUS EXIGEANT DES DEUX : le plancher absolu, et la
   * part du mieux placé. Le second n'a pas d'échelle, donc il vaut pour les deux
   * modes de recherche — c'est lui qui coupe les traînards d'un classement par
   * ailleurs bon, là où un plancher absolu devrait choisir entre les vider tous
   * ou les laisser tous passer.
   */
  const minimum = seuilAppliquable(
    classes,
    options.minimum ?? SCORE_MINIMUM,
    options.partDuPremier ?? PART_MINIMALE_DU_PREMIER,
  );
  const maxCode = options.maxCode ?? Number.POSITIVE_INFINITY;
  const plafondCode = options.plafondCode ?? Math.floor(plafond * PART_MAX_DU_CODE);
  const plafondCompetences = options.plafondCompetences ?? Math.floor(plafond * PART_MAX_DES_COMPETENCES);

  const gardes: PassageClasse[] = [];
  const vus = new Set<string>();
  const parFichier = new Map<string, number>();
  let jetons = 0;
  let ecartes = 0;
  let code = 0;
  let jetonsDuCode = 0;
  let jetonsDesCompetences = 0;

  for (const passage of classes) {
    if (passage.score < minimum) continue;
    const cle = `${passage.source}#${passage.titre}#${passage.texte.slice(0, 60)}`;
    if (vus.has(cle)) continue;
    if (gardes.length >= max) {
      ecartes++;
      continue;
    }
    /*
     * LE POOL NE PASSE PAS DEVANT LA DOCUMENTATION DU PROJET. Une compétence est
     * une leçon d'AILLEURS : elle peut être la meilleure réponse — son score le
     * dit — mais elle ne doit jamais manger le budget des règles du projet visé.
     * Comme pour le code, le PREMIER passage échappe à la part : une demande qui
     * entre pile dans le champ d'une compétence doit la recevoir.
     */
    if (estPassageDeCompetence(passage.source)) {
      const tropLourd =
        jetonsDesCompetences > 0 && jetonsDesCompetences + passage.jetons > plafondCompetences;
      if (tropLourd) {
        ecartes++;
        continue;
      }
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
    if (estPassageDeCompetence(passage.source)) jetonsDesCompetences += passage.jetons;
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
