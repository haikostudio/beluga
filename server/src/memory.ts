import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FICHIER_D_ATTENTE,
  MARQUE_ARBRE,
  amontApplicable,
  brancheDemandee,
  carteDeLArbre,
  chercherFaits,
  construireLArbre,
  dossierDuSujet,
  rappelDuSujet,
  rendreBranche,
  rendreRacine,
  rendreRappelDuSujet,
  type SujetEnArbre,
  classerRegles,
  decouperRegles,
  estLigneDeJournal,
  extraitDeControles,
  extraitDeSujet,
  faitsDuTexte,
  fichierDuSujet,
  fichierNatif,
  instructionsQuiFontFoi,
  libelleSujet,
  lireDemandeDeMemoire,
  mentionDEcart,
  nettoyer,
  partagerSujets,
  partsDAccueil,
  reglesContenant,
  repartirParSujet,
  SUJETS_MEMOIRE,
  SUJETS_REGLES,
  sujetDeLaRequete,
  sujetDuFait,
  sujetNomme,
  sujetNommeAFiltrer,
  sujetsPourRequete,
  texteAccesGithub,
  texteDesCompetences,
  type InstructionsDuProjet,
  type NiveauDAccueil,
  type SujetRegles,
} from '@haikodev/shared';
import { dossierDesCompetences, listerCompetences } from './competences.js';

/**
 * La mémoire du projet (PLAN §25) : du texte DANS le dépôt, que les agents
 * lisent naturellement et qui suit le code dans l'historique. Règle d'hygiène :
 * une ligne devenue fausse est remplacée, pas empilée.
 *
 * ELLE EST RANGÉE EN ARBRE, et c'est le seul chemin pour la retrouver — il n'y
 * a plus de recherche par le sens derrière (`shared/src/arbre-memoire.ts`) :
 *  — MEMOIRE.md : la RACINE. Les sujets, et les MOTS de leurs branches. Aucun
 *    fait : rien que des chemins, pour l'humain comme pour l'agent.
 *  — `docs/memoire/<sujet>.md` : le RAPPEL de premier niveau — ce qui existe
 *    sous ce sujet, et où.
 *  — `docs/memoire/<sujet>/<sujet>-<branche>.md` : le DÉTAIL. Le dossier porte
 *    le nom du parent, et chaque fichier le répète : un mot lu dans la racine
 *    donne le chemin exact, sans rien chercher.
 *  — HISTORIQUE.md : les livraisons datées. Relisible par un humain, jamais
 *    envoyé au moteur : « telle carte livrée le 3 août » n'apprend rien à un
 *    agent qui commence une tâche.
 */

const FILE_NAME = 'MEMOIRE.md';
const HISTORY_NAME = 'HISTORIQUE.md';
const HISTORY_HEADER =
  "# Historique des livraisons\n\n_Tenu automatiquement par HaikoDev. Ce fichier n'est JAMAIS envoyé au moteur : il se relit à la main._\n\n";

/**
 * Plafond de sécurité, pas outil de ménage : la réduction se fait par synthèse
 * (voir `synthese-memoire.ts`). Couper les plus anciennes lignes à l'aveugle
 * jetait des pièges encore vrais.
 */
const MAX_LINES = 200;

export function memoryPath(projectPath: string): string {
  return path.join(projectPath, FILE_NAME);
}

export function historyPath(projectPath: string): string {
  return path.join(projectPath, HISTORY_NAME);
}

/** Le fichier d'un sujet de mémoire, sur le disque. */
export function cheminDuSujet(projectPath: string, sujet: string): string {
  return path.join(projectPath, ...fichierDuSujet(sujet).split('/'));
}

function lireFichier(chemin: string): string {
  try {
    return fs.readFileSync(chemin, 'utf8');
  } catch {
    return '';
  }
}

/**
 * La marque du SOMMAIRE. Sans elle, les lignes de MEMOIRE.md qui renvoient aux
 * fichiers de sujet seraient relues comme autant de faits — la mémoire se
 * remplirait d'elle-même à chaque passage.
 */
const MARQUE_SOMMAIRE = '<!-- haikodev:memoire-par-sujet -->';

/** Les faits restés dans le vieux fichier plat : rien si c'est déjà la racine. */
function faitsRestes(projectPath: string): string[] {
  const texte = lireFichier(memoryPath(projectPath));
  if (texte.includes(MARQUE_ARBRE) || texte.includes(MARQUE_SOMMAIRE)) return [];
  return faitsDuTexte(texte);
}

/**
 * LES CHEMINS DES BRANCHES, LUS DANS LE RAPPEL DU SUJET.
 *
 * L'ordre compte : c'est lui qui rend une écriture puis une relecture
 * identiques. Le rappel les cite dans l'ordre où elles ont été écrites, chacune
 * entre accents graves ; à défaut de rappel lisible, on retombe sur le contenu
 * du dossier, trié par nom — jamais sur l'ordre que le système de fichiers
 * voudra bien rendre.
 */
