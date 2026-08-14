import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COUVERTURE_VECTEURS_MIN,
  DIMENSIONS_VECTEUR,
  DOSSIER_MEMOIRE,
  DOSSIER_PLANS,
  FICHIERS_CODE_MAX,
  PASSAGES_CODE_MAX,
  PASSAGES_PAR_PASSE_MAX,
  POIDS_MOTS_VECTEUR,
  POIDS_SENS_VECTEUR,
  PRIORITE,
  SCORE_MINIMUM_VECTEUR,
  SIGNES_MAX_PAR_FICHIER,
  DOSSIERS_HORS_INDEX,
  choisirPassages,
  classerPassages,
  decouperCodeEnPassages,
  decouperEnPassages,
  empreinteSemantique,
  estFichierDeCode,
  jetonsApproches,
  modeDeRecherche,
  plafondDeRecherche,
  rechercheRentable,
  texteAVectoriser,
  texteDesPassages,
  vecteurUtilisable,
  type ModeDeRecherche,
  type PassageClasse,
  type PassageDoc,
  type PassageIndexe,
} from '@haikodev/shared';
import { getDb } from './db.js';
import { dossierDesCompetences } from './competences.js';
import { log } from './logger.js';
import { modeleDesVecteurs, vectoriser, vectoriserLaQuestion } from './vecteurs.js';

/**
 * LA RECHERCHE DANS LA DOCUMENTATION, CÔTÉ DISQUE ET BASE.
 *
 * Les règles (découpage, score mixte, plafond) vivent dans
 * `shared/src/passages-doc.ts`, celles de la vectorisation dans
 * `shared/src/vecteurs-doc.ts` : elles se testent seules. Ce module-ci fait les
 * quatre choses qui demandent une machine :
 *
 *  1. LIRE la documentation du projet — règles, faits, contrôles, mécaniques,
 *     compétences partagées — ET ses fichiers de code ;
 *  2. TENIR L'INDEX en base, de façon INCRÉMENTALE : un fichier inchangé n'est
 *     ni relu ni recalculé, un fichier modifié voit ses seuls passages remplacés ;
 *  3. VECTORISER ce qui ne l'est pas encore, par tranches, en appelant le modèle
 *     de sens (`server/src/vecteurs.ts`) ;
 *  4. RÉPONDRE à une question — la demande de la carte — par quelques passages
 *     sous plafond de jetons.
 *
 * Le SENS vient désormais d'un vrai modèle, comme le chat de HaikoFormations :
 * une demande écrite avec d'autres mots que la règle qu'elle vise la retrouve
 * quand même. L'ancienne empreinte de mots reste le REPLI — sans clé, sans
 * réseau, ou tant que l'index n'est pas assez vectorisé, la recherche continue
 * de fonctionner, simplement moins finement.
 *
 * Rien de ce module ne doit jamais faire échouer un tour : au pire, il rend
 * `undefined` et l'index de la mémoire reprend sa place.
 */

/**
 * LA VERSION DU DÉCOUPAGE. Changer la façon de couper rend l'index existant
 * incomparable : la version entre dans l'empreinte des fichiers, si bien qu'un
 * changement de règle force une réindexation complète, sans migration à écrire.
 */
const VERSION_INDEX = 'v2';

/** Un fichier à indexer, avec ce qu'il pèse dans le classement. */
interface FichierIndexable {
  /** Le chemin RELATIF affiché à l'agent — c'est lui qu'il ouvrira. */
  source: string;
  /** Le chemin absolu, sur le disque. */
  chemin: string;
  sujet: string;
  priorite: number;
}

/** Le dossier des fiches de MÉCANIQUES : les modes d'emploi réutilisables. */
export const DOSSIER_MECANIQUES = 'docs/mecaniques';

