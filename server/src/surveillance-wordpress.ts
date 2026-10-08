import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DELAI_WORDPRESS_MS,
  ECHECS_AVANT_DEPANNAGE,
  GENRES_DES_EXTENSIONS,
  GENRES_DES_JOURNAUX,
  PERIODE_EXTENSIONS_WP_MS,
  PERIODE_FAILLES_MS,
  PERIODE_JOURNAUX_WP_MS,
  PERIODE_NETTOYAGE_JOURNAUX_MS,
  SUIVI_WORDPRESS_MS,
  bascule,
  compacterFluxWordfence,
  courrielDeSoucisWordpress,
  decisionDeCourrielDePanne,
  doitApaiserParCourriel,
  doitEnvoyerLeRecapitulatif,
  estImportant,
  extensionsActives,
  jugerConfigWordpress,
  journalDeWordpress,
  jugerFicheCatalogue,
  lireDecouverte,
  lireInventaire,
  lireJournaux,
  lireNettoyage,
  phraseDuSouci,
  positionApresNettoyage,
  prochaineMoyenne,
  rapprocher,
  recapitulatifWordpress,
  scriptDecouverte,
  scriptExtensions,
  scriptJournaux,
  scriptNettoyageJournaux,
  seuilDuNettoyage,
  soucisDeLInventaire,
  soucisDesJournaux,
  suiviDeLigne,
  suiviVide,
  texteAlerte,
  type ConfigWordpress,
  type ConstatWordpress,
  type EtatCatalogue,
  type GenreSouci,
  type IndexFailles,
  type InventaireWordpress,
  type LectureJournaux,
  type SiteSurveille,
  type SouciEnCours,
  type SouciWordpress,
  type SuiviWordpress,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { listerAcces } from './coffre-fort.js';
import { getDb } from './db.js';
import { log } from './logger.js';
import { notify } from './notify.js';
import {
  diffuser,
  listerSites,
  lireSurveillance,
  refermerAlerteCourrielDuSite,
  refermerIncidentDuSite,
} from './surveillance.js';

/**
 * LE CONTRÔLE WORDPRESS — les passages sur le serveur du site, sans agent.
 *
 * Les règles (ce qui fait un souci, une faille, un pic, les scripts envoyés)
 * sont PURES et vivent dans `shared/src/surveillance-wordpress.ts`. Ici : la
 * connexion SSH avec la fiche du coffre-fort, la base de failles Wordfence et
 * le catalogue de WordPress (un téléchargement par jour, pour tous les sites),
 * le suivi de 30 jours et les courriels.
 *
 * CINQ PRINCIPES.
 *
 *  1. **AUCUN AGENT, AUCUNE DÉPENSE.** L'agent pose la configuration une fois
 *     (`surveillance_recette`) ; chaque passage rejoue des scripts fixes.
 *  2. **UNE PANNE D'ACCÈS N'EST PAS UNE PANNE DU SITE.** Un SSH refusé ou trop
 *     lent devient un souci « accès » (site à surveiller), jamais un point rouge.
 *  3. **UNE ERREUR FATALE EST UNE PANNE**, qui suit le chemin de la page :
 *     alerte à la chute, courriel et enquête après `ECHECS_AVANT_DEPANNAGE`
 *     lectures d'affilée qui en montrent — et RIEN avant (DEC-232).
 *  4. **UN COURRIEL PAR APPARITION.** Un souci important fait partir un
 *     courriel quand il APPARAÎT ; la date est posée avant l'envoi, et tant
 *     qu'il dure, rien de plus (DEC-077).
 *  5. **AUCUN PASSAGE NE FAIT TOMBER UNE TOURNÉE.** Tout est rattrapé et dit
 *     dans le journal.
 */

/* ------------------------------------------------------------------ */
/* La connexion au serveur du site                                      */
/* ------------------------------------------------------------------ */

export type ExecutionDistante = { ok: true; sortie: string } | { ok: false; erreur: string };

/** La sortie gardée au plus : largement de quoi lire un inventaire de centaines d'extensions. */
const SORTIE_MAX = 4_000_000;

/**
 * JOUE UN SCRIPT SUR LE SERVEUR DU SITE, par SSH, avec la fiche du coffre-fort
 * relue à CHAQUE passage : changer le mot de passe au coffre suffit à réparer
 * le contrôle. Le mot de passe passe par l'environnement (`sshpass -e`), une clé
 * par un fichier temporaire effacé aussitôt — jamais par la ligne de commande.
 * Le script part sur l'entrée standard : aucune commande n'est composée à partir
 * d'un texte venu d'ailleurs.
 */
