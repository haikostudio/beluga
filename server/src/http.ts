import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  Attachment,
  TRANCHE_ATTENTE_MS,
  ROUTE_CARTE_EXTERNE,
  ROUTE_CLIENTS_EXTERNE,
  ROUTE_DOC_API,
  appelDuPontRecevable,
  cleDesEntetes,
  documentationApi,
  jugerDemandeDeCarte,
  jugerLaCle,
  jugerRapportErreur,
  nomSansCollision,
  pageChangelog,
  pageDocApi,
  rechercherClientsParNom,
  ROUTE_CHANGELOG,
  trouverLeProjetVise,
} from '@haikodev/shared';
import { CONFIG, PATHS, ROOT, webRoot } from './config.js';
import { checkSession, login, logout, resolveDownload, getInternalToken, currentUsername, mintDownload } from './auth.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { callTool, createCard, toolsFor } from './tools.js';
import { cleParSecret, noterUsageDeCle } from './cles-api.js';
import { ajouterConsultationMemoireAuTour, attachToCurrentMessage, liveRun } from './runtime.js';
import { readFilePreview, makeZip, safeJoin } from './files.js';
import { EXTRAIT, transcribe, digestText, speak, voiceAvailable, normaliserTexteVoix } from './voice.js';
import { publicKey, subscribe, unsubscribe } from './push.js';
import { pontDemarre, pontAServiLesOutils } from './pont.js';
import { attendreUneTranche, poserLAttente } from './attente-question.js';
import { enregistrerErreurInterface } from './erreurs-interface.js';
import { fichierFavicon } from './favicon.js';
import {
  fichierDuPersonnageRemplace,
  remplacerLePersonnage,
  retablirLePersonnage,
  routeDUnPersonnage,
} from './personnages.js';
import { log } from './logger.js';

const COOKIE = 'haikodev_session';

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
  return readCookies(req)[COOKIE];
}

