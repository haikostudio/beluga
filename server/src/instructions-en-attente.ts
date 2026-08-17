import fs from 'node:fs';
import path from 'node:path';
import {
  FICHIER_D_ATTENTE,
  PERIODE_DE_FUSION_MS,
  SUJETS_REGLES,
  decisionDeFusion,
  fichierApresFusion,
  fichierDAttenteVide,
  lireEntrees,
  planDeFusion,
  type PlanDeFusion,
} from '@haikodev/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

/**
 * LE RANGEMENT DE NUIT DES INSTRUCTIONS.
 *
 * Les règles (heure, format, refus) vivent dans
 * `shared/src/instructions-en-attente.ts` et se testent seules. Ici, le disque
 * et le journal — rien d'autre.
 *
 * Ce travail n'appelle AUCUN moteur : il déplace du texte d'un fichier à un
 * autre. Il ne coûte donc pas un jeton, et n'a aucune raison d'attendre qu'un
 * agent ait fini.
 */

const CLE_DERNIERE_FUSION = 'instructions:derniere-fusion';

/** Le fichier d'instructions qui fait foi pour un projet, s'il existe. */
function fichierDInstructions(racine: string): string | undefined {
  for (const nom of ['CLAUDE.md', 'AGENTS.md']) {
    const chemin = path.join(racine, nom);
    if (fs.existsSync(chemin)) return chemin;
  }
  return undefined;
}

export interface BilanDeFusion {
  lance: boolean;
  raison?: string;
  projets: number;
  rangees: number;
  refusees: number;
}

/** Écrit un bloc à la fin d'un fichier, en le créant au besoin. */
function ajouterALaFin(chemin: string, texte: string, entete: string): void {
  const existant = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : entete;
  const separe = existant.endsWith('\n') ? existant : `${existant}\n`;
  fs.writeFileSync(chemin, `${separe}${texte}`);
}

/**
 * Range ce qu'UN projet a déposé. Rend le plan appliqué — ce qui a été rangé,
 * ce qui reste en attente avec sa cause.
 */
export function rangerUnProjet(racine: string): PlanDeFusion | undefined {
  const attente = path.join(racine, FICHIER_D_ATTENTE);
  if (!fs.existsSync(attente)) return undefined;

  const entrees = lireEntrees(fs.readFileSync(attente, 'utf8'));
  if (!entrees.length) return undefined;

  const plan = planDeFusion(entrees, SUJETS_REGLES.map((s) => s.id));

  for (const { sujet, texte } of plan.parSujet) {
    const cible = SUJETS_REGLES.find((s) => s.id === sujet);
    if (!cible) continue;
    const chemin = path.join(racine, cible.fichier);
    ajouterALaFin(chemin, texte, `# ${cible.libelle} — règles du moteur\n`);
  }

  /*
   * LE CONTRAT NE GROSSIT QUE D'UNE LIGNE PAR RÈGLE, et seulement quand
   * l'agent en a écrit une. C'est tout l'objet de la manœuvre : le fichier lu
   * par le moteur à chaque session ne doit pas reprendre le texte entier.
   */
  if (plan.contrat.length) {
    const instructions = fichierDInstructions(racine);
    if (instructions) {
      ajouterALaFin(instructions, `${plan.contrat.join('\n')}\n`, '# Instructions du moteur\n');
    } else {
      log.warn(`rangement des instructions : ${racine} n'a pas de fichier d'instructions, contrat non ajouté`);
    }
  }

  fs.writeFileSync(attente, plan.refusees.length ? fichierApresFusion(plan.refusees) : fichierDAttenteVide());
  return plan;
}

/**
 * Le rendez-vous de la nuit, tous projets confondus. Un projet dont le dossier
 * a disparu ne doit pas emporter le rangement des autres.
 */
export function rendezVousDeRangement(maintenant = new Date()): BilanDeFusion {
  const projets = store.listProjects().filter((p) => !p.archived);

  let enAttente = 0;
  for (const projet of projets) {
    const attente = path.join(projet.path, FICHIER_D_ATTENTE);
    if (!fs.existsSync(attente)) continue;
    try {
      enAttente += lireEntrees(fs.readFileSync(attente, 'utf8')).length;
    } catch {
      // Fichier illisible : il se dira au rangement, pas ici.
    }
  }

  const dernier = Number(getMeta(CLE_DERNIERE_FUSION) ?? 0) || undefined;
  const decision = decisionDeFusion({ maintenant, derniereFusionA: dernier, entreesEnAttente: enAttente });
  if (!decision.fusionner) return { lance: false, raison: decision.raison, projets: 0, rangees: 0, refusees: 0 };

  let touches = 0;
  let rangees = 0;
  let refusees = 0;
  for (const projet of projets) {
    try {
      const plan = rangerUnProjet(projet.path);
      if (!plan) continue;
      touches += 1;
      rangees += plan.parSujet.length;
      refusees += plan.refusees.length;
      for (const { entree, raison } of plan.refusees) {
        log.warn(`rangement des instructions : « ${entree.titre} » laissée en attente — ${raison}`);
      }
    } catch (err) {
      log.warn(`rangement des instructions : ${projet.name} sauté — ${(err as Error).message}`);
    }
  }

  setMeta(CLE_DERNIERE_FUSION, String(maintenant.getTime()));
  log.info(`rangement des instructions : ${touches} projet(s), ${rangees} sujet(s) enrichi(s), ${refusees} en attente`);
  return { lance: true, projets: touches, rangees, refusees };
}

/** La veille, à la même cadence que les autres travaux de fond. */
export const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

export function planifierRangementDesInstructions(): NodeJS.Timeout {
  return setInterval(() => {
    try {
      rendezVousDeRangement();
    } catch (err) {
      // Une panne ici ne doit jamais emporter le minuteur.
      log.warn(`rangement des instructions : passage sauté — ${(err as Error).message}`);
    }
  }, PERIODE_DE_VEILLE_MS);
}

export { PERIODE_DE_FUSION_MS };
