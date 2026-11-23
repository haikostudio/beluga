#!/usr/bin/env node
/**
 * JARVIS PARLE DANS SES BULLES — L'HISTORIQUE ET LA BULLE D'INFORMATION, DANS UN VRAI NAVIGATEUR.
 *
 * Carte « Jarvis : parler dans ses bulles » (23/11/2026). Ce contrôle juge :
 *
 *   1. à l'ouverture de la bulle vocale, les appels PRÉCÉDENTS de l'assistant sont déjà au-dessus, chacun précédé de
 *      sa ligne de date, la dernière ligne de date avant l'appel en cours ;
 *   2. une bulle d'information gardée (« voix_montrer ») se relit avec son intitulé, ses liens et son tableau ;
 *   3. en REMONTANT, la page plus ancienne se charge, et la bulle qu'on regardait ne saute pas (±2 px) ;
 *   4. une bulle d'information VIVANTE (événement du démon) se pose dans la pile, liens cliquables ;
 *   5. 1440 et 390, clair et sombre : la pile reste au-dessus de la bulle vocale, dans l'écran, sans débord.
 *
 * Un DÉMON D'ESSAI (base neuve) et le serveur de développement de la copie. Jamais BELUGA_URL, jamais BELUGA_TOKEN.
 *
 *   env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-historique-jarvis.mjs
 *   VERIF_CAPTURES=/chemin env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-historique-jarvis.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7223);
const PORT_WEB = Number(process.env.BELUGA_VERIF_PORT_WEB || 7124);
const BASE = `http://localhost:${PORT_WEB}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-historique-jarvis-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const vite = spawn('npm', ['run', 'dev', '--workspace', 'web', '--', '--port', String(PORT_WEB), '--strictPort'], {
  cwd: RACINE,
  env: { ...process.env, BELUGA_DEMON_PORT: String(PORT), NODE_ENV: 'development', BELUGA_URL: '', BELUGA_TOKEN: '' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const couperVite = () => {
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* déjà parti */
  }
};
process.on('exit', couperVite);

const base = () => new Database(path.join(DATA, 'beluga.db'));
function poserLaPreference(cle, valeur) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(cle, JSON.stringify(valeur), Date.now());
  db.close();
}

/** Trois appels passés de l'assistant : le plus ancien a 45 tours (il faut remonter pour le voir en entier). */
function poserLHistorique() {
  const db = base();
  const assistant = db.prepare("SELECT value FROM meta WHERE key = 'assistant.agent'").get()?.value;
  if (!assistant) {
    db.close();
    return null;
  }
  const maintenant = Date.now();
  const appel = (debut, tours) => {
    const id = Number(db.prepare('INSERT INTO discussions_vocales (debut, fin, agent_id, tours) VALUES (?, ?, ?, ?)').run(debut, debut + 600_000, assistant, tours.length).lastInsertRowid);
    tours.forEach(([role, texte], i) => db.prepare('INSERT INTO discussions_vocales_tours (discussion_id, quand, role, texte) VALUES (?, ?, ?, ?)').run(id, debut + i * 1000, role, texte));
  };
  appel(maintenant - 3 * 86_400_000, Array.from({ length: 45 }, (_, i) => [i % 2 ? 'assistant' : 'user', `Très ancien échange numéro ${i}`]));
  appel(maintenant - 86_400_000 + 3600_000, [
    ['user', 'Trouve-moi les liens des docs de la voix temps réel.'],
    ['information', '**Documentation**\n\n- [Guide de la voix en direct](https://exemple.fr/guide)\n- [Référence des outils](https://exemple.fr/outils)\n\n| Page | État |\n| --- | --- |\n| Guide | à jour |'],
    ['assistant', 'Les liens sont dans la bulle juste au-dessus.'],
  ]);
  appel(maintenant - 3600_000, [
    ['user', 'Et la carte sur les quotas, elle en est où ?'],
    ['assistant', 'Elle est terminée, en attente de mise en ligne.'],
  ]);
  db.close();
  return assistant;
}

async function ouvrirPage(navigateur, telephone) {
  const contexte = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    permissions: ['microphone'],
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-bouton-du-bord]', { timeout: 60_000 });
  await page.waitForTimeout(3200);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { contexte, page, erreurs };
}

