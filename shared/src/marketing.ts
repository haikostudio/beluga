/**
 * L'ATELIER MARKETING — les règles pures, sans base ni réseau.
 *
 * Chaque projet a UN agent marketing attitré (`server/src/assistant-marketing.ts`)
 * qui étudie le produit, écrit sa CONFIGURATION (nature, hébergement, sources
 * de ventes, façon de poser le script de suivi) et sa FICHE commerciale, puis
 * rédige des CONTENUS à valider. Ici : ce que ces objets valent, les étapes
 * d'un contenu et qui peut les franchir, le calcul du Guide, les chiffres
 * montrés selon la nature du produit, l'attribution d'une vente au contenu qui
 * l'a amenée, le verdict d'un test à deux versions, le script de suivi et la
 * phrase de confidentialité.
 *
 * TROIS PRINCIPES QUI NE BOUGENT PAS.
 *  1. **RIEN NE PART SANS UN GESTE HUMAIN.** L'agent ne dépose qu'en
 *     « Brouillon » ou « À valider » ; « Prêt », « Programmé » et « Publié »
 *     sont des gestes de l'utilisateur (`transitionPermise`).
 *  2. **LE SUIVI EST ANONYME ET SANS COOKIE.** Aucun nom, aucune adresse, aucun
 *     visiteur reconnu d'un jour à l'autre (`extraitDeSuivi`,
 *     `jugerEvenementDeSuivi`).
 *  3. **LE SCRIPT N'EST JAMAIS POSÉ EN CACHETTE.** Il passe par une carte, un
 *     geste annoncé dans une plateforme, ou une marche à suivre — toujours avec
 *     la phrase de confidentialité (`phraseDeConfidentialite`).
 */

/* ------------------------------------------------------------------ */
/* Vocabulaire                                                         */
/* ------------------------------------------------------------------ */

export const LABEL_MARKETING = 'marketing';

export const NATURES_PRODUIT = ['site', 'boutique', 'app', 'saas'] as const;
export type NatureProduit = (typeof NATURES_PRODUIT)[number];

export const GENRES_HEBERGEMENT = ['beluga', 'serveur-distant', 'hebergeur', 'plateforme'] as const;
export type GenreHebergement = (typeof GENRES_HEBERGEMENT)[number];

export const SOURCES_VENTES = ['suivi', 'stripe', 'shopify', 'woocommerce', 'compta'] as const;
export type SourceVentes = (typeof SOURCES_VENTES)[number];

export const METHODES_SUIVI = ['carte-code', 'plateforme', 'manuel'] as const;
export type MethodeSuivi = (typeof METHODES_SUIVI)[number];

export const ETATS_SUIVI = ['absent', 'pose', 'verifie'] as const;
export type EtatSuivi = (typeof ETATS_SUIVI)[number];

/**
 * LE CATALOGUE DES CANAUX — tout ce qui peut amener un client, pas seulement
 * trois réseaux. L'utilisateur est débutant : l'écran Canaux les montre TOUS,
 * rangés par famille, et l'agent dit pour chacun s'il convient au produit
 * (`RecommandationCanal`). L'ordre est celui de l'affichage.
 */
export const FAMILLES_CANAL = ['reseaux', 'direct', 'recherche', 'payant', 'relais'] as const;
export type FamilleCanal = (typeof FAMILLES_CANAL)[number];

export interface CanalDuCatalogue {
  cle: string;
  famille: FamilleCanal;
  /** Le nom affiché : un nom propre ne se traduit pas, le reste passe par le dictionnaire. */
  libelle: string;
  /** À quoi il sert, en une phrase pour un débutant. */
  description: string;
  /** Un contenu peut-il y être rédigé et daté dans le calendrier ? */
  publiable: boolean;
}

export const CATALOGUE_CANAUX: readonly CanalDuCatalogue[] = [
  { cle: 'linkedin', famille: 'reseaux', libelle: 'LinkedIn', description: 'Le réseau des professionnels : idéal pour vendre à des entreprises ou des indépendants.', publiable: true },
  { cle: 'facebook', famille: 'reseaux', libelle: 'Facebook', description: 'Un large public, des groupes par passion ou par région, souvent plus de 35 ans.', publiable: true },
  { cle: 'instagram', famille: 'reseaux', libelle: 'Instagram', description: 'Des images et des vidéos courtes : parfait quand le produit se montre bien.', publiable: true },
  { cle: 'tiktok', famille: 'reseaux', libelle: 'TikTok', description: 'Des vidéos courtes et spontanées, un public jeune, une portée qui peut exploser.', publiable: true },
  { cle: 'youtube', famille: 'reseaux', libelle: 'YouTube', description: 'Des vidéos longues qui expliquent ou démontrent, et qu’on retrouve des années après.', publiable: true },
  { cle: 'x', famille: 'reseaux', libelle: 'X', description: 'Des messages courts, l’actualité et les milieux tech, médias ou politiques.', publiable: true },
  { cle: 'threads', famille: 'reseaux', libelle: 'Threads', description: 'Des messages courts, reliés à Instagram, un ton plus détendu.', publiable: true },
  { cle: 'pinterest', famille: 'reseaux', libelle: 'Pinterest', description: 'Des idées en images (déco, mode, cuisine, mariage) qui mènent vers les sites.', publiable: true },
  { cle: 'reddit', famille: 'reseaux', libelle: 'Reddit', description: 'Des communautés par sujet, exigeantes : on y aide avant de vendre.', publiable: true },
  { cle: 'courriel', famille: 'direct', libelle: 'Lettre d’information', description: 'Des courriels réguliers à ceux qui se sont inscrits : le canal qui vend le plus, et qui vous appartient.', publiable: true },
  { cle: 'bouche-a-oreille', famille: 'direct', libelle: 'Bouche-à-oreille et parrainage', description: 'Vos clients contents en amènent d’autres, surtout si on les y invite ou les récompense.', publiable: false },
  { cle: 'site', famille: 'recherche', libelle: 'Référencement et blog', description: 'Des pages et des articles qui répondent aux questions des gens, pour être trouvé sur Google sans payer.', publiable: true },
  { cle: 'google-business', famille: 'recherche', libelle: 'Fiche Google (Maps)', description: 'La fiche qui s’affiche sur Google Maps : indispensable pour un commerce ou un service local.', publiable: true },
  { cle: 'annuaires', famille: 'recherche', libelle: 'Annuaires, comparateurs et places de marché', description: 'Être listé là où les gens comparent avant d’acheter (annuaires, comparateurs, magasins d’applications).', publiable: false },
  { cle: 'publicite-recherche', famille: 'payant', libelle: 'Publicité sur Google', description: 'Apparaître en tête quand quelqu’un cherche exactement ce que vous vendez. On paie au clic.', publiable: true },
  { cle: 'publicite-reseaux', famille: 'payant', libelle: 'Publicité sur les réseaux', description: 'Montrer une annonce à un public choisi (âge, région, intérêts) sur Facebook, Instagram, LinkedIn…', publiable: true },
  { cle: 'communautes', famille: 'relais', libelle: 'Communautés et lancements', description: 'Forums, groupes spécialisés, Product Hunt : présenter le produit à ceux qu’il passionne.', publiable: true },
  { cle: 'partenariats', famille: 'relais', libelle: 'Partenariats et affiliation', description: 'D’autres marques ou créateurs qui parlent de vous à leur public, contre une commission ou un échange.', publiable: false },
  { cle: 'presse', famille: 'relais', libelle: 'Presse et blogs', description: 'Un article dans un média ou chez un blogueur : de la crédibilité et des visites d’un coup.', publiable: true },
  { cle: 'evenements', famille: 'relais', libelle: 'Salons et événements', description: 'Rencontrer les clients en vrai : salons, marchés, conférences, ateliers.', publiable: false },
];

export const CLES_CANAUX = CATALOGUE_CANAUX.map((c) => c.cle);

/** Les anciens noms, gardés pour relire une configuration déjà enregistrée. */
export const RESEAUX = CLES_CANAUX;
export type Reseau = string;

export function canalDuCatalogue(cle: string): CanalDuCatalogue | undefined {
  return CATALOGUE_CANAUX.find((c) => c.cle === cle);
}

/** Les canaux où un CONTENU peut se ranger : ceux du catalogue qui se publient, plus « autre ». */
export const CANAUX_CONTENU = [...CATALOGUE_CANAUX.filter((c) => c.publiable).map((c) => c.cle), 'autre'] as const;
export type CanalContenu = string;

export const PERTINENCES = ['haute', 'moyenne', 'faible'] as const;
export type Pertinence = (typeof PERTINENCES)[number];

