/**
 * L'ASSISTANT QUI CONFIGURE UN SITE À SAUVEGARDER — le travail réel.
 *
 * L'écran n'envoie plus quinze champs : il envoie UNE phrase. Ce module ouvre
 * alors une conversation dédiée, confiée à un agent LÉGER (le palier « leger »,
 * traduit en modèle réel par `reglagesDuNiveau` — on ne nomme jamais un modèle
 * ici, il vieillirait), et lui donne la demande fabriquée par la règle pure
 * (`shared/src/snapshots-agent.ts`).
 *
 * L'agent lit le serveur, POSE SES QUESTIONS avec `ask_user` — qui arrête le
 * moteur jusqu'à la réponse, exactement comme partout ailleurs — puis enregistre
 * la fiche avec `snapshot_site`. La conversation reste ouverte : c'est là que
 * les questions s'affichent et que le compte rendu se lit.
 *
 * LE TOUR EST LANCÉ SANS RETENIR L'ÉCRAN : un tour de moteur dure des dizaines
 * de secondes, la commande rend la main tout de suite avec l'identifiant de la
 * conversation, comme le lancement d'un snapshot.
 */

import {
  demandeDeConfiguration,
  raisonDemandeRefusee,
  reglagesDuNiveau,
  titreDeLAssistantSnapshot,
} from '@haikodev/shared';
import * as store from './store.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { createAgent, sendPrompt } from './runtime.js';
import { log } from './logger.js';

export interface DepartDAssistant {
  agentId: string;
  projectId: string;
}

/**
 * Où la conversation s'ouvre. Un site rattaché à un projet appartient à ce
 * projet ; un site extérieur va chez HaikoDev lui-même — le tableau du serveur,
 * seul endroit qui ne dépend d'aucun client. À défaut, le premier projet ouvert :
 * une conversation doit bien vivre quelque part.
 */
function projetDAccueil(projectId?: string | null): { id: string; name: string; path: string } | null {
  const projets = store.listProjects();
  const vise = projectId ? projets.find((p) => p.id === projectId) : undefined;
  const retenu = vise ?? projets.find((p) => p.isSelf) ?? projets[0];
  return retenu ? { id: retenu.id, name: retenu.name, path: retenu.path } : null;
}

/**
 * LE MOTEUR ET LE MODÈLE DE L'ASSISTANT. Claude au palier « léger » : configurer
 * une fiche, c'est lire deux fichiers de configuration et poser trois questions
 * — payer un modèle de raisonnement pour cela serait le prix fort pour rien.
 * Le catalogue est celui du serveur, pas une liste écrite en dur : un modèle
 * renommé ne casse rien.
 */
async function reglagesDeLAssistant(): Promise<{ engine: 'claude'; model?: string; thinking: string }> {
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  if (!claude) return { engine: 'claude', model: undefined, thinking: 'none' };
  const reglages = reglagesDuNiveau(claude, 'leger');
  return { engine: 'claude', model: reglages.model, thinking: reglages.thinking };
}

/**
 * Ouvre l'assistant sur une demande. Rend l'identifiant de la conversation : c'est
 * elle que l'écran propose d'ouvrir pour suivre les questions.
 */
export async function lancerAssistantDeSnapshot(entree: {
  description: string;
  projectId?: string | null;
}): Promise<DepartDAssistant> {
  const description = String(entree.description ?? '').trim();
  const refus = raisonDemandeRefusee(description);
  if (refus) throw new Error(refus);

  const projet = projetDAccueil(entree.projectId);
  if (!projet) throw new Error('Aucun projet ouvert : la conversation de l’assistant n’a nulle part où vivre.');

  // Le projet RATTACHÉ au site n'est nommé à l'agent que si l'utilisateur l'a
  // choisi : un site extérieur accueilli chez HaikoDev ne doit pas se retrouver
  // avec « projectId: HaikoDev » dans sa fiche.
  const rattache = entree.projectId ? store.getProject(entree.projectId) : null;

  const reglages = await reglagesDeLAssistant();
  const agent = createAgent({
    projectId: projet.id,
    role: 'task',
    title: titreDeLAssistantSnapshot(description),
    run: { engine: reglages.engine, model: reglages.model, thinking: reglages.thinking as any },
  });

  const demande = demandeDeConfiguration({
    description,
    projet: rattache ? { id: rattache.id, nom: rattache.name, chemin: rattache.path } : null,
  });

  // Le tour part SANS retenir l'écran : il dure des dizaines de secondes, et
  // l'agent s'arrêtera de lui-même sur sa première question.
  void sendPrompt(agent.id, demande, {
    template: 'none',
    silent: true,
    motif: 'configuration-snapshot',
  }).catch((err) => log.error('assistant de snapshot : le tour a échoué', err));

  return { agentId: agent.id, projectId: projet.id };
}
