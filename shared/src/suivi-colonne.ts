import { RAISON_TRACE_INCONNUE, traceAcquise, type TraceDuTravail } from './carte-interrompue.js';
import { COLUMN_LABELS, ColumnKey } from './columns.js';
import { etatDuDepart } from './depart-programme.js';
import type { AgentRole } from './models.js';

/**
 * La carte suit les ÉTAPES RÉELLES du travail.
 *
 * Parcours attendu : « Planifié » (où la carte NAÎT ; un clic de validation y
 * lance son chiffrage sur place, sans la déplacer) → (clic de lancement) →
 * « En cours » → (exécution rendue) → « Terminé ».
 *
 * Le piège : l'analyse, l'orchestration et la publication portent elles aussi
 * le numéro de carte. Appliquées à tout agent, les deux règles ci-dessous
 * faisaient sauter la carte en « En cours » dès que l'ANALYSE démarrait, puis
 * en « Terminé » quand cette même analyse rendait son chiffrage — alors que
 * rien n'avait encore été exécuté.
 *
 * D'où la règle unique : seul l'agent d'EXÉCUTION (rôle « task ») déplace une
 * carte. Il la met en « En cours » quand son tour démarre, en « Terminé »
 * quand son tour réussit. Les autres rôles la laissent exactement où elle est.
 * Le passage de « Planifié » à « En cours » (lancement) reste le travail de
 * l'ordonnanceur : ces règles ne le doublent pas.
 *
 * Second piège, le plus coûteux : un tour d'exécution qui RÉPOND sans rien
 * changer posait quand même la carte en « Terminé ». Une analyse écrite, une
 * question traitée, un tour qui n'a fait que lire suffisaient — la carte partait
 * ensuite dans le lot à publier alors qu'aucune ligne n'avait bougé. D'où la
 * règle : c'est le CONSTAT du dépôt qui clôt une carte, pas le fait que le
 * moteur ait rendu sa réponse.
 *
 * Les règles sont PURES : elles ne connaissent ni la base ni le moteur, elles
 * disent seulement où la carte devrait être. Le démon observe le dépôt (le même
 * repère avant / après que le travail hors tâche) et leur passe le constat ; les
 * tests les rejouent.
 */

/**
 * Les colonnes qu'un tour d'agent ne remet PAS en marche.
 *
 * « À déployer », « En production » et « Archivé » sont des fins de parcours
 * choisies : poser une question dans la conversation d'une carte déjà prête à
 * publier — ou déjà en ligne — ne doit pas la sortir du lot sans qu'on l'ait
 * demandé.
 */
export const COLONNES_HORS_REPRISE: ColumnKey[] = ['to_deploy', 'in_production', 'archived'];

/**
 * QUI demande la reprise. La règle n'est pas la même selon la main qui pousse :
 *
 *   - « automatique » : un tour d'agent, une réponse dans la conversation,
 *     l'ordonnanceur. Ceux-là ne ressortent JAMAIS une carte d'une fin de
 *     parcours — c'était le but de la règle d'origine, il ne change pas ;
 *   - « humain » : un clic ou un glissement de l'utilisateur. Une carte peut
 *     être allée dans « Archivé » à tort (travail annoncé fait alors que rien
 *     n'avait bougé) : il faut pouvoir l'en sortir, sinon il ne reste que
 *     l'écriture directe en base.
 */
export type Demandeur = 'humain' | 'automatique';

export interface DecisionReprise {
  possible: boolean;
  /** Pourquoi c'est refusé, dit en toutes lettres. */
  raison?: string;
}

/** La phrase rendue à un agent qui essaie de reprendre une carte rangée. */
export function raisonRepriseRefusee(colonne: ColumnKey): string {
  return `« ${COLUMN_LABELS[colonne]} » est une fin de parcours : seul un geste de l'utilisateur peut en ressortir une carte.`;
}

