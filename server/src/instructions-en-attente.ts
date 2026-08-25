import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DOSSIER_D_ATTENTE,
  FICHIER_D_ATTENTE,
  PERIODE_DE_FUSION_MS,
  compacterInstructions,
  contratMisDeCote,
  contratsQuiTiennent,
  decisionDeFusion,
  fichierApresFusion,
  fichierDAttenteVide,
  lireEntrees,
  planDeFusion,
  type PlanDeFusion,
  type CommitObserve,
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
 *
 * IL NE POSE PLUS DE CARTE. Le résultat était systématiquement enregistré
 * directement dans le dépôt de travail du projet (celui que lisent
 * `project_memory` et l'accueil de chaque agent) : rien n'y attend une
 * publication pour devenir effectif. La fiche posée chaque matin dans
 * « À déployer » n'apportait donc qu'une case à ranger de plus sur chaque
 * projet, sans rien changer d'utile — elle est retirée.
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
 * INSÈRE CHAQUE LIGNE DE CONTRAT SOUS LA SECTION « ### … » DE SON SUJET, au lieu
 * de tout recoller en fin de fichier. Le repère existe déjà dans chaque section :
 * la ligne « Texte entier : … (`project_memory`, sujet « <sujet> »). ». Une
 * ligne dont le sujet n'a pas de section correspondante garde l'ancien
 * comportement — ajoutée à la fin — plutôt que d'être perdue.
 *
 * UNE LIGNE DÉJÀ PRÉSENTE N'EST PAS RÉÉCRITE. Le fichier d'instructions vit
 * sous un plafond mesuré ; deux règles déposées deux fois — par deux cartes, ou
 * par une carte reprise — y écrivaient deux fois le même contrat, et le doublon
 * se paie à chaque session de chaque agent.
 */
function insererParSujet(
  chemin: string,
  contrat: readonly { sujet: string; ligne: string }[],
  entete: string,
): void {
  if (!contrat.length) return;
  if (!fs.existsSync(chemin)) {
    ajouterALaFin(chemin, `${contrat.map((c) => c.ligne).join('\n')}\n`, entete);
    return;
  }

  const parSujet = new Map<string, string[]>();
  for (const { sujet, ligne } of contrat) {
    const liste = parSujet.get(sujet) ?? [];
    liste.push(ligne);
    parSujet.set(sujet, liste);
  }

  let texte = fs.readFileSync(chemin, 'utf8');
  const restantes: string[] = [];

  for (const [sujet, toutes] of parSujet) {
    const lignes = toutes.filter((ligne) => !texte.includes(ligne.trim()));
    if (!lignes.length) continue;
    const repere = new RegExp(`sujet\\s*«\\s*${sujet}\\s*»`, 'i');
    const lignesFichier = texte.split('\n');
    const indexRepere = lignesFichier.findIndex((l) => repere.test(l));
    if (indexRepere === -1) {
      restantes.push(...lignes);
      continue;
    }
    let fin = lignesFichier.length;
    for (let i = indexRepere + 1; i < lignesFichier.length; i++) {
      if (/^### /.test(lignesFichier[i])) {
        fin = i;
        break;
      }
    }
    let insertion = fin;
    while (insertion > indexRepere + 1 && lignesFichier[insertion - 1].trim() === '') insertion--;
    lignesFichier.splice(insertion, 0, ...lignes);
    texte = lignesFichier.join('\n');
  }

  fs.writeFileSync(chemin, texte);
  if (restantes.length) ajouterALaFin(chemin, `${restantes.join('\n')}\n`, entete);
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
 * copies de travail suivantes partent du fichier rangé, et la prochaine
 * publication réelle emportera ce commit avec le reste.
 */
function enregistrerLeRangement(racine: string, fichiers: readonly string[]): CommitObserve | undefined {
  if (!fichiers.length) return undefined;
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
    // `--all` sur un chemin NOMMÉ : il faut aussi enregistrer la DISPARITION
    // d'un dépôt de carte, consommé et retiré. La règle du dossier partagé est
    // tenue — un fichier à la fois, jamais `git add -A` sur tout le dépôt.
    for (const fichier of fichiers) {
      git('add', '--all', '--', fichier);
    }
    try {
      git('diff', '--cached', '--quiet');
      return undefined; // rien de neuf dans l'index : pas de commit à vide.
    } catch {
      /* il y a bien quelque chose à enregistrer */
    }
    git('commit', '-m', 'Range les règles durables déposées, une fois pour la nuit');
    const sha = git('rev-parse', 'HEAD').trim();
    const branche = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const date = git('show', '-s', '--format=%aI', 'HEAD').trim();
    log.info(`rangement des instructions : ${fichiers.length} fichier(s) enregistré(s) dans ${racine}`);
    return { sha, titre: 'Range les règles durables déposées, une fois pour la nuit', branche, date };
  } catch (err) {
    log.warn(`rangement des instructions : enregistrement impossible dans ${racine} — ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * TOUS LES DÉPÔTS D'UN PROJET : le fichier commun, puis un fichier par carte.
 *
 * Le fichier commun était le SEUL, et c'était la cause d'une bonne part des
 * conflits qui atteignaient la fusion du lot : chaque agent ajoutait son entrée
 * à la fin des mêmes lignes. Chaque copie de travail écrit désormais dans
 * `docs/instructions-en-attente/<sa-copie>.md` — deux fichiers différents ne se
 * heurtent jamais —, et la nuit les lit tous, dans l'ordre des noms pour que
 * deux rangements du même dépôt rendent le même résultat.
 *
 * Rend une liste vide quand il n'y a rien à ranger.
 */
export function depotsDAttente(racine: string): string[] {
  const depots: string[] = [];
  if (fs.existsSync(path.join(racine, FICHIER_D_ATTENTE))) depots.push(FICHIER_D_ATTENTE);
  const dossier = path.join(racine, DOSSIER_D_ATTENTE);
  if (fs.existsSync(dossier) && fs.statSync(dossier).isDirectory()) {
    // Le mode d'emploi du dossier n'est pas un dépôt : le lire comme tel le
    // ferait retirer à la première nuit qui range quelque chose.
    const modeDEmploi = new Set(['LISEZ-MOI.md', 'README.md']);
    for (const nom of fs.readdirSync(dossier).filter((n) => n.endsWith('.md') && !modeDEmploi.has(n)).sort()) {
      depots.push(path.posix.join(DOSSIER_D_ATTENTE, nom));
    }
  }
  return depots;
}

/**
 * Range ce qu'UN projet a déposé. Rend le plan appliqué — ce qui a été rangé,
 * ce qui reste en attente avec sa cause.
 */
export function rangerUnProjet(racine: string): PlanDeFusion | undefined {
  const attente = path.join(racine, FICHIER_D_ATTENTE);
  const depots = depotsDAttente(racine);
  if (!depots.length) return undefined;

  const entrees = depots.flatMap((relatif) => {
    try {
      return lireEntrees(fs.readFileSync(path.join(racine, relatif), 'utf8'));
    } catch {
      return [];
    }
  });
  if (!entrees.length) return undefined;

  const sujets = sujetsDuProjet(racine);
  const plan = planDeFusion(entrees, sujets.map((s) => s.id));

  const touches: string[] = [...depots];
  if (!touches.includes(FICHIER_D_ATTENTE)) touches.push(FICHIER_D_ATTENTE);

  /*
   * LE CONTRAT NE GROSSIT QUE D'UNE LIGNE PAR RÈGLE, et seulement quand l'agent
   * en a écrit une. C'est tout l'objet de la manœuvre : le fichier lu par le
   * moteur à chaque session ne doit pas reprendre le texte entier.
   *
   * …ET IL NE FRANCHIT JAMAIS SON PLAFOND. Le rangement COMPACTE d'abord ce qui
   * s'y répète (doublons, contrats qui redisent leur titre), puis n'ajoute que
   * les lignes qui TIENNENT. Ce qui déborde n'est pas perdu : son texte entier
   * part dans le fichier de son sujet comme les autres, avec la phrase qui dit
   * que son nom attend une place. Sans cette borne, chaque nuit poussait le
   * fichier plus loin au-dessus de sa limite, et le dépassement se paie à
   * chaque aller-retour de chaque agent.
   */
  const instructions = fichierDInstructions(racine);
  let debordent: typeof plan.contrat = [];

  if (plan.contrat.length && !instructions) {
    log.warn(`rangement des instructions : ${racine} n'a pas de fichier d'instructions, contrat non ajouté`);
  } else if (plan.contrat.length && instructions) {
    const compacte = compacterInstructions(fs.readFileSync(instructions, 'utf8'));
    if (compacte.gagnes > 0) {
      fs.writeFileSync(instructions, compacte.texte);
      log.info(
        `rangement des instructions : ${compacte.doublons} doublon(s) et ${compacte.compactees} redite(s) ` +
          `retirés du fichier d'instructions, ${compacte.gagnes} signes gagnés`,
      );
    }
    const tri = contratsQuiTiennent(compacte.texte.length, plan.contrat);
    debordent = tri.debordent;
    if (tri.retenues.length) {
      insererParSujet(instructions, tri.retenues, '# Instructions du moteur\n');
    }
    if (compacte.gagnes > 0 || tri.retenues.length) touches.push(path.relative(racine, instructions));
    for (const mis of debordent) {
      log.warn(`rangement des instructions : « ${mis.titre} » non nommée dans le contrat — plafond atteint`);
    }
  }

  for (const { sujet, texte } of plan.parSujet) {
    const cible = sujets.find((s) => s.id === sujet);
    if (!cible) continue;
    const chemin = path.join(racine, cible.fichier);
    const misDeCote = debordent.filter((c) => c.sujet === sujet).map(contratMisDeCote);
    ajouterALaFin(chemin, texte + misDeCote.join(''), `# ${cible.libelle} — règles du moteur\n`);
    touches.push(cible.fichier);
  }

  /*
   * CE QUI RESTE EN ATTENTE REVIENT DANS LE FICHIER COMMUN, ET LES DÉPÔTS DE
   * CARTE DISPARAISSENT. Un dépôt de carte est un PASSAGE : la carte est finie,
   * sa copie de travail est refermée, personne n'y reviendra. Le laisser en
   * place ferait relire chaque nuit les mêmes entrées déjà rangées.
   */
  fs.writeFileSync(attente, plan.refusees.length ? fichierApresFusion(plan.refusees) : fichierDAttenteVide());
  for (const relatif of depots) {
    if (relatif === FICHIER_D_ATTENTE) continue;
    try {
      fs.rmSync(path.join(racine, relatif));
    } catch (err) {
      log.warn(`rangement des instructions : ${relatif} non retiré — ${(err as Error).message}`);
    }
  }
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
    for (const relatif of depotsDAttente(projet.path)) {
      try {
        enAttente += lireEntrees(fs.readFileSync(path.join(projet.path, relatif), 'utf8')).length;
      } catch {
        // Fichier illisible : il se dira au rangement, pas ici.
      }
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
