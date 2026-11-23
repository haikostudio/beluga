#!/usr/bin/env node
/**
 * LE RELAIS DES INSTALLATIONS, DE BOUT EN BOUT (`server/src/relais-installations.ts`).
 *
 * Deux démons JETABLES de CETTE copie de travail :
 *  - le RÉCEPTEUR, qui joue la machine de l'auteur (`BELUGA_RELAIS_RECEPTEUR=1`) ;
 *  - une INSTALLATION, qui joue une copie venue du dépôt public
 *    (`BELUGA_MACHINE_AUTEUR=0`) et se signale au récepteur
 *    (`BELUGA_RELAIS_ADRESSE`), une seconde après son démarrage.
 * On vérifie :
 *  1. le signe de vie arrive, sans adresse de courriel tant que rien n'est accepté ;
 *  2. une installation inconnue du secret ne peut pas se faire passer pour une autre ;
 *  3. après « oui », l'adresse de l'administrateur part, et l'écran
 *     « Installations » la montre (filtres payantes / gratuites compris) ;
 *  4. PLUS AUCUN TICKET (fin de la version gratuite, 21/11/2026) : le relais
 *     refuse un ticket (410) et l'installation n'a plus de route pour en écrire ;
 *  5. (retiré avec les tickets) ;
 *  6. hors de la machine qui reçoit, les portes `/relais/*` n'existent pas ;
 *  7. dans un vrai navigateur : la rubrique « Installations de Beluga » des
 *     statistiques ; la messagerie n'a plus de filtre payants / gratuits ;
 *  8. LE RAPPORT D'USAGE ANONYME (`server/src/usage-installation.ts`), envoyé
 *     EN SILENCE (décision du 22/10/2026) : sa RÉCEPTION vit dans le central de
 *     Beluga Build, pas dans l'application — un faux central, posé devant le
 *     récepteur, attrape `/relais/usage` et laisse passer le reste. Une personne
 *     connectée depuis la France y est comptée en France ; la journée part avec
 *     sa machine, sa santé, ses projets SANS NOM, son parcours (l'assistant
 *     arrêté à « domaine »), sa panne NETTOYÉE ; aucun avis n'est demandé ;
 *     l'installation ne montre ni annonce, ni interrupteur, ni question.
 *  9. UNE INSTALLATION EXISTANTE, MISE À JOUR : elle redémarre avec son
 *     identité et des journées jamais reçues ; un central sans réception
 *     d'usage (404) n'en fait rien perdre, le central suivant les rattrape ; la
 *     version annoncée n'est jamais vide.
 *
 * Captures : data/verification/relais-*.png
 *
 *   node scripts/verif-relais-installations.mjs   (après `npm run build`)
 */
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT_RECEPTEUR = Number(process.env.HAIKO_RELAIS_PORT || 7251);
const PORT_INSTALLATION = PORT_RECEPTEUR + 1;
const RECEPTEUR = `http://127.0.0.1:${PORT_RECEPTEUR}`;
const INSTALLATION = `http://127.0.0.1:${PORT_INSTALLATION}`;
/** Le FAUX CENTRAL : il reçoit les rapports d'usage et passe tout le reste au récepteur. */
const PORT_CENTRAL = PORT_RECEPTEUR + 2;
const CENTRAL = `http://127.0.0.1:${PORT_CENTRAL}`;
const rapportsRecus = [];
/** Joue un central d'avant la réception d'usage : `/relais/usage` répond 404. */
let centralRefuseLUsage = false;

