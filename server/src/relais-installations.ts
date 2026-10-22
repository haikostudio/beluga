import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ADRESSE_DU_RELAIS,
  COMPTE_DES_TICKETS,
  ETIQUETTE_OPEN_SOURCE,
  LectureDesReponses,
  ROUTES_DU_RELAIS,
  SigneDeVie,
  TicketDuRelais,
  PERIODE_DU_SIGNE_DE_VIE_MS,
  agentEstUnRobot,
  colonneClose,
  courrielAPartager,
  filtrerParPaiement,
  identiteDInstallation,
  resumerLesInstallations,
  type FiltreDePaiement,
  type InstallationRecue,
  type ResumeDesInstallations,
  type TelechargementsDuJour,
  type TicketRendu,
} from '@beluga/shared';
import { bus } from './bus.js';
import { compteParIdentifiant, creerCompte, listerComptes, suspendreCompte } from './comptes.js';
import { CONFIG, DEMON_D_ESSAI } from './config.js';
import { getDb } from './db.js';
import { machineDeLAuteur } from './depot-public.js';
import * as espace from './espace-client.js';
import { rafraichirLesCompteursDeHaiko } from './espace-commandes.js';
import { log } from './logger.js';
import { machineHebergee } from './offre-hebergee.js';
import * as store from './store.js';

const execFileAsync = promisify(execFile);

/**
 * LE RELAIS DES INSTALLATIONS, DES DEUX CÔTÉS (`shared/src/relais-installations.ts`).
 *
 * CÔTÉ INSTALLATION : un signe de vie par jour vers le relais de l'auteur, et
 * les tickets « Contacter l'équipe Beluga » avec leurs réponses. Rien ne part
 * d'un démon d'essai ni de la machine de l'auteur — sauf une adresse posée à
 * la main (`BELUGA_RELAIS_ADRESSE`), pour les contrôles.
 *
 * CÔTÉ AUTEUR (la machine qui reçoit) : les trois portes publiques `/relais/*`,
 * les lignes de l'écran « Installations », et les tickets rangés en demandes de
 * l'espace client, sur le projet de l'application, signées du compte « Open
 * source » — un compte client SUSPENDU, que personne ne peut ouvrir.
 */

/* ------------------------------------------------------------------ */
/* Qui envoie, qui reçoit                                               */
/* ------------------------------------------------------------------ */

/** Cette machine reçoit-elle les signes de vie et les tickets ? La machine de l'auteur, ou un contrôle qui le demande. */
export function relaisRecepteurIci(): boolean {
  if (process.env.BELUGA_RELAIS_RECEPTEUR === '1') return true;
  if (process.env.BELUGA_RELAIS_RECEPTEUR === '0') return false;
  return machineDeLAuteur();
}

/** L'adresse vers laquelle CETTE installation se signale ; `null` : elle ne se signale pas. */
export function adresseDuRelaisIci(): string | null {
  const imposee = process.env.BELUGA_RELAIS_ADRESSE?.trim();
  if (imposee) return imposee.replace(/\/+$/, '');
  if (DEMON_D_ESSAI || machineDeLAuteur() || process.env.BELUGA_RELAIS === '0') return null;
  return ADRESSE_DU_RELAIS;
}

/* ------------------------------------------------------------------ */
/* Côté installation                                                    */
/* ------------------------------------------------------------------ */

interface IdentiteAuRelais {
  id: string;
  secret?: string;
  dernierSigne?: number;
  erreur?: string;
}

function fichierDIdentite(): string {
  return path.join(CONFIG.dataDir, 'relais-installation.json');
}

function lireIdentite(): IdentiteAuRelais {
  try {
    const lu = JSON.parse(fs.readFileSync(fichierDIdentite(), 'utf8')) as IdentiteAuRelais;
    if (typeof lu.id === 'string' && lu.id) return lu;
  } catch {
    /* première fois */
  }
  const neuve: IdentiteAuRelais = { id: crypto.randomUUID() };
  ecrireIdentite(neuve);
  return neuve;
}

