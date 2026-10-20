/**
 * LE MODE « RÉALISATION » (bouton caméra, carte du 18/10/2026) — règles PURES.
 *
 * L'interrupteur vit SUR LA CARTE (`parcours.realisationSouhaitee`), éteint à
 * la naissance. Allumé, la carte suit LE MÊME PARCOURS QUE LE CAHIER DES
 * CHARGES (`cahier-des-charges.ts`, décision de l'utilisateur du 18/10/2026) :
 *  - un VOLET À PART (`estVoletDeRealisation`) : avec ses trois étapes
 *    (`barreDeLaRealisation`) et un bandeau du bas — phase, pourcentage, pause,
 *    reprise, lecture du document. La barre d'écriture n'y existe que tant
 *    qu'aucun type de média n'est choisi et une fois le cahier terminé
 *    (`barreDEcritureDuVoletDeRealisation`) ;
 *  - ALLUMER NE LANCE RIEN ET N'OUVRE PAS LE VOLET : le bouton pose seulement
 *    le mode, le volet attend le premier message parti (`demandeA`). L'utilisateur
 *    écrit sa demande comme d'habitude, et la PREMIÈRE QUESTION du cadrage, dans
 *    la discussion, est « quels types de média ? » en choix multiple (image,
 *    vidéo, musique, voix off, bruitages). La réponse revient par l'outil
 *    (`medias`) et s'écrit sur la carte ;
 *  - L'ÉTAT VIT SUR LA CARTE (`Card.realisation`), jamais déduit des messages
 *    (MEM-0370) : le cadrage le réécrit après CHAQUE réponse avec le document
 *    (outil `cahier_de_realisation`, `docs/realisation/<carte>.md` du projet),
 *    et c'est lui qui permet de reprendre après une pause ;
 *  - le questionnaire finit par le BUDGET TOTAL et le SEUIL D'ACCORD par
 *    génération, écrits dans la rubrique « Budget et seuil » du document ;
 *  - l'agent de TÂCHE reçoit l'outil « realiser » et la méthode du réalisateur
 *    (`consigneDeFabrication`). Avant CHAQUE génération il annonce modèle, prix
 *    et raison ; au-delà du seuil, ou quand le prix n'est pas publié, il attend
 *    l'accord ; au budget atteint, il s'arrête (`decisionDeDepense`).
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
import type { EtapeDeSuivi } from './frise-de-suivi.js';
import type { SegmentDeSuivi } from './parcours-en-points.js';
import { MARQUE_A_VOIR, partiesDuCahier } from './cahier-des-charges.js';
import { REGLE_DES_PISTES } from './pistes-de-question.js';

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

/** La première question du cadrage, dans la discussion : elle oriente tout le reste. */
export const PREMIERE_QUESTION_DE_REALISATION = 'Quels types de média voulez-vous ?';

/** Les compétences importées que la méthode cite par leur nom. */
export const COMPETENCES_DE_REALISATION =
  'les compétences des bibliothèques de réalisation importées le 18/10/2026 (OSideMedia, higgsfield-ai, heygen-com, seaartpublic, pixelab-ch, smixs) — notamment « higgsfield » (méthode d’ensemble), « higgsfield-shotlist-director » et « storyboard-prompt-assistant » (découpage en plans), « higgsfield-camera », « higgsfield-style » et « higgsfield-motion » (cadrage, lumière, mouvement), « higgsfield-character-design » et « higgsfield-soul » (personnages cohérents), « higgsfield-troubleshoot » (plans ratés), les recettes par genre de pixelab (« higgsfield-cinematic », « higgsfield-ecommerce-ad », « higgsfield-social-hook », « higgsfield-brand-story », « higgsfield-real-estate »…), « heygen-video », « heygen-avatar » et « heygen-translate » (présentateur et langues), « image » et « video » de visual-skills (consignes d’image et de vidéo, licence CC-BY : attribution à Serge Shima). Ouvre-les avec l’outil « memoire » (« chercher » par leur nom)';

/* ------------------------------------------------------------------ */
/* L'état du questionnaire, sur la carte                               */
/* ------------------------------------------------------------------ */

