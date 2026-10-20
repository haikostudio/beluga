import { motsDeRecherche, racineDeMot, sansAccents } from './classeurs.js';
import { estUniteDeCompetence, type Importance, type Unite } from './connaissances.js';
import { titreAffiche } from './titres-humains.js';

/**
 * LES THÈMES D'UNE CATÉGORIE DE LA MÉMOIRE — ce que l'écran replie.
 *
 * Une catégorie (Conventions, Composants…) compte parfois des centaines
 * d'unités : l'écran l'ouvre sur ses THÈMES, tous repliés, chacun avec son
 * nombre (décision de l'utilisateur, carte 79083bc5). Le thème d'une unité est
 * son PREMIER sujet, ramené à sa forme canonique : les agents écrivent tantôt
 * « carte », tantôt « cartes », « ui » ou « interface » — `SUJETS_FUSIONNES`
 * les réunit. Un thème trop maigre dans une catégorie rejoint « Autres sujets »,
 * pour que la liste des thèmes reste courte.
 *
 * La recherche en tête de la liste (`uniteCorrespond`) mord sur le titre clair,
 * le titre technique, le résumé et les sujets : chaque mot cherché doit s'y
 * trouver, par sa racine.
 */

/** Un sujet écrit autrement → sa forme canonique. */
export const SUJETS_FUSIONNES: Readonly<Record<string, string>> = {
  carte: 'cartes',
  ui: 'interface',
  'ui-commune': 'interface',
  design: 'interface',
  css: 'interface',
  'design-system': 'interface',
  drawer: 'interface',
  colonne: 'tableau',
  colonnes: 'tableau',
  projet: 'projets',
  'projet-beluga': 'projets',
  deploiement: 'publication',
  'mise-en-ligne': 'publication',
  production: 'publication',
  build: 'publication',
  test: 'tests',
  verification: 'tests',
  verifications: 'tests',
  essais: 'tests',
  courriel: 'courriels',
  'e-mail': 'courriels',
  email: 'courriels',
  notification: 'notifications',
  agent: 'agents',
  moteur: 'moteurs',
  'fil-memoire': 'memoire',
  donnees: 'base-de-donnees',
  pocketbase: 'base-de-donnees',
  sqlite: 'base-de-donnees',
  postgres: 'base-de-donnees',
  migration: 'base-de-donnees',
  authentification: 'securite',
  auth: 'securite',
  i18n: 'langues',
  traductions: 'langues',
  langue: 'langues',
  'journal-carte': 'journal',
  flux: 'journal',
  'flux-en-points': 'journal',
  git: 'branches',
  worktree: 'branches',
  infrastructure: 'serveur',
  hetzner: 'serveur',
  docker: 'serveur',
  systemd: 'serveur',
  abonnements: 'paiement',
  stripe: 'paiement',
  chat: 'conversation',
  composer: 'composeur',
  telemetrie: 'statistiques',
  mesure: 'statistiques',
  image: 'images',
  vocal: 'voix',
  audio: 'voix',
  pwa: 'mobile',
  ios: 'mobile',
  android: 'mobile',
  backups: 'sauvegardes',
  sauvegarde: 'sauvegardes',
  'coffre-fort': 'coffre',
};

/** Le nom lisible des thèmes courants ; un thème inconnu se dit par son sujet, joliment écrit. */
export const LIBELLES_DES_THEMES: Readonly<Record<string, string>> = {
  interface: 'Interface',
  publication: 'Publication',
  competences: 'Compétences',
  methode: 'Méthode de travail',
  cartes: 'Cartes',
  tests: 'Vérifications',
  mobile: 'Téléphone et application installée',
  projets: 'Projets',
  architecture: 'Architecture',
  securite: 'Sécurité et connexion',
  vitrine: 'Site vitrine',
  quotas: 'Quotas et comptes',
  notifications: 'Notifications',
  demo: 'Démonstration',
  voix: 'Voix et son',
  agents: 'Agents',
  moteurs: 'Moteurs',
  convention: 'Conventions',
  navigateur: 'Navigateur',
  environnement: 'Environnement',
  cadrage: 'Cadrage',
  'base-de-donnees': 'Données',
  branches: 'Branches et copies de travail',
  memoire: 'Mémoire',
  'espace-client': 'Espace client',
  outils: 'Outils',
  performance: 'Rapidité',
  sauvegardes: 'Sauvegardes',
  animation: 'Animations',
  paiement: 'Paiement et abonnements',
  comptes: 'Comptes',
  studio: 'Studio',
  statistiques: 'Statistiques',
  recherche: 'Recherche',
  plan: 'Plan',
  'pieces-jointes': 'Pièces jointes',
  operation: 'Exploitation',
  serveur: 'Serveur',
  navigation: 'Navigation',
  langues: 'Langues',
  conversation: 'Conversation',
  tableau: 'Tableau et colonnes',
  admin: 'Administration',
  scripts: 'Scripts',
  surveillance: 'Surveillance des sites',
  live: 'Direct',
  api: 'Échanges avec d’autres services',
  integration: 'Services extérieurs',
  documents: 'Documents',
  composeur: 'Champ d’écriture',
  reglages: 'Réglages',
  images: 'Images',
  courriels: 'Courriels',
  journal: 'Journal et fil des agents',
  coffre: 'Coffre-fort',
  divers: 'Divers',
};

