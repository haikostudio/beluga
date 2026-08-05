#!/usr/bin/env node
/**
 * Vérification, dans un VRAI navigateur, de la page « Tableau de bord » :
 * le bouton apparaît AU-DESSUS de « Projets » dans la colonne de gauche, un
 * clic remplace le Kanban et le volet de droite par la page sur toute la
 * largeur (colonne de gauche conservée), la page montre ses cinq blocs avec
 * des données, et sur téléphone elle reste lisible et se referme.
 *
 * Le démon en service tourne sur l'ANCIEN code, sans la commande
 * `stats.dashboard` : on répond à cette commande à la volée (enveloppe
 * WebSocket), tout le reste passe au vrai démon par le proxy du serveur de
 * développement.
 *
 *   HAIKODEV_URL=http://localhost:7099 node scripts/verif-tableau-de-bord.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.HAIKODEV_URL || 'http://localhost:7099';
// La racine se déduit du script (elle sert au repérage) ; mais la SESSION doit
// vivre dans la base du démon EN SERVICE, celui que le proxy du serveur de
// développement interroge sur 127.0.0.1:7070 — donc le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMON = process.env.HAIKODEV_DATA_ROOT || '/root/haikodev';
const SHOTS = `${DEMON}/data/verification`;

const base = () => {
  const require = createRequire(import.meta.url);
  return require(`${DEMON}/node_modules/better-sqlite3`)(`${DEMON}/data/haikodev.db`);
};
void RACINE;

/** Une session d'essai : la colonne « token » garde le SHA-256 du cookie. */
function poserSession() {
  const db = base();
  const cookie = crypto.randomBytes(24).toString('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(cookie).digest('hex'),
    maintenant,
    maintenant + 3600_000,
    'vérification tableau de bord',
  );
  return cookie;
}

