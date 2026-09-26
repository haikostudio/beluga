import { z } from 'zod';

/**
 * Les clés techniques des colonnes. RÈGLE GRAVÉE (PLAN §30) : on change
 * l'étiquette affichée, JAMAIS la clé — sinon les tableaux déjà enregistrés
 * deviennent illisibles.
 */
export const COLUMN_KEYS = [
  // « Notes » a disparu du tableau : une note n'est plus une carte mais un
  // OBJET À ELLE, avec sa table, ses commandes et sa page dédiée
  // (`shared/src/notes.ts`). Les notes qui dormaient dans cette colonne sont
  // reprises à la migration 45 (`server/src/db.ts`).
  // « Validé » puis « À faire » ont disparu : une carte NAÎT dans « Planifié ».
  // Son chiffrage se lance SUR PLACE (drapeau `analyseDemandee`) et la carte n'en
  // bouge pas ; seul le geste de lancement la fait entrer en « En cours ». Deux
  // étapes d'attente en moins sur le tableau, aucune dépense de plus.
  'planned',
  // « Plan » a disparu du tableau : une carte NE BOUGE PLUS pendant qu'un plan
  // s'écrit. Elle reste posée dans « Demande », et le plan rendu se lit sous la
  // compréhension, dans le flux de la carte. L'ÉTAPE « plan » du parcours
  // (`shared/src/parcours-carte.ts`, `parcours-en-points.ts`) et le bloc replié
  // qui porte son numéro de version restent, eux, entièrement en place : la
  // colonne était un doublon d'affichage, pas une information de plus. Les
  // cartes qui y dormaient sont reprises à la migration 80 (`server/src/db.ts`).
  'running',
  // « Rapport » a disparu du tableau : elle doublait « À déployer » d'une
  // étape que personne ne décidait. Un rapport RENDU (sans erreur, sans
  // question restée sans réponse) range désormais la carte DIRECTEMENT dans
  // « À déployer » (`COLONNE_DE_FIN_DE_TOUR`, `shared/src/suivi-colonne.ts`),
  // avec sa pastille bleue de non-lu : le compte rendu se lit en ouvrant la
  // carte, comme avant. L'interrupteur de DÉPLOIEMENT AUTOMATIQUE, passé à
  // droite de l'entête d'« À déployer », ne commande plus qu'une chose : le
  // DÉPART du lot en publication, une fois que plus rien ne travaille sur le
  // projet. Les cartes qui dormaient dans l'ancienne colonne sont reprises à
  // la migration 82 (`server/src/db.ts`).
  'to_deploy',
  // « En production » a disparu : le DÉPLOIEMENT range désormais ses cartes
  // directement en « Archivé ». La mise en production, elle, ne porte plus de
  // lot de cartes — c'est un ÉTAT de version, lu en tête d'« Archivé »
  // (`shared/src/etat-production.ts`).
  'archived',
] as const;

/** Le type d'une clé de colonne, disponible avant le schéma zod ci-dessous. */
type ColumnKeyBrut = (typeof COLUMN_KEYS)[number];

/**
 * LES RANGÉES QUE LE TABLEAU DESSINE — les QUATRE clés, « Archivé » compris.
 *
 * Le tableau ne s'écrit plus en colonnes verticales mais en RANGÉES
 * horizontales : une rangée tient sur la hauteur d'une carte, et quatre
 * rangées tiennent dans un écran. « Archivé » n'a donc plus à se cacher dans
 * un tiroir pour économiser de la largeur — sa rangée est la dernière du
 * tableau, sous « À déployer ».
 *
 * La liste reste SÉPARÉE de `COLUMN_KEYS` : tout ce qui DESSINE part d'ici,
 * et une clé qu'on voudrait retirer de l'écran se retire de cette liste —
 * jamais du modèle, où elle rendrait illisibles les cartes déjà rangées.
 */
export const COLONNES_AFFICHEES: readonly ColumnKeyBrut[] = COLUMN_KEYS;

export const ColumnKey = z.enum(COLUMN_KEYS);
export type ColumnKey = z.infer<typeof ColumnKey>;

/*
 * LES ÉTIQUETTES SUIVENT LES ÉTAPES RÉELLES D'UNE TÂCHE, plus le vocabulaire
 * d'un tableau de rangement : on lit le tableau comme on lit le parcours d'une
 * carte — « Demande », « Travail », « À déployer ». Les CLÉS, elles, ne
 * bougent pas d'un caractère : aucune carte enregistrée ne devient illisible.
 */
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  planned: 'Demande',
  running: 'Travail',
  to_deploy: 'À déployer',
  archived: 'Archivé',
};

