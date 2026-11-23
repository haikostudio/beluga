#!/usr/bin/env node
/**
 * CAPTURES ET PLAQUETTE CLIENT, DE BOUT EN BOUT — sur une base NEUVE (dossier temporaire), sans toucher au démon en
 * service ni dépenser de quota. Le chemin réel, dans l'ordre :
 *
 *   1. une page d'essai (en-tête collant, barre fixe du bas) est servie en local ;
 *   2. la recette de captures la photographie en ordinateur ET téléphone, page entière : deux images rangées dans le
 *      projet, notées « capture » ;
 *   3. une plaquette est créée avec ces images (couverture, texte, galerie, appel), aux couleurs d'une marque donnée ;
 *   4. son lien privé est ouvert dans un VRAI navigateur, comme le client : le LECTEUR sombre (carte « Refonte du
 *      service Charte graphique ») pose les feuilles au format et leurs miniatures, les images se chargent, la PREMIÈRE
 *      ouverture est comptée et une notification est posée ;
 *   5. le client commente un endroit précis : le bouton suit le bord droit de la page, le prénom est demandé au premier
 *      commentaire, le fil est rangé non lu, à sa page et sa section, et la cloche sonne ;
 *   6. une visite de l'AUTEUR (session présente) ne se compte pas ;
 *   7. le PDF se fabrique, commence par « %PDF » ;
 *   8. une image du projet NON citée par la plaquette n'est pas servie (404) ; le lien coupé répond 410, le nouveau
 *      lien remplace l'ancien (404) ;
 *   9. LES TROIS FORMATS (carte « Refonte de l'espace Plaquettes ») : l'outil de l'agent crée une plaquette SANS
 *      projet de marque (la marque par défaut du réglage), refuse sans format, fabrique le PDF d'office à la bonne
 *      taille de page (A4 portrait, A4 paysage, diapositives 16:9) avec sa vignette, et le PDF porte le repère qui le
 *      montre en carte d'aperçu dans le fil ; la charte d'une marque est retenue d'une plaquette à l'autre ;
 *  10. le service « Charte graphique » de l'application (démon d'essai sur la même base, ordinateur puis téléphone,
 *      clair puis sombre) : les documents en cartes (colonne de gauche, ou la page sur téléphone), le document ouvert
 *      au centre, le FORMAT EN HAUT À DROITE, « Charte graphique » en bas qui ouvre son volet, aucune liste ni case
 *      de couleur du navigateur ; la bulle du commentaire du client, la réponse de l'équipe que le client voit ; un
 *      titre corrigé SUR PLACE et une section MASQUÉE (absente pour le client) ; la charte ne change QUE ce document.
 *
 *   node scripts/verif-plaquette.mjs        (port : HAIKO_VERIF_PLAQUETTE_PORT, 7291 par défaut)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* LES OPTIONS D'AFFICHAGE SONT UN MENU (18/11/2026) : format, PDF, lien et choix des pages vivent sur ses lignes.
   Menu Radix : focus puis Entrée ; `ligne` (facultatif) est cliquée dans le menu ouvert. */
async function menuDAffichage(app, ligne) {
  await app.locator('[data-plaquette-options-affichage]').first().focus();
  await app.keyboard.press('Enter');
  await app.waitForSelector('[data-plaquette-menu-affichage]', { timeout: 5000 });
  if (ligne) await app.click(`[data-plaquette-menu-affichage] ${ligne}`);
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-plaquette-'));
process.env.BELUGA_DATA = path.join(TMP, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });
delete process.env.BELUGA_TOKEN;
const PORT = Number(process.env.HAIKO_VERIF_PLAQUETTE_PORT || 7291);

const dist = (f) => path.join(RACINE, 'server/dist', f);
const store = await import(dist('store.js'));
const { executerLaRecette } = await import(dist('capture-ecran.js'));
const plaq = await import(dist('plaquettes.js'));
const { outilCapture } = await import(dist('outil-capture.js'));
const { getDb } = await import(dist('db.js'));
const { lireLaRecette } = await import(path.join(RACINE, 'shared/dist/index.js'));
const { bus } = await import(dist('bus.js'));
const alertes = [];
bus.subscribe((e) => {
  if (e.type === 'notify') alertes.push(`${e.title ?? ''} ${e.body ?? ''}`);
});