/**
 * Peut-on reprendre une carte posée dans cette colonne ? Tout est permis
 * ailleurs ; les deux fins de parcours ne s'ouvrent qu'à la main humaine.
 */
export function repriseAutorisee(colonne: ColumnKey, demandeur: Demandeur): DecisionReprise {
  if (!COLONNES_HORS_REPRISE.includes(colonne)) return { possible: true };
  if (demandeur === 'humain') return { possible: true };
  return { possible: false, raison: raisonRepriseRefusee(colonne) };
}

/**
 * Où retombe une carte qu'on sort d'une fin de parcours, d'un seul geste.
 *
 *   - « Archivé » → « Planifié » : la colonne où toute carte naît, celle d'où
 *     part le geste de lancement — personne ne rouvre une dépense sans le
 *     savoir, puisque rien n'y démarre tout seul ;
 *   - « À déployer » → « Terminé » : elle sort du lot à publier et revient à
 *     l'étape juste avant, celle d'où l'on décide de publier ;
 *   - « En production » → « À déployer » : le travail est en ligne quelque
 *     part, mais on veut le remettre dans le lot — une correction à repasser,
 *     une mise en ligne à refaire.
 *
 * Toujours l'étape JUSTE AVANT, jamais deux d'un coup.
 *
 * Rend `null` pour toute autre colonne : il n'y a rien à reprendre.
 */
export function colonneDeReprise(colonne: ColumnKey): ColumnKey | null {
  if (colonne === 'archived') return 'planned';
  if (colonne === 'in_production') return 'to_deploy';
  if (colonne === 'to_deploy') return 'done';
  return null;
}

/**
 * Ce que dit le bouton qui ressort une carte d'une fin de parcours. Trois
 * phrases, parce que trois gestes différents : on ne « retire pas du lot à
 * publier » une carte déjà en ligne. Rend `null` quand il n'y a rien à
 * reprendre.
 */
export function libelleDeReprise(colonne: ColumnKey): string | null {
  if (colonne === 'archived') return 'Sortir de l’archive';
  if (colonne === 'in_production') return 'Repasser dans le lot à publier';
  if (colonne === 'to_deploy') return 'Retirer du lot à publier';
  return null;
}

/**
 * Ce qu'une carte ressortie garde de son passage : la date de son archivage.
 * Rend `null` quand il n'y a rien à dire — carte jamais archivée, ou encore
 * dans « Archivé », où la colonne le dit déjà.
 */
export function mentionArchivage(carte: { column: ColumnKey; archivedAt?: number }): string | null {
  if (!carte.archivedAt) return null;
  if (carte.column === 'archived') return null;
  const jour = new Date(carte.archivedAt).toLocaleDateString('fr-CH');
  return `Archivée le ${jour}, ressortie depuis.`;
}

/**
 * Les rôles d'agent qui EXÉCUTENT le travail d'une carte, et sont donc les
 * seuls à la déplacer — au démarrage comme à l'arrivée. L'analyse,
 * l'orchestration et la publication regardent la carte sans y toucher.
 */
export const ROLES_QUI_DEPLACENT: AgentRole[] = ['task'];

/** Ancien nom, gardé pour la clôture : c'est la même liste. */
export const ROLES_QUI_CLOTURENT = ROLES_QUI_DEPLACENT;

/**
 * Où va la carte quand un tour d'agent DÉMARRE. Rend `null` s'il n'y a rien à
 * bouger — l'agent n'exécute pas, elle y est déjà, ou sa colonne est une fin de
 * parcours assumée.
 */
export function colonneAuDemarrage(colonne: ColumnKey, role: AgentRole): ColumnKey | null {
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne === 'running') return null;
  // Un tour d'agent est une reprise AUTOMATIQUE : les fins de parcours lui
  // restent fermées, quoi qu'il ait répondu.
  if (!repriseAutorisee(colonne, 'automatique').possible) return null;
  return 'running';
}

