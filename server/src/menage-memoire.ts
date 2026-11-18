/**
 * LE MÉNAGE AUTOMATIQUE DE LA MÉMOIRE, LA NUIT — appliqué seul, vérifié par un
 * essai, annulé s'il dégrade (règles pures : `shared/src/menage-memoire.ts`).
 *
 * Pour chaque portée (chaque projet actif, puis le global) :
 *  1. l'indicateur de flou dit s'il y a quelque chose à faire ;
 *  2. l'ESSAI AVANT : les cas versionnés du dépôt (`scripts/cas-tests-memoire.json`,
 *     `scripts/cas-tests-interface.json`) dont la réponse vit dans cette portée,
 *     plus les unités vitales cherchées par leur titre clair ;
 *  3. le lot passe par la PORTE D'ÉCRITURE (`changerLImportance`,
 *     `deprecierEnFaveurDe`), version gardée à chaque geste ;
 *  4. l'ESSAI APRÈS, sur les mêmes cas ; s'il est moins bon, CHAQUE unité
 *     touchée est restaurée (`restaurerLUnite`) — le lot entier, jamais à moitié.
 *
 * Le bilan de la nuit se garde en base (`memoire.menage.dernier`) et se lit au
 * journal : chiffres avant / après, gestes appliqués ou annulés.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  PORTEE_GLOBALE,
  casDEssaiDeLaMemoire,
  indicateurDeFlou,
  planDeMenage,
  rangMoyen,
  scoreDeRappel,
  verdictDeLEssai,
  type ActionDeMenage,
  type CasDEssai,
  type Unite,
  type UniteDuMenage,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import {
  changerLImportance,
  chercherUnites,
  deprecierEnFaveurDe,
  dernieresLectures,
  lireUnite,
  restaurerLUnite,
  titresNormesDeLaPortee,
  unitesDeLaPortee,
} from './connaissances.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';

const AUTEUR = 'menage-de-nuit';
const CLE_BILAN = 'memoire.menage.dernier';
const FICHIERS_DE_CAS = ['scripts/cas-tests-memoire.json', 'scripts/cas-tests-interface.json'];

export interface BilanDuMenage {
  portee: string;
  at: number;
  flou: boolean;
  raisons: string[];
  partVitaleAvant: number;
  gestes: number;
  reclassees: number;
  depreciees: number;
  essai: { cas: number; avant: { rappel: number; rang: number }; apres?: { rappel: number; rang: number } };
  issue: 'rien-a-faire' | 'garde' | 'annule';
}

/** Les cas versionnés du dépôt dont TOUTES les réponses attendues vivent dans cette portée (ou le global). */
function casVersionnes(portee: string): CasDEssai[] {
  const cas: CasDEssai[] = [];
  for (const fichier of FICHIERS_DE_CAS) {
    try {
      const lus = JSON.parse(fs.readFileSync(path.join(CONFIG.selfPath, fichier), 'utf8')) as CasDEssai[];
      for (const c of lus) {
        if (!c?.demande || !Array.isArray(c.attendu) || !c.attendu.length) continue;
        const ici = c.attendu.every((id) => {
          const u = lireUnite(id);
          return u && u.statut === 'active' && (u.portee === portee || (portee !== PORTEE_GLOBALE && u.portee === PORTEE_GLOBALE));
        });
        if (ici) cas.push(c);
      }
    } catch {
      /* fichier absent : pas de cas versionnés pour cette installation */
    }
  }
  return cas;
}

function passerLEssai(portee: string, cas: readonly CasDEssai[]): { rappel: number; rang: number } {
  const options = portee === PORTEE_GLOBALE ? { portees: [PORTEE_GLOBALE], limite: 10 } : { projectId: portee, limite: 10 };
  const resultats = cas.map((c) => ({ attendu: c.attendu, trouves: chercherUnites(c.demande, options).map((t) => t.unite.id) }));
  return { rappel: scoreDeRappel(resultats), rang: rangMoyen(resultats) };
}

function versUniteDuMenage(u: Unite, titres: Map<string, string>, lectures: Map<string, number>): UniteDuMenage {
  return {
    id: u.id,
    type: u.type,
    importance: u.importance,
    jamaisSupposer: u.jamaisSupposer,
    titreNorme: titres.get(u.id) ?? '',
    creeLe: u.creeLe,
    modifieLe: u.modifieLe,
    derniereLecture: lectures.get(u.id.toUpperCase()),
  };
}

