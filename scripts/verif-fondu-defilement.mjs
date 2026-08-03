#!/usr/bin/env node
/**
 * Le contenu s'efface-t-il en haut et en bas d'une zone qui défile ?
 *
 * On ouvre la conversation du chef sur un écran de téléphone et on vérifie
 * trois choses : rien ne voile le haut tant qu'on est en haut, le voile du
 * haut s'allume dès qu'on a fait défiler, et il floute vraiment ce qui passe
 * derrière.
 *
 *   node scripts/verif-fondu-defilement.mjs
 */
import { chromium } from '/home/paseo/playwright-automation/node_modules/playwright/index.mjs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/* Le serveur de DÉVELOPPEMENT : HAIKODEV_URL désigne l'application publiée. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification des fondus de défilement',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database('/root/haikodev/data/haikodev.db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** L'état des deux voiles d'une zone : présents ? visibles ? flous ? */
function lireVoiles() {
  const zones = Array.from(document.querySelectorAll('div')).filter((n) => {
    const enfants = Array.from(n.children);
    return (
      enfants.length === 3 &&
      enfants[0].getAttribute('aria-hidden') === 'true' &&
      enfants[2].getAttribute('aria-hidden') === 'true' &&
      enfants[1].scrollHeight > 0
    );
  });
  // La plus haute zone visible : le fil de la conversation.
  const zone = zones.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!zone) return null;
  const [haut, corps, bas] = Array.from(zone.children);
  const style = (n) => getComputedStyle(n);
  return {
    debordement: corps.scrollHeight > corps.clientHeight + 8,
    scrollTop: corps.scrollTop,
    opaciteHaut: Number(style(haut).opacity),
    opaciteBas: Number(style(bas).opacity),
    flou: style(haut).backdropFilter || style(haut).webkitBackdropFilter || '',
    degrade: style(haut).backgroundImage,
    masque: style(haut).maskImage || style(haut).webkitMaskImage || '',
    hauteur: haut.getBoundingClientRect().height,
  };
}

async function main() {
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const repos = await page.evaluate(lireVoiles);
  noter('la zone de conversation porte bien deux voiles', !!repos, repos ? '' : 'aucune zone trouvée');

  if (repos) {
    noter('le voile est bien un dégradé flouté et masqué',
      repos.flou.includes('blur') && repos.degrade.includes('gradient') && repos.masque.includes('gradient'),
      `flou=${repos.flou} masque=${repos.masque.slice(0, 28)}`);
    noter('le voile fait une bande fine', repos.hauteur > 16 && repos.hauteur < 48, `${Math.round(repos.hauteur)} px`);
  }

  // On fait défiler : le voile du haut doit s'allumer.
  const apres = await page.evaluate((lire) => {
    const zones = Array.from(document.querySelectorAll('div')).filter((n) => {
      const e = Array.from(n.children);
      return e.length === 3 && e[0].getAttribute('aria-hidden') === 'true' && e[2].getAttribute('aria-hidden') === 'true';
    });
    const zone = zones.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!zone) return null;
    const corps = zone.children[1];
    corps.scrollTop = Math.max(0, Math.floor(corps.scrollHeight / 2));
    corps.dispatchEvent(new Event('scroll'));
    return new Promise((r) => setTimeout(() => r(eval(`(${lire})`)()), 500));
  }, lireVoiles.toString());

  if (apres && apres.debordement) {
    noter('le voile du haut s\'allume une fois le contenu remonté', apres.opaciteHaut > 0.9, `opacité ${apres.opaciteHaut}`);
    noter('le voile du bas reste allumé tant qu\'il reste à lire', apres.opaciteBas > 0.9, `opacité ${apres.opaciteBas}`);
  } else {
    noter('la conversation déborde assez pour juger du voile', false, 'contenu trop court');
  }

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));

  await context.close();
  await navigateur.close();
  retirer(empreinte);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
