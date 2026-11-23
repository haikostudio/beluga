#!/usr/bin/env node
/**
 * PLUS AUCUN PERSONNAGE : NI IMAGE DEMANDÉE, NI MACHINERIE RESTÉE DERRIÈRE.
 *
 * Chaque colonne du tableau portait une petite figure détourée, animée quand un
 * agent travaillait, et l'application savait la remplacer depuis ses réglages.
 * Tout cela est retiré au profit d'une interface sobre : l'information « ça
 * travaille » est reprise par un INDICATEUR dessiné en code
 * (`shared/src/indicateur-activite.ts`), présent dans TOUTES les colonnes
 * occupées — l'ancien dessin ne bougeait que dans deux d'entre elles.
 *
 * Un retrait en chaîne se prouve, il ne se suppose pas : un seul maillon oublié
 * laisse une image demandée qui n'existe plus (un trou dans un entête, une
 * alerte sans icône). Ce contrôle relit donc le dépôt SERVI, sans rien lancer :
 *
 *   node scripts/verif-plus-aucun-personnage.mjs
 *
 * Avec une interface en marche, il va plus loin et écoute les requêtes d'un
 * VRAI navigateur — aucune ne doit partir vers `/personnages/…`, ni échouer :
 *
 *   HAIKO_PERSONNAGES_URL=http://localhost:7099 node scripts/verif-plus-aucun-personnage.mjs
 *
 * (`localhost`, jamais `127.0.0.1` : le serveur de développement n'écoute qu'en
 * IPv6. Ne jamais reprendre `BELUGA_URL`, qui désigne l'application publiée.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* LE DÉPÔT D'OÙ PART LE SCRIPT, jamais un chemin personnel : le contrôle se
   lance aussi bien depuis une copie de travail que depuis le tronc. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => {
  const chemin = path.join(RACINE, relatif);
  return fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
};

const resultats = [];
const noter = (libelle, ok, detail = '') => {
  resultats.push({ libelle, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${libelle}${detail ? ` (${detail})` : ''}`);
};

console.log('\n1. Les fichiers des personnages ont disparu du dépôt');

for (const chemin of [
  'web/public/personnages',
  'shared/src/personnages-colonnes.ts',
  'server/src/personnages.ts',
  'web/src/components/reglages/page-personnages.tsx',
  'scripts/personnages-colonnes.py',
  'scripts/verif-personnages-colonnes.mjs',
  'server/src/test/personnages-colonnes.test.ts',
]) {
  noter(`« ${chemin} » n’existe plus`, !fs.existsSync(path.join(RACINE, chemin)));
}

console.log('\n2. Plus personne ne demande une image de personnage');

/* On relit ce qui est SERVI au navigateur : le code de l'interface, le petit
   programme des alertes fermées, et les règles partagées. */
const SOURCES = [];
const parcourir = (dossier, filtre) => {
  const complet = path.join(RACINE, dossier);
  if (!fs.existsSync(complet)) return;
  for (const entree of fs.readdirSync(complet, { withFileTypes: true })) {
    const relatif = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      if (entree.name === 'node_modules' || entree.name === 'dist') continue;
      parcourir(relatif, filtre);
    } else if (filtre.test(entree.name)) {
      SOURCES.push([relatif, fs.readFileSync(path.join(RACINE, relatif), 'utf8')]);
    }
  }
};
parcourir('web/src', /\.(ts|tsx|css)$/);
parcourir('shared/src', /\.ts$/);
parcourir('server/src', /\.ts$/);
SOURCES.push(['web/public/sw.js', lire('web/public/sw.js') ?? '']);

