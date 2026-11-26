/**
 * LES AGENTS PERSONNALISÉS D'UN PROJET — les règles pures (carte « Agents personnalisés dans les projets »,
 * 24/11/2026).
 *
 * Un agent personnalisé se CRÉE EN LUI PARLANT : la conversation remplit sa FICHE, rubrique par rubrique, et il ne
 * travaille seul qu'une fois ALLUMÉ par l'utilisateur. Ce module dit, sans base ni disque :
 *
 *  - ce qu'est une fiche (huit rubriques) et quand elle est COMPLÈTE ;
 *  - les GESTES JAMAIS PERMIS : publier, mettre en ligne, envoyer à un client, payer, lancer une carte, modifier le
 *    code, supprimer. Ils sont VERROUILLÉS : ni l'agent ni l'utilisateur ne peuvent les inscrire dans « ce qu'il fait
 *    seul » (règle P0 « rien ne se publie ni ne s'exécute sans geste explicite ») ;
 *  - le PROCHAIN PASSAGE d'un déclencheur horaire, recalculé depuis le dernier passage — jamais un minuteur long, qui
 *    sauterait au moindre redémarrage ;
 *  - la LIMITE de passages par période, et l'état « en pause » qu'elle impose ;
 *  - l'ÉTAT affiché d'une ligne du tableau ;
 *  - le POINT DU MATIN : ce qui s'est passé depuis la veille au soir, cité depuis le journal.
 *
 * Surfaces (méthode « harness engineering ») : les gestes jamais permis et la limite sont VERROUILLÉS (l'agent ne
 * peut pas les relâcher seul) ; la fiche ne s'écrit que sur accord de l'utilisateur ; le JOURNAL ne fait que
 * s'allonger ; publier, envoyer, payer et donner un accès restent des gestes humains. L'état vit HORS du fil
 * (fiche + journal), et chaque passage reçoit un relais complet au lieu de l'historique de la conversation.
 */
import { debutDuJour, decalageFuseau, jourDeSemaineLocal, jourLocal } from './fuseau.js';
import { REGLE_DE_LA_VALIDATION } from './validation-de-geste.js';
import type { OutilDAgent, RoleDEquipier } from './equipe-d-agents.js';

/** L'étiquette posée sur la carte d'un agent personnalisé : elle en fait un agent de volet (`agent-de-volet.ts`). */
export const LABEL_AGENT_PERSO = 'agent-perso';

/** Le nom d'un agent qui vient de naître, tant que la conversation ne lui en a pas donné. */
export const NOM_D_UN_NOUVEL_AGENT = 'Nouvel agent';

/* ------------------------------------------------------------------ */
/* Les déclencheurs                                                    */
/* ------------------------------------------------------------------ */

/** Les événements des services de Beluga qui peuvent réveiller un agent. */
export const SOURCES_D_EVENEMENT = [
  'messagerie.demande',
  'surveillance.panne',
  'publication.terminee',
  'referencement.audit',
  'backup.echec',
  'securite.alerte',
] as const;
export type SourceDEvenement = (typeof SOURCES_D_EVENEMENT)[number];

/** Le nom court de chaque événement (traduit à l'affichage). */
export const LIBELLE_DE_SOURCE: Readonly<Record<SourceDEvenement, string>> = {
  'messagerie.demande': 'À chaque nouvelle demande client',
  'surveillance.panne': 'Quand le site tombe',
  'publication.terminee': 'Après chaque mise en ligne',
  'referencement.audit': 'Après chaque audit de référencement',
  'backup.echec': 'Quand une sauvegarde échoue',
  'securite.alerte': 'Quand la sécurité signale un point grave',
};

export type RythmeHoraire = 'jour' | 'semaine' | 'mois';

/** Un passage à heure fixe : chaque jour, certains jours de la semaine, ou un jour du mois. */
export interface DeclencheurHoraire {
  genre: 'horaire';
  rythme: RythmeHoraire;
  /** « 08:00 », dans le fuseau du produit. */
  heure: string;
  /** Pour « semaine » : les jours (dimanche = 0 … samedi = 6). Vide ou absent : lundi. */
  jours?: number[];
  /** Pour « mois » : le jour du mois (1 à 31 ; un mois plus court prend son dernier jour). */
  jourDuMois?: number;
  /** Les jours où il ne passe pas (dimanche = 0 … samedi = 6), par exemple le week-end. */
  joursExclus?: number[];
  /** Un passage qui tombe un jour exclu est REPORTÉ au premier jour permis, à la même heure (week-end → lundi). */
  report?: boolean;
}

export type Declencheur =
  | { genre: 'manuel' }
  | DeclencheurHoraire
  | { genre: 'evenement'; source: SourceDEvenement }
  /** Une surveillance que l'agent pose lui-même (format des veilles, sans secret) : sa description seule est gardée ici. */
  | { genre: 'veille'; description: string };

/* ------------------------------------------------------------------ */
/* La fiche                                                            */
/* ------------------------------------------------------------------ */

export type PeriodeDeLimite = 'jour' | 'semaine' | 'mois';
export interface LimiteDeLAgent {
  passages: number;
  periode: PeriodeDeLimite;
}

/** Ce que l'agent emporte : des compétences, des RÉFÉRENCES au coffre-fort (jamais une valeur), la mémoire du projet. */
export interface BagageDeLAgent {
  competences: string[];
  /** Les identifiants (ou noms) de fiches du coffre-fort. Une valeur secrète n'entre JAMAIS ici. */
  acces: string[];
  memoire: boolean;
}

/**
 * LA FICHE D'UN AGENT. `null` veut dire « à définir dans la conversation » ; une liste vide ou « aucune » est une
 * réponse TRANCHÉE (par exemple « il ne demande rien », « pas de limite »).
 */
export interface FicheDAgent {
  nom: string;
  mission: string;
  declencheurs: Declencheur[];
  faitSeul: string[] | null;
  demandeAccord: string[] | null;
  jamais: string[] | null;
  emporte: BagageDeLAgent | null;
  limite: LimiteDeLAgent | 'aucune' | null;
}

export const RUBRIQUES_DE_LA_FICHE = ['nom', 'mission', 'quand', 'seul', 'demande', 'jamais', 'emporte', 'limite'] as const;
export type RubriqueDeFiche = (typeof RUBRIQUES_DE_LA_FICHE)[number];

/** Le titre de chaque rubrique dans le volet (traduit à l'affichage). */
export const TITRE_DE_RUBRIQUE: Readonly<Record<RubriqueDeFiche, string>> = {
  nom: 'Nom',
  mission: 'Mission',
  quand: 'Quand il agit',
  seul: 'Ce qu’il fait seul',
  demande: 'Ce qu’il vous demande',
  jamais: 'Ce qu’il ne fait jamais',
  emporte: 'Ce qu’il emporte',
  limite: 'Sa limite',
};

