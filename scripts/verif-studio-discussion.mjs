#!/usr/bin/env node
/**
 * LE STUDIO AVANCE PAR QUESTIONS ET RÉPONSES, DANS UN VRAI NAVIGATEUR (01/11/2026, capture #6db2).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-studio-discussion.mjs
 *
 * Démon d'essai sur une base neuve, port à soi, aucun moteur lancé, aucune dépense.
 *   1. dans le fil du Studio : lot, voix finale et personnage 3D portent « Générer · prix » ;
 *   2. la dépense proposée dans le fil ne paraît pas aussi dans l'encadré du dessus ;
 *   3. aucun « Valider » sur un média du fil ni dans son menu ; le tableau, lui, le garde ;
 *   4. le choix de version en images montre son issue « Aucune, on arrête là » ;
 *   6. ni « Création » ni « Réalisation » dans le champ du Studio ; la carte du tableau les garde ;
 *   5. « Refuser » ne dépense rien, « Générer » décide la dépense une fois, personne n'est réveillé ;
 *   7. la conversation tient dans 820 px, centrée entre la colonne et l'aperçu, sans rappel des sujets d'avant ;
 *   8. l'encart d'une génération porte le menu des modèles avec leurs prix : changer ne lance rien, le bouton suit,
 *      le clic lance le modèle affiché. kie.ai est branché par une clé d'essai, que le service refuse : rien n'est dépensé.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7237);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-studio-discussion-', port: PORT });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const base = (o) => new Database(path.join(DATA, 'beluga.db'), o);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const run = { engine: 'claude', thinking: 'none', mode: 'direct' };

function carte(db, id, title, agentId, extra = {}) {
  const c = { id, projectId: 'p-essai', title, description: '', labels: [], column: 'planned', position: T, origin: 'user', attachments: [], run, excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, agentId, parcours: { plans: [], realisationSouhaitee: true }, realisation: { medias: ['video'], faites: 0, total: 0, phase: 'intention', restants: [], demandeA: T, esquissesA: T }, createdAt: T, updatedAt: T, ...extra };
  db.prepare('INSERT OR REPLACE INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(id, 'p-essai', 'planned', T, title, JSON.stringify(c), T, T);
}
function agent(db, id, cardId, extra = {}) {
  const a = { id, projectId: 'p-essai', cardId, role: 'cadrage', title: 'Agent', run, status: 'idle', createdAt: T, updatedAt: T, ...extra };
  db.prepare('INSERT OR REPLACE INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'p-essai', cardId, 'cadrage', 'idle', JSON.stringify(a), T, T);
}
function piece(db, id, cardId) {
  fs.mkdirSync(path.join(DATA, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'attachments', `${id}-image.png`), PNG);
  db.prepare('INSERT OR REPLACE INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, 'p-essai', id, JSON.stringify({ id, projectId: 'p-essai', cardId, name: 'image.png', mime: 'image/png', size: PNG.length, sha: id, createdAt: T }), T);
}
function message(db, id, agentId, questions) {
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 1, 0)').run(id, agentId, 'assistant', JSON.stringify({ id, agentId, role: 'assistant', content: 'Voici mes propositions.', questions, attachments: [], createdAt: T, updatedAt: T }), T);
}
const aPrix = (id, question, champ) => ({ id, question, description: 'Essai', kind: 'text', options: [], allowFreeText: true, ...champ });

function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const p = { id: 'p-essai', name: 'Essai', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run('p-essai', 'Essai', DEPOT, JSON.stringify(p), T, T);
  const composition = { format: '9:16', fond: '#101828', dureeVoulue: 12, pistes: [{ id: 'visuels', genre: 'visuel', nom: 'Visuels', segments: [{ id: 'titre', genre: 'texte', debut: 0, duree: 4, nom: 'Titre', texte: 'Le Studio', taille: 96, couleur: '#ffffff', position: { x: 50, y: 40 }, gras: true }] }] };
  db.prepare('INSERT OR IGNORE INTO studio_espaces (project_id, kit, cree_le, maj_le) VALUES (?, ?, ?, ?)').run('p-essai', '{}', T, T);
  db.prepare('INSERT INTO studio_creations (id, project_id, titre, formats, etat, version, agent_id, card_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)').run('cre-disc', 'p-essai', 'Discussion', '["9:16"]', 'brouillon', 'ag-studio', 'c-studio', T, T);
  db.prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)').run('cre-disc', JSON.stringify(composition), 'départ', 'humain', T);
  carte(db, 'c-studio', 'Studio — Discussion', 'ag-studio', { labels: ['studio'] });
  db.prepare('INSERT OR IGNORE INTO card_labels (card_id, position, label) VALUES (?, 0, ?)').run('c-studio', 'studio');
  agent(db, 'ag-studio', 'c-studio', { service: { id: 'studio', nom: 'Studio', adresse: 'studio/cre-disc' } });
  carte(db, 'c-tableau', 'Carte de média du tableau', 'ag-tableau');
  agent(db, 'ag-tableau', 'c-tableau');
  const depense = (id) => db.prepare("INSERT INTO studio_depenses (id, project_id, creation_id, genre, modele, plafond, raison, etat, details, demandee_par, cree_le, maj_le) VALUES (?, 'p-essai', 'cre-disc', 'modele3d', 'meshy', 1.2, 'Personnage', 'en-attente', ?, 'agent', ?, ?)").run(id, JSON.stringify({ nom: 'Mascotte', duFil: true }), T, T);
  depense('dep-refus');
  depense('dep-clic');
  const creationId = 'cre-disc';
  piece(db, 'piece-a', 'c-studio');
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 0, 0)').run('m-demande', 'ag-studio', 'user', JSON.stringify({ id: 'm-demande', agentId: 'ag-studio', role: 'user', content: 'Fais-moi une mascotte animée pour la vidéo, s’il te plaît.', attachments: [], createdAt: T - 2000, updatedAt: T - 2000 }), T - 2000);
  message(db, 'm-prop', 'ag-studio', [
    aPrix('q-lot', 'Générer « Mascotte » ?', { devis: { lotId: 'lot-essai', titre: 'Mascotte', lignes: [{ plan: 'p', modele: 'Kling', service: 'kie', prix: 1.5 }], total: 1.5, sansPrix: 0, budget: null, depense: 0, bouton: true } }),
    aPrix('q-voix', 'Générer la voix finale ?', { depenseDuFil: { genre: 'voix', creationId, plafond: 0.4 } }),
    aPrix('q-3d-refus', 'Générer le personnage 3D « Alpha » ?', { depenseDuFil: { genre: 'modele3d', creationId, plafond: 1.2, depenseId: 'dep-refus' } }),
    aPrix('q-3d-clic', 'Générer le personnage 3D « Bravo » ?', { depenseDuFil: { genre: 'modele3d', creationId, plafond: 1.2, depenseId: 'dep-clic' } }),
  ]);
  /* 8. UN VRAI LOT DE DEUX BROUILLONS z-image (kie.ai), proposé dans le fil : son encart a le menu des modèles. */
  db.prepare("INSERT INTO production_lots (id, project_id, card_id, titre, etape, etat, question_id, cree_le, decide_le) VALUES ('lot-menu', 'p-essai', 'c-studio', 'Affiche', NULL, 'propose', 'q-menu', ?, NULL)").run(T);
  for (const n of [1, 2]) {
    db.prepare(`INSERT INTO medias_realisation (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, raison, prix, source_prix, etat, lot_id, cree_le, modifie_le) VALUES (?, 'p-essai', 'c-studio', 'ag-studio', '', 'Affiche', 0, 'image', 'image', 'kie', 'z-image', 'Z-Image', '{"consigne":"a poster","format":"9:16"}', 'brouillon', 0.004, 'credits-kie', 'devis', 'lot-menu', ?, ?)`).run(`m-menu-${n}`, T + n, T + n);
    db.prepare("INSERT INTO production_operations (id, lot_id, card_id, media_id, plan, service, modele_nom, capacite, prix, etat, montant_reserve, montant_debite, cle, maj_le) VALUES (?, 'lot-menu', 'c-studio', ?, 'Affiche', 'kie', 'Z-Image', 'image', 0.004, 'prevue', 0, NULL, ?, ?)").run(`op-menu-${n}`, `m-menu-${n}`, `lot:lot-menu:devis:m-menu-${n}`, T);
  }
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at, a_questions, streaming) VALUES (?, ?, ?, ?, ?, 1, 0)').run('m-menu', 'ag-studio', 'assistant', JSON.stringify({ id: 'm-menu', agentId: 'ag-studio', role: 'assistant', content: 'L’affiche.', questions: [aPrix('q-menu', 'Générer « Affiche » ?', { description: 'Z-Image · 2 brouillons', devis: { lotId: 'lot-menu', titre: 'Affiche', lignes: [1, 2].map(() => ({ plan: 'Affiche', modele: 'Z-Image', service: 'kie.ai', prix: 0.004 })), total: 0.008, sansPrix: 0, budget: null, depense: 0, bouton: true } })], attachments: [], createdAt: T + 1, updatedAt: T + 1 }), T + 1);
  /* Un média fini, la même ligne sur la création et sur la carte du tableau. */
  const ligne = db.prepare(`INSERT INTO medias_realisation (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, source_prix, etat, attachment_id, cree_le, modifie_le) VALUES (?, 'p-essai', ?, ?, '', 'Mascotte', 1, 'image', 'image', 'montage', 'montage', 'Montage', '{"consigne":"x","format":"9:16"}', 'aucun', 'fini', ?, ?, ?)`);
  ligne.run('m-studio', 'c-studio', 'ag-studio', 'piece-a', T, T);
  piece(db, 'piece-t', 'c-tableau');
  ligne.run('m-tableau', 'c-tableau', 'ag-tableau', 'piece-t', T, T);
  db.close();
}

