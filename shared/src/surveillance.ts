/**
 * LA SURVEILLANCE DES SITES — savoir qu'un site est tombé avant son visiteur.
 *
 * Les projets hébergés ailleurs que sur la machine d'HaikoDev n'avaient aucun
 * témoin : leur panne se découvrait quand quelqu'un s'en plaignait. La
 * surveillance garde une LISTE D'ADRESSES, les appelle à intervalle régulier et
 * retient, pour chacune, son ÉTAT ACTUEL — rien d'autre. Pas de journal, pas
 * d'historique de disponibilité : la question à laquelle elle répond est
 * « est-ce debout, maintenant ? ».
 *
 * Ces règles sont PURES : elles disent ce qu'une adresse doit valoir pour être
 * gardée, ce qui compte comme une PANNE, et ce qui bascule d'un état à l'autre.
 * Le serveur (`server/src/surveillance.ts`) appelle les sites et range les
 * résultats ; l'interface (`web/src/components/surveillance.tsx`) les affiche.
 *
 * TROIS CHOSES FONT UNE PANNE, et elles seules : une réponse en erreur (4xx ou
 * 5xx), une absence de réponse (délai dépassé, machine injoignable), une page
 * VIDE. Chercher un mot dans la page serait un autre métier — celui-là ne
 * demande pas de savoir à quoi le site ressemble.
 */

/** Le temps entre deux tournées de vérification : une heure. */
export const PERIODE_SURVEILLANCE_MS = 3_600_000;

/** Au-delà, on considère que le site ne répond pas. */
export const DELAI_REPONSE_MS = 15_000;

/** Le nombre d'adresses gardées. Au-delà, une tournée durerait plus que sa période. */
export const SITES_MAX = 50;

/** Les longueurs retenues, celles des autres fiches du projet. */
export const NOM_SITE_SURVEILLANCE_MAX = 60;
export const URL_SITE_MAX = 300;

/**
 * Combien de temps un rétablissement reste ANNONCÉ. Le bandeau qui apaise le
 * badge n'a de sens que peu après la panne : passé ce délai, il n'apprend plus
 * rien à personne.
 */
export const APAISEMENT_MS = 6 * 3_600_000;

/** L'état d'un site : jamais appelé, debout, ou tombé. */
export type EtatSite = 'inconnu' | 'ok' | 'panne';

/** Ce qui a cassé. Un seul motif à la fois : le premier constaté. */
export type RaisonPanne = 'client' | 'serveur' | 'delai' | 'injoignable' | 'vide';

/**
 * Le libellé français de chaque raison — l'interface le traduit, exactement
 * comme les types du coffre-fort.
 */
export const LIBELLE_RAISON: Readonly<Record<RaisonPanne, string>> = {
  client: 'Page introuvable ou refusée',
  serveur: 'Erreur du serveur',
  delai: 'Aucune réponse à temps',
  injoignable: 'Serveur injoignable',
  vide: 'Page vide',
};

/** Une adresse surveillée, telle qu'elle voyage jusqu'à l'écran. */
export interface SiteSurveille {
  id: string;
  /** L'adresse appelée, complète (« https://… »). */
  url: string;
  /** Le nom affiché. À défaut de mieux, le domaine. */
  nom: string;
  etat: EtatSite;
  /** Le dernier code HTTP reçu, quand il y en a eu un. */
  code?: number;
  /** Ce qui a cassé, quand c'est cassé. */
  raison?: RaisonPanne;
  /** Le dernier appel, ou 0 si le site n'a jamais été appelé. */
  verifieLe: number;
  /** Depuis quand le site est dans cet état. */
  depuis: number;
  /** La dernière fois qu'il était tombé, ou 0 s'il ne l'a jamais été. */
  dernierePanne: number;
  creeLe: number;
}

/** Ce qu'un appel a rendu, tel que le serveur le rapporte au juge. */
export interface ReponseObservee {
  /** Le code HTTP, absent si rien n'est revenu. */
  statut?: number;
  /** La taille du contenu reçu, une fois les espaces retirés. */
  taille?: number;
  /** Le délai a-t-il été dépassé ? */
  delaiDepasse?: boolean;
  /** L'erreur réseau, s'il y en a eu une. */
  erreur?: string;
}

/** Le verdict d'un appel : debout, ou tombé et pourquoi. */
export interface VerdictSite {
  etat: 'ok' | 'panne';
  raison?: RaisonPanne;
  code?: number;
}

/**
 * L'ORDRE DES REFUS COMPTE : une absence de réponse se juge avant un code, et
 * un code en erreur avant le contenu — un serveur qui rend « 500 » avec une
 * page d'excuse bien remplie reste en panne.
 */