/**
 * La phrase portée par une carte dont l'analyse est rendue mais qui n'a pas
 * encore reçu son geste de lancement. Elle dit l'essentiel : le chiffrage est
 * là, et rien ne partira tant que l'utilisateur n'aura pas cliqué.
 */
export const RAISON_ATTENTE_LANCEMENT =
  'Analyse rendue : la carte attend votre lancement, rien ne démarre tout seul.';

/**
 * L'ordonnanceur a-t-il le droit de DÉMARRER cette carte de lui-même, sans un
 * nouveau geste de l'utilisateur ?
 *
 * C'est le garde-fou de la session fusionnée : le chiffrage et l'exécution
 * partagent un même agent et un même contexte (on économise le quota), mais
 * l'agent d'analyse ne doit JAMAIS enchaîner tout seul sur l'exécution. Une
 * carte fraîchement analysée — jamais lancée, pas marquée « dès que possible » —
 * reste donc en attente : la bascule Planifié → En cours reste un clic.
 *
 * L'ordonnanceur ne reprend AUTOMATIQUEMENT que trois sortes de cartes :
 *   - celle dont l'HEURE DITE est arrivée (`departPrevu`, posé à la création ou
 *     à la main) — la date EST le geste de lancement, donné à l'avance ;
 *   - celle que l'utilisateur a poussée avec « Dès que possible » (`asap`) —
 *     c'est LÀ son geste de lancement ;
 *   - celle qui a DÉJÀ été lancée puis interrompue (un tour coupé, une reprise
 *     après redémarrage du serveur : `attempts`/`restarts` l'attestent) — on ne
 *     lui redemande pas un clic pour reprendre un travail déjà autorisé.
 *
 * Deux refus passent devant tout le reste : une carte SUSPENDUE à la main ne
 * repart jamais seule, et une date ENCORE À VENIR retient la carte même si elle
 * est marquée « dès que possible » — poser une date, c'est demander à ce que
 * rien ne parte avant.
 *
 * Le geste direct (« Lancer maintenant », dépôt dans « En cours », « Tout
 * lancer ») ne passe pas par ici : il appelle le démarrage sans détour.
 */
export function demarrageAutomatiqueAutorise(
  scheduling?: {
    asap?: boolean;
    attempts?: number;
    restarts?: number;
    departPrevu?: number;
    suspendu?: boolean;
  },
  maintenant: number = Date.now(),
): boolean {
  if (!scheduling) return false;
  // La main l'emporte toujours : suspendre puis voir repartir ne serait pas
  // suspendre. La boucle du démon le vérifie aussi de son côté.
  if (scheduling.suspendu) return false;

  const depart = etatDuDepart(scheduling, maintenant);
  // L'heure est passée : la carte part, et le reste autorisée aussi longtemps
  // qu'il faudra — c'est ce qui rattrape une heure manquée pendant un arrêt du
  // démon, au lieu de l'oublier.
  if (depart === 'venu') return true;
  if (depart === 'attend') return false;

  if (scheduling.asap) return true;
  return (scheduling.attempts ?? 0) > 0 || (scheduling.restarts ?? 0) > 0;
}

/**
 * Ce que porte une carte de « Planifié » qui ne partira pas toute seule tout de
 * suite. Une seule phrase à la fois, dans cet ordre : la suspension d'abord (le
 * geste le plus fort), puis la date (elle dit déjà tout ce qu'il y a à savoir),
 * puis l'attente du clic. Rend `undefined` quand la carte est prête à partir :
 * il n'y a alors rien à expliquer.
 */
export function raisonDattente(
  scheduling?: {
    asap?: boolean;
    attempts?: number;
    restarts?: number;
    departPrevu?: number;
    suspendu?: boolean;
  },
  maintenant: number = Date.now(),
): string | undefined {
  if (scheduling?.suspendu) return RAISON_SUSPENDU;
  const depart = etatDuDepart(scheduling, maintenant);
  // Une date affichée en clair se recalcule à chaque affichage
  // (`mentionDepartProgramme`) : on ne fige pas « demain » dans la base.
  if (depart !== 'aucun') return undefined;
  return demarrageAutomatiqueAutorise(scheduling, maintenant) ? undefined : RAISON_ATTENTE_LANCEMENT;
}

