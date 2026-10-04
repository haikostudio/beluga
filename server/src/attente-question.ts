/**
 * Le registre des questions qui BLOQUENT un tour.
 *
 * Quand un agent appelle `ask_user`, le démon note ici que ce tour attend une
 * réponse, et le pont d'outils redemande « alors ? » toutes les vingt secondes
 * jusqu'à ce qu'une issue soit posée. Tant qu'aucune ne l'est, l'appel d'outil
 * du moteur n'a pas répondu : le moteur est arrêté sur place, il ne fait pas
 * les étapes suivantes de sa liste.
 *
 * Les règles et les textes vivent dans `shared/src/attente-question.ts` ; ici
 * il n'y a que le va-et-vient : poser, réveiller, libérer.
 */
import {
  ATTENTE_EN_COURS,
  IssueDAttente,
  PLAFOND_ATTENTE_MS,
  TRANCHE_ATTENTE_MS,
  attenteExpiree,
  texteDAnnulation,
  texteDeQuestionSimultanee,
  texteDExpiration,
  texteDePerte,
  texteDeReponseALaQuestion,
} from '@beluga/shared';
import path from 'node:path';
import { aliasDe } from '@beluga/shared';
import { cheminDePieceJointe } from './pieces-jointes.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { PATHS } from './config.js';

interface Attente {
  agentId: string;
  poseeA: number;
  /** L'issue une fois posée : la tranche suivante la rend et l'attente se ferme. */
  issue: IssueDAttente | null;
  /** Les tranches en cours de sommeil, réveillées d'un coup dès qu'une issue tombe. */
  reveils: Set<() => void>;
  /**
   * LA SUITE D'UNE DEMANDE D'ACCORD (assistant global, `assistant-global.ts`) :
   * ce qu'on exécute une fois la réponse donnée. Le texte qu'elle rend REMPLACE
   * la réponse brute dans ce que reçoit le moteur — c'est le résultat du geste
   * autorisé, ou son refus. Absente pour une question ordinaire.
   */
  suite?: (reponse: string) => Promise<string>;
  /** La réponse telle que cliquée, avant d'être mise en phrase pour le moteur. */
  reponseBrute?: string;
  /** La suite en cours : deux tranches simultanées n'exécutent jamais deux fois le geste. */
  suiteEnCours?: Promise<IssueDAttente>;
}

const attentes = new Map<string, Attente>();

/**
 * DEPUIS QUAND CET AGENT EST-IL ARRÊTÉ SUR UNE QUESTION ? Absent : il n'attend
 * rien.
 *
 * Le registre est le MÊME pour tous les agents — celui d'une carte, le chef
 * d'orchestre, celui d'un tiroir : tout appel de `ask_user` passe par
 * `/internal/call`, donc par `poserLAttente`. Rendre l'INSTANT plutôt qu'un
 * simple oui/non permet à n'importe quel témoin de travail de figer son
 * chronomètre au bon endroit (`instantDuTemoin`, `shared/src/attente-question.ts`),
 * au lieu de faire défiler le temps de réponse comme du temps de travail.
 *
 * Une attente dont l'issue est déjà posée ne compte plus : la réponse est
 * donnée, l'agent est reparti, même si la tranche qui la portera au moteur ne
 * l'a pas encore consommée.
 */
export function attenteDeLAgent(agentId: string): number | undefined {
  let depuis: number | undefined;
  for (const attente of attentes.values()) {
    if (attente.agentId !== agentId || attente.issue) continue;
    if (depuis === undefined || attente.poseeA < depuis) depuis = attente.poseeA;
  }
  return depuis;
}

/** L'agent attend-il une réponse ? Sert au repère de la barre d'écriture. */
export function agentEnAttente(agentId: string): boolean {
  return attenteDeLAgent(agentId) !== undefined;
}

/** Les outils dont le résultat est une QUESTION posée à l'utilisateur. */
const OUTILS_QUI_QUESTIONNENT = new Set(['ask_user', 'suggerer_modele']);

/**
 * UNE SEULE QUESTION À LA FOIS, PAR AGENT. Rend le texte de refus quand l'outil
 * appelé pose une question alors qu'une autre de CE MÊME agent attend encore sa
 * réponse ; rien sinon. Les autres agents ne sont jamais concernés : le registre
 * se lit par agent. Un refus ne pose aucune attente et n'attache aucune bulle.
 */
