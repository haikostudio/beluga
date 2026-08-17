/**
 * LA PREUVE QU'UNE CARTE A TENU — et le CYCLE qu'elle suit ensuite.
 *
 * Le pool n'apprend que de travail PROUVÉ. « Sept jours sans correctif » n'est
 * pas une preuve : c'est une absence de nouvelle, et une carte jamais mise en
 * ligne n'a rien à prouver du tout. On exige donc TROIS VOLETS, ensemble :
 *
 *   1. les CONTRÔLES du projet ont été rejoués et RÉUSSIS sur cette carte —
 *      c'est l'étape de contrôles de sa publication qui le dit, pas l'agent ;
 *   2. la carte est passée EN PRODUCTION — elle sert vraiment à quelqu'un ;
 *   3. SEPT JOURS ont passé sans qu'une autre carte la contredise
 *      (`shared/src/contradiction-cartes.ts`).
 *
 * La barre d'état de l'application installable échoue au premier volet, et c'est
 * VOULU : c'est l'exemple donné par l'utilisateur de ce qu'il ne faut pas
 * capitaliser.
 *
 * TROIS ÉTATS, et chacun DIT pourquoi il s'arrête là — c'est la réponse à
 * « pourquoi cette carte n'a rien donné ? », qu'aucun écran ne pouvait donner
 * avant. Rien ici ne touche la base : les faits sont RELEVÉS par le démon
 * (`server/src/capitalisation.ts`), jugés ici.
 */

/** Le délai sans contradiction qui fait mûrir une carte. */
export const DELAI_MATURITE_MS = 7 * 24 * 60 * 60 * 1000;

/** Les faits relevés sur une carte, tous constatés — aucun n'est déclaré par l'agent. */
export interface FaitsDeCarte {
  /** Les contrôles du projet ont été rejoués ET réussis (étape de publication). */
  controlesReussis: boolean;
  /** La carte est passée en production, et quand. */
  enProductionDepuis?: number;
  /** Une carte postérieure la contredit (voir `contradiction-cartes.ts`). */
  contrediteLe?: number;
  /** Le titre de la carte qui la contredit, pour le dire en clair. */
  contreditePar?: string;
  /** Une fiche est déjà née de cette carte. */
  ficheNee?: string;
  /** La carte a été forcée à la main : l'ATTENTE saute, jamais les contrôles. */
  forcee?: boolean;
}

/** Où en est une carte dans le chemin qui mène à une fiche. */
export type EtatDeCapitalisation = 'sans-preuve' | 'candidate' | 'mure' | 'publiee';

export interface JugementDeCapitalisation {
  etat: EtatDeCapitalisation;
  /** Pourquoi elle en est là — lisible sur la carte, jamais deviné. */
  raison: string;
  /** Ce qu'il resterait à attendre, en millisecondes (0 si rien). */
  resteAAttendreMs: number;
}

/**
 * L'ÉTAT D'UNE CARTE, à un instant donné. `maintenant` est passé en argument :
 * une règle qui lit l'horloge ne se teste pas.
 */
export function etatDeCapitalisation(faits: FaitsDeCarte, maintenant: number): JugementDeCapitalisation {
  if (faits.ficheNee) {
    return {
      etat: 'publiee',
      raison: `une compétence est née de cette carte : « ${faits.ficheNee} »`,
      resteAAttendreMs: 0,
    };
  }
  if (!faits.controlesReussis) {
    return {
      etat: 'sans-preuve',
      raison:
        'les contrôles du projet n’ont pas été rejoués et réussis sur cette carte : rien ne prouve que le travail tient',
      resteAAttendreMs: 0,
    };
  }
  if (!faits.enProductionDepuis) {
    return {
      etat: 'candidate',
      raison: 'les contrôles sont passés, mais la carte n’est jamais allée en production',
      resteAAttendreMs: 0,
    };
  }
  if (faits.contrediteLe) {
    return {
      etat: 'candidate',
      raison: faits.contreditePar
        ? `une carte postérieure la contredit : « ${faits.contreditePar} »`
        : 'une carte postérieure la contredit',
      resteAAttendreMs: 0,
    };
  }
  const ecoule = maintenant - faits.enProductionDepuis;
  if (faits.forcee) {
    return {
      etat: 'mure',
      raison: 'capitalisation forcée à la main : l’attente est sautée, les contrôles ne le sont pas',
      resteAAttendreMs: 0,
    };
  }
  if (ecoule < DELAI_MATURITE_MS) {
    return {
      etat: 'candidate',
      raison: `en production depuis ${Math.floor(ecoule / (24 * 60 * 60 * 1000))} jour(s) : il en faut sept sans contradiction`,
      resteAAttendreMs: DELAI_MATURITE_MS - ecoule,
    };
  }
  return {
    etat: 'mure',
    raison: 'contrôles réussis, passée en production, sept jours sans contradiction',
    resteAAttendreMs: 0,
  };
}

