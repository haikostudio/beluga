/**
 * LA CARTE D'UN AGENT QUE LE DÉMON LANCE LUI-MÊME.
 *
 * Certains agents ne naissent d'aucun clic sur « Lancer » : l'analyse d'un site
 * à sauvegarder, sa réparation après des échecs, l'assistant qui configure une
 * nouvelle fiche, le rendez-vous d'auto-amélioration de la nuit. Ils tournaient
 * SANS carte : rien sur le tableau ne disait qu'un agent travaillait, et leur
 * conversation ne s'ouvrait que depuis la fenêtre qui les avait lancés — ou
 * pas du tout. Constaté le 11.09.2026 : une analyse de backup tournait sur
 * ProjetE sans qu'aucune fenêtre permette de la suivre, et le rendez-vous de
 * 5 h 35 était tombé sur une session expirée sans rien laisser au tableau.
 *
 * RIEN NE TOURNE PLUS SANS SE VOIR. Chacun de ces agents reçoit une carte AVANT
 * de naître : elle entre directement dans « En cours », avec sa marque de vol
 * (le balayage des cartes oubliées ne la ferme donc pas pendant les secondes
 * où l'agent n'a pas encore démarré), et l'agent est créé AVEC son identifiant.
 *
 * CES CARTES N'ONT NI BRANCHE NI COPIE DE TRAVAIL : l'agent ne livre pas de
 * code. Sans `workdir`, le tour vit dans le dossier du projet
 * (`dossierDuTour`), la fin de tour ne referme aucun dossier, et la
 * publication ignore une carte sans branche (`deploy.ts` ne fusionne que
 * `card.github.branch`).
 */
import { metriquesSessionLlmIndisponibles, type AgentRole, type Card, type ColumnKey } from '@beluga/shared';
import { bus } from './bus.js';
import { rangerLaCarte } from './deplacement-carte.js';
import { createAgent } from './runtime.js';
import * as store from './store.js';
import { createCard } from './tools.js';

export interface DepartAvecCarte {
  card: Card;
  agentId: string;
}

/**
 * Pose la carte dans « En cours », crée l'agent rattaché, et rend les deux. Le
 * tour n'est PAS envoyé ici : l'appelant garde la main sur sa demande et ses
 * options.
 */
export function ouvrirCarteDAgent(entree: {
  projectId: string;
  titre: string;
  description: string;
  labels: string[];
  role: AgentRole;
  /** Le titre de la conversation, quand il diffère de celui de la carte. */
  titreAgent?: string;
  run?: Parameters<typeof createAgent>[0]['run'];
}): DepartAvecCarte {
  const nee = createCard(entree.projectId, {
    title: entree.titre,
    description: entree.description,
    labels: entree.labels,
    origin: 'agent',
    run: entree.run as Partial<Card['run']> | undefined,
    // Aucun créneau conseillé : cette carte part À L'INSTANT, elle n'attend
    // aucune date (`createCard`, option `cadrage`).
    cadrage: true,
  });
  const agent = createAgent({
    projectId: entree.projectId,
    role: entree.role,
    title: entree.titreAgent ?? entree.titre,
    cardId: nee.id,
    run: entree.run,
  });
  const card = store.saveCard({
    ...nee,
    column: 'running',
    position: store.nextPosition(entree.projectId, 'running'),
    agentId: agent.id,
    scheduling: {
      ...(nee.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      attempts: 1,
      tourEnVolDepuis: Date.now(),
      departPrevu: undefined,
      creneauConseille: undefined,
      creneauAutomatique: undefined,
      waitingReason: undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card });
  return { card, agentId: agent.id };
}

/**
 * RANGE LA CARTE D'UN AGENT DU DÉMON, avec sa phrase. Ne touche à rien si la
 * carte a déjà quitté « En cours » ou si un autre agent la tient : la fin de
 * tour ordinaire, le balayage ou un geste humain sont passés avant.
 */
export function rangerCarteDAgent(
  cardId: string,
  agentId: string,
  cible: Extract<ColumnKey, 'to_deploy' | 'planned' | 'archived'>,
  raison: string | null,
): Card | null {
  const card = store.getCard(cardId);
  if (!card || card.column !== 'running' || card.agentId !== agentId) return null;
  const rangee = rangerLaCarte(card, cible);
  const finale = store.saveCard({
    ...rangee,
    // « Archivé » n'est pas dans COLONNES_DE_CLOTURE (ce nom-là veut dire
    // « réouvrable en écrivant un message », ce qu'une carte archivée n'est
    // JAMAIS — voir suivi-colonne.ts) : `rangerLaCarte` ne lui pose donc ni
    // date de fin ni photographie par défaut. Cette carte-ci saute directement
    // « À déployer » ; sans ce complément elle resterait sans date dans le
    // tiroir des archives, comme si elle n'avait jamais fini.
    doneAt: cible === 'archived' ? (rangee.doneAt ?? Date.now()) : rangee.doneAt,
    llmSessionMetrics:
      cible === 'archived' && !rangee.llmSessionMetrics
        ? metriquesSessionLlmIndisponibles('unavailable')
        : rangee.llmSessionMetrics,
    scheduling: {
      ...(rangee.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      tourEnVolDepuis: undefined,
      waitingReason: raison ?? undefined,
    },
  });
  bus.emit({ type: 'card.upsert', card: finale });
  return finale;
}

/**
 * UN TOUR TOMBÉ SE DIT SUR LA CARTE, AVEC SON MOTIF, ET ELLE NE PASSE PAS POUR
 * TERMINÉE. Elle revient en « Planifié » avec la phrase qui dit pourquoi. Un
 * agent encore au travail n'est jamais dérangé : ce n'est alors pas une panne.
 */
export function direLaPanneSurLaCarte(cardId: string, agentId: string, motif: string): Card | null {
  const agent = store.getAgent(agentId);
  if (agent && (agent.status === 'running' || agent.status === 'starting')) return null;
  const propre = (motif ?? '').replace(/\s+/g, ' ').trim() || 'raison inconnue';
  return rangerCarteDAgent(
    cardId,
    agentId,
    'planned',
    `Le tour de l’agent est tombé sans aboutir : ${propre.length > 240 ? `${propre.slice(0, 239)}…` : propre}`,
  );
}
