/**
 * LE RESPONSABLE CRÉATIF DU STUDIO (chantier « Beluga Creative Studio », carte 2
 * sur 5, 24/10/2026) — règles PURES, sans base ni disque.
 *
 * Le mode caméra d'une carte devient un responsable créatif unique qui tient
 * sept rôles (`ROLES_DE_REALISATION`) et mène, depuis une simple phrase, la
 * CHAÎNE D'ÉCRITURE : brief → directions → scénario → storyboard → plans. Tout
 * s'écrit en texte, sans dépense, dans la mémoire de production du socle
 * (`production_elements`, `shared/src/production.ts`), par l'outil
 * « production » servi au cadrage ET à la tâche d'une carte caméra.
 *
 * Décisions de l'utilisateur (24/10/2026, revues le 25/10/2026) :
 *  - TROIS ARRÊTS POUR ACCORD, PAS UN DE PLUS (`ARRETS_DU_DIRECTEUR`, remplace
 *    « un arrêt à chaque étape » du 24/10) : l'IDÉE (brief + direction
 *    ensemble), les IMAGES CLÉS avec le PRIX du film (scénario, storyboard et
 *    plans écrits sans s'arrêter entre deux — son accord LANCE la fabrication),
 *    puis le FILM MONTÉ. Une étape de l'arrêt 2 ne s'écrit qu'après l'accord sur
 *    l'idée (`etapeSuivantePermise`) ; une retouche d'une étape validée la fait
 *    revalider et invalide l'aval (`etapesEnAval`) ;
 *  - LE DIRECTEUR NE PRÉVOIT RIEN QU'IL NE SAIT PAS FABRIQUER : chaque plan
 *    déclare sa capacité, refusée si aucun service branché ne la couvre
 *    (`plansSurCapaciteAbsente`) ; les PIÈCES À FOURNIR (photo, logo, voix…)
 *    se demandent au départ et bloquent l'arrêt 2 tant qu'elles manquent
 *    (`piecesAFournirManquantes`) ;
 *  - LE BRIEF par UN formulaire de 3 à 5 questions d'un coup, choix suggérés et
 *    réponse libre, jamais une question dont le brief a déjà la réponse
 *    (`questionsDuFormulaire`) ;
 *  - un plan retouché GARDE ses versions ; « Utiliser cette version » refait
 *    d'une ancienne version la version en cours, sans rien effacer.
 *
 * Architecture : `docs/mecaniques/creative-studio.md`.
 */

import { z } from 'zod';
import { elementsCourants, type ElementDeProduction, type GenreDElement } from './production.js';
import type { TypeDeMediaDeRealisation } from './mode-realisation.js';

/* ------------------------------------------------------------------ */
/* 1. La chaîne d'écriture et ses accords                               */
/* ------------------------------------------------------------------ */

export const ETAPES_D_ECRITURE = ['brief', 'direction', 'scenario', 'storyboard', 'plans'] as const;
export type EtapeDEcriture = (typeof ETAPES_D_ECRITURE)[number];

export const LIBELLES_ETAPES_D_ECRITURE: Record<EtapeDEcriture, string> = {
  brief: 'Brief',
  direction: 'Direction',
  scenario: 'Scénario',
  storyboard: 'Storyboard',
  plans: 'Plans',
};

/** Le genre d'élément qui PORTE chaque étape (personnages et références accompagnent la direction sans la juger). */
export const GENRE_DE_L_ETAPE_D_ECRITURE: Record<EtapeDEcriture, GenreDElement> = {
  brief: 'brief',
  direction: 'concept',
  scenario: 'script',
  storyboard: 'scene',
  plans: 'plan',
};

export function etapeDEcritureDuGenre(genre: GenreDElement): EtapeDEcriture | null {
  return ETAPES_D_ECRITURE.find((e) => GENRE_DE_L_ETAPE_D_ECRITURE[e] === genre) ?? null;
}

/**
 * LA CHAÎNE D'UNE PRODUCTION, selon ce qu'on produit : une vidéo (ou rien de
 * choisi encore) passe par les cinq étapes ; une image n'a ni scénario ni
 * storyboard ; un son seul n'a ni direction visuelle ni storyboard.
 */
export function chaineDEcriture(types: readonly TypeDeMediaDeRealisation[]): EtapeDEcriture[] {
  if (!types.length || types.includes('video')) return [...ETAPES_D_ECRITURE];
  if (types.includes('image')) return ['brief', 'direction', 'plans'];
  return ['brief', 'scenario', 'plans'];
}

