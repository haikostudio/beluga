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

import { IDS_STYLES_DE_REALISATION, STYLES_DE_REALISATION, styleDeRealisation, type IdStyleDeRealisation } from './styles-de-realisation.js';
import { BIBLIOTHEQUES_DE_COMPOSITION, CAPACITE_COMPOSITION } from './composition.js';
import { z } from 'zod';
import type { RubriqueDuCahier } from './cahier-vivant.js';
import { COLONNES_AVANT_LE_TRAVAIL } from './columns.js';
import { MARQUE_A_VOIR, estVoletDuCahier, partiesDuCahier } from './cahier-des-charges.js';
import { REGLE_DES_PISTES } from './pistes-de-question.js';
import { REGLE_DE_LA_PIECE_DESIGNEE } from './responsable-creatif.js';
import { MediaFinal, MontageSon, ReglagesPhoto } from './studios-du-media.js';

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
  /*
   * LES PASSAGES DU NOUVEAU PARCOURS (Brief → Esquisses → Montage →
   * Téléchargement, décision du 26/10/2026), posés par le bouton du bas
   * (`realisation.passer`, `passageAEcrire`) — jamais par l'agent.
   */
  /** « Passer aux esquisses » : les générations à prix deviennent possibles. */
  esquissesA: z.number().optional(),
  /** Vidéo : « Passer aux séquences vidéo » — chaque plan a son image validée, l'animation devient possible. */
  sequencesA: z.number().optional(),
  /** « Passer au téléchargement » : le montage est fini, la page des fichiers s'ouvre. */
  telechargementA: z.number().optional(),
  /** LES MÉDIAS FINAUX rendus par les studios (photo retouchée, mixage son, export vidéo). */
  finaux: z.array(MediaFinal).optional(),
  /** Les réglages du studio photo, par image source (média ou pièce jointe) : rouverts tels quels. */
  retouchesPhoto: z.record(z.string(), ReglagesPhoto).optional(),
  /** Le montage du studio son : pistes et extraits, rouvert tel quel. */
  montageSon: MontageSon.optional(),
  /**
   * LE STYLE RETENU (décision de l'utilisateur du 26/10/2026), un des dix de
   * `STYLES_DE_REALISATION`, choisi en images au premier échange
   * (« production » action « style ») : il décide de la fabrication — sur le
   * serveur sans frais, par un service payant, ou les deux.
   */
  style: z.enum(IDS_STYLES_DE_REALISATION).optional(),
  /**
   * LE CONTENU MARKETING D'OÙ VIENT LA CARTE (« Créer le visuel », 26/10/2026) :
   * le film validé de la carte revient à ce contenu, prêt à publier.
   */
  contenuMarketingId: z.string().optional(),
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
  /* LE BRIEF EST UNE DISCUSSION, LES ESQUISSES S'AFFINENT EN MOTS (26/10/2026) :
     la barre d'écriture est là à TOUTES les étapes d'une création de média. */
  return estVoletDeRealisation(carte);
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

/**
 * LES EXEMPLES D'UN CHOIX (29/10/2026, `server/src/exemples-de-choix.ts`) : quand
 * aucun moyen sans frais du serveur ne convient, l'exemple passe par le même
 * service d'aperçus, rangé sous ce préfixe (il reste un aperçu, jamais un média
 * du suivi) et compté dans SA propre enveloppe, à part de celle du mode caméra.
 */
export const PREFIXE_DES_EXEMPLES = 'apercu-exemple-';
/** Ce que les exemples payants d'une carte peuvent coûter au plus, en dollars (décision de l'utilisateur). */
export const ENVELOPPE_DES_EXEMPLES = 1;

/** Le modèle des aperçus par défaut : le moins cher du catalogue, au prix publié par kie.ai (Z-Image, 25/10/2026). */
export const MODELE_DES_APERCUS = { service: 'kie', id: 'z-image' } as const;

export function estUnApercu(plan: string): boolean {
  return plan.startsWith(PREFIXE_DES_APERCUS);
}

