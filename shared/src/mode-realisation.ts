/**
 * LE MODE « RÉALISATION » (bouton caméra, carte du 18/10/2026) — règles PURES.
 *
 * L'interrupteur vit SUR LA CARTE (`parcours.realisationSouhaitee`), éteint à
 * la naissance. Allumé, la carte suit LE MÊME PARCOURS QUE LE CAHIER DES
 * CHARGES (`cahier-des-charges.ts`, décision de l'utilisateur du 18/10/2026) :
 *  - un VOLET À PART (`estVoletDeRealisation`) : avec SIX étapes, les mêmes
 *    dans la barre et dans le suivi de la production, du premier message à la
 *    fin (`etapesDuMedia`, `etapes-du-media.ts`, 25/10/2026), et un bouton qui
 *    suit l'étape (`boutonDuMedia`) : il RÉPOND à la question d'accord du
 *    directeur — le bouton « Lancer la fabrication » d'avant a disparu le
 *    25/10/2026 —, plus de bandeau ni de pause dans l'interface
 *    (21/10/2026). La barre d'écriture n'y existe que tant qu'aucun type de
 *    média n'est choisi, en pause et une fois le cahier terminé
 *    (`barreDEcritureDuVoletDeRealisation`) ;
 *  - ALLUMER NE LANCE RIEN ET N'OUVRE PAS LE VOLET : le bouton pose seulement
 *    le mode, le volet attend le premier message parti (`demandeA`). L'utilisateur
 *    choisit d'abord ce qu'il veut obtenir dans le MENU DU BOUTON CAMÉRA, avant
 *    l'envoi (vidéo, image ou son — décision du 25/10/2026 : jamais dans la
 *    discussion ; on demande le RÉSULTAT, pas les ingrédients ; une vidéo
 *    comprend d'office ses images, son animation, sa voix, sa musique, ses
 *    bruitages et son montage). Le choix s'écrit sur la carte (`medias`) ;
 *  - L'ÉTAT VIT SUR LA CARTE (`Card.realisation`), jamais déduit des messages
 *    (MEM-0370) : le cadrage le réécrit après CHAQUE réponse avec le document
 *    (outil `cahier_de_realisation`, `docs/realisation/<carte>.md` du projet),
 *    et c'est lui qui permet de reprendre après une pause ;
 *  - DEPUIS LE 25/10/2026, UN DIRECTEUR ARTISTIQUE GUIDE TOUT dans une seule
 *    conversation, en TROIS ARRÊTS (idée, images clés et prix, film monté —
 *    `shared/src/responsable-creatif.ts`). Plus de bouton « Lancer la
 *    fabrication » ni de question de budget, de seuil ou de tentatives :
 *    l'enveloppe d'aperçus est posée d'office à 1 $, et l'accord de l'arrêt 2
 *    fixe le budget au prix annoncé plus 30 % de marge de réparation
 *    (`plafondDeFabrication`), puis LANCE le tour de tâche ;
 *  - l'agent de TÂCHE reçoit l'outil « realiser » et la méthode du réalisateur
 *    (`consigneDeFabrication`) : il fabrique SANS s'arrêter, les lots qui
 *    tiennent dans le prix accordé partent d'office (`decisionDuLot`), une
 *    panne se répare seule dans la marge (`issueDePanne`), et il revient avec
 *    le film monté (arrêt 3).
 *
 * Le savoir-faire vient des bibliothèques de réalisation à licence libre,
 * importées comme compétences (OSideMedia, Higgsfield, HeyGen, SeaArt, Pixelab,
 * Visual Skills). Celles sans licence ou sous licence restrictive (fal-ai
 * community, skillpack, remotion, OpenMontage) n'ont été qu'étudiées : leurs
 * idées sont REFORMULÉES ici (fiche de production → scènes → plans → éléments →
 * générations → contrôle qualité), rien n'en est recopié.
 */

import { z } from 'zod';
import type { RubriqueDuCahier } from './cahier-vivant.js';
import { COLONNES_AVANT_LE_TRAVAIL } from './columns.js';
import { MARQUE_A_VOIR, estVoletDuCahier, partiesDuCahier } from './cahier-des-charges.js';
import { REGLE_DES_PISTES } from './pistes-de-question.js';
import { REGLE_DE_LA_PIECE_DESIGNEE } from './responsable-creatif.js';

/**
 * Les rubriques FIXES du cahier d'un média, dans cet ordre. Elles suivent la
 * chaîne d'une production publicitaire — brief, direction artistique, plans,
 * montage, droits, contrôle, devis — et pas seulement le brief et le
 * storyboard : un cahier qui s'arrête au scénario laisse le générateur deviner.
 * Une rubrique sans objet pour le média (un son pour une image) s'écrit
 * « Sans objet : <raison> » : elle n'est jamais omise.
 */
export const RUBRIQUES_DE_REALISATION = [
  'Intention',
  'Format et livrables',
  'Scénario et découpage',
  'Direction artistique',
  'Personnages et continuité',
  'Plan par plan',
  'Son',
  'Montage et incrustations',
  'Droits et conformité',
  'Contrôle qualité',
  'Devis prévisionnel',
  'Budget et seuil',
] as const;

/** Les compétences importées que la méthode cite par leur nom. */
export const COMPETENCES_DE_REALISATION =
  'les compétences des bibliothèques de réalisation importées le 18/10/2026 (OSideMedia, higgsfield-ai, heygen-com, seaartpublic, pixelab-ch, smixs) — notamment « higgsfield » (méthode d’ensemble), « higgsfield-shotlist-director » et « storyboard-prompt-assistant » (découpage en plans), « higgsfield-camera », « higgsfield-style » et « higgsfield-motion » (cadrage, lumière, mouvement), « higgsfield-character-design » et « higgsfield-soul » (personnages cohérents), « higgsfield-troubleshoot » (plans ratés), les recettes par genre de pixelab (« higgsfield-cinematic », « higgsfield-ecommerce-ad », « higgsfield-social-hook », « higgsfield-brand-story », « higgsfield-real-estate »…), « heygen-video », « heygen-avatar » et « heygen-translate » (présentateur et langues), « image » et « video » de visual-skills (consignes d’image et de vidéo, licence CC-BY : attribution à Serge Shima). Ouvre-les avec l’outil « memoire » (« chercher » par leur nom)';

/* ------------------------------------------------------------------ */
/* L'état du questionnaire, sur la carte                               */
/* ------------------------------------------------------------------ */

/**
 * Les types de média qu'on peut fabriquer. La première question n'en propose
 * plus que TROIS (`CHOIX_DE_DEPART` : vidéo, image, son) ; « musique », « voix »
 * et « bruitages » restent LUS pour les cartes commencées avec l'ancienne liste
 * à cases, et servent à préciser un son seul après le brief.
 */
export const TYPES_DE_MEDIA_DE_REALISATION = ['image', 'video', 'musique', 'voix', 'bruitages', 'son'] as const;
export type TypeDeMediaDeRealisation = (typeof TYPES_DE_MEDIA_DE_REALISATION)[number];

/** LA RÉPONSE À LA PREMIÈRE QUESTION : ce qu'on veut obtenir, un seul choix (24/10/2026). */
export const CHOIX_DE_DEPART = ['video', 'image', 'son'] as const satisfies readonly TypeDeMediaDeRealisation[];

export const LIBELLES_TYPES_DE_MEDIA_DE_REALISATION: Record<TypeDeMediaDeRealisation, string> = {
  image: 'Image',
  video: 'Vidéo',
  musique: 'Musique',
  voix: 'Voix off',
  bruitages: 'Bruitages',
  son: 'Son',
};

/** Ce que chaque choix veut dire, sous son libellé. */
export const DESCRIPTIONS_TYPES_DE_MEDIA_DE_REALISATION: Record<TypeDeMediaDeRealisation, string> = {
  image: 'Une ou plusieurs images fixes : visuel, affiche, illustration.',
  video: 'Un film : publicité, clip, accroche, présentation. Tout est compris : storyboard, images des plans, animation, voix, musique, bruitages et montage.',
  musique: 'Une musique originale : jingle, fond sonore, titre complet.',
  voix: 'Une voix qui lit un texte : voix off, narration, annonce.',
  bruitages: 'Des sons et ambiances : effets, bruits de fond.',
  son: 'Un son seul : musique, voix off ou bruitages, précisé ensuite dans le brief.',
};

/**
 * L'ANCIEN « genre » (image, vidéo, les deux), répondu par l'écran avant que la
 * question passe dans la discussion. Il reste LU pour les cartes déjà
 * commencées, jamais écrit.
 */
export const GENRES_DE_REALISATION = ['image', 'video', 'les-deux'] as const;

/** Les phases du questionnaire, une par rubrique du document, dans cet ordre. */
export const PHASES_DE_REALISATION = [
  'intention',
  'format',
  'scenario',
  'direction',
  'personnages',
  'plans',
  'son',
  'montage',
  'droits',
  'controle',
  'devis',
  'budget',
] as const;
export type PhaseDeRealisation = (typeof PHASES_DE_REALISATION)[number];

export const LIBELLES_PHASES_DE_REALISATION = Object.fromEntries(
  PHASES_DE_REALISATION.map((phase, index) => [phase, RUBRIQUES_DE_REALISATION[index]!]),
) as Record<PhaseDeRealisation, string>;

/** Une vignette du tableau d'ambiance : la pièce jointe, la rubrique qu'elle illustre, sa légende. */
export const PieceDAmbiance = z.object({
  piece: z.string(),
  phase: z.enum(PHASES_DE_REALISATION),
  legende: z.string().optional(),
  at: z.number(),
});
export type PieceDAmbiance = z.infer<typeof PieceDAmbiance>;

