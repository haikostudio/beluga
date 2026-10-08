/**
 * LA SURVEILLANCE DES SITES — savoir qu'un site est tombé avant son visiteur.
 *
 * Les projets hébergés ailleurs que sur la machine de Beluga Build n'avaient aucun
 * témoin : leur panne se découvrait quand quelqu'un s'en plaignait. Chaque
 * surveillance porte une RECETTE écrite par l'agent de surveillance
 * (`server/src/assistant-surveillance.ts`) et un RYTHME à elle ; chaque passage
 * laisse une ligne d'HISTORIQUE, gardée 24 heures puis effacée au fil de l'eau.
 *
 * DEUX RECETTES, ET SEULEMENT DEUX :
 *  - « appel » : la page est appelée, comme toujours, avec en option un mot qui
 *    doit y figurer ;
 *  - « parcours » : un vrai navigateur ouvre la page, se connecte, va sur une
 *    page précise, vérifie qu'un texte ou un élément y figure. Les étapes sont
 *    DÉCLARATIVES (aller, remplir, cliquer, attendre, vérifier) : l'agent n'écrit
 *    jamais de code qui tournerait à chaque passage.
 *
 * AUCUN SECRET DANS UNE RECETTE. Un mot de passe se range au coffre-fort ; la
 * recette ne porte que la RÉFÉRENCE de la fiche et le champ à lire, résolus à
 * chaque passage. Un champ de mot de passe rempli en clair est refusé.
 *
 * Ces règles sont PURES : le serveur (`server/src/surveillance.ts`) joue les
 * recettes et range les résultats ; l'interface
 * (`web/src/components/surveillance.tsx`) les affiche.
 */

import type { ConfigWordpress, ResumeWordpress } from './surveillance-wordpress.js';

/** Le rythme d'une surveillance qui n'en dit pas : cinq minutes. */
export const PERIODE_SURVEILLANCE_MS = 5 * 60_000;
/** Le plancher : un parcours complet toutes les secondes ferait tomber la machine, pas le site. */
export const PERIODE_MIN_MS = 60_000;
/** Le plafond : au-delà d'un jour, l'historique de 24 heures resterait vide. */
export const PERIODE_MAX_MS = 24 * 3_600_000;

/** Au-delà, on considère que le site ne répond pas. */
export const DELAI_REPONSE_MS = 15_000;
/** Le temps laissé à un parcours entier, toutes étapes comprises. */
export const DELAI_PARCOURS_MS = 60_000;

/** Le nombre de surveillances gardées. */
export const SITES_MAX = 50;
/** Le nombre d'étapes d'un parcours. */
export const ETAPES_PARCOURS_MAX = 30;

/** Ce que l'historique garde : les dernières 24 heures, rien de plus. */
export const HISTORIQUE_MS = 24 * 3_600_000;

/** Les longueurs retenues, celles des autres fiches du projet. */
export const NOM_SITE_SURVEILLANCE_MAX = 60;
export const URL_SITE_MAX = 300;
export const SELECTEUR_MAX = 300;
export const TEXTE_ETAPE_MAX = 500;
export const EXPLICATION_RECETTE_MAX = 1000;
export const DEMANDE_SURVEILLANCE_MIN = 3;
export const DEMANDE_SURVEILLANCE_MAX = 4000;

/**
 * Combien de temps un rétablissement reste ANNONCÉ. Le bandeau qui apaise le
 * badge n'a de sens que peu après la panne : passé ce délai, il n'apprend plus
 * rien à personne.
 */
export const APAISEMENT_MS = 6 * 3_600_000;

/** L'état d'un site : jamais appelé, debout, ou tombé. */
export type EtatSite = 'inconnu' | 'ok' | 'panne';