/** Les types de média qu'on peut fabriquer — la réponse à la première question. */
export const TYPES_DE_MEDIA_DE_REALISATION = ['image', 'video', 'musique', 'voix', 'bruitages'] as const;
export type TypeDeMediaDeRealisation = (typeof TYPES_DE_MEDIA_DE_REALISATION)[number];

export const LIBELLES_TYPES_DE_MEDIA_DE_REALISATION: Record<TypeDeMediaDeRealisation, string> = {
  image: 'Image',
  video: 'Vidéo',
  musique: 'Musique',
  voix: 'Voix off',
  bruitages: 'Bruitages',
};

/** Ce que chaque choix veut dire, sous son libellé. */
export const DESCRIPTIONS_TYPES_DE_MEDIA_DE_REALISATION: Record<TypeDeMediaDeRealisation, string> = {
  image: 'Une ou plusieurs images fixes : visuel, affiche, illustration.',
  video: 'Un film : publicité, clip, accroche pour les réseaux, présentation.',
  musique: 'Une musique originale : jingle, fond sonore, titre complet.',
  voix: 'Une voix qui lit un texte : voix off, narration, annonce.',
  bruitages: 'Des sons et ambiances : effets, bruits de fond.',
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
        realisation?: Partial<Pick<EtatDeRealisation, 'demandeA' | 'medias' | 'genre' | 'termineA'>> | null;
      }
    | null
    | undefined,
): boolean {
  if (!carte?.parcours?.realisationSouhaitee || carte.cahierDesCharges || carte.archivedAt) return false;
  if (!(COLONNES_AVANT_LE_TRAVAIL as readonly string[]).includes(String(carte.column ?? ''))) return false;
  const r = carte.realisation;
  return !!(r?.demandeA || r?.termineA || typesDeMediaDeLaRealisation(r).length);
}

/**
 * LA BARRE D'ÉCRITURE SOUS LE BANDEAU : tant qu'aucun type de média n'est choisi
 * (l'utilisateur écrit sa demande, et c'est ce message qui lance le cadrage —
 * allumer le mode ne lance rien) et une fois le cahier TERMINÉ (sans elle, un
 * cahier imparfait ne pourrait plus être amélioré). Pendant le questionnaire
 * (en cours, en pause) on répond dans le panneau de décision et rien ne change.
 * UN SEUL PRÉDICAT pour l'écran et les contrôles.
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
  return etat === 'termine' || etat === 'genre';
}

export type EtatDuQuestionnaire = 'genre' | 'en-cours' | 'en-pause' | 'termine';

export function etatDeLaRealisation(r: Pick<EtatDeRealisation, 'medias' | 'genre' | 'enPauseA' | 'termineA'>): EtatDuQuestionnaire {
  if (!typesDeMediaDeLaRealisation(r).length) return 'genre';
  if (r.enPauseA) return 'en-pause';
  if (r.termineA) return 'termine';
  return 'en-cours';
}

/** Tant que le cahier n'est pas déclaré terminé, la barre ne se remplit jamais tout à fait. */
export const POURCENTAGE_MAX_AVANT_LA_FIN = 95;

