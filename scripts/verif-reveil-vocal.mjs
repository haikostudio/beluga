#!/usr/bin/env node
/**
 * LE RÉVEIL VOCAL « Dis Haiko » — dans un vrai navigateur.
 *
 * On juge la chaîne complète côté écran : l'interrupteur d'écoute permanente,
 * le passage en écoute sur le mot de réveil, les ondes qui passent au ROUGE, la
 * phrase affichée pour relecture, puis publiée — et les deux façons de la jeter
 * (« Annule », ou un clic).
 *
 * Ce que ce script NE juge pas, et le dit : ni le micro réel, ni Whisper. Le
 * navigateur reçoit un micro FACTICE parfaitement silencieux (aucune tranche ne
 * part donc au serveur), et les phrases sont injectées par le point d'essai de
 * la page (`window.haikodevEssai.parole`), qui entre par le MÊME chemin qu'une
 * transcription revenue de `/api/transcribe`.
 *
 *   HAIKO_REVEIL_URL=http://localhost:7099 node scripts/verif-reveil-vocal.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 *
 * L'interrupteur d'écoute et la place du module sont des préférences du COMPTE :
 * le script les relève AVANT et les remet À L'IDENTIQUE en partant, quoi qu'il
 * arrive — on ne laisse jamais un micro armé ni un module déplacé derrière soi.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

// La racine se déduit du script lui-même : lancé depuis une copie de travail, il
// doit juger CE dépôt, jamais le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_REVEIL_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Les jetons de session sont stockés hachés : on s'en fabrique un, une heure,
// retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification réveil vocal');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

/*
 * LES PRÉFÉRENCES DU COMPTE, RENDUES TELLES QUELLES. Le script allume l'écoute
 * et survole le module : deux réglages qui vivent en base. On les relève ici et
 * on les repose en partant, y compris si le script tombe — un contrôle ne laisse
 * pas de trace dans les réglages de qui le lance.
 */
const CLES_RENDUES = ['voix.ecoute', 'voix'];
const avant = new Map(
  CLES_RENDUES.map((cle) => [
    cle,
    base.prepare('SELECT value FROM preferences WHERE key = ?').get(cle)?.value ?? null,
  ]),
);
process.on('exit', () => {
  for (const [cle, valeur] of avant) {
    if (valeur === null) base.prepare('DELETE FROM preferences WHERE key = ?').run(cle);
    else
      base
        .prepare(
          'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        )
        .run(cle, valeur, Date.now());
  }
});

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

console.log(`Dépôt jugé : ${RACINE}`);

/** Un WAV d'une seconde de SILENCE : le micro factice n'entend jamais rien. */
function fabriquerSilence() {
  const taux = 16000;
  const octets = taux * 2; // 1 s, 16 bits mono
  const entete = Buffer.alloc(44);
  entete.write('RIFF', 0);
  entete.writeUInt32LE(36 + octets, 4);
  entete.write('WAVE', 8);
  entete.write('fmt ', 12);
  entete.writeUInt32LE(16, 16);
  entete.writeUInt16LE(1, 20);
  entete.writeUInt16LE(1, 22);
  entete.writeUInt32LE(taux, 24);
  entete.writeUInt32LE(taux * 2, 28);
  entete.writeUInt16LE(2, 32);
  entete.writeUInt16LE(16, 34);
  entete.write('data', 36);
  entete.writeUInt32LE(octets, 40);
  const fichier = path.join(os.tmpdir(), 'haiko-silence.wav');
  fs.writeFileSync(fichier, Buffer.concat([entete, Buffer.alloc(octets)]));
  return fichier;
}

const silence = fabriquerSilence();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    // Un micro factice, accepté d'office et rigoureusement muet.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${silence}`,
  ],
});

const contexte = await navigateur.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone'],
});
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);