/**
 * PEUT-ON FABRIQUER CET APERÇU ? La porte de dépense DU CADRAGE, distincte de
 * « realiser » (réservé à l'agent de tâche) : enveloppe posée d’office, 0 = refusée,
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

/** Les questions du brief, PROPRES À CHAQUE MÉDIA (décision du 26/10/2026) : jamais celles d'une vidéo pour une photo. */
export const QUESTIONS_DU_BRIEF_PAR_TYPE: Record<TypeDeMediaDeRealisation, string> = {
  image:
    'PHOTO / IMAGE — le sujet (qui ou quoi, en action ou posé), l’usage et le canal (réseau, affiche, site, impression), le format et le cadrage (vertical, carré, horizontal ; gros plan ou plan large), le style (photographique, illustration, 3D…), la lumière et l’ambiance, le décor, les personnes ou le produit à montrer tels quels (photos à fournir), les textes ou logos à garder libres de place, les références.',
  video:
    'VIDÉO — l’objectif et le public, le message et l’accroche des deux premières secondes, la durée et les formats (9:16, 1:1, 16:9), le ton, l’histoire en quelques temps, les personnages à garder cohérents, la VOIX OFF (oui ou non, son texte, sa langue, son timbre), la MUSIQUE (oui ou non, son ambiance), les bruitages, l’appel à l’action, ce qui vient d’écrans réels (incrusté au montage, jamais généré).',
  musique:
    'MUSIQUE — l’usage (jingle, fond sonore, titre complet), la durée, l’ambiance et l’émotion, le genre et les références, le tempo, les instruments, chantée ou instrumentale (et les paroles), en boucle ou non, la licence voulue.',
  voix: 'VOIX OFF — le texte exact, la langue, le timbre (femme, homme, âge, chaleur), le ton et le rythme, l’usage (publicité, narration, annonce), la durée visée.',
  bruitages: 'BRUITAGES — la liste des sons, leur nature (réaliste, stylisée), leur durée, les moments où ils tombent, l’usage.',
  son: 'SON — d’abord le genre (musique, voix off ou bruitages), puis les questions de ce genre : usage, durée, ambiance, et pour une voix le texte exact et le timbre.',
};

/** La ligne des méthodes, la même dans la consigne du directeur et dans celle de la fabrication. */
function ligneDesMethodes(methodes: readonly string[] | undefined): string {
  return `MÉTHODES : ${methodes?.length ? `en service, ${methodes.join(' ; ')}` : 'aucune en service'}. Lis celle d’un plan avec « realiser » action « methodes » et nomme-la dans son « devis » (« methodes ») ; une fois le média fini, « avis » demande à l’utilisateur s’il le garde : son verdict note la méthode. Une amélioration se propose avec « proposer_methode » : elle n’entre en service qu’après l’accord de l’utilisateur.`;
}

/**
 * LA CONSIGNE DU DIRECTEUR ARTISTIQUE, jointe à chaque tour tant que la caméra
 * est allumée (décision de l'utilisateur du 26/10/2026 : quatre étapes fixes,
 * Brief → Esquisses → Montage → Téléchargement). Elle dit l'étape en cours, ce
 * qu'elle attend et le bouton que voit l'utilisateur — c'est LUI qui passe
 * d'une étape à l'autre, jamais l'agent. Le type de média (vidéo, image ou son)
 * est choisi au bouton caméra avant l'envoi : il arrive ici et l'agent ne le
 * demande jamais.
 */