/** Ce qui a cassé. Un seul motif à la fois : le premier constaté. */
export type RaisonPanne = 'client' | 'serveur' | 'delai' | 'injoignable' | 'vide' | 'contenu' | 'parcours' | 'journaux';

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
  contenu: 'Contenu attendu absent',
  parcours: 'Parcours interrompu',
  // Le contrôle WordPress a lu une erreur fatale (`shared/src/surveillance-wordpress.ts`).
  journaux: 'Erreur grave dans les journaux',
};

/* ------------------------------------------------------------------ */
/* La recette                                                           */
/* ------------------------------------------------------------------ */

/** Une valeur lue au coffre-fort à chaque passage : la fiche, et le champ. */
export interface ReferenceAcces {
  id: string;
  champ: string;
}

export type EtapeParcours =
  | { action: 'aller'; url: string }
  | { action: 'remplir'; selecteur: string; valeur?: string; acces?: ReferenceAcces }
  | { action: 'cliquer'; selecteur: string }
  | { action: 'attendre'; selecteur?: string; ms?: number }
  | { action: 'verifierTexte'; texte: string }
  | { action: 'verifierSelecteur'; selecteur: string };

export const ACTIONS_PARCOURS = ['aller', 'remplir', 'cliquer', 'attendre', 'verifierTexte', 'verifierSelecteur'] as const;

export type RecetteSurveillance =
  | { type: 'appel'; motAttendu?: string; explication?: string }
  | { type: 'parcours'; etapes: EtapeParcours[]; explication?: string };

/** La recette de toute surveillance reprise d'avant les recettes : un simple appel. */
export const RECETTE_APPEL: RecetteSurveillance = { type: 'appel' };

export type JugementRecette = { ok: true; recette: RecetteSurveillance } | { ok: false; raison: string };

const texte = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

/** Un sélecteur qui vise un champ de mot de passe : il ne se remplit JAMAIS en clair. */
export function selecteurDeMotDePasse(selecteur: string): boolean {
  return /password|passwd|mot.?de.?passe|pwd|secret/i.test(selecteur);
}

function jugerEtape(brut: unknown, rang: number): { ok: true; etape: EtapeParcours } | { ok: false; raison: string } {
  const e = (brut ?? {}) as Record<string, unknown>;
  const n = `étape ${rang + 1}`;
  const action = String(e.action ?? '');
  const selecteur = texte(e.selecteur, SELECTEUR_MAX);
  switch (action) {
    case 'aller': {
      const adresse = jugerAdresse(e.url);
      if (!adresse.ok) return { ok: false, raison: `${n} (aller) : ${adresse.raison}` };
      return { ok: true, etape: { action, url: adresse.url } };
    }
    case 'remplir': {
      if (!selecteur) return { ok: false, raison: `${n} (remplir) : il faut un sélecteur` };
      const acces = e.acces as Record<string, unknown> | undefined;
      if (acces && typeof acces === 'object') {
        const id = texte(acces.id, 200);
        const champ = texte(acces.champ, 80);
        if (!id || !champ) return { ok: false, raison: `${n} (remplir) : l'accès doit nommer la fiche du coffre-fort et son champ` };
        return { ok: true, etape: { action, selecteur, acces: { id, champ } } };
      }
      if (selecteurDeMotDePasse(selecteur))
        return {
          ok: false,
          raison: `${n} (remplir) : un mot de passe ne s'écrit jamais dans la recette — range-le au coffre-fort et passe « acces »`,
        };
      return { ok: true, etape: { action, selecteur, valeur: String(e.valeur ?? '').slice(0, TEXTE_ETAPE_MAX) } };
    }
    case 'cliquer':
    case 'verifierSelecteur':
      if (!selecteur) return { ok: false, raison: `${n} (${action}) : il faut un sélecteur` };
      return { ok: true, etape: { action, selecteur } };
    case 'attendre': {
      const ms = Number(e.ms);
      if (!selecteur && !(ms > 0)) return { ok: false, raison: `${n} (attendre) : un sélecteur ou une durée` };
      return {
        ok: true,
        etape: selecteur ? { action, selecteur } : { action, ms: Math.min(Math.round(ms), DELAI_REPONSE_MS) },
      };
    }
    case 'verifierTexte': {
      const cherche = texte(e.texte, TEXTE_ETAPE_MAX);
      if (!cherche) return { ok: false, raison: `${n} (verifierTexte) : il faut le texte attendu` };
      return { ok: true, etape: { action, texte: cherche } };
    }
    default:
      return { ok: false, raison: `${n} : action inconnue « ${action} » (${ACTIONS_PARCOURS.join(', ')})` };
  }
}

