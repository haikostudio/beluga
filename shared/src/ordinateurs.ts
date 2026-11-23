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
import type { DroitsDOrdinateur } from './droits-d-ordinateur.js';
import type { MarqueDeNavigateur, NavigateurInstalle } from './navigateurs-de-l-ordinateur.js';

/** Au plus vingt ordinateurs par compte. */
export const ORDINATEURS_MAX = 20;

/** Le nom pris quand rien n'est donné. */
export const NOM_D_ORDINATEUR_PAR_DEFAUT = 'Ordinateur';

/** Attendre au plus ce délai qu'un navigateur relancé par le programme du Mac se reconnecte. */
export const ATTENTE_RECONNEXION_NAVIGATEUR_MS = 60_000;

export const NAVIGATEURS = ['chrome', 'safari'] as const;
export type GenreDeNavigateur = (typeof NAVIGATEURS)[number];

export function genreDeNavigateur(brut: unknown): GenreDeNavigateur {
  return brut === 'safari' || brut === 'firefox' || brut === 'orion' ? 'safari' : 'chrome';
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
  /** Le vrai navigateur (Chrome, Edge, Brave, Firefox…) annoncé par l'extension 1.0.17 ; absent : celui du genre. */
  marque?: MarqueDeNavigateur | null;
  enLigne: boolean;
  version: string | null;
  /** Autorisée en navigation privée (extension 1.0.11 et plus) ; `null`/absent quand elle ne le dit pas. */
  incognito?: boolean | null;
  vuLe: number | null;
  /** Les agents qui travaillent dans ce navigateur en ce moment. */
  agentsAuTravail: number;
  /** Quand ce navigateur a été relié : l'assistant reconnaît la liaison faite avec SON code. */
  creeLe?: number;
}

/**
 * LES DEUX AUTORISATIONS DE macOS du programme du Mac (carte « Installation guidée sur le Mac », 15/11/2026) : vraie,
 * fausse, ou `null` quand le Mac n'a pas pu le dire.
 */
export interface AutorisationsDuMac {
  accessibilite: boolean | null;
  ecran: boolean | null;
}

/**
 * LE SYSTÈME de l'ordinateur où tourne Beluga Connect (carte « Beluga Connect : installation simplifiée », 21/11/2026) :
 * l'application Mac (Swift, `connect/`) ou l'application Windows / Linux (Go, `connect/go/`). Absent : un Mac (tous les
 * programmes d'avant cette carte en sont).
 */
export type SystemeDOrdinateur = 'mac' | 'windows' | 'linux';
export const SYSTEMES_D_ORDINATEUR: readonly SystemeDOrdinateur[] = ['mac', 'windows', 'linux'];

export function systemeValable(brut: unknown): SystemeDOrdinateur | null {
  return SYSTEMES_D_ORDINATEUR.includes(brut as SystemeDOrdinateur) ? (brut as SystemeDOrdinateur) : null;
}

export interface ProgrammeDuMac {
  id: string;
  /** Le système qui fait tourner Beluga Connect ; absent : un Mac. */
  systeme?: SystemeDOrdinateur;
  /** Quand ce programme s'est relié : le parcours reconnaît l'ordinateur relié avec SON code. */
  relieLe?: number | null;
  etat: EtatDuRelais;
  vuLe: number | null;
  /** `null` : programme d'avant « Beluga Relais » (il ne rapporte rien), ou pas encore de nouvelles. */
  autorisations: AutorisationsDuMac | null;
  /** La version de Beluga Connect qui joue ce programme ; `null`/absent : ancien « Beluga Relais ». */
  connect?: string | null;
  /** Beluga Connect prépare Chrome (écran 5 de l'assistant) ; `null` : rien en cours ni récent. */
  preparation?: PreparationDeChrome | null;
  /** Beluga Connect installe Safari, APRÈS Chrome (carte « Beluga Connect : liaison sans fenêtre ») ; `null` : rien. */
  safari?: PreparationDeSafari | null;
  /** Les navigateurs trouvés sur l'ordinateur par Beluga Connect (carte « Navigateurs facultatifs ») ; `null` : pas encore dit. */
  installes?: NavigateurInstalle[] | null;
  /** La préparation des AUTRES navigateurs (Edge, Brave, Firefox…), par marque ; Chrome et Safari gardent la leur. */
  autres?: Partial<Record<MarqueDeNavigateur, PreparationDeChrome>> | null;
}

/**
 * SAFARI D'OFFICE, APRÈS CHROME (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) : Beluga Connect pose
 * l'application « Beluga » pour Safari, coche l'extension dans les réglages de Safari et lui passe le code par le
 * conteneur partagé ; « reliée » se lit sur le navigateur Safari relié lui-même. `message` : ce qui a bloqué.
 */
export interface PreparationDeSafari {
  etat: 'en-cours' | 'fait' | 'echec';
  installee: boolean | null;
  activee: boolean | null;
  message: string | null;
  depuis: number;
  majLe?: number;
}

