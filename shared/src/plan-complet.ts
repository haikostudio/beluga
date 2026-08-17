/**
 * UN PLAN, C'EST QUATRE PARTIES — sinon ce n'est pas un plan.
 *
 * Le mode plan demandait déjà, en toutes lettres, que CHAQUE itération rende
 * les quatre parties en entier (§ `TRI_MODE_PLAN`, `server/src/runtime.ts`).
 * La consigne n'était pourtant qu'une consigne : rien ne regardait le texte
 * rendu. Une relance formulée en QUESTION (« quelle amélioration proposes-tu
 * pour ce mécanisme ? ») recevait donc une réponse ordinaire — trois pistes et
 * « dites-moi laquelle intégrer au plan » — que le démon habillait quand même
 * en « Plan proposé · version 3 », boutons « Valider » / « Refuser » compris.
 * L'utilisateur perdait le plan qu'il avait, et le bouton portait sur un
 * fragment.
 *
 * D'où cette règle, sans base ni disque, donc rejouable seule : un texte n'est
 * un plan que s'il ANNONCE ses quatre parties. On ne juge pas la qualité du
 * contenu — seulement la présence des quatre INTITULÉS, là où un plan les met :
 * en titre, en gras, ou en tête de ligne suivie de deux points.
 *
 * Le jugement sert deux fois côté démon :
 *   — un texte incomplet ne porte plus le drapeau `plan` (donc ni cadre, ni
 *     boutons de décision) ;
 *   — quand un plan attendait une décision, le chef est RELANCÉ une fois pour
 *     rendre la version suivante en entier.
 *
 * DEUXIÈME EXIGENCE, LE FOND (`jugerLeFond`). Les quatre titres étaient tenus,
 * mais remplis d'une phrase chacun : un plan qui « a l'air d'un plan » sans
 * rien avoir étudié. On mesure donc aussi la MATIÈRE — une analyse qui constate
 * l'existant, des étapes numérotées, un découpage à deux niveaux, des
 * améliorations en liste — et le contraire, le PAVÉ, qui n'est pas plus
 * lisible. Cette exigence-là ne retire JAMAIS le cadre : elle relance le chef
 * une fois, et un plan mince mais entier reste décidable.
 */

/**
 * L'ÉTAPE VISIBLE dans la conversation quand le démon rattrape un plan
 * incomplet : l'utilisateur voit pourquoi sa réponse a été refaite.
 */
export const ETAPE_PLAN = 'Plan rendu en entier';
export const ETAPE_PLAN_ID = 'plan-entier';

/** La MÊME chose pour le FOND : le plan avait ses titres, pas sa matière. */
export const ETAPE_FOND = 'Plan repris en profondeur';
export const ETAPE_FOND_ID = 'plan-fond';

/** Les quatre parties, dans l'ordre où un plan les écrit. */
export interface PartieDePlan {
  /** Le nom affiché quand la partie manque. */
  nom: string;
  /**
   * Les intitulés acceptés, déjà sans accent ni majuscule. Le premier est le
   * nom canonique ; les autres sont les tournures qu'un moteur emploie
   * naturellement pour la même partie.
   */
  intitules: string[];
}

export const PARTIES_DU_PLAN: PartieDePlan[] = [
  { nom: 'Faisabilité', intitules: ['faisabilite', 'est-ce faisable', 'est-ce possible'] },
  {
    nom: 'Chemin à suivre',
    intitules: ['chemin a suivre', 'chemin propose', 'chemin', 'les etapes', 'etapes', 'demarche'],
  },
  { nom: 'Conséquences', intitules: ['consequences', 'ce que cela change', 'ce que ca change'] },
  {
    nom: 'Améliorations apportées',
    intitules: [
      'ameliorations apportees',
      'ameliorations',
      'ce que vous y gagnez',
      'ce que l utilisateur y gagne',
      'gains',
    ],
  },
];

/** Minuscules, sans accent, espaces normalisés : deux écritures d'un même mot se rejoignent. */
function aplati(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Les INTITULÉS d'un texte : ce qui, ligne par ligne, se présente comme le
 * titre d'une partie — un titre Markdown, une ligne toute en gras, ou un début
 * de ligne suivi de deux points. Une même notion citée en pleine phrase ne
 * compte pas : un plan qui dit « les conséquences seront faibles » au fil d'un
 * paragraphe n'a pas pour autant une partie « Conséquences ».
 */
export function intitulesDuTexte(texte: string): string[] {
  const intitules: string[] = [];
  for (const ligne of texte.split('\n')) intitules.push(...intitulesDeLaLigne(ligne));
  return intitules;
}

/** Les intitulés portés par UNE ligne — la brique de `intitulesDuTexte`. */
function intitulesDeLaLigne(ligne: string): string[] {
  const nue = ligne.trim();
  if (!nue) return [];
  // « ## 2. Chemin à suivre », « **Chemin à suivre.** », « - CHEMIN À SUIVRE : … »
  const sansPuce = nue.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s*/, '');
  const gras = sansPuce.match(/^\*\*(.+?)\*\*/);
  const avantDeuxPoints = sansPuce.match(/^([^:]{1,60}):/);
  const candidats = [gras?.[1], avantDeuxPoints?.[1], /^#{1,6}\s/.test(nue) ? sansPuce : undefined];
  const trouves: string[] = [];
  for (const candidat of candidats) {
    if (!candidat) continue;
    const plat = aplati(candidat.replace(/^\d+[.)]\s*/, ''));
    if (plat && plat.length <= 60) trouves.push(plat);
  }
  return trouves;
}