/** Les fichiers `.md` d'un dossier, triés, sans jamais lever d'exception. */
function fichiersMarkdown(dossier: string): string[] {
  try {
    return fs
      .readdirSync(dossier)
      .filter((nom) => nom.toLowerCase().endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * LA DOCUMENTATION D'UN PROJET, telle qu'on l'indexe. L'ordre importe peu (le
 * score classe), mais la PRIORITÉ, elle, décide des ex æquo : une fiche de
 * mécanique passe devant une règle, une règle devant une page libre, une page
 * libre devant un fichier de code.
 */
export function fichiersAIndexer(projectPath: string): FichierIndexable[] {
  const liste: FichierIndexable[] = [];
  const ajouter = (source: string, sujet: string, priorite: number) => {
    const chemin = path.join(projectPath, ...source.split('/'));
    if (fs.existsSync(chemin)) liste.push({ source, chemin, sujet, priorite });
  };

  // Les fiches de MÉCANIQUES d'abord : écrites pour être resservies.
  for (const nom of fichiersMarkdown(path.join(projectPath, DOSSIER_MECANIQUES))) {
    ajouter(`${DOSSIER_MECANIQUES}/${nom}`, nom.replace(/\.md$/i, ''), PRIORITE.mecanique);
  }
  /*
   * LES PLANS DU CHEF D'ORCHESTRE. Un plan est écrit AVANT la carte qui le
   * réalise, pour cette carte-là : à score égal il passe donc devant, comme une
   * mécanique. C'est tout l'intérêt du dossier — ce que le chef a préparé
   * revient tout seul au lancement, sans que personne ne le recopie.
   * Le sujet est PRÉFIXÉ (`plan-…`) : deux fichiers du même nom, l'un en règle
   * l'autre en plan, ne se confondent pas dans `project_memory`.
   */
  for (const nom of fichiersMarkdown(path.join(projectPath, ...DOSSIER_PLANS.split('/')))) {
    ajouter(`${DOSSIER_PLANS}/${nom}`, `plan-${nom.replace(/\.md$/i, '')}`, PRIORITE.mecanique);
  }
  // Les règles, les faits, les contrôles.
  for (const nom of fichiersMarkdown(path.join(projectPath, 'docs', 'regles'))) {
    ajouter(`docs/regles/${nom}`, nom.replace(/\.md$/i, ''), PRIORITE.regle);
  }
  for (const nom of fichiersMarkdown(path.join(projectPath, ...DOSSIER_MEMOIRE.split('/')))) {
    ajouter(`${DOSSIER_MEMOIRE}/${nom}`, nom.replace(/\.md$/i, ''), PRIORITE.regle);
  }
  ajouter('docs/verifications.md', 'verifications', PRIORITE.regle);
  // Le reste de `docs/`, à plat : les cartes de sujets, les audits.
  for (const nom of fichiersMarkdown(path.join(projectPath, 'docs'))) {
    ajouter(`docs/${nom}`, nom.replace(/\.md$/i, ''), PRIORITE.normale);
  }
  ajouter('DOCUMENTATION.md', 'documentation', PRIORITE.normale);

  // Les COMPÉTENCES PARTAGÉES : elles ne vivent pas dans le dépôt du projet
  // (`data/` est hors dépôt) mais elles s'appliquent à tous les projets.
  const competences = dossierDesCompetences();
  try {
    for (const nom of fs.readdirSync(competences)) {
      const chemin = path.join(competences, nom, 'SKILL.md');
      if (!fs.existsSync(chemin)) continue;
      liste.push({
        source: `data/competences/${nom}/SKILL.md`,
        chemin,
        sujet: `competence-${nom}`,
        priorite: PRIORITE.normale,
      });
    }
  } catch {
    /* aucune compétence : rien à indexer */
  }

  return [...liste, ...fichiersDeCodeAIndexer(projectPath)];
}

/**
 * LES FICHIERS DU PROJET. La documentation dit POURQUOI, le code montre COMMENT
 * — et l'agent qui demande « où se décide la couleur d'une colonne » n'a de
 * réponse que dans le second. On descend le dépôt en écartant les dossiers de
 * machine et les copies de travail (`shared/src/passages-code.ts`), et on
 * s'arrête à `FICHIERS_CODE_MAX` : sur un projet quelconque, un dossier oublié
 * peut porter des dizaines de milliers de fichiers.
 */
export function fichiersDeCodeAIndexer(projectPath: string): FichierIndexable[] {
  const trouves: FichierIndexable[] = [];
  const parcourir = (dossier: string, relatif: string) => {
    if (trouves.length >= FICHIERS_CODE_MAX) return;
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
      if (trouves.length >= FICHIERS_CODE_MAX) return;
      if (entree.name.startsWith('.') || DOSSIERS_HORS_INDEX.has(entree.name)) continue;
      const suite = relatif ? `${relatif}/${entree.name}` : entree.name;
      if (entree.isDirectory()) {
        parcourir(path.join(dossier, entree.name), suite);
        continue;
      }
      if (!entree.isFile() || !estFichierDeCode(suite)) continue;
      trouves.push({
        source: suite,
        chemin: path.join(dossier, entree.name),
        sujet: `code-${suite.split('/')[0]}`,
        priorite: PRIORITE.code,
      });
    }
  };
  parcourir(projectPath, '');
  return trouves;
}

function empreinteDuContenu(texte: string): string {
  return crypto.createHash('sha1').update(`${VERSION_INDEX}\n${texte}`).digest('hex').slice(0, 16);
}

function idDuPassage(projectId: string, source: string, rang: number): string {
  return crypto.createHash('sha1').update(`${projectId}\n${source}\n${rang}`).digest('hex').slice(0, 20);
}

/** Un vecteur rangé en base : des flottants 32 bits bout à bout, sans JSON. */
function vecteurEnBinaire(vecteur: number[]): Buffer {
  const tableau = Float32Array.from(vecteur);
  return Buffer.from(tableau.buffer, tableau.byteOffset, tableau.byteLength);
}

/** Le chemin inverse. Un binaire de mauvaise taille est traité comme absent. */
function vecteurDepuisBinaire(brut: Buffer | Uint8Array | null | undefined): Float32Array | undefined {
  if (!brut || brut.byteLength !== DIMENSIONS_VECTEUR * 4) return undefined;
  // Une copie, et non une vue : le tampon de better-sqlite3 peut être réutilisé.
  return new Float32Array(Uint8Array.from(brut).buffer);
}

/**
 * L'INDEXATION, INCRÉMENTALE. Elle relit les fichiers, compare leur empreinte à
 * celle déjà rangée, et ne recalcule que ce qui a changé. Un fichier disparu
 * emporte ses passages ; le reste ne bouge pas.
 *
 * Rend ce qui a réellement été fait — c'est ce que le contrôle mesure.
 */
export function indexerDocumentation(
  projectId: string,
  projectPath: string,
): { fichiers: number; modifies: number; passages: number } {
  const db = getDb();
  const fichiers = fichiersAIndexer(projectPath);
  const connus = new Map<string, string>(
    (db.prepare('SELECT chemin, empreinte FROM doc_fichiers WHERE project_id = ?').all(projectId) as {
      chemin: string;
      empreinte: string;
    }[]).map((ligne) => [ligne.chemin, ligne.empreinte]),
  );

  const supprimerFichier = db.prepare('DELETE FROM doc_fichiers WHERE project_id = ? AND chemin = ?');
  const supprimerPassages = db.prepare('DELETE FROM doc_passages WHERE project_id = ? AND source = ?');
  const poserFichier = db.prepare(
    'INSERT OR REPLACE INTO doc_fichiers (project_id, chemin, empreinte, indexe_at) VALUES (?, ?, ?, ?)',
  );
  const poserPassage = db.prepare(
    `INSERT OR REPLACE INTO doc_passages
       (id, project_id, source, titre, sujet, priorite, texte, empreinte, signes, maj_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let modifies = 0;
  const maintenant = Date.now();

  const travail = db.transaction(() => {
    const vivants = new Set(fichiers.map((f) => f.source));
    // Un fichier disparu emporte ses passages : un index qui garde des règles
    // effacées ferait conclure un agent sur un texte qui n'existe plus.
    for (const chemin of connus.keys()) {
      if (vivants.has(chemin)) continue;
      supprimerFichier.run(projectId, chemin);
      supprimerPassages.run(projectId, chemin);
      modifies++;
    }

    for (const fichier of fichiers) {
      let texte = '';
      try {
        const taille = fs.statSync(fichier.chemin).size;
        if (taille > SIGNES_MAX_PAR_FICHIER) continue;
        texte = fs.readFileSync(fichier.chemin, 'utf8');
      } catch {
        continue;
      }
      const empreinte = empreinteDuContenu(texte);
      if (connus.get(fichier.source) === empreinte) continue;

      supprimerPassages.run(projectId, fichier.source);
      const passages =
        fichier.priorite === PRIORITE.code
          ? decouperCodeEnPassages(fichier.source, texte, { sujet: fichier.sujet })
          : decouperEnPassages(fichier.source, texte, {
              sujet: fichier.sujet,
              priorite: fichier.priorite,
            });
      passages.forEach((passage, rang) => {
        poserPassage.run(
          idDuPassage(projectId, fichier.source, rang),
          projectId,
          passage.source,
          passage.titre,
          passage.sujet,
          passage.priorite,
          passage.texte,
          JSON.stringify(empreinteDuPassage(passage)),
          passage.texte.length,
          maintenant,
        );
      });
      poserFichier.run(projectId, fichier.source, empreinte, maintenant);
      modifies++;
    }
  });

  try {
    travail();
  } catch (err) {
    log.warn(`indexation de la documentation impossible : ${(err as Error).message}`);
    return { fichiers: fichiers.length, modifies: 0, passages: 0 };
  }

  const total = db
    .prepare('SELECT COUNT(*) AS n FROM doc_passages WHERE project_id = ?')
    .get(projectId) as { n: number };
  return { fichiers: fichiers.length, modifies, passages: total.n };
}

/** L'empreinte de repli d'un passage : son titre compte, il porte le sujet en clair. */
function empreinteDuPassage(passage: PassageDoc): number[] {
  return empreinteSemantique(`${passage.titre}\n${passage.texte}`);
}

/* ------------------------------------------------------------------ */
/* La vectorisation de l'index                                         */
/* ------------------------------------------------------------------ */

/** Où en est l'index d'un projet : combien de passages, combien vectorisés. */
export function couvertureDesVecteurs(projectId: string): { total: number; vectorises: number } {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS n FROM doc_passages WHERE project_id = ?').get(projectId) as {
    n: number;
  }).n;
  const vectorises = (db
    .prepare('SELECT COUNT(*) AS n FROM doc_passages WHERE project_id = ? AND modele = ? AND vecteur IS NOT NULL')
    .get(projectId, modeleDesVecteurs()) as { n: number }).n;
  return { total, vectorises };
}

/**
 * LA VECTORISATION DE CE QUI NE L'EST PAS ENCORE, par tranche. Elle tourne DANS
 * la préparation d'un tour : sur un gros projet, la première passe a des
 * milliers de passages à traiter et bloquer le lancement d'une carte plusieurs
 * minutes serait pire que le mal. On en fait donc `PASSAGES_PAR_PASSE_MAX` au
 * plus, et le reste au lancement suivant — la recherche fonctionne pendant ce
 * temps, en repli sur les mots.
 *
 * Un passage vectorisé par un AUTRE modèle est repris : deux vecteurs venus de
 * deux modèles ne se comparent pas.
 */
export async function vectoriserLIndex(projectId: string): Promise<{ faits: number }> {
  const db = getDb();
  const modele = modeleDesVecteurs();
  const aFaire = db
    .prepare(
      `SELECT id, source, titre, texte FROM doc_passages
        WHERE project_id = ? AND (vecteur IS NULL OR modele IS NOT ?)
        ORDER BY priorite DESC, source
        LIMIT ?`,
    )
    .all(projectId, modele, PASSAGES_PAR_PASSE_MAX) as {
    id: string;
    source: string;
    titre: string;
    texte: string;
  }[];
  if (!aFaire.length) return { faits: 0 };

  const vecteurs = await vectoriser(aFaire.map((p) => texteAVectoriser(p)));
  if (!vecteurs) return { faits: 0 };

  const poser = db.prepare('UPDATE doc_passages SET vecteur = ?, modele = ? WHERE id = ?');
  const ecrire = db.transaction(() => {
    aFaire.forEach((passage, rang) => {
      const vecteur = vecteurs[rang];
      if (!vecteurUtilisable(vecteur)) return;
      poser.run(vecteurEnBinaire(vecteur), modele, passage.id);
    });
  });
  try {
    ecrire();
  } catch (err) {
    log.warn(`vecteurs non enregistrés : ${(err as Error).message}`);
    return { faits: 0 };
  }
  return { faits: aFaire.length };
}

/** Tous les passages indexés d'un projet, empreinte de repli et vecteur compris. */
export function passagesIndexes(projectId: string): PassageIndexe[] {
  const modele = modeleDesVecteurs();
  const lignes = getDb()
    .prepare('SELECT source, titre, sujet, priorite, texte, empreinte, vecteur, modele FROM doc_passages WHERE project_id = ?')
    .all(projectId) as {
    source: string;
    titre: string;
    sujet: string;
    priorite: number;
    texte: string;
    empreinte: string;
    vecteur: Buffer | null;
    modele: string | null;
  }[];
  return lignes.map((ligne) => ({
    source: ligne.source,
    titre: ligne.titre,
    sujet: ligne.sujet,
    priorite: ligne.priorite,
    texte: ligne.texte,
    empreinte: JSON.parse(ligne.empreinte) as number[],
    vecteur: ligne.modele === modele ? vecteurDepuisBinaire(ligne.vecteur) : undefined,
  }));
}

/** Ce qu'une recherche rend au démon : le bloc à envoyer, et de quoi l'afficher. */
export interface RechercheDePassages {
  /** Le texte qui remplace l'index de la mémoire dans l'accueil. */
  texte: string;
  passages: PassageClasse[];
  jetons: number;
  /** Ce que pesait l'index qu'on remplace : c'est lui, le point de comparaison. */
  jetonsIndex: number;
  /** Combien de passages passaient le seuil sans tenir sous le plafond. */
  ecartes: number;
  /** Par le SENS RÉEL ou par les mots — et pourquoi, quand c'est par les mots. */
  mode: ModeDeRecherche;
}

/**
 * LA RECHERCHE POUR UNE TÂCHE. La demande de la carte sert de question ; on rend
 * les passages les mieux placés, sous plafond strict.
 *
 * Rend `undefined` — et l'index de la mémoire garde alors sa place — dans trois
 * cas, tous dits en clair par le contrôle : pas de question, aucun passage au
 * dessus du seuil, ou une recherche qui pèserait PLUS LOURD que l'index qu'elle
 * remplace (`rechercheRentable`). Le repli n'est pas une panne : c'est la règle.
 */
export async function rechercherPourLaTache(
  projectId: string,
  projectPath: string,
  question: string,
  index: { texte: string; faits: number },
): Promise<RechercheDePassages | undefined> {
  if (!question.trim()) return undefined;
  try {
    indexerDocumentation(projectId, projectPath);
    await vectoriserLIndex(projectId);
    const indexes = passagesIndexes(projectId);
    if (!indexes.length) return undefined;

    /*
     * LE MODE se décide AVANT de classer : soit tout le monde est jugé au sens
     * réel, soit tout le monde l'est à l'empreinte de mots. Mélanger les deux
     * échelles ferait gagner les passages vectorisés par construction.
     */
    const vecteurQuestion = await vectoriserLaQuestion(question);
    const mode = modeDeRecherche({
      vecteurQuestion,
      total: indexes.length,
      vectorises: indexes.filter((p) => p.vecteur).length,
    });

    const jetonsIndex = jetonsApproches(index.texte.length);
    const classes = classerPassages(
      indexes,
      question,
      mode.vecteurs
        ? { vecteurQuestion, poids: { sens: POIDS_SENS_VECTEUR, mots: POIDS_MOTS_VECTEUR } }
        : {},
    );
    const choix = choisirPassages(classes, {
      plafond: plafondDeRecherche(jetonsIndex),
      minimum: mode.vecteurs ? SCORE_MINIMUM_VECTEUR : undefined,
      maxCode: PASSAGES_CODE_MAX,
    });
    if (!choix.gardes.length) return undefined;

    /*
     * LE GARDE-FOU, APPLIQUÉ POUR DE VRAI. Le plafond porte sur les passages ;
     * le bloc, lui, porte aussi sa phrase d'introduction. On retire donc le
     * moins bien placé tant que l'ensemble pèse plus lourd que l'index qu'il
     * remplace — et si même un seul passage coûte plus cher, on renonce.
     */
    let gardes = choix.gardes;
    let ecartes = choix.ecartes;
    while (gardes.length) {
      const texte = texteDesPassages(gardes, index.faits);
      const jetons = jetonsApproches(texte.length);
      if (rechercheRentable(jetons, jetonsIndex)) {
        return { texte, passages: gardes, jetons, jetonsIndex, ecartes, mode };
      }
      gardes = gardes.slice(0, -1);
      ecartes++;
    }
    return undefined;
  } catch (err) {
    log.warn(`recherche de passages impossible : ${(err as Error).message}`);
    return undefined;
  }
}

/** Ce que la couverture doit atteindre pour que le sens réel prenne la main. */
export const COUVERTURE_MINIMALE = COUVERTURE_VECTEURS_MIN;