const page = await contexte.newPage();
// Une attente bornée : un module recouvert ou hors d'atteinte doit faire ÉCHOUER
// un contrôle en quelques secondes, jamais retenir le script une demi-heure.
page.setDefaultTimeout(15_000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

/** L'état de l'écoute, tel que l'écran le donne à l'instant. */
const etat = (p) =>
  p.evaluate(() => {
    const module = document.querySelector('[data-module-voix]');
    if (!module) return null;
    const boite = module.getBoundingClientRect();
    const ondes = module.querySelector('[data-onde-vocale]');
    const barre = ondes?.querySelector('span');
    const dictee = module.querySelector('[data-dictee]');
    // Les deux couleurs de référence, lues sur le thème du moment : on ne compare
    // jamais à une teinte écrite en dur dans le script.
    const temoin = document.createElement('span');
    document.body.appendChild(temoin);
    temoin.className = 'bg-danger';
    const rouge = getComputedStyle(temoin).backgroundColor;
    temoin.className = 'bg-success';
    const vert = getComputedStyle(temoin).backgroundColor;
    temoin.remove();
    return {
      etat: module.getAttribute('data-etat-ecoute'),
      largeur: Math.round(boite.width),
      ondes: Boolean(ondes),
      ondesEcoute: ondes?.hasAttribute('data-onde-ecoute') ?? false,
      couleurOnde: barre ? getComputedStyle(barre).backgroundColor : '',
      rouge,
      vert,
      temoinMicro: Boolean(module.querySelector('[data-temoin-micro]')),
      dictee: dictee ? dictee.textContent.trim() : null,
      relecture: dictee?.hasAttribute('data-relecture') ?? false,
      interrupteur: module.querySelector('[data-interrupteur-ecoute]')?.getAttribute('aria-pressed'),
    };
  });

/** Une phrase entendue, injectée par le point d'essai de la page. */
const parler = async (p, texte) => {
  await p.evaluate((t) => window.haikodevEssai.parole(t), texte);
  await p.waitForTimeout(300);
};

/**
 * Ouvrir le panneau du module, au survol. On ne passe PAS par `hover()` : le
 * module peut être accroché à un bord, donc à moitié hors de l'écran, et
 * Playwright viserait son centre — dehors. On vise le milieu de ce qui est
 * VISIBLE, et l'on recommence une fois le module revenu du bord (il s'agrandit).
 */
const ouvrirPanneau = async (p) => {
  for (let essai = 0; essai < 4; essai += 1) {
    const boite = await p.evaluate(() => {
      const m = document.querySelector('[data-module-voix]');
      if (!m) return null;
      const b = m.getBoundingClientRect();
      return {
        x0: Math.max(b.left, 0),
        x1: Math.min(b.right, window.innerWidth),
        y0: Math.max(b.top, 0),
        y1: Math.min(b.bottom, window.innerHeight),
        ouvert: m.hasAttribute('data-ouvert'),
      };
    });
    if (!boite) return false;
    if (boite.ouvert) return true;
    await p.mouse.move((boite.x0 + boite.x1) / 2, (boite.y0 + boite.y1) / 2);
    await p.waitForTimeout(500);
  }
  return p.evaluate(() => document.querySelector('[data-module-voix]')?.hasAttribute('data-ouvert') ?? false);
};

/**
 * Un clic ENVOYÉ à l'élément lui-même. Le bloc en bas à droite (messages courts,
 * vignettes d'agents) flotte au-dessus de l'écran et peut recouvrir le module
 * quand celui-ci a été déplacé dans ce coin : un clic aux coordonnées tomberait
 * alors sur le bloc. On juge donc le GESTE, pas la superposition du jour.
 */
const cliquer = (p, selecteur) => p.locator(selecteur).dispatchEvent('click');

const basculerEcoute = async (p) => {
  await ouvrirPanneau(p);
  await cliquer(p, '[data-interrupteur-ecoute]');
  await p.waitForTimeout(900);
};

try {
  if (!(await page.evaluate(() => Boolean(window.haikodevEssai)))) {
    noter('la page est bien celle du serveur de développement', false, 'viser le serveur de développement');
  } else {
    // On part TOUJOURS d'une écoute éteinte : un run précédent a pu la laisser
    // allumée, et le premier contrôle jugerait alors le passé, pas le code.
    if ((await etat(page))?.etat !== 'eteinte') {
      await basculerEcoute(page);
      await page.mouse.move(700, 400);
      await page.waitForTimeout(600);
    }

    // Le collecteur des phrases publiées : c'est là qu'atterrit une dictée finie.
    await page.evaluate(() => {
      window.__dictees = [];
      window.addEventListener('haikodev:dictee', (e) => window.__dictees.push(e.detail.texte));
    });
    const publiees = () => page.evaluate(() => window.__dictees.slice());

    /* ---------- 1. Rien ne s'ouvre tout seul ---------- */
    const repos = await etat(page);
    noter('au repos, l’écoute est éteinte', repos?.etat === 'eteinte', `état « ${repos?.etat} »`);
    noter('au repos, aucun témoin de micro', repos?.temoinMicro === false);
    noter(
      'le point d’essai de parole est en place',
      await page.evaluate(() => typeof window.haikodevEssai.parole === 'function'),
    );
    noter(
      'éteinte, une parole ne réveille rien',
      (await parler(page, 'Dis Haiko ouvre le tableau'), (await etat(page))?.etat === 'eteinte'),
    );

    /* ---------- 2. L'interrupteur ouvre le micro ---------- */
    await basculerEcoute(page);
    const guet = await etat(page);
    noter('allumé, le micro guette le mot de réveil', guet?.etat === 'guette', `état « ${guet?.etat} »`);
    noter('l’interrupteur se montre allumé', guet?.interrupteur === 'true');
    noter('un micro ouvert porte son témoin rouge', guet?.temoinMicro === true);
    await page.mouse.move(700, 400);
    await page.waitForTimeout(600);

    /* ---------- 3. Une phrase ordinaire ne réveille pas ---------- */
    await parler(page, 'Bonjour, je regarde le tableau des tâches');
    const apresBanal = await etat(page);
    noter('une phrase sans mot de réveil laisse le guet intact', apresBanal?.etat === 'guette');

    /* ---------- 4. « Dis Haiko » fait passer en écoute ---------- */
    await parler(page, 'Dis Haiko');
    const ecoute = await etat(page);
    noter('« Dis Haiko » fait passer le module en écoute', ecoute?.etat === 'ecoute', `état « ${ecoute?.etat}»`);
    noter('en écoute, les ondes sont ROUGES', ecoute?.ondesEcoute && ecoute?.couleurOnde === ecoute?.rouge,
      `${ecoute?.couleurOnde} (rouge attendu ${ecoute?.rouge}, vert ${ecoute?.vert})`);
    noter('en écoute, le module s’élargit pour la phrase', (ecoute?.largeur ?? 0) > 100, `${ecoute?.largeur} px`);
    noter('en écoute, un bandeau attend la phrase', ecoute?.dictee !== null);
    await page.screenshot({ path: `${SHOTS}/reveil-vocal-ecoute.png` });

    /* ---------- 5. La phrase est relue, puis publiée ---------- */
    await parler(page, 'ouvre le tableau de bord');
    const relu = await etat(page);
    noter('la phrase dictée s’affiche pour relecture', (relu?.dictee ?? '').includes('ouvre le tableau de bord'),
      `« ${relu?.dictee} »`);
    noter('la relecture se signale', relu?.relecture === true, `état « ${relu?.etat} »`);
    await page.screenshot({ path: `${SHOTS}/reveil-vocal-relecture.png` });
    await page.waitForTimeout(2600);
    const envoyees = await publiees();
    noter('la phrase part après la relecture', envoyees.length === 1 && envoyees[0] === 'ouvre le tableau de bord',
      JSON.stringify(envoyees));
    noter('après l’envoi, le module retourne au guet', (await etat(page))?.etat === 'guette');

    /* ---------- 6. « Annule » jette la phrase, relecture comprise ---------- */
    await parler(page, 'Dis Haiko note cette idée');
    noter('la phrase à annuler est bien en main', (await etat(page))?.dictee?.includes('note cette idée') === true);
    await parler(page, 'annule');
    const apresAnnule = await etat(page);
    noter('« Annule » jette la phrase et rend le guet', apresAnnule?.etat === 'guette', `état « ${apresAnnule?.etat} »`);
    // On laisse passer la relecture : rien ne doit partir en différé.
    await page.waitForTimeout(2600);
    noter('« Annule » n’envoie rien', (await publiees()).length === 1, JSON.stringify(await publiees()));

    /* ---------- 7. Un clic jette aussi la phrase ---------- */
    await parler(page, 'Dis Haiko ceci partira à la poubelle');
    await cliquer(page, '[data-dictee]');
    await page.waitForTimeout(2800);
    noter('un clic sur la phrase la jette', (await etat(page))?.etat === 'guette');
    noter('un clic n’envoie rien', (await publiees()).length === 1, JSON.stringify(await publiees()));

    /* ---------- 8. L'interrupteur referme tout ---------- */
    await basculerEcoute(page);
    await page.mouse.move(700, 400);
    await page.waitForTimeout(600);
    const eteint = await etat(page);
    noter('éteint, plus rien n’écoute', eteint?.etat === 'eteinte', `état « ${eteint?.etat} »`);
    noter('éteint, le témoin de micro disparaît', eteint?.temoinMicro === false);

    noter('aucune erreur dans la page', erreurs.length === 0, erreurs[0] ?? '');
  }
} finally {
  // On ne laisse JAMAIS l'écoute allumée dans le compte de l'utilisateur. Par
  // l'interface d'abord (le vrai chemin) ; les préférences relevées au départ
  // sont de toute façon reposées en base à la sortie du script.
  try {
    if ((await etat(page))?.etat !== 'eteinte') await basculerEcoute(page);
  } catch {
    console.log('  !! l’écoute est rééteinte en base, l’interface n’a pas répondu');
  }
  await navigateur.close();
}

const tombes = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - tombes.length}/${resultats.length} contrôles passés.`);
if (tombes.length) {
  console.log('Contrôles tombés :');
  for (const t of tombes) console.log(`  - ${t.nom}`);
}
process.exit(tombes.length ? 1 : 0);