const VIVANTES = [
  { role: 'user', texte: 'On reprend là où on en était hier ?' },
  { role: 'assistant', texte: 'Oui : on parlait des liens de la doc et de tes captures effacées.' },
];

/** Ouvre la bulle (toucher du bouton du bord) et pose l'appel en cours, jusqu'à voir la pile. */
async function ouvrirLaBulle(page) {
  await page.locator('[data-bouton-du-bord]').first().click({ force: true });
  await page.waitForSelector('[data-bulle-vocale]', { timeout: 10_000 });
  // La vraie ouverture (sans Codex) republie l'état pendant quelques secondes : on la laisse se poser.
  await page.waitForTimeout(6000);
  return poserLAppelEnCours(page, VIVANTES);
}
/** Pose l'appel en cours jusqu'à le voir en bas de la pile, historique chargé au-dessus. */
async function poserLAppelEnCours(page, tours, attendu = /captures effacées/) {
  for (let i = 0; i < 25; i += 1) {
    await page.evaluate((b) => window.belugaEssai?.bullesDuDirect?.(null, b), tours);
    await page.waitForTimeout(400);
    const ok = await page.evaluate((motif) => {
      const pile = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]');
      const vivantes = [...(pile?.querySelectorAll('[data-bulle]:not([data-bulle-ancienne] *)') ?? [])].filter((b) => !b.closest('[data-bulle-ancienne]'));
      return !!pile?.querySelector('[data-bulle-ancienne]') && new RegExp(motif).test(vivantes.map((b) => b.textContent).join(' '));
    }, attendu.source);
    if (ok) return true;
  }
  return false;
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

