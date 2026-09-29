/*
 * UNE CARTE PRÊTE À PUBLIER QUI REÇOIT UN MESSAGE ROUVRE SA DISCUSSION — ET
 * ELLE NE BOUGE QUE SI L'ÉCHANGE DEMANDE UN NOUVEAU TRAVAIL.
 *
 * Le parcours est le même pour une première demande et pour une suivante :
 * DEMANDE → COMPRÉHENSION → (clic « Valider et lancer ») TRAVAIL → À DÉPLOYER.
 * Un message écrit sous un rapport rendu partait pourtant chez l'agent de
 * TÂCHE, le dernier créé sur la carte (`agentDeCadrage` ne rend que le dernier
 * agent) : la carte repassait en « Travail » et un tour payant répondait à ce
 * qui n'était qu'une nouvelle demande (capture #8bbb, 13.09.2026).
 *
 * Désormais :
 *   - le message va à l'agent de CADRAGE de la carte, rouvert — ou créé s'il
 *     n'a jamais existé — et la carte NE BOUGE PAS. Elle reste dans
 *     « À déployer », où son travail rendu l'a posée : une QUESTION se répond
 *     dans le fil, sans sortir la carte du lot à publier ;
 *   - la réouverture est DATÉE sur la carte (`parcours.cadrageRouvertA`) : c'est
 *     CE repère, et plus la colonne, qui dit « carte relancée » — la carte
 *     garde l'agent de tâche dans `agentId`, ses anciens plans et son code
 *     enregistré, et chacun doit le savoir où qu'elle soit posée ;
 *   - elle ne repart en « Demande » QUE si le cadrage rend une nouvelle
 *     COMPRÉHENSION (`colonneApresComprehensionDeRelance`) : c'est le seul
 *     signe qu'un nouveau travail se prépare, et c'est l'agent de cadrage qui
 *     tranche, exactement comme sur une carte neuve (« un tour de cadrage a
 *     DEUX fins : répondre, ou cadrer »). De là elle suit le parcours d'une
 *     carte neuve, jusqu'au lancement — sur sa branche, le repère tombe alors.
 *     Elle ne part JAMAIS seule : ses essais passés ne valent pas un geste de
 *     lancement.
 *
 * La version du 16.09.2026, qui déplaçait la carte dès le message reçu, est
 * remplacée : une simple question vidait le lot à publier.
 *
 * Ni base, ni disque, ni écran : `server/src/test/relance-apres-rapport.test.ts`.
 */

import { COLONNES_AVANT_LE_TRAVAIL, type ColumnKey } from './columns.js';

/** Les colonnes où un message de l'utilisateur est une DEMANDE de cadrage. */
export const COLONNES_RELANCEES_PAR_LE_CADRAGE: readonly ColumnKey[] = ['to_deploy'];

/**
 * Les colonnes où une carte RELANCÉE se tient : celles d'avant le travail, où
 * une nouvelle demande cadrée la pose, et « À déployer », où elle reste tant
 * que l'échange n'est qu'une discussion.
 */
export const COLONNES_D_UNE_RELANCE: readonly ColumnKey[] = [...COLONNES_AVANT_LE_TRAVAIL, 'to_deploy'];

/** Où la relance pose la carte une fois la nouvelle compréhension rendue. */
export const COLONNE_DE_LA_RELANCE: ColumnKey = 'planned';

interface CarteRelancable {
  column: ColumnKey | string;
  parcours?: { cadrageRouvertA?: number } | null;
}

interface ParcoursDeRelance {
  cadrageRouvertA?: number;
  plans?: readonly { at: number }[];
  comprehension?: { texte?: string; at: number } | null;
}

/** Un message écrit sur une carte de cette colonne part-il au cadrage ? */
export function messageVaAuCadrage(colonne: ColumnKey | string): boolean {
  return COLONNES_RELANCEES_PAR_LE_CADRAGE.includes(colonne as ColumnKey);
}

/**
 * LA CARTE EST-ELLE RELANCÉE ? Un message sous son rapport a rouvert son
 * cadrage, et elle ne s'est pas encore remise au travail. La colonne seule ne
 * le dit plus : en « Demande » comme en « À déployer », seule la date de
 * réouverture distingue une relance d'une carte neuve — ou d'une carte
 * simplement prête à publier.
 */
export function cadrageRouvertApresRapport(carte: CarteRelancable): boolean {
  return COLONNES_D_UNE_RELANCE.includes(carte.column as ColumnKey) && !!carte.parcours?.cadrageRouvertA;
}

/**
 * UN MESSAGE SUR CETTE CARTE VA-T-IL À SON AGENT DE CADRAGE ? Sous un rapport
 * (le geste qui relance), et sur toute carte déjà relancée — dont `agentId`
 * désigne encore l'agent de tâche du travail livré.
 */
export function messageDeLaCarteVaAuCadrage(carte: CarteRelancable): boolean {
  return messageVaAuCadrage(carte.column) || cadrageRouvertApresRapport(carte);
}

