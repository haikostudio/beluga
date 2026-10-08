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
 * `reglagesDuNiveau` choisit la famille la plus capable, et l'utilisateur garde
 * le choix du modèle dans la barre d'écriture de la conversation.
 */
import { LABEL_STUDIO, demandeStudio, raisonDemandeStudioRefusee, reglagesDuNiveau, titreDeLAgentStudio } from '@beluga/shared';
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

async function reglages() {
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  return claude ? reglagesDuNiveau(claude, 'approfondi') : { model: undefined, thinking: 'none' };
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

  const r = await reglages();
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: titreDeLAgentStudio(creation.titre),
    description: `L’agent attitré de la création « ${creation.titre} » du Studio : il dessine les visuels en code, prépare les voix et les sous-titres, et exporte avec vous. Première demande : ${demande.slice(0, 300)}`,
    labels: [LABEL_STUDIO],
    role: 'task',
    run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
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