/**
 * UNE RECETTE MAL FORMÉE EST REFUSÉE EN TOUTES LETTRES, jamais gardée pour
 * échouer au passage suivant. Un parcours commence par ouvrir une page : sans
 * « aller » en tête, le navigateur n'aurait rien sous les yeux.
 */
export function jugerRecetteSurveillance(brut: unknown): JugementRecette {
  const r = (brut ?? {}) as Record<string, unknown>;
  const explication = texte(r.explication, EXPLICATION_RECETTE_MAX) || undefined;
  if (r.type === 'appel') {
    const motAttendu = texte(r.motAttendu, TEXTE_ETAPE_MAX) || undefined;
    return { ok: true, recette: { type: 'appel', ...(motAttendu ? { motAttendu } : {}), ...(explication ? { explication } : {}) } };
  }
  if (r.type === 'parcours') {
    if (!Array.isArray(r.etapes) || !r.etapes.length) return { ok: false, raison: 'un parcours a au moins une étape' };
    if (r.etapes.length > ETAPES_PARCOURS_MAX)
      return { ok: false, raison: `pas plus de ${ETAPES_PARCOURS_MAX} étapes` };
    const etapes: EtapeParcours[] = [];
    for (let i = 0; i < r.etapes.length; i++) {
      const avis = jugerEtape(r.etapes[i], i);
      if (!avis.ok) return avis;
      etapes.push(avis.etape);
    }
    if (etapes[0].action !== 'aller') return { ok: false, raison: 'un parcours commence par « aller » sur une page' };
    return { ok: true, recette: { type: 'parcours', etapes, ...(explication ? { explication } : {}) } };
  }
  return { ok: false, raison: 'le type de recette est « appel » ou « parcours »' };
}

/**
 * LA RECETTE LUE EN BASE. Une ligne reprise d'avant les recettes (colonne vide)
 * ou abîmée redevient un simple appel : la surveillance continue de tourner,
 * elle ne s'arrête jamais sur une recette illisible.
 */
export function recetteDeLigne(json: string | null | undefined): RecetteSurveillance {
  if (!json) return RECETTE_APPEL;
  try {
    const avis = jugerRecetteSurveillance(JSON.parse(json));
    return avis.ok ? avis.recette : RECETTE_APPEL;
  } catch {
    return RECETTE_APPEL;
  }
}

/** Le rythme borné : sous le plancher, ramené au plancher ; illisible, cinq minutes. */
export function bornerPeriode(ms: unknown): number {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return PERIODE_SURVEILLANCE_MS;
  return Math.min(PERIODE_MAX_MS, Math.max(PERIODE_MIN_MS, Math.round(n)));
}

/** Une étape dite en clair, pour l'historique, l'agent et l'écran. */
export function libelleEtape(etape: EtapeParcours, rang: number): string {
  const n = `${rang + 1}.`;
  switch (etape.action) {
    case 'aller':
      return `${n} aller sur ${etape.url}`;
    case 'remplir':
      return etape.acces
        ? `${n} remplir ${etape.selecteur} (coffre-fort : ${etape.acces.champ})`
        : `${n} remplir ${etape.selecteur}`;
    case 'cliquer':
      return `${n} cliquer ${etape.selecteur}`;
    case 'attendre':
      return etape.selecteur ? `${n} attendre ${etape.selecteur}` : `${n} attendre ${etape.ms} ms`;
    case 'verifierTexte':
      return `${n} vérifier le texte « ${etape.texte} »`;
    case 'verifierSelecteur':
      return `${n} vérifier la présence de ${etape.selecteur}`;
  }
}