/**
 * Le tour qui se termine est-il encore CELUI de la carte ?
 *
 * Une carte ne porte qu'un agent d'exécution à la fois (`card.agentId`), et un
 * relancement en crée un NOUVEAU. Le tour d'AVANT, lui, se termine à son
 * rythme : son processus peut rendre la main longtemps après, et il écrivait
 * alors « Terminé » sur une carte qu'un autre agent était déjà en train de
 * faire avancer — le tableau annonçait la fin pendant que quelqu'un écrivait.
 *
 * D'où la question posée avant TOUTE clôture : la carte reconnaît-elle encore
 * cet agent comme le sien ? Sans agent inscrit (carte hors parcours ordinaire),
 * on ne bloque rien : il n'y a personne à qui la carte aurait été confiée.
 */
export function tourDeLaCarte(carte: { agentId?: string }, agentId: string): boolean {
  if (!carte.agentId) return true;
  return carte.agentId === agentId;
}

/**
 * La phrase affichée sur une carte sortie de « En cours » faute de code
 * modifié. Elle est écrite pour être lue telle quelle sur le tableau.
 */
export const RAISON_SANS_MODIFICATION =
  "Réponse rendue, mais aucun fichier du projet n'a changé : la carte revient en « Planifié » plutôt que d'être annoncée terminée.";

/**
 * La phrase affichée sur une carte rangée alors que ce tour n'a rien changé —
 * parce qu'il n'y avait RIEN à changer : le travail avait déjà été livré et
 * enregistré lors d'un tour précédent.
 *
 * ELLE COMMENÇAIT PAR « Rien à changer », et c'est ce qui a fait croire à une
 * carte vide : lue sur un triangle jaune, à côté d'un travail réellement fait,
 * elle disait exactement le contraire de ce qui s'était passé. La phrase
 * commence donc désormais par le FAIT — le code est là —, et n'explique
 * qu'ensuite pourquoi ce tour-ci n'a rien ajouté.
 */
export const RAISON_DEJA_LIVRE =
  'Travail déjà enregistré : le code de cette carte est bien sur sa branche, livré lors d’un tour précédent. Ce tour n’avait donc plus rien à changer.';

/**
 * La phrase affichée sur une carte dont le travail écrit a été RETROUVÉ dans sa
 * copie de travail après une coupure, puis enregistré d'office sur sa branche
 * (`enregistrerLeTravailEnCours`).
 *
 * Elle est posée par le ménage du démarrage, tout de suite : sans elle, le seul
 * mot que l'utilisateur voyait sur la carte était celui d'un tour ULTÉRIEUR —
 * qui, lui, n'avait effectivement plus rien à changer, et laissait donc croire
 * que rien n'avait jamais été fait.
 */
export const RAISON_TRAVAIL_SAUVE =
  'Travail retrouvé après une interruption et enregistré d’office sur la branche de la carte : rien n’est perdu.';

/**
 * CE QUE DIT UNE PHRASE DE CARTE : un travail acquis, ou une attente ?
 *
 * Toutes les phrases posées sur une carte (`card.sansModification`) étaient
 * affichées de la même façon : encadré jaune, triangle d'alerte. Or elles ne
 * disent pas la même chose. « Le code est là, livré lors d'un tour précédent »
 * est une INFORMATION sur un travail acquis — l'annoncer en alerte, c'est
 * démentir la coche verte affichée juste à côté. « Rien n'a changé, la carte
 * revient en file » est bien une attente, elle garde son jaune.
 *
 * La règle est PURE et se juge sur la phrase elle-même : l'interface n'a rien à
 * deviner, et les deux mondes ne peuvent pas se contredire.
 */
export type NatureDeLaMention = 'travail' | 'attente';

