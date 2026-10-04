/**
 * LA LISTE UNIQUE DES NOTIFICATIONS.
 *
 * Ce qui réclamait l'attention se lisait à DEUX endroits, et jamais ensemble :
 * les questions en attente sous un point d'interrogation du bandeau, et tout ce
 * que le guichet des notifications (`server/src/notify.ts`) pousse vers les
 * onglets ouverts et les téléphones — qui, lui, ne laissait aucune trace une
 * fois le message passager effacé. Une tâche terminée pendant qu'on regardait
 * ailleurs était donc simplement perdue.
 *
 * Ce fichier réunit les deux en UNE liste, sans base ni réseau — donc testable
 * seule :
 *
 *  - les DEMANDES ouvertes (questions d'agent, cartes proposées) : elles ne
 *    s'effacent pas toutes seules, elles se règlent ;
 *  - les ANNONCES reçues du guichet (fin de tâche, échec, publication, quota…) :
 *    elles se lisent, et restent consultables ensuite.
 *
 * Deux invariants tiennent tout :
 *
 *  1. UNE DEMANDE OUVERTE PASSE TOUJOURS DEVANT UNE ANNONCE, si ancienne
 *     soit-elle : c'est la seule chose qui bloque quelqu'un.
 *  2. UNE ANNONCE QUI DOUBLE UNE DEMANDE OUVERTE NE S'AJOUTE PAS. Le guichet
 *     annonce « décision attendue » au moment même où la demande naît : sans
 *     cette règle, la même question paraîtrait deux fois dans la liste.
 */
import { DecisionAttendue, decisionsOuvertes } from './decision-attendue.js';
import { iconeDeLAttention } from './nature-attention.js';
import {
  GenreDAlerte,
  IconeNotification,
  MOTIFS,
  MotifNotification,
  genreDeLAlerte,
  iconeDuMotif,
} from './notification-tri.js';

/** Ce que le guichet de notifications a poussé vers l'onglet ouvert. */
export interface AnnonceRecue {
  /** Identifiant local, posé à la réception : deux annonces identiques restent deux lignes. */
  id: string;
  titre: string;
  corps: string;
  /** Le motif du guichet ; absent, l'annonce est traitée comme une simple information. */
  motif?: string;
  /** Quand elle est arrivée. */
  a: number;
  /** Lue par l'utilisateur (il a ouvert le tiroir depuis). */
  lue?: boolean;
  projectId?: string;
  cardId?: string;
  agentId?: string;
}

/** Une ligne de la liste, quelle que soit sa provenance. */
export interface LigneNotification {
  /** Clé d'affichage, unique dans la liste. */
  cle: string;
  /** D'où elle vient : une demande à régler, ou une annonce à lire. */
  source: 'demande' | 'annonce';
  /** Le genre de nouvelle — il choisit la couleur et l'icône. */
  genre: GenreDAlerte;
  icone: IconeNotification;
  /** Le titre court : le projet et l'endroit pour une demande, le titre du guichet sinon. */
  titre: string;
  /** Le texte : la question posée, ou le corps de l'annonce. */
  texte: string;
  /** Quand elle a été posée ou reçue. `0` quand on ne sait pas. */
  a: number;
  /** Encore à régler : une demande ouverte, ou une annonce jamais lue. */
  nonLue: boolean;
  /** Où emmener au clic. Vide : la ligne n'est pas cliquable. */
  lieu: { projectId?: string; cardId?: string; agentId?: string; messageId?: string };
  /** La demande d'origine, quand c'en est une : l'affichage y reprend son détail. */
  demande?: DecisionAttendue;
}

/** Au-delà, les plus anciennes annonces sortent : une liste sans fin ne se lit plus. */
export const PLAFOND_ANNONCES = 50;

/**
 * Le titre d'une annonce arrive parfois précédé d'un emoji de genre
 * (`titreNotification`, côté serveur) : c'est le seul repère visuel qui
 * survit sur un téléphone verrouillé, où le système impose l'icône de
 * l'application. Dans le tiroir, ce repère fait DOUBLE EMPLOI avec l'icône
 * déjà posée à gauche de chaque ligne — on le retire donc à l'affichage,
 * sans toucher au texte gardé pour la notification système elle-même.
 */
export function titreSansEmoji(titre: string): string {
  return titre.replace(/^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}]️?‍?)+\s*/u, '');
}

/**
 * Le genre d'une annonce reçue. `genreDeLAlerte` lit une table figée et tombe
 * sur un motif qu'elle ne connaît pas : un démon plus récent, un champ libre.
 * On vérifie donc le motif AVANT de la consulter, et sans motif connu l'annonce
 * se lit comme une information terminée.
 */
export function genreDeLAnnonce(motif?: string): GenreDAlerte {
  if (!motif || !(motif in MOTIFS)) return 'termine';
  return genreDeLAlerte(motif as MotifNotification) ?? 'termine';
}

/**
 * L'image d'une annonce reçue. `iconeDuMotif` lit une table figée : un motif
 * inconnu — une version plus récente du démon, un champ libre — la ferait
 * retomber sur rien. On retombe alors sur l'image d'une fin de travail.
 */
