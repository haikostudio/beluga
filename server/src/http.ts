import http from 'node:http';
import { deposerUnFichier, fichierAServir } from './fichiers-ranges.js';
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
  lectureDePieceJointeAutorisee,
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
import { creerLePremierCompte, installationEnAttente } from './installation.js';
import { compteEstSuperAdministrateur } from './super-admin.js';
import { PARAMETRE_DU_LIEN, messageMotsDePasseDifferents, pageDInstallation } from './page-installation.js';
import { STYLE_DU_CHAMP, TEXTES_DU_CHAMP_FR, champMotDePasseHtml, scriptDuChamp } from './champ-mot-de-passe-html.js';
import {
  REPERE_DE_PORTE,
  REPERE_D_IDENTITE,
  identitePublique,
  echapperHtml,
  nomEspaceClient,
  porteDuCompte,
  porteDeLHote,
  redirectionDeLaPorte,
  routeApiAutorisee,
  ROUTE_SIGNALEMENT_DE_BLOCAGE,
  signalementDeBlocageValide,
  peutVoirProjet,
  estCollaborateur,
  REFUS_HORS_PORTEE,
  type CompteUtilisateur,
} from '@beluga/shared';
import { demandeDUneePiece, filDUnePiece } from './espace-client.js';
import { deposerArchive, examinerArchive } from './export-donnees.js';
import { cheminDePieceJointe, dossierDEcriture, dossiersDeLecture } from './pieces-jointes.js';
import { rangerUneCaptureDeLAgent } from './joindre-fichier.js';
import { racinesDesImagesDEtape } from './copies-de-cartes.js';
import { largeurDemandee, miniatureDe, vignetteSansOriginal } from './miniatures.js';
import { recevoirAuFilDeLEau } from './envoi-piece-jointe.js';
import { pipeline } from 'node:stream/promises';
import * as store from './store.js';
import { bus } from './bus.js';
import { callTool, outilServiA, toolsFor } from './tools.js';
import {
  estAssistantGlobal,
  executerPourLAssistant,
  outilServiALAssistant,
  outilsDeLAssistant,
  preparerLAppel,
} from './assistant-global.js';
import { faireNaitreLaCarte } from './naissance-de-carte.js';
import { adresseDeBeluga, recevoirEvenement, suivreLien } from './marketing.js';
import { paysDeLaRequete } from './pays-des-visites.js';
import { noterLEcran, noterUneLatence, noterUnePanne } from './usage-installation.js';
import { entetesDeSecurite, filtreDePaiementLu, mimeDuFichier, requeteEnHttps, scriptDeSuivi, validationNonBloquante } from '@beluga/shared';
import {
  FICHIERS_FICHE_OCTETS_MAX,
  PROJET_DU_COFFRE,
  ROUTE_ARCHIVE_DES_IMAGES,
  ROUTE_FICHIER_CITE,
  typeServiDUnFichierCite,
  adresseDuLot,
  refusDuFichierDuCoffre,
  type CorpsDArchive,
  type LotDArchive,
} from '@beluga/shared';
import { proposerAuCadrage } from './proposition-competences.js';
import { realisationAllumeePourLAgent } from './realisation.js';
import { cleParSecret, noterUsageDeCle } from './cles-api.js';
import { relayerCatalogueLlm, relayerDemandeLlm } from './relais-llm.js';
import {
  ajouterConsultationMemoireAuTour,
  attachToCurrentMessage,
  journaliserDansLeTour,
  jugerLAppelSousListe,
  liveRun,
} from './runtime.js';
import { readFilePreview, imageDEtape, makeZip, safeJoin } from './files.js';
import { resoudreFichierCite } from './fichiers-conserves.js';
import { transcribe, digestText } from './voice.js';
import { appareilsDuCompte, publicKey, retirerAppareilDuCompte, subscribe, unsubscribe } from './push.js';
import { pontDemarre, pontAServiLesOutils, pontAAbouti } from './pont.js';
import { attendreUneTranche, poserLAttente, refusDeQuestionSimultanee } from './attente-question.js';
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

/**
 * LA PAGE AFFICHÉE AU RETOUR D'UN RÉSEAU : le compte est relié (ou pourquoi il
 * ne l'est pas), puis l'onglet se referme seul — l'atelier, resté ouvert à
 * côté, s'est déjà mis à jour.
 */
function pageDeRetourDeConnexion(r: { ok: boolean; raison?: string; comptes?: { nom: string }[] }): string {
  const echapper = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const titre = r.ok ? 'Compte relié' : 'Connexion impossible';
  const phrase = r.ok
    ? `${(r.comptes ?? []).map((c) => echapper(c.nom)).join(', ')} : l’atelier Réseaux sociaux peut publier. Vous pouvez fermer cet onglet.`
    : echapper(r.raison ?? 'La connexion n’a pas abouti.');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:420px;padding:24px}h1{font-size:18px;color:${r.ok ? '#a78bfa' : '#f87171'}}</style></head>
<body><main data-retour-reseau="${r.ok ? 'ok' : 'echec'}"><h1>${titre}</h1><p>${phrase}</p></main>${r.ok ? '<script>setTimeout(function(){window.close()},2500)</script>' : ''}</body></html>`;
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
  /* La détection des visages (« Remplacer le visage ») : son moteur et son modèle, chargés à l'ouverture du panneau. */
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
};

/**
 * Les fichiers IMMUABLES (nom haché) compressés une fois pour toutes, gardés en
 * mémoire : le paquet de l'application se sert des milliers de fois entre deux
 * publications, il serait absurde de le recompresser à chaque ouverture. Une
 * publication change les noms, donc les clés — rien de périmé ne survit.
 */
const cacheCompresse = new Map<string, Buffer>();

/**
 * La page de l'application, renommée pour le visage client : le nom de l'espace
 * client réglé dans l'installation. Elle porte aussi le REPÈRE DE PORTE, qui
 * dit à l'interface de monter l'espace client même quand l'adresse demandée
 * n'est pas la sienne — le cas d'une installation à une seule adresse.
 */
/** La page, avec ce que l'interface doit savoir de l'installation avant de s'afficher. */
export function pageAvecLIdentite(html: string): string {
  const contenu = echapperHtml(JSON.stringify(identitePublique()));
  return html.replace(/<head>/, `<head><meta name="${REPERE_D_IDENTITE}" content="${contenu}">`);
}

export function pageAuNomDuClient(html: string, nom = nomEspaceClient()): string {
  const propre = echapperHtml(nom);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${propre}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${propre}$2`)
    .replace(/<head>/, `<head><meta name="${REPERE_DE_PORTE}" content="client">`);
}

/** La fiche d'installation du visage client, à son nom. */
function manifesteAuNomDuClient(texte: string): string {
  try {
    const fiche = JSON.parse(texte) as Record<string, unknown>;
    return JSON.stringify({ ...fiche, name: nomEspaceClient(), short_name: nomEspaceClient() });
  } catch {
    return texte;
  }
}

/**
 * LA COMMANDE QUI DONNE UN LIEN D'INSTALLATION NEUF, telle qu'on la tape sur le
 * serveur. Elle nomme le dossier RÉEL de l'installation : un chemin d'exemple
 * ne marcherait chez personne.
 */
function commandeDuCode(): string {
  return `node ${path.join(CONFIG.selfPath, 'scripts', 'code-installation.mjs')} --lien`;
}

/**
 * LES ENTÊTES DE LA PAGE D'INSTALLATION. Elle peut porter le code venu du lien :
 * elle ne se garde donc nulle part, et l'adresse d'où l'on vient ne suit
 * personne vers un autre site.
 */
const ENTETES_DE_LA_PAGE_D_INSTALLATION = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
} as const;

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

/**
 * Le mot de passe des deux pages de connexion : l'œil seul — on y SAISIT un mot
 * de passe existant, un générateur n'y aurait aucun sens.
 */
const CHAMP_DE_CONNEXION = champMotDePasseHtml({
  id: 'p',
  attributs: 'name="password" autocomplete="current-password" required',
  textes: TEXTES_DU_CHAMP_FR,
});

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
${STYLE_DU_CHAMP}</style>
</head>
<body>
<form method="POST" action="/auth/login">
  <h1>Beluga Build</h1>
  <p class="sub">Pilotage de projets par agents.</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div><label for="u">Identifiant</label><input id="u" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required autofocus></div>
  <div><label for="p">Mot de passe</label>${CHAMP_DE_CONNEXION}</div>
  <button type="submit">Entrer</button>
</form>
${scriptDuChamp(TEXTES_DU_CHAMP_FR)}
</body>
</html>`;

/**
 * LA PORTE DES CLIENTS. Une page à part, servie sur l'adresse de l'espace client :
 * elle ne nomme jamais l'application d'administration, ne parle ni d'agents ni
 * de projets, et ne dit rien de plus qu'un formulaire. Le fond et les couleurs
 * suivent la marque, sans dépendre de l'interface construite : cette page doit
 * s'afficher même quand `web/dist` n'existe pas encore.
 */
const PAGE_ENTREE_CLIENT = (error?: string, nom = echapperHtml(nomEspaceClient())) => `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>${nom}</title>
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
${STYLE_DU_CHAMP}</style>
</head>
<body>
<form method="POST" action="/auth/login" data-porte="client">
  <h1>${nom}</h1>
  <p class="sub">Vos demandes, vos échanges.</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div><label for="u">Identifiant</label><input id="u" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required autofocus></div>
  <div><label for="p">Mot de passe</label>${CHAMP_DE_CONNEXION}</div>
  <button type="submit">Entrer</button>