const ADRESSE = /['"`(]\/personnages\//;
const demandeurs = SOURCES.filter(([, texte]) => ADRESSE.test(texte)).map(([nom]) => nom);
noter('aucune adresse « /personnages/… » dans le code servi', demandeurs.length === 0, demandeurs.join(', '));

/* Seuls les noms de l'ancien module (server/src/personnages.ts, shared/src/personnages-colonnes.ts)
   comptent : le Studio garde ses propres fonctions locales « …DuPersonnage » (personnage 3D Meshy). */
const SYMBOLES = /from ['"][^'"]*\/(personnages|personnages-colonnes)(\.js)?['"]|personnagesRemplaces|fichierDuPersonnageRemplace|routeDUnPersonnage|remplacerLePersonnage|retablirLePersonnage|avatarDeLAlerte|DOSSIER_DES_PERSONNAGES|jugerImageDePersonnage/;
const restes = SOURCES.filter(([nom, texte]) => nom !== 'web/public/sw.js' && SYMBOLES.test(texte)).map(([nom]) => nom);
noter('aucun appel au module retiré ne subsiste', restes.length === 0, restes.join(', '));

/* Le service worker a SA propre copie de tout : il ne partage rien avec
   l'application, et c'est lui qu'on oublie. Sa table des portraits doit avoir
   disparu, et l'icône neutre du motif prendre le relais. */
const sw = lire('web/public/sw.js') ?? '';
noter('le programme des alertes fermées n’a plus sa table de portraits', !/const PERSONNAGES\b/.test(sw));
noter('…et son avatar retombe sur l’icône neutre du motif', /return imageDeLAlerte\(motif\)/.test(sw));

const app = lire('web/src/app.tsx') ?? '';
noter('l’application ouverte choisit la même icône neutre', /icon: imageDeLAlerte\(event\.motif\)/.test(app));

console.log('\n3. Les portes du serveur et le dictionnaire sont nets');

const http = lire('server/src/http.ts') ?? '';
noter('plus aucune porte « /api/personnage »', !http.includes('/api/personnage'));
const config = lire('server/src/config.ts') ?? '';
noter('plus aucun dossier de dépôt d’images', !/PATHS\.personnages|personnages: path\.join/.test(config));
const protocole = lire('shared/src/protocol.ts') ?? '';
noter('le message envoyé à la connexion a disparu du protocole', !/literal\('personnages'\)/.test(protocole));
const arborescence = lire('shared/src/reglages-arborescence.ts') ?? '';
noter('la rubrique des réglages a disparu', !/cle: 'personnages'/.test(arborescence));
const traductions = lire('shared/src/traductions.ts') ?? '';
/* Les phrases du Studio parlent de « personnage 3D » : on ne cherche que les clés retirées au commit 0cc77ff0. */
const ANCIENNES_PHRASES = [
  "'Personnages des colonnes'",
  "'personnage d\\'origine'",
  'Le personnage de « {v0} » a été remplacé.',
  "a retrouvé son personnage d'origine.",
  'Chaque colonne du tableau a son personnage.',
];
noter('le dictionnaire ne garde plus une seule phrase orpheline', !ANCIENNES_PHRASES.some((phrase) => traductions.includes(phrase)));
const habillage = lire('web/tailwind.config.js') ?? '';
noter('l’animation de balancement n’est plus déclarée', !/personnage-au-travail/.test(habillage));

console.log('\n4. Ce qui REMPLACE est bien là');

const indicateur = lire('shared/src/indicateur-activite.ts') ?? '';
noter('la règle de l’indicateur existe, et ne privilégie aucune colonne', /export function colonneAuTravail/.test(indicateur) && !/COLONNES_VIVANTES/.test(indicateur));
const composant = lire('web/src/components/indicateur-activite.tsx') ?? '';
noter('le composant est unique, et ne demande aucune image', /export function IndicateurActivite/.test(composant) && !/<img/.test(composant));
noter(
  '…il laisse passer le doigt (le dépôt d’une carte se résout sous lui)',
  /pointer-events-none/.test(composant),
);
noter('…et il est muet pour les lecteurs d’écran', /aria-hidden/.test(composant));
const styles = lire('web/src/styles.css') ?? '';
noter(
  '« réduire les animations » arrête son battement, sans l’effacer',
  /\[data-indicateur-activite\] \.animate-ping/.test(styles),
);
const tableau = lire('web/src/components/board.tsx') ?? '';
noter('chaque entête de colonne le pose, sur son propre comptage', /<IndicateurActivite cartesAuTravail=\{auTravail\}/.test(tableau));
const conversation = lire('web/src/components/chat.tsx') ?? '';
noter('la conversation d’une carte pose le MÊME', /<IndicateurActivite cartesAuTravail=\{busy[^}]*\? 1 : 0\}/.test(conversation));

/* ------------------------------------------------------------------ */
/* 5. DANS UN VRAI NAVIGATEUR : aucune requête vers une image disparue  */
/* ------------------------------------------------------------------ */

const URL_INTERFACE = process.env.HAIKO_PERSONNAGES_URL;
if (URL_INTERFACE) {
  console.log('\n5. Dans un vrai navigateur : aucune requête vers une image disparue');
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome' });
  const page = await navigateur.newPage();
  const versPersonnages = [];
  const echecs = [];
  page.on('request', (requete) => {
    if (requete.url().includes('/personnages/')) versPersonnages.push(requete.url());
  });
  page.on('requestfailed', (requete) => echecs.push(`${requete.url()} — ${requete.failure()?.errorText ?? '?'}`));
  await page.goto(URL_INTERFACE, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(2500);
  /* Les réglages sont chargés à la demande : on les ouvre pour de vrai. */
  await page.keyboard.press('Control+,').catch(() => undefined);
  await page.waitForTimeout(1500);
  noter('le tableau et les réglages ne demandent aucune image de personnage', versPersonnages.length === 0, versPersonnages.slice(0, 3).join(' | '));
  noter('…et aucune requête n’échoue', echecs.length === 0, echecs.slice(0, 3).join(' | '));
  await navigateur.close();
} else {
  console.log('\n5. (navigateur sauté : pose HAIKO_PERSONNAGES_URL pour l’ajouter)');
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
if (rates.length) {
  console.log('✗ des personnages traînent encore.');
  process.exit(1);
}
console.log('✓ plus aucun personnage, et l’indicateur a pris le relais.');