/** L'état écrit sur la carte (`Card.realisation`), calqué sur `CahierDesCharges`. */
export const EtatDeRealisation = z.object({
  /** La réponse à la première question : les types de média voulus. Vide : elle n'est pas encore tranchée. */
  medias: z.array(z.enum(TYPES_DE_MEDIA_DE_REALISATION)).default([]),
  /** Ancienne réponse (cartes commencées avant que la question passe dans la discussion) : lue, jamais écrite. */
  genre: z.enum(GENRES_DE_REALISATION).optional(),
  /** Questions déjà tranchées (les types de média compris). */
  faites: z.number().int().nonnegative().default(0),
  /** Questions prévues en tout, ajusté en chemin. 0 : pas encore estimé. */
  total: z.number().int().nonnegative().default(0),
  phase: z.enum(PHASES_DE_REALISATION).default('intention'),
  /** Ce qui reste à voir, en mots courants — c'est ce que la reprise relit. */
  restants: z.array(z.string()).default([]),
  /** Dernière écriture du document. */
  majA: z.number().optional(),
  /** Posée par « Mettre en pause », effacée par « Reprendre » ou un nouveau message. */
  enPauseA: z.number().optional(),
  /** Toutes les questions sont tranchées : la fabrication peut être lancée. */
  termineA: z.number().optional(),
  /**
   * LE PREMIER MESSAGE PARTI EN MODE RÉALISATION. Posée par le démon quand un
   * tour de cadrage emporte la consigne du mode : c'est elle, et non
   * l'interrupteur, qui ouvre le volet (`estVoletDeRealisation`).
   */
  demandeA: z.number().optional(),
  /**
   * L'ENVELOPPE D'APERÇUS, en dollars (décision de l'utilisateur du 22/10/2026) :
   * demandée juste après les types de média, acceptée d'un clic. Elle paie les
   * images d'essai fabriquées PENDANT le questionnaire (`decisionDApercu`),
   * à part du budget principal, qui reste la dernière question. Absente : pas
   * encore demandée ; 0 : refusée (aucun aperçu).
   */
  enveloppe: z.number().nonnegative().optional(),
  /**
   * LE TABLEAU D'AMBIANCE : les vignettes retenues pendant le questionnaire
   * (un choix en images tranché, un aperçu gardé), chacune avec la rubrique
   * qu'elle illustre. Absent sur les cartes d'avant.
   */
  ambiance: z.array(PieceDAmbiance).optional(),
  /**
   * LE MONTAGE A COMMENCÉ (décision de l'utilisateur du 22/10/2026) : posée par
   * le démon quand l'agent de tâche annonce l'assemblage (« realiser » action
   * « monter »), ou à défaut au premier fichier monté rangé (« ajouter »). Elle
   * allume l'étape « Montage » du chemin du tournage tant que la carte travaille.
   */
  montageA: z.number().optional(),
  /**
   * LE FILM MONTÉ EST SOUMIS (arrêt 3 du directeur, `production` action
   * « soumettre », étape « rendu ») : l'étape « Film monté » attend l'accord.
   */
  filmSoumisA: z.number().optional(),
  /** « Valider le film » a été répondu : l'export final part, puis « Terminer » range la carte. */
  filmValideA: z.number().optional(),
});
export type EtatDeRealisation = z.infer<typeof EtatDeRealisation>;

export function realisationNeuve(): EtatDeRealisation {
  return { medias: [], faites: 0, total: 0, phase: 'intention', restants: [] };
}

/** L'état de la carte, ou un état neuf pour une carte allumée avant qu'il n'existe. */
export function realisationDeLaCarte(carte: { realisation?: EtatDeRealisation | null } | null | undefined): EtatDeRealisation {
  return carte?.realisation ?? realisationNeuve();
}

/** Les types de média choisis : la réponse actuelle, ou l'ancien « genre » traduit. */
export function typesDeMediaDeLaRealisation(
  r: { medias?: readonly TypeDeMediaDeRealisation[]; genre?: (typeof GENRES_DE_REALISATION)[number] } | null | undefined,
): TypeDeMediaDeRealisation[] {
  if (r?.medias?.length) return [...r.medias];
  if (r?.genre === 'image') return ['image'];
  if (r?.genre === 'video') return ['video'];
  if (r?.genre === 'les-deux') return ['image', 'video'];
  return [];
}

/** Les libellés des types choisis, « Image + Vidéo + Musique ». */
export function libelleDesTypesDeMedia(types: readonly TypeDeMediaDeRealisation[]): string {
  return types.map((type) => LIBELLES_TYPES_DE_MEDIA_DE_REALISATION[type]).join(' + ');
}

/**
 * LE VOLET DE RÉALISATION : la caméra allumée sur une carte qui n'est pas encore
 * au travail, ET UNE DEMANDE DÉJÀ PARTIE dans ce mode. UN SEUL PRÉDICAT pour
 * tous les écrans. Allumer le bouton ne fait QUE poser le mode (décision de
 * l'utilisateur du 19/10/2026) : la conversation reste ordinaire, avec sa barre
 * d'écriture, jusqu'au premier envoi — c'est ce message qui lance l'analyse et
 * ouvre le volet. Une carte dont le questionnaire a déjà commencé (types
 * choisis, cahier terminé) garde son volet même sans `demandeA` (cartes
 * d'avant). Une fois la fabrication lancée, la carte redevient une carte
 * ordinaire (l'agent de tâche y parle). Le cahier des charges d'un nouveau
 * projet garde son propre volet.
 */
export function estVoletDeRealisation(
  carte:
    | {
        parcours?: { realisationSouhaitee?: boolean } | null;
        column?: string;
        cahierDesCharges?: unknown;
        archivedAt?: number | null;
        realisation?: Partial<Pick<EtatDeRealisation, 'demandeA' | 'medias' | 'genre' | 'termineA' | 'faites'>> | null;
      }
    | null
    | undefined,
): boolean {
  if (!carte?.parcours?.realisationSouhaitee || carte.cahierDesCharges || carte.archivedAt) return false;
  if (!(COLONNES_AVANT_LE_TRAVAIL as readonly string[]).includes(String(carte.column ?? ''))) return false;
  /* RIEN NE S'OUVRE À DROITE TANT QUE LE TYPE N'EST PAS DÉFINI (décision du
     25/10/2026) : il faut le type ET une demande partie — ou un cahier terminé. */
  const r = carte.realisation;
  if (r?.termineA) return true;
  return !!typesDeMediaDeLaRealisation(r).length && !!(r?.demandeA || r?.faites);
}

/**
 * LA BARRE D'ÉCRITURE DU VOLET : tant qu'aucun type de média n'est choisi
 * (l'utilisateur écrit sa demande, et c'est ce message qui lance le cadrage —
 * allumer le mode ne lance rien), une fois le cahier TERMINÉ (sans elle, un
 * cahier imparfait ne pourrait plus être amélioré) et sur un questionnaire
 * EN PAUSE : l'interface n'a plus de bouton de reprise, on reprend en écrivant
 * (`leverLaPauseDeRealisationSurMessage`). Pendant le questionnaire on répond
 * dans le panneau de décision. UN SEUL PRÉDICAT pour l'écran et les contrôles.
 */
export function barreDEcritureDuVoletDeRealisation(
  carte:
    | {
        parcours?: { realisationSouhaitee?: boolean } | null;
        column?: string;
        cahierDesCharges?: unknown;
        archivedAt?: number | null;
        realisation?: EtatDeRealisation | null;
      }
    | null
    | undefined,
): boolean {
  if (!estVoletDeRealisation(carte)) return false;
  const etat = etatDeLaRealisation(realisationDeLaCarte(carte));
  return etat === 'termine' || etat === 'genre' || etat === 'en-pause';
}

export type EtatDuQuestionnaire = 'genre' | 'en-cours' | 'en-pause' | 'termine';

export function etatDeLaRealisation(r: Pick<EtatDeRealisation, 'medias' | 'genre' | 'enPauseA' | 'termineA'>): EtatDuQuestionnaire {
  if (!typesDeMediaDeLaRealisation(r).length) return 'genre';
  if (r.enPauseA) return 'en-pause';
  if (r.termineA) return 'termine';
  return 'en-cours';
}

/**
 * LE FILET D'UN CADRAGE AUDIOVISUEL QUI VEUT SE CLORE SANS CAHIER. Mode allumé,
 * aucun document écrit, cahier pas terminé : rendre la compréhension ferait
 * croire que tout est prêt alors que rien n'est écrit (cas vécu : six questions
 * tranchées, jamais d'appel de l'outil du cahier, « C'est prêt à partir »).
 * L'outil de la compréhension refuse alors, et dit quoi faire.
 */
export function cahierDeRealisationManquant(
  carte: { parcours?: { realisationSouhaitee?: boolean } | null; realisation?: { termineA?: number | null } | null },
  documentEcrit: boolean,
): boolean {
  return !!carte.parcours?.realisationSouhaitee && !carte.realisation?.termineA && !documentEcrit;
}

export const REFUS_COMPREHENSION_SANS_CAHIER =
  'Le mode réalisation est allumé et le cahier n’est pas écrit : ne rends pas de compréhension. Écris le document ENTIER avec « cahier_de_realisation » (avancement, rubriques), puis, une fois tout tranché, rappelle l’outil avec « termine » = vrai.';

/* LA BARRE D'UNE CRÉATION DE MÉDIA (six étapes, du type au film livré) vit
   dans `etapes-du-media.ts` : elle lit aussi les pièces de la production. */

/* ------------------------------------------------------------------ */
/* Le chemin du tournage : sept étapes, une équipe qui se passe le relais */
/* ------------------------------------------------------------------ */

/**
 * LES SEPT ÉTAPES VISIBLES du chemin (décision de l'utilisateur du 22/10/2026) :
 * les douze rubriques du questionnaire se regroupent en quatre étapes avant le
 * lancement (idée, style, scénario, budget), puis la fabrication, le montage
 * et la livraison. Le chemin vit DANS le fil (`chemin-de-realisation.tsx`),
 * jamais en bandeau fixe : le bandeau a été retiré le 21/10/2026.
 */
export const JALONS_DE_REALISATION = ['idee', 'style', 'scenario', 'budget', 'fabrication', 'montage', 'livre'] as const;
export type JalonDeRealisation = (typeof JALONS_DE_REALISATION)[number];

export const LIBELLES_JALONS_DE_REALISATION: Record<JalonDeRealisation, string> = {
  idee: 'Idée',
  style: 'Style',
  scenario: 'Scénario',
  budget: 'Budget',
  fabrication: 'Fabrication',
  montage: 'Montage',
  livre: 'Livré',
};

