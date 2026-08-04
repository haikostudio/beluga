#!/usr/bin/env node
/**
 * Les six images des notifications arrivent-elles VRAIMENT dans un navigateur,
 * et sont-elles bien différentes les unes des autres ?
 *
 * Le choix de l'image (motif → fichier) est déjà verrouillé côté règles par
 * `notification-tri.test.ts`, des deux côtés : la table de `shared/` et celle,
 * recopiée, du service worker. Reste ce qu'aucun test pur ne peut dire — que
 * les fichiers sont servis, qu'ils se décodent, et qu'une alerte de chaque
 * genre ne montre pas deux fois le même dessin.
 *
 * Viser le serveur de DÉVELOPPEMENT (jamais l'application publiée) :
 *
 *   npm run dev --workspace web -- --port 7099
 *   node scripts/verif-icones-notifications.mjs
 *
 * Autre adresse : HAIKO_ICONES_URL. Le Chrome du système est utilisé, aucun
 * navigateur n'est à télécharger.
 */
import { chromium } from 'playwright';

const URL_BASE = process.env.HAIKO_ICONES_URL || 'http://localhost:7099';

/** Les six genres, tels que `IconeNotification` les nomme. */
const IMAGES = ['termine', 'attention', 'erreur', 'publication', 'quota', 'redemarrage'];

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const navigateur = await chromium.launch({ channel: 'chrome' });
try {
  const page = await navigateur.newPage();
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });

  // Chaque image est chargée par le navigateur lui-même, comme le ferait une
  // notification, puis réduite à une empreinte de ses pixels.
  const empreintes = await page.evaluate(async (noms) => {
    const lire = async (nom) => {
      const image = new Image();
      image.src = `/notif/${nom}.png`;
      try {
        await image.decode();
      } catch {
        return { nom, ok: false };
      }
      const toile = document.createElement('canvas');
      toile.width = image.naturalWidth;
      toile.height = image.naturalHeight;
      toile.getContext('2d').drawImage(image, 0, 0);
      return {
        nom,
        ok: true,
        largeur: image.naturalWidth,
        hauteur: image.naturalHeight,
        empreinte: toile.toDataURL().slice(-2000),
      };
    };
    return Promise.all(noms.map(lire));
  }, IMAGES);

  for (const image of empreintes) {
    noter(
      `l’image « ${image.nom} » est servie et se décode`,
      image.ok && image.largeur === 192 && image.hauteur === 192,
      image.ok ? `${image.largeur}×${image.hauteur}` : 'illisible',
    );
  }

  const distinctes = new Set(empreintes.filter((i) => i.ok).map((i) => i.empreinte));
  noter(
    'les six genres d’alerte montrent six dessins différents',
    distinctes.size === IMAGES.length,
    `${distinctes.size} dessin(s) distinct(s)`,
  );

  // La table du service worker doit désigner des fichiers qui existent.
  const sw = await page.evaluate(async () => (await fetch('/sw.js')).text());
  const nommees = [...sw.matchAll(/'[a-z-]+':\s*'([a-z-]+)'/g)].map((m) => m[1]);
  noter(
    'le service worker ne nomme que des images existantes',
    nommees.length > 0 && nommees.every((nom) => IMAGES.includes(nom)),
    nommees.join(', '),
  );
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) réussi(s).`);
process.exit(echecs ? 1 : 0);