</form>
${scriptDuChamp(TEXTES_DU_CHAMP_FR)}
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
    // LES ENTÊTES DE SÉCURITÉ, par défaut sur TOUTE réponse (`shared/src/entetes-de-securite.ts`) : une réponse qui
    // pose le sien dans `writeHead` (plaquette client, page d'installation) le garde.
    const chiffree = Boolean((req.socket as { encrypted?: boolean }).encrypted);
    for (const [nom, valeur] of Object.entries(entetesDeSecurite(requeteEnHttps(req.headers['x-forwarded-proto'], chiffree)))) {
      res.setHeader(nom, valeur);
    }

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

      /*
       * LA GARDE DES VERSIONS DE TRAVAIL (`server/src/garde-acces.ts`, carte « Accès des IA : prod ou dev »,
       * 23/11/2026). `verifier` est interrogé par Caddy pour chaque requête d'un site protégé ; `connexion` est la
       * page de connexion de l'aller-retour. Avant tout mur : un visiteur non connecté doit pouvoir y arriver.
       */
      if (route === '/auth/garde/verifier') {
        const { repondreALaVerification } = await import('./garde-acces.js');
        return repondreALaVerification(req, res);
      }
      if (route === '/auth/garde/connexion' && (req.method === 'GET' || req.method === 'POST')) {
        const { repondreALaConnexion } = await import('./garde-acces.js');
        return await repondreALaConnexion(req, res, {
          lireCorps: async () => (await readBody(req, 64 * 1024)).toString('utf8'),
          ip: clientIp(req),
          champMotDePasse: CHAMP_DE_CONNEXION,
          styleDuChamp: STYLE_DU_CHAMP,
          scriptDuChamp: scriptDuChamp(TEXTES_DU_CHAMP_FR),
        });
      }

      /*
       * LE PREMIER COMPTE D'UNE INSTALLATION NEUVE. La porte n'existe que tant
       * qu'aucun administrateur n'existe, et elle est gardée par le code
       * d'installation (`server/src/installation.ts`). Le compte créé, la
       * session s'ouvre dans la foulée : on ne redemande pas le mot de passe
       * qu'on vient de choisir.
       */
      if (route === '/auth/installation' && req.method === 'POST') {
        const body = (await readBody(req, 64 * 1024)).toString('utf8');
        const isJson = (req.headers['content-type'] ?? '').includes('json');
        const payload = isJson ? JSON.parse(body || '{}') : Object.fromEntries(new URLSearchParams(body));
        const langues = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : undefined;
        const identifiant = String(payload.username ?? '');
        const nomAffiche = String(payload.nomAffiche ?? '');
        const motDePasse = String(payload.password ?? '');
        // Un refus qui ne vient PAS du code (mot de passe trop court, identifiant
        // refusé) garde le code venu du lien : sinon la personne devrait
        // retourner le chercher pour une faute qui n'a rien à voir avec lui.
        const refuser = (message: string, code = 400, garderLeCode = false) => {
          if (isJson) return json(res, code, { ok: false, error: message });
          res.writeHead(code, ENTETES_DE_LA_PAGE_D_INSTALLATION);
          return res.end(
            pageDInstallation({
              acceptLanguage: langues,
              erreur: message,
              commande: commandeDuCode(),
              saisie: { nomAffiche, identifiant },
              codeDuLien: garderLeCode ? String(payload.code ?? '') : undefined,
            }),
          );
        };
        if (!installationEnAttente()) {
          if (isJson) return json(res, 403, { ok: false, error: 'installation déjà faite' });
          res.writeHead(302, { location: '/' });
          return res.end();
        }
        if (!isJson && motDePasse !== String(payload.password2 ?? '')) return refuser(messageMotsDePasseDifferents(langues), 400, true);
        const cree = creerLePremierCompte({ code: String(payload.code ?? ''), nomAffiche, identifiant, motDePasse }, clientIp(req));
        if (!cree.ok) return refuser(cree.message, cree.raison === 'trop-d-essais' ? 429 : 400, cree.raison === 'compte');
        const session = login(cree.identifiant, motDePasse, clientIp(req));
        if (!session.ok) return refuser(session.error ?? 'connexion impossible');
        const cookie = `${COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.sessionDays * 86400}`;
        if (isJson) {
          res.writeHead(200, { 'set-cookie': cookie, 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
        res.writeHead(302, { 'set-cookie': cookie, location: '/' });
        return res.end();
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
        const ip = clientIp(req);
        // Le pays se déduit ici, puis l'adresse est oubliée (`pays-des-visites.ts`).
        const recu = recevoirEvenement({ corps, origine, ip, userAgent: String(req.headers['user-agent'] ?? ''), pays: paysDeLaRequete(ip, req.headers['cf-ipcountry']) });
        /* LA PREMIÈRE PAGE VUE APPREND SON MODE AU SCRIPT (« a » anonyme, « v »
           visiteur : bandeau d'accord) — l'extrait posé sur le site ne change
           jamais d'un mode à l'autre. */
        if (recu.ok && recu.mode) {
          res.writeHead(200, { ...entetes, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(JSON.stringify(recu.mode));
        }
        res.writeHead(recu.ok ? 204 : recu.statut, entetes);
        return res.end();
      }
      /*
       * LA PLAQUETTE CLIENT, SUR SON LIEN PRIVÉ (`server/src/plaquettes.ts`). Publique par nature : le client l'ouvre
       * sans compte. Le jeton ne mène qu'à SA plaquette et aux images qu'elle cite ; un lien coupé répond 410. Une
       * session Beluga présente fait de la visite celle de l'auteur : elle ne se compte pas.
       */
      if (route.startsWith('/plaquette/')) {
        const { servirLaPlaquette } = await import('./plaquettes.js');
        const session = identiteDeLaRequete(req);
        const servie = await servirLaPlaquette(req, res, route, {
          auteur: !!session,
          compte: session ? { id: session.id, nomAffiche: session.nomAffiche || session.identifiant, admin: session.role === 'admin' } : null,
          ip: clientIp(req),
          lireCorps: (max) => readBody(req, max),
        });
        if (servie) return;
      }

      /*
       * LE RELAIS DES INSTALLATIONS (`server/src/relais-installations.ts`) : les
       * copies de Beluga Build s'y signalent et y déposent leurs tickets. Public
       * par nature, mais OUVERT SEULEMENT sur la machine qui reçoit — partout
       * ailleurs, ces adresses n'existent pas. L'adresse de l'appelant ne sert
       * qu'au plafond d'appels et au pays, puis elle est oubliée.
       */
      if (route.startsWith('/relais/')) {
        const relais = await import('./relais-installations.js');
        if (!relais.relaisRecepteurIci()) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          return res.end('Introuvable.');
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' });
          return res.end();
        }
        let corps = '';
        try {
          corps = (await readBody(req, 16384)).toString('utf8');
        } catch {
          return json(res, 413, { erreur: 'Trop long.' });
        }
        const ip = clientIp(req);
        const contexte = { ip, userAgent: String(req.headers['user-agent'] ?? ''), pays: paysDeLaRequete(ip, req.headers['cf-ipcountry']) };
        const rendu =
          route === '/relais/signe-de-vie'
            ? relais.recevoirUnSigneDeVie(corps, contexte)
            : route === '/relais/ticket'
              ? relais.recevoirUnTicket(corps, contexte)
              : route === '/relais/reponses'
                ? relais.rendreLesReponses(corps, contexte)
                : { statut: 404, corps: { erreur: 'Introuvable.' } };
        return json(res, rendu.statut, rendu.corps);
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

      /*
       * LA PUBLICATION OFFICIELLE SUR LES RÉSEAUX (`server/src/publication-sociale.ts`).
       *  - `/m/oauth/retour` : le réseau y renvoie l'utilisateur après son
       *    accord. Public par nature (le réseau ne porte pas la session) : seul
       *    un ÉTAT tiré par Beluga quelques minutes plus tôt est accepté, et la
       *    page ne montre que le résultat ;
       *  - `/m/media/<pièce>/<échéance>/<signature>` : le visuel d'un contenu,
       *    que certains réseaux viennent chercher eux-mêmes. Signé, temporaire,
       *    un seul fichier par adresse.
       */
      if (route === '/m/oauth/retour') {
        const { terminerConnexion } = await import('./publication-sociale.js');
        const r = await terminerConnexion(url.searchParams);
        res.writeHead(r.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(pageDeRetourDeConnexion(r));
      }
      if (route.startsWith('/m/media/')) {
        const { mediaDeLAdressePublique } = await import('./publication-sociale.js');
        const media = mediaDeLAdressePublique(route);
        if (!media) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          return res.end('Visuel introuvable ou lien échu.');
        }
        res.writeHead(200, { 'content-type': media.mime, 'content-length': String(media.taille), 'cache-control': 'private, max-age=3600' });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(media.chemin).pipe(res);
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
         * (`server/src/juge-des-cartes.ts`). Sans clé Jev au coffre : rien.
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
        /*
         * …OU DE LA CONVERSATION VOCALE EN DIRECT de l'assistant (`server/src/voix-directe.ts`) : elle n'est pas un
         * tour du démon, mais elle porte son propre identifiant de tour, reconnu tant que la session est ouverte.
         */
        const tourAnnonce = String(req.headers['x-beluga-tour'] ?? '') || undefined;
        const { tourVocalDe, messageDeLaSessionVocale } = await import('./voix-directe.js');
        const tourVocal = tourVocalDe(agentId, tourAnnonce);
        const recevable = appelDuPontRecevable({
          tourAnnonce,
          tourEnCours: tourVocal && tourAnnonce === tourVocal ? tourVocal : liveRun(agentId)?.tourId,
        });
        /*
         * JARVIS A PARTOUT LES OUTILS DE L'ASSISTANT (17/11/2026) : un appel venu de la conversation vocale reçoit la
         * boîte de l'assistant global (créer puis valider une carte, lire les projets, agir à l'écran), même quand la
         * voix est branchée sur l'agent d'une carte.
         */
        const pourLaVoix = !!tourVocal && tourAnnonce === tourVocal;
        const commeLAssistant = estAssistantGlobal(agent) || pourLaVoix;
        // Le message vocal ne se crée qu'à la PREMIÈRE production de la voix (carte proposée, pièce jointe).
        const messageVocal = () => (pourLaVoix ? messageDeLaSessionVocale(agentId, tourVocal) : undefined);
        if (!recevable.ok) {
          // Un envoi refusé « tour terminé » est un envoi ARRIVÉ TROP TARD : on
          // le dit, pour ne plus lire « plan jamais venu » là où il a été rejeté.
          const tardif = recevable.raison === TOUR_TERMINE ? ` — envoi arrivé après la fermeture du tour (route ${route})` : '';
          log.warn(`appel d'outil refusé (agent ${agentId})${tardif} : ${recevable.raison}`);
          if (route === '/internal/call') {
            // UN REFUS PENDANT LA VOIX SE VOIT : une ligne d'activité en échec, et Jarvis le dit (consigne de la voix).
            if (tourAnnonce?.startsWith('voix-')) {
              bus.emit({ type: 'voix.direct.activite', id: `refus-${Date.now()}`, libelle: 'Mes outils m’ont été refusés', etat: 'echec' });
            }
            return json(res, 200, { ok: false, text: recevable.raison });
          }
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
          // L'ASSISTANT GLOBAL : les outils d'un agent ordinaire, plus les siens (`assistant-global.ts`).
          const tools = commeLAssistant
            ? outilsDeLAssistant(agentId, { realisation: realisationAllumeePourLAgent(agentId), voix: pourLaVoix })
            : toolsFor(agent.role, { realisation: realisationAllumeePourLAgent(agentId) }).filter((tool) =>
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
          let corps: { outil?: unknown; chemin?: unknown } = {};
          try {
            corps = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
          } catch {
            corps = {};
          }
          const outil = typeof corps?.outil === 'string' ? corps.outil : '';
          const chemin = typeof corps?.chemin === 'string' ? corps.chemin : '';
          let analyseFaite = true;
          /*
           * LA PIÈCE JOINTE DÉPOSÉE SE LIT D'EMBLÉE : c'est la demande de
           * l'utilisateur, pas le projet. Le chemin est RÉSOLU (liens suivis)
           * avant d'être comparé aux dossiers de pièces jointes, eux aussi résolus.
           */
          const resoudre = (p: string): string => {
            try {
              return fs.realpathSync(p);
            } catch {
              return p;
            }
          };
          const pieceJointe =
            agent.role === 'cadrage' &&
            !!chemin &&
            lectureDePieceJointeAutorisee({
              outil,
              chemin: resoudre(chemin),
              dossiers: [PATHS.attachments, PATHS.attachmentsStockage, ...dossiersDeLecture()]
                .filter((d): d is string => typeof d === 'string' && d.length > 0)
                .map(resoudre),
            });
          // Un outil de préparation (ToolSearch) n'est jamais retenu, même par un vieux réglage.
          if (!pieceJointe && agent.role === 'cadrage' && (!outil || outilVerrouilleAvantAnalyse(outil))) {
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
        /*
         * LA LISTE OBLIGATOIRE, DEMANDÉE À L'APPEL. Le script posé devant les
         * commandes et les modifications d'un agent de tâche
         * (`server/verrou-liste.mjs`) demande ici si l'action peut partir.
         */
        if (route === '/internal/liste') {
          let corps: { outil?: unknown; sousAgent?: unknown } = {};
          try {
            corps = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
          } catch {
            corps = {};
          }
          const jugement = jugerLAppelSousListe(agentId, {
            outil: typeof corps?.outil === 'string' ? corps.outil : '',
            sousAgent: corps?.sousAgent === true,
          });
          return json(res, 200, jugement);
        }
        if (route === '/internal/call') {
          const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}');
          const assistant = commeLAssistant;
          const allowed = assistant
            ? outilServiALAssistant(String(body.name), agentId, {
                realisation: realisationAllumeePourLAgent(agentId),
                voix: pourLaVoix,
              })
            : toolsFor(agent.role, { realisation: realisationAllumeePourLAgent(agentId) }).some(
                (tool) => tool.name === body.name && outilServiA(tool.name, agentId),
              );
          if (!allowed) {
            return json(res, 200, {
              ok: false,
              text: `Refusé : l'outil « ${body.name} » n'est pas autorisé pour ce rôle.`,
            });
          }
          /*
           * UNE SEULE QUESTION À LA FOIS. Une seconde question émise pendant que
           * la première attend est rédigée SANS connaître la réponse : elle peut
           * être devenue sans objet (« si vous gardez… » après « on supprime »).
           * Le refus est un résultat d'outil lisible, jamais une exception : le
           * tour continue, l'agent reposera la suivante après la réponse.
           */
          const refusDeQuestion = refusDeQuestionSimultanee(agentId, String(body.name));
          if (refusDeQuestion) return json(res, 200, { ok: false, text: refusDeQuestion });
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
          const contexteDeLAppel = {
            agentId,
            projectId: agent.projectId,
            role: agent.role,
            cardId: agent.cardId,
            // Les réglages visibles dans la barre d'écriture au moment du
            // clic : une carte proposée en hérite.
            run: { engine: agent.run.engine, model: agent.run.model, thinking: agent.run.thinking },
            ...(pourLaVoix ? { voix: true } : {}),
          };
          /*
           * L'ASSISTANT GLOBAL N'A PLUS DE PORTE D'ACCORD (décision du
           * 29/10/2026) : ses appels partent directement, comme ceux de tout
           * agent — c'est lui qui confirme l'irréversible par `ask_user`. Ses
           * outils propres et ses gestes d'écran passent par
           * `executerPourLAssistant`.
           */
          /* LES DROITS SUIVENT L'INTERLOCUTEUR : un accès tiers n'obtient rien, par l'agent, qu'il ne verrait pas à l'écran (`services-des-agents.ts`). */
          const { refusParLesDroits } = await import('./services-des-agents.js');
          let result: Awaited<ReturnType<typeof callTool>>;
          if (assistant) {
            const prepare = preparerLAppel(String(body.name), body.args ?? {});
            if (!prepare.ok) return json(res, 200, { ok: false, text: prepare.text });
            const refusDroits = await refusParLesDroits(contexteDeLAppel, String(body.name), prepare.args, prepare.projectId);
            if (refusDroits) return json(res, 200, { ok: false, text: refusDroits });
            const executer = () => executerPourLAssistant(contexteDeLAppel, String(body.name), prepare.args, prepare.projectId);
            result = await executer();
          } else {
            const refusDroits = await refusParLesDroits(contexteDeLAppel, String(body.name), body.args ?? {});
            if (refusDroits) return json(res, 200, { ok: false, text: refusDroits });
            result = await callTool(contexteDeLAppel, body.name, body.args ?? {});
          }
          // CHAQUE OUTIL DE JARVIS LAISSE SA LIGNE AU JOURNAL DU SERVICE (23/11/2026).
          if (pourLaVoix) {
            const { tracerLOutilDeLaVoix } = await import('./voix-directe.js');
            tracerLOutilDeLaVoix(agentId, String(body.name), body.args ?? {}, result);
          }
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
            attachToCurrentMessage(agentId, { proposal: result.proposal }, messageVocal());
          }
          // CE QUE JARVIS PRODUIT À LA VOIX (image, document, fichier) ENTRE DANS LE FIL, sous « Jarvis · conversation vocale ».
          if (result.download) attachToCurrentMessage(agentId, { download: result.download }, messageVocal());
          if (result.attachment) attachToCurrentMessage(agentId, { attachment: result.attachment.id }, messageVocal());
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
          /*
           * BELUGA PROPOSE LES COMPÉTENCES, PAS L'AGENT. La recherche de
           * mémoire qu'un cadrage fait à chaque tour est le point d'entrée : le
           * démon y cherche les compétences qui parlent de la demande, les
           * RETIENT d'office sur la carte (trois au plus), pose une ligne
           * violette par fiche, et rend la recherche AUSSITÔT avec la liste —
           * plus aucune attente : une croix les écarte avant le lancement.
           */
          if (body.name === 'memoire' && body.args?.geste === 'chercher' && result.ok && agent.role === 'cadrage') {
            const retenues = await proposerAuCadrage({
              agent: { id: agentId, role: agent.role, cardId: agent.cardId, projectId: agent.projectId },
              tour: liveRun(agentId),
              mots: [body.args?.demande, body.args?.contexte].filter((v) => typeof v === 'string').join('\n'),
              texteMemoire: result.text,
            }).catch((err) => {
              log.warn('compétences à proposer : abandon', err);
              return null;
            });
            if (retenues) {
              for (const question of retenues.questions) attachToCurrentMessage(agentId, { question });
              return json(res, 200, { ok: true, text: retenues.texte });
            }
          }
          /* UNE VALIDATION DE GÉNÉRATION N'ARRÊTE PAS LE MOTEUR (27/10/2026) : son
             bouton à prix se tranche au clic, côté démon (`trancherLeLotDuClic`).
             L'agent en pose une par plan dans le même tour ; aucune attente. */
          if (result.question && validationNonBloquante(result.question)) {
            attachToCurrentMessage(agentId, { question: result.question });
            return json(res, 200, { ok: result.ok, text: result.text });
          }
          if (result.question) {
            /* Deux appels simultanés passent tous deux le contrôle d'entrée : on
               tranche ici, au moment même de poser l'attente, sans rien d'asynchrone. */
            const secondeQuestion = refusDeQuestionSimultanee(agentId, String(body.name));
            if (secondeQuestion) return json(res, 200, { ok: false, text: secondeQuestion });
            /*
             * L'ATTENTE EST POSÉE AVANT LA QUESTION, pas après. Attacher la
             * question au message DIFFUSE aussitôt l'événement que les écrans
             * écoutent (le tiroir de procédure, par exemple, y recalcule son
             * témoin) : posée ensuite, l'attente arrivait trop tard et ces
             * écrans concluaient que l'agent travaillait encore, chronomètre
             * qui défile, devant la question qu'ils venaient d'afficher.
             */
            poserLAttente(result.question.id, agentId, Date.now(), result.suite);
            attachToCurrentMessage(agentId, { question: result.question });
            /* LE MODE AUTO DE LA CARTE RÉPOND AUSSITÔT, par le même chemin qu'un clic (`mode-auto.ts`). */
            if (agent.cardId && store.getCard(agent.cardId)?.parcours?.lancementAutomatique) {
              const questionId = result.question.id;
              void import('./mode-auto.js').then(({ planifierLaReponseAuto }) => planifierLaReponseAuto(agentId, questionId));
            }
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
      // Les images des COURRIELS aussi (pictogrammes et logo de `/courriel/`) :
      // c'est la messagerie du destinataire qui les télécharge, sans session.
      // Faute de cette ligne, l'adresse rendait la page de l'application
      // (200 en text/html) et chaque pictogramme s'affichait cassé.
      //
      // DEUX FICHES D'INSTALLATION, UNE PAR VISAGE. Sur l'adresse de l'espace
      // client, `/manifest.json` rend `manifest-client.json` — au nom de l'espace client,
      // la baleine — ; l'administration garde « Beluga Build ». Même adresse de
      // fichier des deux côtés : `index.html` et le cache du service worker
      // (par origine) n'ont rien à savoir.
      if (
        ['/manifest.json', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(route) ||
        /^\/notif\/[a-z-]+\.png$/.test(route) ||
        /^\/courriel\/[a-z0-9-]+\.png$/.test(route)
      ) {
        const racine = webRoot();
        const fichier =
          route === '/manifest.json' &&
          porteDuCompte(porteDeLHote(req.headers.host), identiteDeLaRequete(req)?.role ?? null) === 'client'
            ? '/manifest-client.json'
            : route;
        const publicFile = path.join(racine, fichier.replace(/^\/+/, ''));
        // La fiche d'installation du visage client porte le nom RÉGLÉ : elle se
        // rend donc à la demande, jamais telle qu'écrite dans le dépôt.
        if (fichier === '/manifest-client.json' && publicFile.startsWith(racine) && fs.existsSync(publicFile)) {
          res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' });
          return res.end(manifesteAuNomDuClient(fs.readFileSync(publicFile, 'utf8')));
        }
        if (publicFile.startsWith(racine) && serveStatic(res, publicFile)) return;
      }

      /*
       * LE CADRE D'APERÇU DU STUDIO A UNE ORIGINE OPAQUE (`sandbox` sans
       * `allow-same-origin`) : il n'envoie pas le témoin de session. Ses trois
       * sortes de fichiers passent donc AVANT le mur :
       *  - GSAP et les polices embarquées, publics par nature (bibliothèque et
       *    polices libres), avec l'entête CORS que réclament les polices ;
       *  - les médias, par une adresse SIGNÉE de courte durée, limitée à une
       *    création et à un média de son projet (`mediaDeLAdresseSignee`).
       */
      /*
       * LA LIAISON D'UN CHROME (`server/src/extension-chrome.ts`) : AVANT le mur, puisque l'extension n'a pas de
       * session. Le code à usage unique (émis AVEC session dans Réglages → Extension) est sa seule clé d'entrée,
       * et les essais sont plafonnés par adresse.
       */
      if (route === '/api/extension-chrome/relier' && req.method === 'POST') {
        const { relierUnChrome } = await import('./extension-chrome.js');
        let demande: Record<string, unknown> = {};
        try {
          demande = JSON.parse((await readBody(req, 4096)).toString() || '{}');
        } catch {
          return json(res, 400, { ok: false, raison: 'Demande illisible.' });
        }
        const r = relierUnChrome(demande, clientIp(req));
        return json(res, r.ok ? 200 : 400, r);
      }
      /* L'extension signale un code de `liaison.json` refusé (carte « Liaison Chrome automatique et suivie ») : avant le
         mur, comme `/relier`, borné par adresse ; seul un code encore connu est retenu. */
      if (route === '/api/extension-chrome/cle' && req.method === 'POST') {
        const { laCleVautEncore } = await import('./extension-chrome.js');
        let demande: Record<string, unknown> = {};
        try {
          demande = JSON.parse((await readBody(req, 2048)).toString() || '{}');
        } catch {
          return json(res, 400, { ok: false });
        }
        const r = laCleVautEncore(demande);
        return r ? json(res, 200, { ok: true, ...r }) : json(res, 400, { ok: false });
      }
      if (route === '/api/extension-chrome/echec' && req.method === 'POST') {
        const { signalerUnEchecDeLiaison } = await import('./extension-chrome.js');
        let demande: Record<string, unknown> = {};
        try {
          demande = JSON.parse((await readBody(req, 2048)).toString() || '{}');
        } catch {
          return json(res, 400, { ok: false });
        }
        return json(res, 200, { ok: signalerUnEchecDeLiaison(demande, clientIp(req)) });
      }

      /*
       * LE RELAIS DU MAC (`server/src/relais-mac.ts`, 13/11/2026) : AVANT le mur, comme l'extension Chrome — le relais
       * n'a pas de session. Le code à usage unique le relie ; ensuite chaque demande est signée par sa clé d'appareil.
       */
      /*
       * BELUGA CONNECT (carte « Liaison de l'extension Chrome simplifiée », 20/11/2026) : l'application Mac signée et
       * notarisée, téléchargée par le bouton « Installer sur ce Mac » de l'assistant, AVANT le mur (le Mac n'a pas de
       * session ; l'archive ne contient aucun secret) ; `version` sert à sa mise à jour d'elle-même.
       */
      /*
       * BELUGA CONNECT POUR WINDOWS ET LINUX (carte « Beluga Connect : installation simplifiée », 21/11/2026) : même
       * porte publique. Avec `?code=` (six chiffres, émis par le parcours « Connecter cet ordinateur »), le fichier
       * servi porte en REMORQUE l'adresse de ce Beluga et ce code : l'application se relie seule au premier lancement.
       * Sous Linux, `installer-linux.sh` choisit l'architecture, pose le fichier et le lance (une commande à coller).
       */
      if (route.startsWith('/api/connect/')) {
        const { paquetDeConnect, paquetDeLaRoute } = await import('./relais-mac.js');
        const { baseValable, octetsDeRemorque, systemeValable } = await import('@beluga/shared');
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        /* L'adresse écrite dans la remorque : celle que la page a sous les yeux (`base`), si elle vise bien CET hôte ;
           sinon celle que disent les en-têtes du relais d'entrée. */
        const baseDeLaPage = baseValable(q.get('base'));
        const base =
          baseDeLaPage && new URL(baseDeLaPage).host === req.headers.host
            ? baseDeLaPage
            : `${req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https'}://${req.headers.host ?? ''}`;
        const code = /^\d{6}$/.test(q.get('code') ?? '') ? q.get('code')! : null;
        if (route === '/api/connect/version') {
          const systeme = systemeValable(q.get('systeme')) ?? 'mac';
          const cle = systeme === 'windows' ? 'windows' : systeme === 'linux' ? (q.get('arch') === 'arm64' ? 'linux-arm64' : 'linux-amd64') : 'mac';
          const a = paquetDeConnect(cle);
          if (!a) return json(res, 404, { ok: false, raison: 'Beluga Connect n’est pas encore fabriqué pour ce système sur ce Beluga.' });
          return json(res, 200, { version: a.version, empreinte: a.empreinte, chemin: a.route });
        }
        if (route === '/api/connect/installer-linux.sh') {
          if (!code || !/^https?:\/\/[A-Za-z0-9.:\[\]-]+$/.test(base)) return json(res, 400, { ok: false, raison: 'Code de liaison absent : relancez « Connecter cet ordinateur ».' });
          const script = [
            '#!/bin/sh',
            '# Beluga Connect pour Linux : pose l’application dans ~/.local/share/beluga, puis la lance (elle se relie seule).',
            'set -e',
            'case "$(uname -m)" in x86_64|amd64) A=amd64 ;; aarch64|arm64) A=arm64 ;; *) echo "Beluga Connect : architecture $(uname -m) non prise en charge." >&2; exit 1 ;; esac',
            'D="${XDG_DATA_HOME:-$HOME/.local/share}/beluga"',
            'mkdir -p "$D"',
            `curl -fsSL "${base}/api/connect/beluga-connect-linux-$A?code=${code}&base=${encodeURIComponent(base)}" -o "$D/beluga-connect.telecharge"`,
            'chmod +x "$D/beluga-connect.telecharge"',
            'exec "$D/beluga-connect.telecharge" --installer',
            '',
          ].join('\n');
          res.writeHead(200, { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(script);
        }
        const cle = paquetDeLaRoute(route);
        if (cle) {
          const a = paquetDeConnect(cle);
          /* L'image disque pas encore fabriquée sur ce Beluga : l'archive d'avant, sous la même adresse de départ. */
          if (!a && cle === 'mac-dmg' && paquetDeConnect('mac')) {
            res.writeHead(302, { location: `/api/connect/Beluga-Connect.zip${code ? `?code=${code}` : ''}`, 'cache-control': 'no-store' });
            return res.end();
          }
          if (!a) return json(res, 404, { ok: false, raison: 'Beluga Connect n’est pas encore fabriqué pour ce système sur ce Beluga.' });
          /* L'archive et l'image signées du Mac ne se touchent jamais : la remorque ne vaut que pour Windows et Linux. Sur
             Mac, le code voyage dans l'ADRESSE (`?code=`), que macOS garde dans la quarantaine du fichier téléchargé et que
             Beluga Connect relit au premier lancement pour se relier seul (carte « Liaison d'ordinateur simplifiée »). */
          let corps: Buffer = a.octets;
          if (code && cle !== 'mac' && cle !== 'mac-dmg') {
            try {
              corps = Buffer.concat([a.octets, Buffer.from(octetsDeRemorque({ base, code }))]);
            } catch {
              /* adresse illisible : le fichier part sans remorque, la liaison passera par le lien */
            }
          }
          res.writeHead(200, {
            'content-type': a.type,
            'content-length': corps.length,
            'content-disposition': `attachment; filename="${cle === 'mac' ? 'Beluga-Connect.zip' : cle === 'mac-dmg' ? 'Beluga-Connect.dmg' : cle === 'windows' ? 'Beluga-Connect.exe' : 'beluga-connect'}"`,
            'cache-control': 'no-store',
          });
          return res.end(corps);
        }
        return json(res, 404, { ok: false, raison: 'Paquet de Beluga Connect inconnu.' });
      }

      if (route.startsWith('/api/relais-mac/')) {
        const relaisMac = await import('./relais-mac.js');
        if (route === '/api/relais-mac/relier' && req.method === 'POST') {
          let demande: Record<string, unknown> = {};
          try {
            demande = JSON.parse((await readBody(req, 4096)).toString() || '{}');
          } catch {
            return json(res, 400, { ok: false, raison: 'Demande illisible.' });
          }
          const r = relaisMac.relierUnMac(demande, clientIp(req));
          return json(res, r.ok ? 200 : 400, r);
        }
        /* BELUGA CONNECT 1.7 S'ANNONCE (26/11/2026) : sans session, avec le code de son téléchargement — rien n'est relié,
           les réglages du compte se rouvrent sur le code à taper dans l'application. */
        if (route === '/api/relais-mac/annonce' && req.method === 'POST') {
          let demande: Record<string, unknown> = {};
          try {
            demande = JSON.parse((await readBody(req, 4096)).toString() || '{}');
          } catch {
            return json(res, 400, { ok: false, raison: 'Demande illisible.' });
          }
          const r = relaisMac.annoncerConnect(demande, clientIp(req));
          return json(res, r.ok ? 200 : 429, r);
        }
        /* « RELIER CE MAC ? » (21/11/2026) : l'application demande une liaison SANS session, puis attend qu'on l'accepte
           dans Beluga. La clé de retrait voyage dans le CORPS, jamais dans l'adresse. */
        if (route === '/api/relais-mac/demande-de-liaison' && req.method === 'POST') {
          let demande: Record<string, unknown> = {};
          try {
            demande = JSON.parse((await readBody(req, 4096)).toString() || '{}');
          } catch {
            return json(res, 400, { ok: false, raison: 'Demande illisible.' });
          }
          const r = relaisMac.demanderUneLiaison(demande, clientIp(req));
          return json(res, r.ok ? 200 : 429, r);
        }
        if (route === '/api/relais-mac/demande-de-liaison/attendre' && req.method === 'POST') {
          let demande: Record<string, unknown> = {};
          try {
            demande = JSON.parse((await readBody(req, 4096)).toString() || '{}');
          } catch {
            return json(res, 400, { ok: false, raison: 'Demande illisible.' });
          }
          return json(res, 200, await relaisMac.attendreLaLiaison(String(demande.retrait ?? '')));
        }
        if (route === '/api/relais-mac/installer.sh' && req.method === 'GET') {
          const script = relaisMac.installateurDuRelais(`${req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https'}://${req.headers.host ?? ''}`);
          if (!script) return json(res, 404, { error: 'installateur introuvable' });
          res.writeHead(200, { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(script);
        }
        if (route === '/api/relais-mac/lanceur.js' && req.method === 'GET') {
          const script = relaisMac.lanceurDuRelais();
          if (!script) return json(res, 404, { error: 'lanceur introuvable' });
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(script);
        }
        if (route === '/api/relais-mac/relais.js' && req.method === 'GET') {
          const script = relaisMac.scriptDuRelais();
          if (!script) return json(res, 404, { error: 'relais introuvable' });
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(script);
        }
        const entete = (nom: string) => {
          const v = req.headers[nom];
          return Array.isArray(v) ? v[0] : (v ?? null);
        };
        const corps = req.method === 'POST' ? (await readBody(req, 12 * 1024 * 1024)).toString() : '';
        const voie = relaisMac.verifierLeRelais({ id: entete('x-relais-id'), ts: entete('x-relais-ts'), sig: entete('x-relais-sig') }, corps);
        if (!voie) return json(res, 401, { ok: false, raison: 'Relais non reconnu : reliez-le de nouveau depuis Réglages → Extension.' });
        if (route === '/api/relais-mac/attendre' && req.method === 'GET') {
          const q = new URL(req.url ?? '/', 'http://x').searchParams;
          const commande = await relaisMac.attendreUnGeste(voie.appareilId, {
            /* Beluga Connect Windows / Linux (21/11/2026) : son système et son architecture. */
            systeme: q.get('systeme') === 'windows' || q.get('systeme') === 'linux' ? (q.get('systeme') as 'windows' | 'linux') : undefined,
            arch: /^[a-z0-9]{2,12}$/.test(q.get('arch') ?? '') ? q.get('arch')! : undefined,
            recopie: q.has('recopie') ? q.get('recopie') === '1' : undefined,
            verrouille: q.has('verrouille') ? q.get('verrouille') === '1' : undefined,
            /* Autorisations de macOS (« Beluga Relais ») : 1, 0, vide = inconnue ; absentes = relais d'avant. */
            accessibilite: q.has('acces') ? (q.get('acces') === '1' ? true : q.get('acces') === '0' ? false : null) : undefined,
            ecran: q.has('ecran') ? (q.get('ecran') === '1' ? true : q.get('ecran') === '0' ? false : null) : undefined,
            /* 20/11/2026 : version du relais et lanceur fixe (absents : relais d'avant, version 1). */
            version: q.has('v') ? Number(q.get('v')) || 1 : undefined,
            lanceur: q.get('lanceur') === '1',
            /* Beluga Connect (20/11/2026) : sa version ; absente pour l'ancien « Beluga Relais ». */
            connect: /^\d+(\.\d+){1,3}$/.test(q.get('connect') ?? '') ? q.get('connect')! : undefined,
          });
          return json(res, 200, commande ? { commande } : {});
        }
        /* Le paquet de l'extension, préparé par le démon pour UNE mise à jour (jeton à usage court), signé comme le reste. */
        if (route === '/api/relais-mac/extension.zip' && req.method === 'GET') {
          const { paquetPreparePour } = await import('./mise-a-jour-extension.js');
          const jeton = new URL(req.url ?? '/', 'http://x').searchParams.get('jeton') ?? '';
          const zip = paquetPreparePour(voie.appareilId, jeton);
          if (!zip) return json(res, 404, { ok: false, raison: 'Paquet inconnu ou expiré.' });
          res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length, 'cache-control': 'no-store' });
          return res.end(zip);
        }
        /* L'APPLICATION « BELUGA » POUR SAFARI, posée par Beluga Connect lui-même (carte « Beluga Connect : liaison sans fenêtre »). */
        if (route === '/api/relais-mac/extension-safari.zip' && req.method === 'GET') {
          const zip = await relaisMac.paquetSafariPourLeRelais();
          if (!zip) return json(res, 404, { ok: false, raison: 'L’extension Safari n’est pas encore fabriquée.' });
          res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length, 'cache-control': 'no-store' });
          return res.end(zip);
        }
        /* LE MODULE FIREFOX SIGNÉ PAR MOZILLA (carte « Navigateurs facultatifs à la liaison »), posé par Beluga Connect. */
        if (route === '/api/relais-mac/extension-firefox.xpi' && req.method === 'GET') {
          const { paquetFirefox } = await import('./extension-firefox.js');
          const xpi = paquetFirefox();
          if (!xpi) return json(res, 404, { ok: false, raison: 'Le module Firefox n’est pas encore signé.' });
          const octets = fs.readFileSync(xpi.chemin);
          res.writeHead(200, { 'content-type': 'application/x-xpinstall', 'content-length': octets.length, 'cache-control': 'no-store' });
          return res.end(octets);
        }
        /* Le menu de Beluga Connect : son état, et ses deux gestes (« Mettre à jour maintenant », « Réparer »). */
        if (route === '/api/relais-mac/statut' && req.method === 'POST') {
          return json(res, 200, await relaisMac.statutPourConnect(voie.appareilId, voie.compteId));
        }
        if (route === '/api/relais-mac/demande' && req.method === 'POST') {
          let demande: Record<string, unknown> = {};
          try {
            demande = JSON.parse(corps || '{}');
          } catch {
            return json(res, 400, { ok: false, raison: 'Demande illisible.' });
          }
          const r = await relaisMac.demandeDeConnect(voie.appareilId, voie.compteId, demande.quoi);
          return json(res, r.ok ? 200 : 400, r.ok ? r : { ok: false, raison: r.texte });
        }
        if (route === '/api/relais-mac/reponse' && req.method === 'POST') {
          let reponse: Record<string, unknown> = {};
          try {
            reponse = JSON.parse(corps || '{}');
          } catch {
            return json(res, 400, { ok: false });
          }
          return json(res, 200, { ok: relaisMac.recevoirLaReponse(voie.appareilId, reponse) });
        }
        return json(res, 404, { error: 'route du relais inconnue' });
      }

      /*
       * LA LIAISON BELUGA PASS (`server/src/belugapass.ts`, 15/11/2026) : AVANT le mur, Beluga Pass n'a pas de
       * session. Sa seule clé est la clé de liaison (Bearer, empreinte comparée à temps constant) ; le corps ne se lit
       * qu'après elle, sous plafond ; une adresse qui se trompe trop souvent attend.
       */
      if (route.startsWith('/api/belugapass/')) {
        const { traiterAppelEntrant } = await import('./belugapass.js');
        const r = await traiterAppelEntrant({
          methode: req.method ?? 'GET',
          route,
          autorisation: req.headers.authorization,
          proto: req.headers['x-forwarded-proto'],
          ip: clientIp(req),
          lireLeCorps: (plafond) => readBody(req, plafond),
        });
        return json(res, r.status, r.corps);
      }

      if (route === '/studio/gsap.min.js' || /^\/studio\/polices\/[a-z0-9-]+\.woff2$/.test(route)) {
        const { outilsDeRendu } = await import('./studio-rendu.js');
        const outils = outilsDeRendu();
        const fichier = route === '/studio/gsap.min.js' ? outils.gsap : path.join(outils.polices, path.basename(route));
        if (!fichier || !fs.existsSync(fichier)) return json(res, 404, { error: 'fichier introuvable' });
        res.writeHead(200, {
          'content-type': route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'font/woff2',
          'cache-control': 'public, max-age=86400',
          'access-control-allow-origin': '*',
        });
        return fs.createReadStream(fichier).pipe(res);
      }
      /* LES POLICES DU PROJET (la vraie police du produit) : nommées par leur empreinte, lues par le cadre d'aperçu. */
      const policeDuProjet = /^\/studio\/polices-projet\/([a-f0-9]{16,64}\.(?:woff2|woff|ttf|otf))$/.exec(route);
      if (policeDuProjet) {
        const { fichierDePoliceDuProjet, typeMimeDePolice } = await import('./studio-polices.js');
        const fichier = fichierDePoliceDuProjet(policeDuProjet[1]!);
        if (!fichier) return json(res, 404, { error: 'police introuvable' });
        res.writeHead(200, {
          'content-type': typeMimeDePolice(fichier),
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        });
        return fs.createReadStream(fichier).pipe(res);
      }
      const studioMedia = /^\/studio-media\/([\w-]+)\/([\w-]+)$/.exec(route);
      if (studioMedia) {
        const { mediaDeLAdresseSignee, fichierDuMedia } = await import('./studio.js');
        const { PREFIXE_COPIE_ALPHA } = await import('@beluga/shared');
        const media = mediaDeLAdresseSignee(studioMedia[1]!, studioMedia[2]!, Number(url.searchParams.get('e')), String(url.searchParams.get('s') ?? ''));
        const fichier = media ? fichierDuMedia(media) : null;
        if (!media || !fichier) return json(res, 404, { error: 'média introuvable' });
        const taille = fs.statSync(fichier).size;
        const entetes: http.OutgoingHttpHeaders = {
          'content-type': media.mime ?? 'application/octet-stream',
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
          /* LA COPIE D'APERÇU SE DESSINE DANS UN CANEVAS, DEPUIS UN CADRE SANS ORIGINE : sans cette autorisation, Safari
             refuse d'en lire les images. L'adresse signée reste la seule clé, et aucune session ne part avec la demande. */
          ...(media.categorie?.startsWith(PREFIXE_COPIE_ALPHA) ? { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, accept-ranges, content-length' } : {}),
        };
        const plage = plageDemandee(typeof req.headers.range === 'string' ? req.headers.range : undefined, taille);
        if (plage.genre === 'impossible') {
          res.writeHead(416, { 'content-range': `bytes */${taille}` });
          return res.end();
        }
        if (plage.genre === 'partiel') {
          res.writeHead(206, { ...entetes, 'content-range': `bytes ${plage.debut}-${plage.fin}/${taille}`, 'content-length': plage.fin - plage.debut + 1 });
          if (req.method === 'HEAD') return res.end();
          return pipeline(fs.createReadStream(fichier, { start: plage.debut, end: plage.fin }), res).catch(() => {});
        }
        res.writeHead(200, { ...entetes, 'content-length': taille });
        if (req.method === 'HEAD') return res.end();
        return pipeline(fs.createReadStream(fichier), res).catch(() => {});
      }

      /* ---------------- Mur d'accès ---------------- */

      /*
       * DEUX VISAGES, UN SEUL DÉMON : C'EST L'ENTÊTE `Host` QUI DÉCIDE.
       *
       * Sur l'adresse de l'espace client, un visiteur non identifié reçoit le
       * formulaire CLIENT — sobre, à la marque, et qui ne dit rien de
       * l'application d'administration. Ailleurs, la page d'entrée habituelle.
       */
      const porte = porteDeLHote(req.headers.host);
      const compte = identiteDeLaRequete(req);

      if (!compte) {
        if (route.startsWith('/api/')) return json(res, 401, { error: 'session expirée' });
        // UNE INSTALLATION NEUVE N'A PERSONNE À RECONNAÎTRE : elle montre la
        // page qui fait créer le premier compte, pas un formulaire de connexion
        // auquel personne ne pourrait répondre. Le code du lien de fin
        // d'installation (`?installation=…`) y entre tout seul.
        if (installationEnAttente()) {
          const langues = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : undefined;
          res.writeHead(200, ENTETES_DE_LA_PAGE_D_INSTALLATION);
          return res.end(
            pageDInstallation({
              acceptLanguage: langues,
              commande: commandeDuCode(),
              codeDuLien: url.searchParams.get(PARAMETRE_DU_LIEN) ?? undefined,
            }),
          );
        }
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

      /* LA RAPIDITÉ RESSENTIE (`usage-installation.ts`) : le temps de chaque route, rangé par famille. */
      if (route.startsWith('/api/')) {
        const debutApi = performance.now();
        res.once('finish', () => noterUneLatence(route, performance.now() - debutApi));
      }

      /*
       * LE RAPPORT D'USAGE, VU DE L'ÉCRAN : ce que la page mesure d'elle-même
       * (écrans ouverts, temps par zone, profil d'affichage, coupures). Ouverte
       * à toute personne connectée ; sans effet là où aucun relais n'est joint.
       */
      if (route === '/api/usage' && req.method === 'POST') {
        let brut: unknown = null;
        try {
          brut = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8') || 'null');
        } catch {
          return json(res, 400, { ok: false });
        }
        noterLEcran(compte, brut, String(req.headers['user-agent'] ?? ''));
        return json(res, 200, { ok: true });
      }

      if (route === '/api/me') {
        return json(res, 200, {
          user: compte.identifiant,
          role: compte.role,
          nomAffiche: compte.nomAffiche,
          projets: compte.projets,
          version: CONFIG.version,
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
        return json(res, 200, { ok: subscribe(body, compte.id, String(req.headers['user-agent'] ?? '')) });
      }

      /*
       * LES APPAREILS DE CE COMPTE, jamais ceux des autres. L'appareil qui
       * regarde donne son adresse d'abonnement (en corps, pas dans l'adresse
       * de la requête, que les journaux gardent) pour être repéré ; il ne la
       * reçoit pas en retour — seulement des empreintes.
       */
      if (route === '/api/push/appareils' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
        const courant = typeof body.endpoint === 'string' ? body.endpoint : undefined;
        return json(res, 200, appareilsDuCompte(compte.id, courant));
      }

      if (route === '/api/push/appareils/retirer' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
        return json(res, 200, { ok: typeof body.id === 'string' && retirerAppareilDuCompte(compte.id, body.id) });
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
      /*
       * L'ESPACE CLIENT QUI NE SE RELIE PAS (`server/src/espace-blocage.ts`) : la page le signale après 30 s, par
       * HTTP puisque le canal est mort. Réservé au rôle client, corps borné à 4 Ko et jugé par une règle pure ; une
       * alerte aux administrateurs au plus par compte et par heure.
       */
      if (route === ROUTE_SIGNALEMENT_DE_BLOCAGE && req.method === 'POST') {
        if (compte.role !== 'client') return json(res, 403, { error: REFUS_HORS_PORTEE });
        let brut: unknown = null;
        try {
          brut = JSON.parse((await readBody(req, 4 * 1024)).toString('utf8') || 'null');
        } catch {
          return json(res, 400, { ok: false });
        }
        const signalement = signalementDeBlocageValide(brut);
        if (!signalement) return json(res, 400, { ok: false });
        const { signalerUnBlocageDEspace } = await import('./espace-blocage.js');
        return json(res, 200, { ok: true, alerte: signalerUnBlocageDEspace(compte, signalement) });
      }

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
        // Et une panne regroupée du rapport d'usage, nettoyée avant de partir.
        noterUnePanne(juge.erreur.source, juge.erreur.message, juge.erreur.pile, juge.erreur.zone);
        log.warn('interface', `${juge.erreur.source} — ${juge.erreur.message}`);
        return json(res, 200, { ok: true });
      }

      if (route === '/api/upload' && req.method === 'POST') {
        /*
         * UN FICHIER POUR LE COFFRE-FORT (`?coffre=1`). Une fiche partagée n'a
         * pas de projet : ses fichiers se rangent sous le projet RÉSERVÉ du
         * coffre, à part de toute carte et de toute demande. Seul
         * l'administrateur en dépose ; tout fichier, sauf un programme. Le
         * plafond d'1 Go se juge sur la FICHE à l'enregistrement — ici, un
         * seul fichier plus lourd que ce plafond est refusé d'office.
         */
        const pourLeCoffre =
          url.searchParams.get('coffre') === '1' || url.searchParams.get('project') === PROJET_DU_COFFRE;
        if (pourLeCoffre && compte.role !== 'admin') return json(res, 403, { error: REFUS_HORS_PORTEE });
        const projectId = pourLeCoffre ? PROJET_DU_COFFRE : (url.searchParams.get('project') ?? '');
        // Un compte qui n'est pas administrateur ne dépose que dans un projet de sa portée.
        if (compte.role !== 'admin' && !peutVoirProjet(compte, projectId)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'fichier'));
        const mime = String(req.headers['content-type'] ?? 'application/octet-stream');
        const refusDuCoffre = pourLeCoffre ? refusDuFichierDuCoffre(mime, name) : null;
        if (refusDuCoffre) {
          res.setHeader('connection', 'close');
          return json(res, 415, { error: refusDuCoffre });
        }
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
        if (pourLeCoffre && recu.taille > FICHIERS_FICHE_OCTETS_MAX) {
          fs.rmSync(recu.provisoire, { force: true });
          return json(res, 413, { error: 'Ce fichier dépasse 1 Go, le plafond d’une fiche du coffre-fort.' });
        }

        // Dédoublonnage : le même fichier envoyé dix fois n'apparaît qu'une fois.
        const existing = store.findAttachmentBySha(projectId, sha);
        if (existing) {
          fs.rmSync(recu.provisoire, { force: true });
          return json(res, 200, { attachment: existing, deduplicated: true });
        }

        // Une image du coffre n'appartient ni à une carte ni à un agent.
        const cardId = pourLeCoffre ? undefined : (url.searchParams.get('card') ?? undefined);
        const agentId = pourLeCoffre ? undefined : (url.searchParams.get('agent') ?? undefined);
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
        // Les images du coffre ne sont diffusées à aucun écran de projet.
        if (!pourLeCoffre) bus.emit({ type: 'attachments', projectId, items: store.listAttachments(projectId) });
        return json(res, 200, { attachment });
      }

      /*
       * LE CONTENU D'UN FICHIER RANGÉ (fenêtre « Fichiers », `server/src/fichiers-ranges.ts`) : droits revérifiés ici
       * (`fichierAServir` : projet de la portée, jamais journaux, sauvegardes ni mémoire pour un collaborateur), lecture
       * partielle pour les vidéos. Une page HTML ou un SVG ne s'exécute JAMAIS dans l'application : texte brut, ou
       * bac à sable.
       */
      if (route === '/api/fichiers/contenu') {
        const trouve = fichierAServir(compte, url.searchParams.get('id') ?? '');
        if (!trouve) return json(res, 404, { error: 'fichier introuvable' });
        let taille: number;
        try {
          taille = fs.statSync(trouve.chemin).size;
        } catch {
          return json(res, 404, { error: 'fichier absent' });
        }
        const telecharger = !!url.searchParams.get('download');
        const largeur = telecharger ? null : largeurDemandee(url.searchParams.get('w'));
        if (largeur && !req.headers.range) {
          const mini = await miniatureDe(trouve.chemin, trouve.mime, largeur);
          if (mini) {
            res.writeHead(200, { 'content-type': mini.mime, 'cache-control': 'private, max-age=86400', 'content-length': mini.taille });
            if (req.method === 'HEAD') return res.end();
            return pipeline(fs.createReadStream(mini.file), res).catch(() => {});
          }
          /* Une vignette de vidéo ratée ne télécharge jamais la vidéo entière. */
          if (vignetteSansOriginal(trouve.mime)) return json(res, 404, { error: 'vignette indisponible' });
        }
        const actif = /html|svg|xml|javascript/.test(trouve.mime);
        const entetes: http.OutgoingHttpHeaders = {
          'content-type': actif && !telecharger ? 'text/plain; charset=utf-8' : trouve.mime.startsWith('text/') && !trouve.mime.includes('charset') ? `${trouve.mime}; charset=utf-8` : trouve.mime,
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=600',
          'x-content-type-options': 'nosniff',
          'content-security-policy': 'sandbox',
          'content-disposition': telecharger ? `attachment; filename*=UTF-8''${encodeURIComponent(trouve.nom)}` : 'inline',
        };
        const plage = plageDemandee(typeof req.headers.range === 'string' ? req.headers.range : undefined, taille);
        if (plage.genre === 'impossible') {
          res.writeHead(416, { 'content-range': `bytes */${taille}` });
          return res.end();
        }
        if (plage.genre === 'partiel') {
          res.writeHead(206, { ...entetes, 'content-range': `bytes ${plage.debut}-${plage.fin}/${taille}`, 'content-length': plage.fin - plage.debut + 1 });
          if (req.method === 'HEAD') return res.end();
          return pipeline(fs.createReadStream(trouve.chemin, { start: plage.debut, end: plage.fin }), res).catch(() => {});
        }
        res.writeHead(200, { ...entetes, 'content-length': taille });
        if (req.method === 'HEAD') return res.end();
        return pipeline(fs.createReadStream(trouve.chemin), res).catch(() => {});
      }

      /* DÉPOSER UN FICHIER dans un dossier rangé : corps brut, `?dossier=<chemin rangé>&nom=<nom>`, 200 Mo au plus. */
      if (route === '/api/fichiers/deposer' && req.method === 'POST') {
        const dossier = url.searchParams.get('dossier') ?? '';
        const nom = url.searchParams.get('nom') ?? '';
        if (!nom.trim()) return json(res, 400, { error: 'nom manquant' });
        try {
          const contenu = await readBody(req, 200 * 1024 * 1024);
          return json(res, 200, { fichier: deposerUnFichier(compte, dossier, nom, contenu) });
        } catch (err) {
          return json(res, 400, { error: (err as Error).message });
        }
      }

      if (route === '/api/attachment') {
        const demande = url.searchParams.get('id') ?? '';
        /* Un chemin de fichier cité à la place de l'identifiant mène à la pièce rangée depuis ce fichier. */
        const attachment = store.getAttachment(demande) ?? store.pieceDuChemin(demande);
        if (!attachment) return json(res, 404, { error: 'pièce jointe introuvable' });
        const id = attachment.id;
        /*
         * UN CLIENT NE TÉLÉCHARGE QUE CE QU'IL A LE DROIT DE LIRE. Le fichier
         * doit appartenir à l'une de SES demandes, ou à SON fil : deviner un
         * identifiant ne mène nulle part, et le refus dit la même chose qu'une
         * pièce absente.
         */
        if (compte.role === 'client' && !pieceLisiblePar(compte, id)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        // Un membre ou un lecteur lit les pièces des projets de sa portée, et d'eux seuls.
        if (estCollaborateur(compte.role) && !peutVoirProjet(compte, attachment.projectId)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        /*
         * UN FICHIER DU COFFRE-FORT NE SORT QUE POUR L'ADMINISTRATEUR, quoi que
         * dise la règle ci-dessus : c'est une capture d'accès, un code QR, un
         * document — jamais la pièce d'une demande.
         */
        if (attachment.projectId === PROJET_DU_COFFRE && compte.role !== 'admin') {
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
         * UNE VIGNETTE (`&w=`) SE SERT EN MINIATURE : jamais l'original décodé
         * pour quelques dizaines de pixels (`miniatures.ts`).
         */
        const largeur = url.searchParams.get('download') ? null : largeurDemandee(url.searchParams.get('w'));
        if (largeur && !req.headers.range) {
          const mini = await miniatureDe(file, attachment.mime, largeur);
          if (mini) {
            res.writeHead(200, {
              'content-type': mini.mime,
              'cache-control': 'private, max-age=86400',
              'content-length': mini.taille,
            });
            if (req.method === 'HEAD') return res.end();
            return pipeline(fs.createReadStream(mini.file), res).catch(() => {});
          }
          if (vignetteSansOriginal(attachment.mime)) return json(res, 404, { error: 'vignette indisponible' });
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

      /*
       * « TOUT TÉLÉCHARGER » DE LA VISIONNEUSE (`server/src/archive-des-images.ts`) :
       * les MÊMES deux règles que `/api/attachment`, pour chaque pièce — un client
       * ne lit que ses pièces, le coffre ne sort que pour l'administrateur — et une
       * seule pièce refusée refuse toute l'archive.
       */
      if (route === ROUTE_ARCHIVE_DES_IMAGES) {
        const { archiveDesImages, deposerLot, lireLot, verifierArchive } = await import('./archive-des-images.js');
        const acces = {
          lirePiece: (id: string) => store.getAttachment(id),
          peutLire: (piece: Attachment) =>
            (compte.role !== 'client' || pieceLisiblePar(compte, piece.id)) &&
            (!estCollaborateur(compte.role) || peutVoirProjet(compte, piece.projectId)) &&
            (piece.projectId !== PROJET_DU_COFFRE || compte.role === 'admin'),
          cheminDe: cheminDePieceJointe,
          trouverCapture:
            compte.role === 'admin'
              ? (projet: string, chemin: string) => {
                  const p = store.getProject(projet);
                  return p ? (imageDEtape(chemin, racinesDesImagesDEtape(p.path))?.file ?? null) : null;
                }
              : undefined,
          refus: REFUS_HORS_PORTEE,
        };
        /* PRÉPARER : la liste arrive dans le CORPS, est vérifiée entière, et repart en adresse courte. */
        if (req.method === 'POST') {
          let corps: Partial<CorpsDArchive>;
          try {
            corps = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}');
          } catch {
            return json(res, 400, { error: 'demande illisible' });
          }
          const texte = (v: unknown): v is string => typeof v === 'string';
          const demande = {
            ids: Array.isArray(corps.ids) ? corps.ids.filter(texte) : [],
            captures: texte(corps.project) ? { projet: corps.project, chemins: Array.isArray(corps.chemins) ? corps.chemins.filter(texte) : [] } : undefined,
            nom: texte(corps.nom) ? corps.nom : null,
            ...(corps.nomsDansLArchive && typeof corps.nomsDansLArchive === 'object'
              ? { nomsDansLArchive: Object.fromEntries(Object.entries(corps.nomsDansLArchive).filter(([, v]) => texte(v))) as Record<string, string> }
              : {}),
            ...(Array.isArray(corps.textes) ? { textes: corps.textes.filter((x) => x && texte(x.nom) && texte(x.contenu)) } : {}),
          };
          const verifiee = verifierArchive(demande, acces);
          if (!verifiee.ok) return json(res, verifiee.statut, { error: verifiee.raison });
          const lot: LotDArchive = { adresse: adresseDuLot(deposerLot(compte.id, demande)) };
          return json(res, 200, lot);
        }
        /* RECEVOIR : un lot préparé (`?lot=`), ou — petits lots écrits à la main — la liste dans l'adresse. */
        const jeton = url.searchParams.get('lot');
        const projetDesCaptures = url.searchParams.get('project');
        const demande = jeton
          ? lireLot(jeton, compte.id)
          : {
              ids: (url.searchParams.get('ids') ?? '').split(','),
              captures: projetDesCaptures ? { projet: projetDesCaptures, chemins: url.searchParams.getAll('chemin') } : undefined,
              nom: url.searchParams.get('nom'),
            };
        if (!demande) return json(res, 404, { error: 'cette archive n’est plus disponible : relancez le téléchargement' });
        const r = archiveDesImages(demande, acces);
        if (!r.ok) return json(res, r.statut, { error: r.raison });
        const poids = await r.poids;
        res.writeHead(200, {
          'content-type': 'application/zip',
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,
          ...(poids > 0 ? { 'content-length': poids } : {}),
        });
        if (req.method === 'HEAD') {
          r.flux.destroy();
          return res.end();
        }
        return pipeline(r.flux, res).catch(() => {});
      }

      /*
       * LE CAHIER DES CHARGES D'UN PROJET, À EMPORTER : en PDF (mis en page par
       * le Chrome du système) ou en texte Markdown. Sans document : 404, et le
       * bouton qui y mène n'est de toute façon pas affiché.
       */
      if (route === '/api/projets/cahier-des-charges') {
        const format = url.searchParams.get('format') === 'md' ? 'md' : 'pdf';
        const { exporterLeCahier } = await import('./cahier-des-charges.js');
        const r = await exporterLeCahier(String(url.searchParams.get('projet') ?? ''), format).catch((err) => {
          log.error('export du cahier des charges impossible', err);
          return undefined;
        });
        if (r === undefined) return json(res, 500, { error: 'Export du cahier des charges impossible.' });
        if (!r) return json(res, 404, { error: 'Ce projet n’a pas de cahier des charges.' });
        res.writeHead(200, {
          'content-type': r.type,
          'content-length': r.contenu.length,
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,
        });
        return res.end(r.contenu);
      }

      /*
       * LE CAHIER DE RÉALISATION D'UNE CARTE (caméra), À EMPORTER : même
       * mise en page que le cahier des charges. Sans document : 404.
       */
      if (route === '/api/cartes/realisation') {
        const format = url.searchParams.get('format') === 'md' ? 'md' : 'pdf';
        const carte = store.getCard(String(url.searchParams.get('carte') ?? ''));
        if (!carte) return json(res, 404, { error: 'Carte introuvable.' });
        if (estCollaborateur(compte.role) && !peutVoirProjet(compte, carte.projectId)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        const { exporterLaRealisation } = await import('./realisation-questionnaire.js');
        const r = await exporterLaRealisation(carte.id, format).catch((err) => {
          log.error('export du cahier de réalisation impossible', err);
          return undefined;
        });
        if (r === undefined) return json(res, 500, { error: 'Export du cahier de réalisation impossible.' });
        if (!r) return json(res, 404, { error: 'Cette carte n’a pas encore de cahier de réalisation.' });
        res.writeHead(200, {
          'content-type': r.type,
          'content-length': r.contenu.length,
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,
        });
        return res.end(r.contenu);
      }

      /*
       * LE PLAN D'UNE CARTE, PAR VERSION, À EMPORTER depuis l'entête de son
       * volet : même mise en page que le cahier des charges. Sans plan : 404.
       */
      if (route === '/api/cartes/plan') {
        const format = url.searchParams.get('format') === 'md' ? 'md' : 'pdf';
        const carte = store.getCard(String(url.searchParams.get('carte') ?? ''));
        if (!carte) return json(res, 404, { error: 'Carte introuvable.' });
        if (estCollaborateur(compte.role) && !peutVoirProjet(compte, carte.projectId)) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        const numero = Number(url.searchParams.get('version') ?? '');
        const { exporterLePlan } = await import('./export-du-plan.js');
        const r = await exporterLePlan(carte.id, numero, format).catch((err) => {
          log.error('export du plan impossible', err);
          return undefined;
        });
        if (r === undefined) return json(res, 500, { error: 'Export du plan impossible.' });
        if (!r) return json(res, 404, { error: 'Cette version du plan n’existe pas.' });
        res.writeHead(200, {
          'content-type': r.type,
          'content-length': r.contenu.length,
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,
        });
        return res.end(r.contenu);
      }

      /*
       * LE RELAIS, VU DE L'ÉCRAN (administrateurs seulement : ces routes ne sont
       * ouvertes à personne d'autre dans `droits-commandes.ts`). L'état et les
       * tickets de CETTE installation ; sur la machine qui reçoit, les chiffres
       * de l'écran « Installations ».
       */
      if (route === '/api/relais/etat') {
        const { etatDuRelaisIci } = await import('./relais-installations.js');
        return json(res, 200, etatDuRelaisIci());
      }
      if (route === '/api/relais/installations') {
        const { installationsRecues, relaisRecepteurIci } = await import('./relais-installations.js');
        if (!relaisRecepteurIci()) return json(res, 404, { error: 'Cette machine ne reçoit pas les installations.' });
        const filtre = url.searchParams.get('filtre');
        return json(res, 200, installationsRecues(filtreDePaiementLu(filtre)));
      }

      /*
       * LE « TOUT TÉLÉCHARGER » D'UNE CRÉATION DE MÉDIA (26/10/2026) : trois dossiers — médias finaux,
       * validés, esquisses —, en flux et sans compression, comme l'archive du Studio.
       */
      if (route === '/api/creation/telechargement') {
        const { archiveDuTelechargement } = await import('./parcours-du-media.js');
        const r = await archiveDuTelechargement(String(url.searchParams.get('cardId') ?? ''), (url.searchParams.get('langue') ?? 'fr') as never);
        if (!r.ok) return json(res, r.statut, { error: r.raison });
        const entetes: http.OutgoingHttpHeaders = {
          'content-type': 'application/zip',
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,
        };
        const poids = await r.poids;
        res.writeHead(200, poids > 0 ? { ...entetes, 'content-length': poids } : entetes);
        if (req.method === 'HEAD') {
          r.flux.destroy();
          return res.end();
        }
        return pipeline(r.flux, res).catch(() => {});
      }

      /* L'extrait d'une voix finale du Studio : fabriqué une fois (quota gratuit), gardé, puis servi. */
      if (route === '/api/studio/extrait') {
        const { fichierDExtrait } = await import('./studio-generation.js');
        const r = await fichierDExtrait(String(url.searchParams.get('voix') ?? ''));
        if (!r.ok) return json(res, 503, { error: r.raison });
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'private, max-age=86400' });
        return fs.createReadStream(r.fichier).pipe(res);
      }

      /*
       * « TOUT TÉLÉCHARGER » : les fichiers PRÊTS de plusieurs exports d'une même création, en UNE archive.
       * Écrite en flux et SANS compression (une vidéo ne se compresse pas, et le serveur est petit) : rien
       * ne tient en mémoire. Un export pas prêt, ou d'une autre création, refuse toute l'archive.
       */
      if (route === '/api/studio/exports-groupes') {
        const { archiveDesExports } = await import('./studio-archive.js');
        const r = archiveDesExports((url.searchParams.get('ids') ?? '').split(',').filter(Boolean));
        if (!r.ok) return json(res, r.statut, { error: r.raison });
        const entetes: http.OutgoingHttpHeaders = {
          'content-type': 'application/zip',
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.nom)}`,
        };
        // Sans compression, le poids final est connu d'avance : le navigateur montre un vrai pourcentage.
        const poids = await r.poids;
        res.writeHead(200, poids > 0 ? { ...entetes, 'content-length': poids } : entetes);
        if (req.method === 'HEAD') {
          r.flux.destroy();
          return res.end();
        }
        return pipeline(r.flux, res).catch(() => {});
      }

      /* LA PHOTO D'UN TYPE DE MÉDIA DU STUDIO (liste du début de la conversation, 31/10/2026) : fabriquée une fois par
         Codex, versionnée dans `outils/modes-du-studio/<id>.webp`. Un identifiant hors de la liste n'ouvre rien. */
      if (route === '/api/studio/mode-image') {
        const { estModeDuStudio } = await import('@beluga/shared');
        const id = String(url.searchParams.get('id') ?? '');
        const chemin = estModeDuStudio(id) ? path.join(CONFIG.selfPath, 'outils', 'modes-du-studio', `${id}.webp`) : '';
        if (!chemin || !fs.existsSync(chemin)) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'private, max-age=604800', 'x-content-type-options': 'nosniff' });
        return fs.createReadStream(chemin).pipe(res);
      }

      /* LA VIGNETTE D'UN STYLE DU STUDIO (galerie « Styles ») : téléchargée une fois, gardée, servie d'ici. */
      if (route === '/api/studio/style-vignette') {
        const { vignetteDuStyle } = await import('./studio-styles.js');
        const v = await vignetteDuStyle(String(url.searchParams.get('id') ?? ''), url.searchParams.get('anime') === '1');
        const entetes = { 'content-type': v.type, 'cache-control': 'private, max-age=604800', 'x-content-type-options': 'nosniff' };
        if (Buffer.isBuffer(v.corps)) {
          res.writeHead(200, entetes);
          return res.end(v.corps);
        }
        // Une vidéo se sert PAR PLAGES (206) : sans réponse aux requêtes Range, Safari ne la lit pas.
        if (v.type.startsWith('video/')) {
          const taille = fs.statSync(v.corps).size;
          const plage = plageDemandee(typeof req.headers.range === 'string' ? req.headers.range : undefined, taille);
          if (plage.genre === 'impossible') {
            res.writeHead(416, { 'content-range': `bytes */${taille}` });
            return res.end();
          }
          if (plage.genre === 'partiel') {
            res.writeHead(206, { ...entetes, 'accept-ranges': 'bytes', 'content-range': `bytes ${plage.debut}-${plage.fin}/${taille}`, 'content-length': plage.fin - plage.debut + 1 });
            if (req.method === 'HEAD') return res.end();
            return pipeline(fs.createReadStream(v.corps, { start: plage.debut, end: plage.fin }), res).catch(() => {});
          }
          res.writeHead(200, { ...entetes, 'accept-ranges': 'bytes', 'content-length': taille });
          if (req.method === 'HEAD') return res.end();
          return pipeline(fs.createReadStream(v.corps), res).catch(() => {});
        }
        res.writeHead(200, entetes);
        return fs.createReadStream(v.corps).pipe(res);
      }

      if (route === '/api/favicon') {
        // L'icône d'un projet hors de sa portée ne sort pas pour un membre ou un lecteur.
        if (estCollaborateur(compte.role) && !peutVoirProjet(compte, url.searchParams.get('project') ?? '')) {
          return json(res, 403, { error: REFUS_HORS_PORTEE });
        }
        const trouve = fichierFavicon(url.searchParams.get('project') ?? '');
        if (!trouve) return json(res, 404, { error: 'icône introuvable' });
        const largeur = largeurDemandee(url.searchParams.get('w'));
        if (largeur) {
          const mini = await miniatureDe(trouve.file, trouve.mime, largeur);
          if (mini) {
            res.writeHead(200, { 'content-type': mini.mime, 'cache-control': 'private, max-age=3600', 'content-length': mini.taille });
            return pipeline(fs.createReadStream(mini.file), res).catch(() => {});
          }
        }
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
      /*
       * UNE CAPTURE DE L'AGENT RANGÉE EN PIÈCE JOINTE, À LA DEMANDE DE L'ÉCRAN (17/11/2026) : la première fois que sa
       * vignette s'affiche sans référence, l'écran demande son rangement et reçoit son « #alias »
       * (`rangerUneCaptureDeLAgent`). Mêmes racines que la lecture d'une capture ; idempotent.
       */
      if (route === '/api/capture/ranger' && req.method === 'POST') {
        const corps = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
        const project = store.getProject(typeof corps.project === 'string' ? corps.project : '');
        if (!project) return json(res, 404, { error: 'projet introuvable' });
        const chemin = typeof corps.path === 'string' ? corps.path : '';
        const trouve = imageDEtape(chemin, racinesDesImagesDEtape(project.path));
        if (!trouve) return json(res, 404, { error: 'capture introuvable' });
        /* Rattachée au PROJET seul : l'image compte déjà parmi les captures de sa conversation (bouton photo) ; une
           pièce de conversation de plus la compterait deux fois dans « pas encore vues ». */
        const piece = await rangerUneCaptureDeLAgent({ projectId: project.id, chemin, fichier: trouve.file });
        if (!piece) return json(res, 422, { error: 'capture trop lourde pour être rangée' });
        return json(res, 200, { id: piece.id, reference: piece.alias ? `#${piece.alias}` : null });
      }

      if (route === '/api/capture') {
        const project = store.getProject(url.searchParams.get('project') ?? '');
        if (!project) return json(res, 404, { error: 'projet introuvable' });
        /*
         * LES RACINES OÙ UN AGENT REGARDE RÉELLEMENT SES IMAGES : le projet, les
         * données, le dossier temporaire — et aussi les PIÈCES JOINTES (disque
         * de stockage compris : l'agent y lit les captures que l'utilisateur lui
         * joint) et les COPIES DE TRAVAIL des cartes, qui peuvent vivre hors du
         * projet. Sans elles, la vignette tombait en 404 et la bande « Ce que
         * l'agent a vu » la retirait : on croyait qu'il n'y avait rien.
         */
        const racines = racinesDesImagesDEtape(project.path);
        const trouve = imageDEtape(url.searchParams.get('path') ?? '', racines);
        if (!trouve) return json(res, 404, { error: 'capture introuvable' });
        res.writeHead(200, { 'content-type': trouve.mime, 'cache-control': 'private, max-age=3600' });
        return fs.createReadStream(trouve.file).pipe(res);
      }

      /*
       * UN FICHIER CITÉ PAR L'AGENT, LU SUR PLACE (`shared/src/fichiers-cites.ts`).
       * Lecture seule, sans créer de pièce jointe : le clic sur un chemin du fil
       * ouvre la visionneuse sur ce fichier. Réservé à l'administrateur (aucune
       * liste de routes des autres rôles ne la nomme). Le fichier vivant d'abord,
       * puis sa copie gardée, puis l'historique du dépôt
       * (`resoudreFichierCite`) ; sinon un `motif` dit la vraie raison à l'écran.
       * `info=1` rend la fiche (type, poids) pour que l'écran choisisse son rendu.
       * Une copie garde pour `chemin` le chemin DEMANDÉ : l'adresse suivante se
       * résout de la même façon.
       */
      if (route === ROUTE_FICHIER_CITE) {
        const project = store.getProject(url.searchParams.get('project') ?? '');
        if (!project) return json(res, 404, { error: 'projet introuvable' });
        const agent = store.getAgent(url.searchParams.get('agent') ?? '');
        const duProjet = agent && agent.projectId === project.id ? agent : undefined;
        const demande = url.searchParams.get('path') ?? '';
        const trouve = await resoudreFichierCite(
          { projectId: project.id, projectPath: project.path, workdir: duProjet?.workdir, cardId: duProjet?.cardId, agentId: duProjet?.id },
          demande,
        );
        if (!trouve.trouve) return json(res, 404, { error: 'fichier indisponible', motif: trouve.motif, date: trouve.date });
        if (url.searchParams.get('info')) {
          return json(res, 200, { nom: trouve.nom, chemin: trouve.origine === 'vivant' ? trouve.file : demande, mime: trouve.mime, taille: trouve.taille });
        }
        const largeur = url.searchParams.get('download') ? null : largeurDemandee(url.searchParams.get('w'));
        if (largeur && !req.headers.range) {
          const mini = await miniatureDe(trouve.file, trouve.mime, largeur);
          if (mini) {
            res.writeHead(200, { 'content-type': mini.mime, 'cache-control': 'private, max-age=600', 'content-length': mini.taille });
            if (req.method === 'HEAD') return res.end();
            return pipeline(fs.createReadStream(mini.file), res).catch(() => {});
          }
        }
        const servi = typeServiDUnFichierCite(trouve.mime);
        const entetes: http.OutgoingHttpHeaders = {
          'content-type': servi.type,
          'accept-ranges': 'bytes',
          'cache-control': 'private, no-cache',
          'x-content-type-options': 'nosniff',
          'content-disposition': url.searchParams.get('download')
            ? `attachment; filename*=UTF-8''${encodeURIComponent(trouve.nom)}`
            : 'inline',
          ...(servi.isole ? { 'content-security-policy': 'sandbox' } : {}),
        };
        const taille = trouve.taille;
        const plage = plageDemandee(typeof req.headers.range === 'string' ? req.headers.range : undefined, taille);
        if (plage.genre === 'impossible') {
          res.writeHead(416, { 'content-range': `bytes */${taille}` });
          return res.end();
        }
        if (plage.genre === 'partiel') {
          res.writeHead(206, { ...entetes, 'content-range': `bytes ${plage.debut}-${plage.fin}/${taille}`, 'content-length': plage.fin - plage.debut + 1 });
          if (req.method === 'HEAD') return res.end();
          return pipeline(fs.createReadStream(trouve.file, { start: plage.debut, end: plage.fin }), res).catch(() => {});
        }
        res.writeHead(200, { ...entetes, 'content-length': taille });
        if (req.method === 'HEAD') return res.end();
        return pipeline(fs.createReadStream(trouve.file), res).catch(() => {});
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
        /* LE VRAI TYPE DU FICHIER (un PDF reste un PDF) : la fenêtre de
           l'application installée s'en sert pour le montrer au lieu d'annoncer
           « données ». Une page ou une image vectorielle, qui pourraient porter
           du script, restent un simple téléchargement. */
        const type = mimeDuFichier(entry.name);
        res.writeHead(200, {
          'content-type': /html|svg|xml/.test(type) ? 'application/octet-stream' : type,
          'x-content-type-options': 'nosniff',
          /* « voir=1 » : un PDF s'ouvre dans l'onglet au lieu de se télécharger (le rapport de Marketing 2, « Ouvrir »). */
          'content-disposition': url.searchParams.get('voir') === '1' && type === 'application/pdf' ? 'inline' : `attachment; filename="${encodeURIComponent(entry.name)}"`,
        });
        return fs.createReadStream(entry.path).pipe(res);
      }

      /* L'EXTENSION SAFARI SIGNÉE (fabriquée sur GitHub, récupérée par `server/src/extension-safari.ts`). */
      if (route === '/api/extension-safari.zip') {
        const { paquetSafari } = await import('./extension-safari.js');
        const paquet = paquetSafari();
        if (!paquet) return json(res, 404, { error: 'L’extension Safari n’est pas encore fabriquée.' });
        const taille = fs.statSync(paquet.chemin).size;
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': taille,
          'content-disposition': 'attachment; filename="Beluga-Safari.zip"',
          'cache-control': 'no-store',
        });
        return fs.createReadStream(paquet.chemin).pipe(res);
      }

      /* LE PAQUET DE L'EXTENSION CHROME, réglé pour cette installation (son adresse dans `config.json`). */
      if (route === '/api/extension-chrome.zip') {
        const { paquetDeLExtension } = await import('./extension-chrome.js');
        const { adresseDeBeluga } = await import('./marketing.js');
        const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]!.trim();
        const adresse = adresseDeBeluga() || `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
        const zip = await paquetDeLExtension(adresse);
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': zip.length,
          'content-disposition': 'attachment; filename="beluga-chrome.zip"',
          'cache-control': 'no-store',
        });
        return res.end(zip);
      }

      /* LA DICTÉE EST-ELLE INSTALLÉE SUR CE SERVEUR ? (17/11/2026) Sans assistant vocal, le micro du champ la sert ; tant
         qu'elle manque, il reste grisé et mène à son installation. */
      if (route === '/api/dictee' && req.method === 'GET') {
        const { voiceAvailable } = await import('./voice.js');
        return json(res, 200, { disponible: voiceAvailable().transcribe });
      }
      if (route === '/api/transcribe' && req.method === 'POST') {
        const audio = await readBody(req, 40 * 1024 * 1024);
        const ext = (String(req.headers['x-audio-ext'] ?? 'webm') || 'webm').replace(/[^a-z0-9]/gi, '');
        const result = await transcribe(audio, ext);
        return json(res, result.ok ? 200 : 503, result);
      }

      /*
       * LE MODÈLE DU MOT DE RÉVEIL, téléchargé par le navigateur à la première ouverture du micro du module de voix :
       * c'est LUI qui reconnaît « Dis Jarvis » sur l'appareil, sans qu'aucun son n'en sorte. Nom versionné, cache long.
       */
      if (route.startsWith('/api/modele-de-reveil/')) {
        const { modeleDeReveil, VERSION_DU_MODELE_DE_REVEIL } = await import('./modele-de-reveil.js');
        if (route !== `/api/modele-de-reveil/${VERSION_DU_MODELE_DE_REVEIL}.tar.gz`) return json(res, 404, { error: 'modèle inconnu' });
        let chemin: string;
        try {
          chemin = await modeleDeReveil();
        } catch (err) {
          return json(res, 503, { error: `Le modèle du mot de réveil est indisponible : ${(err as Error).message}` });
        }
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-length': fs.statSync(chemin).size,
          'cache-control': 'private, max-age=31536000, immutable',
        });
        return fs.createReadStream(chemin).pipe(res);
      }

      if (route === '/api/digest') {
        const projectId = url.searchParams.get('project') ?? undefined;
        // Le point du jour se LIT : la version à voix haute a été retirée avec la voix du serveur (17/11/2026).
        return json(res, 200, { text: digestText(projectId) });
      }

      /* ---------------- Interface web ---------------- */

      const racineWeb = webRoot();
      if (route !== '/' && route !== '/index.html' && !route.startsWith('/api/')) {
        const candidate = path.join(racineWeb, route.replace(/^\/+/, ''));
        if (candidate.startsWith(racineWeb) && serveStatic(res, candidate)) return;
      }

      /*
       * UN MORCEAU D'HABILLAGE QUI N'EXISTE PLUS RÉPOND 404, JAMAIS LA PAGE
       * D'ACCUEIL. Les morceaux portent une empreinte qui change à chaque mise en
       * ligne : une application restée ouverte réclame un ancien nom. Lui rendre
       * la page d'accueil en « 200 » faisait refuser ce faux script par le
       * navigateur (« 'text/html' is not a valid JavaScript MIME type ») sans
       * rien dire de la cause — un vrai 404 le dit, et l'écran se recharge
       * (`vite:preloadError`, web/src/main.tsx).
       */
      if (/^\/assets\/.+\.(?:m?js|css|map|woff2?)$/i.test(route)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end('Fichier introuvable : cette version de l’application n’est plus en ligne.');
      }

      const indexFile = path.join(racineWeb, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, must-revalidate' });
        const page = fs.readFileSync(indexFile);
        // Le NOM sous l'icône d'un iPhone vient de la page, pas de la fiche
        // d'installation : côté client, titre et nom d'application portent le
        // nom de l'espace client. `/index.html` passe donc ici, jamais en
        // fichier brut. Un compte CLIENT reçoit son espace même sur l'adresse
        // commune (`porteDuCompte`).
        const html = pageAvecLIdentite(page.toString('utf8'));
        return res.end(porteDuCompte(porte, compte.role) === 'client' ? pageAuNomDuClient(html) : html);
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