function ecrireIdentite(identite: IdentiteAuRelais): void {
  try {
    fs.mkdirSync(path.dirname(fichierDIdentite()), { recursive: true });
    fs.writeFileSync(fichierDIdentite(), JSON.stringify(identite, null, 2), { mode: 0o600 });
  } catch (e) {
    log.warn(`relais : identité non enregistrée (${(e as Error).message})`);
  }
}

let versionConnue: string | null = null;
export async function versionDeLInstallation(): Promise<string> {
  if (versionConnue !== null) return versionConnue;
  try {
    const { stdout } = await execFileAsync('git', ['-C', CONFIG.selfPath, 'log', '-1', '--format=%cs %h'], { timeout: 8000 });
    versionConnue = stdout.trim().slice(0, 80);
  } catch {
    versionConnue = '';
  }
  return versionConnue;
}

/** L'adresse du premier administrateur actif qui en a une. */
function courrielDeLAdministrateur(): string | undefined {
  return listerComptes().find((c) => c.role === 'admin' && c.actif && c.courriel)?.courriel;
}

export async function appelerLeRelais<T>(route: string, corps: unknown): Promise<{ ok: true; reponse: T } | { ok: false; raison: string }> {
  const base = adresseDuRelaisIci();
  if (!base) return { ok: false, raison: 'Cette installation ne joint pas l’équipe Beluga.' };
  try {
    const r = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'BelugaBuild-relais/1' },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(15000),
    });
    const texte = await r.text();
    if (!r.ok) {
      let raison = `Le relais a répondu ${r.status}.`;
      try {
        raison = (JSON.parse(texte) as { erreur?: string }).erreur ?? raison;
      } catch {
        /* réponse sans corps lisible */
      }
      return { ok: false, raison };
    }
    return { ok: true, reponse: (texte ? JSON.parse(texte) : {}) as T };
  } catch (e) {
    return { ok: false, raison: `Le relais ne répond pas (${(e as Error).message}).` };
  }
}

/** Envoie le signe de vie du jour. Le premier rend le secret qui signera la suite. */
export async function envoyerLeSigneDeVie(): Promise<{ ok: boolean; raison?: string }> {
  const identite = lireIdentite();
  const reglages = identiteDInstallation();
  const signe = SigneDeVie.parse({
    installation: identite.id,
    secret: identite.secret,
    version: await versionDeLInstallation(),
    payant: machineHebergee(),
    courriel: courrielAPartager(reglages.partageDuCourriel, courrielDeLAdministrateur()),
  });
  const r = await appelerLeRelais<{ secret?: string }>(ROUTES_DU_RELAIS.signeDeVie, signe);
  if (!r.ok) {
    ecrireIdentite({ ...identite, erreur: r.raison });
    return { ok: false, raison: r.raison };
  }
  ecrireIdentite({ id: identite.id, secret: r.reponse.secret ?? identite.secret, dernierSigne: Date.now() });
  return { ok: true };
}

/** Le numéro et le secret de cette installation, tels qu'enregistrés (le secret manque avant le premier signe). */
export function identiteAuRelais(): { id: string; secret?: string } {
  const identite = lireIdentite();
  return { id: identite.id, secret: identite.secret };
}

/** Le secret de l'installation, demandé au relais s'il manque encore. */
async function secretAssure(): Promise<{ id: string; secret: string } | { raison: string }> {
  let identite = lireIdentite();
  if (!identite.secret) {
    const r = await envoyerLeSigneDeVie();
    if (!r.ok) return { raison: r.raison ?? 'Le relais ne répond pas.' };
    identite = lireIdentite();
  }
  return identite.secret ? { id: identite.id, secret: identite.secret } : { raison: 'Le relais n’a pas reconnu cette installation.' };
}

