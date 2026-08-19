import {
  CiblePublication,
  EtatDeProcedure,
  Message,
  PROCEDURE_MAX,
  QuestionDeProcedure,
  issueDuTour,
  procedureDeLEtape,
  promptAnalyseProcedure,
  promptModificationProcedure,
  promptReponseProcedure,
  titreDeLaProcedure,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { agentsActifs, createAgent, sendPrompt } from './runtime.js';

/**
 * LE TIROIR QUI DÉFINIT UNE PROCÉDURE DE MISE EN LIGNE.
 *
 * Un projet neuf n'a plus de procédure toute faite : la tête de la colonne
 * propose de l'INITIER, et c'est un AGENT qui la définit — il lit le projet,
 * TRANCHE lui-même les choix techniques, explique en français simple ce qu'il a
 * constaté et décidé, puis écrit la procédure. L'utilisateur n'a rien à
 * arbitrer : il lit, et il écrit ce qu'il veut changer.
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

/** Le titre de l'agent du tiroir : on doit le reconnaître dans la pile. */
function titreDeLAgent(cible: CiblePublication): string {
  return `Procédure — ${titreDeLaProcedure(cible)}`;
}

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
  const question = questionDeLAgent(etat.agentId);
  return question ? { ...etat, question } : { ...etat, question: undefined };
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
    poser({ ...etat, echanges, question });
    return;
  }
});

/**
 * Enregistre la procédure sur la CIBLE demandée, et sur elle seule.
 *
 * Le déploiement a sa clé (`deploiement`), la mise en production garde la
 * sienne (`miseEnProduction`, à côté de son type de cible et de ses accès, qui
 * ne sont pas touchés). Écrire la procédure du déploiement RETIRE le marqueur
 * « constaté » : on ne peut pas suivre un texte et un constat à la fois.
 */
export function enregistrerProcedure(
  projectId: string,
  cible: CiblePublication,
  procedure: string,
  base: string,
): boolean {
  const projet = store.getProject(projectId);
  if (!projet) return false;
  const texte = procedure.trim().slice(0, PROCEDURE_MAX);
  const suite =
    cible === 'dev'
      ? { ...projet, deploiement: { base: base.trim().slice(0, PROCEDURE_MAX), prompt: texte } }
      : {
          ...projet,
          miseEnProduction: {
            ...projet.miseEnProduction,
            base: base.trim().slice(0, PROCEDURE_MAX),
            prompt: texte,
          },
        };
  const enregistre = store.saveProject(suite);
  // Le tableau et la colonne de gauche voient le changement sans recharger :
  // c'est ce qui fait passer le bouton « Initier… » à l'icône de réglages.
  bus.emit({ type: 'project.upsert', project: enregistre });
  return true;
}

/**
 * UN TOUR du tiroir, LANCÉ puis rendu tout de suite.
 *
 * Sans `message` : ouverture, l'agent lit le projet, tranche et écrit la
 * procédure. Avec `message` : la demande de l'utilisateur part au même agent,
 * qui la réécrit en conséquence — ou pose une question de plus s'il lui manque
 * vraiment quelque chose que le projet ne dit nulle part. Un tour d'agent est PAYANT : le tiroir n'en lance aucun tout seul, et
 * un tour DÉJÀ en train de tourner n'est jamais doublé — on s'y raccroche.
 */