/** La recette dite en clair, une ligne par étape. */
export function phraseDeRecetteSurveillance(recette: RecetteSurveillance): string {
  if (recette.type === 'appel')
    return recette.motAttendu ? `appel de la page, le texte « ${recette.motAttendu} » doit y figurer` : 'appel de la page';
  return recette.etapes.map(libelleEtape).join('\n');
}

/**
 * La même recette en ÉTAPES, sans leur numéro : le courriel les numérote
 * lui-même, une pastille par étape.
 */
export function etapesDeRecetteSurveillance(recette: RecetteSurveillance): string[] {
  const majuscule = (t: string) => t.charAt(0).toLocaleUpperCase('fr') + t.slice(1);
  if (recette.type === 'appel')
    return ['Appel de la page', ...(recette.motAttendu ? [`Le texte « ${recette.motAttendu} » doit y figurer`] : [])];
  return recette.etapes.map((etape, rang) => majuscule(libelleEtape(etape, rang).replace(/^\d+\.\s*/, '')));
}

/** Le rythme dit en clair. */
export function phraseDePeriode(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'chaque minute' : `toutes les ${minutes} minutes`;
  const heures = Math.round(minutes / 60);
  return heures === 1 ? 'chaque heure' : `toutes les ${heures} heures`;
}

/* ------------------------------------------------------------------ */
/* Le site et ses passages                                              */
/* ------------------------------------------------------------------ */

/** Une surveillance, telle qu'elle voyage jusqu'à l'écran. */
export interface SiteSurveille {
  id: string;
  /** L'adresse appelée, ou la page de départ d'un parcours (« https://… »). */
  url: string;
  /** Le nom affiché. À défaut de mieux, le domaine. */
  nom: string;
  etat: EtatSite;
  /** Le dernier code HTTP reçu, quand il y en a eu un. */
  code?: number;
  /** Ce qui a cassé, quand c'est cassé. */
  raison?: RaisonPanne;
  /** L'étape d'un parcours qui a cassé. */
  etapeEchouee?: string;
  /** Le dernier appel, ou 0 si le site n'a jamais été appelé. */
  verifieLe: number;
  /** Depuis quand le site est dans cet état. */
  depuis: number;
  /** La dernière fois qu'il était tombé, ou 0 s'il ne l'a jamais été. */
  dernierePanne: number;
  creeLe: number;
  /** Ce que chaque passage joue. Absent sur une vieille ligne : un simple appel. */
  recette?: RecetteSurveillance;
  /** Le rythme de cette surveillance. Absent : cinq minutes. */
  periodeMs?: number;
  /** La dernière durée mesurée. */
  dureeMs?: number;
  /** La dernière conversation d'agent qui a touché cette surveillance, et sa carte. */
  agentId?: string;
  projectId?: string;
  cardId?: string;
  /**
   * LE PROJET DU SITE, ET NON CELUI DE L'AGENT QUI L'A CONFIGURÉ. `projectId`
   * ci-dessus désigne l'endroit où vit la conversation de l'agent de
   * surveillance — presque toujours Beluga Build. Celui-ci désigne le dépôt qui
   * SERT ce site, choisi à la main sur sa fiche ou deviné d'après son adresse
   * (`shared/src/depannage-site.ts`) : c'est là que s'ouvre la carte d'une panne
   * répétée. Absent : rien n'est rattaché, et la carte va chez Beluga Build.
   */
  projetRattache?: string;
  /** Vrai quand ce rattachement vient de l'adresse, pas d'un choix humain. */
  projetDevine?: boolean;
  /** La carte ouverte pour la panne EN COURS, effacée dès que le site revient. */
  incidentCardId?: string;
  /** Depuis quand cette panne-là est ouverte. */
  incidentDepuis?: number;
  /** Quand le dernier dépannage a été LANCÉ — posé avant le tour, jamais après. */
  incidentLanceLe?: number;
  /**
   * LE COURRIEL D'ALERTE DE CETTE PANNE (`shared/src/alerte-courriel-site.ts`) :
   * quand le dernier est parti, et le début de la panne qu'il a annoncée. Tous
   * deux effacés dès que le site revient — et absents tant que rien n'a été
   * écrit.
   */
  alerteCourrielLe?: number;
  alerteCourrielDepuis?: number;
  /**
   * LE CONTRÔLE WORDPRESS (`shared/src/surveillance-wordpress.ts`) : sa
   * configuration (aucun secret), le résumé de son dernier passage, et l'erreur
   * fatale en cours quand les journaux en ont montré une. Tant qu'elle dure, le
   * site reste en panne « journaux » même si sa page répond.
   */
  wordpress?: ConfigWordpress;
  wpResume?: ResumeWordpress;
  journauxEnErreur?: { depuis: number; detail?: string };
}