export function ficheVide(): FicheDAgent {
  return { nom: NOM_D_UN_NOUVEL_AGENT, mission: '', declencheurs: [], faitSeul: null, demandeAccord: null, jamais: null, emporte: null, limite: null };
}

/** Relit une fiche venue de la base : un champ manquant ou d'une forme inattendue redevient « à définir ». */
export function ficheLue(brut: unknown): FicheDAgent {
  const f = (brut && typeof brut === 'object' ? brut : {}) as Partial<Record<keyof FicheDAgent, unknown>>;
  const liste = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
  const vide = ficheVide();
  const limite = f.limite === 'aucune' ? 'aucune' : limiteLue(f.limite);
  const emporte =
    f.emporte && typeof f.emporte === 'object'
      ? {
          competences: liste((f.emporte as BagageDeLAgent).competences) ?? [],
          acces: liste((f.emporte as BagageDeLAgent).acces) ?? [],
          memoire: (f.emporte as BagageDeLAgent).memoire === true,
        }
      : null;
  return {
    nom: typeof f.nom === 'string' && f.nom.trim() ? f.nom : vide.nom,
    mission: typeof f.mission === 'string' ? f.mission : '',
    declencheurs: Array.isArray(f.declencheurs) ? f.declencheurs.map(declencheurLu).filter((d): d is Declencheur => d !== null) : [],
    faitSeul: liste(f.faitSeul),
    demandeAccord: liste(f.demandeAccord),
    jamais: liste(f.jamais),
    emporte,
    limite,
  };
}

function limiteLue(v: unknown): LimiteDeLAgent | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Partial<LimiteDeLAgent>;
  const passages = Math.floor(Number(l.passages));
  if (!Number.isFinite(passages) || passages < 1) return null;
  const periode = l.periode === 'semaine' || l.periode === 'mois' ? l.periode : 'jour';
  return { passages: Math.min(passages, 1000), periode };
}

const HEURE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Un déclencheur lu (base, outil) : rend `null` pour une forme qu'on ne sait pas jouer. */
export function declencheurLu(v: unknown): Declencheur | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (d.genre === 'manuel') return { genre: 'manuel' };
  if (d.genre === 'evenement') {
    return SOURCES_D_EVENEMENT.includes(d.source as SourceDEvenement) ? { genre: 'evenement', source: d.source as SourceDEvenement } : null;
  }
  if (d.genre === 'veille') {
    const description = typeof d.description === 'string' ? d.description.trim() : '';
    return description ? { genre: 'veille', description: description.slice(0, 300) } : null;
  }
  if (d.genre === 'horaire') {
    const heure = typeof d.heure === 'string' && HEURE.test(d.heure.trim()) ? d.heure.trim().padStart(5, '0') : null;
    if (!heure) return null;
    const rythme: RythmeHoraire = d.rythme === 'semaine' || d.rythme === 'mois' ? d.rythme : 'jour';
    const jours = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : undefined);
    const horaire: DeclencheurHoraire = { genre: 'horaire', rythme, heure };
    const semaine = jours(d.jours);
    if (rythme === 'semaine' && semaine?.length) horaire.jours = semaine;
    if (rythme === 'mois') {
      const jour = Math.floor(Number(d.jourDuMois));
      horaire.jourDuMois = Number.isFinite(jour) ? Math.min(31, Math.max(1, jour)) : 1;
    }
    const exclus = jours(d.joursExclus);
    if (exclus?.length && exclus.length < 7) horaire.joursExclus = exclus;
    if (horaire.joursExclus && d.report === true) horaire.report = true;
    return horaire;
  }
  return null;
}

/** Les rubriques déjà remplies ou tranchées. */
export function rubriquesRemplies(fiche: FicheDAgent): RubriqueDeFiche[] {
  const remplie: Record<RubriqueDeFiche, boolean> = {
    nom: !!fiche.nom.trim() && fiche.nom.trim() !== NOM_D_UN_NOUVEL_AGENT,
    mission: !!fiche.mission.trim(),
    quand: fiche.declencheurs.length > 0,
    seul: fiche.faitSeul !== null,
    demande: fiche.demandeAccord !== null,
    jamais: fiche.jamais !== null,
    emporte: fiche.emporte !== null,
    limite: fiche.limite !== null,
  };
  return RUBRIQUES_DE_LA_FICHE.filter((r) => remplie[r]);
}

/** « n sur 8 » : où en est la fiche. */
export function completionDeLaFiche(fiche: FicheDAgent): { remplies: number; total: number } {
  return { remplies: rubriquesRemplies(fiche).length, total: RUBRIQUES_DE_LA_FICHE.length };
}

/** La fiche est complète : « Allumer l'agent » peut s'allumer. */
export function ficheComplete(fiche: FicheDAgent): boolean {
  return rubriquesRemplies(fiche).length === RUBRIQUES_DE_LA_FICHE.length;
}

/* ------------------------------------------------------------------ */
/* Les gestes jamais permis                                            */
/* ------------------------------------------------------------------ */

export const GESTES_JAMAIS_PERMIS = [
  'publier',
  'deployer',
  'mettre_en_production',
  'envoyer_au_client',
  'payer',
  'lancer_carte',
  'modifier_code',
  'supprimer',
] as const;
export type GesteJamaisPermis = (typeof GESTES_JAMAIS_PERMIS)[number];

/**
 * JAMAIS SEUL NE VEUT PLUS DIRE « JAMAIS LUI-MÊME » (26/11/2026, capture #6b90 : l'agent laissait deux clics
 * « Enregistrer » à l'utilisateur). Ces gestes-ci, l'agent les FAIT lui-même, après une validation avec capture
 * dans le fil (`shared/src/validation-de-geste.ts`).
 */
export const GESTES_A_VALIDER: readonly GesteJamaisPermis[] = ['publier', 'envoyer_au_client', 'payer', 'supprimer'];
/** Ceux-là ne se font jamais seuls depuis la fiche : l'agent n'a ni dépôt ni bouton de publication. */
export const GESTES_PAR_CARTE: readonly GesteJamaisPermis[] = ['deployer', 'mettre_en_production', 'lancer_carte', 'modifier_code'];
/**
 * DÉPLOYER ET METTRE EN PRODUCTION : LE CLIC DE L'UTILISATEUR, JAMAIS UN AGENT (carte « Beluga piloté par des agents »,
 * 26/11/2026). L'agent de déploiement prépare et contrôle ; le bouton « Déployer » fait partir la publication existante.
 */