export function tourDeProcedure(input: {
  projectId: string;
  cible: CiblePublication;
  agentId?: string;
  message?: string;
}): EtatDeProcedure {
  const vide: EtatDeProcedure = { projectId: input.projectId, cible: input.cible, enCours: false, echanges: [] };
  const projet = store.getProject(input.projectId);
  if (!projet) return { ...vide, raison: 'Projet introuvable.' };

  const courant = etatDeProcedure(input.projectId, input.cible);
  // Un tour tourne déjà pour cette étape : on rend l'état tel quel. Deux clics,
  // deux tiroirs ouverts ou une réponse envoyée deux fois ne paient qu'un tour.
  if (courant?.enCours) return courant;

  const reponse = (input.message ?? '').trim();
  /*
   * L'agent du dialogue : celui du tour d'avant quand il est encore là, sinon
   * un neuf. Reprendre le même agent garde la question, la réponse et ce que
   * l'agent a lu du projet dans une seule session. Un agent encore OCCUPÉ (tour
   * resté en vol) est écarté : `sendPrompt` empilerait la demande au lieu de la
   * jouer, et le tiroir attendrait une réponse qui ne viendrait jamais.
   */
  const precedentId = input.agentId ?? courant?.agentId;
  const precedent = precedentId ? store.getAgent(precedentId) : null;
  const reprenable =
    precedent && precedent.projectId === input.projectId && !agentsActifs().includes(precedent.id)
      ? precedent
      : null;
  const agent =
    reprenable ??
    createAgent({ projectId: input.projectId, role: 'deploy', title: titreDeLAgent(input.cible) });

  const echanges = reponse
    ? [...(courant?.echanges ?? []), { qui: 'moi' as const, texte: reponse }]
    : [];
  const etat = poser({
    projectId: input.projectId,
    cible: input.cible,
    agentId: agent.id,
    enCours: true,
    echanges,
    depuis: store.now(),
  });

  /*
   * QUEL PROMPT ? Il dépend de ce que l'agent a DÉJÀ dans sa session.
   *  - une demande dans un dialogue en cours → il a déjà lu le projet et écrit
   *    une première procédure : ce qu'on lui dit suffit ;
   *  - une demande de MODIFICATION arrivée sur un tiroir rouvert (le dialogue
   *    d'avant a disparu, il ne vivait qu'en mémoire) → l'agent est neuf, il
   *    lui faut le projet, la procédure actuelle ET la demande ;
   *  - rien d'écrit → l'ouverture, l'agent lit le projet et écrit lui-même.
   */
  const actuelle = procedureDeLEtape(projet, input.cible) || undefined;
  const dialogueEnCours = !!courant?.echanges.length && !!reprenable;
  const contexte = {
    projet: projet.name,
    dossier: projet.path,
    devUrl: projet.devUrl,
    actuelle,
  };
  const prompt = !reponse
    ? promptAnalyseProcedure(input.cible, contexte)
    : dialogueEnCours
      ? promptReponseProcedure(input.cible, reponse)
      : promptModificationProcedure(input.cible, contexte, reponse);

  void mener(etat, prompt, reponse);
  return etat;
}

/**
 * LE TOUR LUI-MÊME, en fond. Il ne rend rien à personne : il DIFFUSE son issue,
 * quelle qu'elle soit — la question, la procédure écrite, ou la raison de son
 * échec. Aucun chemin ne laisse le témoin allumé.
 */
async function mener(depart: EtatDeProcedure, prompt: string, reponse: string): Promise<void> {
  const agentId = depart.agentId as string;
  let erreur: string | undefined;
  try {
    await sendPrompt(agentId, prompt, {
      // `none` : aucun gabarit de réponse — le texte rendu est la question ou
      // la procédure, rien d'autre.
      template: 'none',
      silent: true,
    });
  } catch (err: any) {
    erreur = err?.message ?? 'raison inconnue';
  }

  const messages = store.listMessages(agentId, 50).filter((m) => m.role === 'assistant');
  const dernier = messages[messages.length - 1];
  const agent = store.getAgent(agentId);
  const issue = issueDuTour({
    contenu: dernier?.content,
    statut: agent?.status,
    erreur: erreur ?? dernier?.error,
  });
  /*
   * L'instant du tour est GARDÉ : il ne sert plus seulement à afficher une
   * durée, il dit aussi si la question rendue est encore fraîche à la
   * réouverture du tiroir. L'effacer faisait passer toute question posée
   * pendant que le tiroir était fermé pour une vieillerie — donc un tour
   * repayé. La question de l'outil, elle, est retombée avec le tour.
   */
  /*
   * On repart de l'état RANGÉ, pas de celui du départ : le tour a pu se voir
   * ajouter des bulles pendant qu'il tournait (une question de l'agent, la
   * réponse qu'on lui a faite). Rendre `depart` les effacerait.
   */
  const courant = dialogues.get(cleDuDialogue(depart.projectId, depart.cible)) ?? depart;
  const fini = { ...courant, enCours: false, question: undefined };

  if ('procedure' in issue) {
    if (!enregistrerProcedure(depart.projectId, depart.cible, issue.procedure, reponse)) {
      poser({ ...fini, raison: 'Projet introuvable : la procédure n’a pas pu être enregistrée.' });
      return;
    }
    /*
     * CE QUE L'AGENT A CONSTATÉ ET DÉCIDÉ EST DIT, pas seulement enregistré.
     * L'agent tranche désormais les choix techniques lui-même : sans son
     * explication, la procédure tomberait du ciel et personne ne saurait
     * pourquoi c'est celle-là. Elle est rendue avant le bloc, on la porte en
     * bulle. À défaut (agent muet), la phrase d'avant reste.
     */
    poser({
      ...fini,
      procedure: issue.procedure,
      echanges: [
        ...fini.echanges,
        { qui: 'agent', texte: issue.resume || 'La procédure est écrite et enregistrée.' },
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