/** Les phrases qui annoncent un travail ACQUIS, et non une attente. */
const MENTIONS_DE_TRAVAIL: string[] = [RAISON_DEJA_LIVRE, RAISON_TRAVAIL_SAUVE];

export function natureDeLaMention(raison?: string | null): NatureDeLaMention {
  const phrase = (raison ?? '').trim();
  if (!phrase) return 'attente';
  return MENTIONS_DE_TRAVAIL.includes(phrase) ? 'travail' : 'attente';
}

/**
 * Où va la carte quand le tour se TERMINE.
 *
 * Un tour réussi d'agent d'EXÉCUTION qui a RÉELLEMENT modifié le dépôt la pose
 * en « Terminé ». Trois cas la laissent où elle est :
 *   - le tour a échoué : le travail n'est pas fait, l'annoncer terminé serait un
 *     mensonge, et la carte doit rester là où on peut la relancer ;
 *   - le rôle n'exécute pas : une étude rendue n'est pas un travail fait ;
 *   - rien n'a changé dans le dépôt : répondre n'est pas travailler.
 *
 * `depotModifie` est un CONSTAT, pas une intention : le démon compare le dépôt
 * d'avant le tour à celui d'après (enregistrements ajoutés, fichiers en cours de
 * modification). Quand rien ne peut être constaté — projet hors git —, il vaut
 * `true` : on ne bloque pas une carte sur une observation qu'on n'a pas pu
 * faire.
 */
export function colonneEnFinDeTour(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
  depotModifie: boolean,
): ColumnKey | null {
  if (!reussi) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  if (!depotModifie) return null;
  return 'done';
}

/**
 * Le moteur n'a RIEN dit avant que le tour ne tombe : ni texte, ni étape —
 * signe que le LANCEMENT lui-même n'a pas pu joindre le moteur (binaire
 * injoignable, réseau coupé au démarrage du process), pas que la tâche a
 * échoué en cours de route. Une carte dans ce cas ne doit pas rester figée en
 * « En cours » comme le ferait un échec ordinaire (`colonneEnFinDeTour`,
 * inchangée) : elle retombe en « Planifié », prête à repartir toute seule —
 * `demarrageAutomatiqueAutorise` la reprend dès que `restarts` dépasse zéro,
 * et la boucle de l'ordonnanceur (15 s) s'en charge sans geste humain.
 */
export function colonneApresMoteurMuet(colonne: ColumnKey, role: AgentRole, moteurMuet: boolean): ColumnKey | null {
  if (!moteurMuet) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return 'planned';
}

/**
 * La phrase portée par une carte que le moteur n'a pas pu joindre au
 * lancement. Elle dit les deux choses qu'on veut savoir en la relisant : ce
 * n'est pas un échec du travail, et une nouvelle tentative partira seule.
 */
export const RAISON_MOTEUR_INJOIGNABLE =
  'Le moteur n’a pas répondu au lancement : la carte repart en « Planifié », nouvelle tentative automatique.';

/* ------------------------------------------------------------------ */
/* Ce que vaut un DÉPÔT de carte à la main                              */
/* ------------------------------------------------------------------ */

/**
 * Déplacer une carte à la main sur le tableau ne changeait que sa colonne : il
 * fallait ensuite ouvrir la carte et cliquer sur « Lancer maintenant ». Le
 * geste évident ne faisait donc rien.
 *
 * Désormais le dépôt VAUT le geste que la colonne d'arrivée désigne :
 *   - déposer dans « En cours » = cliquer sur « Lancer maintenant » (le même
 *     chemin de lancement, pas un raccourci parallèle) ;
 *   - sortir de « En cours » vers « Planifié » = suspendre l'agent en travail,
 *     la carte restant en file ;
 *   - tout le reste = un simple rangement.
 */
export type EffetDuDepot = 'lancer' | 'suspendre' | 'ranger';

