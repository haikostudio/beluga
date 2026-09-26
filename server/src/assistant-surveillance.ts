/**
 * L'AGENT DE SURVEILLANCE — créer ou modifier une surveillance en discutant.
 *
 * Même mécanique que l'assistant des backups (`assistant-backup.ts`) : l'écran
 * envoie UNE phrase, ce module ouvre une conversation dédiée au palier
 * « standard » avec sa CARTE (`ouvrirCarteDAgent` : rien ne tourne sans se voir
 * au tableau), et lui donne la demande fabriquée par la règle pure
 * (`demandeDeSurveillance`). L'agent liste le coffre-fort, pose ses questions
 * avec `ask_user`, range les accès, essaie sa recette avec `surveillance_essai`
 * et l'enregistre avec `surveillance_recette`.
 *
 * SUR UNE SURVEILLANCE EXISTANTE, la conversation ET SA CARTE sont retenues sur
 * la ligne AVANT le départ : le tiroir de la surveillance les montre tout de
 * suite, et l'agent reçoit la recette actuelle pour la modifier.
 *
 * LE TOUR EST LANCÉ SANS RETENIR L'ÉCRAN : la commande rend la main avec
 * l'identifiant de la conversation.
 */
import {
  LABEL_SURVEILLANCE,
  demandeDeSurveillance,
  raisonDemandeSurveillanceRefusee,
  reglagesDuNiveau,
  titreDeLAssistantSurveillance,
} from '@beluga/shared';
import * as store from './store.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent } from './carte-d-agent-demon.js';
import { lireSurveillance, marquerAssistantSurveillance } from './surveillance.js';
import { log } from './logger.js';

export interface DepartDeSurveillance {
  agentId: string;
  projectId: string;
  cardId: string;
}

export async function lancerAssistantDeSurveillance(entree: { demande: string; id?: string | null }): Promise<DepartDeSurveillance> {
  const demande = String(entree.demande ?? '').trim();
  const refus = raisonDemandeSurveillanceRefusee(demande);
  if (refus) throw new Error(refus);

  const site = entree.id ? lireSurveillance(entree.id) : null;
  if (entree.id && !site) throw new Error('surveillance introuvable');

  // Un site surveillé est extérieur au tableau : sa conversation vit chez Beluga Build lui-même.
  const projets = store.listProjects();
  const projet = projets.find((p) => p.isSelf) ?? projets[0];
  if (!projet) throw new Error('Aucun projet ouvert : la conversation de l’agent n’a nulle part où vivre.');

  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  const reglages = claude ? reglagesDuNiveau(claude, 'standard') : { model: undefined, thinking: 'none' };

  const titre = titreDeLAssistantSurveillance(site?.nom ?? null, demande);
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre,
    description: site
      ? `L’agent de surveillance modifie le contrôle de « ${site.nom} » : ${demande.slice(0, 300)}`
      : `L’agent de surveillance prépare un nouveau contrôle : ${demande.slice(0, 300)}`,
    labels: [LABEL_SURVEILLANCE],
    role: 'task',
    run: { engine: 'claude', model: reglages.model, thinking: reglages.thinking as any },
  });

  if (site) marquerAssistantSurveillance(site.id, { agentId, projectId: projet.id, cardId: card.id });

  void sendPrompt(agentId, demandeDeSurveillance({ demande, site }), {
    template: 'none',
    silent: true,
    motif: 'configuration-surveillance',
  }).catch((err) => {
    log.error('agent de surveillance : le tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });

  log.info(`surveillance : l’agent ${site ? `modifie « ${site.nom} »` : 'prépare une nouvelle surveillance'}`);
  return { agentId, projectId: projet.id, cardId: card.id };
}
