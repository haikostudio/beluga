/**
 * LA GARDE DES VERSIONS DE TRAVAIL — le démon (carte « Accès des IA : prod ou dev », 23/11/2026).
 *
 * Les règles pures vivent dans shared/src/garde-acces.ts. Ici : la lecture des blocs Caddy du serveur, les jetons et
 * sessions de garde (table `garde_acces`, jetons HACHÉS), les trois points HTTP et la page de connexion.
 *
 *   GET  /auth/garde/verifier   — appelé par Caddy (`forward_auth`) pour chaque requête d'un site protégé : 200 = passe ;
 *                                  sinon la réponse (renvoi, cookie) est rendue telle quelle au visiteur.
 *   GET  /auth/garde/connexion  — sur l'adresse d'administration, puis sur celle de l'espace client : un compte déjà
 *                                  connecté et autorisé repart aussitôt avec un jeton ; sinon la page de connexion.
 *   POST /auth/garde/connexion  — la page de connexion envoie identifiant et mot de passe.
 *
 * Le cookie de session de Beluga ne quitte JAMAIS ses deux adresses : le site du projet ne reçoit qu'un cookie de
 * garde, qui n'ouvre que sa propre garde — le code du projet le voit passer et ne peut rien en faire d'autre.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import {
  COOKIE_GARDE,
  CHEMIN_ENTREE_GARDE,
  DUREE_JETON_GARDE_MS,
  ENTETE_ESSAI_VISITEUR,
  IP_DES_SERVEURS,
  ROUTE_CONNEXION_GARDE,
  adresseAdministration,
  adresseDeRetourSure,
  blocsDeSiteCaddy,
  cheminDeRetourSur,
  compteOuvreLeSite,
  echapperHtml,
  hoteDUneAdresse,
  hoteEspaceClient,
  hoteNormalise,
  hotesProteges,
  ipInterne,
  sitesDeTravail,
  verdictDeGarde,
  zoneDesProjets,
  type BlocDeSite,
  type CompteUtilisateur,
  type SiteDeTravail,
} from '@beluga/shared';
import { CONFIG } from './config.js';
import { getDb } from './db.js';
import { compteParId } from './comptes.js';
import { checkSession, login } from './auth.js';
import * as store from './store.js';
import { log } from './logger.js';

const CADDYFILE = process.env.BELUGA_CADDYFILE || '/etc/caddy/Caddyfile';
const DOSSIER_SITES = process.env.BELUGA_CADDY_SITES || '/etc/caddy/project-autostart.d';
const COOKIE_SESSION = 'beluga_session';

/** La garde est-elle coupée pour toute l'installation ? (secours : BELUGA_GARDE_ACCES=off) */
export function gardeCoupee(): boolean {
  return /^(off|0|non|false)$/i.test(process.env.BELUGA_GARDE_ACCES ?? '');
}

/* ------------------------------------------------------------------------------------------------------------------
 * Les sites, relus au plus toutes les 30 secondes
 * ---------------------------------------------------------------------------------------------------------------- */

export function lireLesBlocsCaddy(): BlocDeSite[] {
  const textes: string[] = [];
  try {
    textes.push(fs.readFileSync(CADDYFILE, 'utf8'));
  } catch {
    /* pas de Caddy ici */
  }
  try {
    for (const nom of fs.readdirSync(DOSSIER_SITES).filter((n) => n.endsWith('.caddy')).sort()) {
      try {
        textes.push(fs.readFileSync(path.join(DOSSIER_SITES, nom), 'utf8'));
      } catch {
        /* illisible : ignoré */
      }
    }
  } catch {
    /* dossier absent */
  }
  return textes.flatMap(blocsDeSiteCaddy);
}

let cache: { vu: number; blocs: BlocDeSite[]; sites: SiteDeTravail[] } | null = null;

/** Oublie la lecture en cache (un projet a changé). */
export function oublierLesSites(): void {
  cache = null;
  verdicts.clear();
}

function lecture(): { blocs: BlocDeSite[]; sites: SiteDeTravail[] } {
  if (cache && Date.now() - cache.vu < 30_000) return cache;
  const blocs = lireLesBlocsCaddy();
  const hotesExclus = [hoteEspaceClient(), hoteDUneAdresse(adresseAdministration()) ?? ''].filter(Boolean);
  const sites = sitesDeTravail(blocs, store.listProjects(), { zone: zoneDesProjets(), portDuDemon: CONFIG.port, hotesExclus });
  cache = { vu: Date.now(), blocs, sites };
  return cache;
}