function branchesDuSujet(projectPath: string, sujet: string): string[] {
  const relatifs: string[] = [];
  const dossier = dossierDuSujet(sujet);
  const cites = lireFichier(cheminDuSujet(projectPath, sujet)).matchAll(/`([^`]+\.md)`/g);
  for (const [, chemin] of cites) {
    if (chemin.startsWith(`${dossier}/`) && !relatifs.includes(chemin)) relatifs.push(chemin);
  }

  let surLeDisque: string[] = [];
  try {
    surLeDisque = fs
      .readdirSync(path.join(projectPath, ...dossier.split('/')))
      .filter((nom) => nom.endsWith('.md'))
      .sort()
      .map((nom) => `${dossier}/${nom}`);
  } catch {
    surLeDisque = [];
  }

  // Ce que le rappel cite d'abord, puis ce qui traîne dans le dossier sans y
  // être cité : un fichier ajouté à la main ne disparaît pas de la lecture.
  const existe = new Set(surLeDisque);
  return [...relatifs.filter((c) => existe.has(c)), ...surLeDisque.filter((c) => !relatifs.includes(c))];
}

/**
 * Les faits d'un SEUL sujet — son rappel ET toutes ses branches. Un sujet resté
 * à plat porte ses faits dans son rappel ; un sujet éclaté n'y garde que des
 * chemins, et les faits vivent dans le dossier enfant.
 */
export function faitsDuSujet(projectPath: string, sujet: string): string[] {
  const vus = new Set<string>();
  const faits: string[] = [];
  const ajouter = (texte: string) => {
    for (const fait of faitsDuTexte(texte)) {
      const cle = fait.toLowerCase();
      if (vus.has(cle)) continue;
      vus.add(cle);
      faits.push(fait);
    }
  };
  const branches = branchesDuSujet(projectPath, sujet);
  for (const branche of branches) {
    ajouter(lireFichier(path.join(projectPath, ...branche.split('/'))));
  }
  /*
   * LE RAPPEL D'UN SUJET ÉCLATÉ NE PORTE PAS DE FAIT — il ne porte que des
   * chemins, écrits eux aussi à la puce. Les relire comme des faits ferait
   * entrer « **Catalogue** (3) — `…md` » dans la mémoire à chaque passage : la
   * mémoire se remplirait de sa propre table des matières.
   */
  if (!branches.length) ajouter(lireFichier(cheminDuSujet(projectPath, sujet)));
  return faits;
}

/**
 * Les faits rangés par sujet, lus sur le disque. Un projet pas encore découpé
 * (ou un projet tiers) garde ses faits dans MEMOIRE.md : ils sont répartis à la
 * volée, si bien que rien ne dépend de la migration pour être LU.
 */
export function faitsParSujet(projectPath: string): Map<string, string[]> {
  const parSujet = new Map<string, string[]>();
  for (const sujet of SUJETS_MEMOIRE) {
    const faits = faitsDuSujet(projectPath, sujet.id);
    if (faits.length) parSujet.set(sujet.id, faits);
  }
  const restes = faitsRestes(projectPath);
  if (!restes.length) return parSujet;

  // Le fichier plat n'est pas encore découpé : on le range sans l'écrire.
  for (const [sujet, faits] of repartirParSujet(restes)) {
    const dedans = parSujet.get(sujet) ?? [];
    for (const fait of faits) {
      if (!dedans.some((f) => f.toLowerCase() === fait.toLowerCase())) dedans.push(fait);
    }
    parSujet.set(sujet, dedans);
  }
  // On réordonne : la numérotation de l'index suit l'ordre des sujets.
  const ordonne = new Map<string, string[]>();
  for (const sujet of SUJETS_MEMOIRE) {
    const dedans = parSujet.get(sujet.id);
    if (dedans?.length) ordonne.set(sujet.id, dedans);
  }
  return ordonne;
}

/**
 * La mémoire ENTIÈRE, en un seul texte. Elle ne part jamais telle quelle à un
 * moteur : elle sert à l'affichage dans l'application et aux contrôles, qui ont
 * besoin d'un point de comparaison.
 */
export function readMemory(projectPath: string): string {
  const parSujet = faitsParSujet(projectPath);
  if (!parSujet.size) return '';
  const morceaux: string[] = ['# Mémoire du projet'];
  for (const [sujet, faits] of parSujet) {
    morceaux.push(`## ${libelleSujet(sujet)}\n\n${faits.map((f) => `- ${f}`).join('\n')}`);
  }
  return `${morceaux.join('\n\n')}\n`;
}

/** L'arbre du projet, tel qu'il est sur le disque. */
export function arbreDuProjet(projectPath: string): SujetEnArbre[] {
  return construireLArbre(faitsParSujet(projectPath));
}

/** Retire un fichier sans jamais faire échouer la tâche qui l'a provoqué. */
function retirer(chemin: string): void {
  try {
    if (fs.existsSync(chemin)) fs.rmSync(chemin, { recursive: true, force: true });
  } catch {
    /* la mémoire ne doit jamais faire échouer une tâche */
  }
}

/**
 * ÉCRIT L'ARBRE ENTIER, et ne laisse rien derrière.
 *
 * Trois étages à poser, et trois à nettoyer : une branche qui disparaît (son
 * dernier fait a été remplacé), un sujet qui redescend à plat (il n'a plus
 * qu'une branche), un sujet devenu vide. Sans ce ménage, un fichier orphelin
 * continuerait d'être LU par `faitsDuSujet` et ressusciterait un fait effacé.
 */
function ecrireLArbre(projectPath: string, parSujet: Map<string, string[]>): void {
  const arbre = construireLArbre(parSujet);
  const parId = new Map(arbre.map((sujet) => [sujet.id, sujet]));

  for (const connu of SUJETS_MEMOIRE) {
    const sujet = parId.get(connu.id);
    const rappel = cheminDuSujet(projectPath, connu.id);
    const dossier = path.join(projectPath, ...dossierDuSujet(connu.id).split('/'));

    if (!sujet) {
      retirer(rappel);
      retirer(dossier);
      continue;
    }

    writeSafely(rappel, rendreRappelDuSujet(sujet));

    if (!sujet.eclate) {
      // Le sujet est redescendu à plat : son dossier enfant n'a plus lieu d'être.
      retirer(dossier);
      continue;
    }

    const gardes = new Set<string>();
    for (const branche of sujet.branches) {
      writeSafely(path.join(projectPath, ...branche.fichier.split('/')), rendreBranche(sujet, branche));
      gardes.add(path.basename(branche.fichier));
    }
    try {
      for (const nom of fs.readdirSync(dossier)) {
        if (nom.endsWith('.md') && !gardes.has(nom)) retirer(path.join(dossier, nom));
      }
    } catch {
      /* le dossier vient d'être créé : rien à nettoyer */
    }
  }

  writeSafely(memoryPath(projectPath), rendreRacine(arbre));
}

/**
 * LA MISE EN ARBRE, une fois pour toutes. Un projet qui garde ses faits dans le
 * vieux fichier plat — ou dans les fichiers par sujet d'avant l'arbre — les voit
 * partir dans leurs branches, sans rien perdre. Rejouable : un deuxième passage
 * ne trouve plus rien à déplacer et rend 0.
 */
export function migrerParSujet(projectPath: string): number {
  const restes = faitsRestes(projectPath);
  const parSujet = faitsParSujet(projectPath);
  const racine = lireFichier(memoryPath(projectPath));
  const dejaEnArbre = racine.includes(MARQUE_ARBRE);

  if (!restes.length && dejaEnArbre) return 0;
  if (!parSujet.size) {
    // Rien à ranger. On pose tout de même la racine sur un projet neuf, pour
    // qu'un humain trouve le fichier même quand il est vide.
    if (!racine.trim()) writeSafely(memoryPath(projectPath), rendreRacine([]));
    return 0;
  }

  ecrireLArbre(projectPath, parSujet);
  return restes.length;
}

export function readHistory(projectPath: string): string {
  try {
    return fs.readFileSync(historyPath(projectPath), 'utf8');
  } catch {
    return '';
  }
}

/** Une livraison datée : elle va dans l'historique, jamais dans la mémoire. */
export function appendHistory(projectPath: string, line: string): void {
  const clean = `- ${nettoyer(line)}`;
  let content = readHistory(projectPath);
  if (!content.trim()) content = HISTORY_HEADER;
  const lines = content.split('\n');
  if (lines.some((l) => l.trim().toLowerCase() === clean.toLowerCase())) return;
  lines.push(clean);
  writeSafely(historyPath(projectPath), lines.join('\n'));
}

