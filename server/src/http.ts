import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Attachment } from '@haikodev/shared';
import { CONFIG, PATHS, webRoot } from './config.js';
import { checkSession, login, logout, resolveDownload, getInternalToken, currentUsername, mintDownload } from './auth.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { callTool, toolsFor } from './tools.js';
import { attachToCurrentMessage } from './runtime.js';
import { readFilePreview, makeZip, safeJoin } from './files.js';
import { EXTRAIT, transcribe, digestText, speak, voiceAvailable, normaliserTexteVoix } from './voice.js';
import { publicKey, subscribe, unsubscribe } from './push.js';
import { pontDemarre, pontAServiLesOutils } from './pont.js';
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

      /* ---------------- Pont d'outils des agents ---------------- */

      if (route.startsWith('/internal/')) {
        if (req.headers['x-haikodev-token'] !== getInternalToken()) {
          return json(res, 403, { error: 'jeton interne invalide' });
        }
        const agentId = String(req.headers['x-haikodev-agent'] ?? '');
        const agent = store.getAgent(agentId);
        if (!agent) return json(res, 404, { error: 'agent inconnu' });

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
            },
            body.name,
            body.args ?? {},
          );
          if (result.proposal) {
            store.saveProposal(
              store.listMessages(agentId, 1).slice(-1)[0]?.id ?? '',
              agent.projectId,
              result.proposal,
            );
            attachToCurrentMessage(agentId, { proposal: result.proposal });
          }
          if (result.question) attachToCurrentMessage(agentId, { question: result.question });
          if (result.download) attachToCurrentMessage(agentId, { download: result.download });
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

      if (route === '/api/upload' && req.method === 'POST') {
        const projectId = url.searchParams.get('project') ?? '';
        const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'fichier'));
        const mime = String(req.headers['content-type'] ?? 'application/octet-stream');
        const data = await readBody(req);
        const sha = crypto.createHash('sha256').update(data).digest('hex');

        // Dédoublonnage : le même fichier envoyé dix fois n'apparaît qu'une fois.
        const existing = store.findAttachmentBySha(projectId, sha);
        if (existing) return json(res, 200, { attachment: existing, deduplicated: true });

        const attachment = Attachment.parse({
          id: store.newId(),
          projectId,
          name: path.basename(name),
          mime,
          size: data.length,
          sha,
          cardId: url.searchParams.get('card') ?? undefined,
          agentId: url.searchParams.get('agent') ?? undefined,
          createdAt: Date.now(),
        });
        fs.mkdirSync(PATHS.attachments, { recursive: true });
        fs.writeFileSync(path.join(PATHS.attachments, `${attachment.id}-${attachment.name}`), data);
        store.saveAttachment(attachment);
        bus.emit({ type: 'attachments', projectId, items: store.listAttachments(projectId) });
        return json(res, 200, { attachment });
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
        const result = await speak(EXTRAIT, voix);
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
