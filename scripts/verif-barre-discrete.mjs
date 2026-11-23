#!/usr/bin/env node
/**
 * La barre de défilement est-elle DISCRÈTE, FINE et FLUIDE partout ?
 *
 * Toute zone qui défile (`ZoneDefilement`) masque la barre du navigateur et
 * peint la sienne : un pouce de TROIS pixels, invisible au repos, qui paraît en
 * fondu pendant le mouvement puis s'efface près d'une seconde après. On le juge
 * sur la colonne des projets (celle où la bande grise permanente se voyait),
 * sinon sur la plus grande zone verticale qui déborde.
 *
 * ON LE JUGE SUR LES TABLEAUX DE BORD (refonte du 11/10/2026). L'application
 * s'ouvre dans un projet, où la colonne de gauche porte les options du projet
 * et où le tableau, en colonnes, ne déborde pas forcément de haut en bas : il
 * n'y avait alors plus rien à juger. Sur les tableaux de bord, la colonne de
 * gauche retrouve la liste des projets, et les colonnes de la page défilent :
 *
 *
 *  1. aucune place prise par la barre du navigateur ;
 *  2. au repos, la barre dessinée est éteinte, et son pouce ne capte rien ;
 *  3. le pouce fait 3 px de large ;
 *  4. un coup de molette l'allume en FONDU (transition d'opacité, pas un saut) ;
 *  5. le pouce suit le contenu par `transform` (aucun rendu par cran) ;
 *  6. une rafale de molette ne la fait pas clignoter ;
 *  7. l'immobilité la rééteint, en fondu plus lent ;
 *  8. aucune longue tâche pendant deux secondes de défilement continu ;
 *  9. saisir le pouce et le traîner fait défiler le contenu, sans retard.
 *
 *   BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-barre-discrete.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { ouvrirLesTableauxDeBord } from './lib/navigation.mjs';

/* Le serveur de DÉVELOPPEMENT : BELUGA_URL désigne l'application publiée. */
const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const BASE_DE_DONNEES = cheminDeLaBaseServie();

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database(BASE_DE_DONNEES);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification de la barre discrète',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(BASE_DE_DONNEES);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Marque la zone jugée (`data-verif-barre`) et rend ce qu'elle porte. */
function lireZone() {
  let zone = document.querySelector('[data-verif-barre]');
  if (!zone) {
    const candidates = Array.from(document.querySelectorAll('[data-barre-defilement="vertical"]'))
      .map((piste) => Array.from(piste.parentElement.children).find((e) => !e.hasAttribute('aria-hidden')))
      .filter((corps) => corps && corps.scrollHeight > corps.clientHeight + 20);
    const colonne = candidates.find((c) => c.closest('[data-colonne-projets]'));
    zone = colonne ?? candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!zone) return null;
    zone.setAttribute('data-verif-barre', colonne ? 'colonne-projets' : 'plus-grande');
  }
  const piste = zone.parentElement.querySelector(':scope > [data-barre-defilement]');
  const pouce = piste?.querySelector('[data-pouce-defilement]');
  const sp = piste ? getComputedStyle(piste) : null;
  const so = pouce ? getComputedStyle(pouce) : null;
  const boite = zone.getBoundingClientRect();
  return {
    quelle: zone.getAttribute('data-verif-barre'),
    barreNative: zone.offsetWidth - zone.clientWidth,
    visible: piste?.getAttribute('data-barre-visible') ?? null,
    opacite: sp ? Number(sp.opacity) : null,
    transition: sp?.transition ?? '',
    largeurPouce: pouce ? pouce.getBoundingClientRect().width : null,
    hauteurPouce: pouce ? pouce.getBoundingClientRect().height : null,
    transformPouce: so?.transform ?? '',
    pointeurPouce: so?.pointerEvents ?? '',
    scrollTop: zone.scrollTop,
    centre: { x: boite.left + boite.width / 2, y: boite.top + boite.height / 2 },
    pouceBoite: pouce ? pouce.getBoundingClientRect().toJSON() : null,
  };
}