/**
 * UNE FICHE FORCÉE NAÎT EN CONFIANCE BASSE. Le forçage saute l'ATTENTE, jamais
 * les contrôles de qualité ni la preuve des contrôles du projet : la fiche
 * existe tout de suite, mais elle ne se comporte pas comme une fiche mûre tant
 * que la preuve n'est pas complète.
 */
export const CONFIANCE_FORCEE = 0.35;

/** La confiance de départ d'une fiche née d'une carte réellement mûre. */
export const CONFIANCE_MURE = 0.6;

export function confianceDeDepart(faits: FaitsDeCarte): number {
  return faits.forcee ? CONFIANCE_FORCEE : CONFIANCE_MURE;
}

/**
 * COMBIEN DE CARTES LA NUIT RELIT AU PLUS. Le passage de nuit n'est pas un
 * inventaire : trois leçons vraies valent mieux que vingt fiches vagues, et
 * c'est le même plafond que les propositions du rendez-vous d'amélioration.
 */
export const CARTES_PAR_NUIT_MAX = 8;

/** Les fiches écrites en une nuit, au plus : le pool grossit lentement, exprès. */
export const FICHES_PAR_NUIT_MAX = 3;

/**
 * LA CONSIGNE DU PASSAGE DE CAPITALISATION. Un agent d'ANALYSE : il ne modifie
 * aucun code, il n'a qu'une sortie — l'outil d'écriture du pool — et il doit
 * TRIER : une leçon qui ne vaut que pour un projet n'a rien à faire dans un pool
 * partagé.
 */
export function consigneDeCapitalisation(cartes: { titre: string; projet: string; id: string }[]): string {
  const liste = cartes.map((c) => `- [${c.projet} · ${c.id}] ${c.titre}`).join('\n');
  return (
    `TU RELIS DES TÂCHES QUI ONT FAIT LEURS PREUVES, ET TU EN TIRES DES COMPÉTENCES PARTAGÉES.\n\n` +
    `Ces cartes ont toutes passé les trois volets : contrôles du projet rejoués et réussis, passage en ` +
    `production, et sept jours sans qu'une autre carte les contredise.\n\n${liste}\n\n` +
    `POUR CHACUNE, TRANCHE UNE SEULE QUESTION : la leçon vient-elle de la PLATEFORME (un piège de navigateur, ` +
    `d'outil, de service, de bibliothèque — vrai partout) ou du seul CODE DE CE PROJET (vrai nulle part ailleurs) ? ` +
    `Seule la première se capitalise. Dans le doute, ne capitalise pas.\n\n` +
    `ENSUITE, pour les leçons retenues (${FICHES_PAR_NUIT_MAX} au plus) : appelle l'outil « competences » avec ` +
    `action « ecrire ». Si une fiche proche existe déjà, COMPLÈTE-LA (même nom) au lieu d'en créer une deuxième — ` +
    `sa provenance d'origine est gardée et la carte s'ajoute à celles qui l'ont renforcée.\n\n` +
    `UNE FICHE UTILE DIT : le SYMPTÔME qu'on constate, la CAUSE, la PROCÉDURE pas à pas, la VÉRIFICATION qui ` +
    `prouve que ça marche (obligatoire), les PIÈGES, et ce qui NE MARCHE PAS. La description doit dire QUAND s'en ` +
    `servir : c'est elle qui déclenche la fiche.\n\n` +
    `TU N'ÉCRIS AUCUN CODE et tu ne touches à aucun projet. Ta seule sortie est cet outil.`
  );
}

/** Le titre de l'agent de la nuit, visible dans la pile d'agents. */
export const TITRE_CAPITALISATION = 'Capitalisation des tâches prouvées';
