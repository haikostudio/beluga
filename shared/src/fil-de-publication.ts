/*
 * LA PUBLICATION SE LIT ET SE DISCUTE COMME UN AGENT.
 *
 * Une mise en ligne était un TABLEAU DE BORD : sept lignes d'étapes, leurs
 * fils horodatés, une barre d'avancement — juste, complet, et complètement
 * étranger au reste de l'application. Surtout, on n'y accédait que par la
 * notification du moment : l'alerte passée, plus rien ne ramenait à la
 * publication en cours.
 *
 * Elle a désormais un CONDUCTEUR : un agent unique, créé au départ, auquel la
 * publication reste attachée (`DeployRun.agentId`), et dont la conversation
 * devient le fil officiel de cette mise en ligne. Tout ce que les étapes
 * racontent déjà s'y dépose au fil de l'eau, et la barre d'écriture permet de
 * lui parler — pendant, et après.
 *
 * Ce fichier tient les règles PURES de ce fil : les quatre temps du parcours,
 * les textes de la demande et de la compréhension, la phrase de chaque étape,
 * et les réponses toutes faites d'un échec. Ni base, ni disque, ni horloge
 * imposée.
 *
 * TROIS PRINCIPES.
 *
 *  1. LE FIL NE REMPLACE PAS LA TRACE TECHNIQUE : `steps[].journal` continue
 *     d'être écrit exactement comme avant (`journal-publication.ts`). Le fil
 *     en est le RÉCIT, il n'en est pas la source.
 *  2. UNE PUBLICATION SANS CONDUCTEUR RESTE LISIBLE : toute mise en ligne
 *     d'avant cette règle n'a pas d'`agentId`, et l'écran retombe alors sur
 *     son déroulé d'étapes. On ne réécrit pas le passé.
 *  3. LIRE ET ÉCRIRE NE PUBLIENT JAMAIS : le fil est une conversation. Seul le
 *     bouton met en ligne — la règle « aucun bouton ne permet de rejouer un
 *     historique » vaut aussi pour la barre d'écriture.
 */

import type { CiblePublication } from './etapes-publication.js';
const CARTES_NOMMEES_MAX = 12;

/* ------------------------------------------------------------------ */
/* Les quatre temps du parcours                                        */
/* ------------------------------------------------------------------ */

/**
 * LE PARCOURS D'UNE PUBLICATION COMPTE QUATRE TEMPS, PAS SIX.
 *
 * Le repère d'une carte en compte six, dont un PLAN à valider. Publier ne se
 * négocie pas étape par étape : le plan est volontairement absent, et le
 * parcours passe directement de ce qui est compris au travail. La
 * configuration de l'agent n'y figure pas non plus — le conducteur n'est pas
 * une tâche qu'on règle, c'est une mise en ligne qu'on suit.
 */
export type PointDuFilPublication = 'demande' | 'comprehension' | 'travail' | 'rapport';

export const ORDRE_FLUX_PUBLICATION: readonly PointDuFilPublication[] = [
  'demande',
  'comprehension',
  'travail',
  'rapport',
] as const;

export const LIBELLE_POINT_PUBLICATION: Record<PointDuFilPublication, string> = {
  demande: 'Demande',
  comprehension: 'Compréhension',
  travail: 'Travail',
  rapport: 'Rapport',
};

/** Où en est un temps du parcours. Les mêmes états que partout ailleurs. */
export type EtatDuPointDePublication = 'avenir' | 'encours' | 'fait' | 'erreur';

export interface PointDuParcoursPublication {
  cle: PointDuFilPublication;
  libelle: string;
  etat: EtatDuPointDePublication;
}

/**
 * CE QUE LE REPÈRE MONTRE, à partir du seul état de la publication.
 *
 * La demande et la compréhension sont écrites AU DÉPART : dès qu'une
 * publication existe, ces deux temps sont faits. Le travail dure tant que la
 * publication tourne, et il TOMBE avec elle. Le rapport n'arrive qu'à la fin —
 * réussite comme échec : une mise en ligne tombée rend elle aussi son compte
 * rendu, c'est même ce qu'on vient lire.
 *
 * `null` quand il n'y a aucune publication : on n'invente pas un parcours à
 * quatre points vides sous un volet au repos.
 */
export function parcoursDeLaPublication(run?: {
  state: 'running' | 'success' | 'failed' | 'stopped';
} | null): PointDuParcoursPublication[] | null {
  if (!run) return null;
  const fini = run.state !== 'running';
  const tombee = run.state === 'failed' || run.state === 'stopped';
  const etats: Record<PointDuFilPublication, EtatDuPointDePublication> = {
    demande: 'fait',
    comprehension: 'fait',
    travail: fini ? (tombee ? 'erreur' : 'fait') : 'encours',
    rapport: fini ? (tombee ? 'erreur' : 'fait') : 'avenir',
  };
  return ORDRE_FLUX_PUBLICATION.map((cle) => ({
    cle,
    libelle: LIBELLE_POINT_PUBLICATION[cle],
    etat: etats[cle],
  }));
}

