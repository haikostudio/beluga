/**
 * L'AGENT D'UNE CHARTE, CÔTÉ DÉMON (refonte du service Charte graphique, 17/11/2026). Le patron est celui de
 * Marketing 2 (`strategie-marketing-2.ts`) : un agent de SERVICE par document, créé à la première ouverture, sa
 * consigne relue à chaque message (`contexteDeLAgentDeCharte`, branché dans `ws.ts`), et son premier message envoyé
 * une seule fois. Les règles pures vivent dans `shared/src/agent-de-charte.ts`.
 *
 * L'agent est rangé DANS LE PROJET du document : l'outil « capture » ne touche un document que de son projet
 * (`plaquette_modifier`), et le dépôt du projet est l'endroit où il cherche le logo. Il n'a pas de carte : rien ne se
 * pose sur le tableau (décision de l'utilisateur : « créer une charte passe par l'agent »).
 */

import crypto from 'node:crypto';
import {
  Agent,
  COULEUR_D_ATTENTE_DE_CHARTE,
  PREMIER_MESSAGE_CHARTE_EXISTANTE,
  PREMIER_MESSAGE_CHARTE_NEUVE,
  blocsDUneCharteNeuve,
  consigneDeLAgentDeCharte,
  plaquetteDeLAgentDeCharte,
  reglagesDuNiveau,
  serviceDeLAgentDeCharte,
} from '@beluga/shared';
import * as store from './store.js';
import { reglageDeConversation } from './puissance-des-agents.js';
import { bus } from './bus.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import { brouillonDe, charteRetenue, creerPlaquette, filsDe, lirePlaquette, projetDeLaSignature, type Plaquette } from './plaquettes.js';

/** Un agent de charte : son service le dit, et il sert ce document-là. */
export function estAgentDeCharte(agent: Pick<Agent, 'service'> | null | undefined, plaquetteId?: string): boolean {
  const vise = plaquetteDeLAgentDeCharte(agent?.service);
  return !!vise && (!plaquetteId || vise.plaquetteId === plaquetteId);
}

/** L'agent déjà attaché au document, s'il est bien SON agent de charte (jamais l'agent de tâche qui l'a rédigé). */
function agentAttache(p: Plaquette): Agent | null {
  const agent = p.agentId ? store.getAgent(p.agentId) : null;
  return agent && estAgentDeCharte(agent, p.id) ? agent : null;
}

