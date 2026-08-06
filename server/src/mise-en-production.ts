import {
  TITRE_MISE_EN_PRODUCTION,
  nettoyerPromptGenere,
  promptGenerationMiseEnProduction,
} from '@haikodev/shared';
import * as store from './store.js';
import { createAgent, sendPrompt } from './runtime.js';

/**
 * RÉDIGER LE PROMPT DE MISE EN PRODUCTION PAR UN AGENT.
 *
 * L'utilisateur écrit le concept dans ses mots — quel serveur, par quel chemin,
 * quels contrôles ; un agent en fait le prompt complet que l'agent de mise en
 * production suivra ensuite. C'est un tour d'agent PAYANT, comme une mise en
 * ligne confiée : on crée l'agent, on lui envoie la base, on lit sa dernière
 * réponse.
 *
 * On ne persiste RIEN ici : le prompt rendu est montré dans les réglages du
 * projet, modifiable, puis enregistré par l'interface via `project.update` — le
 * seul chemin d'écriture. Générer ne déclenche donc aucune publication.
 */
export async function genererPromptDeProduction(
  projectId: string,
  base: string,
): Promise<{ ok: boolean; prompt?: string; raison?: string }> {
  const projet = store.getProject(projectId);
  if (!projet) return { ok: false, raison: 'projet introuvable' };

  const brute = (base ?? '').trim();
  if (!brute) return { ok: false, raison: 'aucun texte à mettre en forme' };

  const agent = createAgent({
    projectId,
    role: 'deploy',
    title: `Prompt de ${TITRE_MISE_EN_PRODUCTION.toLowerCase()}`,
  });

  try {
    await sendPrompt(agent.id, promptGenerationMiseEnProduction(projet, brute), {
      // `none` : aucun gabarit de réponse, la dernière réponse EST le prompt.
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

  const prompt = nettoyerPromptGenere(dernier?.content ?? '');
  if (!prompt) return { ok: false, raison: 'l’agent n’a rendu aucun prompt' };
  return { ok: true, prompt };
}