/**
 * Les lignes de journal déjà écrites dans la mémoire des versions précédentes
 * repartent une fois pour toutes dans l'historique. Rien n'est perdu : elles
 * cessent seulement d'occuper le contexte des agents.
 */
export function migrerJournal(projectPath: string): number {
  const parSujet = faitsParSujet(projectPath);
  if (!parSujet.size) return 0;

  const gardes = new Map<string, string[]>();
  const deplacees: string[] = [];
  for (const [sujet, faits] of parSujet) {
    const restants = faits.filter((fait) => {
      if (!estLigneDeJournal(fait)) return true;
      deplacees.push(fait);
      return false;
    });
    if (restants.length) gardes.set(sujet, restants);
  }
  if (!deplacees.length) return 0;

  for (const line of deplacees) appendHistory(projectPath, line);
  ecrireLArbre(projectPath, gardes);
  return deplacees.length;
}

export function appendMemory(projectPath: string, line: string, replaces?: string): void {
  // Une livraison datée n'est pas un fait : elle part dans l'historique.
  if (estLigneDeJournal(line)) {
    appendHistory(projectPath, line);
    return;
  }

  migrerJournal(projectPath);
  const parSujet = faitsParSujet(projectPath);
  const clean = nettoyer(line);

  // Un fait qui en REMPLACE un autre prend sa place, où qu'il soit rangé — et
  // change de fichier si son sujet a changé.
  if (replaces) {
    const needle = nettoyer(replaces).toLowerCase().slice(0, 40);
    for (const [sujet, faits] of parSujet) {
      const idx = faits.findIndex((f) => f.toLowerCase().startsWith(needle));
      if (idx < 0) continue;
      faits.splice(idx, 1);
      if (!faits.length) parSujet.delete(sujet);
      poserLeFait(parSujet, clean);
      ecrireLArbre(projectPath, plafonner(parSujet));
      return;
    }
  }

  if (!poserLeFait(parSujet, clean)) return; // doublon exact : on ne l'empile pas
  ecrireLArbre(projectPath, plafonner(parSujet));
}

/** Range un fait sous son sujet. Rend faux si le fait y était déjà. */
function poserLeFait(parSujet: Map<string, string[]>, fait: string): boolean {
  const sujet = sujetDuFait(fait);
  const dedans = parSujet.get(sujet) ?? [];
  if (dedans.some((f) => f.toLowerCase() === fait.toLowerCase())) return false;
  dedans.push(fait);
  parSujet.set(sujet, dedans);
  return true;
}

/**
 * Plafond de sécurité seulement : au-delà, la synthèse a déjà dû passer. On
 * retire les plus anciens faits, sujet par sujet, en commençant par les plus
 * fournis — jamais un sujet entier.
 */
function plafonner(parSujet: Map<string, string[]>): Map<string, string[]> {
  let total = [...parSujet.values()].reduce((n, faits) => n + faits.length, 0);
  while (total > MAX_LINES) {
    const plusFourni = [...parSujet.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!plusFourni || plusFourni[1].length <= 1) break;
    plusFourni[1].shift();
    total--;
  }
  return parSujet;
}

/** Réécrit la mémoire entière (synthèse relue et acceptée). */
export function replaceMemory(projectPath: string, faits: string[]): void {
  ecrireLArbre(projectPath, repartirParSujet(faits));
}

function writeSafely(file: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n', 'utf8');
  } catch {
    /* la mémoire ne doit jamais faire échouer une tâche */
  }
}

/**
 * Ce que l'agent vient de relire, en clair : combien de faits, et lesquels.
 * Sert à afficher l'étape « lecture de la mémoire du projet » tout en haut de
 * la conversation — on voit qu'il pioche dans la mémoire avant de répondre.
 */
export function memorySummary(projectPath: string): { facts: number; text: string } {
  const memory = readMemory(projectPath).trim();
  const facts = memory.split('\n').filter((line) => line.trim().startsWith('- ')).length;
  return { facts, text: memory };
}

/** Les faits de la mémoire, sujet par sujet, dans l'ordre de l'index. */
export function memoryFacts(projectPath: string): string[] {
  return [...faitsParSujet(projectPath).values()].flat();
}

/**
 * Les faits ajoutés DEPUIS un point donné. Une session d'agent garde l'index
 * dans son contexte : le renvoyer en entier à chaque message le répéterait des
 * dizaines de fois pour rien. Seul le complément est utile.
 *
 * On compare le TEXTE, jamais un rang : un fait rangé sous son sujet ne
 * s'ajoute plus forcément à la fin, et un décompte aurait fait passer pour
 * neufs des faits déjà lus.
 */
export function newFactsSince(projectPath: string, dejaVus: string[]): string[] {
  const connus = new Set(dejaVus);
  return memoryFacts(projectPath).filter((fait) => !connus.has(empreinteDuFait(fait)));
}

/** L'empreinte courte d'un fait : ce qu'on retient d'une session, pas son texte. */
export function empreinteDuFait(texte: string): string {
  return crypto.createHash('sha1').update(nettoyer(texte).toLowerCase()).digest('hex').slice(0, 8);
}

/** Les empreintes de TOUS les faits : ce qu'un agent a sous les yeux après son briefing. */
export function empreintesDesFaits(projectPath: string): string[] {
  return memoryFacts(projectPath).map(empreinteDuFait);
}

/**
 * LE POIDS AU-DELÀ DUQUEL UN SUJET NE SE SERT PLUS D'UN BLOC.
 *
 * L'arbre existe pour descendre par paliers, pas pour multiplier les
 * allers-retours : un sujet qui tient en quelques lignes part en entier, et
 * l'agent n'a rien de plus à demander. Au-delà, il reçoit le RAPPEL — ses
 * branches et leurs mots — et ouvre celle qui le concerne.
 */
const POIDS_SERVI_EN_ENTIER = 1400;

/** Tous les faits d'un sujet, écrits en clair. */
function faitsEnEntier(sujet: SujetEnArbre, faits: string[]): string {
  return `SUJET « ${sujet.id} » (${sujet.libelle}) — ${faits.length > 1 ? `ses ${faits.length} faits` : 'son seul fait'} :\n\n${faits
    .map((f) => `- ${f}`)
    .join('\n')}`;
}