export function jugerReponse(observee: ReponseObservee): VerdictSite {
  if (observee.delaiDepasse) return { etat: 'panne', raison: 'delai' };
  if (observee.erreur || typeof observee.statut !== 'number')
    return { etat: 'panne', raison: 'injoignable' };
  const code = observee.statut;
  if (code >= 500) return { etat: 'panne', raison: 'serveur', code };
  if (code >= 400) return { etat: 'panne', raison: 'client', code };
  // Une page servie mais VIDE est une panne : le serveur répond, le site non.
  if ((observee.taille ?? 0) === 0) return { etat: 'panne', raison: 'vide', code };
  return { etat: 'ok', code };
}

/** Ce qui a changé entre deux tournées, pour un site donné. */
export type Bascule = 'tombe' | 'retabli' | null;

/**
 * LA BASCULE, ET RIEN QUE LA BASCULE. Une alerte ne part qu'au CHANGEMENT :
 * un site tombé qui reste tombé ne réveille personne une fois par heure. Un
 * premier appel qui trouve le site déjà à terre compte comme une chute — c'est
 * bien une nouvelle pour qui vient d'ajouter l'adresse.
 */
export function bascule(avant: EtatSite, apres: EtatSite): Bascule {
  if (apres === avant) return null;
  if (apres === 'panne') return 'tombe';
  if (apres === 'ok' && avant === 'panne') return 'retabli';
  return null;
}

/** Les sites tombés, dans l'ordre où ils sont donnés. */
export function sitesEnPanne(sites: readonly SiteSurveille[]): SiteSurveille[] {
  return sites.filter((site) => site.etat === 'panne');
}

/** Le chiffre porté par la pastille du menu. Zéro veut dire : pas de pastille. */
export function compterEnPanne(sites: readonly SiteSurveille[]): number {
  return sitesEnPanne(sites).length;
}

/**
 * LE BANDEAU QUI APAISE : tout est debout, et l'un des sites était tombé il y a
 * peu. Sans la seconde condition, une liste qui n'a jamais connu de panne
 * afficherait un « tout va bien » permanent, qu'on cesserait de voir.
 */
export function apaisement(sites: readonly SiteSurveille[], maintenant: number): boolean {
  if (!sites.length || compterEnPanne(sites)) return false;
  return sites.some((site) => site.dernierePanne > 0 && maintenant - site.dernierePanne < APAISEMENT_MS);
}

/** Ce site est-il dû pour un nouvel appel ? */
export function doitVerifier(
  site: SiteSurveille,
  maintenant: number,
  periode = PERIODE_SURVEILLANCE_MS,
): boolean {
  return maintenant - site.verifieLe >= periode;
}

export type JugementAdresse =
  | { ok: true; url: string; nom: string }
  | { ok: false; raison: string };

/**
 * L'ADRESSE SE RATTRAPE PLUTÔT QUE DE SE FAIRE REFUSER : « exemple.ch » devient
 * « https://exemple.ch ». Ce qu'on ne sait pas appeler — une adresse sans point,
 * un protocole exotique — est refusé en toutes lettres, jamais gardé pour
 * échouer une heure plus tard.
 */
export function jugerAdresse(brut: unknown, nomVoulu?: unknown): JugementAdresse {
  const texte = String(brut ?? '').trim();
  if (!texte) return { ok: false, raison: 'Il faut une adresse.' };
  if (texte.length > URL_SITE_MAX) return { ok: false, raison: `Adresse trop longue (${URL_SITE_MAX} signes au plus).` };

  const complete = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(texte) ? texte : `https://${texte}`;
  let url: URL;
  try {
    url = new URL(complete);
  } catch {
    return { ok: false, raison: 'Cette adresse n’est pas lisible.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, raison: 'Seules les adresses web (http, https) se surveillent.' };
  const hote = url.hostname;
  if (!hote || (!hote.includes('.') && hote !== 'localhost'))
    return { ok: false, raison: 'Cette adresse n’a pas de nom de domaine.' };

  const nom = String(nomVoulu ?? '').trim().slice(0, NOM_SITE_SURVEILLANCE_MAX) || hote;
  return { ok: true, url: url.toString(), nom };
}

/** Deux fois la même adresse ne se garde pas : la comparaison ignore la casse. */
export function dejaSurveille(sites: readonly SiteSurveille[], url: string, sauf?: string): boolean {
  const cible = url.toLowerCase();
  return sites.some((site) => site.id !== sauf && site.url.toLowerCase() === cible);
}

/**
 * LE TEXTE DE L'ALERTE, composé une seule fois pour les deux canaux. Il nomme
 * le site ET ce qui cloche : une notification qui dirait « un site est tombé »
 * obligerait à ouvrir l'application pour savoir lequel.
 */
export function texteAlerte(site: SiteSurveille): { titre: string; corps: string } {
  const raison = site.raison ? LIBELLE_RAISON[site.raison] : 'Injoignable';
  const code = site.code ? ` (${site.code})` : '';
  return {
    titre: `${site.nom} ne répond plus`,
    corps: `${raison}${code} — ${site.url}`,
  };
}