/**
 * L'ÉQUIPE DE TOURNAGE : UN SEUL agent, le responsable créatif, qui tient SEPT
 * rôles (carte 2 du studio créatif, 24/10/2026) — qui parle à chaque moment du
 * questionnaire, puis de la fabrication. Le rôle se CALCULE depuis la carte
 * (`cheminDeLaRealisation`), il n'est jamais écrit : une carte d'avant, faite
 * avec quatre rôles, se relit donc sans rien migrer.
 */
export const ROLES_DE_REALISATION = [
  'directeur-createur',
  'scenariste',
  'directeur-artistique',
  'realisateur',
  'producteur',
  'ingenieur-son',
  'monteur',
] as const;
export type RoleDeRealisation = (typeof ROLES_DE_REALISATION)[number];

export const LIBELLES_ROLES_DE_REALISATION: Record<RoleDeRealisation, string> = {
  'directeur-createur': 'directeur créatif',
  scenariste: 'scénariste',
  'directeur-artistique': 'directeur artistique',
  realisateur: 'réalisateur',
  producteur: 'producteur',
  'ingenieur-son': 'ingénieur du son',
  monteur: 'monteur',
};

/** L'étape du chemin où se range chaque rubrique du questionnaire. */
export const JALON_DE_LA_PHASE: Record<PhaseDeRealisation, JalonDeRealisation> = {
  intention: 'idee',
  format: 'idee',
  direction: 'style',
  personnages: 'style',
  scenario: 'scenario',
  plans: 'scenario',
  son: 'scenario',
  montage: 'scenario',
  droits: 'scenario',
  controle: 'scenario',
  devis: 'budget',
  budget: 'budget',
};

/**
 * Qui mène chaque rubrique : le directeur créatif ouvre (brief) et ferme (contrôle),
 * le directeur artistique tient la direction, le scénariste l'histoire, le
 * réalisateur les plans, l'ingénieur du son le son, le monteur le montage, le
 * producteur les droits, le devis et le budget.
 */
export const ROLE_DE_LA_PHASE: Record<PhaseDeRealisation, RoleDeRealisation> = {
  intention: 'directeur-createur',
  format: 'directeur-createur',
  direction: 'directeur-artistique',
  personnages: 'directeur-artistique',
  scenario: 'scenariste',
  plans: 'realisateur',
  son: 'ingenieur-son',
  montage: 'monteur',
  droits: 'producteur',
  controle: 'directeur-createur',
  devis: 'producteur',
  budget: 'producteur',
};

/** Qui mène chaque étape une fois le questionnaire passé. */
const ROLE_APRES_LE_QUESTIONNAIRE: Record<'fabrication' | 'montage' | 'livre', RoleDeRealisation> = {
  fabrication: 'realisateur',
  montage: 'monteur',
  livre: 'monteur',
};

export type EtatDUnJalon = 'fait' | 'encours' | 'pret' | 'avenir';

export interface CheminDeRealisation {
  /** L'étape où l'on est. */
  jalon: JalonDeRealisation;
  /** Celui qui parle maintenant. */
  role: RoleDeRealisation;
  /** Les sept étapes, chacune avec son état ; `pret` : la fabrication attend le clic. */
  etapes: { jalon: JalonDeRealisation; etat: EtatDUnJalon }[];
  /** L'étape suivante, pour l'annoncer ; absente une fois livré. */
  suivant?: { jalon: JalonDeRealisation; role: RoleDeRealisation };
}

/**
 * OÙ EN EST LE TOURNAGE ? Calculé depuis la carte seule — sa colonne et
 * `Card.realisation` —, jamais depuis les messages. Une carte d'avant (ni
 * enveloppe ni ambiance, ancien « genre ») se lit aussi : elle n'a besoin que
 * de sa phase.
 */
export function cheminDeLaRealisation(carte: {
  column?: string;
  realisation?: Partial<Pick<EtatDeRealisation, 'medias' | 'genre' | 'phase' | 'termineA' | 'enveloppe' | 'montageA'>> | null;
}): CheminDeRealisation {
  const r = carte.realisation ?? {};
  const colonne = String(carte.column ?? '');
  const avant = (COLONNES_AVANT_LE_TRAVAIL as readonly string[]).includes(colonne) || !colonne;
  let jalon: JalonDeRealisation;
  let role: RoleDeRealisation;
  let pret = false;
  if (!avant) {
    /* Au travail : la fabrication, puis le montage une fois l'assemblage
       annoncé (`montageA`) ; au-delà (à déployer, terminé, archivé), le média est livré. */
    jalon = colonne === 'running' ? (r.montageA ? 'montage' : 'fabrication') : 'livre';
    role = ROLE_APRES_LE_QUESTIONNAIRE[jalon as 'fabrication' | 'montage' | 'livre'];
  } else if (r.termineA) {
    jalon = 'fabrication';
    role = 'realisateur';
    pret = true;
  } else if (!typesDeMediaDeLaRealisation(r).length) {
    jalon = 'idee';
    role = 'directeur-createur';
  } else if (r.enveloppe === undefined && (r.phase ?? 'intention') === 'intention') {
    /* Juste après les types de média, le producteur propose l'enveloppe d'aperçus. */
    jalon = 'idee';
    role = 'producteur';
  } else {
    const phase = (PHASES_DE_REALISATION as readonly string[]).includes(String(r.phase)) ? (r.phase as PhaseDeRealisation) : 'intention';
    jalon = JALON_DE_LA_PHASE[phase];
    role = ROLE_DE_LA_PHASE[phase];
  }
  const rang = JALONS_DE_REALISATION.indexOf(jalon);
  const livre = jalon === 'livre';
  const etapes = JALONS_DE_REALISATION.map((j, i) => ({
    jalon: j,
    etat: (i < rang || (livre && i === rang) ? 'fait' : i === rang ? (pret ? 'pret' : 'encours') : 'avenir') as EtatDUnJalon,
  }));
  const prochain = livre ? undefined : JALONS_DE_REALISATION[rang + 1];
  return {
    jalon,
    role,
    etapes,
    ...(prochain ? { suivant: { jalon: prochain, role: roleDuJalon(prochain) } } : {}),
  };
}

/**
 * LE CHEMIN SE MONTRE dans le fil d'une carte caméra : pendant le
 * questionnaire (le volet), puis pendant et après la fabrication d'un cahier
 * terminé. Jamais sur une carte où la caméra est éteinte.
 */
export function cheminDeRealisationVisible(
  carte:
    | (Parameters<typeof estVoletDeRealisation>[0] & { realisation?: Partial<Pick<EtatDeRealisation, 'termineA' | 'demandeA' | 'medias' | 'genre'>> | null })
    | null
    | undefined,
): boolean {
  if (!carte?.parcours?.realisationSouhaitee || carte.archivedAt) return false;
  return estVoletDeRealisation(carte) || !!carte.realisation?.termineA;
}

/** Le membre de l'équipe qui ouvre une étape. */
export function roleDuJalon(jalon: JalonDeRealisation): RoleDeRealisation {
  if (jalon === 'fabrication' || jalon === 'montage' || jalon === 'livre') return ROLE_APRES_LE_QUESTIONNAIRE[jalon];
  const phase = PHASES_DE_REALISATION.find((p) => JALON_DE_LA_PHASE[p] === jalon)!;
  return ROLE_DE_LA_PHASE[phase];
}

/* ------------------------------------------------------------------ */
/* L'enveloppe d'aperçus et le tableau d'ambiance                       */
/* ------------------------------------------------------------------ */

/** L'enveloppe proposée par défaut, et son plafond : quelques images d'essai, pas une fabrication. */
export const ENVELOPPE_CONSEILLEE = 1;
export const ENVELOPPE_MAXIMALE = 5;

/** Les aperçus se reconnaissent à leur nom de plan : ils ne comptent JAMAIS dans le budget principal. */
export const PREFIXE_DES_APERCUS = 'apercu-';

/** Le modèle des aperçus par défaut : le moins cher du catalogue, au prix publié par kie.ai (Z-Image, 25/10/2026). */
export const MODELE_DES_APERCUS = { service: 'kie', id: 'z-image' } as const;

export function estUnApercu(plan: string): boolean {
  return plan.startsWith(PREFIXE_DES_APERCUS);
}

/**
 * PEUT-ON FABRIQUER CET APERÇU ? La porte de dépense DU CADRAGE, distincte de
 * « realiser » (réservé à l'agent de tâche) : rien sans enveloppe acceptée,
 * rien dont le prix n'est pas publié (personne ne valide un aperçu un par un),
 * jamais au-delà de l'enveloppe. La règle de fond reste `decisionDeDepense`,
 * appliquée avec l'enveloppe comme budget ET comme seuil.
 */
export function decisionDApercu(e: { enveloppe: number | undefined; prix: number | null; depense: number }): DecisionDeDepense {
  /* L'ENVELOPPE EST POSÉE D'OFFICE (décision du 25/10/2026) : 1 $ par vidéo, sans question. */
  const enveloppe = e.enveloppe ?? ENVELOPPE_CONSEILLEE;
  if (enveloppe <= 0) return { verdict: 'refus', raison: 'l’utilisateur a refusé l’enveloppe d’aperçus : continue avec des choix décrits en mots.' };
  if (e.prix === null) return { verdict: 'refus', raison: 'ce modèle ne publie pas son prix : un aperçu ne part qu’avec un prix connu. Choisis un modèle d’image au prix publié (kie.ai).' };
  const decision = decisionDeDepense({ prix: e.prix, depense: e.depense, budget: enveloppe, seuil: enveloppe });
  if (decision.verdict === 'refus') {
    return { verdict: 'refus', raison: `l’enveloppe d’aperçus de ${enveloppe} $ ne suffit plus (${arrondi(e.depense)} $ déjà dépensés, cet aperçu coûte ${arrondi(e.prix)} $) : continue avec des choix décrits en mots.` };
  }
  return decision;
}

