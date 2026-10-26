/**
 * POSER UNE SUITE D'ÉTAPES — le clic qui valide une proposition à étapes.
 *
 * Les règles pures vivent dans `shared/src/suite-de-cartes.ts`, le suivi et
 * l'enchaînement dans `server/src/regroupements.ts` (`suivreLaSuite`). Ici, le
 * seul geste de NAISSANCE : une carte globale en tête, une carte par étape
 * dessous, toutes dans « Planifié », dans le même projet. Rien ne part : le
 * lancement de la carte globale reste un geste de l'utilisateur, et il vaut
 * pour toute la suite.
 */

import {
  Card,
  ComprehensionDeCarte,
  consigneDeLEtape,
  type Agent,
  type TaskProposal,
} from '@beluga/shared';

import { bus } from './bus.js';
import { log } from './logger.js';
import { releverLaSuite } from './regroupements.js';
import * as store from './store.js';
import { createCard } from './tools.js';

/**
 * LA CARTE QUI DEVIENT LA TÊTE, quand la suite est proposée par le CADRAGE
 * d'une carte encore en « Planifié » : c'est elle qu'on discutait, c'est elle
 * qui porte la demande — elle ne s'exécutera plus elle-même, elle groupera ses
 * étapes. Partout ailleurs (conversation, assistant, agent de tâche), une
 * carte globale neuve est posée.
 */
function carteDeCadrageReprise(agent: Agent, projectId: string): Card | null {
  if (agent.role !== 'cadrage' || !agent.cardId) return null;
  const carte = store.getCard(agent.cardId);
  if (!carte || carte.projectId !== projectId || carte.column !== 'planned') return null;
  if (carte.cartesFilles?.length || carte.carteMereId || carte.rangDansLaSuite) return null;
  return carte;
}

export function poserLaSuite(input: {
  projectId: string;
  proposal: TaskProposal;
  retenu: { title: string; description: string; labels: string[]; run?: Card['run'] };
  agent: Agent;
  origineAt: number;
}): Card {
  const { projectId, proposal, retenu, agent, origineAt } = input;
  const etapes = proposal.etapes ?? [];
  const maintenant = store.now();

  const reprise = carteDeCadrageReprise(agent, projectId);
  const tete =
    reprise ??
    createCard(projectId, {
      title: retenu.title,
      description: retenu.description,
      labels: retenu.labels,
      ...(retenu.run ? { run: retenu.run } : {}),
      origin: 'agent',
      attachments: proposal.attachments,
      briefing: proposal.briefing,
      auteur: 'chef',
      // Une carte globale n'annonce aucun créneau : elle ne part qu'au clic.
      cadrage: true,
      departPrevu: proposal.departPrevu,
      origineAgentId: agent.id,
      origineAt,
    });

  /*
   * CHAQUE ÉTAPE NAÎT CADRÉE : sa compréhension validée est la description
   * jugée de sa proposition, et sa synthèse ouvre sa conversation, précédée de
   * la consigne qui la situe dans la suite. Une étape n'a pas de cadrage à elle,
   * comme une fille de projet réuni — elle part sans attendre un tour de plus.
   */
  const titres = etapes.map((etape) => etape.title);
  const filles = etapes.map((etape, index) => {
    const rang = index + 1;
    const consigne = consigneDeLEtape(rang, titres, tete.title);
    const carte = createCard(projectId, {
      title: etape.title,
      description: etape.description,
      labels: etape.labels,
      ...(etape.run ?? retenu.run ? { run: etape.run ?? retenu.run } : {}),
      origin: 'agent',
      attachments: proposal.attachments,
      briefing: [consigne, '', (etape.briefing || etape.description).trim()].join('\n'),
      auteur: 'chef',
      cadrage: true,
      origineAgentId: agent.id,
      origineAt,
    });
    return store.saveCard({
      ...carte,
      carteMereId: tete.id,
      rangDansLaSuite: rang,
      parcours: {
        ...(carte.parcours ?? { plans: [] }),
        plans: carte.parcours?.plans ?? [],
        comprehension: ComprehensionDeCarte.parse({ texte: etape.description || etape.title, at: maintenant }),
        comprehensionValidee: { at: maintenant, comprehensionAt: maintenant, niveau: etape.run?.niveau },
      },
    });
  });

  const posee = store.saveCard({
    ...(store.getCard(tete.id) ?? tete),
    teteDeSuite: true,
    /* LA CARTE GLOBALE NE PUBLIE RIEN : elle n'a aucun code à elle. Elle suit
       ses étapes jusqu'en « À déployer », sans jamais entrer dans le lot. */
    excludedFromDeploy: true,
    cartesFilles: filles.map((fille) => ({ projectId: fille.projectId, cardId: fille.id })),
  });
  bus.emit({ type: 'card.upsert', card: posee });
  for (const fille of filles) bus.emit({ type: 'card.upsert', card: fille });
  releverLaSuite(posee);
  log.info(
    `suite « ${posee.title} » posée${reprise ? ' sur la carte cadrée' : ''} : ${filles.length} étape(s) — ` +
      filles.map((f) => f.title).join(' ; '),
  );
  return store.getCard(posee.id) ?? posee;
}
