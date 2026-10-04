/**
 * CE QUI PRÉVIENT DANS L'ESPACE CLIENT : LES COMPTEURS DE HAIKO, L'AVANCEMENT
 * D'UNE CARTE LIÉE, ET LA CLOCHE DE CHAQUE CLIENT.
 *
 * Trois règles vivent ici, pures — aucune base, aucun disque :
 *
 *  1. LES DEUX COMPTEURS DE LA MESSAGERIE. Haiko voit d'un coup d'œil, sur la
 *     ligne « Messagerie » de sa colonne de gauche, ce qu'il n'a pas LU (les
 *     demandes jamais ouvertes, les commentaires et les messages des clients)
 *     et ce qu'il a À TRAITER (les demandes vivantes encore dans « À faire »,
 *     sans carte). Deux chiffres séparés : une demande ouverte mais pas prise
 *     en charge reste à traiter, un message lu n'est plus rien.
 *
 *  2. L'ÉTAPE D'UNE CARTE LIÉE. Le client ne voit jamais le détail du travail
 *     d'un agent : il apprend l'ÉTAPE — démarrée, terminée, en ligne — et rien
 *     d'autre. La règle se lit sur deux photos de la carte, avant et après
 *     son enregistrement.
 *
 *  3. LA CLOCHE DU CLIENT EST GARDÉE PAR LE SERVEUR, PAS PAR LE NAVIGATEUR : un
 *     client passe du téléphone à l'ordinateur. Une RAFALE (cinq cases cochées
 *     d'affilée) ne fait qu'une ligne : la plus récente, non lue, du même
 *     événement sur la même demande, est MISE À JOUR au lieu d'être doublée.
 */

import { z } from 'zod';
import { FRAGMENT_DE_DISCUSSION, construireFragmentDeDemande } from './adresse-navigateur.js';
import type { ColumnKey } from './columns.js';
import { colonneClose, type ColonneDemande } from './espace-client.js';

/* ------------------------------------------------------------------ */
/* 1. Les deux compteurs de la Messagerie                               */
/* ------------------------------------------------------------------ */

export interface CompteursMessagerie {
  /** Demandes jamais ouvertes + commentaires non lus + messages non lus. */
  nonLu: number;
  /** Demandes vivantes, dans « À faire », sans carte — lues ou non. */
  aTraiter: number;
}

/** Ce qu'il faut savoir d'une demande pour la compter. */
export interface DemandePourCompteur {
  auteurId: string;
  colonne: string;
  carteId?: string | null;
  archiveeLe?: number | null;
  /** Ce compte a-t-il déjà ouvert la fiche au moins une fois ? */
  ouverte: boolean;
}

export function demandeATraiter(demande: Omit<DemandePourCompteur, 'ouverte' | 'auteurId'>): boolean {
  return !demande.archiveeLe && demande.colonne === 'a-faire' && !demande.carteId;
}

/**
 * UNE DEMANDE « JAMAIS OUVERTE » POUR CE COMPTE — la part du non-lu qui ne
 * s'allumait nulle part dans la fiche du client. La vignette la montre avec la
 * MÊME règle que le compteur : les deux ne peuvent plus se contredire.
 */
export function demandeJamaisOuverte(
  compteId: string,
  demande: Pick<DemandePourCompteur, 'auteurId' | 'colonne' | 'archiveeLe' | 'ouverte'>,
): boolean {
  return (
    !demande.archiveeLe &&
    !demande.ouverte &&
    demande.auteurId !== compteId &&
    !colonneClose(demande.colonne as ColonneDemande)
  );
}

/**
 * LES DEUX CHIFFRES D'UN COMPTE. Une demande qu'il a écrite lui-même n'est
 * jamais « jamais ouverte » pour lui ; une demande rangée ne compte nulle part,
 * et une demande déjà TERMINÉE ou VALIDÉE non plus : ce n'est plus une
 * nouvelle, et les demandes d'avant cette règle n'allument pas la pastille.
 */