let navigateur = null;
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  {
    const db = base();
    const T = Date.now();
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai historique');
    db.close();
  }
  for (let i = 0; i < 90; i += 1) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });

  let historiquePose = false;
  const CAS = [
    [false, 'sombre'],
    [false, 'clair'],
    [true, 'sombre'],
    [true, 'clair'],
  ];
  for (const [telephone, clarte] of process.env.VERIF_SEUL ? CAS.slice(0, 1) : CAS) {
    const nom = `${telephone ? 'telephone' : 'ordinateur'}-${clarte}`;
    poserLaPreference('theme', clarte);
    const { contexte, page, erreurs } = await ouvrirPage(navigateur, telephone);
    if (!historiquePose) {
      historiquePose = !!poserLHistorique();
      verifier('l’assistant existe et ses appels passés sont posés', historiquePose);
    }
    const ouverte = await ouvrirLaBulle(page);
    verifier(`${nom} : la bulle s’ouvre avec les appels précédents au-dessus`, ouverte);

    const lu = await page.evaluate(() => {
      const pile = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]');
      const seps = [...(pile?.querySelectorAll('[data-separateur-de-discussion]') ?? [])].map((p) => p.textContent?.trim());
      const info = pile?.querySelector('[data-bulle="information"]');
      const b = document.querySelector('[data-bulle-vocale]')?.getBoundingClientRect();
      const p = pile?.getBoundingClientRect();
      return {
        seps,
        infoTitre: info?.querySelector('p')?.textContent ?? '',
        liens: [...(info?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('target')),
        tableau: !!info?.querySelector('table'),
        auDessus: !!p && !!b && p.bottom <= b.top + 1,
        dansLEcran: !!p && p.left >= 0 && p.right <= window.innerWidth + 1,
        deborde: document.documentElement.scrollWidth > window.innerWidth + 1,
        derniereVivante: [...(pile?.querySelectorAll('[data-bulle]') ?? [])].filter((b) => !b.closest('[data-bulle-ancienne]')).map((b) => b.textContent).join(' '),
      };
    });
    verifier(`${nom} : une ligne de date avant chaque appel, puis avant l’appel en cours`, lu.seps.length >= 3 && lu.seps.some((s) => /^Hier, /.test(s)) && /^Aujourd’hui, /.test(lu.seps.at(-1) ?? ''), lu.seps.join(' | '));
    verifier(`${nom} : la bulle d’information se relit (intitulé, liens qui s’ouvrent à part, tableau)`, /Jarvis · information — Documentation/.test(lu.infoTitre) && lu.liens.length === 2 && lu.liens.every((t) => t === '_blank') && lu.tableau, JSON.stringify(lu.liens));
    verifier(`${nom} : l’appel en cours reste en bas de la pile`, /captures effacées/.test(lu.derniereVivante));
    verifier(`${nom} : la pile reste au-dessus de la bulle vocale, dans l’écran, sans débord`, lu.auDessus && lu.dansLEcran && !lu.deborde);
    await capturer(page, `${nom}-historique`);

    if (!telephone && clarte === 'sombre') {
      // 3. Remonter : la page plus ancienne se charge, la bulle regardée ne saute pas.
      const avant = await page.evaluate(() => {
        const pile = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]');
        return { anciens: pile.querySelectorAll('[data-bulle-ancienne]').length, tres: [...pile.querySelectorAll('[data-bulle]')].filter((b) => /Très ancien/.test(b.textContent)).length };
      });
      const reference = await page.evaluate(() => {
        const pile = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]');
        pile.setAttribute('data-pile-essai', '');
        const cible = [...pile.querySelectorAll('[data-bulle]')].find((b) => /Très ancien/.test(b.textContent)) ?? pile.querySelector('[data-bulle]');
        cible.setAttribute('data-repere-essai', '');
        pile.scrollTop = 0;
        pile.dispatchEvent(new Event('scroll'));
        return { texte: cible.textContent, y: cible.getBoundingClientRect().top };
      });
      await page.waitForTimeout(1500);
      const apres = await page.evaluate(() => {
        const pile = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]');
        const cible = pile.querySelector('[data-repere-essai]');
        return { anciens: pile.querySelectorAll('[data-bulle-ancienne]').length, y: cible?.getBoundingClientRect().top ?? null, memePile: pile.hasAttribute('data-pile-essai') };
      });
      verifier('en remontant, les échanges plus anciens se chargent', apres.anciens > avant.anciens, `${avant.anciens} → ${apres.anciens} (dont ${avant.tres} très anciens avant), même pile : ${apres.memePile}`);
      verifier('la bulle regardée ne saute pas pendant le chargement (±2 px)', apres.y !== null && Math.abs(apres.y - reference.y) <= 2, `${Math.round(reference.y)} → ${Math.round(apres.y ?? -1)}`);
      await capturer(page, `${nom}-remonte`);

      // 4. Une bulle d'information VIVANTE.
      await poserLAppelEnCours(page, [
        ...VIVANTES,
        { role: 'user', texte: 'Montre-moi le tableau des projets' },
        { information: { id: 'essai', titre: 'Projets', contenu: '| Projet | État |\n| --- | --- |\n| Beluga | En cours |\n| Toogo | À valider |\n\n[Ouvrir Beluga](https://exemple.fr/beluga)' } },
        { role: 'assistant', texte: 'C’est dans la bulle juste au-dessus.' },
      ], /Projets/);
      await page.waitForTimeout(800);
      const vivante = await page.evaluate(() => {
        const pile = document.querySelector('[data-bulle-vocale] [data-bulles-du-direct]');
        pile.scrollTop = pile.scrollHeight;
        const infos = [...pile.querySelectorAll('[data-bulle="information"]')];
        const derniere = infos.at(-1);
        return { titre: derniere?.querySelector('p')?.textContent ?? '', lignes: derniere?.querySelectorAll('tr').length ?? 0, lien: derniere?.querySelector('a')?.getAttribute('href') ?? '' };
      });
      verifier('une bulle d’information vivante se pose, tableau et lien compris', /Projets/.test(vivante.titre) && vivante.lignes === 3 && vivante.lien === 'https://exemple.fr/beluga', JSON.stringify(vivante));
      await capturer(page, `${nom}-information`);
    }
    verifier(`${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
    await contexte.close();
  }
} catch (err) {
  verifier('le contrôle va au bout', false, String(err?.stack ?? err));
} finally {
  await navigateur?.close().catch(() => undefined);
  couperVite();
  nettoyer();
}
const ok = resultats.filter(Boolean).length;
console.log(`\n${ok}/${resultats.length} vérifications réussies`);
process.exit(ok === resultats.length ? 0 : 1);
