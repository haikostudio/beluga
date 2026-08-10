import { COLUMN_LABELS, ColumnKey } from './columns.js';
import { etatDuDepart } from './depart-programme.js';
import type { AgentRole } from './models.js';

/**
 * La carte suit les ÉTAPES RÉELLES du travail.
 *
 * Parcours attendu : « À faire » → (clic de validation : l'analyse part, la
 * carte reste sur place le temps du chiffrage, puis garde ses chiffres SANS
 * changer de colonne) → (clic de lancement, ou heure dite) → « En cours » →
 * (exécution rendue) → « Terminé ».
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
 * Le passage de « À faire » à « En cours » (lancement) reste le travail de
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
 *   - « Archivé » → « À faire » : elle repassera par la validation, donc
 *     personne ne rouvre une dépense sans le savoir ;
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
  if (colonne === 'archived') return 'todo';
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
 * reste donc en attente : la bascule À faire → En cours reste un clic.
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
 * Ce que porte une carte d'« À faire » qui ne partira pas toute seule tout de
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
 * La phrase affichée sur une carte restée en place faute de code modifié.
 * Elle est écrite pour être lue telle quelle sur le tableau.
 */
export const RAISON_SANS_MODIFICATION =
  "Réponse rendue, mais aucun fichier du projet n'a changé : la carte reste ouverte tant qu'aucun code n'est enregistré.";

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
 *   - sortir de « En cours » vers « À faire » = suspendre l'agent en travail,
 *     la carte restant en file ;
 *   - tout le reste = un simple rangement.
 */
export type EffetDuDepot = 'lancer' | 'suspendre' | 'ranger';

export function effetDuDepot(depart: ColumnKey, arrivee: ColumnKey): EffetDuDepot {
  if (depart === arrivee) return 'ranger';
  if (arrivee === 'running') return 'lancer';
  if (depart === 'running' && arrivee === 'todo') return 'suspendre';
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
 * Pourquoi la carte n'a pas bougé alors que le tour a réussi. Rend `null` quand
 * il n'y a rien à expliquer — carte déplacée, tour en échec (déjà signalé comme
 * tel), rôle qui ne déplace jamais.
 *
 * Seul le cas « l'agent d'exécution a répondu sans rien changer » mérite une
 * phrase : c'est le seul où l'on pourrait croire le travail fait.
 *
 * `dejaEnregistre` regarde l'HISTOIRE de la carte, pas ce seul tour : une carte
 * qui a déjà produit et enregistré du code (elle a atteint « Terminé », ou porte
 * un enregistrement de son travail) ne concerne plus cette note. Un tour de
 * simple suite ou de discussion, donné après coup, ne doit pas rallumer « aucun
 * fichier n'a changé » sur un travail qui a bel et bien atterri.
 */
export function raisonSansModification(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
  depotModifie: boolean,
  dejaEnregistre: boolean,
): string | null {
  if (!reussi || depotModifie) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  if (dejaEnregistre) return null;
  return RAISON_SANS_MODIFICATION;
}