/**
 * La partie du plan qu'une ligne OUVRE, s'il y en a une.
 *
 * Ici on est PLUS STRICT que `jugerLePlan` : l'intitulé doit COMMENCER la
 * ligne, pas seulement y figurer. Chercher « améliorations » n'importe où
 * ferait ouvrir la quatrième partie sur une étape du chemin nommée « Rendre
 * les améliorations cliquables » — et le chemin s'arrêterait là. Juger la
 * PRÉSENCE d'une partie tolère le à-peu-près ; en découper les FRONTIÈRES, non.
 */
function partieOuvertePar(ligne: string): PartieDePlan | null {
  const intitules = intitulesDeLaLigne(ligne);
  if (!intitules.length) return null;
  return (
    PARTIES_DU_PLAN.find((partie) =>
      partie.intitules.some((attendu) => intitules.some((vu) => vu.startsWith(attendu))),
    ) ?? null
  );
}

/**
 * LE PLAN, DÉCOUPÉ EN SES PARTIES — le titre d'un côté, ce qu'il y a dessous de
 * l'autre. Ce qui précède la première partie (une phrase d'introduction) n'est
 * rattaché à personne : on ne veut pas qu'un préambule bavard fasse passer une
 * analyse vide pour une analyse fournie.
 */
export function corpsDesParties(texte: string): Map<string, string> {
  const corps = new Map<string, string[]>();
  let courante: PartieDePlan | null = null;
  for (const ligne of (texte ?? '').split('\n')) {
    const ouverte = partieOuvertePar(ligne);
    if (ouverte) {
      courante = ouverte;
      if (!corps.has(ouverte.nom)) corps.set(ouverte.nom, []);
      continue;
    }
    if (courante) corps.get(courante.nom)!.push(ligne);
  }
  return new Map([...corps].map(([nom, lignes]) => [nom, lignes.join('\n').trim()]));
}

/** Ce que vaut un texte rendu en mode plan. */
export interface JugementDePlan {
  /** Les quatre parties sont-elles annoncées ? */
  complet: boolean;
  /** Les noms des parties absentes, dans l'ordre du plan. */
  manquantes: string[];
}

/**
 * CE TEXTE EST-IL UN PLAN ENTIER ? On cherche les quatre intitulés parmi les
 * titres du texte, jamais dans sa prose.
 */
export function jugerLePlan(texte: string): JugementDePlan {
  const intitules = intitulesDuTexte(texte ?? '');
  const manquantes = PARTIES_DU_PLAN.filter(
    (partie) => !partie.intitules.some((attendu) => intitules.some((vu) => vu.includes(attendu))),
  ).map((partie) => partie.nom);
  return { complet: manquantes.length === 0, manquantes };
}

/* ------------------------------------------------------------------ */
/* LE FOND : un plan qui a l'air d'un plan n'en est pas forcément un.   */
/* ------------------------------------------------------------------ */

/**
 * LES SEUILS DU FOND, réunis ici pour se relire d'un coup — et se corriger
 * d'un seul endroit. Ils disent la MATIÈRE attendue, jamais le style : ce
 * sont des minimums de plancher, pas une cible à viser.
 */
export const EXIGENCES_DE_FOND = {
  /** L'analyse (FAISABILITÉ) sous ce nombre de signes n'a rien constaté. */
  signesDAnalyse: 500,
  /** Un chemin en dessous de ce nombre d'étapes numérotées n'est pas un chemin. */
  etapesDuChemin: 3,
  /** Le découpage à deux niveaux : sous-titres ou étapes nommées, dans tout le plan. */
  sousTitres: 3,
  /** Les améliorations sont une LISTE : autant de lignes en puce, au moins. */
  ameliorations: 3,
  /** Au-delà, un paragraphe est un pavé : on ne le lit plus, on le survole. */
  signesDUnParagraphe: 1000,
  /** Au-delà, le plan entier est un pavé, quelle que soit sa structure. */
  signesDuPlan: 14000,
} as const;