/** L'AVIS DE L'AGENT SUR UN CANAL : convient-il, pourquoi, et par quoi commencer. */
export interface RecommandationCanal {
  canal: string;
  pertinence: Pertinence;
  raison: string;
  premierPas?: string;
}

export const GENRES_CONTENU = ['post', 'courriel', 'page', 'annonce', 'argumentaire'] as const;
export type GenreContenu = (typeof GENRES_CONTENU)[number];

export const ETAPES_CONTENU = ['brouillon', 'a_valider', 'pret', 'programme', 'publie', 'echec', 'abandonne'] as const;
export type EtapeContenu = (typeof ETAPES_CONTENU)[number];

export const ORIGINES_CONTENU = ['agent', 'humain', 'nouveaute', 'hebdo'] as const;
export type OrigineContenu = (typeof ORIGINES_CONTENU)[number];

export const LANGUES_MARKETING = ['fr', 'en', 'de', 'it', 'es'] as const;
export type LangueMarketing = (typeof LANGUES_MARKETING)[number];

export interface ConfigurationMarketing {
  nature?: NatureProduit;
  hebergement?: GenreHebergement;
  /** Où tourne la production, dit en clair (« VPS OVH », « Shopify »…). */
  hebergementDetail?: string;
  /** L'adresse publique du produit. */
  adresse?: string;
  /** Les origines autorisées à envoyer des visites (https://exemple.ch). */
  origines: string[];
  sourcesVentes: SourceVentes[];
  /** Les objectifs suivis : « inscription », « contact », « achat »… */
  objectifs: string[];
  canaux: Reseau[];
  /** L'avis de l'agent sur chaque canal du catalogue qu'il a étudié. */
  recommandations: RecommandationCanal[];
  methodeSuivi?: MethodeSuivi;
  etatSuivi: EtatSuivi;
  langue: LangueMarketing;
  /** Ce que l'agent a compris et choisi, en deux ou trois phrases. */
  explication?: string;
}

export interface FicheMarketing {
  cible?: string;
  probleme?: string;
  promesse?: string;
  arguments?: string[];
  ton?: string;
  offre?: string;
  prix?: string;
  concurrents?: string[];
}

export interface EspaceMarketing {
  projectId: string;
  agentId?: string;
  cardId?: string;
  /** La clé PUBLIQUE du script de suivi : elle n'ouvre rien, elle désigne le projet. */
  cleSuivi: string;
  configuration: ConfigurationMarketing;
  fiche: FicheMarketing;
  suiviVerifieLe?: number;
  /**
   * LE RAPPORT DE L'AGENT — ce qu'il a compris du produit et ce qu'il a
   * décidé, en Markdown, rangé comme une procédure : il se relit dans le
   * tiroir de l'agent, se retravaille en lui parlant, se refait sur
   * « Réanalyser ». Écrit par l'outil « marketing », action « rapport », et
   * par elle seule : aucun texte de message n'est relu pour le deviner.
   */
  rapport?: string;
  rapportLe?: number;
  creeLe: number;
  majLe: number;
}

export interface ContenuMarketing {
  id: string;
  projectId: string;
  genre: GenreContenu;
  canal: CanalContenu;
  titre: string;
  texte: string;
  /** Le jour prévu, AAAA-MM-JJ, et l'heure prévue facultative (HH:MM). */
  datePrevue?: string;
  heurePrevue?: string;
  etape: EtapeContenu;
  origine: OrigineContenu;
  /** La version A dont celle-ci est la version B. */
  varianteDe?: string;
  /** Le code du lien de suivi propre à ce contenu. */
  lienCode?: string;
  /** L'adresse vers laquelle le lien de suivi mène. */
  lienCible?: string;
  urlPubliee?: string;
  raisonEchec?: string;
  creeLe: number;
  majLe: number;
}

/* ------------------------------------------------------------------ */
/* Configuration et fiche                                              */
/* ------------------------------------------------------------------ */

export function configurationVide(): ConfigurationMarketing {
  return { origines: [], sourcesVentes: [], objectifs: [], canaux: [], recommandations: [], etatSuivi: 'absent', langue: 'fr' };
}

function dans<T extends string>(liste: readonly T[], valeur: unknown): T | undefined {
  return typeof valeur === 'string' && (liste as readonly string[]).includes(valeur) ? (valeur as T) : undefined;
}

function texteBorne(valeur: unknown, max = 600): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const propre = valeur.replace(/\s+/g, ' ').trim();
  return propre ? propre.slice(0, max) : undefined;
}

function listeDe<T extends string>(liste: readonly T[], valeur: unknown): T[] {
  if (!Array.isArray(valeur)) return [];
  return [...new Set(valeur.map((v) => dans(liste, v)).filter((v): v is T => !!v))];
}

function listeLibre(valeur: unknown, max = 12): string[] {
  if (!Array.isArray(valeur)) return [];
  return [...new Set(valeur.map((v) => texteBorne(v, 200)).filter((v): v is string => !!v))].slice(0, max);
}

/**
 * L'ORIGINE D'UNE ADRESSE — « https://www.exemple.ch/page » devient
 * « https://www.exemple.ch ». Rend null pour ce qui n'est pas une adresse web.
 */