export function iconeDeLAnnonce(motif?: string): IconeNotification {
  if (!motif || !(motif in MOTIFS)) return 'termine';
  return iconeDuMotif(motif as MotifNotification);
}

/**
 * Une annonce double-t-elle une demande déjà ouverte ? Le guichet annonce
 * « décision attendue » à l'instant où la question naît : sans ce filtre, la
 * question paraîtrait deux fois, une fois à régler et une fois à lire.
 */
export function annonceDoublonne(annonce: AnnonceRecue, demandes: DecisionAttendue[]): boolean {
  if (genreDeLAnnonce(annonce.motif) !== 'attente') return false;
  return demandes.some(
    (demande) =>
      (annonce.cardId && demande.cardId === annonce.cardId) ||
      (annonce.agentId && demande.agentId === annonce.agentId),
  );
}

/**
 * Le temps qu'on laisse à une annonce de décision avant de la juger éteinte.
 *
 * L'annonce est poussée à l'instant même où la question naît, et la liste des
 * décisions arrive par un autre chemin (la diffusion `attention`) : pendant
 * quelques secondes, l'annonce est seule et parfaitement légitime. Une minute
 * couvre largement cet écart, et reste bien en deçà du moment où l'on revient
 * voir sa cloche.
 */
export const GRACE_ANNONCE_MS = 60_000;

/**
 * UNE DÉCISION ANNONCÉE DONT LE PORTEUR N'EXISTE PLUS S'EFFACE.
 *
 * Le guichet pousse « une réponse est attendue » ; l'annonce, elle, vit dans le
 * navigateur et survit à ce dont elle parle. Quand l'agent qui posait la
 * question s'en va — l'assistant d'une fiche de sauvegarde part avec sa fiche —
 * le serveur cesse de compter la décision, mais la ligne restait affichée,
 * orange, sans rien à ouvrir : le fantôme.
 *
 * La règle, et ses trois verrous — une annonce de genre « attente » s'efface
 * quand, ET SEULEMENT QUAND :
 *
 *  1. son porteur est ABSENT des porteurs connus. Sans cette liste, on ne
 *     présume rien : une annonce dont la question a simplement reçu sa réponse
 *     reste lisible, c'est une trace, pas un fantôme ;
 *  2. aucune décision ouverte ne la porte — sinon elle doublerait une demande
 *     bien vivante ;
 *  3. le délai de grâce est passé, le temps que la liste des décisions arrive.
 *
 * Les annonces qui ne demandent rien (une tâche terminée, une publication) ne
 * sont jamais concernées : elles se lisent, elles n'attendent personne.
 *
 * ET LE RISQUE SYMÉTRIQUE : EFFACER CE QUI COMPTAIT ENCORE. Les porteurs connus
 * ne sont que ce que CET écran a chargé — les cartes des projets ouverts, les
 * conversations au travail. Une annonce qui parle d'une carte d'un projet
 * jamais consulté avait donc un porteur « absent » sans l'être le moins du
 * monde, et disparaissait au bout d'une minute. On ne conclut désormais à
 * l'absence que sur un projet dont les cartes sont RÉELLEMENT arrivées ;
 * ailleurs, on ne présume rien.
 */
export function annonceSansPorteur(
  annonce: AnnonceRecue,
  demandes: DecisionAttendue[],
  maintenant: number,
  porteurs?: {
    cartes: ReadonlySet<string>;
    agents: ReadonlySet<string>;
    /** Les projets dont les cartes sont arrivées. Absent : on juge comme avant. */
    projetsCharges?: ReadonlySet<string>;
  },
  graceMs = GRACE_ANNONCE_MS,
): boolean {
  if (!porteurs) return false;
  if (genreDeLAnnonce(annonce.motif) !== 'attente') return false;
  // Une annonce qui ne nomme ni carte ni conversation ne peut pas être
  // rapprochée d'un porteur : on ne la juge pas.
  if (!annonce.cardId && !annonce.agentId) return false;
  if (maintenant - annonce.a < graceMs) return false;
  // Le projet de l'annonce n'a pas encore livré ses cartes : son porteur
  // manquerait pour cette seule raison. On ne juge pas.
  if (annonce.projectId && porteurs.projetsCharges && !porteurs.projetsCharges.has(annonce.projectId)) {
    return false;
  }

  const porteurVivant =
    (annonce.cardId ? porteurs.cartes.has(annonce.cardId) : false) ||
    (annonce.agentId ? porteurs.agents.has(annonce.agentId) : false);
  if (porteurVivant) return false;

  return !demandes.some(
    (demande) =>
      (annonce.cardId && demande.cardId === annonce.cardId) ||
      (annonce.agentId && demande.agentId === annonce.agentId),
  );
}

/** Le dessin d'une demande dans la cloche, traduit de sa nature. */
export function iconeDeLaDemande(demande: DecisionAttendue): IconeNotification {
  if (demande.genre === 'incident') return 'erreur';
  const icone = iconeDeLAttention(demande);
  if (icone === 'message') return 'question';
  if (icone === 'plan') return 'plan';
  return 'attention';
}