/**
 * UN MESSAGE SUR UNE CARTE DÉJÀ EN LIGNE OUVRE UNE NOUVELLE CARTE. Une carte
 * rangée dans « Archivé » avec sa date de mise en ligne ne se modifie pas sur
 * place : le travail est publié, le réécrire après coup contournerait la revue
 * et la publication. Le message devient donc la demande d'une carte neuve, qui
 * suit tout le parcours (Demande, Compréhension, Travail). Une carte archivée
 * jamais publiée n'est pas concernée ; elle ne s'ouvre que sur geste humain.
 */
export function messageOuvreUneNouvelleCarte(carte: { column: ColumnKey | string; deployedAt?: number | null }): boolean {
  return carte.column === 'archived' && !!carte.deployedAt;
}

/**
 * UNE CARTE RELANCÉE NE PART PAS TOUTE SEULE. Elle a déjà été lancée
 * (`attempts` > 0), ce que l'ordonnanceur lit comme « travail autorisé à
 * reprendre » : sans ce refus, elle repartait dès son arrivée en « Demande »,
 * sur l'ancien plan. Seul un lancement demandé puis refusé par une porte qui se
 * rouvre (`reprendreDesQuePossible`) la laisse repartir.
 */
export function relanceRetenueAvantLancement(carte: CarteRelancable & {
  scheduling?: { reprendreDesQuePossible?: boolean } | null;
}): boolean {
  return cadrageRouvertApresRapport(carte) && !carte.scheduling?.reprendreDesQuePossible;
}

/**
 * UNE NOUVELLE COMPRÉHENSION VAUT « NOUVEAU TRAVAIL » : OÙ LA CARTE RETOMBE.
 *
 * C'est le SEUL chemin qui ressort une carte de « À déployer » sans geste de
 * glissement, et il tient à un jugement d'agent : le cadrage a écouté le
 * message, et il a choisi de CADRER plutôt que de simplement RÉPONDRE. Une
 * question qui n'appelle aucun travail ne rend pas de compréhension, donc ne
 * déplace rien — la carte reste dans le lot à publier.
 *
 * Rend `null` quand il n'y a rien à déplacer : carte déjà en cadrage, carte
 * jamais relancée, ou colonne qui n'est pas une fin de parcours.
 */
export function colonneApresComprehensionDeRelance(carte: CarteRelancable): ColumnKey | null {
  if (!COLONNES_RELANCEES_PAR_LE_CADRAGE.includes(carte.column as ColumnKey)) return null;
  if (!carte.parcours?.cadrageRouvertA) return null;
  return COLONNE_DE_LA_RELANCE;
}

/**
 * LA CARTE SE CADRE-T-ELLE ENCORE ? Avant le travail (« Demande »), ou dans
 * « À déployer » avec un cadrage rouvert. C'est la porte de « Générer le
 * plan », côté démon.
 */
export function carteEnCadrage(carte: CarteRelancable): boolean {
  return COLONNES_AVANT_LE_TRAVAIL.includes(carte.column as ColumnKey) || cadrageRouvertApresRapport(carte);
}

/** Un plan a-t-il été rendu DEPUIS la réouverture du cadrage ? */
export function planRenduDepuisLaRelance(parcours?: ParcoursDeRelance | null): boolean {
  const depuis = parcours?.cadrageRouvertA;
  if (!depuis) return false;
  return (parcours?.plans ?? []).some((plan) => plan.at >= depuis);
}

/** Une compréhension a-t-elle été rendue DEPUIS la réouverture du cadrage ? */
export function comprehensionDepuisLaRelance(parcours?: ParcoursDeRelance | null): boolean {
  const depuis = parcours?.cadrageRouvertA;
  const rendue = parcours?.comprehension;
  if (!depuis || !rendue?.texte?.trim()) return false;
  return rendue.at >= depuis;
}

/**
 * CE PLAN APPARTIENT-IL À LA RELANCE ? Un plan rendu après la réouverture, sur
 * une carte relancée qui n'est pas encore repartie au travail : le travail déjà livré ne ferme pas sa
 * décision (`travailDeLaCarteDejaLance`), puisqu'il décide du travail SUIVANT.
 */
export function planDeLaRelance(etat: {
  colonne?: string;
  cadrageRouvertA?: number;
  planRenduA?: number;
}): boolean {
  if (!etat.colonne || !COLONNES_D_UNE_RELANCE.includes(etat.colonne as ColumnKey)) return false;
  if (!etat.cadrageRouvertA || etat.planRenduA === undefined) return false;
  return etat.planRenduA >= etat.cadrageRouvertA;
}

/**
 * LA DISCUSSION QUI PART AVEC LE LANCEMENT D'UNE RELANCE : ce qui s'est dit
 * depuis la réouverture, pas le cadrage d'origine — lui a déjà servi au travail
 * livré. Un message sans date est gardé.
 */
export function messagesDepuisLaRelance<T extends { createdAt?: number }>(messages: readonly T[], depuis?: number): T[] {
  if (!depuis) return [...messages];
  return messages.filter((message) => message.createdAt === undefined || message.createdAt >= depuis);
}
