/**
 * L'AGENT ATTITRÉ D'UNE CRÉATION DU STUDIO.
 *
 * Même mécanique que l'agent marketing (`assistant-marketing.ts`) : l'écran
 * envoie UNE phrase, ce module ouvre une conversation avec sa CARTE
 * (`ouvrirCarteDAgent` : rien ne tourne sans se voir au tableau), dans le
 * projet de la création. UN AGENT PAR CRÉATION — son contexte reste ciblé ; la
 * phrase suivante lui est envoyée à LUI.
 *
 * PALIER « APPROFONDI » : c'est lui qui dessine, sur le quota des abonnements
 * (aucune facturation à l'appel, MEM-1034). Jamais un nom de modèle en dur :
 * `reglagesDuNiveau` choisit la famille la plus capable. L'utilisateur choisit
 * le moteur et le modèle par le bouton de configuration en tête de la
 * conversation : avant la première demande, le choix vit sur la création
 * (`runAgent`) et sert ici au démarrage ; ensuite il passe par `agent.config`.
 */
import { LABEL_STUDIO, demandeStudio, raisonDemandeStudioRefusee, reglagesDuNiveau, titreDeLAgentStudio, type Creation } from '@beluga/shared';
import * as store from './store.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent } from './carte-d-agent-demon.js';
import { lireCreation, lireSelection, marquerAgentStudio } from './studio.js';
import { log } from './logger.js';

export interface DepartStudio {
  agentId: string;
  cardId: string;
}

/**
 * LE RÉGLAGE DU DÉMARRAGE : celui choisi sur la création s'il désigne un moteur
 * connu (modèle et réflexion ramenés à ce qui existe vraiment), sinon Claude au
 * palier « approfondi ».
 */
async function reglages(choisi?: Creation['runAgent']): Promise<{ engine: string; model?: string; thinking: string; account?: string }> {
  const catalogue = await catalogueMoteurs();
  const moteur = choisi ? catalogue.find((m) => m.id === choisi.engine) : undefined;
  if (choisi && moteur) {
    const modele = moteur.models.find((m) => m.id === choisi.model) ?? moteur.models.find((m) => m.id === reglagesDuNiveau(moteur, 'approfondi').model);
    const reflexion = modele?.thinking.some((t) => t.id === choisi.thinking) ? choisi.thinking! : (modele?.defaultThinking ?? 'none');
    return { engine: moteur.id, model: modele?.id, thinking: reflexion, ...(choisi.account ? { account: choisi.account } : {}) };
  }
  const claude = catalogue.find((m) => m.id === 'claude');
  return { engine: 'claude', ...(claude ? reglagesDuNiveau(claude, 'approfondi') : { model: undefined, thinking: 'none' }) };
}

/** Le contenu Marketing d'où vient une création, pour le premier tour. */
async function contexteMarketing(contenuId?: string): Promise<{ canal: string; titre: string; texte: string } | null> {
  if (!contenuId) return null;
  const { lireContenu } = await import('./marketing.js');
  const c = lireContenu(contenuId);
  return c ? { canal: c.canal, titre: c.titre, texte: c.texte } : null;
}

export async function lancerAgentStudio(entree: { creationId: string; demande: string }): Promise<DepartStudio> {
  const demande = String(entree.demande ?? '').trim();
  const refus = raisonDemandeStudioRefusee(demande);
  if (refus) throw new Error(refus);
  const creation = lireCreation(entree.creationId);
  if (!creation) throw new Error('création introuvable');
  const projet = store.getProject(creation.projectId);
  if (!projet) throw new Error('projet introuvable');
  const selection = lireSelection(creation.id);

  const existant = creation.agentId ? store.getAgent(creation.agentId) : null;
  if (existant && creation.cardId && store.getCard(creation.cardId)) {
    void sendPrompt(existant.id, demandeStudio({ demande, titre: creation.titre, premiere: false, selection }), {
      template: 'none',
      motif: 'studio',
    }).catch((err) => log.error('studio : le tour a échoué', err));
    return { agentId: existant.id, cardId: creation.cardId };
  }

  const r = await reglages(creation.runAgent);
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: titreDeLAgentStudio(creation.titre),
    description: `L’agent attitré de la création « ${creation.titre} » du Studio : il dessine les visuels en code, prépare les voix et les sous-titres, et exporte avec vous. Première demande : ${demande.slice(0, 300)}`,
    labels: [LABEL_STUDIO],
    role: 'task',
    run: { engine: r.engine as any, model: r.model, thinking: r.thinking as any, ...(r.account ? { account: r.account } : {}) },
  });
  marquerAgentStudio(creation.id, agentId, card.id);
  const marketing = await contexteMarketing(creation.contenuMarketingId);
  void sendPrompt(agentId, demandeStudio({ demande, titre: creation.titre, premiere: true, selection, contexteMarketing: marketing }), {
    template: 'none',
    motif: 'studio',
  }).catch((err) => {
    log.error('studio : le premier tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });
  log.info(`studio : agent attitré ouvert pour « ${creation.titre} »`);
  return { agentId, cardId: card.id };
}
