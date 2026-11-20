/**
 * LA MISE À JOUR DE L'EXTENSION CHROME DES MAC — les règles pures (carte « Extension à jour et Jarvis tout en voix »,
 * 20/11/2026).
 *
 * Une extension non empaquetée ne se met jamais à jour seule : le Mac mini était resté en 1.0.8 et le Mac en 1.0.5,
 * et l'audit GEO attendait sans fin. Beluga la met donc à jour LUI-MÊME par le programme du Mac (« Beluga Relais ») :
 * le relais remplace le contenu du MÊME dossier (même chemin = même identifiant = liaison et autorisation de
 * navigation privée conservées), puis l'extension se recharge (1.0.11 et plus) ou Chrome est relancé (plus ancienne).
 *
 * Décision de l'utilisateur (carte « Liaison de l'extension Chrome simplifiée », 20/11/2026) — elle REMPLACE « la nuit
 * ou d'un clic » : une extension qui sait se recharger seule (1.0.11 et plus) est mise à jour TOUT DE SUITE, dès
 * qu'aucun agent ne travaille dans ce Chrome ; seule la relance de Chrome (extension plus ancienne), qui fermerait les
 * onglets, reste la nuit ou sur un clic. La bande du haut n'est plus orange que si un GESTE est nécessaire ; une mise à
 * jour faite seule s'y annonce en simple information, qui disparaît d'elle-même.
 */
import { versionAuMoins } from './extension-chrome.js';

/** La fenêtre de nuit où Beluga met à jour sans demander : de 1 h à 6 h, heure de Paris. */
export const NUIT_DE_LA_MISE_A_JOUR = { debut: 1, fin: 6, fuseau: 'Europe/Paris' } as const;

/** Un Chrome qu'on n'a pas vu depuis sept jours ne déclenche plus la bannière (ordinateur rangé, ancien poste). */
export const VU_RECEMMENT_MS = 7 * 24 * 3600_000;

/** La première extension qui sait se recharger seule (`se_recharger`) : plus besoin de relancer Chrome. */
export const VERSION_QUI_SE_RECHARGE = '1.0.11';

/** Entre deux essais automatiques sur un même Chrome (la nuit), pour ne pas relancer Chrome en boucle. */
export const ESSAI_DE_NUIT_TOUS_LES_MS = 6 * 3600_000;

/** L'heure (0-23) à Paris, sans dépendre du fuseau de la machine. */
export function heureA(maintenant: number, fuseau: string = NUIT_DE_LA_MISE_A_JOUR.fuseau): number {
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: fuseau }).format(new Date(maintenant));
  return Number.parseInt(heure, 10) % 24;
}

/** Est-ce la nuit de la mise à jour (1 h ≤ heure < 6 h, heure de Paris) ? */
export function estLaNuitDeLaMiseAJour(maintenant: number): boolean {
  const h = heureA(maintenant);
  return h >= NUIT_DE_LA_MISE_A_JOUR.debut && h < NUIT_DE_LA_MISE_A_JOUR.fin;
}

/** Ce qu'il faut savoir d'un Chrome relié pour juger s'il est en retard. */
export interface ChromeAJuger {
  id: string;
  nom: string;
  genre: 'chrome' | 'safari';
  version: string | null;
  /** Autorisée en navigation privée ? `null` : l'extension ne le dit pas (avant 1.0.11). */
  incognito: boolean | null;
  vuLe: number | null;
  enLigne: boolean;
  ordinateurId: string | null;
  agentsAuTravail: number;
}

export type RaisonDuRetard = 'version' | 'navigation-privee';

/** Un Chrome en retard, et ce que Beluga peut y faire. */
export interface RetardDExtension {
  chromeId: string;
  nom: string;
  ordinateurId: string | null;
  version: string | null;
  versionAttendue: string;
  raison: RaisonDuRetard;
  /** Le programme du Mac répond sur cet ordinateur : la mise à jour se fait d'un clic. */
  programmeEnLigne: boolean;
  enLigne: boolean;
  /** Des agents travaillent dans ce Chrome : une mise à jour attend qu'ils aient fini (jamais de bande orange). */
  agentsAuTravail: number;
  /** Ce que la bande demande : rien (Beluga s'en charge), ou le geste qui règle le problème. */
  geste: GesteDuRetard;
}

