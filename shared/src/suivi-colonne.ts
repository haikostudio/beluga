import {
  RAISON_TRACE_INCONNUE,
  RAISON_TRAVAIL_HORS_COPIE,
  traceAcquise,
  type TraceDuTravail,
} from './carte-interrompue.js';
import { COLUMN_LABELS, ColumnKey } from './columns.js';
import { etatDuDepart } from './depart-programme.js';
import type { AgentRole } from './models.js';
import { estUnePhraseDeMere } from './regroupements.js';

/**
 * La carte suit les ÉTAPES RÉELLES du travail.
 *
 * Parcours attendu : « À planifier » (où la carte NAÎT ; un clic de validation
 * y lance son chiffrage sur place, sans la déplacer) → (clic de lancement) →
 * « En cours » → (exécution rendue) → « À déployer ».
 *
 * « À déployer » est le point d'arrivée d'un travail RENDU : une réponse
 * FINALE — tour réussi, aucune erreur, aucune question restée sans réponse —
 * y range la carte toute seule, avec sa pastille bleue de non-lu, et son
 * compte rendu se lit en ouvrant la carte. Ce qui échoue ou vous attend NE
 * BOUGE PAS : la carte reste en « En cours », là où on la relance.
 *
 * La colonne « Rapport » qui s'intercalait ici n'existe plus : elle doublait
 * « À déployer » d'une étape que personne ne décidait. L'interrupteur de
 * déploiement automatique, passé à droite de l'entête d'« À déployer », ne
 * commande donc plus aucun passage de colonne : il ne décide plus que du
 * DÉPART du lot en publication (`server/src/deploiement-automatique.ts`).
 *
 * Le piège : l'analyse, l'orchestration et la publication portent elles aussi
 * le numéro de carte. Appliquées à tout agent, les deux règles ci-dessous
 * faisaient sauter la carte en « En cours » dès que l'ANALYSE démarrait, puis
 * en « À déployer » quand cette même analyse rendait son chiffrage — alors que
 * rien n'avait encore été exécuté.
 *
 * D'où la règle unique : seul l'agent d'EXÉCUTION (rôle « task ») déplace une
 * carte. Il la met en « En cours » quand son tour démarre, en « À déployer »
 * quand son tour réussit. Les autres rôles la laissent exactement où elle est.
 * Le passage de « Planifié » à « En cours » (lancement) reste le travail de
 * l'ordonnanceur : ces règles ne le doublent pas.
 *
 * CE QUI CLÔT UNE CARTE : LE RAPPORT RENDU, PLUS LE CONSTAT DU DÉPÔT.
 *
 * Pendant longtemps, la clôture attendait un CONSTAT : des fichiers modifiés
 * dans le dépôt. L'intention était juste — ne pas annoncer terminé un travail
 * qui n'a rien produit — mais le résultat mentait dans l'autre sens : une carte
 * de vérification, une carte dont l'agent conclut qu'il n'y avait rien à faire,
 * une carte dont tout le travail tenait dans son rapport restaient plantées en
 * « En cours » alors que l'utilisateur avait le compte rendu complet sous les
 * yeux, liste de tâches cochée 5/5. Le tableau démentait la conversation.
 *
 * La règle est donc renversée, et c'est une décision de l'utilisateur : DÈS QUE
 * L'AGENT A RENDU SON RAPPORT, LA CARTE EST TERMINÉE — qu'un fichier ait changé
 * ou non. Deux garde-fous seulement, inchangés : un tour en ÉCHEC ou INTERROMPU
 * n'est pas un rapport rendu (la carte reste là où on la relance), et un rôle
 * qui n'exécute pas ne déplace jamais rien.
 *
 * Conséquence ASSUMÉE, et qui doit se lire sur la carte : une carte peut être
 * « À déployée » sans qu'aucun code n'ait changé. Elle le DIT alors en clair
 * (`RAISON_RENDU_SANS_CODE`), plutôt que de laisser croire à une livraison.
 *
 * Les règles sont PURES : elles ne connaissent ni la base ni le moteur, elles
 * disent seulement où la carte devrait être. Le démon observe le dépôt (le même
 * repère avant / après que le travail hors tâche) et leur passe le constat — qui
 * ne décide plus de la clôture, mais de la PHRASE portée par la carte ; les
 * tests les rejouent.
 */

/**
 * Les colonnes qu'un tour d'agent ne remet PAS en marche.
 *
 * « À déployer » et « Archivé » sont des fins de parcours choisies : poser une
 * question dans la conversation d'une carte déjà prête à publier — ou déjà en
 * ligne — ne doit pas la sortir du lot sans qu'on l'ait demandé.
 *
 * C'est d'autant plus vrai depuis que « À déployer » est AUSSI la colonne
 * d'arrivée d'un travail rendu : une carte close y retomberait ouverte à toute
 * reprise AUTOMATIQUE — un tour de suite, une file dépilée, un rejeu après
 * panne la ramènerait en « Travail » sans qu'aucune main n'ait bougé, la fin
 * de tour la remettrait en « À déployer », et le tableau montrerait une carte
 * qui fait l'aller-retour toute seule.
 *
 * Le GESTE HUMAIN, lui, rouvre toujours — mais c'est le LANCEMENT, et lui seul.
 * Écrire dans la conversation d'une carte prête à publier ne la remet plus au
 * travail : le message rouvre son cadrage SANS la déplacer, et elle ne repart
 * en « Demande » que si ce cadrage rend une nouvelle compréhension
 * (`shared/src/relance-apres-rapport.ts`).
 */