function demarrerLeFauxCentral() {
  const serveur = http.createServer(async (req, res) => {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const corps = Buffer.concat(morceaux);
    try {
      if (req.method === 'POST' && req.url === '/relais/usage') {
        if (centralRefuseLUsage) {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end('{"erreur":"introuvable"}');
        }
        const brut = corps.toString('utf8');
        rapportsRecus.push({ recuLe: Date.now(), brut, rapport: JSON.parse(brut) });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{"ok":true}');
      }
      const entetes = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection'].includes(k)));
      const r = await fetch(`${RECEPTEUR}${req.url}`, { method: req.method, headers: entetes, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : corps });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(502);
      res.end(String(e));
    }
  });
  serveur.listen(PORT_CENTRAL, '127.0.0.1');
  return serveur;
}

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/** Une session d'une heure, jeton HACHÉ en base, retirée avec le démon. */
function ouvrirUneSession(data) {
  const jeton = crypto.randomBytes(32).toString('hex');
  const db = new Database(path.join(data, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t, t + 3_600_000, 'vérification du relais');
  db.close();
  return { cookie: `beluga_session=${jeton}` };
}

async function appel(base, route, { session, corps, entetes = {} } = {}) {
  const r = await fetch(`${base}${route}`, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { ...entetes, ...(session ? { cookie: session.cookie } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    /* pas du json */
  }
  return { statut: r.status, json };
}

async function attendreQue(test, limiteMs = 20_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const v = await test();
    if (v) return v;
    await attendre(400);
  }
  return null;
}

const enfants = [];
let fauxCentral;
async function main() {
  fauxCentral = demarrerLeFauxCentral();
  const recepteur = demarrerDemonDEssai({ prefixe: 'verif-relais-recepteur-', port: PORT_RECEPTEUR, signaux: true, env: { BELUGA_RELAIS_RECEPTEUR: '1' } });
  enfants.push(recepteur);
  const installationEnv = {
    BELUGA_MACHINE_AUTEUR: '0',
    BELUGA_RELAIS_RECEPTEUR: '0',
    BELUGA_RELAIS_ADRESSE: CENTRAL,
    BELUGA_RELAIS_DELAI_MS: '1000',
    BELUGA_USAGE_PANNE_DELAI_MS: '1500',
    BELUGA_USAGE_PANNE_INTERVALLE_MS: '1000',
  };
  let installation = demarrerDemonDEssai({ prefixe: 'verif-relais-installation-', port: PORT_INSTALLATION, garder: true, env: installationEnv });
  enfants.push(installation);
  if (!(await recepteur.attendrePort()) || !(await installation.attendrePort())) {
    noter('les deux démons jetables démarrent', false, [...recepteur.journal, ...installation.journal].join('').slice(-800));
    return;
  }

  /* 6. Hors de la machine qui reçoit, les portes du relais n'existent pas. */
  const ailleurs = await appel(INSTALLATION, '/relais/signe-de-vie', { corps: {} });
  noter('hors de la machine qui reçoit, « /relais » n’existe pas', ailleurs.statut === 404, String(ailleurs.statut));

  /* 1. Le premier signe de vie, sans adresse. */
  const dbRecepteur = () => new Database(path.join(recepteur.DATA, 'beluga.db'), { readonly: true });
  const lire = (sql, ...args) => {
    const db = dbRecepteur();
    try {
      return db.prepare(sql).all(...args);
    } finally {
      db.close();
    }
  };
  const premier = await attendreQue(() => lire('SELECT * FROM relais_installations')[0]);
  const identiteLocale = (() => {
    try {
      return fs.readFileSync(path.join(installation.DATA, 'relais-installation.json'), 'utf8');
    } catch {
      return 'aucune identité';
    }
  })();
  noter('le signe de vie de l’installation arrive chez le récepteur', !!premier, premier ? premier.id.slice(0, 8) : identiteLocale.slice(0, 300));
  noter('sans accord, aucune adresse de courriel ne part', !!premier && premier.courriel === null);
  noter('le secret est gardé haché, jamais en clair', !!premier && /^[0-9a-f]{64}$/.test(premier.secret_hache));
  noter('aucune adresse de machine n’est gardée', !!premier && !Object.values(premier).some((v) => typeof v === 'string' && /127\.0\.0\.1|::1/.test(v)));
  noter('le jour du signe est noté pour la fréquence d’usage', lire('SELECT * FROM relais_jours').length === 1);

  /* 2. Se faire passer pour une autre installation : refusé. */
  const usurpation = await appel(RECEPTEUR, '/relais/signe-de-vie', { corps: { installation: premier?.id, secret: 'a'.repeat(64), version: 'x' } });
  noter('un secret faux ne se fait pas passer pour l’installation', usurpation.statut === 403, String(usurpation.statut));
  const robot = await fetch(`${RECEPTEUR}/relais/signe-de-vie`, { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 HeadlessChrome/120' }, body: '{}' });
  noter('un robot est refusé', robot.status === 403, String(robot.status));

  /* 3. L'accord : l'installation redémarre avec « oui » et une adresse d'administrateur. */
  installation.nettoyer();
  await attendre(800);
  {
    const db = new Database(path.join(installation.DATA, 'beluga.db'));
    const brut = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}';
    const reglages = JSON.parse(brut);
    reglages.installation = { ...(reglages.installation ?? {}), partageDuCourriel: 'oui' };
    // Un assistant arrêté après « moteurs » : le parcours doit le dire (étape « domaine »).
    reglages.assistant = { statut: 'a-faire', etapes: { bienvenue: 'faite', moteurs: 'faite' } };
    db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(reglages));
    db.prepare("UPDATE users SET courriel = 'admin@exemple.com' WHERE role = 'admin'").run();
    db.close();
  }
  installation = demarrerDemonDEssai({ tmp: installation.TMP, port: PORT_INSTALLATION, depot: false, garder: true, env: installationEnv });
  enfants.push(installation);
  await installation.attendrePort();
  const avecAdresse = await attendreQue(() => lire("SELECT * FROM relais_installations WHERE courriel = 'admin@exemple.com'")[0]);
  noter('après « oui », l’adresse de l’administrateur part avec le signe de vie', !!avecAdresse);
  noter('la même installation est reconnue (aucun doublon)', lire('SELECT COUNT(*) AS n FROM relais_installations')[0].n === 1);

  const sessionRecepteur = ouvrirUneSession(recepteur.DATA);
  const ecran = await appel(RECEPTEUR, '/api/relais/installations?filtre=tous', { session: sessionRecepteur });
  noter(
    'l’écran « Installations » la montre, adresse comprise',
    ecran.statut === 200 && ecran.json?.resume?.total === 1 && ecran.json.lignes[0]?.courriel === 'admin@exemple.com',
    JSON.stringify(ecran.json?.resume ?? ecran.statut),
  );
  const payantes = await appel(RECEPTEUR, '/api/relais/installations?filtre=payants', { session: sessionRecepteur });
  const libres = await appel(RECEPTEUR, '/api/relais/installations?filtre=gratuites', { session: sessionRecepteur });
  const ancienNom = await appel(RECEPTEUR, '/api/relais/installations?filtre=open-source', { session: sessionRecepteur });
  noter('le filtre range l’installation du côté de la version gratuite', payantes.json?.resume?.total === 0 && libres.json?.resume?.total === 1);
  noter('l’ancien nom du filtre vaut « gratuites »', ancienNom.json?.resume?.total === 1);

  /* 4. Plus aucun ticket : le relais refuse, l'installation n'a plus de route pour en écrire. */
  const sessionInstallation = ouvrirUneSession(installation.DATA);
  const refuse = await appel(RECEPTEUR, '/relais/ticket', { corps: { titre: 'Le terminal se ferme', message: 'Bonjour.' } });
  noter('le relais refuse un ticket, en disant d’aller vers l’offre hébergée', refuse.statut === 410 && /offre hébergée/.test(refuse.json?.erreur ?? ''), JSON.stringify(refuse));
  const routeRetiree = await appel(INSTALLATION, '/api/relais/ticket', { session: sessionInstallation, corps: { titre: 'x', message: 'y' } });
  noter('l’installation n’a plus de route pour écrire un ticket', routeRetiree.json?.ok === undefined && routeRetiree.json?.raison === undefined, `${routeRetiree.statut} ${JSON.stringify(routeRetiree.json)}`);
  noter('aucun ticket n’est rangé', lire('SELECT COUNT(*) AS n FROM relais_tickets')[0].n === 0);

  const etat = await appel(INSTALLATION, '/api/relais/etat', { session: sessionInstallation });
  noter('l’installation se sait jointe à l’équipe Beluga', etat.json?.joint === true && etat.json?.recepteur === false, JSON.stringify(etat.json));

  /* 8. Le rapport d'usage anonyme, envoyé en silence au central. */
  noter('l’installation ne dit rien du rapport (ni numéro, ni partage)', etat.json?.partage === undefined && etat.json?.numero === undefined, JSON.stringify(etat.json));
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1';
  const canal = new WebSocket(`ws://127.0.0.1:${PORT_INSTALLATION}/ws`, {
    headers: { cookie: sessionInstallation.cookie, 'cf-ipcountry': 'FR', 'user-agent': IPHONE },
  });
  const canalOuvert = await new Promise((r) => {
    canal.once('open', () => r(true));
    canal.once('error', () => r(false));
    setTimeout(() => r(false), 10_000);
  });
  noter('une personne se connecte à l’installation depuis la France', canalOuvert);
  if (canalOuvert) {
    canal.send(JSON.stringify({ id: 'u1', cmd: { type: 'project.list' } }));
    await attendre(600);
  }
  const mesures = await appel(INSTALLATION, '/api/usage', {
    session: sessionInstallation,
    entetes: { 'user-agent': IPHONE },
    corps: { langue: 'fr', langueNavigateur: 'fr-FR', ecran: '390x844', installee: true, theme: 'clair', ouvertures: [{ nom: 'tableau', ms: 420 }, { nom: 'statistiques', ms: 900 }], zones: { tableau: 120, conversation: 60 }, coupures: 1 },
  });
  noter('l’écran envoie ses mesures (écrans, zones, profil)', mesures.statut === 200 && mesures.json?.ok === true, JSON.stringify(mesures.json));
  const avis = await appel(INSTALLATION, '/api/usage/avis', { session: sessionInstallation, corps: { note: 8 } });
  noter('plus aucune porte pour une note de satisfaction', avis.json?.ok !== true && avis.json?.due === undefined, String(avis.statut));
  const panne = { source: 'fenetre', message: 'x is not a function', pile: 'TypeError: x is not a function\n    at f (/home/ana/beluga/web/src/app.tsx:10:3)' };
  await appel(INSTALLATION, '/api/erreur', { session: sessionInstallation, corps: panne });
  // Le rapport parti au démarrage était vide : on attend celui que la panne fait repartir.
  const recu = await attendreQue(() => rapportsRecus.find((r) => r.rapport.erreurs?.length), 30_000);
  noter('le rapport d’usage du jour arrive au central', !!recu, recu ? '' : installation.journal.join('').split('\n').filter((l) => /usage|relais|ERROR/.test(l)).slice(-8).join(' | '));
  noter('le récepteur de l’application ne range plus aucun rapport', !lire("SELECT name FROM sqlite_master WHERE name = 'relais_rapports'").length);
  const donnees = recu?.rapport ?? {};
  noter('le rapport porte le numéro de l’installation', donnees.installation === premier?.id);
  const personneFr = donnees.personnes?.find((p) => p.pays === 'FR');
  noter('la personne est comptée en France', !!personneFr && donnees.paysUtilisateurs?.FR >= 1, JSON.stringify(donnees.paysUtilisateurs));
  noter('elle est un numéro anonyme, avec sa langue et son appareil', !!personneFr && /^[0-9a-f]{12}$/.test(personneFr.numero) && personneFr.langue === 'fr' && personneFr.appareil === 'telephone', JSON.stringify(personneFr));
  noter('la machine et sa santé sont décrites', !!donnees.machine?.systeme && donnees.machine?.processeurs > 0 && typeof donnees.sante?.disquePct === 'number', JSON.stringify(donnees.machine).slice(0, 160));
  noter('les gestes, écrans, zones et la rapidité sont mesurés', donnees.gestes?.['project.list'] >= 1 && donnees.ecrans?.tableau === 1 && donnees.zones?.tableau === 120 && donnees.rapidite?.ecrans?.statistiques?.p50 === 900);
  noter('le parcours dit l’assistant arrêté à « domaine »', donnees.parcours?.assistant === 'a-faire' && donnees.parcours?.etapeArret === 'domaine', JSON.stringify(donnees.parcours));
  noter('les projets ne sont qu’un genre et des langages', Array.isArray(donnees.projets?.liste) && donnees.projets.liste.every((p) => Object.keys(p).sort().join() === 'genre,langages,services'));
  noter('le journal horodaté part, sans contenu', Array.isArray(donnees.journal) && donnees.journal.length > 0 && donnees.journal.every((e) => Object.keys(e).every((k) => ['t', 'p', 'e', 'z'].includes(k))));
  noter('aucun avis ne part', Array.isArray(donnees.satisfaction) && donnees.satisfaction.length === 0);
  const panneRecue = donnees.erreurs?.find((e) => /x is not a function/.test(e.message));
  noter('la panne part, nettoyée de son chemin', !!panneRecue && !/\/home\/ana/.test(JSON.stringify(panneRecue)), JSON.stringify(panneRecue).slice(0, 200));
  const nomsDeProjets = (() => {
    const db = new Database(path.join(installation.DATA, 'beluga.db'), { readonly: true });
    try {
      return db.prepare('SELECT data FROM projects').all().map((r) => JSON.parse(r.data)).flatMap((p) => [p.name, p.path]).filter((v) => v && v.length > 3);
    } finally {
      db.close();
    }
  })();
  const toutLeRecu = rapportsRecus.map((r) => r.brut).join('\n');
  noter('aucun nom de projet, chemin ni adresse ne part', !nomsDeProjets.some((n) => toutLeRecu.includes(n)) && !/admin@exemple\.com|127\.0\.0\.1|\/home\/ana/.test(toutLeRecu), nomsDeProjets.find((n) => toutLeRecu.includes(n)) ?? '');
  const envoye = (() => {
    const db = new Database(path.join(installation.DATA, 'beluga.db'), { readonly: true });
    try {
      return db.prepare('SELECT COUNT(*) AS n FROM usage_local WHERE envoye_le IS NOT NULL').get().n;
    } finally {
      db.close();
    }
  })();
  noter('l’installation note la journée comme reçue', envoye >= 1);
  canal.close();

  /* 9. Une installation EXISTANTE, mise à jour : même identité, journées en retard rattrapées. */
  const versionVue = lire('SELECT version FROM relais_installations WHERE id = ?', premier?.id)[0]?.version ?? '';
  noter('la version de l’installation n’est jamais vide', /^\d{4}-\d{2}-\d{2}( [0-9a-f]{7,})?$/.test(versionVue), JSON.stringify(versionVue));
  const ilYA = (jours) => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10);
  const enRetard = [ilYA(3), ilYA(2)];
  const reprendre = async (avant) => {
    installation.nettoyer();
    await attendre(800);
    avant?.();
    installation = demarrerDemonDEssai({ tmp: installation.TMP, port: PORT_INSTALLATION, depot: false, garder: true, env: installationEnv });
    enfants.push(installation);
    await installation.attendrePort();
  };
  const nonEnvoyes = () => {
    const db = new Database(path.join(installation.DATA, 'beluga.db'), { readonly: true });
    try {
      return db.prepare('SELECT jour FROM usage_local WHERE envoye_le IS NULL').all().map((r) => r.jour);
    } finally {
      db.close();
    }
  };
  const vuAvant = lire('SELECT derniere_vue FROM relais_installations WHERE id = ?', premier?.id)[0]?.derniere_vue ?? 0;
  // D'abord un central qui ne connaît pas encore « /relais/usage » (404) : rien ne se perd.
  centralRefuseLUsage = true;
  await reprendre(() => {
    const db = new Database(path.join(installation.DATA, 'beluga.db'));
    for (const jour of enRetard) {
      db.prepare('INSERT INTO usage_local (jour, donnees, envoye_le) VALUES (?, ?, NULL) ON CONFLICT(jour) DO UPDATE SET envoye_le = NULL').run(jour, JSON.stringify({ jour, demarrages: 1 }));
    }
    db.close();
  });
  const revu = await attendreQue(() => (lire('SELECT derniere_vue FROM relais_installations WHERE id = ?', premier?.id)[0]?.derniere_vue ?? 0) > vuAvant);
  await attendre(1500);
  noter('après mise à jour, l’installation se signale sous la MÊME identité', !!revu && lire('SELECT COUNT(*) AS n FROM relais_installations')[0].n === 1);
  noter('un central sans réception d’usage (404) ne fait rien perdre', enRetard.every((j) => nonEnvoyes().includes(j)), JSON.stringify(nonEnvoyes()));
  // Puis le central mis à jour : le redémarrage suivant rattrape les journées en retard.
  centralRefuseLUsage = false;
  await reprendre();
  const rattrapes = await attendreQue(() => enRetard.every((j) => rapportsRecus.some((r) => r.rapport.jour === j)) || null, 30_000);
  noter('les journées en retard arrivent au central', !!rattrapes, JSON.stringify(rapportsRecus.map((r) => r.rapport.jour)));
  noter('et sont notées comme reçues', !enRetard.some((j) => nonEnvoyes().includes(j)), JSON.stringify(nonEnvoyes()));

  /* 7. Les écrans, dans un vrai navigateur. */
  const SHOTS = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'verification');
  fs.mkdirSync(SHOTS, { recursive: true });
  navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH' });
  await contexte.addCookies([{ name: 'beluga_session', value: sessionRecepteur.cookie.split('=')[1], url: RECEPTEUR, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${RECEPTEUR}/#statistiques`, { waitUntil: 'domcontentloaded' });
  const rubrique = page.locator('[data-stats-groupe-rubrique="installations"]');
  const rubriqueVue = await rubrique.waitFor({ state: 'visible', timeout: 40_000 }).then(() => true).catch(() => false);
  noter('les statistiques de la machine qui reçoit ont la rubrique « Installations de Beluga »', rubriqueVue);
  if (rubriqueVue) await rubrique.click();
  const liste = await page.locator('[data-installations-liste] [data-installation]').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  noter('l’écran « Installations » liste l’installation', liste);
  noter('son adresse acceptée y figure', (await page.locator('[data-installation-courriel]').first().textContent({ timeout: 10_000 }).catch(() => ''))?.includes('admin@exemple.com') ?? false);
  await page.screenshot({ path: path.join(SHOTS, 'relais-installations.png') });
  await page.locator('[data-installations-filtre-choix="payants"]').click({ timeout: 10_000 }).catch(() => undefined);
  const vide = await page.locator('[data-installations-vide]').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  noter('le filtre « Payantes » écarte l’installation gratuite', vide);

  await page.goto(`${RECEPTEUR}/#espace`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-espace-haiko]').first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => undefined);
  const texteMessagerie = (await page.locator('body').textContent()) ?? '';
  noter('la messagerie n’a plus de filtre payants / gratuits', !/Clients payants|Open source/.test(texteMessagerie));
  await page.screenshot({ path: path.join(SHOTS, 'relais-messagerie.png') });

  /* 8 ter. Côté installation, rien ne parle du rapport : ni annonce, ni interrupteur, ni question. */
  const sessionVue = ouvrirUneSession(installation.DATA);
  await contexte.addCookies([{ name: 'beluga_session', value: sessionVue.cookie.split('=')[1], url: INSTALLATION, httpOnly: true, sameSite: 'Lax' }]);
  const pageInstallation = await contexte.newPage();
  pageInstallation.on('pageerror', (e) => erreurs.push(String(e)));
  await pageInstallation.goto(`${INSTALLATION}/`, { waitUntil: 'domcontentloaded' });
  await pageInstallation.waitForTimeout(6000);
  const texte = (await pageInstallation.locator('body').textContent()) ?? '';
  const traces = await pageInstallation.locator('[data-partage-statistiques], [data-ce-qui-part], [data-identifiant-installation]').count();
  noter('l’installation n’affiche ni annonce, ni interrupteur, ni question du mois', traces === 0 && !/Recommanderiez-vous|Statistiques d’usage anonymes/.test(texte), `${traces} trace(s)`);
  noter('aucune erreur de page', erreurs.length === 0, erreurs[0] ?? '');
}

let navigateur;

try {
  await main();
} catch (erreur) {
  noter('le contrôle va au bout', false, String(erreur?.stack ?? erreur));
} finally {
  await navigateur?.close().catch(() => undefined);
  fauxCentral?.close();
  for (const enfant of enfants) {
    try {
      enfant.nettoyer();
    } catch {
      /* déjà rangé */
    }
  }
  for (const enfant of enfants) fs.rmSync(enfant.TMP, { recursive: true, force: true });
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies.`);
process.exit(echecs ? 1 : 0);
