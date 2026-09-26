/**
 * L'ACCUEIL DE LA MESSAGERIE : L'ACTIVITÉ JOUR PAR JOUR, CLIENT PAR CLIENT.
 *
 * Ouvrir la Messagerie tombait d'office dans la conversation du premier client :
 * pour savoir qui attendait quelque chose, il fallait ouvrir chaque client l'un
 * après l'autre. Une vue d'ensemble se pose devant — un graphique en colonnes
 * JOURNALIÈRES partagées entre les clients, la répartition des demandes par
 * colonne du kanban, puis une fiche par client.
 *
 * LE PAS EST LE JOUR, PLUS LA SEMAINE. Huit semaines figées ne disaient ni la
 * régularité ni le creux : on lit désormais une colonne par jour sur la période
 * DEMANDÉE, bornée à `PROFONDEUR_MAX_JOURS` pour qu'une profondeur absurde ne
 * fasse pas ramer le serveur.
 *
 * TOUT SE CALCULE AU SERVEUR, EN UN SEUL APPEL : dix clients ne font pas dix
 * allers-retours, et l'écran s'affiche d'un coup.
 *
 * LES RÈGLES SONT ICI, PURES : découper des horodatages en journées et
 * additionner des fiches ne demande ni base ni disque, et se teste seul.
 */

import { COLONNES_DEMANDE, type ColonneDemande } from './espace-client.js';
import { debutDuJour, jourLocal } from './fuseau.js';

/** Un jour en millisecondes — le pas nominal du graphique. */
export const UN_JOUR_MS = 24 * 3600 * 1000;

/** La profondeur la plus lointaine qu'on accepte de calculer : un an et un jour. */
export const PROFONDEUR_MAX_JOURS = 366;

/** La période affichée à la première ouverture, tant que rien n'a été choisi. */
export const PERIODE_PAR_DEFAUT_JOURS = 30;

/** Les échelles toutes prêtes du sélecteur de période, en JOURS. */
export const ECHELLES_DU_TABLEAU = [7, 30, 90, 365] as const;

/**
 * MINUIT DU JOUR OÙ TOMBE UN INSTANT, DANS LE FUSEAU DU PRODUIT.
 *
 * Le serveur tourne en UTC et la personne qui lit le graphique est à Zurich :
 * découper avec `new Date(...).getHours()` ferait basculer au lendemain tout ce
 * qui est envoyé après 22 h l'été. On passe donc par le fuseau de référence,
 * comme tout ce qui nomme une heure dans le produit.
 */
export function minuitDe(quand: number): number {
  return debutDuJour(jourLocal(quand));
}

/** La dernière milliseconde de la journée où tombe un instant. */
export function finDeJournee(quand: number): number {
  return jourSuivant(quand) - 1;
}

/**
 * LA JOURNÉE SUIVANTE — en passant par le calendrier, jamais par « + 24 h ».
 * Les changements d'heure font des journées de 23 ou 25 heures : on saute une
 * journée entière, puis on retombe sur minuit.
 */
function jourSuivant(quand: number): number {
  return minuitDe(minuitDe(quand) + 36 * 3600 * 1000);
}

/**
 * COMBIEN DE JOURS ENTRE DEUX INSTANTS, bornes incluses. `Math.round` et non
 * `Math.floor` : les changements d'heure font des journées de 23 ou 25 heures,
 * qu'une division sèche décalerait d'un rang.
 */
export function nombreDeJours(debut: number, fin: number): number {
  const a = minuitDe(debut);
  const b = minuitDe(fin);
  if (b < a) return 0;
  return Math.round((b - a) / UN_JOUR_MS) + 1;
}

/**
 * LES BORNES D'UNE PÉRIODE DEMANDÉE, remises d'aplomb.
 *
 * Les deux bouts sont ramenés au début et à la fin de leur jour local, remis
 * dans l'ordre s'ils sont inversés, et la profondeur est ramenée sous le
 * plafond en RECULANT la date de début : on rend toujours une période valable
 * plutôt que de refuser l'écran.
 */
