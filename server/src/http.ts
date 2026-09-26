import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  Attachment,
  choisirEncodage,
  type Encodage,
  TRANCHE_ATTENTE_MS,
  REFUS_AVANT_ANALYSE,
  analyseDeCadrageFaite,
  outilVerrouilleAvantAnalyse,
  ROUTE_CARTE_EXTERNE,
  ROUTE_CLIENTS_EXTERNE,
  ROUTE_LLM_EXTERNE,
  ROUTE_LLM_MODELES_EXTERNE,
  jugerDemandeLlm,
  ROUTE_DOC_API,
  appelDuPontRecevable,
  TOUR_TERMINE,
  cleDesEntetes,
  documentationApi,
  jugerDemandeDeCarte,
  jugerLaCle,
  jugerRapportErreur,
  aliasDePieceJointe,
  nomSansCollision,
  nomSurDisque,
  plageDemandee,
  outilJournalise,
  pageChangelog,
  pageDocApi,
  rechercherClientsParNom,
  ROUTE_CHANGELOG,
  trouverLeProjetVise,
} from '@beluga/shared';
import { CONFIG, PATHS, ROOT, webRoot } from './config.js';
import { checkSession, login, logout, resolveDownload, getInternalToken, currentUsername, mintDownload } from './auth.js';
import {
  HOTE_ESPACE_CLIENT,
  porteDeLHote,
  redirectionDeLaPorte,
  routeApiAutorisee,
  peutVoirProjet,
  REFUS_HORS_PORTEE,
  type CompteUtilisateur,
} from '@beluga/shared';
import { demandeDUneePiece, filDUnePiece } from './espace-client.js';
import { deposerArchive, examinerArchive } from './export-donnees.js';
import { cheminDePieceJointe, dossierDEcriture } from './pieces-jointes.js';
import { recevoirAuFilDeLEau } from './envoi-piece-jointe.js';
import { pipeline } from 'node:stream/promises';
import * as store from './store.js';
import { bus } from './bus.js';
import { callTool, outilServiA, toolsFor } from './tools.js';
import { faireNaitreLaCarte } from './naissance-de-carte.js';
import { adresseDeBeluga, recevoirEvenement, suivreLien } from './marketing.js';
import { scriptDeSuivi } from '@beluga/shared';
import { creationAllumeePourLAgent } from './mode-creation.js';
import { cleParSecret, noterUsageDeCle } from './cles-api.js';
import { relayerCatalogueLlm, relayerDemandeLlm } from './relais-llm.js';
import {
  ajouterConsultationMemoireAuTour,
  attachToCurrentMessage,
  journaliserDansLeTour,
  liveRun,
} from './runtime.js';
import { readFilePreview, imageDEtape, makeZip, safeJoin } from './files.js';
import { EXTRAIT, transcribe, digestText, speak, voiceAvailable, normaliserTexteVoix } from './voice.js';
import { publicKey, subscribe, unsubscribe } from './push.js';
import { pontDemarre, pontAServiLesOutils, pontAAbouti } from './pont.js';
import { attendreUneTranche, poserLAttente } from './attente-question.js';
import { enregistrerErreurInterface } from './erreurs-interface.js';
import { fichierFavicon } from './favicon.js';
import { log } from './logger.js';
import { jugerLUrgenceEnFond } from './juge-des-cartes.js';

const COOKIE = 'beluga_session';

function readCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) out[key] = decodeURIComponent(rest.join('='));
  }
  return out;
}

export function sessionToken(req: http.IncomingMessage): string | undefined {
  const cookies = readCookies(req);
  return cookies[COOKIE];
}

/**
 * QUI FRAPPE À LA PORTE ? Rend l'identité derrière le cookie — qui, quel rôle,
 * quels projets —, ou `null`. Tout ce qui décide d'un droit part de là.
 */
export function identiteDeLaRequete(req: http.IncomingMessage): CompteUtilisateur | null {
  return checkSession(sessionToken(req));
}

function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'inconnu';
}

async function readBody(req: http.IncomingMessage, limit = 60 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('contenu trop volumineux');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/*
 * CE QUI PART VERS L'ÉCRAN PART COMPRESSÉ (`shared/src/compression-http.ts`).
 *
 * Ce que le navigateur sait lire (`accept-encoding`) est attaché à SA réponse
 * dès l'entrée du gestionnaire, pour que `json` et `serveStatic` le retrouvent
 * sans qu'on ait à le passer à chacun des soixante appels. Attaché à la
 * réponse, et non à une variable partagée : le gestionnaire attend souvent
 * (lecture d'un corps, appel d'un outil), et deux requêtes s'y croisent.
 */
const encodagesAcceptes = new WeakMap<http.ServerResponse, string | undefined>();
function retenirLesEncodages(req: http.IncomingMessage, res: http.ServerResponse): void {
  const brut = req.headers['accept-encoding'];
  encodagesAcceptes.set(res, Array.isArray(brut) ? brut.join(', ') : brut);
}
const acceptEncodingDe = (res: http.ServerResponse): string | undefined => encodagesAcceptes.get(res);

/**
 * Le corps compressé d'un coup : pour une réponse dont on tient déjà les
 * octets. Qualité modérée par défaut — une réponse JSON se compresse en
 * quelques millisecondes, sans retenir le tour de boucle du démon — et plus
 * haute pour ce qui est compressé UNE FOIS puis gardé en mémoire.
 */
function compresser(corps: Buffer, encodage: Encodage, soigne = false): Buffer {
  return encodage === 'br'
    ? zlib.brotliCompressSync(corps, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: soigne ? 9 : 4,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: corps.length,
        },
      })
    : zlib.gzipSync(corps, { level: soigne ? 9 : 6 });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const brut = Buffer.from(JSON.stringify(data));
  const type = 'application/json; charset=utf-8';
  const encodage = choisirEncodage({ acceptEncoding: acceptEncodingDe(res), contentType: type, taille: brut.length });
  const body = encodage ? compresser(brut, encodage) : brut;
  res.writeHead(status, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-store',
    vary: 'accept-encoding',
    ...(encodage ? { 'content-encoding': encodage } : {}),
  });
  res.end(body);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav',
};

/**
 * Les fichiers IMMUABLES (nom haché) compressés une fois pour toutes, gardés en
 * mémoire : le paquet de l'application se sert des milliers de fois entre deux
 * publications, il serait absurde de le recompresser à chaque ouverture. Une
 * publication change les noms, donc les clés — rien de périmé ne survit.
 */
const cacheCompresse = new Map<string, Buffer>();

