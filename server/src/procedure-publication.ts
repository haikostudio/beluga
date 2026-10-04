import fs from 'node:fs';
import path from 'node:path';
import {
  adresseDeControleAEcrire,
  Agent,
  CiblePublication,
  DEBUT_PROCESSUS,
  EtatDeProcedure,
  Message,
  QuestionDeProcedure,
  consigneDeConfiguration,
  empreinteDesReglages,
  etapeDeLAgentDeConfiguration,
  issueDuTour,
  lireProcessusRendu,
  processusEnTexte,
  promptInitialisationDeploiement,
  promptInitialisationProduction,
  promptSuiteInitialisation,
  type ProcessusDeProduction,
} from '@beluga/shared';
import * as store from './store.js';
import { CONFIG } from './config.js';
import { brancheDeLEtape } from './deploy.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { agentsActifs, createAgent, sendPrompt } from './runtime.js';
import { attenteDeLAgent } from './attente-question.js';

/**
 * LES AGENTS QUI CONFIGURENT LE DÉPLOIEMENT ET LA MISE EN PRODUCTION
 * (refonte du 22/09/2026 ; le déploiement a le sien depuis le 29/09/2026, et
 * les deux conversations vivent dans la rubrique de leur étape, dans les
 * réglages du projet).
 *
 * Un projet n'a AUCUNE information de production tant qu'on ne l'a pas
 * initialisé. Le bouton « Initialiser la mise en production » lance un AGENT
 * qui étudie le projet, INTERROGE l'utilisateur (ask_user, affiché dans ce
 * tiroir) sur l'instance qui accueille la production, puis rend le PROCESSUS :
 * une suite d'étapes que le bouton « Mise en production » déroulera ensuite
 * telle quelle, sans agent. Le déploiement, lui, n'a plus de procédure.
 *
 * Le dialogue tient dans UN agent, gardé d'un tour à l'autre par son
 * identifiant : la question et la réponse vivent donc dans la même session, et
 * l'agent ne redécouvre pas le projet à chaque message.
 *
 * LE TOUR NE SE LIVRE PLUS PAR LA RÉPONSE DE LA COMMANDE. Lire tout un projet
 * prend une à deux minutes ; faire attendre la requête pendant ce temps rendait
 * la question INRATTRAPABLE — tiroir refermé, page rechargée, serveur
 * redémarré, délai d'attente du navigateur dépassé, et le travail déjà payé
 * partait en fumée sans un mot, l'écran restant sur « L'agent travaille… ». La
 * commande rend donc l'ÉTAT tout de suite, le tour continue en fond, et chaque
 * changement est DIFFUSÉ (`procedure`) : l'écran suit, se rattrape après une
 * coupure, et deux tiroirs ouverts voient la même chose.
 *
 * L'écriture est le seul moment qui touche la base, et elle ne touche QUE la
 * cible demandée : un tiroir ouvert depuis « À déployer » ne peut pas écrire la
 * mise en production, et l'inverse non plus.
 */

/**
 * LES DIALOGUES EN COURS, un par étape de projet.
 *
 * En mémoire seulement : un dialogue est une conversation d'écran, pas une
 * donnée du projet — seule la procédure ÉCRITE est enregistrée. Un redémarrage
 * du serveur les perd donc, et c'est le tiroir qui le DIT (`RAISON_TOUR_PERDU`)
 * au lieu de tourner dans le vide.
 */
const dialogues = new Map<string, EtatDeProcedure>();

const cleDuDialogue = (projectId: string, cible: CiblePublication): string => `${projectId}:${cible}`;

/** Le titre de l'agent de configuration : on doit le reconnaître dans la pile. */
function titreDeLAgent(cible: CiblePublication): string {
  return cible === 'production' ? 'Configuration de la mise en production' : 'Configuration du déploiement';
}

/** Le champ du projet qui porte l'agent et le processus de cette étape. */
function champDeLEtape(cible: CiblePublication): 'deploiement' | 'miseEnProduction' {
  return cible === 'dev' ? 'deploiement' : 'miseEnProduction';
}

/**
 * L'AGENT DE CONFIGURATION DU PROJET — UN SEUL, GARDÉ SUR LE PROJET.
 *
 * Refonte du 24/09/2026. Le bandeau « Mise en production » ouvre un tiroir
 * calqué sur celui d'une tâche, dont l'onglet « Conversation » était le fil de
 * cet agent. La conversation doit se RETROUVER et se POURSUIVRE — tiroir
 * refermé, page rechargée, démon redémarré : son identifiant est donc écrit
 * sur le projet (`miseEnProduction.agentId`), jamais seulement en mémoire.
 * Aucune branche « tache/… » : il travaille dans le dossier du projet.
 */