export function bornesDeLaPeriode(
  debut: number | undefined,
  fin: number | undefined,
  maintenant: number,
): { debut: number; fin: number; jours: number } {
  const finVoulue = Number.isFinite(fin) ? (fin as number) : maintenant;
  const debutVoulu = Number.isFinite(debut)
    ? (debut as number)
    : finVoulue - (PERIODE_PAR_DEFAUT_JOURS - 1) * UN_JOUR_MS;
  const bas = Math.min(debutVoulu, finVoulue);
  const haut = Math.max(debutVoulu, finVoulue);
  let depart = minuitDe(bas);
  const arrivee = finDeJournee(haut);
  if (nombreDeJours(depart, arrivee) > PROFONDEUR_MAX_JOURS) {
    depart = minuitDe(arrivee - (PROFONDEUR_MAX_JOURS - 1) * UN_JOUR_MS);
  }
  return { debut: depart, fin: arrivee, jours: nombreDeJours(depart, arrivee) };
}

/** Les bornes d'une échelle toute prête : « les N derniers jours », aujourd'hui compris. */
export function bornesDeLEchelle(jours: number, maintenant: number): { debut: number; fin: number; jours: number } {
  const pas = Math.min(Math.max(Math.round(jours) || 1, 1), PROFONDEUR_MAX_JOURS);
  return bornesDeLaPeriode(maintenant - (pas - 1) * UN_JOUR_MS, maintenant, maintenant);
}

/** Le début de chaque journée de la période, du plus ancien au plus récent. */
export function joursDeLaPeriode(debut: number, fin: number): number[] {
  const jours: number[] = [];
  let curseur = minuitDe(debut);
  const borne = minuitDe(fin);
  while (curseur <= borne && jours.length < PROFONDEUR_MAX_JOURS) {
    jours.push(curseur);
    curseur = jourSuivant(curseur);
  }
  return jours;
}

/**
 * LES ÉCHANGES RANGÉS PAR JOURNÉE, du plus ancien au plus récent.
 *
 * Une case par jour de la période, bornes INCLUSES : un jour sans le moindre
 * échange garde sa case à zéro, sans quoi on ne lirait plus la régularité de
 * l'activité. Un horodatage hors de la période est ignoré — jamais tassé dans
 * la première ou la dernière case, ce qui inventerait une pointe.
 */
export function joursDInteractions(horodatages: readonly number[], debut: number, fin: number): number[] {
  const depart = minuitDe(debut);
  const arrivee = finDeJournee(fin);
  const cases = new Array<number>(Math.max(1, nombreDeJours(depart, arrivee))).fill(0);
  for (const quand of horodatages) {
    if (!Number.isFinite(quand) || quand < depart || quand > arrivee) continue;
    const rang = Math.round((minuitDe(quand) - depart) / UN_JOUR_MS);
    if (rang < 0 || rang >= cases.length) continue;
    cases[rang] = (cases[rang] ?? 0) + 1;
  }
  return cases;
}

/** La répartition, colonne par colonne, dans l'ordre du kanban de la messagerie. */
export type RepartitionParColonne = Record<ColonneDemande, number>;

/** Une répartition vide — toutes les colonnes présentes, toutes à zéro. */
export function repartitionVide(): RepartitionParColonne {
  return Object.fromEntries(COLONNES_DEMANDE.map((colonne) => [colonne, 0])) as RepartitionParColonne;
}

/**
 * COMBIEN DE DEMANDES DANS CHAQUE COLONNE DU TABLEAU.
 *
 * Les demandes RANGÉES ne comptent pas : elles ne sont plus sur le tableau, les
 * additionner ferait dire au chiffre autre chose que ce que l'écran montre.
 * Toutes les colonnes sont présentes, même à zéro : une colonne qui disparaît
 * des chiffres se lit comme une colonne qui n'existe pas.
 */