export function refusDeQuestionSimultanee(agentId: string, outil: string): string | undefined {
  if (!OUTILS_QUI_QUESTIONNENT.has(outil)) return undefined;
  return agentEnAttente(agentId) ? texteDeQuestionSimultanee() : undefined;
}

/**
 * LA QUESTION SUR LAQUELLE CET AGENT EST ARRÊTÉ. La plus ancienne encore
 * ouverte, quand il y en a plusieurs — c'est celle qui bloque son appel
 * d'outil. Sert à la barre d'écriture : un message écrit pendant qu'une
 * question attend est la RÉPONSE à cette question
 * (`texteRepondALaQuestion`, `shared/src/attente-question.ts`).
 */
export function questionEnAttenteDeLAgent(agentId: string): string | undefined {
  let choisie: { id: string; poseeA: number } | undefined;
  for (const [questionId, attente] of attentes) {
    if (attente.agentId !== agentId || attente.issue) continue;
    if (!choisie || attente.poseeA < choisie.poseeA) choisie = { id: questionId, poseeA: attente.poseeA };
  }
  return choisie?.id;
}

/**
 * Le tour de cet agent attend désormais la réponse à cette question. Le drapeau
 * est aussi posé SUR L'AGENT, pour que l'interface dise « l'agent attend votre
 * réponse » au lieu de « l'agent travaille ».
 */
export function poserLAttente(
  questionId: string,
  agentId: string,
  maintenant = Date.now(),
  suite?: (reponse: string) => Promise<string>,
): void {
  attentes.set(questionId, { agentId, poseeA: maintenant, issue: null, reveils: new Set(), suite });
  marquerLAgent(agentId, true);
}

/**
 * L'utilisateur a répondu. Rend faux si plus aucun tour n'attendait cette
 * question — à l'appelant, alors, de relancer l'agent comme avant.
 *
 * Les pièces jointes sont désignées par leur identifiant, comme partout
 * ailleurs : on les traduit ici en CHEMINS de fichiers, seule forme qu'un
 * moteur en ligne de commande sache ouvrir.
 */
export function repondreALAttente(questionId: string, reponse: string, jointes: string[] = []): boolean {
  const fichiers = jointes
    .map((id) => store.getAttachment(id))
    .filter(Boolean)
    .map((piece) => `#${aliasDe(piece!)} — ${cheminDePieceJointe(piece!)}`);
  const attente = attentes.get(questionId);
  if (attente && !attente.issue) attente.reponseBrute = reponse;
  return poserLIssue(questionId, { etat: 'repondu', text: texteDeReponseALaQuestion(reponse, fichiers) });
}

/** La question a été retirée sans réponse. Un texte personnalisé peut être fourni. */
export function annulerLAttente(questionId: string, texte?: string): boolean {
  return poserLIssue(questionId, { etat: 'annulee', text: texte ?? texteDAnnulation() });
}

/**
 * Le tour de cet agent se referme (fin normale, arrêt à la main, panne) : plus
 * personne n'attend. Sans ce ménage, une attente restait ouverte pour toujours
 * et le pont d'un moteur déjà mort continuait de sonder.
 */
export function libererLesAttentes(agentId: string): void {
  for (const [questionId, attente] of attentes) {
    if (attente.agentId !== agentId) continue;
    poserLIssue(questionId, { etat: 'perdue', text: texteDePerte() });
  }
  marquerLAgent(agentId, false);
}

/** Toutes les attentes tombent : le serveur redémarre, aucun moteur ne survit. */
export function oublierToutesLesAttentes(): void {
  for (const attente of attentes.values()) marquerLAgent(attente.agentId, false);
  attentes.clear();
}

/**
 * UNE TRANCHE D'ATTENTE, telle que le pont d'outils la demande. Rend tout de
 * suite l'issue si elle est là, sinon dort au plus une tranche puis rend
 * « attente » — au pont de redemander.
 */
