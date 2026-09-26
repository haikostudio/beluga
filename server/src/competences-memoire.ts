import fs from 'node:fs';
import {
  GENRE_SOURCE_COMPETENCE,
  PORTEE_DES_COMPETENCES,
  gesteDeSynchro,
  nomDeCompetenceDeLUnite,
  propositionDeLaCompetence,
  uniteAJour,
  type Competence,
  type Unite,
} from '@beluga/shared';
import { changerLEtat, confianceMesureeDeLaFiche, dossierDesCompetences, lirePool, relierCompetencesAuxCoffres } from './competences.js';
import { deprecierEnFaveurDe, proposerUnite, quandUneUniteEstDepreciee, unitesDeLaSource } from './connaissances.js';
import { log } from './logger.js';

/**
 * LES COMPÉTENCES DANS LA MÉMOIRE — le pool (`data/competences/`) reflété dans
 * la base de connaissances, une unité « operation » du classeur GLOBAL par
 * fiche (règle de conversion : `shared/src/unite-competence.ts`).
 *
 * LE DISQUE FAIT FOI POUR LE MODE D'EMPLOI, LA BASE POUR LA RECHERCHE. La
 * synchronisation va toujours du pool vers la base, et passe par la porte
 * d'écriture UNIQUE (`proposerUnite`) : jamais une ligne SQL écrite à côté.
 * Elle est IDEMPOTENTE — une unité qui dit déjà ce que la fiche dit n'est pas
 * réécrite, et l'unité d'une fiche se retrouve par sa SOURCE (genre
 * « competence », `ref` = le nom), jamais par son titre.
 *
 * UN SEUL CHEMIN EN SENS INVERSE : déprécier l'unité d'une compétence (à
 * l'écran Mémoire, ou par l'outil « memoire ») la RETIRE DU SERVICE — la fiche
 * passe « archivée » sur le disque, et les coffres suivent. La synchronisation
 * elle-même signe ses dépréciations (`AUTEUR_SYNCHRO`) : l'écouteur les
 * reconnaît et ne rejoue rien, donc pas de boucle.
 */

export const AUTEUR_SYNCHRO = 'pool-de-competences';

export interface BilanDeSynchro {
  creees: string[];
  misesAJour: string[];
  depreciees: string[];
  inchangees: string[];
  refusees: { nom: string; raisons: string[] }[];
}

function texteDuSkill(fiche: Competence): string {
  try {
    return fs.readFileSync(fiche.fichier, 'utf8');
  } catch {
    return '';
  }
}

/**
 * REFLÉTER LE POOL DANS LA BASE. `noms` restreint le passage à quelques fiches
 * (après l'écriture ou le retour d'une seule) ; sans lui, tout le pool passe,
 * et les unités dont la fiche a DISPARU sont dépréciées.
 */
export function synchroniserCompetencesVersLaBase(options: { racine?: string; noms?: readonly string[] } = {}): BilanDeSynchro {
  const bilan: BilanDeSynchro = { creees: [], misesAJour: [], depreciees: [], inchangees: [], refusees: [] };
  const { fiches } = lirePool(options.racine ?? dossierDesCompetences());
  const parNom = new Map(fiches.map((f) => [f.nom, f]));

  // Les unités de compétence déjà en base, groupées par fiche (la plus vivante d'abord).
  const parRef = new Map<string, Unite[]>();
  for (const unite of unitesDeLaSource(PORTEE_DES_COMPETENCES, GENRE_SOURCE_COMPETENCE)) {
    const nom = nomDeCompetenceDeLUnite(unite);
    if (!nom) continue;
    parRef.set(nom, [...(parRef.get(nom) ?? []), unite]);
  }

  const noms = options.noms ? [...new Set(options.noms)] : [...new Set([...parNom.keys(), ...parRef.keys()])];
  const contexte = { auteur: AUTEUR_SYNCHRO, sansQuatreQuestions: true, confianceMesuree: true } as const;

  for (const nom of noms) {
    const fiche = parNom.get(nom);
    const [unite, ...enTrop] = parRef.get(nom) ?? [];

    // Deux unités actives pour une même fiche : la plus récente reste, l'autre lui cède la place.
    for (const doublon of enTrop) {
      if (unite && doublon.statut === 'active') deprecierEnFaveurDe(doublon.id, unite.id, AUTEUR_SYNCHRO, `même compétence « ${nom} »`);
    }

    const geste = gesteDeSynchro(fiche, unite);
    if (geste === 'rien') continue;
    if (geste === 'deprecier') {
      const r = proposerUnite(
        PORTEE_DES_COMPETENCES,
        { action: 'deprecate', id: unite!.id, raisonnement: fiche ? 'compétence archivée dans le pool' : 'compétence disparue du pool' },
        { ...contexte, motif: fiche ? 'compétence archivée' : 'compétence disparue du pool' },
      );
      if (r.ok && r.geste === 'deprecie') bilan.depreciees.push(nom);
      continue;
    }

    const p = propositionDeLaCompetence(fiche!, texteDuSkill(fiche!), {
      confiance: confianceMesureeDeLaFiche(fiche!),
      id: unite?.id,
    });
    if (unite && uniteAJour(unite, p)) {
      bilan.inchangees.push(nom);
      continue;
    }
    const r = proposerUnite(PORTEE_DES_COMPETENCES, p, { ...contexte, motif: unite ? 'compétence mise à jour dans le pool' : 'compétence entrée dans la mémoire' });
    if (!r.ok) {
      bilan.refusees.push({ nom, raisons: r.raisons });
      continue;
    }
    if (unite) bilan.misesAJour.push(nom);
    else bilan.creees.push(nom);
  }

  const bouge = bilan.creees.length + bilan.misesAJour.length + bilan.depreciees.length;
  if (bouge) {
    log.info(
      `compétences → mémoire : ${bilan.creees.length} entrée(s), ${bilan.misesAJour.length} mise(s) à jour, ${bilan.depreciees.length} dépréciée(s)`,
    );
  }
  for (const refus of bilan.refusees) log.warn(`compétence « ${refus.nom} » refusée par la mémoire : ${refus.raisons.join(' ; ')}`);
  return bilan;
}

