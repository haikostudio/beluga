import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DIMENSIONS_MINIMALES,
  DOSSIER_MEMOIRE,
  PASSAGES_SUITE_MAX,
  PLAFOND_PASSAGES_SUITE_JETONS,
  SCORE_MINIMUM,
  passagesInedits,
  seuilDeSuite,
  texteDesPassagesDeSuite,
  DOSSIER_PLANS,
  FICHIERS_CODE_MAX,
  FICHIERS_DOC_MAX,
  PASSAGES_CODE_MAX,
  PASSAGES_PAR_PASSE_MAX,
  POIDS_MOTS_VECTEUR,
  POIDS_SENS_VECTEUR,
  PRIORITE,
  SCORE_MINIMUM_VECTEUR,
  PROFONDEUR_CODE_MAX,
  SIGNES_MAX_PAR_FICHIER,
  DOSSIERS_HORS_INDEX,
  DOSSIERS_SANS_DOC,
  choisirPassages,
  classerPassages,
  decouperCodeEnPassages,
  decouperEnPassages,
  empreinteSemantique,
  estDocumentMarkdown,
  estFichierDeCode,
  estFichierDeConfig,
  jetonsApproches,
  modeDeRecherche,
  plafondDeRecherche,
  rechercheConvaincante,
  rechercheRentable,
  sensUtileSur,
  texteAVectoriser,
  texteDesPassages,
  vecteurUtilisable,
  vecteursRepris,
  type ModeDeRecherche,
  type TerrainDeRecherche,
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
const VERSION_INDEX = 'v3';

/* ------------------------------------------------------------------ */
/* L'INDEX EN MÉMOIRE VIVE                                             */
/* ------------------------------------------------------------------ */

/**
 * UN PASSAGE TEL QU'IL EST GARDÉ EN MÉMOIRE — le vecteur reste sous sa forme
 * BINAIRE (celle de la base) et le modèle qui l'a produit reste à côté : la
 * conversion en `PassageIndexe` (vers un `Float32Array`, filtrée par le modèle
 * COURANT) se refait à chaque lecture, pour rester identique à ce que
 * `passagesIndexes` rendait avant ce cache — un changement de moteur de
 * vectorisation en cours de route ne doit rien casser.
 */
interface PassageEnCache {
  source: string;
  titre: string;
  sujet: string;
  priorite: number;
  texte: string;
  empreinte: number[];
  vecteur: Buffer | null;
  modele: string | null;
}

/**
 * TENIR L'INDEX EN MÉMOIRE, PAR PROJET, POUR TOUTE LA VIE DU PROCESSUS.
 *
 * La recherche relisait TOUTE la table `doc_passages` à chaque demande — 880 ms
 * sur les 5 143 passages de HaikoDev, dont l'essentiel à faire un `JSON.parse`
 * de l'empreinte de repli de chacun. Or `indexerDocumentation` sait déjà,
 * précisément, ce qui a changé (un fichier modifié, un fichier disparu) : il
 * met ce cache à jour lui-même, passage par passage, sans jamais relire ce qui
 * n'a pas bougé. `vectoriserLIndex` fait de même pour les vecteurs qu'il vient
 * de calculer.
 *
 * La clé du sous-dossier est le SOURCE (le chemin relatif du fichier) : c'est
 * la même granularité que la base (`doc_fichiers.chemin`), donc un fichier
 * modifié ou disparu se traite en UNE écriture, jamais en relisant les autres.
 *
 * Le premier accès à un projet — après un redémarrage, ou son tout premier
 * passage dans ce processus — coûte encore la lecture complète : c'est le prix,
 * payé une fois, de ne plus jamais la repayer ensuite.
 */
const indexEnMemoire = new Map<string, Map<string, PassageEnCache[]>>();

/** Charge l'index d'un projet depuis la base — le coût payé une seule fois. */
function chargerIndexDepuisLaBase(projectId: string): Map<string, PassageEnCache[]> {
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
  const carte = new Map<string, PassageEnCache[]>();
  for (const ligne of lignes) {
    const liste = carte.get(ligne.source) ?? [];
    liste.push({
      source: ligne.source,
      titre: ligne.titre,
      sujet: ligne.sujet,
      priorite: ligne.priorite,
      texte: ligne.texte,
      empreinte: JSON.parse(ligne.empreinte) as number[],
      vecteur: ligne.vecteur,
      modele: ligne.modele,
    });
    carte.set(ligne.source, liste);
  }
  return carte;
}