async function creerLAgent(p: Plaquette): Promise<Agent> {
  const projet = store.getProject(p.projectId);
  if (!projet) throw new Error('projet du document introuvable');
  const { catalogueMoteurs } = await import('./catalogue-moteurs.js');
  const claude = (await catalogueMoteurs()).find((m) => m.id === 'claude');
  const r = reglageDeConversation(claude);
  const agent = store.saveAgent({
    ...Agent.parse({
      id: store.newId(),
      projectId: p.projectId,
      role: 'task',
      title: `Charte — ${p.titre}`.slice(0, 120),
      workdir: projet.path,
      run: { engine: 'claude', model: r.model, thinking: r.thinking, ...(r.niveau ? { niveau: r.niveau } : {}) },
      status: 'idle',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
    service: serviceDeLAgentDeCharte(p.projectId, p.id),
  });
  /* LE DOCUMENT GARDE SON AGENT : l'ancien agent de tâche qui l'avait rédigé est remplacé ici (sa carte, elle, reste). */
  getDb().prepare('UPDATE plaquettes SET agent_id = ? WHERE id = ?').run(agent.id, p.id);
  bus.emit({ type: 'agent.upsert', agent });
  return agent;
}

/**
 * « OUVRIR » UN DOCUMENT : son agent (créé au premier appel) et, la toute première fois, son premier message — celui
 * d'une charte neuve ou celui d'un document qui existait déjà. Jamais pendant un tour, jamais deux fois.
 */
export async function ouvrirLAgentDeCharte(plaquetteId: string, opts: { neuve?: boolean } = {}): Promise<{ agentId: string }> {
  const p = lirePlaquette(plaquetteId);
  if (!p) throw new Error('document introuvable');
  const agent = agentAttache(p) ?? (await creerLAgent(p));
  const aDejaParle = store.listMessages(agent.id, 1).length > 0;
  const auTravail = agent.status === 'running' || agent.status === 'starting';
  /* LA GARDE D'ESSAI (contrôles navigateur) : aucun vrai moteur ne part d'un essai. */
  if (!aDejaParle && !auTravail && process.env.BELUGA_CHARTE_SANS_PREMIER_MESSAGE !== '1') {
    const { sendPrompt } = await import('./runtime.js');
    const premier = opts.neuve ? PREMIER_MESSAGE_CHARTE_NEUVE : PREMIER_MESSAGE_CHARTE_EXISTANTE;
    void sendPrompt(agent.id, premier, { template: 'none', context: contexteDeLAgentDeCharte(agent) }).catch((err) => log.error('charte : l’agent n’a pas démarré', err));
  }
  return { agentId: agent.id };
}

/** Le contexte de chaque message à l'agent d'une charte ; `undefined` pour tout autre agent. */
export function contexteDeLAgentDeCharte(agent: Pick<Agent, 'service'>): string | undefined {
  const vise = plaquetteDeLAgentDeCharte(agent.service);
  if (!vise) return undefined;
  const p = lirePlaquette(vise.plaquetteId);
  if (!p) return undefined;
  const projet = store.getProject(p.projectId);
  const projetMarque = (p.projetMarqueId ? store.getProject(p.projetMarqueId) : null) ?? projet;
  return consigneDeLAgentDeCharte({
    plaquette: { id: p.id, titre: p.titre, format: p.format, adresse: p.adresse, version: p.version, marque: p.marque, blocs: p.blocs },
    projet: {
      nom: projetMarque?.name ?? p.marque.nom,
      dossier: projetMarque?.path ?? null,
      site: projetMarque?.adresseProduction ?? projetMarque?.devUrl ?? null,
    },
    charteRetenue: !!(projetMarque && charteRetenue(projetMarque.id)),
    brouillonEnCours: !!brouillonDe(p.id),
    commentairesOuverts: filsDe(p.id).filter((f) => !f.resolu).length,
  });
}

/**
 * « CRÉER LA CHARTE GRAPHIQUE » SANS CARTE (décision de l'utilisateur) : un document neuf et minimal — couverture,
 * sommaire, partie « Charte graphique » —, à la marque du projet (sa charte retenue s'il en a une, sinon un anthracite
 * d'attente que l'agent remplace dès le relevé du site), puis son agent, qui ouvre la conversation.
 */
export async function creerUneCharteVide(projectId: string): Promise<{ plaquetteId: string; agentId: string }> {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  const retenue = charteRetenue(projet.id);
  const { logoProjet, ...charte } = retenue ?? { logoProjet: undefined };
  const marque: Record<string, unknown> = { nom: projet.name, couleur: COULEUR_D_ATTENTE_DE_CHARTE, ...charte };
  /* Un logo retenu ailleurs (autre projet) ne se cite pas ici : l'agent le rejoindra au projet. */
  if (logoProjet && logoProjet !== projet.id) delete marque.logo;
  const auteur = projetDeLaSignature();
  if (auteur && auteur.id !== projet.id) marque.signature = auteur.name;
  else delete marque.signature;
  const cree = creerPlaquette({
    projectId: projet.id,
    projetMarqueId: projet.id,
    titre: `Charte graphique — ${projet.name}`,
    blocs: blocsDUneCharteNeuve(projet.name).map((b) => ({ ...b, id: crypto.randomBytes(5).toString('hex') })),
    marque,
  });
  if (!cree.ok) throw new Error(cree.raison);
  const { agentId } = await ouvrirLAgentDeCharte(cree.plaquette.id, { neuve: true });
  return { plaquetteId: cree.plaquette.id, agentId };
}
