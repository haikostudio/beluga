import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import type http from 'node:http';
import {
  FONCTIONNALITES_DECOUVRABLES,
  GESTES_MUETS,
  JOURNAL_MAX_PAR_JOUR,
  JOURS_DE_RATTRAPAGE,
  PANNES_MAX_PAR_JOUR,
  ROUTE_DU_RAPPORT_D_USAGE,
  RapportDUsage,
  appareilDuNavigateur,
  centiles,
  empreinteDePanne,
  familleDeRoute,
  fonctionnaliteDuGeste,
  genreDuProjet,
  lieuDeLaPanne,
  identiteDInstallation,
  masquerLesCitations,
  nettoyerLeRapport,
  nettoyerPile,
  nettoyerTexteLibre,
  prochaineEtape,
  type AccountQuota,
  type CompteUtilisateur,
  type DeployRun,
  type PanneDuRapport,
  type ServerEvent,
} from '@beluga/shared';
import { bus } from './bus.js';
import { listerComptes } from './comptes.js';
import { CONFIG } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log, surErreurDuJournal } from './logger.js';
import { machineHebergee } from './offre-hebergee.js';
import { paysDeLaRequete } from './pays-des-visites.js';
import { adresseDuRelaisIci, appelerLeRelais, identiteAuRelais, versionDeLInstallation } from './relais-installations.js';
import * as store from './store.js';

/*
 * LE RAPPORT D'USAGE ANONYME, CÔTÉ INSTALLATION (`shared/src/rapport-d-usage.ts`,
 * décisions du 22/10/2026).
 *
 * La journée se mesure EN MÉMOIRE, se pose en base toutes les deux minutes
 * (`usage_local`) pour survivre à un redémarrage, et part avec le signe de vie
 * quotidien — plus tôt quand une panne NOUVELLE apparaît. Une journée que le
 * relais n'a pas reçue est rattrapée au prochain envoi (quatorze jours au plus).
 *
 * CE QUI NE PART JAMAIS : une adresse de machine (le pays est déduit puis
 * l'adresse oubliée, sur-le-champ), un nom de personne, de projet ou de carte,
 * le texte d'une demande. Les personnes sont des NUMÉROS : un hachage salé par
 * un sel propre à l'installation, stable chez elle, impossible à remonter.
 *
 * L'ENVOI EST SILENCIEUX (décision du 22/10/2026) : aucune annonce, aucun
 * interrupteur, aucune question posée aux personnes ; seule l'adresse de
 * l'administrateur reste soumise à son accord (`partageDuCourriel`, signe de vie).
 *
 * RIEN NE SE MESURE quand l'installation ne joint pas le relais (machine de
 * l'auteur, démon d'essai). Aucune mesure ne peut gêner l'application : chaque
 * point d'entrée avale ses erreurs.
 */

interface PersonneDuJour {
  numero: string;
  role: string;
  pays?: string;
  langue?: string;
  langueNavigateur?: string;
  appareil?: string;
  systeme?: string;
  navigateur?: string;
  ecran?: string;
  installee?: boolean;
  theme?: string;
  sessions: number;
  dureeS: number;
  gestes: number;
  fonctionnalites: Record<string, number>;
}

interface Journee {
  jour: string;
  demarrages: number;
  personnes: Record<string, PersonneDuJour>;
  fonctionnalites: Record<string, number>;
  gestes: Record<string, number>;
  ecrans: Record<string, number>;
  zones: Record<string, number>;
  sessions: { n: number; dureeS: number };
  latences: { api: Record<string, number[]>; ecrans: Record<string, number[]>; demarrageAgent: number[]; publication: number[] };
  coupures: number;
  reconnexions: number;
  agents: { lances: number; termines: number; echoues: number; arretes: number; dureeS: number; parMoteur: Record<string, number>; parNiveau: Record<string, number> };
  choix: Record<string, number>;
  limitesAtteintes: Record<string, number>;
  toursCoupesParLimite: number;
  publications: { reussies: number; echouees: number; arretees: number };
  journal: { t: number; p?: string; e: string; z?: string }[];
  erreurs: Record<string, PanneDuRapport>;
  memoirePicPct: number;
  chargePic: number;
  misesAJour: { de: string; vers: string; issue: 'reussie' | 'ratee'; dureeS?: number; t: number }[];
  dernierePanneServeur?: number;
}

const LATENCES_MAX = 400;