export const THEME_AUTRES = 'autres';
export const LIBELLE_THEME_AUTRES = 'Autres sujets';
/** Un thème qui compte moins d'unités que ceci dans une catégorie rejoint « Autres sujets ». */
export const MIN_UNITES_D_UN_THEME = 3;

const ORDRE_IMPORTANCE: Record<Importance, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** La forme canonique d'un sujet. */
export function sujetCanonique(sujet: string): string {
  const id = sansAccents(String(sujet ?? ''))
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SUJETS_FUSIONNES[id] ?? id;
}

/**
 * Les sujets qu'une COMPÉTENCE porte pour être retrouvée, pas pour dire de quoi
 * elle parle : « competences » (toutes l'ont), « projet-<nom> » (sa portée) et
 * « bibliotheque-<nom> » (sa provenance). Sans les sauter, les 488 compétences
 * du Global tombaient toutes dans un seul thème « Compétences ».
 */
function sujetDeRangementDeCompetence(sujet: string): boolean {
  return sujet === 'competences' || sujet.startsWith('projet-') || sujet.startsWith('bibliotheque-');
}

/**
 * Le thème d'une unité : son premier sujet canonique, sinon « divers ». Pour une
 * compétence (reconnue à sa source), son premier THÈME déclaré.
 */
export function themeDeLUnite(u: Pick<Unite, 'sujets'> & Partial<Pick<Unite, 'source'>>): string {
  const competence = u.source ? estUniteDeCompetence(u as Pick<Unite, 'source'>) : false;
  for (const s of u.sujets ?? []) {
    if (competence && sujetDeRangementDeCompetence(s)) continue;
    const c = sujetCanonique(s);
    if (c) return c;
  }
  return 'divers';
}

/** Le nom d'un thème, en français : connu, sinon le sujet avec ses tirets rendus en espaces. */
export function libelleDuTheme(theme: string): string {
  if (theme === THEME_AUTRES) return LIBELLE_THEME_AUTRES;
  const connu = LIBELLES_DES_THEMES[theme];
  if (connu) return connu;
  const mots = theme.replace(/-/g, ' ').trim();
  return mots ? mots.charAt(0).toUpperCase() + mots.slice(1) : LIBELLES_DES_THEMES.divers!;
}

export interface ThemeDeCategorie<U> {
  theme: string;
  libelle: string;
  unites: U[];
  /** Combien sont vitales (P0) : l'écran le montre sur le thème replié. */
  vitales: number;
  /** La date de création la plus récente du thème (0 si inconnue) : la liste dit « dernier ajout ». */
  dernierAjout: number;
}

/** Les plus importantes d'abord, puis par identifiant. */
export function trierParImportance<U extends Pick<Unite, 'importance' | 'id'>>(unites: readonly U[]): U[] {
  return [...unites].sort((a, b) => ORDRE_IMPORTANCE[a.importance] - ORDRE_IMPORTANCE[b.importance] || a.id.localeCompare(b.id));
}

/**
 * LES PLUS RÉCENTES D'ABORD (demande de l'utilisateur, 2026-10-20 : « venir dans
 * une catégorie, un thème, et voir ce qui a été créé dernièrement »). Environ
 * 2 600 unités partagent la date de la reprise de septembre : à date égale,
 * l'importance départage, puis l'identifiant (le plus grand est le plus jeune).
 */