const resultats = [];
function record(nom, ok, detail = '') {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    // Sinon c'est la version PUBLIÉE qui s'affiche, pas celle qu'on vérifie.
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: poserSession(), url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();

  // On répond à `stats.dashboard` à la volée. Le démon EN SERVICE tourne sur
  // l'ancien code : sa validation rejette la commande inconnue et n'envoie
  // AUCUN ack. On ne la transmet donc pas — on fabrique la réponse nous-mêmes,
  // en rappelant le `onmessage` du client avec un ack complet.
  await page.addInitScript(() => {
    const vrai = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      try {
        const message = JSON.parse(donnees);
        if (message?.cmd?.type === 'stats.dashboard') {
          const socket = this;
          setTimeout(() => {
            socket.onmessage?.({
              data: JSON.stringify({ type: 'ack', id: message.id, ok: true, data: donneesFabriquees() }),
            });
          }, 30);
          return; // on ne transmet pas au démon : il ne saurait pas répondre
        }
      } catch {
        /* message non JSON */
      }
      return vrai.call(this, donnees);
    };
    const donneesFabriquees = () => {
      const jour = (n) => {
        const d = new Date(Date.now() - n * 86400_000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const byDay = [];
      for (let i = 0; i < 20; i++) byDay.push({ day: jour(i), tokens: 5000 + Math.round(3000 * Math.abs(Math.sin(i))), seconds: 600 + i * 30, tasks: 1 + (i % 3) });
      return {
        byProject: [
          { projectId: 'p1', name: 'HaikoDev', tokens: 480000, seconds: 42000, tasks: 37 },
          { projectId: 'p2', name: 'Aikomail', tokens: 210000, seconds: 18000, tasks: 14 },
          { projectId: 'p3', name: 'Eloya', tokens: 90000, seconds: 7200, tasks: 6 },
        ],
        byDay,
        // Les deux parts sont MESURÉES, en points de pourcentage. La première
        // carte a le plus de jetons mais PAS la plus grosse part de semaine :
        // c'est ce qui prouve que le classement suit bien la semaine.
        byCard: [
          { cardId: 'c1', title: 'Refonte du volet des quotas', projectName: 'HaikoDev', column: 'done', quota5h: 9.5, quotaSemaine: 3.2, tokens: 42000, seconds: 3600, turns: 3 },
          { cardId: 'c2', title: 'Barre d’écriture mobile', projectName: 'Aikomail', column: 'deployable', quota5h: 2.1, quotaSemaine: 7.8, tokens: 18000, seconds: 1500, turns: 2 },
          { cardId: 'c3', title: 'Sans part de quota (ancienne tâche)', projectName: 'Eloya', column: 'done', quota5h: 0, quotaSemaine: 0, quotaEstime: 0.05, tokens: 9000, seconds: 900, turns: 1 },
        ],
      };
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  // Un tiroir de carte restauré peut recouvrir l'écran : on le referme.
  for (let essai = 0; essai < 3; essai++) {
    if (!(await page.locator('[data-state="open"][aria-hidden="true"]').count())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  /* ---------- 1. Le bouton est au-dessus de « Projets » ---------- */
  const bouton = page.locator('[data-ouvrir-tableau-de-bord]').first();
  const boutonVisible = await bouton.isVisible().catch(() => false);
  record('le bouton « Tableau de bord » est présent dans la colonne de gauche', boutonVisible);

  const auDessus = await page.evaluate(() => {
    const b = document.querySelector('[data-ouvrir-tableau-de-bord]');
    const titres = [...document.querySelectorAll('span')].filter((s) => s.textContent?.trim() === 'Projets');
    if (!b || !titres.length) return false;
    // Le titre « Projets » de la colonne de gauche est celui qui suit le bouton.
    return titres.some((t) => b.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  record('le bouton est AU-DESSUS de l’en-tête « Projets »', auDessus);

  /* ---------- 2. Un clic ouvre la page, masque Kanban + volet ---------- */
  const kanbanAvant = await page.locator('h2:has-text("À faire")').count();
  await bouton.click();
  await page.waitForTimeout(1500);

  const titrePage = await page.locator('h1:has-text("Tableau de bord")').isVisible().catch(() => false);
  record('un clic ouvre la page « Tableau de bord »', titrePage);

  const kanbanApres = await page.locator('h2:has-text("À faire")').count();
  record('le Kanban est masqué quand la page est ouverte', kanbanAvant > 0 && kanbanApres === 0, `avant ${kanbanAvant}, après ${kanbanApres}`);

  const gaucheEncoreLa = await bouton.isVisible().catch(() => false);
  record('la colonne de gauche reste visible et cliquable', gaucheEncoreLa);

  /* ---------- 3. Les cinq blocs, avec des données ---------- */
  const texte = await page.locator('[data-fil="tableau-de-bord"]').innerText().catch(() => '');
  // Les titres des tuiles sont mis en majuscules par CSS : on compare sans casse.
  const blocs = {
    temps: /Temps de travail total/i.test(texte),
    taches: /Tâches exécutées/i.test(texte),
    parJour: /Consommation au fil des jours/i.test(texte),
    projets: /Projets les plus travaillés/i.test(texte),
    quotaCarte: /Part de quota par carte/i.test(texte),
  };
  record('les cinq blocs sont présents', Object.values(blocs).every(Boolean), JSON.stringify(blocs));

  const donneesReelles = /HaikoDev/.test(texte) && /37/.test(texte) && /Refonte du volet des quotas/.test(texte);
  record('la page affiche de vraies données (projets, tâches, cartes)', donneesReelles);

  const barres = await page.locator('[data-fil="tableau-de-bord"] svg, [data-fil="tableau-de-bord"] [style*="height"]').count();
  record('la courbe par jour est dessinée', barres > 0, `${barres} éléments graphiques`);

  /* ---------- 3 bis. Les deux parts de quota par tâche ---------- */
  const lignesQuota = await page.locator('[data-quota-carte]').all();
  const detailQuota = [];
  for (const ligne of lignesQuota) {
    detailQuota.push({
      semaine: Number(await ligne.getAttribute('data-quota-semaine')),
      texte: (await ligne.innerText()).replace(/\s+/g, ' '),
    });
  }
  record('chaque tâche porte une ligne de part de quota', detailQuota.length === 2, `${detailQuota.length} lignes`);

  const lesDeuxParts = detailQuota.every((l) => /semaine/i.test(l.texte) && /sur 5 h/i.test(l.texte));
  record('chaque ligne montre la part de SEMAINE et la part de 5 h', lesDeuxParts, JSON.stringify(detailQuota.map((l) => l.texte)));

  const classee = detailQuota.every((l, i) => i === 0 || detailQuota[i - 1].semaine >= l.semaine);
  const semaineDAbord = detailQuota[0]?.semaine === 7.8;
  record(
    'la liste est classée par la part de SEMAINE décroissante (pas par les jetons)',
    classee && semaineDAbord,
    detailQuota.map((l) => l.semaine).join(' > '),
  );

  const total = await page.locator('[data-total-quota]').innerText().catch(() => '');
  record('le total de la période est rappelé au-dessus de la liste', /11(?:[.,]0)? % du quota de la semaine/i.test(total), total.replace(/\s+/g, ' '));

  const sansReleve = await page.locator('[data-quota-sans-releve]').innerText().catch(() => '');
  record(
    'une tâche sans relevé le DIT au lieu d’afficher un zéro',
    /ancienne tâche/i.test(sansReleve) && /estimés, jamais mesurés/i.test(sansReleve),
    sansReleve.replace(/\s+/g, ' '),
  );

  await page.screenshot({ path: `${SHOTS}/tableau-de-bord.png`, fullPage: false });

  /* ---------- 4. Sur téléphone : lisible et refermable ---------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const titreMobile = await page.locator('h1:has-text("Tableau de bord")').isVisible().catch(() => false);
  record('sur téléphone, la page reste affichée et lisible', titreMobile);
  await page.screenshot({ path: `${SHOTS}/tableau-de-bord-mobile.png`, fullPage: false });

  const fermer = page.locator('[data-fermer-tableau-de-bord]').first();
  await fermer.click();
  await page.waitForTimeout(1200);
  const kanbanRevenu = await page.locator('h2:has-text("À faire")').count();
  const pageFermee = !(await page.locator('h1:has-text("Tableau de bord")').isVisible().catch(() => false));
  record('« Revenir au tableau » referme la page et rend le Kanban', pageFermee && kanbanRevenu > 0, `Kanban ${kanbanRevenu}`);

  await browser.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
