#!/usr/bin/env node
/**
 * L'ÉCOUTE PERMANENTE SUR TÉLÉPHONE — et ce qu'elle ne doit PLUS casser.
 *
 * Un enregistreur créé avec un format IMPOSÉ que le navigateur refuse (Safari
 * sur iPhone n'accepte pas « audio/webm ») lançait une erreur hors de toute
 * protection : elle remontait jusqu'à la page, qui se vidait. Ce script rejoue
 * la scène dans un vrai navigateur, en écran de téléphone :
 *
 *   1. écoute ÉTEINTE : aucun micro ouvert, l'application répond aux doigts ;
 *   2. navigateur qui refuse le webm : l'écoute part quand même (repli sur un
 *      format accepté), aucune erreur ne sort de la page ;
 *   3. la tranche envoyée porte l'extension du format RÉELLEMENT enregistré ;
 *   4. navigateur qui ne sait RIEN enregistrer : un message s'affiche, l'écoute
 *      s'éteint proprement, et l'application continue de fonctionner.
 *
 *   HAIKO_ECOUTE_URL=http://localhost:7099 node scripts/verif-ecoute-mobile.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée.
 *
 * Le micro est FACTICE et muet, et l'appel de transcription est INTERCEPTÉ :
 * ni Whisper ni le moteur de voix ne sont jugés ici, et aucun quota n'est
 * dépensé. L'interrupteur d'écoute est une préférence du COMPTE : elle est
 * relevée au départ et reposée à l'identique en partant.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_ECOUTE_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const base = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

const jeton = crypto.randomBytes(32).toString('base64url');
base
  .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
  .run(sha(jeton), Date.now(), Date.now() + 3600_000, 'vérification écoute mobile');
process.on('exit', () => base.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton)));

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

/**
 * Un WAV qui PARLE puis se TAIT : une seconde et demie de son, puis quatre
 * secondes de silence. Le navigateur le joue en boucle, si bien que la découpe
 * par le silence a de quoi trancher — un son continu ne finirait jamais une
 * tranche, et rien ne partirait jamais.
 */
function fabriquerSon() {
  const taux = 16000;
  const parle = Math.round(taux * 1.5);
  const muet = taux * 4;
  const corps = Buffer.alloc((parle + muet) * 2);
  for (let i = 0; i < parle; i += 1) {
    corps.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / taux) * 20000), i * 2);
  }
  const entete = Buffer.alloc(44);
  entete.write('RIFF', 0);
  entete.writeUInt32LE(36 + corps.length, 4);
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
  entete.writeUInt32LE(corps.length, 40);
  const fichier = path.join(os.tmpdir(), 'haiko-ecoute-son.wav');
  fs.writeFileSync(fichier, Buffer.concat([entete, corps]));
  return fichier;
}

const son = fabriquerSon();