/** La synchronisation, sans jamais faire échouer l'appelant : un tour d'agent ne tombe pas pour la mémoire. */
export function synchroniserSansEchec(noms?: readonly string[]): BilanDeSynchro | null {
  try {
    return synchroniserCompetencesVersLaBase({ noms });
  } catch (err) {
    log.warn(`compétences → mémoire en panne : ${(err as Error).message}`);
    return null;
  }
}

/**
 * L'UNITÉ D'UNE COMPÉTENCE DÉPRÉCIÉE PAR QUELQU'UN D'AUTRE QUE LA SYNCHRO : la
 * fiche sort du service (« archivée » — rien ne s'efface), et les coffres des
 * comptes suivent. Rend vrai si la fiche a été archivée.
 */
export function suivreLaDepreciation(unite: Unite, auteur: string, racine = dossierDesCompetences()): boolean {
  if (auteur === AUTEUR_SYNCHRO) return false;
  const nom = nomDeCompetenceDeLUnite(unite);
  if (!nom) return false;
  const fiche = lirePool(racine).fiches.find((f) => f.nom === nom);
  if (!fiche || fiche.etat === 'archivee') return false;
  const r = changerLEtat(dossierDeLaFiche(fiche), 'archivee', racine);
  if (!r.ok) {
    log.warn(`compétence « ${nom} » non archivée après la dépréciation de ${unite.id} : ${(r.raisons ?? []).join(' ; ')}`);
    return false;
  }
  log.info(`compétence « ${nom} » archivée : son unité ${unite.id} a été dépréciée par ${auteur}`);
  return true;
}

/** Le nom de DOSSIER d'une fiche (celui que `changerLEtat` attend) — il peut différer du `name` déclaré. */
function dossierDeLaFiche(fiche: Competence): string {
  return fiche.dossier.split(/[\\/]/).filter(Boolean).pop() ?? fiche.nom;
}

let branche: (() => void) | null = null;
let minuterie: NodeJS.Timeout | null = null;

/** Tant de temps entre deux passages de fond : une fiche retouchée à la main dans le coffre finit par entrer. */
const INTERVALLE_DE_SYNCHRO_MS = 30 * 60_000;

/**
 * AU DÉMARRAGE DU DÉMON : l'écouteur des dépréciations, un premier passage
 * complet, puis un passage de fond toutes les trente minutes.
 */
export function brancherLesCompetencesSurLaMemoire(): void {
  if (!branche) {
    branche = quandUneUniteEstDepreciee((unite, contexte) => {
      if (suivreLaDepreciation(unite, contexte.auteur)) relierCompetencesAuxCoffres();
    });
  }
  synchroniserSansEchec();
  if (!minuterie) {
    minuterie = setInterval(() => synchroniserSansEchec(), INTERVALLE_DE_SYNCHRO_MS);
    minuterie.unref?.();
  }
}
