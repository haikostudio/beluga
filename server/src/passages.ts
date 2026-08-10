import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOSSIER_MEMOIRE,
  PRIORITE,
  choisirPassages,
  classerPassages,
  decouperEnPassages,
  empreinteSemantique,
  jetonsApproches,
  plafondDeRecherche,
  rechercheRentable,
  texteDesPassages,
  type PassageClasse,
  type PassageDoc,
} from '@haikodev/shared';
import { getDb } from './db.js';
import { dossierDesCompetences } from './competences.js';
import { log } from './logger.js';

/**
 * LA RECHERCHE DANS LA DOCUMENTATION, CÔTÉ DISQUE ET BASE.
 *
 * Les règles (découpage, empreinte, score mixte, plafond) vivent dans
 * `shared/src/passages-doc.ts` et se testent seules. Ce module-ci fait les trois
 * choses qui demandent une machine :
 *
 *  1. LIRE la documentation du projet — règles, faits, contrôles, mécaniques,
 *     compétences partagées ;
 *  2. TENIR L'INDEX en base, de façon INCRÉMENTALE : un fichier inchangé n'est
 *     ni relu ni recalculé, un fichier modifié voit ses seuls passages remplacés ;
 *  3. RÉPONDRE à une question — la demande de la carte — par quelques passages
 *     sous plafond de jetons.
 *
 * Aucune clé n'est appelée : l'empreinte se calcule ici, sur le serveur. C'est
 * une règle du projet, et c'est aussi ce qui permet de tout réindexer en
 * quelques millisecondes.
 *
 * Rien de ce module ne doit jamais faire échouer un tour : au pire, il rend
 * `undefined` et l'index de la mémoire reprend sa place.
 */

/**
 * LA VERSION DU DÉCOUPAGE. Changer la façon de couper ou de calculer une
 * empreinte rend l'index existant incomparable : la version entre dans
 * l'empreinte des fichiers, si bien qu'un changement de règle force une
 * réindexation complète, sans migration à écrire.
 */
const VERSION_INDEX = 'v1';

/** Un fichier de documentation à indexer, avec ce qu'il pèse dans le classement. */
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
 * mécanique passe devant une règle, une règle devant une page libre.
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

  return liste;
}

function empreinteDuContenu(texte: string): string {
  return crypto.createHash('sha1').update(`${VERSION_INDEX}\n${texte}`).digest('hex').slice(0, 16);
}

function idDuPassage(projectId: string, source: string, rang: number): string {
  return crypto.createHash('sha1').update(`${projectId}\n${source}\n${rang}`).digest('hex').slice(0, 20);
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
        texte = fs.readFileSync(fichier.chemin, 'utf8');
      } catch {
        continue;
      }
      const empreinte = empreinteDuContenu(texte);
      if (connus.get(fichier.source) === empreinte) continue;

      supprimerPassages.run(projectId, fichier.source);
      const passages = decouperEnPassages(fichier.source, texte, {
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

/** L'empreinte d'un passage : son titre compte, il porte le sujet en clair. */
function empreinteDuPassage(passage: PassageDoc): number[] {
  return empreinteSemantique(`${passage.titre}\n${passage.texte}`);
}

/** Tous les passages indexés d'un projet, empreinte comprise. */
export function passagesIndexes(projectId: string): (PassageDoc & { empreinte: number[] })[] {
  const lignes = getDb()
    .prepare('SELECT source, titre, sujet, priorite, texte, empreinte FROM doc_passages WHERE project_id = ?')
    .all(projectId) as {
    source: string;
    titre: string;
    sujet: string;
    priorite: number;
    texte: string;
    empreinte: string;
  }[];
  return lignes.map((ligne) => ({
    source: ligne.source,
    titre: ligne.titre,
    sujet: ligne.sujet,
    priorite: ligne.priorite,
    texte: ligne.texte,
    empreinte: JSON.parse(ligne.empreinte) as number[],
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
export function rechercherPourLaTache(
  projectId: string,
  projectPath: string,
  question: string,
  index: { texte: string; faits: number },
): RechercheDePassages | undefined {
  if (!question.trim()) return undefined;
  try {
    indexerDocumentation(projectId, projectPath);
    const indexes = passagesIndexes(projectId);
    if (!indexes.length) return undefined;

    const jetonsIndex = jetonsApproches(index.texte.length);
    const classes = classerPassages(indexes, question);
    const choix = choisirPassages(classes, { plafond: plafondDeRecherche(jetonsIndex) });
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
        return { texte, passages: gardes, jetons, jetonsIndex, ecartes };
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
