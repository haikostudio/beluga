/**
 * CAPITALISER LES TÂCHES PROUVÉES — côté démon (règles pures dans
 * `shared/src/preuve-competence.ts` et `shared/src/contradiction-cartes.ts`).
 *
 * Le pool ne doit apprendre que de travail qui a TENU. Ce module ne juge rien
 * lui-même : il RELÈVE des faits — l'étape de contrôles d'une publication, le
 * passage en production, les cartes postérieures qui reviennent au même
 * endroit — et laisse les règles pures trancher.
 *
 * DEUX PORTES, une seule ligne d'écriture :
 *
 *   • LA NUIT. Après le rendez-vous d'amélioration, un agent d'ANALYSE relit
 *     les cartes devenues mûres, tous projets confondus, et n'écrit que par
 *     l'outil « competences » — donc à travers le contrôle de qualité.
 *   • LE FORÇAGE. Un bouton, dans le tiroir d'une carte terminée, saute
 *     l'ATTENTE et rien d'autre : les contrôles du projet doivent avoir été
 *     rejoués, la qualité de la fiche est vérifiée comme d'habitude, et la
 *     fiche naît en confiance basse.
 */

import {
  CARTES_PAR_NUIT_MAX,
  TITRE_CAPITALISATION,
  consigneDeCapitalisation,
  etatDeCapitalisation,
  premiereContradiction,
  type CarteComparable,
  type Card,
  type FaitsDeCarte,
  type JugementDeCapitalisation,
  type Project,
} from '@haikodev/shared';
import { canStartAgent } from './capacity.js';
import { lirePool } from './competences.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { createAgent, sendPrompt } from './runtime.js';
import * as store from './store.js';

/** L'instant du dernier passage de capitalisation, tenu ou seulement tenté. */
const CLE_DERNIER_PASSAGE = 'capitalisation.dernier-passage';

/** Un passage par jour, comme le rendez-vous d'amélioration. */
export const PERIODE_MS = 24 * 60 * 60 * 1000;

/** À quel rythme on regarde si le passage doit partir. */
export const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

/**
 * L'HEURE. Le rendez-vous d'amélioration part vers 3 h ; celui-ci vient APRÈS,
 * pour ne pas prendre sa place d'agent — la machine n'en fait pas deux de front
 * sans raison, et la nuit est assez longue pour les deux.
 */
export const HEURE_RENDEZ_VOUS = 5;
export const FENETRE_HEURES = 3;

let enCours = false;

/* ------------------------------------------------------------------ */
/* LES FAITS                                                            */
/* ------------------------------------------------------------------ */

/**
 * LES CONTRÔLES DU PROJET ONT-ILS ÉTÉ REJOUÉS ET RÉUSSIS SUR CETTE CARTE ?
 *
 * Ce n'est pas l'agent qui le dit — il dirait oui — c'est la PUBLICATION :
 * l'étape « verify » d'un déploiement rejoue les contrôles du projet, et son
 * état est écrit en base. Une carte qui n'est jamais passée par là n'a pas de
 * preuve, quoi qu'elle raconte.
 */
export function controlesReussisSur(card: Card): boolean {
  return store.recentDeploys(card.projectId, 50).some(
    (run) =>
      run.cardIds.includes(card.id) &&
      run.steps.some((etape) => etape.key === 'verify' && etape.state === 'done'),
  );
}

/**
 * DEPUIS QUAND LE TRAVAIL DE LA CARTE EST-IL EN LIGNE ? La publication de cible
 * « production » fait foi quand elle a nommé cette carte — c'était le cas tant
 * que la mise en production embarquait un lot ; à défaut, la date de mise en
 * ligne de la carte, posée par son déploiement.
 */