/* ------------------------------------------------------------------ */
/* Ce qui a été demandé, et ce qui en a été compris                    */
/* ------------------------------------------------------------------ */

export interface DemandeDePublication {
  /** L'étape : déploiement sur l'instance de dev, ou mise en production. */
  cible: CiblePublication;
  /** Le libellé de l'étape, tel que l'application le nomme partout. */
  libelleEtape: string;
  projet: string;
  /** Les titres des cartes embarquées, dans l'ordre du lot. */
  cartes: readonly string[];
  /** L'adresse contrôlée à la fin, quand le projet en déclare une. */
  url?: string;
  /** Le dépôt visé, quand la publication ne porte que l'un d'eux. */
  depot?: string;
}

/**
 * CE QUI PART EN LIGNE, EN TÊTE DU FIL.
 *
 * C'est la « demande » du parcours : elle n'a pas été tapée par l'utilisateur,
 * elle a été faite d'un clic — mais elle existe, et elle doit se lire avant le
 * détail. Le lot est NOMMÉ carte par carte tant qu'il tient, puis compté : un
 * lot de quarante branches ne doit pas noyer le fil.
 */
export function texteDeLaDemande(demande: DemandeDePublication): string {
  const lignes: string[] = [`**${demande.libelleEtape}** — projet « ${demande.projet} »`];
  if (demande.depot) lignes.push(`Dépôt visé : \`${demande.depot}\` (lui seul).`);
  if (demande.cartes.length) {
    const nommees = demande.cartes.slice(0, CARTES_NOMMEES_MAX);
    const reste = demande.cartes.length - nommees.length;
    lignes.push('', `${demande.cartes.length} tâche${demande.cartes.length > 1 ? 's' : ''} embarquée${demande.cartes.length > 1 ? 's' : ''} :`);
    for (const titre of nommees) lignes.push(`- ${titre}`);
    if (reste > 0) lignes.push(`- … et ${reste} autre${reste > 1 ? 's' : ''}`);
  } else {
    lignes.push('', 'Aucune tâche embarquée : c’est une **version** qui part, pas un lot.');
  }
  if (demande.url) lignes.push('', `Adresse contrôlée à la fin : ${demande.url}`);
  return lignes.join('\n');
}

export interface ComprehensionDePublication {
  cible: CiblePublication;
  /** Les étapes réellement prévues, dans l'ordre, sous leur nom lisible. */
  etapes: readonly string[];
  /** Comment la mise en ligne se fera, tel que le plan constaté le dit. */
  moyen?: string;
  /** La branche sur laquelle le lot est fusionné. */
  branche?: string;
}

/**
 * CE QUE LE CONDUCTEUR A COMPRIS AVANT DE COMMENCER.
 *
 * Deuxième temps du parcours, et le seul qui manquait vraiment : le déroulé
 * disait ce qui se passait, jamais ce qui allait se passer. On annonce donc les
 * étapes prévues, la branche visée et le moyen de mise en ligne — puis on redit
 * la seule limite qui compte : rien ne repart d'ici.
 */
export function texteDeLaComprehension(vue: ComprehensionDePublication): string {
  const lignes: string[] = [];
  lignes.push(
    vue.cible === 'production'
      ? 'Je mets la version déjà déployée **en production**, chez le client.'
      : 'Je fusionne le lot, je l’enregistre, je l’envoie sur le dépôt, puis je rafraîchis **l’instance de dev** sur ce serveur.',
  );
  if (vue.branche) lignes.push('', `Branche visée : \`${vue.branche}\`.`);
  if (vue.moyen) lignes.push('', vue.moyen);
  if (vue.etapes.length) {
    lignes.push('', 'Étapes prévues :');
    vue.etapes.forEach((etape, i) => lignes.push(`${i + 1}. ${etape}`));
  }
  lignes.push('', MENTION_LECTURE_SEULE);
  return lignes.join('\n');
}

/**
 * LA SEULE LIMITE DU FIL, DITE DANS LE FIL.
 *
 * Ouvrir un échange dans un écran qui commande une mise en ligne crée un risque
 * qu'il faut fermer explicitement : écrire à l'agent ne vaut jamais l'ordre de
 * publier. La phrase est ici, partagée par le serveur (qui l'emporte dans la
 * consigne du conducteur) et par le fil (qui l'affiche).
 */