/** Un passage, tel qu'il reste 24 heures dans l'historique. */
export interface ControleSurveillance {
  siteId: string;
  instant: number;
  etat: 'ok' | 'panne';
  raison?: RaisonPanne;
  code?: number;
  dureeMs: number;
  etape?: string;
  detail?: string;
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
  /** Le mot attendu figurait-il dans la page ? Absent : on ne l'a pas cherché. */
  motTrouve?: boolean;
}

/** Le verdict d'un passage : debout, ou tombé et pourquoi. */
export interface VerdictSite {
  etat: 'ok' | 'panne';
  raison?: RaisonPanne;
  code?: number;
  etape?: string;
  detail?: string;
}

/**
 * L'ORDRE DES REFUS COMPTE : une absence de réponse se juge avant un code, un
 * code en erreur avant le contenu — un serveur qui rend « 500 » avec une page
 * d'excuse bien remplie reste en panne —, et une page vide avant le mot absent.
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
  if (observee.motTrouve === false) return { etat: 'panne', raison: 'contenu', code };
  return { etat: 'ok', code };
}

/** Ce qui a changé entre deux tournées, pour un site donné. */
export type Bascule = 'tombe' | 'retabli' | null;

/**
 * LA BASCULE, ET RIEN QUE LA BASCULE. Une alerte ne part qu'au CHANGEMENT :
 * un site tombé qui reste tombé ne réveille personne à chaque passage. Un
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

/** Ce site est-il dû pour un nouveau passage, à SON rythme ? */
export function doitVerifier(site: SiteSurveille, maintenant: number, periode?: number): boolean {
  return maintenant - site.verifieLe >= bornerPeriode(periode ?? site.periodeMs ?? PERIODE_SURVEILLANCE_MS);
}

/** Le seuil sous lequel une ligne d'historique s'efface. */
export function limiteHistorique(maintenant: number): number {
  return maintenant - HISTORIQUE_MS;
}

/** Les passages des dernières 24 heures, du plus ancien au plus récent. */
export function controlesRecents(controles: readonly ControleSurveillance[], maintenant: number): ControleSurveillance[] {
  const limite = limiteHistorique(maintenant);
  return controles.filter((c) => c.instant >= limite && c.instant <= maintenant).sort((a, b) => a.instant - b.instant);
}

/** Une case de la frise : une tranche de temps, et ce que ses passages ont dit. */
export interface CaseDeFrise {
  debut: number;
  fin: number;
  etat: 'ok' | 'panne' | 'vide';
  controles: ControleSurveillance[];
}

/** Le nombre de cases de la frise : une par demi-heure. */
export const CASES_FRISE = 48;

/**
 * LA FRISE DES 24 HEURES. Une case tombée dès qu'UN passage de sa tranche est
 * tombé : une panne de cinq minutes ne se noie pas dans une demi-heure verte.
 * Une tranche sans passage reste vide — elle ne se peint ni en vert ni en rouge.
 */