export function agentDeConfigurationDuProjet(projectId: string, cible: CiblePublication = 'production'): Agent | null {
  const projet = store.getProject(projectId);
  if (!projet) return null;
  const champ = champDeLEtape(cible);
  const idRetenu = projet[champ]?.agentId;
  const retenu = idRetenu ? store.getAgent(idRetenu) : null;
  if (retenu && retenu.projectId === projectId) return retenu;
  const agent = createAgent({ projectId, role: 'deploy', title: titreDeLAgent(cible) });
  const enregistre = store.saveProject({
    ...projet,
    [champ]: { ...(projet[champ] ?? {}), agentId: agent.id },
  });
  bus.emit({ type: 'project.upsert', project: enregistre });
  return agent;
}

/** L'étape que configure cet agent, ou `null` s'il n'est l'agent de configuration d'aucune. */
export function etapeConfigureePar(agent: Pick<Agent, 'id' | 'projectId' | 'role'> | null | undefined): CiblePublication | null {
  if (!agent || agent.role !== 'deploy') return null;
  return etapeDeLAgentDeConfiguration(store.getProject(agent.projectId) ?? undefined, agent.id);
}

/**
 * CE QUI ACCOMPAGNE UN MESSAGE ÉCRIT À L'AGENT DE CONFIGURATION depuis la
 * conversation du tiroir (`agent.prompt`). Son tout premier message emporte
 * l'accueil ENTIER — l'agent n'a encore rien lu du projet ; les suivants, le
 * rappel court de ce qu'il est et de ce qu'il rend. `undefined` pour tout
 * autre agent.
 */
export async function contexteDeConfiguration(agent: Agent): Promise<string | undefined> {
  const cible = etapeConfigureePar(agent);
  if (!cible) return undefined;
  const projet = store.getProject(agent.projectId);
  if (!projet) return undefined;
  if (store.listMessages(agent.id, 1).length > 0) return consigneDeConfiguration(cible);
  return promptDAccueil(projet, cible);
}

/** L'accueil entier de l'agent de configuration : ce qu'il lit à son premier tour. */
async function promptDAccueil(
  projet: NonNullable<ReturnType<typeof store.getProject>>,
  cible: CiblePublication = 'production',
): Promise<string> {
  const [dev, production] = await Promise.all([brancheDeLEtape(projet, 'dev'), brancheDeLEtape(projet, 'production')]);
  if (cible === 'dev') {
    return promptInitialisationDeploiement({
      projet: projet.name,
      dossier: projet.path,
      brancheTravail: dev.branche,
      commande: projet.deploiement?.commande,
      service: projet.deploiement?.service,
      devUrl: projet.devUrl,
      port: projet.port,
      estBeluga: projet.isSelf,
      actuel: processusEnTexte(projet.deploiement?.processus) || undefined,
      automatismes: automatismesDuDepot(projet.path),
    });
  }
  return promptInitialisationProduction({
    projet: projet.name,
    dossier: projet.path,
    brancheTravail: dev.branche,
    brancheProduction: production.branche,
    adresseProduction: projet.adresseProduction,
    ancienneRecette: ancienneRecette(projet.id),
    actuel: processusEnTexte(projet.miseEnProduction?.processus) || undefined,
    automatismes: automatismesDuDepot(projet.path),
  });
}

/**
 * LE PROCESSUS RENDU DANS UN MESSAGE DE L'AGENT DE CONFIGURATION, ENREGISTRÉ.
 *
 * L'agent se parle désormais par la barre d'écriture de la conversation
 * (`agent.prompt`), comme n'importe quel agent — plus seulement par le tour
 * lancé à l'ouverture. Le processus se lit donc sur CHAQUE message achevé de
 * cet agent, d'où qu'il vienne ; un même message ne s'enregistre qu'une fois
 * (`depuisMessage`), et un bloc illisible ne remplace jamais le processus en
 * place.
 */
export function retenirProcessusDuMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.streaming || !message.content.includes(DEBUT_PROCESSUS)) return false;
  const agent = store.getAgent(message.agentId);
  const cible = etapeConfigureePar(agent);
  if (!agent || !cible) return false;
  const projet = store.getProject(agent.projectId);
  if (!projet || projet[champDeLEtape(cible)]?.processus?.depuisMessage === message.id) return false;
  const lu = lireProcessusRendu(message.content);
  if (!lu.processus) return false;
  return enregistrerProcessus(
    agent.projectId,
    {
      ...lu.processus,
      ...(lu.explication ? { explication: lu.explication } : {}),
      depuisMessage: message.id,
    },
    cible,
  );
}