async function main() {
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    const bureau = await navigateur.newContext({
      // Une hauteur modeste : la colonne des projets déborde plus sûrement.
      viewport: { width: 1440, height: 560 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await bureau.addCookies([
      { name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await bureau.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-barre-defilement="vertical"]').first().waitFor({ state: 'attached', timeout: 30000 });
    /* Vers les tableaux de bord : la liste des projets y est à l'écran, et la
       page y défile de haut en bas. */
    await ouvrirLesTableauxDeBord(page);
    await page.waitForTimeout(2500);

    const repos = await page.evaluate(lireZone);
    if (!repos) {
      noter('une zone verticale qui déborde est trouvée', false);
      return;
    }
    noter('une zone verticale qui déborde est trouvée', true, repos.quelle);
    noter('la barre du NAVIGATEUR ne prend aucune place', repos.barreNative <= 1, `${repos.barreNative} px`);
    noter('au repos, la barre dessinée est éteinte', repos.visible === 'non' && repos.opacite === 0, `${repos.visible}, opacité ${repos.opacite}`);
    noter('au repos, le pouce ne capte aucun clic', repos.pointeurPouce === 'none', repos.pointeurPouce);
    noter('le pouce fait 3 px de large', Math.abs((repos.largeurPouce ?? 0) - 3) < 0.5, `${repos.largeurPouce} px`);

    /* 4. Un coup de molette : allumage en fondu. */
    await page.mouse.move(repos.centre.x, repos.centre.y);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(40);
    const debutFondu = await page.evaluate(lireZone);
    await page.waitForTimeout(260);
    const allume = await page.evaluate(lireZone);
    noter('la molette allume la barre', allume.visible === 'oui' && allume.opacite === 1, `${allume.visible}, opacité ${allume.opacite}`);
    noter(
      'elle paraît en FONDU, pas d’un coup',
      /opacity/.test(debutFondu.transition) && debutFondu.opacite < 1,
      `${debutFondu.transition} · opacité à 40 ms : ${debutFondu.opacite}`,
    );
    noter(
      'le pouce suit le contenu par transform',
      allume.scrollTop > repos.scrollTop && allume.transformPouce !== repos.transformPouce && allume.transformPouce.startsWith('matrix'),
      `${repos.transformPouce} → ${allume.transformPouce}`,
    );
    noter('allumé, le pouce se saisit', allume.pointeurPouce === 'auto', allume.pointeurPouce);

    /* 6 et 8. Une rafale de deux secondes : pas de clignotement, pas de longue tâche. */
    const rafale = await page.evaluate(async () => {
      const zone = document.querySelector('[data-verif-barre]');
      const piste = zone.parentElement.querySelector(':scope > [data-barre-defilement]');
      const longues = [];
      const obs = new PerformanceObserver((liste) => longues.push(...liste.getEntries().map((e) => Math.round(e.duration))));
      obs.observe({ type: 'longtask', buffered: false });
      let eteinte = 0;
      let images = 0;
      const fin = performance.now() + 2000;
      let sens = 1;
      await new Promise((resolve) => {
        const pas = () => {
          if (zone.scrollTop + zone.clientHeight >= zone.scrollHeight - 2) sens = -1;
          if (zone.scrollTop <= 0) sens = 1;
          zone.scrollTop += 6 * sens;
          images += 1;
          if (piste.getAttribute('data-barre-visible') !== 'oui') eteinte += 1;
          if (performance.now() < fin) requestAnimationFrame(pas);
          else resolve();
        };
        requestAnimationFrame(pas);
      });
      obs.disconnect();
      return { longues, eteinte, images };
    });
    noter('une rafale ne fait pas clignoter la barre', rafale.eteinte <= 1, `${rafale.eteinte} image(s) éteinte(s) sur ${rafale.images}`);
    noter('aucune longue tâche pendant le défilement continu', rafale.longues.length === 0, rafale.longues.join(', ') || 'aucune');

    /* 7. L'immobilité la rééteint, en fondu plus lent. */
    await page.waitForTimeout(900);
    const sortie = await page.evaluate(lireZone);
    await page.waitForTimeout(700);
    const calme = await page.evaluate(lireZone);
    noter('l’immobilité rééteint la barre', calme.visible === 'non' && calme.opacite === 0, `${calme.visible}, opacité ${calme.opacite}`);
    noter('elle s’efface en fondu plus lent', /opacity 0\.4/.test(sortie.transition), sortie.transition);

    /* 9. Saisir le pouce et le traîner. */
    await page.evaluate(() => {
      document.querySelector('[data-verif-barre]').scrollTop = 0;
    });
    await page.waitForTimeout(120);
    const avantGlisser = await page.evaluate(lireZone);
    const p = avantGlisser.pouceBoite;
    await page.mouse.move(p.x + p.width / 2, p.y + Math.min(8, p.height / 2));
    await page.mouse.down();
    await page.mouse.move(p.x + p.width / 2, p.y + 60, { steps: 6 });
    const pendant = await page.evaluate(lireZone);
    await page.mouse.up();
    noter('traîner le pouce fait défiler le contenu, aussitôt', pendant.scrollTop > avantGlisser.scrollTop + 20, `${avantGlisser.scrollTop} → ${pendant.scrollTop}`);
    noter('la barre reste allumée sous la main', pendant.visible === 'oui', String(pendant.visible));

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await bureau.close();
  } finally {
    await navigateur.close();
    retirer(empreinte);
  }
}

await main();
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées`);
process.exit(echecs ? 1 : 0);