/** La page de l'application, renommée « Haiko Chat » pour le visage client. */
export function pageAuNomDuClient(html: string): string {
  return html
    .replace(/<title>[^<]*<\/title>/, '<title>Haiko Chat</title>')
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, '$1Haiko Chat$2');
}

function serveStatic(res: http.ServerResponse, filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const hashed = /-[A-Za-z0-9_]{8,}\.(js|css|woff2)$/.test(filePath);
  const type = MIME[ext] ?? 'application/octet-stream';
  const entetes: http.OutgoingHttpHeaders = {
    'content-type': type,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
    vary: 'accept-encoding',
  };
  const encodage = choisirEncodage({ acceptEncoding: acceptEncodingDe(res), contentType: type, taille: stat.size });
  if (!encodage) {
    res.writeHead(200, { ...entetes, 'content-length': stat.size });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }
  if (hashed) {
    const cle = `${encodage}:${filePath}`;
    let corps = cacheCompresse.get(cle);
    if (!corps) {
      corps = compresser(fs.readFileSync(filePath), encodage, true);
      cacheCompresse.set(cle, corps);
    }
    res.writeHead(200, { ...entetes, 'content-encoding': encodage, 'content-length': corps.length });
    res.end(corps);
    return true;
  }
  // Un fichier qui peut changer (page d'accueil, service worker) : compressé
  // au fil de l'eau, à une qualité qui ne retient pas la réponse.
  res.writeHead(200, { ...entetes, 'content-encoding': encodage });
  const flux =
    encodage === 'br'
      ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
      : zlib.createGzip({ level: 6 });
  fs.createReadStream(filePath).pipe(flux).pipe(res);
  return true;
}

const LOGIN_PAGE = (error?: string) => `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>Beluga Build</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#09090b; color:#fafafa;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:24px; }
  form { width:100%; max-width:340px; display:flex; flex-direction:column; gap:14px; }
  h1 { font-size:19px; font-weight:600; margin:0 0 4px; letter-spacing:-0.01em; }
  p.sub { margin:0 0 12px; color:#a1a1aa; font-size:13px; line-height:1.5; }
  label { font-size:12px; color:#a1a1aa; display:block; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #27272a; background:#131316;
          color:#fafafa; font-size:14px; outline:none; }
  input:focus { border-color:#52525b; }
  button { padding:10px 12px; border-radius:8px; border:0; background:#fafafa; color:#09090b;
           font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#e4e4e7; }
  .err { background:#2a1215; border:1px solid #5c1f26; color:#fca5a5; padding:9px 11px; border-radius:8px; font-size:13px; }
</style>
</head>
<body>
<form method="POST" action="/auth/login">
  <h1>Beluga Build</h1>
  <p class="sub">Pilotage de projets par agents.</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div><label for="u">Identifiant</label><input id="u" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required autofocus></div>
  <div><label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
  <button type="submit">Entrer</button>
</form>
</body>
</html>`;

/**
 * LA PORTE DES CLIENTS. Une page à part, servie sur `my.haikostudio.cloud` :
 * elle ne nomme jamais l'application d'administration, ne parle ni d'agents ni
 * de projets, et ne dit rien de plus qu'un formulaire. Le fond et les couleurs
 * suivent la marque, sans dépendre de l'interface construite : cette page doit
 * s'afficher même quand `web/dist` n'existe pas encore.
 */
const PAGE_ENTREE_CLIENT = (error?: string) => `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>Haiko Chat</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#09090b; color:#fafafa;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:24px; }
  form { width:100%; max-width:340px; display:flex; flex-direction:column; gap:14px; }
  h1 { font-size:19px; font-weight:600; margin:0 0 4px; letter-spacing:-0.01em; }
  p.sub { margin:0 0 12px; color:#a1a1aa; font-size:13px; line-height:1.5; }
  label { font-size:12px; color:#a1a1aa; display:block; margin-bottom:6px; }
  input { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #27272a; background:#131316;
          color:#fafafa; font-size:14px; outline:none; }
  input:focus { border-color:#52525b; }
  button { padding:10px 12px; border-radius:8px; border:0; background:#fafafa; color:#09090b;
           font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#e4e4e7; }
  .err { background:#2a1215; border:1px solid #5c1f26; color:#fca5a5; padding:9px 11px; border-radius:8px; font-size:13px; }
</style>
</head>
<body>
<form method="POST" action="/auth/login" data-porte="client">
  <h1>Haiko Chat</h1>
  <p class="sub">Vos demandes, vos échanges.</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div><label for="u">Identifiant</label><input id="u" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required autofocus></div>
  <div><label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
  <button type="submit">Entrer</button>
</form>
</body>
</html>`;

/**
 * CETTE PIÈCE JOINTE EST-ELLE LISIBLE PAR CE CLIENT ? Elle doit appartenir à
 * l'une de ses demandes — projet de sa portée ET demande dont il est l'auteur —
 * ou à son propre fil de discussion. Tout le reste est refusé.
 */
function pieceLisiblePar(compte: CompteUtilisateur, attachmentId: string): boolean {
  const demande = demandeDUneePiece(attachmentId);
  if (demande) {
    return peutVoirProjet(compte, demande.projectId) && demande.auteurId === compte.id;
  }
  const filId = filDUnePiece(attachmentId);
  if (filId) return filId === compte.id;
  return false;
}