export const COLONNES_HORS_REPRISE: ColumnKey[] = ['to_deploy', 'archived'];

/**
 * LES COLONNES QUI DISENT « CE TRAVAIL EST FINI ».
 *
 * Une carte qui y entre porte sa date de fin (`doneAt`), sa photographie de
 * session, et perd l'attente qu'un tour précédent lui avait posée. Il n'en
 * reste plus qu'UNE depuis le retrait de « Rapport » : « À déployer », où la
 * carte s'arrête d'elle-même et attend le lot à publier. La liste RESTE une
 * liste — c'est elle que lisent tous les chemins de rangement.
 */
export const COLONNES_DE_CLOTURE: ColumnKey[] = ['to_deploy'];

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
 *   - « Archivé » → « Demande » : la colonne où toute carte naît, celle d'où
 *     part le geste de lancement — personne ne rouvre une dépense sans le
 *     savoir, puisque rien n'y démarre tout seul ;
 *   - « À déployer » → « Demande » aussi, depuis le retrait de « Rapport » :
 *     l'étape d'avant n'est plus une salle d'attente mais le TRAVAIL lui-même,
 *     et retirer une carte du lot ne doit jamais rallumer un agent. Elle
 *     retombe donc là où rien ne démarre tout seul.
 *
 * Rend `null` pour toute autre colonne : il n'y a rien à reprendre.
 */
export function colonneDeReprise(colonne: ColumnKey): ColumnKey | null {
  if (colonne === 'archived') return 'planned';
  if (colonne === 'to_deploy') return 'planned';
  return null;
}

/**
 * Ce que dit le bouton qui ressort une carte d'une fin de parcours. Deux
 * phrases, parce que deux gestes différents : on ne « retire pas du lot à
 * publier » une carte déjà archivée. Rend `null` quand il n'y a rien à
 * reprendre.
 */
