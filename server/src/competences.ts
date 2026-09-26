import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMPTEURS_VIDES,
  Competence,
  CompteursDeFiche,
  EtatDeFiche,
  EtatDuPool,
  FICHIERS_D_ENTREE,
  FICHIER_COMPETENCE,
  FICHIER_INDEX_SYMPTOMES,
  FICHIER_SOMMAIRE,
  FICHIER_REGISTRE_BIBLIOTHEQUES,
  NOM_DOSSIER_COMPETENCES,
  ProvenanceDeFiche,
  type RegistreDesBibliotheques,
  annonceeEnTeteDeSession,
  bibliothequeDuRegistre,
  confianceInitialeDeLaFiche,
  registreDepuisTexte,
  texteDuRegistre,
  RedactionDeFiche,
  RefusDeCompetence,
  type DatesDeFiche,
  anomaliesDeLaFiche,
  confianceDeLaFiche,
  datesDesFichesDepuisGit,
  enTeteDeCompetence,
  etatDeFiche,
  ficheEnService,
  gesteDeLiaison,
  grouperParTheme,
  jugerLaFiche,
  listeDEnTete,
  nomDeFicheValide,
  provenanceDepuisEnTete,
  provenanceRenforcee,
  raisonDuRefus,
  texteDeLIndexDesSymptomes,
  texteDeLaFiche,
  texteDuSommaireDesCompetences,
} from '@beluga/shared';
import { PATHS } from './config.js';
import { listAccountRecords } from './accounts.js';
import { getDb } from './db.js';
import { log } from './logger.js';

/**
 * LE POOL DE COMPÉTENCES, CÔTÉ DISQUE ET BASE (règles pures dans
 * `shared/src/competences.ts`, format d'écriture dans
 * `shared/src/fiche-competence.ts`).
 *
 * Un seul dossier fait foi : `data/competences/`. Chaque compétence y est un
 * dossier portant un `SKILL.md` — écrit là, ou simplement lié depuis l'endroit
 * où l'utilisateur le tient à jour. Le démon le recopie dans le coffre de
 * chaque compte Claude (`<coffre>/skills/<nom>`), qui est le seul endroit où ce
 * moteur va chercher ses compétences ; Codex, lui, n'en a aucun — c'est le
 * briefing qui les lui annonce, comme au chef d'orchestre bridé.
 *
 * CE QUI A CHANGÉ AVEC LE POOL :
 *
 *  • ON LIT L'ARBRE ENTIER. Une compétence n'est plus « un fichier » : sa TÊTE
 *    (`SKILL.md`) plus ses fichiers de DÉTAIL, qui sont indexés mais ne pèsent
 *    que si on les ouvre.
 *  • ON DIT CE QU'ON REFUSE. Un dossier sans `SKILL.md`, un fichier posé à plat,
 *    un lien mort étaient écartés en silence : ils sortent maintenant avec leur
 *    cause, au journal et à l'écran.
 *  • ON ÉCRIT. `ecrireLaFiche` est le SEUL chemin d'écriture du pool : il passe
 *    par le contrôle de qualité, garde la provenance et enregistre dans le dépôt
 *    git du pool.
 *  • ON COMPTE. Quatre compteurs par fiche, en base, qui donnent sa confiance.
 */

/** Le dossier des compétences partagées. */
export function dossierDesCompetences(): string {
  return PATHS.competences;
}

/** Ce qu'une lecture du pool rapporte : ce qui est gardé ET ce qui est écarté. */
export interface PoolLu {
  fiches: Competence[];
  refus: RefusDeCompetence[];
}

/**
 * LES FICHIERS DE DÉTAIL d'une compétence : tout ce qui vit dans son dossier
 * hors la tête. On descend de deux niveaux au plus et on plafonne — une
 * compétence qui embarque un dépôt entier ne doit pas noyer l'index.
 */
const PROFONDEUR_ANNEXES_MAX = 3;
const ANNEXES_MAX = 40;

