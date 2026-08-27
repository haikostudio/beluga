/**
 * L'AGENT DE CADRAGE D'UNE CARTE : celui à qui on parle avant de lancer.
 *
 * Le « + » de la colonne « Planifié » ne demande plus un titre dans un petit
 * formulaire : il crée la carte et OUVRE SA CONVERSATION. Un agent léger y
 * discute le besoin, écrit le titre, la description et le niveau d'exécution de
 * la carte, et s'arrête là — il ne code pas, la carte n'a pas de branche.
 *
 * Son MODÈLE est ÉPINGLÉ économe (Haiku 4.5 sous Claude, GPT-5.4 sous Codex),
 * parce que ce tour-là ne lit pas le projet : la règle qui plafonne ce choix vit
 * dans `shared/src/modele-econome.ts`.
 *
 * RIEN NE PART AU MOTEUR À LA CRÉATION : l'agent existe, sa conversation est
 * vide, et le premier tour n'a lieu qu'au premier message de l'utilisateur.
 */

import { Agent, NIVEAU_PAR_DEFAUT_CADRAGE, reglagesDuNiveau, TITRE_CARTE_DE_CADRAGE } from '@haikodev/shared';
import * as store from './store.js';
import { createAgent } from './runtime.js';
import { bus } from './bus.js';
import { listEngines } from './engines/index.js';
import { choixEconome, resolveModel } from './engines/catalog.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { log } from './logger.js';

/**
 * L'agent de cadrage d'une carte, créé s'il n'existe pas encore.
 *
 * Une carte qui a DÉJÀ un agent — cadrage repris, ou agent de tâche parce
 * qu'elle a été lancée — n'en reçoit pas un second : deux fils sur la même
 * carte, ce serait deux endroits où répondre.
 */
export async function ouvrirLeCadrage(cardId: string): Promise<Agent | null> {
  const card = store.getCard(cardId);
  if (!card) return null;
  const existant = store.getLastAgentByCard(cardId);
  if (existant) return existant.role === 'cadrage' ? existant : null;

  const engines = await listEngines();
  const settings = store.getSettings();
  const project = store.getProject(card.projectId);

  /*
   * LE MOTEUR SUIT LA CARTE, PUIS LE PROJET. Une carte posée avec des réglages
   * (héritage d'une proposition) garde son moteur ; sinon c'est celui du
   * projet, comme pour toute autre conversation.
   */
  const engineId = card.run?.engine ?? project?.defaultEngine ?? 'claude';
  const engine = engines.find((e) => e.id === engineId) ?? engines[0];
  const memorise =
    settings.cadrageEngine === engineId && settings.cadrageModel
      ? resolveModel(engine?.models ?? [], settings.cadrageModel)
      : undefined;
  const { model, thinking } = choixEconome(
    engine?.id ?? 'claude',
    engine?.models ?? [],
    memorise,
    settings.cadrageThinking,
  );

  const agent = createAgent({
    projectId: card.projectId,
    role: 'cadrage',
    title: card.title || TITRE_CARTE_DE_CADRAGE,
    cardId: card.id,
    run: { engine: engineId, model, thinking },
  });
  bus.emit({ type: 'agent.upsert', agent });

  /*
   * LA CARTE ELLE-MÊME AFFICHE DÉJÀ UN MODÈLE ÉCONOME, avant tout échange :
   * le composant de saisie (`web/src/components/composer.tsx`) lit `card.run`
   * pendant un cadrage, pas le réglage de l'agent qui discute. Sans ce
   * réglage posé ici, il resterait vide tant que le cadrage n'a rien décidé.
   * Une carte qui a DÉJÀ un niveau ou un modèle (reprise, héritage d'une
   * proposition) n'est jamais touchée.
   */
  if (!card.run?.niveau && !card.run?.model) {
    try {
      const catalogue = await catalogueMoteurs();
      const moteur = catalogue.find((m) => m.id === engineId) ?? catalogue.find((m) => m.installed) ?? catalogue[0];
      if (moteur) {
        const reglages = reglagesDuNiveau(moteur, NIVEAU_PAR_DEFAUT_CADRAGE);
        const fraiche = store.saveCard({
          ...card,
          run: { ...(card.run ?? {}), engine: moteur.id, ...reglages, niveau: NIVEAU_PAR_DEFAUT_CADRAGE },
        });
        bus.emit({ type: 'card.upsert', card: fraiche });
      }
    } catch (err) {
      // Catalogue illisible : la carte reste sans modèle affiché, comme avant.
      log.warn('niveau par défaut du cadrage : catalogue des moteurs illisible', err);
    }
  }

  return agent;
}

/**
 * L'agent de cadrage d'une carte, s'il en a un — et seulement lui. Sert à
 * décider ce que le lancement doit reprendre (`startCard`). Une carte déjà
 * lancée a un agent de tâche plus récent : elle ne rend donc rien ici.
 */
export function agentDeCadrage(cardId: string): Agent | null {
  const dernier = store.getLastAgentByCard(cardId);
  return dernier && dernier.role === 'cadrage' ? dernier : null;
}
