/**
 * LE MÉNAGE DE NUIT DU POOL — côté démon (règles pures dans
 * `shared/src/menage-competences.ts` et `shared/src/contradiction-cartes.ts`).
 *
 * Les fiches naissent désormais à la fin de chaque tâche (consigne du rôle de
 * tâche, `server/src/runtime.ts`) : la nuit ne crée plus, elle RANGE. Ce module
 * ne juge rien lui-même : il RELÈVE les fiches écrites depuis le dernier passage
 * et celles dont la carte d'origine a été contredite depuis, puis confie le
 * ménage à un agent d'ANALYSE qui n'écrit que par l'outil « competences » —
 * donc à travers le contrôle de qualité de la porte d'écriture.
 *
 * Depuis le 2026-10-06, il relève AUSSI les éléments d'interface du même genre
 * dans le code de plusieurs projets (`server/src/recurrences-du-code.ts`) : la
 * nuit en tire la fiche COMMUNE qui manquait, et y relie les fiches propres.
 *
 * Il remplace la capitalisation des tâches prouvées (DEC-104, remplacée le
 * 2026-10-02) et garde son créneau : vers 5 h, après le rendez-vous
 * d'amélioration de 3 h.
 */

import fs from 'node:fs';
import {
  TITRE_MENAGE,
  annonceeEnTeteDeSession,
  consigneDuMenage,
  ficheEnService,
  menageNecessaire,
  premiereContradiction,
  type CarteComparable,
  type Card,
  type Competence,
  type FicheARevoir,
  type FicheTouchee,
  type Project,
} from '@beluga/shared';
import { canStartAgent } from './capacity.js';
import { lirePool } from './competences.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { releverLesRecurrencesDuCode } from './recurrences-du-code.js';
import { createAgent, sendPrompt } from './runtime.js';
import * as store from './store.js';

/**
 * L'instant du dernier passage, tenu ou seulement tenté. La clé est celle de
 * l'ancienne capitalisation : le premier ménage ne relit donc que ce qui a été
 * écrit depuis le dernier passage de nuit, pas le pool depuis sa naissance.
 */
const CLE_DERNIER_PASSAGE = 'capitalisation.dernier-passage';

/**
 * L'INVENTAIRE INITIAL DU CODE est fait une fois, puis seuls comptent les rôles
 * dont un fichier a changé depuis le dernier passage. Sa clé est À PART : celle
 * du passage existe déjà sur la machine, et le premier relevé du code doit
 * pourtant voir tout l'existant (le sélecteur de période de HaikoNote n'a pas
 * bougé depuis des semaines).
 */
const CLE_INVENTAIRE_DU_CODE = 'competences.inventaire-du-code';

/** Un passage par jour, comme le rendez-vous d'amélioration. */
export const PERIODE_MS = 24 * 60 * 60 * 1000;

/** À quel rythme on regarde si le passage doit partir. */
export const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

/**
 * L'HEURE. Le rendez-vous d'amélioration part vers 3 h ; celui-ci vient APRÈS,
 * pour ne pas prendre sa place d'agent.
 */
export const HEURE_RENDEZ_VOUS = 5;
export const FENETRE_HEURES = 3;

/**
 * JUSQU'OÙ ON CHERCHE UNE CONTRADICTION. Comparer chaque fiche à toutes les
 * cartes de son projet coûte : on ne regarde que les fiches nées d'une carte
 * close depuis moins d'un mois — au-delà, une fiche a eu le temps d'être
 * corrigée par les tâches qui l'ont servie.
 */
export const FENETRE_DE_CONTRADICTION_MS = 30 * 24 * 60 * 60 * 1000;

let enCours = false;

/* ------------------------------------------------------------------ */
/* LES FAITS                                                            */
/* ------------------------------------------------------------------ */

/** Les fiches MAISON en service : une fiche de bibliothèque ne se range pas ici. */
function fichesMaison(): Competence[] {
  return lirePool().fiches.filter((fiche) => ficheEnService(fiche.etat) && annonceeEnTeteDeSession(fiche));
}

/** La dernière écriture du mode d'emploi d'une fiche (0 si illisible). */
function dateDuFichier(fiche: Competence): number {
  try {
    return fs.statSync(fiche.fichier).mtimeMs;
  } catch {
    return 0;
  }
}

