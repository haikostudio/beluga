import {
  Agent,
  AgentQuestion,
  CLE_PROJET_ACTIF,
  Message,
  TITRE_CARTE_DE_CADRAGE,
  extrait,
  lieuDeLaQuestion,
  reponseEncoreAttendue,
  routerLaDemande,
  suiteDuRoutage,
  type ProjetJoignable,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { ouvrirLeCadrage } from './cadrage.js';
import { createCard } from './tools.js';
import { sendPrompt } from './runtime.js';
import { notify } from './notify.js';
import { log } from './logger.js';

/**
 * L'ASSISTANT VOCAL GLOBAL : où va cette phrase ?
 *
 * Une phrase dictée n'a aucun destinataire tant que personne n'a dit « ça,
<<<<<<< HEAD
 * c'est pour tel projet ». Ce module est ce quelqu'un — hors projet, au-dessus
 * du tableau.
 *
 * Il n'appelle AUCUN moteur pour router : il lit la liste des projets ouverts,
 * applique la règle pure (`shared/src/routage-vocal.ts`), et fait l'une de deux
 * choses.
 *
 *  - Projet clair : il OUVRE UNE CARTE dans « Planifié », lui donne son agent
 *    de CADRAGE et y écrit la phrase telle qu'elle a été entendue. C'est le
 *    chemin du « + » de la colonne, à la voix : la carte ne quitte pas
 *    « Planifié » tant que « Lancer la tâche » n'a pas été cliqué.
 *  - Doute : il POSE LA QUESTION, dans la carte de cadrage ouverte pour elle.
 *    Une vraie question d'agent, donc le triangle orange habituel, l'annonce
 *    vocale « une décision attend » et une réponse qui se donne à l'écran… ou à
 *    la voix, la phrase suivante étant lue comme la réponse tant que la
 *    question est fraîche.
=======
 * c'est pour HaikoDev ». Ce module est ce quelqu'un — hors projet, au-dessus
 * du tableau.
 *
 * Il ne code pas et n'appelle AUCUN moteur payant : il lit la liste des
 * projets ouverts, applique la règle pure (`shared/src/routage-vocal.ts`), et
 * fait l'une de deux choses.
 *
 *  - Projet clair : il ouvre une carte-fil de cadrage dans ce projet (la même
 *    que le « + » de « Planifié ») et y dépose la phrase. Le fil montre la
 *    phrase telle qu'elle a été comprise, et l'agent de cadrage fait son tri
 *    habituel.
 *  - Doute : il POSE LA QUESTION, dans une carte-fil de cadrage éphémère de ce
 *    projet — une vraie question d'agent, donc le triangle orange habituel,
 *    l'annonce vocale « une décision attend » et une réponse qui se donne à
 *    l'écran… ou à la voix, la phrase suivante étant lue comme la réponse tant
 *    que la question est fraîche. Cette carte de question, qui ne sert à
 *    rien d'autre, est retirée une fois la réponse reçue.
>>>>>>> main
 */

export interface ResultatDictee {
  /**
   * Où la demande a été DÉPOSÉE. Absent quand une question a été posée : le
   * projet qui porte la question n'est pas un destinataire, c'est un endroit.
   */
  projectId?: string;
  /** La conversation qui a reçu la demande, ou qui porte la question. */
  agentId?: string;
  /** Le projet où la question s'affiche, quand une question a été posée. */
  lieu?: string;
  /** La question posée, quand un doute demeurait. */
  question?: string;
  /** Ce qui s'est passé, en un mot : sert aux contrôles et au journal. */
  motif: string;
}

function projetsOuverts(): ProjetJoignable[] {
  return store.listProjects().map((projet) => ({ id: projet.id, name: projet.name }));
}

function projetActif(): string | null {
  const valeur = store.readPreferences()[CLE_PROJET_ACTIF];
  return typeof valeur === 'string' ? valeur : null;
}

/**
 * Ouvrir une carte-fil de cadrage dans un projet, exactement comme le « + »
 * de « Planifié ». La création émet elle-même l'événement `card.upsert` et
 * `agent.upsert` : le tableau et la conversation apparaissent sous les yeux.
 * Un titre optionnel peut être fourni (pour refléter le texte dictée) ; par
 * défaut, c'est le titre de cadrage.
 */
async function ouvrirUneCarteDeCadrage(projectId: string, titre?: string) {
  const card = createCard(projectId, { title: titre ?? TITRE_CARTE_DE_CADRAGE, origin: 'user' });
  bus.emit({ type: 'card.upsert', card });
  const agent = await ouvrirLeCadrage(card.id);
  if (!agent) throw new Error('agent de cadrage introuvable pour la carte dictée');
  return { card, agent };
}

/**
 * Déposer la phrase dans une carte-fil de cadrage neuve, et lancer le tour.
 * La phrase part TELLE QUELLE : ce que le fil montre est ce qui a été entendu.
 */
async function deposer(projectId: string, texte: string): Promise<{ agentId: string }> {
  const { agent } = await ouvrirUneCarteDeCadrage(projectId, extrait(texte, 80));
  void sendPrompt(agent.id, texte).catch((err) => log.error('dépôt de la demande dictée impossible', err));
  return { agentId: agent.id };
}

/** Poser la question du doute, là où elle se prendra. */
async function demander(
  texte: string,
  question: string,
  candidats: ProjetJoignable[],
  projetRetenu: string | undefined,
  lieu: string,
  motif: string,
): Promise<ResultatDictee> {
  const { agent } = await ouvrirUneCarteDeCadrage(lieu);

  const posee = AgentQuestion.parse({
    id: store.newId(),
    question,
    kind: candidats.length ? 'single' : 'text',
    options: candidats.map((projet) => ({ id: projet.id, label: projet.name })),
    allowFreeText: true,
  });

  const message = store.saveMessage(
    Message.parse({
      id: store.newId(),
      agentId: agent.id,
      role: 'assistant',
      content: `J'ai entendu : « ${extrait(texte, 300)} ».`,
      questions: [posee],
      createdAt: store.now(),
    }),
  );
  bus.emit({ type: 'message.upsert', message });

  store.saveDictee({
    texte,
    projectId: projetRetenu,
    candidats,
    agentId: agent.id,
    messageId: message.id,
    questionId: posee.id,
  });

  // Le MÊME signal que pour toute question d'agent : triangle orange sur la
  // conversation, compte d'attention qui monte, donc annonce vocale.
  bus.emit({ type: 'attention', ...store.signalAttention() });
  notify({
    motif: 'decision-attendue',
    title: 'Une réponse est attendue',
    body: question.slice(0, 120),
    reference: `dictee:${message.id}`,
    element: question.slice(0, 120),
    projectId: agent.projectId,
    agentId: agent.id,
  });

  return { agentId: agent.id, lieu: agent.projectId, question, motif };
}

/**
 * Le point d'entrée : une phrase vient d'être dictée, où va-t-elle ?
 *
 * Une question de routage encore fraîche l'emporte sur tout le reste : la
 * phrase qui suit une question EST la réponse. Sinon on route.
 */
export async function deposerDemandeDictee(texteBrut: string): Promise<ResultatDictee> {
  const texte = texteBrut.trim();
  if (!texte) return { motif: 'phrase-vide' };

  // Une question posée il y a moins de dix minutes attend sa réponse : c'est
  // elle qu'on sert, sinon on reposerait éternellement la même question.
  const attente = store.derniereDicteeEnAttente();
  if (attente && reponseEncoreAttendue(attente.poseeA, store.now())) {
    return repondreALaDictee(attente.questionId, texte, true);
  }

  const projets = projetsOuverts();
  const routage = routerLaDemande(texte, projets);

  if (routage.motif === 'aucun-projet') {
    bus.toast('warning', "Aucun projet ouvert : la demande dictée n'a nulle part où aller.");
    return { motif: 'aucun-projet' };
  }

  if (routage.projectId) {
    const { agentId } = await deposer(routage.projectId, texte);
    if (!agentId) return { motif: 'aucun-projet' };
    return { projectId: routage.projectId, agentId, motif: routage.motif };
  }

  const lieu = lieuDeLaQuestion(routage, projets, projetActif());
  if (!lieu) return { motif: 'aucun-projet' };
  return demander(
    texte,
    routage.question ?? 'Pour quel projet est cette demande ?',
    routage.candidats,
    routage.projetRetenu,
    lieu,
    routage.motif,
  );
}

/**
 * La réponse est arrivée — cochée à l'écran, ou dictée à la suite.
 *
 * @param parLaVoix  Vrai quand la réponse vient d'une seconde dictée : il faut
 *                   alors l'écrire nous-mêmes dans la question, sinon le
 *                   triangle orange resterait allumé pour toujours.
 */
export async function repondreALaDictee(
  questionId: string,
  reponse: string,
  parLaVoix = false,
): Promise<ResultatDictee> {
  const attente = store.dicteeDeLaQuestion(questionId);
  if (!attente || attente.regleeA) return { motif: 'sans-objet' };

  if (parLaVoix) inscrireLaReponse(attente.messageId, questionId, reponse);
  store.marquerDicteeReglee(attente.id);

  const projets = projetsOuverts();
  const suite = suiteDuRoutage(attente, reponse, projets);

  if (!suite.projectId || !suite.texte) {
    // On ne devine pas davantage : on le DIT, dans la conversation où la
    // question a été posée, et la dictée s'arrête là.
    const message = store.saveMessage(
      Message.parse({
        id: store.newId(),
        agentId: attente.agentId,
        role: 'assistant',
        content: `${suite.raison ?? "Réponse incomprise."} Redites la demande en nommant le projet.`,
        createdAt: store.now(),
      }),
    );
    bus.emit({ type: 'message.upsert', message });
    bus.emit({ type: 'attention', ...store.signalAttention() });
    return { agentId: attente.agentId, motif: 'reponse-incomprise' };
  }

  const { agentId } = await deposer(suite.projectId, suite.texte);
  supprimerLaCarteDeLaQuestion(attente.agentId);
  bus.emit({ type: 'attention', ...store.signalAttention() });
  if (!agentId) return { motif: 'aucun-projet' };
  return { projectId: suite.projectId, agentId, motif: attente.projectId ? 'action-donnee' : 'projet-donne' };
}

/**
 * La carte de cadrage ouverte pour poser « pour quel projet ? » ne sert à
 * rien d'autre : une fois la réponse comprise et la vraie demande déposée
 * ailleurs, elle ne fait que traîner dans « Planifié ».
 */
function supprimerLaCarteDeLaQuestion(agentId: string): void {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId) return;
  store.deleteCard(agent.cardId);
  bus.emit({ type: 'card.delete', id: agent.cardId, projectId: agent.projectId });
}

/** Écrire la réponse DANS la question : c'est ce qui éteint le triangle. */
function inscrireLaReponse(messageId: string, questionId: string, reponse: string): void {
  const message = store.getMessage(messageId);
  if (!message) return;
  const modifie = store.saveMessage({
    ...message,
    questions: message.questions.map((question) =>
      question.id === questionId && !question.answer
        ? { ...question, answer: reponse, answeredAt: store.now() }
        : question,
    ),
  });
  bus.emit({ type: 'message.upsert', message: modifie });
}
