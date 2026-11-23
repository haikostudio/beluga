#!/usr/bin/env node
/**
 * LA VIDÉO TRANSPARENTE DE L'APERÇU DU STUDIO, AVEC L'IDENTITÉ DE L'IPHONE.
 *
 * Fabrique une petite vidéo VP9 à alpha, sa copie H.264, et joue la VRAIE page
 * d'aperçu dans un cadre isolé comme celui de l'écran (`sandbox="allow-scripts"`),
 * servie par un mini serveur à part. Prouve : l'échange vidéo → canevas, l'image
 * lue malgré le cadre sans origine, les coins transparents et le centre opaque, la
 * lecture qui avance, un Chrome de bureau qui garde sa vidéo, une page de rendu
 * sans aucune trace de la copie, et la mémoire de la page.
 *
 * Chrome N'EST PAS WebKit : ce contrôle prouve la logique, pas le décodage d'un
 * vrai iPhone. Rien n'est écrit en base, aucun démon n'est lancé.
 *
 *   npm run build:server && node scripts/verif-copie-alpha.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { traduireEnPage, MOTEUR_APERCU_STUDIO, compositionVide } = await import(path.join(RACINE, 'shared/dist/index.js'));
const { copieAlphaDUneVideo, videoATransparence } = await import(path.join(RACINE, 'server/dist/studio-detourage.js'));
const GSAP = createRequire(path.join(RACINE, 'server/package.json')).resolve('gsap/dist/gsap.min.js');

const echecs = [];
const verifier = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) echecs.push(message);
};

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-copie-alpha-'));
const webm = path.join(dossier, 'a.webm');
const opaque = path.join(dossier, 'o.webm');
const lavfi = "color=0x00ff00:s=200x400:d=4:r=30,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(between(X,50,150)*between(Y,100,300),255,0)'";
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', lavfi, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', webm]);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64:d=1', '-c:v', 'libvpx-vp9', opaque]);
verifier(await videoATransparence(webm), 'une vidéo à alpha est reconnue dans son fichier');
verifier(!(await videoATransparence(opaque)), 'une vidéo opaque n’est pas prise pour une transparente');
const copie = await copieAlphaDUneVideo(webm, 200, 400);
fs.renameSync(copie.chemin, path.join(dossier, 'c.mp4'));

const serveur = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://x').pathname;
  if (route === '/studio/gsap.min.js') return fs.createReadStream(GSAP).pipe(res);
  const fichier = { '/studio-media/a': webm, '/studio-media/c': path.join(dossier, 'c.mp4') }[route];
  if (!fichier) return res.writeHead(404).end();
  const taille = fs.statSync(fichier).size;
  const entetes = { 'content-type': route.endsWith('c') ? 'video/mp4' : 'video/webm', 'accept-ranges': 'bytes', ...(route.endsWith('c') ? { 'access-control-allow-origin': '*' } : {}) };
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (!m) return (res.writeHead(200, { ...entetes, 'content-length': taille }), fs.createReadStream(fichier).pipe(res));
  const debut = +m[1];
  const fin = m[2] ? +m[2] : taille - 1;
  res.writeHead(206, { ...entetes, 'content-range': `bytes ${debut}-${fin}/${taille}`, 'content-length': fin - debut + 1 });
  fs.createReadStream(fichier, { start: debut, end: fin }).pipe(res);
});
await new Promise((ok) => serveur.listen(0, 'localhost', ok));
const origine = `http://localhost:${serveur.address().port}`;

const composition = compositionVide('9:16', 4);
composition.fond = '#ff0000';
composition.pistes.find((p) => p.id === 'videos').segments.push({ id: 'vid', genre: 'video', debut: 0, duree: 4, mediaId: 'a', debutMedia: 0, volume: 0, ajustement: 'contenir' });
const medias = { a: { url: `${origine}/studio-media/a`, genre: 'video', copieAlpha: { url: `${origine}/studio-media/c`, largeur: copie.largeur, hauteur: copie.hauteur } } };
const page = traduireEnPage(composition, {
  format: '9:16',
  medias,
  gsap: `${origine}/studio/gsap.min.js`,
  polices: `${origine}/studio/polices/`,
  mode: 'apercu',
  sourcesApercu: { scripts: `${origine}/studio/`, medias: `${origine}/studio-media/`, polices: `${origine}/studio/polices/` },
  moteurApercu: MOTEUR_APERCU_STUDIO,
});
const rendu = traduireEnPage(composition, { format: '9:16', medias, gsap: 'gsap.min.js', polices: 'polices/', mode: 'rendu' });
verifier(!/copie-alpha|studio-media\/c/.test(rendu), 'la page d’export ne connaît pas la copie');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults']  });

async function ouvrir(userAgent) {
  const contexte = await navigateur.newContext({ ...(userAgent ? { userAgent, isMobile: true, hasTouch: true } : {}), viewport: { width: 390, height: 780 } });
  const onglet = await contexte.newPage();
  await onglet.route(`${origine}/hote`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0"></body>' }));
  await onglet.goto(`${origine}/hote`);
  await onglet.evaluate((srcdoc) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText = 'width:360px;height:640px;border:0';
    f.srcdoc = srcdoc;
    document.body.append(f);
    window.envoyer = (m) => f.contentWindow.postMessage(m, '*');
  }, page);
  onglet.on('pageerror', (e) => console.log('  [erreur]', e.message));
  await onglet.waitForTimeout(500);
  return { onglet, contexte, cadre: onglet.frames().find((x) => x !== onglet.mainFrame()) };
}

const LIRE_PIXELS = () => {
  const c = document.querySelector('#seg-vid');
  if (c.tagName !== 'CANVAS') return { balise: c.tagName };
  const x = c.getContext('2d');
  const p = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data);
  return { balise: 'CANVAS', coin: p(3, 3), centre: p(c.width / 2, c.height / 2), masque: Array.from(x.getImageData(c.width * 0.1, c.height * 0.1, 1, 1).data), compteur: window.__studioCopies, sources: document.querySelectorAll('body > video').length, objet: getComputedStyle(c).objectFit };
};

try {
  const { onglet, cadre, contexte } = await ouvrir(IPHONE);
  await onglet.evaluate(() => window.envoyer({ type: 'aller', t: 1 }));
  await onglet.waitForTimeout(1500);
  const arret = await cadre.evaluate(LIRE_PIXELS);
  verifier(arret.balise === 'CANVAS' && arret.sources === 1, 'iPhone : la vidéo transparente devient un canevas, sa copie joue à part');
  verifier(arret.compteur?.refus === 0 && arret.compteur?.images > 0, `iPhone : la copie se dessine malgré le cadre sans origine (${JSON.stringify(arret.compteur)})`);
  verifier(arret.coin?.[3] === 0 && arret.masque?.[3] === 0, `iPhone : les coins sont transparents (${arret.coin})`);
  verifier(arret.centre?.[3] === 255 && arret.centre?.[1] > 200 && arret.centre?.[0] < 40, `iPhone : le centre garde sa couleur (${arret.centre})`);
  verifier(arret.objet === 'contain', 'iPhone : le cadrage de la vidéo vaut sur le canevas');
  const image = await onglet.locator('iframe').screenshot({ path: path.join(dossier, 'iphone.png') });
  verifier(image.length > 0, `capture : ${path.join(dossier, 'iphone.png')}`);
  await onglet.evaluate(() => window.envoyer({ type: 'lire', t: 0 }));
  await onglet.waitForTimeout(2000);
  const lu = await cadre.evaluate(LIRE_PIXELS);
  verifier(lu.compteur.images > arret.compteur.images + 5, `iPhone : la lecture avance image par image (${lu.compteur.images - arret.compteur.images} images en 2 s)`);
  const cdp = await contexte.newCDPSession(onglet);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  console.log(`  mémoire JS de la page : ${Math.round(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1e6)} Mo`);
  await contexte.close();

  const bureau = await ouvrir(null);
  await bureau.onglet.waitForTimeout(300);
  const balise = await bureau.cadre.evaluate(() => document.querySelector('#seg-vid').tagName);
  verifier(balise === 'VIDEO', 'Chrome de bureau : la vidéo d’origine reste jouée');
  await bureau.contexte.close();
} finally {
  await navigateur.close();
  serveur.close();
}
if (echecs.length) {
  console.error(`\n${echecs.length} échec(s)`);
  process.exit(1);
}
console.log('\nCopie d’aperçu : tout est bon (imitation dans Chrome, le mot de la fin revient à un vrai iPhone).');
process.exit(0);
