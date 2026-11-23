#!/usr/bin/env node
/*
 * LA SILHOUETTE D'UNE VIGNETTE NE FAIT PAS SAUTER L'ÉCRAN.
 *
 * Les fichiers lourds de tous les projets vivent désormais sur le grand disque,
 * atteint par le réseau : une vignette met un instant à venir, là où elle était
 * instantanée depuis le disque du serveur. `ImageDePiece`
 * (`web/src/components/pastille-de-fichier.tsx`) montre donc une silhouette
 * pendant l'attente — et une silhouette est, par nature, un DOUBLON de mise en
 * page : deux descriptions du même cadre, que rien ne relie.
 *
 * Ce contrôle verrouille les trois façons dont ce doublon se paie.
 *
 *  1. UN SEUL RENDU. Aucune autre vignette de pièce jointe ne doit poser son
 *     propre `<img src={adresseDePiece(…)}>` : le jour où le cadre change,
 *     un rendu parallèle garderait l'ancien. `PastilleDeFichier` est le rendu
 *     unique d'une pièce jointe, et `ImageDePiece` celui de son image.
 *  2. AUCUN SAUT. En vrai navigateur, l'image RETENUE, on relève la boîte de
 *     la silhouette ; on relâche, et on relève celle de l'image. On exige le
 *     même nombre d'éléments et un écart ≤ 2 px sur GAUCHE, LARGEUR **ET
 *     HAUT** — un bloc en trop au-dessus d'une liste décale tout vers le bas
 *     sans changer d'un pixel sa largeur, et c'est le saut le plus visible.
 *     Mesuré dans deux tailles d'écran, ordinateur et téléphone.
 *  3. UNE SILHOUETTE QUI SE VOIT. Sa couleur est relevée dans le vrai thème :
 *     en sombre, `--surface` (8 %) et `--border` (9 %) ne diffèrent que d'un
 *     point de clarté, et une silhouette peinte au jeton de bordure y serait
 *     invisible tout en occupant la bonne place.
 *
 * LES CLASSES NE SONT PAS RECOPIÉES ICI : elles sont LUES dans le composant.
 * Le jour où il change de taille ou de couleur, ce contrôle le suit tout seul
 * — c'est la seule façon d'empêcher les deux descriptions de diverger.
 *
 *   node scripts/verif-silhouette-image.mjs
 *
 * Aucun serveur, aucune donnée : le contrôle bâtit sa page avec le Tailwind du
 * projet et le vrai fichier de thèmes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSANT = path.join(RACINE, 'web', 'src', 'components', 'pastille-de-fichier.tsx');

let echecs = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const ko = (m) => {
  echecs += 1;
  console.log(`  ÉCHEC ${m}`);
};

console.log('SILHOUETTE D’UNE VIGNETTE — l’écran saute-t-il quand l’image arrive ?\n');

/* ------------------------------------------------------------------ */
/* 1. UN SEUL RENDU                                                    */
/* ------------------------------------------------------------------ */