/** Un bloc de média fini : la liste vit en mémoire du démon, sans tour d'agent ici ; elle est donc glissée dans le canal de la page. */
const blocFini = (id, cardId, agentId, attachmentId) => ({ id, projectId: 'p-essai', cardId, agentId, sujet: 'Mascotte', outil: 'Essai', genre: 'image', format: '9:16', debut: Date.now(), fin: Date.now(), etat: 'fini', attachmentId });

function compteurDeMessages() {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const n = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE agent_id = 'ag-studio'").get().n;
  db.close();
  return n;
}

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const canaux = [];
    const serveurs = [];
    await page.routeWebSocket(/.*/, (ws) => {
      const serveur = ws.connectToServer();
      ws.onMessage((m) => serveur.send(m));
      serveur.onMessage((m) => ws.send(m));
      canaux.push(ws);
      serveurs.push(serveur);
    });
    const poserLesBlocs = (...items) => {
      const pieces = items.map((m) => ({ id: m.attachmentId, projectId: 'p-essai', cardId: m.cardId, name: 'image.png', mime: 'image/png', size: PNG.length, sha: m.attachmentId, createdAt: T }));
      for (const ws of canaux) {
        ws.send(JSON.stringify({ type: 'attachments', projectId: 'p-essai', items: pieces }));
        ws.send(JSON.stringify({ type: 'medias.fabrication', items }));
      }
    };
    const fil = page.locator('[data-studio-agent="conversation"]');
    await page.goto(`${BASE}/#studio/cre-disc`);
    await fil.waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-validation-du-lot]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(800);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'propositions.png') });

    /* 7. LA MISE EN PAGE (01/11/2026, captures #bbb9 et #39c51) : colonne de 820 px au plus, centrée dans le volet,
          marges égales, bulle et réponses au même bord droit, aucun rappel des sujets d'avant. */
    const mesure = () =>
      page.evaluate(() => {
        const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        const zone = r('main');
        const volet = r('[data-studio-volet-agent]');
        const conv = r('[data-studio-agent="conversation"]');
        const bulles = [...document.querySelectorAll('[data-studio-agent="conversation"] [data-bulle="utilisateur"]')].map((b) => b.getBoundingClientRect());
        const agent = [...document.querySelectorAll('[data-studio-agent="conversation"] [data-bulle="agent"], [data-studio-agent="conversation"] [data-validation-du-lot]')].map((b) => b.getBoundingClientRect());
        const champ = r('[data-studio-agent="conversation"] textarea');
        const contenu = [...document.querySelectorAll('[data-studio-agent="conversation"] [data-fil] *')]
          .map((e) => e.getBoundingClientRect())
          .filter((b) => b.width > 0 && b.height > 0);
        const cadre = r('[data-studio-cadre-apercu]');
        return {
          cadreG: cadre?.left,
          zoneG: zone?.left,
          volet: volet && { l: volet.left, r: volet.right, w: volet.width },
          conv: conv && { l: conv.left, r: conv.right, w: conv.width },
          champ: champ && { l: champ.left, r: champ.right },
          contenuG: contenu.length ? Math.min(...contenu.map((b) => b.left)) : null,
          contenuD: contenu.length ? Math.max(...contenu.map((b) => b.right)) : null,
          bulleD: bulles.length ? Math.max(...bulles.map((b) => b.right)) : null,
          agentD: agent.length ? Math.max(...agent.map((b) => b.right)) : null,
        };
      });
    /* Un grand écran, pour que le volet puisse dépasser 820 px (le plafond suit 55 % de l'atelier). */
    await page.setViewportSize({ width: 2200, height: 1100 });
    await page.reload();
    await fil.waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-validation-du-lot]').first().waitFor({ state: 'visible', timeout: 20000 });
    const poignee = page.locator('[data-studio-poignee="volet"]');
    for (const largeur of [480, 760, 1000]) {
      const b = await poignee.boundingBox();
      const volet0 = await page.locator('[data-studio-volet-agent]').boundingBox();
      if (b && volet0) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(volet0.x + largeur, b.y + b.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(400);
      }
      const m = await mesure();
      if (process.env.BELUGA_VERIF_DETAIL) console.log(JSON.stringify(m));
      /* La bande VISIBLE : du bord gauche de la zone au cadre de l'aperçu — c'est elle que l'œil lit (#bbb9 : 44 / 24 px). */
      const gauche = m.conv.l - m.zoneG;
      const droite = m.cadreG - m.conv.r;
      noter(`7. volet de ${Math.round(m.volet.w)} px : conversation au plus 820 px`, m.conv.w <= 820.5, `${Math.round(m.conv.w)} px`);
      noter(`7. volet de ${Math.round(m.volet.w)} px : conversation centrée entre la colonne et l’aperçu`, Math.abs(gauche - droite) <= 1, `${gauche.toFixed(1)} / ${droite.toFixed(1)} px`);
      if (m.champ) {
        const g = m.champ.l - m.zoneG;
        const d = m.cadreG - m.champ.r;
        noter(`7. volet de ${Math.round(m.volet.w)} px : champ d'écriture centré`, Math.abs(g - d) <= 1.5, `${g.toFixed(1)} / ${d.toFixed(1)} px`);
      }
      if (m.contenuG !== null) {
        const g = m.contenuG - m.zoneG;
        const d = m.cadreG - m.contenuD;
        noter(`7. volet de ${Math.round(m.volet.w)} px : contenu du fil centré`, Math.abs(g - d) <= 1.5, `${g.toFixed(1)} / ${d.toFixed(1)} px`);
      }
      if (m.agentD !== null && m.bulleD !== null) noter(`7. volet de ${Math.round(m.volet.w)} px : bulle et réponses au même bord`, Math.abs(m.agentD - m.bulleD) <= 1.5, `${m.bulleD.toFixed(1)} / ${m.agentD.toFixed(1)}`);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `largeur-${largeur}.png`) });
    }
    const voletMax = await page.locator('[data-studio-volet-agent]').evaluate((e) => e.getBoundingClientRect().width);
    noter('7. le volet s’élargit au-delà de 820 px', voletMax > 840, `${Math.round(voletMax)} px`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await fil.waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-validation-du-lot]').first().waitFor({ state: 'visible', timeout: 20000 });
    noter('7. aucun titre « Réponse · sujet » au-dessus des réponses du Studio', (await fil.locator('h4').filter({ hasText: /^Réponse(\s·|$)/ }).count()) === 0);

    /* 8. LE MENU DES MODÈLES DE L'ENCART « GÉNÉRER » : kie.ai branché (clé d'essai, aucune dépense possible), la page relue. */
    for (const sv of serveurs) sv.send(JSON.stringify({ id: 'essai-kie', cmd: { type: 'coffre.enregistrer', acces: { nom: 'Studio — kie.ai', type: 'cle-api', projectId: null, champs: { service: 'kie.ai', cle: 'cle-essai-kie-ABCD1234', adresse: 'https://kie.ai' } } } }));
    await page.waitForTimeout(800);
    await page.reload();
    await fil.waitFor({ state: 'visible', timeout: 30000 });
    const encart = fil.locator('[data-validation-du-lot="lot-menu"]');
    await encart.waitFor({ state: 'visible', timeout: 20000 });
    const declencheur = encart.locator('[data-menu-des-modeles]');
    await declencheur.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
    noter('8. l’encart du lot porte le menu des modèles', (await declencheur.count()) === 1);
    const brouillons = () => {
      const db = base({ readonly: true });
      const r = db.prepare("SELECT modele, etat, prix FROM medias_realisation WHERE lot_id = 'lot-menu' ORDER BY id").all();
      db.close();
      return r;
    };
    const messagesAvant = compteurDeMessages();
    if (await declencheur.count()) {
      await encart.scrollIntoViewIfNeeded();
      await declencheur.click();
      const liste = page.locator('[data-liste-des-modeles="lot-menu"]');
      await liste.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500); // la fin du fondu d'ouverture, avant de mesurer et de capturer
      const lignes = liste.locator('[data-modele-du-menu]');
      const n = await lignes.count();
      noter('8. le menu liste plusieurs modèles, le prévu coché en tête', n > 1 && (await lignes.first().getAttribute('data-modele-du-menu')) === 'z-image' && (await lignes.first().getAttribute('data-modele-coche')) !== null, `${n} modèles`);
      noter('8. chaque ligne dit son prix', (await liste.locator('[data-prix-du-modele]').count()) === n);
      const boite = await liste.boundingBox();
      const vue = page.viewportSize();
      noter('8. le menu reste dans l’écran', !!boite && boite.x >= 0 && boite.y >= 0 && boite.x + boite.width <= vue.width && boite.y + boite.height <= vue.height, JSON.stringify(boite));
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'menu-des-modeles.png') });
      noter('8. ouvrir le menu ne lance rien', brouillons().every((b) => b.etat === 'devis' && b.modele === 'z-image'));
      const autre = lignes.nth(1);
      const modeleAutre = await autre.getAttribute('data-modele-du-menu');
      const prixAutre = await autre.locator('[data-prix-du-modele]').innerText();
      await autre.click();
      await page.waitForFunction((m) => document.querySelector('[data-validation-du-lot="lot-menu"] [data-menu-des-modeles]')?.textContent && !document.querySelector('[data-validation-du-lot="lot-menu"] [aria-busy="true"]'), modeleAutre, { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const apres = brouillons();
      noter('8. changer de modèle réécrit les brouillons, sans rien lancer', apres.every((b) => b.etat === 'devis' && b.modele === modeleAutre), JSON.stringify(apres));
      const bouton = await encart.locator('[data-valider-avec-cout]').innerText();
      noter('8. le bouton suit le prix du modèle choisi', bouton.includes(prixAutre.trim()), `${bouton} / ${prixAutre}`);
      noter('8. le changement ne réveille pas l’agent', compteurDeMessages() === messagesAvant);
      if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'modele-change.png') });
      /* Le clic lance exactement le modèle affiché (la clé d'essai est refusée par kie.ai : rien n'est dépensé). */
      await encart.locator('[data-valider-avec-cout]').click();
      await page.waitForTimeout(2500);
      const lances = brouillons();
      noter('8. « Générer » lance le modèle affiché', lances.every((b) => b.modele === modeleAutre && b.etat !== 'devis'), JSON.stringify(lances));
    }

    const lot = await fil.locator('[data-validation-du-lot] [data-valider-avec-cout]').first().innerText();
    noter('1. le lot porte « Générer · prix »', /^Générer · 1[.,]5/.test(lot), lot);
    const voix = fil.locator('[data-validation-de-depense="voix"]');
    noter('1. la voix finale se propose dans le fil', /Générer · 0[.,]4/.test(await voix.locator('[data-valider-avec-cout]').innerText()));
    const troisD = fil.locator('[data-validation-de-depense="modele3d"]');
    noter('1. le personnage 3D se propose dans le fil', (await troisD.count()) === 2 && /Générer · 1[.,]2/.test(await troisD.first().locator('[data-valider-avec-cout]').innerText()));
    noter('2. l’encadré du dessus ne les montre pas une seconde fois', (await page.locator('[data-studio-depense]').count()) === 0);
    noter('3. plus aucun « Valider · prix » dans le fil', !/Valider ·/.test(await fil.innerText()));

    noter('6. ni étoile ni caméra dans le champ du Studio', (await fil.locator('[data-interrupteur-creation], [data-interrupteur-realisation]').count()) === 0);
    /* 5. Les clics : on lit la base, et personne n'est réveillé. */
    const etat = (id) => {
      const db = base({ readonly: true });
      const e = db.prepare('SELECT etat FROM studio_depenses WHERE id = ?').get(id)?.etat;
      db.close();
      return e;
    };
    const compteur = () => {
      const db = base({ readonly: true });
      const n = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE agent_id = 'ag-studio'").get().n;
      db.close();
      return n;
    };
    const avant = compteur();
    await fil.locator('[data-validation-de-depense="modele3d"]').filter({ hasText: 'Alpha' }).locator('[data-refuser-avec-cout]').click();
    await page.waitForTimeout(1000);
    noter('5. « Refuser » : la dépense est refusée, rien n’est lancé', etat('dep-refus') === 'refusee', etat('dep-refus'));
    await fil.locator('[data-validation-de-depense="modele3d"]').filter({ hasText: 'Bravo' }).locator('[data-valider-avec-cout]').click();
    await page.waitForTimeout(1500);
    noter('5. « Générer » : la dépense est décidée', etat('dep-clic') !== 'en-attente', etat('dep-clic'));
    await fil.locator('[data-validation-de-depense="voix"] [data-refuser-avec-cout]').click();
    await page.waitForTimeout(800);
    const db = base({ readonly: true });
    noter('5. la voix refusée ne crée aucune dépense', db.prepare("SELECT COUNT(*) AS n FROM studio_depenses WHERE genre = 'voix'").get().n === 0);
    db.close();
    noter('5. aucun clic ne réveille l’agent', compteur() === avant, `${avant} → ${compteur()}`);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'apres-clics.png') });

    /* 3. Un média fini : aucun « Valider » dans le Studio, ni sur lui ni dans son menu. */
    poserLesBlocs(blocFini('b-studio', 'c-studio', 'ag-studio', 'piece-a'));
    await fil.locator('[data-media-en-fabrication][data-media-etat="fini"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    const menu = fil.locator('[data-media-en-fabrication][data-media-etat="fini"] [data-menu-actions]').first();
    noter('3. le média du fil du Studio a son menu, sans bouton « Valider »', (await menu.count()) === 1 && (await fil.locator('[data-valider-media]').count()) === 0);
    await menu.click();
    await page.locator('[data-media-reglages]').first().waitFor({ state: 'visible', timeout: 5000 });
    noter('3. son menu ne propose pas « Valider » non plus', (await page.locator('[data-media-retenir]').count()) === 0);
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'menu-studio.png') });
    await page.keyboard.press('Escape');

    /* Le tableau, lui aussi, sans bouton de mode. */
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-agent-en-liste="c-tableau"]').first().click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    poserLesBlocs(blocFini('b-tableau', 'c-tableau', 'ag-tableau', 'piece-t'));
    await page.locator('[data-media-en-fabrication][data-media-etat="fini"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    /* 11/11/2026 : plus aucun bouton de mode, nulle part — le mode se confirme dans la discussion. */
    noter('6. la carte du tableau n’a plus de bouton de mode', (await page.locator('[data-interrupteur-creation], [data-interrupteur-realisation], [data-interrupteur-plan]').count()) === 0);
    noter('3. la carte de média du tableau garde « Valider »', (await page.locator('[data-media-en-fabrication] [data-valider-media]').count()) === 1);

    /* 4. Le choix de version, avec son issue d'arrêt. */
    {
      const db2 = base();
      piece(db2, 'piece-b', 'c-tableau');
      message(db2, 'm-choix', 'ag-tableau', [{ id: 'q-choix', question: '« Mascotte » : gardez-vous cette version ?', description: 'La version choisie est validée.', kind: 'single', options: [{ id: 'o0', label: 'A — version 1', description: 'Montage', image: 'piece-b' }, { id: 'arret', label: 'Aucune, on arrête là', description: 'Rien n’est validé.' }], allowFreeText: true, choixDeVersion: { cardId: 'c-tableau', plan: 'Mascotte', versions: [{ optionId: 'o0', mediaId: 'm-x' }] } }]);
      db2.close();
    }
    await page.reload();
    await page.locator('[data-agent-en-liste="c-tableau"]').first().click({ timeout: 15000 }).catch(() => undefined);
    const arret = page.locator('[data-option-apercu="arret"], [data-option-question="arret"]').first();
    await arret.waitFor({ state: 'visible', timeout: 15000 });
    noter('4. le choix de version montre son issue d’arrêt', await arret.isVisible());
    if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, 'choix.png') });
  } finally {
    await navigateur.close();
  }
  const reussis = resultats.filter(Boolean).length;
  console.log(`\n${reussis}/${resultats.length} vérifications`);
  process.exit(reussis === resultats.length ? 0 : 1);
}
principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
