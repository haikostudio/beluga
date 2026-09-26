import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  FICHIER_COMPETENCE,
  convertirEnFiche,
  enIdentifiant,
  enTeteAvecCles,
  enTeteDeCompetence,
  formatAConvertir,
  idDeBibliothequeValide,
  nomDeFicheImportee,
  nomDeFicheSansCollision,
  raisonsDeRefusDeLImport,
  sourceDeBibliotheque,
  sousDossierDeLAdresse,
  sousDossierValide,
  type BilanDImportDeBibliotheque,
} from '@beluga/shared';
import {
  changerLEtat,
  dossierDesCompetences,
  ecrireLeRegistre,
  enregistrerLePool,
  lireLeRegistre,
  lirePool,
  reecrireLesFichiersDEntree,
  relierCompetencesAuxCoffres,
} from './competences.js';
import { synchroniserSansEchec } from './competences-memoire.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * IMPORTER UNE BIBLIOTHÈQUE DE COMPÉTENCES — d'un seul geste, par un agent
 * (outil « competences », action « importer »). Règles pures :
 * `shared/src/bibliotheque-competences.ts`.
 *
 * 1. La source est CLONÉE (dépôt git, `--depth 1`) ou lue (chemin local) dans
 *    un dossier temporaire, jamais exécutée : aucun script de la bibliothèque
 *    ne tourne, et aucun LIEN du clone n'est suivi.
 * 2. Chaque dossier portant un `SKILL.md` (format Claude ET Codex) est COPIÉ
 *    dans le pool avec ses fichiers de détail — une vraie copie, jamais un lien
 *    vers le dossier temporaire. Sans aucun `SKILL.md`, les règles d'autres
 *    outils (`.mdc`, `AGENTS.md`, `*.instructions.md`) sont converties au mieux.
 * 3. L'en-tête apprend d'où vient la fiche (`provenance-bibliotheque`…) ; le
 *    texte de ses auteurs ne bouge pas. La licence de la bibliothèque suit.
 * 4. RÉIMPORTER MET À JOUR : ce qui a changé est réécrit (état, compteurs et
 *    confiance gardés — ils vivent ailleurs), ce qui a disparu de la source est
 *    RETIRÉ DU SERVICE (archivé), jamais effacé.
 * 5. Le pool est enregistré, les coffres suivent, la mémoire est synchronisée.
 *
 * Une fiche importée est servie PAR LA MÉMOIRE SEULEMENT (décision de
 * l'utilisateur, 2026-09-24) : ni briefing, ni coffre des comptes.
 */

/** Au-delà, un fichier de détail n'est pas copié : une compétence n'embarque pas de gros binaires. */
const FICHIER_MAX_OCTETS = 5 * 1024 * 1024;
/** Le poids total qu'un import peut copier. */
const IMPORT_MAX_OCTETS = 200 * 1024 * 1024;
/** Les fiches qu'un import peut poser, au plus. */
const FICHES_PAR_IMPORT_MAX = 400;
const PROFONDEUR_MAX = 8;
const DUREE_DU_CLONE_MS = 180_000;

/** Les dossiers qu'on ne parcourt jamais dans une bibliothèque. */
const DOSSIERS_IGNORES = new Set(['.git', 'node_modules', 'template', 'templates']);
/** Les fichiers de licence de la bibliothèque, recopiés avec chaque fiche qui n'a pas la sienne. */
const MOTIF_LICENCE = /^(licen[cs]e|notice|third_party_notices|copying)(\.[a-z]+)?$/i;

interface Candidat {
  genre: 'skill' | 'conversion';
  /** Le dossier de la fiche (skill), ou le fichier à convertir. */
  chemin: string;
}

/** Une adresse sans identifiants : un jeton glissé dans l'adresse ne doit jamais atterrir dans le registre. */
function adresseAffichable(adresse: string): string {
  try {
    const url = new URL(adresse);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return adresse;
  }
}

/** Les fiches (dossiers à `SKILL.md`) et les règles à convertir, sans jamais suivre un lien. */
function trouverLesCandidats(racine: string): { skills: Candidat[]; conversions: Candidat[] } {
  const skills: Candidat[] = [];
  const conversions: Candidat[] = [];
  const parcourir = (dossier: string, profondeur: number) => {
    if (profondeur > PROFONDEUR_MAX || skills.length + conversions.length > FICHES_PAR_IMPORT_MAX * 2) return;
    let entrees: fs.Dirent[] = [];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    if (entrees.some((e) => e.isFile() && e.name === FICHIER_COMPETENCE)) {
      skills.push({ genre: 'skill', chemin: dossier });
      return; // Le reste du dossier est le DÉTAIL de cette fiche.
    }
    for (const entree of entrees) {
      if (entree.isSymbolicLink()) continue;
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(entree.name.toLowerCase())) parcourir(chemin, profondeur + 1);
      } else if (entree.isFile() && formatAConvertir(entree.name)) {
        conversions.push({ genre: 'conversion', chemin });
      }
    }
  };
  parcourir(racine, 0);
  return { skills, conversions };
}

