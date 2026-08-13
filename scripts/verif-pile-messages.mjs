#!/usr/bin/env node
/**
 * La pile des vignettes d'agents, en bas à droite : est-elle bien une PILE ?
 *
 * On regarde, dans un vrai navigateur : les commandes sont-elles tout en
 * bas ? Les vignettes s'empilent-elles, la plus récente devant, trois
 * visibles et le reste compté ? La pile s'ouvre-t-elle au survol, en
 * douceur ?
 *
 * Les messages d'information passagers (les « toasts ») ne vivent plus dans
 * ce bloc — ils sont en haut au centre, vérifiés par
 * `scripts/verif-messages-info.mjs`.
 *
 *   node scripts/verif-pile-messages.mjs
 *
 * On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
 * désigne l'application déjà publiée — on y verrait l'ancienne version.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification pile des vignettes',
  );
  db.close();
  return { token, empreinte };
}

function retirerLaSession(empreinte) {
  const db = new Database('/root/haikodev/data/haikodev.db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Ce que l'écran montre de la pile des vignettes. */
const LECTURE = () => {
  const commandes = document.querySelector('[data-commandes="pile"]');
  const vignettes = document.querySelector('[data-vignettes="agents"]');
  if (!vignettes) return null;
  const rangVignettes = Array.from(document.querySelectorAll('[data-vignette-pile]')).map((el) => {
    const boite = el.getBoundingClientRect();
    return {
      index: Number(el.dataset.vignettePile),
      opacite: Number(getComputedStyle(el).opacity),
      bas: boite.bottom,
      largeur: boite.width,
    };
  });
  return {
    vignettes: rangVignettes,
    hauteurVignettes: vignettes.querySelector(':scope > div').getBoundingClientRect().height,
    resteVignettes: vignettes.querySelector('[data-reste="agents"]')?.textContent?.trim() ?? '',
    hautCommandes: commandes ? commandes.getBoundingClientRect().top : null,
    basVignettes: vignettes.getBoundingClientRect().bottom,
  };
};

async function main() {
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    // Le bloc garde la position où on l'a traîné (préférence « dock ») : un
    // décalage pris ailleurs le pousserait hors de l'écran. On le ramène à sa
    // place, le temps du contrôle, sans rien écrire dans les préférences.
    await page.addStyleTag({ content: '[data-bloc="dock"] { transform: none !important; }' });

    const ferme = await page.evaluate(LECTURE);
    if (!ferme) {
      console.log('  (aucun agent en cours : la pile des vignettes n’a pas pu être jugée)');
    } else {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/pile-vignettes-fermee.png` });

      const premiere = ferme.vignettes[0];
      const empilees = ferme.vignettes
        .filter((v) => v.index > 0 && v.index < 3)
        .every((v) => v.bas > premiere.bas && v.bas - premiere.bas < 30 && v.largeur < premiere.largeur);
      noter(
        'Les vignettes du dessous ne dépassent que de quelques pixels',
        ferme.vignettes.length === 1 || empilees,
        ferme.vignettes.map((v) => Math.round(v.bas - premiere.bas)).join(' / ') + ' px',
      );
      noter(
        'La pile des vignettes tient la place d’une seule',
        ferme.hauteurVignettes < 40 * ferme.vignettes.length || ferme.vignettes.length === 1,
        `${Math.round(ferme.hauteurVignettes)} px pour ${ferme.vignettes.length} vignettes`,
      );
      noter(
        'Au-delà de trois, les vignettes sont cachées et comptées',
        ferme.vignettes.filter((v) => v.index >= 3).every((v) => v.opacite === 0) &&
          (ferme.vignettes.length <= 3 || /\+ \d+ autres? agents?/.test(ferme.resteVignettes)),
        ferme.resteVignettes || 'rien à compter',
      );

      if (ferme.hautCommandes !== null) {
        noter(
          'La rangée de commandes est sous les vignettes',
          ferme.hautCommandes >= ferme.basVignettes - 1,
          `commandes à ${Math.round(ferme.hautCommandes)}, vignettes jusqu’à ${Math.round(ferme.basVignettes)}`,
        );
      }

      await page.hover('[data-pile="agents"]');
      await page.waitForTimeout(500);
      const ouverte = await page.evaluate(LECTURE);
      await page.screenshot({ path: `${SHOTS}/pile-vignettes-ouverte.png` });
      noter(
        'Au survol, la pile des vignettes s’ouvre en liste complète',
        ferme.vignettes.length === 1 ||
          (ouverte.hauteurVignettes > ferme.hauteurVignettes && ouverte.vignettes.every((v) => v.opacite === 1)),
        `${Math.round(ferme.hauteurVignettes)} px → ${Math.round(ouverte.hauteurVignettes)} px`,
      );
      noter('Ouverte, plus rien n’est compté à part', ouverte.resteVignettes === '');

      await page.mouse.move(20, 20);
      await page.waitForTimeout(500);
      const refermee = await page.evaluate(LECTURE);
      noter(
        'À la sortie du curseur, la pile se referme',
        Math.abs(refermee.hauteurVignettes - ferme.hauteurVignettes) < 4,
        `${Math.round(refermee.hauteurVignettes)} px`,
      );
    }

    noter('Aucune erreur dans la console', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
    retirerLaSession(empreinte);
  }

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
