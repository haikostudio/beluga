import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FICHIER_D_ATTENTE,
  amontApplicable,
  chercherFaits,
  classerRegles,
  decouperRegles,
  DOSSIER_MEMOIRE,
  estLigneDeJournal,
  extraitDeSujet,
  faitsDuTexte,
  fichierDuSujet,
  fichierNatif,
  instructionsQuiFontFoi,
  libelleSujet,
  mentionDEcart,
  nettoyer,
  partagerSujets,
  partsDAccueil,
  reglesContenant,
  rendreFichierSujet,
  repartirParSujet,
  SUJETS_MEMOIRE,
  SUJETS_REGLES,
  sujetDeLaRequete,
  sujetDuFait,
  sujetNomme,
  sujetsPourRequete,
  texteIndex,
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
 * Trois endroits, trois usages :
 *  — `docs/memoire/<sujet>.md` : les faits durables et les pièges, RANGÉS PAR
 *    SUJET comme les règles de `docs/regles/`. Seul l'INDEX (une ligne brève par
 *    fait) part au moteur au lancement d'un agent ; le fichier d'un sujet se
 *    demande à la carte, et une fois pour toutes dans une session.
 *  — MEMOIRE.md : le SOMMAIRE de ces fichiers. Il ne porte plus de faits — il
 *    dit où ils vivent, pour qui ouvre le dépôt à la main.
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

/** Les faits restés dans le vieux fichier plat : rien si c'est déjà le sommaire. */
function faitsRestes(projectPath: string): string[] {
  const texte = lireFichier(memoryPath(projectPath));
  if (texte.includes(MARQUE_SOMMAIRE)) return [];
  return faitsDuTexte(texte);
}

/** Les faits d'un SEUL sujet, tels qu'écrits dans son fichier. */
export function faitsDuSujet(projectPath: string, sujet: string): string[] {
  return faitsDuTexte(lireFichier(cheminDuSujet(projectPath, sujet)));
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

/** Le sommaire écrit dans MEMOIRE.md : où vivent les faits, et combien par sujet. */
function sommaireMemoire(parSujet: Map<string, string[]>): string {
  const lignes = [
    '# Mémoire du projet',
    '',
    MARQUE_SOMMAIRE,
    '',
    '_Tenue automatiquement par HaikoDev. Les faits durables vivent PAR SUJET dans ' +
      `\`${DOSSIER_MEMOIRE}/\` — un fichier par sujet, demandé à la carte avec l'outil ` +
      "`project_memory`. Ce sommaire ne porte aucun fait._",
    '',
  ];
  for (const [sujet, faits] of parSujet) {
    const compte = faits.length > 1 ? `${faits.length} faits` : '1 fait';
    lignes.push(`- \`${fichierDuSujet(sujet)}\` — ${libelleSujet(sujet)} (${compte})`);
  }
  if (!parSujet.size) lignes.push('_Aucun fait retenu pour le moment._');
  return `${lignes.join('\n')}\n`;
}

/**
 * Écrit la mémoire telle qu'elle doit être sur le disque : un fichier par
 * sujet, le sommaire dans MEMOIRE.md, et plus rien qui traîne pour un sujet
 * devenu vide.
 */
function ecrireParSujet(projectPath: string, parSujet: Map<string, string[]>): void {
  for (const sujet of SUJETS_MEMOIRE) {
    const faits = parSujet.get(sujet.id) ?? [];
    const chemin = cheminDuSujet(projectPath, sujet.id);
    if (!faits.length) {
      try {
        if (fs.existsSync(chemin)) fs.rmSync(chemin);
      } catch {
        /* la mémoire ne doit jamais faire échouer une tâche */
      }
      continue;
    }
    writeSafely(chemin, rendreFichierSujet(sujet.id, faits));
  }
  writeSafely(memoryPath(projectPath), sommaireMemoire(parSujet));
}

/**
 * LE DÉCOUPAGE, une fois pour toutes. Un projet qui garde ses faits dans le
 * vieux fichier plat les voit partir dans `docs/memoire/`, sans rien perdre :
 * chaque fait est simplement rangé sous son sujet. Rejouable — un deuxième
 * passage ne trouve plus rien à déplacer et rend 0.
 */
export function migrerParSujet(projectPath: string): number {
  const restes = faitsRestes(projectPath);
  const parSujet = faitsParSujet(projectPath);
  if (!restes.length) {
    // Rien à déplacer, mais le sommaire peut manquer sur un projet neuf.
    if (parSujet.size && !fs.existsSync(memoryPath(projectPath))) ecrireParSujet(projectPath, parSujet);
    return 0;
  }
  ecrireParSujet(projectPath, parSujet);
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
  ecrireParSujet(projectPath, gardes);
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
      ecrireParSujet(projectPath, plafonner(parSujet));
      return;
    }
  }

  if (!poserLeFait(parSujet, clean)) return; // doublon exact : on ne l'empile pas
  ecrireParSujet(projectPath, plafonner(parSujet));
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
  ecrireParSujet(projectPath, repartirParSujet(faits));
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

