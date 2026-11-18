/**
 * L'AGENT D'UNE CRÉATION DU STUDIO EST UN DIRECTEUR ARTISTIQUE (décision de
 * l'utilisateur du 30/10/2026) : la même conversation qu'une carte caméra — le
 * chemin des quatre étapes, la liste de tâches collée au champ, les questions et
 * leurs exemples, les fabrications à prix —, plus l'outil « studio » et sa ligne
 * de temps. Une création porte donc une VRAIE carte caméra (`realisationSouhaitee`),
 * dans « Planifié » comme toute carte caméra, avec son agent de cadrage : rien de
 * cette mécanique n'est écrit deux fois.
 *
 * La carte porte l'étiquette « studio » et l'agent `agent.service` : ni l'une ni
 * l'autre ne paraissent dans la liste des agents du projet (MEM-5822) ; tout ce
 * qui y mène ouvre le Studio sur la création.
 *
 * UN AGENT PAR CRÉATION. Une création d'avant le retour du Studio (agent de
 * volet, rôle « task », carte rangée) ne reprend pas ce fil : son premier message
 * ouvre un directeur neuf, qui lit la composition avec « lire ». L'ancienne
 * conversation reste sur sa carte archivée.
 */
import { LABEL_STUDIO, raisonDemandeStudioRefusee, realisationNeuve, titreDeLAgentStudio, type Agent, type Card, type Creation } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { getMeta } from './db.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte } from './carte-d-agent-demon.js';
import { compositionCourante, estMontageDeCarte, lireCreation, marquerAgentStudio } from './studio.js';
import { log } from './logger.js';

export interface DepartStudio {
  agentId: string;
  cardId: string;
}

/** Le directeur en place de cette création, s'il en est bien un (une création d'avant n'en a pas). */
function directeurDeLaCreation(creation: Creation): { agent: Agent; card: Card } | null {
  const agent = creation.agentId ? store.getAgent(creation.agentId) : null;
  const card = creation.cardId ? store.getCard(creation.cardId) : null;
  if (!agent || !card || agent.role !== 'cadrage' || !card.parcours?.realisationSouhaitee) return null;
  return { agent, card };
}

/**
 * LA CARTE CAMÉRA D'UNE CRÉATION. Une vidéo par défaut (le directeur en change sur
 * demande). Une création déjà montée s'ouvre à l'étape « Montage » : son brief et
 * ses plans sont derrière elle.
 */
async function poserLeDirecteur(creation: Creation): Promise<{ agent: Agent; card: Card }> {
  const { createCard } = await import('./tools.js');
  const { ouvrirLeCadrage } = await import('./cadrage.js');
  const composition = compositionCourante(creation.id);
  const dejaMontee = !!composition && composition.pistes.some((p) => p.segments.length > 0);
  const nee = createCard(creation.projectId, {
    title: titreDeLAgentStudio(creation.titre),
    description: `La création « ${creation.titre} » du Studio.`,
    labels: [LABEL_STUDIO],
    origin: 'agent',
    run: creation.runAgent as Partial<Card['run']> | undefined,
    cadrage: true,
  });
  const maintenant = Date.now();
  const card = store.saveCard({
    ...nee,
    parcours: { ...(nee.parcours ?? { plans: [] }), realisationSouhaitee: true },
    /* UNE IMAGE DEMANDÉE PAR UN AGENT (`studio.genre.<création>`, suivi-studio.ts) : la carte vise une image. */
    realisation: { ...realisationNeuve(), medias: [getMeta(`studio.genre.${creation.id}`) === 'image' ? 'image' : 'video'], ...(dejaMontee ? { esquissesA: maintenant, montageA: maintenant } : {}) },
  });
  bus.emit({ type: 'card.upsert', card });
  const cadrage = await ouvrirLeCadrage(card.id);
  if (!cadrage) throw new Error('le directeur artistique n’a pas pu naître');
  const agent = store.saveAgent({ ...cadrage, service: { id: 'studio', nom: 'Studio', adresse: `studio/${creation.id}` } });
  bus.emit({ type: 'agent.upsert', agent });
  store.saveCard({ ...store.getCard(card.id)!, agentId: agent.id });
  marquerAgentStudio(creation.id, agent.id, card.id);
  return { agent, card: store.getCard(card.id)! };
}

export async function lancerAgentStudio(entree: { creationId: string; demande: string; attachments?: string[] }): Promise<DepartStudio> {
  const demande = String(entree.demande ?? '').trim();
  const refus = raisonDemandeStudioRefusee(demande);
  if (refus) throw new Error(refus);
  const creation = lireCreation(entree.creationId);
  if (!creation) throw new Error('création introuvable');
  if (!store.getProject(creation.projectId)) throw new Error('projet introuvable');
  /* LE MONTAGE D'UNE CARTE n'ouvre aucun agent de plus : la retouche en mots s'écrit dans la conversation de SA carte. */
  if (estMontageDeCarte(creation)) throw new Error('Ce montage appartient à une carte : écris ta retouche dans la conversation de la carte.');

  const { agent, card } = directeurDeLaCreation(creation) ?? (await poserLeDirecteur(creation));
  /* Les pièces jointes du champ d'écriture, posées avant la naissance du directeur, partent avec la première demande. */
  void sendPrompt(agent.id, demande, entree.attachments?.length ? { attachments: entree.attachments } : {}).catch((err) => {
    log.error('studio : le tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agent.id, err?.message ?? String(err));
  });
  return { agentId: agent.id, cardId: card.id };
}