/**
 * LE GESTE QU'UN RETARD DEMANDE À LA PERSONNE :
 *  - `aucun` : Beluga s'en charge seul (programme du Mac en ligne, extension qui se recharge) — pas de bande orange ;
 *  - `relancer-chrome` : extension d'avant 1.0.11, Chrome doit redémarrer une fois (clic, ou la nuit) ;
 *  - `guider` : pas de programme du Mac sur cet ordinateur (PC, ou Mac sans Beluga Connect) : trois clics à la main ;
 *  - `autoriser` : à jour mais non autorisée en navigation privée ;
 *  - `reessayer` : la mise à jour faite seule a échoué il y a peu : un clic la relance (et dit pourquoi).
 */
export type GesteDuRetard = 'aucun' | 'relancer-chrome' | 'guider' | 'autoriser' | 'reessayer';

/**
 * LES CHROME À SIGNALER : non révoqués (déjà filtrés par l'appelant), vus depuis moins de sept jours, Chrome seulement
 * (Safari se met à jour par l'App Store), dont la version est plus ancienne que la version servie — sinon, à jour mais
 * sans l'autorisation de navigation privée (dite par l'extension elle-même, jamais devinée).
 */
export function retardsDExtension(
  chromes: readonly ChromeAJuger[],
  versionServie: string,
  programmesEnLigne: ReadonlySet<string>,
  maintenant: number,
  echecsRecents: ReadonlySet<string> = new Set(),
): RetardDExtension[] {
  const retards: RetardDExtension[] = [];
  for (const c of chromes) {
    if (c.genre !== 'chrome') continue;
    if (!c.enLigne && (c.vuLe === null || maintenant - c.vuLe > VU_RECEMMENT_MS)) continue;
    const raison: RaisonDuRetard | null = !versionAuMoins(c.version, versionServie) ? 'version' : c.incognito === false ? 'navigation-privee' : null;
    if (!raison) continue;
    const programmeEnLigne = !!c.ordinateurId && programmesEnLigne.has(c.ordinateurId);
    retards.push({
      chromeId: c.id,
      nom: c.nom,
      ordinateurId: c.ordinateurId,
      version: c.version,
      versionAttendue: versionServie,
      raison,
      programmeEnLigne,
      enLigne: c.enLigne,
      agentsAuTravail: c.agentsAuTravail,
      geste: gesteDuRetard({ raison, version: c.version, programmeEnLigne, agentsAuTravail: c.agentsAuTravail, echecRecent: echecsRecents.has(c.id) }),
    });
  }
  return retards;
}

/** Comment Beluga fait passer un Chrome à la nouvelle version : rechargement par l'extension, ou relance de Chrome. */
export function faconDeRecharger(version: string | null): 'extension' | 'relancer-chrome' {
  return versionAuMoins(version, VERSION_QUI_SE_RECHARGE) ? 'extension' : 'relancer-chrome';
}

export function gesteDuRetard(r: { raison: RaisonDuRetard; version: string | null; programmeEnLigne: boolean; agentsAuTravail: number; echecRecent: boolean }): GesteDuRetard {
  if (r.raison === 'navigation-privee') return 'autoriser';
  if (!r.programmeEnLigne) return 'guider';
  if (faconDeRecharger(r.version) === 'relancer-chrome') return r.agentsAuTravail > 0 ? 'aucun' : 'relancer-chrome';
  if (r.echecRecent) return 'reessayer';
  return 'aucun';
}

/** Entre deux essais automatiques sur un même Chrome, le jour : une mise à jour qui échoue n'est pas rejouée en boucle. */
export const ESSAI_AUTOMATIQUE_TOUS_LES_MS = 30 * 60_000;

/**
 * BELUGA MET À JOUR SEUL un Chrome en retard de VERSION (l'autorisation de navigation privée, elle, se coche à part)
 * quand son programme du Mac répond et qu'aucun agent ne travaille dans ce Chrome :
 *  - extension qui se recharge (1.0.11 et plus) : TOUT DE SUITE, au plus une fois toutes les trente minutes ;
 *  - extension plus ancienne (Chrome à relancer, onglets fermés) : la nuit seulement, au plus toutes les six heures.
 */