export function lesSitesDeTravail(): SiteDeTravail[] {
  return lecture().sites;
}

export function lesBlocsDeSite(): BlocDeSite[] {
  return lecture().blocs;
}

/** Les hôtes à fermer, pour le bloc Caddy généré. Vide quand la garde est coupée. */
export function hotesAGarder(): string[] {
  if (gardeCoupee()) return [];
  return hotesProteges(lesSitesDeTravail());
}

/** L'adresse du démon que Caddy interroge. */
export function amontDeLaGarde(): string {
  return `127.0.0.1:${CONFIG.port}`;
}

function siteDeLHote(hote: string): SiteDeTravail | null {
  return lesSitesDeTravail().find((s) => s.hotes.includes(hote)) ?? null;
}

/** Ce que l'écran des paramètres montre d'un projet. */
export function etatDeLaGardeDuProjet(projectId: string): {
  hotes: string[];
  protege: boolean;
  gardePosee: boolean;
  coupeePartout: boolean;
} {
  const site = lesSitesDeTravail().find((s) => s.projetId === projectId);
  const projet = store.getProject(projectId);
  return {
    hotes: site?.hotes ?? [],
    protege: projet ? (projet as { protectionTravail?: boolean }).protectionTravail !== false : true,
    gardePosee: site?.gardePosee ?? false,
    coupeePartout: gardeCoupee(),
  };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Jetons et sessions de garde
 * ---------------------------------------------------------------------------------------------------------------- */

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

function nettoyer(): void {
  try {
    getDb().prepare('DELETE FROM garde_acces WHERE expires_at < ?').run(Date.now());
  } catch {
    /* table absente (base très ancienne) : rien à nettoyer */
  }
}

export function creerJeton(userId: string, hote: string, chemin: string): string {
  nettoyer();
  const jeton = crypto.randomBytes(32).toString('base64url');
  getDb()
    .prepare('INSERT INTO garde_acces (token, genre, user_id, hote, chemin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha(jeton), 'jeton', userId, hote, chemin, Date.now(), Date.now() + DUREE_JETON_GARDE_MS);
  return jeton;
}

/** Consomme un jeton (usage unique) : rend la session de garde ouverte, ou null. */
export function echangerLeJeton(jeton: string, hote: string): { session: string; chemin: string } | null {
  if (!jeton || jeton.length > 200) return null;
  const db = getDb();
  const ligne = db.prepare("SELECT user_id, hote, chemin, expires_at FROM garde_acces WHERE token = ? AND genre = 'jeton'").get(sha(jeton)) as
    | { user_id: string; hote: string; chemin: string | null; expires_at: number }
    | undefined;
  if (!ligne) return null;
  db.prepare('DELETE FROM garde_acces WHERE token = ?').run(sha(jeton));
  if (ligne.expires_at < Date.now() || ligne.hote !== hote) return null;
  const session = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO garde_acces (token, genre, user_id, hote, chemin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    sha(session),
    'session',
    ligne.user_id,
    hote,
    null,
    Date.now(),
    Date.now() + CONFIG.sessionDays * 86_400_000,
  );
  return { session, chemin: cheminDeRetourSur(ligne.chemin) };
}

/** Le compte derrière un cookie de garde, pour CET hôte seulement. Relu en base : un compte suspendu tombe. */
function compteDeLaSession(session: string | undefined, hote: string): CompteUtilisateur | null {
  if (!session || session.length > 200) return null;
  const ligne = getDb().prepare("SELECT user_id, hote, expires_at FROM garde_acces WHERE token = ? AND genre = 'session'").get(sha(session)) as
    | { user_id: string; hote: string; expires_at: number }
    | undefined;
  if (!ligne || ligne.hote !== hote || ligne.expires_at < Date.now()) return null;
  const compte = compteParId(ligne.user_id);
  return compte && compte.actif ? compte : null;
}

/* Le verdict d'un même cookie sur un même hôte est gardé une minute : un site de travail charge des dizaines de
   fichiers par page, la base n'est pas relue pour chacun. */
const verdicts = new Map<string, { jusqua: number; compte: CompteUtilisateur | null }>();
function compteEnCache(session: string | undefined, hote: string): CompteUtilisateur | null {
  if (!session) return null;
  const cle = `${hote}\n${session}`;
  const vu = verdicts.get(cle);
  if (vu && vu.jusqua > Date.now()) return vu.compte;
  const compte = compteDeLaSession(session, hote);
  if (verdicts.size > 5000) verdicts.clear();
  verdicts.set(cle, { jusqua: Date.now() + 60_000, compte });
  return compte;
}

/* ------------------------------------------------------------------------------------------------------------------
 * HTTP
 * ---------------------------------------------------------------------------------------------------------------- */

function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [cle, ...reste] = part.trim().split('=');
    if (!cle) continue;
    try {
      out[cle] = decodeURIComponent(reste.join('='));
    } catch {
      out[cle] = reste.join('=');
    }
  }
  return out;
}

