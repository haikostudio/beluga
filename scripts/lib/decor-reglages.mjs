/**
 * LE DÉCOR DES CONTRÔLES DES RÉGLAGES (carte « Retrouver la gestion des accès clients », 24/11/2026).
 *
 * Les réglages ne se contrôlent plus contre le démon de production : la page « Accès » écrit des réglages et des
 * comptes. Ce décor monte un DÉMON D'ESSAI (base neuve, `scripts/lib/demon-d-essai.mjs`) qui sert l'interface
 * construite de la copie (`web/dist` : `npm run build` avant), y pose des projets, une session d'administrateur d'une
 * heure (jeton HACHÉ), et ouvre un canal pour les commandes. Un navigateur s'y ouvre avec le thème posé sur le
 * canal, jamais en base.
 *
 *   const decor = await monterLeDecorDesReglages({ port: 7318, projets: [{ id, name }] });
 *   const page = await decor.ouvrirPage(navigateur, { largeur: 1440, theme: 'sombre' });
 *   …
 *   decor.nettoyer();
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { demarrerDemonDEssai, RACINE } from './demon-d-essai.mjs';

const require = createRequire(path.join(RACINE, 'package.json'));
const sha = (valeur) => crypto.createHash('sha256').update(valeur).digest('hex');

export async function monterLeDecorDesReglages({ port, projets = [], prefixe = 'verif-reglages-' }) {
  if (!fs.existsSync(path.join(RACINE, 'web', 'dist', 'index.html'))) {
    throw new Error('Interface non construite : lancez « npm run build » dans cette copie avant le contrôle.');
  }
  const { TMP, DATA, PROJETS, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ port, prefixe, signaux: true });
  if (!(await attendrePort())) {
    nettoyer();
    throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join('').slice(-2000));
  }
  const Database = require('better-sqlite3');
  const base = () => new Database(path.join(DATA, 'beluga.db'));
  /* L'administrateur est créé au démarrage : on l'attend un instant. */
  let admin = null;
  for (let i = 0; i < 50 && !admin; i += 1) {
    const db = base();
    admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    db.close();
    if (!admin) await new Promise((r) => setTimeout(r, 200));
  }
  if (!admin) {
    nettoyer();
    throw new Error('Le démon d’essai n’a pas créé son administrateur :\n' + journal.join('').slice(-1500));
  }
  const jeton = crypto.randomBytes(24).toString('hex');
  {
    const db = base();
    const maintenant = Date.now();
    for (const projet of projets) {
      const dossier = path.join(PROJETS, projet.id);
      fs.mkdirSync(dossier, { recursive: true });
      db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
        projet.id,
        projet.name,
        dossier,
        projet.archived ? 1 : 0,
        JSON.stringify({ id: projet.id, name: projet.name, path: dossier, archived: !!projet.archived, createdAt: maintenant, updatedAt: maintenant }),
        maintenant,
        maintenant,
      );
    }
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
      sha(jeton),
      maintenant,
      maintenant + 3_600_000,
      'contrôle des réglages',
      admin.id,
    );
    db.close();
  }
  /* Le démon relit ses projets : on lui laisse le temps de voir ceux qu'on vient de poser. */
  await new Promise((r) => setTimeout(r, 1500));

  const ADRESSE = `http://127.0.0.1:${port}`;
  const canal = await ouvrirCanal(port, jeton);

  async function ouvrirPage(navigateur, { largeur, theme, hauteur }) {
    const telephone = largeur < 640;
    /* La base est jetable : le thème s'y pose franchement, en plus d'être réécrit sur le canal. */
    await canal.demander({ type: 'prefs.set', key: 'theme', value: theme }).catch(() => undefined);
    const ctx = await navigateur.newContext({
      /* `hauteur` : une page entière d'un coup d'œil (relecture d'une rubrique en une capture). */
      viewport: { width: largeur, height: hauteur ?? (telephone ? 844 : 900) },
      isMobile: telephone,
      hasTouch: telephone,
      serviceWorkers: 'block',
      colorScheme: theme === 'sombre' ? 'dark' : 'light',
    });
    await ctx.addCookies([{ name: 'beluga_session', value: jeton, url: ADRESSE }]);
    const page = await ctx.newPage();
    /* LE THÈME SE POSE SUR LE CANAL, JAMAIS EN BASE. */
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const serveur = ws.connectToServer();
      ws.onMessage((m) => {
        if (typeof m === 'string' && /"type":"prefs\.set"/.test(m)) return;
        serveur.send(m);
      });
      serveur.onMessage((m) => ws.send(typeof m === 'string' ? m.replace(/"theme":"(clair|sombre)"/g, `"theme":"${theme}"`) : m));
    });
    await page.addInitScript((th) => {
      try {
        localStorage.setItem('beluga-theme-flash', th);
        localStorage.setItem('beluga-theme', th);
      } catch {}
    }, theme);
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    return { page, ctx, erreurs };
  }

  return {
    ADRESSE,
    TMP,
    DATA,
    canal,
    journal,
    base,
    ouvrirPage,
    nettoyer: () => {
      canal.fermer();
      nettoyer();
    },
  };
}

/** Un canal comme celui de l'écran : une commande, sa réponse — un refus JETTE. */
function ouvrirCanal(port, jeton) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const attentes = new Map();
    socket.on('message', (brut) => {
      const event = JSON.parse(brut.toString());
      if (event.type === 'ack' && attentes.has(event.id)) {
        const suite = attentes.get(event.id);
        attentes.delete(event.id);
        suite(event);
      }
    });
    socket.on('open', () =>
      resolve({
        fermer: () => socket.close(),
        demander: (cmd, delaiMs = 15_000) =>
          new Promise((resoudre, refuser) => {
            const id = crypto.randomBytes(6).toString('hex');
            const minuteur = setTimeout(() => {
              attentes.delete(id);
              refuser(new Error(`${cmd.type} : sans réponse`));
            }, delaiMs);
            attentes.set(id, (event) => {
              clearTimeout(minuteur);
              if (event.ok === false) refuser(new Error(`${cmd.type} : ${event.error ?? 'refusée'}`));
              else resoudre(event.data ?? {});
            });
            socket.send(JSON.stringify({ id, cmd }));
          }),
      }),
    );
    socket.on('error', reject);
  });
}