/** Ce qu'une étape porte : rien encore, une proposition, une demande d'accord, un accord. */
export type EtatDEtapeDEcriture = 'vide' | 'propose' | 'a-valider' | 'valide';

/** Les pièces COURANTES qui portent une étape (la dernière version de chaque clé). */
export function piecesDeLEtape(elements: readonly ElementDeProduction[], etape: EtapeDEcriture): ElementDeProduction[] {
  const genre = GENRE_DE_L_ETAPE_D_ECRITURE[etape];
  return elementsCourants(elements).filter((e) => e.genre === genre && e.etat !== 'remplace');
}

/**
 * L'ÉTAT D'UNE ÉTAPE. La direction est validée dès qu'UNE direction est
 * choisie (les autres sont écartées) ; les autres étapes, quand TOUTES leurs
 * pièces courantes sont validées — une pièce retouchée depuis l'accord le défait.
 */
export function etatDeLEtapeDEcriture(elements: readonly ElementDeProduction[], etape: EtapeDEcriture): EtatDEtapeDEcriture {
  const pieces = piecesDeLEtape(elements, etape);
  if (!pieces.length) return 'vide';
  if (etape === 'direction') {
    if (pieces.some((p) => p.etat === 'valide')) return 'valide';
    if (pieces.some((p) => p.etat === 'a-valider')) return 'a-valider';
    return 'propose';
  }
  if (pieces.every((p) => p.etat === 'valide')) return 'valide';
  if (pieces.some((p) => p.etat === 'a-valider')) return 'a-valider';
  return 'propose';
}

export function etatsDesEtapesDEcriture(
  elements: readonly ElementDeProduction[],
  types: readonly TypeDeMediaDeRealisation[],
): { etape: EtapeDEcriture; etat: EtatDEtapeDEcriture }[] {
  return chaineDEcriture(types).map((etape) => ({ etape, etat: etatDeLEtapeDEcriture(elements, etape) }));
}

/* ------------------------------------------------------------------ */
/* 1 bis. Les trois arrêts du directeur artistique (25/10/2026)        */
/* ------------------------------------------------------------------ */

export const ARRETS_DU_DIRECTEUR = ['idee', 'images-cles', 'rendu'] as const;
export type ArretDuDirecteur = (typeof ARRETS_DU_DIRECTEUR)[number];

export const LIBELLES_ARRETS_DU_DIRECTEUR: Record<ArretDuDirecteur, string> = {
  idee: 'L’idée',
  'images-cles': 'Les images clés et le prix',
  rendu: 'Le film monté',
};

/** L'arrêt qui juge une étape d'écriture : brief et direction à l'idée, le reste aux images clés. */
export function arretDeLEtape(etape: EtapeDEcriture): Exclude<ArretDuDirecteur, 'rendu'> {
  return etape === 'brief' || etape === 'direction' ? 'idee' : 'images-cles';
}

/** Les étapes d'écriture qu'un arrêt soumet ensemble, dans la chaîne de cette production. */
export function etapesDeLArret(arret: ArretDuDirecteur, types: readonly TypeDeMediaDeRealisation[]): EtapeDEcriture[] {
  if (arret === 'rendu') return [];
  return chaineDEcriture(types).filter((e) => arretDeLEtape(e) === arret);
}

/** Un arrêt est-il accordé ? Toutes ses étapes validées (le rendu se lit dans les approbations, pas ici). */
export function arretAccorde(arret: Exclude<ArretDuDirecteur, 'rendu'>, elements: readonly ElementDeProduction[], types: readonly TypeDeMediaDeRealisation[]): boolean {
  const etapes = etapesDeLArret(arret, types);
  return etapes.length > 0 && etapes.every((e) => etatDeLEtapeDEcriture(elements, e) === 'valide');
}

/** L'arrêt à mener : l'idée tant qu'elle n'est pas accordée, puis les images clés, puis le rendu. */
export function arretAMener(elements: readonly ElementDeProduction[], types: readonly TypeDeMediaDeRealisation[]): ArretDuDirecteur {
  if (!arretAccorde('idee', elements, types)) return 'idee';
  if (!arretAccorde('images-cles', elements, types)) return 'images-cles';
  return 'rendu';
}