/**
 * LE DÉTAIL DEMANDÉ PAR UN AGENT — et l'arbre est le SEUL chemin pour y aller.
 *
 * Quatre demandes possibles, de la plus large à la plus fine, et chacune rend
 * exactement le palier qu'on lui demande :
 *  — rien : la CARTE de l'arbre, les sujets et les mots de leurs branches ;
 *  — un SUJET : ses faits s'il est court, sinon son RAPPEL — la liste de ses
 *    branches, à ouvrir une par une ;
 *  — une BRANCHE, par son mot : ses faits en entier. C'est le geste que tout le
 *    système existe pour rendre possible.
 *  — des mots quelconques : les faits qui les contiennent, sans note de
 *    ressemblance. Rien ne correspond ? On le DIT, et on rend la carte — un
 *    silence honnête vaut mieux que cinq passages tirés au sort.
 */
export function detailMemoire(projectPath: string, requete: string, travail = ''): string {
  const arbre = arbreDuProjet(projectPath);
  const faits = arbre.flatMap((sujet) => sujet.branches.flatMap((b) => b.faits));
  if (!faits.length) return 'La mémoire du projet est vide pour le moment.';

  const { requete: demande, entier: toutVoulu } = lireDemandeDeMemoire(requete);
  if (!demande) return carteDeLArbre(arbre);

  // UN SUJET, par son nom : le palier au-dessus des branches.
  const vise = sujetDeLaRequete(demande);
  const sujet = vise && arbre.find((s) => s.id === vise.id);
  if (sujet) {
    const siens = sujet.branches.flatMap((b) => b.faits);
    const entier = faitsEnEntier(sujet, siens);
    if (sujet.eclate && entier.length > POIDS_SERVI_EN_ENTIER) return rappelDuSujet(sujet);
    /*
     * UN SUJET RESTÉ À PLAT peut peser autant qu'un fichier de règles : il n'a
     * pas de branches où descendre, donc rien ne le rognait. Quand une CARTE dit
     * le travail à faire, ses faits partent eux aussi au poids de cette demande.
     */
    if (sujetNommeAFiltrer({ signes: entier.length, demande: travail, entier: toutVoulu })) {
      const garde = extraitDeSujet(siens, travail);
      if (garde.gardees.length) {
        return [
          faitsEnEntier(sujet, garde.gardees),
          garde.ecartees &&
            `(${garde.ecartees} autre${garde.ecartees > 1 ? 's' : ''} fait${
              garde.ecartees > 1 ? 's' : ''
            } de ce sujet ne parle${garde.ecartees > 1 ? 'nt' : ''} pas de ta demande. ` +
              `Pour le sujet entier, redemande project_memory avec « ${sujet.id} entier ».)`,
        ]
          .filter(Boolean)
          .join('\n\n');
      }
    }
    return entier;
  }

  // UNE BRANCHE, par son mot. Deux sujets peuvent porter le même : on rend les
  // deux plutôt que d'en cacher un.
  const branches = brancheDemandee(arbre, demande);
  if (branches.length) {
    return branches
      .map(
        ({ sujet: parent, branche }) =>
          `\`${branche.fichier}\` — ${parent.libelle} › ${branche.titre}\n\n${branche.faits
            .map((f) => `- ${f}`)
            .join('\n')}`,
      )
      .join('\n\n———\n\n');
  }

  const trouves = chercherFaits(faits, demande);
  if (!trouves.length) {
    return `Aucun fait ne correspond à « ${demande} ».\n\n${carteDeLArbre(arbre)}`;
  }
  return trouves.map((f) => `- ${f.texte}`).join('\n');
}

/**
 * UN MORCEAU DE RÉPONSE, avec sa CLÉ. La clé nomme le sujet ET son contenu :
 * même sujet, même texte, même clé — c'est ce qui permet de ne pas resservir
 * dans une session ce que l'agent a déjà sous les yeux, tout en renvoyant quand
 * même un sujet qui a CHANGÉ depuis (un fait ajouté en cours de tâche).
 */
interface MorceauServi {
  cle: string;
  /** Comment le nommer quand on refuse de le resservir. */
  libelle: string;
  texte: string;
}

function cleMorceau(genre: string, id: string, texte: string): string {
  return `${genre}:${id}:${crypto.createHash('sha1').update(texte).digest('hex').slice(0, 8)}`;
}

/**
 * Le titre de la section des CONTRÔLES d'un sujet, dans `docs/verifications.md`.
 * Le fichier range les scripts de vérification sous ces titres exacts : on y va
 * chercher les seuls contrôles qui touchent le sujet demandé.
 */
const TITRE_CONTROLES: Record<string, string> = {
  publication: 'Publication',
  cartes: 'Cartes',
  branches: 'Branches et dossiers',
  projets: 'Projets',
  interface: 'Interface, téléphone et notifications',
  quotas: 'Quotas, comptes et modèles',
  voix: 'Voix et écoute',
  methode: 'Méthode, moteurs et outils',
};

function lireDoc(projectPath: string, relatif: string): string {
  try {
    return fs.readFileSync(path.join(projectPath, relatif), 'utf8');
  } catch {
    return '';
  }
}