bus.subscribe((event) => {
  if (event.type !== 'message.upsert') return;
  try {
    retenirProcessusDuMessage(event.message);
  } catch {
    // Un message illisible ne casse pas le bus : le processus en place reste.
  }
});

/** Range l'état et le DIFFUSE : l'écran ne devine jamais, il est prévenu. */
function poser(etat: EtatDeProcedure): EtatDeProcedure {
  dialogues.set(cleDuDialogue(etat.projectId, etat.cible), etat);
  bus.emit({ type: 'procedure', etat });
  return etat;
}

/**
 * LA QUESTION QUE L'AGENT A POSÉE AVEC SON OUTIL, relue dans ses messages.
 *
 * `ask_user` arrête le tour jusqu'à la réponse : la question s'affichait donc
 * dans la cloche du bandeau, avec toutes les autres décisions attendues, et
 * nulle part dans le tiroir ouvert juste dessous — qui restait sur « L'agent
 * travaille… ». On va la chercher là où elle est rangée, sur le message de
 * l'agent, et on la porte dans l'état du dialogue.
 */
function questionDuMessage(message: Message): QuestionDeProcedure | undefined {
  const ouverte = [...message.questions].reverse().find((q) => !q.answer && !q.cancelled);
  if (!ouverte) return undefined;
  return {
    messageId: message.id,
    questionId: ouverte.id,
    texte: ouverte.question,
    options: ouverte.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
    })),
  };
}

/** La question ouverte de cet agent, s'il en a une : le dernier message gagne. */
function questionDeLAgent(agentId: string | undefined): QuestionDeProcedure | undefined {
  if (!agentId) return undefined;
  const messages = store.listMessages(agentId, 30);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const question = questionDuMessage(messages[i]);
    if (question) return question;
  }
  return undefined;
}

/**
 * Le dialogue de cette étape, quand il y en a un. Aucun tour n'est lancé ici.
 *
 * La question ouverte est RELUE à chaque lecture : un tiroir rouvert après une
 * coupure la retrouve, même si l'événement qui l'annonçait est passé pendant
 * que personne n'écoutait.
 */
export function etatDeProcedure(projectId: string, cible: CiblePublication): EtatDeProcedure | null {
  const etat = dialogues.get(cleDuDialogue(projectId, cible));
  if (!etat) return null;
  return { ...etat, question: questionDeLAgent(etat.agentId), attendDepuis: attenteDeLAgentDuDialogue(etat) };
}

/**
 * DEPUIS QUAND L'AGENT DE CE DIALOGUE ATTEND-IL ? Lu dans le registre commun à
 * TOUS les agents, jamais deviné ici : c'est ce qui fait que le tiroir arrête
 * son témoin exactement comme la conversation d'une carte arrête le sien.
 */
function attenteDeLAgentDuDialogue(etat: EtatDeProcedure): number | undefined {
  return etat.agentId ? attenteDeLAgent(etat.agentId) : undefined;
}

/**
 * L'AGENT POSE SA QUESTION, LE TIROIR L'APPREND TOUT DE SUITE.
 *
 * On écoute les messages qui bougent : dès que celui d'un agent de dialogue
 * porte une question sans réponse — ou qu'elle vient d'être tranchée —, l'état
 * est reposé et diffusé. Sans cela, le tiroir ne l'aurait vue qu'au prochain
 * sondage, ou jamais.
 */
bus.subscribe((event) => {
  if (event.type !== 'message.upsert') return;
  for (const etat of dialogues.values()) {
    if (etat.agentId !== event.message.agentId) continue;
    const question = questionDeLAgent(etat.agentId);
    if ((question?.questionId ?? null) === (etat.question?.questionId ?? null)) return;
    /*
     * Une question TRANCHÉE laisse sa trace dans le fil du tiroir : sans cela,
     * la question et la réponse disparaissaient de l'écran d'un coup, et l'on
     * ne savait plus ce qu'on avait répondu à l'agent qui travaille encore.
     */
    const tranchee = etat.question
      ? event.message.questions.find((q) => q.id === etat.question?.questionId)
      : undefined;
    const echanges =
      tranchee?.answer
        ? [
            ...etat.echanges,
            { qui: 'agent' as const, texte: etat.question!.texte },
            { qui: 'moi' as const, texte: tranchee.answer },
          ]
        : etat.echanges;
    poser({ ...etat, echanges, question, attendDepuis: attenteDeLAgentDuDialogue(etat) });
    return;
  }
});

