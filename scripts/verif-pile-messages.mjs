#!/usr/bin/env node
/**
 * La pile des messages courts, en bas à droite : est-elle bien une PILE ?
 *
 * On pose cinq messages d'affilée — les vraies trames que le serveur envoie —
 * et on regarde, dans un vrai navigateur : les commandes sont-elles tout en
 * bas ? Les messages s'empilent-ils, le plus récent devant, trois visibles et
 * le reste compté ? La pile s'ouvre-t-elle au survol, en douceur ? Chaque
 * message porte-t-il son heure et sa date ?
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
    'vérification pile des messages',
  );
  db.close();
  return { token, empreinte };
}

function retirerLaSession(empreinte) {
  const db = new Database('/root/haikodev/data/haikodev.db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/**
 * Le serveur envoie ses messages courts par la liaison temps réel. On garde
 * une main sur cette liaison pour lui faire passer les MÊMES trames, à la
 * demande : rien n'est simulé côté application.
 */
const PONT = `
  (() => {
    const Vraie = window.WebSocket;
    window.__socketsHaikodev = [];
    window.WebSocket = function (...args) {
      const socket = new Vraie(...args);
      window.__socketsHaikodev.push(socket);
      return socket;
    };
    window.WebSocket.prototype = Vraie.prototype;
    Object.assign(window.WebSocket, Vraie);
    window.__messageCourt = (level, text) => {
      for (const socket of window.__socketsHaikodev) {
        if (socket.onmessage) socket.onmessage({ data: JSON.stringify({ type: 'toast', level, text }) });
      }
    };
  })();
`;