export function repartitionParColonne(
  demandes: readonly { colonne: ColonneDemande; archiveeLe?: number }[],
): RepartitionParColonne {
  const par = repartitionVide();
  for (const demande of demandes) {
    if (demande.archiveeLe) continue;
    if (par[demande.colonne] === undefined) continue;
    par[demande.colonne] += 1;
  }
  return par;
}

export interface FicheClientTableau {
  clientId: string;
  nomAffiche: string;
  actif: boolean;
  /** Les projets du client, pour nommer sous le client à qui appartient quoi. */
  projets: { id: string; nom: string }[];
  /** Les deux mêmes chiffres que la pastille de la colonne de gauche. */
  compteurs: { nonLu: number; aTraiter: number };
  /** Les demandes encore ouvertes chez ce client (ni terminées ni rangées). */
  demandesOuvertes: number;
  /** Ses demandes, colonne par colonne du tableau de la messagerie. */
  parColonne: RepartitionParColonne;
  /** Les tâches Beluga nées de ses demandes et pas encore rangées. */
  tachesOuvertes: number;
  /** Les échanges de la période : demandes déposées, commentaires, messages du fil. */
  messages: number;
  /** Le dernier échange, quel qu'il soit ; absent s'il n'y en a jamais eu. */
  derniereActivite?: number;
  /** Une case par JOUR de la période, de la PLUS ANCIENNE à la plus récente. */
  interactions: number[];
}

/** Un client « attend quelque chose » dès qu'il a du non-lu ou une demande à traiter. */
export function clientEnAttente(fiche: Pick<FicheClientTableau, 'compteurs'>): boolean {
  return fiche.compteurs.nonLu > 0 || fiche.compteurs.aTraiter > 0;
}

export interface TotauxDuTableau {
  clients: number;
  clientsEnAttente: number;
  nonLu: number;
  aTraiter: number;
  tachesOuvertes: number;
  messages: number;
  parColonne: RepartitionParColonne;
}

/** Les quelques chiffres qui résument la situation en un regard. */
export function totauxDuTableau(fiches: readonly FicheClientTableau[]): TotauxDuTableau {
  const parColonne = repartitionVide();
  for (const fiche of fiches) {
    for (const colonne of COLONNES_DEMANDE) parColonne[colonne] += fiche.parColonne?.[colonne] ?? 0;
  }
  return {
    clients: fiches.length,
    clientsEnAttente: fiches.filter(clientEnAttente).length,
    nonLu: fiches.reduce((total, fiche) => total + fiche.compteurs.nonLu, 0),
    aTraiter: fiches.reduce((total, fiche) => total + fiche.compteurs.aTraiter, 0),
    tachesOuvertes: fiches.reduce((total, fiche) => total + fiche.tachesOuvertes, 0),
    messages: fiches.reduce((total, fiche) => total + (fiche.messages ?? 0), 0),
    parColonne,
  };
}

/**
 * L'ORDRE DES FICHES : LE PLUS ACTIF EN TÊTE.
 *
 * Les clients qui attendaient quelque chose remontaient d'office, et un client
 * muet depuis six mois mais porteur d'un non-lu passait devant celui à qui l'on
 * parle tous les jours. C'est l'ACTIVITÉ RÉCENTE qui décide maintenant ; ce qui
 * attend reste signalé par les pastilles de la fiche, jamais par son rang. À
 * activité égale, le nom départage — sans quoi l'ordre danserait d'un appel à
 * l'autre.
 */
export function fichesRangees(fiches: readonly FicheClientTableau[]): FicheClientTableau[] {
  return [...fiches].sort((a, b) => {
    const ecart = (b.derniereActivite ?? 0) - (a.derniereActivite ?? 0);
    if (ecart) return ecart;
    return a.nomAffiche.localeCompare(b.nomAffiche);
  });
}