export function effetDuDepot(depart: ColumnKey, arrivee: ColumnKey): EffetDuDepot {
  if (depart === arrivee) return 'ranger';
  if (arrivee === 'running') return 'lancer';
  if (depart === 'running' && arrivee === 'planned') return 'suspendre';
  return 'ranger';
}

/**
 * La phrase portée par une carte suspendue à la main. Elle dit les deux choses
 * qu'on veut savoir en la relisant : le tour a été arrêté, et plus rien ne
 * repartira tant qu'on ne l'aura pas demandé.
 */
export const RAISON_SUSPENDU =
  'Agent suspendu à la main : la carte attend en file, elle ne repartira que sur votre geste.';

/**
 * L'ISSUE D'UN TOUR : où va la carte, et ce qui s'écrit dessus.
 *
 * Le trou d'origine : un tour d'exécution qui RÉUSSISSAIT sans rien changer
 * laissait la carte en « En cours », pour toujours. Aucun agent ne travaillait
 * plus, rien ne devait la reprendre, et — quand la carte avait déjà produit du
 * code lors d'un tour précédent (`dejaEnregistre`) — pas même une phrase
 * n'était écrite : la carte affichait la coche du travail rendu tout en restant
 * comptée dans « EN COURS ». Elle n'en sortait plus jamais.
 *
 * L'exigence de fond ne bouge pas — une carte n'est close que si le travail est
 * réellement CONSTATÉ — mais elle ne justifie pas de laisser la carte coincée.
 * Chaque fin de tour a donc une issue, et une seule :
 *
 *   - le dépôt a bougé → « Terminé », rien à expliquer ;
 *   - le dépôt n'a pas pu être consulté → « Planifié », RETENUE, le trou dit ;
 *   - rien n'a bougé mais la carte avait DÉJÀ livré son code → « Terminé »,
 *     avec la raison : il n'y avait rien à refaire. Le travail est bien
 *     constaté, simplement lors d'un tour antérieur (`codeDejaEnregistre`, posé
 *     par un tour qui a produit ou par une relance depuis une fin de travail) ;
 *   - rien n'a bougé et rien n'a jamais été enregistré → « Planifié », RETENUE,
 *     avec la raison : répondre n'est pas travailler, mais la carte redescend
 *     dans la file au lieu de rester en travers du tableau.
 *
 * RETENUE veut dire : la carte n'est pas reprise toute seule par l'ordonnanceur
 * (`demarrageAutomatiqueAutorise` la refuse dès qu'elle est suspendue). Sans
 * cela, une carte renvoyée en « Planifié » repartirait à la boucle suivante,
 * ne changerait toujours rien, et tournerait en rond en dépensant du quota.
 *
 * Trois cas ne bougent rien : un tour en ÉCHEC (l'incident est déjà dit en
 * rouge, la carte reste là où on la relance), un rôle qui n'exécute pas, une
 * carte qui n'était pas en « En cours ».
 */
export interface IssueDeFinDeTour {
  /** Où poser la carte, ou `null` pour la laisser exactement où elle est. */
  colonne: ColumnKey | null;
  /** La phrase écrite sur la carte, ou `null` quand il n'y a rien à dire. */
  raison: string | null;
  /** La carte ne repart pas toute seule : elle attend un geste. */
  retenue: boolean;
}

/** L'issue « on ne touche à rien », rendue par les trois cas qui s'abstiennent. */
export const CARTE_INCHANGEE: IssueDeFinDeTour = { colonne: null, raison: null, retenue: false };

/**
 * La phrase portée par une carte retrouvée en « En cours » alors que plus rien
 * ne la tenait : son tour s'est terminé sans jamais la ranger.
 */
export const RAISON_TOUR_SANS_ISSUE =
  'Le tour s’est terminé sans ranger la carte : elle revient en « Planifié » plutôt que de rester bloquée en « En cours ».';