export type EtatDUneEtapeDeSafari = 'fait' | 'en-cours' | 'a-venir' | 'echec';

/**
 * LES TROIS LIGNES DE SAFARI (installée, activée, reliée), dans l'ordre, d'après la préparation et le Safari relié.
 * `apresChrome` : Chrome n'est pas encore prêt — tout reste « à venir ».
 */
export function etapesDeSafari(
  p: PreparationDeSafari | null | undefined,
  safariRelie: boolean,
  apresChrome: boolean,
): { cle: 'installee' | 'activee' | 'reliee'; etat: EtatDUneEtapeDeSafari }[] {
  if (safariRelie) return (['installee', 'activee', 'reliee'] as const).map((cle) => ({ cle, etat: 'fait' as const }));
  if (apresChrome) return (['installee', 'activee', 'reliee'] as const).map((cle) => ({ cle, etat: 'a-venir' as const }));
  /* Chrome prêt, rien encore de Beluga Connect : l'installation est la prochaine chose qui se fait. */
  if (!p) return [
    { cle: 'installee', etat: 'en-cours' },
    { cle: 'activee', etat: 'a-venir' },
    { cle: 'reliee', etat: 'a-venir' },
  ];
  const echec = p.etat === 'echec';
  const installee: EtatDUneEtapeDeSafari = p.installee ? 'fait' : echec ? 'echec' : 'en-cours';
  const activee: EtatDUneEtapeDeSafari = p.activee ? 'fait' : !p.installee ? 'a-venir' : echec ? 'echec' : 'en-cours';
  const reliee: EtatDUneEtapeDeSafari = !p.activee ? 'a-venir' : echec ? 'echec' : 'en-cours';
  return [
    { cle: 'installee', etat: installee },
    { cle: 'activee', etat: activee },
    { cle: 'reliee', etat: reliee },
  ];
}

/**
 * LA PRÉPARATION DE CHROME PAR BELUGA CONNECT (carte « Liaison de l'extension Chrome simplifiée », 20/11/2026) :
 * extension posée et ajoutée à Chrome (`ajoutee`, `null` tant que ce n'est pas tenté), puis reliée et autorisée en
 * navigation privée — ces deux-là se lisent sur le navigateur relié lui-même. `message` : ce qui a bloqué.
 */
export interface PreparationDeChrome {
  etat: 'en-cours' | 'fait' | 'echec';
  ajoutee: boolean | null;
  message: string | null;
  depuis: number;
  /** Le dossier où Beluga Connect a posé l'extension (affiché si elle doit être chargée à la main). */
  dossier?: string | null;
  /**
   * LE SUIVI DÉTAILLÉ (carte « Liaison Chrome automatique et suivie », 22/11/2026) : le genre du travail, l'instant où
   * le code de liaison a été posé (le code de secours s'affiche 30 s après), et la dernière fois que l'état a bougé
   * (une préparation « en cours » qui ne bouge plus depuis `PREPARATION_FIGEE_APRES_MS` est un échec, jamais un
   * chargement sans fin).
   */
  travail?: TravailDeConnect;
  debutLiaison?: number | null;
  majLe?: number;
  /**
   * L'AJOUT SUIVI EN CINQ LIGNES (carte « Beluga Connect : liaison et suivi », 22/11/2026) : le mode développeur posé
   * par Beluga Connect, Chrome rouvert avec ses onglets, et le nombre d'essais (trois au plus) qu'a pris l'ajout.
   */
  developpeur?: boolean | null;
  rouvert?: boolean | null;
  essais?: number;
}

/** Ce que Beluga Connect fait sur l'ordinateur : première installation, réparation, navigation privée, mise à jour. */
export type TravailDeConnect = 'installation' | 'reparation' | 'prive' | 'mise-a-jour';

/** Le code de secours paraît 30 s après la pose du code de liaison, si Chrome ne s'est pas relié seul. */
export const SECOURS_APRES_MS = 30_000;
/** Une préparation qui ne bouge plus depuis six minutes s'est interrompue (démon redémarré, relais tombé). */
export const PREPARATION_FIGEE_APRES_MS = 6 * 60_000;

/** La préparation telle qu'on doit la montrer : une préparation figée devient un échec dit. */
export function preparationVue(p: PreparationDeChrome | null | undefined, maintenant = Date.now()): PreparationDeChrome | null {
  if (!p) return null;
  if (p.etat === 'en-cours' && maintenant - (p.majLe ?? p.depuis) > PREPARATION_FIGEE_APRES_MS) {
    return { ...p, etat: 'echec', message: p.message || 'La préparation de Chrome s’est interrompue.' };
  }
  return p;
}

/**
 * LE CODE DE SECOURS EST-IL À MONTRER ? Seulement si aucun Chrome de l'ordinateur n'est relié en ligne, et que le code
 * de liaison a été posé depuis 30 s (horodatage du démon), ou que la préparation a échoué après l'ajout de l'extension.
 */