export function compteursDeLaMessagerie(
  compteId: string,
  demandes: readonly DemandePourCompteur[],
  commentairesNonLus: number,
  messagesNonLus: number,
): CompteursMessagerie {
  const jamaisOuvertes = demandes.filter((d) => demandeJamaisOuverte(compteId, d)).length;
  return {
    nonLu: jamaisOuvertes + Math.max(0, commentairesNonLus) + Math.max(0, messagesNonLus),
    aTraiter: demandes.filter(demandeATraiter).length,
  };
}

/** Le chiffre d'une pastille : jamais plus de trois signes. */
export function chiffreDePastille(n: number): string {
  return n > 99 ? '99+' : String(Math.max(0, Math.floor(n)));
}

/* ------------------------------------------------------------------ */
/* 2. L'étape d'une carte liée                                          */
/* ------------------------------------------------------------------ */

export const ETAPES_CARTE_LIEE = ['demarree', 'terminee', 'en-ligne'] as const;
export type EtapeCarteLiee = (typeof ETAPES_CARTE_LIEE)[number];

/** Les colonnes où le travail d'une carte est FINI, qu'il reste ou non à le mettre en ligne. */
const COLONNES_TERMINEES: readonly string[] = ['to_deploy'];

export interface PhotoDeCarte {
  column: ColumnKey | string;
  deployedAt?: number | null;
}

/**
 * L'ÉTAPE FRANCHIE ENTRE DEUX ENREGISTREMENTS, ou `null`. La mise en ligne
 * l'emporte : une carte qui reçoit sa date de mise en ligne en changeant de
 * colonne ne dit qu'une chose au client — c'est en ligne. Réordonner une
 * colonne, réécrire un titre, ranger une carte déjà en ligne : rien. Une carte
 * relancée qui retourne dans « À déployer » parce que son cadrage n'a fait que
 * répondre (`retourSansTravail`) non plus : rien n'y a été terminé.
 */