/** « Contacter l'équipe Beluga » : le ticket part, l'équipe le reçoit dans son espace client. */
export async function envoyerUnTicket(titre: string, message: string): Promise<{ ok: boolean; raison?: string }> {
  const cle = await secretAssure();
  if ('raison' in cle) return { ok: false, raison: cle.raison };
  const ticket = TicketDuRelais.safeParse({ installation: cle.id, secret: cle.secret, titre, message });
  if (!ticket.success) return { ok: false, raison: 'Un titre et un message sont nécessaires.' };
  const r = await appelerLeRelais<{ id: string }>(ROUTES_DU_RELAIS.ticket, ticket.data);
  return r.ok ? { ok: true } : { ok: false, raison: r.raison };
}

/** Les tickets de cette installation, réponses de l'équipe comprises. */
export async function lireMesTickets(): Promise<{ ok: boolean; tickets: TicketRendu[]; raison?: string }> {
  const identite = lireIdentite();
  if (!identite.secret) return { ok: true, tickets: [] };
  const r = await appelerLeRelais<{ tickets: TicketRendu[] }>(ROUTES_DU_RELAIS.reponses, { installation: identite.id, secret: identite.secret });
  return r.ok ? { ok: true, tickets: r.reponse.tickets ?? [] } : { ok: false, tickets: [], raison: r.raison };
}

/** Ce que l'écran des réglages dit du relais, sur cette installation. */
export function etatDuRelaisIci(): { joint: boolean; recepteur: boolean; hebergee: boolean; dernierSigne?: number; erreur?: string } {
  const joint = adresseDuRelaisIci() !== null;
  const identite = joint && fs.existsSync(fichierDIdentite()) ? lireIdentite() : null;
  return { joint, recepteur: relaisRecepteurIci(), hebergee: machineHebergee(), dernierSigne: identite?.dernierSigne, erreur: identite?.erreur };
}

/**
 * Le signe de vie part deux minutes après le démarrage, puis une fois par jour.
 * Un relais qui ne répond pas n'attend pas un jour entier : on réessaie une
 * demi-heure plus tard (le délai de démarrage, pour un contrôle).
 */
export function signalerLInstallation(): void {
  if (!adresseDuRelaisIci()) return;
  const delai = Number(process.env.BELUGA_RELAIS_DELAI_MS || 2 * 60 * 1000);
  const nouvelEssai = process.env.BELUGA_RELAIS_DELAI_MS ? delai : 30 * 60 * 1000;
  /* LE RAPPORT D'USAGE ANONYME SUIT CHAQUE SIGNE DE VIE REÇU (`usage-installation.ts`) :
     il a besoin du secret que le premier signe rend. Il part en silence, vers le
     central de Beluga Build qui le reçoit (décision du 22/10/2026). */
  const signeEtRapport = async () => {
    const r = await envoyerLeSigneDeVie();
    if (r.ok) {
      const { envoyerLesRapportsDUsage } = await import('./usage-installation.js');
      await envoyerLesRapportsDUsage();
    }
    return r;
  };
  const tenter = async () => {
    const r = await signeEtRapport();
    if (!r.ok) setTimeout(() => void tenter(), nouvelEssai).unref?.();
  };
  const premier = setTimeout(() => void tenter(), delai);
  const periodique = setInterval(() => void signeEtRapport(), PERIODE_DU_SIGNE_DE_VIE_MS);
  premier.unref?.();
  periodique.unref?.();
}

/* ------------------------------------------------------------------ */
/* Côté auteur : les portes publiques                                   */
/* ------------------------------------------------------------------ */

export interface ReponseDuRelais {
  statut: number;
  corps: Record<string, unknown>;
}

/** Trente appels par heure et par adresse : bien assez pour un signe par jour et quelques tickets. */
const PLAFOND_PAR_HEURE = 30;
const appelsParAdresse = new Map<string, number[]>();

function tropDAppels(ip: string, maintenant: number): boolean {
  const recents = (appelsParAdresse.get(ip) ?? []).filter((t) => maintenant - t < 60 * 60 * 1000);
  recents.push(maintenant);
  appelsParAdresse.set(ip, recents);
  if (appelsParAdresse.size > 5000) appelsParAdresse.clear();
  return recents.length > PLAFOND_PAR_HEURE;
}