function entete(req: http.IncomingMessage, nom: string): string {
  const v = req.headers[nom];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

let ipsDuServeur: string[] | null = null;
function lesIpsDuServeur(): string[] {
  if (ipsDuServeur) return ipsDuServeur;
  const locales = Object.values(os.networkInterfaces())
    .flat()
    .map((i) => i?.address ?? '')
    .filter(Boolean);
  ipsDuServeur = [...new Set([IP_DES_SERVEURS.beluga, ...locales])];
  return ipsDuServeur;
}

const ENTETES_PAGE = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};

/** Le point que Caddy interroge. */
export function repondreALaVerification(req: http.IncomingMessage, res: http.ServerResponse): void {
  const hote = hoteNormalise(entete(req, 'x-forwarded-host') || entete(req, 'host'));
  const uri = entete(req, 'x-forwarded-uri') || '/';
  const site = gardeCoupee() ? null : siteDeLHote(hote);
  const ip = (entete(req, 'x-forwarded-for').split(',')[0] ?? '').trim();
  const session = cookies(req)[COOKIE_GARDE];
  const verdict = verdictDeGarde({
    site,
    chemin: uri,
    interne: ipInterne(ip, lesIpsDuServeur()),
    essaiVisiteur: !!entete(req, ENTETE_ESSAI_VISITEUR),
    compte: site ? compteEnCache(session, hote) : null,
  });
  if (verdict === 'passe') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return void res.end('ok');
  }
  if (verdict === 'entree') {
    const params = new URL(uri, `https://${hote}`).searchParams;
    const ouverte = echangerLeJeton(params.get('jeton') ?? '', hote);
    if (!ouverte) {
      res.writeHead(302, { location: lienDeConnexion(hote, '/'), 'cache-control': 'no-store' });
      return void res.end();
    }
    res.writeHead(302, {
      location: ouverte.chemin,
      'set-cookie': `${COOKIE_GARDE}=${ouverte.session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${CONFIG.sessionDays * 86400}`,
      'cache-control': 'no-store',
    });
    return void res.end();
  }
  res.writeHead(302, { location: lienDeConnexion(hote, uri), 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  res.end();
}

function lienDeConnexion(hote: string, uri: string): string {
  const vers = `https://${hote}${cheminDeRetourSur(uri)}`;
  const base = adresseAdministration() || (hoteEspaceClient() ? `https://${hoteEspaceClient()}` : '');
  return `${base.replace(/\/$/, '')}${ROUTE_CONNEXION_GARDE}?vers=${encodeURIComponent(vers)}`;
}

function retourAvecJeton(compte: CompteUtilisateur, vers: URL): string {
  const chemin = cheminDeRetourSur(`${vers.pathname}${vers.search}`);
  const jeton = creerJeton(compte.id, vers.hostname.toLowerCase(), chemin);
  return `https://${vers.hostname}${CHEMIN_ENTREE_GARDE}?jeton=${encodeURIComponent(jeton)}`;
}

/** La page de connexion de la garde (GET) et son envoi (POST). */
export async function repondreALaConnexion(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  outils: { lireCorps: () => Promise<string>; ip: string; champMotDePasse: string; styleDuChamp: string; scriptDuChamp: string },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  let vers = url.searchParams.get('vers');
  let identifiant = '';
  let motDePasse = '';
  if (req.method === 'POST') {
    const corps = new URLSearchParams(await outils.lireCorps());
    vers = corps.get('vers') ?? vers;
    identifiant = corps.get('username') ?? '';
    motDePasse = corps.get('password') ?? '';
  }
  const hotes = hotesAGarder();
  const cible = adresseDeRetourSure(vers, hotes);
  const page = (o: { message?: string; erreur?: string; statut?: number }) => {
    res.writeHead(o.statut ?? 200, ENTETES_PAGE);
    res.end(pageDeConnexion({ ...o, vers: cible?.toString() ?? '', hote: cible?.hostname ?? '', identifiant, outils }));
  };
  if (!cible) return page({ erreur: 'Cette adresse n’est pas un site protégé par Beluga.', statut: 400 });
  const site = siteDeLHote(cible.hostname.toLowerCase());
  if (!site) return page({ erreur: 'Cette adresse n’est pas un site protégé par Beluga.', statut: 400 });

  if (req.method === 'POST') {
    const entree = login(identifiant, motDePasse, outils.ip);
    if (!entree.ok || !entree.token) return page({ erreur: entree.error ?? 'Connexion impossible.', statut: 401 });
    const compte = checkSession(entree.token);
    const cookie = `${COOKIE_SESSION}=${entree.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.sessionDays * 86400}`;
    if (!compte || !compteOuvreLeSite(compte, site.projetId)) {
      res.writeHead(403, { ...ENTETES_PAGE, 'set-cookie': cookie });
      return void res.end(
        pageDeConnexion({ erreur: 'Ce compte n’a pas accès à ce site.', vers: cible.toString(), hote: cible.hostname, identifiant: '', outils }),
      );
    }
    log.info(`garde des versions de travail : ${compte.identifiant} entre sur ${cible.hostname}`);
    res.writeHead(302, { 'set-cookie': cookie, location: retourAvecJeton(compte, cible), 'cache-control': 'no-store' });
    return void res.end();
  }

  const compte = checkSession(cookies(req)[COOKIE_SESSION]);
  if (compte && compteOuvreLeSite(compte, site.projetId)) {
    res.writeHead(302, { location: retourAvecJeton(compte, cible), 'cache-control': 'no-store' });
    return void res.end();
  }
  /* Personne sur l'adresse d'administration : on regarde sur celle de l'espace client, où vit la session d'un client. */
  const ici = hoteNormalise(entete(req, 'x-forwarded-host') || entete(req, 'host'));
  const client = hoteEspaceClient();
  if (!compte && client && ici !== client && !url.searchParams.has('ici')) {
    res.writeHead(302, { location: `https://${client}${ROUTE_CONNEXION_GARDE}?vers=${encodeURIComponent(cible.toString())}`, 'cache-control': 'no-store' });
    return void res.end();
  }
  return page(compte ? { erreur: 'Ce compte n’a pas accès à ce site. Connectez-vous avec un autre compte.' } : {});
}

function pageDeConnexion(o: {
  erreur?: string;
  message?: string;
  vers: string;
  hote: string;
  identifiant: string;
  outils: { champMotDePasse: string; styleDuChamp: string; scriptDuChamp: string };
}): string {
  const hote = echapperHtml(o.hote);
  return `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#09090b">
<title>Version de travail réservée</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#09090b; color:#fafafa;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:24px; }
  form { width:100%; max-width:360px; display:flex; flex-direction:column; gap:14px; }
  h1 { font-size:19px; font-weight:600; margin:0 0 4px; letter-spacing:-0.01em; }
  p.sub { margin:0 0 8px; color:#a1a1aa; font-size:13px; line-height:1.55; }
  p.sub strong { color:#fafafa; font-weight:500; word-break:break-all; }
  label { font-size:12px; color:#a1a1aa; display:block; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #27272a; background:#131316;
          color:#fafafa; font-size:14px; outline:none; }
  input:focus { border-color:#52525b; }
  button { padding:10px 12px; border-radius:8px; border:0; background:#fafafa; color:#09090b;
           font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#e4e4e7; }
  .err { background:#2a1215; border:1px solid #5c1f26; color:#fca5a5; padding:9px 11px; border-radius:8px; font-size:13px; }
  .pied { color:#71717a; font-size:12px; line-height:1.5; margin:4px 0 0; }
${o.outils.styleDuChamp}</style>
</head>
<body>
<form method="POST" action="${ROUTE_CONNEXION_GARDE}?ici=1" data-garde-acces>
  <h1>Version de travail réservée</h1>
  <p class="sub">${hote ? `<strong>${hote}</strong> est une version de travail. ` : ''}Elle s’ouvre aux personnes connectées : l’équipe, et les clients du projet avec l’accès de leur espace client.</p>
  ${o.erreur ? `<div class="err" data-garde-erreur>${echapperHtml(o.erreur)}</div>` : ''}
  <input type="hidden" name="vers" value="${echapperHtml(o.vers)}">
  <div><label for="u">Identifiant</label><input id="u" name="username" value="${echapperHtml(o.identifiant)}" autocomplete="username" autocapitalize="off" autocorrect="off" required autofocus></div>
  <div><label for="p">Mot de passe</label>${o.outils.champMotDePasse}</div>
  <button type="submit">Entrer</button>
  <p class="pied">La version en ligne du site reste ouverte à tous.</p>
</form>
${o.outils.scriptDuChamp}
</body>
</html>`;
}
