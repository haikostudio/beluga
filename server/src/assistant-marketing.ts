/**
 * L'AGENT MARKETING ATTITRÉ D'UN PROJET.
 *
 * Même mécanique que l'agent de surveillance (`assistant-surveillance.ts`) :
 * l'écran envoie UNE phrase, ce module ouvre une conversation au palier
 * « standard » avec sa CARTE (`ouvrirCarteDAgent` : rien ne tourne sans se voir
 * au tableau) — mais DANS LE PROJET VISÉ, pas chez Beluga Build : l'agent lit
 * le dépôt du projet qu'il doit vendre.
 *
 * UN SEUL AGENT PAR PROJET. Il est retenu sur l'espace marketing ; la phrase
 * suivante lui est envoyée à LUI, pour qu'il garde ce qu'il a compris. Une
 * conversation disparue (retirée à la main) en fait naître une nouvelle.
 *
 * LE DIMANCHE SOIR (`lancerLesPlansDeLaSemaine`), chaque projet actif (suivi
 * marketing non coupé, `EspaceMarketing.actif`) qui a une
 * fiche reçoit un tour court sur SA PROPRE carte, rangée ensuite directement
 * en archive (comme le rendez-vous de nuit, DEC-247) : l'agent lit tout avec
 * l'outil « marketing », il n'a pas besoin de la conversation de la semaine.
 */
import {
  LABEL_MARKETING,
  demandeDuPlanHebdo,
  demandeMarketing,
  ficheRemplie,
  raisonDemandeMarketingRefusee,
  reglagesDuNiveau,
  titreDeLAgentMarketing,
  estSiteAutonome,
} from '@beluga/shared';
import * as store from './store.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent, rangerCarteDAgent } from './carte-d-agent-demon.js';
import { assurerEspace, listerEspaces, marquerAgentMarketing } from './marketing.js';
import { log } from './logger.js';

export interface DepartMarketing {
  agentId: string;
  projectId: string;
  cardId: string;
}

async function reglages() {
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  return claude ? reglagesDuNiveau(claude, 'standard') : { model: undefined, thinking: 'none' };
}

export async function lancerAgentMarketing(entree: { projectId: string; demande: string }): Promise<DepartMarketing> {
  const demande = String(entree.demande ?? '').trim();
  const refus = raisonDemandeMarketingRefusee(demande);
  if (refus) throw new Error(refus);
  const projet = store.getProject(entree.projectId);
  if (!projet) throw new Error('projet introuvable');
  const espace = assurerEspace(projet.id);

  const existant = espace.agentId ? store.getAgent(espace.agentId) : null;
  if (existant && espace.cardId) {
    void sendPrompt(existant.id, demandeMarketing({ demande, nomProjet: projet.name, premiere: false, espace }), {
      template: 'none',
      motif: 'configuration-marketing',
    }).catch((err) => log.error('agent marketing : le tour a échoué', err));
    return { agentId: existant.id, projectId: projet.id, cardId: espace.cardId };
  }

  const r = await reglages();
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: titreDeLAgentMarketing(projet.name),
    description: `L’agent marketing attitré de « ${projet.name} » : il comprend le produit, règle l’atelier marketing et rédige les contenus à valider. Première demande : ${demande.slice(0, 300)}`,
    labels: [LABEL_MARKETING],
    role: 'task',
    run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
  });
  marquerAgentMarketing(projet.id, agentId, card.id);

  const processus = projet.miseEnProduction?.processus;
  void sendPrompt(
    agentId,
    demandeMarketing({
      demande,
      nomProjet: projet.name,
      premiere: true,
      espace,
      destination: processus?.resume ?? null,
      consignesDeMiseEnLigne: processus?.explication ?? null,
      adressePublique: projet.vitrineLiee?.adresseProduction ?? null,
    }),
    { template: 'none', silent: true, motif: 'configuration-marketing' },
  ).catch((err) => {
    log.error('agent marketing : le premier tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });

  log.info(`marketing : agent attitré ouvert pour « ${projet.name} »`);
  return { agentId, projectId: projet.id, cardId: card.id };
}

/**
 * LE PLAN DE LA SEMAINE, le dimanche soir. Un projet après l'autre : jamais
 * dix agents lancés d'un coup sur le même compte.
 */
/** Les espaces qui reçoivent le plan du dimanche : suivi non coupé, fiche remplie, nature connue. */
export function espacesDuPlanDeLaSemaine() {
  // Un site autonome du service Statistiques n'a ni projet ni agent marketing.
  return listerEspaces().filter((e) => !estSiteAutonome(e.projectId) && e.actif && ficheRemplie(e.fiche) && e.configuration.nature);
}

export async function lancerLesPlansDeLaSemaine(lundi: string): Promise<number> {
  const espaces = espacesDuPlanDeLaSemaine();
  let lances = 0;
  for (const espace of espaces) {
    const projet = store.getProject(espace.projectId);
    if (!projet || projet.archived) continue;
    const r = await reglages();
    const { card, agentId } = ouvrirCarteDAgent({
      projectId: projet.id,
      titre: `Plan marketing de la semaine — ${projet.name}`.slice(0, 80),
      description: `Chaque dimanche soir, l’agent marketing prépare la semaine du ${lundi} en brouillons à valider. Rien n’est programmé sans vous.`,
      labels: [LABEL_MARKETING],
      role: 'analysis',
      run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
    });
    try {
      await sendPrompt(agentId, demandeDuPlanHebdo({ lundi }), { template: 'none', silent: true, motif: 'configuration-marketing' });
      rangerCarteDAgent(card.id, agentId, 'archived', `Plan de la semaine du ${lundi} déposé en brouillons.`);
      lances += 1;
    } catch (err: any) {
      log.warn(`marketing : plan de la semaine impossible pour « ${projet.name} »`, err);
      direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
    }
  }
  if (lances) log.info(`marketing : plan de la semaine du ${lundi} préparé pour ${lances} projet(s)`);
  return lances;
}