/** Ce que l'écran montre de la pile, message par message. */
const LECTURE = () => {
  const pile = document.querySelector('[data-pile="messages"]');
  if (!pile) return null;
  const rang = document.querySelectorAll('[data-message-pile]');
  const messages = Array.from(rang).map((el) => {
    const style = getComputedStyle(el);
    const boite = el.getBoundingClientRect();
    return {
      index: Number(el.dataset.messagePile),
      transform: style.transform,
      opacite: Number(style.opacity),
      profondeur: Number(style.zIndex),
      duree: style.transitionDuration,
      bas: boite.bottom,
      largeur: boite.width,
      heure: el.querySelector('[data-heure-message]')?.textContent?.trim() ?? '',
      texte: el.textContent ?? '',
    };
  });
  const commandes = document.querySelector('[data-commandes="pile"]');
  const vignettes = document.querySelector('[data-vignettes="agents"]');
  // Les vignettes d'agents forment leur PROPRE pile, au même mécanisme.
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
    hauteurVignettes: vignettes ? vignettes.querySelector(':scope > div').getBoundingClientRect().height : null,
    resteVignettes: vignettes?.querySelector('[data-reste="agents"]')?.textContent?.trim() ?? '',
    hauteurPile: pile.querySelector(':scope > div').getBoundingClientRect().height,
    reste: pile.querySelector('[data-reste="messages"]')?.textContent?.trim() ?? '',
    messages,
    hautCommandes: commandes ? commandes.getBoundingClientRect().top : null,
    basVignettes: vignettes ? vignettes.getBoundingClientRect().bottom : null,
    basPile: pile.getBoundingClientRect().bottom,
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
  await context.addInitScript(PONT);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    /* ---------- Cinq messages d'affilée ---------- */
    const textes = [
      'Le serveur ne répond pas',
      'La carte « essai » attend une place',
      'Trois cartes déplacées vers « À déployer »',
      'Le point du jour est prêt',
      'La branche a été enregistrée',
    ];
    for (const texte of textes) {
      await page.evaluate(
        ([t]) => window.__messageCourt('error', t),
        [texte],
      );
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(600);

    const ferme = await page.evaluate(LECTURE);
    if (!ferme) {
      noter('La pile des messages est à l’écran', false, 'aucun bloc trouvé');
      throw new Error('pile absente');
    }
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/pile-messages-fermee.png` });

    /* ---------- 1. Le plus récent devant ---------- */
    const devant = ferme.messages.find((m) => m.index === 0);
    noter(
      'Le message le plus récent est devant',
      devant?.texte.includes(textes[textes.length - 1]) && devant.profondeur >= ferme.messages.length,
      `devant : « ${devant?.texte.slice(0, 40)} »`,
    );

    /* ---------- 2. Une pile, pas une liste ---------- */
    const decales = ferme.messages
      .filter((m) => m.index > 0 && m.index < 3)
      .every((m, i, tous) => m.bas > devant.bas && m.bas - devant.bas < 30 && (i === 0 || m.bas > tous[i - 1].bas));
    noter('Les messages du dessous ne dépassent que de quelques pixels', decales,
      ferme.messages.slice(0, 3).map((m) => Math.round(m.bas - devant.bas)).join(' / ') + ' px');

    const retrecis = ferme.messages
      .filter((m) => m.index > 0 && m.index < 3)
      .every((m) => m.largeur < devant.largeur && m.opacite < devant.opacite);
    noter('Ils rétrécissent et s’assombrissent en profondeur', retrecis,
      ferme.messages.slice(0, 3).map((m) => `${Math.round(m.largeur)}px/${m.opacite}`).join(' · '));

    /* ---------- 3. Trois visibles, le reste compté ---------- */
    const caches = ferme.messages.filter((m) => m.index >= 3).every((m) => m.opacite === 0);
    noter('Au-delà de trois, les messages sont cachés', caches);
    noter('Le reste est compté en toutes lettres', /\+ \d+ autres? messages?/.test(ferme.reste), ferme.reste);

    /* ---------- 4. La pile n’occupe qu’un message ---------- */
    const sommeOuverte = ferme.messages.reduce((total, m) => total + 30, 0);
    noter('La pile fermée tient la place d’un seul message', ferme.hauteurPile < sommeOuverte,
      `${Math.round(ferme.hauteurPile)} px pour ${ferme.messages.length} messages`);

    /* ---------- 5. Heure et date ---------- */
    const heures = ferme.messages.every((m) => /^\d{2}:\d{2} · \d{2}\.\d{2}\.\d{4}$/.test(m.heure));
    noter('Chaque message porte son heure et sa date', heures, ferme.messages[0]?.heure);

    /* ---------- 6. Les commandes tout en bas ---------- */
    if (ferme.hautCommandes === null) {
      noter('La rangée de commandes est sous les vignettes', false, 'aucun agent en cours : rangée absente');
    } else {
      noter(
        'La rangée de commandes est sous les vignettes et sous la pile',
        ferme.hautCommandes >= ferme.basVignettes - 1 && ferme.hautCommandes >= ferme.basPile - 1,
        `commandes à ${Math.round(ferme.hautCommandes)}, vignettes jusqu’à ${Math.round(ferme.basVignettes)}`,
      );
    }

    /* ---------- 7. L’ouverture au survol ---------- */
    const douceur = ferme.messages.every((m) => {
      const ms = m.duree.includes('ms') ? parseFloat(m.duree) : parseFloat(m.duree) * 1000;
      return ms >= 150 && ms <= 250;
    });
    noter('L’animation dure entre 150 et 250 ms', douceur, ferme.messages[0]?.duree);

    await page.hover('[data-pile="messages"]');
    await page.waitForTimeout(500);
    const ouverte = await page.evaluate(LECTURE);
    await page.screenshot({ path: `${SHOTS}/pile-messages-ouverte.png` });
    noter('Au survol, la pile s’ouvre en liste complète',
      ouverte.hauteurPile > ferme.hauteurPile * 2 && ouverte.messages.every((m) => m.opacite === 1),
      `${Math.round(ferme.hauteurPile)} px → ${Math.round(ouverte.hauteurPile)} px`);
    noter('Ouverte, plus rien n’est compté à part', ouverte.reste === '');

    await page.mouse.move(20, 20);
    await page.waitForTimeout(500);
    const refermee = await page.evaluate(LECTURE);
    noter('À la sortie du curseur, la pile se referme',
      Math.abs(refermee.hauteurPile - ferme.hauteurPile) < 4,
      `${Math.round(refermee.hauteurPile)} px`);

    /* ---------- 8. Les vignettes d’agents s’empilent pareil ---------- */
    if (!ferme.vignettes.length) {
      console.log('  (aucun agent en cours : la pile des vignettes n’a pas pu être jugée)');
    } else {
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

      await page.hover('[data-pile="agents"]');
      await page.waitForTimeout(500);
      const vignettesOuvertes = await page.evaluate(LECTURE);
      await page.screenshot({ path: `${SHOTS}/pile-vignettes-ouverte.png` });
      noter(
        'Au survol, la pile des vignettes s’ouvre en liste complète',
        ferme.vignettes.length === 1 ||
          (vignettesOuvertes.hauteurVignettes > ferme.hauteurVignettes &&
            vignettesOuvertes.vignettes.every((v) => v.opacite === 1)),
        `${Math.round(ferme.hauteurVignettes)} px → ${Math.round(vignettesOuvertes.hauteurVignettes)} px`,
      );
      await page.mouse.move(20, 20);
      await page.waitForTimeout(400);
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