export function etapeDeLaCarteLiee(
  avant: PhotoDeCarte | null | undefined,
  apres: PhotoDeCarte,
  details?: { retourSansTravail?: boolean },
): EtapeCarteLiee | null {
  if (details?.retourSansTravail) return null;
  if (apres.deployedAt && !avant?.deployedAt) return 'en-ligne';
  if (avant && avant.column === apres.column) return null;
  if (apres.column === 'running') return 'demarree';
  if (COLONNES_TERMINEES.includes(apres.column) && !COLONNES_TERMINEES.includes(avant?.column ?? '')) {
    return 'terminee';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 3. La cloche du client                                               */
/* ------------------------------------------------------------------ */

/** Ce qui s'est passé : l'écran en rédige la phrase, dans la langue du lecteur. */
export const EVENEMENTS_ESPACE = [
  'nouvelle-demande',
  'deplacement',
  'commentaire',
  'message',
  'modification',
  'prise-en-charge',
  'archivage',
  'demarree',
  'terminee',
  'en-ligne',
] as const;
export const EvenementEspace = z.enum(EVENEMENTS_ESPACE);
export type EvenementEspace = z.infer<typeof EvenementEspace>;

/** Où mène un clic : la fiche d'une demande, la discussion, ou le projet. */
export const CibleNotification = z.enum(['demande', 'discussion', 'projet']);
export type CibleNotification = z.infer<typeof CibleNotification>;

export const NotificationEspace = z.object({
  id: z.string(),
  /** Le compte destinataire, et lui seul. */
  pour: z.string(),
  projectId: z.string().optional(),
  demandeId: z.string().optional(),
  cible: CibleNotification,
  /** Le motif d'alerte (`MotifNotification`) : il choisit l'icône. */
  motif: z.string(),
  evenement: EvenementEspace,
  /** Qui a fait le geste, tel que signé : « Haiko » ou le nom du client. */
  auteur: z.string().default(''),
  /** Le titre de la demande, quand l'événement en vise une. */
  demandeTitre: z.string().default(''),
  /** Un complément court : la colonne d'arrivée, l'extrait d'un message… */
  detail: z.string().default(''),
  /** Combien de gestes cette ligne résume : une rafale ne fait qu'une ligne. */
  fois: z.number().default(1),
  creeLe: z.number(),
  luLe: z.number().optional(),
});
export type NotificationEspace = z.infer<typeof NotificationEspace>;

/** Une rafale : même destinataire, même événement, même demande, en dix minutes. */
export const FENETRE_RAFALE_MS = 10 * 60 * 1000;

/** Au-delà, une notification LUE est effacée : la cloche ne grossit pas sans fin. */
export const DUREE_NOTIFICATION_LUE_MS = 90 * 24 * 3600 * 1000;

/** Les événements qui se répètent en rafale. Un message ou un commentaire, lui, se dit chacun. */
const EVENEMENTS_EN_RAFALE: readonly EvenementEspace[] = ['modification', 'deplacement'];

/**
 * CETTE NOUVELLE LIGNE PROLONGE-T-ELLE LA DERNIÈRE ? Vrai quand les deux parlent
 * du même geste répété, sur la même demande, pour le même compte, et que la
 * précédente n'a pas encore été lue : la cloche la met à jour au lieu d'en
 * ajouter une.
 */
export function prolongeLaRafale(
  precedente: Pick<NotificationEspace, 'pour' | 'evenement' | 'demandeId' | 'creeLe' | 'luLe'> | null | undefined,
  nouvelle: Pick<NotificationEspace, 'pour' | 'evenement' | 'demandeId'>,
  maintenant: number,
): boolean {
  if (!precedente || precedente.luLe) return false;
  if (!EVENEMENTS_EN_RAFALE.includes(nouvelle.evenement)) return false;
  return (
    precedente.pour === nouvelle.pour &&
    precedente.evenement === nouvelle.evenement &&
    (precedente.demandeId ?? '') === (nouvelle.demandeId ?? '') &&
    maintenant - precedente.creeLe <= FENETRE_RAFALE_MS
  );
}

/**
 * L'ADRESSE OÙ MÈNE UNE NOTIFICATION, lue par le service worker quand aucun
 * onglet n'est ouvert. Le client lit `#projet/<id>/demande/<id>`
 * (`lireFragmentDeDemande`) ; la discussion s'ouvre sur `#discussion`.
 */
export function adresseDeNotification(
  notification: Pick<NotificationEspace, 'cible' | 'projectId' | 'demandeId'>,
): string {
  if (notification.cible === 'discussion') return `/#${FRAGMENT_DE_DISCUSSION}`;
  if (notification.cible === 'demande' && notification.projectId && notification.demandeId) {
    /* LE FORMAT NE SE RECOPIE PAS : il vient des règles d'adresse, comme
       partout ailleurs — c'est la seule façon qu'un lien déjà parti reste
       lisible quand les adresses s'enrichissent. */
    return `/#${construireFragmentDeDemande(notification.projectId, notification.demandeId)}`;
  }
  return '/';
}

/** L'adresse désigne-t-elle la discussion ? */
export function adresseDeDiscussion(hash: string): boolean {
  return (hash || '').replace(/^#\/?/, '').trim() === FRAGMENT_DE_DISCUSSION;
}

/* ------------------------------------------------------------------ */
/* 4. La cloche d'UN client, vue par Haiko                              */
/* ------------------------------------------------------------------ */

/** Une demande du client, telle que la cloche de Haiko la lit. */
export interface DemandePourCloche {
  id: string;
  projectId: string;
  titre: string;
  auteurId: string;
  auteurNom: string;
  colonne: string;
  archiveeLe?: number | null;
  /** Ce compte l'a-t-il déjà ouverte au moins une fois ? */
  ouverte: boolean;
  creeeLe: number;
}

/** Les commentaires non lus d'UNE demande, résumés par le dernier arrivé. */
export interface CommentairesNonLusPourCloche {
  demandeId: string;
  projectId: string;
  titre: string;
  nombre: number;
  auteur: string;
  texte: string;
  dernierLe: number;
}

export interface EntreesDeLaClocheDuClient {
  /** L'administrateur qui regarde : c'est SON non-lu qui compte. */
  compteId: string;
  demandes: readonly DemandePourCloche[];
  commentaires: readonly CommentairesNonLusPourCloche[];
  /** Les messages du client que Haiko n'a pas lus dans la discussion. */
  fil: { nombre: number; auteur: string; texte: string; dernierLe: number } | null;
  /** Les étapes franchies par les cartes liées : de l'information, déjà « lue ». */
  etapes: readonly { id: string; demandeId: string; projectId: string; titre: string; etape: string; creeLe: number }[];
}

const EXTRAIT_CLOCHE = 140;
const extraitCourt = (texte: string) =>
  texte.length > EXTRAIT_CLOCHE ? `${texte.slice(0, EXTRAIT_CLOCHE).trimEnd()}…` : texte;

/**
 * LA CLOCHE D'UN CLIENT, ASSEMBLÉE POUR HAIKO. Haiko n'a pas de lignes gardées
 * en base (ses alertes vivent dans la cloche du bandeau) : ce qui concerne UN
 * client se RECONSTRUIT à partir de ce qui compte déjà dans la Messagerie — les
 * demandes jamais ouvertes, les commentaires non lus, les messages non lus —
 * plus les étapes des cartes liées, pour l'historique.
 *
 * LE CHIFFRE DE LA CLOCHE EST CELUI DE LA LIGNE DU CLIENT : `nonLues` suit la
 * même addition que `compteursDeLaMessagerie`. Une ligne non lue s'éteint par le
 * geste qui l'éteint déjà ailleurs — ouvrir la fiche, ouvrir la discussion.
 */
export function clocheDuClientVueParHaiko(entrees: EntreesDeLaClocheDuClient): {
  notifications: NotificationEspace[];
  nonLues: number;
} {
  const pour = entrees.compteId;
  const lignes: NotificationEspace[] = [];
  let nonLues = 0;

  for (const demande of entrees.demandes) {
    if (!demandeJamaisOuverte(pour, demande)) continue;
    nonLues += 1;
    lignes.push({
      id: `nouvelle:${demande.id}`,
      pour,
      projectId: demande.projectId,
      demandeId: demande.id,
      cible: 'demande',
      motif: 'espace-demande',
      evenement: 'nouvelle-demande',
      auteur: demande.auteurNom,
      demandeTitre: demande.titre,
      detail: '',
      fois: 1,
      creeLe: demande.creeeLe,
    });
  }

  for (const lot of entrees.commentaires) {
    if (lot.nombre <= 0) continue;
    nonLues += lot.nombre;
    lignes.push({
      id: `commentaire:${lot.demandeId}`,
      pour,
      projectId: lot.projectId,
      demandeId: lot.demandeId,
      cible: 'demande',
      motif: 'espace-message',
      evenement: 'commentaire',
      auteur: lot.auteur,
      demandeTitre: lot.titre,
      detail: extraitCourt(lot.texte),
      fois: lot.nombre,
      creeLe: lot.dernierLe,
    });
  }

  if (entrees.fil && entrees.fil.nombre > 0) {
    nonLues += entrees.fil.nombre;
    lignes.push({
      id: 'fil',
      pour,
      cible: 'discussion',
      motif: 'espace-message',
      evenement: 'message',
      auteur: entrees.fil.auteur,
      demandeTitre: '',
      detail: extraitCourt(entrees.fil.texte),
      fois: entrees.fil.nombre,
      creeLe: entrees.fil.dernierLe,
    });
  }

  for (const etape of entrees.etapes) {
    if (!(ETAPES_CARTE_LIEE as readonly string[]).includes(etape.etape)) continue;
    lignes.push({
      id: `etape:${etape.id}`,
      pour,
      projectId: etape.projectId,
      demandeId: etape.demandeId,
      cible: 'demande',
      motif: etape.etape === 'en-ligne' ? 'espace-en-ligne' : 'espace-avancement',
      evenement: etape.etape as EtapeCarteLiee,
      auteur: 'Haiko',
      demandeTitre: etape.titre,
      detail: etape.etape,
      fois: 1,
      creeLe: etape.creeLe,
      luLe: etape.creeLe,
    });
  }

  lignes.sort((a, b) => b.creeLe - a.creeLe);
  return { notifications: lignes, nonLues };
}