let echecs = 0;
const ok = (cond, libelle) => {
  console.log(`${cond ? '✓' : '✗'} ${libelle}`);
  if (!cond) echecs++;
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Essai</title>
<style>body{margin:0;font-family:sans-serif}header{position:sticky;top:0;height:60px;background:#f0f}main{padding:20px}section{height:600px;border-bottom:1px solid #ccc}
footer{position:fixed;bottom:0;left:0;right:0;height:40px;background:#0ff}</style></head><body><header>En-tête</header><main>
<section>Un</section><section>Deux</section><section>Trois</section></main><footer>Barre</footer></body></html>`;

let auteurPresent = false;
const serveur = http.createServer(async (req, res) => {
  const route = (req.url || '/').split('?')[0];
  if (route === '/site') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  const servie = await plaq.servirLaPlaquette(req, res, route, {
    auteur: auteurPresent,
    ip: '127.0.0.1',
    lireCorps: (max) =>
      new Promise((ok_, ko) => {
        const morceaux = [];
        let n = 0;
        req.on('data', (c) => {
          n += c.length;
          if (n > max) ko(new Error('trop'));
          else morceaux.push(c);
        });
        req.on('end', () => ok_(Buffer.concat(morceaux)));
      }),
  });
  if (!servie) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;
process.env.BELUGA_PUBLIC_URL = BASE;

let code = 1;
let navigateur;
let demon;
try {
  const projet = store.saveProject({
    id: store.newId(),
    name: 'Projet d’essai',
    path: TMP,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  });

  /* 2. Les captures. */
  const recette = lireLaRecette({ cibles: [{ url: `${BASE}/site`, nom: 'Accueil' }], appareils: ['ordinateur', 'telephone'], themes: ['clair'] });
  ok(recette.ok, 'la recette se lit');
  const captures = await executerLaRecette({ recette: recette.recette, projectId: projet.id });
  ok(captures.pieces.length === 2 && !captures.erreurs.length, `deux captures rangées (${captures.pieces.map((p) => p.name).join(', ')}${captures.erreurs.length ? ' ; erreurs : ' + captures.erreurs.join(' | ') : ''})`);
  const genres = plaq.genresDesCaptures();
  ok(captures.pieces.every((p) => genres.get(p.id) === 'capture'), 'chaque image est notée « capture »');
  const [ordi, tel] = captures.pieces;

  /* Une image du projet que la plaquette ne cite pas. */
  const intruse = path.join(TMP, 'intruse.png');
  const { execFileSync } = await import('node:child_process');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=16x16', '-frames:v', '1', intruse]);
  const { joindreUnFichier } = await import(dist('joindre-fichier.js'));
  const j = await joindreUnFichier({ projectId: projet.id, fichier: intruse, nom: 'intruse.png', deLAgent: true });
  /* UN LOGO SVG (carte « Plaquette client : images, icône et titre ») : il doit se montrer dans un <img>. */
  const cheminSvg = path.join(TMP, 'logo.svg');
  fs.writeFileSync(cheminSvg, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#2b5cff"/><script>window.top.svgPiege=1</script></svg>');
  const logoSvg = await joindreUnFichier({ projectId: projet.id, fichier: cheminSvg, nom: 'logo.svg', deLAgent: true });
  ok(logoSvg.ok && logoSvg.attachment.mime === 'image/svg+xml', `le logo SVG est joint (${logoSvg.ok ? logoSvg.attachment.mime : logoSvg.refus})`);

  /* 3. La plaquette. */
  const creee = plaq.creerPlaquette({
    projectId: projet.id,
    titre: 'Votre nouvel espace en ligne',
    langue: 'fr',
    marque: { nom: 'Atelier Lumière', couleur: '#2b5cff', contact: 'bonjour@atelier.example' },
    /* UNE VRAIE CHARTE (carte « Aperçu, chat, Agentik et vraie charte ») : sommaire, partie charte, présentation, ressources. */
    blocs: [
      { genre: 'couverture', titre: 'Votre nouvel espace en ligne', texte: 'Un site clair, rapide, pensé pour vos clients.', pieces: [ordi.id] },
      { genre: 'sommaire' },
      { genre: 'partie', titre: 'Charte graphique', texte: 'Les règles qui font reconnaître la marque.' },
      { genre: 'couleurs', titre: 'Couleurs', elements: [{ valeur: '#2b5cff', libelle: 'Bleu atelier — couleur principale' }, { valeur: '#16181d', libelle: 'Encre — texte courant' }, { valeur: '#ffffff', libelle: 'Blanc — fond' }] },
      { genre: 'typographies', titre: 'Typographies', elements: [{ valeur: 'Inter', libelle: 'Titres — 700' }] },
      { genre: 'partie', titre: 'Votre site' },
      { genre: 'texte', titre: 'Ce qui change', texte: 'Des pages plus lisibles.\n\nUne prise de rendez-vous en deux gestes.' },
      { genre: 'galerie', titre: 'Sur tous les écrans', legende: 'Une légende longue qui doit rester au-dessus du pied de page, quelle que soit la place des images.', pieces: [ordi.id, tel.id] },
      { genre: 'image', titre: 'Le logo', pieces: [logoSvg.attachment.id] },
      { genre: 'ressources', titre: 'Ressources', pieces: [ordi.id] },
    ],
  });
  ok(creee.ok, `la plaquette est créée${creee.ok ? '' : ' : ' + creee.raison}`);
  const p = creee.plaquette;
  const lien = plaq.cheminDuLien(p.id, 1);

  /* 4. Le client ouvre le lien : le lecteur sombre, ses feuilles et ses miniatures. */
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await navigateur.newPage({ viewport: { width: 1400, height: 900 } });
  const reponse = await page.goto(`${BASE}${lien}`, { waitUntil: 'networkidle' });
  ok(reponse?.status() === 200, 'le lien privé répond 200');
  await page.waitForSelector('.lx-mini', { timeout: 20000 });
  ok((await page.locator('h1').first().textContent())?.includes('Votre nouvel espace'), 'le titre du document s’affiche');
  const feuilles = await page.locator('.lx-pages > .pages > .feuille').count();
  ok(feuilles >= 2 && (await page.locator('.lx-mini').count()) === feuilles, `les pages sont posées en feuilles, chacune avec sa miniature (${feuilles})`);
  ok((await page.locator('.lx-mini.courante').count()) === 1, 'la page en cours est entourée dans les miniatures');
  const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(fond === 'rgb(38, 39, 43)', `le fond du lecteur est anthracite (${fond})`);
  const images = await page.$$eval('.lx-pages img', (els) => els.map((i) => i.naturalWidth));
  ok(images.length >= 3 && images.every((w) => w > 0), `les images se chargent (${images.length})`);
  const svgs = await page.$$eval('.lx-pages img', (els) => els.filter((i) => i.src.includes('/image/')).map((i) => ({ src: i.src, w: i.naturalWidth })));
  const leSvg = svgs.find((x) => x.src.endsWith(`/image/${logoSvg.attachment.id}`));
  ok(leSvg && leSvg.w > 0, `le logo SVG s’affiche dans la page du client (${leSvg ? leSvg.w + ' px' : 'absent'})`);
  const rSvg = await fetch(`${BASE}${lien}/image/${logoSvg.attachment.id}`);
  const cspSvg = rSvg.headers.get('content-security-policy') ?? '';
  ok(rSvg.headers.get('content-type') === 'image/svg+xml' && /sandbox/.test(cspSvg) && /default-src 'none'/.test(cspSvg) && rSvg.headers.get('x-content-type-options') === 'nosniff', `le SVG part en image, sous CSP sandbox (${rSvg.headers.get('content-type')} ; ${cspSvg})`);
  const seul = await navigateur.newPage();
  await seul.goto(`${BASE}${lien}/image/${logoSvg.attachment.id}`);
  ok((await seul.evaluate(() => window.svgPiege ?? 0)) === 0, 'ouvert seul, le SVG n’exécute aucun script');
  await seul.close();
  const titreOnglet = await page.title();
  ok(titreOnglet === 'Votre nouvel espace en ligne' || titreOnglet.endsWith('— Votre nouvel espace en ligne'), `l’onglet porte le titre du document (${titreOnglet})`);
  const rognees = await page.$$eval('.lx-pages .cadre:not(.cadre-zoom) img', (els) => els.filter((i) => getComputedStyle(i).objectFit === 'cover').length);
  ok(rognees === 0, 'aucune capture n’est recadrée');
  /* LE SOMMAIRE EN PAGE 2, chaque ligne avec sa page ; un clic y mène. */
  const sommaire = await page.$$eval('.lx-pages .feuille', (fs) => {
    const i = fs.findIndex((f) => f.querySelector('.liste-sommaire'));
    const lignes = i >= 0 ? Array.from(fs[i].querySelectorAll('.ligne-sommaire')).map((a) => ({ href: a.getAttribute('href'), page: a.querySelector('.p')?.textContent })) : [];
    return { page: i + 1, lignes };
  });
  ok(sommaire.page === 2 && sommaire.lignes.length >= 5 && sommaire.lignes.every((l) => /^#bloc-/.test(l.href) && /^\d+$/.test(l.page ?? '')), `le sommaire est en page 2, chaque ligne mène à sa page (${sommaire.lignes.map((l) => l.page).join(', ')})`);
  const avantClic = await page.evaluate(() => document.querySelector('.lx-defile').scrollTop);
  await page.locator('.ligne-sommaire').last().click();
  await page.waitForTimeout(900);
  ok((await page.evaluate(() => document.querySelector('.lx-defile').scrollTop)) > avantClic + 200, 'un clic sur une ligne du sommaire mène à sa page');
  ok((await page.locator('.lx-pages .ressource[href*="telecharger=1"]').count()) === 1, 'les ressources se montrent à l’écran, avec leur lien de téléchargement');
  ok((await page.locator('.lx-pages .tuile-couleur dd').first().textContent()) === '#2B5CFF' && (await page.locator('.lx-pages .tuile-couleur').count()) === 3, 'les couleurs de la charte portent leurs codes');
  ok(!(await page.evaluate(() => document.body.innerText.includes('Vos remarques'))), 'aucun bloc « Vos remarques »');
  /* LE PIED DE PAGE N'EST JAMAIS CHEVAUCHÉ : le bas de tout contenu reste au-dessus du texte du pied. */
  const chevauchements = await page.$$eval('.lx-pages .feuille.flux', (fs) =>
    fs.flatMap((f, i) => {
      const pied = f.querySelector('.pied span');
      const haut = pied ? pied.getBoundingClientRect().top : Infinity;
      return Array.from(f.querySelectorAll('.zone *')).filter((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().bottom > haut + 0.5).map((n) => `p${i + 1}:${n.tagName.toLowerCase()}.${n.className}`);
    }),
  );
  ok(!chevauchements.length, `rien ne passe sous le pied de page${chevauchements.length ? ' : ' + chevauchements.slice(0, 4).join(' | ') : ''}`);
  await page.waitForTimeout(400);
  ok(plaq.ouverturesDe(p.id).total === 1, 'la première ouverture est comptée');
  const premiere = plaq.lirePlaquette(p.id).premiereOuvertureLe;
  ok(!!premiere, 'la date de première ouverture est notée');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.lx-mini', { timeout: 20000 });
  await page.waitForTimeout(400);
  ok(plaq.ouverturesDe(p.id).total === 2, 'une seconde visite compte une seconde ouverture');
  ok(plaq.lirePlaquette(p.id).premiereOuvertureLe === premiere, '…sans toucher à la première');

  /* 5. Le commentaire, à un endroit précis de la deuxième page. */
  await page.locator('.lx-pages > .pages > .feuille').nth(1).evaluate((f) => f.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  const deuxieme = await page.locator('.lx-pages > .pages > .feuille').nth(1).boundingBox();
  await page.mouse.move(deuxieme.x + deuxieme.width - 60, deuxieme.y + 140);
  await page.mouse.move(deuxieme.x + deuxieme.width - 30, deuxieme.y + 160);
  await page.waitForSelector('.lx-plus.visible', { timeout: 5000 });
  const plus = await page.locator('.lx-plus').boundingBox();
  ok(plus && plus.x > deuxieme.x + deuxieme.width, 'le bouton de commentaire suit le bord droit de la page');
  await page.click('.lx-plus');
  await page.waitForSelector('.lx-fil input.lx-champ');
  await page.fill('.lx-fil input.lx-champ', 'Claire');
  await page.fill('.lx-fil textarea', 'Pouvez-vous ajouter nos horaires ?');
  await page.click('.lx-fil .lx-envoyer');
  await page.waitForSelector('.lx-bulle', { timeout: 10000 });
  const fils = plaq.filsDe(p.id);
  ok(fils.length === 1 && fils[0].messages[0].texte.includes('horaires') && fils[0].messages[0].auteur === 'Claire' && !fils[0].messages[0].lu, 'le commentaire est rangé en fil, avec le prénom, non lu');
  ok(fils[0].page === 2 && !!fils[0].bloc, `le fil est ancré à sa page et à sa section (page ${fils[0].page}, section ${fils[0].bloc})`);
  const prenom = await page.evaluate(() => localStorage.getItem('beluga.plaquette.prenom'));
  ok(prenom === 'Claire', 'le navigateur retient le prénom');
  /* LES BULLES ET LA SUPPRESSION, CÔTÉ CLIENT : son message à droite ; il le supprime, la mention reste. */
  await page.fill('.lx-fil textarea', 'Un message à retirer.');
  await page.click('.lx-fil .lx-envoyer');
  await page.waitForFunction(() => document.querySelectorAll('.lx-fil .lx-message.moi').length === 2, null, { timeout: 8000 }).catch(() => undefined);
  const moi = await page.locator('.lx-fil .lx-message.moi').count();
  const aDroite = await page.$$eval('.lx-fil .lx-message.moi', (ms) => ms.every((m) => getComputedStyle(m).alignSelf === 'flex-end'));
  ok(moi === 2 && aDroite, `les messages du client sont à droite, en bulles (${moi})`);
  /* COMME UNE MESSAGERIE : le rond à initiale à gauche de la bulle, le nom et la date SOUS elle, sur son bord gauche. */
  const gabarit = await page.$$eval('.lx-fil .lx-message', (ms) =>
    ms.map((m) => {
      const rond = m.querySelector('.lx-avatar')?.getBoundingClientRect();
      const bulle = m.querySelector('.lx-message-texte')?.getBoundingClientRect();
      const infos = m.querySelector('.lx-message-auteur')?.getBoundingClientRect();
      const nom = m.querySelector('.lx-message-auteur b')?.textContent ?? '';
      return !!rond && !!bulle && !!infos && rond.right <= bulle.left + 1 && infos.top >= bulle.bottom - 1 && Math.abs(infos.left - bulle.left) <= 6 && nom === 'Claire' && m.querySelector('.lx-avatar').textContent === 'C';
    }),
  );
  ok(gabarit.length === 2 && gabarit.every(Boolean), `chaque message : le rond à initiale à gauche, le nom et la date sous la bulle, alignés sur son bord gauche (${gabarit.join(',')})`);
  await page.locator('.lx-fil .lx-message.moi').last().hover();
  await page.locator('.lx-fil .lx-message.moi').last().locator('.lx-suppr').click();
  await page.locator('.lx-fil .lx-message.moi').last().locator('.lx-suppr.confirmer').click();
  await page.waitForSelector('.lx-fil .lx-message.supprime', { timeout: 8000 }).catch(() => undefined);
  ok((await page.locator('.lx-fil .lx-message.supprime').textContent())?.includes('Message supprimé'), 'un message supprimé garde sa mention « Message supprimé »');
  const filApres = plaq.filsDe(p.id)[0];
  ok(filApres.messages.length === 2 && filApres.messages[1].supprime && filApres.messages[1].texte === '', 'la suppression est douce : le texte est effacé, le message reste');
  const etranger = await fetch(`${BASE}${lien}/fils/${filApres.id}/messages/${filApres.messages[0].id}`, { method: 'DELETE', headers: { 'x-visiteur': 'un-autre-navigateur-123' } });
  ok(etranger.status === 403 && !plaq.filsDe(p.id)[0].messages[0].supprime, 'un autre visiteur ne peut pas supprimer le message du client');
  await page.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-lecteur.png') });
  await page.keyboard.press('Escape');

  /* LE ZOOM CHEZ LE CLIENT : en haut au centre ; la liste, Ctrl + molette, « Ajuster ». */
  const barreZoom = await page.locator('[data-lx-zoom]').boundingBox();
  const zoneClient = await page.locator('.lx-defile').boundingBox();
  ok(!!barreZoom && Math.abs(barreZoom.x + barreZoom.width / 2 - (zoneClient.x + zoneClient.width / 2)) <= 4 && barreZoom.y < zoneClient.y + 30, 'la barre du zoom est en haut au centre du document');
  const zoomDe = () => page.evaluate(() => Number(document.querySelector('.lx-pages > .pages').style.zoom || 1));
  const ajuste = await zoomDe();
  await page.click('[data-lx-zoom-valeur]');
  await page.click('[data-lx-zoom-option="2"]');
  await page.waitForTimeout(200);
  const aDeux = await zoomDe();
  const deborde = await page.evaluate(() => { const d = document.querySelector('.lx-defile'); return d.scrollWidth > d.clientWidth + 10; });
  ok(aDeux === 2 && deborde && (await page.locator('[data-lx-zoom-valeur]').textContent()).includes('200'), `la liste règle le zoom à 200 %, le document défile en largeur (${ajuste} → ${aDeux})`);
  await page.mouse.move(zoneClient.x + zoneClient.width / 2, zoneClient.y + zoneClient.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  ok((await zoomDe()) < 2, `Ctrl + molette dézoome (${await zoomDe()})`);
  await page.click('[data-lx-zoom-plus]');
  ok((await zoomDe()) > 1, 'le bouton « + » agrandit');
  await page.click('[data-lx-zoom-valeur]');
  await page.click('[data-lx-zoom-option="ajuster"]');
  await page.waitForTimeout(200);
  ok(Math.abs((await zoomDe()) - ajuste) < 0.01, '« Ajuster à la largeur » revient au zoom de départ');
  const titresMinis = await page.$$eval('.lx-mini', (bs) => bs.map((b) => b.title));
  ok(titresMinis.length > 1 && titresMinis.every((x) => x.length > 0) && titresMinis.some((x) => !/^Page \d+$/.test(x)), `chaque miniature porte le titre de sa page au survol (${titresMinis.slice(0, 3).join(' | ')})`);

  /* 6. L'auteur ne se compte pas. */
  auteurPresent = true;
  const page2 = await navigateur.newPage();
  await page2.goto(`${BASE}${lien}`, { waitUntil: 'networkidle' });
  await page2.waitForTimeout(400);
  ok(plaq.ouverturesDe(p.id).total === 2, 'la visite de l’auteur ne se compte pas');
  auteurPresent = false;

  /* 7. Le PDF. */
  const pdf = await fetch(`${BASE}${lien}/pdf`);
  const octets = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.status === 200 && octets.subarray(0, 4).toString() === '%PDF', `le PDF se fabrique (${Math.round(octets.length / 1024)} Ko)`);

  /* 8. Les portes. */
  if (j.ok) {
    const r = await fetch(`${BASE}${lien}/image/${j.attachment.id}`);
    ok(r.status === 404, 'une image non citée n’est pas servie');
  } else ok(false, `pièce intruse non jointe : ${j.refus}`);
  plaq.regleLeLien(p.id, 'couper');
  ok((await fetch(`${BASE}${lien}`)).status === 410, 'le lien coupé répond 410');
  plaq.regleLeLien(p.id, 'rouvrir');
  const nouveau = plaq.regleLeLien(p.id, 'nouveau');
  ok((await fetch(`${BASE}${lien}`)).status === 404, 'l’ancien lien ne mène plus nulle part');
  ok((await fetch(`${BASE}${plaq.cheminDuLien(p.id, nouveau.generation)}`)).status === 200, 'le nouveau lien s’ouvre');

  /* Les alertes partent groupées après quatre secondes : une à la première ouverture, une à la remarque. */
  await new Promise((r) => setTimeout(r, 4500));
  const ouvertes = alertes.filter((a) => a.includes('première fois'));
  ok(ouvertes.length === 1, `une seule alerte « document ouvert » (${ouvertes.length})`);
  /* Deux messages du client coup sur coup (le second supprimé ensuite) : la cloche les regroupe en une alerte, au nom du document. */
  const cloche = alertes.some((a) => a.includes('horaires') || /attendent.*Votre nouvel espace en ligne/.test(a));
  ok(cloche, `la cloche sonne pour le commentaire du client${cloche ? '' : ' : ' + alertes.join(' | ')}`);

  /* 9. LES FORMATS, PAR L'OUTIL DE L'AGENT : la marque du projet décrit, la signature de l'auteur, le PDF d'office, sa taille de page, sa vignette. */
  const marqueProjet = store.saveProject({
    id: store.newId(),
    name: 'Studio Marque',
    path: path.join(TMP, 'marque'),
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  });
  store.saveSettings({ marqueDesPlaquettes: marqueProjet.id });
  /* L'ICÔNE DU PROJET SIGNATAIRE (carte « Finitions du lecteur de charte ») : celle de la colonne de gauche. */
  const dossierIcones = path.join(process.env.BELUGA_DATA, 'favicons');
  fs.mkdirSync(dossierIcones, { recursive: true });
  fs.writeFileSync(
    path.join(dossierIcones, `${marqueProjet.id}.png`),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  );
  ok(plaq.projetDeLaSignature()?.id === marqueProjet.id, 'la signature des documents vient du réglage');
  const ctx = { agentId: 'agent-essai', projectId: projet.id, role: 'task' };
  const blocsDiapo = [
    { genre: 'couverture', titre: 'Présentation', texte: 'Le projet en quelques diapositives.', pieces: [ordi.id] },
    { genre: 'texte', titre: 'Le constat', texte: ('Une phrase assez longue pour remplir une diapositive entière de présentation. '.repeat(8) + '\n\n').repeat(3) },
    { genre: 'galerie', titre: 'Les écrans', pieces: [ordi.id, tel.id, ordi.id, tel.id] },
    { genre: 'chiffres', titre: 'En chiffres', elements: [{ valeur: '2 s', libelle: 'par page' }, { valeur: '+30 %', libelle: 'de contacts' }] },
    { genre: 'appel', titre: 'On en parle ?', bouton: 'Écrire', lien: 'mailto:bonjour@atelier.example' },
  ];
  const sansFormat = await outilCapture(ctx, { geste: 'plaquette_creer', titre: 'Sans format', blocs: blocsDiapo, marque: { couleur: '#7a3cff' } });
  ok(!sansFormat.ok && /FORMAT/.test(sansFormat.text), 'sans format, l’outil demande de le demander');
  const sansAdresse = await outilCapture(ctx, { geste: 'plaquette_creer', titre: 'Sans adresse', format: 'a4-portrait', blocs: blocsDiapo, marque: { couleur: '#7a3cff' } });
  ok(!sansAdresse.ok && /TUTOYER/.test(sansAdresse.text), 'sans « tu » ni « vous », l’outil demande de le demander');
  const tailles = {};
  const pdfs = {};
  const idsParFormat = {};
  for (const [format, premiere] of [['diapositives', true], ['a4-paysage', false]]) {
    const r = await outilCapture(ctx, {
      geste: 'plaquette_creer',
      titre: `Essai ${format}`,
      format,
      adresse: premiere ? 'tu' : 'vous',
      blocs: blocsDiapo,
      ...(premiere ? { marque: { couleur: '#7a3cff', texte: '#16181d', fond: '#ffffff', contact: 'bonjour@studio.example' } } : {}),
    });
    ok(r.ok && !!r.attachment, `${format} : la plaquette est créée sans projet de marque, PDF joint d’office${r.ok ? '' : ' : ' + r.text}`);
    if (!r.attachment) continue;
    pdfs[format] = r.attachment;
    const id = /id ([0-9a-f-]{36})/.exec(r.text)?.[1];
    const cree = plaq.lirePlaquette(id);
    ok(cree?.marque.nom === 'Projet d’essai' && cree.marque.couleur === '#7a3cff', `${format} : aux couleurs du projet décrit, pas de l’auteur${premiere ? '' : ' (charte retenue, rien redonné)'}`);
    ok(cree?.marque.signature === 'Studio Marque', `${format} : l’auteur signe en petit (« ${cree?.marque.signature ?? ''} »)`);
    idsParFormat[format] = id;
    ok(cree?.adresse === (premiere ? 'tu' : 'vous'), `${format} : le document garde le ${premiere ? 'tutoiement' : 'vouvoiement'} choisi`);
    ok(r.attachment.plaquette?.id === id && r.attachment.plaquette.format === format && !!r.attachment.plaquette.vignette, `${format} : le PDF porte son repère de plaquette et sa vignette`);
    const { cheminDePieceJointe } = await import(dist('pieces-jointes.js'));
    const octets = fs.readFileSync(cheminDePieceJointe(r.attachment));
    const media = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(octets.toString('latin1'));
    tailles[format] = media ? [Math.round(Number(media[1])), Math.round(Number(media[2]))] : null;
    const pages = (octets.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    if (format === 'diapositives') ok(pages >= 6, `diapositives : une diapositive par bloc, le texte long et la galerie coupés (${pages} pages)`);
  }
  /* LA SIGNATURE, à l'écran du client : en petit sur la couverture et dans le pied de la dernière page, nulle part ailleurs. */
  if (idsParFormat.diapositives) {
    for (const format of ['diapositives', 'a4-paysage']) {
      const pl = plaq.lirePlaquette(idsParFormat[format]);
      await page.goto(`${BASE}${plaq.cheminDuLien(pl.id, pl.generation)}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.lx-mini', { timeout: 20000 });
      const sig = await page.$$eval('.lx-pages > .pages > .feuille', (fs) => ({
        total: fs.length,
        ou: fs.map((f, i) => (f.querySelector('.signature-auteur') ? i : -1)).filter((i) => i >= 0),
        texte: fs[0]?.querySelector('.signature-auteur')?.textContent ?? '',
        icones: fs.filter((f) => (f.querySelector('.signature-auteur img.icone-auteur')?.getAttribute('src') ?? '').startsWith('data:image/png')).length,
        couleurDuStudio: fs.some((f) => /Studio Marque/.test(f.querySelector('.tete-marque, .marque-pied, .bas span:first-child')?.textContent ?? '')),
      }));
      ok(sig.texte === 'Réalisé par Studio Marque' && sig.ou.length === 2 && sig.ou[0] === 0 && sig.ou[1] === sig.total - 1, `${format} : « Réalisé par » en couverture et sur la dernière page seulement (${sig.ou.join(', ')} / ${sig.total})`);
      ok(!sig.couleurDuStudio, `${format} : aucune tête ni pied de page au nom de l’auteur`);
      ok(sig.icones === 2, `${format} : l’icône du projet signataire précède « Réalisé par », sur la couverture et la dernière page (${sig.icones})`);
    }
  }
  /* LE BLOC « LOGO » : jamais celui de l'auteur, et jamais vide de logo. */
  plaq.retenirLaCharte(marqueProjet.id, { nom: 'Studio Marque', couleur: '#7e00fd', texte: '#16181d', fond: '#ffffff', logo: tel.id }, projet.id);
  const avecLogoAuteur = await outilCapture(ctx, { geste: 'plaquette_creer', titre: 'Logo de l’auteur', format: 'a4-portrait', adresse: 'vous', blocs: [{ genre: 'couverture', titre: 'X' }, { genre: 'logo', titre: 'Logo', pieces: [tel.id] }] });
  ok(!avecLogoAuteur.ok && /celui de l’auteur/.test(avecLogoAuteur.text) && /ask_user/.test(avecLogoAuteur.text), 'le logo de l’auteur est refusé dans le bloc « logo », avec la consigne de chercher puis demander celui du client');
  const sansLogo = await outilCapture(ctx, { geste: 'plaquette_creer', titre: 'Sans logo', format: 'a4-portrait', adresse: 'vous', blocs: [{ genre: 'couverture', titre: 'X' }, { genre: 'logo', titre: 'Logo' }] });
  ok(!sansLogo.ok && /aucun logo/.test(sansLogo.text), 'un bloc « logo » sans aucun logo du client est refusé');
  ok(tailles['diapositives']?.join('x') === '960x540', `diapositives : page 16:9 (${tailles['diapositives']?.join('x')} pt)`);
  ok(tailles['a4-paysage']?.join('x') === '842x595', `A4 paysage : page couchée (${tailles['a4-paysage']?.join('x')} pt)`);
  const pdfPortrait = await plaq.fabriquerLePdf(p.id);
  if (pdfPortrait.ok) {
    const { cheminDePieceJointe } = await import(dist('pieces-jointes.js'));
    const m = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(fs.readFileSync(cheminDePieceJointe(pdfPortrait.piece)).toString('latin1'));
    ok(m && Math.round(Number(m[1])) === 595 && Math.round(Number(m[2])) === 842, 'une plaquette d’avant les formats reste en A4 portrait');
  } else ok(false, `PDF A4 portrait : ${pdfPortrait.raison}`);
  const toutes = plaq.listerToutesLesPlaquettes();
  ok(toutes.length === 3 && toutes.every((x) => x.vignette), `la liste rend les trois plaquettes, chacune avec sa vignette (${toutes.length})`);
  const versionAvant = plaq.lirePlaquette(p.id).version;

  /* 10. LA PAGE « PLAQUETTES » DE L'APPLICATION, dans un vrai navigateur, sur un démon d'essai qui lit CETTE base. */
  const PORT_DEMON = PORT + 1;
  const jeton = crypto.randomBytes(32).toString('hex');
  getDb()
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(jeton).digest('hex'), Date.now(), Date.now() + 3600_000, 'vérification plaquette');
  demon = spawn('node', [dist('main.js')], {
    env: {
      ...process.env,
      BELUGA_PORT: String(PORT_DEMON),
      BELUGA_HOST: '127.0.0.1',
      BELUGA_DATA: process.env.BELUGA_DATA,
      BELUGA_PROJECTS_ROOT: path.join(TMP, 'projets'),
      BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
      /* Aucun appel au moteur depuis un démon d'essai (l'amorce de la fenêtre de quota dépenserait des jetons). */
      BELUGA_SANS_AMORCE: '1',
      /* L'agent de la charte, créé à l'ouverture d'un document, n'envoie pas son premier message (aucun moteur). */
      BELUGA_CHARTE_SANS_PREMIER_MESSAGE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const journal = [];
  demon.stdout.on('data', (d) => journal.push(String(d)));
  demon.stderr.on('data', (d) => journal.push(String(d)));
  const BASE_DEMON = `http://127.0.0.1:${PORT_DEMON}`;
  let pret = false;
  for (let i = 0; i < 120 && !pret; i++) {
    pret = await fetch(`${BASE_DEMON}/health`).then((r) => r.ok, () => false);
    if (!pret) await new Promise((r) => setTimeout(r, 500));
  }
  ok(pret, 'le démon d’essai répond');
  const autre = toutes.find((x) => x.id !== p.id);
  const lienDuClient = () => `${BASE}${plaq.cheminDuLien(p.id, plaq.lirePlaquette(p.id).generation)}`;
  const attendre = async (cond, ms = 8000) => {
    for (let i = 0; i < ms / 200; i++) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return cond();
  };
  for (const [largeur, theme] of [[1400, 'light'], [390, 'light'], [1400, 'dark'], [390, 'dark']]) {
    const nom = `${largeur} px ${theme === 'dark' ? 'sombre' : 'clair'}`;
    const telephone = largeur < 600;
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: telephone ? 844 : 900 }, colorScheme: theme, ...(telephone ? { hasTouch: true, isMobile: true } : {}) });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE_DEMON, httpOnly: true, sameSite: 'Lax' }]);
    const app = await contexte.newPage();
    const erreurs = [];
    app.on('pageerror', (e) => erreurs.push(e.message));
    const complet = theme === 'light';
    /* « ÉDITER » : sur ordinateur, l'icône paraît au survol d'une feuille (son coin haut droit) ; sur téléphone, dans la rangée. */
    const editerLeDocument = async () => {
      if (!telephone) {
        const point = await app.locator('[data-plaquette-ombre]').evaluate((h) => {
          const r = h.shadowRoot.querySelector('.pages > .feuille').getBoundingClientRect();
          return { x: r.x + r.width / 2, y: Math.max(r.y + 80, 260) };
        });
        await app.mouse.move(point.x, point.y);
        await app.mouse.move(point.x + 4, point.y + 4);
        await app.locator('[data-plaquette-editer]').waitFor({ state: 'visible', timeout: 5000 });
      }
      await app.click('[data-plaquette-editer]', { timeout: 10000 });
    };

    /* LES DOCUMENTS EN CARTES : dans la colonne de gauche sur ordinateur, dans la page sur téléphone. */
    /* La page des chartes s'ouvre dans le projet affiché : on vise celui des documents d'essai. */
    await app.goto(`${BASE_DEMON}/#projet/${projet.id}/plaquettes`, { waitUntil: "domcontentloaded" });
    let liste = await app.waitForSelector('[data-plaquettes-liste]', { timeout: 15000 }).then(() => true, () => false);
    if (!liste) {
      /* Le premier écran restauré peut passer devant l'adresse : on la redonne une fois. */
      await app.evaluate((id) => (window.location.hash = `#charte/${id}`), projet.id);
      liste = await app.waitForSelector('[data-plaquettes-liste]', { timeout: 15000 }).then(() => true, () => false);
    }
    ok(liste, `${nom} : le service liste les documents`);
    if (!liste) {
      await app.screenshot({ path: path.join(os.tmpdir(), `verif-plaquette-${largeur}-${theme}.png`) });
      console.log(journal.slice(-15).join(''));
      await contexte.close();
      continue;
    }
    ok((await app.getAttribute('[data-plaquettes-liste]', 'data-plaquettes-lignes')) === '3', `${nom} : les trois documents sont en cartes`);
    if (!telephone) {
      ok((await app.locator('[data-colonne-plaquettes] [data-plaquettes-carte]').count()) === 3, `${nom} : les cartes vivent dans la colonne de gauche`);
      const ouvertSeul = await app.waitForSelector('[data-plaquette-editeur]', { timeout: 15000 }).then(() => true, () => false);
      ok(ouvertSeul, `${nom} : le centre n’est jamais vide, le document le plus récent s’ouvre`);
    }
    const menuDuService = await app.evaluate(() => document.body.innerText.includes('Charte graphique'));
    ok(menuDuService, `${nom} : le service s’appelle « Charte graphique »`);
    /* LE RÉGLAGE DE LA SIGNATURE : il ne donne plus la marque, seulement le petit « Réalisé par … ». */
    if (!(await app.locator('[data-plaquettes-marque]:visible').count())) await app.locator('[data-options-de-page="menu"]:visible, [data-options-de-page-chevron]:visible').first().click().catch(() => undefined);
    const optionSignature = await app.locator('[data-plaquettes-marque]:visible').first().click({ timeout: 5000 }).then(() => true, () => false);
    const fenetreSignature = optionSignature && (await app.waitForSelector('[role="dialog"]:has-text("Signature des documents")', { timeout: 5000 }).then(() => true, () => false));
    ok(fenetreSignature, `${nom} : le réglage s’appelle « Signature des documents »`);
    if (fenetreSignature) {
      await app.waitForTimeout(800);
      await app.screenshot({ path: path.join(os.tmpdir(), `verif-plaquette-${largeur}-${theme}-signature.png`) });
      await app.keyboard.press('Escape');
      await app.waitForTimeout(300);
    }

    /* LE DOCUMENT AU CENTRE (un clic sur sa carte). */
    await app.click(`[data-plaquettes-carte="${p.id}"]`);
    const editeur = await app.waitForSelector(`[data-plaquette-editeur="${p.id}"]`, { timeout: 30000 }).then(() => true, () => false);
    ok(editeur, `${nom} : un clic sur la carte ouvre le document au centre`);
    if (!editeur) {
      await app.screenshot({ path: path.join(os.tmpdir(), `verif-plaquette-${largeur}-${theme}.png`) });
      await contexte.close();
      continue;
    }
    /* LA CHARTE S'OUVRE À DROITE DE SON AGENT (17/11/2026) : le document entier, avec ses gestes, est « agrandi ». */
    if (telephone) {
      await app.click('[data-options-de-page="menu"], [aria-label="Plus d’options"]');
      await app.locator('[data-charte-agrandir-ligne]').first().click({ timeout: 5000 }).catch(() => undefined);
    } else await app.click('[data-charte-agrandir="volet"]', { timeout: 10000 }).catch(() => undefined);
    ok(await app.waitForSelector('[data-charte-volet="agrandi"] [data-plaquette-editeur]:not([data-plaquette-compact])', { timeout: 10000 }).then(() => true, () => false), `${nom} : « Agrandir » pose le document entier`);
    await app.waitForTimeout(600);
    await app.waitForSelector('[data-plaquette-document-zone][data-plaquette-pret="1"]', { timeout: 20000 }).catch(() => undefined);
    ok((await app.locator('[data-plaquette-ombre]').evaluate((h) => h.shadowRoot?.querySelectorAll('.pages > .feuille').length ?? 0)) >= 2, `${nom} : le document est posé en feuilles`);
    /* LE VOLET FONCÉ VA BORD À BORD de la page (carte « Retouches de la charte graphique ») : on mesure son contenu, marges
       intérieures retirées. */
    const zone = await app.locator('[data-plaquette-editeur]').evaluate((n) => {
      const r = n.getBoundingClientRect();
      const st = getComputedStyle(n);
      const g = parseFloat(st.paddingLeft) || 0;
      const d = parseFloat(st.paddingRight) || 0;
      return { x: r.x + g, y: r.y, width: r.width - g - d, height: r.height };
    });
    const format = await app.locator('[data-plaquette-format]').boundingBox();
    /* LES FORMATS TOUT À DROITE de la rangée du document ; Télécharger et Commentaires, en icônes, dans le haut de la page. */
    ok(!!format && format.x + format.width >= zone.x + zone.width - 4 && (telephone || format.x > zone.x + zone.width / 2), `${nom} : les formats sont tout à droite du document`);
    /* L'APERÇU EST FONCÉ DANS LES DEUX THÈMES (décision de l'utilisateur) : le fond du volet reste sombre, même en clair. */
    const fondDuVolet = await app.locator('[data-plaquette-editeur]').evaluate((n) => {
      const m = getComputedStyle(n).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    });
    /* LE VOLET FONCÉ COLLE SOUS LA BARRE DU HAUT (carte « Espace vide en haut à retirer ») : aucune bande claire entre le
       bas de l'en-tête de la page et le haut du volet, en lecture comme en édition. */
    const ecartSousLEntete = () =>
      app.locator('[data-plaquette-editeur]').evaluate((n) => {
        const haut = n.getBoundingClientRect().top;
        const entetes = [...document.querySelectorAll('[data-entete-de-zone], [data-entete-de-page]')]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.height > 0 && r.bottom <= haut + 1);
        if (!entetes.length) return null;
        return Math.round((haut - Math.max(...entetes.map((r) => r.bottom))) * 10) / 10;
      });
    const ecartLecture = await ecartSousLEntete();
    ok(ecartLecture !== null && Math.abs(ecartLecture) <= 0.5, `${nom} : le volet foncé colle sous la barre du haut (écart ${ecartLecture} px)`);
    ok(fondDuVolet < 0.25, `${nom} : l’aperçu du document est sur fond foncé (luminance ${fondDuVolet.toFixed(2)})`);
    if (!telephone) {
      const menu = await app.locator('[data-plaquette-options-affichage]').boundingBox();
      const commentaires = await app.locator('[data-plaquette-commentaires-bouton]').boundingBox();
      ok(!!menu && !!commentaires && menu.y + menu.height <= zone.y + 2 && commentaires.y + commentaires.height <= zone.y + 2, `${nom} : le menu des options d’affichage et Commentaires sont dans le haut de la page`);
      ok(Math.abs(menu.height - commentaires.height) <= 0.5, `${nom} : le menu a la hauteur des boutons (${menu.height} / ${commentaires.height} px)`);
      /* LE MENU : les trois formats (icône et nom), Télécharger, Copier le lien, et le choix des pages de chaque sortie. */
      await menuDAffichage(app);
      const lignes = await app.locator('[data-plaquette-menu-affichage] [data-plaquette-choix-format]').evaluateAll((ns) => ns.map((n) => ({ texte: n.textContent.trim(), icone: !!n.querySelector('svg') })));
      ok(lignes.length === 3 && lignes.every((o) => o.texte && o.icone), `${nom} : le menu propose les trois formats, avec icône et nom (${JSON.stringify(lignes)})`);
      ok((await app.locator('[data-plaquette-menu-affichage] [data-plaquette-telecharger], [data-plaquette-menu-affichage] [data-plaquette-copier], [data-plaquette-menu-affichage] [data-plaquette-pages-pdf-bouton], [data-plaquette-menu-affichage] [data-plaquette-pages-client-bouton]').count()) === 4, `${nom} : …puis Télécharger, Copier le lien et le choix des pages`);
      await app.keyboard.press('Escape');
    }
    const boutonCharte = await app.locator('[data-plaquette-charte-bouton]').boundingBox();
    const apercu = await app.locator('[data-plaquette-apercu-zone]').boundingBox();
    ok(!!boutonCharte && boutonCharte.y + boutonCharte.height <= apercu.y + apercu.height && boutonCharte.y > apercu.y + apercu.height - 90, `${nom} : « Charte graphique » est fixé en bas du document`);
    if (!telephone) ok((await app.locator('[data-plaquette-groupe-lien] [data-plaquette-options-affichage]').count()) === 1, `${nom} : le lien du client part du menu de l’en-tête`);
    else {
      await app.click('[data-options-de-page="menu"], [aria-label="Plus d’options"]');
      ok((await app.locator('[data-plaquette-copier-ligne]').count()) === 1, `${nom} : « Copier le lien du client » est dans le menu à trois points`);
      await app.keyboard.press('Escape');
    }
    ok((await app.locator('[data-plaquette-compteur]').count()) === 0, `${nom} : le nombre d’ouvertures n’est plus affiché`);
    ok((await app.locator('select, input[type="color"]').count()) === 0, `${nom} : aucune liste ni case de couleur du navigateur`);
    /* LIRE, ÉDITER, ENREGISTRER : la page s'ouvre en lecture — aucune barre, rien de modifiable. */
    ok((await app.locator('[data-plaquette-lecteur-commun][data-plaquette-mode="lecture"]').count()) === 1, `${nom} : le document s’ouvre en lecture`);
    if (telephone) ok((await app.locator('[data-plaquette-barre-section]').count()) === 0 && (await app.locator('[data-plaquette-editer]').count()) === 1, `${nom} : en lecture, aucune barre ; « Éditer » est une icône dans la rangée (pas de survol)`);
    else {
      ok((await app.locator('[data-plaquette-barre-section]').count()) === 0 && (await app.locator('[data-plaquette-editer]').count()) === 0, `${nom} : en lecture, aucune barre ni bouton « Éditer » hors survol`);
      await app.waitForSelector('[data-plaquette-bulle]', { timeout: 10000 }).catch(() => undefined);
      const point = await app.locator('[data-plaquette-ombre]').evaluate((h) => {
        const r = h.shadowRoot.querySelector('.pages > .feuille').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: Math.max(r.y + 80, 260), droite: r.right, haut: r.top };
      });
      await app.mouse.move(point.x, point.y);
      await app.mouse.move(point.x + 4, point.y + 4);
      const crayon = await app.locator('[data-plaquette-editer]').waitFor({ state: 'visible', timeout: 5000 }).then(() => app.locator('[data-plaquette-editer]').boundingBox(), () => null);
      ok(!!crayon && Math.abs(crayon.x + crayon.width - point.droite) <= 2 && crayon.y + crayon.height <= point.haut + 1 && !(await app.locator('[data-plaquette-editer]').innerText()).trim(), `${nom} : au survol, « Éditer » est une icône au coin haut droit de la page`);
      await app.mouse.move(5, 5);
    }
    if (telephone) {
      await editerLeDocument();
      await app.waitForSelector('[data-plaquette-barre-section]', { timeout: 8000 }).catch(() => undefined);
      ok((await app.locator('[data-plaquette-barre-section]').count()) >= 3, `${nom} : en édition sur écran tactile, chaque page porte sa barre`);
      const ecartEdition = await ecartSousLEntete();
      ok(ecartEdition !== null && Math.abs(ecartEdition) <= 0.5, `${nom} : en édition aussi, le volet foncé colle sous la barre du haut (écart ${ecartEdition} px)`);
      await app.screenshot({ path: path.join(os.tmpdir(), `verif-plaquette-${largeur}-${theme}-edition.png`) });
      await app.click('[data-plaquette-enregistrer]');
      await app.waitForSelector('[data-plaquette-editer]', { timeout: 8000 }).catch(() => undefined);
    }
    const bulle = await app.waitForSelector('[data-plaquette-bulle]', { timeout: 10000 }).then(() => true, () => false);
    ok(bulle, `${nom} : le commentaire du client paraît en bulle sur le document`);
    if (!telephone) ok((await app.locator(`[data-plaquettes-carte="${p.id}"] [data-plaquette-fils-ouverts="1"]`).count()) === 1, `${nom} : la carte du document compte le commentaire ouvert`);
    const deborde = await app.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!deborde, `${nom} : rien ne déborde en largeur`);
    /* LE LECTEUR COMMUN : plein volet sans cadre gris, bande de miniatures (ordinateur), « Télécharger » en haut. */
    const cadreGris = await app.locator('[data-plaquette-apercu-zone]').evaluate((z) => ({ fond: getComputedStyle(z).backgroundColor, rayon: getComputedStyle(z).borderTopLeftRadius }));
    ok((cadreGris.fond === 'rgba(0, 0, 0, 0)' || cadreGris.fond === 'transparent') && cadreGris.rayon === '0px', `${nom} : le document occupe le volet, sans cadre gris arrondi`);
    if (!telephone) {
      const nMinis = await app.locator('[data-plaquette-miniatures] > * , [data-plaquette-miniatures]').first().evaluate(() => {
        const h = document.querySelector('[data-plaquette-miniatures] div[class=""], [data-plaquette-miniatures] div');
        const hotes = Array.from(document.querySelectorAll('[data-plaquette-miniatures] div')).filter((d) => d.shadowRoot);
        return hotes[0]?.shadowRoot?.querySelectorAll('.lx-mini').length ?? 0;
      });
      const nFeuilles = await app.locator('[data-plaquette-ombre]').evaluate((h) => h.shadowRoot?.querySelectorAll('.pages > .feuille').length ?? 0);
      ok(nMinis > 0 && nMinis === nFeuilles, `${nom} : la bande de miniatures montre chaque page (${nMinis}/${nFeuilles})`);
      /* LES MINIATURES ONT LA BULLE D'AIDE MAISON, PAS CELLE DU NAVIGATEUR : elles vivent dans une ombre, que la couche
         des infobulles traverse (carte « Retouches charte et fin de tâche », 06/11/2026). */
      const centreMini = await app.evaluate(() => {
        const hote = Array.from(document.querySelectorAll('[data-plaquette-miniatures] div')).find((d) => d.shadowRoot?.querySelector('.lx-mini'));
        const m = hote?.shadowRoot?.querySelectorAll('.lx-mini')[1] ?? hote?.shadowRoot?.querySelector('.lx-mini');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, titre: m.getAttribute('title') ?? m.getAttribute('data-infobulle-titre') ?? '' };
      });
      if (centreMini) {
        await app.mouse.move(centreMini.x, centreMini.y);
        const texteBulle = await app.waitForSelector('[data-infobulle]', { timeout: 3000 }).then((b) => b.innerText(), () => '');
        ok(!!texteBulle.trim() && texteBulle.trim() === centreMini.titre.trim(), `${nom} : une miniature survolée montre la bulle maison (« ${texteBulle.trim()} »)`);
        await app.screenshot({ path: path.join(os.tmpdir(), `verif-plaquette-${largeur}-${theme}-bulle-miniature.png`) });
        await app.mouse.move(5, 5);
      } else ok(false, `${nom} : aucune miniature à survoler`);
      const minisBox = await app.locator('[data-plaquette-miniatures]').boundingBox();
      const docBox = await app.locator('[data-plaquette-document-zone]').boundingBox();
      ok(!!minisBox && !!docBox && minisBox.x + minisBox.width <= docBox.x + 1, `${nom} : les miniatures sont à gauche du document`);
    }
    if (!telephone) ok((await app.locator('[data-plaquette-groupe-pdf] [data-plaquette-options-affichage]').count()) === 1, `${nom} : « Télécharger » et le choix de ses pages partent du menu du haut de la page`);
    else {
      await app.click('[data-options-de-page="menu"], [aria-label="Plus d’options"]');
      ok((await app.locator('[data-plaquette-telecharger-ligne]').count()) === 1 && (await app.locator('[data-plaquette-commentaires-ligne]').count()) === 1, `${nom} : « Télécharger le PDF » et « Commentaires » sont dans le menu à trois points`);
      await app.keyboard.press('Escape');
    }
    /* La relecture en images se fait aussi en CLAIR : le réglage d'apparence du démon d'essai est sombre, on retire la marque du sombre. */
    if (theme === 'light')
      await app.evaluate(() => {
        const r = document.documentElement;
        r.dataset.theme = 'clair';
        r.classList.remove('dark');
        r.style.colorScheme = 'light';
      });
    /* Les fonds des boutons passent en fondu (`transition-colors`) : la photo attend la fin de la bascule. */
    if (theme === 'light') await app.waitForTimeout(400);
    await app.screenshot({ path: path.join(os.tmpdir(), `verif-plaquette-${largeur}-${theme}-document.png`) });

    if (largeur === 1400 && complet) {
      /* « FICHIERS » S'OUVRE PAR-DESSUS LA PAGE (carte « Retouches de la charte graphique ») : l'icône reste dans la tête
         de la colonne du service, la fenêtre s'ouvre, et la page en dessous ne change ni d'adresse ni de contenu. */
      const adresseAvant = app.url();
      const boutonFichiers = app.locator('[data-ligne-fichiers]:visible').first();
      const fichiersVisible = (await boutonFichiers.count()) === 1;
      if (fichiersVisible) await boutonFichiers.click();
      const fenetre = fichiersVisible && (await app.waitForSelector('[data-fenetre-fichiers]', { timeout: 15000 }).then(() => true, () => false));
      ok(fenetre && app.url() === adresseAvant && (await app.locator('[data-plaquette-editeur]').count()) === 1, 'Fichiers s’ouvre en fenêtre par-dessus la charte, sans changer de page');
      if (fenetre) {
        await app.keyboard.press('Escape');
        await app.waitForSelector('[data-fenetre-fichiers]', { state: 'detached', timeout: 5000 }).catch(() => undefined);
      }
      /* LES COMMENTAIRES DU HAUT : la pastille compte la discussion non lue ; la liste y mène et l'ouvre. */
      ok((await app.getAttribute('[data-plaquette-commentaires-bouton]', 'data-plaquette-commentaires-non-lus')) === '1' && (await app.locator('[data-plaquette-commentaires-pastille]').count()) === 1, 'l’icône Commentaires porte la pastille d’une discussion non lue');
      await app.click('[data-plaquette-commentaires-bouton]');
      await app.waitForSelector('[data-plaquette-commentaires] [data-plaquette-commentaire-ligne]', { timeout: 5000 }).catch(() => undefined);
      ok((await app.locator('[data-plaquette-commentaires] [data-plaquette-commentaire-ligne][data-plaquette-commentaire-non-lu="oui"]').count()) === 1, 'la liste des commentaires montre la discussion, en gras tant qu’elle n’est pas lue');
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-commentaires.png') });
      await app.locator('[data-plaquette-commentaires] [data-plaquette-commentaire-ligne]').first().click();
      const ouvertParLaListe = await app.waitForSelector('[data-plaquette-fil]', { timeout: 5000 }).then(() => true, () => false);
      ok(ouvertParLaListe, 'un clic dans la liste fait défiler jusqu’au commentaire et ouvre sa discussion');
      ok(await attendre(() => plaq.filsDe(p.id)[0].messages.every((m) => m.lu)), 'ouvrir la discussion depuis la liste la marque lue');
      await app.waitForFunction(() => document.querySelector('[data-plaquette-commentaires-bouton]')?.getAttribute('data-plaquette-commentaires-non-lus') === '0', null, { timeout: 8000 }).catch(() => undefined);
      ok((await app.getAttribute('[data-plaquette-commentaires-bouton]', 'data-plaquette-commentaires-non-lus')) === '0', 'la pastille s’éteint une fois la discussion lue');
      await app.click('[data-plaquette-fil] [aria-label="Fermer"]');

      /* LE ZOOM CHEZ L'ÉQUIPE : en haut au centre du document, la liste règle les feuilles. */
      const zoomEquipe = () => app.locator('[data-plaquette-ombre]').evaluate((h) => Number(h.shadowRoot.querySelector('.pages').style.zoom || 1));
      const zoomDepart = await zoomEquipe();
      const barreZ = await app.locator('[data-plaquette-zoom] [data-lx-zoom]').boundingBox();
      const zoneZ = await app.locator('[data-plaquette-document-zone]').boundingBox();
      ok(!!barreZ && Math.abs(barreZ.x + barreZ.width / 2 - (zoneZ.x + zoneZ.width / 2)) <= 4 && barreZ.y < zoneZ.y + 30, 'chez l’équipe, la barre du zoom est en haut au centre du document');
      await app.click('[data-plaquette-zoom] [data-lx-zoom-valeur]');
      await app.click('[data-plaquette-zoom] [data-lx-zoom-option="0.5"]');
      await app.waitForTimeout(250);
      ok((await zoomEquipe()) === 0.5, `la liste règle le zoom des feuilles à 50 % (${zoomDepart} → ${await zoomEquipe()})`);
      await app.click('[data-plaquette-zoom] [data-lx-zoom-valeur]');
      await app.click('[data-plaquette-zoom] [data-lx-zoom-option="ajuster"]');
      await app.waitForTimeout(250);
      ok(Math.abs((await zoomEquipe()) - zoomDepart) < 0.01, '« Ajuster à la largeur » rend la largeur de la zone');

      /* LA RÉPONSE DE L'ÉQUIPE, que le client voit. */
      await app.click('[data-plaquette-bulle]');
      await app.waitForSelector('[data-plaquette-fil]');
      await app.fill('[data-plaquette-fil] textarea', 'Bien noté, nous les ajoutons.');
      await app.click('[data-plaquette-fil] [data-lx-envoyer]');
      ok(await attendre(() => plaq.filsDe(p.id)[0]?.messages.some((m) => m.role === 'equipe')), 'la réponse de l’équipe est rangée dans le fil');
      const vuParLeClient = await fetch(`${lienDuClient()}/fils`).then((r) => r.json());
      ok(vuParLeClient.fils?.[0]?.messages?.some((m) => m.texte.includes('Bien noté')) && !('lu' in vuParLeClient.fils[0].messages[0]), 'le client voit la réponse (sans rien d’interne)');
      ok(plaq.filsDe(p.id)[0].messages.every((m) => m.lu), 'ouvrir et répondre marque le fil comme lu');
      await app.waitForFunction(() => document.querySelectorAll('[data-plaquette-fil] .lx-message.moi').length === 1, null, { timeout: 8000 }).catch(() => undefined);
      const cotes = await app.$$eval('[data-plaquette-fil] .lx-message', (ms) => ms.map((m) => (m.classList.contains('moi') ? 'D' : 'G')).join(''));
      ok(cotes === 'GGD', `chez l’équipe, le client à gauche et l’équipe à droite (${cotes})`);
      const nomEquipe = await app.locator('[data-plaquette-fil] .lx-message.moi .lx-message-auteur b').textContent();
      ok(!!nomEquipe && (await app.locator('[data-plaquette-fil] .lx-message.moi .lx-avatar').count()) === 1, `le message de l’équipe porte aussi son rond et le nom de son auteur (${nomEquipe})`);
      const compteDuMessage = getDb().prepare("SELECT compte FROM plaquette_messages WHERE role = 'equipe' ORDER BY cree_le DESC LIMIT 1").get();
      ok(!!compteDuMessage?.compte, 'un message neuf de l’équipe retient le compte qui l’a écrit');
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-fil.png') });
      /* L'ÉQUIPE SUPPRIME SON PROPRE MESSAGE. */
      await app.locator('[data-plaquette-fil] .lx-message.moi .lx-suppr').click();
      await app.locator('[data-plaquette-fil] .lx-message.moi .lx-suppr.confirmer').click();
      ok(await attendre(() => plaq.filsDe(p.id)[0].messages.some((m) => m.role === 'equipe' && m.supprime)), 'l’équipe supprime son propre message');
      await app.waitForSelector('[data-plaquette-fil] .lx-message.moi.supprime', { timeout: 8000 }).catch(() => undefined);
      ok((await app.locator('[data-plaquette-fil] .lx-message.moi .lx-suppr').count()) === 0 && (await app.locator('[data-plaquette-fil] .lx-message:not(.moi) .lx-suppr').count()) === 0, 'personne ne supprime le message de l’autre');
      await app.click('[data-plaquette-fil] [aria-label="Fermer"]');

      /* LA MARGE : côté équipe, la feuille occupe la largeur de la zone de lecture. */
      const largeurs = await app.evaluate(() => {
        const zoneDoc = document.querySelector('[data-plaquette-document-zone]')?.getBoundingClientRect();
        const f = document.querySelector('[data-plaquette-ombre]')?.shadowRoot?.querySelector('.pages > .feuille')?.getBoundingClientRect();
        return { zone: zoneDoc?.width ?? 0, feuille: f?.width ?? 0 };
      });
      ok(largeurs.feuille >= largeurs.zone - 60, `la feuille prend la largeur de la zone, sans grande marge (${Math.round(largeurs.feuille)} / ${Math.round(largeurs.zone)} px)`);

      /* LE RENDU NE SE RECHARGE PLUS : la zone ne repasse jamais par la silhouette après le premier affichage. */
      await app.evaluate(() => {
        window.__silhouette = 0;
        const z = document.querySelector('[data-plaquette-document-zone]');
        new MutationObserver(() => {
          if (z.getAttribute('data-plaquette-pret') !== '1') window.__silhouette += 1;
        }).observe(z, { attributes: true, attributeFilter: ['data-plaquette-pret'] });
      });

      /* LA PAGE DU CLIENT, OUVERTE À CÔTÉ : elle suivra la version enregistrée sans se recharger. */
      const contexteClient = await navigateur.newContext({ viewport: { width: 1200, height: 900 } });
      const pageClient = await contexteClient.newPage();
      await pageClient.goto(lienDuClient(), { waitUntil: 'networkidle' });
      await pageClient.waitForSelector('.lx-mini', { timeout: 20000 });
      await pageClient.evaluate(() => (window.__memePage = 1));

      /* ÉDITER : le titre se corrige sur place ; la retouche va dans le BROUILLON, le client ne la voit pas. */
      const versionAvant = plaq.lirePlaquette(p.id).version;
      await editerLeDocument();
      await app.waitForSelector('[data-plaquette-lecteur-commun][data-plaquette-mode="edition"]');
      ok((await app.locator('[data-plaquette-enregistrer][data-bouton-violet]').count()) === 1, 'en édition, le bouton violet « Enregistrer » remplace « Éditer »');
      const ecartEdition = await ecartSousLEntete();
      ok(ecartEdition !== null && Math.abs(ecartEdition) <= 0.5, `${nom} : en édition aussi, le volet foncé colle sous la barre du haut (écart ${ecartEdition} px)`);
      const titre = app.locator('[data-plaquette-ombre] h2[data-champ="titre"]', { hasText: 'Ce qui change' }).first();
      await titre.click();
      await app.keyboard.press('Control+A');
      await app.keyboard.type('Ce qui change pour vous');
      await app.keyboard.press('Enter');
      ok(await attendre(() => plaq.brouillonDe(p.id)?.blocs.some((b) => b.titre === 'Ce qui change pour vous')), 'un titre corrigé dans la page va dans le brouillon');
      ok(plaq.lirePlaquette(p.id).version === versionAvant && !plaq.lirePlaquette(p.id).blocs.some((b) => b.titre === 'Ce qui change pour vous'), 'la version publiée ne bouge pas avant « Enregistrer »');
      ok(!(await fetch(lienDuClient()).then((r) => r.text())).includes('Ce qui change pour vous'), 'le lien du client ne montre pas le brouillon');

      /* LA BARRE DE CHAQUE PAGE : au-dessus de la feuille, dans l'espace entre deux pages, calée sur son bord droit. */
      const nPages = await app.locator('[data-plaquette-ombre]').evaluate((h) => h.shadowRoot.querySelectorAll('.pages > .feuille').length);
      let barresBienPosees = 0;
      for (let i = 0; i < nPages; i++) {
        const boite = await app.locator('[data-plaquette-ombre]').evaluate((h, i) => {
          const f = h.shadowRoot.querySelectorAll('.pages > .feuille')[i];
          f.scrollIntoView({ block: 'center' });
          const r = f.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }, i);
        /* À droite du milieu : la barre du zoom occupe le haut au centre du document. */
        await app.mouse.move(boite.x + boite.w * 0.75, boite.y + Math.min(200, boite.h / 2));
        const barre = await app.waitForSelector(`[data-plaquette-barre-page="${i + 1}"]`, { timeout: 3000 }).then((b) => b.boundingBox(), () => null);
        if (barre && barre.y + barre.height <= boite.y + 1 && barre.y >= boite.y - 48 && Math.abs(barre.x + barre.width - (boite.x + boite.w)) <= 3) barresBienPosees++;
      }
      ok(barresBienPosees === nPages, `chaque page a sa barre au-dessus d’elle, à droite, dans l’espace entre les pages (${barresBienPosees}/${nPages})`);
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-barre-de-page.png') });

      /* LA BARRE D'UN ÉLÉMENT : une image (cadre, remplacer, retirer), une couleur (teinte, retirer). */
      const survolerElement = async (selecteur) => {
        const b = await app.locator('[data-plaquette-ombre]').evaluate((h, sel) => {
          const n = h.shadowRoot.querySelector(sel);
          if (!n) return null;
          n.scrollIntoView({ block: 'center' });
          const r = n.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }, selecteur);
        if (b) await app.mouse.move(b.x, b.y);
        return !!b;
      };
      const avecImage = await survolerElement('[data-element="image"]');
      const barreImage = avecImage && (await app.waitForSelector('[data-plaquette-barre-element="image"]', { timeout: 3000 }).then(() => true, () => false));
      ok(
        barreImage && (await app.locator('[data-plaquette-barre-element="image"] [data-plaquette-remplacer]').count()) === 1 && (await app.locator('[data-plaquette-barre-element="image"] [data-plaquette-retirer-element]').count()) === 1,
        'une image a sa barre : cadre, remplacer, retirer',
      );
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-barre-image.png') });
      const idCouleursDuDoc = plaq.lirePlaquette(p.id).blocs.find((b) => b.genre === 'couleurs')?.id;
      const nCouleurs = plaq.lirePlaquette(p.id).blocs.find((b) => b.genre === 'couleurs')?.elements?.length ?? 0;
      const avecCouleur = await survolerElement('[data-element="couleur"]');
      const barreCouleur = avecCouleur && (await app.waitForSelector('[data-plaquette-barre-element="couleur"] [data-plaquette-teinte]', { timeout: 3000 }).then(() => true, () => false));
      ok(barreCouleur, 'une couleur a sa barre : changer la teinte, retirer');
      if (barreCouleur) {
        await app.click('[data-plaquette-barre-element="couleur"] [data-plaquette-retirer-element]');
        ok(await attendre(() => (plaq.brouillonDe(p.id)?.blocs.find((b) => b.id === idCouleursDuDoc)?.elements?.length ?? nCouleurs) === nCouleurs - 1), 'retirer une couleur la retire du brouillon');
      }

      /* « ENREGISTRER » : une nouvelle version, que la page ouverte du client montre sans se recharger. */
      await app.click('[data-plaquette-enregistrer]');
      ok(await attendre(() => plaq.lirePlaquette(p.id).version === versionAvant + 1 && plaq.lirePlaquette(p.id).blocs.some((b) => b.titre === 'Ce qui change pour vous')), '« Enregistrer » publie le brouillon en nouvelle version');
      ok(plaq.brouillonDe(p.id) === null && plaq.versionsDe(p.id).some((v) => v.version === versionAvant + 1), 'le brouillon s’efface et la version est gardée');
      await app.waitForSelector('[data-plaquette-lecteur-commun][data-plaquette-mode="lecture"]', { timeout: 8000 }).catch(() => undefined);
      ok((await app.locator('[data-plaquette-lecteur-commun][data-plaquette-mode="lecture"]').count()) === 1, 'après « Enregistrer », le document repasse en lecture');
      const enDirect = await pageClient.waitForFunction(() => document.querySelector('.lx-pages > .pages')?.textContent?.includes('Ce qui change pour vous'), null, { timeout: 25000 }).then(() => true, () => false);
      ok(enDirect && (await pageClient.evaluate(() => window.__memePage === 1)), 'la page ouverte du client change d’elle-même, sans se recharger');
      await contexteClient.close();

      /* MASQUER UNE PAGE, depuis sa barre ; puis ABANDONNER une retouche. */
      const idTexte = plaq.lirePlaquette(p.id).blocs.find((b) => b.genre === 'texte').id;
      await editerLeDocument();
      const feuilleTexte = await app.locator('[data-plaquette-ombre]').evaluate((h, id) => {
        const fs = Array.from(h.shadowRoot.querySelectorAll('.pages > .feuille'));
        const i = fs.findIndex((f) => f.querySelector(`[data-bloc="${id}"]`));
        fs[i].scrollIntoView({ block: 'start' });
        const r = fs[i].getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + 80 };
      }, idTexte);
      await app.mouse.move(feuilleTexte.x, feuilleTexte.y);
      const barreTexte = await app.waitForSelector(`[data-plaquette-barre-section="${idTexte}"] [data-plaquette-masquer]`, { timeout: 5000 }).then(() => true, () => false);
      if (!barreTexte) {
        console.log('barres présentes :', await app.$$eval('[data-plaquette-barre-page]', (bs) => bs.map((b) => `${b.getAttribute('data-plaquette-barre-page')}:${b.getAttribute('data-plaquette-barre-section')}`).join(' ')), 'visée :', idTexte, JSON.stringify(feuilleTexte));
        await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-masquer-echec.png') });
      }
      await app.click(`[data-plaquette-barre-section="${idTexte}"] [data-plaquette-masquer]`, { timeout: 5000 });
      ok(await attendre(() => plaq.brouillonDe(p.id)?.blocs.find((b) => b.id === idTexte)?.masque === true), 'masquer une page va dans le brouillon');
      await app.click('[data-plaquette-enregistrer]');
      ok(await attendre(() => plaq.lirePlaquette(p.id).blocs.find((b) => b.id === idTexte)?.masque === true), 'masquer une page est enregistré');
      const client = await fetch(lienDuClient()).then((r) => r.text());
      ok(!client.includes('Ce qui change pour vous') && !client.includes('prise de rendez-vous'), 'la section masquée n’apparaît plus chez le client');
      await app.waitForFunction((id) => document.querySelector('[data-plaquette-ombre]')?.shadowRoot?.querySelector(`[data-bloc="${id}"].masque`), idTexte, { timeout: 8000 }).catch(() => undefined);
      ok((await app.locator(`[data-plaquette-ombre] [data-bloc="${idTexte}"].masque`).count()) >= 1, 'elle reste, grisée, dans l’éditeur');
      const pdfMasque = await plaq.fabriquerLePdf(p.id);
      if (pdfMasque.ok) {
        const { cheminDePieceJointe } = await import(dist('pieces-jointes.js'));
        const brut = fs.readFileSync(cheminDePieceJointe(pdfMasque.piece)).toString('latin1');
        ok(pdfMasque.piece && !/Ce qui change pour vous/.test(brut), 'le PDF ne porte pas la section masquée');
      } else ok(false, `PDF après masquage : ${pdfMasque.raison}`);

      /* LA CHARTE, DANS SON VOLET PAR-DESSUS LE DOCUMENT : elle ne change que ce document, et se ferme au clic dehors. */
      await app.click('[data-plaquette-charte-bouton]');
      await app.waitForSelector('aside[data-plaquette-charte]');
      const volet = await app.locator('aside[data-plaquette-charte]').boundingBox();
      ok(!!volet && volet.x >= apercu.x && volet.x + volet.width <= apercu.x + apercu.width + 1, 'la charte s’ouvre dans un volet posé sur le document');
      await app.fill('[data-plaquette-marque-nom]', 'Atelier Lumière Studio');
      ok(await attendre(() => plaq.brouillonDe(p.id)?.marque.nom === 'Atelier Lumière Studio'), 'une retouche de la charte, même en lecture, ouvre l’édition et va dans le brouillon');
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-charte.png') });
      await app.mouse.click(apercu.x + 60, apercu.y + 200);
      ok(await app.waitForSelector('aside[data-plaquette-charte]', { state: 'detached', timeout: 3000 }).then(() => true, () => false), 'le volet de la charte se ferme au clic dehors');
      await app.click('[data-plaquette-enregistrer]');
      ok(await attendre(() => plaq.lirePlaquette(p.id).marque.nom === 'Atelier Lumière Studio'), 'la charte retouchée est enregistrée sur ce document');
      ok(plaq.lirePlaquette(autre.id).marque.nom === 'Projet d’essai', 'les autres documents gardent leur charte');

      /* LE CHOIX DES PAGES : un menu ACCROCHÉ sous le chevron, aligné à droite sur son groupe, aussi haut que sa liste. */
      const idGalerie = plaq.lirePlaquette(p.id).blocs.find((b) => b.genre === 'galerie').id;
      await menuDAffichage(app, '[data-plaquette-pages-client-bouton]');
      await app.waitForSelector('[data-plaquette-volet-pages="client"]');
      const groupeLien = await app.locator('[data-plaquette-groupe-lien]').boundingBox();
      const menuClient = await app.locator('[data-plaquette-volet-pages="client"]').boundingBox();
      ok(
        !!groupeLien && !!menuClient && menuClient.y >= groupeLien.y + groupeLien.height && menuClient.y <= groupeLien.y + groupeLien.height + 12 && Math.abs(menuClient.x + menuClient.width - (groupeLien.x + groupeLien.width)) <= 3,
        'le menu « Pages montrées au client » s’ouvre sous son bouton, aligné sur son bord droit',
      );
      await app.click(`[data-plaquette-volet-pages="client"] [data-plaquette-page-case="${idGalerie}"]`);
      ok(await attendre(() => plaq.brouillonDe(p.id)?.blocs.find((b) => b.id === idGalerie)?.horsClient === true), 'une section décochée pour le client va dans le brouillon');
      ok((await app.locator('[data-plaquette-volet-pages="client"]').count()) === 1, 'cocher une case ne referme pas le menu');
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-pages-client.png') });
      await app.mouse.click(apercu.x + 60, apercu.y + 200);
      ok(await app.waitForSelector('[data-plaquette-volet-pages="client"]', { state: 'detached', timeout: 3000 }).then(() => true, () => false), 'le menu des pages se ferme au clic dehors');
      await menuDAffichage(app, '[data-plaquette-pages-pdf-bouton]');
      await app.waitForSelector('[data-plaquette-volet-pages="pdf"]');
      const groupePdfBoite = await app.locator('[data-plaquette-groupe-pdf]').boundingBox();
      const menuPdf = await app.locator('[data-plaquette-volet-pages="pdf"]').boundingBox();
      const hauteurContenu = await app.locator('[data-plaquette-volet-pages="pdf"] [data-plaquette-choix-pages]').evaluate((n) => n.scrollHeight);
      ok(
        !!groupePdfBoite && !!menuPdf && menuPdf.y >= groupePdfBoite.y + groupePdfBoite.height && Math.abs(menuPdf.x + menuPdf.width - (groupePdfBoite.x + groupePdfBoite.width)) <= 3 && menuPdf.height <= hauteurContenu + 120,
        `le menu « Pages du PDF » s’ouvre sous « Télécharger », à droite, aussi haut que sa liste (${Math.round(menuPdf?.height ?? 0)} px)`,
      );
      const idCouleurs = plaq.lirePlaquette(p.id).blocs.find((b) => b.genre === 'couleurs').id;
      await app.click(`[data-plaquette-volet-pages="pdf"] [data-plaquette-page-case="${idCouleurs}"]`);
      ok(await attendre(() => plaq.brouillonDe(p.id)?.blocs.find((b) => b.id === idCouleurs)?.horsPdf === true), 'une section décochée pour le PDF va dans le brouillon');
      await app.screenshot({ path: path.join(os.tmpdir(), 'verif-plaquette-1400-pages-pdf.png') });
      await app.keyboard.press('Escape');
      await app.click('[data-plaquette-enregistrer]');
      ok(await attendre(() => plaq.lirePlaquette(p.id).blocs.find((b) => b.id === idCouleurs)?.horsPdf === true && plaq.lirePlaquette(p.id).blocs.find((b) => b.id === idGalerie)?.horsClient === true), 'les choix des pages sont enregistrés');
      const pageDuClient = await fetch(lienDuClient()).then((r) => r.text());
      ok(!pageDuClient.includes('Sur tous les écrans'), 'la section décochée n’apparaît plus sur la page du client');
      const pdfChoisi = await plaq.fabriquerLePdf(p.id);
      if (pdfChoisi.ok) {
        const { cheminDePieceJointe } = await import(dist('pieces-jointes.js'));
        const { execFileSync: ex } = await import('node:child_process');
        const texte = ex('pdftotext', [cheminDePieceJointe(pdfChoisi.piece), '-']).toString();
        ok(!texte.includes('HEX') && texte.includes('Sur tous les écrans'), 'le PDF retire la section décochée pour lui, et garde celle retirée du client seulement');
      } else ok(false, `PDF après choix des pages : ${pdfChoisi.raison}`);
      ok((await app.evaluate(() => window.__silhouette)) === 0, 'aucune retouche ne recharge le document (pas de silhouette)');

      /* ABANDONNER : la retouche disparaît, le document revient à la version du client. */
      await menuDAffichage(app, '[data-plaquette-choix-format="a4-paysage"]');
      ok(await attendre(() => plaq.brouillonDe(p.id)?.format === 'a4-paysage'), 'le format choisi va dans le brouillon');
      await app.click('[data-plaquette-abandonner]');
      await app.getByRole('dialog', { name: 'Annuler les retouches ?' }).getByRole('button', { name: 'Annuler les retouches', exact: true }).click();
      ok(await attendre(() => plaq.brouillonDe(p.id) === null && plaq.lirePlaquette(p.id).format !== 'a4-paysage'), '« Annuler » efface le brouillon');

      /* LE FORMAT, EN HAUT À DROITE, ENREGISTRÉ. */
      const versionAvantFormat = plaq.lirePlaquette(p.id).version;
      await menuDAffichage(app, '[data-plaquette-choix-format="a4-paysage"]');
      await app.click('[data-plaquette-enregistrer]');
      ok(await attendre(() => plaq.lirePlaquette(p.id).format === 'a4-paysage'), 'le format choisi est enregistré');
      const relue = plaq.lirePlaquette(p.id);
      ok(relue.version > versionAvantFormat && relue.pdfVersion !== relue.version, 'une nouvelle version : le PDF d’avant ne sera pas resservi');
    }
    ok(!erreurs.length, `${nom} : aucune erreur dans la page${erreurs.length ? ' : ' + erreurs.join(' | ') : ''}`);
    await contexte.close();
  }

  /* L'APERÇU DANS LE FIL : la pièce PDF d'une plaquette se rend en carte, une autre pièce PDF non. */
  ok(!!pdfs['diapositives']?.plaquette && !store.getAttachment(j.ok ? j.attachment.id : '')?.plaquette, 'seul le PDF d’une plaquette porte le repère de la carte d’aperçu');

  code = echecs ? 1 : 0;
  console.log(echecs ? `\n${echecs} contrôle(s) en échec.` : '\nTous les contrôles passent.');
} catch (err) {
  console.error(err);
} finally {
  await navigateur?.close();
  serveur.close();
  demon?.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(code);
}