export const GESTES_AU_CLIC: readonly GesteJamaisPermis[] = ['deployer', 'mettre_en_production'];
/**
 * LE CODE ET LES TÂCHES PASSENT PAR L'ÉQUIPE (décision de l'utilisateur du 26/11/2026, « libres entre eux, réglable agent
 * par agent ») : un agent les DEMANDE à l'agent de développement de son équipe (outil `equipe`) ; la tâche part seule
 * si celui-ci est libre avec ses collègues, sinon elle attend un clic dans « Planifié ».
 */
export const GESTES_PAR_L_EQUIPE: readonly GesteJamaisPermis[] = ['lancer_carte', 'modifier_code'];

/** Ce que chaque geste veut dire, en mots courants (montré dans le volet, traduit à l'affichage). */
export const LIBELLE_DU_GESTE: Readonly<Record<GesteJamaisPermis, string>> = {
  publier: 'Publier quoi que ce soit',
  deployer: 'Mettre en ligne',
  mettre_en_production: 'Mettre en production',
  envoyer_au_client: 'Envoyer un message à un client',
  payer: 'Payer ou acheter',
  lancer_carte: 'Lancer une tâche',
  modifier_code: 'Modifier le code',
  supprimer: 'Supprimer des données',
};

/** Préparer n'est pas faire : un brouillon, une proposition, une lecture ou une surveillance restent permis. */
const PREPARER = /^\s*(pr[ée]par\w*|r[ée]dig\w*|brouillon\w*|propos\w*|sugg[ée]r\w*|sign\w*l\w*|pr[ée]ven\w*|alert\w*|r[ée]sum\w*|not\w*|lire|li[ts]|surveill\w*|v[ée]rifi\w*|contr[ôo]l\w*|suivr\w*|suiv\w*|compt\w*|relev\w*|analys\w*)\b/i;

const MOTIFS_DES_GESTES: ReadonlyArray<readonly [GesteJamaisPermis, RegExp]> = [
  ['mettre_en_production', /\b(mettre|mise|passer)\s+en\s+production\b/i],
  ['deployer', /\b(d[ée]ploi\w*|d[ée]ploy\w*|mettre\s+en\s+ligne|mise\s+en\s+ligne|deploy\w*)\b/i],
  ['publier', /\b(publi(er|e|es|ez|ons|cation)|poster|programmer\s+(une|la|les)\s+publication)\b/i],
  ['envoyer_au_client', /\b(envoy\w*|r[ée]pond\w*|[ée]cri\w*|transmet\w*|mail\w*|courriel\w*)\b[^.;\n]*\bclients?\b/i],
  ['payer', /\b(pay\w*|paie\w*|acheter|achat\w*|r[ée]gler\s+(la|une|les)\s+factures?|commander)\b/i],
  ['lancer_carte', /\blancer\b[^.;\n]*\b(carte|t[âa]che)s?\b/i],
  ['modifier_code', /\b(modifi\w*|chang\w*|corrig\w*|[ée]cri\w*|touch\w*)\b[^.;\n]*\bcode\b|\b(coder|programmer|commit\w*|pousser\s+(le|la|une)\s+branche|git\s+push)\b/i],
  ['supprimer', /\b(supprim\w*|effac\w*|d[ée]truir\w*|vider\s+(la|une)\s+base)\b/i],
];

/**
 * Ce texte décrit-il un geste jamais permis, à faire SEUL ? Rend le geste, ou `null`. « Préparer une réponse au client »
 * ou « proposer une carte » restent permis : seuls l'envoi, la mise en ligne, le paiement… sont verrouillés.
 */
