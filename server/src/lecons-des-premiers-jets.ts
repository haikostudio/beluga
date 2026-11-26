/**
 * LES LEÇONS DES PREMIERS JETS — le passage de nuit, côté démon (règles pures dans
 * `shared/src/lecons-des-premiers-jets.ts`).
 *
 * Vers 6 h, APRÈS le ménage des compétences (5 h), le démon relève sur TOUS les projets ouverts (hors Beluga Build
 * lui-même) les cartes nées depuis le dernier passage qui REPRENNENT un travail livré, et confie leur lecture à un agent
 * d'ANALYSE. Il n'écrit que par l'outil « competences » — donc à travers la porte de qualité du pool — dans la compétence
 * commune `lecons-des-premiers-jets` (et `vitrine-de-produit-d-un-seul-jet`). Écriture AUTOMATIQUE, sans validation :
 * décision de l'utilisateur du 26/11/2026. Le matin, une carte de RÉSUMÉ, VISIBLE, posée dans « Planifié » de Beluga
 * Build, dit ce qui a été appris et de quel projet ; écrire à cette carte retire une leçon. Rien appris : pas de carte.
 *
 * Comme les autres passages de nuit : un seul à la fois, la date notée AVANT le lancement, et le moindre échec
 * journalisé plutôt que propagé.
 */

import {
  COMPETENCE_DES_LECONS,
  DESCRIPTION_DU_PASSAGE_DES_LECONS,
  FENETRE_DES_LECONS_HEURES,
  HEURE_DES_LECONS,
  LABEL_LECONS_DES_PREMIERS_JETS,
  LABEL_RENDEZ_VOUS_DE_NUIT,
  TITRE_DU_PASSAGE_DES_LECONS,
  consigneDesLecons,
  descriptionDuResumeDesLecons,
  lireLeBilanDesLecons,
  reprisesDepuis,
  sansRegroupements,
  titreDuResumeDesLecons,
  type CarteRelue,
  type LeconDeLaNuit,
  type Project,
  type Reprise,
} from '@beluga/shared';
import { canStartAgent } from './capacity.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { panneDuTour } from './auto-amelioration.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent, rangerCarteDAgent } from './carte-d-agent-demon.js';
import { createCard } from './tools.js';
import { sendPrompt } from './runtime.js';
import * as store from './store.js';

const CLE_DERNIER_PASSAGE = 'lecons-des-premiers-jets.dernier-passage';
const JOUR_MS = 24 * 60 * 60 * 1000;
export const PERIODE_DE_VEILLE_DES_LECONS_MS = 10 * 60 * 1000;

let enCours = false;

/** Une carte, à plat : sa demande puis ce que le cadrage en a compris. */
export function carteRelue(card: { id: string; title: string; description?: string | null; createdAt: number; parcours?: unknown }, projet: string): CarteRelue {
  const comprehension = (card.parcours as { comprehension?: { texte?: unknown } } | undefined)?.comprehension?.texte;
  return {
    id: card.id,
    projet,
    titre: card.title,
    texte: `${card.description ?? ''}\n${typeof comprehension === 'string' ? comprehension : ''}`,
    creeeLe: card.createdAt,
  };
}

/** Les cartes de reprise des projets ouverts, nées depuis `depuis`. */
export function reprisesDeLaNuit(depuis: number): Reprise[] {
  const projets = sansRegroupements(store.listProjects()).filter((p) => !p.archived);
  const exclus = projets.filter((p) => p.isSelf).map((p) => p.name);
  const cartes: CarteRelue[] = [];
  for (const projet of projets) {
    if (projet.isSelf) continue;
    for (const card of store.listCards(projet.id)) cartes.push(carteRelue(card, projet.name));
  }
  return reprisesDepuis(cartes, depuis, exclus);
}

function dernierPassage(): number | undefined {
  const valeur = Number(getMeta(CLE_DERNIER_PASSAGE) ?? NaN);
  return Number.isFinite(valeur) ? valeur : undefined;
}

/** Beluga Build lui-même : c'est là que l'agent travaille et que la carte du matin se pose. */
function projetDeBeluga(): Project | undefined {
  return store.listProjects().find((p) => p.isSelf && !p.archived);
}