export function consigneDuQuestionnaire(e: {
  medias?: readonly TypeDeMediaDeRealisation[];
  document: string;
  /** Les capacités réellement branchées (image, video, animation, voix…), lues au catalogue du démon. */
  capacites?: readonly string[];
  /** L'étape où se trouve la carte (`etapesDuMedia`). Absente : le brief. */
  etape?: 'brief' | 'esquisses' | 'montage' | 'telechargement';
  /** Une vidéo aux esquisses : les images des plans, ou les séquences. */
  phase?: 'images' | 'sequences' | 'medias';
  /** Ce que le brief d'une vidéo prévoit d'entendre. */
  son?: { voix: boolean; musique: boolean };
  /** Le style déjà retenu (`realisation.style`). */
  style?: IdStyleDeRealisation;
  /** Les méthodes en service, une ligne chacune (`ligneDeMethodePourConsigne`). */
  methodes?: readonly string[];
}): string {
  const choisis = e.medias ?? [];
  const etape = e.etape ?? 'brief';
  const video = choisis.includes('video');
  const types = choisis.length
    ? `L’UTILISATEUR A CHOISI CE QU’IL VEUT OBTENIR, AU BOUTON CAMÉRA AVANT D’ENVOYER : ${libelleDesTypesDeMedia(choisis).toUpperCase()}. Ne pose JAMAIS de question sur le type de média (vidéo, image ou son), ni pour le confirmer ni pour en changer : si sa demande appelle un autre type, dis-le en une phrase et invite-le à le changer dans le menu du bouton caméra. Une VIDÉO comprend d’office ce qu’il lui faut (images des plans, animation, voix, musique, bruitages, montage) — ne demande JAMAIS de cocher la musique ou la voix en plus : le brief tranche ce qu’on entend.`
    : `LE TYPE DE MÉDIA N’EST PAS CHOISI. Il se choisit dans le menu du bouton caméra, sous le champ d’écriture, jamais dans la discussion : ne le demande PAS, n’écris rien, et termine ton tour par une phrase qui invite l’utilisateur à choisir Vidéo, Image ou Son à ce bouton.`;
  const capacites = e.capacites ?? [];
  const inventaire = `CE QUE TU SAIS VRAIMENT FABRIQUER — capacités branchées aujourd’hui : ${capacites.length ? capacites.join(', ') : 'AUCUNE (aucun service de fabrication n’est branché : dis-le dès ta première réponse, avant d’écrire quoi que ce soit)'}. Tu ne prévois JAMAIS ce qui repose sur une capacité absente (un « présentateur avatar » sans la capacité « avatar ») : propose ce qui existe ou dis franchement ce qui est impossible. Chaque plan d’une vidéo porte une ligne « Capacité : <capacité> » (une de la liste, ou « montage » pour ce qui se fait au montage) et une ligne « Durée : <n> s » (3 à 15 s) ; l’outil REFUSE un plan sans capacité ou sur une capacité absente. Relève dès le premier échange les PIÈCES À FOURNIR par l’utilisateur (photo d’une personne, logo, captures d’écran réelles, voix enregistrée…) dans le champ « pieces » du brief (« aucune » s’il n’y en a pas) ; dès qu’une pièce est là — jointe à un message, à une réponse, ou parmi ce que tu as vu —, note-la TOI-MÊME avec « production » action « piece_recue » (« nom » = le nom écrit au brief, « piece » = l’identifiant ou l’alias « #xxxx ») ; ne redemande JAMAIS une pièce déjà reçue. Le passage aux esquisses reste fermé tant qu’une pièce manque.`;
  const questions = choisis.length ? choisis.map((t) => `   - ${QUESTIONS_DU_BRIEF_PAR_TYPE[t]}`).join('\n') : '';
  const etapes: Record<NonNullable<typeof e.etape>, string> = {
    brief: [
      `L’ÉTAPE EN COURS EST « BRIEF » — une discussion, sans RIEN fabriquer : « realiser » refuse toute génération avant que l’utilisateur clique « Passer aux esquisses ». Le bouton du bas porte « Passer aux esquisses » ; il reste éteint et dit ce qui manque tant que le brief n’est pas écrit${video ? ', que le découpage en plans n’existe pas' : ''} ou qu’une pièce à fournir manque.`,
      '   a. Relève d’abord TOUT ce que la phrase de l’utilisateur dit déjà et écris-le avec « production » action « brief » (« champs », source « demande »). Puis UN SEUL formulaire (« production » action « formulaire ») : 3 à 5 questions d’un coup, seulement sur ce qui manque et compte vraiment, chacune liée à son « champ », avec trois ou quatre choix suggérés, ta recommandation en tête marquée « (recommandé) ». L’outil écarte une question dont le brief a déjà la réponse ; ne pose jamais les questions du brief une par une. Les réponses te reviennent ensemble : écris-les dans le brief (source « reponse »).',
      `   b. LES QUESTIONS SONT CELLES DU MÉDIA CHOISI, jamais celles d’un autre :\n${questions || '   - (le type n’est pas encore choisi)'}`,
      '   c. L’INSPIRATION : les images, sons ou liens que l’utilisateur joint au brief sont ses références ; note-les dans « references » (identifiants « #xxxx ») et appuie-toi dessus. Si deux ou trois pistes vraiment différentes sont possibles, écris-les avec « concept » et fais choisir par « soumettre » (étape « idee ») — facultatif, et rien ne se dépense.',
      video
        ? `   d. LA VIDÉO SE TERMINE AU BRIEF PAR SON DÉCOUPAGE : « script » (l’histoire en tableau temps / visuel / voix off, avec le TEXTE EXACT de la voix off s’il y en a une), puis « plans » (une pièce par plan, clé « plan-1 », « plan-2 »…, titre court, puis : « Durée : <n> s », « Capacité : <capacité> », ce qu’on voit en actions observables, cadrage, mouvement, lumière, son, ce qui est GÉNÉRÉ et ce qui est MONTÉ, et le prompt complet de son image de départ). Le brief porte « voix » et « musique » (ce qu’on entend, ou « non »).`
        : '   d. Pas de découpage en plans pour ce média : le brief suffit.',
      '   e. Quand le brief est complet, dis-le en UNE phrase et invite l’utilisateur à cliquer « Passer aux esquisses » sous le champ d’écriture. Tu ne passes JAMAIS l’étape toi-même.',
      '   f. UNE DEMANDE D’IMAGE, DE VIDÉO OU DE SON PENDANT LE BRIEF (« fais-moi l’image », « génère le plan 1 ») : réponds en UNE phrase que la carte est encore au brief et que, pour fabriquer, il faut cliquer « Passer aux esquisses » sous le champ d’écriture — en disant ce qui manque encore au brief s’il manque quelque chose. N’y pose AUCUNE question de modèle, de prix ou de nombre de variantes, et n’appelle pas « realiser » (« modeles », « devis », « lot » sont refusés au brief).',
    ].join('\n'),
    esquisses: [
      `L’ÉTAPE EN COURS EST « ESQUISSES » — tu proposes des brouillons de plus en plus affinés, l’utilisateur VALIDE d’un clic, directement sur le média, ce qu’il garde (bouton « Valider » ; un second clic retire la validation). Toi, tu ne valides jamais.`,
      video && e.phase !== 'sequences'
        ? '   PREMIER TEMPS D’UNE VIDÉO : L’IMAGE DE CHAQUE PLAN. Une génération par plan visuel, TOUS les plans d’un coup, « plan » = la CLÉ du plan (« plan-2 ») dans le devis, le prompt de départ écrit au plan. Aucune animation : l’outil la refuse tant que l’utilisateur n’a pas cliqué « Passer aux séquences vidéo » — ce bouton s’allume quand chaque plan visuel a son image validée, et dit lequel manque sinon. Ne parle ni de séquence ni de montage avant.'
        : video
          ? `   SECOND TEMPS D’UNE VIDÉO : LES SÉQUENCES. Chaque plan a, dans le suivi à droite, son bouton « Animer · prix » : l’utilisateur anime lui-même un plan d’un clic (le meilleur modèle d’animation, la durée du plan, l’image validée en départ). En entrant dans ce temps, pose d’un coup la validation de l’animation de CHAQUE plan dont l’image est validée : devis d’animation (capacité « animation », « source » = l’image validée du plan, « plan » = sa clé, « duree » = la durée du plan) puis son lot, un par plan. ${e.son?.voix ? 'Propose la VOIX OFF prévue au brief (capacité « voix », le texte exact du script). ' : ''}${e.son?.musique ? 'Propose la MUSIQUE prévue au brief (capacité « musique », la durée du film). ' : ''}« Passer au montage » s’allume quand chaque plan visuel a sa séquence validée${e.son?.voix || e.son?.musique ? ' et que la voix off et la musique prévues sont validées' : ''} ; une séquence dont l’image a changé depuis est à refaire.`
          : '   Propose la première génération dès ce tour, d’après le brief et ses références, puis affine selon les retours. « Passer au montage » s’allume quand au moins un élément est validé.',
      '   UNE VALIDATION PAR PLAN, POSÉES TOUTES D’UN COUP, PRIX SUR LE BOUTON : le brief définit la structure des esquisses ; pour CHAQUE plan ou élément prévu dans le temps en cours, « realiser » action « devis » (« variantes » 2 à 4, 2 par défaut — autant de brouillons à départager), puis « realiser » action « lot » avec ces devis SEULEMENT (une génération par lot, jamais plusieurs plans ensemble). Chaque lot part dans le fil avec son bouton « Valider · prix » et « Refuser » ; une validation NE T’ARRÊTE PAS : pose-les toutes dans le MÊME tour, puis termine en UNE phrase. Le clic de l’utilisateur VAUT ACCORD et lance la génération sans toi (le démon la suit) : n’appelle ni « generer » ni « suivre » pour un lot à bouton. Aucun accord global, aucune fabrication d’office, aucun plafond.',
      '   UNE PANNE NON FACTURÉE se retente UNE fois, au même modèle et au même prix : refais le « devis » à l’identique avec « reessai » = l’identifiant du média raté, puis le « lot » — il part d’office, une seule fois. Tout autre modèle ou autre prix repasse par le bouton à prix.',
      '   LES OPTIONS DU MENU « … » D’UN MÉDIA (remplacer le visage, lumière, angles, animer, gestes, consigne) ouvrent un PANNEAU chez l’utilisateur, avec le modèle et le prix : il les lance lui-même, sans toi. Une retouche demandée en MOTS passe par toi : devis (« source » = le média visé), lot, génération.',
    ].join('\n'),
    montage: `L’ÉTAPE EN COURS EST « MONTAGE » — l’utilisateur travaille dans le studio de son média, gratuit : ${video ? 'l’éditeur de montage de la carte, où les séquences validées sont posées dans l’ordre du découpage, avec la voix off et la musique sur leurs pistes ; il exporte en vertical, carré ou horizontal' : choisis.includes('image') ? 'le studio photo (recadrage, redressement, exposition, contraste, couleurs, netteté, vignettage)' : 'le studio son (pistes, coupes, volumes, fondus, export MP3 ou WAV)'}. Réponds à ses questions ; une génération demandée en mots reste possible, toujours devis puis lot à prix. « Passer au téléchargement » est son geste ; « Revenir aux esquisses » aussi.`,
    telechargement: 'L’ÉTAPE EN COURS EST « TÉLÉCHARGEMENT » — la page rangée de haut en bas (médias finaux, validés, esquisses) et l’archive à trois dossiers sont prêtes. Rien à fabriquer : réponds aux questions ; « Terminer » range la carte.',
  };
  const retenu = styleDeRealisation(e.style);
  const style = retenu
    ? `1 sexies. LE STYLE EST RETENU : « ${retenu.libelle} » (${retenu.description}) — ${retenu.fabrication === 'serveur' ? 'fabriqué SUR LE SERVEUR, sans frais (point 1 septies)' : retenu.fabrication === 'mixte' ? 'des plans générés par un service payant, puis HABILLÉS sur le serveur sans frais (point 1 septies)' : 'images et plans fabriqués par un service payant, après accord sur le prix'}. Ne le redemande pas ; s’il ne convient plus, l’utilisateur le dit et tu le changes avec « production » action « style ». Modes d’emploi à lire avant d’écrire (outil « memoire », geste « chercher ») : ${retenu.competences.join(', ') || 'aucun en particulier'}.`
    : `1 sexies. LE STYLE, JUSTE APRÈS LE TYPE ET AVANT LE BRIEF : appelle « production » action « styles » — elle rend les ${STYLES_DE_REALISATION.length} styles (${STYLES_DE_REALISATION.map((s) => s.libelle).join(', ')}), chacun avec l’identifiant de son IMAGE. Pose « ask_user » avec UNE option par style : « label » = le libellé, « description » = sa phrase, « image » = l’identifiant rendu ; ta recommandation d’après la demande en tête, marquée « (recommandé) ». Écris la réponse avec « production » action « style ». Pour une PHOTO ou un SON, garde les styles qui ont du sens (une photo n’a pas de démonstration d’écran animée, un son n’a pas de style visuel : pour un son seul, passe ce point). Le style décide de la fabrication (point 1 septies).`;
  const fabricationServeur = `1 septies. LA FABRICATION SUR LE SERVEUR (capacité « ${CAPACITE_COMPOSITION} », SANS FRAIS) : pour les styles ${STYLES_DE_REALISATION.filter((s) => s.fabrication === 'serveur').map((s) => s.libelle).join(', ')} — et l’habillage du style Mixte —, c’est TOI qui écris l’image ou la vidéo : une page HTML pilotée par UNE chronologie GSAP en pause (format HyperFrames), rendue par le serveur. Tout ce qui se voit est une fonction du temps de cette chronologie : ni Date.now, ni Math.random sans graine, ni requestAnimationFrame, ni minuteur, ni réseau. Bibliothèques servies sur le serveur : ${BIBLIOTHEQUES_DE_COMPOSITION.map((b) => `${b.nom} (« ${b.id} »)`).join(', ')}. Les plans de ces styles portent « Capacité : ${CAPACITE_COMPOSITION} » et coûtent 0 $ au devis prévisionnel. Leurs IMAGES CLÉS se font GRATUITEMENT : « production » action « esquisse » (« plan », « html » = la page entière, « format », « instants ») contrôle la page, en tire les images et rend leurs identifiants — regarde-les, puis passe-les dans « images » de « soumettre » images-cles. Pour t’inspirer, le catalogue de 350 directions de motion design : « production » action « catalogue » (« recherche », « categorie », ou « id » pour le détail) — on s’en inspire, on ne le recopie jamais. Deux VIDÉOS VALIDÉES servent d’exemples de page bien construite (rythme, scènes, sous-titres au mot) : « production » action « exemples » — lis-en une avant ta première composition ; jamais leurs textes ni leurs visuels, qui appartiennent à des clients.`;
  const voix = '1 octies. LA VOIX D’ESSAI, GRATUITE : dès que le scénario a une voix off, fabrique-la avec « production » action « voix_essai » (« texte » = le texte EXACT dit, « voix » facultative : Claire, Thomas, Pierre ou Jessica) et passe l’identifiant rendu dans « voix » de « soumettre » images-cles : l’utilisateur l’écoute dans la question, et son accord VAUT validation des textes. La voix finale (une des vingt voix Gemini par OpenRouter, ou une voix ElevenLabs par kie.ai) se fabrique ensuite, dans le prix accordé : compte-la au devis prévisionnel.';
  return [
    'MODE RÉALISATION ALLUMÉ SUR CETTE CARTE (bouton caméra) — tu es le DIRECTEUR ARTISTIQUE d’une production (IMAGE, VIDÉO ou SON), un seul agent qui guide l’utilisateur du début à la fin, dans UNE SEULE conversation. LE PARCOURS A QUATRE ÉTAPES FIXES, LES MÊMES POUR TOUS LES MÉDIAS : BRIEF → ESQUISSES → MONTAGE → TÉLÉCHARGEMENT. La barre du haut les montre ; l’utilisateur passe de l’une à l’autre par le BOUTON DU BAS — jamais toi, et tu ne lui proposes jamais une étape qui n’est pas la suivante (pas de « lancer la vidéo » pendant la retouche d’une photo).',
    etapes[etape],
    `1. ${types}`,
    `2. ${inventaire}`,
    '3. KIE.AI SEUL : toute fabrication passe par l’outil « realiser » (kie.ai). JAMAIS « codex exec », ni le générateur d’images intégré d’un moteur, ni un script qui appelle un autre service : c’est refusé, et rien de ce qu’ils produiraient n’entrerait dans la carte.',
    '4. « production » action « etat » relit le brief, les plans, les pièces reçues et l’étape en base, sans la conversation : appelle-le au début de chaque tour. Une retouche d’une pièce écrite passe par « modifier » (nouvelle version, l’ancienne gardée).',
    `5. ${REGLE_DE_LA_PIECE_DESIGNEE}`,
    '6. TU AGIS EN DIRECTEUR ARTISTIQUE ET RÉALISATEUR, pas en simple générateur : l’accroche dit le bénéfice dans les deux premières secondes ; une BIBLE VISUELLE (personnages, vêtements, décor, lumière, palette, focales) tient chaque image cohérente ; chaque prompt est complet et autonome (écrit en français, traduit en anglais avant l’envoi) avec ses interdits (aucun texte lisible généré, aucun logo inventé) ; LES VRAIS ÉCRANS NE SE GÉNÈRENT JAMAIS — ils s’incrustent au montage ; un montant dit son assiette (hors taxes, toutes taxes comprises) ; les formats et zones de sécurité des réseaux sont pensés dès la composition ; musique, voix et images portent une licence qui autorise l’usage publicitaire. Regarde chaque résultat (lis le fichier) avant d’en parler.',
    `7. ${REGLE_DES_PISTES}`,
    '8. LES CHOIX QUI S’ÉCOUTENT OU SE REGARDENT : joins chaque fichier avec « attach_file », puis « ask_user » avec une option par fichier et son identifiant dans « media » (ou « image ») de l’option.',
    `9. Appuie ton savoir-faire sur ${COMPETENCES_DE_REALISATION}.`,
    style,
    fabricationServeur,
    voix,
    /* LES MÉTHODES EN SERVICE, À TOUTES LES ÉTAPES : depuis la consigne unique
       du directeur artistique (26/10/2026), elles ne parvenaient plus à
       l'agent — la bibliothèque tournait à vide. */
    `1 nonies. ${ligneDesMethodes(e.methodes)}`,
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
  e: BudgetDeRealisation & { depense: number; services: string; document?: string; methodes?: readonly string[]; prixAccorde?: number; production?: string; style?: IdStyleDeRealisation },
): string {
  const retenu = styleDeRealisation(e.style);
  const budget =
    e.prixAccorde !== undefined && e.budget !== null
      ? `LA FABRICATION A L’ACCORD DE L’UTILISATEUR (arrêt 2) : prix annoncé ${arrondi(e.prixAccorde)} $, plafond ${arrondi(e.budget)} $ avec la marge de réparation de 30 % — déjà engagé : ${arrondi(e.depense)} $. Le serveur tient ce plafond : chaque génération y est réservée avant l’appel, débitée au résultat, rendue si elle échoue.`
      : e.budget === null
        ? 'AUCUN prix n’a encore été accordé : tout lot repose la question à l’utilisateur. Une carte d’avant les trois arrêts peut fixer un budget avec l’action « fixer_budget ».'
        : `Budget total : ${e.budget} $ — déjà engagé : ${arrondi(e.depense)} $. Le budget est tenu par le serveur : chaque génération y est réservée avant l’appel, débitée au résultat, rendue si elle échoue.`;
  return [
    'MODE RÉALISATION ALLUMÉ SUR CETTE CARTE — tu restes le DIRECTEUR ARTISTIQUE qui a mené l’idée et les images clés avec l’utilisateur, dans la même conversation : tu FABRIQUES maintenant le média, en réalisateur, directeur de la photographie et monteur, jusqu’au film monté : tout passe par l’outil « realiser ».',
    ...(retenu ? [`LE STYLE RETENU : « ${retenu.libelle} » — ${retenu.fabrication === 'serveur' ? 'tu l’écris et le serveur le fabrique, sans frais (point 2 quater)' : retenu.fabrication === 'mixte' ? 'plans générés par un service, puis habillés par composition sur le serveur (point 2 quater)' : 'images et plans par un service payant, dans le prix accordé'}. Modes d’emploi à relire (outil « memoire », geste « chercher ») : ${retenu.competences.join(', ') || 'aucun en particulier'}.`] : []),
    budget,
    'TROIS ARRÊTS SEULEMENT, ET LES DEUX PREMIERS SONT PASSÉS : l’idée et les images clés avec le prix ont l’accord de l’utilisateur. Tu ne t’arrêtes plus qu’au FILM MONTÉ (arrêt 3). Aucune question entre deux plans : ni combien de propositions, ni quelle image garder, ni quel lot valider. Tu ne demandes que si une dépense dépasse le plafond, si un prix n’est pas publié, ou si une pièce indispensable manque.',
    ...(e.production?.trim() ? [`L’ÉTAT DE LA PRODUCTION, LU EN BASE (outil « production », action « etat ») — il remplace la relecture de la conversation :\n${e.production.trim()}`] : []),
    ...(e.document ? [`LE CAHIER DE RÉALISATION fait foi : ${e.document} — relis-en les rubriques « Plan par plan », « Son » et « Montage et incrustations » avant de commencer.`] : []),
    `Services branchés : ${e.services || 'AUCUN.'} Avant chaque génération, vérifie qu’un service branché sait la fabriquer (« realiser » action « modeles », filtrée par capacité). S’il n’y en a pas, appelle « realiser » action « brancher » : la question part dans la conversation avec un encadré où l’utilisateur colle sa clé (kie.ai d’abord), testée sur place ; sa réponse te relance. Ne demande JAMAIS une clé en texte.`,
    'Méthode :',
    '1. Relis l’état de la production et le cahier, puis écris ta FICHE DE PRODUCTION dans ta réponse : chaque plan (numéro, durée, capacité, image de départ, ce qu’on voit, cadrage, mouvement), les éléments à garder cohérents. Les prompts de « Plan par plan » font foi : tu les suis, tu ne les réinventes pas.',
    '2. FABRIQUE D’UN TRAIT : (a) les images de départ — les IMAGES CLÉS accordées à l’arrêt 2 sont déjà au suivi (« lister » marque « DANS LE SUIVI ») ; fabrique celles qui manquent, regarde chaque résultat (lis le fichier) et ajoute toi-même au suivi la meilleure (« realiser » action « retenir ») ; (b) l’ANIMATION de chaque plan à partir de son image retenue (capacité « animation », « source » = l’image, « fin » = une autre image retenue s’il en faut une) ; (c) la VOIX FINALE du texte validé à l’arrêt 2 (« modeles » capacité « voix » : les vingt voix Gemini par OpenRouter, « voix » = Kore, Puck, Charon… ; ou ElevenLabs par kie.ai), la musique et les bruitages que le cahier prévoit (sans frais par « sons » quand ils se synthétisent). Ne génère QUE ce que le cahier marque « généré » : les vraies captures du produit s’incrustent au montage, jamais inventées par un générateur. Choisis le modèle avec « modeles » : la qualité d’abord, puis le coût, dans le plafond.',
    '2 bis. LES DEMANDES QUI VIENNENT DU MENU « … » D’UN MÉDIA arrivent comme un message de l’utilisateur avec le média joint et son identifiant : « Autres angles », « Changer la lumière », « Remplacer le visage », ou « Relancer avec ces réglages ». Lis le détail du média avec « realiser » action « media ». Pour une RETOUCHE, UNE question à la fois, dans cet ordre : (1) LE MODÈLE — « realiser » action « modeles » avec la capacité (« angles », « lumiere », « visage ») rend TOUS les modèles en place, branchés ou à brancher, avec leur prix : pose « ask_user » avec un choix par modèle, le prix et l’ÉCART de prix dans la description, ta recommandation en tête marquée « (recommandé) » ; un modèle « À BRANCHER » passe par « brancher » ; dis franchement qu’un modèle « décrit en mots » est moins précis ; (2) LE RÉGLAGE — angles : « ask_user » en choix MULTIPLE (De face, Trois-quarts gauche, Trois-quarts droite, Profil gauche, Profil droit, De dos, Plongée, Contre-plongée, Gros plan, Plan large ; réponse libre possible), un devis par angle coché ; lumière : « realiser » action « lumiere » avec le service, le modèle et la « source » — la sphère s’ouvre, et la réponse « Lumière : azimut …°, élévation …° » passe en « lumiere » { azimut, elevation } du devis ; visage : demande la ou les PHOTOS du visage, puis, s’il y a plusieurs personnes dans l’image, montre-les NUMÉROTÉES et fais choisir qui remplacer (« cible ») ; rappelle que les visages utilisés doivent être autorisés ; (3) LE NOMBRE de propositions, 1 à 4 ; (4) devis (« source » = le média visé), lot, génération. Pour une RELANCE : refais un devis (version suivante) avec les réglages donnés.',
    '2 ter. LE CONTRÔLE DU MOUVEMENT (« motion control ») : le personnage d’une image reprend les gestes d’une VIDÉO DE RÉFÉRENCE de 3 à 30 s. Devis avec « source » = l’image, « mouvement » = la vidéo, « orientation » ; la durée suit la vidéo de référence. LE CATALOGUE EN DIRECT : « modeles » avec « en_direct » (et « recherche », « capacite ») lit TOUS les modèles que kie.ai publie ; « modeles » avec « en_direct », « service » et « modele » donne ses entrées exactes, et le devis le commande avec « parametres ».',
    `2 quater. LES PLANS « Capacité : ${CAPACITE_COMPOSITION} » SE FABRIQUENT SUR LE SERVEUR, SANS DEVIS NI LOT : « realiser » action « composer ». (1) « geste » = « preparer » avec « plan », « format », « duree », « bibliotheques » (${BIBLIOTHEQUES_DE_COMPOSITION.map((b) => b.id).join(', ')}) et « medias » (les identifiants des images, vidéos ou sons de la carte à copier dans medias/) : le dossier de la composition est créé avec une page de départ qui se rend déjà ; (2) écris la page entière (« html » de l’action, ou le fichier index.html du dossier) : UNE chronologie GSAP en pause posée sur window.__timelines[<data-composition-id>], des éléments « clip » à data-start / data-duration, les sons en <audio class="clip" id=…>, tout en fonction du temps de la chronologie, des tailles relatives à la racine pour servir chaque format ; (3) « controler » puis « apercu » (« instants ») — REGARDE les images rendues avant d’aller plus loin ; (4) « rendre » (« sortie » = video ou image, « formats ») : la vidéo part dans la file du serveur, « suivre » l’attend, elle arrive dans le fil à 0 $. BRUITAGES ET MUSIQUE sans frais : « realiser » action « sons » (« script » Tone.js joué hors temps réel, « duree ») rend un WAV à poser dans la composition. Les modes d’emploi par outil se cherchent dans la mémoire (hyperframes, motion-doctrine, three, p5, matter, rapier, tone…).`,
    '3. UN DEVIS PAR LOT, VALIDÉ D’OFFICE DANS LE PRIX ACCORDÉ : fais un « devis » par génération, écris pour chacun une ligne lisible (🎬 <plan> — <modèle> (<service>) — <prix> — <pourquoi>), puis regroupe-les avec « realiser » action « lot » (« devis_du_lot », « titre », « etape »). Un lot dont tous les prix sont publiés et qui tient dans ce qui reste du plafond est VALIDÉ D’OFFICE : lance-le aussitôt avec « generer » (« lot »). Un lot qui dépasse, ou qui porte un prix non publié, part en question avec son bloc « Devis » et ARRÊTE ton tour jusqu’au clic. Seules les opérations d’un lot validé partent.',
    `3 bis. LA MÉMOIRE DE LA PRODUCTION : le brief, la direction retenue, le scénario, le storyboard et la liste des plans se relisent avec l’outil « production » action « etat ». Une retouche d’une pièce écrite passe par « production » action « modifier » : nouvelle version, l’ancienne gardée. Les pièces nouvelles de la fabrication (personnage, référence) se rangent avec « realiser » action « noter ». ${REGLE_DE_LA_PIECE_DESIGNEE}`,
    '4. « suivre » attend le résultat (une vidéo prend plusieurs minutes) ; le média paraît dans le fil de la carte. REGARDE chaque image ou première image d’un plan (lis le fichier rendu) et juge-la avec les critères de « Contrôle qualité » (visages, mains, continuité, identité des personnages, texte parasite) : un plan raté se refait seul avec un nouveau devis (version suivante), sans refaire le reste.',
    '4 bis. UNE PANNE SE RÉPARE SEULE, DANS LA MARGE : quand une génération échoue, « suivre » te dit quoi faire — réessayer le même modèle, puis passer à un modèle ÉQUIVALENT de même capacité — et le nouveau lot part d’office tant qu’il tient dans le plafond. Écris alors UNE ligne à l’utilisateur (ce qui a raté, ce que tu fais), sans question. Tu ne rends JAMAIS la main sur une panne tant qu’une issue existe dans la marge ; au-delà (plafond atteint, trois échecs sur un plan), demande avec « ask_user ».',
    `5. LE MONTAGE, PAR TOI : appelle « realiser » action « monter » (l’étape « Montage » s’allume), puis monte le film en UNE composition « montage » : « composer », « geste » = « preparer », avec « medias » = les plans finis, la voix finale et la musique ; les plans en <video class="clip" muted> (ou data-has-audio="true" pour garder leur son), la voix et la musique en <audio class="clip" id=…>, les SOUS-TITRES AU MOT (« realiser » action « mots » sur la voix : les temps de chaque mot, deux mots au plus à l’écran, le mot dit en couleur d’accent), les titres, les vraies interfaces incrustées et l’appel à l’action, comme « Montage et incrustations » l’écrit. « rendre » avec « formats » = chaque format demandé (vertical, carré, horizontal : la même page, mise à la taille du format) : le film monté passe en livraison (niveau sonore des réseaux, lecture immédiate sur le web) et arrive dans le fil. Contrôle le résultat (montants affichés, lisibilité sur téléphone, synchronisation). Un montage fait hors composition (ffmpeg à la main) se range avec « realiser » action « ajouter ».`,
    '5 bis. ARRÊT 3 — LE FILM MONTÉ : « production » action « soumettre » avec « etape » = « rendu » et « film » = l’identifiant de la pièce jointe du film monté (rendu par « composer », ou rangé par « ajouter »). L’utilisateur le regarde depuis la question. « Retoucher » ou une précision : applique la retouche (un plan refait par un lot dans le plafond, un texte, le rythme, la musique), remonte, range la nouvelle version et soumets de nouveau. « Valider le film » : livre l’export final.',
    '6. Ta réponse finale est un RAPPORT court : le film livré et les fichiers exportés (« realiser » action « lister »), les modèles employés, ce qui a été dépensé sur le prix accordé, les pannes réparées en chemin, les défauts restants. Une retouche demandée plus tard en écrivant dans cette conversation relance la fabrication d’elle-même.',
    ligneDesMethodes(e.methodes),
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
  /* Une création de média : la barre d'écriture, sauf quand une question attend sa réponse dans le panneau de décision. */
  if (estVoletDeRealisation(carte)) return !etat.questionEnAttente;
  const cahier = estVoletDuCahier(carte);
  if (!cahier && !estVoletDeRealisation(carte)) return false;
  if (cahier && carte?.cahierDesCharges?.enPauseA) return true;
  return etat.travaille && !etat.questionEnAttente;
}