export function origineDe(adresse: unknown): string | null {
  if (typeof adresse !== 'string' || !adresse.trim()) return null;
  try {
    const url = new URL(adresse.trim().includes('://') ? adresse.trim() : `https://${adresse.trim()}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * FUSIONNE une configuration reçue (de l'agent ou de l'écran) avec l'actuelle :
 * ce qui n'est pas redit est CONSERVÉ, ce qui ne vaut rien est ignoré. L'origine
 * de l'adresse publique rejoint toujours les origines autorisées.
 */
export function fusionnerConfiguration(actuelle: ConfigurationMarketing, recue: Record<string, unknown>): ConfigurationMarketing {
  const suivante: ConfigurationMarketing = { ...actuelle };
  const nature = dans(NATURES_PRODUIT, recue.nature);
  if (nature) suivante.nature = nature;
  const hebergement = dans(GENRES_HEBERGEMENT, recue.hebergement);
  if (hebergement) suivante.hebergement = hebergement;
  const detail = texteBorne(recue.hebergementDetail, 200);
  if (detail) suivante.hebergementDetail = detail;
  if (typeof recue.adresse === 'string') {
    const origine = origineDe(recue.adresse);
    if (origine) suivante.adresse = recue.adresse.trim().slice(0, 300);
  }
  if (Array.isArray(recue.origines)) {
    suivante.origines = recue.origines.map(origineDe).filter((o): o is string => !!o);
  }
  const origineAdresse = origineDe(suivante.adresse);
  if (origineAdresse && !suivante.origines.includes(origineAdresse)) suivante.origines = [...suivante.origines, origineAdresse];
  suivante.origines = [...new Set(suivante.origines)].slice(0, 10);
  if (Array.isArray(recue.sourcesVentes)) suivante.sourcesVentes = listeDe(SOURCES_VENTES, recue.sourcesVentes);
  if (Array.isArray(recue.objectifs)) suivante.objectifs = listeLibre(recue.objectifs, 8);
  if (Array.isArray(recue.canaux)) suivante.canaux = listeDe(CLES_CANAUX, recue.canaux);
  if (Array.isArray(recue.recommandations)) suivante.recommandations = fusionnerRecommandations(actuelle.recommandations ?? [], recue.recommandations);
  const methode = dans(METHODES_SUIVI, recue.methodeSuivi);
  if (methode) suivante.methodeSuivi = methode;
  const langue = dans(LANGUES_MARKETING, recue.langue);
  if (langue) suivante.langue = langue;
  const explication = texteBorne(recue.explication, 900);
  if (explication) suivante.explication = explication;
  return suivante;
}

/**
 * LES AVIS SUR LES CANAUX : chaque avis reçu REMPLACE celui du même canal, les
 * autres sont gardés. Un canal hors catalogue ou sans raison est ignoré.
 */
export function fusionnerRecommandations(actuelles: readonly RecommandationCanal[], recues: unknown[]): RecommandationCanal[] {
  const parCanal = new Map(actuelles.map((r) => [r.canal, r]));
  for (const brut of recues) {
    if (!brut || typeof brut !== 'object') continue;
    const r = brut as Record<string, unknown>;
    const canal = dans(CLES_CANAUX, r.canal);
    const pertinence = dans(PERTINENCES, r.pertinence);
    const raison = texteBorne(r.raison, 400);
    if (!canal || !pertinence || !raison) continue;
    const premierPas = texteBorne(r.premierPas, 300);
    parCanal.set(canal, { canal, pertinence, raison, ...(premierPas ? { premierPas } : {}) });
  }
  return [...parCanal.values()];
}

/**
 * LES CANAUX DANS L'ORDRE DE L'ÉCRAN : les canaux choisis d'abord, puis par
 * pertinence donnée par l'agent (haute, moyenne, sans avis, faible), l'ordre du
 * catalogue départageant.
 */
export function canauxDansLOrdre(config: Pick<ConfigurationMarketing, 'canaux' | 'recommandations'>): {
  canal: CanalDuCatalogue;
  choisi: boolean;
  recommandation?: RecommandationCanal;
}[] {
  const avis = new Map((config.recommandations ?? []).map((r) => [r.canal, r]));
  const rang = (p?: Pertinence) => (p === 'haute' ? 0 : p === 'moyenne' ? 1 : p === 'faible' ? 3 : 2);
  return CATALOGUE_CANAUX.map((canal, i) => ({ canal, i, choisi: config.canaux.includes(canal.cle), recommandation: avis.get(canal.cle) }))
    .sort((a, b) => Number(b.choisi) - Number(a.choisi) || rang(a.recommandation?.pertinence) - rang(b.recommandation?.pertinence) || a.i - b.i)
    .map(({ canal, choisi, recommandation }) => ({ canal, choisi, ...(recommandation ? { recommandation } : {}) }));
}

/* ------------------------------------------------------------------ */
/* Le plan d'action                                                    */
/* ------------------------------------------------------------------ */

/**
 * UNE ACTION DU PLAN : une chose À FAIRE par l'utilisateur, datée — créer sa
 * fiche Google, écrire à trois blogueurs, s'inscrire à un salon. Le plan est
 * posé par l'agent et se lit dans le calendrier à côté des contenus ; cocher
 * « fait » est un geste de l'utilisateur.
 */
export interface ActionMarketing {
  id: string;
  projectId: string;
  titre: string;
  detail: string;
  canal?: string;
  datePrevue?: string;
  faitLe?: number;
  creeLe: number;
  majLe: number;
}

export function raisonActionRefusee(entree: { titre?: unknown; datePrevue?: unknown }, creation: boolean): string | null {
  if (creation && !texteBorne(entree.titre, 160)) return 'Une action a besoin d’un titre.';
  if (creation && !jourValide(entree.datePrevue)) return 'Une action du plan a besoin de sa « datePrevue » (AAAA-MM-JJ).';
  if (!creation && entree.datePrevue !== undefined && !jourValide(entree.datePrevue)) return '« datePrevue » attend AAAA-MM-JJ.';
  return null;
}

export function fusionnerFiche(actuelle: FicheMarketing, recue: Record<string, unknown>): FicheMarketing {
  const suivante: FicheMarketing = { ...actuelle };
  for (const champ of ['cible', 'probleme', 'promesse', 'ton', 'offre', 'prix'] as const) {
    const valeur = texteBorne(recue[champ], 900);
    if (valeur) suivante[champ] = valeur;
  }
  if (Array.isArray(recue.arguments)) suivante.arguments = listeLibre(recue.arguments, 8);
  if (Array.isArray(recue.concurrents)) suivante.concurrents = listeLibre(recue.concurrents, 8);
  return suivante;
}

/** La fiche dit-elle l'essentiel : à qui, quel problème, quelle promesse ? */
export function ficheRemplie(fiche: FicheMarketing): boolean {
  return !!(fiche.cible && fiche.probleme && fiche.promesse);
}

/* ------------------------------------------------------------------ */
/* Étapes d'un contenu                                                 */
/* ------------------------------------------------------------------ */

export const LIBELLE_ETAPE: Record<EtapeContenu, string> = {
  brouillon: 'Brouillon',
  a_valider: 'À valider',
  pret: 'Prêt',
  programme: 'Programmé',
  publie: 'Publié',
  echec: 'En échec',
  abandonne: 'Abandonné',
};

/** Les passages permis, quel que soit l'auteur. */
const PASSAGES: Record<EtapeContenu, EtapeContenu[]> = {
  brouillon: ['a_valider', 'pret', 'abandonne'],
  a_valider: ['brouillon', 'pret', 'abandonne'],
  pret: ['a_valider', 'programme', 'publie', 'abandonne'],
  programme: ['pret', 'publie', 'echec', 'abandonne'],
  publie: [],
  echec: ['pret', 'programme', 'abandonne'],
  abandonne: ['brouillon'],
};

/** Ce que l'AGENT peut atteindre : jamais plus loin que « À valider ». */
const ETAPES_DE_L_AGENT: EtapeContenu[] = ['brouillon', 'a_valider'];

/**
 * UN PASSAGE D'ÉTAPE EST-IL PERMIS ? Rend null si oui, sinon la raison en une
 * phrase. « Programmé » exige une date : on ne programme pas « un jour ».
 */
export function transitionPermise(entree: {
  de: EtapeContenu;
  vers: EtapeContenu;
  parQui: 'humain' | 'agent' | 'systeme';
  datePrevue?: string;
}): string | null {
  const { de, vers, parQui } = entree;
  if (de === vers) return null;
  if (parQui === 'agent' && !ETAPES_DE_L_AGENT.includes(vers)) {
    return `L’agent ne dépose qu’en « Brouillon » ou « À valider » : « ${LIBELLE_ETAPE[vers]} » est un geste de l’utilisateur.`;
  }
  if (parQui === 'agent' && !ETAPES_DE_L_AGENT.includes(de)) {
    return `Ce contenu est déjà « ${LIBELLE_ETAPE[de]} » : l’agent n’y touche plus.`;
  }
  // « Publié » et « En échec » depuis « Programmé » sont posés par la publication elle-même.
  if (parQui === 'systeme') return de === 'programme' && (vers === 'publie' || vers === 'echec') ? null : 'Passage réservé à l’utilisateur.';
  if (!PASSAGES[de].includes(vers)) return `On ne passe pas de « ${LIBELLE_ETAPE[de]} » à « ${LIBELLE_ETAPE[vers]} ».`;
  if (vers === 'programme' && !jourValide(entree.datePrevue)) return 'Un contenu programmé a besoin d’une date.';
  return null;
}

export function jourValide(jour: unknown): jour is string {
  if (typeof jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return false;
  const d = new Date(`${jour}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

export function heureValide(heure: unknown): heure is string {
  return typeof heure === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(heure);
}

/* ------------------------------------------------------------------ */
/* Le Guide                                                            */
/* ------------------------------------------------------------------ */

export interface JalonDuGuide {
  cle: 'configuration' | 'fiche' | 'offre' | 'suivi' | 'canaux' | 'contenus' | 'ventes';
  libelle: string;
  explication: string;
  fait: boolean;
  action: string;
}

export interface GuideMarketing {
  jalons: JalonDuGuide[];
  /** Part des jalons faits, de 0 à 100. */
  avancement: number;
  /** Les trois prochaines actions, dans l'ordre où elles rapportent. */
  prochainesActions: string[];
}

/**
 * OÙ EN EST LE PROJET, ET QUE FAIRE ENSUITE. L'ordre des jalons est celui où
 * ils rapportent : sans savoir ce qu'on vend, écrire ne sert à rien ; sans
 * mesure, on ne sait pas ce qui marche.
 */
export function guideDuProjet(entree: {
  espace: EspaceMarketing | null;
  contenusPublies: number;
  contenusEnAttente: number;
  ventes: number;
}): GuideMarketing {
  const config = entree.espace?.configuration ?? configurationVide();
  const fiche = entree.espace?.fiche ?? {};
  const jalons: JalonDuGuide[] = [
    {
      cle: 'configuration',
      libelle: 'Le produit est compris',
      explication: 'L’agent sait ce que vous vendez, où le produit est hébergé et comment on y paie.',
      fait: !!(config.nature && config.hebergement),
      action: 'Demandez à l’agent d’étudier le projet.',
    },
    {
      cle: 'fiche',
      libelle: 'Le positionnement est clair',
      explication: 'À qui s’adresse le produit, quel problème il règle, ce qu’il promet. C’est la base de chaque texte.',
      fait: ficheRemplie(fiche),
      action: 'Faites rédiger la fiche de positionnement par l’agent.',
    },
    {
      cle: 'offre',
      libelle: 'L’offre et le prix sont posés',
      explication: 'Un visiteur convaincu doit savoir quoi acheter et combien ça coûte.',
      fait: !!(fiche.offre && fiche.prix),
      action: 'Précisez l’offre et le prix avec l’agent.',
    },
    {
      cle: 'suivi',
      libelle: 'La mesure est en place',
      explication: 'Un petit script anonyme compte les visites et d’où elles viennent. Sans lui, impossible de savoir ce qui marche.',
      fait: config.etatSuivi === 'verifie',
      action:
        config.etatSuivi === 'pose'
          ? 'Attendez la première visite : le suivi sera confirmé tout seul.'
          : 'Faites installer le script de suivi par l’agent.',
    },
    {
      cle: 'canaux',
      libelle: 'Les canaux sont choisis',
      explication: 'Les canaux où votre public se trouve vraiment, pas tous à la fois.',
      fait: config.canaux.length > 0,
      action: 'Demandez à l’agent quels canaux conviennent à ce produit.',
    },
    {
      cle: 'contenus',
      libelle: 'Des contenus sortent',
      explication: 'Des posts réguliers, relus et validés par vous, qui amènent des visiteurs.',
      fait: entree.contenusPublies > 0,
      action:
        entree.contenusEnAttente > 0
          ? `Relisez ${entree.contenusEnAttente > 1 ? `les ${entree.contenusEnAttente} contenus qui attendent` : 'le contenu qui attend'} votre validation.`
          : 'Demandez à l’agent un premier contenu.',
    },
    {
      cle: 'ventes',
      libelle: 'Les ventes sont reliées',
      explication: 'Chaque vente est rattachée au contenu qui a amené l’acheteur : on voit ce qui rapporte vraiment.',
      fait: entree.ventes > 0 || config.sourcesVentes.length > 0,
      action: 'Indiquez à l’agent comment vos clients paient.',
    },
  ];
  const faits = jalons.filter((j) => j.fait).length;
  return {
    jalons,
    avancement: Math.round((faits / jalons.length) * 100),
    prochainesActions: jalons.filter((j) => !j.fait).slice(0, 3).map((j) => j.action),
  };
}

/* ------------------------------------------------------------------ */
/* Les chiffres, selon la nature du produit                            */
/* ------------------------------------------------------------------ */

export interface Indicateur {
  cle: string;
  libelle: string;
  explication: string;
}

const COMMUNS: Indicateur[] = [
  { cle: 'visites', libelle: 'Visites', explication: 'Le nombre de passages sur le produit.' },
  { cle: 'visiteurs', libelle: 'Visiteurs', explication: 'Les personnes différentes, comptées jour par jour, sans les reconnaître.' },
];

export const INDICATEURS_PAR_NATURE: Record<NatureProduit, Indicateur[]> = {
  site: [
    ...COMMUNS,
    { cle: 'pagesParVisite', libelle: 'Pages par visite', explication: 'Combien de pages une personne regarde avant de partir.' },
    { cle: 'duree', libelle: 'Durée moyenne', explication: 'Le temps passé par visite.' },
    { cle: 'rebond', libelle: 'Rebond', explication: 'La part des visites qui repartent après une seule page.' },
    { cle: 'objectifs', libelle: 'Objectifs atteints', explication: 'Inscriptions, demandes de contact : ce que le site cherche à obtenir.' },
  ],
  boutique: [
    ...COMMUNS,
    { cle: 'ventes', libelle: 'Ventes', explication: 'Le nombre de commandes.' },
    { cle: 'chiffreAffaires', libelle: 'Chiffre d’affaires', explication: 'L’argent encaissé sur la période.' },
    { cle: 'panierMoyen', libelle: 'Panier moyen', explication: 'Le montant moyen d’une commande.' },
    { cle: 'paniersAbandonnes', libelle: 'Paniers abandonnés', explication: 'Les paniers remplis puis laissés sans achat.' },
    { cle: 'conversion', libelle: 'Taux d’achat', explication: 'La part des visites qui finissent en commande.' },
  ],
  app: [
    { cle: 'sessions', libelle: 'Ouvertures', explication: 'Le nombre de fois où l’application est ouverte.' },
    { cle: 'visiteurs', libelle: 'Utilisateurs', explication: 'Les personnes différentes, comptées jour par jour, sans les reconnaître.' },
    { cle: 'installations', libelle: 'Installations', explication: 'Les nouvelles installations sur la période.' },
    { cle: 'fidelite', libelle: 'Fidélité', explication: 'La part des jours actifs qui reviennent la semaine suivante.' },
    { cle: 'duree', libelle: 'Durée moyenne', explication: 'Le temps passé par ouverture.' },
  ],
  saas: [
    ...COMMUNS,
    { cle: 'objectifs', libelle: 'Inscriptions', explication: 'Les comptes créés : le premier pas vers un abonnement.' },
    { cle: 'ventes', libelle: 'Abonnements', explication: 'Les paiements reçus.' },
    { cle: 'chiffreAffaires', libelle: 'Revenu', explication: 'L’argent encaissé sur la période.' },
    { cle: 'conversion', libelle: 'Taux d’inscription', explication: 'La part des visites qui créent un compte.' },
  ],
};

/** Les chiffres d'un projet dont la nature n'est pas encore connue : ceux d'un site. */
export function indicateursDe(nature: NatureProduit | undefined): Indicateur[] {
  return INDICATEURS_PAR_NATURE[nature ?? 'site'];
}

/* ------------------------------------------------------------------ */
/* Événements de suivi                                                 */
/* ------------------------------------------------------------------ */

export const TYPES_EVENEMENT = ['vue', 'sortie', 'objectif', 'achat', 'panier', 'session', 'ecran', 'installation', 'clic'] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];

/** Un événement tel qu'il est gardé : aucune donnée personnelle, aucune adresse IP. */
export interface EvenementDeSuivi {
  instant: number;
  type: TypeEvenement;
  /** Le chemin de la page ou le nom de l'écran, sans paramètres. */
  chemin?: string;
  /** D'où vient la visite : un réseau, un moteur de recherche, « direct »… */
  source?: string;
  contenuId?: string;
  /** Le visiteur DU JOUR : un hachage salé qui change chaque jour. */
  visiteur: string;
  /** La visite : un identifiant tiré au hasard par la page, jamais gardé ailleurs. */
  visite?: string;
  dureeMs?: number;
  montantCentimes?: number;
  devise?: string;
  reference?: string;
  objectif?: string;
  variante?: 'A' | 'B';
  /** Une ouverture d'application par quelqu'un qui l'avait déjà utilisée. */
  retour?: boolean;
  appareil?: 'mobile' | 'tablette' | 'ordinateur';
}

export const TAILLE_EVENEMENT_MAX = 2048;

const MOTEURS = ['google', 'bing', 'duckduckgo', 'qwant', 'ecosia', 'yahoo', 'startpage', 'brave'];
const RESEAUX_SOURCES: Record<string, string> = {
  'linkedin.com': 'linkedin',
  'lnkd.in': 'linkedin',
  't.co': 'x',
  'x.com': 'x',
  'twitter.com': 'x',
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'l.facebook.com': 'facebook',
  'youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
};

/**
 * LA SOURCE D'UNE VISITE, d'après le paramètre « utm_source » ou la page d'où
 * elle arrive. La page d'origine n'est gardée que sous forme de nom de domaine.
 */
export function sourceDeLaVisite(entree: { referent?: string; utm?: string; origineDuSite?: string }): string {
  const utm = texteBorne(entree.utm, 40)?.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (utm) return utm;
  if (!entree.referent) return 'direct';
  let hote: string;
  try {
    hote = new URL(entree.referent).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'direct';
  }
  if (entree.origineDuSite) {
    try {
      if (new URL(entree.origineDuSite).hostname.toLowerCase().replace(/^www\./, '') === hote) return 'direct';
    } catch {
      /* rien */
    }
  }
  if (RESEAUX_SOURCES[hote]) return RESEAUX_SOURCES[hote];
  const moteur = MOTEURS.find((m) => hote === `${m}.com` || hote.startsWith(`${m}.`) || hote.includes(`.${m}.`));
  if (moteur) return 'recherche';
  return hote.slice(0, 80);
}

export function appareilDe(userAgent: string | undefined): EvenementDeSuivi['appareil'] {
  const ua = (userAgent ?? '').toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablette';
  if (/mobi|iphone|android/.test(ua)) return 'mobile';
  return 'ordinateur';
}

export type EvenementJuge =
  | { ok: true; evenement: Omit<EvenementDeSuivi, 'instant' | 'visiteur' | 'appareil' | 'source'>; referent?: string; utm?: string }
  | { ok: false; raison: string };

/**
 * JUGE UN ÉVÉNEMENT REÇU D'UNE PAGE. Tout ce qui n'est pas prévu est jeté : un
 * champ « email » ou « nom » glissé par un site ne passe jamais. Le chemin perd
 * ses paramètres (ils portent parfois des adresses ou des jetons).
 */
export function jugerEvenementDeSuivi(brut: unknown): EvenementJuge {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'événement illisible' };
  const b = brut as Record<string, unknown>;
  const type = dans(TYPES_EVENEMENT, b.t ?? b.type);
  if (!type || type === 'clic') return { ok: false, raison: 'type inconnu' };
  const cheminBrut = typeof (b.p ?? b.chemin) === 'string' ? String(b.p ?? b.chemin) : '';
  const chemin = cheminBrut ? (cheminBrut.split(/[?#]/)[0] || '/').slice(0, 200) : undefined;
  const evenement: Omit<EvenementDeSuivi, 'instant' | 'visiteur' | 'appareil' | 'source'> = { type };
  if (chemin) evenement.chemin = chemin;
  const visite = typeof b.v === 'string' && /^[a-z0-9]{6,32}$/i.test(b.v) ? b.v : undefined;
  if (visite) evenement.visite = visite;
  const contenu = typeof b.c === 'string' && /^[a-z0-9_-]{4,40}$/i.test(b.c) ? b.c : undefined;
  if (contenu) evenement.contenuId = contenu;
  const duree = Number(b.d);
  if (Number.isFinite(duree) && duree > 0) evenement.dureeMs = Math.min(Math.round(duree), 6 * 3600_000);
  if (type === 'achat' || type === 'panier') {
    const montant = Number(b.m);
    if (Number.isFinite(montant) && montant >= 0) evenement.montantCentimes = Math.min(Math.round(montant * 100), 10_000_000_00);
    const devise = typeof b.cur === 'string' && /^[A-Za-z]{3}$/.test(b.cur) ? b.cur.toUpperCase() : undefined;
    if (devise) evenement.devise = devise;
    const reference = typeof b.ref === 'string' ? b.ref.replace(/[^\w.-]/g, '').slice(0, 64) : '';
    if (reference) evenement.reference = reference;
  }
  if (type === 'objectif') {
    const objectif = typeof b.o === 'string' ? b.o.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) : '';
    if (!objectif) return { ok: false, raison: 'objectif sans nom' };
    evenement.objectif = objectif;
  }
  if (b.ab === 'A' || b.ab === 'B') evenement.variante = b.ab;
  if (type === 'session' && (b.ret === 1 || b.ret === true || b.ret === '1')) evenement.retour = true;
  const referent = typeof b.r === 'string' ? b.r.slice(0, 400) : undefined;
  const utm = typeof b.u === 'string' ? b.u : undefined;
  return { ok: true, evenement, referent, utm };
}

/** L'origine d'une requête est-elle déclarée pour ce projet ? */
export function origineAutorisee(origine: string | undefined, config: ConfigurationMarketing): boolean {
  const o = origineDe(origine);
  if (!o) return false;
  return config.origines.includes(o);
}

/* ------------------------------------------------------------------ */
/* Résultats                                                           */
/* ------------------------------------------------------------------ */

export interface Vente {
  instant: number;
  montantCentimes: number;
  devise: string;
  source: SourceVentes;
  /** L'identifiant de la commande ou du paiement : c'est lui qui dédoublonne. */
  reference?: string;
  visiteur?: string;
  contenuId?: string;
}

export const FENETRE_ATTRIBUTION_MS = 30 * 24 * 3600_000;

/**
 * LE CONTENU QUI A AMENÉ UNE VENTE : le dernier contenu par lequel ce visiteur
 * est arrivé, dans les trente jours qui précèdent. Le visiteur étant compté au
 * jour, une vente ne remonte en pratique qu'aux contenus du même jour — sauf
 * quand la vente porte elle-même le contenu (lien de suivi transmis au paiement).
 */
export function attribuerVente(
  vente: Pick<Vente, 'instant' | 'visiteur' | 'contenuId'>,
  touches: readonly { instant: number; visiteur: string; contenuId: string }[],
): string | null {
  if (vente.contenuId) return vente.contenuId;
  if (!vente.visiteur) return null;
  let meilleure: { instant: number; contenuId: string } | null = null;
  for (const t of touches) {
    if (t.visiteur !== vente.visiteur) continue;
    if (t.instant > vente.instant || vente.instant - t.instant > FENETRE_ATTRIBUTION_MS) continue;
    if (!meilleure || t.instant > meilleure.instant) meilleure = t;
  }
  return meilleure?.contenuId ?? null;
}

/**
 * UNE VENTE N'EST COMPTÉE QU'UNE FOIS, même vue par deux sources (le script du
 * site ET le service de paiement). La référence fait foi ; entre deux copies,
 * on garde celle qui connaît son contenu.
 */
export function dedoublonnerVentes<V extends Vente>(ventes: readonly V[]): V[] {
  const parReference = new Map<string, V>();
  const sansReference: V[] = [];
  for (const v of ventes) {
    if (!v.reference) {
      sansReference.push(v);
      continue;
    }
    const deja = parReference.get(v.reference);
    if (!deja || (!deja.contenuId && v.contenuId)) parReference.set(v.reference, v);
  }
  return [...parReference.values(), ...sansReference].sort((a, b) => a.instant - b.instant);
}

export interface ResultatsMarketing {
  depuis: number;
  jusqua: number;
  totaux: Record<string, number | null>;
  parJour: { jour: string; visites: number; visiteurs: number; objectifs: number; ventes: number; montantCentimes: number }[];
  sources: { source: string; visites: number }[];
  pages: { chemin: string; vues: number }[];
  appareils: { appareil: string; visites: number }[];
  parContenu: { contenuId: string; visites: number; objectifs: number; ventes: number; montantCentimes: number }[];
  /** Un plafond qui se dit : les listes sont coupées à ce nombre. */
  plafondListes: number;
}

const PLAFOND_LISTES = 10;

function jourDe(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * LES RÉSULTATS D'UNE PÉRIODE, calculés depuis les événements bruts. Une
 * mesure qui ne se calcule pas (aucune visite) vaut null — l'écran dit « — »,
 * jamais un zéro inventé.
 */
export function resumeDesResultats(entree: {
  evenements: readonly EvenementDeSuivi[];
  ventes: readonly Vente[];
  depuis: number;
  jusqua: number;
}): ResultatsMarketing {
  const ev = entree.evenements.filter((e) => e.instant >= entree.depuis && e.instant <= entree.jusqua);
  const ventes = dedoublonnerVentes(entree.ventes.filter((v) => v.instant >= entree.depuis && v.instant <= entree.jusqua));
  const vues = ev.filter((e) => e.type === 'vue');
  const sessions = ev.filter((e) => e.type === 'session');
  // Une visite = une clé de visite (ou, à défaut, le visiteur du jour).
  const visiteDe = (e: EvenementDeSuivi) => e.visite ?? `${e.visiteur}:${jourDe(e.instant)}`;
  const visites = new Map<string, EvenementDeSuivi[]>();
  for (const e of vues) {
    const cle = visiteDe(e);
    const liste = visites.get(cle);
    if (liste) liste.push(e);
    else visites.set(cle, [e]);
  }
  const visiteursParJour = new Map<string, Set<string>>();
  const visitesParJour = new Map<string, Set<string>>();
  for (const e of [...vues, ...sessions]) {
    const jour = jourDe(e.instant);
    if (!visiteursParJour.has(jour)) visiteursParJour.set(jour, new Set());
    if (!visitesParJour.has(jour)) visitesParJour.set(jour, new Set());
    visiteursParJour.get(jour)!.add(e.visiteur);
    visitesParJour.get(jour)!.add(visiteDe(e));
  }
  const visiteurs = [...visiteursParJour.values()].reduce((s, v) => s + v.size, 0);
  const nbVisites = visites.size;
  const sorties = ev.filter((e) => e.type === 'sortie' && typeof e.dureeMs === 'number');
  const dureeMoyenne = sorties.length ? Math.round(sorties.reduce((s, e) => s + (e.dureeMs ?? 0), 0) / sorties.length) : null;
  const rebonds = [...visites.values()].filter((l) => l.length === 1).length;
  const objectifs = ev.filter((e) => e.type === 'objectif').length;
  const paniers = ev.filter((e) => e.type === 'panier').length;
  const chiffre = ventes.reduce((s, v) => s + v.montantCentimes, 0);
  const installations = ev.filter((e) => e.type === 'installation').length;

  // Fidélité d'une application : le visiteur changeant chaque jour, on ne peut pas le reconnaître ;
  // c'est l'application qui dit qu'une ouverture est un RETOUR (« ret: 1 »), sans rien dire de la personne.
  const retours = sessions.filter((e) => e.retour).length;

  const compter = <K extends string>(cles: K[]) => {
    const m = new Map<K, number>();
    for (const c of cles) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, PLAFOND_LISTES);
  };
  const premieresVues = [...visites.values()].map((l) => l[0]);
  const parContenu = new Map<string, { visites: number; objectifs: number; ventes: number; montantCentimes: number }>();
  const ligneContenu = (id: string) => {
    let l = parContenu.get(id);
    if (!l) parContenu.set(id, (l = { visites: 0, objectifs: 0, ventes: 0, montantCentimes: 0 }));
    return l;
  };
  for (const e of ev) {
    if (!e.contenuId) continue;
    if (e.type === 'clic') ligneContenu(e.contenuId).visites += 1;
    if (e.type === 'objectif') ligneContenu(e.contenuId).objectifs += 1;
  }
  const touches = ev
    .filter((e) => e.contenuId && (e.type === 'clic' || e.type === 'vue'))
    .map((e) => ({ instant: e.instant, visiteur: e.visiteur, contenuId: e.contenuId! }));
  for (const v of ventes) {
    const id = attribuerVente(v, touches);
    if (!id) continue;
    const l = ligneContenu(id);
    l.ventes += 1;
    l.montantCentimes += v.montantCentimes;
  }

  const objectifsParJour = new Map<string, number>();
  for (const e of ev) if (e.type === 'objectif') objectifsParJour.set(jourDe(e.instant), (objectifsParJour.get(jourDe(e.instant)) ?? 0) + 1);
  const ventesParJour = new Map<string, { n: number; montant: number }>();
  for (const v of ventes) {
    const l = ventesParJour.get(jourDe(v.instant)) ?? { n: 0, montant: 0 };
    ventesParJour.set(jourDe(v.instant), { n: l.n + 1, montant: l.montant + v.montantCentimes });
  }
  const jours: ResultatsMarketing['parJour'] = [];
  for (let t = Date.parse(`${jourDe(entree.depuis)}T00:00:00Z`); t <= entree.jusqua; t += 86_400_000) {
    const jour = jourDe(t);
    jours.push({
      jour,
      visites: visitesParJour.get(jour)?.size ?? 0,
      visiteurs: visiteursParJour.get(jour)?.size ?? 0,
      objectifs: objectifsParJour.get(jour) ?? 0,
      ventes: ventesParJour.get(jour)?.n ?? 0,
      montantCentimes: ventesParJour.get(jour)?.montant ?? 0,
    });
  }

  return {
    depuis: entree.depuis,
    jusqua: entree.jusqua,
    totaux: {
      visites: nbVisites + sessions.length,
      visiteurs,
      sessions: sessions.length,
      pagesParVisite: nbVisites ? Math.round((vues.length / nbVisites) * 10) / 10 : null,
      duree: dureeMoyenne,
      rebond: nbVisites ? Math.round((rebonds / nbVisites) * 100) : null,
      objectifs,
      ventes: ventes.length,
      chiffreAffaires: chiffre,
      panierMoyen: ventes.length ? Math.round(chiffre / ventes.length) : null,
      paniersAbandonnes: Math.max(0, paniers - ventes.length),
      conversion: nbVisites ? Math.round(((ventes.length || objectifs) / nbVisites) * 1000) / 10 : null,
      installations,
      fidelite: sessions.length ? Math.round((retours / sessions.length) * 100) : null,
    },
    parJour: jours,
    sources: compter(premieresVues.map((e) => e.source ?? 'direct')).map(([source, n]) => ({ source, visites: n })),
    pages: compter(vues.map((e) => e.chemin ?? '/')).map(([chemin, n]) => ({ chemin, vues: n })),
    appareils: compter(premieresVues.map((e) => e.appareil ?? 'ordinateur')).map(([appareil, n]) => ({ appareil, visites: n })),
    parContenu: [...parContenu.entries()]
      .map(([contenuId, l]) => ({ contenuId, ...l }))
      .sort((a, b) => b.montantCentimes - a.montantCentimes || b.visites - a.visites),
    plafondListes: PLAFOND_LISTES,
  };
}

/* ------------------------------------------------------------------ */
/* Tests à deux versions                                               */
/* ------------------------------------------------------------------ */

export const VUES_MIN_PAR_VERSION = 100;

export interface VerdictAB {
  verdict: 'trop-tot' | 'egalite' | 'A' | 'B';
  tauxA: number | null;
  tauxB: number | null;
  /** La confiance, de 0 à 1 (test de deux proportions). */
  confiance: number | null;
}

/** Fonction de répartition de la loi normale (approximation d'Abramowitz et Stegun). */
function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * QUELLE VERSION A GAGNÉ ? Aucune tant que chaque version n'a pas été vue
 * `VUES_MIN_PAR_VERSION` fois : conclure sur trente visites, c'est tirer à
 * pile ou face. Ensuite, une version ne gagne qu'avec 95 % de confiance.
 */
export function verdictAB(a: { vues: number; conversions: number }, b: { vues: number; conversions: number }): VerdictAB {
  const tauxA = a.vues ? a.conversions / a.vues : null;
  const tauxB = b.vues ? b.conversions / b.vues : null;
  if (a.vues < VUES_MIN_PAR_VERSION || b.vues < VUES_MIN_PAR_VERSION) return { verdict: 'trop-tot', tauxA, tauxB, confiance: null };
  const p = (a.conversions + b.conversions) / (a.vues + b.vues);
  const ecart = Math.sqrt(p * (1 - p) * (1 / a.vues + 1 / b.vues));
  if (!ecart) return { verdict: 'egalite', tauxA, tauxB, confiance: 0 };
  const z = (tauxB! - tauxA!) / ecart;
  const confiance = 2 * phi(Math.abs(z)) - 1;
  if (confiance < 0.95) return { verdict: 'egalite', tauxA, tauxB, confiance };
  return { verdict: z > 0 ? 'B' : 'A', tauxA, tauxB, confiance };
}

/** La version montrée à un visiteur : stable pour la journée, sans cookie. */
export function versionPourVisiteur(visiteur: string, experience: string): 'A' | 'B' {
  let h = 2166136261;
  for (const c of `${experience}:${visiteur}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 2 === 0 ? 'A' : 'B';
}

/* ------------------------------------------------------------------ */
/* Le script de suivi et la confidentialité                            */
/* ------------------------------------------------------------------ */

/** La ligne à coller dans les pages du produit. */
export function extraitDeSuivi(adresseBeluga: string, cleSuivi: string): string {
  const racine = adresseBeluga.replace(/\/+$/, '');
  return `<script defer src="${racine}/m/s.js" data-cle="${cleSuivi}"></script>`;
}

/** Comment déclarer un objectif atteint ou un achat depuis la page. */
export function modeDEmploiDuSuivi(): string {
  return [
    'Une page vue est comptée toute seule.',
    'Objectif atteint : belugaSuivi("objectif", { o: "inscription" })',
    'Achat : belugaSuivi("achat", { m: 49.9, cur: "EUR", ref: "<numéro de commande>" })',
    'Panier rempli : belugaSuivi("panier", { m: 49.9, cur: "EUR" })',
    'Application — ouverture : belugaSuivi("session") (ou belugaSuivi("session", { ret: 1 }) pour quelqu’un qui revient) ; écran : belugaSuivi("ecran", { p: "Accueil" }) ; installation : belugaSuivi("installation")',
  ].join('\n');
}

const PHRASES_CONFIDENTIALITE: Record<LangueMarketing, (nom: string) => string> = {
  fr: (nom) =>
    `Mesure d’audience — ${nom} mesure la fréquentation de ses pages de façon anonyme, sans cookie et sans service extérieur : aucune donnée ne permet de vous identifier, et votre passage n’est pas suivi d’un jour à l’autre. Ces chiffres servent uniquement à améliorer le site.`,
  en: (nom) =>
    `Audience measurement — ${nom} measures visits to its pages anonymously, without cookies and without any third-party service: no data can identify you, and your visit is not tracked from one day to the next. These figures are used only to improve the site.`,
  de: (nom) =>
    `Reichweitenmessung — ${nom} misst die Besuche seiner Seiten anonym, ohne Cookies und ohne externe Dienste: Keine Daten ermöglichen Ihre Identifizierung, und Ihr Besuch wird nicht von einem Tag zum nächsten verfolgt. Diese Zahlen dienen ausschliesslich der Verbesserung der Website.`,
  it: (nom) =>
    `Misurazione del pubblico — ${nom} misura le visite alle sue pagine in modo anonimo, senza cookie e senza servizi esterni: nessun dato permette di identificarvi e la vostra visita non viene seguita da un giorno all’altro. Questi dati servono solo a migliorare il sito.`,
  es: (nom) =>
    `Medición de audiencia — ${nom} mide las visitas a sus páginas de forma anónima, sin cookies y sin servicios externos: ningún dato permite identificarle y su visita no se sigue de un día a otro. Estas cifras solo sirven para mejorar el sitio.`,
};

/** LA PHRASE À AJOUTER À LA PAGE « CONFIDENTIALITÉ » du produit, dans sa langue. */
export function phraseDeConfidentialite(langue: LangueMarketing | undefined, nomProjet: string): string {
  return PHRASES_CONFIDENTIALITE[langue ?? 'fr'](nomProjet.trim() || 'Ce site');
}

/**
 * LE SCRIPT SERVI AUX PAGES. Minuscule et différé ; il n'écrit RIEN sur
 * l'appareil (ni cookie, ni stockage local) et se tait quand le navigateur
 * demande à ne pas être suivi (Do Not Track, Global Privacy Control).
 * L'identifiant de visite vit en mémoire le temps de la page.
 */
export function scriptDeSuivi(adresseCollecte: string): string {
  const url = JSON.stringify(`${adresseCollecte.replace(/\/+$/, '')}/m/c`);
  return `(function(){var d=document,n=navigator,w=window;var s=d.currentScript;if(!s)return;var k=s.getAttribute('data-cle');if(!k)return;
if(n.doNotTrack==='1'||w.doNotTrack==='1'||n.globalPrivacyControl){w.belugaSuivi=function(){};return;}
var v=Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,8),t0=Date.now(),q=new URLSearchParams(location.search);
var c=q.get('bm')||'',u=q.get('utm_source')||'';
function e(t,x){x=x||{};var b={k:k,t:t,v:v,p:x.p||location.pathname,r:d.referrer||'',u:u,c:x.c||c};for(var i in x)if(!(i in b))b[i]=x[i];
var j=JSON.stringify(b);try{if(t==='sortie'&&n.sendBeacon){n.sendBeacon(${url},new Blob([j],{type:'text/plain'}));return;}
fetch(${url},{method:'POST',body:j,keepalive:true,mode:'cors',credentials:'omit',headers:{'content-type':'text/plain'}});}catch(_){}}
w.belugaSuivi=e;e('vue');var fini=false;function sortie(){if(fini)return;fini=true;e('sortie',{d:Date.now()-t0});}
d.addEventListener('visibilitychange',function(){if(d.visibilityState==='hidden')sortie();});w.addEventListener('pagehide',sortie);})();`;
}

/* ------------------------------------------------------------------ */
/* Annonces et semaine                                                 */
/* ------------------------------------------------------------------ */

/**
 * UNE LIVRAISON QUI MÉRITE UNE ANNONCE : seules une grande nouveauté ou une
 * amélioration en valent la peine. Rend le brouillon, ou null.
 */
export function annonceDeLivraison(entree: {
  poids?: string | null;
  titre?: string | null;
  explication?: string | null;
  nomProjet: string;
}): { titre: string; texte: string } | null {
  if (entree.poids !== 'grande-nouveaute' && entree.poids !== 'amelioration') return null;
  const titre = (entree.titre ?? '').trim();
  if (!titre) return null;
  const explication = (entree.explication ?? '').trim();
  const accroche = entree.poids === 'grande-nouveaute' ? `Nouveau sur ${entree.nomProjet} :` : `${entree.nomProjet} s’améliore :`;
  return {
    titre: `Annonce — ${titre}`.slice(0, 120),
    texte: [`${accroche} ${titre}.`, explication].filter(Boolean).join('\n\n').slice(0, 2000),
  };
}

/** Le lundi (AAAA-MM-JJ) de la semaine d'un instant, en heure locale du serveur. */
export function lundiDe(instant: number): string {
  const d = new Date(instant);
  const decalage = (d.getDay() + 6) % 7;
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * EST-CE L'HEURE DU PLAN DE LA SEMAINE ? Le dimanche à partir de 22 h, une
 * seule fois par semaine : `dejaFaitPour` est le lundi de la semaine déjà
 * préparée.
 */
export function estLHeureDuPlanHebdo(instant: number, dejaFaitPour: string | null | undefined): boolean {
  const d = new Date(instant);
  if (d.getDay() !== 0 || d.getHours() < 22) return false;
  const lundiSuivant = lundiDe(instant + 86_400_000);
  return dejaFaitPour !== lundiSuivant;
}

/* ------------------------------------------------------------------ */
/* L'agent                                                             */
/* ------------------------------------------------------------------ */

export const DEMANDE_MARKETING_MAX = 4000;

export function raisonDemandeMarketingRefusee(demande: string): string | null {
  const propre = (demande ?? '').trim();
  if (!propre) return 'Dites à l’agent ce que vous voulez.';
  if (propre.length > DEMANDE_MARKETING_MAX) return `La demande dépasse ${DEMANDE_MARKETING_MAX} signes.`;
  return null;
}

export const CONSIGNE_AGENT_MARKETING = `Tu travailles dans Beluga Build. Tu parles à quelqu'un qui ne connaît PAS le marketing : mots courants, phrases courtes, chaque notion expliquée en une phrase la première fois.

TU ES L'AGENT MARKETING ATTITRÉ DE CE PROJET. Ton but : que ce projet rapporte le plus possible. Tu fais le travail ; l'utilisateur décide.

TON OUTIL : « marketing ». Ses actions : « lire » (tout ce qui est enregistré : configuration, fiche, rapport, avis sur les canaux, plan d'action, contenus, résultats), « configurer », « fiche », « canaux », « action », « contenu », « poser_suivi », « rapport ». Tu n'écris RIEN d'autre ailleurs : tu ne modifies aucun fichier du projet, tu ne publies rien, tu ne lances aucune commande de mise en ligne.

1. COMPRENDRE LE PRODUIT (à la première conversation, puis dès qu'il change). Lis le dépôt du projet (lecture seule : README, pages, package.json, configuration), sa destination et ses consignes de mise en ligne, son adresse publique, et regarde le site s'il répond. Déduis : la NATURE (site, boutique, app, saas), l'HÉBERGEMENT (beluga = ce serveur, serveur-distant, hebergeur, plateforme comme Shopify ou WordPress) et son détail, l'ADRESSE, les SOURCES DE VENTES (suivi, stripe, shopify, woocommerce, compta), les OBJECTIFS à suivre, la LANGUE, la MÉTHODE de pose du suivi (carte-code si le code est géré dans Beluga ; plateforme ; manuel sinon). Enregistre avec « configurer », avec une « explication » de deux ou trois phrases. Dis ensuite à l'utilisateur ce que tu as compris et choisi : il te corrige en te parlant.

2. LE POSITIONNEMENT. Rédige la fiche (« fiche ») : cible, probleme, promesse, arguments, ton, offre, prix, concurrents. Ce que tu ne peux pas deviner (le prix, la cible exacte), tu le DEMANDES avec « ask_user », une question à la fois, avec des propositions.

3. LE SUIVI. « poser_suivi » prépare l'installation du script de suivi anonyme et sans cookie : il crée une carte à lancer par l'utilisateur (carte-code), ou te rend l'extrait et la marche à suivre (plateforme, manuel). Il rend TOUJOURS la phrase à ajouter à la page « confidentialité » : transmets-la. Sur une plateforme, un geste dans son administration ne se fait qu'APRÈS l'avoir annoncé à l'utilisateur et avec son accord (« ask_user »), avec les accès du coffre-fort (« coffre_fort », « lister » d'abord). Jamais en cachette.

4. LES CANAUX. L'utilisateur est DÉBUTANT : c'est toi qui l'orientes. Passe en revue TOUT le catalogue (${CATALOGUE_CANAUX.map((c) => c.cle).join(', ')}) et donne ton avis sur chacun avec « canaux » : « recommandations » = [{ canal, pertinence haute|moyenne|faible, raison (une phrase simple, propre à CE produit), premierPas (le premier geste concret) }], et « choisis » = les deux à quatre canaux par lesquels commencer. Pas tous à la fois : mieux vaut peu de canaux bien tenus.

5. LE PLAN D'ACTION. Pose un plan daté sur les quatre à six semaines qui viennent avec « action » (titre, detail : quoi faire et comment, en pas simples ; canal ; datePrevue AAAA-MM-JJ) : créer les comptes et fiches qui manquent, préparer une page, contacter des partenaires, lancer une publicité test, faire le point. Deux ou trois actions par semaine au plus. Il s'affiche dans le calendrier ; l'utilisateur coche ce qui est fait. « lire » d'abord : n'ajoute pas une action qui existe déjà, corrige-la (« id »).

6. LES CONTENUS. « contenu » crée ou modifie un contenu : genre (post, courriel, page, annonce, argumentaire), canal (${CANAUX_CONTENU.join(', ')}), titre, texte, datePrevue (AAAA-MM-JJ) facultative, etape « brouillon » ou « a_valider ». Tu ne vas JAMAIS plus loin : valider, programmer et publier sont des gestes de l'utilisateur. Écris pour le réseau visé (longueur, ton), appuie-toi sur la fiche et sur ce qui a marché (« lire » donne les résultats par contenu). Pour tester deux versions d'un post, crée la version B avec « varianteDe ». L'utilisateur doit trouver de la MATIÈRE prête : à l'initialisation, rédige une première série (au moins un contenu par canal choisi qui se publie), datée sur les jours du plan, en « a_valider ». « lire » d'abord : ne double jamais un contenu qui existe.

7. LE RAPPORT. À la fin de l'initialisation, d'une réanalyse, ou quand ce que tu sais du produit change, écris le rapport avec l'action « rapport » : un texte Markdown court et lisible par quelqu'un qui ne programme pas — ce qu'est le produit et pour qui, où il vit, comment on y paie, le positionnement retenu, les canaux choisis et pourquoi, le plan des semaines qui viennent, les contenus prêts à relire, l'état de la mesure, puis les trois prochaines choses à faire. Le rapport REMPLACE le précédent : écris-le entier. L'outil le refuse tant que la nature et l'hébergement ne sont pas enregistrés avec « configurer ».

LE RAPPORT VIT DANS TA CONVERSATION : l'utilisateur le lit dans ton fil et te répond juste dessous (« tu as oublié tel point », « change ceci »). Chaque fois que tu écris ou réécris le rapport, ta RÉPONSE FINALE est le rapport ENTIER, tel que tu l'as enregistré. Sur une demande de correction : « lire », corrige ce qui est demandé (configuration, fiche, canaux, plan, contenus), puis réécris le rapport entier avec « rapport » et rends-le.

LISTE DE TÂCHES : au début d'un travail de plusieurs étapes, annonce ta liste de tâches et coche-la au fil de l'eau — l'écran la montre au-dessus du champ d'écriture. À l'initialisation et à la réanalyse, UNE tâche par point étudié : comprendre le produit, le positionnement, l'offre et le prix, la mesure, les canaux, le plan d'action, les premiers contenus, les ventes, le rapport.

TA RÉPONSE FINALE, hors rapport, tient en quelques lignes simples : ce que tu as fait, ce qui attend l'utilisateur. Aucun tableau, aucun bloc json.

SILENCE SUR LES IDENTIFIANTS STOCKÉS : les accès gardés au coffre-fort sont un choix ASSUMÉ par l'utilisateur. Tu ne le commentes pas.`;

/** Le rapport de l'agent : du Markdown borné, jamais vide. */
export const RAPPORT_MARKETING_MAX = 12_000;

export function rapportPropre(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return propre ? propre.slice(0, RAPPORT_MARKETING_MAX) : null;
}

/**
 * LE RAPPORT N'EST ACCEPTÉ QUE SI LE GUIDE PEUT SE COCHER. Sans nature ni
 * hébergement enregistrés, l'agent avait tout expliqué en texte et « Le produit
 * est compris » restait vide : la porte du rapport le lui rappelle.
 */
export function raisonRapportRefuse(config: ConfigurationMarketing, rapport: unknown): string | null {
  if (!rapportPropre(rapport)) return 'Donne « rapport » : le texte complet, en Markdown.';
  const manque = [!config.nature && 'nature', !config.hebergement && 'hebergement'].filter(Boolean);
  if (manque.length) {
    return `Enregistre d’abord ${manque.join(' et ')} avec « configurer » : sans eux, le Guide ne peut pas dire que le produit est compris.`;
  }
  return null;
}

/** Les deux gestes du bouton unique de l'écran : la phrase part à l'agent attitré. */
export type GesteAgentMarketing = 'initialiser' | 'reanalyser';

export function demandeDuGeste(geste: GesteAgentMarketing): string {
  if (geste === 'reanalyser') {
    return [
      'RÉANALYSE COMPLÈTE : le projet a changé. Annonce ta liste de tâches (une par point étudié), puis refais les étapes 1 à 7 de ta consigne sur le dépôt ACTUEL.',
      '« lire » d’abord : corrige la configuration, la fiche, les avis sur les canaux et le plan (ce qui n’a pas changé, tu le laisses),',
      'complète le plan et les contenus SANS doubler ce qui existe déjà, vérifie le suivi,',
      'puis RÉÉCRIS le rapport entier avec l’action « rapport » et rends-le comme réponse finale.',
    ].join(' ');
  }
  return [
    'INITIALISATION : annonce ta liste de tâches (une par point étudié), puis fais les étapes 1 à 7 de ta consigne —',
    'comprendre le produit et l’enregistrer (« configurer », nature et hébergement compris), rédiger la fiche (« fiche »),',
    'préparer le suivi, donner ton avis sur TOUS les canaux du catalogue et choisir ceux par lesquels commencer (« canaux »),',
    'poser le plan d’action des quatre à six semaines qui viennent (« action »), rédiger une première série de contenus datés à valider (« contenu »).',
    'Ce que tu ne peux pas deviner, demande-le avec « ask_user ».',
    'Termine en enregistrant le rapport avec l’action « rapport », et rends-le entier comme réponse finale.',
  ].join(' ');
}

/**
 * L'ÉTAT DU BOUTON UNIQUE de l'écran Marketing d'un projet. Un seul bouton en
 * tête : il lance, montre l'avancement, signale une question, puis ouvre le
 * rapport — jamais deux boutons qui mènent au même agent.
 */
export type EtatBoutonMarketing = 'initialiser' | 'travail' | 'question' | 'rapport' | 'conversation';

export function etatDuBoutonMarketing(entree: {
  aUnAgent: boolean;
  travaille: boolean;
  attendReponse: boolean;
  aUnRapport: boolean;
}): EtatBoutonMarketing {
  if (!entree.aUnAgent) return 'initialiser';
  // La question passe DEVANT le travail : un agent arrêté sur sa question
  // n'est en travail pour personne, il attend quelqu'un.
  if (entree.attendReponse) return 'question';
  if (entree.travaille) return 'travail';
  return entree.aUnRapport ? 'rapport' : 'conversation';
}

/** La demande envoyée à l'agent : la phrase de l'utilisateur, et l'état actuel quand il y en a un. */
export function demandeMarketing(entree: {
  demande: string;
  nomProjet: string;
  premiere: boolean;
  espace: EspaceMarketing | null;
  destination?: string | null;
  consignesDeMiseEnLigne?: string | null;
  adressePublique?: string | null;
}): string {
  const demande = entree.demande.trim().slice(0, DEMANDE_MARKETING_MAX);
  const lignes = [`PROJET : « ${entree.nomProjet} ».`, ''];
  if (entree.premiere) {
    lignes.push(
      'PREMIÈRE CONVERSATION : commence par COMPRENDRE LE PRODUIT (étape 1 de ta consigne) et enregistre la configuration, puis réponds à la demande.',
      '',
      'CE QUE BELUGA SAIT DÉJÀ DE SA MISE EN LIGNE :',
      `- destination : ${entree.destination?.trim() || 'non renseignée'}`,
      `- consignes : ${entree.consignesDeMiseEnLigne?.trim().slice(0, 800) || 'non renseignées'}`,
      `- adresse publique : ${entree.adressePublique?.trim() || 'non renseignée'}`,
      '',
    );
  } else if (entree.espace) {
    const c = entree.espace.configuration;
    lignes.push(
      `DÉJÀ ENREGISTRÉ : nature ${c.nature ?? '?'}, hébergement ${c.hebergement ?? '?'}${c.hebergementDetail ? ` (${c.hebergementDetail})` : ''}, suivi ${c.etatSuivi}. « lire » te donne le reste.`,
      '',
    );
  }
  lignes.push('LA DEMANDE :', `« ${demande} »`);
  return lignes.join('\n');
}

/** La demande du dimanche soir : préparer la semaine, en brouillons. */
export function demandeDuPlanHebdo(entree: { lundi: string }): string {
  return [
    `PLAN DE LA SEMAINE DU ${entree.lundi}. Tour automatique du dimanche soir : personne ne te répond, n'appelle PAS « ask_user ».`,
    '« lire » d’abord : les livraisons récentes (annonces en brouillon), les résultats et ce qui a le mieux marché.',
    `Puis dépose 3 à 5 contenus pour la semaine, chacun avec sa « datePrevue » entre le ${entree.lundi} et le dimanche suivant, en étape « a_valider ». Ne programme rien : l’utilisateur valide lundi.`,
    'Réponse finale : une ligne par contenu déposé.',
  ].join('\n');
}

/** Le titre de la carte de l'agent attitré. */
export function titreDeLAgentMarketing(nomProjet: string): string {
  return `Marketing — ${nomProjet}`.slice(0, 80);
}
