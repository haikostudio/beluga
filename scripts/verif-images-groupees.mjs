#!/usr/bin/env node
/**
 * LES IMAGES GROUPÉES DANS LE FIL, ET LE CARROUSEL D'UN CHOIX (carte « Images groupées dans le fil », 19/11/2026,
 * capture #347e), DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-images-groupees.mjs
 *   (BELUGA_VERIF_CAPTURES=<dossier> pour garder les captures 1440 / 390, clair et sombre)
 *
 * Démon d'essai sur une base neuve, port à soi, aucun moteur lancé. Une carte dont l'agent a joint CINQ images
 * d'affilée (une commande entre deux), puis écrit une phrase, puis joint DEUX images, puis DOUZE ; et une question
 * qui attend, dont un choix porte TROIS images. Ce qui est vérifié :
 *   1. trois paquets dans le fil (5, 2 puis 12), la phrase au pluriel, la commande intercalée rendue après le paquet ;
 *   2. en pile, trois cartes se voient ; au survol de la souris, les images s'étalent À LEUR TAILLE PLEINE (224 × 140,
 *      carte « Images du fil en grand format »), sans se chevaucher, et la hauteur du paquet ne bouge pas ; la rangée
 *      de douze déborde et défile à la molette (le fil, lui, ne bouge pas), revient au début en quittant le survol ;
 *      celle de deux ne déborde pas et n'a aucun fondu ;
 *   3. un clic ouvre la visionneuse sur CE paquet seulement (« n / 5 »), qui boucle dans le paquet ;
 *   4. le choix à trois images feuillette son carrousel aux flèches, SANS se cocher ni ouvrir l'aperçu ; un clic sur
 *      l'image ouvre l'aperçu sur ses trois images ;
 *   5. au doigt (390 × 844, vrais événements tactiles) — carte « Paquet d'images déplié sur mobile » : le premier
 *      toucher ÉTALE la pile sans ouvrir l'aperçu ; la ligne défile au doigt sans rien ouvrir ; un toucher dans le
 *      paquet (phrase) ou un défilement vertical du fil la laisse ouverte ; un toucher sur la troisième image ouvre
 *      l'aperçu « 3 / 5 » ; le refermer garde la ligne ouverte ; un toucher AILLEURS la replie, revenue au début ;
 *      la page ne déborde jamais en largeur. Le glissé change d'image du carrousel sans cocher.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7271);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-images-groupees-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET = 'p-images-groupees';
const CARTE = 'c-images-groupees';
const AGENT = 'a-images-groupees';
const t0 = Date.now() - 600_000;

/* Une image PNG d'une couleur, avec une bande plus claire en haut : la pile se lit. */
function png(largeur, hauteur, [r, g, b]) {
  const crc = (buf) => {
    let c = ~0;
    for (const o of buf) {
      c ^= o;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const morceau = (type, donnees) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(donnees.length);
    const t = Buffer.from(type);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, donnees])));
    return Buffer.concat([l, t, donnees, c]);
  };
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8;
  entete[9] = 2;
  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const clair = y < hauteur / 4;
    const px = clair ? [Math.min(255, r + 70), Math.min(255, g + 70), Math.min(255, b + 70)] : [r, g, b];
    lignes.push(Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: largeur }, () => px).flat())]));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', entete), morceau('IDAT', zlib.deflateSync(Buffer.concat(lignes))), morceau('IEND', Buffer.alloc(0))]);
}

const COULEURS = [[200, 60, 60], [60, 150, 80], [60, 90, 200], [190, 140, 40], [140, 70, 170], [40, 150, 160], [170, 90, 60]];

if (!(await attendrePort())) {
  console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

{
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), t0, Date.now() + 3_600_000, 'verif-images-groupees');
  const projet = { id: PROJET, name: 'Essai images groupées', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: t0, updatedAt: t0 };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, DEPOT, JSON.stringify(projet), t0, t0);
  db.close();
}