/** Un nom d'arrêt lu avec tolérance, ancien nom d'étape compris (« brief » → idée, « plans » → images clés). */
export function arretLu(brut: unknown): ArretDuDirecteur | null {
  const s = String(brut ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if ((ARRETS_DU_DIRECTEUR as readonly string[]).includes(s)) return s as ArretDuDirecteur;
  const alias: Record<string, ArretDuDirecteur> = {
    brief: 'idee',
    direction: 'idee',
    directions: 'idee',
    concept: 'idee',
    'l-idee': 'idee',
    scenario: 'images-cles',
    script: 'images-cles',
    storyboard: 'images-cles',
    plans: 'images-cles',
    plan: 'images-cles',
    images: 'images-cles',
    'images-cles-et-prix': 'images-cles',
    prix: 'images-cles',
    film: 'rendu',
    montage: 'rendu',
    'film-monte': 'rendu',
  };
  return alias[s] ?? null;
}

/**
 * PEUT-ON ÉCRIRE CETTE ÉTAPE ? Depuis le 26/10/2026, tout l'écrit d'une
 * création (brief, directions, scénario, storyboard, plans) se fait AU BRIEF,
 * librement et sans arrêt d'accord : c'est le bouton « Passer aux esquisses »
 * qui vaut accord. Seule une étape étrangère à la chaîne du média est refusée
 * (un storyboard pour une photo).
 */
export function etapeSuivantePermise(
  etape: EtapeDEcriture,
  elements: readonly ElementDeProduction[],
  types: readonly TypeDeMediaDeRealisation[],
): { ok: true } | { ok: false; raison: string } {
  const chaine = chaineDEcriture(types);
  if (!chaine.includes(etape)) {
    return { ok: false, raison: `l’étape « ${LIBELLES_ETAPES_D_ECRITURE[etape]} » n’existe pas pour cette production (chaîne : ${chaine.map((e) => LIBELLES_ETAPES_D_ECRITURE[e]).join(' → ')}).` };
  }
  void elements;
  return { ok: true };
}

/** Les étapes qu'une retouche invalide : toutes celles qui suivent dans la chaîne. */
export function etapesEnAval(etape: EtapeDEcriture, types: readonly TypeDeMediaDeRealisation[]): EtapeDEcriture[] {
  const chaine = chaineDEcriture(types);
  const rang = chaine.indexOf(etape);
  return rang < 0 ? [] : chaine.slice(rang + 1);
}

/** La prochaine étape à mener : la première de la chaîne qui n'est pas validée. */
export function etapeAMener(elements: readonly ElementDeProduction[], types: readonly TypeDeMediaDeRealisation[]): EtapeDEcriture | null {
  return chaineDEcriture(types).find((e) => etatDeLEtapeDEcriture(elements, e) !== 'valide') ?? null;
}

/* ------------------------------------------------------------------ */
/* 2. La question d'accord                                              */
/* ------------------------------------------------------------------ */

export const REPONSE_VALIDER_L_ETAPE = 'Valider';
export const REPONSE_RETOUCHER_L_ETAPE = 'Retoucher';
export const REPONSE_AUTRES_DIRECTIONS = 'Aucune : proposer d’autres directions';

/** Ce que porte une question d'accord : l'étape et les pièces soumises (leurs identifiants de version). */
export const AccordDEtape = z.object({
  cardId: z.string(),
  /** Un des trois arrêts (25/10/2026) ; les anciennes questions portent encore un nom d'étape, toujours lisible. */
  etape: z.enum([...ETAPES_D_ECRITURE, ...ARRETS_DU_DIRECTEUR]),
  elements: z.array(z.string()),
  /** Arrêt 2 : le prix annoncé du film, en dollars — l'accord le fixe, marge de réparation en plus. */
  prix: z.number().optional(),
  /** Arrêt 2 : les images clés à verser au suivi quand l'accord est donné. */
  images: z.array(z.string()).optional(),
});
export type AccordDEtape = z.infer<typeof AccordDEtape>;

/** « Valider » (ou Oui, Accepter, OK, Lancer), complément libre toléré. */
export function etapeValideeParLaReponse(reponse: string | undefined): boolean {
  return /^\s*(valider|valide|oui|accepter|ok|d['’]accord|lancer)\b/i.test(reponse ?? '');
}

/**
 * La direction retenue par une réponse : la pièce dont le titre OUVRE la réponse
 * (« <titre> » ou « <titre> — précision », forme de la bulle). Jamais une simple
 * inclusion : un titre court (« A ») se lirait dans n'importe quelle phrase.
 */
export function directionChoisie<T extends { id: string; titre: string }>(reponse: string | undefined, directions: readonly T[]): T | null {
  const r = (reponse ?? '').trim().toLowerCase();
  if (!r) return null;
  const parLongueur = [...directions].filter((d) => d.titre.trim()).sort((a, b) => b.titre.length - a.titre.length);
  return (
    parLongueur.find((d) => {
      const t = d.titre.trim().toLowerCase();
      return r === t || (r.startsWith(t) && /^[\s—–:,.-]/.test(r.slice(t.length)));
    }) ?? null
  );
}

function extrait(texte: string, max = 220): string {
  const propre = texte.replace(/\s+/g, ' ').trim();
  return propre.length > max ? `${propre.slice(0, max - 1)}…` : propre;
}

export const REPONSE_LANCER_LA_FABRICATION = 'Valider et lancer la fabrication';
export const REPONSE_VALIDER_LE_FILM = 'Valider le film';

/**
 * LA QUESTION D'UN DES TROIS ARRÊTS (25/10/2026).
 *  - IDÉE : le brief et les deux ou trois directions ensemble ; choisir une
 *    direction vaut accord sur l'idée entière. Sans direction (un son seul), on
 *    valide ou on retouche le brief.
 *  - IMAGES CLÉS : le prix du film et son plafond (marge de réparation
 *    comprise) ; « Valider et lancer la fabrication » est le geste de lancement.
 *  - RENDU : le film monté, lisible depuis l'option ; valider ou retoucher en
 *    disant ce qui change.
 */
export function questionDAccordDArret(e: {
  arret: ArretDuDirecteur;
  directions?: readonly Pick<ElementDeProduction, 'id' | 'titre' | 'contenu' | 'cle'>[];
  pieces?: readonly Pick<ElementDeProduction, 'titre'>[];
  resume?: string;
  images?: Record<string, string>;
  prix?: number;
  plafond?: number;
  film?: string;
  /** La voix d'essai (pièce jointe son) que l'arrêt 2 fait écouter : son accord vaut validation des textes. */
  voix?: string;
}): { question: string; description: string; options: { label: string; description: string; image?: string; media?: string }[] } {
  const resume = (e.resume ?? '').trim();
  if (e.arret === 'idee') {
    const directions = e.directions ?? [];
    if (directions.length >= 2) {
      return {
        question: 'Quelle idée retenez-vous ?',
        description: [
          resume,
          'Le brief est lisible dans le suivi à droite. Choisir une direction vaut accord sur l’idée entière : le directeur écrit ensuite seul le scénario, le storyboard et les plans, puis revient avec les images clés et le prix du film. Une précision libre est reprise telle quelle. Rien n’est dépensé.',
        ]
          .filter(Boolean)
          .join(' '),
        options: [
          ...directions.map((p) => ({
            label: p.titre,
            description: extrait(p.contenu),
            ...(e.images?.[p.cle] ? { image: e.images[p.cle] } : {}),
          })),
          { label: REPONSE_AUTRES_DIRECTIONS, description: 'Aucune ne convient : le directeur en propose de nouvelles.' },
        ],
      };
    }
    return {
      question: 'Validez-vous l’idée ?',
      description: [resume, 'Le brief est lisible dans le suivi à droite. Valider laisse le directeur écrire seul la suite, jusqu’au prix. Rien n’est dépensé.'].filter(Boolean).join(' '),
      options: [
        { label: REPONSE_VALIDER_L_ETAPE, description: 'C’est bon, le directeur écrit la suite.' },
        { label: REPONSE_RETOUCHER_L_ETAPE, description: 'Dites ce qu’il faut changer : une nouvelle version sera écrite.' },
      ],
    };
  }
  if (e.arret === 'images-cles') {
    const prix = e.prix ?? 0;
    const plafond = e.plafond ?? prix;
    const nombre = (e.pieces ?? []).length;
    const voix = e.voix ? 'Écoutez la voix d’essai (bouton lecture) : valider vaut accord sur les textes dits, la voix finale est fabriquée ensuite. ' : '';
    const gratuit = prix <= 0;
    return {
      question: gratuit ? 'Lancer la fabrication ?' : `Lancer la fabrication pour ${montant(prix)} $ ?`,
      description: [
        resume,
        `${nombre ? `Scénario, storyboard et ${nombre} pièce(s) à fabriquer sont lisibles dans le suivi à droite ; les images clés sont dans le fil. ` : ''}${voix}${
          gratuit
            ? 'Tout se fabrique sur notre serveur, sans aucun frais de génération. Valider lance la fabrication ici même : le directeur revient avec le film monté.'
            : `Prix annoncé : ${montant(prix)} $. Pour réparer seul une panne (un nouvel essai, un autre outil), le directeur peut aller jusqu’à ${montant(plafond)} $, soit 30 % de marge ; au-delà, il vous demande. Valider lance la fabrication ici même : il revient avec le film monté.`
        }`,
      ]
        .filter(Boolean)
        .join(' '),
      options: [
        { label: REPONSE_LANCER_LA_FABRICATION, description: gratuit ? 'La fabrication part tout de suite, sans frais.' : `La fabrication part tout de suite, ${montant(plafond)} $ au plus.`, ...(e.voix ? { media: e.voix } : {}) },
        { label: REPONSE_RETOUCHER_L_ETAPE, description: 'Dites ce qu’il faut changer avant de dépenser : une nouvelle version sera écrite.' },
      ],
    };
  }
  return {
    question: 'Le film vous convient-il ?',
    description: [resume, 'Valider livre l’export final sous la réponse. Pour retoucher, dites ce qui change (un plan, un texte, le rythme, la musique, un format) : le directeur l’applique et vous le remontre.']
      .filter(Boolean)
      .join(' '),
    options: [
      { label: REPONSE_VALIDER_LE_FILM, description: 'C’est bon : l’export final est livré.', ...(e.film ? { media: e.film } : {}) },
      { label: REPONSE_RETOUCHER_L_ETAPE, description: 'Dites ce qui change : le directeur retouche le montage.' },
    ],
  };
}

function montant(n: number): string {
  return n < 1 ? n.toFixed(2) : (Math.round(n * 100) / 100).toString();
}

/* ------------------------------------------------------------------ */
/* 2 bis. Ce que le directeur sait fabriquer, et ce qu'on lui fournit  */
/* ------------------------------------------------------------------ */

/** Ce qu'un plan déclare sans rien générer : une capture réelle, un titre, une incrustation faite au montage. */
export const CAPACITE_DU_MONTAGE = 'montage';

/** La capacité qu'un plan déclare, sur sa ligne « Capacité : … » (minuscules, sans accent). */
export function capaciteDuPlan(contenu: string): string | null {
  const m = /capacit[ée]\s*:\s*([a-zà-ÿ-]+)/i.exec(contenu ?? '');
  if (!m) return null;
  return m[1]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * LES PLANS QUE PERSONNE NE SAIT FABRIQUER : une capacité non déclarée, ou
 * déclarée mais qu'aucun service branché ne couvre. La carte « présentation
 * avec avatar » s'était arrêtée là, découvert APRÈS le lancement : désormais
 * l'outil refuse d'écrire de tels plans dès le cadrage.
 */
export function plansSurCapaciteAbsente(
  plans: readonly { titre: string; contenu: string }[],
  branchees: readonly string[],
): { titre: string; capacite: string | null }[] {
  return plans
    .map((p) => ({ titre: p.titre, capacite: capaciteDuPlan(p.contenu) }))
    .filter((p) => p.capacite === null || (p.capacite !== CAPACITE_DU_MONTAGE && !branchees.includes(p.capacite)));
}

const sansAccent = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Les pièces que le brief demande à l'utilisateur (« Pièces à fournir : photo du présentateur ; logo »). « aucune » n'en demande pas. */
export function piecesAFournir(champs: readonly ChampRempli[]): string[] {
  const valeur = champs.find((c) => c.champ === 'pieces')?.valeur ?? '';
  return valeur
    .split(/[;\n]|,(?![^(]*\))/)
    .map((x) => x.trim())
    .filter((x) => x && !/^(aucune?s?|rien|sans objet|néant)\b/i.test(x));
}

/**
 * LES PIÈCES ENCORE ATTENDUES : chaque pièce du brief doit avoir sa pièce
 * reçue (élément « reference » écrit par l'action « piece_recue ») dont le
 * titre la nomme. Tant que la liste n'est pas vide, l'arrêt 2 est refusé :
 * rien ne se dépense sur une vidéo qui manque de sa photo.
 */
export function piecesAFournirManquantes(champs: readonly ChampRempli[], elements: readonly ElementDeProduction[]): string[] {
  const recues = elementsCourants(elements)
    .filter((e) => e.genre === 'reference' && e.cle.startsWith(PREFIXE_DES_PIECES_RECUES))
    .map((e) => sansAccent(e.titre));
  return piecesAFournir(champs).filter((p) => {
    const nom = sansAccent(p);
    return !recues.some((r) => r === nom || r.includes(nom) || nom.includes(r));
  });
}

/** La clé d'une pièce reçue : « piece-<nom> ». */
export const PREFIXE_DES_PIECES_RECUES = 'piece-';

/* ------------------------------------------------------------------ */
/* 3. Le brief et son formulaire                                        */
/* ------------------------------------------------------------------ */

export const CHAMPS_DU_BRIEF = [
  'objectif',
  'public',
  'message',
  'accroche',
  'format',
  'duree',
  'ton',
  'references',
  'appel',
  'pieces',
  'contraintes',
  'echeance',
  /* Ce qu'une VIDÉO fait entendre (26/10/2026) : prévu ici, fabriqué au second temps des esquisses, exigé avant le montage. */
  'voix',
  'musique',
] as const;
export type ChampDuBrief = (typeof CHAMPS_DU_BRIEF)[number];

export const LIBELLES_CHAMPS_DU_BRIEF: Record<ChampDuBrief, string> = {
  objectif: 'Objectif',
  public: 'Public',
  message: 'Message clé',
  accroche: 'Accroche',
  format: 'Formats',
  duree: 'Durée',
  ton: 'Ton',
  references: 'Références',
  appel: 'Appel à l’action',
  pieces: 'Pièces à fournir',
  contraintes: 'Contraintes',
  echeance: 'Échéance',
  voix: 'Voix off',
  musique: 'Musique',
};

/** D'où vient une valeur : la phrase de départ, une réponse au formulaire, ou une déduction du responsable créatif. */
export const SOURCES_DU_BRIEF = ['demande', 'reponse', 'deduit'] as const;
export type SourceDuBrief = (typeof SOURCES_DU_BRIEF)[number];
const LIBELLES_SOURCES: Record<SourceDuBrief, string> = { demande: 'tiré de la demande', reponse: 'réponse', deduit: 'déduit' };

export interface ChampRempli {
  champ: ChampDuBrief;
  valeur: string;
  source: SourceDuBrief;
}

/** Un nom de champ lu avec tolérance (accents, casse, libellé ou identifiant). */
export function champDuBrief(brut: unknown): ChampDuBrief | null {
  const s = String(brut ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
  if (!s) return null;
  const direct = CHAMPS_DU_BRIEF.find((c) => c === s.replace(/ /g, ''));
  if (direct) return direct;
  return (
    CHAMPS_DU_BRIEF.find((c) => {
      const libelle = LIBELLES_CHAMPS_DU_BRIEF[c].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
      return libelle === s;
    }) ?? null
  );
}

/** Le brief écrit lisible ET relisible : une ligne par champ, sa source entre parenthèses (texte brut, le suivi l'affiche tel quel). */
export function briefEnMarkdown(champs: readonly ChampRempli[], notes = ''): string {
  const lignes = CHAMPS_DU_BRIEF.flatMap((c) => {
    const x = champs.find((f) => f.champ === c);
    return x && x.valeur.trim() ? [`- ${LIBELLES_CHAMPS_DU_BRIEF[c]} : ${x.valeur.replace(/\s+/g, ' ').trim()} (${LIBELLES_SOURCES[x.source]})`] : [];
  });
  return [...lignes, ...(notes.trim() ? ['', notes.trim()] : [])].join('\n');
}

/** Relit les champs d'un brief écrit par `briefEnMarkdown`. */
export function champsDuBrief(markdown: string | null | undefined): ChampRempli[] {
  const champs: ChampRempli[] = [];
  for (const ligne of String(markdown ?? '').split('\n')) {
    const m = /^-\s+(.+?)\s:\s(.+?)(?:\s\((tiré de la demande|réponse|déduit)\))?\s*$/.exec(ligne);
    if (!m) continue;
    const champ = champDuBrief(m[1]);
    if (!champ || champs.some((c) => c.champ === champ)) continue;
    const source = (Object.entries(LIBELLES_SOURCES).find(([, l]) => l === m[3])?.[0] ?? 'deduit') as SourceDuBrief;
    champs.push({ champ, valeur: m[2]!.trim(), source });
  }
  return champs;
}

/** Les notes libres d'un brief : ce qui suit la liste des champs. */
export function notesDuBrief(markdown: string | null | undefined): string {
  const lignes = String(markdown ?? '').split('\n');
  const debut = lignes.findIndex((l) => l.trim() && !/^-\s+.+?\s:\s/.test(l));
  return debut < 0 ? '' : lignes.slice(debut).join('\n').trim();
}

/**
 * UN BRIEF CORRIGÉ À LA MAIN, REMIS EN FORME RELISIBLE (suivi de production,
 * 25/10/2026). L'utilisateur retouche le texte du brief dans le suivi : chaque
 * ligne « - Champ : valeur » reconnue redevient un champ, et TOUT le reste — une
 * ligne au format cassé, un champ inconnu, un paragraphe glissé entre deux
 * champs — part en notes, dans l'ordre. Rien de ce qu'il a écrit ne se perd, et
 * la prochaine action « brief » de l'agent, qui refusionne depuis ce texte
 * (`champsDuBrief` + `notesDuBrief`), relit exactement sa correction.
 */
export function briefCorrige(markdown: string): string {
  const champs: ChampRempli[] = [];
  const notes: string[] = [];
  for (const ligne of String(markdown ?? '').split('\n')) {
    const relu = champsDuBrief(ligne)[0];
    if (relu && !champs.some((c) => c.champ === relu.champ)) champs.push(relu);
    else notes.push(ligne);
  }
  return briefEnMarkdown(champs, notes.join('\n'));
}

/** La consigne d'une pièce désignée par « [pièce: Titre · clé] » dans un message, servie au responsable créatif. */
export const REGLE_DE_LA_PIECE_DESIGNEE =
  'UNE PIÈCE DÉSIGNÉE : un message qui porte « [pièce: Titre · clé] » vise CETTE pièce du suivi. Relis-la en entier (« production » action « lire », « cle »), applique la correction demandée avec l’action « modifier » sur la même clé (texte ENTIER de la nouvelle version), sans réécrire l’étape ni les autres pièces, puis dis en une phrase ce qui a changé et quelles étapes sont à revalider. Une version écrite « par vous » dans le suivi est une correction de l’utilisateur : elle fait foi, ne la défais jamais.';

/** Fusionne des valeurs nouvelles dans un brief : une valeur donnée remplace l'ancienne, une valeur vide ne retire rien. */
export function fusionnerLeBrief(avant: readonly ChampRempli[], apres: readonly ChampRempli[]): ChampRempli[] {
  const parChamp = new Map(avant.map((c) => [c.champ, c] as const));
  for (const c of apres) if (c.valeur.trim()) parChamp.set(c.champ, c);
  return CHAMPS_DU_BRIEF.flatMap((c) => (parChamp.has(c) ? [parChamp.get(c)!] : []));
}

export const QUESTIONS_DU_FORMULAIRE_MIN = 3;
export const QUESTIONS_DU_FORMULAIRE_MAX = 5;

/** UNE question du formulaire groupé : un champ du brief, ses choix suggérés, et toujours une réponse libre. */
export const QuestionDuFormulaire = z.object({
  id: z.string(),
  champ: z.enum(CHAMPS_DU_BRIEF).optional(),
  question: z.string(),
  description: z.string().optional(),
  kind: z.enum(['single', 'multiple']).default('single'),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).default([]),
});
export type QuestionDuFormulaire = z.infer<typeof QuestionDuFormulaire>;

export const FormulaireDeQuestions = z.object({
  questions: z.array(QuestionDuFormulaire).min(1).max(QUESTIONS_DU_FORMULAIRE_MAX),
});
export type FormulaireDeQuestions = z.infer<typeof FormulaireDeQuestions>;

/**
 * LES QUESTIONS QUI PARTENT VRAIMENT. Une question dont le champ a déjà sa
 * réponse dans le brief enregistré (tirée de la demande ou d'un formulaire
 * précédent) est ÉCARTÉE : on ne repose jamais une question déjà répondue.
 * Deux questions sur un même champ n'en font qu'une.
 */
export function questionsDuFormulaire(
  questions: readonly Omit<QuestionDuFormulaire, 'id'>[],
  connus: readonly ChampRempli[],
): { posees: QuestionDuFormulaire[]; ecartees: { question: string; champ: ChampDuBrief; valeur: string }[] } {
  const posees: QuestionDuFormulaire[] = [];
  const ecartees: { question: string; champ: ChampDuBrief; valeur: string }[] = [];
  const vus = new Set<ChampDuBrief>();
  for (const q of questions) {
    if (!q.question.trim()) continue;
    const connu = q.champ ? connus.find((c) => c.champ === q.champ && c.valeur.trim()) : undefined;
    if (q.champ && connu) {
      ecartees.push({ question: q.question, champ: q.champ, valeur: connu.valeur });
      continue;
    }
    if (q.champ && vus.has(q.champ)) continue;
    if (q.champ) vus.add(q.champ);
    posees.push({ ...q, id: `q${posees.length}`, options: q.options.slice(0, 6) });
    if (posees.length >= QUESTIONS_DU_FORMULAIRE_MAX) break;
  }
  return { posees, ecartees };
}

/** La réponse d'une question du formulaire, telle que l'écran la tient. */
export interface ReponseDuFormulaire {
  choix: string[];
  texte: string;
}


/**
 * LES RÉPONSES RENDUES ENSEMBLE à l'agent, en un seul texte : une ligne par
 * question, dans l'ordre, et « (sans réponse) » pour une question laissée vide —
 * l'agent ne devine pas, il la garde pour plus tard.
 */
export function reponseDuFormulaire(questions: readonly QuestionDuFormulaire[], reponses: Record<string, ReponseDuFormulaire | undefined>): string {
  return questions
    .map((q, i) => {
      const r = reponses[q.id];
      const morceaux = [...(r?.choix ?? []), (r?.texte ?? '').trim()].filter(Boolean);
      const champ = q.champ ? ` [${q.champ}]` : '';
      return `${i + 1}. ${q.question}${champ} → ${morceaux.length ? morceaux.join(' — ') : '(sans réponse)'}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* 4. Les versions                                                      */
/* ------------------------------------------------------------------ */

/** Toutes les versions d'une clé, de la plus récente à la plus ancienne. */
export function versionsDeLaCle(elements: readonly ElementDeProduction[], cle: string): ElementDeProduction[] {
  return elements.filter((e) => e.cle === cle).sort((a, b) => b.version - a.version);
}

/**
 * REVENIR À UNE VERSION, C'EST EN ÉCRIRE UNE NOUVELLE avec son contenu — rien
 * ne s'efface. Rien à écrire quand la version en cours a déjà ce contenu
 * (double clic, deuxième envoi) : le geste est idempotent.
 */
export function retourAVersion(
  versions: readonly ElementDeProduction[],
  version: number,
): { verdict: 'ecrire'; cible: ElementDeProduction; courante: ElementDeProduction } | { verdict: 'deja'; courante: ElementDeProduction } | { verdict: 'introuvable' } {
  const triees = [...versions].sort((a, b) => b.version - a.version);
  const courante = triees[0];
  const cible = triees.find((v) => v.version === version);
  if (!courante || !cible) return { verdict: 'introuvable' };
  if (cible.version === courante.version || (cible.contenu === courante.contenu && cible.titre === courante.titre)) return { verdict: 'deja', courante };
  return { verdict: 'ecrire', cible, courante };
}

/* ------------------------------------------------------------------ */
/* 5. L'état de la production, relu sans la conversation               */
/* ------------------------------------------------------------------ */

const LIBELLES_ETATS: Record<EtatDEtapeDEcriture, string> = {
  vide: 'pas encore écrite',
  propose: 'écrite',
  'a-valider': 'soumise, attend la réponse',
  valide: 'validée',
};

/**
 * L'ÉTAT DE LA PRODUCTION EN TEXTE, pour l'agent : la chaîne et l'état de
 * chaque étape, le brief, chaque pièce (clé, version, état), et la prochaine
 * étape à mener. C'est ce qu'on lui redonne à la reprise, à la place de la
 * conversation.
 */
export function resumeDeLaProduction(elements: readonly ElementDeProduction[], types: readonly TypeDeMediaDeRealisation[]): string {
  const etats = etatsDesEtapesDEcriture(elements, types);
  const prochaine = etapeAMener(elements, types);
  const arret = arretAMener(elements, types);
  const manquantes = piecesAFournirManquantes(champsDuBrief(elementsCourants(elements).find((e) => e.genre === 'brief')?.contenu), elements);
  const courants = elementsCourants(elements);
  const brief = courants.find((e) => e.genre === 'brief');
  const pieces = courants
    .filter((e) => e.genre !== 'brief')
    .map((e) => `- ${e.genre} « ${e.titre} » (clé « ${e.cle} », v${e.version}, ${e.etat})`);
  void arret;
  return [
    `ÉCRIT : ${etats.map((x) => `${LIBELLES_ETAPES_D_ECRITURE[x.etape]} — ${LIBELLES_ETATS[x.etat]}`).join(' ; ')}${prochaine ? ` — prochaine pièce à écrire au brief : ${LIBELLES_ETAPES_D_ECRITURE[prochaine]}` : ''}.`,
    manquantes.length ? `PIÈCES À FOURNIR ENCORE ATTENDUES : ${manquantes.join(' ; ')} — si elles sont DÉJÀ arrivées (jointes à un message ou à une réponse, ou parmi ce que tu as vu), note-les TOI-MÊME avec « piece_recue » (identifiant ou alias « #xxxx ») ; sinon demande-les avec « ask_user ». Ne redemande JAMAIS une pièce déjà reçue.` : '',
    `BRIEF${brief ? ` (v${brief.version}, ${brief.etat})` : ''} :\n${brief?.contenu.trim() || '(pas encore écrit)'}`,
    `PIÈCES :\n${pieces.length ? pieces.join('\n') : '(aucune)'}`,
  ]
    .filter(Boolean)
    .join('\n');
}