/** Ajoute une vignette au tableau d'ambiance, sans doublon (la même pièce n'y entre qu'une fois). */
export function ajouterALAmbiance(r: EtatDeRealisation, pieces: readonly Omit<PieceDAmbiance, 'at'>[], at: number): EtatDeRealisation {
  const deja = new Set((r.ambiance ?? []).map((p) => p.piece));
  const nouvelles = pieces.filter((p) => p.piece && !deja.has(p.piece)).map((p) => ({ ...p, at }));
  if (!nouvelles.length) return r;
  return { ...r, ambiance: [...(r.ambiance ?? []), ...nouvelles].slice(-24) };
}

/** Le verdict d'un bouton du bandeau : possible, ou la raison de son extinction. */
export interface VerdictDeRealisation {
  possible: boolean;
  raison?: string;
}

export function pauseDeRealisationPossible(r: EtatDeRealisation | undefined): VerdictDeRealisation {
  if (!r || !typesDeMediaDeLaRealisation(r).length) return { possible: false, raison: 'Le questionnaire n’a pas encore commencé.' };
  if (r.enPauseA) return { possible: false, raison: 'Le questionnaire est déjà en pause.' };
  if (r.termineA) return { possible: false, raison: 'Toutes les questions ont leur réponse.' };
  return { possible: true };
}

export function repriseDeRealisationPossible(r: EtatDeRealisation | undefined): VerdictDeRealisation {
  if (!r?.enPauseA) return { possible: false, raison: 'Le questionnaire n’est pas en pause.' };
  return { possible: true };
}

/**
 * CE QUE L'OUTIL REÇOIT, LU ET BORNÉ — comme `lireAvancement` du cahier : un
 * total dépassé est relevé, une phase inconnue refusée avec la liste.
 */
export function lireAvancementDeRealisation(
  args: Record<string, unknown>,
  avant: EtatDeRealisation,
  maintenant: number,
): { ok: true; realisation: EtatDeRealisation } | { ok: false; raison: string } {
  const entier = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const faites = entier(args.faites) ?? avant.faites;
  let total = entier(args.total) ?? avant.total;
  if (total < faites) total = faites;
  const phase = String(args.phase ?? avant.phase);
  if (!(PHASES_DE_REALISATION as readonly string[]).includes(phase)) {
    return { ok: false, raison: `Phase inconnue « ${phase} » : ${PHASES_DE_REALISATION.join(', ')}.` };
  }
  const restants = Array.isArray(args.restants)
    ? args.restants.map((r) => String(r ?? '').trim()).filter(Boolean).slice(0, 40).map((r) => r.slice(0, 200))
    : avant.restants;
  const termine = args.termine === true || args.termine === 'true';
  /* LES TYPES DE MÉDIA : la liste de l'outil si elle est valable, sinon ce que la carte portait. */
  const brut = Array.isArray(args.medias) ? args.medias.map((m) => String(m ?? '').trim().toLowerCase()) : [];
  const inconnus = brut.filter((m) => m && !(TYPES_DE_MEDIA_DE_REALISATION as readonly string[]).includes(m));
  if (inconnus.length) {
    return { ok: false, raison: `Type de média inconnu « ${inconnus[0]} » : ${TYPES_DE_MEDIA_DE_REALISATION.join(', ')}.` };
  }
  const medias = [...new Set(brut.filter(Boolean))] as TypeDeMediaDeRealisation[];
  /* L'ENVELOPPE D'APERÇUS : un montant en dollars, borné ; absente, celle de la carte. */
  let enveloppe = avant.enveloppe;
  if (args.enveloppe !== undefined && args.enveloppe !== null && args.enveloppe !== '') {
    const n = typeof args.enveloppe === 'string' ? Number(args.enveloppe.replace(',', '.')) : Number(args.enveloppe);
    if (!Number.isFinite(n) || n < 0) return { ok: false, raison: '« enveloppe » est un montant en dollars, 0 pour « pas d’aperçus ».' };
    if (n > ENVELOPPE_MAXIMALE) {
      return { ok: false, raison: `L’enveloppe d’aperçus reste petite : ${ENVELOPPE_MAXIMALE} $ au plus. Le budget de la fabrication, lui, se demande à la fin.` };
    }
    enveloppe = Math.round(n * 100) / 100;
  }
  return {
    ok: true,
    realisation: {
      medias: medias.length ? medias : avant.medias,
      genre: avant.genre,
      faites,
      total,
      phase: phase as PhaseDeRealisation,
      restants: termine ? [] : restants,
      majA: maintenant,
      enPauseA: undefined,
      termineA: termine ? avant.termineA ?? maintenant : undefined,
      /* La date du premier envoi ne se perd pas à la réécriture : c'est elle qui tient le volet ouvert. */
      ...(avant.demandeA ? { demandeA: avant.demandeA } : {}),
      ...(enveloppe !== undefined ? { enveloppe } : {}),
      ...(avant.ambiance?.length ? { ambiance: avant.ambiance } : {}),
    },
  };
}

/** Le document d'une carte, rangé dans le projet : un fichier par carte, nommé par son identifiant (stable même quand le titre change). */
export function documentDeRealisation(cardId: string): string {
  return `docs/realisation/${segmentDeChemin(cardId.slice(0, 8), 'carte')}.md`;
}

/** Le document découpé en rubriques (« ## »), pour y lire le budget. */
export function rubriquesDuDocumentDeRealisation(markdown: string | null | undefined): RubriqueDuCahier[] {
  return partiesDuCahier(String(markdown ?? ''))
    .filter((p) => p.titre)
    .map((p) => ({ titre: p.titre, contenu: p.texte }));
}