function annexesDeLaFiche(dossier: string): string[] {
  const trouves: string[] = [];
  const parcourir = (courant: string, relatif: string, profondeur: number) => {
    if (profondeur > PROFONDEUR_ANNEXES_MAX || trouves.length >= ANNEXES_MAX) return;
    let entrees: fs.Dirent[] = [];
    try {
      entrees = fs.readdirSync(courant, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees) {
      if (trouves.length >= ANNEXES_MAX) return;
      if (entree.name.startsWith('.')) continue;
      const suite = relatif ? `${relatif}/${entree.name}` : entree.name;
      const chemin = path.join(courant, entree.name);
      let estDossier = entree.isDirectory();
      if (entree.isSymbolicLink()) {
        try {
          estDossier = fs.statSync(chemin).isDirectory();
        } catch {
          continue;
        }
      }
      if (estDossier) {
        parcourir(chemin, suite, profondeur + 1);
        continue;
      }
      if (suite === FICHIER_COMPETENCE) continue;
      trouves.push(suite);
    }
  };
  parcourir(dossier, '', 1);
  return trouves.sort();
}

/**
 * LE POOL, LU EN ENTIER — fiches gardées et entrées REFUSÉES, chacune avec sa
 * cause. Jamais d'exception : au pire, un pool vide et un refus dit.
 */
export function lirePool(dossier = dossierDesCompetences()): PoolLu {
  const fiches: Competence[] = [];
  const refus: RefusDeCompetence[] = [];
  let entrees: fs.Dirent[] = [];
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return { fiches, refus };
  }
  const registre = lireLeRegistre(dossier);

  for (const entree of entrees) {
    const nom = entree.name;
    if (nom.startsWith('.')) continue;
    // Les deux fichiers d'ENTRÉE sont écrits par le démon lui-même : ils vivent
    // à la racine du pool et ne sont pas des compétences.
    if (FICHIERS_D_ENTREE.includes(nom)) continue;

    const chemin = path.join(dossier, nom);
    // Un lien vers le dossier tenu par l'utilisateur compte autant qu'un vrai
    // dossier : on interroge la CIBLE, pas le lien.
    let estDossier = false;
    try {
      estDossier = fs.statSync(chemin).isDirectory();
    } catch (err) {
      refus.push({ nom, cause: 'lien-mort', detail: (err as Error).message });
      continue;
    }
    if (!estDossier) {
      refus.push({ nom, cause: 'pas-un-dossier' });
      continue;
    }

    const fichier = path.join(chemin, FICHIER_COMPETENCE);
    let texte: string;
    try {
      texte = fs.readFileSync(fichier, 'utf8');
    } catch (err) {
      const cause = fs.existsSync(fichier) ? 'illisible' : 'sans-mode-d-emploi';
      refus.push({ nom, cause, detail: cause === 'illisible' ? (err as Error).message : undefined });
      continue;
    }

    const entete = enTeteDeCompetence(texte);
    const provenance = provenanceDepuisEnTete(entete);
    const nomDeclare = entete.nom?.trim() || nom;
    fiches.push({
      nom: nomDeclare,
      description: entete.description?.trim() || 'compétence sans description',
      dossier: chemin,
      fichier,
      etat: etatDeFiche(entete.etat),
      themes: listeDEnTete(entete.themes),
      symptomes: listeDEnTete(entete.symptomes),
      projets: listeDEnTete(entete.projets),
      provenance,
      annexes: annexesDeLaFiche(chemin),
      anomalies: anomaliesDeLaFiche(texte),
      // L'en-tête d'une fiche importée le dit ; une fiche ADOPTÉE (un lien vers
      // le coffre personnel, qu'on ne réécrit pas) le dit par le registre.
      bibliotheque:
        provenance.bibliotheque || bibliothequeDuRegistre(registre, nom) || bibliothequeDuRegistre(registre, nomDeclare) || undefined,
    });
  }

  fiches.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return { fiches, refus };
}

/**
 * LES COMPÉTENCES EN SERVICE, triées par nom : ce que voient les agents. Une
 * fiche ARCHIVÉE n'en fait pas partie — elle reste sur le disque, avec son
 * histoire, mais elle ne se sert plus.
 *
 * Les refus, eux, sont DITS au journal (une fois par cause et par nom : sans
 * cela, le même dossier bancal écrirait une ligne à chaque briefing).
 */
export function listerCompetences(dossier = dossierDesCompetences()): Competence[] {
  const { fiches, refus } = lirePool(dossier);
  direLesRefus(refus);
  return fiches.filter((fiche) => ficheEnService(fiche.etat));
}

/** Ce qui a déjà été dit : un refus se journalise une fois, pas à chaque tour. */
const refusDejaDits = new Set<string>();