export function trierParDateDeCreation<U extends Pick<Unite, 'importance' | 'id'> & Partial<Pick<Unite, 'creeLe'>>>(unites: readonly U[]): U[] {
  return [...unites].sort(
    (a, b) => (b.creeLe ?? 0) - (a.creeLe ?? 0) || ORDRE_IMPORTANCE[a.importance] - ORDRE_IMPORTANCE[b.importance] || b.id.localeCompare(a.id),
  );
}

/** Les genres de source d'une unité REPRISE d'un ancien rangement : sa date est celle de la reprise, pas celle du fait. */
const GENRES_REPRIS: ReadonlySet<string> = new Set(['note', 'depot']);

/** L'unité a-t-elle été reprise d'un ancien rangement (l'écran dit « reprise le … » au lieu de « ajoutée le … ») ? */
export function uniteReprise(u: Partial<Pick<Unite, 'source'>>): boolean {
  return GENRES_REPRIS.has(String(u.source?.genre ?? ''));
}

export interface OptionsDeGroupement {
  /** Le seuil sous lequel un thème rejoint « Autres sujets ». */
  minimum?: number;
  /**
   * « importance » (défaut) : les vitales d'abord, les thèmes les plus fournis
   * d'abord. « date » : les plus récentes d'abord, et les thèmes au dernier
   * ajout le plus récent d'abord.
   */
  tri?: 'importance' | 'date';
}

/**
 * Les thèmes d'une catégorie : les plus fournis d'abord (ou les plus récemment
 * nourris, en tri par date), « Autres sujets » à la fin, chaque thème trié des
 * plus vitales aux moins importantes (ou des plus récentes aux plus anciennes).
 */
export function grouperLesUnitesParTheme<U extends Pick<Unite, 'sujets' | 'importance' | 'id'> & Partial<Pick<Unite, 'creeLe' | 'source'>>>(
  unites: readonly U[],
  options: number | OptionsDeGroupement = {},
): ThemeDeCategorie<U>[] {
  const { minimum = MIN_UNITES_D_UN_THEME, tri = 'importance' } = typeof options === 'number' ? { minimum: options } : options;
  const trier = tri === 'date' ? trierParDateDeCreation : trierParImportance;
  const parTheme = new Map<string, U[]>();
  for (const u of unites) {
    const t = themeDeLUnite(u);
    parTheme.set(t, [...(parTheme.get(t) ?? []), u]);
  }
  const theme = (cle: string, libelle: string, liste: U[]): ThemeDeCategorie<U> => ({
    theme: cle,
    libelle,
    unites: trier(liste),
    vitales: liste.filter((u) => u.importance === 'P0').length,
    dernierAjout: liste.reduce((max, u) => Math.max(max, u.creeLe ?? 0), 0),
  });
  const autres: U[] = [];
  const themes: ThemeDeCategorie<U>[] = [];
  for (const [cle, liste] of parTheme) {
    if (liste.length < minimum && parTheme.size > 1) autres.push(...liste);
    else themes.push(theme(cle, libelleDuTheme(cle), liste));
  }
  themes.sort(
    tri === 'date'
      ? (a, b) => b.dernierAjout - a.dernierAjout || b.unites.length - a.unites.length || a.libelle.localeCompare(b.libelle)
      : (a, b) => b.unites.length - a.unites.length || a.libelle.localeCompare(b.libelle),
  );
  if (autres.length) themes.push(theme(THEME_AUTRES, LIBELLE_THEME_AUTRES, autres));
  return themes;
}

/** Le texte où cherche l'écran : titre clair, titre technique, résumé, sujets, identifiant. */
function texteCherchable(u: Pick<Unite, 'titre' | 'titreHumain' | 'resume' | 'sujets' | 'id'>): string {
  return sansAccents([titreAffiche(u), u.titre, u.resume, (u.sujets ?? []).join(' '), u.id].join(' ')).toLowerCase();
}

/**
 * Une unité correspond-elle à la recherche ? Chaque mot cherché doit s'y
 * trouver, par sa racine (« déploiement » trouve « déployer »). Une recherche
 * vide laisse tout passer.
 */
export function uniteCorrespond(u: Pick<Unite, 'titre' | 'titreHumain' | 'resume' | 'sujets' | 'id'>, demande: string): boolean {
  const mots = motsDeRecherche(demande);
  if (!mots.length) return true;
  const texte = texteCherchable(u);
  return mots.every((m) => texte.includes(racineDeMot(m)));
}
