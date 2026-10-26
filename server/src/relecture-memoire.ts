import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIANCE_APRES_RELECTURE,
  LOT_DE_RELECTURE,
  PORTEE_GLOBALE,
  SEUIL_DE_CONFIANCE,
  cheminsCites,
  estUniteDeCompetence,
  verdictMecanique,
  type Unite,
  type VerdictDeRelecture,
} from '@beluga/shared';
import { compterUnitesPeuSures, marquerRelue, proposerUnite, quandUneUniteEstEcrite, unitesPeuSures } from './connaissances.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { getProject, listProjects } from './store.js';

/**
 * LA RELECTURE AUTOMATIQUE DE LA MÉMOIRE, EN TÂCHE DE FOND.
 *
 * Décision du 20/10/2026 : « il ne faut pas demander à l'utilisateur de
 * confirmer quoi que ce soit, c'est le système qui doit le faire ». L'écran n'a
 * donc plus de bouton « Confirmer » ; ce module relit les unités peu sûres
 * (confiance < 0,6, jamais relues), par lots, sans quota :
 *
 *  - JUSTE : tous les fichiers qu'elle cite existent dans le dépôt de sa portée →
 *    relue, confiance relevée, version d'avant gardée ;
 *  - OBSOLÈTE : unité d'un PROJET dont tous les fichiers cités ont disparu
 *    alors que leurs dossiers de tête existent (jamais une P0, jamais une unité
 *    du global, dont les chemins visent le dossier d'une compétence ou un
 *    autre dépôt) → dépréciée PAR LA PORTE D'ÉCRITURE, avec sa raison ;
 *  - INDÉCIDABLE : rien de cité, un mélange, ou aucun dépôt où chercher →
 *    laissée telle quelle et confiée à l'agent d'analyse de nuit
 *    (`unitesIndecisesPourLaNuit`), jamais à l'utilisateur.
 *
 * Une unité écartée ne revient pas dans le même processus. Réveil au démarrage
 * (après trois minutes), puis après les écritures de la porte. Le script
 * `scripts/relire-memoire.mjs` lance la même passe à la main.
 */

const PAUSE_AU_DEMARRAGE_MS = 180_000;
const PAUSE_APRES_ECRITURE_MS = 90_000;
const PAUSE_ENTRE_DEUX_LOTS_MS = 2_000;
const AUTEUR = 'relecture automatique';
/** Les unités que la relecture n'a pas su trancher, pour l'agent d'analyse de nuit. */
const CLE_INDECISES = 'connaissances.indecises';
const INDECISES_GARDEES = 60;

const ecartees = new Set<string>();
let enCours: Promise<RapportDeRelecture> | null = null;

export interface RapportDeRelecture {
  lots: number;
  relues: number;
  retirees: number;
  indecises: number;
  restantes: number;
  /** En essai, le verdict de chaque unité, sans rien écrire. */
  verdicts?: { id: string; verdict: VerdictDeRelecture; chemins: string[] }[];
}

/**
 * LES DOSSIERS OÙ CHERCHER LES FICHIERS CITÉS. Une unité de projet : le dépôt de
 * ce projet. Une unité du GLOBAL (souvent une compétence du pool, écrite dans un
 * projet puis partagée) : les dépôts de tous les projets actifs — un fichier
 * cité « existe » s'il existe dans l'un d'eux.
 */
function racinesDeLaPortee(portee: string): string[] {
  const projets = portee === PORTEE_GLOBALE ? listProjects().filter((p) => !p.archived) : [getProject(portee)].filter((p) => !!p);
  return [...new Set(projets.map((p) => p!.path).filter((d): d is string => !!d && fs.existsSync(d)))];
}

/** Le verdict d'une unité, sans rien écrire. */
export function jugerUneUnite(u: Unite, racines = racinesDeLaPortee(u.portee)): { verdict: VerdictDeRelecture; chemins: string[] } {
  const chemins = cheminsCites([u.resume, u.detail, u.raisonnement].filter(Boolean).join('\n'));
  if (!racines.length) return { verdict: 'indecidable', chemins };
  const existe = (chemin: string) => racines.some((r) => fs.existsSync(path.join(r, chemin)));
  const dossierExiste = (dossier: string) => racines.some((r) => fs.existsSync(path.join(r, dossier)));
  return {
    verdict: verdictMecanique({ chemins, existe, dossierExiste, importance: u.importance, retraitPermis: u.portee !== PORTEE_GLOBALE }),
    chemins,
  };
}