export function direLesRefus(refus: RefusDeCompetence[]): void {
  for (const entree of refus) {
    const cle = `${entree.nom}:${entree.cause}`;
    if (refusDejaDits.has(cle)) continue;
    refusDejaDits.add(cle);
    log.warn(`compétence écartée — ${raisonDuRefus(entree)}`);
  }
}

/* ------------------------------------------------------------------ */
/* LE REGISTRE DES BIBLIOTHÈQUES                                        */
/* ------------------------------------------------------------------ */

/**
 * Le registre des bibliothèques importées (`.bibliotheques.json`, à la racine
 * du pool et dans son dépôt git). Il dit quelle fiche vient de quelle
 * bibliothèque — donc lesquelles sont servies PAR LA MÉMOIRE SEULEMENT.
 */
export function lireLeRegistre(racine = dossierDesCompetences()): RegistreDesBibliotheques {
  try {
    return registreDepuisTexte(fs.readFileSync(path.join(racine, FICHIER_REGISTRE_BIBLIOTHEQUES), 'utf8'));
  } catch {
    return {};
  }
}

export function ecrireLeRegistre(registre: RegistreDesBibliotheques, racine = dossierDesCompetences()): void {
  fs.mkdirSync(racine, { recursive: true });
  fs.writeFileSync(path.join(racine, FICHIER_REGISTRE_BIBLIOTHEQUES), texteDuRegistre(registre), 'utf8');
}

/** La confiance MESURÉE d'une fiche : ses compteurs, depuis son point de départ (plus bas pour une fiche importée). */
export function confianceMesureeDeLaFiche(fiche: Pick<Competence, 'nom' | 'bibliotheque'>): number {
  return confianceDeLaFiche(compteursDeLaFiche(fiche.nom), confianceInitialeDeLaFiche(fiche));
}

function cheminReel(chemin: string): string | undefined {
  try {
    return fs.realpathSync(chemin);
  } catch {
    return undefined;
  }
}

export interface BilanDeLiaison {
  /** Liens posés à l'instant. */
  posees: string[];
  /** Compétences déjà en place, rien à faire. */
  dejaLa: string[];
  /** La place était prise par autre chose : on n'y touche pas, on le dit. */
  occupees: string[];
  /** Liens retirés : fiches de bibliothèque (servies par la mémoire seulement) ou archivées. */
  retirees: string[];
}

/**
 * Pose chaque compétence partagée dans le coffre des comptes Claude. Rien n'est
 * écrasé : une place déjà occupée par autre chose est LAISSÉE et signalée —
 * c'est souvent la compétence d'origine, tenue à jour par l'utilisateur.
 */