/** La dernière réponse de l'agent (son bilan json). */
function derniereReponse(agentId: string): string {
  const reponses = store.listMessages(agentId, 50).filter((m) => m.role === 'assistant');
  return reponses[reponses.length - 1]?.content ?? '';
}

export interface BilanDesLecons {
  lance: boolean;
  raison?: string;
  reprises?: number;
  lecons?: LeconDeLaNuit[];
}

/** LE RENDEZ-VOUS. Refus dits : pas l'heure, déjà passé aujourd'hui, pas de place, rien à relire. */
export async function rendezVousDesLecons(force = false): Promise<BilanDesLecons> {
  if (enCours) return { lance: false, raison: 'un passage des leçons tourne déjà' };
  const maintenant = Date.now();
  const dernier = dernierPassage();
  if (!force) {
    const heure = new Date(maintenant).getHours();
    if (heure < HEURE_DES_LECONS || heure >= HEURE_DES_LECONS + FENETRE_DES_LECONS_HEURES) return { lance: false, raison: "ce n'est pas l'heure" };
    if (dernier && maintenant - dernier < JOUR_MS) return { lance: false, raison: 'le passage du jour a déjà eu lieu' };
    if (!canStartAgent().ok) return { lance: false, raison: 'aucune place pour un agent' };
  }
  enCours = true;
  try {
    const reprises = reprisesDeLaNuit(dernier ?? maintenant - JOUR_MS);
    // Notée AVANT le tour, même sans rien à relire : un agent lent ne doit pas être relancé dix minutes plus tard.
    setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
    if (!reprises.length) return { lance: false, raison: 'aucune reprise de premier jet depuis le dernier passage', reprises: 0 };
    const beluga = projetDeBeluga();
    if (!beluga) return { lance: false, raison: 'Beluga Build introuvable pour accueillir l’agent' };

    const { card, agentId } = ouvrirCarteDAgent({
      projectId: beluga.id,
      titre: TITRE_DU_PASSAGE_DES_LECONS,
      description: DESCRIPTION_DU_PASSAGE_DES_LECONS,
      labels: [LABEL_RENDEZ_VOUS_DE_NUIT],
      role: 'analysis',
    });
    let panne: string | null = null;
    try {
      await sendPrompt(agentId, consigneDesLecons({ reprises }), { template: 'none', silent: true });
    } catch (err: any) {
      log.error('leçons des premiers jets : le passage a échoué', err);
      panne = err?.message ?? 'raison inconnue';
    }
    panne ??= panneDuTour(agentId);
    if (panne) {
      direLaPanneSurLaCarte(card.id, agentId, panne);
      return { lance: true, raison: panne, reprises: reprises.length };
    }
    const lecons = lireLeBilanDesLecons(derniereReponse(agentId));
    rangerCarteDAgent(card.id, agentId, 'archived', lecons.length ? `${lecons.length} leçon(s) écrite(s) dans « ${COMPETENCE_DES_LECONS} ».` : 'Rien de nouveau à retenir cette nuit.');
    if (lecons.length) {
      /* LA CARTE DU MATIN, VISIBLE : elle naît dans « Planifié » de Beluga Build ; lui écrire retire une leçon. */
      createCard(beluga.id, {
        title: titreDuResumeDesLecons(lecons),
        description: descriptionDuResumeDesLecons(lecons),
        labels: [LABEL_RENDEZ_VOUS_DE_NUIT, LABEL_LECONS_DES_PREMIERS_JETS],
        origin: 'agent',
      });
    }
    log.info(`leçons des premiers jets : ${reprises.length} reprise(s) relue(s), ${lecons.length} leçon(s) écrite(s)`);
    return { lance: true, reprises: reprises.length, lecons };
  } catch (err) {
    log.warn(`leçons des premiers jets : passage abandonné — ${(err as Error).message}`);
    return { lance: false, raison: (err as Error).message };
  } finally {
    enCours = false;
  }
}

/** La veille : elle regarde l'heure, et le rendez-vous fait le reste. */
export function planifierLeconsDesPremiersJets(): NodeJS.Timeout {
  return setInterval(() => {
    void rendezVousDesLecons();
  }, PERIODE_DE_VEILLE_DES_LECONS_MS);
}
