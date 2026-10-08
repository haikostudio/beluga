/*
 * LA COPIE DE TEST D'UN PROJET ET SON REGISTRE DE PRODUCTION — les règles pures.
 *
 * Un projet qui a une copie de test (InVia : /var/www/invia) et un vrai site
 * ailleurs suit une convention de dépôt (`production/README.md` du projet) :
 *
 * - chaque carte qui change la copie note son changement dans
 *   `production/a-rejouer/<AAAAMMJJ-HHMM-sujet>.sh` ;
 * - la mise en production rejoue ces entrées sur le vrai site, puis note leur
 *   nom dans une liste « appliquées » (la vérité sur le site, un reflet dans le
 *   dossier git du projet, hors versionnement) ;
 * - `production/rafraichir-copie-de-test.sh` recopie le vrai site vers la copie.
 *
 * Le bouton « Rafraîchir la copie de test » n'existe que si ce script est sur la
 * branche de travail, et il est BLOQUÉ tant qu'une entrée attend : la copie
 * porte encore ce changement, le vrai site pas — on le perdrait.
 */

/** Le dossier du registre, dans le dépôt du projet. */
export const REGISTRE_DE_PRODUCTION = 'production/a-rejouer';
/** Le script qui recopie le vrai site vers la copie de test. */
export const SCRIPT_DE_RAFRAICHISSEMENT = 'production/rafraichir-copie-de-test.sh';
/** Le reflet local de ce qui est en ligne, dans le dossier git commun du projet. */
export const FICHIER_DES_APPLIQUEES = 'beluga-production-appliques.txt';

/** Ce que le tiroir de mise en production sait de la copie de test du projet. */
export interface EtatDeLaCopieDeTest {
  /** Le projet suit la convention (le script de rafraîchissement est sur sa branche de travail). */
  disponible: boolean;
  /** Les entrées pas encore rejouées en ligne (branche de travail et branches de cartes). */
  enAttente: string[];
  /** Un rafraîchissement tourne. */
  enCours: boolean;
  /** Le dernier rafraîchissement : son issue et ses dernières lignes. */
  derniere?: { ok: boolean; texte: string; finiLe: number };
}

/** Pourquoi le bouton est éteint, ou `null` s'il peut partir. */
export type RaisonCopieBloquee = 'indisponible' | 'en-cours' | 'en-attente' | null;

/**
 * LES ENTRÉES QUI ATTENDENT LEUR MISE EN PRODUCTION : celles d'une branche
 * vivante (travail ou carte), sans doublon, dans l'ordre de leur nom — qui est
 * l'ordre du rejeu —, moins celles déjà notées en ligne.
 */
export function entreesEnAttente(cheminsParBranche: readonly (readonly string[])[], appliquees: readonly string[]): string[] {
  const faites = new Set(appliquees.map((ligne) => ligne.trim()).filter(Boolean));
  const noms = new Set<string>();
  for (const chemins of cheminsParBranche) {
    for (const chemin of chemins) {
      const nom = chemin.trim().split('/').pop() ?? '';
      if (nom.endsWith('.sh') && !faites.has(nom)) noms.add(nom);
    }
  }
  return [...noms].sort();
}

/** Le bouton « Rafraîchir la copie de test » peut-il partir ? */
export function raisonCopieBloquee(etat: EtatDeLaCopieDeTest | null | undefined): RaisonCopieBloquee {
  if (!etat?.disponible) return 'indisponible';
  if (etat.enCours) return 'en-cours';
  if (etat.enAttente.length) return 'en-attente';
  return null;
}