/** La section « ## <titre> » d'un document, jusqu'au prochain « ## ». */
function sectionDoc(texte: string, titre: string): string {
  const lignes = texte.split('\n');
  const debut = lignes.findIndex((l) => l.trim() === `## ${titre}`);
  if (debut < 0) return '';
  let fin = debut + 1;
  while (fin < lignes.length && !/^## /.test(lignes[fin])) fin++;
  return lignes.slice(debut, fin).join('\n').trim();
}

/** Les règles ET les contrôles d'un sujet, réunis. */
function texteDuSujet(projectPath: string, sujet: SujetRegles): string {
  const regles = lireDoc(projectPath, sujet.fichier).trim();
  const controles = sectionDoc(lireDoc(projectPath, 'docs/verifications.md'), TITRE_CONTROLES[sujet.id] ?? '');
  return [regles, controles && `CONTRÔLES — ${sujet.libelle}\n\n${controles}`].filter(Boolean).join('\n\n');
}

/**
 * Le détail des RÈGLES et CONTRÔLES touchés par une demande. Comme les faits,
 * ils ne partent plus en bloc : rangés par sujet dans `docs/regles/` et
 * `docs/verifications.md`, ils se demandent à la carte. Rend une chaîne vide sur
 * un projet qui n'a pas ces fichiers (rien à ajouter aux faits).
 */
export function detailRegles(projectPath: string, requete: string, travail = ''): string {
  return morceauxRegles(projectPath, requete, travail)
    .map((m) => m.texte)
    .join('\n\n———\n\n');
}

/**
 * LES CONTRÔLES D'UN SUJET, SERVIS AU POIDS DE LA DEMANDE EUX AUSSI.
 *
 * Ils suivaient l'extrait EN ENTIER, au motif qu'une section pèse « quelques
 * centaines de signes ». Celle du sujet « interface » en pèse 16 000 : trois
 * fois l'extrait de règles qu'elle accompagnait. Une carte rejoue les contrôles
 * qui touchent ce qu'elle a changé, pas les cinquante d'un sujet ; ce qui est
 * écarté est compté, et le sujet entier reste à un mot de distance.
 */
function controlesDuSujet(projectPath: string, sujet: SujetRegles, demande: string, entier: boolean): string {
  const section = sectionDoc(lireDoc(projectPath, 'docs/verifications.md'), TITRE_CONTROLES[sujet.id] ?? '');
  if (!section) return '';

  const entete = `CONTRÔLES — ${sujet.libelle}`;
  if (!sujetNommeAFiltrer({ signes: section.length, demande, entier })) return `${entete}\n\n${section}`;

  const extrait = extraitDeControles(section, demande);
  if (!extrait.gardees.length) return `${entete}\n\n${section}`;
  const reste = extrait.ecartees
    ? `\n\n(${extrait.ecartees} autre${extrait.ecartees > 1 ? 's' : ''} contrôle${
        extrait.ecartees > 1 ? 's' : ''
      } de ce sujet ne parle${extrait.ecartees > 1 ? 'nt' : ''} pas de ta demande. ` +
      `Pour la liste entière, redemande project_memory avec « ${sujet.id} entier ».)`
    : '';
  return `${entete} — ceux qui touchent ta demande :\n\n\`\`\`bash\n${extrait.gardees.join('\n')}\n\`\`\`${reste}`;
}

/**
 * LE SUJET NOMMÉ, SERVI AU POIDS DE LA DEMANDE DE LA CARTE — ou rien, et
 * l'appelant rend alors le fichier entier comme avant.
 *
 * Rien n'est rendu dans quatre cas, et chacun protège l'agent d'une réponse
 * amputée : l'agent a écrit « entier », le fichier tient sous le plafond, la
 * demande de la carte ne porte pas assez de mots pour classer, ou aucune règle
 * du sujet ne parle de cette demande — dans ce dernier cas, rogner reviendrait à
 * rendre le silence, ce que la mémoire en arbre s'interdit.
 */
function extraitDuSujetNomme(
  projectPath: string,
  sujet: SujetRegles,
  travail: string,
  entier: boolean,
): MorceauServi | null {
  const fichier = lireDoc(projectPath, sujet.fichier).trim();
  if (!sujetNommeAFiltrer({ signes: fichier.length, demande: travail, entier })) return null;

  const extrait = extraitDeSujet(decouperRegles(fichier), travail);
  if (!extrait.gardees.length) return null;

  const texte = [
    `RÈGLES « ${sujet.libelle} » qui touchent le travail de ta carte ` +
      `(le sujet entier pèse ${fichier.length} signes ; il est servi au poids de ta demande) :`,
    extrait.gardees.join('\n\n'),
    mentionDEcart(sujet, extrait),
    controlesDuSujet(projectPath, sujet, travail, entier),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    cle: cleMorceau('extrait', sujet.id, texte),
    libelle: `un extrait des règles « ${sujet.libelle} »`,
    texte,
  };
}

/** Les morceaux de règles servis par une demande, chacun avec sa clé. */
function morceauxRegles(projectPath: string, requete: string, travail = ''): MorceauServi[] {
  if (!fs.existsSync(path.join(projectPath, 'docs', 'regles'))) return [];

  const { requete: demande, entier } = lireDemandeDeMemoire(requete);
  if (!demande) {
    return [
      {
        cle: '',
        libelle: 'la liste des sujets de règles',
        texte:
          'RÈGLES DU PROJET — par sujet (demande-en un par son nom ou des mots-clés, ' +
          'tu recevras ses règles ET ses contrôles) :\n' +
          SUJETS_REGLES.map((s) => `  ${s.id} — ${s.libelle}`).join('\n'),
      },
    ];
  }

  /*
   * UN SUJET NOMMÉ vaut le fichier ENTIER, contrôles compris : l'agent l'a
   * demandé par son nom, c'est un choix, on obéit sans rogner.
   *
   * …SAUF QUAND UNE CARTE DIT LE TRAVAIL À FAIRE. La MÉTHODE imposée envoie
   * l'agent ouvrir « le SUJET de sa tâche » à son premier tour : le sujet est
   * donc NOMMÉ presque à chaque lancement de carte, et c'est par là que
   * partaient les 36 000 signes de `cartes.md` pour une carte qui ne touche
   * qu'un bouton. Un sujet volumineux est alors servi au poids de la demande de
   * la CARTE (`sujetNommeAFiltrer`) : ce qui en parle d'abord, le reste NOMMÉ,
   * et « <sujet> entier » pour tout obtenir malgré tout.
   */
  const nomme = sujetNomme(demande);
  if (nomme) {
    const filtre = extraitDuSujetNomme(projectPath, nomme, travail, entier);
    if (filtre) return [filtre];
    const texte = texteDuSujet(projectPath, nomme);
    /*
     * UN SUJET SANS FICHIER N'EST PAS UNE RÉPONSE. Les sujets de règles sont une
     * liste FIXE ; un projet qui n'a pas écrit `docs/regles/cartes.md` rendait
     * pourtant un morceau vide, marqué « servi » — l'agent recevait le silence,
     * puis « déjà dans ton contexte » s'il redemandait. On ne rend rien : c'est
     * ce vide qui laisse la couche amont répondre à sa place (`morceauxHerites`).
     */
    if (!texte.trim()) return [];
    return [{ cle: cleMorceau('regles', nomme.id, texte), libelle: `les règles « ${nomme.libelle} »`, texte }];
  }

  /*
   * DES MOTS-CLÉS, eux, ne demandent pas un fichier : ils décrivent un besoin.
   * On ouvrait pourtant chaque sujet touché EN ENTIER — « détail de carte »
   * emportait les 36 000 signes de `cartes.md`, « tiroir » les 31 000 de
   * `interface.md`, pour deux invariants qui en pèsent quatre cents. On ne rend
   * donc que les règles qui PARLENT de ces mots, les mieux placées d'abord, et
   * on NOMME le reste avec la façon de l'obtenir en entier.
   */
  const touches = sujetsPourRequete(demande);
  if (touches.length) {
    const decoupes = new Map(touches.map((sujet) => [sujet.id, decouperRegles(lireDoc(projectPath, sujet.fichier))]));
    const classees = new Map(touches.map((sujet) => [sujet.id, classerRegles(decoupes.get(sujet.id) ?? [], demande)]));

    const { ouverts } = partagerSujets(touches, (sujet) => classees.get(sujet.id)?.length ?? 0);

    const morceaux: MorceauServi[] = [];
    const rendus = new Set<string>();
    for (const sujet of ouverts) {
      const extrait = extraitDeSujet(decoupes.get(sujet.id) ?? [], demande);
      if (!extrait.gardees.length) continue;
      /*
       * Les CONTRÔLES du sujet suivent l'extrait — au poids de la demande eux
       * aussi dès que leur liste est longue : la MÉTHODE impose de rejouer les
       * contrôles TOUCHÉS, pas les cinquante d'un sujet.
       */
      const texte = [
        `RÈGLES « ${sujet.libelle} » qui touchent ta demande :`,
        extrait.gardees.join('\n\n'),
        mentionDEcart(sujet, extrait),
        controlesDuSujet(projectPath, sujet, travail || demande, entier),
      ]
        .filter(Boolean)
        .join('\n\n');
      rendus.add(sujet.id);
      morceaux.push({
        cle: cleMorceau('extrait', sujet.id, texte),
        libelle: `un extrait des règles « ${sujet.libelle} »`,
        texte,
      });
    }

    // Les sujets touchés qu'on n'a pas ouverts sont DITS : un plafond silencieux
    // se lirait comme une réponse complète.
    const restants = touches.filter((sujet) => !rendus.has(sujet.id));
    if (morceaux.length && restants.length) {
      morceaux.push({
        cle: '',
        libelle: 'les autres sujets touchés',
        texte:
          `AUTRES SUJETS touchés par ta demande, non ouverts ici : ` +
          `${restants.map((s) => `« ${s.id} »`).join(', ')}. Demande-les par leur nom si tu en as besoin.`,
      });
    }
    if (morceaux.length) return morceaux;
  }

  // Repli : aucune rubrique reconnue, on cherche les mots dans toutes les règles.
  const toutes = SUJETS_REGLES.flatMap((s) => decouperRegles(lireDoc(projectPath, s.fichier)));
  const trouves = reglesContenant(toutes, demande);
  if (!trouves.length) return [];
  return [
    { cle: '', libelle: 'ces règles', texte: `RÈGLES qui mentionnent « ${demande} » :\n\n${trouves.join('\n\n')}` },
  ];
}

/**
 * LE CRAN AU-DESSUS : LES RÈGLES HÉRITÉES DE LA SOURCE DU PROJET.
 *
 * C'est le dernier étage de l'arbre. Quand l'agent demande un sujet et que le
 * projet courant n'a rien à en dire, on monte d'un cran et on sert le fichier de
 * sa SOURCE — HaikoDev par défaut, ou le projet désigné dans ses réglages
 * (`cibleDHeritage`, `shared/src/arbre-memoire.ts`).
 *
 * TROIS REFUS tiennent ce repli à sa place :
 *  — sur SA PROPRE SOURCE, jamais (`amontApplicable`) : ce serait servir deux
 *    fois le même fichier — et c'est aussi ce qui rend inoffensif un réglage
 *    « je m'hérite moi-même » ;
 *  — quand le projet A répondu, jamais non plus : sa règle à lui fait foi, et
 *    une règle héritée qui la contredirait serait un piège ;
 *  — sans demande précise, jamais : la liste nue des sujets d'un autre dépôt
 *    n'apprend rien et se paie.
 *
 * La clé de dédoublonnage est préfixée : un sujet servi depuis l'amont ne se
 * confond pas avec le même sujet servi depuis le projet.
 */
function morceauxHerites(
  projectPath: string,
  requete: string,
  amont?: SourceDHeritage,
  travail = '',
): MorceauServi[] {
  if (!requete.trim()) return [];
  if (!amontApplicable({ projet: projectPath, amont: amont?.chemin })) return [];
  // Le projet a répondu : on ne monte pas d'un cran.
  if (morceauxRegles(projectPath, requete, travail).length) return [];

  const source = amont as SourceDHeritage;
  return morceauxRegles(source.chemin, requete, travail).map((morceau) => ({
    cle: morceau.cle ? `amont:${morceau.cle}` : '',
    libelle: `${morceau.libelle}, héritées de ${source.nom}`,
    texte:
      `HÉRITÉ DE ${source.nom.toUpperCase()} — ce projet n'a pas de règle sur ce sujet ; voici celle du projet ` +
      `dont il HÉRITE. Elle vaut tant que ce projet n'écrit pas la sienne, et le fichier cité vit ` +
      `dans le dépôt de ${source.nom}, pas ici.\n\n${morceau.texte}`,
  }));
}

/**
 * LA SOURCE D'HÉRITAGE, telle que l'appelant l'a résolue : son dossier et son
 * NOM. Le nom compte autant que le chemin — une règle servie sans dire d'où elle
 * vient est une règle qu'un agent croira écrite ici, et qu'il ira modifier dans
 * le mauvais dépôt.
 */
export interface SourceDHeritage {
  nom: string;
  chemin: string;
}

/** Les morceaux de FAITS servis par une demande. */
function morceauxFaits(projectPath: string, requete: string, travail = ''): MorceauServi[] {
  const texte = detailMemoire(projectPath, requete, travail);

  // Une demande qui NOMME un sujet se dédoublonne : l'agent l'a déjà sous les
  // yeux. Le marqueur « entier » est retiré d'abord : « cartes entier » et
  // « cartes » nomment le même sujet, et un texte différent porte déjà une clé
  // différente.
  const sujet = sujetDeLaRequete(lireDemandeDeMemoire(requete).requete);
  if (sujet) {
    return [{ cle: cleMorceau('faits', sujet.id, texte), libelle: `les faits « ${sujet.libelle} »`, texte }];
  }

  /*
   * …ET UNE BRANCHE AUSSI. C'est devenu le geste le plus fréquent depuis
   * l'arbre : sans clé, un agent qui redemande « catalogue » repaierait le même
   * fichier à chaque tour, ce que le dédoublonnage des sujets évitait déjà.
   */
  const branches = brancheDemandee(arbreDuProjet(projectPath), lireDemandeDeMemoire(requete).requete);
  if (branches.length === 1) {
    const { sujet: parent, branche } = branches[0];
    return [
      {
        cle: cleMorceau('branche', `${parent.id}/${branche.nom}`, texte),
        libelle: `la branche « ${branche.nom} » de « ${parent.id} »`,
        texte,
      },
    ];
  }

  return [{ cle: '', libelle: 'ces faits', texte }];
}

/** Ce que l'outil `project_memory` rend, et ce qu'il faut retenir d'avoir servi. */
export interface DetailProjet {
  texte: string;
  /** Les clés des sujets réellement servis : à retenir pour ne pas les resservir. */
  servis: string[];
}

/**
 * Ce que rend l'outil `project_memory` : les FAITS de la mémoire ET les RÈGLES /
 * CONTRÔLES touchés par la demande, réunis. Quand la demande vise clairement une
 * règle (aucun fait ne correspond), on ne noie pas la réponse sous l'index des
 * faits.
 *
 * ÉCONOMIE DE JETONS : un sujet DÉJÀ SERVI dans la session n'est pas renvoyé une
 * seconde fois — l'agent l'a encore sous les yeux, et un fichier de mémoire ou de
 * règles pèse des milliers de signes. Il reçoit une ligne qui le lui rappelle. Un
 * sujet qui a CHANGÉ depuis (un fait ajouté en cours de tâche) porte une autre
 * clé : il repart, lui.
 */
export function detailProjet(
  projectPath: string,
  requete: string,
  dejaServis: string[] = [],
  /**
   * LA SOURCE D'HÉRITAGE de ce projet, déjà résolue par l'appelant (c'est lui
   * qui connaît les projets ; ce module ne connaît que le disque). Elle ne sert
   * QUE de repli : voir `morceauxHerites`. Absente, l'outil se comporte
   * exactement comme si le projet n'héritait de rien.
   */
  amont?: SourceDHeritage,
  /**
   * LE TRAVAIL RÉEL À FAIRE — le titre et le constat de la CARTE en cours, tels
   * que l'agent les a reçus. Il ne remplace jamais la demande de l'agent : il
   * sert à RANGER un gros sujet nommé dans l'ordre de ce travail, et à écarter
   * ce qui n'en parle pas (`sujetNommeAFiltrer`). Absent — une conversation, un
   * agent sans carte —, tout se comporte comme avant.
   */
  travail = '',
): DetailProjet {
  const connus = new Set(dejaServis);
  const morceaux = [
    ...morceauxFaits(projectPath, requete, travail),
    ...morceauxRegles(projectPath, requete, travail),
    ...morceauxHerites(projectPath, requete, amont, travail),
  ];

  const aServir = morceaux.filter((m) => !m.cle || !connus.has(m.cle));
  const rappels = morceaux.filter((m) => m.cle && connus.has(m.cle));

  // La demande vise une règle et aucun fait ne correspond : on ne noie pas la
  // réponse sous l'index des faits.
  const utiles = aServir.filter(
    (m, i) => !(i === 0 && requete.trim() && /^Aucun fait ne correspond/.test(m.texte) && aServir.length > 1),
  );

  const parties = utiles.map((m) => m.texte);
  if (rappels.length) {
    parties.push(
      `DÉJÀ DANS TON CONTEXTE, inchangé depuis : ${rappels.map((m) => m.libelle).join(', ')}. ` +
        `Relis plus haut dans cette session, ne le redemande pas.`,
    );
  }

  return {
    texte: parties.filter(Boolean).join('\n\n═══\n\n'),
    servis: utiles.map((m) => m.cle).filter(Boolean),
  };
}

/** Le nom du fichier d'instructions natif du moteur. */
export function fichierInstructions(engine?: string): string {
  return fichierNatif(engine);
}

/**
 * Le fichier d'instructions qui fait FOI pour ce projet et ce moteur.
 *
 * Le fichier natif du moteur ne porte pas toujours les instructions : à la
 * création d'un projet, `AGENTS.md` ne fait que renvoyer à `CLAUDE.md`. On suit
 * le renvoi, pour qu'un agent Codex lise le VRAI contenu et écrive ses règles
 * durables là où quelqu'un les relira. Rien n'est écrit ni supprimé ici.
 */
export function instructionsDuProjet(projectPath: string, engine?: string): InstructionsDuProjet {
  const lire = (nom: string): string | null => {
    const chemin = path.join(projectPath, nom);
    try {
      return fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
    } catch {
      return null;
    }
  };
  return instructionsQuiFontFoi(engine, lire);
}

/**
 * Le fichier d'instructions posé À L'AJOUT d'un projet, s'il n'en a aucun.
 * Un squelette vide vaut mieux qu'une absence : il dit ce qu'on attend de lui,
 * et le premier agent qui touche à une règle durable le remplit au lieu de se
 * demander où l'écrire. Un projet qui a déjà le sien n'est jamais touché.
 */
export function creerFichierInstructions(projectPath: string, projectName: string): boolean {
  const existants = ['CLAUDE.md', 'AGENTS.md'].filter((f) => fs.existsSync(path.join(projectPath, f)));
  if (existants.length) return false;

  const contenu = `# ${projectName} — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches par les agents : comment lancer, comment
vérifier, où vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont
dans \`HISTORIQUE.md\`, les règles apprises dans \`MEMOIRE.md\`.

## Où vivent les choses

_À remplir : les dossiers du projet et leur rôle, une ligne chacun._

## Lancer

\`\`\`bash
# À remplir : installer, construire, lancer en développement.
\`\`\`

## Vérifier

\`\`\`bash
# À remplir : les tests, les scripts de contrôle.
\`\`\`

## Règles à ne pas enfreindre

- Ne jamais publier de sa propre initiative : enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur.
`;
  writeSafely(path.join(projectPath, 'CLAUDE.md'), contenu);
  return true;
}

/**
 * LA PART DE MÉMOIRE DU BRIEFING, à elle seule.
 *
 * C'est ici que vit la règle « on envoie l'INDEX, pas la mémoire entière » —
 * donc c'est ici, et nulle part ailleurs, qu'elle se mesure. Le briefing
 * complet porte aussi des choses qui n'ont rien à voir avec la mémoire (nom du
 * projet, fichiers d'instructions, compétences partagées) et qui GRANDISSENT
 * avec le produit : le jour où ce préambule a dépassé la mémoire d'un projet
 * d'essai, un contrôle qui pesait le briefing entier est tombé, et la
 * publication avec lui, alors que la règle, elle, n'avait jamais bougé.
 */
export function blocMemoire(projectPath: string): string {
  return carteDeLArbre(arbreDuProjet(projectPath));
}

/**
 * Le briefing compact injecté au lancement de chaque agent : il sait déjà où
 * regarder au lieu de redécouvrir le projet de zéro.
 *
 * Depuis la tâche « alléger la mémoire », ce n'est plus la mémoire ENTIÈRE qui
 * part mais son INDEX : une ligne brève par fait, groupée par sujet. Le texte
 * complet se demande avec l'outil `project_memory`, quand le sujet concerne la
 * tâche. Sur un projet chargé, l'index tient en un quart de la place.
 *
 * `avecMemoire` est faux pour les tours SUIVANTS d'une même session : l'agent a
 * déjà l'index sous les yeux, on ne lui renvoie que les faits nouveaux.
 */
/**
 * LE BRIEFING COUPÉ SELON SON ORIGINE, et c'est cette coupure que le tiroir
 * « Contexte envoyé » donne à lire :
 *  — `sansMemoire` : ce qui vient du PROJET — son dossier, ses fichiers
 *    d'instructions ;
 *  — `socle` : ce qui vient de la PLATEFORME et serait le même sur n'importe
 *    quel projet — les compétences partagées, l'accès GitHub, la façon d'écrire
 *    une règle durable. Absent quand l'accueil n'en emporte rien ;
 *  — `memoire` : la carte de l'arbre du PROJET, à part depuis toujours, pour
 *    que le tiroir sache la distinguer du reste.
 */
export interface BriefingSepare {
  sansMemoire: string;
  socle?: string;
  memoire?: string;
}

export function briefingSepare(
  projectPath: string,
  projectName: string,
  avecMemoire = true,
  engine?: string,
  /**
   * Le dossier où l'agent travaille VRAIMENT, quand ce n'est pas celui du projet :
   * une carte lancée reçoit une copie de travail à elle. La mémoire et les
   * instructions se lisent toujours au même endroit — le projet — mais le dossier
   * annoncé doit être celui où l'agent écrit.
   */
  dossierDeTravail?: string,
  /**
   * Ce que l'accueil emporte. « minimal » ne dit que le projet et le dossier :
   * un agent appelé pour un dépannage de publication n'a que faire de l'index
   * de la mémoire ni de la liste des compétences (`shared/src/accueil-agent.ts`).
   */
  niveau: NiveauDAccueil = 'complet',
  /**
   * CE QUI REMPLACE L'INDEX de la mémoire, quand une recherche a trouvé mieux.
   * L'index part au lancement pour que l'agent SACHE quels sujets existent ;
   * mais quand la demande de la carte permet de retrouver les PASSAGES qui y
   * répondent (`server/src/passages.ts`), ils valent mieux qu'une table des
   * matières — et l'index reste à un appel de `project_memory`. Le calcul se
   * fait chez l'appelant : ce module ne connaît ni base ni index de recherche.
   */
  memoireRemplacee?: string,
): BriefingSepare {
  const emporte = partsDAccueil(niveau);
  migrerJournal(projectPath);
  // Le découpage par sujet se fait au premier briefing venu : un projet monté
  // avant lui n'a rien à faire pour en profiter.
  migrerParSujet(projectPath);
  const dossier = dossierDeTravail?.trim() || projectPath;
  const parts: string[] = [
    dossier === projectPath
      ? `Projet : ${projectName} (dossier ${projectPath}).`
      : `Projet : ${projectName}. Tu travailles dans ${dossier} — une copie de travail à toi seul, ouverte pour cette carte (le projet vit dans ${projectPath}).`,
  ];

  const { fichier: quiFaitFoi, renvoiDepuis } = instructionsDuProjet(projectPath, engine);
  const instructions = emporte.instructions
    ? [quiFaitFoi, 'CLAUDE.md', 'AGENTS.md', 'README.md'].filter(
        (f, i, tab) => tab.indexOf(f) === i && fs.existsSync(path.join(projectPath, f)),
      )
    : [];
  if (instructions.length) parts.push(`Fichiers d'instructions présents : ${instructions.join(', ')}.`);
  if (emporte.instructions && renvoiDepuis) {
    parts.push(
      `${renvoiDepuis} ne fait que RENVOYER à ${quiFaitFoi} : c'est ${quiFaitFoi} qui porte les instructions de ce projet, ` +
        `c'est lui que tu lis et lui que tu tiens à jour.`,
    );
  }

  /*
   * Les compétences partagées sont ANNONCÉES, jamais supposées connues. Claude
   * les trouve dans le coffre de son compte, mais Codex n'a pas la notion et le
   * chef d'orchestre n'a pas le droit d'ouvrir celles de son moteur : sans
   * cette ligne, le même projet « ne sait pas créer une offre » d'un moteur à
   * l'autre. Un chemin de fichier se lit partout.
   */
  const socle: string[] = [];
  const competences = emporte.competences
    ? texteDesCompetences(listerCompetences(), dossierDesCompetences())
    : '';
  if (competences) socle.push(competences);

  /*
   * L'accès GitHub est ANNONCÉ, jamais supposé deviné. Le jeton est posé dans
   * l'environnement de tout agent (`server/src/github.ts`), mais un agent qui
   * l'ignore continue de proposer une carte pour un `gh pr view` de dix
   * secondes. Une ligne, valable sur tous les projets, sans réglage
   * (`shared/src/acces-github.ts`).
   */
  if (emporte.github) socle.push(texteAccesGithub());

  const sansMemoire = parts.join('\n\n');
  if (!avecMemoire || !emporte.memoire) {
    return { sansMemoire, socle: socle.length ? socle.join('\n\n') : undefined };
  }

  /*
   * LA FAÇON D'ÉCRIRE UNE RÈGLE DURABLE EST DU SOCLE, PAS DE LA MÉMOIRE. Elle
   * était collée au bloc mémoire, ce qui faisait passer pour « venu du projet »
   * un paragraphe identique sur les dix-huit projets. Le tiroir compte
   * désormais chaque signe du bon côté.
   */
  socle.push(
    `RÈGLE DURABLE APPRISE : si ta tâche change une règle durable, une architecture ou une commande, NE TOUCHE PAS à ${quiFaitFoi} — ` +
      `écris-la à la fin de « ${FICHIER_D_ATTENTE} », et le démon la rangera cette nuit dans le fichier de son sujet. ` +
      `Ce fichier est chargé par le MOTEUR à chaque session : le modifier fait repayer aux agents suivants tout ce qu'il contient, au plein tarif. ` +
      `Le fichier d'attente, lui, n'est lu par aucun moteur et ne coûte rien.\n` +
      `Format d'une entrée : un titre en « ## », puis « - sujet : <un sujet de docs/regles/> », puis « - contrat : <une ligne> » seulement si l'invariant doit être NOMMÉ dans ${quiFaitFoi}, ` +
      `puis le texte entier de la règle. Court et factuel : comment lancer, comment vérifier, où vivent les choses, ce qu'on n'enfreint pas. Aucun journal, aucune trace de tâche.`,
  );

  return {
    sansMemoire,
    socle: socle.length ? socle.join('\n\n') : undefined,
    memoire: memoireRemplacee?.trim() || blocMemoire(projectPath),
  };
}

/** Le briefing complet, tel qu'envoyé au moteur : la part sans mémoire, puis la mémoire. */
export function briefing(
  projectPath: string,
  projectName: string,
  avecMemoire = true,
  engine?: string,
  dossierDeTravail?: string,
  niveau: NiveauDAccueil = 'complet',
): string {
  const { sansMemoire, socle, memoire } = briefingSepare(
    projectPath,
    projectName,
    avecMemoire,
    engine,
    dossierDeTravail,
    niveau,
  );
  return [sansMemoire, socle, memoire].filter(Boolean).join('\n\n');
}
