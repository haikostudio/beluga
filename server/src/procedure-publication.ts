import {
  CiblePublication,
  PROCEDURE_MAX,
  lireReponseDeProcedure,
  procedureDeLEtape,
  promptOuvertureProcedure,
  promptReponseProcedure,
  titreDeLaProcedure,
} from '@haikodev/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { createAgent, sendPrompt } from './runtime.js';

/**
 * LE TIROIR QUI DÉFINIT UNE PROCÉDURE DE MISE EN LIGNE.
 *
 * Un projet neuf n'a plus de procédure toute faite : la tête de la colonne
 * propose de l'INITIER, et c'est un AGENT qui la définit — il lit le projet, il
 * demande comment cette étape doit se passer, et il écrit la procédure à partir
 * de la réponse.
 *
 * Le dialogue tient dans UN agent, gardé d'un tour à l'autre par son
 * identifiant : la question et la réponse vivent donc dans la même session, et
 * l'agent ne redécouvre pas le projet à chaque message.
 *
 * L'écriture est le seul moment qui touche la base, et elle ne touche QUE la
 * cible demandée : un tiroir ouvert depuis « À déployer » ne peut pas écrire la
 * mise en production, et l'inverse non plus.
 */

export type TourDeProcedure = {
  ok: boolean;
  /** L'agent qui mène le dialogue : à repasser au tour suivant. */
  agentId?: string;
  /** La question posée par l'agent, quand il en pose une. */
  question?: string;
  /** La procédure écrite ET enregistrée, quand le dialogue aboutit. */
  procedure?: string;
  raison?: string;
};

/** Le titre de l'agent du tiroir : on doit le reconnaître dans la pile. */
function titreDeLAgent(cible: CiblePublication): string {
  return `Procédure — ${titreDeLaProcedure(cible)}`;
}

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
 * UN TOUR du tiroir.
 *
 * Sans `message` : ouverture, l'agent lit le projet et pose sa question. Avec
 * `message` : la réponse de l'utilisateur part au même agent, qui écrit la
 * procédure — ou pose une question de plus s'il lui manque vraiment quelque
 * chose. Un tour d'agent est PAYANT : le tiroir n'en lance aucun tout seul.
 */
export async function tourDeProcedure(input: {
  projectId: string;
  cible: CiblePublication;
  agentId?: string;
  message?: string;
}): Promise<TourDeProcedure> {
  const projet = store.getProject(input.projectId);
  if (!projet) return { ok: false, raison: 'projet introuvable' };

  const reponse = (input.message ?? '').trim();
  /*
   * L'agent du dialogue : celui du tour d'avant quand il est encore là, sinon
   * un neuf. Reprendre le même agent garde la question, la réponse et ce que
   * l'agent a lu du projet dans une seule session.
   */
  const precedent = input.agentId ? store.getAgent(input.agentId) : null;
  const agent =
    precedent && precedent.projectId === input.projectId
      ? precedent
      : createAgent({ projectId: input.projectId, role: 'deploy', title: titreDeLAgent(input.cible) });

  const prompt = reponse
    ? promptReponseProcedure(input.cible, reponse)
    : promptOuvertureProcedure(input.cible, {
        projet: projet.name,
        dossier: projet.path,
        devUrl: projet.devUrl,
        actuelle: procedureDeLEtape(projet, input.cible) || undefined,
      });

  try {
    await sendPrompt(agent.id, prompt, {
      // `none` : aucun gabarit de réponse — le texte rendu est la question ou
      // la procédure, rien d'autre.
      template: 'none',
      silent: true,
    });
  } catch (err: any) {
    return { ok: false, agentId: agent.id, raison: err?.message ?? 'raison inconnue' };
  }

  const messages = store.listMessages(agent.id, 50).filter((m) => m.role === 'assistant');
  const dernier = messages[messages.length - 1];
  const fini = store.getAgent(agent.id);
  if (fini && fini.status !== 'done') {
    const raison = dernier?.error?.trim() || `le tour de l'agent s'est terminé en « ${fini.status} »`;
    return { ok: false, agentId: agent.id, raison };
  }

  const lue = lireReponseDeProcedure(dernier?.content ?? '');
  if (lue.procedure) {
    if (!enregistrerProcedure(input.projectId, input.cible, lue.procedure, reponse)) {
      return { ok: false, agentId: agent.id, raison: 'projet introuvable' };
    }
    return { ok: true, agentId: agent.id, procedure: lue.procedure };
  }

  const question = lue.question?.trim();
  if (!question) return { ok: false, agentId: agent.id, raison: 'l’agent n’a rien rendu' };
  return { ok: true, agentId: agent.id, question };
}
