/**
 * LE PARCOURS COMMUN DE NAISSANCE D'UNE CARTE (MEM-3555).
 *
 * Qu'elle vienne de l'utilisateur ou d'un agent, une carte suit le même chemin :
 *  1. elle naît avec sa DEMANDE lisible (`createCard` la compose au besoin,
 *     `demandeDeNaissance`), qui ouvre sa conversation ;
 *  2. son agent de CADRAGE naît (`ouvrirLeCadrage`) et le jalon « Demande »
 *     s'écrit aussitôt ;
 *  3. pour une carte posée par un agent — personne n'a tapé de premier
 *     message —, un premier tour silencieux part jusqu'à la compréhension,
 *     jamais au-delà : RIEN ne se lance sans clic (MEM-0354), aucune date ne
 *     se pose (DEC-034).
 *
 * Ce module porte aussi les deux rattrapages des cartes posées avant la règle,
 * et la reprise du cadrage après un déplacement de projet par l'agent.
 */

import {
  COLONNES_AVANT_LE_TRAVAIL,
  LABEL_AUTO_AMELIORATION,
  LABEL_MARKETING,
  carteSansDemande,
  demandeAfficheeDeProposition,
  demandeDeCadrageApresDeplacement,
  demandeDeCadrageDeNaissance,
  demandeDeNaissance,
  type Agent,
  type AuteurDeCarte,
  type Card,
} from '@beluga/shared';
import { bus } from './bus.js';
import { ouvrirLeCadrage } from './cadrage.js';
import { ajouterAuJournal, phaseDeLaCarte } from './journal-carte.js';
import { log } from './logger.js';
import { agentsActifs, sendPrompt } from './runtime.js';
import * as store from './store.js';
import { createCard } from './tools.js';

type EntreeDeCarte = Parameters<typeof createCard>[1];

/**
 * FAIRE NAÎTRE UNE CARTE PAR LE PARCOURS COMMUN. Rend la carte dès qu'elle est
 * posée et son cadrage ouvert ; le premier tour, lui, n'est pas attendu.
 */
export async function faireNaitreLaCarte(
  projectId: string,
  entree: EntreeDeCarte & { auteur: AuteurDeCarte },
  options: { premierTour?: boolean } = {},
): Promise<{ card: Card; cadrage: Agent | null }> {
  const card = createCard(projectId, entree);
  bus.emit({ type: 'card.upsert', card });
  const cadrage = await ouvrirLeCadrageDeLaCarte(card, entree.auteur, options.premierTour ?? true);
  return { card: store.getCard(card.id) ?? card, cadrage };
}

/**
 * OUVRIR LE CADRAGE D'UNE CARTE DÉJÀ POSÉE : l'agent, le jalon « Demande »,
 * puis — si demandé — le premier tour silencieux. Une carte qui a déjà un agent
 * n'est pas touchée (deux fils sur une carte, ce serait deux endroits où
 * répondre).
 */
export async function ouvrirLeCadrageDeLaCarte(
  card: Card,
  auteur: AuteurDeCarte,
  premierTour: boolean,
): Promise<Agent | null> {
  if (store.getLastAgentByCard(card.id)) return null;
  const cadrage = await ouvrirLeCadrage(card.id).catch((err) => {
    log.warn(`naissance de carte : cadrage impossible à ouvrir pour « ${card.title} »`, err);
    return null;
  });
  if (!cadrage) return null;
  const demande = demandeAfficheeDeProposition(card);
  const jalon = ajouterAuJournal({
    cardId: card.id,
    phase: phaseDeLaCarte(card.id, cadrage.role),
    nature: 'jalon',
    libelle: 'Demande',
    agentId: cadrage.id,
    agentRole: cadrage.role,
    resultat: demande.texte,
    donnees: demande.resume ? { resumeDemande: demande.resume } : undefined,
  });
  if (jalon) bus.emit({ type: 'journal.entree', entree: jalon });
  if (premierTour) {
    /* `silent` : la demande ouvre DÉJÀ la conversation (`filAvecLaSynthese`),
       une bulle d'utilisateur la redirait. Passe par `sendPrompt` : choix du
       compte, file d'attente faute de quota. */
    void sendPrompt(cadrage.id, demandeDeCadrageDeNaissance(card, auteur), { template: 'none', silent: true }).catch(
      (err) => log.error(`le cadrage de « ${card.title} » n'a pas pu partir`, err),
    );
  }
  return cadrage;
}

/* ------------------------------------------------------------------ */
/* Les cartes posées AVANT la règle                                    */
/* ------------------------------------------------------------------ */

