#!/usr/bin/env node
/**
 * LES SERVICES S'OUVRENT PAREIL PAR LES TROIS CHEMINS (carte « Services et fils d'Ariane fiables », 20/11/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-services-et-fils.mjs
 *
 * Démon jetable, base neuve, aucun quota dépensé. Le projet ACTIF est Alpha, alors que la marque, sa campagne et la
 * charte appartiennent à Beta : c'est le piège qui faisait dire « rien ici » à Communication et à la Charte quand la
 * page se limitait en silence au dernier projet touché. On juge, pour chacun des treize services du menu :
 *   (a) son adresse ouverte sur une page vierge — aucun plantage, aucune erreur React, une adresse sans chiffre ;
 *   (b) le menu « Services » depuis la page d'un projet — « Tous les projets », les données de Beta présentes ;
 *   (c) le fil d'Ariane depuis la page d'un objet — le cran du service est un vrai lien vers sa liste.
 * Puis : la portée choisie s'écrit dans l'adresse et survit au rechargement ; les anciennes adresses
 * (« marketing2 », « communication2 », « plaquettes », « calendrier ») mènent aux nouvelles ; sur téléphone, la feuille
 * « Tâches » allume en bleu la tâche ouverte ; la légende d'un aperçu ne porte plus « A · #xxxx ».
 *
 * LE FIL « SERVICE / PROJET / FICHE » (carte « Fil d'Ariane et Communication repensés », 20/11/2026) : le service
 * d'abord, le projet ensuite (absent sur « Tous les projets »), noms seuls ; Communication s'ouvre sur ses projets, un
 * projet sur ses campagnes, une campagne sur sa conversation et son suivi à quatre volets (dont le Calendrier) ; aucun
 * morceau de fil n'est rendu dans la page ; le Calendrier n'est plus au menu « Services ».
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = path.join(RACINE, 'data/verification');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-services-et-fils-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();
const H = 3600_000;

function projet(db, id, name, rank) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, deploiement: { herite: true }, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}
function carte(db, id, projectId, title) {
  const c = { id, projectId, title, description: '', labels: [], column: 'planned', position: MAINTENANT, origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' }, excludedFromDeploy: false, horsTache: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
  db.prepare('INSERT INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, 'planned', MAINTENANT, title, JSON.stringify(c), null, MAINTENANT, MAINTENANT);
}
function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + H, 'vérification services et fils');
  db.prepare('DELETE FROM projects').run();
  projet(db, 'p-alpha', 'Alpha', 1);
  projet(db, 'p-beta', 'Beta', 2);
  carte(db, 'c-alpha-1', 'p-alpha', 'Refaire la page d’accueil');
  carte(db, 'c-alpha-2', 'p-alpha', 'Corriger le formulaire');
  /* LE PIÈGE : le dernier projet touché est Alpha. */
  db.prepare('INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('project.active', JSON.stringify('p-alpha'), MAINTENANT);
  db.close();
}

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomUUID();
    const fin = setTimeout(() => (w.close(), reject(new Error('sans réponse'))), 30000);
    w.on('open', () => w.send(JSON.stringify({ id, cmd })));
    w.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) {
        clearTimeout(fin);
        w.close();
        ev.ok === false ? reject(new Error(ev.error)) : resolve(ev.data);
      }
    });
    w.on('error', reject);
  });
}