export function enProductionDepuis(card: Card): number | undefined {
  const miseEnProduction = store
    .recentDeploys(card.projectId, 50)
    .filter((run) => run.cible === 'production' && run.state === 'success' && run.cardIds.includes(card.id))
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))[0];
  if (miseEnProduction) return miseEnProduction.endedAt ?? miseEnProduction.startedAt;
  // Une carte archivée APRÈS avoir été déployée garde sa date de mise en
  // ligne : « Archivé » n'efface pas ce qui a servi. Une carte simplement
  // abandonnée, elle, n'a pas de `deployedAt` — et ne prouve donc rien.
  if (card.column === 'archived' && card.deployedAt) return card.deployedAt;
  return undefined;
}

/** Une carte, réduite à ce qui permet de la comparer à une autre. */
function comparable(card: Card): CarteComparable {
  return {
    id: card.id,
    titre: card.title,
    demande: card.description ?? '',
    fichiers: (card.github?.fichiers ?? []).map((f) => f.chemin),
    closeLe: card.doneAt ?? card.deployedAt ?? card.updatedAt,
  };
}

/** La fiche déjà née d'une carte, s'il y en a une : sa provenance le dit. */
export function ficheNeeDe(cardId: string): string | undefined {
  return lirePool().fiches.find((fiche) => fiche.provenance.carte === cardId)?.nom;
}

/**
 * TOUS LES FAITS D'UNE CARTE, relevés. `forcee` vient du geste de
 * l'utilisateur, jamais d'un calcul.
 */
export function faitsDeLaCarte(card: Card, options: { forcee?: boolean } = {}): FaitsDeCarte {
  const cette = comparable(card);
  const suivantes = store
    .listCards(card.projectId)
    .filter((autre) => autre.id !== card.id)
    .map(comparable)
    .filter((autre) => autre.closeLe > cette.closeLe);
  const contradiction = premiereContradiction(cette, suivantes);
  return {
    controlesReussis: controlesReussisSur(card),
    enProductionDepuis: enProductionDepuis(card),
    contrediteLe: contradiction?.carte.closeLe,
    contreditePar: contradiction?.carte.titre,
    ficheNee: ficheNeeDe(card.id),
    forcee: options.forcee,
  };
}

/** Où en est une carte, et POURQUOI — c'est ce que le tiroir affiche. */
export function jugementDeLaCarte(card: Card, options: { forcee?: boolean } = {}): JugementDeCapitalisation {
  return etatDeCapitalisation(faitsDeLaCarte(card, options), Date.now());
}

/**
 * LES CARTES MÛRES DE TOUS LES PROJETS, les plus anciennes d'abord. Une carte
 * dont une fiche est déjà née (« publiée ») n'y est plus : elle a donné ce
 * qu'elle avait.
 */
export function cartesMures(limite = CARTES_PAR_NUIT_MAX): { projet: Project; card: Card }[] {
  const trouvees: { projet: Project; card: Card; quand: number }[] = [];
  for (const projet of store.listProjects()) {
    if (projet.archived) continue;
    for (const card of store.listCards(projet.id)) {
      if (card.column !== 'archived') continue;
      const jugement = jugementDeLaCarte(card);
      if (jugement.etat !== 'mure') continue;
      trouvees.push({ projet, card, quand: card.deployedAt ?? card.doneAt ?? card.updatedAt });
    }
  }
  return trouvees
    .sort((a, b) => a.quand - b.quand)
    .slice(0, limite)
    .map(({ projet, card }) => ({ projet, card }));
}

/* ------------------------------------------------------------------ */
/* LE PASSAGE DE NUIT                                                   */
/* ------------------------------------------------------------------ */

export interface BilanDeCapitalisation {
  lance: boolean;
  raison?: string;
  cartes?: number;
}

function dernierPassage(): number | undefined {
  const brut = getMeta(CLE_DERNIER_PASSAGE);
  const valeur = brut ? Number(brut) : NaN;
  return Number.isFinite(valeur) ? valeur : undefined;
}

/**
 * LE RENDEZ-VOUS. Trois refus, tous dits : ce n'est pas l'heure, il n'y a pas
 * de place pour un agent, ou aucune carte n'est mûre — le cas le plus fréquent,
 * et ce n'est pas une panne.
 */
