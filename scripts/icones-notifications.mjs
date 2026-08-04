#!/usr/bin/env node
/**
 * Fabrique les six images des notifications, dans `web/public/notif/`.
 *
 * Pourquoi un script plutôt que six fichiers déposés à la main : une image de
 * notification doit être un PNG (les navigateurs ne rendent pas le SVG à cet
 * endroit), et un PNG binaire posé dans le dépôt ne se relit ni ne se corrige.
 * Ici, la forme et la couleur de chaque image se lisent en clair et se
 * regénèrent d'une commande — aucune bibliothèque, seulement `zlib`.
 *
 *   node scripts/icones-notifications.mjs
 *
 * Les six noms sont ceux de `IconeNotification` (`shared/src/notification-tri.ts`) :
 * termine, attention, erreur, publication, quota, redemarrage.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// La racine se déduit du script : lancé depuis une copie de travail, il écrit
// dans CETTE copie et non dans le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = path.join(RACINE, 'web', 'public', 'notif');

const TAILLE = 192;
/** Trois échantillons par côté : les bords obliques ne font pas d'escalier. */
const FINESSE = 3;
const FOND = '#09090b';
const COIN = 42;

/* ------------------------------------------------------------------ */
/* Les formes : chacune répond « ce point est-il dedans ? »             */
/* ------------------------------------------------------------------ */

const rectangleArrondi = (x, y, l, h, r) => (px, py) => {
  if (px < x || py < y || px > x + l || py > y + h) return false;
  const dx = Math.max(x + r - px, 0, px - (x + l - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return dx * dx + dy * dy <= r * r;
};

/** Un trait épais aux bouts ronds, d'un point à l'autre. */
const trait = (x1, y1, x2, y2, epaisseur) => (px, py) => {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const long2 = vx * vx + vy * vy || 1;
  let t = ((px - x1) * vx + (py - y1) * vy) / long2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (x1 + t * vx);
  const dy = py - (y1 + t * vy);
  return dx * dx + dy * dy <= (epaisseur / 2) ** 2;
};

const disque = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

/** Un anneau, éventuellement ouvert : `ouverture` est un demi-angle en degrés. */
const anneau = (cx, cy, r, epaisseur, ouverture = 0) => (px, py) => {
  const d = Math.hypot(px - cx, py - cy);
  if (d < r - epaisseur / 2 || d > r + epaisseur / 2) return false;
  if (!ouverture) return true;
  // L'ouverture est en haut : l'angle est mesuré depuis la verticale.
  const angle = Math.abs((Math.atan2(px - cx, cy - py) * 180) / Math.PI);
  return angle > ouverture;
};

const polygone = (points) => (px, py) => {
  let dedans = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
};

/* ------------------------------------------------------------------ */
/* Le dessin                                                            */
/* ------------------------------------------------------------------ */

function couleur(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Peint une couche : `formes` unies, mélangées au fond selon leur couverture. */
function peindre(pixels, formes, hex) {
  const [r, v, b] = couleur(hex);
  const pas = 1 / FINESSE;
  for (let y = 0; y < TAILLE; y++) {
    for (let x = 0; x < TAILLE; x++) {
      let dedans = 0;
      for (let sy = 0; sy < FINESSE; sy++) {
        for (let sx = 0; sx < FINESSE; sx++) {
          const px = x + (sx + 0.5) * pas;
          const py = y + (sy + 0.5) * pas;
          if (formes.some((forme) => forme(px, py))) dedans++;
        }
      }
      if (!dedans) continue;
      const a = dedans / (FINESSE * FINESSE);
      const i = (y * TAILLE + x) * 4;
      pixels[i] = Math.round(pixels[i] * (1 - a) + r * a);
      pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + v * a);
      pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + b * a);
      pixels[i + 3] = Math.round(pixels[i + 3] * (1 - a) + 255 * a);
    }
  }
}

/* ------------------------------------------------------------------ */
/* L'écriture du PNG                                                    */
/* ------------------------------------------------------------------ */

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const octet of buf) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function morceau(type, data) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, somme]);
}

function png(pixels) {
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(TAILLE, 0);
  entete.writeUInt32BE(TAILLE, 4);
  entete[8] = 8; // 8 bits par composante
  entete[9] = 6; // couleurs + transparence
  // Une ligne de plus par rangée : l'octet de filtre, laissé à zéro.
  const brut = Buffer.alloc(TAILLE * (TAILLE * 4 + 1));
  for (let y = 0; y < TAILLE; y++) {
    pixels.copy(brut, y * (TAILLE * 4 + 1) + 1, y * TAILLE * 4, (y + 1) * TAILLE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', entete),
    morceau('IDAT', zlib.deflateSync(brut, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Les six images                                                       */
/* ------------------------------------------------------------------ */

const IMAGES = {
  // Une coche : le travail est fini.
  termine: [{ hex: '#22c55e', formes: [trait(52, 100, 84, 132, 22), trait(84, 132, 142, 62, 22)] }],
  // Un triangle : on attend une décision. Le point d'exclamation est creusé
  // dans le fond, comme sur le repère orange de l'application.
  attention: [
    { hex: '#f59e0b', formes: [polygone([[96, 36], [162, 152], [30, 152]])] },
    { hex: FOND, formes: [trait(96, 82, 96, 116, 14), disque(96, 134, 8)] },
  ],
  // Une croix : quelque chose est tombé.
  erreur: [{ hex: '#ef4444', formes: [trait(62, 62, 130, 130, 22), trait(130, 62, 62, 130, 22)] }],
  // Une flèche qui monte : le travail est parti en ligne.
  publication: [
    {
      hex: '#3b82f6',
      formes: [trait(96, 152, 96, 74, 22), polygone([[96, 34], [148, 88], [44, 88]])],
    },
  ],
  // Trois barres qui montent : la consommation de la semaine.
  quota: [
    {
      hex: '#eab308',
      formes: [
        rectangleArrondi(46, 116, 28, 40, 10),
        rectangleArrondi(82, 86, 28, 70, 10),
        rectangleArrondi(118, 52, 28, 104, 10),
      ],
    },
  ],
  // Le symbole d'allumage : le serveur repart.
  redemarrage: [
    { hex: '#a1a1aa', formes: [anneau(96, 106, 48, 20, 34), trait(96, 40, 96, 96, 20)] },
  ],
};

fs.mkdirSync(SORTIE, { recursive: true });
const fondArrondi = rectangleArrondi(0, 0, TAILLE, TAILLE, COIN);
for (const [nom, couches] of Object.entries(IMAGES)) {
  const pixels = Buffer.alloc(TAILLE * TAILLE * 4); // transparent au départ
  peindre(pixels, [fondArrondi], FOND);
  for (const couche of couches) peindre(pixels, couche.formes, couche.hex);
  const fichier = path.join(SORTIE, `${nom}.png`);
  fs.writeFileSync(fichier, png(pixels));
  console.log(`  ${path.relative(RACINE, fichier)}`);
}
console.log(`${Object.keys(IMAGES).length} image(s) écrite(s).`);
