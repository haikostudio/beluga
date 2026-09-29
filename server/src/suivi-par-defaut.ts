/**
 * LE SUIVI DES VISITES POSÉ PAR DÉFAUT (demande du 26/09/2026) : chaque projet
 * qui a une adresse de production connue reçoit d'office son espace de suivi,
 * cette adresse y est autorisée, et la page servie est relue. Un code absent,
 * faux, ou resté sur l'ancien outil de statistiques fait naître UNE carte de
 * correction dans « Planifié » du projet. Son cadrage part tout seul jusqu'à
 * la compréhension (une carte après l'autre) ; le travail ne part que sur le
 * clic de l'utilisateur, et rien n'est mis en production sans lui.
 *
 * Règles pures : `shared/src/suivi-par-defaut.ts`. Rejouable : un espace déjà
 * juste n'est pas réécrit, et tant que la carte posée existe, aucune autre ne
 * naît pour ce projet.
 */
import {
  LIBELLE_DIAGNOSTIC_SUIVI,
  adresseDeProductionDuProjet,
  consigneDeCorrection,
  consigneDesObjectifs,
  diagnosticACorriger,
  diagnostiquerSuivi,
  estSiteAutonome,
  estUnRegroupement,
  etatSuiviApresDiagnostic,
  extraitDeSuivi,
  modeDEmploiDuSuivi,
  origineDe,
  phraseDeConfidentialite,
  type Card,
  type DiagnosticSuivi,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';
import { adresseDeBeluga, assurerEspace, carteDuSuivi, carteDuSuiviEnTravail, ecrireConfiguration, lireEspace } from './marketing.js';

export { carteDuSuivi };
import * as store from './store.js';
import { bus } from './bus.js';

/** L'étiquette des cartes de correction : elles restent sur le tableau, contrairement à celles de l'atelier. */
export const LABEL_SUIVI_DES_VISITES = 'suivi-des-visites';

const DELAI_LECTURE_MS = 8_000;
const TAILLE_LUE_MAX = 600_000;

/** Ce que la page d'accueil porte, lu sans jamais bloquer : une panne donne « injoignable ». */
export async function lireLaPage(adresse: string, lecteur: typeof fetch = fetch): Promise<string | null> {
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), DELAI_LECTURE_MS);
  try {
    const reponse = await lecteur(adresse, { signal: controle.signal, redirect: 'follow', headers: { 'user-agent': 'BelugaSuivi/1.0' } });
    if (!reponse.ok) return null;
    return (await reponse.text()).slice(0, TAILLE_LUE_MAX);
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/** Les sites de la surveillance que l'utilisateur a rattachés à ce projet de sa main. */
function sitesRattachesALaMain(projectId: string): string[] {
  return (
    getDb().prepare('SELECT url FROM sites_surveilles WHERE projet_rattache = ? AND projet_devine = 0 ORDER BY cree_le ASC').all(projectId) as { url: string }[]
  ).map((l) => l.url);
}

/** Une installation annoncée par un agent de projet couvre sept jours : le temps d'être mise en ligne. */
export const DUREE_INSTALLATION_AGENT_MS = 7 * 86_400_000;

export function installationParUnAgentEnCours(projectId: string, maintenant = Date.now()): boolean {
  const l = getDb().prepare('SELECT installation_agent_le FROM marketing_espaces WHERE project_id = ?').get(projectId) as { installation_agent_le: number | null } | undefined;
  return !!l?.installation_agent_le && maintenant - l.installation_agent_le < DUREE_INSTALLATION_AGENT_MS;
}

export function marquerInstallationParUnAgent(projectId: string, maintenant = Date.now()): void {
  getDb().prepare('UPDATE marketing_espaces SET installation_agent_le = ? WHERE project_id = ?').run(maintenant, projectId);
}

export interface EtatDuSuivi {
  diagnostic: DiagnosticSuivi | null;
  lu: number | null;
  carteId: string | null;
}

export function lireEtatDuSuivi(projectId: string): EtatDuSuivi {
  const l = getDb()
    .prepare('SELECT diagnostic_suivi, diagnostic_le, carte_suivi_id FROM marketing_espaces WHERE project_id = ?')
    .get(projectId) as { diagnostic_suivi: string | null; diagnostic_le: number | null; carte_suivi_id: string | null } | undefined;
  return {
    diagnostic: (l?.diagnostic_suivi as DiagnosticSuivi | null) ?? null,
    lu: l?.diagnostic_le ?? null,
    carteId: l?.carte_suivi_id ?? null,
  };
}

/** Le diagnostic, et l'état du suivi qui en découle (`etatSuiviApresDiagnostic`) : seul le code lu sur le site fait « posé ». */
function ecrireDiagnostic(projectId: string, diagnostic: DiagnosticSuivi, maintenant: number): void {
  const etat = lireEspace(projectId)?.configuration.etatSuivi ?? 'absent';
  getDb()
    .prepare('UPDATE marketing_espaces SET diagnostic_suivi = ?, diagnostic_le = ?, etat_suivi = ? WHERE project_id = ?')
    .run(diagnostic, maintenant, etatSuiviApresDiagnostic(etat, diagnostic), projectId);
}

/**
 * L'ESPACE DU PROJET EST-IL PRÊT À RECEVOIR SES VISITES ? Créé s'il manque,
 * l'origine de production ajoutée si elle n'y est pas (les autres origines,
 * même insolites, sont gardées), la méthode « carte-code » posée si aucune
 * n'est choisie. Un espace déjà juste n'est pas réécrit.
 */
export function assurerLEspaceDeSuivi(projectId: string, adresse: string): boolean {
  const origine = origineDe(adresse);
  if (!origine) return false;
  const espace = assurerEspace(projectId);
  const c = espace.configuration;
  const aEcrire: Record<string, unknown> = {};
  if (!c.adresse) aEcrire.adresse = adresse;
  if (!c.origines.includes(origine)) aEcrire.origines = [...c.origines, origine];
  if (!c.methodeSuivi) aEcrire.methodeSuivi = 'carte-code';
  if (Object.keys(aEcrire).length) ecrireConfiguration(projectId, aEcrire);
  return true;
}

/** Ce que la carte dit du consentement, selon le mode du suivi. */
function phraseDuBandeau(mode: 'anonyme' | 'visiteur'): string {
  return mode === 'visiteur'
    ? 'Le suivi est en MODE VISITEUR : le script affiche lui-même son bandeau d’accord (sans cookie) — n’en ajouter aucun autre pour lui ; ajouter seulement un lien « gérer mon choix » qui appelle belugaSuivi.accord() sur la page de confidentialité.'
    : 'Le script est anonyme et sans cookie : aucun bandeau de consentement à ajouter pour lui.';
}

/** La description de la carte de correction : quoi retirer, quoi poser, quoi garder. */
function descriptionDeLaCarte(projectId: string, adresse: string, diagnostic: DiagnosticSuivi): string {
  const espace = lireEspace(projectId)!;
  const projet = store.getProject(projectId);
  return [
    `Le site en production (${adresse}) doit être suivi par Beluga, par défaut. Constat à la dernière lecture de sa page d’accueil : ${LIBELLE_DIAGNOSTIC_SUIVI[diagnostic].toLowerCase()}.`,
    '',
    consigneDeCorrection(diagnostic),
    '',
    `EXTRAIT À POSER dans le <head> de chaque page servie en production : ${extraitDeSuivi(adresseDeBeluga(), espace.cleSuivi)}`,
    consigneDesObjectifs(espace.modeSuivi),
    `APPELS À LA MAIN (achats, objectifs sans clic) :\n${modeDEmploiDuSuivi()}`,
    `PHRASE À AJOUTER À LA PAGE « CONFIDENTIALITÉ » :\n${phraseDeConfidentialite(espace.configuration.langue, projet?.name ?? '', espace.modeSuivi)}`,
    '',
    `${phraseDuBandeau(espace.modeSuivi)} Sur un site à gabarits compilés (ProcessWire…), écrire dans les gabarits sources, jamais dans leur cache.`,
    'La mise en production reste le geste de l’utilisateur : le suivi sera confirmé tout seul à la première visite reçue.',
  ].join('\n');
}

/**
 * UNE CARTE DU SUIVI PAR PROJET, QUEL QUE SOIT CELUI QUI LA DEMANDE : le démon
 * (correction), le bouton « Installer le suivi » de Statistiques, ou l'agent de
 * l'atelier (`poser_suivi`). Tous partagent `carte_suivi_id` : tant que la carte
 * existe, aucune autre ne naît et c'est elle qu'on rend. Naître ne marque RIEN
 * comme posé : seul le code lu sur le site le fait (`ecrireDiagnostic`), ou la
 * première visite reçue.
 */
async function naitreLaCarteDuSuivi(
  projectId: string,
  entree: { title: string; description: string; origineAgentId?: string },
  premierTour: 'en-serie' | true,
  remplacer = false,
): Promise<{ card: Card; deja: boolean }> {
  const deja = remplacer ? null : carteDuSuivi(projectId);
  if (deja) return { card: deja, deja: true };
  const { faireNaitreLaCarte } = await import('./naissance-de-carte.js');
  const { card } = await faireNaitreLaCarte(
    projectId,
    {
      auteur: 'marketing',
      ...(entree.origineAgentId ? { origineAgentId: entree.origineAgentId, origineAt: Date.now() } : {}),
      title: entree.title,
      description: entree.description,
      labels: [LABEL_SUIVI_DES_VISITES],
      origin: 'agent',
    },
    /* LA CARTE SUIT LE PARCOURS COMPLET (MEM-3555) : son cadrage part tout
       seul jusqu'à la compréhension. Rien ne se lance au travail sans le clic
       de l'utilisateur. */
    { premierTour },
  );
  assurerEspace(projectId);
  getDb().prepare('UPDATE marketing_espaces SET carte_suivi_id = ? WHERE project_id = ?').run(card.id, projectId);
  bus.emit({ type: 'marketing', projectId });
  return { card, deja: false };
}

/**
 * UNE CARTE DE CORRECTION, UNE SEULE. Tant que la carte déjà posée existe —
 * quelle que soit sa colonne —, aucune autre ne naît : la correction peut
 * attendre sa mise en production sans que le démon ne la redemande. Les
 * corrections partent en SÉRIE : une carte par projet ne lance jamais tous les
 * agents d'un coup.
 */
async function poserLaCarteDeCorrection(projectId: string, adresse: string, diagnostic: DiagnosticSuivi): Promise<string | null> {
  if (carteDuSuivi(projectId)) return null;
  // Un agent du projet pose le code lui-même (outil « statistiques ») : pas de carte en doublon.
  if (installationParUnAgentEnCours(projectId)) return null;
  const { card } = await naitreLaCarteDuSuivi(
    projectId,
    {
      title: diagnostic === 'ancien-outil' ? 'Remplacer l’ancien suivi des visites' : 'Poser le suivi des visites',
      description: descriptionDeLaCarte(projectId, adresse, diagnostic),
    },
    'en-serie',
  );
  return card.id;
}

/**
 * LE BOUTON « INSTALLER LE SUIVI » (onglet Statistiques) et l'outil
 * `poser_suivi` de l'agent de l'atelier. Sans adresse connue, la carte part
 * quand même : son cadrage demande l'adresse du site à l'utilisateur.
 */
export async function installerLeSuivi(projectId: string, origineAgentId?: string): Promise<{ card: Card; deja: boolean }> {
  const projet = store.getProject(projectId);
  if (!projet) throw new Error('projet introuvable');
  // Ce geste est EXPLICITE : seule une carte encore en demande ou au travail
  // se rouvre. Une carte « À déployer » ou archivée est un travail fini — une
  // nouvelle carte naît et prend sa place dans `carte_suivi_id`.
  const deja = carteDuSuiviEnTravail(projectId);
  if (deja) return { card: deja, deja: true };
  const espace = assurerEspace(projectId);
  const adresse = adresseDeProductionDuProjet(projet, espace.configuration.adresse, sitesRattachesALaMain(projectId));
  if (adresse) assurerLEspaceDeSuivi(projectId, adresse);
  const diagnostic = lireEtatDuSuivi(projectId).diagnostic;
  const description = adresse
    ? descriptionDeLaCarte(projectId, adresse, diagnosticACorriger(diagnostic) ? diagnostic! : 'absent')
    : [
        'Poser le script de suivi des visites de Beluga sur le site en production de ce projet, sans rien changer d’autre.',
        '',
        'ADRESSE DU SITE INCONNUE : la demander à l’utilisateur pendant le cadrage (« ask_user »), puis la déclarer dans les réglages du projet (adresse de production) — le script refuse les sites non déclarés.',
        '',
        `EXTRAIT À POSER dans le <head> de chaque page servie en production : ${extraitDeSuivi(adresseDeBeluga(), espace.cleSuivi)}`,
        consigneDesObjectifs(espace.modeSuivi),
        `APPELS À LA MAIN (achats, objectifs sans clic) :\n${modeDEmploiDuSuivi()}`,
        `PHRASE À AJOUTER À LA PAGE « CONFIDENTIALITÉ » :\n${phraseDeConfidentialite(espace.configuration.langue, projet.name, espace.modeSuivi)}`,
        '',
        `${phraseDuBandeau(espace.modeSuivi)} La mise en production reste le geste de l’utilisateur : le suivi sera confirmé tout seul à la première visite reçue.`,
      ].join('\n');
  return naitreLaCarteDuSuivi(projectId, { title: 'Installer le suivi des visites', description, origineAgentId }, true, true);
}

export interface BilanDuSuivi {
  projectId: string;
  adresse: string;
  diagnostic: DiagnosticSuivi;
  carteId: string | null;
}

/** Un seul projet : l'espace, la lecture de la page, la carte si besoin. */
export async function assurerLeSuiviDuProjet(projectId: string, lecteur: typeof fetch = fetch, maintenant = Date.now()): Promise<BilanDuSuivi | null> {
  const projet = store.getProject(projectId);
  if (!projet || estUnRegroupement(projet)) return null;
  // Un projet dont le suivi marketing est coupé ne reçoit plus de carte de correction.
  if (lireEspace(projectId)?.actif === false) return null;
  const adresse = adresseDeProductionDuProjet(projet, lireEspace(projectId)?.configuration.adresse, sitesRattachesALaMain(projectId));
  if (!adresse || !assurerLEspaceDeSuivi(projectId, adresse)) return null;
  const espace = lireEspace(projectId)!;
  const page = await lireLaPage(adresse, lecteur);
  const diagnostic: DiagnosticSuivi = page === null ? 'injoignable' : diagnostiquerSuivi(page, espace.cleSuivi, adresseDeBeluga());
  ecrireDiagnostic(projectId, diagnostic, maintenant);
  const carteId = diagnosticACorriger(diagnostic) ? await poserLaCarteDeCorrection(projectId, adresse, diagnostic) : null;
  bus.emit({ type: 'marketing', projectId });
  return { projectId, adresse, diagnostic, carteId };
}

/** Tous les projets vivants, l'un après l'autre : une panne sur l'un n'arrête pas les autres. */
export async function assurerLeSuiviParDefaut(lecteur: typeof fetch = fetch): Promise<BilanDuSuivi[]> {
  const bilans: BilanDuSuivi[] = [];
  for (const projet of store.listProjects()) {
    try {
      const bilan = await assurerLeSuiviDuProjet(projet.id, lecteur);
      if (bilan) bilans.push(bilan);
    } catch (err) {
      log.warn(`suivi par défaut : « ${projet.name} » non traité`, err);
    }
  }
  const cartes = bilans.filter((b) => b.carteId).length;
  if (bilans.length) log.info(`suivi par défaut : ${bilans.length} site(s) relu(s), ${cartes} carte(s) de correction posée(s)`);
  return bilans;
}

/**
 * « TESTER LE SUIVI » (écran Statistiques, demande du 28/09/2026) : relit la
 * page du site TOUT DE SUITE et rend ce qu'elle porte. Un projet passe par le
 * même chemin que le tour quotidien (carte de correction comprise) ; un site
 * autonome n'a que sa lecture — aucune carte ne peut naître sans projet.
 */
export async function testerLeSuivi(id: string, lecteur: typeof fetch = fetch, maintenant = Date.now()): Promise<{ diagnostic: DiagnosticSuivi; adresse: string }> {
  if (!estSiteAutonome(id)) {
    const bilan = await assurerLeSuiviDuProjet(id, lecteur, maintenant);
    if (!bilan) throw new Error('Adresse du site inconnue : déclarez-la dans les réglages du projet.');
    return { diagnostic: bilan.diagnostic, adresse: bilan.adresse };
  }
  const espace = lireEspace(id);
  if (!espace) throw new Error('site introuvable');
  const adresse = espace.configuration.adresse;
  if (!adresse) throw new Error('Adresse du site inconnue.');
  const page = await lireLaPage(adresse, lecteur);
  const diagnostic: DiagnosticSuivi = page === null ? 'injoignable' : diagnostiquerSuivi(page, espace.cleSuivi, adresseDeBeluga());
  ecrireDiagnostic(id, diagnostic, maintenant);
  bus.emit({ type: 'marketing', projectId: id });
  return { diagnostic, adresse };
}

const PERIODE_MS = 24 * 3_600_000;

/**
 * AU DÉMARRAGE, UNE MINUTE APRÈS (le démarrage ne l'attend jamais), puis
 * chaque jour. `BELUGA_SUIVI_PAR_DEFAUT=0` coupe tout.
 */
export function demarrerLeSuiviParDefaut(): NodeJS.Timeout | null {
  if (process.env.BELUGA_SUIVI_PAR_DEFAUT === '0') return null;
  const tour = () => void assurerLeSuiviParDefaut().catch((err) => log.warn('suivi par défaut : tour impossible', err));
  const premier = setTimeout(tour, 60_000);
  premier.unref?.();
  const minuteur = setInterval(tour, PERIODE_MS);
  minuteur.unref?.();
  return minuteur;
}