/** Ce qu'il faut savoir d'une carte pour dire si elle est OUBLIÉE. */
export interface CarteOubliee {
  colonne: ColumnKey;
  /** Un tour d'exécution la tient encore (marque `tourEnVolDepuis`). */
  tourEnVol: boolean;
  /** Un agent — quel que soit son rôle — travaille en ce moment dessus. */
  agentAuTravail: boolean;
  /** Son dernier tour s'est mal terminé : échec, ou arrêt à la main. */
  dernierTourEnEchec: boolean;
  /** Elle a déjà produit du code, ce tour-ci ou avant. */
  dejaEnregistre: boolean;
}

/**
 * LA CARTE OUBLIÉE EN « EN COURS » — le rattrapage de celles qui étaient DÉJÀ
 * coincées.
 *
 * `issueDeFinDeTour` donne une issue à tout tour QUI SE TERMINE. Elle ne peut
 * rien pour les cartes bloquées AVANT elle : leur tour est fini depuis
 * longtemps, leur marque de vol a été retirée, leur agent est rendu. Plus aucun
 * tour ne se terminera pour elles, donc plus rien ne les rangera — elles
 * restaient comptées dans « EN COURS » à jamais, exactement le bogue qu'on
 * corrige. Le balayage de l'ordonnanceur les retrouve et cette règle dit ce
 * qu'il faut en faire.
 *
 * Quatre situations n'y touchent PAS, et c'est ce qui rend le balayage sûr :
 *
 *   - la carte n'est pas en « En cours » : il n'y a rien à débloquer ;
 *   - un tour la TIENT encore (`tourEnVolDepuis`, posée au démarrage du tour et
 *     retirée seulement une fois la carte rangée) : le ranger maintenant, ce
 *     serait la ranger en plein vol ;
 *   - un agent travaille dessus : l'agent fait foi, pas la colonne ;
 *   - son dernier tour a ÉCHOUÉ ou a été ARRÊTÉ à la main : la règle est déjà
 *     écrite, l'incident est dit en rouge et la carte reste là où on la relance.
 *
 * Restent les vraies oubliées, et leur issue est la MÊME que celle d'une fin de
 * tour sans changement : code déjà livré → « Terminé » avec sa raison ; rien
 * jamais enregistré → « Planifié », RETENUE, avec la sienne. On ne peut plus
 * constater le dépôt d'un tour terminé il y a des heures : le drapeau
 * `codeDejaEnregistre` est le seul témoin qui reste, et il suffit.
 */
export function issueDeCarteOubliee(etat: CarteOubliee): IssueDeFinDeTour {
  if (etat.colonne !== 'running') return CARTE_INCHANGEE;
  if (etat.tourEnVol) return CARTE_INCHANGEE;
  if (etat.agentAuTravail) return CARTE_INCHANGEE;
  if (etat.dernierTourEnEchec) return CARTE_INCHANGEE;

  if (etat.dejaEnregistre) return { colonne: 'done', raison: RAISON_DEJA_LIVRE, retenue: false };
  return { colonne: 'planned', raison: RAISON_TOUR_SANS_ISSUE, retenue: true };
}

export function issueDeFinDeTour(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
  trace: TraceDuTravail,
  dejaEnregistre: boolean,
): IssueDeFinDeTour {
  if (!reussi) return CARTE_INCHANGEE;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return CARTE_INCHANGEE;
  if (colonne !== 'running') return CARTE_INCHANGEE;

  const cloture = colonneEnFinDeTour(colonne, reussi, role, traceAcquise(trace));
  if (cloture) return { colonne: cloture, raison: null, retenue: false };

  // « Je n'ai pas pu regarder » n'est pas « rien n'a bougé » : c'est l'absence
  // d'observation, et elle se dit autrement.
  if (trace === 'inconnue') return { colonne: 'planned', raison: RAISON_TRACE_INCONNUE, retenue: true };

  if (dejaEnregistre) return { colonne: 'done', raison: RAISON_DEJA_LIVRE, retenue: false };
  return { colonne: 'planned', raison: RAISON_SANS_MODIFICATION, retenue: true };
}