/**
 * Enregistre le processus d'une étape du projet, et le diffuse. L'EMPREINTE
 * des réglages qui le décident est prise au même instant : un réglage changé
 * ensuite fait dire « à revérifier » à la rubrique (`reglagesChangesDepuisLeProcessus`).
 */
export function enregistrerProcessus(
  projectId: string,
  processus: ProcessusDeProduction,
  cible: CiblePublication = 'production',
): boolean {
  const projet = store.getProject(projectId);
  if (!projet) return false;
  const champ = champDeLEtape(cible);
  /*
   * L'ADRESSE DE CONTRÔLE DÉCLARÉE PAR L'AGENT (30/09/2026) rejoint le réglage
   * du projet quand il est VIDE — jamais par-dessus une adresse en place : un
   * écart se dit dans la réponse de l'agent (sa consigne le lui demande) et se
   * note au journal. Elle est écrite AVANT de prendre l'empreinte : sinon le
   * processus s'afficherait « à revérifier » à peine écrit.
   */
  const decision = adresseDeControleAEcrire(projet, cible, processus.adresse);
  const avecAdresse =
    decision?.action === 'ecrire'
      ? {
          ...projet,
          [decision.champ]: decision.adresse,
          ...(decision.champ === 'adresseProduction' ? { adresseProductionRattrapee: undefined } : {}),
        }
      : projet;
  if (decision?.action === 'ecart') {
    log.info(
      `adresse déclarée par l'agent de configuration de « ${projet.name} » (${decision.adresse}) différente du réglage en place (${decision.enPlace}) : réglage gardé`,
    );
  }
  const enregistre = store.saveProject({
    ...avecAdresse,
    /* L'agent de configuration RESTE retenu : sa conversation se poursuit. */
    [champ]: {
      ...(projet[champ] ?? {}),
      processus: { ...processus, ecritLe: store.now(), empreinte: empreinteDesReglages(avecAdresse, cible) },
    },
  });
  bus.emit({ type: 'project.upsert', project: enregistre });
  /* Une adresse publique écrite par l'agent ouvre son suivi, comme une saisie. */
  if (decision?.action === 'ecrire' && decision.champ === 'adresseProduction') {
    void import('./suivi-par-defaut.js')
      .then(({ assurerLeSuiviDuProjet }) => assurerLeSuiviDuProjet(projectId))
      .catch((err) => log.warn('suivi par défaut : relecture du projet impossible', err));
  }
  return true;
}

/**
 * L'ANCIENNE RECETTE de mise en production, archivée lors de la refonte
 * (`data/archives/publication-*.json`) : l'agent la relit, et la fait confirmer.
 */
function ancienneRecette(projectId: string): string | undefined {
  try {
    const dossier = path.join(CONFIG.dataDir, 'archives');
    const fichiers = fs.readdirSync(dossier).filter((f) => /^publication-.*\.json$/.test(f)).sort();
    for (const fichier of fichiers.reverse()) {
      const lignes = JSON.parse(fs.readFileSync(path.join(dossier, fichier), 'utf8')) as Array<{ id: string; miseEnProduction?: unknown }>;
      const ligne = lignes.find((l) => l.id === projectId);
      if (!ligne) continue;
      const brut = typeof ligne.miseEnProduction === 'string' ? JSON.parse(ligne.miseEnProduction) : ligne.miseEnProduction;
      const prompt = (brut as { prompt?: string } | null)?.prompt?.trim();
      if (prompt) return prompt.slice(0, 8000);
    }
  } catch {
    // Pas d'archive lisible : l'agent part du projet seul.
  }
  return undefined;
}