const PLANTE = "L'affichage s'est interrompu";
/* Le mot de l'adresse (avant « / » ou « ? ») ne porte aucun chiffre. */
const motSansChiffre = (hash) => !/\d/.test(hash.replace(/^#/, '').split(/[/?]/)[0] ?? '');

const SERVICES = [
  ['charte', 'plaquettes'],
  ['communication', 'communication2'],
  ['studio', 'studio'],
  ['marketing', 'marketing2'],
  ['statistiques', 'statistiques'],
  ['espace', 'espace-client'],
  ['backups', 'backups'],
  ['surveillance', 'surveillance'],
  ['securite', 'securite'],
  ['taches-recurrentes', 'taches-recurrentes'],
  ['coffre', 'coffre'],
  ['memoire', 'memoire'],
];

let browser;
try {
  if (!(await attendrePort())) throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  poserLeDecor();
  const { marque } = await commande({ type: 'communication.marque.creer', nom: 'Beta', origine: 'projets', projets: ['p-beta'] });
  await commande({ type: 'communication.campagne.ecrire', campagne: { marqueId: marque.id, titre: 'Lancement de Beta', statut: 'en_cours' } });
  const campagnes = await commande({ type: 'communication.campagnes', marqueId: marque.id });
  const campagne = (campagnes?.campagnes ?? campagnes ?? []).find?.((c) => c.titre === 'Lancement de Beta');
  const { plaquetteId } = await commande({ type: 'plaquettes.creerVide', projectId: 'p-beta' });

  browser = await chromium.launch({ channel: 'chrome' });
  const contexte = async (largeur = 1440) => {
    const ctx = await browser.newContext({ viewport: { width: largeur, height: 900 } });
    await ctx.addCookies([{ name: 'beluga_session', value: jeton, domain: '127.0.0.1', path: '/' }]);
    return ctx;
  };
  const suivre = (page) => {
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && /Minified React error|Maximum update depth/.test(m.text())) erreurs.push(m.text().slice(0, 160));
    });
    return erreurs;
  };
  const texte = (page) => page.evaluate(() => document.body.innerText);
  const hash = (page) => page.evaluate(() => location.hash);

  /* (a) Chaque service, ouvert par son adresse sur une page vierge. */
  for (const [mot] of SERVICES) {
    const ctx = await contexte();
    const page = await ctx.newPage();
    const erreurs = suivre(page);
    await page.goto(`${BASE}/#${mot}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const h = await hash(page);
    const t = await texte(page);
    noter(`(a) #${mot} : aucun plantage`, !t.includes(PLANTE) && !erreurs.length, erreurs[0] ?? '');
    noter(`(a) #${mot} : adresse sans chiffre`, motSansChiffre(h), h);
    await page.screenshot({ path: path.join(CAPTURES, `services-et-fils-${mot}.png`) });
    await ctx.close();
  }

  /* Communication et la Charte, par leur adresse : tous les projets, les données de Beta. */
  {
    const ctx = await contexte();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#communication`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    noter('Communication : l’accueil liste les projets, Beta compris, sans « pas encore de marque »', (await page.locator(`[data-v2-accueil-projet="${marque.id}"]`).count()) === 1 && !(await texte(page)).includes('n’a pas encore de marque'));
    const filDeLAccueil = page.locator('[data-fenetre-de-service="creation-communication2"] [data-fil-de-la-page-de-service]').first();
    noter('Communication : sur « Tous les projets », le fil ne dit que le service', ((await filDeLAccueil.innerText().catch(() => '')) || '').trim().startsWith('Communication') && (await page.locator('[data-fenetre-de-service="creation-communication2"] [data-cran-a-menu="portee-du-service"]').count()) === 0);
    noter('Communication : le fil ne porte aucune icône', (await filDeLAccueil.locator('svg:not([aria-hidden])').count()) === 0 && (await filDeLAccueil.locator('img').count()) === 0);
    await page.goto(`${BASE}/#charte`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    noter('Charte : le document de Beta est là', (await page.locator(`[data-plaquettes-ligne="${plaquetteId}"]`).count()) === 1);

    /* (b) Le menu « Services », depuis la page d'Alpha. */
    for (const [mot, cle] of [['communication', 'communication2'], ['charte', 'plaquettes'], ['backups', 'backups']]) {
      await page.goto(`${BASE}/#projet/p-alpha`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      /* « Tous les services », dans le menu à trois points de la colonne (26/11/2026). */
      await page.locator('[data-menu-dossier]').first().click();
      await page.locator('[data-tous-les-services]').first().click();
      await page.waitForTimeout(500);
      if (cle === 'communication2') noter('(b) menu des services : plus de Calendrier', (await page.locator('[data-service-du-menu-colonne="calendrier"]').count()) === 0);
      await page.locator(`[data-service-du-menu-colonne="${cle}"]`).first().click({ force: true });
      await page.waitForTimeout(3000);
      const h = await hash(page);
      noter(`(b) menu → ${mot} : « #${mot} », tous les projets`, h === `#${mot}`, h);
    }

    /* Un projet de l'accueil ouvre SES campagnes ; la portée s'écrit dans l'adresse, et revient au rechargement. */
    await page.goto(`${BASE}/#communication`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.locator(`[data-v2-accueil-projet="${marque.id}"]`).first().click();
    await page.waitForTimeout(2500);
    noter('Projet : « ?projet=p-beta » dans l’adresse', (await hash(page)) === `#communication/${marque.id}?projet=p-beta`, await hash(page));
    noter('Projet : ses campagnes s’affichent', (await page.locator(`[data-communication-ligne="${campagne?.id}"]`).count()) === 1);
    const ordre = await page.evaluate(() => [...document.querySelectorAll('[data-fenetre-de-service="creation-communication2"] [data-nom-du-cran]')].map((e) => e.getAttribute('data-nom-du-cran') + ':' + e.textContent));
    noter('Projet : le fil dit « Communication / Beta », dans cet ordre', ordre.join('|') === 'service-de-la-page:Communication|portee-du-service:Beta', ordre.join('|'));
    noter('Projet : plus d’onglets Campagnes / Connexion / Réponses dans la page', (await page.locator(['v2-etapes-en-rangee', 'v2-choix-marque'].map((n) => `[data-${n}]`).join(', ')).count()) === 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    noter('Portée : le rechargement la redonne', ((await page.locator('[data-fenetre-de-service="creation-communication2"] [data-cran-a-menu="portee-du-service"]').first().innerText().catch(() => '')) || '').includes('Beta'));
    /* Le chevron du projet : « Tous les projets » en tête ; il ramène à la liste des projets. */
    await page.locator('[data-fenetre-de-service="creation-communication2"] [data-cran-a-menu="portee-du-service"]').first().hover();
    await page.locator('[data-voisins-du-cran="portee-du-service"]').first().click();
    await page.waitForTimeout(500);
    const premiers = await page.locator('[data-liste-panneau="voisins-portee-du-service"] [role=option]').allInnerTexts();
    noter('Chevron du projet : « Tous les projets » en premier choix', (premiers.find((x) => !/^Ouvrir /.test(x.trim())) ?? '').includes('Tous les projets'), premiers.slice(0, 3).join(' | '));
    await page.locator('[data-liste-panneau="voisins-portee-du-service"] [role=option]', { hasText: 'Tous les projets' }).first().click();
    await page.waitForTimeout(2500);
    noter('Chevron du projet : « Tous les projets » ramène à la liste des projets', (await hash(page)) === '#communication' && (await page.locator('[data-v2-accueil-projet]').count()) >= 1, await hash(page));
    /* Le chevron du service : les autres services. */
    await page.locator('[data-fenetre-de-service="creation-communication2"] [data-cran-a-menu="service-de-la-page"]').first().hover();
    await page.locator('[data-voisins-du-cran="service-de-la-page"]').first().click();
    await page.waitForTimeout(500);
    const services = await page.locator('[data-liste-panneau="voisins-service-de-la-page"] [role=option]').allInnerTexts();
    noter('Chevron du service : la liste des services, sans Calendrier', services.some((x) => x.includes('Studio')) && !services.some((x) => x.trim() === 'Calendrier'), services.join(' | '));
    await page.keyboard.press('Escape');

    /* (c) Le fil d'Ariane depuis la page d'un objet : le cran du service est un vrai lien vers sa liste. */
    await page.goto(`${BASE}/#charte/p-beta/${plaquetteId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const cran = page.locator('[data-fil-du-service-du-projet] [data-cran-du-projet]').first();
    const href = await cran.getAttribute('href').catch(() => null);
    noter('(c) Charte : le cran du projet est un lien vers la liste du service pour ce projet', href === '#charte/p-beta', String(href));
    if (href) {
      await cran.click();
      await page.waitForTimeout(2500);
      noter('(c) Charte : le clic y mène', (await hash(page)) === '#charte/p-beta', await hash(page));
    }
    if (campagne?.id) {
      await page.goto(`${BASE}/#communication/${marque.id}/campagnes/${campagne.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      noter('(c) Campagne : le fil porte le projet Beta', (await page.locator('[data-fil-du-projet="p-beta"]').count()) >= 1);
      const fil = await page.evaluate(() => {
        const nav = [...document.querySelectorAll('[data-fil-du-service-du-projet]')].find((n) => n.offsetParent);
        if (!nav) return null;
        const service = nav.querySelector('[data-cran-du-service-du-projet]');
        const projet = nav.querySelector('[data-cran-du-projet]');
        return { texte: nav.innerText.replace(/\s+/g, ' '), service: service?.getAttribute('href'), projet: projet?.getAttribute('href'), ordre: !!(service && projet && service.compareDocumentPosition(projet) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      noter('(c) Campagne : « Communication / Beta / Lancement de Beta », dans cet ordre', !!fil?.ordre && /Communication.*Beta.*Lancement de Beta/.test(fil.texte), JSON.stringify(fil));
      noter('(c) Campagne : le service mène à tous les projets, le projet à la liste de Beta', fil?.service === '#communication' && fil?.projet === '#communication?projet=p-beta', JSON.stringify(fil));
      noter('(c) Campagne : aucun morceau de fil rendu dans la page (capture #fe29)', (await page.locator('[data-suite-du-fil="page"]').count()) === 0);
      noter('(c) Campagne : la conversation et son suivi à quatre volets', (await page.locator('[data-v2-volet-du-suivi]').count()) === 4 && (await page.locator('[data-v2-suivi-chiffres] [data-v2-chiffre]').count()) === 3);
      await page.locator('[data-v2-volet-du-suivi="calendrier"]').first().click();
      await page.waitForTimeout(600);
      noter('(c) Campagne : le volet Calendrier pose le mois', (await page.locator('[data-v2-calendrier-campagne] [data-v2-jour]').count()) >= 28);
    } else noter('(c) Campagne : créée pour l’essai', false, JSON.stringify(campagnes).slice(0, 120));

    /* Les anciennes adresses mènent aux nouvelles. */
    for (const [ancien, neuf] of [['communication2', '#communication'], ['calendrier', '#communication'], ['plaquettes', '#charte'], [`plaquettes/p-beta/${plaquetteId}`, `#charte/p-beta/${plaquetteId}`]]) {
      await page.goto(`${BASE}/#${ancien}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      noter(`Ancienne adresse #${ancien} → ${neuf}`, (await hash(page)) === neuf, await hash(page));
    }
    await ctx.close();
  }

  /* Téléphone : la feuille « Tâches » allume en bleu la tâche ouverte. */
  {
    const ctx = await contexte(390);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#projet/p-alpha/tache/c-alpha-2`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await page.locator('[data-taches-du-haut]').first().click();
    await page.waitForTimeout(1500);
    const couleurs = await page.evaluate(() => {
      const ligne = document.querySelector('[data-feuille-des-taches] [data-ouvert] [data-titre-agent]');
      const sonde = document.createElement('span');
      sonde.style.color = 'hsl(var(--important))';
      document.body.appendChild(sonde);
      const attendue = getComputedStyle(sonde).color;
      sonde.remove();
      return { titre: ligne?.textContent ?? null, couleur: ligne ? getComputedStyle(ligne).color : null, attendue };
    });
    noter('Téléphone : la tâche ouverte est en bleu dans la feuille « Tâches »', couleurs.titre === 'Corriger le formulaire' && couleurs.couleur === couleurs.attendue, JSON.stringify(couleurs));
    await page.screenshot({ path: path.join(CAPTURES, 'services-et-fils-feuille-des-taches.png') });
    await ctx.close();
  }

  /* La légende sous un aperçu ne porte plus « A · #xxxx » (la lettre et l'identifiant restent dans l'en-tête). */
  const source = fs.readFileSync(path.join(RACINE, 'web/src/components/attachment-preview.tsx'), 'utf8');
  noter('Aperçu : la légende du bas ne pose plus le code de l’image', !source.includes('data-legende-code') && source.includes('data-visionneuse-repere'));
} catch (err) {
  noter('déroulé du contrôle', false, err?.stack ?? String(err));
  console.log(journal.join('').slice(-3000));
} finally {
  await browser?.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées.`);
process.exit(echecs.length ? 1 : 0);