export function codeDeSecoursAMontrer(
  p: PreparationDeChrome | null | undefined,
  chromeRelie: boolean,
  maintenant = Date.now(),
): boolean {
  if (chromeRelie || !p) return false;
  const vue = preparationVue(p, maintenant)!;
  if (vue.etat === 'echec') return vue.ajoutee === true || !!vue.debutLiaison;
  if (vue.etat !== 'en-cours' || !vue.debutLiaison) return false;
  return maintenant - vue.debutLiaison >= SECOURS_APRES_MS;
}

/** Les étapes de la préparation, cochées d'après l'état réel : pour Beluga comme pour le menu de Beluga Connect. */
export type EtapeDePreparation = 'developpeur' | 'ajoutee' | 'reliee' | 'prive' | 'rouvert';

/**
 * LES LIGNES DE « PRÉPARER CHROME », LES MÊMES PARTOUT (page de Beluga, fenêtre et volet de Beluga Connect) : sur un
 * Mac, mode développeur → extension ajoutée (vérifiée) → reliée → navigation privée → Chrome rouvert avec ses onglets ;
 * ailleurs, ajoutée → reliée. Chacune est cochée d'après l'état RÉEL ; la première qui manque est « en cours », ou
 * « échec » si la préparation a échoué.
 */
export function etapesDeLaPreparation(
  p: PreparationDeChrome | null | undefined,
  chrome: { enLigne: boolean; incognito?: boolean | null } | null | undefined,
  mac: boolean,
  maintenant = Date.now(),
): { cle: EtapeDePreparation; etat: 'fait' | 'en-cours' | 'a-venir' | 'echec' }[] {
  const vue = preparationVue(p, maintenant);
  const ajoutee = !!chrome || vue?.ajoutee === true;
  const faits: Record<EtapeDePreparation, boolean> = {
    developpeur: ajoutee || vue?.developpeur === true,
    ajoutee,
    reliee: !!chrome?.enLigne,
    prive: chrome?.incognito === true,
    /* Chrome relié tourne forcément ; sinon, ce que Beluga Connect a constaté en le rouvrant. */
    rouvert: !!chrome?.enLigne || (vue?.rouvert === true && vue.etat !== 'echec'),
  };
  const cles: EtapeDePreparation[] = mac ? ['developpeur', 'ajoutee', 'reliee', 'prive', 'rouvert'] : ['ajoutee', 'reliee'];
  const premiere = cles.find((c) => !faits[c]) ?? null;
  return cles.map((cle) => ({
    cle,
    etat: faits[cle] ? 'fait' : cle !== premiere ? 'a-venir' : vue?.etat === 'echec' ? 'echec' : 'en-cours',
  }));
}

/** Les deux autorisations sont-elles données ? (Pour cocher l'étape de l'assistant.) */
export function autorisationsDonnees(p: Pick<ProgrammeDuMac, 'autorisations' | 'systeme'> | null | undefined): boolean {
  /* Windows et Linux n'ont aucune autorisation à donner à Beluga Connect : rien n'attend la personne. */
  if (p && p.systeme && p.systeme !== 'mac') return true;
  return p?.autorisations?.accessibilite === true && p.autorisations.ecran === true;
}

export interface Ordinateur {
  id: string;
  nom: string;
  /** Le repère court (« mac-mini-du-bureau ») : celui que « /ordinateur:… » écrit. */
  repere: string;
  creeLe: number;
  /** Ce que Beluga a le droit d'y faire (`droits-d-ordinateur.ts`) ; absent : les défauts. */
  droits?: DroitsDOrdinateur;
  /**
   * LES NAVIGATEURS CHOISIS (carte « Navigateurs facultatifs à la liaison », 22/11/2026) : ceux que Beluga Connect équipe
   * et répare, et eux seuls. `null` : pas encore choisi (étape « Navigateurs » du parcours) ; `[]` : sans navigateur.
   */
  navigateursChoisis?: MarqueDeNavigateur[] | null;
  navigateurs: NavigateurDOrdinateur[];
  programme: ProgrammeDuMac | null;
}

/**
 * UN TRAVAIL DE BELUGA CONNECT EST-IL EN COURS SUR UN ORDINATEUR ? (carte « Ordinateurs : pannes et volets alignés »,
 * 22/11/2026) Tant que oui, les écrans qui suivent les ordinateurs relisent leur état toutes les
 * `RELECTURE_DES_ORDINATEURS_MS`, en SECOURS du signal poussé par le démon : un signal perdu ne laisse plus une étape
 * « en cours » à l'écran alors que l'ordinateur l'a déjà finie, réussie ou tombée. Rien en cours : aucune relecture.
 */
export const RELECTURE_DES_ORDINATEURS_MS = 5_000;

export function travailEnCoursSurUnOrdinateur(ordinateurs: readonly Pick<Ordinateur, 'programme'>[] | null | undefined): boolean {
  return (ordinateurs ?? []).some(
    (o) =>
      o.programme?.preparation?.etat === 'en-cours' ||
      o.programme?.safari?.etat === 'en-cours' ||
      Object.values(o.programme?.autres ?? {}).some((p) => p?.etat === 'en-cours'),
  );
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
