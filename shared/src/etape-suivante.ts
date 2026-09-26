/*
 * POUSSER UNE CARTE À L'ÉTAPE SUIVANTE, SANS OUVRIR SON DÉTAIL.
 *
 * Le tableau savait déjà déplacer une carte : à la glisse, ou par le menu
 * « Déplacer vers » qui liste TOUTES les colonnes. Or dans la vie d'une tâche,
 * un seul déplacement revient sans cesse — celui d'UN CRAN EN AVANT, le long du
 * chemin « Planifié → En cours → À déployer → Archivé ». C'est ce geste-là qui
 * est nommé ici, une fois, pour les trois endroits qui l'offrent : le tiroir
 * d'une carte, le menu d'une ligne, et l'action de masse sur une sélection.
 *
 * Règle PURE : ni base, ni disque, ni écran. Elle se teste seule
 * (`server/src/test/etape-suivante.test.ts`).
 */

import { COLUMN_LABELS, COLUMN_KEYS, type ColumnKey } from './columns.js';
import { gesteDuDepot } from './suivi-colonne.js';

/** Ce qu'il faut savoir d'une carte pour juger son avancement d'un cran. */
export interface CartePourAvancer {
  /** La colonne AFFICHÉE de la carte, pas forcément celle enregistrée. */
  colonne: ColumnKey;
  /** Un agent de tâche travaille-t-il encore dessus ? */
  agentActif?: boolean;
}

/** Le verdict rendu pour une carte : peut-on l'avancer, et à quel prix ? */
export interface AvanceDEtape {
  /** L'étape d'arrivée. `null` quand il n'y a plus rien après. */
  cible: ColumnKey | null;
  /** Le geste est-il proposé ? */
  possible: boolean;
  /** Ce que dit le bouton : « Passer à « À déployer » ». */
  libelle: string;
  /** POURQUOI c'est refusé, en toutes lettres. Absent quand c'est permis. */
  raison?: string;
  /**
   * Faut-il demander confirmation avant d'agir ? VRAI pour les deux gestes qui
   * ne se rattrapent pas d'un clic : le LANCEMENT (qui dépense) et l'ARCHIVAGE
   * (une fin de parcours, dont on ne ressort qu'à la main).
   */
  confirmation: boolean;
  /** La question posée par cette confirmation, quand il y en a une. */
  question?: string;
}

/**
 * L'étape juste APRÈS celle-ci, le long du chemin du tableau. `null` sur la
 * dernière : le chemin s'arrête, on n'invente pas de cinquième colonne.
 */
export function etapeSuivante(colonne: ColumnKey): ColumnKey | null {
  const rang = COLUMN_KEYS.indexOf(colonne);
  if (rang < 0) return null;
  return COLUMN_KEYS[rang + 1] ?? null;
}

/** La phrase du bouton, toujours la même forme : « Passer à « X » ». */
export function libelleEtapeSuivante(cible: ColumnKey | null): string {
  if (!cible) return 'Dernière étape atteinte';
  if (cible === 'running') return 'Lancer maintenant';
  return `Passer à « ${COLUMN_LABELS[cible]} »`;
}

/**
 * PEUT-ON AVANCER CETTE CARTE D'UN CRAN, ET COMMENT LE DIRE ?
 *
 * Quatre refus, jamais un bouton mort sans explication :
 *
 *  - la carte est DÉJÀ au bout du chemin (« Archivé ») ;
 *  - un AGENT TRAVAILLE dessus : le tableau la ramènerait aussitôt en
 *    « En cours » (`colonneAffichee`), le clic n'aurait donc aucun effet
 *    visible — mieux vaut le dire que laisser croire à une panne ;
 *  - sa colonne n'existe plus (navigateur resté ouvert pendant une mise à
 *    jour) ;
 *  - le geste est REFUSÉ par la règle du dépôt (`gesteDuDepot`) : c'est le cas
 *    de « Travail → À déployer », qu'aucune main ne décrète.
 */
export function avanceDEtape(carte: CartePourAvancer): AvanceDEtape {
  const connue = COLUMN_KEYS.includes(carte.colonne);
  const cible = connue ? etapeSuivante(carte.colonne) : null;
  const libelle = libelleEtapeSuivante(cible);

  if (!connue) {
    return { cible: null, possible: false, libelle, confirmation: false, raison: 'Étape inconnue : rechargez la page.' };
  }
  if (!cible) {
    return {
      cible: null,
      possible: false,
      libelle,
      confirmation: false,
      raison: `« ${COLUMN_LABELS[carte.colonne]} » est la dernière étape du chemin.`,
    };
  }
  if (carte.agentActif) {
    return {
      cible,
      possible: false,
      libelle,
      confirmation: false,
      raison: 'Un agent travaille sur cette carte : arrêtez-le avant de la faire avancer.',
    };
  }

  /*
   * UN GESTE OFFERT DOIT ÊTRE UN GESTE QUI ABOUTIT. Le cran d'avance lit la
   * MÊME règle que le dépôt à la souris (`gesteDuDepot`) : ce que le serveur
   * refuserait n'est pas proposé ici, il s'éteint avec sa raison. C'est le cas
   * de « Travail → À déployer » : un rapport se rend, il ne se décrète pas.
   */
  const geste = gesteDuDepot(carte.colonne, cible);
  if (geste.effet === 'refuser') {
    return { cible, possible: false, libelle, confirmation: false, raison: geste.raison };
  }

  const confirmation = cible === 'running' || cible === 'archived';
  return {
    cible,
    possible: true,
    libelle,
    confirmation,
    question: confirmation ? questionDAvance(cible, 1) : undefined,
  };
}