export function aMettreAJourSeul(r: RetardDExtension, agentsAuTravail: number, dernierEssai: number | null, maintenant: number): boolean {
  if (r.raison !== 'version' || !r.programmeEnLigne || agentsAuTravail > 0) return false;
  if (faconDeRecharger(r.version) === 'extension') return dernierEssai === null || maintenant - dernierEssai >= ESSAI_AUTOMATIQUE_TOUS_LES_MS;
  return estLaNuitDeLaMiseAJour(maintenant) && (dernierEssai === null || maintenant - dernierEssai >= ESSAI_DE_NUIT_TOUS_LES_MS);
}

/** Une mise à jour faite SEULE (sans clic), annoncée par la bande en simple information. */
export interface AvisDeMiseAJour {
  chromeId: string;
  nom: string;
  version: string;
  faiteLe: number;
}

/** L'avis reste proposé une journée ; la page le retire dès qu'on l'a vu (mémorisé par Chrome et version). */
export const AVIS_DE_MISE_A_JOUR_PENDANT_MS = 24 * 3600_000;

/**
 * L'ISSUE NOTÉE après une mise à jour (`chrome_appareils.mise_a_jour_issue`) : « ok <version> (<origine>) » ou
 * « échec : … ». Seule une réussite automatique (origine `auto` ou `nuit`) devient un avis : après un clic, la personne a
 * déjà vu le résultat.
 */
export function avisDeLIssue(issue: string | null | undefined, faiteLe: number | null | undefined, maintenant: number): { version: string } | null {
  const m = /^ok (\S+) \((auto|nuit)\)$/.exec(issue ?? '');
  if (!m || !faiteLe || maintenant - faiteLe > AVIS_DE_MISE_A_JOUR_PENDANT_MS) return null;
  return { version: m[1]! };
}

/** Un échec récent de la mise à jour automatique (moins de trente minutes) : la bande propose de réessayer. */
export function echecRecent(issue: string | null | undefined, faiteLe: number | null | undefined, maintenant: number): boolean {
  return /^échec/.test(issue ?? '') || /^fichiers remplacés/.test(issue ?? '') ? !!faiteLe && maintenant - faiteLe < ESSAI_AUTOMATIQUE_TOUS_LES_MS * 2 : false;
}

/** Ce qu'il faut savoir d'une fiche de navigateur relié pour retrouver ses doublons. */
export interface FicheDeNavigateur {
  id: string;
  ordinateurId: string | null;
  genre: 'chrome' | 'safari';
  extensionId: string | null;
  creeLe: number;
  vuLe: number | null;
  enLigne: boolean;
}

/**
 * LES ANCIENNES FICHES DU MÊME NAVIGATEUR (carte « Liaison de l'extension Chrome simplifiée », 20/11/2026) : relier de
 * nouveau un Chrome créait une fiche de plus sans retirer l'ancienne, et la bande orange restait sur la vieille version.
 * Sont des doublons de `nouvelle` les fiches PLUS ANCIENNES, hors ligne, du même ordinateur et du même navigateur :
 *  - au même identifiant d'extension (même profil, même dossier) ;
 *  - ou sans identifiant (extension d'avant 1.0.11, qui ne le disait pas) ET plus vues depuis la naissance de la
 *    nouvelle — un second profil Chrome du même Mac, lui, reste vu, ou a un autre identifiant : il est gardé.
 */
export function doublonsDuNavigateur(nouvelle: FicheDeNavigateur, autres: readonly FicheDeNavigateur[]): string[] {
  if (!nouvelle.ordinateurId) return [];
  return autres
    .filter(
      (a) =>
        a.id !== nouvelle.id &&
        a.ordinateurId === nouvelle.ordinateurId &&
        a.genre === nouvelle.genre &&
        a.creeLe < nouvelle.creeLe &&
        !a.enLigne &&
        (a.extensionId !== null ? a.extensionId === nouvelle.extensionId : (a.vuLe ?? a.creeLe) <= nouvelle.creeLe),
    )
    .map((a) => a.id);
}