/** Le nom du fichier exporté : « Réalisation — <carte>.pdf » ou « .md ». */
export function nomDeLaRealisationExportee(titreDeLaCarte: string, format: 'pdf' | 'md'): string {
  const propre = String(titreDeLaCarte ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'carte';
  return `Réalisation — ${propre}.${format}`;
}

/* ------------------------------------------------------------------ */
/* Les textes envoyés au cadrage                                        */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DU CADRAGE, jointe à chaque tour tant que la caméra est allumée.
 * Le type de média (vidéo, image ou son) est choisi au bouton caméra avant
 * l'envoi : il arrive dans la consigne et l'agent ne le demande jamais.
 */
/** La chaîne d'écriture d'une vidéo, dite dans la consigne (`shared/src/responsable-creatif.ts` la tient). */
const ETAPES_DU_PARCOURS_CREATIF = 'brief → directions → scénario → storyboard → plans';

export function consigneDuQuestionnaire(e: {
  medias?: readonly TypeDeMediaDeRealisation[];
  document: string;
  enveloppe?: number;
  /** Les capacités réellement branchées (image, video, animation, voix…), lues au catalogue du démon. */
  capacites?: readonly string[];
  /** L'accord de l'arrêt 2 est déjà donné : une retouche demandée part d'elle-même en fabrication. */
  fabricationAccordee?: boolean;
}): string {
  const choisis = e.medias ?? [];
  /* LE TYPE SE CHOISIT AU BOUTON CAMÉRA, AVANT L'ENVOI (décision du 25/10/2026) :
     jamais dans la discussion, ni au départ ni pour en changer. */
  const types = choisis.length
    ? `L’UTILISATEUR A CHOISI CE QU’IL VEUT OBTENIR, AU BOUTON CAMÉRA AVANT D’ENVOYER : ${libelleDesTypesDeMedia(choisis).toUpperCase()}. Ne pose JAMAIS de question sur le type de média (vidéo, image ou son), ni pour le confirmer ni pour en changer : si sa demande appelle un autre type, dis-le en une phrase et invite-le à le changer dans le menu du bouton caméra. Une VIDÉO comprend d’office tout ce qu’il lui faut (storyboard, images des plans, animation, voix, musique, bruitages, montage) — ne demande JAMAIS de cocher la musique ou la voix en plus ; ce qu’on entend se tranche à la rubrique « Son ». Pour un SON seul, le genre (musique, voix off ou bruitages) se demande dans le brief.`
    : `LE TYPE DE MÉDIA N’EST PAS CHOISI. Il se choisit dans le menu du bouton caméra, sous le champ d’écriture, jamais dans la discussion : ne le demande PAS, n’écris rien, et termine ton tour par une phrase qui invite l’utilisateur à choisir Vidéo, Image ou Son à ce bouton.`;
  /* L'ENVELOPPE D'APERÇUS EST POSÉE D'OFFICE à 1 $ (25/10/2026) : plus de question. */
  const enveloppeEnDollars = e.enveloppe ?? ENVELOPPE_CONSEILLEE;
  const enveloppe =
    enveloppeEnDollars > 0
      ? `1 bis. L’ENVELOPPE D’APERÇUS est posée d’office : ${enveloppeEnDollars} $ pour cette production, sans la demander. Elle paie les images clés de l’arrêt 2 (et, si besoin, deux ou trois aperçus de style pour l’arrêt 1) ; au-delà, tout se dit en mots.`
      : '1 bis. L’utilisateur a REFUSÉ l’enveloppe d’aperçus : aucun aperçu, tous les choix se posent en mots. Ne la redemande pas.';
  const capacites = e.capacites ?? [];
  const inventaire = `0. AVANT TOUT, CE QUE TU SAIS VRAIMENT FABRIQUER — capacités branchées aujourd’hui : ${capacites.length ? capacites.join(', ') : 'AUCUNE (aucun service de fabrication n’est branché : dis-le dès ta première réponse, avant d’écrire quoi que ce soit)'}. Tu ne prévois JAMAIS un plan, une direction ni un brief qui reposent sur une capacité absente (un « présentateur avatar » sans la capacité « avatar », par exemple) : propose ce qui existe (une image animée avec une voix synchronisée, un plan filmé au montage…) ou dis franchement ce qui est impossible. Chaque plan porte une ligne « Capacité : <capacité> » (une de la liste, ou « montage » pour ce qui se fait au montage) ; l’outil REFUSE un plan qui n’en a pas ou qui en demande une absente. DÈS LE PREMIER ÉCHANGE, relève aussi les PIÈCES À FOURNIR par l’utilisateur (photo d’une personne à animer, logo, captures d’écran réelles, voix enregistrée, musique sous licence…) : écris-les dans le champ « pieces » du brief (« aucune » s’il n’y en a pas) et demande-les dans le formulaire du brief ; dès qu’une pièce est là — jointe à un message, à une réponse, ou parmi ce que tu as vu —, note-la TOI-MÊME avec l’action « piece_recue » (« nom » = le nom écrit au brief, « piece » = l’identifiant ou l’alias « #xxxx » de la pièce jointe) ; ne demande JAMAIS à l’utilisateur de rejoindre une pièce déjà reçue. L’arrêt 2 est REFUSÉ tant qu’une pièce manque : rien ne se dépense sur une vidéo à qui manque sa photo.`;
  const apresAccord = e.fabricationAccordee
    ? 'LA FABRICATION A DÉJÀ L’ACCORD DE L’UTILISATEUR (arrêt 2 validé). Un message qui demande une RETOUCHE (un plan, un texte, le rythme, le film entier) part de lui-même en fabrication à la fin de ton tour : relis l’état (« production » action « etat »), note la retouche dans la pièce concernée (« modifier ») ou dans le cahier, puis dis en UNE phrase ce qui va être retouché — sans question, sans « soumettre ». Ne redemande l’accord que si la retouche coûte plus que le prix accordé marge comprise ou change l’idée validée.'
    : '';
  return [
    'MODE RÉALISATION ALLUMÉ SUR CETTE CARTE (bouton caméra) — tu es le DIRECTEUR ARTISTIQUE d’une production (IMAGE, VIDÉO ou SON) : un seul agent qui tient sept rôles et qui GUIDE l’utilisateur du début à la fin, dans UNE SEULE conversation : le brief, l’idée, les images clés et le prix, puis la fabrication, le montage et le film livré. Il n’y a PAS de bouton « Lancer » : l’accord de l’arrêt 2 lance la fabrication ici même. TROIS ARRÊTS POUR ACCORD, PAS UN DE PLUS : (1) l’IDÉE — brief et directions ensemble ; (2) les IMAGES CLÉS et le PRIX du film — son accord LANCE la fabrication ; (3) le FILM MONTÉ. Entre deux arrêts tu avances seul. Ce parcours REMPLACE les questions génériques de cadrage ; le document de réalisation est réécrit au fil de l’eau, une pause possible à tout moment.',
    ...(apresAccord ? [apresAccord] : []),
    inventaire,
    `1. ${types}`,
    enveloppe,
    `1 ter. L’ÉQUIPE DE TOURNAGE SE PASSE LE RELAIS — TU TIENS SEPT RÔLES : ${ROLES_DE_REALISATION.map((r) => LIBELLES_ROLES_DE_REALISATION[r].toUpperCase()).join(', ')}. L’utilisateur voit dans le fil un chemin de sept étapes (${JALONS_DE_REALISATION.map((j) => LIBELLES_JALONS_DE_REALISATION[j]).join(', ')}) et le membre de l’équipe qui parle, déduits de « phase » : tiens « phase » exacte à chaque appel. ${ROLES_DE_REALISATION.filter((r) => PHASES_DE_REALISATION.some((p) => ROLE_DE_LA_PHASE[p] === r))
      .map((r) => `Le ${LIBELLES_ROLES_DE_REALISATION[r].toUpperCase()} mène ${PHASES_DE_REALISATION.filter((p) => ROLE_DE_LA_PHASE[p] === r).join(', ')}`)
      .join(' ; ')}. Avant chaque question, écris UNE phrase courte et vivante au nom de celui qui parle ; quand la rubrique change de membre, annonce le passage de relais (« Je laisse la main au scénariste pour l’histoire. »). Ton ton reste celui d’un plateau de tournage, jamais d’un formulaire administratif.`,
    `1 quater. LES CHOIX EN IMAGES : pour les directions de l’arrêt 1, et SURTOUT pour les IMAGES CLÉS de l’arrêt 2 (l’image de départ des plans principaux), fabrique des aperçus sur l’enveloppe — pour un choix de style, DEUX ou TROIS aperçus avec « apercu_de_realisation » (une consigne d’image par proposition, écrite en français et traduite en anglais avant l’envoi, une légende de quelques mots), puis pose « ask_user » avec une option par aperçu (pour les DIRECTIONS, passe plutôt les identifiants dans « images » de l’action « soumettre » de l’outil « production », clé de la direction → identifiant), l’identifiant rendu dans « image » de l’option et la légende en « label ». Les IMAGES CLÉS ne font pas une question à part : elles partent avec l’arrêt 2 (« soumettre » images-cles, « images »). Le choix retenu rejoint seul le tableau d’ambiance de la carte ; un aperçu à garder sans question passe dans « ambiance » de « cahier_de_realisation ». Quand l’outil refuse (enveloppe vide ou épuisée, service non branché), pose la question en mots et continue : ne redemande jamais d’argent pour un aperçu.`,
    '1 quinquies. LES CHOIX QUI S’ÉCOUTENT : quand tu fais comparer des voix, des musiques ou des vidéos d’essai, joins chaque fichier avec « attach_file », puis pose « ask_user » avec une option par fichier et l’identifiant rendu dans « media » de l’option : un bouton lecture s’affiche à droite du choix (le son se lit sur place, la vidéo s’ouvre en grand). Commence le libellé de chaque option par le même repère que la légende du fichier joint (« Voix A : … »).',
    `2. LA CHAÎNE D’ÉCRITURE, PAR L’OUTIL « production » — dès le premier tour, AVANT les autres rubriques. Chaîne d’une vidéo : ${ETAPES_DU_PARCOURS_CREATIF}. Une image n’a ni scénario ni storyboard ; un son seul n’a ni direction ni storyboard. Tout s’écrit en texte et ne coûte rien ; chaque pièce rejoint la mémoire de production et paraît dans le suivi à droite. L’outil REFUSE d’écrire le scénario, le storyboard ou les plans tant que l’IDÉE n’a pas l’accord de l’utilisateur.`,
    '   a. LE BRIEF ADAPTATIF (directeur créatif) : relève d’abord TOUT ce que la phrase de l’utilisateur dit déjà (objectif, public, message, ton, formats, durée, pièces à fournir…) et écris-le avec l’action « brief » (« champs », source « demande »). Puis UN SEUL formulaire avec l’action « formulaire » : 3 à 5 questions d’un coup, seulement sur ce qui manque et compte vraiment — les pièces à fournir comprises —, chacune liée à son « champ », avec trois ou quatre choix suggérés dont ta recommandation en tête marquée « (recommandé) » — l’utilisateur peut toujours répondre librement. L’outil écarte seul une question dont le brief a déjà la réponse : ne pose JAMAIS une question déjà répondue, et ne pose pas les questions du brief une par une avec « ask_user ». Les réponses te reviennent ensemble ; écris-les dans le brief (« brief », source « reponse »).',
    '   b. LES DIRECTIONS (directeur artistique) : « concept » avec DEUX ou TROIS directions vraiment différentes (titre court, puis l’idée, l’accroche, le ton, la palette, la lumière, les références), toutes faisables avec les capacités branchées.',
    '   c. ARRÊT 1 — L’IDÉE : « soumettre » avec « etape » = « idee » (et « images » pour un aperçu par direction s’il y en a). L’utilisateur choisit une direction : ce choix vaut accord sur le brief ET la direction. « Aucune » ou une précision : retouche (« modifier » ou « concept »), puis soumets de nouveau.',
    '   d. SANS T’ARRÊTER, ÉCRIS LA SUITE : « script » (l’histoire, son contraste avant/après, puis le tableau temps / visuel / voix off), « storyboard » (une pièce par scène : ce qu’on voit, cadrage, lumière, son, durée), « plans » (une pièce par plan : numéro, durée, ce qu’on voit en actions observables, cadrage, mouvement, lumière, son, la ligne « Capacité : … », ce qui est GÉNÉRÉ et ce qui est MONTÉ, et le prompt de génération complet). Aucune question entre ces trois étapes, sauf une vraie impasse.',
    '   e. ARRÊT 2 — LES IMAGES CLÉS ET LE PRIX : fabrique sur l’enveloppe les images clés (l’image de départ des plans principaux, « apercu_de_realisation »), chiffre le « Devis prévisionnel » plan par plan (modèle visé, prix publié, total), écris la rubrique « Budget et seuil » ainsi : « Prix annoncé : <total> $ » puis « Plafond avec la marge de réparation de 30 % : <total × 1,3> $ », termine le cahier (point 7), puis « soumettre » avec « etape » = « images-cles », « prix » = le total en dollars et « images » = les identifiants des images clés. La question part avec le prix et le plafond : « Valider et lancer la fabrication » LANCE la fabrication dans cette même conversation — rien d’autre à cliquer. Un prix NON publié par le service ne compte pas dans « prix » : dis-le, il fera l’objet d’un accord à part pendant la fabrication.',
    '   f. « soumettre » ARRÊTE ton tour jusqu’à la réponse, comme « ask_user ». Une retouche écrit une NOUVELLE version (l’ancienne est gardée et l’utilisateur peut y revenir depuis le suivi), puis tu soumets de nouveau l’arrêt. Retoucher l’idée après son accord invalide ce qui la suit : dis-le en une phrase. Ne redemande JAMAIS un accord déjà donné : « etat » relit la production en base, sans la conversation — appelle-le au début de chaque tour et à chaque reprise.',
    '   g. APRÈS « Valider et lancer la fabrication » : termine ton tour IMMÉDIATEMENT par une phrase courte (« C’est parti : je fabrique et je reviens avec le film monté. »), sans autre outil ni question — la fabrication part d’elle-même à la fin de ton tour.',
    `   h. ${REGLE_DE_LA_PIECE_DESIGNEE}`,
    `   i. APRÈS CHAQUE ARRÊT ACCORDÉ, reporte-le dans le cahier (point 5) : brief → « ${RUBRIQUES_DE_REALISATION[0]} » et « ${RUBRIQUES_DE_REALISATION[1]} » ; direction → « ${RUBRIQUES_DE_REALISATION[3]} » et « ${RUBRIQUES_DE_REALISATION[4]} » ; scénario et storyboard → « ${RUBRIQUES_DE_REALISATION[2]} » ; plans → « ${RUBRIQUES_DE_REALISATION[5]} ».`,
    '2 ter. LES RUBRIQUES QUI RESTENT (son, montage, droits, contrôle) : tranche-les TOI-MÊME d’après le brief et l’idée validée, et n’en fais une question (« ask_user », une à la fois) que si un choix appartient vraiment à l’utilisateur et n’a pas été tranché, chacune avec des choix concrets et ta recommandation en tête, marquée « (recommandé) ». Le champ complet à couvrir, chaîne comprise : genre de production (publicité produit, publicité d’application, film de marque, accroche pour les réseaux, clip, présentation, immobilier, film d’animation, tutoriel…), objectif, public, message, accroche et appel à l’action, durée et formats (vertical 9:16, carré 1:1, portrait 4:5, horizontal 16:9), histoire et découpage en scènes puis en plans, style visuel et références, cadrage, optique et mouvements de caméra, lumière, étalonnage et couleurs, personnages, décors et costumes à garder cohérents, présentateur humain et langues de déclinaison, voix off, musique et bruitages, textes à l’écran et sous-titres, images de référence fournies (première et dernière image d’un plan), ce qui vient d’un écran réel et ce qui est généré, licences. Pour la MUSIQUE : usage, durée, ambiance et émotion, genre musical et références, tempo, instruments, voix chantée ou non, paroles, boucle ou titre complet, licence. Pour la VOIX OFF : texte exact, langue, ton, rythme, voix homme ou femme. Pour les BRUITAGES : liste des sons, durée, moments du plan où ils tombent. UNE VIDÉO comprend toujours son son : la rubrique « Son » y tranche ce qu’on entend (voix off, musique, bruitages, ou rien de tout cela par choix), jamais « Sans objet » faute de case cochée. Une rubrique qui ne concerne pas le média choisi s’écrit « Sans objet ». L’utilisateur répond dans le panneau de décision.',
    `2 bis. ${REGLE_DES_PISTES} Exemple : pour « comment la vidéo invite-t-elle à vous contacter ? », ne propose pas seulement « adresse du site » et « formulaire » ; ajoute par exemple un mot-clé dit par le présentateur puis un message direct, un code à l’écran, une offre limitée dans le temps.`,
    '3. TU AGIS EN DIRECTEUR ARTISTIQUE, RÉALISATEUR PUBLICITAIRE ET SUPERVISEUR DE POSTPRODUCTION — pas en simple générateur. La chaîne : brief commercial → direction artistique → storyboard → prompts par plan → génération → montage → validation. Le cahier couvre TOUTE la chaîne, jusqu’aux prompts et au contrôle, pas seulement le brief et le storyboard. Huit règles de fond :',
    '   a. L’ACCROCHE : les deux premières secondes disent déjà le bénéfice pour le spectateur (pas une scène d’ambiance). Propose deux ou trois accroches par « ask_user ». Le scénario montre un CONTRASTE avant/après, du rythme et de la personnalité — pas une simple suite d’actions descriptives.',
    '   b. LA BIBLE VISUELLE avant toute génération : visage exact des personnages, vêtements, décor, lumière, palette, texture, étalonnage, focales, tailles de plan, mouvements de caméra, transitions, références de cadrage. Sans elle, chaque plan ressemble à une publicité différente.',
    '   c. SCÉNARIO ≠ PROMPTS. « Scénario et découpage » est un tableau temps / visuel / voix off. « Plan par plan » donne, pour CHAQUE plan, un prompt de génération complet et autonome (écrit en français : il est traduit en anglais automatiquement avant l’envoi au générateur) avec : image de départ (et d’arrivée), références de personnage et de lieu, taille de plan, focale indicative, mouvement principal et secondaire, profondeur de champ, durée, interdits (aucun texte lisible généré, aucun logo, aucun personnage en plus, aucun mouvement brusque) et critères de validation. Chaque plan dit aussi ce que l’IA GÉNÈRE et ce qui se fait AU MONTAGE.',
    '   d. LES VRAIS ÉCRANS NE SE GÉNÈRENT JAMAIS : les captures réelles du produit sont incrustées au montage, avec animations contrôlées ; le plan généré garde un écran vide remplaçable. « Montage et incrustations » écrit chaque incrustation, les sous-titres, les titres et l’appel à l’action animé.',
    '   e. L’EXACTITUDE COMMERCIALE : demande l’assiette de chaque montant (hors taxes, toutes taxes comprises, net) et écris le calcul. Une promesse (gain, commission, remise) n’est jamais montrée comme acquise : sa condition (abonnement souscrit et payé, durée) est dite à l’image ou à la voix.',
    '   f. LES FORMATS dès la composition : zones de sécurité des interfaces sociales prévues dans chaque plan, déclinaisons horizontales et carrées pensées au départ plutôt que recadrées après coup ; textes, sous-titres et appel à l’action lisibles sur téléphone.',
    '   g. LES DROITS : musique, voix, images et ressources externes portent une licence qui autorise explicitement l’usage publicitaire, écrite dans « Droits et conformité » ; une musique « composée » n’est pas libre de droits d’office.',
    '   h. LE CONTRÔLE ET LE RAPPORT : « Contrôle qualité » liste ce qu’on vérifie (visages, mains, continuité, lisibilité, synchronisation voix et image, montants, formats, conformité du message) ; la fabrication rendra un rapport final (modèles et réglages employés, crédits dépensés, défauts restants, fichiers sources réutilisables).',
    '4. LA DÉPENSE, SANS LA DEMANDER : aucun budget, aucun seuil ni nombre de tentatives ne se demande plus. L’enveloppe d’aperçus paie les images clés ; le prix du film se tire du devis prévisionnel (jamais d’un chiffre arbitraire) et s’accorde à l’arrêt 2 ; la fabrication peut ensuite aller jusqu’à ce prix plus 30 % pour réparer seule une panne, et redemande au-delà. Les générations abouties se facturent même quand le résultat déplaît : dis-le en présentant le prix.',
    `5. APRÈS CHAQUE RÉPONSE, AVANT LA QUESTION SUIVANTE, appelle « cahier_de_realisation » avec le document ENTIER mis à jour et l’avancement : « faites » (questions tranchées, le genre compris), « total » (questions prévues, ajusté en chemin), « phase » (${PHASES_DE_REALISATION.join(', ')}), « restants » (ce qui reste à voir, quelques mots chacun). L’outil l’écrit dans ${e.document} du projet ; l’utilisateur le lit depuis la carte pendant qu’il s’écrit. Le document porte ces rubriques « ## », dans cet ordre : ${RUBRIQUES_DE_REALISATION.map((r) => `« ${r} »`).join(', ')} ; une rubrique pas encore tranchée porte « ${MARQUE_A_VOIR} », une rubrique sans objet pour ce média s’écrit « Sans objet : <raison> ». « Budget et seuil » porte le prix annoncé et le plafond (point 2 e).`,
    '6. L’UTILISATEUR PEUT METTRE EN PAUSE à tout moment : ton tour s’arrête net. À la reprise, on te redonne le document, l’avancement et l’état de la production lu en base : ne repose JAMAIS une question déjà tranchée ni un accord déjà donné.',
    `7. AVANT L’ARRÊT 2 : relis le document comme un directeur de production — chaque rubrique écrite, chaque plan avec son prompt, sa capacité et sa mention généré ou monté, chaque montant avec son assiette, devis et prix cohérents. Puis appelle « cahier_de_realisation » avec « termine » = vrai et le document complet, sans plus aucune marque « ${MARQUE_A_VOIR} » : l’outil REFUSE de terminer tant qu’une rubrique manque ou reste à voir, et te dit laquelle — et l’arrêt 2 est refusé tant que le cahier n’est pas terminé. Tu ne rends PAS de plan : le document le remplace.`,
    `7 bis. UNE RETOUCHE DEMANDÉE AVANT L’ARRÊT 2 (un plan, un ton, une rubrique) : relis ${e.document}, applique-la, réécris le document ENTIER (« termine » = vrai s’il reste complet), puis soumets de nouveau l’arrêt concerné.`,
    `8. Appuie tes questions et ton découpage sur ${COMPETENCES_DE_REALISATION}.`,
    'Rien d’autre que les aperçus de l’enveloppe ne se génère avant l’arrêt 2 : la fabrication part à son accord, dans cette même conversation.',
  ].join('\n');
}

/** La reprise après une pause : tout ce qu'il faut pour repartir sans la conversation. */
export function demandeDeRepriseDeRealisation(r: EtatDeRealisation, document: string | null | undefined, chemin: string, production = ''): string {
  const restants = r.restants.length ? r.restants.map((x) => `- ${x}`).join('\n') : '(aucun point noté)';
  return `REPRISE DU QUESTIONNAIRE DE RÉALISATION APRÈS UNE PAUSE. L’utilisateur revient : repars EXACTEMENT où tu t’étais arrêté.

AVANCEMENT ENREGISTRÉ : ${typesDeMediaDeLaRealisation(r).length ? libelleDesTypesDeMedia(typesDeMediaDeLaRealisation(r)) : 'types de média pas encore choisis'}, ${r.faites} question(s) tranchée(s)${r.total ? ` sur ${r.total} prévue(s)` : ''}, phase « ${LIBELLES_PHASES_DE_REALISATION[r.phase]} ».

CE QUI RESTE À VOIR :
${restants}

LE DOCUMENT TEL QU’IL EST ENREGISTRÉ (${chemin}) :
${String(document ?? '').trim() || '(le document n’a pas pu être lu : reprends depuis l’avancement ci-dessus)'}

${production.trim() ? `\nL’ÉTAT DE LA PRODUCTION, LU EN BASE (outil « production », action « etat ») :\n${production.trim()}\n` : ''}
Ne repose aucune question déjà tranchée dans ce document, ni un accord déjà donné. Mène l’étape SUIVANTE (formulaire, pièce à écrire ou à soumettre, ou question avec « ask_user »), puis continue le parcours.`;
}

/* ------------------------------------------------------------------ */
/* Un cahier complet, vérifié avant de le dire terminé                  */
/* ------------------------------------------------------------------ */

const sansAccent = (texte: string): string => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * CE QUI MANQUE POUR QUE LE CAHIER SOIT COMPLET : une rubrique absente, une
 * rubrique restée « à voir » (ou vide). Le budget et le seuil ne se demandent
 * plus (25/10/2026) : le prix s'accorde à l'arrêt 2 du directeur. Vide : le cahier peut être dit terminé. L'outil refuse « termine »
 * tant que cette liste n'est pas vide — le cahier ne se déclare pas fini sur la
 * foi de l'agent.
 */
export function lacunesDuCahierDeRealisation(markdown: string | null | undefined): string[] {
  const parties = partiesDuCahier(String(markdown ?? '')).filter((p) => p.titre);
  const lacunes: string[] = [];
  for (const rubrique of RUBRIQUES_DE_REALISATION) {
    const cle = sansAccent(rubrique);
    const partie = parties.find((p) => sansAccent(p.titre).startsWith(cle));
    if (!partie) lacunes.push(`la rubrique « ${rubrique} » manque`);
    else if (partie.aVoir) lacunes.push(`la rubrique « ${rubrique} » est vide ou porte encore « ${MARQUE_A_VOIR} »`);
  }
  /* Plus de budget ni de seuil à exiger (25/10/2026) : le prix s'accorde à l'arrêt 2, la marge est fixe. */
  return lacunes;
}

/* ------------------------------------------------------------------ */
/* Le budget et le seuil, lus dans le cahier des charges                */
/* ------------------------------------------------------------------ */

export interface BudgetDeRealisation {
  /** Le plafond total de la fabrication, en dollars ; `null` s'il n'est pas écrit. */
  budget: number | null;
  /** Au-delà de ce prix par génération, l'accord est demandé ; `null` s'il n'est pas écrit. */
  seuil: number | null;
}

/** Un montant en dollars dans une ligne : « 25 $ », « $25 », « 2,50 USD », « 3 dollars ». */
function montantEnDollars(ligne: string): number | null {
  const m =
    /(\d+(?:[.,]\d+)?)\s*(?:\$|usd\b|dollars?\b)/i.exec(ligne) ?? /(?:\$|usd)\s*(\d+(?:[.,]\d+)?)/i.exec(ligne);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * LE BUDGET ET LE SEUIL ÉCRITS DANS LE CAHIER (rubrique « Budget et seuil »,
 * ou toute rubrique dont le titre parle de budget). Seuls les montants en
 * DOLLARS comptent : un montant en euros ne se convertit pas au hasard.
 */
export function budgetDuCahier(cahier: readonly RubriqueDuCahier[] | undefined): BudgetDeRealisation {
  const rubriques = (cahier ?? []).filter((r) => /budget/i.test(r.titre));
  let budget: number | null = null;
  let seuil: number | null = null;
  for (const r of rubriques) {
    for (const ligne of r.contenu.split('\n')) {
      const montant = montantEnDollars(ligne);
      if (montant === null) continue;
      if (/seuil|accord|par g[ée]n[ée]ration/i.test(ligne)) seuil ??= montant;
      else if (/budget|total|plafond/i.test(ligne)) budget ??= montant;
    }
  }
  return { budget, seuil };
}

/* ------------------------------------------------------------------ */
/* La décision de dépense, avant CHAQUE génération                      */
/* ------------------------------------------------------------------ */

export type DecisionDeDepense =
  | { verdict: 'refus'; raison: string }
  | { verdict: 'accord'; raison: string }
  | { verdict: 'libre' };

/**
 * PEUT-ON LANCER ? Rien sans budget ; jamais au-delà du budget ; l'accord de
 * l'utilisateur au-delà du seuil — et TOUJOURS quand le prix n'est pas publié,
 * puisqu'on ne sait pas s'il passe sous le seuil.
 */
export function decisionDeDepense(entree: { prix: number | null; depense: number } & BudgetDeRealisation): DecisionDeDepense {
  const { prix, depense, budget, seuil } = entree;
  if (budget === null) {
    return {
      verdict: 'refus',
      raison:
        'aucun budget n’est écrit dans le cahier de réalisation (rubrique « Budget et seuil » : « Budget total : <montant> $ »). Rien de payant ne part sans budget : demande-le avec « fixer_budget ».',
    };
  }
  if (depense >= budget) return { verdict: 'refus', raison: `le budget de ${budget} $ est atteint (${arrondi(depense)} $ dépensés) : arrête-toi et demande à l’utilisateur s’il l’augmente (« fixer_budget »).` };
  if (prix !== null && depense + prix > budget + 1e-9) {
    return { verdict: 'refus', raison: `cette génération (${arrondi(prix)} $) dépasserait le budget : ${arrondi(depense)} $ déjà dépensés sur ${budget} $. Choisis un modèle moins cher ou demande une rallonge (« fixer_budget »).` };
  }
  if (prix === null) return { verdict: 'accord', raison: 'le service ne publie pas son prix : l’accord de l’utilisateur est demandé avant de lancer.' };
  if (seuil === null) return { verdict: 'accord', raison: 'aucun seuil d’accord n’est écrit : chaque génération demande l’accord.' };
  if (prix > seuil + 1e-9) return { verdict: 'accord', raison: `${arrondi(prix)} $ dépasse le seuil d’accord de ${seuil} $.` };
  return { verdict: 'libre' };
}

export function arrondi(montant: number): string {
  return montant < 1 ? montant.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : montant.toFixed(2);
}

/** La réponse donnée vaut-elle accord ? Le choix « Lancer » (ou « Accepter »), complément libre toléré. */
export function accordDeRealisationDonne(reponse: string | undefined): boolean {
  return /^\s*(lancer|accepter|oui)\b/i.test(reponse ?? '');
}

/** La question qui FIXE le budget et le seuil, quand le cahier n'en porte pas ou qu'une rallonge est demandée. */
export function questionDeBudget(e: { budget: number; seuil: number; raison: string; depense: number }): {
  question: string;
  description: string;
  options: { label: string; description: string }[];
} {
  return {
    question: `Fixer le budget à ${e.budget} $ et le seuil d’accord à ${e.seuil} $ par génération ?`,
    description: `${e.raison.trim().slice(0, 500)}${e.depense > 0 ? ` Déjà dépensé : ${arrondi(e.depense)} $.` : ''}`,
    options: [
      { label: 'Accepter', description: 'Ce budget et ce seuil s’appliquent à la suite de la fabrication.' },
      { label: 'Refuser', description: 'Rien ne change ; l’agent s’arrête ou propose moins cher.' },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Les noms de fichiers et le rangement                                 */
/* ------------------------------------------------------------------ */

/** Un morceau de chemin sûr : minuscules, sans accents, tirets. */
export function segmentDeChemin(texte: string, defaut = 'media'): string {
  const s = texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || defaut;
}

/** Le dossier d'une carte sous la racine des médias : `<projet>/<branche de la carte>`. */
export function dossierRelatifDesMedias(projet: string, branche: string): string {
  return `${segmentDeChemin(projet, 'projet')}/${segmentDeChemin(branche.replace(/^tache\//, 'tache-'), 'carte')}`;
}

/** Le nom du fichier d'une version : `<plan>-v<n>.<ext>` — un plan refait garde ses versions précédentes. */
export function nomDuFichierDeMedia(plan: string, version: number, extension: string): string {
  return `${segmentDeChemin(plan)}-v${Math.max(1, Math.floor(version))}.${extension.replace(/^\./, '')}`;
}

/* ------------------------------------------------------------------ */
/* La consigne de l'agent de TÂCHE                                      */
/* ------------------------------------------------------------------ */

export function consigneDeFabrication(
  e: BudgetDeRealisation & { depense: number; services: string; document?: string; methodes?: readonly string[]; prixAccorde?: number; production?: string },
): string {
  const budget =
    e.prixAccorde !== undefined && e.budget !== null
      ? `LA FABRICATION A L’ACCORD DE L’UTILISATEUR (arrêt 2) : prix annoncé ${arrondi(e.prixAccorde)} $, plafond ${arrondi(e.budget)} $ avec la marge de réparation de 30 % — déjà engagé : ${arrondi(e.depense)} $. Le serveur tient ce plafond : chaque génération y est réservée avant l’appel, débitée au résultat, rendue si elle échoue.`
      : e.budget === null
        ? 'AUCUN prix n’a encore été accordé : tout lot repose la question à l’utilisateur. Une carte d’avant les trois arrêts peut fixer un budget avec l’action « fixer_budget ».'
        : `Budget total : ${e.budget} $ — déjà engagé : ${arrondi(e.depense)} $. Le budget est tenu par le serveur : chaque génération y est réservée avant l’appel, débitée au résultat, rendue si elle échoue.`;
  return [
    'MODE RÉALISATION ALLUMÉ SUR CETTE CARTE — tu restes le DIRECTEUR ARTISTIQUE qui a mené l’idée et les images clés avec l’utilisateur, dans la même conversation : tu FABRIQUES maintenant le média, en réalisateur, directeur de la photographie et monteur, jusqu’au film monté. Le Studio n’a rien à voir avec ce travail : tout passe par l’outil « realiser ».',
    budget,
    'TROIS ARRÊTS SEULEMENT, ET LES DEUX PREMIERS SONT PASSÉS : l’idée et les images clés avec le prix ont l’accord de l’utilisateur. Tu ne t’arrêtes plus qu’au FILM MONTÉ (arrêt 3). Aucune question entre deux plans : ni combien de propositions, ni quelle image garder, ni quel lot valider. Tu ne demandes que si une dépense dépasse le plafond, si un prix n’est pas publié, ou si une pièce indispensable manque.',
    ...(e.production?.trim() ? [`L’ÉTAT DE LA PRODUCTION, LU EN BASE (outil « production », action « etat ») — il remplace la relecture de la conversation :\n${e.production.trim()}`] : []),
    ...(e.document ? [`LE CAHIER DE RÉALISATION fait foi : ${e.document} — relis-en les rubriques « Plan par plan », « Son » et « Montage et incrustations » avant de commencer.`] : []),
    `Services branchés : ${e.services || 'AUCUN.'} Avant chaque génération, vérifie qu’un service branché sait la fabriquer (« realiser » action « modeles », filtrée par capacité). S’il n’y en a pas, appelle « realiser » action « brancher » : la question part dans la conversation avec un encadré où l’utilisateur colle sa clé (kie.ai d’abord), testée sur place ; sa réponse te relance. Ne demande JAMAIS une clé en texte.`,
    'Méthode :',
    '1. Relis l’état de la production et le cahier, puis écris ta FICHE DE PRODUCTION dans ta réponse : chaque plan (numéro, durée, capacité, image de départ, ce qu’on voit, cadrage, mouvement), les éléments à garder cohérents. Les prompts de « Plan par plan » font foi : tu les suis, tu ne les réinventes pas.',
    '2. FABRIQUE D’UN TRAIT : (a) les images de départ — les IMAGES CLÉS accordées à l’arrêt 2 sont déjà au suivi (« lister » marque « DANS LE SUIVI ») ; fabrique celles qui manquent, regarde chaque résultat (lis le fichier) et ajoute toi-même au suivi la meilleure (« realiser » action « retenir ») ; (b) l’ANIMATION de chaque plan à partir de son image retenue (capacité « animation », « source » = l’image, « fin » = une autre image retenue s’il en faut une) ; (c) la voix off, la musique et les bruitages que le cahier prévoit. Ne génère QUE ce que le cahier marque « généré » : les vraies captures du produit s’incrustent au montage, jamais inventées par un générateur. Choisis le modèle avec « modeles » : la qualité d’abord, puis le coût, dans le plafond.',
    '2 bis. LES DEMANDES QUI VIENNENT DU MENU « … » D’UN MÉDIA arrivent comme un message de l’utilisateur avec le média joint et son identifiant : « Autres angles », « Changer la lumière », « Remplacer le visage », ou « Relancer avec ces réglages ». Lis le détail du média avec « realiser » action « media ». Pour une RETOUCHE, UNE question à la fois, dans cet ordre : (1) LE MODÈLE — « realiser » action « modeles » avec la capacité (« angles », « lumiere », « visage ») rend TOUS les modèles en place, branchés ou à brancher, avec leur prix : pose « ask_user » avec un choix par modèle, le prix et l’ÉCART de prix dans la description, ta recommandation en tête marquée « (recommandé) » ; un modèle « À BRANCHER » passe par « brancher » ; dis franchement qu’un modèle « décrit en mots » est moins précis ; (2) LE RÉGLAGE — angles : « ask_user » en choix MULTIPLE (De face, Trois-quarts gauche, Trois-quarts droite, Profil gauche, Profil droit, De dos, Plongée, Contre-plongée, Gros plan, Plan large ; réponse libre possible), un devis par angle coché ; lumière : « realiser » action « lumiere » avec le service, le modèle et la « source » — la sphère s’ouvre, et la réponse « Lumière : azimut …°, élévation …° » passe en « lumiere » { azimut, elevation } du devis ; visage : demande la ou les PHOTOS du visage, puis, s’il y a plusieurs personnes dans l’image, montre-les NUMÉROTÉES et fais choisir qui remplacer (« cible ») ; rappelle que les visages utilisés doivent être autorisés ; (3) LE NOMBRE de propositions, 1 à 4 ; (4) devis (« source » = le média visé), lot, génération. Pour une RELANCE : refais un devis (version suivante) avec les réglages donnés.',
    '2 ter. LE CONTRÔLE DU MOUVEMENT (« motion control ») : le personnage d’une image reprend les gestes d’une VIDÉO DE RÉFÉRENCE de 3 à 30 s. Devis avec « source » = l’image, « mouvement » = la vidéo, « orientation » ; la durée suit la vidéo de référence. LE CATALOGUE EN DIRECT : « modeles » avec « en_direct » (et « recherche », « capacite ») lit TOUS les modèles que kie.ai publie ; « modeles » avec « en_direct », « service » et « modele » donne ses entrées exactes, et le devis le commande avec « parametres ».',
    '3. UN DEVIS PAR LOT, VALIDÉ D’OFFICE DANS LE PRIX ACCORDÉ : fais un « devis » par génération, écris pour chacun une ligne lisible (🎬 <plan> — <modèle> (<service>) — <prix> — <pourquoi>), puis regroupe-les avec « realiser » action « lot » (« devis_du_lot », « titre », « etape »). Un lot dont tous les prix sont publiés et qui tient dans ce qui reste du plafond est VALIDÉ D’OFFICE : lance-le aussitôt avec « generer » (« lot »). Un lot qui dépasse, ou qui porte un prix non publié, part en question avec son bloc « Devis » et ARRÊTE ton tour jusqu’au clic. Seules les opérations d’un lot validé partent.',
    `3 bis. LA MÉMOIRE DE LA PRODUCTION : le brief, la direction retenue, le scénario, le storyboard et la liste des plans se relisent avec l’outil « production » action « etat ». Une retouche d’une pièce écrite passe par « production » action « modifier » : nouvelle version, l’ancienne gardée. Les pièces nouvelles de la fabrication (personnage, référence) se rangent avec « realiser » action « noter ». ${REGLE_DE_LA_PIECE_DESIGNEE}`,
    '4. « suivre » attend le résultat (une vidéo prend plusieurs minutes) ; le média paraît dans le fil de la carte. REGARDE chaque image ou première image d’un plan (lis le fichier rendu) et juge-la avec les critères de « Contrôle qualité » (visages, mains, continuité, identité des personnages, texte parasite) : un plan raté se refait seul avec un nouveau devis (version suivante), sans refaire le reste.',
    '4 bis. UNE PANNE SE RÉPARE SEULE, DANS LA MARGE : quand une génération échoue, « suivre » te dit quoi faire — réessayer le même modèle, puis passer à un modèle ÉQUIVALENT de même capacité — et le nouveau lot part d’office tant qu’il tient dans le plafond. Écris alors UNE ligne à l’utilisateur (ce qui a raté, ce que tu fais), sans question. Tu ne rends JAMAIS la main sur une panne tant qu’une issue existe dans la marge ; au-delà (plafond atteint, trois échecs sur un plan), demande avec « ask_user ».',
    '5. LE MONTAGE : appelle « realiser » action « monter » — l’étape « Montage » s’allume et les plans finis sont versés dans le montage de la carte, que l’utilisateur peut ouvrir dans le grand volet pour régler à la main. Assemble avec ffmpeg dans le dossier des médias, comme « Montage et incrustations » l’écrit (enchaînement des plans, vraies interfaces incrustées, voix, musique, sous-titres, titres, appel à l’action, formats vertical, carré et horizontal avec leurs zones de sécurité), puis range le fichier monté avec « realiser » action « ajouter ». Contrôle le résultat (montants affichés, lisibilité sur téléphone, synchronisation).',
    '5 bis. ARRÊT 3 — LE FILM MONTÉ : « production » action « soumettre » avec « etape » = « rendu » et « film » = l’identifiant de la pièce jointe rendue par « ajouter ». L’utilisateur le regarde depuis la question. « Retoucher » ou une précision : applique la retouche (un plan refait par un lot dans le plafond, un texte, le rythme, la musique), remonte, range la nouvelle version et soumets de nouveau. « Valider le film » : livre l’export final.',
    '6. Ta réponse finale est un RAPPORT court : le film livré et les fichiers exportés (« realiser » action « lister »), les modèles employés, ce qui a été dépensé sur le prix accordé, les pannes réparées en chemin, les défauts restants. Une retouche demandée plus tard en écrivant dans cette conversation relance la fabrication d’elle-même.',
    `MÉTHODES : ${e.methodes?.length ? `en service, ${e.methodes.join(' ; ')}` : 'aucune en service'}. Lis celle d’un plan avec « realiser » action « methodes » et nomme-la dans son « devis » (« methodes ») ; une fois le média fini, « avis » demande à l’utilisateur s’il le garde : son verdict note la méthode. Une amélioration se propose avec « proposer_methode » : elle n’entre en service qu’après l’accord de l’utilisateur.`,
    'DÉCLINER DANS UNE AUTRE LANGUE : « decliner » dit ce qui se réutilise (images, plans sans parole, musique), ce qui se refait (la voix, un audio propre par langue, « langue » dans le devis), ce qui se resynchronise (un présentateur, capacité « synchro ») et ce qui se remonte aux durées adaptées. Aucune image n’est refaite.',
    `Savoir-faire : ${COMPETENCES_DE_REALISATION}.`,
  ].join('\n');
}

/**
 * LA BARRE D'ÉCRITURE DES DEUX VOLETS (cahier des charges et réalisation),
 * UN SEUL PRÉDICAT pour l'écran et les contrôles. Elle revient :
 *  - dans les cas propres au volet de réalisation (`barreDEcritureDuVoletDeRealisation`) ;
 *  - sur un cahier des charges EN PAUSE (on reprend en écrivant, `leverLaPauseSurMessage`) ;
 *  - PENDANT QUE L'AGENT TRAVAILLE (demande du 22/10/2026) : sans elle, rien
 *    pour Suspendre ni pour envoyer un message en priorité pendant la
 *    réflexion. « Travaille » = le témoin du tour vivant (`temoinDeTravail`),
 *    pas le dernier message, pour ne pas clignoter entre deux outils.
 * Une QUESTION EN ATTENTE garde la main : on y répond dans le panneau de
 * décision, jamais dans deux endroits à la fois (l'agent est arrêté dessus).
 */
export function barreDEcritureDuVolet(
  carte:
    | (Parameters<typeof barreDEcritureDuVoletDeRealisation>[0] & {
        cahierDesCharges?: { enPauseA?: number | null } | null;
      })
    | null
    | undefined,
  etat: { travaille: boolean; questionEnAttente: boolean },
): boolean {
  if (barreDEcritureDuVoletDeRealisation(carte)) return true;
  const cahier = estVoletDuCahier(carte);
  if (!cahier && !estVoletDeRealisation(carte)) return false;
  if (cahier && carte?.cahierDesCharges?.enPauseA) return true;
  return etat.travaille && !etat.questionEnAttente;
}