/**
 * LA QUESTION POSÉE AVANT UN GESTE QUI NE SE RATTRAPE PAS D'UN CLIC.
 *
 * Elle dit ce qui va se passer, pas « êtes-vous sûr ? » : lancer, c'est
 * dépenser ; archiver, c'est refermer un parcours dont on ne ressort qu'à la
 * main. Le nombre sert à la même phrase pour une carte ou pour un lot.
 */
export function questionDAvance(cible: ColumnKey, nombre: number): string {
  const quoi = nombre > 1 ? `${nombre} tâches` : 'cette tâche';
  if (cible === 'running') return `Lancer ${quoi} maintenant ? Un agent démarre et le travail est facturé.`;
  if (cible === 'archived') {
    return `Archiver ${quoi} ? « Archivé » est une fin de parcours : on n'en ressort qu'à la main.`;
  }
  return `Faire passer ${quoi} à « ${COLUMN_LABELS[cible]} » ?`;
}

/** Une carte d'un lot, avec ce qu'il faut pour la juger. */
export interface CarteQuiAvance extends CartePourAvancer {
  id: string;
}

/** Ce qu'un lot de cartes cochées peut réellement faire avancer. */
export interface LotDAvance<C extends CarteQuiAvance> {
  /** Les cartes qui bougeront vraiment, avec leur cible. */
  avances: { carte: C; cible: ColumnKey }[];
  /** Celles qui ne bougeront pas, avec leur raison. */
  bloquees: { carte: C; raison: string }[];
  /** Faut-il confirmer ? Oui dès qu'UNE seule des avances le demande. */
  confirmation: boolean;
  /** La question du lot, quand il y en a une. */
  question?: string;
}

/**
 * LE LOT : chaque carte va à SA propre étape suivante, jamais à une colonne
 * commune. Cocher une carte « Planifié » et une carte « À déployer », c'est
 * lancer la première et archiver la seconde — un cran chacune.
 *
 * Ce qui ne peut pas bouger n'est pas passé sous silence : l'écran a de quoi
 * dire combien de cartes restent en place, et pourquoi.
 */
export function lotDAvance<C extends CarteQuiAvance>(cartes: C[]): LotDAvance<C> {
  const avances: LotDAvance<C>['avances'] = [];
  const bloquees: LotDAvance<C>['bloquees'] = [];
  let confirmation = false;

  for (const carte of cartes) {
    const verdict = avanceDEtape(carte);
    if (verdict.possible && verdict.cible) {
      avances.push({ carte, cible: verdict.cible });
      if (verdict.confirmation) confirmation = true;
    } else {
      bloquees.push({ carte, raison: verdict.raison ?? 'Cette carte ne peut pas avancer.' });
    }
  }

  if (!confirmation || !avances.length) return { avances, bloquees, confirmation: false };

  /* Une seule question pour tout le lot : elle nomme le geste le plus lourd
     (lancer, puis archiver) et le NOMBRE de cartes réellement concernées. */
  const lancees = avances.filter((a) => a.cible === 'running').length;
  const archivees = avances.filter((a) => a.cible === 'archived').length;
  return { avances, bloquees, confirmation: true, question: questionDuLot(lancees, archivees) };
}

/**
 * LA QUESTION D'UN LOT MIXTE. Un lot peut lancer des cartes ET en archiver
 * d'autres du même clic : la question compte donc les deux gestes, au lieu de
 * n'en nommer qu'un et de laisser l'autre se produire en silence.
 */
export function questionDuLot(lancees: number, archivees: number): string {
  const gestes: string[] = [];
  if (lancees) gestes.push(`lancer ${lancees} tâche${lancees > 1 ? 's' : ''}`);
  if (archivees) gestes.push(`archiver ${archivees} tâche${archivees > 1 ? 's' : ''}`);
  const liste = gestes.join(' et ');
  /* La mise en garde ne nomme que les gestes RÉELLEMENT présents : parler de
     dépense sur un lot qui ne fait qu'archiver serait un contresens. */
  const gardes: string[] = [];
  if (lancees) gardes.push("lancer, c'est dépenser");
  if (archivees) gardes.push("archiver referme un parcours dont on ne ressort qu'à la main");
  const garde = gardes.join(' ; ');
  return `Ce geste va ${liste}. Pour mémoire : ${garde}. Continuer ?`;
}