const source = fs.readFileSync(COMPOSANT, 'utf8');
const fichiersWeb = execFileSync('grep', ['-rl', 'adresseDePiece', path.join(RACINE, 'web', 'src')], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const coupables = [];
for (const fichier of fichiersWeb) {
  if (path.resolve(fichier) === COMPOSANT) continue;
  const texte = fs.readFileSync(fichier, 'utf8');
  /* Une balise <img dont la source est une pièce jointe, hors du rendu unique. */
  if (/<img[^>]*\n?[^>]*src=\{adresseDePiece\(/.test(texte)) coupables.push(path.relative(RACINE, fichier));
}
if (coupables.length === 0) ok('aucune vignette de pièce jointe ne double le rendu de « ImageDePiece »');
else ko(`rendu parallèle d’une vignette dans : ${coupables.join(', ')} — passer par « ImageDePiece »`);

if (!/data-silhouette-image=/.test(source)) ko('« ImageDePiece » ne pose plus son repère data-silhouette-image');
if (!/loading="lazy"/.test(source)) ko('« ImageDePiece » ne demande plus l’image à la demande (loading="lazy")');

/* LES CLASSES, LUES DANS LE COMPOSANT — jamais recopiées. */
const classesSilhouette = source.match(/data-silhouette-image=\{id\}\s*className="([^"]+)"/)?.[1];
const cadreVignette = source.match(/grande \? '([^']+)' : compact \? '([^']+)' : '([^']+)'/);
if (!classesSilhouette) ko('impossible de lire les classes de la silhouette dans le composant');
if (!cadreVignette) ko('impossible de lire les tailles de cadre dans le composant');

/* ------------------------------------------------------------------ */
/* 2 et 3. LA MESURE, EN VRAI NAVIGATEUR                               */
/* ------------------------------------------------------------------ */

if (classesSilhouette && cadreVignette) {
  const styles = fs.readFileSync(path.join(RACINE, 'web', 'src', 'styles.css'), 'utf8');
  /* Le thème sombre par défaut : c'est là que le piège du contraste se joue. */
  const racineSombre = styles.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const jeton = (nom) => racineSombre.match(new RegExp(`--${nom}:\\s*([^;]+);`))?.[1]?.trim();

  const page = `<!doctype html><html class="dark"><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root { --surface: ${jeton('surface') ?? '0 0% 8%'}; --border: ${jeton('border') ?? '0 0% 9%'};
          --faint: ${jeton('faint') ?? '0 0% 58%'}; --bg: ${jeton('bg') ?? '0 0% 0%'}; }
  body { background: hsl(var(--bg)); margin: 0; padding: 24px; }
  .bg-surface { background-color: hsl(var(--surface)); }
  .border-border { border-color: hsl(var(--border)); }
  .bg-faint\\/25 { background-color: hsl(var(--faint) / 0.25); }
  .animate-silhouette { animation: silhouette 1.4s ease-in-out infinite; }
  @keyframes silhouette { 0%,100% { opacity:.5 } 50% { opacity:.85 } }
</style></head><body>
  <div id="cadres"></div>
  <script>
    const tailles = ${JSON.stringify(cadreVignette.slice(1, 4))};
    const classesSilhouette = ${JSON.stringify(classesSilhouette)};
    const hote = document.getElementById('cadres');
    tailles.forEach((taille, rang) => {
      const bouton = document.createElement('button');
      bouton.className = 'relative block overflow-hidden rounded-lg border border-border bg-surface ' + taille;
      bouton.dataset.cadre = String(rang);
      const silhouette = document.createElement('span');
      silhouette.className = classesSilhouette;
      silhouette.dataset.silhouetteImage = String(rang);
      const img = document.createElement('img');
      img.dataset.imagePiece = String(rang);
      img.className = 'relative h-full w-full object-cover opacity-0';
      img.loading = 'lazy';
      bouton.append(silhouette, img);
      hote.append(bouton);
    });
    /* L'IMAGE EST RETENUE : la page reste sur sa silhouette aussi longtemps
       qu'on veut, sans délai artificiel. « window.relacher() » la relâche. */
    window.relacher = () => {
      const jaune = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#c90"/></svg>');
      document.querySelectorAll('[data-image-piece]').forEach((img) => {
        img.addEventListener('load', () => {
          img.classList.remove('opacity-0');
          img.classList.add('opacity-100');
          img.parentElement.querySelector('[data-silhouette-image]')?.remove();
        }, { once: true });
        img.src = jaune;
      });
    };
  </script>
</body></html>`;

  const fichierPage = path.join(process.env.TMPDIR ?? '/tmp', `verif-silhouette-image-${process.pid}.html`);
  fs.writeFileSync(fichierPage, page);

  const FENETRES = [
    { nom: 'ordinateur', viewport: { width: 1440, height: 900 } },
    { nom: 'téléphone', viewport: { width: 390, height: 844 } },
  ];

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const fenetre of FENETRES) {
      const contexte = await navigateur.newContext({ viewport: fenetre.viewport });
      const onglet = await contexte.newPage();
      await onglet.goto(`file://${fichierPage}`);
      await onglet.locator('[data-silhouette-image]').first().waitFor({ state: 'attached' });

      const boites = (selecteur) =>
        onglet.$$eval(selecteur, (noeuds) =>
          noeuds.map((n) => {
            const b = n.getBoundingClientRect();
            return { gauche: b.left, largeur: b.width, haut: b.top };
          }),
        );

      const avant = await boites('[data-silhouette-image]');
      /* LE CONTRASTE, RELEVÉ SUR LE VRAI FOND QUI LA PORTE. */
      const contraste = await onglet.$eval('[data-silhouette-image]', (n) => {
        const canaux = (couleur) => (couleur.match(/[\d.]+/g) ?? []).map(Number);
        const clarte = ([r, v, b]) => 0.2126 * r + 0.7152 * v + 0.0722 * b;
        const fond = canaux(getComputedStyle(n.parentElement).backgroundColor);
        const [r, v, b, a = 1] = canaux(getComputedStyle(n).backgroundColor);
        /* LA TRANSPARENCE COMPTE. Une silhouette posée en voile ne vaut pas sa
           couleur brute : sans composer sur le fond qui la porte, on mesure
           une teinte que personne ne voit et le piège passe inaperçu. */
        const composee = [r, v, b].map((canal, i) => canal * a + (fond[i] ?? 0) * (1 - a));
        return Math.abs(clarte(composee) - clarte(fond));
      });

      await onglet.evaluate(() => window.relacher());
      await onglet.waitForFunction(() => document.querySelectorAll('[data-silhouette-image]').length === 0);
      const apres = await boites('[data-image-piece]');

      if (avant.length === 0) {
        ko(`${fenetre.nom} : aucune silhouette mesurée`);
      } else if (avant.length !== apres.length) {
        ko(`${fenetre.nom} : ${avant.length} silhouette(s) pour ${apres.length} image(s)`);
      } else {
        let pire = 0;
        let axePire = '';
        for (let i = 0; i < avant.length; i += 1) {
          for (const axe of ['gauche', 'largeur', 'haut']) {
            const ecart = Math.abs(avant[i][axe] - apres[i][axe]);
            if (ecart > pire) {
              pire = ecart;
              axePire = axe;
            }
          }
        }
        if (pire > 2) ko(`${fenetre.nom} : l’écran saute de ${pire.toFixed(1)} px (${axePire}) à l’arrivée de l’image`);
        else ok(`${fenetre.nom} : ${avant.length} vignette(s), écart max ${pire.toFixed(1)} px (gauche, largeur et haut)`);
      }

      /* 8 points de clarté : au-dessous, la silhouette se devine à peine sur
         un écran ordinaire. Le jeton de bordure sur `--surface` en donne 2. */
      if (contraste < 8) ko(`${fenetre.nom} : silhouette presque invisible sur son fond (${contraste.toFixed(1)} points de clarté)`);
      else ok(`${fenetre.nom} : silhouette visible sur son fond (${contraste.toFixed(1)} points de clarté)`);

      await contexte.close();
    }
  } finally {
    await navigateur.close();
    fs.rmSync(fichierPage, { force: true });
  }
}

console.log('');
if (echecs > 0) {
  console.log(`ÉCHEC : ${echecs} point(s) à revoir.`);
  process.exit(1);
}
console.log('OK — la vignette montre sa silhouette, et l’écran ne saute pas.');