export function createHttpServer(): http.Server {
  /*
   * `requestTimeout: 0` : Node coupe par défaut toute requête qui n'a pas fini
   * d'arriver en 5 minutes — une vidéo de 2 Go depuis une connexion ordinaire
   * en prend davantage. Les entêtes, eux, gardent leur délai (`headersTimeout`).
   */
  return http.createServer({ requestTimeout: 0 }, async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = url.pathname;
    retenirLesEncodages(req, res);

    try {
      /* ---------------- Points publics ---------------- */

      if (route === '/health') {
        return json(res, 200, {
          ok: true,
          version: CONFIG.version,
          clients: bus.clientCount(),
          uptime: Math.round(process.uptime()),
        });
      }

      if (route === '/auth/login' && req.method === 'POST') {
        const body = (await readBody(req, 64 * 1024)).toString('utf8');
        const params = new URLSearchParams(body);
        const isJson = (req.headers['content-type'] ?? '').includes('json');
        const payload = isJson ? JSON.parse(body || '{}') : Object.fromEntries(params);
        const result = login(String(payload.username ?? ''), String(payload.password ?? ''), clientIp(req));
        if (!result.ok) {
          if (isJson) return json(res, 401, { ok: false, error: result.error });
          res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
          // Le refus se réaffiche SUR LA PORTE d'où il vient : un client refusé
          // ne doit pas se retrouver devant le formulaire d'administration.
          const porteDEntree = porteDeLHote(req.headers.host);
          return res.end(porteDEntree === 'client' ? PAGE_ENTREE_CLIENT(result.error) : LOGIN_PAGE(result.error));
        }
        const cookie = `${COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.sessionDays * 86400}`;
        if (isJson) {
          res.writeHead(200, { 'set-cookie': cookie, 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
        res.writeHead(302, { 'set-cookie': cookie, location: '/' });
        return res.end();
      }

      /* ---------------- Atelier marketing : la porte des sites suivis ---------------- */

      /*
       * LE SCRIPT DE SUIVI, LA RÉCEPTION DES VISITES ET LES LIENS DE SUIVI
       * (`server/src/marketing.ts`). Publics par nature : les sites qui les
       * appellent sont ailleurs, sans compte. Ils ne lisent rien de la base :
       * le script est le même pour tous, la réception n'accepte qu'une clé
       * connue venue d'un site DÉCLARÉ, et un lien ne rend qu'une redirection.
       * Aucun cookie n'est lu ni posé ici.
       */
      if (route === '/m/s.js') {
        res.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=3600',
          'access-control-allow-origin': '*',
        });
        return res.end(req.method === 'HEAD' ? '' : scriptDeSuivi(adresseDeBeluga()));
      }
      if (route === '/m/c') {
        const origine = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
        const entetes: Record<string, string> = {
          'access-control-allow-origin': origine ?? '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          vary: 'Origin',
        };
        if (req.method === 'OPTIONS') {
          res.writeHead(204, entetes);
          return res.end();
        }
        if (req.method !== 'POST') {
          res.writeHead(405, entetes);
          return res.end();
        }
        let corps = '';
        try {
          corps = (await readBody(req, 4096)).toString('utf8');
        } catch {
          res.writeHead(413, entetes);
          return res.end();
        }
        const recu = recevoirEvenement({ corps, origine, ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '') });
        res.writeHead(recu.ok ? 204 : recu.statut, entetes);
        return res.end();
      }
      if (route.startsWith('/m/l/')) {
        const code = route.slice('/m/l/'.length).replace(/[^A-Za-z0-9_-]/g, '');
        const cible = code ? suivreLien(code, { ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '') }) : null;
        if (!cible) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          return res.end('Lien inconnu.');
        }
        res.writeHead(302, { location: cible, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer-when-downgrade' });
        return res.end();
      }

      if (route === '/auth/logout') {
        logout(sessionToken(req));
        res.writeHead(302, {
          'set-cookie': `${COOKIE}=; Path=/; Max-Age=0`,
          location: '/',
        });
        return res.end();
      }

      /* ---------------- Porte d'entrée des services extérieurs ---------------- */

      /**
       * LE MODE D'EMPLOI, PUBLIC.
       *
       * Un service qu'on branche doit pouvoir trouver la marche à suivre sans
       * compte : `/api` la donne, avant le mur d'accès. Lecture seule, aucun
       * accès à la base — la page ne montre que du texte, jamais une clé, un
       * projet ou une carte. En HTML pour un humain, en JSON pour un outil.
       */
      if (route === ROUTE_DOC_API || route === `${ROUTE_DOC_API}/`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return json(res, 405, { ok: false, error: 'Cette adresse se lit en GET.' });
        }
        // Derrière un proxy, l'adresse publique est en https : la donner fausse
        // ferait recopier un exemple qui ne marche pas.
        const proto =
          String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || url.protocol.replace(':', '');
        const racine = `${proto}://${req.headers.host ?? url.host}`;
        const veutJson =
          String(req.headers.accept ?? '').includes('application/json') || url.searchParams.get('format') === 'json';
        if (veutJson) return json(res, 200, documentationApi(racine));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? '' : pageDocApi(racine));
      }

      /**
       * LE JOURNAL DES LIVRAISONS, PUBLIC. `HISTORIQUE.md` vit à la racine du
       * dépôt et est relu à CHAQUE requête — jamais mis en cache ici — pour
       * que la page suive sans redémarrage la moindre nouvelle entrée.
       */
      if (route === ROUTE_CHANGELOG || route === `${ROUTE_CHANGELOG}/`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return json(res, 405, { ok: false, error: 'Cette adresse se lit en GET.' });
        }
        const fichier = path.join(ROOT, 'HISTORIQUE.md');
        const contenu = fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : '';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, must-revalidate' });
        return res.end(req.method === 'HEAD' ? '' : pageChangelog(contenu));
      }

      /**
       * UNE CARTE POSÉE DEPUIS LE DEHORS, par un service qui présente sa CLÉ.
       *
       * Le cas réel : un mail d'un client arrive, et le service qui le reçoit
       * pose aussitôt une carte dans le projet de ce client. Aucune session,
       * aucun cookie : la clé seule ouvre la porte, et elle n'ouvre QUE cette
       * porte — créer une carte, rien d'autre.
       *
       * La carte naît dans « Planifié » comme toutes les autres (`createCard`) :
       * elle attend un lancement, et aucun agent de TÂCHE ne part tout seul.
       *
       * Mais contrairement à une carte posée à la main, personne n'est là pour
       * discuter avec l'agent de cadrage avant de cliquer « Lancer » : sans
       * rien de plus, elle resterait nue, avec pour seul contenu le texte brut
       * envoyé par le service extérieur. On lui ouvre donc SON cadrage
       * par le parcours commun (`faireNaitreLaCarte`) : sa demande ouvre sa
       * conversation, et le premier tour du cadrage l'étudie tout de suite
       * (mémoire par sujet comprise), jusqu'à la compréhension.
       */
      if (route === ROUTE_CARTE_EXTERNE) {
        if (req.method !== 'POST') {
          return json(res, 405, { ok: false, error: 'Cette adresse attend un POST.' });
        }

        const presentee = cleDesEntetes(req.headers);
        const verdict = jugerLaCle(presentee, presentee ? cleParSecret(presentee) : undefined);
        if (!verdict.ok) {
          log.warn('api externe', `appel refusé (${verdict.motif}) depuis ${clientIp(req)}`);
          return json(res, verdict.statut, { ok: false, error: verdict.raison });
        }

        let brut: unknown;
        try {
          brut = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || 'null');
        } catch {
          return json(res, 400, { ok: false, error: "L'envoi n'est pas du JSON lisible." });
        }

        const demande = jugerDemandeDeCarte(brut);
        if (!demande.ok) return json(res, 400, { ok: false, error: demande.raison });

        const projets = store.listProjects(true).map((p) => ({ id: p.id, name: p.name, archive: p.archived }));
        const vise = trouverLeProjetVise(projets, demande.demande.projet);
        if (!vise.ok) return json(res, vise.statut, { ok: false, error: vise.raison });

        /*
         * LE PARCOURS COMMUN (MEM-3555) : la carte naît avec sa demande en tête
         * de sa conversation, son agent de cadrage et un premier tour jusqu'à
         * la compréhension — même sans description, où elle ne recevait aucun
         * cadrage. Rien ne se lance pour autant.
         */
        const { card } = await faireNaitreLaCarte(vise.projet.id, {
          title: demande.demande.titre,
          description: demande.demande.description,
          labels: demande.demande.etiquettes,
          origin: 'user',
          auteur: 'porte-externe',
        });
        noterUsageDeCle(verdict.cle.id);
        /*
         * CETTE DEMANDE PRESSE-T-ELLE ? Un avis pour ORDONNER ce qui attend,
         * posé en arrière-plan : la réponse à l'appelant ne l'attend pas, et
         * aucun avis ne lance, ne valide ni ne déplace quoi que ce soit
         * (`server/src/juge-des-cartes.ts`). Sans Laya installé : rien.
         */
        jugerLUrgenceEnFond(card.id, 'porte-externe');
        log.info('api externe', `carte « ${card.title} » posée dans ${vise.projet.name} par « ${verdict.cle.nom} »`);

        return json(res, 201, {
          ok: true,
          carte: {
            id: card.id,
            titre: card.title,
            description: card.description,
            colonne: card.column,
            projet: { id: vise.projet.id, nom: vise.projet.name },
            creeeLe: card.createdAt,
          },
        });
      }

      /**
       * RETROUVER LE PROJET D'UN CLIENT, PAR SON NOM.
       *
       * Un service extérieur connaît le nom d'un client — celui qui vient
       * d'écrire, par exemple — pas l'identifiant technique du projet
       * Beluga Build qui lui correspond. Cette adresse rend les clients déjà
       * rapprochés d'un projet (réglages → onglet facturation), filtrés sur
       * le nom quand `?client=` est donné. Même clé que la création de
       * carte : lecture seule, rien n'est modifié.
       */
      if (route === ROUTE_CLIENTS_EXTERNE) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return json(res, 405, { ok: false, error: 'Cette adresse se lit en GET.' });
        }

        const presentee = cleDesEntetes(req.headers);
        const verdict = jugerLaCle(presentee, presentee ? cleParSecret(presentee) : undefined);
        if (!verdict.ok) {
          log.warn('api externe', `appel refusé (${verdict.motif}) depuis ${clientIp(req)}`);
          return json(res, verdict.statut, { ok: false, error: verdict.raison });
        }

        const recherche = url.searchParams.get('client') ?? url.searchParams.get('nom') ?? undefined;
        const projets = store.listProjects(true).map((p) => ({
          id: p.id,
          name: p.name,
          archive: p.archived,
          billing: p.billing,
        }));
        const clients = rechercherClientsParNom(projets, recherche ?? undefined);
        return json(res, 200, { ok: true, clients });
      }

      /**
       * LE RELAIS LLM : un site extérieur fait rédiger un texte SANS porter la clé.
       *
       * L'application de facturation est un site statique : tout ce qu'elle
       * embarque part dans le navigateur. Sa clé OpenRouter s'y lisait donc en
       * clair. Elle vit désormais dans le COFFRE-FORT d'ici, et le site passe
       * par cette porte — même clé nommée que la création de carte, révocable
       * depuis les réglages, et qui n'ouvre AUCUNE donnée du tableau.
       *
       * Aucun en-tête CORS n'est posé à dessein : cette porte s'atteint depuis
       * un serveur (le proxy du site appelant), jamais depuis un navigateur qui
       * devrait alors porter la clé lui-même.
       */
      if (route === ROUTE_LLM_EXTERNE || route === ROUTE_LLM_MODELES_EXTERNE) {
        const catalogue = route === ROUTE_LLM_MODELES_EXTERNE;
        if (catalogue ? req.method !== 'GET' && req.method !== 'HEAD' : req.method !== 'POST') {
          return json(res, 405, {
            ok: false,
            error: catalogue ? 'Cette adresse se lit en GET.' : 'Cette adresse attend un POST.',
          });
        }

        const presentee = cleDesEntetes(req.headers);
        const verdict = jugerLaCle(presentee, presentee ? cleParSecret(presentee) : undefined);
        if (!verdict.ok) {
          log.warn('api externe', `relais llm refusé (${verdict.motif}) depuis ${clientIp(req)}`);
          return json(res, verdict.statut, { ok: false, error: verdict.raison });
        }
        noterUsageDeCle(verdict.cle.id);

        if (catalogue) {
          const rendu = await relayerCatalogueLlm();
          if (!rendu.ok) return json(res, rendu.statut, { ok: false, error: rendu.raison });
          return json(res, 200, rendu.corps as Record<string, unknown>);
        }

        let brut: unknown;
        try {
          brut = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || 'null');
        } catch {
          return json(res, 400, { ok: false, error: "L'envoi n'est pas du JSON lisible." });
        }
        const demande = jugerDemandeLlm(brut);
        if (!demande.ok) return json(res, 400, { ok: false, error: demande.raison });

        const rendu = await relayerDemandeLlm(demande.demande);
        if (!rendu.ok) return json(res, rendu.statut, { ok: false, error: rendu.raison });
        return json(res, 200, rendu.corps as Record<string, unknown>);
      }

      /* ---------------- Pont d'outils des agents ---------------- */

      if (route.startsWith('/internal/')) {
        if (req.headers['x-beluga-token'] !== getInternalToken()) {
          return json(res, 403, { error: 'jeton interne invalide' });
        }
        const agentId = String(req.headers['x-beluga-agent'] ?? '');
        const agent = store.getAgent(agentId);
        if (!agent) return json(res, 404, { error: 'agent inconnu' });

        /*
         * L'APPEL VIENT-IL DU TOUR QUI TOURNE ? La configuration du pont est un
         * fichier sur le disque : elle survit à son tour, et Cursor peut même
         * lire celle d'un dépôt VOISIN au lieu de la sienne
         * (`shared/src/racine-cursor.ts`). Une carte proposée par le chef d'un
         * projet s'est ainsi écrite dans le fil d'un agent d'un AUTRE projet,
         * terminé deux heures plus tôt. Le tour annoncé est donc comparé à celui
         * qui travaille vraiment, et un appel étranger est REFUSÉ, en clair,
         * avant d'écrire quoi que ce soit.
         */
        const recevable = appelDuPontRecevable({
          tourAnnonce: String(req.headers['x-beluga-tour'] ?? '') || undefined,
          tourEnCours: liveRun(agentId)?.tourId,
        });
        if (!recevable.ok) {
          // Un envoi refusé « tour terminé » est un envoi ARRIVÉ TROP TARD : on
          // le dit, pour ne plus lire « plan jamais venu » là où il a été rejeté.
          const tardif = recevable.raison === TOUR_TERMINE ? ` — envoi arrivé après la fermeture du tour (route ${route})` : '';
          log.warn(`appel d'outil refusé (agent ${agentId})${tardif} : ${recevable.raison}`);
          if (route === '/internal/call') return json(res, 200, { ok: false, text: recevable.raison });
          return json(res, 409, { error: recevable.raison });
        }

        /*
         * Le pont s'annonce en démarrant : sans cette trace, un tour sans le
         * moindre outil passait pour un tour normal (la réponse affirmait même
         * avoir lu la mémoire). `runtime` la relit à la fin du tour.
         */
        if (route === '/internal/pont') {
          pontDemarre(agentId);
          return json(res, 200, { ok: true });
        }
        if (route === '/internal/tools') {
          const tools = toolsFor(agent.role, { creation: creationAllumeePourLAgent(agentId) }).filter((tool) =>
            outilServiA(tool.name, agentId),
          );
          pontAServiLesOutils(agentId, tools.length);
          return json(res, 200, { tools });
        }
        /*
         * « Alors, cette réponse ? » Le pont redemande par tranches courtes ;
         * chaque tranche dort côté serveur puis rend soit l'issue, soit
         * « attente ». Découper évite qu'une requête endormie une demi-heure se
         * fasse couper par le premier délai venu.
         */
        if (route === '/internal/attente') {
          const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
          const issue = await attendreUneTranche(String(body.questionId ?? ''));
          return json(res, 200, issue);
        }
        /*
         * LE VERROU D'ANALYSE, DEMANDÉ À L'APPEL. Le script posé devant chaque
         * outil de terrain du cadrage (`server/verrou-analyse.mjs`) demande ici
         * si la mémoire est ouverte. Une mesure illisible ne mure jamais un
         * cadrage : elle rend « faite ».
         */
        if (route === '/internal/analyse') {
          let corps: { outil?: unknown } = {};
          try {
            corps = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
          } catch {
            corps = {};
          }
          const outil = typeof corps?.outil === 'string' ? corps.outil : '';
          let analyseFaite = true;
          // Un outil de préparation (ToolSearch) n'est jamais retenu, même par un vieux réglage.
          if (agent.role === 'cadrage' && (!outil || outilVerrouilleAvantAnalyse(outil))) {
            try {
              analyseFaite = analyseDeCadrageFaite({
                ouverturesMemoire: store.consultationsDeLAgent(agentId).ouvertures,
              });
            } catch (err) {
              log.warn('verrou d’analyse : mesure de mémoire illisible', err);
            }
          }
          return json(res, 200, { analyseFaite, text: analyseFaite ? '' : REFUS_AVANT_ANALYSE });
        }
        if (route === '/internal/call') {
          const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}');
          const allowed = toolsFor(agent.role, { creation: creationAllumeePourLAgent(agentId) }).some(
            (tool) => tool.name === body.name && outilServiA(tool.name, agentId),
          );
          if (!allowed) {
            return json(res, 200, {
              ok: false,
              text: `Refusé : l'outil « ${body.name} » n'est pas autorisé pour ce rôle.`,
            });
          }
          const debutAppel = Date.now();
          /*
           * L'APPEL EST PORTÉ JUSQU'AU DÉMON : le pont a donc bel et bien servi
           * ce tour. C'est cette trace-là, et non le texte rendu à la fin, qui
           * dit qu'un tour a eu ses moyens (`tourARejouerFauteDOutils`). Elle
           * est posée AVANT l'exécution : un outil qui échoue pour SA raison —
           * un sujet de mémoire inconnu, un dépôt refusé — reste un outil qui a
           * répondu, et ne fait pas rejouer le tour.
           */
          pontAAbouti(agentId);
          const result = await callTool(
            {
              agentId,
              projectId: agent.projectId,
              role: agent.role,
              cardId: agent.cardId,
              // Les réglages visibles dans la barre d'écriture au moment du
              // clic : une carte proposée en hérite.
              run: { engine: agent.run.engine, model: agent.run.model, thinking: agent.run.thinking },
            },
            body.name,
            body.args ?? {},
          );
          /*
           * TOUT APPEL D'OUTIL REJOINT LE JOURNAL DE LA CARTE, réussi ou non.
           * `consultationsMemoire`, juste en dessous, ne garde que la mémoire
           * et les compétences, et sur le seul message du tour : elle meurt donc
           * avec lui. Le journal, lui, accumule la vie ENTIÈRE de la carte — le
           * coffre-fort ouvert au cadrage, la question posée, la carte
           * déplacée —, avec les paramètres reçus, le texte exact rendu et la
           * durée de l'appel (`shared/src/journal-carte.ts`).
           */
          if (outilJournalise(body.name)) {
            /*
             * UNE QUESTION N'A PAS ENCORE DE RÉPONSE À CETTE SECONDE-LÀ. Le
             * texte rendu ici n'est qu'un accusé de réception adressé au moteur
             * (« ARRÊTE-TOI ICI… ») : écrit au journal, il s'affichait sous
             * l'intitulé « RÉPONSE » du parcours, à la place de ce que
             * l'utilisateur allait choisir. La vraie réponse arrive avec
             * l'étape du moteur, qui se referme quand elle est donnée — et les
             * deux traces sont réunies en une seule ligne
             * (`fusionnerLesAppelsEnDouble`).
             */
            journaliserDansLeTour(agentId, {
              nature: 'requete',
              libelle: String(body.name),
              outil: String(body.name),
              params: body.args ?? {},
              resultat: result.question ? '' : result.text,
              reussie: result.ok,
              dureeMs: Date.now() - debutAppel,
            });
          }

          if (result.proposal) {
            /*
             * UN SEUL MESSAGE PORTE LA PROPOSITION. Le fil la lit sur le message
             * du tour, la table la rangeait sous le « dernier message » relu à
             * part : deux lectures qui pouvaient déjà se contredire. C'est
             * désormais le message réellement touché qui fait foi — et
             * l'attachement range la proposition dans sa table AVANT d'allumer
             * le signal d'attention du projet.
             */
            attachToCurrentMessage(agentId, { proposal: result.proposal });
          }
          if (result.download) attachToCurrentMessage(agentId, { download: result.download });
          if (result.attachment) attachToCurrentMessage(agentId, { attachment: result.attachment.id });
          /*
           * LE RÉSULTAT DE LA MÉMOIRE REJOINT SA BULLE, pas le déroulé
           * générique des commandes. Le nom du sujet seul était déjà visible,
           * mais pas le texte effectivement rendu au moteur : impossible de
           * juger ce qui avait circulé. On garde aussi un refus, avec son
           * explication, car il fait partie du parcours réel.
           */
          if (body.name === 'memoire') {
            const requete = [body.args?.demande, body.args?.id, body.args?.code, body.args?.fiche, body.args?.titre].find((v) => typeof v === 'string' && v.trim());
            ajouterConsultationMemoireAuTour(agentId, {
              source: 'memoire',
              requete: typeof requete === 'string' ? requete : '',
              resultat: result.text,
              reussie: result.ok,
            });
          }
          if (body.name === 'competences' && (!body.args?.action || body.args.action === 'lister')) {
            ajouterConsultationMemoireAuTour(agentId, {
              source: 'competence',
              requete: 'catalogue partagé',
              resultat: result.text,
              reussie: result.ok,
            });
          }
          /*
           * UNE QUESTION ARRÊTE LE MOTEUR. On enregistre l'attente AVANT de
           * rendre la main : le pont d'outils va sonder `/internal/attente`
           * jusqu'à la réponse, donc l'appel d'outil du moteur reste ouvert et
           * aucune étape suivante ne part. Sans cela, l'agent continuait sa
           * liste et la réponse de l'utilisateur tombait dans la file, pour
           * n'être lue qu'une fois tout le travail fini.
           */
          if (result.question) {
            /*
             * L'ATTENTE EST POSÉE AVANT LA QUESTION, pas après. Attacher la
             * question au message DIFFUSE aussitôt l'événement que les écrans
             * écoutent (le tiroir de procédure, par exemple, y recalcule son
             * témoin) : posée ensuite, l'attente arrivait trop tard et ces
             * écrans concluaient que l'agent travaillait encore, chronomètre
             * qui défile, devant la question qu'ils venaient d'afficher.
             */
            poserLAttente(result.question.id, agentId);
            attachToCurrentMessage(agentId, { question: result.question });
            return json(res, 200, {
              ok: result.ok,
              text: result.text,
              attente: { questionId: result.question.id, trancheMs: TRANCHE_ATTENTE_MS },
            });
          }
          return json(res, 200, { ok: result.ok, text: result.text });
        }
        return json(res, 404, { error: 'route interne inconnue' });
      }

      /* ---------------- Ressources publiques de l'application ---------------- */

      // Le manifeste, les icônes et le service worker doivent rester lisibles
      // sans session : sinon l'installation sur téléphone échoue silencieusement.
      // Les images des notifications suivent la même règle : le navigateur va
      // les chercher pour afficher une alerte, parfois sans onglet ouvert.
      //
      // DEUX FICHES D'INSTALLATION, UNE PAR VISAGE. Sur l'adresse de l'espace
      // client, `/manifest.json` rend `manifest-client.json` — « Haiko Chat »,
      // la baleine — ; l'administration garde « Beluga Build ». Même adresse de
      // fichier des deux côtés : `index.html` et le cache du service worker
      // (par origine) n'ont rien à savoir.
      if (
        ['/manifest.json', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(route) ||
        /^\/notif\/[a-z-]+\.png$/.test(route)
      ) {
        const racine = webRoot();
        const fichier =
          route === '/manifest.json' && porteDeLHote(req.headers.host) === 'client' ? '/manifest-client.json' : route;
        const publicFile = path.join(racine, fichier.replace(/^\/+/, ''));
        if (publicFile.startsWith(racine) && serveStatic(res, publicFile)) return;
      }

      /* ---------------- Mur d'accès ---------------- */

      /*
       * DEUX VISAGES, UN SEUL DÉMON : C'EST L'ENTÊTE `Host` QUI DÉCIDE.
       *
       * Sur `my.haikostudio.cloud`, un visiteur non identifié reçoit le
       * formulaire CLIENT — sobre, à la marque, et qui ne dit rien de
       * l'application d'administration. Ailleurs, la page d'entrée habituelle.
       */
      const porte = porteDeLHote(req.headers.host);
      const compte = identiteDeLaRequete(req);

      if (!compte) {
        if (route.startsWith('/api/')) return json(res, 401, { error: 'session expirée' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(porte === 'client' ? PAGE_ENTREE_CLIENT() : LOGIN_PAGE());
      }

      /*
       * UN COMPTE QUI FRAPPE À LA MAUVAISE PORTE EST RENVOYÉ CHEZ LUI. Un client
       * qui tape l'adresse d'administration ne voit ni son tableau, ni même son
       * formulaire : il repart vers son espace.
       */
      const ailleurs = redirectionDeLaPorte(porte, compte.role);
      if (ailleurs && !route.startsWith('/api/')) {
        res.writeHead(302, { location: ailleurs });
        return res.end();
      }

      /*
       * LA GRILLE DES ROUTES `/api/`, REFUS PAR DÉFAUT. Une route neuve est
       * fermée à un client tant que personne ne l'a nommée dans
       * `shared/src/droits-commandes.ts` — et le contrôle
       * `scripts/verif-cloison-client.mjs` le vérifie à chaque passage.
       */
      if (route.startsWith('/api/') && !routeApiAutorisee(compte.role, route)) {
        return json(res, 403, { error: REFUS_HORS_PORTEE });
      }

      /* ---------------- API authentifiée ---------------- */

      if (route === '/api/me') {
        return json(res, 200, {
          user: compte.identifiant,
          role: compte.role,
          nomAffiche: compte.nomAffiche,
          projets: compte.projets,
          version: CONFIG.version,
          voice: compte.role === 'admin' ? voiceAvailable() : false,
          pushKey: publicKey(),
        });
      }

      /*
       * L'ABONNEMENT EST RANGÉ AU NOM DE QUI L'ENVOIE. L'identité est celle du
       * COOKIE de session, déjà résolue plus haut : le navigateur ne la donne
       * pas, il ne pourrait que mentir. Sans propriétaire, une alerte destinée
       * à un client partirait aussi sur le téléphone de Haiko.
       */
      if (route === '/api/push/subscribe' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
        return json(res, 200, { ok: subscribe(body, compte.id) });
      }

      if (route === '/api/push/unsubscribe' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
        if (body.endpoint) unsubscribe(String(body.endpoint));
        return json(res, 200, { ok: true });
      }

      /**
       * Une erreur survenue DANS LA PAGE. Sur un téléphone, la console du
       * navigateur ne s'ouvre pas : sans ce point d'entrée, une application qui
       * blanchit ne laisse aucune trace. La page envoie l'erreur et n'attend
       * rien — un refus ne la gêne pas et n'est jamais réessayé.
       *
       * Le contenu est BORNÉ (64 Ko) et jugé par une règle pure : un envoi mal
       * formé est refusé en le disant, jamais rangé à moitié. C'est le serveur
       * qui date l'erreur : l'horloge d'un téléphone peut être fausse.
       */
      if (route === '/api/erreur' && req.method === 'POST') {
        const texte = (await readBody(req, 64 * 1024)).toString('utf8');
        let brut: unknown;
        try {
          brut = JSON.parse(texte || 'null');
        } catch {
          return json(res, 400, { ok: false, error: "L'envoi n'est pas lisible." });
        }
        const juge = jugerRapportErreur(brut, Date.now());
        if (!juge.ok) return json(res, 400, { ok: false, error: juge.raison });
        enregistrerErreurInterface(juge.erreur);
        log.warn('interface', `${juge.erreur.source} — ${juge.erreur.message}`);
        return json(res, 200, { ok: true });
      }

      if (route === '/api/upload' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') ?? '';
        // Un client ne dépose que dans un projet de sa portée.
        if (compte.role === 'client' && !peutVoirProjet(compte, projectId)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'fichier'));
        const mime = String(req.headers['content-type'] ?? 'application/octet-stream');
        /*
         * AU FIL DE L'EAU, JUSQU'À 2 GO (`server/src/envoi-piece-jointe.ts`) :
         * le corps va droit dans un fichier provisoire du dossier d'écriture,
         * jamais en mémoire. Un envoi annulé efface son provisoire.
         */
        const dossier = dossierDEcriture();
        const id = store.newId();
        const recu = await recevoirAuFilDeLEau(req, dossier, id);
        if (!recu.ok) {
          if (recu.statut === 499) {
            log.info('envoi', `${name} : ${recu.raison}`);
            if (!res.headersSent && !res.destroyed) json(res, 400, { error: recu.raison });
            return;
          }
          res.setHeader('connection', 'close');
          return json(res, recu.statut, { error: recu.raison });
        }
        const sha = recu.sha;

        // Dédoublonnage : le même fichier envoyé dix fois n'apparaît qu'une fois.
        const existing = store.findAttachmentBySha(projectId, sha);
        if (existing) {
          fs.rmSync(recu.provisoire, { force: true });
          return json(res, 200, { attachment: existing, deduplicated: true });
        }

        const cardId = url.searchParams.get('card') ?? undefined;
        const agentId = url.searchParams.get('agent') ?? undefined;
        // Deux images collées d'affilée arrivent presque toujours sous le même
        // nom générique (« image.png ») : sans repère distinct, leur tag dans
        // le texte devient ambigu dès qu'il y en a plus d'une.
        const conversation = cardId ?? agentId;
        const dejaUtilises = conversation
          ? store
              .listAttachments(projectId)
              .filter((a) => (a.cardId ?? a.agentId) === conversation)
              .map((a) => a.name)
          : [];

        const attachment = Attachment.parse({
          id,
          // Calculé UNE FOIS, ici, puis enregistré : c'est ce qui rend
          // l'identifiant court stable d'une session à l'autre.
          alias: aliasDePieceJointe(id, store.aliasDesPiecesJointes()),
          projectId,
          name: nomSansCollision(path.basename(name), dejaUtilises),
          mime,
          size: recu.taille,
          sha,
          cardId,
          agentId,
          createdAt: Date.now(),
        });
        fs.renameSync(recu.provisoire, path.join(dossier, nomSurDisque(attachment)));
        store.saveAttachment(attachment);
        bus.emit({ type: 'attachments', projectId, items: store.listAttachments(projectId) });
        return json(res, 200, { attachment });
      }

      if (route === '/api/attachment') {
        const id = url.searchParams.get('id') ?? '';
        const attachment = store.getAttachment(id);
        if (!attachment) return json(res, 404, { error: 'pièce jointe introuvable' });
        /*
         * UN CLIENT NE TÉLÉCHARGE QUE CE QU'IL A LE DROIT DE LIRE. Le fichier
         * doit appartenir à l'une de SES demandes, ou à SON fil : deviner un
         * identifiant ne mène nulle part, et le refus dit la même chose qu'une
         * pièce absente.
         */
        if (compte.role === 'client' && !pieceLisiblePar(compte, id)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        const file = cheminDePieceJointe(attachment);
        let taille: number;
        try {
          taille = fs.statSync(file).size;
        } catch {
          return json(res, 404, { error: 'fichier absent' });
        }
        /*
         * LECTURE PARTIELLE : le lecteur vidéo demande un morceau
         * (`Range: bytes=…`) pour démarrer vite et se déplacer dans un
         * fichier de 2 Go sans le télécharger en entier.
         */
        const entetes: http.OutgoingHttpHeaders = {
          'content-type': attachment.mime,
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=3600',
          'content-disposition': url.searchParams.get('download')
            ? `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`
            : 'inline',
        };
        const plage = plageDemandee(
          typeof req.headers.range === 'string' ? req.headers.range : undefined,
          taille,
        );
        if (plage.genre === 'impossible') {
          res.writeHead(416, { 'content-range': `bytes */${taille}` });
          return res.end();
        }
        if (plage.genre === 'partiel') {
          res.writeHead(206, {
            ...entetes,
            'content-range': `bytes ${plage.debut}-${plage.fin}/${taille}`,
            'content-length': plage.fin - plage.debut + 1,
          });
          if (req.method === 'HEAD') return res.end();
          return pipeline(fs.createReadStream(file, { start: plage.debut, end: plage.fin }), res).catch(() => {});
        }
        res.writeHead(200, { ...entetes, 'content-length': taille });
        if (req.method === 'HEAD') return res.end();
        return pipeline(fs.createReadStream(file), res).catch(() => {});
      }

      if (route === '/api/favicon') {
        const trouve = fichierFavicon(url.searchParams.get('project') ?? '');
        if (!trouve) return json(res, 404, { error: 'icône introuvable' });
        res.writeHead(200, { 'content-type': trouve.mime, 'cache-control': 'private, max-age=3600' });
        return fs.createReadStream(trouve.file).pipe(res);
      }

      /*
       * L'IMAGE D'UNE ÉTAPE DU DÉROULÉ. Une capture prise pendant un essai ne
       * se lit pas, elle se REGARDE : le déroulé affiche donc le fichier
       * lui-même sous son point (`web/src/components/steps.tsx`). Le chemin
       * vient de l'étape, écrite par le démon — jamais saisi à la main —, et
       * il n'est servi que s'il tombe dans l'une des racines de ce projet
       * (`imageDEtape`).
       */
      if (route === '/api/capture') {
        const project = store.getProject(url.searchParams.get('project') ?? '');
        if (!project) return json(res, 404, { error: 'projet introuvable' });
        const racines = [project.path, CONFIG.dataDir, os.tmpdir()];
        const trouve = imageDEtape(url.searchParams.get('path') ?? '', racines);
        if (!trouve) return json(res, 404, { error: 'capture introuvable' });
        res.writeHead(200, { 'content-type': trouve.mime, 'cache-control': 'private, max-age=3600' });
        return fs.createReadStream(trouve.file).pipe(res);
      }

      if (route === '/api/file') {
        const project = store.getProject(url.searchParams.get('project') ?? '');
        if (!project) return json(res, 404, { error: 'projet introuvable' });
        const relative = url.searchParams.get('path') ?? '';

        // Depuis l'aperçu, on peut aussi récupérer le fichier tel quel — pas
        // d'archive pour une seule image.
        if (url.searchParams.get('download')) {
          const full = safeJoin(project.path, relative);
          if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
            return json(res, 404, { error: 'fichier introuvable' });
          }
          res.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${encodeURIComponent(path.basename(full))}"`,
          });
          return fs.createReadStream(full).pipe(res);
        }

        const preview = readFilePreview(project.path, relative);
        return json(res, 200, preview);
      }

      if (route === '/api/zip' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
        const project = store.getProject(body.projectId ?? '');
        if (!project) return json(res, 404, { error: 'projet introuvable' });
        try {
          const zip = await makeZip(project.path, body.paths ?? [], body.label ?? project.name);
          const token = mintDownload(zip.file, zip.name);
          return json(res, 200, { token, name: zip.name, size: zip.size });
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? String(err) });
        }
      }

      /*
       * L'ARCHIVE DÉPOSÉE POUR IMPORT. Elle est binaire et peut peser lourd :
       * elle passe par le tuyau HTTP, pas par le protocole. On la range sous un
       * jeton et on rend TOUT DE SUITE ce qu'elle contient — c'est cet aperçu
       * que le tiroir affiche avant que qui que ce soit ne lance l'import.
       */
      if (route === '/api/donnees/archive' && req.method === 'POST') {
        try {
          const archive = await readBody(req, 512 * 1024 * 1024);
          const apercu = examinerArchive(archive);
          if (!apercu.ok) return json(res, 400, { error: apercu.raison });
          return json(res, 200, { depot: deposerArchive(archive), apercu });
        } catch (err: any) {
          return json(res, 400, { error: err?.message ?? String(err) });
        }
      }

      if (route === '/api/download') {
        const entry = resolveDownload(url.searchParams.get('token') ?? '');
        if (!entry || !fs.existsSync(entry.path)) {
          return json(res, 404, { error: 'lien expiré ou introuvable' });
        }
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${encodeURIComponent(entry.name)}"`,
        });
        return fs.createReadStream(entry.path).pipe(res);
      }

      if (route === '/api/transcribe' && req.method === 'POST') {
        const audio = await readBody(req, 40 * 1024 * 1024);
        const ext = (String(req.headers['x-audio-ext'] ?? 'webm') || 'webm').replace(/[^a-z0-9]/gi, '');
        const result = await transcribe(audio, ext);
        return json(res, result.ok ? 200 : 503, result);
      }

      /**
       * L'extrait d'une voix, pour l'écouter AVANT de la choisir. Le son passe
       * par une adresse ordinaire : le lecteur du navigateur sait la jouer
       * telle quelle, sans rien préparer.
       */
      if (route === '/api/voice-sample') {
        const voix = url.searchParams.get('voice') ?? undefined;
        // La vitesse d'essai est imposée ici pour l'ENTENDRE avant de la garder :
        // sans elle, on retomberait sur la vitesse déjà enregistrée.
        const vitesse = url.searchParams.get('vitesse') ?? undefined;
        const result = await speak(EXTRAIT, voix, vitesse);
        if (!result.ok || !result.file) return json(res, 503, { error: result.error });
        const stat = fs.statSync(result.file);
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': stat.size,
          'cache-control': 'no-store',
        });
        return fs.createReadStream(result.file).pipe(res);
      }

      /**
       * Une phrase courte lue à voix haute, aux moments clés (fin de tâche,
       * décision attendue). Le texte vient tout fait du navigateur ; on le
       * borne pour qu'une annonce reste brève, puis on le confie à Piper —
       * exactement comme l'extrait d'une voix, par une adresse audio ordinaire.
       */
      if (route === '/api/speak') {
        const texte = normaliserTexteVoix(url.searchParams.get('text') ?? '');
        if (!texte) return json(res, 400, { error: 'aucun texte à lire' });
        const result = await speak(texte);
        if (!result.ok || !result.file) return json(res, 503, { error: result.error });
        const stat = fs.statSync(result.file);
        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': stat.size,
          'cache-control': 'no-store',
        });
        return fs.createReadStream(result.file).pipe(res);
      }

      if (route === '/api/digest') {
        const projectId = url.searchParams.get('project') ?? undefined;
        const text = digestText(projectId);
        if (url.searchParams.get('audio')) {
          const result = await speak(text);
          if (!result.ok || !result.file) return json(res, 503, { error: result.error, text });
          const stat = fs.statSync(result.file);
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'content-length': stat.size,
            'cache-control': 'no-store',
          });
          return fs.createReadStream(result.file).pipe(res);
        }
        return json(res, 200, { text });
      }

      /* ---------------- Interface web ---------------- */

      const racineWeb = webRoot();
      if (route !== '/' && route !== '/index.html' && !route.startsWith('/api/')) {
        const candidate = path.join(racineWeb, route.replace(/^\/+/, ''));
        if (candidate.startsWith(racineWeb) && serveStatic(res, candidate)) return;
      }

      const indexFile = path.join(racineWeb, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, must-revalidate' });
        const page = fs.readFileSync(indexFile);
        // Le NOM sous l'icône d'un iPhone vient de la page, pas de la fiche
        // d'installation : côté client, titre et nom d'application disent
        // « Haiko Chat ». `/index.html` passe donc ici, jamais en fichier brut.
        return res.end(porte === 'client' ? pageAuNomDuClient(page.toString('utf8')) : page);
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<h1>Beluga Build</h1><p>Interface non construite. Lancez « npm run build ».</p>');
    } catch (err: any) {
      log.error('requête HTTP', err);
      if (!res.headersSent) json(res, 500, { error: err?.message ?? 'erreur interne' });
      else res.end();
    }
  });
}