export async function attendreUneTranche(
  questionId: string,
  trancheMs: number = TRANCHE_ATTENTE_MS,
): Promise<IssueDAttente> {
  const attente = attentes.get(questionId);
  // Question inconnue : le tour a déjà été refermé, ou le serveur a redémarré.
  if (!attente) return { etat: 'perdue', text: texteDePerte() };
  if (attente.issue) return rendreLIssue(questionId, attente, attente.issue);

  if (attenteExpiree(attente.poseeA, Date.now(), PLAFOND_ATTENTE_MS)) {
    return fermer(questionId, { etat: 'expiree', text: texteDExpiration(PLAFOND_ATTENTE_MS) });
  }

  await new Promise<void>((resolve) => {
    let fini = false;
    const finir = () => {
      if (fini) return;
      fini = true;
      attente.reveils.delete(finir);
      clearTimeout(minuterie);
      resolve();
    };
    // La minuterie retient volontairement la boucle d'événements : une tranche
    // en sommeil, c'est un moteur qui attend vraiment une réponse. La lâcher
    // (`unref`) laissait le processus se croire libre et abandonner l'attente.
    const minuterie = setTimeout(finir, trancheMs);
    attente.reveils.add(finir);
  });

  const frais = attentes.get(questionId);
  if (!frais) return { etat: 'perdue', text: texteDePerte() };
  if (frais.issue) return rendreLIssue(questionId, frais, frais.issue);
  if (attenteExpiree(frais.poseeA, Date.now(), PLAFOND_ATTENTE_MS)) {
    return fermer(questionId, { etat: 'expiree', text: texteDExpiration(PLAFOND_ATTENTE_MS) });
  }
  return ATTENTE_EN_COURS;
}

/* ------------------------------------------------------------------ */
/* Rouages internes                                                     */
/* ------------------------------------------------------------------ */

function poserLIssue(questionId: string, issue: IssueDAttente): boolean {
  const attente = attentes.get(questionId);
  if (!attente || attente.issue) return false;
  attente.issue = issue;
  for (const reveil of [...attente.reveils]) reveil();
  return true;
}

/**
 * L'ISSUE PART AU MOTEUR — après la SUITE, quand il y en a une. Une demande
 * d'accord exécute le geste sur « Autoriser » et rend son résultat ; toute
 * autre issue (refus, annulation, expiration) le dit non exécuté.
 */
function rendreLIssue(questionId: string, attente: Attente, issue: IssueDAttente): IssueDAttente | Promise<IssueDAttente> {
  if (!attente.suite) return fermer(questionId, issue);
  if (!attente.suiteEnCours) {
    const suite = attente.suite;
    attente.suiteEnCours = (async () => {
      if (issue.etat !== 'repondu') {
        return fermer(questionId, { ...issue, text: `${issue.text}\nLe geste N'A PAS été exécuté.` });
      }
      let texte: string;
      try {
        texte = await suite(attente.reponseBrute ?? '');
      } catch (err: any) {
        texte = `Le geste autorisé a échoué : ${err?.message ?? String(err)}`;
      }
      return fermer(questionId, { ...issue, text: texte });
    })();
  }
  return attente.suiteEnCours;
}

/** L'attente est consommée : elle sort du registre et l'agent cesse d'attendre. */
function fermer(questionId: string, issue: IssueDAttente): IssueDAttente {
  const attente = attentes.get(questionId);
  attentes.delete(questionId);
  if (attente && !agentEnAttente(attente.agentId)) marquerLAgent(attente.agentId, false);
  return issue;
}

/**
 * Le drapeau porté par l'agent lui-même — c'est lui qui voyage jusqu'à
 * l'interface. Posé et retiré ici seulement, jamais deviné ailleurs.
 */
function marquerLAgent(agentId: string, attend: boolean): void {
  const agent = store.getAgent(agentId);
  if (!agent) return;
  if (Boolean(agent.attendReponse) === attend) return;
  const frais = store.saveAgent({ ...agent, attendReponse: attend ? true : undefined });
  bus.emit({ type: 'agent.upsert', agent: frais });
  /*
   * UNE QUESTION POSÉE EST UN RENDU : elle attend quelqu'un, exactement comme
   * une compréhension ou un rapport. On écrit l'instant sur la carte, ce qui
   * allume la pastille bleue (`carteNonLue`) — et le compteur du projet — tant
   * que la carte n'a pas été ouverte depuis. La réponse ne l'éteint pas : c'est
   * la consultation qui le fait, comme pour tout rendu.
   */
  if (attend && frais.cardId) {
    try {
      const carte = store.marquerRendu(frais);
      if (carte) bus.emit({ type: 'card.upsert', card: carte });
    } catch {
      /* la pastille est un confort : une carte illisible n'empêche pas la question */
    }
  }
}