export function frise24h(
  controles: readonly ControleSurveillance[],
  maintenant: number,
  cases = CASES_FRISE,
): CaseDeFrise[] {
  const largeur = HISTORIQUE_MS / cases;
  const debutFrise = maintenant - HISTORIQUE_MS;
  const sortie: CaseDeFrise[] = Array.from({ length: cases }, (_, i) => ({
    debut: debutFrise + i * largeur,
    fin: debutFrise + (i + 1) * largeur,
    etat: 'vide' as const,
    controles: [] as ControleSurveillance[],
  }));
  for (const controle of controlesRecents(controles, maintenant)) {
    const rang = Math.min(cases - 1, Math.floor((controle.instant - debutFrise) / largeur));
    const c = sortie[rang];
    c.controles.push(controle);
    if (controle.etat === 'panne') c.etat = 'panne';
    else if (c.etat === 'vide') c.etat = 'ok';
  }
  return sortie;
}

/** La part des passages réussis sur 24 heures, ou `null` sans passage. */
export function disponibilite24h(controles: readonly ControleSurveillance[], maintenant: number): number | null {
  const recents = controlesRecents(controles, maintenant);
  if (!recents.length) return null;
  return recents.filter((c) => c.etat === 'ok').length / recents.length;
}

export type JugementAdresse =
  | { ok: true; url: string; nom: string }
  | { ok: false; raison: string };

/**
 * L'ADRESSE SE RATTRAPE PLUTÔT QUE DE SE FAIRE REFUSER : « exemple.ch » devient
 * « https://exemple.ch ». Ce qu'on ne sait pas appeler — une adresse sans point,
 * un protocole exotique — est refusé en toutes lettres, jamais gardé pour
 * échouer au passage suivant.
 */