export async function executerSurLeServeur(accesId: string, script: string, delaiMs = DELAI_WORDPRESS_MS): Promise<ExecutionDistante> {
  const fiche = listerAcces().find((a) => a.id === accesId);
  if (!fiche) return { ok: false, erreur: `la fiche « ${accesId} » est introuvable au coffre-fort` };
  const c = fiche.champs ?? {};
  const hote = String(c.hote ?? c.adresse ?? '').trim();
  const utilisateur = String(c.utilisateur ?? c.identifiant ?? '').trim();
  if (!hote || !utilisateur) return { ok: false, erreur: `la fiche « ${fiche.nom} » ne dit pas l’hôte et l’utilisateur SSH` };
  const port = String(c.port ?? '').trim() || '22';
  const options = ['-p', port, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15'];

  let fichierCle: string | null = null;
  let programme = 'ssh';
  let args: string[];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (c.cle?.trim()) {
    fichierCle = path.join(os.tmpdir(), `beluga-wp-${crypto.randomUUID()}`);
    fs.writeFileSync(fichierCle, c.cle.endsWith('\n') ? c.cle : `${c.cle}\n`, { mode: 0o600 });
    args = [...options, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', fichierCle, `${utilisateur}@${hote}`, 'sh -s'];
  } else if (c.motDePasse) {
    programme = 'sshpass';
    env.SSHPASS = c.motDePasse;
    args = ['-e', 'ssh', ...options, '-o', 'PubkeyAuthentication=no', `${utilisateur}@${hote}`, 'sh -s'];
  } else {
    return { ok: false, erreur: `la fiche « ${fiche.nom} » n’a ni clé ni mot de passe` };
  }

  try {
    return await new Promise<ExecutionDistante>((resolve) => {
      const processus = spawn(programme, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      const sortie: Buffer[] = [];
      const plaintes: Buffer[] = [];
      let poids = 0;
      let rendu = false;
      const rendre = (r: ExecutionDistante) => {
        if (rendu) return;
        rendu = true;
        clearTimeout(minuteur);
        resolve(r);
      };
      const minuteur = setTimeout(() => {
        processus.kill('SIGKILL');
        rendre({ ok: false, erreur: `le serveur n’a pas répondu en ${Math.round(delaiMs / 1000)} secondes` });
      }, delaiMs);
      processus.stdout.on('data', (bloc: Buffer) => {
        if (poids < SORTIE_MAX) sortie.push(bloc);
        poids += bloc.length;
      });
      processus.stderr.on('data', (bloc: Buffer) => plaintes.push(bloc));
      processus.on('error', (err: any) =>
        rendre({ ok: false, erreur: err?.code === 'ENOENT' ? `${programme} n’est pas installé sur cette machine` : String(err?.message ?? err) }),
      );
      processus.on('close', (code) => {
        const texte = Buffer.concat(sortie).toString('utf8');
        // Nos scripts finissent tous par « @@FIN » : s'il est là, le serveur a répondu.
        if (texte.includes('@@FIN') || (code === 0 && texte)) return rendre({ ok: true, sortie: texte });
        const plainte = Buffer.concat(plaintes).toString('utf8').trim().split('\n').filter(Boolean).pop() ?? '';
        const raison =
          programme === 'sshpass' && code === 5
            ? 'mot de passe SSH refusé'
            : plainte || `la connexion a rendu le code ${code}`;
        rendre({ ok: false, erreur: raison.slice(0, 300) });
      });
      processus.stdin.on('error', () => undefined);
      processus.stdin.end(`${script}\n`);
    });
  } finally {
    if (fichierCle) fs.rmSync(fichierCle, { force: true });
  }
}

/* ------------------------------------------------------------------ */
/* La base de failles Wordfence et le catalogue de WordPress            */
/* ------------------------------------------------------------------ */

const DOSSIER = () => path.join(CONFIG.dataDir, 'wordpress');
const FICHIER_FAILLES = () => path.join(DOSSIER(), 'failles.json');
const FICHIER_CATALOGUE = () => path.join(DOSSIER(), 'catalogue.json');
/** Le flux « scanner » : le strict nécessaire pour reconnaître une version touchée. */
const FLUX_WORDFENCE = 'https://www.wordfence.com/api/intelligence/v3/vulnerabilities/scanner';
/** Après un téléchargement raté, on réessaie une heure plus tard, pas à chaque minute. */
const REESSAI_FAILLES_MS = 3_600_000;
/** Après un allègement raté, de même. */
const REESSAI_NETTOYAGE_MS = 3_600_000;

/**
 * LA CLÉ WORDFENCE, au coffre-fort : une fiche « clé d'API » dont le nom ou le
 * service parle de Wordfence. Un seul compte, celui de Haiko, pour tous les sites.
 */
export function cleWordfence(): string | null {
  const fiche = listerAcces().find(
    (a) => a.type === 'cle-api' && /wordfence/i.test(`${a.nom} ${a.champs?.service ?? ''}`) && a.champs?.cle?.trim(),
  );
  return fiche?.champs.cle.trim() ?? null;
}

let failles: { telechargeLe: number; index: IndexFailles } | null = null;
let failleTenteeLe = 0;

function lireJson<T>(fichier: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8')) as T;
  } catch {
    return null;
  }
}

function ecrireJson(fichier: string, valeur: unknown): void {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const provisoire = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(provisoire, JSON.stringify(valeur));
  fs.renameSync(provisoire, fichier);
}

/**
 * LA BASE DE FAILLES DU JOUR. Téléchargée une fois par jour pour TOUS les
 * sites, réduite à ce qui sert et gardée sur le disque : un redémarrage du démon
 * ne la retélécharge pas. Sans clé, `null` — et le résumé le dit à l'écran.
 */
export async function assurerLesFailles(maintenant = Date.now()): Promise<IndexFailles | null> {
  if (!failles) failles = lireJson(FICHIER_FAILLES());
  const cle = cleWordfence();
  if (!cle) return null;
  if (failles && maintenant - failles.telechargeLe < PERIODE_FAILLES_MS) return failles.index;
  if (maintenant - failleTenteeLe < REESSAI_FAILLES_MS) return failles?.index ?? null;
  failleTenteeLe = maintenant;
  try {
    const reponse = await fetch(FLUX_WORDFENCE, {
      headers: { authorization: `Bearer ${cle}`, accept: 'application/json', 'user-agent': 'Beluga Build-surveillance/1.0' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!reponse.ok) throw new Error(`Wordfence a répondu ${reponse.status}`);
    const index = compacterFluxWordfence(await reponse.json());
    failles = { telechargeLe: maintenant, index };
    ecrireJson(FICHIER_FAILLES(), failles);
    log.info(`surveillance WordPress : base de failles Wordfence à jour (${Object.keys(index).length} logiciels)`);
  } catch (err: any) {
    log.warn(`surveillance WordPress : base de failles Wordfence non téléchargée — ${err?.message ?? err}`);
  }
  return failles?.index ?? null;
}

type FicheCatalogue = { etat: EtatCatalogue; date?: string; luLe: number };
let catalogue: Record<string, FicheCatalogue> | null = null;
/** Au plus autant de fiches relues par passage : le catalogue est public, on ne le martèle pas. */
const FICHES_PAR_PASSAGE = 40;

/** LE CATALOGUE PUBLIC DE WORDPRESS : chaque extension relue au plus une fois par jour. */
async function fichesDuCatalogue(slugs: readonly string[], maintenant: number): Promise<Record<string, FicheCatalogue>> {
  if (!catalogue) catalogue = lireJson(FICHIER_CATALOGUE()) ?? {};
  const aLire = slugs.filter((s) => !catalogue![s] || maintenant - catalogue![s].luLe > PERIODE_FAILLES_MS).slice(0, FICHES_PAR_PASSAGE);
  for (const slug of aLire) {
    try {
      const adresse =
        'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information' +
        `&request%5Bslug%5D=${encodeURIComponent(slug)}` +
        ['sections', 'description', 'reviews', 'versions', 'screenshots', 'banners', 'icons', 'contributors', 'ratings']
          .map((f) => `&request%5Bfields%5D%5B${f}%5D=0`)
          .join('');
      const reponse = await fetch(adresse, { signal: AbortSignal.timeout(15_000) });
      const fiche = await reponse.json().catch(() => ({}));
      catalogue[slug] = { ...jugerFicheCatalogue(fiche, maintenant), luLe: maintenant };
    } catch {
      // Le catalogue injoignable ne dit rien : on garde l'ancienne fiche, s'il y en a une.
    }
  }
  if (aLire.length) ecrireJson(FICHIER_CATALOGUE(), catalogue);
  return catalogue;
}

/**
 * CE QUI SORT DE LA MACHINE, remplaçable par les essais : le serveur du site et
 * le catalogue de WordPress. Un essai qui appellerait le vrai réseau
 * dépendrait d'un site tiers et ne prouverait rien de nos règles.
 */
const dehors = { executer: executerSurLeServeur, fichesDuCatalogue };

/** Pour les essais seulement : un faux serveur, un faux catalogue. */
export function remplacerLeDehorsPourEssai(remplacement: Partial<typeof dehors>): void {
  Object.assign(dehors, remplacement);
}

/* ------------------------------------------------------------------ */
/* Le suivi et les constats                                             */
/* ------------------------------------------------------------------ */

function lireLigne(siteId: string): { config: ConfigWordpress; suivi: SuiviWordpress } | null {
  const ligne = getDb().prepare('SELECT wordpress, wp_suivi FROM sites_surveilles WHERE id = ?').get(siteId) as
    | { wordpress: string | null; wp_suivi: string | null }
    | undefined;
  if (!ligne?.wordpress) return null;
  try {
    const avis = jugerConfigWordpress(JSON.parse(ligne.wordpress));
    return avis.ok ? { config: avis.config, suivi: suiviDeLigne(ligne.wp_suivi) } : null;
  } catch {
    return null;
  }
}

function ecrireSuivi(siteId: string, suivi: SuiviWordpress): void {
  getDb().prepare('UPDATE sites_surveilles SET wp_suivi = ? WHERE id = ?').run(JSON.stringify(suivi), siteId);
}

interface LigneConstat {
  id: number;
  site_id: string;
  cle: string;
  genre: string;
  souci: string;
  premiere_vue: number;
  derniere_vue: number;
  resolu_le: number | null;
  courriel_le: number | null;
}

/** Le suivi de 30 jours d'un site : ce qui dure d'abord, puis le plus récent. */
export function listerConstats(siteId: string, maintenant = Date.now()): ConstatWordpress[] {
  const lignes = getDb()
    .prepare(
      `SELECT * FROM constats_wordpress WHERE site_id = ? AND (resolu_le IS NULL OR resolu_le >= ?)
        ORDER BY (resolu_le IS NULL) DESC, COALESCE(resolu_le, derniere_vue) DESC LIMIT 300`,
    )
    .all(siteId, maintenant - SUIVI_WORDPRESS_MS) as LigneConstat[];
  return lignes.map((l) => ({
    ...(JSON.parse(l.souci) as SouciWordpress),
    premiereVue: l.premiere_vue,
    derniereVue: l.derniere_vue,
    ...(l.resolu_le ? { resoluLe: l.resolu_le } : {}),
  }));
}

/** Efface les constats résolus depuis plus de 30 jours. */
export function purgerConstats(maintenant = Date.now()): number {
  return getDb().prepare('DELETE FROM constats_wordpress WHERE resolu_le IS NOT NULL AND resolu_le < ?').run(maintenant - SUIVI_WORDPRESS_MS)
    .changes;
}

/**
 * RAPPROCHE UN PASSAGE DE CE QUI ÉTAIT OUVERT, pour les genres qu'il surveille,
 * et l'écrit : la table du suivi ET les soucis en cours du résumé. Rend les
 * soucis IMPORTANTS qui viennent d'apparaître, et dont le courriel est à écrire
 * — leur date de courriel est posée ICI, avant l'envoi.
 */
function appliquerSoucis(
  siteId: string,
  suivi: SuiviWordpress,
  vus: readonly SouciWordpress[],
  genres: readonly GenreSouci[],
  maintenant: number,
): SouciWordpress[] {
  const db = getDb();
  const { ouvrir, garder, resoudre } = rapprocher(suivi.soucis, vus, genres);
  const fermer = db.prepare('UPDATE constats_wordpress SET resolu_le = ?, derniere_vue = ? WHERE site_id = ? AND cle = ? AND resolu_le IS NULL');
  for (const s of resoudre) fermer.run(maintenant, maintenant, siteId, s.cle);
  const tenir = db.prepare('UPDATE constats_wordpress SET derniere_vue = ?, souci = ? WHERE site_id = ? AND cle = ? AND resolu_le IS NULL');
  for (const s of garder) tenir.run(maintenant, JSON.stringify(s), siteId, s.cle);
  const nouveau = db.prepare(
    'INSERT INTO constats_wordpress (site_id, cle, genre, souci, premiere_vue, derniere_vue, courriel_le) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const aEcrire: SouciWordpress[] = [];
  for (const s of ouvrir) {
    const important = estImportant(s);
    nouveau.run(siteId, s.cle, s.genre, JSON.stringify(s), maintenant, maintenant, important ? maintenant : null);
    if (important) aEcrire.push(s);
  }
  const fermes = new Set(resoudre.map((s) => s.cle));
  const depuis = new Map(suivi.soucis.map((s) => [s.cle, s.depuis]));
  const vusParCle = new Map(vus.map((s) => [s.cle, s]));
  suivi.soucis = [
    // Les soucis d'autres genres restent tels quels ; ceux de ce passage sont rafraîchis.
    ...suivi.soucis.filter((s) => !fermes.has(s.cle) && !vusParCle.has(s.cle)),
    ...vus.map((s): SouciEnCours => ({ ...s, depuis: depuis.get(s.cle) ?? maintenant })),
  ];
  return aEcrire;
}

/** Le souci « accès » : ouvert quand le serveur refuse ou se tait, refermé dès qu'un passage aboutit. */
function noterAcces(siteId: string, suivi: SuiviWordpress, erreur: string | null, maintenant: number): void {
  appliquerSoucis(siteId, suivi, erreur ? [{ cle: 'acces', genre: 'acces', sujet: 'serveur', detail: erreur }] : [], ['acces'], maintenant);
}

/* ------------------------------------------------------------------ */
/* Les deux passages                                                    */
/* ------------------------------------------------------------------ */

/** Les courriels à écrire après une tournée : jamais pendant un passage. */
interface Suites {
  soucis: { siteId: string; soucis: SouciWordpress[] }[];
  pannes: { siteId: string; echecs: number }[];
  retours: { site: SiteSurveille; panneDepuis?: number }[];
}

/** LE RELEVÉ DES EXTENSIONS, des thèmes et du cœur, croisé avec les failles et le catalogue. */
async function passeExtensions(siteId: string, maintenant: number, suites: Suites): Promise<void> {
  const config = lireLigne(siteId)?.config;
  if (!config) return;
  const execution = await dehors.executer(config.acces.id, scriptExtensions(config));
  const lecture = execution.ok ? lireInventaire(execution.sortie) : null;
  const frais = lireLigne(siteId);
  if (!frais) return;
  const suiviFrais = frais.suivi;
  suiviFrais.extensionsLe = maintenant;
  if (!execution.ok || !lecture?.ok) {
    const erreur = !execution.ok ? execution.erreur : lecture && !lecture.ok ? lecture.erreur : 'réponse illisible';
    noterAcces(siteId, suiviFrais, erreur, maintenant);
    ecrireSuivi(siteId, suiviFrais);
    log.warn(`surveillance WordPress : relevé des extensions impossible sur ${siteId} — ${erreur}`);
    return;
  }
  noterAcces(siteId, suiviFrais, null, maintenant);
  const inventaire = lecture.inventaire;
  const index = await assurerLesFailles(maintenant);
  const fiches = await dehors.fichesDuCatalogue(inventaire.extensions.map((e) => e.slug), maintenant);
  const vus = soucisDeLInventaire({ inventaire, attendues: config.extensionsAttendues, failles: index, catalogue: fiches });
  suiviFrais.inventaire = inventaire;
  suiviFrais.faillesActives = !!index;
  const aEcrire = appliquerSoucis(siteId, suiviFrais, vus, GENRES_DES_EXTENSIONS, maintenant);
  ecrireSuivi(siteId, suiviFrais);
  if (aEcrire.length) suites.soucis.push({ siteId, soucis: aEcrire });
}

/**
 * LA LECTURE DES JOURNAUX. Seuls les octets nouveaux sont comptés, sur le
 * serveur. Une erreur fatale met le site en panne « journaux » ; une lecture
 * propre la referme. Le pic d'avertissements se juge sur la moyenne du site.
 */
async function passeJournaux(siteId: string, maintenant: number, suites: Suites): Promise<void> {
  const lu = lireLigne(siteId);
  if (!lu || !lu.config.journaux.length) {
    if (lu) {
      lu.suivi.journauxLe = maintenant;
      ecrireSuivi(siteId, lu.suivi);
    }
    return;
  }
  const { config } = lu;
  const positions = config.journaux.map((j) => lu.suivi.positions[j] ?? -1);
  const execution = await dehors.executer(config.acces.id, scriptJournaux(config, positions));
  const lecture = execution.ok ? lireJournaux(execution.sortie, config) : null;
  const frais = lireLigne(siteId);
  const site = lireSurveillance(siteId);
  if (!frais || !site) return;
  const suivi = frais.suivi;
  suivi.journauxLe = maintenant;
  if (!execution.ok || !lecture) {
    const erreur = execution.ok ? 'le dossier de WordPress est introuvable sur le serveur' : execution.erreur;
    noterAcces(siteId, suivi, erreur, maintenant);
    ecrireSuivi(siteId, suivi);
    log.warn(`surveillance WordPress : lecture des journaux impossible sur ${site.nom} — ${erreur}`);
    return;
  }
  noterAcces(siteId, suivi, null, maintenant);
  for (const j of lecture.journaux) suivi.positions[j.chemin] = j.position;

  // Un premier passage ne fait que MESURER : ni pic, ni moyenne, ni panne.
  if (lecture.lu) {
    const aEcrire = appliquerSoucis(siteId, suivi, soucisDesJournaux(lecture, suivi.moyenne), GENRES_DES_JOURNAUX, maintenant);
    suivi.moyenne = prochaineMoyenne(suivi.moyenne, lecture.avertissements);
    if (aEcrire.length) suites.soucis.push({ siteId, soucis: aEcrire });
  }
  jugerLaPanneDesJournaux(site, suivi, lecture, maintenant, suites);
  ecrireSuivi(siteId, suivi);
}

/**
 * L'ALLÈGEMENT DES JOURNAUX, une fois par jour, JUSTE APRÈS leur lecture : les
 * octets récents sont déjà comptés. Seuls les journaux propres à WordPress
 * perdent ce qui a plus de `JOURS_GARDES_JOURNAL` jours ; la position de lecture
 * recule d'autant (`positionApresNettoyage`), sinon la lecture suivante
 * repartirait de zéro et prendrait de vieilles erreurs fatales pour neuves.
 *
 * Un échec (accès, écriture) n'est NI une panne NI un souci : il se dit dans le
 * journal du démon, et l'allègement réessaie une heure plus tard.
 */
async function passeNettoyage(siteId: string, maintenant: number): Promise<void> {
  const lu = lireLigne(siteId);
  if (!lu) return;
  const { config } = lu;
  if (!config.journaux.some(journalDeWordpress)) {
    lu.suivi.journauxNettoyesLe = maintenant;
    ecrireSuivi(siteId, lu.suivi);
    return;
  }
  const execution = await dehors.executer(config.acces.id, scriptNettoyageJournaux(config, seuilDuNettoyage(maintenant)));
  const lecture = execution.ok ? lireNettoyage(execution.sortie, config) : null;
  const frais = lireLigne(siteId);
  if (!frais) return;
  const suivi = frais.suivi;
  const nom = lireSurveillance(siteId)?.nom ?? siteId;
  if (!lecture) {
    suivi.journauxNettoyesLe = maintenant - PERIODE_NETTOYAGE_JOURNAUX_MS + REESSAI_NETTOYAGE_MS;
    ecrireSuivi(siteId, suivi);
    const erreur = execution.ok ? 'le dossier de WordPress est introuvable sur le serveur' : execution.erreur;
    log.warn(`surveillance WordPress : allègement des journaux impossible sur ${nom} — ${erreur}`);
    return;
  }
  for (const j of lecture.nettoyes) {
    const position = positionApresNettoyage(suivi.positions[j.chemin], j.coupe);
    if (position !== undefined) suivi.positions[j.chemin] = position;
  }
  if (lecture.nettoyes.length) {
    suivi.dernierNettoyage = { le: maintenant, journaux: lecture.nettoyes.map(({ chemin, avant, apres }) => ({ chemin, avant, apres })) };
    log.info(
      `surveillance WordPress : journaux allégés sur ${nom} — ${lecture.nettoyes.map((j) => `${j.chemin} ${j.avant} → ${j.apres} octets`).join(', ')}`,
    );
  }
  if (lecture.echecs.length) {
    log.warn(`surveillance WordPress : journal impossible à réécrire sur ${nom} — ${lecture.echecs.join(', ')}`);
    suivi.journauxNettoyesLe = maintenant - PERIODE_NETTOYAGE_JOURNAUX_MS + REESSAI_NETTOYAGE_MS;
  } else {
    suivi.journauxNettoyesLe = maintenant;
  }
  ecrireSuivi(siteId, suivi);
}

/**
 * L'ERREUR FATALE, ET LE CHEMIN DE LA PANNE. Une lecture qui en montre : la
 * panne s'ouvre (ou dure), le compte d'affilée monte, et au troisième la carte
 * de dépannage et le courriel partent par le chemin de la page. Une lecture
 * propre : le compte retombe et, si la panne venait des journaux, le site revient.
 */
function jugerLaPanneDesJournaux(
  site: SiteSurveille,
  suivi: SuiviWordpress,
  lecture: LectureJournaux,
  maintenant: number,
  suites: Suites,
): void {
  const db = getDb();
  if (lecture.lu && lecture.fatales > 0) {
    const detail = lecture.exemples[0]?.slice(0, 300);
    suivi.echecsJournaux += 1;
    suivi.journauxEnErreur = { depuis: suivi.journauxEnErreur?.depuis ?? maintenant, ...(detail ? { detail } : {}) };
    db.prepare(
      'INSERT INTO controles_surveillance (site_id, instant, etat, raison, code, duree_ms, etape, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(site.id, maintenant, 'panne', 'journaux', null, 0, 'journaux', detail ?? `${lecture.fatales} erreur(s) fatale(s)`);
    if (site.etat !== 'panne') {
      db.prepare(
        "UPDATE sites_surveilles SET etat = 'panne', raison = 'journaux', etape_echouee = NULL, depuis = ?, derniere_panne = ? WHERE id = ?",
      ).run(maintenant, maintenant, site.id);
      const tombe = { ...site, etat: 'panne' as const, raison: 'journaux' as const, etapeEchouee: undefined };
      if (bascule(site.etat, 'panne') === 'tombe') {
        const texte = texteAlerte(tombe);
        log.warn(`surveillance WordPress : ${site.nom} — ${texte.corps}`);
        notify({ motif: 'site-indisponible', title: texte.titre, body: texte.corps, reference: `site:${site.id}`, element: site.nom });
      }
    } else {
      db.prepare('UPDATE sites_surveilles SET derniere_panne = ? WHERE id = ?').run(maintenant, site.id);
    }
    if (suivi.echecsJournaux >= ECHECS_AVANT_DEPANNAGE) suites.pannes.push({ siteId: site.id, echecs: suivi.echecsJournaux });
    return;
  }
  if (!lecture.lu && suivi.journauxEnErreur) return; // rien de neuf à lire : la panne n'est ni confirmée ni démentie
  suivi.echecsJournaux = 0;
  if (!suivi.journauxEnErreur) return;
  delete suivi.journauxEnErreur;
  if (site.etat === 'panne' && site.raison === 'journaux') {
    db.prepare("UPDATE sites_surveilles SET etat = 'ok', raison = NULL, depuis = ? WHERE id = ?").run(maintenant, site.id);
    if (site.incidentCardId) refermerIncidentDuSite(site.id);
    if (doitApaiserParCourriel(site)) {
      const panneDepuis = site.alerteCourrielDepuis;
      refermerAlerteCourrielDuSite(site.id);
      suites.retours.push({ site, panneDepuis });
    }
    log.info(`surveillance WordPress : ${site.nom} — plus d’erreur grave dans les journaux`);
  }
}

/* ------------------------------------------------------------------ */
/* La tournée                                                           */
/* ------------------------------------------------------------------ */

const enCours = new Set<string>();
let recapEnCours = false;

/**
 * LA TOURNÉE WORDPRESS, appelée à chaque battement de la surveillance. Chaque
 * site configuré passe à SES rythmes ; jamais deux passages du même site à la
 * fois. Les courriels partent APRÈS les passages.
 */
export async function tourneeWordpress(maintenant = Date.now(), forcer?: string[]): Promise<void> {
  const sites = listerSites().filter((s) => s.wordpress && !enCours.has(s.id) && (!forcer || forcer.includes(s.id)));
  if (!sites.length) return void (await envoyerLeRecapitulatifSiCestLHeure(maintenant));
  const suites: Suites = { soucis: [], pannes: [], retours: [] };
  for (const site of sites) enCours.add(site.id);
  try {
    await Promise.all(
      sites.map(async (site) => {
        const resume = site.wpResume;
        try {
          if (forcer || maintenant - (resume?.journauxLe ?? 0) >= PERIODE_JOURNAUX_WP_MS) await passeJournaux(site.id, maintenant, suites);
          // Après la lecture, jamais avant : ce qui part a déjà été compté.
          if (maintenant - (resume?.journauxNettoyesLe ?? 0) >= PERIODE_NETTOYAGE_JOURNAUX_MS) await passeNettoyage(site.id, maintenant);
          if (forcer || maintenant - (resume?.extensionsLe ?? 0) >= PERIODE_EXTENSIONS_WP_MS) await passeExtensions(site.id, maintenant, suites);
        } catch (err: any) {
          log.warn(`surveillance WordPress : passage impossible sur ${site.nom}`, err?.message ?? err);
        }
      }),
    );
  } finally {
    for (const site of sites) enCours.delete(site.id);
  }
  purgerConstats(maintenant);
  diffuser();
  await executerLesSuites(suites, maintenant);
  await envoyerLeRecapitulatifSiCestLHeure(maintenant);
}

async function executerLesSuites(suites: Suites, maintenant: number): Promise<void> {
  if (!suites.soucis.length && !suites.pannes.length && !suites.retours.length) return;
  const courriels = await import('./alerte-courriel-site.js');
  for (const { siteId, soucis } of suites.soucis) {
    const site = lireSurveillance(siteId);
    if (!site) continue;
    try {
      const { sujet, texte, html } = courrielDeSoucisWordpress({ site, soucis });
      const resultat = await courriels.envoyer(sujet, texte, html);
      if (resultat.envoye) log.info(`surveillance WordPress : courriel — ${site.nom} : ${soucis.map(phraseDuSouci).join(' ; ')}`);
    } catch (err: any) {
      log.warn(`surveillance WordPress : courriel impossible pour ${site.nom}`, err?.message ?? err);
    }
  }
  for (const { siteId, echecs } of suites.pannes) {
    try {
      const { ouvrirLeDepannage, devinerLeProjetDuSite } = await import('./depannage-site.js');
      const site = lireSurveillance(siteId);
      if (!site) continue;
      devinerLeProjetDuSite(site);
      await ouvrirLeDepannage(siteId, maintenant, echecs);
      const frais = lireSurveillance(siteId);
      const decision = frais ? decisionDeCourrielDePanne(frais, echecs, maintenant) : null;
      if (decision?.ecrire) await courriels.envoyerCourrielDePanneDuSite({ siteId, echecs, genre: decision.genre, maintenant });
    } catch (err: any) {
      log.warn(`surveillance WordPress : dépannage impossible pour ${siteId}`, err?.message ?? err);
    }
  }
  for (const retour of suites.retours) {
    try {
      await courriels.envoyerCourrielDeRetourDuSite({ ...retour, maintenant });
    } catch (err: any) {
      log.warn(`surveillance WordPress : courriel de retour impossible pour ${retour.site.id}`, err?.message ?? err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Le récapitulatif de la semaine                                       */
/* ------------------------------------------------------------------ */

const CLE_RECAP = 'surveillance.wordpress.recapitulatif';

/** LE LUNDI MATIN, un courriel fait le point sur tous les sites WordPress. La date est posée avant l'envoi. */
async function envoyerLeRecapitulatifSiCestLHeure(maintenant: number): Promise<void> {
  if (recapEnCours) return;
  const db = getDb();
  const ligne = db.prepare('SELECT value FROM meta WHERE key = ?').get(CLE_RECAP) as { value: string } | undefined;
  if (!doitEnvoyerLeRecapitulatif(maintenant, ligne ? Number(ligne.value) : undefined)) return;
  const sites = listerSites().filter((s) => s.wordpress);
  if (!sites.length) return;
  recapEnCours = true;
  try {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(CLE_RECAP, String(maintenant));
    const semaine = maintenant - 7 * 24 * 3_600_000;
    const contenu = recapitulatifWordpress({
      sites: sites.map((s) => ({
        id: s.id,
        nom: s.nom,
        url: s.url,
        panne: s.etat === 'panne',
        soucis: s.wpResume?.soucis ?? [],
        resolus: (
          db.prepare('SELECT COUNT(*) AS n FROM constats_wordpress WHERE site_id = ? AND resolu_le >= ?').get(s.id, semaine) as { n: number }
        ).n,
      })),
    });
    const { envoyer } = await import('./alerte-courriel-site.js');
    const resultat = await envoyer(contenu.sujet, contenu.texte, contenu.html);
    if (resultat.envoye) log.info(`surveillance WordPress : récapitulatif de la semaine envoyé (${sites.length} sites)`);
  } catch (err: any) {
    log.warn('surveillance WordPress : récapitulatif impossible', err?.message ?? err);
  } finally {
    recapEnCours = false;
  }
}

/* ------------------------------------------------------------------ */
/* La mise en place : l'essai de l'agent, et l'état accepté             */
/* ------------------------------------------------------------------ */

export type EssaiWordpress =
  | { ok: true; config: ConfigWordpress; suivi: SuiviWordpress; inventaire: InventaireWordpress; texte: string }
  | { ok: false; texte: string };

/**
 * L'ESSAI DE L'AGENT. Ce qu'il n'a pas dit (dossier, outil, journaux) est
 * DÉCOUVERT sur le serveur ; puis l'inventaire est relevé et les journaux
 * mesurés pour de vrai. Rien n'est enregistré : l'essai rend la configuration
 * complète et le suivi de départ — positions en FIN de journal, pour qu'une
 * erreur ancienne ne fasse pas tomber le site à la mise en place.
 */
export async function essayerWordpress(url: string, brut: unknown): Promise<EssaiWordpress> {
  const partiel = (brut ?? {}) as Record<string, any>;
  const accesId = String(partiel?.acces?.id ?? '').trim();
  if (!accesId) return { ok: false, texte: 'Il faut la fiche SSH du coffre-fort : « wordpress »: { "acces": { "id": "…" } }.' };
  const lignes: string[] = [];
  let racine = partiel.racine;
  let wpCli = partiel.wpCli;
  let journaux: string[] | undefined = Array.isArray(partiel.journaux) ? partiel.journaux : undefined;
  if (!racine || !wpCli || !journaux) {
    const decouverte = await dehors.executer(accesId, scriptDecouverte(), 60_000);
    if (!decouverte.ok) return { ok: false, texte: `Connexion SSH impossible : ${decouverte.erreur}` };
    const vu = lireDecouverte(decouverte.sortie, new URL(url).hostname);
    lignes.push(
      `Découverte : WordPress trouvé dans ${vu.racines.length ? vu.racines.join(', ') : 'aucun dossier'} ; outil ${vu.wpCli ?? 'introuvable'} ; journaux ${vu.journaux.join(', ') || 'aucun'}.`,
    );
    racine ??= vu.racine;
    wpCli ??= vu.wpCli;
    journaux ??= vu.journaux;
    if (!racine)
      return {
        ok: false,
        texte: `${lignes.join('\n')}\n${vu.racines.length > 1 ? 'Plusieurs sites sur ce serveur : redonne « racine ».' : 'Aucun WordPress trouvé : redonne « racine » (le dossier qui contient wp-config.php).'}`,
      };
    if (!wpCli) return { ok: false, texte: `${lignes.join('\n')}\nL’outil en ligne de commande de WordPress est introuvable : redonne « wpCli ».` };
  }
  const avis = jugerConfigWordpress({ acces: { id: accesId }, racine, wpCli, journaux, extensionsAttendues: partiel.extensionsAttendues ?? [] });
  if (!avis.ok) return { ok: false, texte: `${lignes.join('\n')}\nConfiguration refusée : ${avis.raison}.` };
  const config = avis.config;

  const releve = await dehors.executer(accesId, scriptExtensions(config));
  if (!releve.ok) return { ok: false, texte: `${lignes.join('\n')}\nRelevé des extensions impossible : ${releve.erreur}` };
  const lecture = lireInventaire(releve.sortie);
  if (!lecture.ok) return { ok: false, texte: `${lignes.join('\n')}\nRelevé des extensions impossible : ${lecture.erreur}` };
  const inventaire = lecture.inventaire;
  if (!config.extensionsAttendues.length) config.extensionsAttendues = extensionsActives(inventaire);

  const suivi = suiviVide();
  if (config.journaux.length) {
    const mesure = await dehors.executer(accesId, scriptJournaux(config, config.journaux.map(() => -1)), 60_000);
    const tailles = mesure.ok ? lireJournaux(mesure.sortie, config) : null;
    if (!tailles) return { ok: false, texte: `${lignes.join('\n')}\nJournaux illisibles : ${mesure.ok ? 'réponse incomplète' : mesure.erreur}` };
    for (const j of tailles.journaux) suivi.positions[j.chemin] = j.position;
    const absents = tailles.journaux.filter((j) => j.absent).map((j) => j.chemin);
    lignes.push(
      `Journaux : ${tailles.journaux.filter((j) => !j.absent).map((j) => `${j.chemin} (${Math.round(j.taille / 1024)} ko)`).join(', ') || 'aucun lisible'}${absents.length ? ` ; absents : ${absents.join(', ')}` : ''}. La lecture partira de leur fin actuelle.`,
    );
  }
  suivi.journauxLe = Date.now();
  const index = await assurerLesFailles();
  suivi.faillesActives = !!index;
  const majs = soucisDeLInventaire({ inventaire, attendues: [], failles: index });
  lignes.push(
    `WordPress ${inventaire.core.version || '?'} ; ${inventaire.extensions.length} extensions (${config.extensionsAttendues.length} actives attendues), ${inventaire.themes.length} thèmes.`,
    majs.length ? `Déjà visible : ${majs.map(phraseDuSouci).join(' ; ')}.` : 'Aucune mise à jour ni faille connue en attente.',
    index ? 'Failles : base Wordfence consultée.' : 'Failles : clé Wordfence absente du coffre-fort — les failles ne seront pas cherchées tant qu’elle manque.',
    `Configuration retenue : ${JSON.stringify(config)}`,
  );
  return { ok: true, config, suivi, inventaire, texte: lignes.join('\n') };
}

/**
 * L'ÉTAT ACTUEL DEVIENT L'ÉTAT ATTENDU : les extensions actives au dernier
 * relevé forment la nouvelle liste, et les soucis « désactivée » ou
 * « disparue » se referment. C'est le geste de qui a retiré une extension exprès.
 */
export function accepterLesExtensionsActuelles(siteId: string, maintenant = Date.now()): { ok: boolean; raison?: string } {
  const lu = lireLigne(siteId);
  if (!lu) return { ok: false, raison: 'aucun contrôle WordPress sur ce site' };
  if (!lu.suivi.inventaire) return { ok: false, raison: 'aucun relevé des extensions pour l’instant' };
  const config = { ...lu.config, extensionsAttendues: extensionsActives(lu.suivi.inventaire) };
  getDb().prepare('UPDATE sites_surveilles SET wordpress = ? WHERE id = ?').run(JSON.stringify(config), siteId);
  const restants = soucisDeLInventaire({ inventaire: lu.suivi.inventaire, attendues: config.extensionsAttendues });
  appliquerSoucis(
    siteId,
    lu.suivi,
    restants.filter((s) => s.genre === 'desactivee' || s.genre === 'disparue'),
    ['desactivee', 'disparue'],
    maintenant,
  );
  ecrireSuivi(siteId, lu.suivi);
  diffuser();
  return { ok: true };
}