function appliquer(action: ActionDeMenage): boolean {
  const motif =
    action.geste === 'reclasser'
      ? `ménage de nuit : ${action.de} → ${action.vers}, ancienne et jamais lue par un agent`
      : `ménage de nuit : doublon exact de ${action.auProfitDe}`;
  const r = action.geste === 'reclasser' ? changerLImportance(action.id, action.vers, AUTEUR, motif) : deprecierEnFaveurDe(action.id, action.auProfitDe, AUTEUR, motif);
  return r.ok && r.geste !== 'deja-la';
}

/**
 * LE MÉNAGE D'UNE PORTÉE. `appliquerLePlan` et `essai` se remplacent dans les
 * tests (simuler une dégradation) ; par défaut, la vraie porte et la vraie
 * recherche.
 */
export function menageDeLaPortee(
  portee: string,
  options: { maintenant?: number; max?: number; essai?: (cas: readonly CasDEssai[]) => { rappel: number; rang: number } } = {},
): BilanDuMenage {
  const maintenant = options.maintenant ?? Date.now();
  const unites = unitesDeLaPortee(portee);
  const titres = titresNormesDeLaPortee(portee);
  const lectures = dernieresLectures();
  const pourLeMenage = unites.map((u) => versUniteDuMenage(u, titres, lectures));
  const indicateur = indicateurDeFlou(pourLeMenage, maintenant);
  const essai = options.essai ?? ((cas) => passerLEssai(portee, cas));
  const cas = [...casVersionnes(portee), ...casDEssaiDeLaMemoire(unites)];
  const bilan: BilanDuMenage = {
    portee,
    at: maintenant,
    flou: indicateur.flou,
    raisons: indicateur.raisons,
    partVitaleAvant: indicateur.partVitale,
    gestes: 0,
    reclassees: 0,
    depreciees: 0,
    essai: { cas: cas.length, avant: { rappel: 1, rang: 0 } },
    issue: 'rien-a-faire',
  };
  if (!indicateur.flou) return bilan;
  const plan = planDeMenage(pourLeMenage, { maintenant, max: options.max });
  if (!plan.length) return bilan;

  bilan.essai.avant = essai(cas);
  const avant = new Map<string, Unite>();
  for (const action of plan) {
    const u = lireUnite(action.id);
    if (!u) continue;
    avant.set(u.id, u);
    if (appliquer(action)) {
      bilan.gestes += 1;
      if (action.geste === 'reclasser') bilan.reclassees += 1;
      else bilan.depreciees += 1;
    }
  }
  bilan.essai.apres = essai(cas);
  if (verdictDeLEssai(bilan.essai.avant, bilan.essai.apres) === 'annuler') {
    for (const u of avant.values()) restaurerLUnite(u, AUTEUR, 'ménage de nuit annulé : l’essai de rappel a baissé');
    bilan.issue = 'annule';
  } else {
    bilan.issue = 'garde';
  }
  return bilan;
}

/** LA NUIT : chaque portée, puis le bilan gardé en base et dit au journal. */
export function menageDeNuit(portees: readonly string[], maintenant = Date.now()): BilanDuMenage[] {
  const bilans: BilanDuMenage[] = [];
  for (const portee of portees) {
    try {
      const bilan = menageDeLaPortee(portee, { maintenant });
      bilans.push(bilan);
      if (bilan.issue !== 'rien-a-faire') {
        log.info(
          `mémoire, ménage de nuit (${portee}) : ${bilan.issue === 'garde' ? 'gardé' : 'ANNULÉ'} — ${bilan.reclassees} reclassée(s), ${bilan.depreciees} doublon(s) ; ` +
            `rappel ${bilan.essai.avant.rappel.toFixed(3)} → ${bilan.essai.apres?.rappel.toFixed(3)} sur ${bilan.essai.cas} cas`,
        );
      }
    } catch (err) {
      log.warn(`mémoire, ménage de nuit (${portee}) sauté : ${(err as Error).message}`);
    }
  }
  setMeta(CLE_BILAN, JSON.stringify(bilans.filter((b) => b.issue !== 'rien-a-faire')));
  return bilans;
}

/** Le bilan du dernier ménage, pour l'écran et l'agent d'analyse du matin. */
export function dernierMenage(): BilanDuMenage[] {
  try {
    return JSON.parse(getMeta(CLE_BILAN) ?? '[]');
  } catch {
    return [];
  }
}