/**
 * AU DÉMARRAGE : chaque carte d'avant le travail qui aurait dû naître avec une
 * demande la reçoit — texte seulement, AUCUN agent ni tour moteur (rien ne part
 * au moteur en masse). Idempotent : une carte qui a sa demande n'est plus
 * candidate. Rend le nombre de cartes complétées.
 */
export function completerLesDemandesManquantes(): number {
  let completees = 0;
  for (const projet of store.listProjects(true)) {
    for (const card of store.listCards(projet.id)) {
      if (!COLONNES_AVANT_LE_TRAVAIL.includes(card.column) || card.archivedAt) continue;
      if (!carteSansDemande(card)) continue;
      /* Une conversation déjà commencée a SA demande : le premier message. */
      if (store.agentsDeLaCarte(card.id).some((agent) => store.listMessages(agent.id).length > 0)) continue;
      const briefing = demandeDeNaissance(card, card.labels.includes(LABEL_MARKETING) ? 'marketing' : undefined);
      if (!briefing) continue;
      const completee = store.saveCard({ ...card, briefing });
      bus.emit({ type: 'card.upsert', card: completee });
      completees += 1;
    }
  }
  return completees;
}

/**
 * À L'OUVERTURE : une carte posée par un agent, restée sans conversation,
 * reçoit sa demande, son cadrage et son premier tour — sous les yeux de
 * l'utilisateur, une carte à la fois. Les cartes de la nuit ont leur propre
 * rattrapage (`rattraperLeCadrageDeLaNuit`) ; une carte née d'une demande
 * client a sa rédaction (`redigerLaTache`).
 */
export async function rattraperLaCarteSansCadrage(card: Card): Promise<boolean> {
  if (card.column !== 'planned' || card.origin !== 'agent') return false;
  if (card.labels.includes(LABEL_AUTO_AMELIORATION) || card.demandeClientId) return false;
  if (card.agentId || card.conversationAgentId || store.getLastAgentByCard(card.id)) return false;
  const auteur: AuteurDeCarte = card.labels.includes(LABEL_MARKETING) ? 'marketing' : 'agent';
  let carte = card;
  if (carteSansDemande(card)) {
    carte = store.saveCard({ ...card, briefing: demandeDeNaissance(card, auteur) });
    bus.emit({ type: 'card.upsert', card: carte });
  }
  return (await ouvrirLeCadrageDeLaCarte(carte, auteur, true)) !== null;
}

/* ------------------------------------------------------------------ */
/* La reprise du cadrage dans le projet d'accueil                      */
/* ------------------------------------------------------------------ */

const ATTENTE_MAX_FIN_DE_TOUR_MS = 2 * 60 * 60 * 1000;
const reprisesEnAttente = new Set<string>();

/**
 * LE CADRAGE REPREND DANS LE PROJET D'ACCUEIL, UNE FOIS LE TOUR EN COURS FINI.
 *
 * L'agent qui a déplacé la carte est encore dans son tour, ouvert sur le dépôt
 * et la mémoire de l'ancien projet. On attend qu'il le referme, puis on efface
 * sa session (le moteur l'aurait réécrite en fin de tour) et un premier tour
 * silencieux repart dans le nouveau projet, avec la demande et ce qui était
 * déjà compris. Une seule reprise en attente par agent.
 */
export function reprendreLeCadrageApresDeplacement(
  agentId: string,
  cardId: string,
  etat: { depuis: string; vers: string; raison?: string },
  delaiMs = 1000,
): void {
  if (reprisesEnAttente.has(agentId)) return;
  reprisesEnAttente.add(agentId);
  const debut = Date.now();
  const essayer = () => {
    if (agentsActifs().includes(agentId)) {
      if (Date.now() - debut > ATTENTE_MAX_FIN_DE_TOUR_MS) {
        reprisesEnAttente.delete(agentId);
        log.warn(`déplacement : le tour de ${agentId} ne s'est pas refermé, le cadrage ne reprend pas tout seul`);
        return;
      }
      setTimeout(essayer, delaiMs).unref?.();
      return;
    }
    reprisesEnAttente.delete(agentId);
    const card = store.getCard(cardId);
    const agent = store.getAgent(agentId);
    if (!card || !agent || agent.projectId !== card.projectId) return;
    store.clearSessions(agentId);
    const prompt = demandeDeCadrageApresDeplacement({
      ...etat,
      title: card.title,
      briefing: card.briefing,
      description: card.description,
      comprehension: card.parcours?.comprehension?.texte,
    });
    void sendPrompt(agentId, prompt, { template: 'none', silent: true }).catch((err) =>
      log.error(`la reprise du cadrage de « ${card.title} » dans « ${etat.vers} » n'a pas pu partir`, err),
    );
  };
  setTimeout(essayer, delaiMs).unref?.();
}