function hacher(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

interface LigneInstallation {
  id: string;
  secret_hache: string;
  premiere_vue: number;
  derniere_vue: number;
  version: string;
  payant: number;
  pays: string | null;
  courriel: string | null;
}

function installationConnue(id: string): LigneInstallation | undefined {
  return getDb().prepare('SELECT * FROM relais_installations WHERE id = ?').get(id) as LigneInstallation | undefined;
}

function secretJuste(ligne: LigneInstallation, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(ligne.secret_hache, 'hex');
  const b = Buffer.from(hacher(secret), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function jourDe(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

const REFUS = (statut: number, erreur: string): ReponseDuRelais => ({ statut, corps: { erreur } });

/** Le contexte d'un appel : l'adresse ne sert qu'au plafond, puis est oubliée ; seul le pays reste. */
export interface ContexteDAppel {
  ip: string;
  userAgent: string;
  pays?: string;
}

function lireCorps<T>(brut: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): T | null {
  try {
    const r = schema.safeParse(JSON.parse(brut || '{}'));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Un signe de vie reçu : une installation neuve reçoit son secret, une connue doit le donner. */
export function recevoirUnSigneDeVie(brut: string, contexte: ContexteDAppel): ReponseDuRelais {
  const maintenant = Date.now();
  if (agentEstUnRobot(contexte.userAgent)) return REFUS(403, 'Refusé.');
  if (tropDAppels(contexte.ip, maintenant)) return REFUS(429, 'Trop d’appels, réessayez plus tard.');
  const signe = lireCorps(brut, SigneDeVie);
  if (!signe) return REFUS(400, 'Signe de vie illisible.');
  const courriel = courrielAPartager('oui', signe.courriel) ?? null;
  const db = getDb();
  const connue = installationConnue(signe.installation);
  let secretRendu: string | undefined;
  if (connue) {
    if (!secretJuste(connue, signe.secret)) return REFUS(403, 'Cette installation ne se reconnaît pas.');
    db.prepare('UPDATE relais_installations SET derniere_vue = ?, version = ?, payant = ?, pays = COALESCE(?, pays), courriel = ? WHERE id = ?').run(
      maintenant,
      signe.version,
      signe.payant ? 1 : 0,
      contexte.pays ?? null,
      courriel,
      signe.installation,
    );
  } else {
    secretRendu = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `INSERT INTO relais_installations (id, secret_hache, premiere_vue, derniere_vue, version, payant, pays, courriel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(signe.installation, hacher(secretRendu), maintenant, maintenant, signe.version, signe.payant ? 1 : 0, contexte.pays ?? null, courriel);
  }
  db.prepare('INSERT OR IGNORE INTO relais_jours (installation, jour) VALUES (?, ?)').run(signe.installation, jourDe(maintenant));
  return { statut: 200, corps: secretRendu ? { secret: secretRendu } : {} };
}

/** Le projet qui porte les tickets : celui de l'application elle-même. */
function projetDesTickets(): string | null {
  return store.listProjects(true).find((p) => p.isSelf)?.id ?? null;
}

/** Le compte « Open source » qui signe les tickets : un client suspendu, que personne ne peut ouvrir. */
function compteDesTickets(projectId: string) {
  const existant = compteParIdentifiant(COMPTE_DES_TICKETS.identifiant);
  if (existant) return existant;
  const { compte } = creerCompte(
    { identifiant: COMPTE_DES_TICKETS.identifiant, role: 'client', nomAffiche: COMPTE_DES_TICKETS.nomAffiche, projets: [projectId] },
    store.listProjects(true).map((p) => p.id),
  );
  // Le mot de passe tiré n'est gardé nulle part : le compte ne s'ouvre jamais.
  return suspendreCompte(compte.id, true);
}

/** Un ticket reçu devient une demande « Open source » de l'espace client. */
export function recevoirUnTicket(brut: string, contexte: ContexteDAppel): ReponseDuRelais {
  const maintenant = Date.now();
  if (agentEstUnRobot(contexte.userAgent)) return REFUS(403, 'Refusé.');
  if (tropDAppels(contexte.ip, maintenant)) return REFUS(429, 'Trop d’appels, réessayez plus tard.');
  const ticket = lireCorps(brut, TicketDuRelais);
  if (!ticket) return REFUS(400, 'Ticket illisible.');
  const connue = installationConnue(ticket.installation);
  if (!connue || !secretJuste(connue, ticket.secret)) return REFUS(403, 'Cette installation ne se reconnaît pas.');
  const projectId = projetDesTickets();
  if (!projectId) return REFUS(503, 'L’équipe Beluga ne reçoit pas de tickets pour l’instant.');
  const compte = compteDesTickets(projectId);
  const court = ticket.installation.slice(0, 8);
  const signature = [
    `Installation ${court}`,
    connue.pays ? `pays ${connue.pays}` : null,
    connue.version ? `version ${connue.version}` : null,
    connue.courriel ? connue.courriel : 'adresse non partagée',
  ]
    .filter(Boolean)
    .join(' · ');
  const demande = espace.creerDemande(
    { id: compte.id, nom: connue.courriel ?? `Installation ${court}`, role: 'client' },
    {
      projectId,
      titre: ticket.titre,
      description: `${ticket.message}\n\n— ${signature}`,
      etiquettes: [ETIQUETTE_OPEN_SOURCE],
    },
  );
  getDb().prepare('INSERT INTO relais_tickets (demande_id, installation, cree_le) VALUES (?, ?, ?)').run(demande.id, ticket.installation, maintenant);
  bus.emit({ type: 'espace.demande', projectId, demande, auteurId: demande.auteurId });
  rafraichirLesCompteursDeHaiko();
  log.info(`relais : ticket reçu de l'installation ${court}`);
  return { statut: 200, corps: { id: demande.id } };
}

/** Les tickets d'une installation, tels qu'elle les relit : sa question, puis le fil. */
export function rendreLesReponses(brut: string, contexte: ContexteDAppel): ReponseDuRelais {
  if (tropDAppels(contexte.ip, Date.now())) return REFUS(429, 'Trop d’appels, réessayez plus tard.');
  const lecture = lireCorps(brut, LectureDesReponses);
  if (!lecture) return REFUS(400, 'Demande illisible.');
  const connue = installationConnue(lecture.installation);
  if (!connue || !secretJuste(connue, lecture.secret)) return REFUS(403, 'Cette installation ne se reconnaît pas.');
  const lignes = getDb()
    .prepare('SELECT demande_id FROM relais_tickets WHERE installation = ? ORDER BY cree_le DESC LIMIT 50')
    .all(lecture.installation) as { demande_id: string }[];
  const compte = compteParIdentifiant(COMPTE_DES_TICKETS.identifiant);
  const tickets: TicketRendu[] = [];
  for (const { demande_id } of lignes) {
    const demande = espace.laDemande(demande_id);
    if (!demande) continue;
    const question = demande.description.replace(/\n\n— Installation [\s\S]*$/, '');
    tickets.push({
      id: demande.id,
      titre: demande.titre,
      creeLe: demande.creeeLe,
      etat: colonneClose(demande.colonne) || demande.archiveeLe ? 'traite' : 'ouvert',
      messages: [
        { de: 'vous', texte: question, creeLe: demande.creeeLe },
        ...espace.messagesDeLaDemande(demande.id).map((m) => ({
          de: (m.auteurId === compte?.id ? 'vous' : 'equipe') as 'vous' | 'equipe',
          texte: m.texte,
          creeLe: m.creeLe,
        })),
      ],
    });
  }
  return { statut: 200, corps: { tickets } };
}

/* ------------------------------------------------------------------ */
/* Côté auteur : l'écran « Installations »                              */
/* ------------------------------------------------------------------ */

export function installationsRecues(filtre: FiltreDePaiement): {
  lignes: InstallationRecue[];
  resume: ResumeDesInstallations;
  telechargements: TelechargementsDuJour[];
} {
  const maintenant = Date.now();
  const depuis = jourDe(maintenant - 30 * 24 * 60 * 60 * 1000);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.*,
         (SELECT COUNT(*) FROM relais_jours j WHERE j.installation = i.id AND j.jour >= ?) AS jours,
         (SELECT COUNT(*) FROM relais_tickets t WHERE t.installation = i.id) AS tickets
       FROM relais_installations i ORDER BY i.derniere_vue DESC`,
    )
    .all(depuis) as (LigneInstallation & { jours: number; tickets: number })[];
  const toutes: InstallationRecue[] = rows.map((r) => ({
    id: r.id,
    premiereVue: r.premiere_vue,
    derniereVue: r.derniere_vue,
    version: r.version,
    payant: r.payant === 1,
    pays: r.pays ?? undefined,
    courriel: r.courriel ?? undefined,
    joursActifs30: r.jours,
    tickets: r.tickets,
  }));
  const lignes = filtrerParPaiement(toutes, filtre);
  const telechargements = (
    db.prepare('SELECT * FROM relais_telechargements ORDER BY jour DESC LIMIT 90').all() as {
      jour: string;
      clones: number;
      clones_uniques: number;
      vues: number;
      vues_uniques: number;
    }[]
  )
    .map((t) => ({ jour: t.jour, clones: t.clones, clonesUniques: t.clones_uniques, vues: t.vues, vuesUniques: t.vues_uniques }))
    .reverse();
  return { lignes, resume: resumerLesInstallations(lignes, maintenant), telechargements };
}

/**
 * LES TÉLÉCHARGEMENTS DU DÉPÔT PUBLIC, relevés chez GitHub une fois par jour.
 * GitHub ne garde que quatorze jours, sans pays ni identité : chaque relevé
 * réécrit les jours qu'il couvre, et la base garde l'histoire au-delà.
 */
export async function releverLesTelechargements(): Promise<void> {
  const lire = async (genre: 'clones' | 'views') => {
    const { stdout } = await execFileAsync('gh', ['api', `repos/haikostudio/beluga/traffic/${genre}`], { timeout: 30000 });
    return (JSON.parse(stdout) as { [cle: string]: { timestamp: string; count: number; uniques: number }[] })[genre] ?? [];
  };
  try {
    const [clones, vues] = await Promise.all([lire('clones'), lire('views')]);
    const parJour = new Map<string, TelechargementsDuJour>();
    const ligne = (jour: string) => parJour.get(jour) ?? { jour, clones: 0, clonesUniques: 0, vues: 0, vuesUniques: 0 };
    for (const c of clones) parJour.set(c.timestamp.slice(0, 10), { ...ligne(c.timestamp.slice(0, 10)), clones: c.count, clonesUniques: c.uniques });
    for (const v of vues) parJour.set(v.timestamp.slice(0, 10), { ...ligne(v.timestamp.slice(0, 10)), vues: v.count, vuesUniques: v.uniques });
    const ecrire = getDb().prepare(
      `INSERT INTO relais_telechargements (jour, clones, clones_uniques, vues, vues_uniques) VALUES (@jour, @clones, @clonesUniques, @vues, @vuesUniques)
       ON CONFLICT(jour) DO UPDATE SET clones = excluded.clones, clones_uniques = excluded.clones_uniques, vues = excluded.vues, vues_uniques = excluded.vues_uniques`,
    );
    for (const jour of parJour.values()) ecrire.run(jour);
  } catch (e) {
    log.warn(`relais : téléchargements GitHub non relevés (${(e as Error).message.split('\n')[0]})`);
  }
}

/** Sur la machine qui reçoit : le relevé GitHub au démarrage, puis chaque jour. */
export function surveillerLesTelechargements(): void {
  if (!relaisRecepteurIci() || DEMON_D_ESSAI) return;
  const premier = setTimeout(() => void releverLesTelechargements(), 5 * 60 * 1000);
  const periodique = setInterval(() => void releverLesTelechargements(), PERIODE_DU_SIGNE_DE_VIE_MS);
  premier.unref?.();
  periodique.unref?.();
}