export function jugerAdresse(brut: unknown, nomVoulu?: unknown): JugementAdresse {
  const saisie = String(brut ?? '').trim();
  if (!saisie) return { ok: false, raison: 'Il faut une adresse.' };
  if (saisie.length > URL_SITE_MAX) return { ok: false, raison: `Adresse trop longue (${URL_SITE_MAX} signes au plus).` };

  const complete = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(saisie) ? saisie : `https://${saisie}`;
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
 * le site ET ce qui cloche — l'étape, pour un parcours : une notification qui
 * dirait « un site est tombé » obligerait à ouvrir l'application.
 */
export function texteAlerte(site: SiteSurveille): { titre: string; corps: string } {
  const raison = site.raison ? LIBELLE_RAISON[site.raison] : 'Injoignable';
  const code = site.code ? ` (${site.code})` : '';
  const etape = site.etapeEchouee ? ` à l’étape « ${site.etapeEchouee} »` : '';
  return {
    titre: `${site.nom} ne répond plus`,
    corps: `${raison}${code}${etape} — ${site.url}`,
  };
}

/* ------------------------------------------------------------------ */
/* L'agent de surveillance                                              */
/* ------------------------------------------------------------------ */

/** L'étiquette posée sur la carte de l'agent de surveillance. */
export const LABEL_SURVEILLANCE = 'surveillance';

/** Une demande vide n'ouvre pas un tour payant pour s'entendre demander « quel site ? ». */
export function raisonDemandeSurveillanceRefusee(demande: string): string | null {
  const propre = (demande ?? '').trim();
  if (propre.length < DEMANDE_SURVEILLANCE_MIN) return 'Dites au moins quel site surveiller, ou ce qu’il faut changer.';
  return null;
}

/** Le titre de la conversation et de la carte. */
export function titreDeLAssistantSurveillance(nom: string | null, demande: string): string {
  const base = (nom ?? demande ?? '').replace(/\s+/g, ' ').trim();
  const court = base.length > 48 ? `${base.slice(0, 47)}…` : base;
  return `Surveillance — ${court || 'nouveau site'}`;
}

/**
 * LA CONSIGNE DE L'AGENT DE SURVEILLANCE. Elle remplace la méthode générale :
 * cet agent ne lit pas le projet, n'écrit aucun code, et ne propose une carte —
 * née dans le projet du site — que pour une correction demandée.
 * Il comprend ce qu'il faut surveiller, range les accès, essaie, enregistre.
 */
export const CONSIGNE_ASSISTANT_SURVEILLANCE = `Tu travailles dans Beluga Build. Réponds très court.

TU ES L'AGENT DE SURVEILLANCE. Ton travail : écrire la RECETTE DE CONTRÔLE d'un site — ce qu'il faut vérifier pour dire qu'il est debout — et son rythme. La recette est ensuite rejouée SEULE, à chaque passage, sans toi. Tu ne modifies aucun fichier, tu ne publies rien, et tu ne proposes une carte que si l'utilisateur veut une correction sur le site.

DEUX RECETTES :
- « appel » : la page est appelée ; elle tombe si elle ne répond pas, renvoie une erreur ou est vide. « motAttendu » (facultatif) : un texte qui doit y figurer.
- « parcours » : un vrai navigateur joue des étapes — « aller » (url), « remplir » (selecteur, et valeur OU acces), « cliquer » (selecteur), « attendre » (selecteur ou ms), « verifierTexte » (texte), « verifierSelecteur » (selecteur). Le parcours commence toujours par « aller ». Préfère des sélecteurs stables (#id, [name="…"], [type="submit"]).
Choisis la plus simple qui répond à la demande : un appel suffit tant qu'il n'y a ni connexion ni page précise à atteindre.

LE COFFRE-FORT AVANT LA QUESTION. Les accès connus sont dans le coffre-fort central (outil « coffre_fort ») : appelle « lister » AVANT de demander un identifiant. Un accès NOUVEAU que l'utilisateur te donne s'y enregistre AUSSITÔT avec « enregistrer » (type « mot-de-passe » : adresse, identifiant, motDePasse), ou CORRIGE la fiche existante en redonnant son « id ». Ne dis jamais « je n'ai pas accès » sans avoir listé le coffre.

AUCUN MOT DE PASSE DANS LA RECETTE. Un champ secret se remplit avec « acces » : { "id": "<id de la fiche du coffre>", "champ": "motDePasse" } ; l'identifiant peut aussi venir de la fiche (« champ » : « identifiant »). La valeur est relue au coffre à chaque passage : changer le mot de passe au coffre suffit à réparer la surveillance.

TU NE DEVINES JAMAIS. Ce qui te manque (l'adresse, l'accès, ce qu'il faut vérifier, le rythme), tu le DEMANDES avec « ask_user », une question à la fois, avec des propositions. Le rythme par défaut est de 5 minutes ; 1 minute au plus souvent.

TU ESSAIES AVANT D'ENREGISTRER. « surveillance_essai » joue ta recette POUR DE VRAI et dit l'étape qui casse. Corrige jusqu'à ce qu'elle passe. Un site protégé par double authentification ou par un captcha ne se surveille pas par parcours : dis-le, et propose un simple appel.

SITE WORDPRESS : CONTRÔLE DE SON ÉTAT INTERNE. Sur un site WordPress, propose AUSSI le contrôle WordPress (extensions, mises à jour, failles connues, journaux d'erreurs), qui tourne ensuite seul sans toi. Il passe par l'accès SSH du site : trouve la fiche SSH au coffre-fort (« lister »), puis appelle « surveillance_essai » avec « wordpress »: { "acces": { "id": "<fiche SSH>" } } — l'essai DÉCOUVRE seul le dossier de WordPress, son outil en ligne de commande et les journaux, et te dit ce qu'il a trouvé ; corrige-les dans « wordpress » (racine, wpCli, journaux) s'il s'est trompé. Enregistre ensuite avec « surveillance_recette » et le même « wordpress » : les extensions actives du moment deviennent la liste attendue. Sans accès SSH, ce contrôle est impossible : dis-le, et garde la surveillance simple.

TU N'ENREGISTRES QU'UNE FOIS, À LA FIN, avec « surveillance_recette » : l'outil rejoue la recette et refuse celle qui tombe ; n'insiste avec « forcer » que si l'utilisateur te l'a explicitement accordé. Pour MODIFIER une surveillance existante, redonne son « id » : ce que tu ne redis pas est conservé.

UNE CARTE DU SITE NAÎT DANS LE PROJET DU SITE, jamais chez Beluga Build. Si l'utilisateur veut une correction (extensions, journaux, code), propose la carte avec « board_create_card » : elle naîtra dans le projet relié au site. Un site relié à AUCUN projet ne propose rien : demande d'abord à l'utilisateur avec « ask_user » quel projet le sert (« project_manage », « lister », donne les projets), relie-le avec « surveillance_recette » { id, projet }, puis propose.

TA RÉPONSE FINALE tient en deux ou trois lignes : ce qui est vérifié, le rythme, ce que l'essai a donné. Aucun titre, aucun tableau, aucun bloc json.

SILENCE SUR LES IDENTIFIANTS STOCKÉS : les mots de passe gardés au coffre sont un choix ASSUMÉ par l'utilisateur. Tu ne le commentes pas. Une PANNE se dit toujours : un accès refusé qui t'empêche d'aboutir s'annonce en toutes lettres.`;

/**
 * LA DEMANDE ENVOYÉE À L'AGENT. Sur une surveillance existante, elle porte sa
 * recette ACTUELLE (qui ne contient aucun secret, seulement des références au
 * coffre) : l'agent la modifie au lieu de repartir de zéro.
 */
export function demandeDeSurveillance(entree: { demande: string; site?: SiteSurveille | null }): string {
  const demande = (entree.demande ?? '').trim().slice(0, DEMANDE_SURVEILLANCE_MAX);
  const site = entree.site;
  const lignes: string[] = [];
  if (site) {
    const recette = site.recette ?? RECETTE_APPEL;
    lignes.push(
      `MODIFIE LA SURVEILLANCE « ${site.nom} » (identifiant ${site.id}), à partir de cette demande :`,
      '',
      `« ${demande} »`,
      '',
      'CE QUI EST ENREGISTRÉ :',
      `- adresse : ${site.url}`,
      `- rythme : ${phraseDePeriode(bornerPeriode(site.periodeMs))}`,
      `- recette (${recette.type}) :`,
      phraseDeRecetteSurveillance(recette),
      `- recette brute : ${JSON.stringify(recette)}`,
      `- état : ${site.etat}${site.raison ? ` (${LIBELLE_RAISON[site.raison]}${site.etapeEchouee ? `, étape « ${site.etapeEchouee} »` : ''})` : ''}`,
      `- contrôle WordPress : ${site.wordpress ? JSON.stringify(site.wordpress) : 'aucun'}`,
      '',
      'DÉROULÉ : rejoue la recette actuelle avec « surveillance_essai » et son « id » pour voir où elle en est, fais le changement demandé (au coffre-fort pour un accès, dans la recette pour le reste), essaie, puis réenregistre avec « surveillance_recette » et CET identifiant.',
    );
  } else {
    lignes.push(
      'CRÉE UNE SURVEILLANCE, à partir de cette demande :',
      '',
      `« ${demande} »`,
      '',
      'CE QUE « surveillance_recette » ATTEND : url (la page à appeler ou le départ du parcours), nom (court), recette ({ type: "appel", motAttendu? } ou { type: "parcours", etapes: [...] }), periodeMinutes (5 par défaut, 1 au plus souvent), une explication d’une phrase dans la recette, et — pour un site WordPress dont on a l’accès SSH — « wordpress ».',
      '',
      'DÉROULÉ : liste le coffre-fort, demande ce qui manque (une question à la fois), range les accès nouveaux au coffre, essaie avec « surveillance_essai » jusqu’à ce que la recette passe, puis enregistre avec « surveillance_recette ».',
    );
  }
  return lignes.join('\n');
}