/** Ce qu'on reproche à un plan trop simple — un identifiant, une phrase. */
export interface ReprocheDeFond {
  /** Repère stable, pour les contrôles. */
  id: string;
  /** Ce qui manque, dit au chef tel quel. */
  texte: string;
}

/** Ce que vaut le FOND d'un plan par ailleurs entier. */
export interface JugementDeFond {
  /** Le plan a-t-il la matière attendue ? */
  assezFouille: boolean;
  /** Ce qu'il faut ajouter, dans l'ordre où le plan s'écrit. */
  reproches: ReprocheDeFond[];
}

/** Les lignes en puce d'un corps de partie. */
function puces(corps: string): number {
  return corps.split('\n').filter((l) => /^\s*[-*•]\s+\S/.test(l)).length;
}

/**
 * UNE ÉTAPE NUMÉROTÉE SE RECONNAÎT À SON NUMÉRO, PAS À SA PONCTUATION.
 *
 * Le compteur n'acceptait que « 1. » ou « 1) » en tout début de ligne. Or un
 * chemin bien écrit ne ressemble jamais à cela : le chef donne un titre à
 * chaque étape, donc il écrit « **Étape 1 — Réparer le raccordement** » ou
 * « ### 2. Poser le fond ». Le compteur voyait alors ZÉRO étape sur un chemin
 * qui en portait cinq, le reproche `chemin-sans-etapes` partait à CHAQUE plan,
 * et le démon relançait un tour de moteur entier — soixante à cent vingt
 * secondes — qui ne pouvait rien y changer, puisque la relance redemandait
 * exactement ce qui était déjà là. Mesuré le 17/08/2026 sur les douze derniers
 * plans du projet : douze relances, douze fois le même reproche encore présent
 * APRÈS la relance.
 *
 * On enlève donc l'habillage (titre Markdown, puce, gras) avant de chercher le
 * numéro, et l'on accepte le mot qui le précède souvent (« Étape », « Phase »).
 * Le numéro reste à DEUX chiffres au plus : sans cela « 2026-08-17 : … » ou
 * « 1000 signes : … » passeraient pour des étapes.
 */
const DEBUT_D_ETAPE = /^(?:etape|phase|partie|lot)?\s*\d{1,2}\s*(?:[.):]|[—–-])\s*\S/;

function estUneEtapeNumerotee(ligne: string): boolean {
  const nue = ligne
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\*+\s*/, '');
  return DEBUT_D_ETAPE.test(sansAccent(nue));
}