/** Le titre d'une ligne née d'une demande : le projet, puis l'endroit. */
export function titreDeLaDemande(demande: DecisionAttendue, projetParDefaut: string): string {
  const projet = demande.projectName?.trim() || projetParDefaut;
  return demande.lieuTitre?.trim() ? `${projet} · ${demande.lieuTitre.trim()}` : projet;
}

/**
 * LA LISTE, prête à afficher : les demandes ouvertes d'abord, de la plus
 * ancienne à la plus récente (celle qui bloque depuis le plus longtemps en
 * tête), puis les annonces, de la plus récente à la plus ancienne.
 */
export function journalDesNotifications(
  demandes: DecisionAttendue[],
  annonces: AnnonceRecue[],
  textes: { projetParDefaut: string; sansTexte: string } = {
    projetParDefaut: 'Projet',
    sansTexte: 'Une décision est attendue.',
  },
  maintenant = Date.now(),
  porteurs?: {
    cartes: ReadonlySet<string>;
    agents: ReadonlySet<string>;
    projetsCharges?: ReadonlySet<string>;
  },
): LigneNotification[] {
  const ouvertes = decisionsOuvertes(demandes);

  const lignesDemandes: LigneNotification[] = ouvertes.map((demande, index) => ({
    cle: `demande:${demande.projectId}:${demande.cardId ?? ''}:${demande.agentId ?? ''}:${index}`,
    source: 'demande',
    /*
     * UN INCIDENT NE SE LIT PAS COMME UNE QUESTION. Un tour coupé par la limite
     * d'un compte, une erreur qui a arrêté le travail : la cloche les garde —
     * c'est là qu'on les règle depuis que le triangle ne les porte plus — mais
     * sous leur propre signe, celui d'un incident, jamais sous le triangle
     * d'une décision qu'on vous demanderait.
     */
    genre: demande.genre === 'incident' ? 'erreur' : 'attente',
    /*
     * ET LE DESSIN SUIT LA NATURE. La même table que la carte du tableau et la
     * ligne du projet (`nature-attention.ts`) : un message pour une question,
     * un chemin pour un plan à générer ou une carte à lancer, le triangle pour
     * ce qui bloque. Les trois écrans ne peuvent donc pas diverger.
     */
    icone: iconeDeLaDemande(demande),
    titre: titreDeLaDemande(demande, textes.projetParDefaut),
    texte: demande.texte?.trim() || textes.sansTexte,
    a: demande.poseeA ?? 0,
    nonLue: true,
    lieu: {
      projectId: demande.projectId,
      cardId: demande.cardId,
      agentId: demande.agentId,
      messageId: demande.messageId,
    },
    demande,
  }));

  const lignesAnnonces: LigneNotification[] = annonces
    .filter((annonce) => !annonceDoublonne(annonce, ouvertes))
    // Ce qui réclamait une réponse et n'a plus de porteur quitte la liste : une
    // alerte qu'on ne peut plus régler est une alerte à vie.
    .filter((annonce) => !annonceSansPorteur(annonce, ouvertes, maintenant, porteurs))
    .slice()
    .sort((a, b) => b.a - a.a)
    .slice(0, PLAFOND_ANNONCES)
    .map((annonce) => ({
      cle: `annonce:${annonce.id}`,
      source: 'annonce',
      genre: genreDeLAnnonce(annonce.motif),
      icone: iconeDeLAnnonce(annonce.motif),
      titre: titreSansEmoji(annonce.titre),
      texte: annonce.corps,
      a: annonce.a,
      nonLue: !annonce.lue,
      lieu: { projectId: annonce.projectId, cardId: annonce.cardId, agentId: annonce.agentId },
    }));

  return [...lignesDemandes, ...lignesAnnonces];
}

/**
 * Ce que porte la pastille de la cloche : les demandes ouvertes PLUS les
 * annonces jamais lues. C'est le compte de ce qui réclame encore quelque chose.
 */
export function compteNonLues(
  demandes: DecisionAttendue[],
  annonces: AnnonceRecue[],
  maintenant = Date.now(),
  porteurs?: {
    cartes: ReadonlySet<string>;
    agents: ReadonlySet<string>;
    projetsCharges?: ReadonlySet<string>;
  },
): number {
  return journalDesNotifications(demandes, annonces, undefined, maintenant, porteurs).filter(
    (ligne) => ligne.nonLue,
  ).length;
}

/**
 * Les annonces gardées après réception d'une nouvelle : la plus récente en
 * tête, et jamais plus que le plafond. Une annonce n'écrase JAMAIS une demande
 * ouverte — ce sont deux listes séparées, réunies seulement à l'affichage.
 */
export function ajouterAnnonce(annonces: AnnonceRecue[], nouvelle: AnnonceRecue): AnnonceRecue[] {
  return [nouvelle, ...annonces].slice(0, PLAFOND_ANNONCES);
}

/** Toutes les annonces marquées lues : ce que fait l'ouverture du tiroir. */
export function marquerLues(annonces: AnnonceRecue[]): AnnonceRecue[] {
  return annonces.map((annonce) => (annonce.lue ? annonce : { ...annonce, lue: true }));
}
