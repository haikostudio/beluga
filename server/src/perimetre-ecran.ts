import {
  detailDansLePerimetre,
  reperesDeLEvenement,
  retenirDansLePerimetre,
  type ClientEnvelope,
  type LieuDEvenement,
  type PerimetreDEcran,
  type ServerEvent,
} from '@beluga/shared';
import * as store from './store.js';

/*
 * LE PÉRIMÈTRE D'UN ÉCRAN, CÔTÉ DÉMON (`shared/src/perimetre-ecran.ts`).
 *
 * Le canal (`ws.ts`) tient un périmètre par écran connecté et le consulte à
 * chaque envoi : le DÉTAIL du travail d'un agent ne part que vers l'écran qui
 * affiche son projet, ou qui a demandé cette conversation ou cette carte.
 */

/** De quoi situer un agent ou une carte. La base par défaut ; un test en passe d'autres. */
export interface LecturesDuPerimetre {
  agent(id: string): { projectId?: string | null; cardId?: string | null } | null | undefined;
  carte(id: string): { projectId?: string | null } | null | undefined;
}

const LECTURES_DE_LA_BASE: LecturesDuPerimetre = {
  agent: (id) => store.getAgent(id),
  carte: (id) => store.getCard(id),
};

/**
 * OÙ SE PASSE UN ÉVÉNEMENT DE DÉTAIL : son agent, sa carte, son projet. Lu
 * UNE fois par événement, quel que soit le nombre d'écrans connectés — le bus
 * présente le même objet à chacun.
 */
const lieuxDesEvenements = new WeakMap<object, LieuDEvenement>();

function lieuDeLEvenement(event: ServerEvent, reperes: LieuDEvenement, lire: LecturesDuPerimetre): LieuDEvenement {
  const connu = lieuxDesEvenements.get(event);
  if (connu) return connu;
  const lieu: LieuDEvenement = { ...reperes };
  try {
    if (lieu.agentId) {
      const agent = lire.agent(lieu.agentId);
      lieu.projectId = agent?.projectId ?? null;
      lieu.cardId = lieu.cardId ?? agent?.cardId ?? null;
    } else if (lieu.cardId) {
      lieu.projectId = lire.carte(lieu.cardId)?.projectId ?? null;
    }
  } catch {
    // Illisible : le lieu reste inconnu, et un lieu inconnu part toujours.
  }
  lieuxDesEvenements.set(event, lieu);
  return lieu;
}

/** Cet événement doit-il partir vers cet écran ? Seul le DÉTAIL est trié. */
export function detailPourCetEcran(
  event: ServerEvent,
  perimetre: PerimetreDEcran,
  lire: LecturesDuPerimetre = LECTURES_DE_LA_BASE,
): boolean {
  const reperes = reperesDeLEvenement(event);
  if (!reperes) return true;
  // Demandé nommément par cet écran : aucune lecture de base à faire.
  if (reperes.agentId && perimetre.agents.has(reperes.agentId)) return true;
  if (reperes.cardId && perimetre.cartes.has(reperes.cardId)) return true;
  return detailDansLePerimetre(lieuDeLEvenement(event, reperes, lire), perimetre);
}

/** Le périmètre tel que le canal le tient : le même, mais qu'on peut élargir. */
export interface PerimetreOuvert {
  projet: string | null;
  agents: Set<string>;
  cartes: Set<string>;
}

/** Ce qu'une commande de l'écran dit de ce qu'il regarde. */
export function elargirLePerimetre(perimetre: PerimetreOuvert, cmd: ClientEnvelope['cmd']): void {
  switch (cmd.type) {
    case 'project.open':
      perimetre.projet = cmd.id;
      break;
    case 'agent.open':
      retenirDansLePerimetre(perimetre.agents, cmd.id);
      break;
    case 'card.conversation':
    case 'card.journal':
      retenirDansLePerimetre(perimetre.cartes, cmd.cardId);
      break;
    case 'ecran.perimetre':
      for (const id of cmd.agents ?? []) retenirDansLePerimetre(perimetre.agents, id);
      for (const id of cmd.cartes ?? []) retenirDansLePerimetre(perimetre.cartes, id);
      break;
    default:
      break;
  }
}