/** Les fiches dont le mode d'emploi a changé depuis `depuis` (date du fichier sur le disque). */
export function fichesTouchees(depuis: number, fiches = fichesMaison()): FicheTouchee[] {
  return fiches.filter((fiche) => dateDuFichier(fiche) > depuis).map((fiche) => ({ nom: fiche.nom, projets: fiche.projets }));
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

/**
 * LES FICHES NÉES D'UN TRAVAIL DÉFAIT DEPUIS. Leur carte d'origine (provenance)
 * est comparée aux cartes POSTÉRIEURES de son projet ; la contradiction ne se
 * déclare qu'au croisement de deux signaux (`premiereContradiction`).
 */
export function fichesARevoir(maintenant = Date.now(), fiches = fichesMaison()): FicheARevoir[] {
  const aRevoir: FicheARevoir[] = [];
  const cartesParProjet = new Map<string, CarteComparable[]>();
  for (const fiche of fiches) {
    const carte = fiche.provenance.carte ? store.getCard(fiche.provenance.carte) : null;
    if (!carte) continue;
    const cette = comparable(carte);
    if (maintenant - cette.closeLe > FENETRE_DE_CONTRADICTION_MS) continue;
    let voisines = cartesParProjet.get(carte.projectId);
    if (!voisines) {
      voisines = store.listCards(carte.projectId).map(comparable);
      cartesParProjet.set(carte.projectId, voisines);
    }
    const suivantes = voisines.filter((autre) => autre.id !== carte.id && autre.closeLe > cette.closeLe);
    const contradiction = premiereContradiction(cette, suivantes);
    // Une fiche RÉÉCRITE après la carte qui la contredit en a déjà tenu compte :
    // sans cette garde, la même fiche reviendrait chaque nuit, pour toujours.
    if (contradiction && contradiction.carte.closeLe > dateDuFichier(fiche)) {
      aRevoir.push({ nom: fiche.nom, carte: carte.title, contreditePar: contradiction.carte.titre });
    }
  }
  return aRevoir;
}

/* ------------------------------------------------------------------ */
/* LE PASSAGE DE NUIT                                                   */
/* ------------------------------------------------------------------ */

export interface BilanDuMenage {
  lance: boolean;
  raison?: string;
  fiches?: number;
}

function dernierPassage(): number | undefined {
  const brut = getMeta(CLE_DERNIER_PASSAGE);
  const valeur = brut ? Number(brut) : NaN;
  return Number.isFinite(valeur) ? valeur : undefined;
}

/** Le projet qui accueille l'agent : celui de la première fiche touchée, sinon le premier projet ouvert. */
function projetDAccueil(touchees: readonly FicheTouchee[]): Project | undefined {
  const ouverts = store.listProjects().filter((p) => !p.archived);
  const nomme = touchees.flatMap((f) => f.projets)[0]?.toLowerCase();
  return (nomme && ouverts.find((p) => p.name.toLowerCase() === nomme)) || ouverts[0];
}

/**
 * LE RENDEZ-VOUS. Trois refus, tous dits : ce n'est pas l'heure, il n'y a pas
 * de place pour un agent, ou rien n'a été écrit ni contredit depuis le dernier
 * passage — et ce n'est pas une panne.
 */
export async function rendezVousDuMenage(force = false): Promise<BilanDuMenage> {
  if (enCours) return { lance: false, raison: 'un ménage des compétences tourne déjà' };

  const maintenant = Date.now();
  const dernier = dernierPassage();
  if (!force) {
    const heure = new Date(maintenant).getHours();
    if (heure < HEURE_RENDEZ_VOUS || heure >= HEURE_RENDEZ_VOUS + FENETRE_HEURES) {
      return { lance: false, raison: "ce n'est pas l'heure" };
    }
    if (dernier && maintenant - dernier < PERIODE_MS) {
      return { lance: false, raison: 'le passage du jour a déjà eu lieu' };
    }
    if (!canStartAgent().ok) return { lance: false, raison: 'aucune place pour un agent' };
  }

  enCours = true;
  try {
    const fiches = fichesMaison();
    const depuis = dernier ?? maintenant - PERIODE_MS;
    const touchees = fichesTouchees(depuis, fiches);
    const aRevoir = fichesARevoir(maintenant, fiches);
    const inventaire = !getMeta(CLE_INVENTAIRE_DU_CODE);
    let recurrences: Awaited<ReturnType<typeof releverLesRecurrencesDuCode>> = [];
    try {
      recurrences = await releverLesRecurrencesDuCode(inventaire ? undefined : depuis);
    } catch (err) {
      log.warn(`ménage des compétences : relevé du code abandonné — ${(err as Error).message}`);
    }
    // La date est posée AVANT le tour, et même quand il n'y a rien : sans cela, on
    // relirait le pool toutes les dix minutes pour ne rien trouver, et un agent
    // lent serait relancé.
    setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
    if (!menageNecessaire({ touchees, aRevoir, recurrences })) {
      if (inventaire) setMeta(CLE_INVENTAIRE_DU_CODE, String(maintenant));
      return { lance: false, raison: 'aucune fiche écrite ni contredite, aucune récurrence dans le code : rien à ranger' };
    }

    const accueil = projetDAccueil(touchees);
    if (!accueil) return { lance: false, raison: 'aucun projet ouvert pour accueillir l’agent' };
    if (inventaire) setMeta(CLE_INVENTAIRE_DU_CODE, String(maintenant));

    const total = touchees.length + aRevoir.length + recurrences.length;
    // Rôle « analysis » : il ne modifie aucun code. Sa seule sortie est l'outil
    // d'écriture du pool, qui vaut pour TOUS les projets.
    const agent = createAgent({ projectId: accueil.id, role: 'analysis', title: TITRE_MENAGE });
    try {
      await sendPrompt(agent.id, consigneDuMenage({ touchees, aRevoir, recurrences, inventaire }), { template: 'none', silent: true });
    } catch (err: any) {
      log.error('ménage des compétences : le passage a échoué', err);
      return { lance: true, raison: err?.message ?? 'raison inconnue', fiches: total };
    }

    log.info(
      `ménage des compétences : ${touchees.length} fiche(s) touchée(s), ${aRevoir.length} à revoir, ` +
        `${recurrences.length} récurrence(s) dans le code${inventaire ? ' (inventaire initial)' : ''}`,
    );
    return { lance: true, fiches: total };
  } finally {
    enCours = false;
  }
}

/** La veille : elle regarde l'heure, et le rendez-vous fait le reste. */
export function planifierMenageDesCompetences(): NodeJS.Timeout {
  return setInterval(() => {
    void rendezVousDuMenage();
  }, PERIODE_DE_VEILLE_MS);
}
