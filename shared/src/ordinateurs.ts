/**
 * LES ORDINATEURS DE LA PERSONNE (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026).
 *
 * Un ORDINATEUR est ce que la personne nomme (« Mac mini du bureau ») : il porte ses NAVIGATEURS reliés (l'extension
 * Beluga dans Chrome, dans Safari) et, sur un Mac, le PROGRAMME DU MAC (le relais, `shared/src/relais-mac.ts`). Depuis
 * le téléphone, on choisit l'ordinateur visé (bouton « Ordinateur » de la barre d'écriture, ou « /ordinateur:<nom> »
 * dans le message) ; l'agent agit alors dans le navigateur de CET ordinateur, et peut y ouvrir une application.
 *
 * Règles PURES, testées seules (`server/src/test/ordinateurs.test.ts`) : nom, repère court (slug), résolution d'un
 * nom écrit, choix par défaut, navigateur à prendre, capacités de Safari.
 */
import { minusculesSansAccents } from './mots.js';
import type { EtatDuRelais } from './relais-mac.js';

/** Au plus vingt ordinateurs par compte. */
export const ORDINATEURS_MAX = 20;

/** Le nom pris quand rien n'est donné. */
export const NOM_D_ORDINATEUR_PAR_DEFAUT = 'Ordinateur';

/** Attendre au plus ce délai qu'un navigateur relancé par le programme du Mac se reconnecte. */
export const ATTENTE_RECONNEXION_NAVIGATEUR_MS = 60_000;

export const NAVIGATEURS = ['chrome', 'safari'] as const;
export type GenreDeNavigateur = (typeof NAVIGATEURS)[number];

export function genreDeNavigateur(brut: unknown): GenreDeNavigateur {
  return brut === 'safari' ? 'safari' : 'chrome';
}

export const LIBELLE_DU_NAVIGATEUR: Record<GenreDeNavigateur, string> = { chrome: 'Chrome', safari: 'Safari' };

