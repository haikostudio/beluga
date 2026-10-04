/*
 * UNE CARTE PRÊTE À PUBLIER QUI REÇOIT UN MESSAGE ROUVRE SA DISCUSSION ET PASSE
 * EN « DEMANDE » — PUIS REVIENT DANS « À DÉPLOYER » SI L'ÉCHANGE N'ÉTAIT
 * QU'UNE QUESTION.
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
 *     n'a jamais existé — et la carte passe AUSSITÔT en « Demande »
 *     (`rouvrirLeCadrage`, `server/src/cadrage.ts`) : c'est là qu'un agent
 *     réfléchit à une demande, et l'écran le montre à l'instant du clic ;
 *   - la réouverture est DATÉE sur la carte (`parcours.cadrageRouvertA`) : c'est
 *     CE repère, et plus la colonne, qui dit « carte relancée » — la carte
 *     garde l'agent de tâche dans `agentId`, ses anciens plans et son code
 *     enregistré, et chacun doit le savoir où qu'elle soit posée ;
 *   - à la FIN DU TOUR de cadrage, l'agent a tranché (« un tour de cadrage a
 *     DEUX fins : répondre, ou cadrer ») : s'il n'a fait que RÉPONDRE — ni
 *     compréhension, ni plan, ni plan demandé, ni question ouverte —, la carte
 *     retourne dans « À déployer » et le repère tombe
 *     (`colonneApresReponseSansCadrage`) : une simple question ne vide pas le
 *     lot à publier. S'il a CADRÉ, elle reste en « Demande » et suit le
 *     parcours d'une carte neuve, jusqu'au lancement — sur sa branche, le
 *     repère tombe alors. Elle ne part JAMAIS seule : ses essais passés ne
 *     valent pas un geste de lancement ;
 *   - tant que la carte est relancée, son tiroir ne montre JAMAIS le bouton de
 *     fin de tâche (« Actions de la tâche ») ni « Déployer le lot », où qu'elle
 *     soit posée (`barreEnFinDeTache`, `lotDeployableDepuisLaCarte`).
 *
 * Historique : la version du 16.09.2026 déplaçait la carte dès le message mais
 * ne la ramenait jamais — une simple question vidait le lot. Celle qui suivit
 * attendait le rendu de la compréhension, soit une bonne minute pendant
 * laquelle la carte avait l'air oubliée en « À déployer » (capture #f374,
 * 23.09.2026) et gardait son bouton de fin de tâche sous un agent qui
 * réfléchissait (capture #35079, 04.10.2026). Le déplacement immédiat, décidé
 * le 23.09.2026 (DEC-245), n'avait jamais rejoint la branche servie : il est
 * reporté ici le 04.10.2026.
 *
 * Ni base, ni disque, ni écran : `server/src/test/relance-apres-rapport.test.ts`.
 */

import { COLONNES_AVANT_LE_TRAVAIL, type ColumnKey } from './columns.js';
import { etatDuDepart } from './depart-programme.js';

/** Les colonnes où un message de l'utilisateur est une DEMANDE de cadrage. */
export const COLONNES_RELANCEES_PAR_LE_CADRAGE: readonly ColumnKey[] = ['to_deploy'];

/**
 * Les colonnes où une carte RELANCÉE se tient : celles d'avant le travail, où
 * le message la pose, et « À déployer », où se trouve encore une carte
 * relancée avant le déplacement immédiat.
 */
export const COLONNES_D_UNE_RELANCE: readonly ColumnKey[] = [...COLONNES_AVANT_LE_TRAVAIL, 'to_deploy'];

/** Où la relance pose la carte, dès le message reçu. */
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
 * sur l'ancien plan. Deux gestes seulement la laissent repartir :
 *
 *  - un lancement demandé puis refusé par une porte qui se rouvre
 *    (`reprendreDesQuePossible`) ;
 *  - une HEURE DITE arrivée, sur une compréhension VALIDÉE DEPUIS la
 *    réouverture (`departDeRelanceAccorde`). Le tiroir de programmation valide
 *    puis date : sans cette sortie, la relance datée attendait pour toujours un
 *    clic que sa propre mention (« elle partira toute seule ») disait inutile.
 */
export function relanceRetenueAvantLancement(
  carte: CarteRelancable & {
    parcours?: { cadrageRouvertA?: number; comprehensionValidee?: { at: number } | null } | null;
    scheduling?: { reprendreDesQuePossible?: boolean; departPrevu?: number } | null;
  },
  maintenant: number = Date.now(),
): boolean {
  if (!cadrageRouvertApresRapport(carte)) return false;
  if (carte.scheduling?.reprendreDesQuePossible) return false;
  return !departDeRelanceAccorde(carte, maintenant);
}