export function isAuthenticated(req: http.IncomingMessage): boolean {
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

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
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

function serveStatic(res: http.ServerResponse, filePath: string): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const hashed = /-[A-Za-z0-9_]{8,}\.(js|css|woff2)$/.test(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const LOGIN_PAGE = (error?: string) => `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>HaikoDev</title>
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
  <h1>HaikoDev</h1>
  <p class="sub">Pilotage de projets par agents.</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div><label for="u">Identifiant</label><input id="u" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required autofocus></div>
  <div><label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
  <button type="submit">Entrer</button>
</form>
</body>
</html>`;

export function createHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = url.pathname;

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
          return res.end(LOGIN_PAGE(result.error));
        }
        const cookie = `${COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.sessionDays * 86400}`;
        if (isJson) {
          res.writeHead(200, { 'set-cookie': cookie, 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
        res.writeHead(302, { 'set-cookie': cookie, location: '/' });
        return res.end();
      }

      if (route === '/auth/logout') {
        logout(sessionToken(req));
        res.writeHead(302, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0`, location: '/' });
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
       * elle attend un lancement, et RIEN ne part au moteur tout seul.
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

        const card = createCard(vise.projet.id, {
          title: demande.demande.titre,
          description: demande.demande.description,
          labels: demande.demande.etiquettes,
          origin: 'user',
        });
        noterUsageDeCle(verdict.cle.id);
        bus.emit({ type: 'card.upsert', card });
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
       * HaikoDev qui lui correspond. Cette adresse rend les clients déjà
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

      /* ---------------- Pont d'outils des agents ---------------- */

      if (route.startsWith('/internal/')) {
        if (req.headers['x-haikodev-token'] !== getInternalToken()) {
          return json(res, 403, { error: 'jeton interne invalide' });
        }
        const agentId = String(req.headers['x-haikodev-agent'] ?? '');
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
          tourAnnonce: String(req.headers['x-haikodev-tour'] ?? '') || undefined,
          tourEnCours: liveRun(agentId)?.tourId,
        });
        if (!recevable.ok) {
          log.warn(`appel d'outil refusé (agent ${agentId}) : ${recevable.raison}`);
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
          const tools = toolsFor(agent.role);
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
        if (route === '/internal/call') {
          const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}');
          const allowed = toolsFor(agent.role).some((tool) => tool.name === body.name);
          if (!allowed) {
            return json(res, 200, {
              ok: false,
              text: `Refusé : l'outil « ${body.name} » n'est pas autorisé pour ce rôle.`,
            });
          }
          const result = await callTool(
            {
              agentId,
              projectId: agent.projectId,
              role: agent.role,
              cardId: agent.cardId,
              // Les réglages visibles dans la barre d'écriture au moment du
              // clic : une carte proposée en hérite.
              run: { engine: agent.run.engine, model: agent.run.model, thinking: agent.run.thinking },
              // Le mode de la conversation : en « plan », board_create_card et
              // propose_task se refusent au niveau de l'outil (voir tools.ts).
              mode: agent.run.mode,
            },
            body.name,
            body.args ?? {},
          );
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
          if (body.name === 'project_memory') {
            ajouterConsultationMemoireAuTour(agentId, {
              requete: typeof body.args?.sujet === 'string' ? body.args.sujet : '',
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
      if (
        ['/manifest.json', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(route) ||
        /^\/notif\/[a-z-]+\.png$/.test(route)
      ) {
        const racine = webRoot();
        const publicFile = path.join(racine, route.replace(/^\/+/, ''));
        if (publicFile.startsWith(racine) && serveStatic(res, publicFile)) return;
      }

      /* ---------------- Mur d'accès ---------------- */

      if (!isAuthenticated(req)) {
        if (route.startsWith('/api/')) return json(res, 401, { error: 'session expirée' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(LOGIN_PAGE());
      }

      /* ---------------- API authentifiée ---------------- */

      if (route === '/api/me') {
        return json(res, 200, {
          user: currentUsername(),
          version: CONFIG.version,
          voice: voiceAvailable(),
          pushKey: publicKey(),
        });
      }

      if (route === '/api/push/subscribe' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
        return json(res, 200, { ok: subscribe(body) });
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
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'fichier'));
        const mime = String(req.headers['content-type'] ?? 'application/octet-stream');
        const data = await readBody(req);
        const sha = crypto.createHash('sha256').update(data).digest('hex');

        // Dédoublonnage : le même fichier envoyé dix fois n'apparaît qu'une fois.
        const existing = store.findAttachmentBySha(projectId, sha);
        if (existing) return json(res, 200, { attachment: existing, deduplicated: true });

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
          id: store.newId(),
          projectId,
          name: nomSansCollision(path.basename(name), dejaUtilises),
          mime,
          size: data.length,
          sha,
          cardId,
          agentId,
          createdAt: Date.now(),
        });
        fs.mkdirSync(PATHS.attachments, { recursive: true });
        fs.writeFileSync(path.join(PATHS.attachments, `${attachment.id}-${attachment.name}`), data);
        store.saveAttachment(attachment);
        bus.emit({ type: 'attachments', projectId, items: store.listAttachments(projectId) });
        return json(res, 200, { attachment });
      }

      /*
       * LE PERSONNAGE D'UNE COLONNE, REMPLACÉ DEPUIS LES RÉGLAGES. L'image
       * arrive telle quelle dans le corps de la requête, comme pour une pièce
       * jointe ; le détourage et les deux découpes sont faits par la même
       * fabrique que les sept d'origine. Tout refus est rendu EN CLAIR, avec sa
       * raison : c'est cette phrase que l'écran affiche.
       */
      if (route === '/api/personnage' && req.method === 'POST') {
        const colonne = url.searchParams.get('colonne') ?? '';
        const nom = decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
        const image = await readBody(req);
        const issue = await remplacerLePersonnage({
          colonne,
          nom,
          mime: String(req.headers['content-type'] ?? ''),
          image,
        });
        return json(res, issue.ok ? 200 : 400, issue);
      }

      /** Revenir au personnage d'origine : on efface ce qui avait été déposé. */
      if (route === '/api/personnage' && req.method === 'DELETE') {
        const issue = retablirLePersonnage(url.searchParams.get('colonne') ?? '');
        return json(res, issue.ok ? 200 : 400, issue);
      }

      if (route === '/api/attachment') {
        const id = url.searchParams.get('id') ?? '';
        const attachment = store.getAttachment(id);
        if (!attachment) return json(res, 404, { error: 'pièce jointe introuvable' });
        const file = path.join(PATHS.attachments, `${attachment.id}-${attachment.name}`);
        if (!fs.existsSync(file)) return json(res, 404, { error: 'fichier absent' });
        res.writeHead(200, {
          'content-type': attachment.mime,
          'content-disposition': url.searchParams.get('download')
            ? `attachment; filename="${encodeURIComponent(attachment.name)}"`
            : 'inline',
        });
        return fs.createReadStream(file).pipe(res);
      }

      if (route === '/api/favicon') {
        const trouve = fichierFavicon(url.searchParams.get('project') ?? '');
        if (!trouve) return json(res, 404, { error: 'icône introuvable' });
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

      if (route === '/api/document') {
        const card = store.getCard(url.searchParams.get('card') ?? '');
        if (!card?.closureDoc || !fs.existsSync(card.closureDoc)) {
          return json(res, 404, { error: 'document introuvable' });
        }
        const content = fs.readFileSync(card.closureDoc, 'utf8');
        if (url.searchParams.get('download')) {
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': `attachment; filename="${encodeURIComponent(path.basename(card.closureDoc))}"`,
          });
          return res.end(content);
        }
        return json(res, 200, { content });
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

      /*
       * UN PERSONNAGE REMPLACÉ SE SERT À LA PLACE DE CELUI D'ORIGINE, à la MÊME
       * adresse. Ce détour vient AVANT le service des fichiers de l'interface :
       * l'image livrée avec l'application est toujours là, elle reprend sa
       * place dès qu'on efface le remplaçant. Rien d'autre à changer — le
       * tableau, les notifications et le service worker continuent de demander
       * `/personnages/<colonne>.png`. Jamais de cache long : un remplacement
       * doit se voir tout de suite (le repère `?v=` de l'interface suffit à le
       * forcer, mais une notification, elle, ne le porte pas).
       */
      const viseUnPersonnage = routeDUnPersonnage(route);
      if (viseUnPersonnage) {
        const remplacant = fichierDuPersonnageRemplace(viseUnPersonnage);
        if (remplacant && fs.existsSync(remplacant)) {
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache, must-revalidate' });
          return fs.createReadStream(remplacant).pipe(res);
        }
      }

      const racineWeb = webRoot();
      if (route !== '/' && !route.startsWith('/api/')) {
        const candidate = path.join(racineWeb, route.replace(/^\/+/, ''));
        if (candidate.startsWith(racineWeb) && serveStatic(res, candidate)) return;
      }

      const indexFile = path.join(racineWeb, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, must-revalidate' });
        return res.end(fs.readFileSync(indexFile));
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<h1>HaikoDev</h1><p>Interface non construite. Lancez « npm run build ».</p>');
    } catch (err: any) {
      log.error('requête HTTP', err);
      if (!res.headersSent) json(res, 500, { error: err?.message ?? 'erreur interne' });
      else res.end();
    }
  });
}