/** Minuscules et sans accent, mais la PONCTUATION gardée — `aplati` l'efface. */
function sansAccent(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Les étapes numérotées d'un corps de partie. */
function etapes(corps: string): number {
  return corps.split('\n').filter((ligne) => estUneEtapeNumerotee(ligne)).length;
}

/**
 * Les SOUS-TITRES du plan : ce qui découpe une partie en morceaux nommés — un
 * titre de niveau 3 et plus, ou une ligne qui COMMENCE en gras (« **Ce qui
 * existe aujourd'hui.** … », « 2. **Poser le fond gris.** … »). Les quatre
 * titres de parties ne comptent pas : ils sont dans `corps`, pas dedans.
 */
function sousTitres(corps: string): number {
  return corps
    .split('\n')
    .filter((ligne) => {
      const nue = ligne.trim();
      if (/^#{3,6}\s+\S/.test(nue)) return true;
      const sansPuce = nue.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s*/, '');
      return /^\*\*[^*]{2,80}\*\*/.test(sansPuce);
    }).length;
}

/** Le plus gros paragraphe d'un texte, en signes. */
function plusGrosParagraphe(texte: string): number {
  return texte
    .split(/\n\s*\n/)
    .map((bloc) => bloc.trim().length)
    .reduce((max, taille) => Math.max(max, taille), 0);
}

/**
 * CE PLAN A-T-IL VRAIMENT ÉTÉ RÉFLÉCHI ? On ne juge pas la pertinence — aucune
 * règle ne sait le faire — mais la MATIÈRE, qui se compte : une analyse qui
 * constate au lieu d'affirmer, un chemin en étapes, un découpage à deux
 * niveaux, des améliorations en liste. Et son revers : ni pavé, ni fleuve.
 *
 * Un texte qui n'est même pas un plan entier n'est pas jugé ici : la première
 * règle l'a déjà écarté.
 */
export function jugerLeFond(texte: string): JugementDeFond {
  const plan = (texte ?? '').trim();
  const corps = corpsDesParties(plan);
  const analyse = corps.get('Faisabilité') ?? '';
  const chemin = corps.get('Chemin à suivre') ?? '';
  const ameliorations = corps.get('Améliorations apportées') ?? '';
  const reproches: ReprocheDeFond[] = [];

  if (analyse.length < EXIGENCES_DE_FOND.signesDAnalyse) {
    reproches.push({
      id: 'analyse-mince',
      texte:
        "l'ANALYSE est trop mince : sous FAISABILITÉ, dis ce que le projet fait AUJOURD'HUI (constaté, pas supposé), ce que la demande veut de plus, l'écart entre les deux, puis les points durs et ce dont tu n'es pas sûr.",
    });
  }
  if (etapes(chemin) < EXIGENCES_DE_FOND.etapesDuChemin) {
    reproches.push({
      id: 'chemin-sans-etapes',
      texte: `le CHEMIN À SUIVRE n'est pas découpé : numérote au moins ${EXIGENCES_DE_FOND.etapesDuChemin} étapes, chacune avec ce qu'elle touche et ce qu'elle produit.`,
    });
  }
  if (sousTitres(plan) < EXIGENCES_DE_FOND.sousTitres) {
    reproches.push({
      id: 'sans-hierarchie',
      texte:
        'le plan est PLAT : donne un titre court en gras à chaque étape et à chaque morceau de ton analyse, pour qu\'on le parcoure des yeux sans tout lire.',
    });
  }
  if (puces(ameliorations) < EXIGENCES_DE_FOND.ameliorations) {
    reproches.push({
      id: 'ameliorations-non-listees',
      texte: `les AMÉLIORATIONS APPORTÉES sont une LISTE de propositions cliquables : au moins ${EXIGENCES_DE_FOND.ameliorations} lignes en puce « - », chacune une idée à AJOUTER au plan, formulée comme une demande.`,
    });
  }
  if (plusGrosParagraphe(plan) > EXIGENCES_DE_FOND.signesDUnParagraphe) {
    reproches.push({
      id: 'pave',
      texte: 'un paragraphe est devenu un PAVÉ : coupe-le en paragraphes de deux ou trois phrases, ou en puces.',
    });
  }
  if (plan.length > EXIGENCES_DE_FOND.signesDuPlan) {
    reproches.push({
      id: 'plan-fleuve',
      texte: 'le plan est trop long pour être lu : garde la même structure, mais resserre chaque partie.',
    });
  }

  return { assezFouille: reproches.length === 0, reproches };
}

/**
 * LA RELANCE QUI DEMANDE PLUS DE FOND — le pendant de `consigneDePlanEntier`
 * quand les quatre titres sont là mais qu'il n'y a rien dessous.
 *
 * Elle nomme ce qui manque, une ligne par reproche, et redemande le plan
 * ENTIER : on ne recolle pas un morceau à un plan déjà écrit.
 */
export function consigneDePlanPlusFouille(numeroAttendu: number, reproches: ReprocheDeFond[]): string {
  return [
    `TON PLAN A SES QUATRE TITRES, MAIS PAS SA MATIÈRE. Ce qui manque :`,
    ...reproches.map((r) => `- ${r.texte}`),
    ``,
    `Rends la VERSION ${numeroAttendu} EN ENTIER, mêmes quatre parties, avec ce fond en plus.`,
    `Appuie-toi sur ce que tu as DÉJÀ lu dans ce tour : tu n'as plus d'outil ici, n'invente donc rien de neuf sur le projet.`,
    `Reste lisible pour quelqu'un qui ne programme pas : des paragraphes courts, des titres en gras, jamais un pavé.`,
    `Réponds uniquement par le plan, sans préambule et sans t'excuser.`,
  ].join('\n');
}

/**
 * LA RELANCE, quand le chef a répondu à côté du plan.
 *
 * Elle est envoyée dans la MÊME session : le chef a donc encore sous les yeux
 * la demande et sa propre réponse. On lui redit le seul point qu'il a manqué —
 * ce qu'il vient d'écrire n'est pas une réponse à part, c'est la matière de la
 * version suivante — et on nomme les parties absentes pour qu'il n'ait rien à
 * deviner.
 */
export function consigneDePlanEntier(numeroAttendu: number, manquantes: string[]): string {
  return [
    `TA RÉPONSE N'EST PAS UN PLAN ENTIER : il y manque ${manquantes.join(', ')}.`,
    `En mode plan, une réponse ne remplace JAMAIS le plan — elle DEVIENT la version suivante.`,
    `Reprends donc la version précédente, intègre ce que tu viens d'écrire, et rends la VERSION ${numeroAttendu}`,
    `EN ENTIER : FAISABILITÉ, CHEMIN À SUIVRE, CONSÉQUENCES, AMÉLIORATIONS APPORTÉES, chacune sous son titre.`,
    `Si tu as un choix à soumettre, pose-le APRÈS les quatre parties, en une ligne — jamais à leur place.`,
    `Réponds uniquement par le plan, sans préambule et sans t'excuser.`,
  ].join('\n');
}