/** Un nom d'ordinateur propre : sans caractère de contrôle, espaces resserrés, 60 signes au plus. */
export function normaliserLeNomDOrdinateur(brut: unknown, defaut = NOM_D_ORDINATEUR_PAR_DEFAUT): string {
  const net = String(brut ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return net || defaut;
}

/**
 * LE NOM PROPOSÉ À LA LIAISON D'UN NAVIGATEUR : une extension ne connaît pas le nom de l'ordinateur, seulement sa
 * plateforme (« macOS », « Windows »). « Chrome · macOS » devient « Mac », « Windows » devient « PC ».
 */
export function nomProposeDepuisLaPlateforme(plateforme: unknown): string {
  const p = minusculesSansAccents(String(plateforme ?? ''));
  if (/mac/.test(p)) return 'Mac';
  if (/win/.test(p)) return 'PC';
  if (/linux|chrome ?os/.test(p)) return 'Ordinateur Linux';
  return NOM_D_ORDINATEUR_PAR_DEFAUT;
}

/** Un nom donné par défaut (pas choisi par la personne) : le vrai nom du Mac peut le remplacer. */
export function nomGenerique(nom: string): boolean {
  return ['mac', 'pc', 'ordinateur', 'ordinateur linux', 'chrome', 'chrome · macos', 'safari'].includes(minusculesSansAccents(nom.trim()));
}

/** Le repère court d'un nom, pour « /ordinateur:<repère> » : minuscules sans accents, tirets. */
export function repereDOrdinateur(nom: string): string {
  return (
    minusculesSansAccents(nom)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ordinateur'
  );
}

/* ------------------------------------------------------------------ */
/* Ce qu'on sait d'un ordinateur                                        */
/* ------------------------------------------------------------------ */

export interface NavigateurDOrdinateur {
  id: string;
  genre: GenreDeNavigateur;
  enLigne: boolean;
  version: string | null;
  /** Autorisée en navigation privée (extension 1.0.11 et plus) ; `null`/absent quand elle ne le dit pas. */
  incognito?: boolean | null;
  vuLe: number | null;
  /** Les agents qui travaillent dans ce navigateur en ce moment. */
  agentsAuTravail: number;
}

/**
 * LES DEUX AUTORISATIONS DE macOS du programme du Mac (carte « Installation guidée sur le Mac », 15/11/2026) : vraie,
 * fausse, ou `null` quand le Mac n'a pas pu le dire.
 */
export interface AutorisationsDuMac {
  accessibilite: boolean | null;
  ecran: boolean | null;
}

export interface ProgrammeDuMac {
  id: string;
  etat: EtatDuRelais;
  vuLe: number | null;
  /** `null` : programme d'avant « Beluga Relais » (il ne rapporte rien), ou pas encore de nouvelles. */
  autorisations: AutorisationsDuMac | null;
}

/** Les deux autorisations sont-elles données ? (Pour cocher l'étape de l'assistant.) */
export function autorisationsDonnees(p: Pick<ProgrammeDuMac, 'autorisations'> | null | undefined): boolean {
  return p?.autorisations?.accessibilite === true && p.autorisations.ecran === true;
}

export interface Ordinateur {
  id: string;
  nom: string;
  /** Le repère court (« mac-mini-du-bureau ») : celui que « /ordinateur:… » écrit. */
  repere: string;
  creeLe: number;
  navigateurs: NavigateurDOrdinateur[];
  programme: ProgrammeDuMac | null;
}

/** Le programme du Mac répond-il (même si la recopie de l'iPhone est fermée) ? */
export function programmeEnLigne(p: ProgrammeDuMac | null | undefined): boolean {
  return !!p && p.etat !== 'absent' && p.etat !== 'hors-ligne';
}

/** Un ordinateur est ALLUMÉ quand un de ses navigateurs ou son programme répond. */
export function ordinateurEnLigne(o: Pick<Ordinateur, 'navigateurs' | 'programme'>): boolean {
  return o.navigateurs.some((n) => n.enLigne) || programmeEnLigne(o.programme);
}

/** La dernière fois qu'on a eu de ses nouvelles. */
export function ordinateurVuLe(o: Pick<Ordinateur, 'navigateurs' | 'programme'>): number | null {
  const dates = [...o.navigateurs.map((n) => n.vuLe), o.programme?.vuLe ?? null].filter((d): d is number => typeof d === 'number');
  return dates.length ? Math.max(...dates) : null;
}

/**
 * LE NAVIGATEUR À PRENDRE SUR UN ORDINATEUR : un Chrome en ligne d'abord (il sait tout faire), sinon un Safari en
 * ligne. `null` si aucun ne répond.
 */
export function navigateurAPrendre(o: Pick<Ordinateur, 'navigateurs'>): NavigateurDOrdinateur | null {
  const enLigne = o.navigateurs.filter((n) => n.enLigne);
  return enLigne.find((n) => n.genre === 'chrome') ?? enLigne[0] ?? null;
}

/** Le navigateur à RELANCER quand aucun ne répond : Chrome s'il y en a un, sinon Safari. */
export function navigateurARelancer(o: Pick<Ordinateur, 'navigateurs'>): GenreDeNavigateur | null {
  if (!o.navigateurs.length) return null;
  return o.navigateurs.some((n) => n.genre === 'chrome') ? 'chrome' : 'safari';
}

/* ------------------------------------------------------------------ */
/* Résoudre un nom, choisir par défaut                                  */
/* ------------------------------------------------------------------ */

/**
 * UN ORDINATEUR DÉSIGNÉ PAR ÉCRIT (« Mac mini », « mac-mini », son identifiant, l'identifiant d'un de ses
 * navigateurs) — CHERCHÉ SEULEMENT DANS LA LISTE DONNÉE, celle du compte de la personne qui parle : un ordinateur
 * d'un autre compte n'est jamais trouvé, même par son nom exact.
 */
export function resoudreLOrdinateur<T extends Pick<Ordinateur, 'id' | 'nom' | 'navigateurs'>>(ordinateurs: readonly T[], brut: unknown): T | null {
  const texte = String(brut ?? '').trim();
  if (!texte) return null;
  const parId = ordinateurs.find((o) => o.id === texte || o.navigateurs.some((n) => n.id === texte));
  if (parId) return parId;
  const cle = minusculesSansAccents(texte);
  const parNom = ordinateurs.find((o) => minusculesSansAccents(o.nom) === cle);
  if (parNom) return parNom;
  const repere = repereDOrdinateur(texte);
  return ordinateurs.find((o) => repereDOrdinateur(o.nom) === repere) ?? null;
}

/**
 * L'ORDINATEUR VISÉ PAR DÉFAUT : celui retenu (carte, conversation), s'il existe encore ; sinon le dernier utilisé par
 * le compte ; sinon le seul relié. `null` : plusieurs, aucun choix — l'agent demande.
 */
export function ordinateurParDefaut<T extends Pick<Ordinateur, 'id'>>(ordinateurs: readonly T[], retenu?: string | null, dernierUtilise?: string | null): T | null {
  if (!ordinateurs.length) return null;
  const parRetenu = retenu ? ordinateurs.find((o) => o.id === retenu) : undefined;
  if (parRetenu) return parRetenu;
  const parDernier = dernierUtilise ? ordinateurs.find((o) => o.id === dernierUtilise) : undefined;
  if (parDernier) return parDernier;
  return ordinateurs.length === 1 ? ordinateurs[0]! : null;
}

export type ChoixDeLOrdinateur =
  | { genre: 'aucun'; texte: string }
  | { genre: 'choisir'; ordinateurs: Ordinateur[] }
  | { genre: 'pret'; ordinateur: Ordinateur; navigateur: NavigateurDOrdinateur }
  /** Aucun navigateur ne répond, mais le programme du Mac oui : il peut relancer le navigateur. */
  | { genre: 'relancer'; ordinateur: Ordinateur; navigateur: GenreDeNavigateur }
  | { genre: 'injoignable'; ordinateur: Ordinateur; texte: string };

/**
 * OÙ L'AGENT TRAVAILLE-T-IL ? L'ordinateur (voulu, retenu, dernier, seul), puis son navigateur. Jamais de bascule sur
 * un autre ordinateur quand celui-ci ne répond pas (décision de l'utilisateur du 15/11/2026).
 */
export function choisirLOrdinateur(
  ordinateurs: readonly Ordinateur[],
  entree: { voulu?: string | null; retenu?: string | null; dernierUtilise?: string | null } = {},
): ChoixDeLOrdinateur {
  const avecNavigateur = ordinateurs.filter((o) => o.navigateurs.length);
  if (!avecNavigateur.length) {
    return {
      genre: 'aucun',
      texte:
        "Aucun navigateur n'est relié à Beluga pour la personne qui te parle. Dis-lui d'installer l'extension (Chrome ou Safari) depuis Réglages → Extension, puis de la relier à son ordinateur avec le code affiché.",
    };
  }
  const voulu = entree.voulu ? resoudreLOrdinateur(ordinateurs, entree.voulu) : null;
  const ordinateur = voulu ?? ordinateurParDefaut(ordinateurs, entree.retenu, entree.dernierUtilise) ?? (avecNavigateur.length === 1 ? avecNavigateur[0]! : null);
  if (!ordinateur) return { genre: 'choisir', ordinateurs: [...avecNavigateur] };
  if (!ordinateur.navigateurs.length) {
    return {
      genre: 'injoignable',
      ordinateur,
      texte: `Aucun navigateur n'est relié sur « ${ordinateur.nom} ». Dis-le à la personne : elle peut relier l'extension sur cet ordinateur depuis Réglages → Extension, ou choisir un autre ordinateur.`,
    };
  }
  const navigateur = navigateurAPrendre(ordinateur);
  if (navigateur) return { genre: 'pret', ordinateur, navigateur };
  const aRelancer = navigateurARelancer(ordinateur);
  if (aRelancer && programmeEnLigne(ordinateur.programme)) return { genre: 'relancer', ordinateur, navigateur: aRelancer };
  return { genre: 'injoignable', ordinateur, texte: texteInjoignable(ordinateur.nom, !!ordinateur.programme) };
}

export type ChoixPourFenetrePrivee =
  | { genre: 'pret'; ordinateur: Ordinateur; navigateur: NavigateurDOrdinateur }
  | { genre: 'a-mettre-a-jour'; texte: string; aMettreAJour: string }
  | { genre: 'sans-autorisation'; texte: string; lesquels: string }
  | { genre: 'aucun'; texte: string };

/**
 * LE NAVIGATEUR D'UNE CARTE EN FENÊTRE PRIVÉE (audit GEO, décision de l'utilisateur du 19/11/2026) : l'agent le choisit
 * SEUL parmi les Chrome ALLUMÉS dont l'extension sait ouvrir une fenêtre privée (`versionMinimale`), en priorité celui
 * de l'ordinateur du dernier passage réussi, sinon le plus récemment vu. Aucun : rien ne s'ouvre, et la phrase dit
 * quoi mettre à jour et sur quel ordinateur — jamais de repli sur la fenêtre de travail.
 */
export function choisirPourFenetrePrivee(
  ordinateurs: readonly Ordinateur[],
  versionMinimale: string,
  aJour: (version: string | null) => boolean,
  dernierOrdinateur?: string | null,
): ChoixPourFenetrePrivee {
  const allumes = ordinateurs.flatMap((o) => o.navigateurs.filter((n) => n.genre === 'chrome' && n.enLigne).map((n) => ({ ordinateur: o, navigateur: n })));
  /* Un Chrome qui DIT ne pas être autorisé en navigation privée (1.0.11 et plus) n'est jamais pris : il refuserait. */
  const capables = allumes
    .filter((c) => aJour(c.navigateur.version) && c.navigateur.incognito !== false)
    .sort((a, b) => Number(b.ordinateur.id === dernierOrdinateur) - Number(a.ordinateur.id === dernierOrdinateur) || (b.navigateur.vuLe ?? 0) - (a.navigateur.vuLe ?? 0));
  const elu = capables[0];
  if (elu) return { genre: 'pret', ...elu };
  const sansAutorisation = allumes.filter((c) => aJour(c.navigateur.version) && c.navigateur.incognito === false);
  if (sansAutorisation.length) {
    const lesquels = sansAutorisation.map((c) => `« ${c.ordinateur.nom} »`).join(', ');
    return {
      genre: 'sans-autorisation',
      lesquels,
      texte: `L’extension Beluga de ${lesquels} est à jour mais n’est pas autorisée en navigation privée : rien n’a été ouvert. La personne doit cocher « Autoriser en navigation privée » dans chrome://extensions › Beluga (la bannière de Beluga ouvre cette page). Arrête la séance et dis-le dans ton compte rendu.`,
    };
  }
  if (allumes.length) {
    const aMettreAJour = allumes.map((c) => `« ${c.ordinateur.nom} » (version ${c.navigateur.version ?? 'inconnue'})`).join(', ');
    return {
      genre: 'a-mettre-a-jour',
      aMettreAJour,
      texte: `L’extension Beluga de ${aMettreAJour} est trop ancienne pour ouvrir une fenêtre privée : rien n’a été ouvert. La personne doit la mettre à jour (version ${versionMinimale} au moins, Réglages › Extension) et cocher « Autoriser en navigation privée » dans chrome://extensions › Beluga. Arrête la séance et dis-le dans ton compte rendu.`,
    };
  }
  return {
    genre: 'aucun',
    texte: 'Aucun Chrome relié n’est allumé en ce moment : rien n’a été ouvert. Arrête la séance ; le passage repartira quand l’ordinateur sera rallumé.',
  };
}

/** La phrase dite quand l'ordinateur ne répond pas : claire, sans bascule sur un autre. */
export function texteInjoignable(nom: string, avecProgramme: boolean): string {
  return avecProgramme
    ? `« ${nom} » ne répond pas (éteint ou débranché) : ni son navigateur ni son programme du Mac ne répondent. Dis-le à la personne et arrête-toi là ; ne bascule pas sur un autre ordinateur sans elle.`
    : `« ${nom} » ne répond pas : son navigateur est fermé ou l'ordinateur est éteint. Dis-le à la personne et arrête-toi là ; ne bascule pas sur un autre ordinateur sans elle.`;
}

/* ------------------------------------------------------------------ */
/* Ce que Safari sait faire                                             */
/* ------------------------------------------------------------------ */

/**
 * SAFARI N'A PAS LE DÉBOGUEUR DE CHROME (ni groupes d'onglets ni panneau latéral, vérifié dans les données de
 * compatibilité MDN). L'extension y joue lecture, clic et frappe par un script FIXE de l'extension (événements
 * synthétiques) et capture la partie visible de l'onglet. Ce qui ne se fait pas là se refuse en le DISANT.
 */
export function refusDuNavigateur(genre: GenreDeNavigateur, geste: string, args: { repere?: unknown } = {}): string | null {
  if (genre !== 'safari') return null;
  if (geste === 'deposer' && !Number.isInteger(args.repere)) {
    return 'Safari ne sait pas déposer un fichier sur une zone sans repère : relis la page avec « lire » et vise le bouton ou le champ de fichier par son repère.';
  }
  return null;
}

/** La phrase ajoutée au résultat d'un geste joué dans Safari, quand il est dégradé. */
export function avertissementSafari(geste: string, args: { pleinePage?: unknown } = {}): string | null {
  if (geste === 'capturer' && args.pleinePage) return 'Safari ne capture que la partie visible de la page : fais défiler puis recapture pour voir la suite.';
  if (geste === 'cliquer' || geste === 'ecrire' || geste === 'touche') {
    return 'Dans Safari, ce geste passe par la page (événement simulé) : si rien n’a bougé, ce site ignore les gestes simulés — dis-le à la personne.';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Ouvrir une application du Mac                                        */
/* ------------------------------------------------------------------ */

/**
 * UN NOM D'APPLICATION ACCEPTABLE : lettres, chiffres, espaces et ponctuation simple, sans chemin ni guillemet. Le
 * programme du Mac le compare EN PLUS à la liste des applications installées (`ouvrirUneApplication`,
 * `scripts/relais-mac/relais.js`) : jamais une commande libre.
 */
export function nomDApplicationValable(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const net = brut.replace(/\.app$/i, '').trim();
  if (!net || net.length > 80) return null;
  if (!/^[\p{L}\p{N} ._+&'’()-]+$/u.test(net)) return null;
  if (net.includes('..') || net.startsWith('.') || net.startsWith('-')) return null;
  return net;
}