/**
 * LE DÉPART DATÉ D'UNE RELANCE A-T-IL ÉTÉ ACCORDÉ ? Deux preuves, ensemble :
 * la date est venue — le départ la CONSOMME, celle que porte une relance a
 * donc été posée depuis le travail livré —, et la compréhension a été validée
 * APRÈS la réouverture. La validation d'origine reste écrite sur la carte :
 * elle a servi au travail déjà rendu et n'accorde rien à la relance.
 *
 * « Dès que possible » n'ouvre PAS cette sortie : la marque `asap` survit au
 * départ, et celle d'une carte relancée peut dater de son premier lancement.
 */
export function departDeRelanceAccorde(
  carte: {
    parcours?: { cadrageRouvertA?: number; comprehensionValidee?: { at: number } | null } | null;
    scheduling?: { departPrevu?: number } | null;
  },
  maintenant: number = Date.now(),
): boolean {
  const rouvertA = carte.parcours?.cadrageRouvertA;
  const valideeA = carte.parcours?.comprehensionValidee?.at;
  if (!rouvertA || !valideeA || valideeA < rouvertA) return false;
  return etatDuDepart(carte.scheduling ?? undefined, maintenant) === 'venu';
}

/**
 * FILET : UNE COMPRÉHENSION RENDUE SUR UNE CARTE RELANCÉE ENCORE EN « À
 * DÉPLOYER » la renvoie en « Demande ». Le message la déplace déjà
 * (`rouvrirLeCadrage`) ; ce filet ne sert qu'à une carte que ce déplacement
 * aurait manquée — relancée avant lui, par exemple.
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
 * LE TOUR DE CADRAGE N'A FAIT QUE RÉPONDRE : LA CARTE RETOURNE AU LOT.
 *
 * Une carte relancée attend en « Demande » que son cadrage tranche. À la fin
 * d'un tour RÉUSSI (l'appelant écarte panne, arrêt, quota et question ouverte),
 * elle revient dans « À déployer » si rien n'a été cadré depuis la
 * réouverture : ni compréhension, ni plan rendu, ni plan demandé, ni incident
 * de cadrage. Rend `null` sinon — carte déplacée à la main entre-temps, jamais
 * relancée, ou nouveau travail en préparation.
 */
export function colonneApresReponseSansCadrage(carte: {
  column: ColumnKey | string;
  parcours?: (ParcoursDeRelance & { planDemandeA?: number; incident?: { at: number } | null }) | null;
}): ColumnKey | null {
  const parcours = carte.parcours;
  const depuis = parcours?.cadrageRouvertA;
  if (carte.column !== COLONNE_DE_LA_RELANCE || !depuis) return null;
  if (comprehensionDepuisLaRelance(parcours) || planRenduDepuisLaRelance(parcours)) return null;
  if (parcours?.planDemandeA && parcours.planDemandeA >= depuis) return null;
  /* Un INCIDENT posé depuis (compréhension réclamée en vain) : le cadrage n'a
     ni cadré ni dit « réponse seule ». La carte reste là où l'incident se lit. */
  if (parcours?.incident && parcours.incident.at >= depuis) return null;
  return 'to_deploy';
}

/**
 * LE TIROIR MONTRE-T-IL LE BOUTON DE FIN DE TÂCHE (« Actions de la tâche ») ?
 *
 * Un rapport rendu, une carte « À déployer » ou « Archivé » n'ont qu'un bouton,
 * qui ouvre le tiroir des actions de fin. UNE CARTE RELANCÉE N'EST PLUS EN FIN
 * DE TÂCHE, où qu'elle soit posée : son cadrage réfléchit à une nouvelle
 * demande, et la rangée montre le geste du cadrage (« Valider et lancer »,
 * éteint tant que la compréhension n'est pas rendue), comme sur une carte
 * neuve. La colonne seule le décidait : une carte relancée encore en
 * « À déployer » gardait « Actions de la tâche » pendant toute la réflexion
 * (capture #35079, 04.10.2026).
 */
export function barreEnFinDeTache(etat: {
  carte: CarteRelancable;
  /** Le chapitre du geste principal de la rangée (`gestesDuParcours`). */
  chapitre?: string;
}): boolean {
  if (cadrageRouvertApresRapport(etat.carte)) return false;
  return etat.chapitre === 'rapport' || etat.carte.column === 'to_deploy' || etat.carte.column === 'archived';
}

/**
 * LE LOT SE DÉPLOIE-T-IL DEPUIS CETTE CARTE ? Une carte « À déployer » porte le
 * bouton qui ouvre la fenêtre de déploiement du lot — sauf relancée : elle
 * n'en fait plus partie tant que sa nouvelle demande se discute
 * (`deploiement-automatique.ts` la retient de la même façon).
 */
export function lotDeployableDepuisLaCarte(carte: CarteRelancable): boolean {
  return carte.column === 'to_deploy' && !cadrageRouvertApresRapport(carte);
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
