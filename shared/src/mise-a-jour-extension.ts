/**
 * LA MISE À JOUR DE L'EXTENSION CHROME DES MAC — les règles pures (carte « Extension à jour et Jarvis tout en voix »,
 * 20/11/2026).
 *
 * Une extension non empaquetée ne se met jamais à jour seule : le Mac mini était resté en 1.0.8 et le Mac en 1.0.5,
 * et l'audit GEO attendait sans fin. Beluga la met donc à jour LUI-MÊME par le programme du Mac (« Beluga Relais ») :
 * le relais remplace le contenu du MÊME dossier (même chemin = même identifiant = liaison et autorisation de
 * navigation privée conservées), puis l'extension se recharge (1.0.11 et plus) ou Chrome est relancé (plus ancienne).
 *
 * Décision de l'utilisateur : SEUL la nuit (1 h – 6 h, heure de Paris), sur un CLIC le jour (bannière orange).
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
}

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
): RetardDExtension[] {
  const retards: RetardDExtension[] = [];
  for (const c of chromes) {
    if (c.genre !== 'chrome') continue;
    if (!c.enLigne && (c.vuLe === null || maintenant - c.vuLe > VU_RECEMMENT_MS)) continue;
    const raison: RaisonDuRetard | null = !versionAuMoins(c.version, versionServie) ? 'version' : c.incognito === false ? 'navigation-privee' : null;
    if (!raison) continue;
    retards.push({
      chromeId: c.id,
      nom: c.nom,
      ordinateurId: c.ordinateurId,
      version: c.version,
      versionAttendue: versionServie,
      raison,
      programmeEnLigne: !!c.ordinateurId && programmesEnLigne.has(c.ordinateurId),
      enLigne: c.enLigne,
    });
  }
  return retards;
}

/** Comment Beluga fait passer un Chrome à la nouvelle version : rechargement par l'extension, ou relance de Chrome. */
export function faconDeRecharger(version: string | null): 'extension' | 'relancer-chrome' {
  return versionAuMoins(version, VERSION_QUI_SE_RECHARGE) ? 'extension' : 'relancer-chrome';
}

/**
 * LA NUIT, BELUGA MET À JOUR SEUL un Chrome en retard de VERSION (l'autorisation de navigation privée, elle, ne se coche
 * qu'à la main) quand : c'est la nuit, son programme du Mac répond, aucun agent ne travaille dans ce Chrome (une
 * relance couperait sa séance), et le dernier essai date de plus de six heures.
 */
export function aMettreAJourCetteNuit(r: RetardDExtension, agentsAuTravail: number, dernierEssai: number | null, maintenant: number): boolean {
  return (
    r.raison === 'version' &&
    r.programmeEnLigne &&
    agentsAuTravail === 0 &&
    estLaNuitDeLaMiseAJour(maintenant) &&
    (dernierEssai === null || maintenant - dernierEssai >= ESSAI_DE_NUIT_TOUS_LES_MS)
  );
}