/** Les fichiers d'un dossier, chemins relatifs, sans lien ni dossier caché de git. */
function fichiersDuDossier(dossier: string): string[] {
  const trouves: string[] = [];
  const parcourir = (courant: string, relatif: string, profondeur: number) => {
    if (profondeur > PROFONDEUR_MAX) return;
    let entrees: fs.Dirent[] = [];
    try {
      entrees = fs.readdirSync(courant, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees) {
      if (entree.isSymbolicLink() || entree.name === '.git' || entree.name === 'node_modules') continue;
      const suite = relatif ? `${relatif}/${entree.name}` : entree.name;
      if (entree.isDirectory()) parcourir(path.join(courant, entree.name), suite, profondeur + 1);
      else if (entree.isFile()) trouves.push(suite);
    }
  };
  parcourir(dossier, '', 0);
  return trouves.sort();
}

/** Ce qu'une fiche va poser : le texte de sa tête, et ses autres fichiers (chemin relatif → contenu). */
interface FicheAPoser {
  nom: string;
  tete: string;
  fichiers: Map<string, Buffer>;
}

/** L'empreinte d'une fiche, date d'import et commit mis à part : deux imports identiques ne font pas une mise à jour. */
function empreinte(tete: string, fichiers: ReadonlyMap<string, Buffer>): string {
  const h = crypto.createHash('sha256');
  // La date d'import et le commit de la bibliothèque changent à chaque passage :
  // ils ne font pas, à eux seuls, une fiche modifiée.
  h.update(tete.replace(/^provenance-(importee-le|commit):.*$/gm, ''));
  for (const [chemin, contenu] of [...fichiers].sort((a, b) => a[0].localeCompare(b[0]))) {
    h.update(`\0${chemin}\0`);
    h.update(contenu);
  }
  return h.digest('hex');
}

function empreinteDuPool(dossier: string): string | null {
  try {
    const tete = fs.readFileSync(path.join(dossier, FICHIER_COMPETENCE), 'utf8');
    const fichiers = new Map<string, Buffer>();
    for (const relatif of fichiersDuDossier(dossier)) {
      if (relatif === FICHIER_COMPETENCE) continue;
      fichiers.set(relatif, fs.readFileSync(path.join(dossier, relatif)));
    }
    return empreinte(tete, fichiers);
  } catch {
    return null;
  }
}

/** Poser une fiche dans le pool : écrite à côté, puis mise à sa place d'un coup. */
function poserLaFiche(racine: string, fiche: FicheAPoser): void {
  const cible = path.join(racine, fiche.nom);
  const provisoire = path.join(racine, `.import-${fiche.nom}-${process.pid}`);
  fs.rmSync(provisoire, { recursive: true, force: true });
  fs.mkdirSync(provisoire, { recursive: true });
  fs.writeFileSync(path.join(provisoire, FICHIER_COMPETENCE), fiche.tete, 'utf8');
  for (const [relatif, contenu] of fiche.fichiers) {
    const chemin = path.join(provisoire, relatif);
    // Deuxième garde : rien ne s'écrit hors du dossier de la fiche.
    if (!chemin.startsWith(provisoire + path.sep)) continue;
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    fs.writeFileSync(chemin, contenu);
  }
  const existant = fs.lstatSync(cible, { throwIfNoEntry: false });
  // Un LIEN (fiche adoptée depuis le coffre) se retire comme un lien : on ne
  // touche jamais au dossier de l'utilisateur qu'il visait.
  if (existant?.isSymbolicLink()) fs.unlinkSync(cible);
  else if (existant) fs.rmSync(cible, { recursive: true, force: true });
  fs.renameSync(provisoire, cible);
}

let importEnCours: Promise<BilanDImportDeBibliotheque> | null = null;

/**
 * IMPORTER (OU METTRE À JOUR) UNE BIBLIOTHÈQUE. Un seul import à la fois :
 * deux imports croisés se disputeraient le registre et le dépôt du pool.
 */
export async function importerUneBibliotheque(
  demande: { source: string; sousDossier?: string; nom?: string },
  options: { racine?: string } = {},
): Promise<BilanDImportDeBibliotheque> {
  while (importEnCours) await importEnCours.catch(() => undefined);
  importEnCours = importer(demande, options.racine ?? dossierDesCompetences());
  try {
    return await importEnCours;
  } finally {
    importEnCours = null;
  }
}

async function importer(demande: { source: string; sousDossier?: string; nom?: string }, racine: string): Promise<BilanDImportDeBibliotheque> {
  const src = sourceDeBibliotheque(demande.source);
  const id = demande.nom?.trim() ? enIdentifiant(demande.nom) : src?.id ?? '';
  const bilan: BilanDImportDeBibliotheque = {
    ok: false,
    bibliotheque: id,
    source: src ? adresseAffichable(src.adresse) : demande.source,
    creees: [],
    misesAJour: [],
    inchangees: [],
    retirees: [],
    renommees: [],
    refusees: [],
  };
  if (!src) {
    bilan.erreur = `« ${demande.source} » n'est ni un mot connu (anthropic, openai), ni « propriétaire/dépôt », ni une adresse de dépôt git, ni un chemin absolu`;
    return bilan;
  }
  if (!idDeBibliothequeValide(id)) {
    bilan.erreur = `« ${id} » ne fait pas un nom de bibliothèque : des minuscules, des chiffres et des traits d'union`;
    return bilan;
  }
  const sousDossier = demande.sousDossier?.trim() || sousDossierDeLAdresse(demande.source);
  if (sousDossier && !sousDossierValide(sousDossier)) {
    bilan.erreur = `le sous-dossier « ${sousDossier} » doit être un chemin relatif, sans remontée`;
    return bilan;
  }

  const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-bibliotheque-'));
  try {
    /* 1. La source, dans un dossier temporaire. */
    let depot: string;
    if (src.genre === 'git') {
      depot = path.join(temporaire, 'depot');
      try {
        await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', '--quiet', src.adresse, depot], {
          timeout: DUREE_DU_CLONE_MS,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
          maxBuffer: 4 * 1024 * 1024,
        });
      } catch (err) {
        const e = err as { stderr?: string; message: string };
        bilan.erreur = `clonage de ${bilan.source} impossible : ${(e.stderr || e.message).trim().split('\n').slice(-2).join(' ')}`;
        return bilan;
      }
    } else {
      depot = src.adresse;
      if (!fs.statSync(depot, { throwIfNoEntry: false })?.isDirectory()) {
        bilan.erreur = `le dossier ${depot} n'existe pas`;
        return bilan;
      }
    }
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: depot, env: { ...process.env, LC_ALL: 'C' } });
      bilan.commit = stdout.trim() || undefined;
    } catch {
      /* un dossier local sans git n'a pas de commit : rien à dire */
    }

    const depart = sousDossier ? path.join(depot, sousDossier) : depot;
    const reelDepot = fs.realpathSync(depot);
    const reelDepart = fs.existsSync(depart) ? fs.realpathSync(depart) : '';
    if (!reelDepart || (reelDepart !== reelDepot && !reelDepart.startsWith(reelDepot + path.sep))) {
      bilan.erreur = `le sous-dossier « ${sousDossier} » n'existe pas dans la bibliothèque`;
      return bilan;
    }

    /* 2. Ce qu'il y a à prendre. */
    const { skills, conversions } = trouverLesCandidats(reelDepart);
    // Des SKILL.md : c'est une vraie bibliothèque, et ses AGENTS.md sont les
    // consignes de ses contributeurs, pas des compétences. Sans aucun, on convertit.
    const candidats = skills.length ? skills : conversions;
    if (!candidats.length) {
      bilan.erreur = `aucune compétence trouvée : ni dossier portant un ${FICHIER_COMPETENCE}, ni règle .mdc, AGENTS.md ou *.instructions.md`;
      return bilan;
    }
    const licences = fs
      .readdirSync(reelDepot, { withFileTypes: true })
      .filter((e) => e.isFile() && MOTIF_LICENCE.test(e.name))
      .map((e) => ({ nom: e.name, contenu: fs.readFileSync(path.join(reelDepot, e.name)) }));

    /* 3. Qui occupe déjà quel nom dans le pool (null = une fiche maison). */
    fs.mkdirSync(racine, { recursive: true });
    const registre = lireLeRegistre(racine);
    const pool = lirePool(racine);
    const occupants = new Map<string, string | null>();
    for (const fiche of pool.fiches) occupants.set(path.basename(fiche.dossier), fiche.bibliotheque ?? null);
    for (const refus of pool.refus) occupants.set(refus.nom, null);
    const etatsAvant = new Map(pool.fiches.map((f) => [path.basename(f.dossier), f.etat]));

    const maintenant = Date.now();
    const posees = new Set<string>();
    let octets = 0;

    for (const candidat of candidats) {
      if (posees.size >= FICHES_PAR_IMPORT_MAX) {
        bilan.refusees.push({ nom: path.relative(reelDepot, candidat.chemin), raison: `plus de ${FICHES_PAR_IMPORT_MAX} fiches dans un seul import` });
        continue;
      }
      const relatifSource = path.relative(reelDepot, candidat.chemin) || path.basename(candidat.chemin);
      let tete: string;
      let nomBase: string;
      const fichiers = new Map<string, Buffer>();

      if (candidat.genre === 'skill') {
        tete = fs.readFileSync(path.join(candidat.chemin, FICHIER_COMPETENCE), 'utf8');
        const raisons = raisonsDeRefusDeLImport(tete);
        if (raisons.length) {
          bilan.refusees.push({ nom: relatifSource, raison: raisons.join(' ; ') });
          continue;
        }
        nomBase = nomDeFicheImportee(enTeteDeCompetence(tete).nom, path.basename(candidat.chemin));
        let tropLourd = false;
        for (const relatif of fichiersDuDossier(candidat.chemin)) {
          if (relatif === FICHIER_COMPETENCE) continue;
          const taille = fs.statSync(path.join(candidat.chemin, relatif)).size;
          if (taille > FICHIER_MAX_OCTETS) continue; // un gros binaire ne suit pas, la fiche si
          octets += taille;
          if (octets > IMPORT_MAX_OCTETS) {
            tropLourd = true;
            break;
          }
          fichiers.set(relatif, fs.readFileSync(path.join(candidat.chemin, relatif)));
        }
        if (tropLourd) {
          bilan.refusees.push({ nom: relatifSource, raison: `l'import dépasse ${IMPORT_MAX_OCTETS / 1024 / 1024} Mo` });
          break;
        }
      } else {
        const format = formatAConvertir(path.basename(candidat.chemin))!;
        const conversion = convertirEnFiche(
          format,
          fs.readFileSync(candidat.chemin, 'utf8'),
          path.basename(candidat.chemin),
          path.basename(path.dirname(candidat.chemin)),
        );
        if (!conversion.ok) {
          bilan.refusees.push({ nom: relatifSource, raison: conversion.raison });
          continue;
        }
        tete = conversion.texte;
        nomBase = conversion.nom;
      }
      if (!nomBase) {
        bilan.refusees.push({ nom: relatifSource, raison: 'aucun nom de fiche utilisable' });
        continue;
      }

      // Un nom pris par une fiche maison ou une autre bibliothèque : suffixe.
      // Deux fiches de la même bibliothèque au même nom : la seconde prend un numéro.
      let nom = nomDeFicheSansCollision(nomBase, id, occupants);
      for (let n = 2; posees.has(nom) && n < 50; n++) nom = `${nomBase.slice(0, 45)}-${n}`;
      if (posees.has(nom)) {
        bilan.refusees.push({ nom: relatifSource, raison: `nom « ${nomBase} » déjà pris trop de fois` });
        continue;
      }
      if (nom !== nomBase) bilan.renommees.push(`${nomBase} → ${nom}`);

      for (const licence of licences) if (!fichiers.has(licence.nom)) fichiers.set(licence.nom, licence.contenu);

      const cible = path.join(racine, nom);
      const dejaLa = fs.lstatSync(cible, { throwIfNoEntry: false });
      const ancienne = dejaLa ? enTeteDeCompetence(safeLire(path.join(cible, FICHIER_COMPETENCE))) : null;
      const cles = {
        name: nom,
        // L'état posé ici (une fiche archivée à la main) survit à la mise à jour.
        etat: etatsAvant.get(nom) && etatsAvant.get(nom) !== 'active' ? etatsAvant.get(nom) : undefined,
        'provenance-bibliotheque': id,
        'provenance-source': bilan.source,
        'provenance-commit': bilan.commit,
        'provenance-importee-le': ancienne?.provenance?.['importee-le'] ?? String(maintenant),
      };
      let texte = enTeteAvecCles(tete, cles);
      const inchangee = Boolean(dejaLa && !dejaLa.isSymbolicLink()) && empreinteDuPool(cible) === empreinte(texte, fichiers);
      posees.add(nom);
      occupants.set(nom, id);
      if (inchangee) {
        bilan.inchangees.push(nom);
        continue;
      }
      texte = enTeteAvecCles(tete, { ...cles, 'provenance-importee-le': String(maintenant) });
      try {
        poserLaFiche(racine, { nom, tete: texte, fichiers });
      } catch (err) {
        posees.delete(nom);
        bilan.refusees.push({ nom: relatifSource, raison: `écriture impossible : ${(err as Error).message}` });
        continue;
      }
      if (dejaLa) bilan.misesAJour.push(nom);
      else bilan.creees.push(nom);
    }

    /* 4. Ce qui a disparu de la source : retiré du service, jamais effacé. */
    const avant = registre[id]?.competences ?? [];
    for (const nom of avant) {
      if (posees.has(nom)) continue;
      const etat = etatsAvant.get(nom);
      if (!etat) continue; // plus dans le pool du tout
      if (etat !== 'archivee') {
        const r = changerLEtat(nom, 'archivee', racine);
        if (r.ok) bilan.retirees.push(nom);
      }
    }

    registre[id] = {
      source: bilan.source,
      commit: bilan.commit,
      sousDossier: sousDossier || undefined,
      importeeLe: maintenant,
      // Les fiches retirées restent inscrites : elles viennent toujours de là.
      competences: [...new Set([...posees, ...avant.filter((nom) => etatsAvant.has(nom))])],
    };
    ecrireLeRegistre(registre, racine);

    reecrireLesFichiersDEntree(racine);
    const combien = bilan.creees.length + bilan.misesAJour.length;
    enregistrerLePool(
      racine,
      `importe la bibliothèque ${id} (${posees.size} compétence(s) : ${bilan.creees.length} nouvelle(s), ${bilan.misesAJour.length} mise(s) à jour, ${bilan.retirees.length} retirée(s))`,
    );
    bilan.ok = posees.size > 0 || bilan.retirees.length > 0;
    if (!bilan.ok) bilan.erreur = 'aucune fiche retenue : toutes ont été écartées (voir les raisons)';
    log.info(`bibliothèque ${id} : ${combien} fiche(s) écrite(s), ${bilan.inchangees.length} inchangée(s), ${bilan.refusees.length} écartée(s)`);
    return bilan;
  } finally {
    fs.rmSync(temporaire, { recursive: true, force: true });
    if (racine === dossierDesCompetences()) {
      relierCompetencesAuxCoffres();
      synchroniserSansEchec();
    }
  }
}

function safeLire(fichier: string): string {
  try {
    return fs.readFileSync(fichier, 'utf8');
  } catch {
    return '';
  }
}