export function relireLaMemoire(options: { maxLots?: number; lot?: number; essai?: boolean } = {}): Promise<RapportDeRelecture> {
  if (enCours) return enCours;
  enCours = (async () => {
    const rapport: RapportDeRelecture = { lots: 0, relues: 0, retirees: 0, indecises: 0, restantes: 0, ...(options.essai ? { verdicts: [] } : {}) };
    const taille = Math.max(1, Math.min(options.lot ?? LOT_DE_RELECTURE, 200));
    const vues = options.essai ? new Set<string>() : ecartees;
    const indecises: string[] = [];
    try {
      while (options.maxLots === undefined || rapport.lots < options.maxLots) {
        const unites = unitesPeuSures(taille, vues, SEUIL_DE_CONFIANCE);
        if (!unites.length) break;
        rapport.lots += 1;
        for (const u of unites) {
          // Le pool de compétences est seul propriétaire de la confiance d'une fiche : la relever ici
          // fait réécrire l'unité à la synchro suivante, qui la remet à zéro, et la boucle ne finit pas.
          if (estUniteDeCompetence(u)) {
            vues.add(u.id);
            continue;
          }
          const { verdict, chemins } = jugerUneUnite(u);
          rapport.verdicts?.push({ id: u.id, verdict, chemins });
          if (options.essai || verdict === 'indecidable') {
            vues.add(u.id);
            if (verdict === 'indecidable') {
              rapport.indecises += 1;
              indecises.push(u.id);
            }
            continue;
          }
          if (verdict === 'juste') {
            if (marquerRelue(u.id, CONFIANCE_APRES_RELECTURE, AUTEUR, `fichiers cités présents : ${chemins.join(', ')}`)) rapport.relues += 1;
            else vues.add(u.id);
            continue;
          }
          const r = proposerUnite(
            u.portee,
            { action: 'deprecate', id: u.id, raisonnement: `relecture automatique : plus aucun des fichiers cités n’existe (${chemins.join(', ')})` },
            { auteur: AUTEUR, motif: 'fichiers cités disparus' },
          );
          if (r.ok) rapport.retirees += 1;
          else vues.add(u.id);
        }
        if (unites.length < taille) break;
        await new Promise((r) => setTimeout(r, PAUSE_ENTRE_DEUX_LOTS_MS));
      }
    } catch (err) {
      log.warn(`relecture de la mémoire : arrêt (${(err as Error).message})`);
    }
    if (!options.essai && indecises.length) {
      const deja = unitesIndecisesPourLaNuit();
      setMeta(CLE_INDECISES, JSON.stringify([...new Set([...indecises, ...deja])].slice(0, INDECISES_GARDEES)));
    }
    rapport.restantes = compterUnitesPeuSures(SEUIL_DE_CONFIANCE);
    if (rapport.lots && !options.essai) {
      log.info(
        `relecture de la mémoire : ${rapport.relues} relue(s), ${rapport.retirees} retirée(s), ${rapport.indecises} confiée(s) à l’analyse de nuit, ${rapport.restantes} encore peu sûre(s)`,
      );
    }
    return rapport;
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}

/** Les unités que la relecture mécanique n'a pas tranchées : l'agent d'analyse de nuit les relit. */
export function unitesIndecisesPourLaNuit(): string[] {
  try {
    const liste = JSON.parse(getMeta(CLE_INDECISES) ?? '[]');
    return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Branche la tâche de fond ; rend de quoi l'arrêter. Rien sous les tests. */
export function veillerSurLaRelectureDeLaMemoire(): () => void {
  if (process.env.NODE_TEST_CONTEXT) return () => {};
  let minuteur: NodeJS.Timeout | null = null;
  const reveiller = (delai: number) => {
    if (minuteur) return;
    minuteur = setTimeout(() => {
      minuteur = null;
      void relireLaMemoire();
    }, delai);
    minuteur.unref?.();
  };
  reveiller(PAUSE_AU_DEMARRAGE_MS);
  const desabonner = quandUneUniteEstEcrite(() => reveiller(PAUSE_APRES_ECRITURE_MS));
  return () => {
    desabonner();
    if (minuteur) clearTimeout(minuteur);
  };
}