/* Les sept aperçus que l'agent joint, sur le disque du projet. */
const APERCUS = path.join(DEPOT, 'apercus');
fs.mkdirSync(APERCUS, { recursive: true });
/* Sept aperçus, puis douze écrans (paquet qui déborde du fil une fois étalé). */
const chemins = Array.from({ length: 19 }, (_, i) => COULEURS[i % COULEURS.length]).map((couleur, i) => {
  const chemin = path.join(APERCUS, `apercu-${i + 1}.png`);
  fs.writeFileSync(chemin, png(320, 200, couleur));
  return chemin;
});

/* Trois images qui composent UN choix de la question, et une image seule pour l'autre choix. */
process.env.BELUGA_DATA = DATA;
const { joindreUnFichier } = await import(pathToFileURL(path.join(RACINE, 'server/dist/joindre-fichier.js')).href);
const fichiers = path.join(TMP, 'fichiers');
fs.mkdirSync(fichiers, { recursive: true });
const poser = async (nom, couleur) => {
  const chemin = path.join(fichiers, nom);
  fs.writeFileSync(chemin, png(200, 200, couleur));
  const r = await joindreUnFichier({ projectId: PROJET, agentId: AGENT, cardId: CARTE, fichier: chemin, nom, deLAgent: true });
  if (!r.ok) throw new Error(`pièce refusée : ${r.refus}`);
  return r.attachment;
};
const serie = [await poser('serie-1.png', COULEURS[0]), await poser('serie-2.png', COULEURS[1]), await poser('serie-3.png', COULEURS[2])];
const seule = await poser('seule.png', COULEURS[4]);

{
  const db = new Database(path.join(DATA, 'beluga.db'));
  const run = { engine: 'claude', thinking: 'none', mode: 'direct' };
  const agent = { id: AGENT, projectId: PROJET, cardId: CARTE, role: 'cadrage', title: 'Essai', run, status: 'idle', createdAt: t0, updatedAt: t0 };
  db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, 'cadrage', 'idle', ?, ?, ?)`).run(AGENT, PROJET, CARTE, JSON.stringify(agent), t0, t0);
  const carte = {
    id: CARTE, projectId: PROJET, title: 'Carte d’essai — images groupées', description: 'Carte posée par un contrôle automatique.', labels: [], column: 'planned', position: 1, origin: 'user',
    run, excludedFromDeploy: false, horsTache: false, scheduling: { asap: false, attempts: 0, restarts: 0 }, createdAt: t0, updatedAt: t0,
  };
  db.prepare(`INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, agent_id) VALUES (?, ?, 'planned', 1, ?, ?, ?, ?, ?)`).run(CARTE, PROJET, carte.title, JSON.stringify(carte), t0, t0, AGENT);
  db.prepare('UPDATE cards SET conversation_agent_id = ? WHERE id = ?').run(AGENT, CARTE);
  const demande = { id: 'm-demande', agentId: AGENT, role: 'user', content: 'Montre-moi la fiche en images.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: t0 + 1000 };
  db.prepare("INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, 'user', ?, ?)").run(demande.id, AGENT, JSON.stringify(demande), demande.createdAt);
  const message = {
    id: 'm-question', agentId: AGENT, role: 'assistant', content: 'Voici les deux versions.', steps: [], todos: [], proposals: [], downloads: [], attachments: [], streaming: false, createdAt: t0 + 60_000,
    questions: [{
      id: 'q-serie', question: 'Quelle version de la fiche gardez-vous ?', kind: 'single',
      options: [
        { id: 'o-serie', label: 'La série en trois visuels', image: serie[0].id, images: serie.map((p) => p.id) },
        { id: 'o-seule', label: 'Un seul grand visuel', image: seule.id },
      ],
      allowFreeText: true, answerAttachments: [],
    }],
  };
  db.prepare("INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, 'assistant', ?, ?)").run(message.id, AGENT, JSON.stringify(message), message.createdAt);
  const ligne = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (@id, @card_id, @rang, 'cadrage', @nature, @at, @agent_id, 'cadrage', 'tour-images', @libelle, @outil, @params, @resultat, 1, 300, NULL, NULL)`,
  );
  let rang = 0;
  const trace = (partiel) => {
    rang += 1;
    ligne.run({ id: `j-${rang}`, card_id: CARTE, rang, nature: 'requete', at: t0 + 1000 + rang * 2000, agent_id: AGENT, libelle: '', outil: null, params: null, resultat: null, ...partiel });
  };
  const joindre = (i, label) =>
    trace({
      outil: 'mcp__beluga__attach_file',
      libelle: `Capture jointe : apercus/apercu-${i + 1}.png`,
      params: JSON.stringify({ path: chemins[i], label }),
      resultat: `Fichier joint à la conversation : apercu-${i + 1}.png (1 ko).`,
    });
  trace({ nature: 'jalon', libelle: 'Demande', resultat: 'Montre-moi la fiche en images.' });
  trace({ nature: 'jalon', libelle: 'Note de l’agent', resultat: 'Voici les cinq aperçus de la fiche, dans l’ordre.' });
  joindre(0, 'Aperçu 1 — Historique');
  joindre(1, 'Aperçu 2 — Compresser');
  trace({ outil: 'Bash', libelle: 'Bash', params: JSON.stringify({ command: 'ls apercus', description: 'Lister les aperçus' }), resultat: 'ok' });
  joindre(2, 'Aperçu 3 — Texte d’une capture');
  joindre(3, 'Aperçu 4 — Recherche');
  joindre(4, 'Aperçu 5 — Convertir');
  trace({ nature: 'jalon', libelle: 'Note de l’agent', resultat: 'Et les deux en-têtes possibles.' });
  joindre(5, 'En-tête A');
  joindre(6, 'En-tête B');
  trace({ nature: 'jalon', libelle: 'Note de l’agent', resultat: 'Et les douze écrans de l’application.' });
  for (let i = 7; i < 19; i++) joindre(i, `Écran ${i - 6}`);
  trace({
    outil: 'mcp__beluga__ask_user', libelle: 'mcp__beluga__ask_user',
    params: JSON.stringify({ question: 'Quelle version de la fiche gardez-vous ?', options: [{ label: 'La série en trois visuels' }, { label: 'Un seul grand visuel' }] }), resultat: null,
  });
  db.close();
}
await new Promise((r) => setTimeout(r, 1200));