/** La part faite, de 0 à 100. Un total inconnu ne promet rien : 0. Pleine seulement une fois le cahier terminé. */
export function pourcentageDeLaRealisation(r: Pick<EtatDeRealisation, 'faites' | 'total' | 'termineA'>): number {
  if (r.termineA) return 100;
  if (!r.total) return 0;
  return Math.max(0, Math.min(POURCENTAGE_MAX_AVANT_LA_FIN, Math.round((r.faites / r.total) * 100)));
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
  'Le mode réalisation est allumé et le cahier n’est pas écrit : ne rends pas de compréhension. Écris le document ENTIER avec « cahier_de_realisation » (types de média dans « medias », avancement, rubriques), puis, une fois tout tranché, rappelle l’outil avec « termine » = vrai.';

/** Les trois étapes de la barre : les types de média, le questionnaire, la fabrication. */
export function barreDeLaRealisation(r: Pick<EtatDeRealisation, 'medias' | 'genre' | 'enPauseA' | 'termineA'>): SegmentDeSuivi[] {
  const fini = !!r.termineA;
  const choisis = typesDeMediaDeLaRealisation(r).length > 0;
  return [
    { etape: 'genre', etat: choisis ? 'fait' : 'question' },
    { etape: 'questionnaire', etat: !choisis ? 'avenir' : fini ? 'fait' : r.enPauseA ? 'question' : 'encours' },
    { etape: 'fabrication', etat: fini ? 'question' : 'avenir' },
  ];
}

/** L'étape où se trouve le volet. */
export function etapeCouranteDeLaRealisation(r: Pick<EtatDeRealisation, 'medias' | 'genre' | 'termineA'>): EtapeDeSuivi {
  if (!typesDeMediaDeLaRealisation(r).length) return 'genre';
  return r.termineA ? 'fabrication' : 'questionnaire';
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
 * Allumer le mode ne lance rien : la première question, posée DANS la
 * discussion au premier message de l'utilisateur, est « quels types de média ? »
 * (choix multiple, audio compris). Une fois tranchés, ils arrivent dans la
 * consigne et l'agent ne les redemande jamais.
 */
export function consigneDuQuestionnaire(e: { medias?: readonly TypeDeMediaDeRealisation[]; document: string }): string {
  const choisis = e.medias ?? [];
  const types = choisis.length
    ? `L’UTILISATEUR A DÉJÀ RÉPONDU À « ${PREMIERE_QUESTION_DE_REALISATION} » : ${libelleDesTypesDeMedia(choisis).toUpperCase()}. Ne repose JAMAIS cette question ; si sa demande change les types voulus, repose-la une fois et passe la nouvelle liste dans « medias ».`
    : `AUCUN TYPE DE MÉDIA N’EST ENCORE CHOISI. Ta PREMIÈRE question, avant toute autre, est « ${PREMIERE_QUESTION_DE_REALISATION} » avec « ask_user » en choix MULTIPLE (kind « multiple »), avec ces options et leur description : ${TYPES_DE_MEDIA_DE_REALISATION.map((t) => `« ${LIBELLES_TYPES_DE_MEDIA_DE_REALISATION[t]} » (${DESCRIPTIONS_TYPES_DE_MEDIA_DE_REALISATION[t]})`).join(', ')}. Recommande celles que la demande de l’utilisateur appelle déjà. Dès sa réponse, écris un premier document avec « cahier_de_realisation » en passant « medias » = la liste choisie (valeurs : ${TYPES_DE_MEDIA_DE_REALISATION.join(', ')}) : l’outil REFUSE d’écrire tant que « medias » n’est pas donné. Rien ne se fabrique et aucune autre question ne se pose avant cette réponse.`;
  return [
    'MODE RÉALISATION ALLUMÉ SUR CETTE CARTE (bouton caméra) — tu cadres une IMAGE ou une VIDÉO, en réalisateur, scénariste et directeur de la photographie. Ce questionnaire REMPLACE les questions génériques de cadrage, et il SUIT LE PARCOURS DU CAHIER DES CHARGES : une question à la fois, un document réécrit après chaque réponse, une pause possible à tout moment.',
    `1. ${types}`,
    '2. UNE question à la fois avec « ask_user », seulement celles qui comptent pour les médias CHOISIS, chacune avec des choix concrets et ta recommandation en tête, marquée « (recommandé) » : genre de production (publicité produit, publicité d’application, film de marque, accroche pour les réseaux, clip, présentation, immobilier, film d’animation, tutoriel…), objectif, public, message, accroche et appel à l’action, durée et formats (vertical 9:16, carré 1:1, portrait 4:5, horizontal 16:9), histoire et découpage en scènes puis en plans, style visuel et références, cadrage, optique et mouvements de caméra, lumière, étalonnage et couleurs, personnages, décors et costumes à garder cohérents, présentateur humain et langues de déclinaison, voix off, musique et bruitages, textes à l’écran et sous-titres, images de référence fournies (première et dernière image d’un plan), ce qui vient d’un écran réel et ce qui est généré, licences. Pour la MUSIQUE : usage, durée, ambiance et émotion, genre musical et références, tempo, instruments, voix chantée ou non, paroles, boucle ou titre complet, licence. Pour la VOIX OFF : texte exact, langue, ton, rythme, voix homme ou femme. Pour les BRUITAGES : liste des sons, durée, moments du plan où ils tombent. Une rubrique qui ne concerne aucun des médias choisis s’écrit « Sans objet ». L’utilisateur répond dans le panneau de décision : une fois le premier message envoyé et tant que le cahier n’est pas terminé, il n’a pas de barre d’écriture sur cette carte (voir le point 7 bis pour la suite).',
    `2 bis. ${REGLE_DES_PISTES} Exemple : pour « comment la vidéo invite-t-elle à vous contacter ? », ne propose pas seulement « adresse du site » et « formulaire » ; ajoute par exemple un mot-clé dit par le présentateur puis un message direct, un code à l’écran, une offre limitée dans le temps.`,
    '3. TU AGIS EN DIRECTEUR ARTISTIQUE, RÉALISATEUR PUBLICITAIRE ET SUPERVISEUR DE POSTPRODUCTION — pas en simple générateur. La chaîne : brief commercial → direction artistique → storyboard → prompts par plan → génération → montage → validation. Le cahier couvre TOUTE la chaîne, jusqu’aux prompts et au contrôle, pas seulement le brief et le storyboard. Huit règles de fond :',
    '   a. L’ACCROCHE : les deux premières secondes disent déjà le bénéfice pour le spectateur (pas une scène d’ambiance). Propose deux ou trois accroches par « ask_user ». Le scénario montre un CONTRASTE avant/après, du rythme et de la personnalité — pas une simple suite d’actions descriptives.',
    '   b. LA BIBLE VISUELLE avant toute génération : visage exact des personnages, vêtements, décor, lumière, palette, texture, étalonnage, focales, tailles de plan, mouvements de caméra, transitions, références de cadrage. Sans elle, chaque plan ressemble à une publicité différente.',
    '   c. SCÉNARIO ≠ PROMPTS. « Scénario et découpage » est un tableau temps / visuel / voix off. « Plan par plan » donne, pour CHAQUE plan, un prompt de génération complet et autonome (en anglais pour un générateur vidéo) avec : image de départ (et d’arrivée), références de personnage et de lieu, taille de plan, focale indicative, mouvement principal et secondaire, profondeur de champ, durée, interdits (aucun texte lisible généré, aucun logo, aucun personnage en plus, aucun mouvement brusque) et critères de validation. Chaque plan dit aussi ce que l’IA GÉNÈRE et ce qui se fait AU MONTAGE.',
    '   d. LES VRAIS ÉCRANS NE SE GÉNÈRENT JAMAIS : les captures réelles du produit sont incrustées au montage, avec animations contrôlées ; le plan généré garde un écran vide remplaçable. « Montage et incrustations » écrit chaque incrustation, les sous-titres, les titres et l’appel à l’action animé.',
    '   e. L’EXACTITUDE COMMERCIALE : demande l’assiette de chaque montant (hors taxes, toutes taxes comprises, net) et écris le calcul. Une promesse (gain, commission, remise) n’est jamais montrée comme acquise : sa condition (abonnement souscrit et payé, durée) est dite à l’image ou à la voix.',
    '   f. LES FORMATS dès la composition : zones de sécurité des interfaces sociales prévues dans chaque plan, déclinaisons horizontales et carrées pensées au départ plutôt que recadrées après coup ; textes, sous-titres et appel à l’action lisibles sur téléphone.',
    '   g. LES DROITS : musique, voix, images et ressources externes portent une licence qui autorise explicitement l’usage publicitaire, écrite dans « Droits et conformité » ; une musique « composée » n’est pas libre de droits d’office.',
    '   h. LE CONTRÔLE ET LE RAPPORT : « Contrôle qualité » liste ce qu’on vérifie (visages, mains, continuité, lisibilité, synchronisation voix et image, montants, formats, conformité du message) ; la fabrication rendra un rapport final (modèles et réglages employés, crédits dépensés, défauts restants, fichiers sources réutilisables).',
    '4. LES DEUX dernières questions sont OBLIGATOIRES et viennent APRÈS un « Devis prévisionnel » calculé plan par plan (modèle visé, prix publié si le service le donne — sinon dis qu’il est inconnu —, nombre de tentatives, total). Puis le BUDGET TOTAL de la fabrication, en dollars (les services facturent en dollars), et le SEUIL D’ACCORD par génération (au-delà, l’agent demandera l’accord avant de lancer), avec un nombre MAXIMAL de nouvelles tentatives par plan. Le budget ne sort JAMAIS d’un chiffre arbitraire : il découle du devis. Les générations abouties se facturent même quand le résultat déplaît, et une utilisation automatisée consomme des crédits même quand une offre promet de l’illimité sur son site ; si le plafond voulu est trop bas pour le devis, dis ce qui devient impossible au lieu de rogner la qualité en silence. Aucune dépense ne part sans validation.',
    `5. APRÈS CHAQUE RÉPONSE, AVANT LA QUESTION SUIVANTE, appelle « cahier_de_realisation » avec le document ENTIER mis à jour et l’avancement : « faites » (questions tranchées, le genre compris), « total » (questions prévues, ajusté en chemin), « phase » (${PHASES_DE_REALISATION.join(', ')}), « restants » (ce qui reste à voir, quelques mots chacun). L’outil l’écrit dans ${e.document} du projet ; l’utilisateur le lit depuis la carte pendant qu’il s’écrit. Le document porte ces rubriques « ## », dans cet ordre : ${RUBRIQUES_DE_REALISATION.map((r) => `« ${r} »`).join(', ')} ; une rubrique pas encore tranchée porte « ${MARQUE_A_VOIR} », une rubrique sans objet pour ce média s’écrit « Sans objet : <raison> ». « Budget et seuil » s’écrit EXACTEMENT sous cette forme, sur trois lignes : « Budget total : <montant> $ », « Seuil d’accord par génération : <montant> $ » puis « Nouvelles tentatives maximales par plan : <nombre> ».`,
    '6. L’UTILISATEUR PEUT METTRE EN PAUSE à tout moment : ton tour s’arrête net. À la reprise, on te redonne le document et l’avancement : ne repose JAMAIS une question déjà tranchée.',
    `7. QUAND TOUT EST TRANCHÉ (budget et seuil compris) : relis le document comme un directeur de production — chaque rubrique écrite, chaque plan avec son prompt et sa mention généré ou monté, chaque montant avec son assiette, devis et budget cohérents. Puis appelle « cahier_de_realisation » avec « termine » = vrai et le document complet, sans plus aucune marque « ${MARQUE_A_VOIR} » : l’outil REFUSE de terminer tant qu’une rubrique manque ou reste à voir, et te dit laquelle. Tu ne rends PAS de plan : le document le remplace. Termine ton tour par une phrase qui dit que le cahier de réalisation est complet et que la fabrication part au clic sur « Lancer la fabrication ».`,
    `7 bis. APRÈS « TERMINÉ », L’UTILISATEUR PEUT ÉCRIRE : la barre d’écriture revient sous le bandeau pour demander une amélioration du cahier (un plan à changer, un ton, un budget, une rubrique à creuser). Relis alors ${e.document}, applique la demande, puis réécris le document ENTIER avec « cahier_de_realisation » et « termine » = vrai (tout reste complet et sans « ${MARQUE_A_VOIR} »). Si la demande rouvre une VRAIE question, appelle l’outil avec « termine » = faux, pose la question avec « ask_user » puis reviens au point 7. Sans « termine » dans l’appel, le cahier repasse « en cours ». Tu ne rends pas de plan et tu ne lances pas la fabrication : elle part au clic sur « Lancer la fabrication ». Termine par une phrase qui dit ce qui a changé dans le cahier.`,
    `8. Appuie tes questions et ton découpage sur ${COMPETENCES_DE_REALISATION}.`,
    'Rien ne se génère pendant le cadrage : la fabrication part au lancement de la carte, par l’agent de tâche.',
  ].join('\n');
}

/** La reprise après une pause : tout ce qu'il faut pour repartir sans la conversation. */
export function demandeDeRepriseDeRealisation(r: EtatDeRealisation, document: string | null | undefined, chemin: string): string {
  const restants = r.restants.length ? r.restants.map((x) => `- ${x}`).join('\n') : '(aucun point noté)';
  return `REPRISE DU QUESTIONNAIRE DE RÉALISATION APRÈS UNE PAUSE. L’utilisateur revient : repars EXACTEMENT où tu t’étais arrêté.

AVANCEMENT ENREGISTRÉ : ${typesDeMediaDeLaRealisation(r).length ? libelleDesTypesDeMedia(typesDeMediaDeLaRealisation(r)) : 'types de média pas encore choisis'}, ${r.faites} question(s) tranchée(s)${r.total ? ` sur ${r.total} prévue(s)` : ''}, phase « ${LIBELLES_PHASES_DE_REALISATION[r.phase]} ».

CE QUI RESTE À VOIR :
${restants}

LE DOCUMENT TEL QU’IL EST ENREGISTRÉ (${chemin}) :
${String(document ?? '').trim() || '(le document n’a pas pu être lu : reprends depuis l’avancement ci-dessus)'}

Ne repose aucune question déjà tranchée dans ce document. Pose la question SUIVANTE avec « ask_user », puis continue le parcours.`;
}

/* ------------------------------------------------------------------ */
/* Un cahier complet, vérifié avant de le dire terminé                  */
/* ------------------------------------------------------------------ */

const sansAccent = (texte: string): string => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * CE QUI MANQUE POUR QUE LE CAHIER SOIT COMPLET : une rubrique absente, une
 * rubrique restée « à voir » (ou vide), un budget et un seuil non écrits en
 * dollars. Vide : le cahier peut être dit terminé. L'outil refuse « termine »
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
  const { budget, seuil } = budgetDuCahier(parties.map((p) => ({ titre: p.titre, contenu: p.texte })));
  if (budget === null) lacunes.push('« Budget total : <montant> $ » n’est pas écrit en dollars');
  if (seuil === null) lacunes.push('« Seuil d’accord par génération : <montant> $ » n’est pas écrit en dollars');
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

/** Les deux réponses d'une question d'accord. */
export const REPONSE_LANCER = 'Lancer';
export const REPONSE_NE_PAS_LANCER = 'Ne pas lancer';

/** La réponse donnée vaut-elle accord ? Le choix « Lancer » (ou « Accepter »), complément libre toléré. */
export function accordDeRealisationDonne(reponse: string | undefined): boolean {
  return /^\s*(lancer|accepter|oui)\b/i.test(reponse ?? '');
}

/** La question d'ACCORD avant une génération : modèle, prix, raison, et où en est le budget. */
export function questionDAccordDeRealisation(e: {
  modele: string;
  service: string;
  prixLibelle: string;
  raison: string;
  motif: string;
  depense: number;
  budget: number | null;
  plan?: string;
}): { question: string; description: string; options: { label: string; description: string }[] } {
  const reste = e.budget === null ? '' : ` Budget : ${arrondi(e.depense)} $ dépensés sur ${e.budget} $.`;
  return {
    question: `Lancer ${e.plan ? `« ${e.plan} » ` : 'cette génération '}avec ${e.modele} (${e.service}) ?`,
    description: `Prix : ${e.prixLibelle}. Pourquoi ce modèle : ${e.raison.trim().slice(0, 400)} Accord demandé parce que ${e.motif}${reste}`.slice(0, 1000),
    options: [
      { label: REPONSE_LANCER, description: 'La génération part tout de suite.' },
      { label: REPONSE_NE_PAS_LANCER, description: 'Rien n’est dépensé ; l’agent propose autre chose.' },
    ],
  };
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

export function consigneDeFabrication(e: BudgetDeRealisation & { depense: number; services: string; document?: string }): string {
  const budget =
    e.budget === null
      ? 'AUCUN budget n’est écrit dans le cahier des charges : avant toute génération, demande-le avec l’action « fixer_budget » (budget total et seuil, en dollars).'
      : `Budget total : ${e.budget} $ — déjà dépensé : ${arrondi(e.depense)} $. Seuil d’accord par génération : ${e.seuil === null ? 'non écrit (chaque génération demandera l’accord)' : `${e.seuil} $`}.`;
  return [
    'MODE RÉALISATION ALLUMÉ SUR CETTE CARTE — tu FABRIQUES le média décrit par le cahier des charges, en réalisateur, directeur de la photographie et monteur. Le Studio n’a rien à voir avec ce travail : tout passe par l’outil « realiser ».',
    budget,
    ...(e.document ? [`LE CAHIER DE RÉALISATION, établi question par question avec l’utilisateur, fait foi : ${e.document} — lis-le EN ENTIER avant tout.`] : []),
    `Services branchés : ${e.services || 'aucun — dis-le à l’utilisateur : il les branche dans Réglages › Services de création.'}`,
    'Méthode :',
    '1. Relis le cahier (le cahier de réalisation s’il existe, sinon le cahier des charges du plan) EN ENTIER, puis écris ta FICHE DE PRODUCTION : chaque scène, chaque plan (numéro, durée, ce qu’on voit en actions observables, cadrage, mouvement, lumière), les éléments à garder cohérents (personnages, décors, costumes, palette). Les prompts de la rubrique « Plan par plan » font foi : tu les suis, tu ne les réinventes pas.',
    '2. FABRIQUE DANS L’ORDRE : bible visuelle et images de référence (un personnage, un décor) d’abord, validées en les REGARDANT ; puis les plans, un par un ; puis le montage. Ne génère QUE ce que le cahier marque « généré » : les vraies captures du produit s’incrustent au montage, jamais inventées par un générateur. Choisis le modèle de chaque plan avec « realiser » action « modeles » (filtré par capacité : image, video, voix, son, musique, avatar) : la qualité d’abord, puis le coût.',
    '3. AVANT CHAQUE génération, fais un « devis » : il rend le prix. Écris alors dans ta réponse, en une ligne lisible : 🎬 <plan> — <modèle> (<service>) — <prix> — <pourquoi>. Puis « generer » avec l’identifiant du devis. Au-delà du seuil, ou quand le prix n’est pas publié, « generer » pose la question d’accord et ATTEND la réponse : rappelle alors « generer » avec le même devis. Une génération aboutie se facture même ratée : respecte le nombre maximal de nouvelles tentatives par plan écrit dans « Budget et seuil » ; au-delà, arrête-toi et demande.',
    '4. « suivre » attend le résultat (une vidéo prend plusieurs minutes) ; le média paraît dans le fil de la carte. REGARDE chaque image ou première image d’un plan avant de passer au suivant (lis le fichier rendu) et juge-le avec les critères de la rubrique « Contrôle qualité » (visages, mains, continuité, identité des personnages, texte parasite) : un plan raté se refait seul avec un nouveau devis (version suivante), sans refaire le reste.',
    '5. Le montage final (enchaînement des plans, vraies interfaces incrustées, voix, musique, sous-titres, titres, appel à l’action, formats vertical, carré et horizontal avec leurs zones de sécurité) se fait avec ffmpeg dans le dossier des médias, comme « Montage et incrustations » l’écrit ; le fichier monté se range avec « realiser » action « ajouter ». Contrôle le résultat final (montants affichés, lisibilité sur téléphone, synchronisation) avant de le rendre.',
    '6. Ta réponse finale est un RAPPORT : tous les médias produits (« realiser » action « lister »), les modèles et réglages employés, les crédits dépensés et ce qui reste du budget, les défauts restants, les fichiers sources réutilisables.',
    `Savoir-faire : ${COMPETENCES_DE_REALISATION}.`,
  ].join('\n');
}