export async function rendezVousDeCapitalisation(force = false): Promise<BilanDeCapitalisation> {
  if (enCours) return { lance: false, raison: 'un passage de capitalisation tourne déjà' };

  const maintenant = Date.now();
  if (!force) {
    const heure = new Date(maintenant).getHours();
    if (heure < HEURE_RENDEZ_VOUS || heure >= HEURE_RENDEZ_VOUS + FENETRE_HEURES) {
      return { lance: false, raison: "ce n'est pas l'heure" };
    }
    const dernier = dernierPassage();
    if (dernier && maintenant - dernier < PERIODE_MS) {
      return { lance: false, raison: 'le passage du jour a déjà eu lieu' };
    }
    if (!canStartAgent().ok) return { lance: false, raison: 'aucune place pour un agent' };
  }

  const mures = cartesMures();
  if (!mures.length) {
    // La date est notée quand même : sans cela, on relirait toutes les cartes
    // de tous les projets toutes les dix minutes pour ne rien trouver.
    setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
    return { lance: false, raison: 'aucune carte n’est mûre : rien à capitaliser cette nuit' };
  }

  // La date est posée AVANT le tour : un agent lent ne doit pas être relancé dix
  // minutes plus tard.
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
  enCours = true;

  // L'agent vit sur le projet de la PREMIÈRE carte mûre — il lui faut un projet
  // d'accueil —, mais il relit les cartes de TOUS les projets : c'est tout
  // l'objet d'un pool partagé.
  const accueil = mures[0].projet;
  const agent = createAgent({
    projectId: accueil.id,
    // Rôle « analysis » : il ne modifie aucun code. Sa seule sortie est l'outil
    // d'écriture du pool.
    role: 'analysis',
    title: TITRE_CAPITALISATION,
  });

  try {
    await sendPrompt(
      agent.id,
      consigneDeCapitalisation(
        mures.map(({ projet, card }) => ({ id: card.id, projet: projet.name, titre: card.title })),
      ),
      { template: 'none', silent: true },
    );
  } catch (err: any) {
    log.error('capitalisation : le passage a échoué', err);
    return { lance: true, raison: err?.message ?? 'raison inconnue', cartes: mures.length };
  } finally {
    enCours = false;
  }

  log.info(`capitalisation : ${mures.length} carte(s) mûre(s) relue(s) sur ${accueil.name}`);
  return { lance: true, cartes: mures.length };
}

/**
 * LE FORÇAGE, depuis le tiroir d'une carte. Il saute l'ATTENTE, JAMAIS les
 * contrôles : une carte dont les contrôles du projet n'ont pas été rejoués est
 * refusée ici, avec sa raison.
 */
export async function capitaliserMaintenant(cardId: string): Promise<{ ok: boolean; raison?: string }> {
  const card = store.getCard(cardId);
  if (!card) return { ok: false, raison: 'carte introuvable' };
  const jugement = jugementDeLaCarte(card, { forcee: true });
  if (jugement.etat === 'publiee') return { ok: false, raison: jugement.raison };
  if (jugement.etat !== 'mure') return { ok: false, raison: jugement.raison };

  const projet = store.getProject(card.projectId);
  if (!projet) return { ok: false, raison: 'projet introuvable' };

  const agent = createAgent({ projectId: projet.id, role: 'analysis', title: TITRE_CAPITALISATION });
  try {
    await sendPrompt(
      agent.id,
      `${consigneDeCapitalisation([{ id: card.id, projet: projet.name, titre: card.title }])}\n\n` +
        `CETTE CAPITALISATION EST FORCÉE À LA MAIN : l'attente de sept jours est sautée, rien d'autre. ` +
        `La fiche naîtra en confiance basse tant que la preuve n'est pas complète.`,
      { template: 'none', silent: true },
    );
  } catch (err: any) {
    return { ok: false, raison: err?.message ?? 'le tour a échoué' };
  }
  return { ok: true };
}

/** La veille : elle regarde l'heure, et le rendez-vous fait le reste. */
export function planifierCapitalisation(): NodeJS.Timeout {
  return setInterval(() => {
    void rendezVousDeCapitalisation();
  }, PERIODE_DE_VEILLE_MS);
}
