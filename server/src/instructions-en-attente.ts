import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  FICHIER_D_ATTENTE,
  PERIODE_DE_FUSION_MS,
  decisionDeFusion,
  fichierApresFusion,
  fichierDAttenteVide,
  lireEntrees,
  planDeFusion,
  type PlanDeFusion,
  type SujetRegles,
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

/** Le libellé d'un sujet : le premier titre du fichier, sinon son identifiant mis en forme. */
function libelleDepuisFichier(chemin: string, id: string): string {
  try {
    const titre = /^#\s+(.+)$/m.exec(fs.readFileSync(chemin, 'utf8'));
    if (titre) return titre[1].replace(/\s*—.*$/, '').trim();
  } catch {
    // Fichier illisible : on retombe sur l'identifiant.
  }
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * LES SUJETS QUI EXISTENT VRAIMENT POUR CE PROJET.
 *
 * `SUJETS_REGLES` (huit sujets fixes, dans `shared/`) décrit la structure
 * d'HAIKODEV, pas celle d'un projet quelconque : lui imposer ces huit fichiers
 * créerait, sur un autre projet, des fichiers de règles sans rapport avec ce
 * qu'il fait. Le rangement ne vise donc que les fichiers de `docs/regles/`
 * RÉELLEMENT présents sur le disque du projet traité — pour HaikoDev, ce sont
 * justement ces huit fichiers ; pour un projet qui n'a pas encore cette
 * structure, la liste est vide et les entrées restent en attente, avec leur
 * raison, plutôt que d'inventer un sujet qui n'existe pas.
 */
export function sujetsDuProjet(racine: string): SujetRegles[] {
  const dossier = path.join(racine, 'docs', 'regles');
  if (!fs.existsSync(dossier)) return [];
  return fs
    .readdirSync(dossier)
    .filter((nom) => nom.endsWith('.md'))
    .map((nom) => {
      const id = nom.slice(0, -3);
      const fichier = path.posix.join('docs', 'regles', nom);
      return { id, libelle: libelleDepuisFichier(path.join(dossier, nom), id), fichier, mots: [] };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * LE RANGEMENT S'ENREGISTRE, SINON IL EST DÉFAIT LA NUIT SUIVANTE.
 *
 * Le rendez-vous de nuit écrit sur le DISQUE du dossier partagé, et s'arrêtait
 * là. Or chaque carte ouvre sa copie de travail depuis le DERNIER COMMIT :
 * l'agent y retrouvait donc le fichier d'attente NON rangé, dans sa version
 * grasse, et sa fusion le ramenait en entier dans le dossier partagé. Le
 * rangement était refait chaque nuit et défait chaque jour — d'où un fichier
 * d'attente au-dessus de son plafond pendant des jours, sans que personne ne
 * voie la boucle.
 *
 * On enregistre donc ce qui vient d'être rangé, en NOMMANT chaque fichier :
 * le dossier est partagé, et un `git add -A` emporterait le travail d'un
 * autre. Pousser n'est PAS de ce ressort : le commit suffit à ce que les
 * copies de travail suivantes partent du fichier rangé.
 */
function enregistrerLeRangement(racine: string, fichiers: readonly string[]): void {
  if (!fichiers.length) return;
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: racine,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    // Un dépôt en pleine fusion ou en plein rebasage ne se laisse pas
    // enregistrer : on repasse la nuit suivante plutôt que d'insister.
    for (const fichier of fichiers) {
      if (fs.existsSync(path.join(racine, fichier))) git('add', '--', fichier);
    }
    try {
      git('diff', '--cached', '--quiet');
      return; // rien de neuf dans l'index : pas de commit à vide.
    } catch {
      /* il y a bien quelque chose à enregistrer */
    }
    git('commit', '-m', 'Range les règles durables déposées, une fois pour la nuit');
    log.info(`rangement des instructions : ${fichiers.length} fichier(s) enregistré(s) dans ${racine}`);
  } catch (err) {
    log.warn(`rangement des instructions : enregistrement impossible dans ${racine} — ${(err as Error).message}`);
  }
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

  const sujets = sujetsDuProjet(racine);
  const plan = planDeFusion(entrees, sujets.map((s) => s.id));

  const touches: string[] = [FICHIER_D_ATTENTE];

  for (const { sujet, texte } of plan.parSujet) {
    const cible = sujets.find((s) => s.id === sujet);
    if (!cible) continue;
    const chemin = path.join(racine, cible.fichier);
    ajouterALaFin(chemin, texte, `# ${cible.libelle} — règles du moteur\n`);
    touches.push(cible.fichier);
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
      touches.push(path.relative(racine, instructions));
    } else {
      log.warn(`rangement des instructions : ${racine} n'a pas de fichier d'instructions, contrat non ajouté`);
    }
  }

  fs.writeFileSync(attente, plan.refusees.length ? fichierApresFusion(plan.refusees) : fichierDAttenteVide());
  enregistrerLeRangement(racine, touches);
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