/**
 * La seule colonne ouverte aux agents (PLAN §4). « À faire » n'existant plus,
 * c'est « Planifié » — la colonne où NAÎT une carte — qui prend sa place : un
 * agent remet une carte dans la file d'attente, et rien de plus. « Notes »
 * n'est plus une colonne : un agent qui voulait y ranger une carte la remet
 * donc en « Planifié ». Y poser une carte ne la lance pas : le départ reste un
 * geste humain (voir `demarrageAutomatiqueAutorise`, `suivi-colonne.ts`).
 */
export const AGENT_MOVABLE_COLUMNS: ColumnKey[] = ['planned'];

/**
 * LA COLONNE D'AVANT LE TRAVAIL — celle où la carte se DISCUTE.
 *
 * « Demande » est le seul moment du cadrage : rien n'a encore été exécuté,
 * aucune branche n'existe, et le lancement part de là. La liste n'en compte
 * plus qu'une depuis le retrait de « Plan », mais elle RESTE une liste : c'est
 * elle que lit tout le code qui demande « la carte attend-elle son départ ? »
 * (bouton « Lancer », date de départ, reprise, relance après rapport,
 * déplacement de projet), et une colonne de cadrage de plus s'y ajouterait
 * sans toucher à ces appelants.
 */
export const COLONNES_AVANT_LE_TRAVAIL: readonly ColumnKey[] = ['planned'];

/**
 * Colonnes que seul l'utilisateur peut atteindre. « À déployer » n'en fait
 * pas partie : la machine l'atteint en clôturant un travail rendu depuis
 * « En cours ».
 */
export const USER_ONLY_TARGETS: ColumnKey[] = [];

/**
 * Colonnes que la machine peut attribuer sans condition sur son départ.
 * « À déployer » n'en fait PAS partie : la machine n'y range une carte
 * qu'en clôturant un travail rendu depuis « En cours » (voir `canMove`,
 * `suivi-colonne.ts`) — jamais depuis n'importe où.
 */
export const MACHINE_ONLY_TARGETS: ColumnKey[] = ['planned', 'running'];

export type Actor = 'user' | 'agent' | 'machine';

export interface MoveDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Le cœur du modèle : qui a le droit de déplacer quoi (PLAN §4).
 * Appliqué au niveau de l'outil, pas de la consigne.
 */
export function canMove(actor: Actor, from: ColumnKey, to: ColumnKey): MoveDecision {
  if (from === to) return { allowed: true };

  if (actor === 'agent') {
    if (!AGENT_MOVABLE_COLUMNS.includes(to)) {
      return {
        allowed: false,
        reason: `Un agent ne peut déplacer une carte que vers « ${COLUMN_LABELS.planned} ». Cible refusée : « ${COLUMN_LABELS[to]} ».`,
      };
    }
    if (!AGENT_MOVABLE_COLUMNS.includes(from)) {
      return {
        allowed: false,
        reason: `Un agent ne peut pas sortir une carte de « ${COLUMN_LABELS[from]} » : cette colonne appartient au pipeline d'exécution.`,
      };
    }
    return { allowed: true };
  }

  if (actor === 'machine') {
    /*
     * « À déployer » n'est atteignable par la machine QUE depuis « En cours » :
     * c'est la CLÔTURE d'un travail rendu (`COLONNE_DE_FIN_DE_TOUR`), jamais un
     * raccourci depuis une autre colonne. Le déploiement automatique, lui, ne
     * pousse plus aucune carte : il ne commande que le DÉPART du lot
     * (`server/src/deploiement-automatique.ts`).
     */
    if (to === 'to_deploy') {
      if (from !== 'running') {
        return {
          allowed: false,
          reason: `L'ordonnanceur ne pousse vers « ${COLUMN_LABELS.to_deploy} » que depuis « ${COLUMN_LABELS.running} », en clôturant un travail rendu.`,
        };
      }
      return { allowed: true };
    }
    if (!MACHINE_ONLY_TARGETS.includes(to) && to !== 'archived') {
      return {
        allowed: false,
        reason: `L'ordonnanceur ne promeut que vers « ${COLUMN_LABELS.planned} » ou « ${COLUMN_LABELS.running} ».`,
      };
    }
    /*
     * Il n'y a plus de colonne d'attente AVANT « Planifié » : c'est là qu'une
     * carte naît, chiffrée ou non. Ce qui protégeait la dépense n'est donc plus
     * une colonne interdite à l'ordonnanceur, c'est la règle de pause
     * (`demarrageAutomatiqueAutorise`) : sans geste humain — « Lancer
     * maintenant », « Dès que possible », dépôt dans « En cours » —, aucune
     * carte de « Planifié » ne part d'elle-même.
     */
    return { allowed: true };
  }

  // Utilisateur : tout est permis, sauf remonter dans le pipeline sans repasser
  // par la validation (garde-fou doux, il peut toujours revenir en arrière).
  return { allowed: true };
}