export function libelleDeReprise(colonne: ColumnKey): string | null {
  if (colonne === 'archived') return 'Sortir de l’archive';
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
export function colonneAuDemarrage(
  colonne: ColumnKey,
  role: AgentRole,
  demandeur: Demandeur = 'automatique',
): ColumnKey | null {
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne === 'running') return null;
  /*
   * RELANCER LA DISCUSSION D'UNE CARTE, C'EST LA REMETTRE AU TRAVAIL.
   *
   * Un tour d'agent reste, par défaut, une reprise AUTOMATIQUE : les fins de
   * parcours lui sont fermées, quoi qu'il ait répondu. Mais un MESSAGE ÉCRIT
   * PAR L'UTILISATEUR dans la conversation d'une carte est un geste humain, au
   * même titre qu'un clic : demander autre chose à une carte rangée
   * « À déployer », c'est rouvrir son travail — et le tableau doit le dire,
   * sinon la carte annonce « prête à publier » pendant qu'un agent la modifie.
   *
   * L'exception vaut pour la colonne de clôture. Un message ÉCRIT dans la
   * conversation n'arrive plus jusqu'ici : il part au cadrage (`agent.prompt`,
   * `messageVaAuCadrage`) et ne déplace rien. Restent la réponse à une question
   * de l'agent de tâche et le lancement, qui remettent bien la carte au travail.
   *
   * « Archivé » reste fermé, même à la main : cette carte-là est en ligne, et
   * la reprendre demande le geste explicite du tiroir (`colonneDeReprise`).
   */
  if (COLONNES_DE_CLOTURE.includes(colonne) && demandeur === 'humain') return 'running';
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
    reprendreDesQuePossible?: boolean;
  },
  maintenant: number = Date.now(),
): boolean {
  if (!scheduling) return false;
  // La main l'emporte toujours : suspendre puis voir repartir ne serait pas
  // suspendre. La boucle du démon le vérifie aussi de son côté.
  if (scheduling.suspendu) return false;

  /*
   * LE LANCEMENT DEMANDÉ QU'UNE PORTE PASSAGÈRE A REFUSÉ. Le geste a eu lieu :
   * seul le quota (ou la place sur la machine) manquait, et cela se répare tout
   * seul. Sans cette ligne, une carte lancée pour la première fois et refusée
   * faute de quota n'était reprise par personne — `attempts` valait encore
   * zéro, puisque le départ n'avait pas eu lieu — et attendait un second clic
   * que rien n'annonçait. La marque se pose UNIQUEMENT sur ce refus-là
   * (`portesDures`, porte « qui se rouvre seule ») et s'efface au vrai départ.
   */
  if (scheduling.reprendreDesQuePossible) return true;

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
 * alors « À déployer » sur une carte qu'un autre agent était déjà en train de
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
 * ANCIENNE phrase : celle des cartes renvoyées en « Planifié » faute de code
 * modifié, du temps où le constat du dépôt décidait de la clôture. Elle n'est
 * plus jamais écrite — mais elle dort encore sur les cartes rangées avant ce
 * changement, et `origineDeReprise` la reconnaît. On la garde pour LIRE le
 * passé, jamais pour écrire.
 */
export const RAISON_SANS_MODIFICATION =
  "Réponse rendue, mais aucun fichier du projet n'a changé : la carte revient en « À planifier » plutôt que d'être annoncée terminée.";

/**
 * La phrase d'une carte CLOSE alors qu'aucun fichier n'a changé — le cas neuf,
 * et celui qu'il faut dire sans ambiguïté.
 *
 * C'est la conséquence assumée de la règle : le rapport rendu ferme la carte.
 * Une carte de vérification, une carte dont l'agent conclut qu'il n'y avait
 * rien à faire arrivent donc dans « À déployer » sans une ligne de code. La carte
 * ne doit surtout pas laisser croire à une livraison : elle annonce le rapport
 * ET l'absence de code, dans la même phrase.
 */
export const RAISON_RENDU_SANS_CODE =
  'Rapport rendu, aucun fichier du projet modifié : la carte est terminée, mais rien n’a été livré — il n’y a donc rien à déployer.';

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
 *
 * TROISIÈME TON depuis que le rapport rendu ferme la carte : l'INFORMATION.
 * « Rapport rendu, aucun fichier modifié » n'est ni un travail acquis (il n'y a
 * pas de code) ni une attente (la carte est close, personne n'a rien à faire) :
 * c'est un fait à connaître, écrit en gris. L'afficher en alerte jaune ferait
 * lire un problème là où il n'y en a pas ; en bleu, il ferait croire à une
 * livraison — exactement ce que la phrase dit ne pas avoir eu lieu.
 */
export type NatureDeLaMention = 'travail' | 'attente' | 'information';

/** Les phrases qui annoncent un travail ACQUIS, et non une attente. */
const MENTIONS_DE_TRAVAIL: string[] = [RAISON_DEJA_LIVRE, RAISON_TRAVAIL_SAUVE];

/**
 * Les phrases qui CONSTATENT, sans rien demander ni rien promettre. Elle est
 * lue à l'APPEL et non au chargement du module : `RAISON_TOUR_SANS_ISSUE` est
 * déclarée plus bas dans ce fichier, et une liste figée ici la trouverait
 * encore vide.
 */
function mentionsDInformation(): string[] {
  return [RAISON_RENDU_SANS_CODE, RAISON_TRACE_INCONNUE, RAISON_TOUR_SANS_ISSUE];
}

export function natureDeLaMention(raison?: string | null): NatureDeLaMention {
  const phrase = (raison ?? '').trim();
  if (!phrase) return 'attente';
  if (MENTIONS_DE_TRAVAIL.includes(phrase)) return 'travail';
  /* LA PHRASE D'UNE MÈRE RANGÉE dit un travail fait dans ses projets : un
     acquis en bleu, jamais une alerte (`phraseDeLaMere`). */
  if (estUnePhraseDeMere(phrase)) return 'travail';
  if (mentionsDInformation().includes(phrase)) return 'information';
  return 'attente';
}

/**
 * Où va la carte quand le tour se TERMINE.
 *
 * Un tour RENDU par un agent d'EXÉCUTION la pose en « À déployer » — le rapport
 * est la preuve, le dépôt n'est plus consulté pour en décider. Trois cas la
 * laissent où elle est :
 *   - le tour a échoué ou a été interrompu : le travail n'est pas rendu,
 *     l'annoncer terminé serait un mensonge, et la carte doit rester là où on
 *     peut la relancer ;
 *   - le rôle n'exécute pas : une étude rendue n'est pas un travail fait ;
 *   - la carte n'était pas en « En cours » : il n'y a rien à clore.
 *
 * Le CONSTAT du dépôt (`TraceDuTravail`) n'a pas disparu pour autant : il ne
 * décide plus de la colonne, il décide de la PHRASE écrite sur la carte
 * (`issueDeFinDeTour`) — livré, rien livré, ou travail vu ailleurs.
 *
 * LA COLONNE D'ARRIVÉE A UN SEUL NOM, `COLONNE_DE_FIN_DE_TOUR`. Elle a déjà
 * changé DEUX fois — « À déployer », puis « Rapport », puis « À déployer » de
 * nouveau depuis le retrait de cette colonne intermédiaire — et les scripts de
 * vérification qui l'avaient recopiée en dur sont restés en arrière, à échouer
 * tous les jours sur un produit pourtant juste. Un contrôle qui parle de cette
 * colonne LIT donc cette constante, il ne la réécrit pas.
 */
export const COLONNE_DE_FIN_DE_TOUR: ColumnKey = 'to_deploy';

export function colonneEnFinDeTour(colonne: ColumnKey, reussi: boolean, role: AgentRole): ColumnKey | null {
  if (!reussi) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return COLONNE_DE_FIN_DE_TOUR;
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
  'L’IA n’a pas répondu au lancement : la carte repart en « Demande » et un nouvel essai part tout seul.';

/**
 * LE TEMPS LAISSÉ AU FOURNISSEUR AVANT DE RETENTER UNE CARTE.
 *
 * Une panne qui a résisté à TOUS les essais du tour (`ESSAIS_MAX`, environ une
 * minute d'attente cumulée) ne passera pas dans les quinze secondes de la
 * boucle de l'ordonnanceur. Repartir aussitôt ferait tourner la carte en rond
 * — lancement, panne, retour en file, lancement — en brûlant du quota à chaque
 * passage, tant que le fournisseur reste perturbé. La carte attend donc ce
 * délai avant de repartir toute seule, et elle DIT quand elle repartira
 * (`departPrevu`, la même date de départ que partout ailleurs).
 */
export const DELAI_AVANT_REPRISE_APRES_PANNE_MS = 5 * 60_000;

/**
 * TOUS LES ESSAIS ONT ÉCHOUÉ SUR UNE PANNE DU FOURNISSEUR — et le moteur, lui,
 * avait bel et bien parlé : `colonneApresMoteurMuet` ne voit donc rien, et
 * `colonneEnFinDeTour` laisse la carte figée en « En cours » comme n'importe
 * quel échec de TÂCHE.
 *
 * Or ce n'en est pas un, et le message affiché à l'utilisateur le promet en
 * toutes lettres : « le travail déjà fait est intact, et il repartira où il
 * s'était arrêté dès que le fournisseur répondra de nouveau »
 * (`messageDePanneDefinitive`). Personne ne tenait cette promesse : la carte
 * restait en « En cours » avec son bandeau rouge, l'agent en « stopped » — donc
 * même le balayage des cartes oubliées s'interdisait d'y toucher
 * (`issueDeCarteOubliee`, refus « dernier tour en échec ») — et il fallait la
 * reprendre à la main.
 *
 * Elle retombe donc en « Planifié », exactement comme une carte coupée par un
 * redémarrage du serveur : `restarts` incrémenté, donc reprise automatique
 * (`demarrageAutomatiqueAutorise`), mais pas avant
 * `DELAI_AVANT_REPRISE_APRES_PANNE_MS` — une panne qui vient de résister à
 * trois essais ne se répare pas en quinze secondes.
 */
export function colonneApresPanneDuMoteur(
  colonne: ColumnKey,
  role: AgentRole,
  panneDuMoteur: boolean,
): ColumnKey | null {
  if (!panneDuMoteur) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return 'planned';
}

/**
 * La phrase portée par une carte dont le tour est tombé sur une panne du
 * fournisseur qui a résisté à tous les essais. Elle dit les trois choses qu'on
 * veut savoir en la relisant : ce n'est pas un échec du travail, le travail
 * déjà fait est gardé, et la carte repartira seule.
 */
export const RAISON_PANNE_MOTEUR =
  'Le service d’IA est en panne et n’a pas repris après plusieurs essais : la carte repart en « Demande » et sera relancée toute seule.';

/**
 * LE TOUR N'A JAMAIS EU LES OUTILS DU PROJET, ET IL N'A RIEN RENDU.
 *
 * Le pont d'outils est le petit programme qui donne au moteur la mémoire du
 * projet, l'écriture de mémoire et les gestes de tableau. Quand il ne démarre
 * pas — le serveur ne peut plus lancer de processus, cas le plus fréquent —,
 * l'agent travaille à l'aveugle : il ne peut ni lire la mémoire, ni écrire sur
 * sa carte, ni poser de question. `shared/src/pont-outils.ts` savait déjà le
 * DIRE (étape rouge, encadré dans la réponse), mais personne n'en tirait de
 * conséquence : le tour comptait comme n'importe quel échec de tâche, donc
 * `colonneEnFinDeTour` laissait la carte figée en « En cours », sans agent au
 * travail et sans rien qui la reprenne. Constaté le 08.09.2026 sur deux cartes
 * voisines, arrêtées l'une à 3/6, l'autre à 1/6.
 *
 * Ce n'est pourtant PAS un échec du travail : c'est un tour qui n'a jamais eu
 * ses moyens. La carte repart donc en « Planifié », comme après une panne du
 * fournisseur, avec le même délai — le pont ne renaîtra pas dans les quinze
 * secondes si la machine est encore pleine — et sa propre phrase.
 *
 * Un tour qui a RENDU son rapport malgré tout n'est pas concerné : le travail
 * est livré, le rejouer le referait deux fois. L'encadré de sa réponse dit déjà
 * que la mémoire n'a pas été lue (`noteDePontEnEchec`).
 */
export function colonneApresPontMort(
  colonne: ColumnKey,
  role: AgentRole,
  pontMort: boolean,
): ColumnKey | null {
  if (!pontMort) return null;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return null;
  if (colonne !== 'running') return null;
  return 'planned';
}

/**
 * La phrase portée par une carte dont le tour n'a jamais reçu les outils du
 * projet. Elle dit ce qui a manqué, et que personne n'a à la relancer à la main.
 */
export const RAISON_PONT_MORT =
  'L’agent a démarré sans ses outils (mémoire du projet, tableau) : la carte repart en « À planifier » et sera relancée toute seule.';

/**
 * LES REJEUX SILENCIEUX SONT ÉPUISÉS : ON DEMANDE.
 *
 * Trois tours de suite sans outils ne sont plus un incident passager. La carte
 * ne repart donc plus toute seule — elle ne se referme pas non plus, ce qui
 * ferait passer trois tours à l'aveugle pour un travail livré : elle RESTE là
 * où elle est, avec sa décision « Relancer / Ignorer / Arrêter » posée sur le
 * message, exactement comme un tour tombé après le moteur.
 */
export function retenueApresPontEpuise(colonne: ColumnKey, role: AgentRole, epuise: boolean): boolean {
  if (!epuise) return false;
  if (!ROLES_QUI_DEPLACENT.includes(role)) return false;
  return colonne === 'running';
}

/**
 * La phrase portée par une carte dont les rejeux d'outils sont épuisés. Elle
 * dit ce qui manque et que la suite tient à un geste : rien ne repartira seul.
 */
export const RAISON_PONT_EPUISE =
  'Les outils du projet n’ont pas répondu après plusieurs essais : la carte attend votre décision — relancer, ignorer ou arrêter.';

/**
 * La phrase portée par une carte dont le tour est tombé parce que LE SERVEUR
 * lui-même ne pouvait plus lancer de programme. Elle ne parle ni du moteur ni
 * du fournisseur : ce qui doit se libérer, ce sont les agents d'à côté.
 */
export const RAISON_MACHINE_SATUREE =
  'Le serveur n’avait plus assez de place pour lancer ce travail : la carte repart en « À planifier » et sera relancée toute seule dès que la charge retombe.';

/* ------------------------------------------------------------------ */
/* Ce que vaut un DÉPÔT de carte à la main                              */
/* ------------------------------------------------------------------ */

/**
 * Déplacer une carte à la main sur le tableau ne changeait que sa colonne : il
 * fallait ensuite ouvrir la carte et cliquer sur le bouton correspondant. Le
 * geste évident ne faisait donc rien.
 *
 * Désormais LE DÉPÔT VAUT LE GESTE QUE LA COLONNE D'ARRIVÉE DÉSIGNE :
 *   - déposer dans « Plan » depuis « Demande » = cliquer sur « Générer le
 *     plan » (la même commande `plan.generer`, pas un raccourci parallèle) ;
 *   - déposer dans « Travail » = cliquer sur « Lancer maintenant » (le même
 *     chemin de lancement) ;
 *   - sortir de « Travail » vers « Demande » = suspendre l'agent en travail,
 *     la carte restant en file ;
 *   - de « Travail » vers « À déployer » = REFUSÉ, avec sa raison : une carte
 *     entre en « À déployer » quand son rapport est rendu, jamais à la main ;
 *   - tout le reste = un simple rangement.
 *
 * La règle dit aussi, pour chaque effet, s'il ENGAGE UNE DÉPENSE : c'est cette
 * information que l'écran lit pour décider s'il demande confirmation, au lieu
 * de recopier la liste des colonnes de son côté.
 */
export type EffetDuDepot = 'lancer' | 'suspendre' | 'ranger' | 'refuser';

/** Ce que vaut un dépôt : l'effet, son prix, et ce qu'on dit à l'écran. */
export interface GesteDuDepot {
  effet: EffetDuDepot;
  /** Le geste lance-t-il un tour de moteur — donc une dépense ? */
  depense: boolean;
  /** Le titre de la fenêtre de confirmation, quand il y a dépense. */
  titre?: string;
  /** Ce que cette fenêtre explique : ce qui va se passer, pas « êtes-vous sûr ? ». */
  question?: string;
  /** POURQUOI le dépôt est refusé, en toutes lettres. Absent sinon. */
  raison?: string;
}

/**
 * La phrase du seul dépôt REFUSÉ. Elle dit la règle du produit — un rapport se
 * rend, il ne se décrète pas — et les deux gestes qui restent ouverts.
 */
export const RAISON_RAPPORT_A_LA_MAIN =
  'Une carte entre en « À déployer » quand son rapport est rendu, pas à la main : reprenez son tour ou arrêtez-le.';

export function gesteDuDepot(depart: ColumnKey, arrivee: ColumnKey): GesteDuDepot {
  if (depart === arrivee) return { effet: 'ranger', depense: false };
  if (arrivee === 'running') {
    return {
      effet: 'lancer',
      depense: true,
      titre: 'Lancer la tâche ?',
      question: 'Un agent démarre tout de suite sur cette carte, et son travail est facturé.',
    };
  }
  if (depart === 'running' && arrivee === COLONNE_DE_FIN_DE_TOUR) {
    return { effet: 'refuser', depense: false, raison: RAISON_RAPPORT_A_LA_MAIN };
  }
  if (depart === 'running' && arrivee === 'planned') return { effet: 'suspendre', depense: false };
  return { effet: 'ranger', depense: false };
}

/** Le seul effet, pour qui n'a pas besoin du reste. */
export function effetDuDepot(depart: ColumnKey, arrivee: ColumnKey): EffetDuDepot {
  return gesteDuDepot(depart, arrivee).effet;
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
 * Un tour d'exécution RENDU ferme la carte, point. Ce qui varie n'est plus la
 * colonne mais la PHRASE, tirée du constat du dépôt :
 *
 *   - le dépôt a bougé → « À déployer », rien à expliquer : le travail parle ;
 *   - rien n'a bougé mais la carte avait DÉJÀ livré son code → « À déployer »,
 *     avec la raison : il n'y avait rien à refaire, le travail est constaté sur
 *     un tour antérieur (`codeDejaEnregistre`) ;
 *   - du travail a été vu AILLEURS que dans la copie de la carte → « À déployer »,
 *     en disant où le chercher : sa branche est vide, il n'y a rien à déployer ;
 *   - le dépôt n'a pas pu être consulté → « À déployer » sur la foi du rapport, le
 *     trou dit ;
 *   - rien n'a bougé du tout → « À déployer », en disant qu'aucun code n'a été
 *     livré. C'est le cas d'une carte de vérification, ou d'un agent qui conclut
 *     qu'il n'y avait rien à faire.
 *
 * CE QUI A CHANGÉ, et pourquoi : ces quatre derniers cas renvoyaient la carte en
 * « Planifié », RETENUE. Une carte dont le rapport était rendu, la liste de
 * tâches cochée 5/5, se retrouvait donc en travers du tableau avec un triangle
 * jaune — le tableau démentait la conversation. Plus aucune issue de fin de tour
 * ne retient une carte : `retenue` a disparu de cette règle avec elle.
 *
 * Trois cas ne bougent rien : un tour en ÉCHEC ou interrompu (l'incident est
 * déjà dit en rouge, la carte reste là où on la relance), un rôle qui n'exécute
 * pas, une carte qui n'était pas en « En cours ».
 */
export interface IssueDeFinDeTour {
  /** Où poser la carte, ou `null` pour la laisser exactement où elle est. */
  colonne: ColumnKey | null;
  /** La phrase écrite sur la carte, ou `null` quand il n'y a rien à dire. */
  raison: string | null;
}

/** L'issue « on ne touche à rien », rendue par les trois cas qui s'abstiennent. */
export const CARTE_INCHANGEE: IssueDeFinDeTour = { colonne: null, raison: null };

/**
 * La phrase portée par une carte retrouvée en « En cours » alors que plus rien
 * ne la tenait : son tour s'est terminé sans jamais la ranger. Elle ne renvoie
 * plus la carte en « Planifié » — le tour avait bien rendu la main —, elle la
 * clôt en disant ce qui s'est passé.
 */
export const RAISON_TOUR_SANS_ISSUE =
  'Le travail s’est terminé sans que la carte soit rangée : elle passe en « À déployer » plutôt que de rester bloquée en « Travail ».';

/** Ce qu'il faut savoir d'une carte pour dire si elle est OUBLIÉE. */
export interface CarteOubliee {
  colonne: ColumnKey;
  /**
   * Depuis quand un tour d'exécution la tient encore, `undefined` si aucun ne
   * la tient. La marque (`tourEnVolDepuis`) est censée disparaître en
   * quelques secondes, le temps de fusionner la branche et de clore la carte —
   * si elle ne bouge plus depuis `SEUIL_VOL_BLOQUE_MS`, ce n'est plus un
   * rangement en cours, c'est un tour mort qui a oublié d'éteindre sa marque.
   */
  tourEnVolDepuis?: number;
  /** Un agent — quel que soit son rôle — travaille en ce moment dessus. */
  agentAuTravail: boolean;
  /**
   * UN TOUR VIT ENCORE SUR CETTE CARTE, alors même que le STATUT de son agent
   * est déjà retombé à « terminé » (`Agent.tourVivantDepuis`).
   *
   * C'est la fenêtre qui faisait ranger des cartes en plein travail. Le démon
   * fige la réponse à l'écran, PUIS continue : compression du fil, mesure du
   * quota, constat du dépôt, fusion de la branche de la carte, fermeture de sa
   * copie de travail — des minutes entières, pendant lesquelles le statut de
   * l'agent dit « terminé » et la marque de vol a largement dépassé son seuil.
   * Le balayage voyait donc une carte « oubliée » là où un tour rangeait
   * encore, la posait en « À déployer » avec la phrase « le tour s'est terminé
   * sans ranger la carte », et le vrai rangement qui arrivait une minute plus
   * tard ne trouvait plus sa carte en « En cours » : il ne faisait plus rien.
   *
   * `tourVivantDepuis` est le seul témoin qui couvre cette fenêtre : posé au
   * lancement du moteur, retiré à la toute dernière ligne du tour, et effacé au
   * démarrage du démon (aucun moteur ne lui survit). Il ne peut donc pas
   * bloquer le balayage pour toujours.
   */
  tourEncoreVivant?: boolean;
  /** Son dernier tour s'est mal terminé : échec, ou arrêt à la main. */
  dernierTourEnEchec: boolean;
  /** Elle a déjà produit du code, ce tour-ci ou avant. */
  dejaEnregistre: boolean;
  /**
   * Une décision reste ouverte sur cette carte : question posée sans réponse,
   * ou liste de tâches refermée avec des étapes non faites. La ranger en
   * « À déployer » maintenant annoncerait un travail abouti alors qu'une
   * intervention de l'utilisateur reste due.
   */
  decisionOuverte?: boolean;
  /**
   * SON LANCEMENT EST ENCORE EN PRÉPARATION — le clic est parti, mais le tour
   * n'a pas commencé : portes à franchir, copie de travail à ouvrir, branche à
   * préparer, agent à créer. La carte est déjà en « En cours » (le clic l'y
   * pose tout de suite, pour que l'écran dise la vérité), et pendant cette
   * fenêtre aucun agent ne travaille encore.
   *
   * C'est CE trou qui faisait sauter la colonne « En cours » : le balayage
   * fermait la carte à peine lancée, en « À déployer », d'où l'interrupteur de
   * déploiement automatique la poussait aussitôt dans « À déployer ».
   */
  lancementEnPreparation?: boolean;
  /**
   * UNE DEMANDE DE CETTE CARTE ATTEND ENCORE EN FILE — écrite, acceptée, mais
   * pas encore partie au moteur (plus un compte n'avait de quota, ou un tour
   * précédent la tenait). L'agent est alors au repos, sans tour vivant : tous
   * les autres témoins disent « plus rien ne travaille », alors que le travail
   * n'a même pas commencé. La carte ne se ferme pas sur une demande qui n'a
   * jamais été traitée.
   */
  demandeEnFile?: boolean;
  /**
   * ELLE PORTE LA MARQUE DE SUSPENSION alors qu'elle est en « En cours ».
   *
   * Les deux ne peuvent pas être vrais ensemble : « suspendue » veut dire
   * « garée, elle ne repartira que sur un geste », et « En cours » veut dire
   * « un agent travaille dessus ». Une carte qui affiche les deux est une carte
   * dont le rangement s'est perdu en chemin — et rien ne l'en sortait, le refus
   * « dernier tour en échec » l'excluant précisément du balayage.
   */
  suspendue?: boolean;
}

/**
 * Passé ce délai sans qu'aucun agent ne soit au travail, une marque de vol
 * encore posée n'est plus le signe d'un rangement en cours : plus rien ne
 * viendra jamais la retirer, et la carte resterait bloquée en « En cours »
 * jusqu'au prochain redémarrage du démon. Cinq minutes, très large au regard
 * des « quelques secondes » qu'un rangement normal (fusion de branche,
 * clôture) est censé prendre.
 */
export const SEUIL_VOL_BLOQUE_MS = 5 * 60 * 1000;

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
 * Cinq situations n'y touchent PAS, et c'est ce qui rend le balayage sûr :
 *
 *   - la carte n'est pas en « En cours » : il n'y a rien à débloquer ;
 *   - un agent travaille dessus : l'agent fait foi, pas la colonne ;
 *   - son LANCEMENT se prépare encore (`lancementEnPreparation`) : la carte
 *     est passée en « En cours » au clic, avant l'ouverture de sa copie de
 *     travail, et aucun agent n'existe encore pour la tenir ;
 *   - une DEMANDE attend encore en file (`demandeEnFile`) : le travail n'a pas
 *     commencé, il n'y a donc rien à clore ;
 *   - un TOUR VIT ENCORE dessus (`tourEncoreVivant`), même avec un statut
 *     d'agent déjà retombé : le rangement d'après-réponse — compression,
 *     constat du dépôt, fusion de la branche — dure des minutes, et fermer la
 *     carte pendant ce temps, c'est l'annoncer terminée avant qu'elle le soit ;
 *   - un tour la TIENT encore depuis MOINS de `SEUIL_VOL_BLOQUE_MS`
 *     (`tourEnVolDepuis`, posée au démarrage du tour et retirée seulement une
 *     fois la carte rangée) : le ranger maintenant, ce serait la ranger en
 *     plein vol. Passé ce délai sans agent au travail, la marque ne dit plus
 *     rien d'un rangement en cours — c'est un tour mort dont la fermeture
 *     d'autorité (`refermerLeTour`) a éteint l'agent SANS jamais y toucher :
 *     sans cette porte de sortie, la carte restait bloquée jusqu'au prochain
 *     redémarrage du démon (`server/src/store.ts`, `cartesEnVol`) ;
 *   - son dernier tour a ÉCHOUÉ ou a été ARRÊTÉ à la main : la règle est déjà
 *     écrite, l'incident est dit en rouge et la carte reste là où on la relance ;
 *   - une DÉCISION reste OUVERTE (`decisionOuverte`) : une question posée sans
 *     réponse, ou une liste de tâches refermée avec des étapes non faites. La
 *     ranger dans « À déployer » ferait passer une carte qui attend l'utilisateur
 *     pour un travail abouti — et donc, plus loin, pour une carte prête à être
 *     déployée.
 *
 * Un cas ne s'abstient pas mais ne CLÔT rien non plus : la carte qui porte la
 * marque de SUSPENSION tout en restant affichée en « En cours ». Elle n'est pas
 * oubliée, elle est mal rangée — le geste qui l'a arrêtée voulait la mettre en
 * « Planifié » et n'a pas fini son travail. Elle y retombe donc, avec sa phrase,
 * et ce cas passe AVANT le refus « dernier tour en échec » qui la retenait.
 *
 * Restent les vraies oubliées, et leur issue est la MÊME que celle d'une fin de
 * tour sans changement : code déjà livré → « À déployer » avec sa raison ; rien
 * jamais enregistré → « À déployer », avec la sienne. On ne peut plus
 * constater le dépôt d'un tour terminé il y a des heures : le drapeau
 * `codeDejaEnregistre` est le seul témoin qui reste, et il suffit.
 */
export function issueDeCarteOubliee(etat: CarteOubliee, maintenant: number): IssueDeFinDeTour {
  if (etat.colonne !== 'running') return CARTE_INCHANGEE;
  if (etat.agentAuTravail) return CARTE_INCHANGEE;
  /*
   * ET UN TOUR QUI RANGE ENCORE N'EST PAS UN TOUR OUBLIÉ. Le statut de l'agent
   * retombe dès la réponse figée, bien avant la fin du rangement : sans ce
   * refus, le balayage fermait la carte pendant que le tour fusionnait encore
   * sa branche (§ `tourEncoreVivant`).
   */
  if (etat.tourEncoreVivant) return CARTE_INCHANGEE;
  /*
   * ET UN TOUR QUI N'A PAS ENCORE COMMENCÉ N'EST PAS UN TOUR OUBLIÉ. Le clic
   * pose la carte en « En cours » avant l'ouverture de sa copie de travail :
   * pendant ces secondes — ces minutes, sur un gros dépôt — aucun agent ne
   * travaille et aucune marque n'est encore posée (§ `lancementEnPreparation`).
   */
  if (etat.lancementEnPreparation) return CARTE_INCHANGEE;
  /*
   * ET UNE DEMANDE QUI ATTEND ENCORE SON TOUR N'EST PAS UN TRAVAIL FINI : la
   * fermer annoncerait terminée une carte dont le moteur n'a pas lu la
   * première ligne (§ `demandeEnFile`).
   */
  if (etat.demandeEnFile) return CARTE_INCHANGEE;
  const volRecent = etat.tourEnVolDepuis !== undefined && maintenant - etat.tourEnVolDepuis < SEUIL_VOL_BLOQUE_MS;
  if (volRecent) return CARTE_INCHANGEE;
  /*
   * UNE CARTE SUSPENDUE N'EST PAS UNE CARTE EN TRAVAIL, et elle passe AVANT le
   * refus « dernier tour en échec » — sans quoi elle n'a aucune issue.
   *
   * « Suspendue » se pose sur les gestes qui ARRÊTENT, et ces gestes rangent la
   * carte en « Planifié » du même mouvement (`suspendreLaCarte`). Les deux
   * marques ensemble disent donc qu'un rangement s'est perdu en chemin : la
   * carte a été garée, mais elle est restée affichée en travail. Or son dernier
   * tour est justement en échec — c'est ce qui l'a fait suspendre —, si bien
   * que le balayage s'interdisait d'y toucher : elle restait en « En cours »
   * pour toujours, sans agent, sans tour, et sans personne pour l'en sortir.
   *
   * Elle retombe donc là où le geste voulait la mettre, en gardant sa phrase :
   * on ne rend pas une raison de plus, celle qui l'a suspendue dit déjà tout.
   */
  if (etat.suspendue) return { colonne: 'planned', raison: null };
  if (etat.dernierTourEnEchec) return CARTE_INCHANGEE;
  if (etat.decisionOuverte) return CARTE_INCHANGEE;

  if (etat.dejaEnregistre) return { colonne: COLONNE_DE_FIN_DE_TOUR, raison: RAISON_DEJA_LIVRE };
  return { colonne: COLONNE_DE_FIN_DE_TOUR, raison: RAISON_TOUR_SANS_ISSUE };
}

/**
 * LA PHRASE D'UNE CARTE QUI RESTE EN TRAVAIL PARCE QU'ELLE VOUS ATTEND.
 *
 * Une réponse rendue n'est pas toujours une réponse DÉFINITIVE : l'agent peut
 * avoir posé une question restée sans réponse. La carte n'a alors rien
 * d'abouti — et l'annoncer « À déployer » ferait passer pour fini un travail que
 * personne n'a terminé. Elle reste donc en « En cours », et elle
 * DIT pourquoi.
 */
export const RAISON_ATTEND_VOTRE_REPONSE =
  'La tâche attend votre réponse : elle reste en « Travail » et ne passera en « À déployer » qu’une fois la discussion tranchée.';

export function issueDeFinDeTour(
  colonne: ColumnKey,
  reussi: boolean,
  role: AgentRole,
  trace: TraceDuTravail,
  dejaEnregistre: boolean,
  questionOuverte = false,
): IssueDeFinDeTour {
  const cloture = colonneEnFinDeTour(colonne, reussi, role);
  if (!cloture) return CARTE_INCHANGEE;

  /*
   * UNE RÉPONSE N'EST DÉFINITIVE QUE SI PLUS RIEN N'EST ATTENDU DE VOUS.
   *
   * Le balayage des cartes oubliées s'interdisait déjà de fermer une carte qui
   * porte une décision ouverte (`issueDeCarteOubliee`) ; la FIN DE TOUR, elle,
   * la fermait quand même — deux règles qui disaient le contraire l'une de
   * l'autre sur la même carte. C'est ce qui faisait sauter en « À déployer »
   * une carte dont l'agent venait justement de poser une question.
   *
   * La carte reste donc EN COURS, avec sa phrase. Elle en sortira au tour
   * suivant — celui qui suit la réponse — quand il n'y aura plus rien à
   * trancher ; et si la question est ANNULÉE sans relance, le balayage de
   * l'ordonnanceur la range dans les quinze secondes.
   */
  if (questionOuverte) return { colonne: null, raison: RAISON_ATTEND_VOTRE_REPONSE };

  // Le dépôt a bougé : le travail parle tout seul, aucune phrase à ajouter.
  if (traceAcquise(trace)) return { colonne: cloture, raison: null };

  /*
   * Le code est DÉJÀ sur la branche, livré par un tour antérieur : cette
   * réponse passe devant les deux suivantes, qui diraient toutes les deux
   * qu'il n'y a rien eu.
   */
  if (dejaEnregistre) return { colonne: cloture, raison: RAISON_DEJA_LIVRE };

  /*
   * « J'ai vu changer, mais ailleurs » : l'agent est sorti de sa copie et a
   * écrit dans le dossier partagé du projet. Sa branche est vide, donc rien ne
   * partira au déploiement — mais lui reprocher de n'avoir rien fait est FAUX,
   * et c'est précisément ce que l'utilisateur démentait d'un `git status`. La
   * carte se ferme et dit où chercher le travail.
   */
  if (trace === 'ailleurs') return { colonne: cloture, raison: RAISON_TRAVAIL_HORS_COPIE };

  // « Je n'ai pas pu regarder » n'est pas « rien n'a bougé » : c'est l'absence
  // d'observation, et elle se dit autrement.
  if (trace === 'inconnue') return { colonne: cloture, raison: RAISON_TRACE_INCONNUE };

  return { colonne: cloture, raison: RAISON_RENDU_SANS_CODE };
}