/** Les automatismes GitHub du dépôt, par leur nom de fichier. */
function automatismesDuDepot(dossier: string): string[] {
  try {
    return fs.readdirSync(path.join(dossier, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    return [];
  }
}

/**
 * UN TOUR du tiroir, LANCÉ puis rendu tout de suite. Sans `message` :
 * l'ouverture, l'agent étudie puis interroge. Avec `message` : ce que
 * l'utilisateur ajoute, envoyé au même agent. Un tour DÉJÀ en vol n'est
 * jamais doublé.
 */
export function tourDeProcedure(input: {
  projectId: string;
  cible: CiblePublication;
  agentId?: string;
  message?: string;
  base?: string;
}): EtatDeProcedure {
  const vide: EtatDeProcedure = { projectId: input.projectId, cible: input.cible, enCours: false, echanges: [] };
  const projet = store.getProject(input.projectId);
  if (!projet) return { ...vide, raison: 'Projet introuvable.' };

  const courant = etatDeProcedure(input.projectId, input.cible);
  if (courant?.enCours) return courant;

  const reponse = (input.message ?? '').trim();
  /*
   * TOUJOURS LE MÊME AGENT : celui retenu sur le projet. La conversation se
   * poursuit donc d'une ouverture à l'autre, au lieu de repartir d'un agent
   * neuf qui relirait tout le projet.
   */
  const agent = agentDeConfigurationDuProjet(input.projectId, input.cible);
  if (!agent) return { ...vide, raison: 'Projet introuvable.' };
  if (agentsActifs().includes(agent.id)) {
    /* Déjà au travail (un message écrit dans la conversation) : on ne double
       rien, et on n'écrit aucun état qu'aucun tour ne viendrait refermer. */
    return courant?.enCours ? courant : { ...vide, agentId: agent.id };
  }
  const dialogueEnCours = store.listMessages(agent.id, 1).length > 0;
  /* Un agent qui a déjà parlé ne se relance JAMAIS sans un message à lui dire :
     rien ne se rejoue à l'aveugle. */
  if (dialogueEnCours && !reponse) return courant ?? { ...vide, agentId: agent.id };

  const echanges = reponse ? [...(courant?.echanges ?? []), { qui: 'moi' as const, texte: reponse }] : [];
  const etat = poser({
    projectId: input.projectId,
    cible: input.cible,
    agentId: agent.id,
    enCours: true,
    echanges,
    depuis: store.now(),
  });

  void (async () => {
    let prompt: string;
    if (dialogueEnCours) {
      prompt = promptSuiteInitialisation(reponse, input.cible);
    } else {
      prompt = await promptDAccueil(projet, input.cible);
      if (reponse) prompt += `\n\nCe que l’utilisateur demande d’emblée : ${reponse}`;
    }
    await mener(etat, prompt);
  })().catch((err) => {
    const courantEtat = dialogues.get(cleDuDialogue(input.projectId, input.cible)) ?? etat;
    poser({ ...courantEtat, enCours: false, raison: `Le tour n’a pas pu partir : ${err?.message ?? err}` });
  });
  return etat;
}

/** LE TOUR, en fond : il DIFFUSE son issue — la question, le processus, ou la raison de l'échec. */
async function mener(depart: EtatDeProcedure, prompt: string): Promise<void> {
  const agentId = depart.agentId as string;
  let erreur: string | undefined;
  try {
    await sendPrompt(agentId, prompt, { template: 'none', silent: true });
  } catch (err: any) {
    erreur = err?.message ?? 'raison inconnue';
  }
  const messages = store.listMessages(agentId, 50).filter((m) => m.role === 'assistant');
  const dernier = messages[messages.length - 1];
  const agent = store.getAgent(agentId);
  const issue = issueDuTour({ contenu: dernier?.content, statut: agent?.status, erreur: erreur ?? dernier?.error });
  const courant = dialogues.get(cleDuDialogue(depart.projectId, depart.cible)) ?? depart;
  const fini = { ...courant, enCours: false, question: undefined, attendDepuis: undefined };

  if ('processus' in issue) {
    /* Déjà enregistré au passage du message (`retenirProcessusDuMessage`) :
       on ne le réécrit que s'il ne l'a pas été. */
    const deja = store.getProject(depart.projectId)?.[champDeLEtape(depart.cible)]?.processus?.depuisMessage === dernier?.id;
    if (!deja && !enregistrerProcessus(depart.projectId, { ...issue.processus, depuisMessage: dernier?.id }, depart.cible)) {
      poser({ ...fini, raison: 'Projet introuvable : le processus n’a pas pu être enregistré.' });
      return;
    }
    poser({
      ...fini,
      procedure: processusEnTexte(issue.processus),
      echanges: [
        ...fini.echanges,
        {
          qui: 'agent',
          texte:
            issue.resume ||
            (depart.cible === 'dev'
              ? 'Le processus de déploiement est écrit et enregistré.'
              : 'Le processus de mise en production est écrit et enregistré.'),
        },
      ],
    });
    return;
  }
  if ('question' in issue) {
    poser({ ...fini, echanges: [...fini.echanges, { qui: 'agent', texte: issue.question }] });
    return;
  }
  poser({ ...fini, raison: issue.raison });
}