const texteDuCompteur = (page) =>
  page.evaluate(() => {
    const r = [...document.querySelectorAll('[data-feuilletage-repere]')].pop();
    return (r?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });

/** La question qui attend s'ouvre depuis sa forme compacte du pied, si besoin. */
async function ouvrirLaQuestion(page, toucher) {
  const grille = page.locator('[data-choix-en-images]').first();
  const compacte = page.locator('[data-question-compacte] [data-repondre-question]').first();
  await Promise.race([grille.waitFor({ state: 'visible', timeout: 30_000 }), compacte.waitFor({ state: 'visible', timeout: 30_000 })]).catch(() => {});
  if (!(await grille.isVisible().catch(() => false)) && (await compacte.count())) await (toucher ? compacte.tap() : compacte.click());
  await grille.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  return grille;
}

let navigateur;
try {
  navigateur = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const [largeur, hauteur, appareil] of [[1440, 900, 'ordinateur'], [390, 844, 'telephone']]) {
    for (const theme of ['light', 'dark']) {
      const db = new Database(path.join(DATA, 'beluga.db'));
      db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('theme', JSON.stringify(theme === 'dark' ? 'sombre' : 'clair'), Date.now());
      db.close();
      const telephone = appareil === 'telephone';
      const contexte = await navigateur.newContext({
        viewport: { width: largeur, height: hauteur }, locale: 'fr-CH', colorScheme: theme, serviceWorkers: 'block',
        ...(telephone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
      });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      const suffixe = `${appareil}-${theme === 'dark' ? 'sombre' : 'clair'}`;
      const capture = async (nom, cible = page) => CAPTURES && cible.screenshot({ path: path.join(CAPTURES, `${nom}-${suffixe}.png`) });
      const verifier = theme === 'light';

      await page.goto(`${BASE}/#projet/${PROJET}/tache/${CARTE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const paquets = page.locator('[data-paquet-images]');
      await paquets.first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
      const premier = paquets.first();
      /* Sur téléphone, la feuille de la question couvre le fil : on la laisse fermée pour le paquet. */
      await premier.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(900);
      await capture('paquet-pile', premier.locator('xpath=ancestor::li[1]'));

      if (verifier) {
        const nombres = await paquets.evaluateAll((n) => n.map((e) => e.getAttribute('data-paquet-images')));
        noter(`1. [${appareil}] trois paquets dans le fil, de 5, 2 puis 12 images`, JSON.stringify(nombres) === '["5","2","12"]', JSON.stringify(nombres));
        const phrase = (await premier.locator('[data-paquet-phrase]').textContent()) ?? '';
        noter(`1. [${appareil}] la phrase du paquet est au pluriel`, phrase.includes('Je joins 5 fichiers à ma réponse.'), phrase);
        const ordre = await page.evaluate(() => {
          const p = document.querySelector('[data-paquet-images]');
          const g = [...document.querySelectorAll('[data-groupe-d-actions]')].find((n) => (n.textContent ?? '').includes('commande'));
          return p && g ? Math.round(g.getBoundingClientRect().top - p.getBoundingClientRect().bottom) : null;
        });
        noter(`1. [${appareil}] la commande intercalée se lit après le paquet`, ordre !== null && ordre >= 0, String(ordre));
        const pile = await premier.locator('[data-paquet-carte]').evaluateAll((n) => n.filter((e) => getComputedStyle(e).opacity !== '0').length);
        noter(`2. [${appareil}] en pile, trois cartes se voient`, pile === 3, String(pile));
      }

      const cadre = premier.locator('[data-paquet-cadre]');
      const hauteurPile = (await cadre.boundingBox())?.height ?? 0;
      if (!telephone) {
        await cadre.hover({ position: { x: 40, y: 40 } });
        await page.waitForTimeout(700);
        await capture('paquet-etale', premier.locator('xpath=ancestor::li[1]'));
        if (verifier) {
          noter('2. au survol de la souris, le paquet s’étale', (await premier.getAttribute('data-paquet-etale')) === '1');
          const geo = await cadre.evaluate((c) => {
            const bc = c.getBoundingClientRect();
            const cartes = [...c.querySelectorAll('[data-paquet-carte]')].map((e) => e.getBoundingClientRect());
            const pleine = cartes.every((r) => Math.abs(r.width - 224) < 1 && Math.abs(r.height - 140) < 1);
            const sansChevauchement = cartes.every((r, i) => i === 0 || r.left >= cartes[i - 1].right - 0.5);
            const dansLaHauteur = cartes.every((r) => r.top >= bc.top - 0.5 && r.bottom <= bc.bottom + 0.5);
            return { pleine, sansChevauchement, dansLaHauteur, n: cartes.length, h: bc.height };
          });
          noter('2. étalées, les cinq images gardent leur taille pleine (224 × 140), sans se chevaucher', geo.pleine && geo.sansChevauchement && geo.dansLaHauteur && geo.n === 5, JSON.stringify(geo));
          noter('2. la hauteur du paquet ne bouge pas au survol', Math.abs(geo.h - hauteurPile) < 0.5, `${hauteurPile} → ${geo.h}`);
        }

        /* LE PAQUET DE DEUX : étalé, il tient dans le fil — aucun débord, aucun fondu. */
        const deux = paquets.nth(1);
        await deux.scrollIntoViewIfNeeded().catch(() => {});
        await deux.locator('[data-paquet-cadre]').hover({ position: { x: 40, y: 40 } });
        await page.waitForTimeout(700);
        if (verifier) {
          const etat = await deux.evaluate((p) => {
            const z = p.querySelector('[data-paquet-rangee]');
            const voiles = [...p.querySelectorAll('[data-voile-allume="oui"]')].length;
            return { deborde: z.scrollWidth - z.clientWidth, voiles, etale: p.getAttribute('data-paquet-etale') };
          });
          noter('2. étalé, le paquet de deux tient dans le fil, sans débord ni fondu', etat.etale === '1' && etat.deborde <= 1 && etat.voiles === 0, JSON.stringify(etat));
        }

        /* LE PAQUET DE DOUZE : étalé, il déborde ; la molette fait défiler la rangée, pas le fil. */
        const douze = paquets.nth(2);
        await douze.scrollIntoViewIfNeeded().catch(() => {});
        const cadreDouze = douze.locator('[data-paquet-cadre]');
        const hauteurDouze = (await cadreDouze.boundingBox())?.height ?? 0;
        await cadreDouze.hover({ position: { x: 60, y: 60 } });
        await page.waitForTimeout(900);
        await capture('paquet-douze-etale', douze.locator('xpath=ancestor::li[1]'));
        const filAvant = await page.evaluate(() => document.querySelector('[data-fil="parcours"]')?.scrollTop ?? -1);
        const etatDouze = await douze.evaluate((p) => {
          const z = p.querySelector('[data-paquet-rangee]');
          const cartes = [...p.querySelectorAll('[data-paquet-carte]')].map((e) => e.getBoundingClientRect());
          const fin = p.querySelector('[data-voile-defilement="horizontal-fin"]')?.getAttribute('data-voile-allume');
          return {
            deborde: z.scrollWidth - z.clientWidth,
            pleine: cartes.every((r) => Math.abs(r.width - 224) < 1 && Math.abs(r.height - 140) < 1),
            h: p.querySelector('[data-paquet-cadre]').getBoundingClientRect().height,
            fin,
          };
        });
        if (verifier) {
          noter('2. étalé, le paquet de douze garde la taille pleine et déborde du fil', etatDouze.pleine && etatDouze.deborde > 200, JSON.stringify(etatDouze));
          noter('2. …avec un fondu au bord droit tant qu’il reste des images', etatDouze.fin === 'oui', String(etatDouze.fin));
          noter('2. …et sa hauteur ne bouge pas', Math.abs(etatDouze.h - hauteurDouze) < 0.5, `${hauteurDouze} → ${etatDouze.h}`);
        }
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(600);
        await capture('paquet-douze-defile', douze.locator('xpath=ancestor::li[1]'));
        const apresMolette = await douze.evaluate((p) => {
          const z = p.querySelector('[data-paquet-rangee]');
          return { gauche: Math.round(z.scrollLeft), debut: p.querySelector('[data-voile-defilement="horizontal-debut"]')?.getAttribute('data-voile-allume') };
        });
        const filApres = await page.evaluate(() => document.querySelector('[data-fil="parcours"]')?.scrollTop ?? -1);
        if (verifier) {
          noter('2. la molette fait défiler la rangée de douze à l’horizontale', apresMolette.gauche > 0 && apresMolette.debut === 'oui', JSON.stringify(apresMolette));
          noter('2. …sans faire défiler le fil', Math.abs(filApres - filAvant) < 1, `${filAvant} → ${filApres}`);
        }
        await page.mouse.move(5, 5);
        await page.waitForTimeout(900);
        if (verifier) {
          const repli = await douze.evaluate((p) => ({ gauche: Math.round(p.querySelector('[data-paquet-rangee]').scrollLeft), etale: p.getAttribute('data-paquet-etale') }));
          noter('2. en quittant le survol, la rangée revient au début et se replie en pile', repli.gauche === 0 && repli.etale === '0', JSON.stringify(repli));
        }
        await premier.scrollIntoViewIfNeeded().catch(() => {});
        await cadre.hover({ position: { x: 40, y: 40 } });
        await page.waitForTimeout(700);
        await premier.locator('[data-paquet-carte="2"]').click();
      } else {
        /* AU DOIGT, par de vrais événements tactiles (CDP) : un toucher, un glissé, un défilement. */
        const cdp = await contexte.newCDPSession(page);
        const glisser = async (x0, y0, dx, dy) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
          for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 8, y: y0 + (dy * i) / 8 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await page.waitForTimeout(600);
        };
        const toucher = async (x, y) => {
          await page.touchscreen.tap(x, y);
          await page.waitForTimeout(700);
        };
        const ouvertes = () => page.locator('[data-feuilletage-repere]').count();
        const etat = () =>
          premier.evaluate((p) => ({
            etale: p.getAttribute('data-paquet-etale'),
            gauche: Math.round(p.querySelector('[data-paquet-rangee]').scrollLeft),
            deborde: document.documentElement.scrollWidth - window.innerWidth,
          }));
        let b = await cadre.boundingBox();
        await toucher(b.x + 60, b.y + 60);
        const apresToucher = await etat();
        if (verifier) {
          noter('5. au doigt, le premier toucher étale le paquet en ligne', apresToucher.etale === '1', JSON.stringify(apresToucher));
          noter('5. …sans ouvrir l’aperçu', (await ouvertes()) === 0);
          const geo = await cadre.evaluate((c) => {
            const bc = c.getBoundingClientRect();
            const cartes = [...c.querySelectorAll('[data-paquet-carte]')].map((e) => e.getBoundingClientRect());
            return { pleine: cartes.every((r) => Math.abs(r.width - 224) < 1 && Math.abs(r.height - 140) < 1), h: bc.height };
          });
          noter('5. étalées au doigt, les images gardent leur taille pleine et la hauteur ne bouge pas', geo.pleine && Math.abs(geo.h - hauteurPile) < 0.5, JSON.stringify(geo));
        }
        await capture('paquet-etale', premier.locator('xpath=ancestor::li[1]'));
        b = await cadre.boundingBox();
        await glisser(b.x + b.width * 0.7, b.y + 70, -180, 0);
        const apresGlisse = await etat();
        await capture('paquet-glisse', premier.locator('xpath=ancestor::li[1]'));
        if (verifier) {
          noter('5. la ligne défile au doigt', apresGlisse.gauche > 40 && apresGlisse.etale === '1', JSON.stringify(apresGlisse));
          noter('5. …sans ouvrir l’aperçu', (await ouvertes()) === 0);
        }
        const phrase = await premier.locator('[data-paquet-phrase]').boundingBox();
        await toucher(phrase.x + 20, phrase.y + phrase.height / 2);
        if (verifier) noter('5. un toucher dans le paquet (sa phrase) le laisse ouvert', (await etat()).etale === '1');
        /* Un défilement vertical du fil parti HORS du paquet n'est pas un toucher ailleurs. */
        b = await cadre.boundingBox();
        const yHors = b.y + b.height + 60 < 780 ? b.y + b.height + 60 : Math.max(120, b.y - 60);
        await glisser(200, yHors, 0, -120);
        if (verifier) noter('5. un défilement du fil hors du paquet le laisse ouvert', (await etat()).etale === '1', JSON.stringify(await etat()));
        await premier.locator('[data-paquet-carte="2"]').scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        const carte2 = await premier.locator('[data-paquet-carte="2"]').boundingBox();
        await toucher(carte2.x + carte2.width / 2, carte2.y + carte2.height / 2);
      }
      const fenetre = page.locator('[role="dialog"]').last();
      await fenetre.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const compteur = await texteDuCompteur(page);
      await capture('paquet-apercu');
      if (verifier) {
        noter(`3. [${appareil}] ${telephone ? 'un toucher sur la troisième image étalée' : 'un clic'} ouvre la visionneuse sur CE paquet seulement`, compteur === '3 / 5', compteur);
        if (!telephone) {
          for (let i = 0; i < 3; i++) {
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(450);
          }
          const apres = await texteDuCompteur(page);
          noter('3. la visionneuse boucle dans le paquet (3 → 4 → 5 → 1)', apres === '1 / 5', apres);
        }
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if (telephone) {
        const etat = () =>
          premier.evaluate((p) => ({
            etale: p.getAttribute('data-paquet-etale'),
            gauche: Math.round(p.querySelector('[data-paquet-rangee]').scrollLeft),
            deborde: document.documentElement.scrollWidth - window.innerWidth,
          }));
        if (verifier) noter('5. l’aperçu refermé, la ligne reste étalée', (await etat()).etale === '1', JSON.stringify(await etat()));
        /* Un toucher AILLEURS : sur la note de l'agent qui précède le paquet, ou sous lui. */
        await premier.scrollIntoViewIfNeeded().catch(() => {});
        const b = await premier.boundingBox();
        const y = b.y > 140 ? b.y - 30 : b.y + b.height + 30;
        await page.touchscreen.tap(30, y);
        await page.waitForTimeout(900);
        const replie = await etat();
        if (verifier) {
          noter('5. un toucher ailleurs replie la ligne, revenue au début', replie.etale === '0' && replie.gauche === 0, JSON.stringify(replie));
          noter('5. la page ne déborde jamais en largeur', replie.deborde <= 0, String(replie.deborde));
        }
      }

      /* 4. Le carrousel du choix à trois images */
      const grille = await ouvrirLaQuestion(page, telephone);
      const carrousel = grille.locator('[data-carrousel-du-choix]').first();
      await carrousel.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await carrousel.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);
      if (verifier) noter(`4. [${appareil}] le choix à trois images porte un carrousel, l’autre reste une image`, (await grille.locator('[data-carrousel-du-choix="3"]').count()) === 1 && (await grille.locator('[data-option-apercu]').count()) === 1);
      if (!telephone) {
        await carrousel.hover();
        await page.waitForTimeout(300);
        await carrousel.locator('[data-carrousel-fleche="suivante"]').click();
      } else {
        const boite = await carrousel.boundingBox();
        const cdp = await contexte.newCDPSession(page);
        const y = boite.y + boite.height / 2;
        /* Le glissé part de l'image, pas de la flèche de droite (qui arrête son geste : elle ne fait que tourner). */
        const x0 = boite.x + boite.width * 0.6;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
        for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * (boite.width * 0.11), y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.waitForTimeout(500);
      await capture('carrousel-du-choix', grille);
      if (verifier) {
        noter(`4. [${appareil}] ${telephone ? 'le glissé' : 'la flèche'} passe à l’image suivante`, (await carrousel.getAttribute('data-carrousel-rang')) === '1', await carrousel.getAttribute('data-carrousel-rang'));
        noter(`4. [${appareil}] …sans cocher le choix`, (await grille.locator('[data-option-retenue]').count()) === 0);
        noter(`4. [${appareil}] …ni ouvrir l’aperçu`, (await page.locator('[data-feuilletage-repere]').count()) === 0);
        const compteurTuile = ((await carrousel.locator('[data-carrousel-compteur]').textContent()) ?? '').replace(/\s+/g, ' ').trim();
        noter(`4. [${appareil}] le compteur de la tuile dit « 2 / 3 »`, compteurTuile === '2 / 3', compteurTuile);
      }
      if (!telephone) {
        const b = await carrousel.boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height * 0.35);
      } else {
        const b = await carrousel.boundingBox();
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height * 0.35);
      }
      await page.locator('[role="dialog"]').last().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const compteurChoix = await texteDuCompteur(page);
      await capture('carrousel-apercu');
      if (verifier) {
        noter(`4. [${appareil}] l’image du carrousel s’ouvre sur les trois images de ce choix`, compteurChoix === '2 / 3', compteurChoix);
        noter(`4. [${appareil}] …toujours sans cocher`, (await page.locator('[data-option-retenue]').count()) === 0);
        noter(`[${appareil}] aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      }
      await contexte.close();
    }
  }
} catch (erreur) {
  noter('le contrôle s’est déroulé jusqu’au bout', false, String(erreur?.message ?? erreur).slice(0, 400));
} finally {
  await navigateur?.close().catch(() => undefined);
}
const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passent.`);
process.exit(echecs.length ? 1 : 0);