export function gesteInterditDans(texte: string): GesteJamaisPermis | null {
  const propre = (texte ?? '').trim();
  if (!propre) return null;
  // CHAQUE ACTION À PART : « Vérifier puis publier » cache une publication derrière une vérification.
  const actions = propre.split(/\s*(?:,|;|\bpuis\b|\bensuite\b|\bet\b|\bavant de\b|\bapr[èe]s\b)\s*/i).filter(Boolean);
  for (const action of actions) {
    // « Préparer une réponse au client », « Surveiller la mise en ligne », « Proposer une carte pour corriger le code ».
    if (PREPARER.test(action)) continue;
    for (const [geste, motif] of MOTIFS_DES_GESTES) if (motif.test(action)) return geste;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Le journal                                                          */
/* ------------------------------------------------------------------ */

/** Ce qui a déclenché une ligne du journal. */
export type GenreDeLigne = 'creation' | 'allumage' | 'extinction' | 'manuel' | 'horaire' | 'evenement' | 'veille' | 'collegue' | 'limite' | 'refus';
/** Comment le passage s'est terminé. */
export type IssueDeLigne = 'en_cours' | 'fait' | 'a_valider' | 'panne' | 'pause' | 'ignore' | 'note';

export interface LigneDeJournal {
  id: string;
  agentPersoId: string;
  date: number;
  genre: GenreDeLigne;
  /** La source d'un événement (`messagerie.demande`…), quand le genre est « evenement ». */
  source?: SourceDEvenement;
  resume: string;
  issue: IssueDeLigne;
  /** Les jetons du passage, quand le moteur les a dits. */
  jetons?: number;
}

/** Une ligne qui COMPTE comme un passage (dans la limite et le point du matin). */
export function estUnPassage(ligne: Pick<LigneDeJournal, 'genre' | 'issue'>): boolean {
  return (
    (ligne.genre === 'manuel' || ligne.genre === 'horaire' || ligne.genre === 'evenement' || ligne.genre === 'veille' || ligne.genre === 'collegue') &&
    ligne.issue !== 'ignore'
  );
}

/* ------------------------------------------------------------------ */
/* La limite                                                           */
/* ------------------------------------------------------------------ */

/** Le début de la période en cours (jour, semaine depuis lundi, mois), dans le fuseau du produit. */
export function debutDeLaPeriode(periode: PeriodeDeLimite, maintenant: number): number {
  const jour = jourLocal(maintenant);
  if (periode === 'jour') return debutDuJour(jour);
  if (periode === 'mois') return debutDuJour(`${jour.slice(0, 8)}01`);
  // Semaine : depuis lundi 0 h.
  const depuisLundi = (jourDeSemaineLocal(maintenant) + 6) % 7;
  return debutDuJour(jourLocal(debutDuJour(jour) - depuisLundi * 86_400_000 + 12 * 3_600_000));
}

/** Les passages comptés dans la période en cours. */
export function passagesDeLaPeriode(journal: readonly LigneDeJournal[], periode: PeriodeDeLimite, maintenant: number): number {
  const debut = debutDeLaPeriode(periode, maintenant);
  return journal.filter((l) => l.date >= debut && l.date <= maintenant && estUnPassage(l)).length;
}

/** La limite est-elle atteinte ? Aucune limite (« aucune », ou pas encore tranchée) : jamais. */
export function limiteAtteinte(journal: readonly LigneDeJournal[], limite: FicheDAgent['limite'], maintenant: number): boolean {
  if (!limite || limite === 'aucune') return false;
  return passagesDeLaPeriode(journal, limite.periode, maintenant) >= limite.passages;
}

/* ------------------------------------------------------------------ */
/* Le rythme horaire                                                   */
/* ------------------------------------------------------------------ */

const JOUR_MS = 86_400_000;

/** L'instant « jour à telle heure », dans le fuseau du produit (changement d'heure compris). */
function aLHeure(jour: string, heure: string): number {
  const [a, mo, j] = jour.split('-').map(Number);
  const [h, m] = heure.split(':').map(Number);
  const brut = Date.UTC(a ?? 1970, (mo ?? 1) - 1, j ?? 1, h ?? 0, m ?? 0);
  const premier = brut - decalageFuseau(brut);
  return brut - decalageFuseau(premier);
}

function joursDuMois(jour: string): number {
  const [a, m] = jour.split('-').map(Number);
  return new Date(Date.UTC(a!, m!, 0)).getUTCDate();
}

/** Ce jour (« 2026-11-24 ») est-il prévu par le rythme, avant toute exclusion ? */
function jourPrevu(d: DeclencheurHoraire, jour: string): boolean {
  const midi = debutDuJour(jour) + 12 * 3_600_000;
  if (d.rythme === 'jour') return true;
  if (d.rythme === 'semaine') return (d.jours?.length ? d.jours : [1]).includes(jourDeSemaineLocal(midi));
  const voulu = Math.min(d.jourDuMois ?? 1, joursDuMois(jour));
  return Number(jour.slice(8, 10)) === voulu;
}

function jourExclu(d: DeclencheurHoraire, jour: string): boolean {
  if (!d.joursExclus?.length) return false;
  return d.joursExclus.includes(jourDeSemaineLocal(debutDuJour(jour) + 12 * 3_600_000));
}

/** Le jour suivant, en jours civils du fuseau. */
function lendemain(jour: string): string {
  return jourLocal(debutDuJour(jour) + JOUR_MS + 12 * 3_600_000);
}

/** Les créneaux d'un déclencheur horaire dont le JOUR PRÉVU tombe entre deux jours (inclus), reports compris. */
function creneaux(d: DeclencheurHoraire, depuis: string, jusqua: string): number[] {
  const sortie: number[] = [];
  let jour = depuis;
  for (let i = 0; i < 80 && jour <= jusqua; i++, jour = lendemain(jour)) {
    if (!jourPrevu(d, jour)) continue;
    if (!jourExclu(d, jour)) {
      sortie.push(aLHeure(jour, d.heure));
      continue;
    }
    if (!d.report) continue;
    // REPORTÉ au premier jour permis (week-end → lundi), à la même heure.
    let suivant = lendemain(jour);
    for (let j = 0; j < 7 && jourExclu(d, suivant); j++) suivant = lendemain(suivant);
    sortie.push(aLHeure(suivant, d.heure));
  }
  return sortie;
}

/** Le dernier créneau prévu à `maintenant` ou avant (sur les quarante derniers jours), ou `null`. */
export function dernierCreneauHoraire(d: DeclencheurHoraire, maintenant: number): number | null {
  const passes = creneaux(d, jourLocal(maintenant - 40 * JOUR_MS), jourLocal(maintenant)).filter((t) => t <= maintenant);
  return passes.length ? Math.max(...passes) : null;
}

/** Le prochain créneau STRICTEMENT après `apres`, ou `null` (aucun dans les quarante jours). */
export function prochainCreneauHoraire(d: DeclencheurHoraire, apres: number): number | null {
  const futurs = creneaux(d, jourLocal(apres - 8 * JOUR_MS), jourLocal(apres + 40 * JOUR_MS)).filter((t) => t > apres);
  return futurs.length ? Math.min(...futurs) : null;
}

/**
 * UN PASSAGE HORAIRE EST-IL DÛ ? Oui quand un créneau prévu est passé APRÈS le dernier passage horaire (ou, s'il n'y en
 * a jamais eu, après l'allumage). Recalculé à chaque tournée : un redémarrage ne double pas un passage (le dernier est
 * déjà inscrit) et n'en perd pas (le créneau manqué pendant l'arrêt est rattrapé une fois, pas plusieurs).
 */
export function passageHoraireDu(
  declencheurs: readonly Declencheur[],
  dernierPassageHoraire: number | null,
  allumeLe: number,
  maintenant: number,
): boolean {
  const reference = Math.max(dernierPassageHoraire ?? 0, allumeLe);
  return declencheurs.some((d) => {
    if (d.genre !== 'horaire') return false;
    const creneau = dernierCreneauHoraire(d, maintenant);
    return creneau !== null && creneau > reference;
  });
}

/** Le prochain passage horaire prévu, tous déclencheurs confondus, ou `null`. */
export function prochainPassageHoraire(declencheurs: readonly Declencheur[], maintenant: number): number | null {
  const prochains = declencheurs
    .filter((d): d is DeclencheurHoraire => d.genre === 'horaire')
    .map((d) => prochainCreneauHoraire(d, maintenant))
    .filter((t): t is number => t !== null);
  return prochains.length ? Math.min(...prochains) : null;
}

/* ------------------------------------------------------------------ */
/* L'agent, son état et le tableau                                     */
/* ------------------------------------------------------------------ */

export interface AgentPerso {
  id: string;
  projectId: string;
  /** L'agent de conversation (sa carte d'agent de volet, sans branche ni copie). */
  agentId: string | null;
  cardId: string | null;
  fiche: FicheDAgent;
  actif: boolean;
  creeLe: number;
  misAJourLe: number;
  allumeLe: number | null;
  /** Le dernier passage (tous genres), et le dernier passage horaire (la tournée en part). */
  dernierPassage: number | null;
  dernierPassageHoraire: number | null;
  /** Un passage tourne en ce moment. */
  enPassage: boolean;
  /** Un passage attend un compte avec du quota : il partira seul dès qu'un compte revient. */
  attendUnCompte: boolean;
  /** Les demandes d'accord encore ouvertes (cartes proposées, réponses préparées) : elles attendent un clic. */
  attentes: number;
  /** La dernière ligne du journal qui dit quelque chose (jamais une ligne « en cours »). */
  derniereAction: Pick<LigneDeJournal, 'date' | 'resume' | 'issue'> | null;
  /** Prochain passage horaire prévu. */
  prochainPassage: number | null;
  /** La limite est atteinte pour la période en cours : l'agent est en pause jusqu'à la suivante. */
  enPauseLimite: boolean;
  /*
   * L'ÉQUIPE (carte « Beluga piloté par des agents », 26/11/2026) : son métier, son visage, sa couleur, ses outils
   * (onglets de son volet), et s'il travaille SEUL quand un collègue le sollicite (« libre avec ses collègues »).
   */
  role: RoleDEquipier;
  portrait: string | null;
  couleur: string;
  outils: OutilDAgent[];
  autonome: boolean;
}

export const ETATS_AFFICHES = ['au_travail', 'a_valider', 'pause_limite', 'en_veille', 'eteint', 'brouillon'] as const;
export type EtatAffiche = (typeof ETATS_AFFICHES)[number];

/** Le libellé de chaque état (traduit à l'affichage). */
export const LIBELLE_D_ETAT: Readonly<Record<EtatAffiche, string>> = {
  au_travail: 'Au travail',
  a_valider: 'À valider',
  pause_limite: 'En pause (limite)',
  en_veille: 'En veille',
  eteint: 'Éteint',
  brouillon: 'Brouillon',
};

/** L'état d'une ligne du tableau. Ce qui attend un geste (« À valider ») passe avant le repos. */
export function etatAffiche(agent: Pick<AgentPerso, 'fiche' | 'actif' | 'enPassage' | 'attentes' | 'enPauseLimite'>): EtatAffiche {
  if (agent.enPassage) return 'au_travail';
  if (agent.attentes > 0) return 'a_valider';
  if (!ficheComplete(agent.fiche)) return 'brouillon';
  if (!agent.actif) return 'eteint';
  if (agent.enPauseLimite) return 'pause_limite';
  return 'en_veille';
}

/** « Chaque jour à 8 h », « Lun., mer. à 9 h 30 », « À chaque nouvelle demande client »… (texte français, traduit à l'affichage par morceaux). */
export function resumeDuDeclencheur(d: Declencheur): string {
  if (d.genre === 'manuel') return 'À la demande';
  if (d.genre === 'evenement') return LIBELLE_DE_SOURCE[d.source];
  if (d.genre === 'veille') return `Surveillance : ${d.description}`;
  const [h, m] = d.heure.split(':');
  const heure = `${Number(h)} h${m && m !== '00' ? ` ${m}` : ''}`;
  const noms = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const exclus = d.joursExclus?.length ? `, sauf ${d.joursExclus.map((j) => noms[j]).join(' ')}${d.report ? ' (reporté)' : ''}` : '';
  if (d.rythme === 'jour') return `Chaque jour à ${heure}${exclus}`;
  if (d.rythme === 'mois') return `Le ${d.jourDuMois ?? 1} du mois à ${heure}${exclus}`;
  const jours = (d.jours?.length ? d.jours : [1]).map((j) => noms[j]).join(' ');
  return `${jours.charAt(0).toUpperCase()}${jours.slice(1)} à ${heure}${exclus}`;
}

/* ------------------------------------------------------------------ */
/* Le point du matin                                                   */
/* ------------------------------------------------------------------ */

/** Depuis quand le point du matin compte : la veille à 18 h, dans le fuseau du produit. */
export function debutDuPointDuMatin(maintenant: number): number {
  const aujourdhui = debutDuJour(jourLocal(maintenant));
  const hier = debutDuJour(jourLocal(aujourdhui - 12 * 3_600_000));
  return hier + 18 * 3_600_000;
}

export interface PointDuMatin {
  depuis: number;
  agentsActifs: number;
  passages: number;
  /** Ce qui attend un geste, agent par agent. */
  aValider: { agentPersoId: string; nom: string; attentes: number }[];
  /** Les passages qui ont abouti, cités du journal (les plus récents d'abord, cinq au plus). */
  faits: { agentPersoId: string; nom: string; date: number; resume: string }[];
  pannes: { agentPersoId: string; nom: string; date: number; resume: string }[];
  enPause: { agentPersoId: string; nom: string }[];
}

/** LE POINT DU MATIN : ce que les agents du projet ont fait depuis la veille au soir — chaque phrase vient du journal. */
export function pointDuMatin(
  agents: readonly Pick<AgentPerso, 'id' | 'fiche' | 'actif' | 'attentes' | 'enPauseLimite'>[],
  journal: readonly LigneDeJournal[],
  maintenant: number,
): PointDuMatin {
  const depuis = debutDuPointDuMatin(maintenant);
  const noms = new Map(agents.map((a) => [a.id, a.fiche.nom]));
  const recentes = journal.filter((l) => l.date >= depuis && l.date <= maintenant && noms.has(l.agentPersoId)).sort((a, b) => b.date - a.date);
  const cite = (l: LigneDeJournal) => ({ agentPersoId: l.agentPersoId, nom: noms.get(l.agentPersoId) ?? '', date: l.date, resume: l.resume });
  return {
    depuis,
    agentsActifs: agents.filter((a) => a.actif).length,
    passages: recentes.filter(estUnPassage).length,
    aValider: agents.filter((a) => a.attentes > 0).map((a) => ({ agentPersoId: a.id, nom: a.fiche.nom, attentes: a.attentes })),
    faits: recentes.filter((l) => estUnPassage(l) && (l.issue === 'fait' || l.issue === 'a_valider')).slice(0, 5).map(cite),
    pannes: recentes.filter((l) => l.issue === 'panne').slice(0, 5).map(cite),
    enPause: agents.filter((a) => a.actif && a.enPauseLimite).map((a) => ({ agentPersoId: a.id, nom: a.fiche.nom })),
  };
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent reçoit                                               */
/* ------------------------------------------------------------------ */

/** La fiche en clair pour l'agent (son relais) : chaque rubrique, « À DÉFINIR » quand elle ne l'est pas. */
export function ficheEnTexte(fiche: FicheDAgent): string {
  const liste = (l: string[] | null, vide: string) => (l === null ? 'À DÉFINIR' : l.length ? l.map((x) => `- ${x}`).join('\n') : vide);
  const limite = fiche.limite === null ? 'À DÉFINIR' : fiche.limite === 'aucune' ? 'aucune limite' : `${fiche.limite.passages} passage(s) par ${fiche.limite.periode}`;
  const emporte =
    fiche.emporte === null
      ? 'À DÉFINIR'
      : [
          `compétences : ${fiche.emporte.competences.join(', ') || 'aucune'}`,
          `accès (fiches du coffre-fort, à lire avec l'outil coffre_fort au moment voulu) : ${fiche.emporte.acces.join(', ') || 'aucun'}`,
          `mémoire du projet : ${fiche.emporte.memoire ? 'oui' : 'non'}`,
        ].join(' · ');
  return [
    `NOM : ${fiche.nom === NOM_D_UN_NOUVEL_AGENT ? 'À DÉFINIR' : fiche.nom}`,
    `MISSION : ${fiche.mission.trim() || 'À DÉFINIR'}`,
    `QUAND IL AGIT : ${fiche.declencheurs.length ? fiche.declencheurs.map(resumeDuDeclencheur).join(' ; ') : 'À DÉFINIR'}`,
    `CE QU'IL FAIT SEUL :\n${liste(fiche.faitSeul, '(rien)')}`,
    `CE QU'IL DEMANDE AVANT D'AGIR :\n${liste(fiche.demandeAccord, '(rien)')}`,
    `CE QU'IL NE FAIT JAMAIS :\n${liste(fiche.jamais, '(rien de plus que les gestes par carte)')}`,
    `GESTES À VALIDER (capture puis « Valider » dans le fil, puis tu le fais TOI-MÊME) : ${GESTES_A_VALIDER.map((g) => LIBELLE_DU_GESTE[g].toLowerCase()).join(', ')}`,
    `GESTES AU CLIC DE L'UTILISATEUR (ni toi, ni une carte) : ${GESTES_AU_CLIC.map((g) => LIBELLE_DU_GESTE[g].toLowerCase()).join(', ')} — un projet de Beluga, pas un site tiers : l'agent de déploiement les prépare, le bouton « Déployer » les fait partir`,
    `CODE ET TÂCHES (par l'équipe) : ${GESTES_PAR_L_EQUIPE.map((g) => LIBELLE_DU_GESTE[g].toLowerCase()).join(', ')} — demande-les à l'agent de développement avec l'outil « equipe » (« demander ») ; sans agent de développement, propose une carte avec board_create_card`,
    `CE QU'IL EMPORTE : ${emporte}`,
    `SA LIMITE : ${limite}`,
  ].join('\n');
}

/**
 * LA CONSIGNE DE L'AGENT PERSONNALISÉ, redite à chaque message avec sa fiche et son journal (le contexte du tour,
 * jamais une bulle) : il relit toujours son cadre à jour, même au fil d'une longue conversation.
 */
export const CONSIGNE_DE_L_AGENT_PERSO = [
  'TU ES UN AGENT PERSONNALISÉ DE CE PROJET, créé par l’utilisateur dans l’onglet « Agents ». Ton cadre est ta FICHE ci-dessous : il fait foi. Tu es le professionnel du métier de ta mission, et tu mènes chaque échange jusqu’à un résultat : tu enquêtes, tu raisonnes, tu proposes — l’utilisateur tranche.',
  'TA CRÉATION, TANT QUE TA FICHE A DES RUBRIQUES « À DÉFINIR », dans cet ordre :',
  '1. TON NOM D’ABORD, dès ta toute première réponse et sans question : écris la rubrique « nom » avec agent_fiche, deux à cinq mots qui disent ton action (« Communication de Haiko Studio », « Relance des devis »). L’utilisateur le change en te le disant : tu le réécris aussitôt.',
  '2. ENQUÊTE SEUL avant toute question : outil « services » (statistiques, réseaux, messagerie, surveillance, référencement, médias, studio), outil « memoire », le site et les comptes reliés du projet. Ne demande jamais ce qu’une lecture peut trouver.',
  '3. REVIENS AVEC UN DIAGNOSTIC ET UN PLAN, en texte : ce que tu as constaté (séparé de ce que tu supposes), ton avis franc, un OBJECTIF CHIFFRÉ avec son échéance (« 4 demandes de devis par mois d’ici fin janvier »), puis ton plan — ce que tu feras à chaque passage, quand tu passeras, ta limite de passages, ce que tu fais seul et ce qui attend l’accord, les accès dont tu as besoin. Puis UNE question « ask_user » : « Je valide ce plan (recommandé) » et deux ou trois variantes réellement différentes.',
  '4. LE PLAN ACCEPTÉ REMPLIT TA FICHE : écris aussitôt chaque rubrique avec agent_fiche (une par appel) — la mission porte l’objectif chiffré, son échéance et le plan en quelques lignes. Aucune question par rubrique : le plan les a déjà réglées.',
  '5. NE QUESTIONNE QUE SUR LE FOND, ce que ni tes outils ni ton métier ne tranchent (la cible, l’offre, le ton, un budget) : une question à la fois, ta réponse conseillée en tête. Chaque réponse se termine par l’étape suivante que tu proposes ou par cette question, jamais par « dites-moi si… ».',
  'Une fois la fiche complète, dis-le en une phrase et invite à cliquer « Allumer l’agent ». Tu ne te dis JAMAIS allumé, ni au travail, avant ce clic.',
  REGLE_DE_LA_VALIDATION +
    ' Les gestes de ta rubrique « demande » passent aussi par cette validation. Une réponse à une demande de la messagerie se PRÉPARE (service messagerie, « préparer une réponse ») : son bouton « Envoyer au client » est déjà sa validation. RESTENT HORS DE TA MAIN, même demandés : mettre en ligne ou en production un PROJET DE BELUGA — c’est le clic « Déployer » de l’utilisateur. LE CODE ET LES TÂCHES PASSENT PAR L’ÉQUIPE : modifier le code ou lancer une tâche se DEMANDE à l’agent de développement (outil « equipe », geste « demander ») ; sans agent de développement, propose une carte avec board_create_card (elle arrive dans « Planifié » ; ne pose jamais de date de départ). Enregistrer un profil, une page ou une fiche sur un site tiers n’est PAS une mise en ligne de projet : c’est un geste à valider, que tu fais toi-même.',
  'TU FAIS PARTIE D’UNE ÉQUIPE (ton projet, et le groupe de projets s’il y en a un). Outil « equipe » : « lister » rend tes collègues (prénom, métier, état) ; « demander » confie un travail ou une question à UN collègue, par son prénom — il s’y met seul s’il est libre avec ses collègues, et sa réponse paraît dans la discussion de l’équipe et dans ton prochain relais. Demande ce qui relève de son métier, une fois, clairement ; ne relance pas en boucle, et ne redemande pas ce qu’il vient de te répondre.',
  'ACCÈS : ta fiche ne porte que des NOMS de fiches du coffre-fort, jamais une valeur. Lis une valeur avec l’outil coffre_fort au moment où tu en as besoin, et ne la recopie nulle part (ni dans la fiche, ni dans une réponse).',
  'À CHAQUE PASSAGE (déclenché à la main, à heure fixe ou par un événement) : relis ton objectif et ton journal, fais ta mission dans ton cadre, puis dis où en est l’objectif (le chiffre atteint face à la cible) et la prochaine étape que tu proposes. Une décision qui revient à l’utilisateur se pose par « ask_user », À LA FIN du passage, une fois le reste de ta mission fait : elle l’attend dans sa cloche et t’arrête jusqu’à sa réponse. Quand les résultats s’écartent de l’objectif, PROPOSE un plan revu de la même façon, et ne réécris ta fiche qu’après son accord. Termine par UNE phrase de compte rendu qui commence par « Fait : », « À valider : » (une question ou une réponse préparée t’attend) ou « Rien à faire : ». Cette phrase entre au journal.',
].join('\n');

/** Le relais d'un tour : consigne, fiche, journal récent, et l'événement du passage s'il y en a un. */
export function contexteDeLAgentPerso(entree: {
  projet: string;
  fiche: FicheDAgent;
  actif: boolean;
  journal: readonly LigneDeJournal[];
  passage?: { genre: GenreDeLigne; source?: SourceDEvenement; details?: string; de?: string } | null;
  /** L'ÉQUIPE (26/11/2026) : son métier, ses collègues et les derniers échanges qui le concernent. */
  role?: string;
  equipe?: readonly { prenom: string; metier: string; etat: string; libre: boolean }[];
  echanges?: readonly { de: string; a: string; texte: string; date: number }[];
}): string {
  const lignes = [...entree.journal]
    .sort((a, b) => b.date - a.date)
    .slice(0, 8)
    .map((l) => `- ${new Date(l.date).toISOString().slice(0, 16).replace('T', ' ')} · ${l.genre}${l.source ? ` (${l.source})` : ''} · ${l.issue} · ${l.resume}`);
  const etat = entree.actif ? 'ALLUMÉ par l’utilisateur.' : ficheComplete(entree.fiche) ? 'ÉTEINT : il attend le clic « Allumer l’agent ».' : 'EN CRÉATION : sa fiche n’est pas complète.';
  const bloc = [
    CONSIGNE_DE_L_AGENT_PERSO,
    '',
    `PROJET : « ${entree.projet} ». ÉTAT : ${etat}`,
    '',
    'TA FICHE :',
    ficheEnTexte(entree.fiche),
    '',
    'TON JOURNAL (le plus récent d’abord) :',
    lignes.length ? lignes.join('\n') : '(vide)',
  ];
  if (entree.role) bloc.splice(4, 0, `TON MÉTIER DANS L’ÉQUIPE : ${entree.role}.`);
  if (entree.equipe?.length) {
    bloc.push(
      '',
      'TES COLLÈGUES (outil « equipe » pour leur demander quelque chose) :',
      ...entree.equipe.map((m) => `- ${m.prenom} · ${m.metier} · ${m.etat}${m.libre ? '' : ' · ne travaille pas seul sur la demande d’un collègue'}`),
    );
  }
  if (entree.echanges?.length) {
    bloc.push(
      '',
      'LES DERNIERS ÉCHANGES QUI TE CONCERNENT (le plus récent d’abord) :',
      ...[...entree.echanges]
        .sort((a, b) => b.date - a.date)
        .slice(0, 8)
        .map((e) => `- ${new Date(e.date).toISOString().slice(0, 16).replace('T', ' ')} · ${e.de} → ${e.a} : ${e.texte.replace(/\s+/g, ' ').slice(0, 400)}`),
    );
  }
  if (entree.passage) {
    const quoi =
      entree.passage.genre === 'evenement' && entree.passage.source
        ? `l’événement « ${LIBELLE_DE_SOURCE[entree.passage.source]} »`
        : entree.passage.genre === 'horaire'
          ? 'ton heure fixe'
          : entree.passage.genre === 'veille'
            ? 'ta surveillance'
            : entree.passage.genre === 'collegue'
              ? `une demande de ton collègue ${entree.passage.de ?? ''}`.trim()
              : 'un clic « Lancer maintenant »';
    bloc.push('', `CE PASSAGE : déclenché par ${quoi}.`);
    if (entree.passage.details?.trim()) bloc.push(`DÉTAIL : ${entree.passage.details.trim().slice(0, 1500)}`);
  }
  return bloc.join('\n');
}

/** La phrase de compte rendu d'un passage, tirée de la réponse de l'agent, et son issue. */
export function compteRenduDuPassage(texte: string): { resume: string; issue: IssueDeLigne } {
  const lignes = (texte ?? '').split('\n').map((l) => l.replace(/^[\s>*_#-]+/, '').replace(/\*\*/g, '').trim()).filter(Boolean);
  const marquee = [...lignes].reverse().find((l) => /^(fait|à valider|a valider|rien à faire|rien a faire)\s*:/i.test(l));
  const brute = marquee ?? lignes[lignes.length - 1] ?? '';
  const resume = brute.length > 220 ? `${brute.slice(0, 219)}…` : brute;
  const issue: IssueDeLigne = /^(à|a) valider\s*:/i.test(brute) ? 'a_valider' : /^rien (à|a) faire\s*:/i.test(brute) ? 'ignore' : 'fait';
  return { resume: resume || 'Passage terminé.', issue };
}

/* ------------------------------------------------------------------ */
/* L'écriture d'une rubrique par l'outil                               */
/* ------------------------------------------------------------------ */

export type EcritureDeRubrique = { ok: true; fiche: FicheDAgent } | { ok: false; raison: string };

/**
 * ÉCRIRE UNE RUBRIQUE (outil `agent_fiche`). La valeur arrive de l'agent : elle est relue, bornée, et REFUSÉE quand elle
 * ferait faire seul un geste verrouillé, ou quand elle porterait une valeur secrète au lieu d'une référence.
 */
export function ecrireRubrique(fiche: FicheDAgent, rubrique: string, valeur: unknown): EcritureDeRubrique {
  const texte = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const liste = (v: unknown): string[] =>
    (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [])
      .map((x) => texte(x, 200))
      .filter(Boolean)
      .slice(0, 12);
  switch (rubrique) {
    case 'nom': {
      const nom = texte(valeur, 60);
      if (!nom) return { ok: false, raison: 'Le nom est vide.' };
      return { ok: true, fiche: { ...fiche, nom } };
    }
    case 'mission': {
      // L'OBJECTIF CHIFFRÉ, SON ÉCHÉANCE ET LE PLAN (26/11/2026) : quelques lignes, plus une seule phrase.
      const mission = texte(valeur, 1200);
      if (!mission) return { ok: false, raison: 'La mission est vide.' };
      return { ok: true, fiche: { ...fiche, mission } };
    }
    case 'quand': {
      const brut = Array.isArray(valeur) ? valeur : [valeur];
      const declencheurs = brut.map(declencheurLu).filter((d): d is Declencheur => d !== null).slice(0, 6);
      if (!declencheurs.length)
        return {
          ok: false,
          raison:
            'Aucun déclencheur lisible. Formes : {genre:"manuel"} ; {genre:"horaire", rythme:"jour"|"semaine"|"mois", heure:"08:00", jours?:[1..5], jourDuMois?, joursExclus?:[0,6], report?:true} ; {genre:"evenement", source:' +
            SOURCES_D_EVENEMENT.map((s) => `"${s}"`).join('|') +
            '} ; {genre:"veille", description:"…"}.',
        };
      return { ok: true, fiche: { ...fiche, declencheurs } };
    }
    case 'seul': {
      const faitSeul = liste(valeur);
      for (const ligne of faitSeul) {
        const geste = gesteInterditDans(ligne);
        if (geste)
          return {
            ok: false,
            raison: GESTES_PAR_CARTE.includes(geste)
              ? `REFUSÉ : « ${ligne} » (${LIBELLE_DU_GESTE[geste].toLowerCase()}) ne se fait jamais seul : il se propose en carte avec board_create_card.`
              : `REFUSÉ : « ${ligne} » est un geste important (${LIBELLE_DU_GESTE[geste].toLowerCase()}) : jamais sans validation. Inscris-le dans « demande » : tu le feras toi-même après le « Valider » de l’utilisateur, capture à l’appui.`,
          };
      }
      return { ok: true, fiche: { ...fiche, faitSeul } };
    }
    case 'demande':
      return { ok: true, fiche: { ...fiche, demandeAccord: liste(valeur) } };
    case 'jamais':
      return { ok: true, fiche: { ...fiche, jamais: liste(valeur) } };
    case 'emporte': {
      const v = (valeur && typeof valeur === 'object' ? valeur : {}) as Partial<BagageDeLAgent>;
      const acces = liste(v.acces);
      const secret = acces.find(ressembleAUnSecret);
      if (secret)
        return { ok: false, raison: 'REFUSÉ : un accès se nomme par sa fiche du coffre-fort (son nom ou son identifiant), jamais par sa valeur. Retire la valeur.' };
      return { ok: true, fiche: { ...fiche, emporte: { competences: liste(v.competences), acces, memoire: v.memoire === true } } };
    }
    case 'limite': {
      if (valeur === 'aucune' || valeur === null || (typeof valeur === 'object' && (valeur as { aucune?: boolean }).aucune === true))
        return { ok: true, fiche: { ...fiche, limite: 'aucune' } };
      const limite = limiteLue(valeur);
      if (!limite) return { ok: false, raison: 'Limite illisible : {passages: 3, periode: "jour"|"semaine"|"mois"}, ou "aucune".' };
      return { ok: true, fiche: { ...fiche, limite } };
    }
    default:
      return { ok: false, raison: `Rubrique inconnue « ${rubrique} ». Rubriques : ${RUBRIQUES_DE_LA_FICHE.join(', ')}.` };
  }
}

/** Une chaîne qui ressemble à une valeur secrète (clé, jeton, mot de passe) plutôt qu'à un nom de fiche. */
export function ressembleAUnSecret(valeur: string): boolean {
  const v = valeur.trim();
  if (/^(sk|pk|rk|ghp|gho|xox[abp]|AKIA|AIza|eyJ)[-_A-Za-z0-9]{8,}/.test(v)) return true;
  // Un long mot sans espace, mêlant chiffres et lettres : une clé, pas un nom.
  return !/\s/.test(v) && v.length >= 24 && /\d/.test(v) && /[A-Za-z]/.test(v) && !/^[0-9a-f-]{36}$/i.test(v);
}

/**
 * CE QUE L'AGENT NOTE DANS SA FICHE, DIT EN CLAIR DANS LE FIL (décision du 26/11/2026 : « je devrais voir ce qui se
 * passe directement dans le chat »). L'étape de l'outil `agent_fiche` ne disait que « Fiche de l'agent » : elle dit
 * désormais « Nom noté : Communication de Haiko Studio », « Mission notée : … ». La valeur passe par `ecrireRubrique`
 * sur une fiche vide — la même lecture que l'écriture réelle — et rien n'est dit d'une valeur refusée.
 */
export function noteDeRubrique(rubrique: unknown, valeur: unknown): string | null {
  const r = String(rubrique ?? '').trim();
  if (!(RUBRIQUES_DE_LA_FICHE as readonly string[]).includes(r)) return null;
  const ecrite = ecrireRubrique(ficheVide(), r, valeur);
  if (!ecrite.ok) return null;
  const f = ecrite.fiche;
  const court = (t: string) => (t.length > 110 ? `${t.slice(0, 109)}…` : t);
  const liste = (l: string[] | null) => (l && l.length ? l.join(' ; ') : 'rien');
  switch (r as RubriqueDeFiche) {
    case 'nom':
      return `Nom noté : ${court(f.nom)}`;
    case 'mission':
      return `Mission notée : ${court(f.mission)}`;
    case 'quand':
      return `Moments notés : ${court(f.declencheurs.map(resumeDuDeclencheur).join(' ; ') || 'aucun')}`;
    case 'seul':
      return `Ce qu’il fait seul, noté : ${court(liste(f.faitSeul))}`;
    case 'demande':
      return `Ce qu’il vous demande, noté : ${court(liste(f.demandeAccord))}`;
    case 'jamais':
      return `Ce qu’il ne fait jamais, noté : ${court(liste(f.jamais))}`;
    case 'emporte': {
      const e = f.emporte;
      if (!e) return null;
      const morceaux = [e.competences.length ? `compétences ${e.competences.join(', ')}` : '', e.acces.length ? `accès ${e.acces.join(', ')}` : '', e.memoire ? 'mémoire du projet' : ''].filter(Boolean);
      return `Ce qu’il emporte, noté : ${court(morceaux.join(' · ') || 'rien')}`;
    }
    case 'limite': {
      const l = f.limite;
      if (!l) return null;
      const periode = l === 'aucune' ? '' : l.periode === 'jour' ? 'jour' : l.periode === 'semaine' ? 'semaine' : 'mois';
      return `Limite notée : ${l === 'aucune' ? 'aucune' : `${l.passages} passage${l.passages > 1 ? 's' : ''} par ${periode}`}`;
    }
  }
}

/** Une étape du fil qui dit une note de fiche (« Nom noté : … ») : elle se lit telle quelle, en clair. */
export function estUneNoteDeFiche(libelle: string | undefined): boolean {
  return /^(Nom noté|Mission notée|Moments notés|Ce qu’il fait seul, noté|Ce qu’il vous demande, noté|Ce qu’il ne fait jamais, noté|Ce qu’il emporte, noté|Limite notée) : /.test(libelle ?? '');
}