export const MENTION_LECTURE_SEULE =
  'Vous pouvez m’écrire à tout moment : je réponds, j’explique, je rejoue une étape si vous me le demandez. Je ne relance jamais une mise en ligne de moi-même — seul le bouton publie.';

/* ------------------------------------------------------------------ */
/* Ce qu'on peut répondre                                             */
/* ------------------------------------------------------------------ */

/**
 * CE QU'ON PEUT RÉPONDRE QUAND UNE ÉTAPE TOMBE.
 *
 * Une barre d'écriture vide sous un échec laisse chercher ses mots. Deux
 * réponses toutes faites suffisent : refaire, ou comprendre. Elles ne font
 * qu'ÉCRIRE dans le champ — elles n'envoient rien et ne publient rien.
 */
export function reponsesToutesFaites(libelleEtape?: string): string[] {
  const etape = libelleEtape?.trim();
  return [
    etape ? `Reprends l’étape « ${etape} ».` : 'Reprends l’étape qui a échoué.',
    'Explique-moi ce qui a bloqué, en clair.',
  ];
}

/**
 * CETTE PUBLICATION EST-ELLE FINIE ?
 *
 * Une mise en ligne terminée met son conducteur en posture d'EXPLICATION : on
 * relit, on questionne, on ne rejoue pas. C'est la même règle des deux côtés —
 * l'écran s'en sert pour le libellé du champ, le serveur pour la consigne qu'il
 * emporte dans le tour.
 */
export function publicationTerminee(run?: { state: string } | null): boolean {
  return !!run && run.state !== 'running';
}

/**
 * LA CONSIGNE QUE LE CONDUCTEUR EMPORTE DANS SON TOUR.
 *
 * C'est le VERROU CÔTÉ SERVEUR de la règle « aucun bouton ne permet de rejouer
 * un historique » : ouvrir un échange dans un écran qui commande une mise en
 * ligne crée un risque nouveau, et il ne suffit pas de le fermer à l'écran. La
 * consigne part avec chaque demande écrite au conducteur, qu'elle vienne de la
 * barre d'écriture du volet ou d'ailleurs.
 *
 * Deux postures, une seule interdiction commune :
 *  - publication EN COURS : il explique, il peut rejouer l'étape qui a
 *    échoué SI on le lui demande, il ne relance jamais la mise en ligne
 *    entière ;
 *  - publication TERMINÉE : il est en posture d'EXPLICATION, point. On relit
 *    et on questionne un historique, on ne le rejoue pas.
 */
export function consigneDuConducteur(terminee: boolean): string {
  const commun =
    'TU ES LE CONDUCTEUR DE CETTE MISE EN LIGNE. Ta conversation est le fil officiel de cette publication : ' +
    'ce que tu y écris se lit dans le volet de déploiement ou de mise en production.\n' +
    'INTERDICTION ABSOLUE : tu ne déclenches JAMAIS de mise en ligne, de déploiement, de mise en production ni de ' +
    'redémarrage du serveur — ni par une commande, ni par un script, ni par un appel d’outil. Seul un clic de ' +
    'l’utilisateur publie. Écrire dans ce fil ne vaut jamais l’ordre de publier.';
  return terminee
    ? `${commun}\nCETTE PUBLICATION EST TERMINÉE : tu es en posture d’EXPLICATION. Tu relis ce qui s’est passé, tu réponds aux questions, tu ne rejoues rien.`
    : `${commun}\nLA PUBLICATION TOURNE ENCORE : tu peux expliquer où elle en est et reprendre UNE étape précise si on te le demande explicitement — jamais la mise en ligne entière.`;
}

/**
 * PENDANT UNE MISE EN LIGNE, LE VOLET NE RACONTE RIEN.
 *
 * Une publication qui tourne n'a pas à être commentée pendant qu'elle tourne :
 * ce qu'on veut voir, ce sont des POINTS — le nom de l'étape, son état, sa
 * durée — et rien d'autre. Les longues explications, le fil horodaté des
 * moments et les mentions de rôle sont de la LECTURE, pas du suivi : ils
 * encombrent l'écran à l'instant précis où l'on ne cherche qu'une chose,
 * savoir où ça en est.
 *
 * Rien n'est jeté : dès que la publication est terminée, tout se relit, et le
 * conducteur répond aux questions dans son fil. C'est le sens exact de
 * « les explications restent disponibles après coup, sur demande ».
 */
export function leVoletSeRaconte(run?: { state: string } | null): boolean {
  return publicationTerminee(run);
}

/** Le libellé du champ d'écriture, selon que la publication tourne ou non. */
export function libelleDuChampDuFil(run?: { state: string } | null): string {
  return publicationTerminee(run)
    ? 'Poser une question sur cette mise en ligne…'
    : 'Écrire à l’agent qui publie…';
}