/** L'index en mémoire d'un projet — chargé depuis la base au tout premier accès. */
function indexDuProjet(projectId: string): Map<string, PassageEnCache[]> {
  let carte = indexEnMemoire.get(projectId);
  if (!carte) {
    carte = chargerIndexDepuisLaBase(projectId);
    indexEnMemoire.set(projectId, carte);
  }
  return carte;
}

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

/**
 * LA PLACE D'UN DOCUMENT DANS LE CLASSEMENT, d'après son chemin. Les dossiers
 * NOMMÉS de HaikoDev gardent la priorité qu'ils avaient ; tout autre Markdown
 * entre en priorité normale — une page rangée ailleurs n'est pas moins vraie,
 * elle est simplement moins souvent la réponse.
 */
export function rangDuDocument(source: string): { sujet: string; priorite: number } {
  const nom = (source.split('/').pop() ?? '').replace(/\.(md|markdown)$/i, '');
  const sansExtension = source.replace(/\.(md|markdown)$/i, '');
  if (source.startsWith(`${DOSSIER_MECANIQUES}/`)) return { sujet: nom, priorite: PRIORITE.mecanique };
  /*
   * LES PLANS DU CHEF D'ORCHESTRE. Un plan est écrit AVANT la carte qui le
   * réalise, pour cette carte-là : à score égal il passe donc devant, comme une
   * mécanique. Le sujet est PRÉFIXÉ (`plan-…`) : deux fichiers du même nom,
   * l'un en règle l'autre en plan, ne se confondent pas dans `project_memory`.
   */
  if (source.startsWith(`${DOSSIER_PLANS}/`)) return { sujet: `plan-${nom}`, priorite: PRIORITE.mecanique };
  if (source.startsWith('docs/regles/')) return { sujet: nom, priorite: PRIORITE.regle };
  if (source.startsWith(`${DOSSIER_MEMOIRE}/`)) return { sujet: nom, priorite: PRIORITE.regle };
  if (source === 'docs/verifications.md') return { sujet: 'verifications', priorite: PRIORITE.regle };
  // Le reste de `docs/`, à plat : les cartes de sujets, les audits.
  if (/^docs\/[^/]+$/.test(source)) return { sujet: nom, priorite: PRIORITE.normale };
  if (source === 'DOCUMENTATION.md') return { sujet: 'documentation', priorite: PRIORITE.normale };
  // Partout ailleurs, le CHEMIN fait le sujet : deux « README.md » de deux
  // dossiers ne se confondent pas.
  return { sujet: sansExtension.replace(/\//g, '-').toLowerCase(), priorite: PRIORITE.normale };
}

/**
 * TOUT CE QU'ON INDEXE D'UN PROJET, en une seule descente.
 *
 * Trois familles, dans cet ordre de poids : les DOCUMENTS Markdown (où qu'ils
 * soient — un cours dans `scripts/`, un document du chef dans `data/documents/`,
 * un `README.md` au fond d'un dossier : l'information est à tous les niveaux),
 * les fichiers de CONFIGURATION, puis le CODE. La PRIORITÉ décide des ex æquo :
 * une fiche de mécanique passe devant une règle, une règle devant une page
 * libre, une page libre devant un fichier de code.
 */
export function fichiersAIndexer(projectPath: string): FichierIndexable[] {
  const documents: FichierIndexable[] = [];
  const code: FichierIndexable[] = [];

  const parcourir = (dossier: string, relatif: string, profondeur: number) => {
    if (documents.length >= FICHIERS_DOC_MAX && code.length >= FICHIERS_CODE_MAX) return;
    let entrees: fs.Dirent[];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
      const suite = relatif ? `${relatif}/${entree.name}` : entree.name;
      if (entree.isDirectory()) {
        if (DOSSIERS_SANS_DOC.has(entree.name)) continue;
        if (entree.name.startsWith('.') && entree.name !== '.claude') continue;
        parcourir(path.join(dossier, entree.name), suite, profondeur + 1);
        continue;
      }
      if (!entree.isFile()) continue;
      const chemin = path.join(dossier, entree.name);

      if (estDocumentMarkdown(suite)) {
        if (documents.length >= FICHIERS_DOC_MAX) continue;
        documents.push({ source: suite, chemin, ...rangDuDocument(suite) });
        continue;
      }
      if (code.length >= FICHIERS_CODE_MAX) continue;
      /*
       * Le CODE et la CONFIGURATION descendent moins loin et écartent plus de
       * dossiers que les documents (`data/`, `tmp/`, `logs/`…) : c'est le
       * volume qui l'impose, un dépôt porte cent fois plus de code que de pages.
       */
      if (profondeur > PROFONDEUR_CODE_MAX) continue;
      if (relatif.split('/').some((part) => DOSSIERS_HORS_INDEX.has(part))) continue;
      if (estFichierDeConfig(suite) || estFichierDeCode(suite)) {
        code.push({
          source: suite,
          chemin,
          sujet: `code-${suite.split('/')[0]}`,
          priorite: PRIORITE.code,
        });
      }
    }
  };
  parcourir(projectPath, '', 0);

  // Les COMPÉTENCES PARTAGÉES : elles ne vivent pas dans le dépôt du projet
  // (`data/` est hors dépôt) mais elles s'appliquent à tous les projets.
  const competences = dossierDesCompetences();
  try {
    for (const nom of fs.readdirSync(competences)) {
      const chemin = path.join(competences, nom, 'SKILL.md');
      if (!fs.existsSync(chemin)) continue;
      documents.push({
        source: `data/competences/${nom}/SKILL.md`,
        chemin,
        sujet: `competence-${nom}`,
        priorite: PRIORITE.normale,
      });
    }
  } catch {
    /* aucune compétence : rien à indexer */
  }

  return [...documents, ...code];
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

/**
 * Le chemin inverse. La TAILLE n'est plus fixe — elle dépend du moteur (1 024
 * pour bge-m3, 512 pour le modèle d'OpenAI) —, on vérifie donc seulement qu'elle
 * est plausible : un multiple de quatre octets, au moins `DIMENSIONS_MINIMALES`.
 * C'est le NOM du modèle rangé à côté qui empêche de comparer deux échelles.
 */
function vecteurDepuisBinaire(brut: Buffer | Uint8Array | null | undefined): Float32Array | undefined {
  if (!brut || brut.byteLength % 4 !== 0 || brut.byteLength < DIMENSIONS_MINIMALES * 4) return undefined;
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
  // L'index en mémoire du projet — chargé une fois depuis la base, tenu à jour
  // ci-dessous EXACTEMENT comme la base, jamais relu ensuite.
  const carteCache = indexDuProjet(projectId);

  const supprimerFichier = db.prepare('DELETE FROM doc_fichiers WHERE project_id = ? AND chemin = ?');
  const supprimerPassages = db.prepare('DELETE FROM doc_passages WHERE project_id = ? AND source = ?');
  const poserFichier = db.prepare(
    'INSERT OR REPLACE INTO doc_fichiers (project_id, chemin, empreinte, indexe_at) VALUES (?, ?, ?, ?)',
  );
  const poserPassage = db.prepare(
    `INSERT OR REPLACE INTO doc_passages
       (id, project_id, source, titre, sujet, priorite, texte, empreinte, signes, maj_at, vecteur, modele)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  /*
   * LES « ANCIENS » VIENNENT DE LA BASE, PAS DU CACHE — à dessein. Le cache
   * n'a de garantie d'exactitude que sur ce que CE module a lui-même écrit ;
   * un contrôle qui pose un vecteur en SQL direct (`scripts/verif-memoire-des-
   * vecteurs.mjs`), ou tout futur écrivain hors de ce fichier, le laisserait
   * périmé. La lecture ici reste ciblée (quelques lignes, un seul fichier) :
   * ce n'est pas elle qui coûtait les 880 ms mesurés, c'est la lecture de
   * TOUT l'index à chaque appel — c'est CETTE lecture-là que le cache évite.
   */
  const lireAnciens = db.prepare(
    'SELECT titre, texte, vecteur, modele FROM doc_passages WHERE project_id = ? AND source = ?',
  );

  let modifies = 0;
  const maintenant = Date.now();
  // Les changements à répercuter sur le CACHE — appliqués seulement après le
  // succès de la transaction, jamais pendant : une transaction qui échoue est
  // annulée côté base, et le cache ne doit alors pas s'en écarter.
  const suppressionsEnCache: string[] = [];
  const misesAJourEnCache: { source: string; passages: PassageEnCache[] }[] = [];

  const travail = db.transaction(() => {
    const vivants = new Set(fichiers.map((f) => f.source));
    // Un fichier disparu emporte ses passages : un index qui garde des règles
    // effacées ferait conclure un agent sur un texte qui n'existe plus.
    for (const chemin of connus.keys()) {
      if (vivants.has(chemin)) continue;
      supprimerFichier.run(projectId, chemin);
      supprimerPassages.run(projectId, chemin);
      suppressionsEnCache.push(chemin);
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

      /*
       * CE QU'ON VA POUVOIR REPRENDRE. Un fichier réécrit voit tous ses
       * passages effacés, mais la modification n'en touche qu'un ou deux : les
       * autres sont mot pour mot les mêmes et gardent donc leur vecteur
       * (`vecteursRepris`, shared/src/vecteurs-doc.ts). Sans cela, un projet
       * dont la documentation bouge chaque jour retombe sous le seuil de
       * couverture et cherche par les MOTS toute la journée, pendant que la
       * nuit revectorise en pure perte.
       */
      const anciens = lireAnciens.all(projectId, fichier.source) as {
        titre: string;
        texte: string;
        vecteur: Buffer | null;
        modele: string | null;
      }[];
      supprimerPassages.run(projectId, fichier.source);
      const passages =
        fichier.priorite === PRIORITE.code
          ? decouperCodeEnPassages(fichier.source, texte, { sujet: fichier.sujet })
          : decouperEnPassages(fichier.source, texte, {
              sujet: fichier.sujet,
              priorite: fichier.priorite,
            });
      const repris = vecteursRepris(anciens, passages);
      const nouveauxEnCache: PassageEnCache[] = [];
      passages.forEach((passage, rang) => {
        const garde = repris[rang];
        const empreintePassage = empreinteDuPassage(passage);
        poserPassage.run(
          idDuPassage(projectId, fichier.source, rang),
          projectId,
          passage.source,
          passage.titre,
          passage.sujet,
          passage.priorite,
          passage.texte,
          JSON.stringify(empreintePassage),
          passage.texte.length,
          maintenant,
          garde?.vecteur ?? null,
          garde?.modele ?? null,
        );
        nouveauxEnCache.push({
          source: passage.source,
          titre: passage.titre,
          sujet: passage.sujet,
          priorite: passage.priorite,
          texte: passage.texte,
          empreinte: empreintePassage,
          vecteur: garde?.vecteur ?? null,
          modele: garde?.modele ?? null,
        });
      });
      poserFichier.run(projectId, fichier.source, empreinte, maintenant);
      misesAJourEnCache.push({ source: fichier.source, passages: nouveauxEnCache });
      modifies++;
    }
  });

  try {
    travail();
  } catch (err) {
    log.warn(`indexation de la documentation impossible : ${(err as Error).message}`);
    // Le cache a pu être lu (indexDuProjet) mais rien n'a été mis à jour côté
    // base : on ne touche à AUCUNE entrée, il reste donc fidèle à la base.
    return { fichiers: fichiers.length, modifies: 0, passages: 0 };
  }

  // La transaction a réussi : le cache suit, exactement comme la base.
  for (const chemin of suppressionsEnCache) carteCache.delete(chemin);
  for (const { source, passages } of misesAJourEnCache) carteCache.set(source, passages);

  let total = 0;
  for (const passages of carteCache.values()) total += passages.length;
  return { fichiers: fichiers.length, modifies, passages: total };
}

/** L'empreinte de repli d'un passage : son titre compte, il porte le sujet en clair. */
function empreinteDuPassage(passage: PassageDoc): number[] {
  return empreinteSemantique(`${passage.titre}\n${passage.texte}`);
}

/* ------------------------------------------------------------------ */
/* La vectorisation de l'index                                         */
/* ------------------------------------------------------------------ */

/**
 * OÙ EN EST L'INDEX D'UN PROJET — ET ON NE COMPTE QUE LES DOCUMENTS.
 *
 * Le CODE pèse les deux tiers de l'index (35 035 passages sur 62 490) mais joue
 * un rôle secondaire : il passe derrière la documentation, ne prend jamais plus
 * de deux places sur sept, et ce qu'on lui demande le plus — retrouver un
 * fichier qu'on NOMME — marche par les mots exacts, pas par le sens. Attendre
 * qu'il soit vectorisé pour basculer, c'était retarder la recherche par le sens
 * de plusieurs jours pour un gain marginal.
 *
 * La couverture porte donc sur la DOCUMENTATION (priorité ≥ 0), qui est aussi
 * ce que la vectorisation traite EN PREMIER (`ORDER BY priorite DESC`). Le code
 * suit, et l'améliore encore, sans jamais la bloquer.
 */
export function couvertureDesVecteurs(projectId: string): { total: number; vectorises: number } {
  const db = getDb();
  const total = (db
    .prepare('SELECT COUNT(*) AS n FROM doc_passages WHERE project_id = ? AND priorite >= 0')
    .get(projectId) as { n: number }).n;
  const vectorises = (db
    .prepare(
      'SELECT COUNT(*) AS n FROM doc_passages WHERE project_id = ? AND priorite >= 0 AND modele = ? AND vecteur IS NOT NULL',
    )
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
export async function vectoriserLIndex(projectId: string, saut = 0): Promise<{ faits: number }> {
  const db = getDb();
  const modele = modeleDesVecteurs();
  const carteCache = indexDuProjet(projectId);
  /*
   * LE SAUT permet à PLUSIEURS processus de vectoriser le MÊME projet sans se
   * marcher dessus : chacun part d'un rang différent dans la liste de ce qui
   * reste à faire. Sur un gros projet, c'est la seule façon d'occuper les
   * quatre cœurs — un processus d'un fil rend 0,8 passage/s, trois en rendent
   * 2,4. Un recouvrement à la marge ne coûte qu'un vecteur recalculé.
   */
  const aFaire = db
    .prepare(
      `SELECT id, source, titre, texte FROM doc_passages
        WHERE project_id = ? AND (vecteur IS NULL OR modele IS NOT ?)
        ORDER BY priorite DESC, source
        LIMIT ? OFFSET ?`,
    )
    .all(projectId, modele, PASSAGES_PAR_PASSE_MAX, saut) as {
    id: string;
    source: string;
    titre: string;
    texte: string;
  }[];
  if (!aFaire.length) return { faits: 0 };

  const poser = db.prepare('UPDATE doc_passages SET vecteur = ?, modele = ? WHERE id = ?');
  let faits = 0;

  /*
   * ON ÉCRIT AU FIL DE L'EAU, PAR SOUS-LOTS. Le moteur local met une dizaine de
   * minutes à traiter une tranche entière : n'enregistrer qu'à la fin, c'était
   * tout reperdre si le processus était arrêté entre-temps. On range donc ce qui
   * est fait tous les `ECRITURE_TOUS_LES` passages — le travail acquis reste
   * acquis, et une reprise ne recommence que le dernier sous-lot.
   */
  for (let debut = 0; debut < aFaire.length; debut += ECRITURE_TOUS_LES) {
    const tranche = aFaire.slice(debut, debut + ECRITURE_TOUS_LES);
    const vecteurs = await vectoriser(tranche.map((p) => texteAVectoriser(p)));
    if (!vecteurs) break;
    const ecrire = db.transaction(() => {
      tranche.forEach((passage, rang) => {
        const vecteur = vecteurs[rang];
        if (!vecteurUtilisable(vecteur)) return;
        poser.run(vecteurEnBinaire(vecteur), modele, passage.id);
      });
    });
    try {
      ecrire();
      faits += tranche.length;
      // Le CACHE suit, comme la base : on ne touche à un passage qu'une fois
      // la transaction commise, jamais avant.
      tranche.forEach((passage, rang) => {
        const vecteur = vecteurs[rang];
        if (!vecteurUtilisable(vecteur)) return;
        const liste = carteCache.get(passage.source);
        const entree = liste?.find((p) => p.titre === passage.titre && p.texte === passage.texte);
        if (!entree) return;
        entree.vecteur = vecteurEnBinaire(vecteur);
        entree.modele = modele;
      });
    } catch (err) {
      log.warn(`vecteurs non enregistrés : ${(err as Error).message}`);
      break;
    }
  }
  return { faits };
}

/** Tous les combien on range ce qui est vectorisé : assez souvent pour ne rien reperdre. */
const ECRITURE_TOUS_LES = 96;

/**
 * Tous les passages indexés d'un projet, empreinte de repli et vecteur compris.
 *
 * Lit désormais l'INDEX EN MÉMOIRE (`indexDuProjet`) plutôt que la base : plus
 * de lecture des 5 000+ lignes ni de `JSON.parse` de leur empreinte à chaque
 * appel — seule la conversion binaire → `Float32Array` du vecteur se refait ici,
 * filtrée par le modèle COURANT comme avant ce cache.
 */
export function passagesIndexes(projectId: string): PassageIndexe[] {
  const modele = modeleDesVecteurs();
  const carte = indexDuProjet(projectId);
  const resultat: PassageIndexe[] = [];
  for (const passages of carte.values()) {
    for (const passage of passages) {
      resultat.push({
        source: passage.source,
        titre: passage.titre,
        sujet: passage.sujet,
        priorite: passage.priorite,
        texte: passage.texte,
        empreinte: passage.empreinte,
        vecteur: passage.modele === modele ? vecteurDepuisBinaire(passage.vecteur) : undefined,
      });
    }
  }
  return resultat;
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
  /**
   * La recherche a-t-elle trouvé quelque chose de NETTEMENT pertinent ?
   * Comparé au reste du corpus classé pour cette question, pas seulement aux
   * passages retenus (`rechercheConvaincante`, shared/src/passages-doc.ts).
   */
  pertinents?: boolean;
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
/**
 * LE TRAVAIL COMMUN AUX DEUX RECHERCHES : indexer ce qui a changé, choisir le
 * mode (sens réel ou mots), classer tout l'index face à la question. Ce qui
 * DIFFÈRE — le plafond, le seuil, les passages déjà servis, le texte du bloc —
 * reste chez l'appelant.
 */
async function classerPourLaQuestion(
  projectId: string,
  projectPath: string,
  question: string,
  /**
   * LE TERRAIN — et c'est LUI qui décide du mode, avant tout le reste. La demande
   * d'une carte et un message tapé ne sont pas la même population de questions :
   * mesuré, le sens n'apporte rien sur la première et gagne sur la seconde
   * (`SENS_PAR_TERRAIN`, shared/src/vecteurs-doc.ts).
   */
  terrain: TerrainDeRecherche,
): Promise<{ classes: PassageClasse[]; mode: ModeDeRecherche } | undefined> {
  /*
   * ON INDEXE, ON NE VECTORISE PAS. Découper les fichiers modifiés coûte
   * quelques centaines de millisecondes et doit être fait maintenant, sinon
   * l'agent travaillerait sur une documentation d'hier. VECTORISER, en
   * revanche, est un travail de fond : il se fait la nuit, pour tous les
   * projets d'un coup (`server/src/vecteurs-nocturne.ts`). Le seul appel payé
   * ici est celui de la QUESTION — un vecteur, quelques dizaines de
   * millisecondes.
   */
  indexerDocumentation(projectId, projectPath);
  const indexes = passagesIndexes(projectId);
  if (!indexes.length) return undefined;

  /*
   * LE MODE se décide AVANT de classer : soit tout le monde est jugé au sens
   * réel, soit tout le monde l'est à l'empreinte de mots. Mélanger les deux
   * échelles ferait gagner les passages vectorisés par construction.
   *
   * ET ON NE VECTORISE PAS UNE QUESTION QU'ON NE COMPTE PAS UTILISER : sur un
   * terrain rendu aux mots exacts, l'appel au modèle serait 189 ms payés pour
   * rien à chaque lancement de carte.
   */
  const vecteurQuestion = sensUtileSur(terrain) ? await vectoriserLaQuestion(question) : undefined;
  /*
   * La couverture se juge sur la DOCUMENTATION seule : le code vient après et
   * ne doit pas retenir la bascule (`couvertureDesVecteurs`).
   */
  const documents = indexes.filter((p) => p.priorite >= 0);
  const mode = modeDeRecherche({
    terrain,
    vecteurQuestion,
    total: documents.length,
    vectorises: documents.filter((p) => p.vecteur).length,
  });

  const classes = classerPassages(
    indexes,
    question,
    mode.vecteurs
      ? { vecteurQuestion, poids: { sens: POIDS_SENS_VECTEUR, mots: POIDS_MOTS_VECTEUR } }
      : {},
  );
  return { classes, mode };
}

export async function rechercherPourLaTache(
  projectId: string,
  projectPath: string,
  question: string,
  /**
   * L'index qu'on remplace : son TEXTE (le point de comparaison du garde-fou),
   * son nombre de faits, et son SOMMAIRE — la seule part de l'index qui reste
   * dans le bloc envoyé, pour que l'agent sache quels sujets il peut demander.
   */
  index: { texte: string; faits: number; sommaire?: string },
): Promise<RechercheDePassages | undefined> {
  if (!question.trim()) return undefined;
  try {
    const classement = await classerPourLaQuestion(projectId, projectPath, question, 'lancement');
    if (!classement) return undefined;
    const { classes, mode } = classement;
    const pertinents = rechercheConvaincante(classes);

    const jetonsIndex = jetonsApproches(index.texte.length);
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
      const texte = texteDesPassages(gardes, index.faits, index.sommaire);
      const jetons = jetonsApproches(texte.length);
      if (rechercheRentable(jetons, jetonsIndex)) {
        return { texte, passages: gardes, jetons, jetonsIndex, ecartes, mode, pertinents };
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

/**
 * LA RECHERCHE POUR UN MESSAGE DE SUITE — la deuxième question, la dixième.
 *
 * La session est déjà ouverte : l'index de la mémoire est parti au premier tour
 * et ne repart pas. Rien n'était donc cherché du tout, et l'utilisateur voyait
 * une bulle « Mémoire du projet retrouvée » qui ne portait qu'un rappel
 * générique — alors que sa question, elle, était neuve.
 *
 * On cherche donc sur le texte QU'IL VIENT D'ÉCRIRE, et on ne garde que ce
 * qu'il n'a pas déjà reçu dans cette session (`dejaServies`, des clés
 * `source#titre`). Trois différences avec le lancement : plafond plus bas, seuil
 * plus exigeant, aucun index à remplacer — donc aucun test de rentabilité, ces
 * passages n'économisent rien, ils ajoutent le peu qui manque.
 */
export async function rechercherPourLaSuite(
  projectId: string,
  projectPath: string,
  question: string,
  dejaServies: Iterable<string>,
): Promise<RechercheDePassages | undefined> {
  if (!question.trim()) return undefined;
  try {
    const classement = await classerPourLaQuestion(projectId, projectPath, question, 'conversation');
    if (!classement) return undefined;

    const candidats = passagesInedits(classement.classes, dejaServies);
    if (!candidats.length) return undefined;

    const choix = choisirPassages(candidats, {
      plafond: PLAFOND_PASSAGES_SUITE_JETONS,
      max: PASSAGES_SUITE_MAX,
      minimum: seuilDeSuite(classement.mode.vecteurs ? SCORE_MINIMUM_VECTEUR : SCORE_MINIMUM),
      maxCode: PASSAGES_CODE_MAX,
    });
    if (!choix.gardes.length) return undefined;

    const texte = texteDesPassagesDeSuite(choix.gardes);
    return {
      texte,
      passages: choix.gardes,
      jetons: jetonsApproches(texte.length),
      jetonsIndex: 0,
      ecartes: choix.ecartes,
      mode: classement.mode,
      pertinents: rechercheConvaincante(classement.classes),
    };
  } catch (err) {
    log.warn(`recherche de passages (tour de suite) impossible : ${(err as Error).message}`);
    return undefined;
  }
}