/** Le détail demandé par un agent : le texte ENTIER des faits qui l'intéressent. */
export function detailMemoire(projectPath: string, requete: string): string {
  const faits = memoryFacts(projectPath);
  if (!faits.length) return 'La mémoire du projet est vide pour le moment.';
  if (!requete.trim()) {
    return `MÉMOIRE DU PROJET — index (${faits.length} faits)\n\n${texteIndex(faits)}\n\nDemande le texte entier d'un fait avec un numéro, un sujet ou des mots-clés.`;
  }
  const trouves = chercherFaits(faits, requete);
  if (!trouves.length) {
    return `Aucun fait ne correspond à « ${requete} ».\n\nL'index complet :\n\n${texteIndex(faits)}`;
  }
  return trouves.map((f) => `${f.numero}. ${f.texte}`).join('\n\n');
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
export function detailRegles(projectPath: string, requete: string): string {
  return morceauxRegles(projectPath, requete)
    .map((m) => m.texte)
    .join('\n\n———\n\n');
}

/** Les morceaux de règles servis par une demande, chacun avec sa clé. */
function morceauxRegles(projectPath: string, requete: string): MorceauServi[] {
  if (!fs.existsSync(path.join(projectPath, 'docs', 'regles'))) return [];

  const demande = requete.trim();
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
   */
  const nomme = sujetNomme(demande);
  if (nomme) {
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
       * Les CONTRÔLES du sujet suivent l'extrait, eux, en entier : la MÉTHODE
       * impose de rejouer les contrôles touchés, et la section d'un sujet pèse
       * quelques centaines de signes, pas des dizaines de milliers.
       */
      const controles = sectionDoc(lireDoc(projectPath, 'docs/verifications.md'), TITRE_CONTROLES[sujet.id] ?? '');
      const texte = [
        `RÈGLES « ${sujet.libelle} » qui touchent ta demande :`,
        extrait.gardees.join('\n\n'),
        mentionDEcart(sujet, extrait),
        controles && `CONTRÔLES — ${sujet.libelle}\n\n${controles}`,
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
 * LE CRAN AU-DESSUS : LES RÈGLES HÉRITÉES DE HAIKODEV.
 *
 * C'est la seconde moitié de la mémoire en arbre. La recherche automatique ne
 * remonte que quelques passages amont, volontairement — c'est le « souvenir
 * flou ». Quand l'agent veut la règle ENTIÈRE, il redemande son sujet : si le
 * projet courant n'a rien à en dire, on monte d'un cran et on sert le fichier
 * de HaikoDev.
 *
 * TROIS REFUS tiennent ce repli à sa place :
 *  — sur HaikoDev lui-même, jamais (`amontApplicable`) : ce serait servir deux
 *    fois le même fichier ;
 *  — quand le projet A répondu, jamais non plus : sa règle à lui fait foi, et
 *    une règle de plateforme qui la contredirait serait un piège ;
 *  — sans demande précise, jamais : la liste nue des sujets de HaikoDev
 *    n'apprend rien et se paie.
 *
 * La clé de dédoublonnage est préfixée : un sujet servi depuis l'amont ne se
 * confond pas avec le même sujet servi depuis le projet.
 */
function morceauxHerites(projectPath: string, requete: string, amont?: string): MorceauServi[] {
  if (!requete.trim()) return [];
  if (!amontApplicable({ projet: projectPath, amont })) return [];
  // Le projet a répondu : on ne monte pas d'un cran.
  if (morceauxRegles(projectPath, requete).length) return [];

  return morceauxRegles(amont as string, requete).map((morceau) => ({
    cle: morceau.cle ? `amont:${morceau.cle}` : '',
    libelle: `${morceau.libelle}, héritées de HaikoDev`,
    texte:
      `HÉRITÉ DE HAIKODEV — ce projet n'a pas de règle sur ce sujet ; voici celle de la PLATEFORME ` +
      `qui l'héberge. Elle vaut tant que ce projet n'écrit pas la sienne, et le fichier cité vit ` +
      `dans le dépôt de HaikoDev, pas ici.\n\n${morceau.texte}`,
  }));
}

/** Les morceaux de FAITS servis par une demande. */
function morceauxFaits(projectPath: string, requete: string): MorceauServi[] {
  const texte = detailMemoire(projectPath, requete);
  const sujet = sujetDeLaRequete(requete);
  // Seule une demande qui NOMME un sujet se dédoublonne : un numéro ou des
  // mots-clés rendent un extrait, jamais un fichier entier.
  if (!sujet) return [{ cle: '', libelle: 'ces faits', texte }];
  return [{ cle: cleMorceau('faits', sujet.id, texte), libelle: `les faits « ${sujet.libelle} »`, texte }];
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
   * LE DÉPÔT AMONT — HaikoDev — quand le projet visé en hérite. Il ne sert QUE
   * de repli : voir `morceauxHerites`. Absent, l'outil se comporte exactement
   * comme avant.
   */
  amont?: string,
): DetailProjet {
  const connus = new Set(dejaServis);
  const morceaux = [
    ...morceauxFaits(projectPath, requete),
    ...morceauxRegles(projectPath, requete),
    ...morceauxHerites(projectPath, requete, amont),
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
  const faits = memoryFacts(projectPath);
  if (!faits.length) {
    return "La mémoire du projet est vide : tu la rempliras en fin de tâche avec ce que tu auras appris.";
  }
  return (
    `MÉMOIRE DU PROJET — index des faits retenus (${faits.length}), une ligne par fait, groupée par sujet :\n` +
    `${texteIndex(faits)}\n\n` +
    `Ces lignes sont VOLONTAIREMENT tronquées. Chaque sujet est un FICHIER (${DOSSIER_MEMOIRE}/<sujet>.md) : ` +
    `demande-le avec l'outil « project_memory » (argument « sujet » : un numéro, un nom de sujet, ou des mots-clés) ` +
    `dès qu'une ligne touche à ce que tu vas modifier — et UNE SEULE FOIS par session, il reste ensuite dans ton contexte.`
  );
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
/** Le briefing coupé en deux : la part sans mémoire, et la part mémoire à part — quand elle existe. */
export interface BriefingSepare {
  sansMemoire: string;
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
  const competences = emporte.competences
    ? texteDesCompetences(listerCompetences(), dossierDesCompetences())
    : '';
  if (competences) parts.push(competences);

  /*
   * L'accès GitHub est ANNONCÉ, jamais supposé deviné. Le jeton est posé dans
   * l'environnement de tout agent (`server/src/github.ts`), mais un agent qui
   * l'ignore continue de proposer une carte pour un `gh pr view` de dix
   * secondes. Une ligne, valable sur tous les projets, sans réglage
   * (`shared/src/acces-github.ts`).
   */
  if (emporte.github) parts.push(texteAccesGithub());

  const sansMemoire = parts.join('\n\n');
  if (!avecMemoire || !emporte.memoire) return { sansMemoire };

  const memoire = [
    memoireRemplacee?.trim() || blocMemoire(projectPath),
    `RÈGLE DURABLE APPRISE : si ta tâche change une règle durable, une architecture ou une commande, NE TOUCHE PAS à ${quiFaitFoi} — ` +
      `écris-la à la fin de « ${FICHIER_D_ATTENTE} », et le démon la rangera cette nuit dans le fichier de son sujet. ` +
      `Ce fichier est chargé par le MOTEUR à chaque session : le modifier fait repayer aux agents suivants tout ce qu'il contient, au plein tarif. ` +
      `Le fichier d'attente, lui, n'est lu par aucun moteur et ne coûte rien.\n` +
      `Format d'une entrée : un titre en « ## », puis « - sujet : <un sujet de docs/regles/> », puis « - contrat : <une ligne> » seulement si l'invariant doit être NOMMÉ dans ${quiFaitFoi}, ` +
      `puis le texte entier de la règle. Court et factuel : comment lancer, comment vérifier, où vivent les choses, ce qu'on n'enfreint pas. Aucun journal, aucune trace de tâche.`,
  ].join('\n\n');

  return { sansMemoire, memoire };
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
  const { sansMemoire, memoire } = briefingSepare(projectPath, projectName, avecMemoire, engine, dossierDeTravail, niveau);
  return memoire ? `${sansMemoire}\n\n${memoire}` : sansMemoire;
}