const navigateur = await chromium.launch({
  channel: 'chrome',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${son}`,
  ],
});

/**
 * Une page de téléphone, avec un enregistreur BRIDÉ : `refuses` est la liste
 * des morceaux de type qu'il rejette (« webm » pour imiter Safari, « » pour
 * tout refuser, y compris l'enregistreur sans option). `transcriptionEnPanne`
 * fait répondre au serveur un refus, pour juger ce que l'écran en dit.
 */
async function ouvrirPage(refuses, transcriptionEnPanne = false) {
  const contexte = await navigateur.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone'],
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  await contexte.addInitScript((liste) => {
    window.__micros = 0;
    const gum = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (gum) {
      navigator.mediaDevices.getUserMedia = (...a) => {
        window.__micros += 1;
        return gum(...a);
      };
    }
    const Vrai = window.MediaRecorder;
    if (!Vrai) return;
    const refuse = (type) => liste.some((m) => (m === '' ? true : String(type ?? '').includes(m)));
    function Bride(flux, options) {
      const type = options?.mimeType ?? '';
      if (refuse(type)) throw new DOMException(`${type || 'aucun format'} non supporté`, 'NotSupportedError');
      return options?.mimeType ? new Vrai(flux, options) : new Vrai(flux);
    }
    Bride.isTypeSupported = (type) => !refuse(type) && Vrai.isTypeSupported(type);
    Bride.prototype = Vrai.prototype;
    window.MediaRecorder = Bride;
  }, refuses);

  const page = await contexte.newPage();
  page.setDefaultTimeout(15_000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  // La transcription est INTERCEPTÉE : on relève l'extension annoncée et on
  // rend une phrase toute faite. Whisper n'est jamais appelé.
  const envois = [];
  await page.route('**/api/transcribe', async (route) => {
    envois.push(route.request().headers()['x-audio-ext'] ?? '(aucune)');
    if (transcriptionEnPanne) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'moteur de transcription absent du serveur' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '' }) });
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { contexte, page, erreurs, envois };
}

/** L'état de l'écoute, tel que l'écran le donne. */
const etat = (p) =>
  p.evaluate(() => {
    const module = document.querySelector('[data-module-voix]');
    if (!module) return null;
    const boite = module.getBoundingClientRect();
    const onde = module.querySelector('[data-onde-vocale]');
    const dictee = module.querySelector('[data-dictee]');
    return {
      etat: module.getAttribute('data-etat-ecoute'),
      erreur: module.querySelector('[data-erreur-micro]')?.textContent?.trim() ?? null,
      temoinMicro: Boolean(module.querySelector('[data-temoin-micro]')),
      micros: window.__micros ?? 0,
      vivant: document.body.innerText.trim().length,
      boutons: document.querySelectorAll('button').length,
      // Ancré au centre du menu du bas (téléphone) : c'est ce mode qu'on juge ici.
      ancre: module.hasAttribute('data-ancre-menu'),
      // Au repos, l'icône aux cinq barres FIGÉES doit se voir, jamais le flux animé.
      repos: Boolean(module.querySelector('[data-icone-repos]')),
      ondeVocale: Boolean(onde),
      // En écoute, la ligne d'ondes porte `data-onde-ecoute` (barres ROUGES).
      ondeEcoute: onde?.hasAttribute('data-onde-ecoute') ?? false,
      dictee: dictee ? dictee.textContent.trim() : null,
      largeur: Math.round(boite.width),
      // Le module déborde-t-il de l'écran une fois élargi pour la dictée ?
      dansLEcran: boite.left >= -1 && boite.right <= window.innerWidth + 1,
    };
  });

/** Une phrase entendue, injectée par le point d'essai de la page (sans micro). */
const parler = async (p, texte) => {
  await p.evaluate((t) => window.haikodevEssai?.parole?.(t), texte);
  await p.waitForTimeout(400);
};

/**
 * Allumer (ou éteindre) l'écoute par le vrai chemin : le panneau, l'interrupteur.
 * L'icône du module devient intouchable une fois le panneau ouvert : on ne
 * l'appuie donc que si le module est encore fermé.
 */
const basculerEcoute = async (p) => {
  const ouvert = () => p.evaluate(() => document.querySelector('[data-module-voix]')?.hasAttribute('data-ouvert') ?? false);
  for (let essai = 0; essai < 3 && !(await ouvert()); essai += 1) {
    await p.locator('[data-icone-voix]').first().tap({ force: true });
    await p.waitForTimeout(700);
  }
  await p.locator('[data-interrupteur-ecoute]').dispatchEvent('click');
  await p.waitForTimeout(2500);
};

/**
 * L'application répond-elle encore au doigt ? On change d'écran par le menu du
 * bas et l'on regarde si l'onglet visé devient bien l'onglet actif — un geste
 * ordinaire, présent quel que soit le projet ouvert.
 */
const applicationVivante = async (p) => {
  const actif = (nom) =>
    p.evaluate((cherche) => {
      const boutons = [...document.querySelectorAll('[data-menu-bas] button')];
      const vise = boutons.find((b) => b.textContent?.includes(cherche));
      // L'onglet actif se reconnaît à `aria-current`, jamais à une couleur
      // écrite en dur : la classe cherchée jadis (`bg-raised`) a changé, et le
      // contrôle déclarait l'application morte alors qu'elle répondait.
      return vise ? vise.getAttribute('aria-current') === 'page' : null;
    }, nom);
  try {
    // Le module de voix se pose en bas, par-dessus le menu : on le referme
    // d'abord d'un appui ailleurs, sinon on jugerait un recouvrement.
    await p.touchscreen.tap(195, 120);
    await p.waitForTimeout(800);
    for (const nom of ['Chef', 'Tableau']) {
      await p.locator('[data-menu-bas] button', { hasText: nom }).first().tap();
      await p.waitForTimeout(1200);
      if ((await actif(nom)) !== true) {
        console.log(`      (l’onglet « ${nom} » n’a pas répondu à l’appui)`);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.log(`      (geste impossible : ${String(e).slice(0, 110)})`);
    return false;
  }
};

let ouverte = null;
try {
  /* ---------- 1 & 2. Un navigateur « à la Safari » : pas de webm ---------- */
  ouverte = await ouvrirPage(['webm']);
  const { page, erreurs, envois } = ouverte;

  const repos = await etat(page);
  noter('au repos, l’écoute est éteinte', repos?.etat === 'eteinte', `état « ${repos?.etat} »`);
  noter('écoute éteinte, AUCUN micro n’est ouvert', repos?.micros === 0, `${repos?.micros} ouverture(s)`);
  // Sur téléphone, le module est ANCRÉ au centre du menu du bas : c'est ce mode
  // qu'on juge. Au repos, il montre les cinq barres FIGÉES, jamais le flux animé.
  noter('sur téléphone, le module est ancré au menu du bas', repos?.ancre === true);
  noter(
    'au repos (ancré), les cinq barres figées se voient, pas le flux animé',
    repos?.repos === true && repos?.ondeVocale === false,
    `repos ${repos?.repos}, flux ${repos?.ondeVocale}`,
  );
  noter('écoute éteinte, l’application répond au doigt', await applicationVivante(page));

  await basculerEcoute(page);
  const guet = await etat(page);
  noter(
    'sans webm, l’écoute part quand même (repli de format)',
    guet?.etat === 'guette',
    `état « ${guet?.etat} »${guet?.erreur ? ` — « ${guet.erreur} »` : ''}`,
  );
  noter('sans webm, aucune erreur ne sort de la page', erreurs.length === 0, erreurs[0] ?? '');
  noter('l’application reste entière', (guet?.boutons ?? 0) > 10, `${guet?.boutons} boutons`);
  await page.screenshot({ path: `${SHOTS}/ecoute-mobile-sans-webm.png` });

  // Le son factice parle puis se tait : une tranche doit partir, nommée du BON
  // format. On laisse passer deux cycles du son avant de juger.
  for (let attente = 0; attente < 14 && envois.length === 0; attente += 1) {
    await page.waitForTimeout(1000);
  }
  noter('une tranche est bien envoyée', envois.length > 0, JSON.stringify(envois.slice(0, 3)));
  noter(
    'la tranche porte l’extension du format réellement enregistré',
    envois.length > 0 && envois.every((e) => e !== 'webm' && /^[a-z0-9]{2,4}$/.test(e)),
    JSON.stringify(envois.slice(0, 3)),
  );

  /* --- Le réveil « Dis Haiko » RÉAGIT, en mode ancré au menu du bas --- */
  // On injecte les phrases par le point d'essai de la page : le MÊME chemin que
  // le retour de /api/transcribe, sans dépendre du micro factice. L'écoute est
  // encore en guet ; le mot de réveil doit la faire passer en dictée.
  await parler(page, 'Dis Haiko');
  const reveille = await etat(page);
  noter(
    '« Dis Haiko » (ancré) fait passer le module en écoute',
    reveille?.etat === 'ecoute',
    `état « ${reveille?.etat} »`,
  );
  noter(
    'en écoute (ancré), les ondes passent au rouge et le flux s’anime',
    reveille?.ondeVocale === true && reveille?.ondeEcoute === true,
    `flux ${reveille?.ondeVocale}, rouge ${reveille?.ondeEcoute}`,
  );
  noter('en écoute (ancré), un bandeau de dictée s’affiche', reveille?.dictee !== null);
  noter(
    'élargi pour la dictée, le module reste dans l’écran',
    (reveille?.largeur ?? 0) > 100 && reveille?.dansLEcran === true,
    `largeur ${reveille?.largeur} px, dans l’écran ${reveille?.dansLEcran}`,
  );
  await parler(page, 'ouvre le tableau des tâches');
  const dicte = await etat(page);
  noter(
    'la phrase dictée s’affiche après le réveil',
    (dicte?.dictee ?? '').includes('ouvre le tableau des tâches'),
    `« ${dicte?.dictee} »`,
  );
  await page.screenshot({ path: `${SHOTS}/ecoute-mobile-reveil-ancre.png` });

  await basculerEcoute(page);
  noter('l’interrupteur rééteint tout', (await etat(page))?.etat === 'eteinte');
  await ouverte.contexte.close();
  ouverte = null;

  /* ---------- 4. Un navigateur qui ne sait RIEN enregistrer ---------- */
  ouverte = await ouvrirPage(['']);
  const seconde = ouverte.page;
  await basculerEcoute(seconde);
  const refus = await etat(seconde);
  noter(
    'sans aucun format, l’écoute renonce et le DIT',
    refus?.etat === 'refusee' && Boolean(refus?.erreur),
    `état « ${refus?.etat} », message « ${refus?.erreur ?? '—'} »`,
  );
  noter('en renonçant, plus aucun micro n’est laissé ouvert', refus?.temoinMicro === false);
  noter('sans aucun format, aucune erreur ne sort de la page', ouverte.erreurs.length === 0, ouverte.erreurs[0] ?? '');
  noter('l’application continue de fonctionner', await applicationVivante(seconde));
  await seconde.screenshot({ path: `${SHOTS}/ecoute-mobile-sans-format.png` });
  await ouverte.contexte.close();
  ouverte = null;

  /* ---------- 5. Le micro marche, mais le SERVEUR ne transcrit pas ---------- */
  // La panne la plus sournoise : tout a l'air normal, le micro est ouvert, et
  // rien ne sera jamais compris. Elle doit se DIRE, sans éteindre l'écoute.
  ouverte = await ouvrirPage(['webm'], true);
  const muette = ouverte.page;
  // L'interrupteur est une préférence du COMPTE : la page précédente a pu le
  // laisser allumé, auquel cas l'écoute est déjà partie au chargement. On
  // n'allume que si elle est éteinte, sinon on la couperait.
  if ((await etat(muette))?.etat === 'eteinte') await basculerEcoute(muette);
  for (let attente = 0; attente < 16 && ouverte.envois.length === 0; attente += 1) {
    await muette.waitForTimeout(1000);
  }
  await muette.waitForTimeout(1200);
  const panne = await etat(muette);
  noter('la transcription en panne a bien été tentée', ouverte.envois.length > 0, `${ouverte.envois.length} envoi(s)`);
  noter(
    'un serveur qui ne transcrit pas le DIT, en clair',
    Boolean(panne?.erreur) && String(panne?.erreur).includes('moteur de transcription absent du serveur'),
    `message « ${panne?.erreur ?? '—'} »`,
  );
  noter(
    'la panne du serveur n’éteint pas le micro',
    panne?.etat === 'guette',
    `état « ${panne?.etat} »`,
  );
  noter('la panne de transcription ne casse pas la page', ouverte.erreurs.length === 0, ouverte.erreurs[0] ?? '');
  await muette.screenshot({ path: `${SHOTS}/ecoute-mobile-transcription-en-panne.png` });
  // On ne laisse pas le micro armé derrière soi : la préférence est de toute
  // façon reposée en base à la sortie, mais on referme par le vrai chemin.
  if ((await etat(muette))?.etat !== 'eteinte') await basculerEcoute(muette);
} finally {
  try {
    if (ouverte) await ouverte.contexte.close();
  } catch {
    /* déjà fermé */
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
