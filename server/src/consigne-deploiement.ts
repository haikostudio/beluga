import {
  COLUMN_LABELS,
  type ColonneConsigne,
  nettoyerConsigneGeneree,
  promptGenerationConsigne,
} from '@haikodev/shared';
import * as store from './store.js';
import { createAgent, sendPrompt } from './runtime.js';

/**
 * RÉDIGER LA CONSIGNE DE DÉPLOIEMENT PAR UN AGENT.
 *
 * L'utilisateur écrit une base de texte brute ; un agent la met en forme en une
 * consigne claire, que l'agent de publication comprendra sans ambiguïté. C'est
 * un tour d'agent PAYANT, comme une mise en ligne confiée
 * (`confierLaMiseEnLigne`) : on crée l'agent, on lui envoie la base, on lit sa
 * dernière réponse.
 *
 * On ne persiste RIEN ici : la consigne rendue est montrée dans la fenêtre,
 * modifiable, puis enregistrée par l'interface via `project.update` — le seul
 * chemin d'écriture. Générer ne déclenche donc aucune publication.
 */
export async function genererConsigne(
  projectId: string,
  colonne: ColonneConsigne,
  base: string,
): Promise<{ ok: boolean; consigne?: string; raison?: string }> {
  const projet = store.getProject(projectId);
  if (!projet) return { ok: false, raison: 'projet introuvable' };

  const brute = (base ?? '').trim();
  if (!brute) return { ok: false, raison: 'aucune base de texte à mettre en forme' };

  const agent = createAgent({
    projectId,
    role: 'deploy',
    title: `Consigne de déploiement — ${COLUMN_LABELS[colonne]}`,
  });

  try {
    await sendPrompt(agent.id, promptGenerationConsigne(projet, colonne, brute), {
      // `none` : aucun gabarit de réponse, la dernière réponse EST la consigne.
      template: 'none',
      silent: true,
    });
  } catch (err: any) {
    return { ok: false, raison: err?.message ?? 'raison inconnue' };
  }

  const messages = store.listMessages(agent.id, 50).filter((m) => m.role === 'assistant');
  const dernier = messages[messages.length - 1];
  const fini = store.getAgent(agent.id);
  if (fini && fini.status !== 'done') {
    const raison = dernier?.error?.trim() || `le tour de l'agent s'est terminé en « ${fini.status} »`;
    return { ok: false, raison };
  }

  const consigne = nettoyerConsigneGeneree(dernier?.content ?? '');
  if (!consigne) return { ok: false, raison: 'l’agent n’a rendu aucune consigne' };
  return { ok: true, consigne };
}