export function relierCompetencesAuxCoffres(): BilanDeLiaison {
  const bilan: BilanDeLiaison = { posees: [], dejaLa: [], occupees: [], retirees: [] };
  const { fiches } = lirePool();
  // Seules les fiches MAISON en service sont posées. Une fiche de BIBLIOTHÈQUE
  // est servie par la mémoire seulement : l'outil de compétences de Claude
  // charge la description de TOUT ce que le coffre porte, à chaque session.
  const competences = fiches.filter((fiche) => ficheEnService(fiche.etat) && annonceeEnTeteDeSession(fiche));
  const aRetirer = fiches.filter((fiche) => !competences.includes(fiche));
  if (!competences.length && !aRetirer.length) return bilan;

  for (const compte of listAccountRecords()) {
    // Seul Claude Code lit un dossier de compétences ; Codex ne connaît pas la
    // notion, et le briefing s'en charge pour lui.
    if (compte.engine !== 'claude') continue;
    const dossierSkills = path.join(compte.configDir, NOM_DOSSIER_COMPETENCES);
    try {
      fs.mkdirSync(dossierSkills, { recursive: true });
    } catch (err) {
      log.warn(`compétences : coffre ${compte.id} inaccessible (${(err as Error).message})`);
      continue;
    }
    /*
     * CE QUI NE DOIT PLUS Y ÊTRE : les liens que le démon a posés vers une fiche
     * de bibliothèque ou une fiche archivée. On ne retire QU'UN LIEN qui mène à
     * la fiche du pool — jamais un vrai dossier : dans le coffre de l'utilisateur,
     * la même compétence peut être SON original, et il n'est pas à nous.
     */
    for (const fiche of aRetirer) {
      const cible = path.join(dossierSkills, fiche.nom);
      try {
        if (!fs.lstatSync(cible, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
        const vise = cheminReel(cible);
        if (vise && vise !== cheminReel(fiche.dossier)) continue;
        fs.unlinkSync(cible);
        bilan.retirees.push(`${compte.id}/${fiche.nom}`);
      } catch (err) {
        log.warn(`compétence « ${fiche.nom} » non retirée de ${compte.id} : ${(err as Error).message}`);
      }
    }
    for (const competence of competences) {
      const source = cheminReel(competence.dossier);
      if (!source) continue;
      const cible = path.join(dossierSkills, competence.nom);
      const geste = gesteDeLiaison(source, cheminReel(cible));
      if (geste === 'deja-liee') {
        bilan.dejaLa.push(`${compte.id}/${competence.nom}`);
        continue;
      }
      if (geste === 'occupe') {
        bilan.occupees.push(`${compte.id}/${competence.nom}`);
        continue;
      }
      try {
        // Un lien mort occupe la place sans avoir de chemin réel : on le retire
        // avant de reposer le bon, sinon le lien échoue à chaque démarrage.
        if (fs.lstatSync(cible, { throwIfNoEntry: false })) fs.unlinkSync(cible);
        fs.symlinkSync(source, cible, 'dir');
        bilan.posees.push(`${compte.id}/${competence.nom}`);
      } catch (err) {
        log.warn(`compétence « ${competence.nom} » non posée dans ${compte.id} : ${(err as Error).message}`);
      }
    }
  }

  if (bilan.posees.length) log.info(`compétences partagées posées : ${bilan.posees.join(', ')}`);
  if (bilan.retirees.length) log.info(`compétences retirées des coffres (mémoire seulement, ou archivées) : ${bilan.retirees.join(', ')}`);
  if (bilan.occupees.length) {
    log.info(`compétences déjà présentes autrement (laissées telles quelles) : ${bilan.occupees.join(', ')}`);
  }
  return bilan;
}

/* ------------------------------------------------------------------ */
/* L'ADOPTION : le coffre personnel entre DANS le pool                  */
/* ------------------------------------------------------------------ */

/**
 * LE POOL NE CONTENAIT QU'UNE FICHE SUR QUINZE, ET PERSONNE NE LE SAVAIT.
 *
 * `data/competences/` portait un seul lien — `compta` — vers le dossier de
 * compétences que l'utilisateur tient à jour dans son coffre personnel. Or ce
 * coffre en porte QUINZE : les quatorze autres n'étaient raccordées à rien,
 * aucun agent ne les voyait, la recherche ne les indexait pas.
 *
 * On ADOPTE donc, sans rien copier ni déplacer : pour chaque dossier du coffre
 * qui porte un `SKILL.md` et qui n'est pas déjà dans le pool, on pose un lien.
 * Le coffre reste la source que l'utilisateur modifie ; le pool devient la
 * porte par laquelle tout le monde y accède.
 *
 * OÙ EST LE COFFRE ? On ne le devine pas : on le DÉDUIT des liens déjà posés
 * (le parent de la cible de `compta`), et `BELUGA_COFFRE_COMPETENCES` permet
 * d'en nommer un de plus. Sans lien ni variable, on n'adopte rien — on ne part
 * pas fouiller le disque.
 *
 * Rien n'est jamais écrasé : une place déjà prise est laissée telle quelle.
 */
export function adopterLesCompetencesDuCoffre(racine = dossierDesCompetences()): {
  adoptees: string[];
  coffres: string[];
} {
  const bilan = { adoptees: [] as string[], coffres: [] as string[] };
  const coffres = new Set<string>();

  const declare = process.env.BELUGA_COFFRE_COMPETENCES?.trim();
  if (declare) coffres.add(declare);

  let entrees: fs.Dirent[] = [];
  try {
    entrees = fs.readdirSync(racine, { withFileTypes: true });
  } catch {
    return bilan;
  }
  for (const entree of entrees) {
    if (!entree.isSymbolicLink()) continue;
    const cible = cheminReel(path.join(racine, entree.name));
    if (cible) coffres.add(path.dirname(cible));
  }
  bilan.coffres = [...coffres];
  if (!coffres.size) return bilan;

  const dejaLa = new Set(entrees.map((e) => e.name));
  for (const coffre of coffres) {
    // Le pool lui-même n'est pas un coffre à adopter : on ne se lie pas à soi.
    if (cheminReel(coffre) === cheminReel(racine)) continue;
    let fiches: fs.Dirent[] = [];
    try {
      fiches = fs.readdirSync(coffre, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const fiche of fiches) {
      if (fiche.name.startsWith('.') || dejaLa.has(fiche.name)) continue;
      const source = path.join(coffre, fiche.name);
      try {
        if (!fs.statSync(source).isDirectory()) continue;
        if (!fs.existsSync(path.join(source, FICHIER_COMPETENCE))) continue;
        fs.symlinkSync(source, path.join(racine, fiche.name), 'dir');
      } catch (err) {
        log.warn(`compétence « ${fiche.name} » non adoptée : ${(err as Error).message}`);
        continue;
      }
      dejaLa.add(fiche.name);
      bilan.adoptees.push(fiche.name);
    }
  }

  if (bilan.adoptees.length) {
    log.info(`compétences adoptées dans le pool : ${bilan.adoptees.join(', ')}`);
    reecrireLesFichiersDEntree(racine);
    enregistrerLePool(racine, `adopte ${bilan.adoptees.length} compétence(s) du coffre`);
  }
  return bilan;
}

/* ------------------------------------------------------------------ */
/* LES COMPTEURS                                                        */
/* ------------------------------------------------------------------ */

/**
 * L'USAGE RÉEL D'UNE FICHE, en base (`competence_stats`, migration 30). Les
 * compteurs vivent à part du fichier : une fiche est un document que
 * l'utilisateur peut réécrire à la main, ses statistiques n'ont rien à y faire.
 */
export function compteursDeLaFiche(nom: string): CompteursDeFiche {
  const ligne = getDb()
    .prepare('SELECT servie, aidee, inutile, contredite, dernier_service FROM competence_stats WHERE nom = ?')
    .get(nom) as
    | { servie: number; aidee: number; inutile: number; contredite: number; dernier_service: number | null }
    | undefined;
  if (!ligne) return { ...COMPTEURS_VIDES };
  return {
    servie: ligne.servie,
    aidee: ligne.aidee,
    inutile: ligne.inutile,
    contredite: ligne.contredite,
    dernierService: ligne.dernier_service ?? undefined,
  };
}

/** Tous les compteurs connus, d'un coup : l'écran des réglages en a besoin. */
export function tousLesCompteurs(): Map<string, CompteursDeFiche> {
  const carte = new Map<string, CompteursDeFiche>();
  try {
    const lignes = getDb()
      .prepare('SELECT nom, servie, aidee, inutile, contredite, dernier_service FROM competence_stats')
      .all() as {
      nom: string;
      servie: number;
      aidee: number;
      inutile: number;
      contredite: number;
      dernier_service: number | null;
    }[];
    for (const ligne of lignes) {
      carte.set(ligne.nom, {
        servie: ligne.servie,
        aidee: ligne.aidee,
        inutile: ligne.inutile,
        contredite: ligne.contredite,
        dernierService: ligne.dernier_service ?? undefined,
      });
    }
  } catch (err) {
    log.warn(`compteurs de compétences illisibles : ${(err as Error).message}`);
  }
  return carte;
}

type ColonneDeCompteur = 'servie' | 'aidee' | 'inutile' | 'contredite';

/** Ajoute UN au compteur nommé. Jamais d'exception : compter ne fait pas échouer un tour. */
export function compter(nom: string, colonne: ColonneDeCompteur, combien = 1): void {
  if (!nom || combien <= 0) return;
  const maintenant = Date.now();
  // Seul un SERVICE date la fiche : un retour d'agent dit sa valeur, pas son
  // dernier emploi. `COALESCE` garde donc l'ancienne date sur les trois autres.
  const service = colonne === 'servie' ? maintenant : null;
  try {
    getDb()
      .prepare(
        `INSERT INTO competence_stats (nom, ${colonne}, dernier_service, maj_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(nom) DO UPDATE SET ${colonne} = ${colonne} + ?,
           dernier_service = COALESCE(excluded.dernier_service, competence_stats.dernier_service),
           maj_at = excluded.maj_at`,
      )
      .run(nom, combien, service, maintenant, combien);
  } catch (err) {
    log.warn(`compteur « ${colonne} » de la compétence « ${nom} » non tenu : ${(err as Error).message}`);
  }
}


/* ------------------------------------------------------------------ */
/* L'ÉCRITURE                                                           */
/* ------------------------------------------------------------------ */

export interface EcritureDeFiche {
  ok: boolean;
  /** Ce qui a été fait : une fiche neuve, ou une fiche complétée. */
  geste?: 'creee' | 'completee';
  nom?: string;
  chemin?: string;
  /** Les raisons du refus, en clair — jamais un refus muet. */
  raisons?: string[];
}

/**
 * ÉCRIRE UNE FICHE — LE SEUL CHEMIN D'ÉCRITURE DU POOL.
 *
 * Trois refus, tous dits : un nom qui n'est pas un nom de dossier (rien
 * n'écrira hors du pool), une fiche qui ne passe pas le contrôle de qualité
 * (`jugerLaFiche` : sans section « Vérification », sans déclenchement dans la
 * description), et un dossier qu'on ne peut pas écrire.
 *
 * Une fiche qui existe déjà est COMPLÉTÉE, jamais dupliquée : sa provenance
 * d'ORIGINE est gardée telle quelle et la nouvelle carte s'ajoute à celles qui
 * l'ont renforcée.
 */
export function ecrireLaFiche(
  redaction: RedactionDeFiche,
  options: { dossier?: string; carte?: { id: string; projet?: string } } = {},
): EcritureDeFiche {
  const racine = options.dossier ?? dossierDesCompetences();
  const nom = redaction.nom.trim();
  if (!nomDeFicheValide(nom)) {
    return {
      ok: false,
      raisons: [
        `« ${nom} » n'est pas un nom de fiche : des minuscules, des chiffres et des traits d'union, rien d'autre`,
      ],
    };
  }

  const dossier = path.join(racine, nom);
  const fichier = path.join(dossier, FICHIER_COMPETENCE);
  const existe = fs.existsSync(fichier);

  // La PROVENANCE d'origine ne bouge jamais : c'est elle qui dit où la leçon est
  // née. La carte du jour ne fait que s'ajouter à celles qui l'ont renforcée.
  let provenance: ProvenanceDeFiche = redaction.provenance ?? {};
  if (existe) {
    try {
      const ancienne = provenanceDepuisEnTete(enTeteDeCompetence(fs.readFileSync(fichier, 'utf8')));
      provenance = options.carte ? provenanceRenforcee(ancienne, options.carte) : ancienne;
    } catch {
      /* fiche illisible : on repart de la provenance donnée */
    }
  } else if (!provenance.creeeLe) {
    provenance = { ...provenance, creeeLe: Date.now() };
  }

  const texte = texteDeLaFiche({ ...redaction, nom, provenance });
  const jugement = jugerLaFiche(texte);
  if (!jugement.ok) return { ok: false, raisons: jugement.raisons };

  try {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(fichier, texte, 'utf8');
    for (const annexe of redaction.annexes ?? []) {
      const cible = path.join(dossier, annexe.chemin);
      // Deuxième garde, après `cheminDAnnexeValide` : on vérifie que le chemin
      // résolu reste DANS le dossier de la fiche. Un lien, un encodage exotique
      // ou un futur assouplissement de la règle ne doivent jamais écrire ailleurs.
      if (!cible.startsWith(dossier + path.sep)) continue;
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, annexe.texte, 'utf8');
    }
  } catch (err) {
    return { ok: false, raisons: [`écriture impossible : ${(err as Error).message}`] };
  }

  reecrireLesFichiersDEntree(racine);
  enregistrerLePool(racine, `${existe ? 'complète' : 'ajoute'} la compétence « ${nom} »`);
  return { ok: true, geste: existe ? 'completee' : 'creee', nom, chemin: fichier };
}

/**
 * CHANGER L'ÉTAT D'UNE FICHE — active, dépréciée, archivée. RIEN NE SE SUPPRIME :
 * on réécrit la seule clé `etat` de l'en-tête, le reste du fichier ne bouge pas
 * (une fiche peut être tenue à la main, on n'a pas à la reformater).
 */
export function changerLEtat(nom: string, etat: EtatDeFiche, racine = dossierDesCompetences()): EcritureDeFiche {
  if (!nomDeFicheValide(nom)) return { ok: false, raisons: [`« ${nom} » n'est pas un nom de fiche`] };
  const fichier = path.join(racine, nom, FICHIER_COMPETENCE);
  let texte: string;
  try {
    texte = fs.readFileSync(fichier, 'utf8');
  } catch (err) {
    return { ok: false, raisons: [`fiche « ${nom} » illisible : ${(err as Error).message}`] };
  }
  const lignes = texte.split(/\r?\n/);
  if (lignes[0]?.trim() !== '---') {
    return { ok: false, raisons: [`la fiche « ${nom} » n'a pas d'en-tête : impossible d'y poser un état`] };
  }
  const fin = lignes.findIndex((ligne, i) => i > 0 && ligne.trim() === '---');
  if (fin < 0) return { ok: false, raisons: [`en-tête de « ${nom} » jamais refermé`] };
  const dansLEntete = lignes.slice(1, fin);
  const rang = dansLEntete.findIndex((ligne) => /^(etat|état)\s*:/i.test(ligne));
  if (rang >= 0) dansLEntete[rang] = `etat: ${etat}`;
  else dansLEntete.push(`etat: ${etat}`);

  const reecrit = ['---', ...dansLEntete, ...lignes.slice(fin)].join('\n');
  try {
    fs.writeFileSync(fichier, reecrit, 'utf8');
  } catch (err) {
    return { ok: false, raisons: [`écriture impossible : ${(err as Error).message}`] };
  }
  reecrireLesFichiersDEntree(racine);
  enregistrerLePool(racine, `passe la compétence « ${nom} » en ${etat}`);
  return { ok: true, geste: 'completee', nom, chemin: fichier };
}

/**
 * LES DEUX FICHIERS D'ENTRÉE, RÉÉCRITS. Ils sont ÉCRITS par le démon à chaque
 * changement du pool : les tenir à la main, c'est les voir mentir au premier
 * ajout.
 */
export function reecrireLesFichiersDEntree(racine = dossierDesCompetences()): void {
  try {
    const { fiches } = lirePool(racine);
    const servies = fiches.filter((fiche) => ficheEnService(fiche.etat));
    const quand = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(racine, FICHIER_SOMMAIRE),
      texteDuSommaireDesCompetences(grouperParTheme(servies), quand),
      'utf8',
    );
    fs.writeFileSync(path.join(racine, FICHIER_INDEX_SYMPTOMES), texteDeLIndexDesSymptomes(servies), 'utf8');
  } catch (err) {
    log.warn(`fichiers d'entrée du pool non réécrits : ${(err as Error).message}`);
  }
}

/* ------------------------------------------------------------------ */
/* CE QUE L'ÉCRAN MONTRE                                                */
/* ------------------------------------------------------------------ */

/**
 * LE POOL TEL QU'IL S'AFFICHE : l'arbre, l'état, la confiance et l'usage de
 * chaque fiche, plus ce qui a été ÉCARTÉ avec sa raison. Les fiches ARCHIVÉES y
 * sont, elles aussi : c'est justement l'écran où on les retrouve.
 */
export function etatDuPoolPourLEcran(racine = dossierDesCompetences()): EtatDuPool {
  const { fiches, refus } = lirePool(racine);
  const compteurs = tousLesCompteurs();
  const dates = datesDuPool(racine);
  return {
    dossier: racine,
    versionne: fs.existsSync(path.join(racine, '.git')),
    refus: refus.map((entree) => ({ nom: entree.nom, raison: raisonDuRefus(entree) })),
    fiches: fiches.map((fiche) => {
      const compte = compteurs.get(fiche.nom) ?? { ...COMPTEURS_VIDES };
      return {
        nom: fiche.nom,
        description: fiche.description,
        etat: fiche.etat,
        themes: fiche.themes,
        symptomes: fiche.symptomes,
        projets: fiche.projets,
        annexes: fiche.annexes,
        anomalies: fiche.anomalies,
        confiance: confianceDeLaFiche(compte, confianceInitialeDeLaFiche(fiche)),
        servie: compte.servie,
        aidee: compte.aidee,
        inutile: compte.inutile,
        contredite: compte.contredite,
        dernierService: compte.dernierService,
        provenanceProjet: fiche.provenance.projet,
        provenanceCarte: fiche.provenance.carte,
        renforceePar: fiche.provenance.renforceePar ?? [],
        creeeLe: fiche.provenance.creeeLe ?? dates.get(fiche.nom)?.premier,
        misAJourLe: dateDeMiseAJour(racine, fiche.nom, dates.get(fiche.nom)),
      };
    }),
  };
}

/**
 * LES DATES DE TOUTES LES FICHES, EN UN SEUL APPEL À GIT, gardées tant que le
 * dernier enregistrement du pool ne bouge pas : rouvrir l'écran ne relance
 * rien. Un pool sans git (ou git en panne) rend une table vide — la date de
 * mise à jour retombe alors sur celle du fichier.
 */
let cacheDesDates: { racine: string; tete: string; dates: Map<string, DatesDeFiche> } | null = null;

function datesDuPool(racine: string): Map<string, DatesDeFiche> {
  if (!fs.existsSync(path.join(racine, '.git'))) return new Map();
  try {
    const tete = git(racine, ['rev-parse', 'HEAD']);
    if (cacheDesDates && cacheDesDates.racine === racine && cacheDesDates.tete === tete) return cacheDesDates.dates;
    const journal = git(racine, ['-c', 'core.quotepath=off', 'log', '--format=@@%ct', '--name-only']);
    const dates = datesDesFichesDepuisGit(journal);
    cacheDesDates = { racine, tete, dates };
    return dates;
  } catch {
    return new Map();
  }
}

/**
 * LA DERNIÈRE MISE À JOUR DU MODE D'EMPLOI. L'histoire git d'abord ; mais une
 * fiche qui est un LIEN vers le dossier tenu par l'utilisateur n'a dans git que
 * le lien lui-même : c'est alors la date du `SKILL.md` visé qui dit vrai. Même
 * repli quand git n'a rien.
 */
function dateDeMiseAJour(racine: string, nom: string, dates: DatesDeFiche | undefined): number | undefined {
  const dossier = path.join(racine, nom);
  let lien = false;
  try {
    lien = fs.lstatSync(dossier).isSymbolicLink();
  } catch {
    return dates?.dernier;
  }
  if (dates && !lien) return dates.dernier;
  try {
    return Math.round(fs.statSync(path.join(dossier, FICHIER_COMPETENCE)).mtimeMs);
  } catch {
    return dates?.dernier;
  }
}

/* ------------------------------------------------------------------ */
/* LA SAUVEGARDE DU POOL                                                */
/* ------------------------------------------------------------------ */

function git(racine: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: racine,
    encoding: 'utf8',
    // Langue NEUTRE : c'est au MESSAGE qu'on reconnaît une panne de git.
    env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * LE POOL EST SON PROPRE DÉPÔT GIT. `data/` est écarté du dépôt de Beluga Build —
 * le pool était donc hors sauvegarde, alors qu'il devient la mémoire commune de
 * tous les projets. Un dépôt à lui, dans son dossier, règle les deux : rien ne
 * remonte dans le dépôt du projet, et rien n'est perdu.
 *
 * Le POUSSER reste un geste de l'utilisateur : on n'invente pas un dépôt
 * distant, et publier n'appartient pas au démon.
 */
export function preparerLeDepotDuPool(racine = dossierDesCompetences()): { ok: boolean; raison?: string } {
  try {
    fs.mkdirSync(racine, { recursive: true });
    if (!fs.existsSync(path.join(racine, '.git'))) {
      git(racine, ['init', '--initial-branch=main']);
      log.info(`pool de compétences : dépôt git créé dans ${racine}`);
    }
    // Les liens vers le coffre personnel sont enregistrés TELS QUELS (git suit
    // un lien symbolique comme un lien, pas comme son contenu) : le dépôt garde
    // la structure du pool sans recopier le dossier personnel de l'utilisateur.
    return { ok: true };
  } catch (err) {
    return { ok: false, raison: (err as Error).message };
  }
}

/**
 * ENREGISTRER LE POOL après une écriture. Silencieux si rien n'a changé, et
 * jamais bloquant : une panne de git ne doit pas faire échouer l'écriture d'une
 * fiche — le fichier, lui, est déjà sur le disque.
 */
export function enregistrerLePool(racine = dossierDesCompetences(), message = 'met à jour le pool'): void {
  try {
    if (!fs.existsSync(path.join(racine, '.git'))) {
      const prepare = preparerLeDepotDuPool(racine);
      if (!prepare.ok) return;
    }
    git(racine, ['add', '-A']);
    const enAttente = git(racine, ['status', '--porcelain']);
    if (!enAttente) return;
    git(racine, ['-c', 'user.name=Beluga Build', '-c', 'user.email=beluga@local', 'commit', '-m', message]);
  } catch (err) {
    log.warn(`pool de compétences non enregistré : ${(err as Error).message}`);
  }
}