function jourDe(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

function journeeVide(jour: string): Journee {
  return {
    jour,
    demarrages: 0,
    personnes: {},
    fonctionnalites: {},
    gestes: {},
    ecrans: {},
    zones: {},
    sessions: { n: 0, dureeS: 0 },
    latences: { api: {}, ecrans: {}, demarrageAgent: [], publication: [] },
    coupures: 0,
    reconnexions: 0,
    agents: { lances: 0, termines: 0, echoues: 0, arretes: 0, dureeS: 0, parMoteur: {}, parNiveau: {} },
    choix: {},
    limitesAtteintes: {},
    toursCoupesParLimite: 0,
    publications: { reussies: 0, echouees: 0, arretees: 0 },
    journal: [],
    erreurs: {},
    memoirePicPct: 0,
    chargePic: 0,
    misesAJour: [],
  };
}

let courante: Journee | null = null;
let demarre = false;

/** La mesure tourne-t-elle ? Seulement là où un relais est joint. */
export function collecteActive(): boolean {
  return adresseDuRelaisIci() !== null;
}

function lireJournee(jour: string): Journee | null {
  try {
    const ligne = getDb().prepare('SELECT donnees FROM usage_local WHERE jour = ?').get(jour) as { donnees: string } | undefined;
    return ligne ? { ...journeeVide(jour), ...(JSON.parse(ligne.donnees) as Journee) } : null;
  } catch {
    return null;
  }
}

function ecrireJournee(j: Journee): void {
  try {
    getDb()
      .prepare('INSERT INTO usage_local (jour, donnees) VALUES (?, ?) ON CONFLICT(jour) DO UPDATE SET donnees = excluded.donnees')
      .run(j.jour, JSON.stringify(j));
  } catch (e) {
    log.warn(`usage : journée non posée (${(e as Error).message})`);
  }
}

/** La journée en cours ; à minuit (temps universel), la précédente est posée et une neuve commence. */
function journee(maintenant = Date.now()): Journee {
  const jour = jourDe(maintenant);
  if (courante?.jour === jour) return courante;
  if (courante) ecrireJournee(courante);
  courante = lireJournee(jour) ?? journeeVide(jour);
  return courante;
}

/** Pose la journée en base (toutes les deux minutes, et avant chaque envoi). */
export function poserLaJournee(): void {
  if (courante) ecrireJournee(courante);
}

function compter(compteurs: Record<string, number>, cle: string, n = 1): void {
  compteurs[cle] = (compteurs[cle] ?? 0) + n;
}

/** Une série de durées bornée : au-delà, une mesure prise au hasard est remplacée. */
function mesurer(serie: number[], ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (serie.length < LATENCES_MAX) serie.push(Math.round(ms));
  else serie[Math.floor(Math.random() * LATENCES_MAX)] = Math.round(ms);
}

function noterAuJournal(e: string, p?: string, z?: string): void {
  const j = journee();
  if (j.journal.length >= JOURNAL_MAX_PAR_JOUR) return;
  j.journal.push({ t: Date.now(), ...(p ? { p } : {}), e: e.slice(0, 80), ...(z ? { z: z.slice(0, 40) } : {}) });
}

/* ------------------------------------------------------------------ */
/* Les personnes : des numéros                                          */
/* ------------------------------------------------------------------ */

/** Le sel de l'installation : tiré une fois, gardé en base, jamais envoyé. */
function sel(): string {
  let valeur = getMeta('usage.sel');
  if (!valeur) {
    valeur = crypto.randomBytes(32).toString('hex');
    setMeta('usage.sel', valeur);
  }
  return valeur;
}

/** Le numéro anonyme d'un compte : stable sur cette installation, impossible à remonter. */
export function numeroDePersonne(compteId: string): string {
  return crypto.createHash('sha256').update(`${sel()}:${compteId}`).digest('hex').slice(0, 12);
}

function personne(compte: Pick<CompteUtilisateur, 'id' | 'role'>): PersonneDuJour {
  const j = journee();
  const numero = numeroDePersonne(compte.id);
  return (j.personnes[numero] ??= { numero, role: compte.role, sessions: 0, dureeS: 0, gestes: 0, fonctionnalites: {} });
}

/** L'adresse de l'appelant, derrière le mandataire : elle ne sert qu'à en déduire le pays. */
function adresseDeLaRequete(req: http.IncomingMessage): string {
  const relaye = req.headers['x-forwarded-for'];
  if (typeof relaye === 'string' && relaye) return relaye.split(',')[0]!.trim();
  return req.socket?.remoteAddress ?? '';
}

const derniereFermeture = new Map<string, number>();

/**
 * UNE CONNEXION S'OUVRE (canal temps réel) : la personne est comptée, son PAYS
 * déduit de son adresse — puis l'adresse est oubliée. Rend la fonction qui
 * clôt la session. Revenir moins d'une minute après une coupure est une
 * RECONNEXION, pas une nouvelle session.
 */
export function noterUneConnexion(compte: CompteUtilisateur, req: http.IncomingMessage): () => void {
  if (!collecteActive()) return () => undefined;
  try {
    const p = personne(compte);
    const pays = paysDeLaRequete(adresseDeLaRequete(req), req.headers['cf-ipcountry']);
    if (pays) p.pays = pays;
    const ua = String(req.headers['user-agent'] ?? '');
    if (ua) Object.assign(p, appareilDuNavigateur(ua));
    const langue = String(req.headers['accept-language'] ?? '').split(',')[0]?.trim();
    if (langue && !p.langueNavigateur) p.langueNavigateur = langue.slice(0, 20);
    const debut = Date.now();
    const reprise = debut - (derniereFermeture.get(p.numero) ?? 0) < 60_000;
    const j = journee();
    if (reprise) j.reconnexions += 1;
    else {
      j.sessions.n += 1;
      p.sessions += 1;
      noterAuJournal('session.debut', p.numero);
    }
    return () => {
      try {
        const duree = Math.round((Date.now() - debut) / 1000);
        const pj = personne(compte);
        pj.dureeS += duree;
        journee().sessions.dureeS += duree;
        derniereFermeture.set(pj.numero, Date.now());
        if (derniereFermeture.size > 5000) derniereFermeture.clear();
      } catch {
        /* la mesure ne gêne jamais */
      }
    };
  } catch {
    return () => undefined;
  }
}

let fonctionnalitesVues: Set<string> | null = null;
function dejaVues(): Set<string> {
  if (!fonctionnalitesVues) {
    try {
      fonctionnalitesVues = new Set(JSON.parse(getMeta('usage.fonctionnalitesVues') ?? '[]') as string[]);
    } catch {
      fonctionnalitesVues = new Set();
    }
  }
  return fonctionnalitesVues;
}

/** UN GESTE (une commande de l'écran) : son nom seul, jamais son contenu. */
export function noterUnGeste(compte: Pick<CompteUtilisateur, 'id' | 'role'>, type: string): void {
  if (GESTES_MUETS.includes(type) || !collecteActive()) return;
  try {
    const j = journee();
    const fonction = fonctionnaliteDuGeste(type);
    const p = personne(compte);
    compter(j.gestes, type.slice(0, 80));
    compter(j.fonctionnalites, fonction);
    compter(p.fonctionnalites, fonction);
    p.gestes += 1;
    noterAuJournal(type, p.numero, fonction);
    const vues = dejaVues();
    if (!vues.has(fonction)) {
      vues.add(fonction);
      setMeta('usage.fonctionnalitesVues', JSON.stringify([...vues]));
    }
  } catch {
    /* la mesure ne gêne jamais */
  }
}

/** Le temps de réponse d'une route `/api/`, rangé par famille — jamais l'adresse entière. */
export function noterUneLatence(route: string, ms: number): void {
  try {
    if (!collecteActive()) return;
    const series = journee().latences.api;
    mesurer((series[familleDeRoute(route)] ??= []), ms);
  } catch {
    /* la mesure ne gêne jamais */
  }
}

/** Ce que l'écran envoie de lui-même : profil d'affichage, écrans ouverts, temps par zone, coupures. */
export interface MesuresDeLEcran {
  langue?: string;
  langueNavigateur?: string;
  ecran?: string;
  installee?: boolean;
  theme?: string;
  ouvertures?: { nom: string; ms: number }[];
  zones?: Record<string, number>;
  coupures?: number;
  reconnexions?: number;
}

const NOM_COURT = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

export function noterLEcran(compte: CompteUtilisateur, brut: unknown, userAgent: string): void {
  if (!collecteActive() || !brut || typeof brut !== 'object') return;
  try {
    const m = brut as MesuresDeLEcran;
    const j = journee();
    const p = personne(compte);
    if (typeof m.langue === 'string' && /^[a-z]{2}(-[a-z0-9]{2,8})?$/i.test(m.langue)) p.langue = m.langue;
    if (typeof m.langueNavigateur === 'string') p.langueNavigateur = m.langueNavigateur.slice(0, 20);
    if (typeof m.ecran === 'string' && /^\d{2,5}x\d{2,5}$/.test(m.ecran)) p.ecran = m.ecran;
    if (typeof m.installee === 'boolean') p.installee = m.installee;
    if (typeof m.theme === 'string' && NOM_COURT.test(m.theme)) p.theme = m.theme;
    if (userAgent) Object.assign(p, appareilDuNavigateur(userAgent));
    for (const o of Array.isArray(m.ouvertures) ? m.ouvertures.slice(0, 200) : []) {
      if (!o || typeof o.nom !== 'string' || !NOM_COURT.test(o.nom)) continue;
      compter(j.ecrans, o.nom);
      noterAuJournal('ecran', p.numero, o.nom);
      if (typeof o.ms === 'number' && o.ms > 0 && o.ms < 120_000) mesurer((j.latences.ecrans[o.nom] ??= []), o.ms);
    }
    for (const [zone, secondes] of Object.entries(m.zones ?? {}).slice(0, 60)) {
      if (!NOM_COURT.test(zone) || typeof secondes !== 'number' || secondes <= 0 || secondes > 86_400) continue;
      compter(j.zones, zone, Math.round(secondes));
    }
    if (typeof m.coupures === 'number' && m.coupures > 0) j.coupures += Math.min(1000, Math.round(m.coupures));
    if (typeof m.reconnexions === 'number' && m.reconnexions > 0) j.reconnexions += Math.min(1000, Math.round(m.reconnexions));
  } catch {
    /* la mesure ne gêne jamais */
  }
}

/* ------------------------------------------------------------------ */
/* Les pannes                                                           */
/* ------------------------------------------------------------------ */

let envoiAnticipe: NodeJS.Timeout | null = null;
let dernierEnvoiAnticipe = 0;

/**
 * UNE PANNE : message nettoyé (citations masquées, chemins raccourcis, adresses
 * et jetons retirés), regroupée par empreinte. Une panne NOUVELLE du jour fait
 * partir le rapport dans les dix minutes — au plus une fois par heure.
 */
export function noterUnePanne(source: string, message: string, pile?: string, zone?: string): void {
  if (!collecteActive()) return;
  try {
    const propre = nettoyerTexteLibre(masquerLesCitations(message), 500);
    if (!propre) return;
    const lieu = zone ? nettoyerTexteLibre(zone, 120) : lieuDeLaPanne(pile);
    const empreinte = empreinteDePanne(source, propre, lieu);
    const j = journee();
    if (source === 'serveur') j.dernierePanneServeur = Date.now();
    const deja = j.erreurs[empreinte];
    if (deja) {
      deja.n += 1;
      return;
    }
    if (Object.keys(j.erreurs).length >= PANNES_MAX_PAR_JOUR) return;
    j.erreurs[empreinte] = { empreinte, source: source.slice(0, 20), message: propre, pile: nettoyerPile(pile), lieu: lieu || undefined, n: 1 };
    noterAuJournal('panne', undefined, source);
    if (!envoiAnticipe && Date.now() - dernierEnvoiAnticipe > Number(process.env.BELUGA_USAGE_PANNE_INTERVALLE_MS || 60 * 60 * 1000)) {
      envoiAnticipe = setTimeout(() => {
        envoiAnticipe = null;
        dernierEnvoiAnticipe = Date.now();
        void envoyerLesRapportsDUsage();
      }, Number(process.env.BELUGA_USAGE_PANNE_DELAI_MS || 10 * 60 * 1000));
      envoiAnticipe.unref?.();
    }
  } catch {
    /* la mesure ne gêne jamais */
  }
}

/* ------------------------------------------------------------------ */
/* Ce que le bus raconte : agents, publications, quotas, mises à jour   */
/* ------------------------------------------------------------------ */

const etatsDesAgents = new Map<string, { status: string; depuis: number }>();
const publicationsEnCours = new Map<string, number>();
const limitesVues = new Set<string>();
const comptesSatures = new Set<string>();
let derniersQuotas: AccountQuota[] = [];

function marquerUneFois(cle: string): void {
  if (!getMeta(cle)) setMeta(cle, String(Date.now()));
}

function ecouterLeBus(evenement: ServerEvent): void {
  if (!collecteActive()) return;
  try {
    const e = evenement as ServerEvent & Record<string, any>;
    if (e.type === 'agent.upsert') {
      const agent = e.agent as { id: string; status: string; cardId?: string; run?: { engine?: string; niveau?: string } };
      const avant = etatsDesAgents.get(agent.id);
      if (avant?.status === agent.status) return;
      const maintenant = Date.now();
      etatsDesAgents.set(agent.id, { status: agent.status, depuis: maintenant });
      if (etatsDesAgents.size > 2000) etatsDesAgents.clear();
      const j = journee();
      const moteur = agent.run?.engine ?? 'inconnu';
      if (agent.status === 'running' && avant?.status !== 'running') {
        j.agents.lances += 1;
        compter(j.agents.parMoteur, moteur);
        compter(j.agents.parNiveau, agent.run?.niveau ?? 'sans-niveau');
        compter(j.choix, `${moteur}/${agent.run?.niveau ?? 'sans-niveau'}`);
        noterAuJournal('agent.lance', undefined, moteur);
        if (agent.cardId) marquerUneFois('usage.premiereCarteLe');
      } else if (avant?.status === 'running' && ['done', 'failed', 'stopped', 'idle'].includes(agent.status)) {
        j.agents.dureeS += Math.round((maintenant - avant.depuis) / 1000);
        if (agent.status === 'failed') j.agents.echoues += 1;
        else if (agent.status === 'stopped') j.agents.arretes += 1;
        else j.agents.termines += 1;
        noterAuJournal(`agent.${agent.status}`, undefined, moteur);
      }
    } else if (e.type === 'card.lancement' && !e.etape && typeof e.depuis === 'number') {
      // La préparation est finie : le moteur part. Ce délai, c'est le démarrage ressenti.
      mesurer(journee().latences.demarrageAgent, Date.now() - e.depuis);
    } else if (e.type === 'deploy.upsert') {
      const run = e.run as DeployRun;
      if (run.state === 'running') {
        if (!publicationsEnCours.has(run.id)) publicationsEnCours.set(run.id, Date.now());
        return;
      }
      const debut = publicationsEnCours.get(run.id);
      if (debut === undefined) return;
      publicationsEnCours.delete(run.id);
      const j = journee();
      mesurer(j.latences.publication, Date.now() - debut);
      if (run.state === 'success') {
        j.publications.reussies += 1;
        marquerUneFois('usage.premierePublicationLe');
      } else if (run.state === 'failed') j.publications.echouees += 1;
      else j.publications.arretees += 1;
      noterAuJournal(`publication.${run.state}`);
    } else if (e.type === 'quotas') {
      // On SE BRANCHE sur les relevés existants : jamais un relevé de plus (DEC-128 / DEC-129).
      derniersQuotas = e.quotas as AccountQuota[];
      const j = journee();
      for (const q of derniersQuotas) {
        if (q.limiteConnue) {
          const cle = `${q.id}:${q.limiteConnue.echeance}`;
          if (!limitesVues.has(cle)) {
            limitesVues.add(cle);
            compter(j.limitesAtteintes, q.engine);
            j.toursCoupesParLimite += 1;
            noterAuJournal('quota.limite', undefined, q.engine);
          }
        }
        const sature = (q.session?.usedPct ?? 0) >= 100 || (q.weekly?.usedPct ?? 0) >= 100;
        if (sature && !comptesSatures.has(q.id)) {
          comptesSatures.add(q.id);
          compter(j.limitesAtteintes, q.engine);
          noterAuJournal('quota.plein', undefined, q.engine);
        } else if (!sature) comptesSatures.delete(q.id);
      }
    } else if (e.type === 'installation.travail') {
      const travail = e.travail as { genre: string; etat: string; debut?: number; fin?: number };
      if (travail.genre !== 'mise-a-jour' || travail.etat === 'en-cours') return;
      journee().misesAJour.push({
        de: getMeta('usage.version') ?? '',
        vers: '',
        issue: travail.etat === 'reussi' ? 'reussie' : 'ratee',
        dureeS: travail.debut && travail.fin ? Math.round((travail.fin - travail.debut) / 1000) : undefined,
        t: Date.now(),
      });
    }
  } catch {
    /* la mesure ne gêne jamais */
  }
}

/* ------------------------------------------------------------------ */
/* La machine, sa santé, ses projets — lus au moment du rapport        */
/* ------------------------------------------------------------------ */

function lire(fichier: string): string {
  try {
    return fs.readFileSync(fichier, 'utf8').trim();
  } catch {
    return '';
  }
}

function systemeDeLaMachine(): string {
  const nom = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(lire('/etc/os-release'))?.[1];
  return (nom ?? `${os.type()} ${os.release()}`).slice(0, 80);
}

function dansUnConteneur(): boolean {
  return fs.existsSync('/.dockerenv') || /docker|lxc|kubepods|containerd/.test(lire('/proc/1/cgroup'));
}

/** L'hébergeur, tel que la machine virtuelle le déclare (« Hetzner vServer »), sinon rien. */
function hebergeurDeLaMachine(): string {
  const vendeur = lire('/sys/class/dmi/id/sys_vendor');
  const produit = lire('/sys/class/dmi/id/product_name');
  return [vendeur, produit].filter(Boolean).join(' ').slice(0, 80);
}

function disque(): { totalMo: number; libreMo: number } {
  try {
    const s = fs.statfsSync(CONFIG.dataDir);
    return { totalMo: Math.round((s.blocks * s.bsize) / 1048576), libreMo: Math.round((s.bavail * s.bsize) / 1048576) };
  } catch {
    return { totalMo: 0, libreMo: 0 };
  }
}

function swapMo(): number {
  const info = lire('/proc/meminfo');
  const total = Number(/^SwapTotal:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  const libre = Number(/^SwapFree:\s+(\d+)/m.exec(info)?.[1] ?? 0);
  return Math.round((total - libre) / 1024);
}

function echantillonnerLaCharge(): void {
  if (!collecteActive()) return;
  const j = journee();
  const memoire = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  const charge = Math.round((os.loadavg()[0]! / Math.max(1, os.cpus().length)) * 100) / 100;
  j.memoirePicPct = Math.max(j.memoirePicPct, memoire);
  j.chargePic = Math.max(j.chargePic, charge);
}

/** Les projets, réduits à leur genre, leurs langages et leurs services — aucun nom, aucun chemin. */
function projetsAnonymes(): RapportDUsage['projets'] {
  const liste: NonNullable<RapportDUsage['projets']['liste']> = [];
  for (const projet of store.listProjects().slice(0, 500)) {
    let entrees: string[] = [];
    try {
      entrees = fs.readdirSync(projet.path).slice(0, 400);
    } catch {
      /* dossier absent : genre inconnu */
    }
    const { genre, langages } = genreDuProjet(entrees);
    const services: string[] = [];
    if (/github\.com/i.test(projet.gitRemote ?? '')) services.push('github');
    if (projet.adresseProduction) services.push('production');
    if (projet.devUrl) services.push('domaine');
    if (projet.isSelf) services.push('copie-de-beluga');
    liste.push({ genre, langages, services });
  }
  return { total: liste.length, liste };
}

function servicesDeLInstallation(): string[] {
  const identite = identiteDInstallation();
  const services: string[] = [];
  if (identite.modeDesCourriels) services.push(`courriels-${identite.modeDesCourriels}`);
  if (identite.hoteEspaceClient) services.push('espace-client');
  if (identite.adressePublique) services.push('adresse-publique');
  if (identite.fournisseurDeNoms) services.push(`noms-${identite.fournisseurDeNoms}`);
  if (machineHebergee()) services.push('offre-hebergee');
  return services;
}

function moteursConnectes(): { moteur: string; comptes: number }[] {
  const parMoteur: Record<string, number> = {};
  for (const q of derniersQuotas) if (!q.disabled) compter(parMoteur, q.engine);
  return Object.entries(parMoteur).map(([moteur, comptes]) => ({ moteur, comptes }));
}

function parcours(): RapportDUsage['parcours'] {
  const assistant = store.getSettings().assistant;
  const vues = dejaVues();
  const nombre = (cle: string) => Number(getMeta(cle) ?? 0) || undefined;
  return {
    installeeLe: nombre('usage.installeeLe'),
    assistant: assistant.statut,
    etapes: assistant.etapes,
    etapeArret: assistant.statut === 'a-faire' ? prochaineEtape(assistant, machineHebergee()) : undefined,
    premiereCarteLe: nombre('usage.premiereCarteLe'),
    premierePublicationLe: nombre('usage.premierePublicationLe'),
    jamaisOuvertes: FONCTIONNALITES_DECOUVRABLES.filter((f) => !vues.has(f)),
  };
}

function versCentiles(series: Record<string, number[]>): Record<string, ReturnType<typeof centiles>> {
  return Object.fromEntries(Object.entries(series).map(([cle, serie]) => [cle, centiles(serie)]));
}

/** Le rapport d'une journée, prêt à partir. `instantane` : machine et santé lues maintenant (la journée en cours). */
async function rapportDe(j: Journee, identite: { id: string; secret: string }, instantane: boolean): Promise<RapportDUsage | null> {
  const version = await versionDeLInstallation();
  const d = disque();
  const comptes = listerComptes();
  let retardCommits: number | undefined;
  if (instantane) {
    try {
      const { nouveautes } = await import('./installation-copie.js');
      const etat = (await Promise.race([nouveautes(), new Promise((r) => setTimeout(() => r(null), 3000))])) as { disponibles?: boolean; nombre?: number } | null;
      if (etat) retardCommits = etat.disponibles ? (etat.nombre ?? 1) : 0;
    } catch {
      /* relevé indisponible : retard inconnu */
    }
  }
  const brut = {
    installation: identite.id,
    secret: identite.secret,
    jour: j.jour,
    version,
    machine: instantane
      ? {
          systeme: systemeDeLaMachine(),
          noyau: os.release().slice(0, 80),
          arch: os.arch(),
          processeurs: os.cpus().length,
          modeleProcesseur: (os.cpus()[0]?.model ?? '').trim().slice(0, 120),
          memoireMo: Math.round(os.totalmem() / 1048576),
          disqueMo: d.totalMo,
          disqueLibreMo: d.libreMo,
          node: process.version,
          conteneur: dansUnConteneur(),
          hebergeur: hebergeurDeLaMachine(),
          fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
        }
      : {},
    sante: {
      ...(instantane
        ? {
            disquePct: d.totalMo ? Math.round(((d.totalMo - d.libreMo) / d.totalMo) * 100) : undefined,
            swapMo: swapMo(),
            enMarcheS: Math.round(process.uptime()),
            dureeSansPanneS: Math.round((Date.now() - (j.dernierePanneServeur ?? Date.now() - process.uptime() * 1000)) / 1000),
            retardCommits,
          }
        : {}),
      memoirePicPct: j.memoirePicPct,
      chargePic: j.chargePic,
      demarrages: j.demarrages,
      misesAJour: j.misesAJour.slice(-50),
    },
    moteurs: {
      ...(instantane ? { connectes: moteursConnectes() } : {}),
      choix: j.choix,
      limitesAtteintes: j.limitesAtteintes,
      toursCoupesParLimite: j.toursCoupesParLimite,
    },
    agents: j.agents,
    publications: j.publications,
    projets: instantane ? projetsAnonymes() : {},
    services: instantane ? servicesDeLInstallation() : [],
    nbPersonnes: comptes.filter((c) => c.actif).length,
    personnes: Object.values(j.personnes).slice(0, 500),
    paysUtilisateurs: Object.values(j.personnes).reduce<Record<string, number>>((acc, p) => (compter(acc, p.pays ?? '??'), acc), {}),
    langues: Object.values(j.personnes).reduce<Record<string, number>>((acc, p) => (p.langue ? (compter(acc, p.langue), acc) : acc), {}),
    fonctionnalites: j.fonctionnalites,
    gestes: j.gestes,
    ecrans: j.ecrans,
    zones: j.zones,
    sessions: { n: j.sessions.n, dureeS: j.sessions.dureeS, personnes: Object.keys(j.personnes).length },
    rapidite: {
      api: versCentiles(j.latences.api),
      ecrans: versCentiles(j.latences.ecrans),
      demarrageAgent: centiles(j.latences.demarrageAgent),
      publication: centiles(j.latences.publication),
      coupures: j.coupures,
      reconnexions: j.reconnexions,
    },
    parcours: instantane ? parcours() : {},
    journal: j.journal.slice(0, JOURNAL_MAX_PAR_JOUR),
    erreurs: Object.values(j.erreurs),
    // Plus aucune question n'est posée (22/10/2026) : le champ reste, vide, pour le contrat du central.
    satisfaction: [],
  };
  const lu = RapportDUsage.safeParse(brut);
  if (!lu.success) {
    log.warn(`usage : rapport du ${j.jour} mal formé (${lu.error.issues[0]?.path.join('.')} : ${lu.error.issues[0]?.message})`);
    return null;
  }
  return nettoyerLeRapport(lu.data);
}

let envoiEnCours: Promise<{ ok: boolean; envoyes: number; raison?: string }> | null = null;

/**
 * ENVOIE LES JOURNÉES QUE LE RELAIS N'A PAS ENCORE : la journée en cours (qui
 * repart à chaque envoi, la réception la remplace) et les précédentes jamais
 * reçues, quatorze jours au plus.
 */
export function envoyerLesRapportsDUsage(): Promise<{ ok: boolean; envoyes: number; raison?: string }> {
  envoiEnCours ??= (async () => {
    if (!collecteActive()) return { ok: false, envoyes: 0, raison: 'relais absent' };
    const identite = identiteAuRelais();
    if (!identite.secret) return { ok: false, envoyes: 0, raison: 'installation pas encore reconnue par le relais' };
    const cle = { id: identite.id, secret: identite.secret };
    journee();
    poserLaJournee();
    const aujourdHui = jourDe(Date.now());
    const depuis = jourDe(Date.now() - JOURS_DE_RATTRAPAGE * 24 * 60 * 60 * 1000);
    const lignes = getDb()
      .prepare('SELECT jour, donnees FROM usage_local WHERE jour >= ? AND (envoye_le IS NULL OR jour = ?) ORDER BY jour')
      .all(depuis, aujourdHui) as { jour: string; donnees: string }[];
    let envoyes = 0;
    for (const ligne of lignes) {
      let j: Journee;
      try {
        j = { ...journeeVide(ligne.jour), ...(JSON.parse(ligne.donnees) as Journee) };
      } catch {
        continue;
      }
      const rapport = await rapportDe(j, cle, ligne.jour === aujourdHui);
      if (!rapport) continue;
      const r = await appelerLeRelais(ROUTE_DU_RAPPORT_D_USAGE, rapport);
      if (!r.ok) {
        log.warn(`usage : rapport du ${ligne.jour} non reçu (${r.raison})`);
        return { ok: false, envoyes, raison: r.raison };
      }
      getDb().prepare('UPDATE usage_local SET envoye_le = ? WHERE jour = ?').run(Date.now(), ligne.jour);
      envoyes += 1;
    }
    // Ce qui est parti depuis plus de quatorze jours n'a plus rien à faire ici.
    getDb().prepare('DELETE FROM usage_local WHERE jour < ? AND envoye_le IS NOT NULL').run(depuis);
    return { ok: true, envoyes };
  })()
    .catch((e) => ({ ok: false, envoyes: 0, raison: (e as Error).message }))
    .finally(() => {
      envoiEnCours = null;
    });
  return envoiEnCours;
}

/**
 * LE DÉMARRAGE DE LA MESURE (appelé une fois par `main.ts`), seulement là où
 * un relais est joint.
 */
export function demarrerLaMesureDUsage(): void {
  if (demarre || adresseDuRelaisIci() === null) return;
  demarre = true;
  try {
    if (!getMeta('usage.installeeLe')) {
      const premier = listerComptes().reduce<number | undefined>((min, c) => (c.creeLe && (!min || c.creeLe < min) ? c.creeLe : min), undefined);
      setMeta('usage.installeeLe', String(premier ?? Date.now()));
    }
    if (collecteActive()) journee().demarrages += 1;
    void versionDeLInstallation().then((version) => {
      const avant = getMeta('usage.version');
      if (avant && version && avant !== version && collecteActive()) {
        journee().misesAJour.push({ de: avant, vers: version, issue: 'reussie', t: Date.now() });
      }
      if (version) setMeta('usage.version', version);
    });
  } catch (e) {
    log.warn(`usage : démarrage de la mesure incomplet (${(e as Error).message})`);
  }
  bus.subscribe(ecouterLeBus);
  surErreurDuJournal((args) => {
    const erreur = args.find((a): a is Error => a instanceof Error);
    const texte = args
      .filter((a) => typeof a === 'string')
      .join(' ')
      .concat(erreur ? ` — ${erreur.message}` : '');
    noterUnePanne('serveur', texte, erreur?.stack);
  });
  const pose = setInterval(() => {
    echantillonnerLaCharge();
    if (collecteActive()) poserLaJournee();
  }, Number(process.env.BELUGA_USAGE_POSE_MS || 2 * 60 * 1000));
  pose.unref?.();
}
