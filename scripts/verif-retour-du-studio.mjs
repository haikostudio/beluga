#!/usr/bin/env node
/**
 * LE RETOUR DU STUDIO, DANS UN VRAI NAVIGATEUR (décision du 30/10/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-retour-du-studio.mjs
 *
 * Démon d'essai sur une base neuve, port à soi, aucun moteur lancé. Les anciennes
 * créations sont RECOPIÉES depuis la base réelle, lue en lecture seule, si elle est
 * là (`BELUGA_VERIF_BASE_REELLE`) ; sans elle, ce contrôle-là est dit sauté.
 *
 * Ce qui est vérifié :
 *   1. le Studio est une tuile des services, ouvert à l'administrateur connecté ;
 *   2. les anciennes créations s'ouvrent, avec leur ligne de temps et leur aperçu ;
 *   3. une création née au Studio porte la conversation d'un directeur artistique :
 *      chemin des quatre étapes et liste de tâches collés au champ, bouton d'étape,
 *      éditeur ouvert à l'étape Brief ; sa carte paraît dans les listes d'agents et y mène ;
 *   4. « Monter au Studio » : une carte vidéo verse ce qu'elle a validé sur la ligne
 *      de temps, le fil reste celui de la carte, et « Revenir à la carte » y ramène ;
 *   5. l'export prêt revient aux finaux de la carte ;
 *   6. modèles, notes sur l'image, versions, bibliothèque commune, déclinaison ;
 *   7. coupe au texte et rythme (règles exercées sur une création d'essai) ;
 *   8. téléphone : aperçu, onglets, ligne de temps et conversation, sans tiroir ;
 *   9. refonte du 31/10/2026 : plus de rangée d'onglets sur ordinateur, Décliner dans la
 *      production, note posée depuis la ligne de temps, et la colonne de gauche (sans traits,
 *      « + » au survol, carte mère qui déplie ses filles, loupe qui ne change pas la page) ;
 *  10. alignement du 31/10/2026 (carte « Studio : conversation et options alignées ») :
 *      conversation centrée à largeur limitée, sans bande grise ; bibliothèque et modèles
 *      dans le champ, le style choisi posé en étiquette ; plus de barre d'étapes ; menu à
 *      trois points (renommer, dupliquer, supprimer) à droite, nom du projet hors du fil
 *      d'Ariane, plus d'historique en haut ; Médias, Téléchargements et Style en TIROIRS,
 *      archives sous les rubriques avec retour qui s'ajoute en tête ; types de média en
 *      liste verticale illustrée, dont le clic choisit ET envoie la première demande.
 *  11. Studio sans étapes (01/11/2026, capture #e4f3) : plus de « Passer au… » ni de bouton
 *      de production en haut ; « Construction », seul bouton, en bas de la conversation,
 *      allumé dès qu'une version se lit, éteint avec sa raison pendant une fabrication ; les
 *      cartes de média du tableau gardent leur bouton d'étape.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7236);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.BELUGA_VERIF_CAPTURES;
const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({ prefixe: 'verif-retour-du-studio-', port: PORT });
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();

const baseDeDonnees = (options) => new Database(path.join(DATA, 'beluga.db'), options);

function projet(db, id, name, rank, extra = {}) {
  const p = { id, name, path: `${DEPOT}-${id}`, defaultEngine: 'claude', isSelf: false, rank, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  fs.mkdirSync(p.path, { recursive: true });
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, name, p.path, JSON.stringify(p), MAINTENANT, MAINTENANT);
}

function carte(db, id, projectId, column, title, extra = {}) {
  const c = {
    id, projectId, title, description: '', labels: [], column, position: MAINTENANT,
    origin: 'user', attachments: [], run: { engine: 'claude', thinking: 'none', mode: 'direct' },
    excludedFromDeploy: false, horsTache: false, codeDejaEnregistre: false, createdAt: MAINTENANT, updatedAt: MAINTENANT,
    ...extra,
  };
  db.prepare('INSERT OR REPLACE INTO cards (id, project_id, column_key, position, title, data, deployed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(id, projectId, column, MAINTENANT, title, JSON.stringify(c), MAINTENANT, MAINTENANT);
}

function agent(db, id, projectId, cardId, role, extra = {}) {
  const a = { id, projectId, cardId, role, title: 'Agent', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'idle', createdAt: MAINTENANT, updatedAt: MAINTENANT, ...extra };
  db.prepare('INSERT OR REPLACE INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, cardId, role, 'idle', JSON.stringify(a), MAINTENANT, MAINTENANT);
}

/* ----- Un petit fichier vidéo de décor : il sert de plan validé et d'export. ----- */
function fabriquerUnPlan(nom, secondes) {
  const sortie = path.join(DATA, 'attachments', nom);
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=teal:s=270x480:d=${secondes}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secondes}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sortie]);
  return fs.statSync(sortie).size;
}

function piece(db, id, projectId, cardId, nom, mime, taille) {
  const data = { id, projectId, cardId, name: nom, mime, size: taille, sha: id, createdAt: MAINTENANT };
  db.prepare('INSERT OR REPLACE INTO attachments (id, project_id, sha, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, id, JSON.stringify(data), MAINTENANT);
}

/** Les anciennes créations, recopiées telles quelles depuis la base réelle ; rien n'y est écrit. */
function recopierLesAnciennesCreations(db) {
  const chemin = process.env.BELUGA_VERIF_BASE_REELLE ?? path.join(RACINE, '..', '..', 'data', 'beluga.db');
  if (!fs.existsSync(chemin)) return [];
  const reelle = new Database(chemin, { readonly: true, fileMustExist: true });
  const creations = reelle.prepare('SELECT * FROM studio_creations').all();
  const inserer = (table, lignes) => {
    for (const ligne of lignes) {
      const noms = Object.keys(ligne);
      db.prepare(`INSERT OR REPLACE INTO ${table} (${noms.join(',')}) VALUES (${noms.map(() => '?').join(',')})`).run(...noms.map((n) => ligne[n]));
    }
  };
  for (const c of creations) {
    const nomProjet = reelle.prepare('SELECT name FROM projects WHERE id = ?').get(c.project_id)?.name ?? 'Projet';
    projet(db, c.project_id, nomProjet, 5);
    inserer('studio_espaces', reelle.prepare('SELECT * FROM studio_espaces WHERE project_id = ?').all(c.project_id));
    inserer('studio_medias', reelle.prepare('SELECT * FROM studio_medias WHERE project_id = ?').all(c.project_id));
    inserer('studio_versions', reelle.prepare('SELECT * FROM studio_versions WHERE creation_id = ?').all(c.id));
    /* L'agent et la carte d'avant restent dans la base réelle : la création repart sans eux. */
    inserer('studio_creations', [{ ...c, agent_id: null, card_id: null }]);
  }
  const pieces = reelle.prepare('SELECT DISTINCT a.* FROM attachments a JOIN studio_medias m ON m.attachment_id = a.id').all();
  inserer('attachments', pieces);
  reelle.close();
  return creations;
}

function poserLeDecor() {
  const db = baseDeDonnees();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + 3600_000, 'essai');
  projet(db, 'p-essai', 'Essai', 1);
  const anciennes = recopierLesAnciennesCreations(db);

  /* UNE CRÉATION NÉE AU STUDIO, avec son directeur artistique : la carte caméra à l'étape Brief. */
  const composition = { format: '9:16', fond: '#101828', dureeVoulue: 12, pistes: [
    { id: 'visuels', genre: 'visuel', nom: 'Visuels', segments: [
      { id: 'titre', genre: 'texte', debut: 0, duree: 4, nom: 'Titre', texte: 'Le Studio', taille: 96, couleur: '#ffffff', position: { x: 50, y: 40 }, gras: true },
    ] },
    { id: 'voix', genre: 'son', nom: 'Voix', segments: [
      { id: 'v1', genre: 'voix', debut: 0, duree: 2, nom: 'Voix', texte: 'un deux', voixEssai: 'fr_FR-siwis-medium', etat: 'essai', volume: 1, mediaId: 'med-voix', mots: [{ texte: 'un', debut: 0, fin: 1 }, { texte: 'deux', debut: 1, fin: 2 }] },
    ] },
    { id: 'musique', genre: 'son', nom: 'Musique', segments: [] },
    { id: 'sous-titres', genre: 'sous-titres', nom: 'Sous-titres', segments: [] },
  ] };
  db.prepare('INSERT OR IGNORE INTO studio_espaces (project_id, kit, cree_le, maj_le) VALUES (?, ?, ?, ?)').run('p-essai', '{}', MAINTENANT, MAINTENANT);
  const tailleVoix = fabriquerUnPlan('piece-voix-voix.mp4', 2);
  piece(db, 'piece-voix', 'p-essai', 'c-studio', 'voix.mp4', 'video/mp4', tailleVoix);
  db.prepare("INSERT INTO studio_medias (id, project_id, creation_id, genre, provenance, nom, attachment_id, mime, duree, cree_le) VALUES ('med-voix', 'p-essai', 'cre-neuve', 'audio', 'voix-essai', 'Voix', 'piece-voix', 'video/mp4', 2, ?)").run(MAINTENANT);
  db.prepare('INSERT INTO studio_creations (id, project_id, titre, formats, etat, version, agent_id, card_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)').run('cre-neuve', 'p-essai', 'Création du directeur', JSON.stringify(['9:16', '1:1']), 'brouillon', 'ag-studio', 'c-studio', MAINTENANT, MAINTENANT);
  db.prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)').run('cre-neuve', JSON.stringify(composition), 'création', 'humain', MAINTENANT);
  carte(db, 'c-studio', 'p-essai', 'planned', 'Studio — Création du directeur', {
    labels: ['studio'],
    agentId: 'ag-studio',
    parcours: { plans: [], realisationSouhaitee: true },
    realisation: { medias: ['video'], faites: 0, total: 0, phase: 'intention', restants: [], demandeA: MAINTENANT },
  });
  db.prepare('INSERT OR IGNORE INTO card_labels (card_id, position, label) VALUES (?, 0, ?)').run('c-studio', 'studio');
  agent(db, 'ag-studio', 'p-essai', 'c-studio', 'cadrage', { service: { id: 'studio', nom: 'Studio', adresse: 'studio/cre-neuve' } });

  /* UNE CARTE CAMÉRA ORDINAIRE, à l'étape Montage, avec un plan validé. */
  carte(db, 'c-camera', 'p-essai', 'planned', 'Spot de rentrée', {
    agentId: 'ag-camera',
    parcours: { plans: [], realisationSouhaitee: true },
    realisation: { medias: ['video'], faites: 0, total: 0, phase: 'intention', restants: [], demandeA: MAINTENANT, esquissesA: MAINTENANT, sequencesA: MAINTENANT, montageA: MAINTENANT },
  });
  agent(db, 'ag-camera', 'p-essai', 'c-camera', 'cadrage');

  /* 9. UNE CRÉATION SANS DIRECTEUR : l'accueil au champ d'écriture standard et les modes de réalisation. */
  db.prepare('INSERT INTO studio_creations (id, project_id, titre, formats, etat, version, agent_id, card_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)').run('cre-vide', 'p-essai', 'Création vierge', JSON.stringify(['9:16']), 'brouillon', MAINTENANT, MAINTENANT);
  db.prepare('INSERT INTO studio_versions (creation_id, numero, parent, composition, raison, auteur, cree_le) VALUES (?, 1, NULL, ?, ?, ?, ?)').run('cre-vide', JSON.stringify({ ...composition, pistes: composition.pistes.map((p) => ({ ...p, segments: [] })) }), 'création', 'humain', MAINTENANT);

  /* 9. UN PROJET RÉUNI : sa carte mère et la carte fille posée dans un membre. */
  projet(db, 'p-groupe', 'Groupe', 2, { regroupement: true });
  projet(db, 'p-membre', 'Membre', 3, { regroupementId: 'p-groupe' });
  carte(db, 'c-mere', 'p-groupe', 'running', 'Travail commun', { cartesFilles: [{ projectId: 'p-membre', cardId: 'c-fille' }] });
  carte(db, 'c-fille', 'p-membre', 'running', 'Travail commun — Membre', { carteMereId: 'c-mere' });
  const taille = fabriquerUnPlan('piece-plan-1-plan-1.mp4', 2);
  piece(db, 'piece-plan-1', 'p-essai', 'c-camera', 'plan-1.mp4', 'video/mp4', taille);
  db.prepare(
    `INSERT INTO medias_realisation (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, source_prix, etat, attachment_id, retenu_le, cree_le, modifie_le)
     VALUES ('m-plan-1', 'p-essai', 'c-camera', 'ag-camera', '', 'plan-1', 1, 'animation', 'video', 'kie', 'kling-3.0/video', 'Kling 3.0', '{"consigne":"x","format":"9:16"}', 'credits-kie', 'fini', 'piece-plan-1', ?, ?, ?)`,
  ).run(MAINTENANT, MAINTENANT, MAINTENANT);
  db.close();
  return anciennes;
}

async function capture(page, nom) {
  if (CAPTURES) await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const anciennes = poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const erreurs = [];
  /* Le cadre d'aperçu est isolé : le service worker bloqué par Playwright y lève une erreur qui n'est pas la nôtre. */
  const noterErreur = (e) => {
    const texte = String(e?.message ?? e);
    if (!texte.includes("'serviceWorker'")) erreurs.push(texte);
  };
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    page.on('pageerror', (e) => noterErreur(e));

    /* 1. La tuile : le Studio s'ouvre depuis Communication (lieu Médias, le directeur), qui a la seule entrée du menu */
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-navigation-compacte]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-navigation-compacte]').first().click();
    /* L'ancien Communication n'est plus dans le menu (10/11/2026) : la tuile « Communication » ouvre le nouvel espace,
       l'ancien s'ouvre par son adresse. */
    const tuile = page.locator('[data-ouvrir-communication2]').first();
    noter('1. Communication est la tuile des services', await tuile.isVisible());
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/#communication`);
    await page.waitForTimeout(1500);
    noter('1. l’adresse mène à Communication', page.url().includes('#communication'));
    await capture(page, '01-liste');

    /* 2. Les anciennes créations */
    if (anciennes.length) {
      for (const c of anciennes) {
        await page.goto(`${BASE}/#studio/${c.id}`);
        await page.locator(`[data-studio-editeur="${c.id}"]`).waitFor({ state: 'visible', timeout: 20000 });
        const ok = await page.locator('[data-studio-regle]').first().isVisible({ timeout: 10000 }).catch(() => false);
        const blocs = await page.locator('[data-studio-rangee-ligne-de-temps] [data-studio-segment]').count();
        noter(`2. « ${c.titre} » s’ouvre avec sa ligne de temps`, ok, `${blocs} bloc(s)`);
        /* Le dessin d'une ancienne création se rejoue dans le cadre d'aperçu. */
        if (blocs) {
          const regle = await page.locator('[data-studio-regle]').first().boundingBox();
          await page.mouse.click(regle.x + 200, regle.y + 10);
          await page.waitForTimeout(1500);
        }
        await capture(page, `02-${c.id}`);
      }
    } else {
      console.log('  SAUTÉ 2. base réelle absente : les anciennes créations ne sont pas recopiées');
    }

    /* 3. La conversation d'un directeur */
    await page.goto(`${BASE}/#studio/cre-neuve`);
    await page.locator('[data-studio-editeur="cre-neuve"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-studio-agent="conversation"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(3000);
    noter('3. la conversation est celle de la carte du directeur', (await page.locator('[data-studio-agent-carte="c-studio"]').count()) === 1);
    noter('3. le fil arrive : plus de silhouette', (await page.locator('[data-studio-agent="conversation"] [data-silhouette], [data-studio-agent="conversation"] [data-zone-silhouette]').count()) === 0);
    /* LE STUDIO N'A PLUS D'ÉTAPES (01/11/2026, capture #e4f3) : le seul bouton, « Construction », est en bas de la conversation. */
    {
      const fil = page.locator('[data-studio-agent="conversation"] [data-studio-mettre-en-production="fil"]');
      const boite = await fil.boundingBox().catch(() => null);
      const hauteur = page.viewportSize()?.height ?? 900;
      noter(
        '3. plus aucun bouton d’étape dans le Studio : « Construction » le remplace, en bas de la conversation',
        (await page.locator('[data-studio-agent="conversation"] [data-geste-du-media]').count()) === 0 && (await fil.count()) === 1 && !!boite && boite.y > hauteur / 2,
        boite ? `y=${Math.round(boite.y)} / ${hauteur}` : 'bouton absent',
      );
    }
    noter('3. l’éditeur reste ouvert à l’étape Brief', await page.locator('[data-studio-regle]').first().isVisible());
    noter('9. plus aucune rangée d’onglets sur ordinateur', (await page.locator('[data-studio-onglets]').count()) === 0);
    noter('10. plus de barre d’étapes en tête de la conversation du directeur', (await page.locator('[data-studio-agent] [data-barre-du-fil]').count()) === 0);
    noter(
      '10. Médias, Téléchargements et Style sont les rubriques de la colonne, sans Bibliothèque',
      (await page.locator('[data-colonne-studio-creation] [data-studio-ouvrir="medias"], [data-colonne-studio-creation] [data-studio-ouvrir="fichiers"], [data-colonne-studio-creation] [data-studio-ouvrir="style"]').count()) === 3 &&
        (await page.locator('[data-colonne-studio-creation] [data-studio-ouvrir-bibliotheque]').count()) === 0,
    );
    noter('10. les archives vivent dans la colonne, sous les rubriques', (await page.locator('[data-colonne-studio-creation] [data-studio-archives]').count()) === 1);
    {
      const production = page.locator('[data-studio-mettre-en-production]').first();
      const texte = (await production.innerText()).trim();
      const fond = await production.evaluate((el) => getComputedStyle(el).backgroundColor);
      const menu = await page.locator('[data-options-de-page="menu"]').first().boundingBox();
      const pos = await production.boundingBox();
      noter(
        '10. un seul « Construction », celui du bas, allumé sur un fond coloré dès qu’une version se lit',
        /Construction/.test(texte) && (await page.locator('[data-studio-mettre-en-production]').count()) === 1 && (await production.getAttribute('data-studio-mettre-en-production')) === 'fil' && (await production.getAttribute('data-geste-possible')) === 'oui' && !/rgba?\((\d+), \1, \1/.test(fond) && !!menu && !!pos,
        `${texte} · ${fond}`,
      );
      /* Une fabrication validée et pas encore posée l'éteint, et il DIT pourquoi. */
      {
        const db = baseDeDonnees();
        db.prepare("INSERT INTO studio_depenses (id, project_id, creation_id, genre, modele, plafond, raison, etat, details, demandee_par, cree_le, maj_le) VALUES ('dep-essai-3d', 'p-essai', 'cre-neuve', 'modele3d', 'meshy', 0.7, 'essai', 'validee', '{}', 'agent', ?, ?)").run(Date.now(), Date.now());
        db.close();
        await page.reload();
        const bas = page.locator('[data-studio-agent="conversation"] [data-studio-mettre-en-production="fil"]');
        await bas.waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForTimeout(1500);
        const raison = (await bas.getAttribute('data-raison')) ?? '';
        noter('11. une fabrication en cours éteint le bouton du bas, qui dit pourquoi', (await bas.getAttribute('data-geste-possible')) === 'non' && /fabrication est en cours/.test(raison), raison);
        await capture(page, '11-bouton-eteint');
        const db2 = baseDeDonnees();
        db2.prepare("DELETE FROM studio_depenses WHERE id = 'dep-essai-3d'").run();
        db2.close();
        await page.reload();
        await page.locator('[data-studio-agent="conversation"] [data-studio-mettre-en-production="fil"][data-geste-possible="oui"]').waitFor({ state: 'visible', timeout: 20000 });
      }
      noter('10. plus d’historique ni de modèles dans les barres', (await page.locator('[data-studio-ouvrir="versions"], [data-studio-ouvrir="modeles"]').count()) === 0);
      noter('10. le fil d’Ariane ne porte que le nom de la création, sans gestes collés', (await page.locator('[data-studio-gestes-creation]').count()) === 0 && (await page.locator('[data-studio-titre-creation]').innerText()).trim() === 'Création du directeur');
      await page.locator('[data-options-de-page="menu"]').first().click();
      noter('10. le menu à trois points porte renommer, dupliquer et supprimer', (await page.locator('[data-options-de-page-menu] [data-studio-renommer], [data-options-de-page-menu] [data-studio-dupliquer], [data-options-de-page-menu] [data-studio-supprimer]').count()) === 3);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      noter('10. bibliothèque et modèles sont des boutons du champ d’écriture', (await page.locator('[data-studio-agent] [data-rangee-de-boutons] [data-studio-ouvrir-bibliotheque]').count()) === 1 && (await page.locator('[data-studio-agent] [data-rangee-de-boutons] [data-studio-menu-modeles]').count()) === 1);
      const volet = await page.locator('[data-studio-volet-agent]').boundingBox();
      const fil = await page.locator('[data-studio-agent]').boundingBox();
      noter('10. la conversation est centrée dans son volet, à largeur limitée', !!volet && !!fil && fil.width <= 821 && Math.abs(fil.x - volet.x - (volet.width - fil.width) / 2) <= 2, `${Math.round(fil?.width ?? 0)} px dans ${Math.round(volet?.width ?? 0)} px`);
      const pied = await page.locator('[data-studio-agent] [data-rangee-de-boutons="champ-gauche"]').first().evaluate((el) => {
        let n = el.parentElement;
        while (n && !n.matches('[data-studio-agent]')) {
          if (/pt-2/.test(n.className) && /px-4/.test(n.className)) return getComputedStyle(n).backgroundColor;
          n = n.parentElement;
        }
        return 'introuvable';
      });
      noter('10. plus de bande grise autour du champ', pied === 'rgba(0, 0, 0, 0)' || pied === 'transparent', pied);
    }
    {
      const agent = await page.locator('[data-studio-volet-agent]').boundingBox();
      const image = await page.locator('[data-studio-colonne-apercu]').boundingBox();
      noter('3. l’agent à gauche, l’image et la ligne de temps à droite', agent.x + agent.width <= image.x + 1, `${Math.round(agent.x)} puis ${Math.round(image.x)}`);
      noter('3. plus aucun calque à l’écran', (await page.locator('[data-studio-calques], [data-studio-colonne-calques], [data-studio-editeur-calques]').count()) === 0);
    }
    await capture(page, '03-directeur');
    /* 7. La coupe au texte : un mot barré est coupé partout, en une version. */
    await page.locator('[data-studio-rangee-ligne-de-temps] [data-studio-segment="v1"]').dblclick();
    const mot = page.locator('[data-studio-mot="1"]');
    await mot.waitFor({ state: 'visible', timeout: 10000 });
    await mot.click();
    await page.locator('[data-studio-couper-mots]').click();
    await page.waitForTimeout(800);
    {
      const db = baseDeDonnees({ readonly: true });
      const v = db.prepare("SELECT composition FROM studio_versions WHERE creation_id = 'cre-neuve' ORDER BY numero DESC LIMIT 1").get();
      db.close();
      const voix = JSON.parse(v.composition).pistes.find((p) => p.id === 'voix').segments[0];
      noter('7. effacer un mot coupe la voix et son texte', voix?.duree === 1 && voix?.texte === 'un', JSON.stringify({ duree: voix?.duree, texte: voix?.texte }));
    }
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-agent-en-liste="c-camera"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    /* DEPUIS LE 31/10/2026, le directeur paraît dans les listes d'agents, et sa ligne mène à sa création. */
    noter('3. le directeur paraît dans « Tableaux de bord »', (await page.locator('[data-agent-en-liste="c-studio"]').count()) === 1, `${await page.locator('[data-agent-en-liste]').count()} ligne(s)`);
    await page.locator('[data-agent-en-liste="c-studio"] > button').first().click();
    await page.locator('[data-studio-agent="conversation"]').waitFor({ state: 'visible', timeout: 15000 });
    noter('3. un appui sur sa ligne ouvre sa création', (await page.locator('[data-studio-agent-carte="c-studio"]').count()) === 1);
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-agent-en-liste="c-camera"]').first().waitFor({ state: 'visible', timeout: 15000 });

    /* 4. Monter au Studio */
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-agent-en-liste="c-camera"]').first().click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    const monter = page.locator('[data-monter-au-studio]').first();
    await monter.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    noter('4. une carte vidéo à l’étape Montage propose « Monter au Studio »', await monter.isVisible());
    noter('11. hors du Studio, la carte de média du tableau garde son bouton d’étape', (await page.locator('[data-geste-du-media]').count()) >= 1 && (await page.locator('[data-studio-mettre-en-production="fil"]').count()) === 0);
    await capture(page, '04-carte');
    if (await monter.isVisible()) {
      await monter.click();
      await page.waitForFunction(() => window.location.hash.startsWith('#studio/'), null, { timeout: 15000 });
      const creationId = decodeURIComponent((await page.evaluate(() => window.location.hash)).slice('#studio/'.length));
      await page.locator(`[data-studio-editeur="${creationId}"]`).waitFor({ state: 'visible', timeout: 20000 });
      noter('4. le fil reste celui de la carte', (await page.locator('[data-studio-agent-carte="c-camera"]').count()) === 1);
      let plans = 0;
      for (let i = 0; i < 25 && !plans; i++) {
        await page.waitForTimeout(1000);
        const db = baseDeDonnees({ readonly: true });
        const v = db.prepare('SELECT composition FROM studio_versions WHERE creation_id = ? ORDER BY numero DESC LIMIT 1').get(creationId);
        db.close();
        plans = JSON.parse(v.composition).pistes.filter((p) => p.genre === 'video').flatMap((p) => p.segments).filter((s) => s.genre === 'video').length;
      }
      noter('4. le plan validé est posé sur la ligne de temps', plans === 1, `${plans} plan(s) ${journal.filter((l) => /montage|plan/i.test(l)).slice(-3).join(' ').slice(0, 900)}`);
      noter('4. « Revenir à la carte » est là', (await page.locator('[data-studio-retour-carte]').count()) === 1);
      await capture(page, '04-monte');
      noter('7. un son sans pulsation ne propose pas de calage', (await page.locator('[data-studio-caler-rythme]').count()) === 0);
      /* 6. Les tiroirs de l'atelier (refonte du 31/10/2026) */
      await page.locator('[data-studio-agent] [data-studio-menu-modeles]').click();
      await page.locator('[data-studio-modele="video"]').first().waitFor({ state: 'visible', timeout: 30000 });
      const types = await page.locator('[data-studio-modele]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-studio-modele')))].length);
      noter('6. le menu des modèles du champ couvre les quatre types', types === 4, `${types} type(s)`);
      await capture(page, '06-modeles');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      /* La note se pose depuis la ligne de temps, à la tête de lecture, sans endroit sur l'image. */
      await page.locator('[data-studio-nouvelle-note]').click();
      await page.locator('[data-studio-note-texte]').fill('Ce titre est trop bas');
      await page.locator('[data-studio-note-poser]').click();
      await page.locator('[data-studio-regle] [data-studio-note]').first().waitFor({ state: 'visible', timeout: 10000 });
      noter('6. une note posée depuis la ligne de temps paraît en repère sur la règle', (await page.locator('[data-studio-regle] [data-studio-note]').count()) === 1);
      const db1 = baseDeDonnees({ readonly: true });
      const note = db1.prepare('SELECT * FROM studio_notes WHERE creation_id = ?').get(creationId);
      db1.close();
      noter('6. la note vise un instant, sans endroit sur l’image', !!note && note.x === 0 && note.y === 0 && note.texte === 'Ce titre est trop bas', `${note?.x} ; ${note?.y}`);
      noter('9. plus d’onglet Notes ni de calque sur l’image', (await page.locator('[data-studio-calque-notes], [data-studio-panneau-notes]').count()) === 0);
      await capture(page, '06-notes');
      {
        /* LES ARCHIVES : la plus récente en haut, vingt au plus ; un retour s'ajoute en tête, rien n'est effacé. */
        const archives = page.locator('[data-colonne-studio-creation] [data-studio-archive]');
        await archives.first().waitFor({ state: 'visible', timeout: 10000 });
        const avant = await archives.count();
        const numeros = await archives.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-studio-archive'))));
        noter('10. les archives listent les modifications, la plus récente en haut, vingt au plus', avant >= 1 && avant <= 20 && numeros.every((n, i) => i === 0 || numeros[i - 1] > n), numeros.join(','));
        const ancienne = page.locator('[data-colonne-studio-creation] [data-studio-archive]:not([data-studio-archive-courante])').first();
        if (await ancienne.count()) {
          const vise = Number(await ancienne.getAttribute('data-studio-archive'));
          await ancienne.hover();
          await ancienne.locator('[data-studio-revenir]').click();
          await page.waitForFunction((n) => Number(document.querySelector('[data-colonne-studio-creation] [data-studio-archive]')?.getAttribute('data-studio-archive')) > n, numeros[0], { timeout: 10000 }).catch(() => undefined);
          const db = baseDeDonnees({ readonly: true });
          const tete = db.prepare('SELECT numero, raison FROM studio_versions WHERE creation_id = ? ORDER BY numero DESC LIMIT 1').get(creationId);
          const total = db.prepare('SELECT COUNT(*) AS n FROM studio_versions WHERE creation_id = ?').get(creationId).n;
          db.close();
          noter('10. revenir à une archive ajoute une ligne en tête, sans rien effacer', tete?.raison === `retour à la version ${vise}` && total >= avant + 1, `${tete?.raison} · ${total} version(s)`);
        } else console.log('  SAUTÉ 10. une seule version : aucun retour à essayer');
        await capture(page, '10-archives');
      }
      /* TÉLÉCHARGEMENTS ET STYLE : des tiroirs, même sur ordinateur ; Téléchargements ne montre que la liste. */
      await page.locator('[data-colonne-studio-creation] [data-studio-ouvrir="fichiers"]').click();
      await page.locator('[data-studio-tiroir="fichiers"]').waitFor({ state: 'visible', timeout: 10000 });
      noter('10. Téléchargements s’ouvre en tiroir du bas, la liste seule', (await page.locator('[data-feuille-du-bas] [data-studio-tiroir="fichiers"] [data-liste-seule]').count()) === 1 && (await page.locator('[data-studio-volet-agent] [data-studio-agent]').count()) === 1);
      await capture(page, '10-telechargements');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.locator('[data-colonne-studio-creation] [data-studio-ouvrir="style"]').click();
      await page.locator('[data-studio-tiroir-style]').waitFor({ state: 'visible', timeout: 10000 });
      noter('10. Style s’ouvre en tiroir du bas', (await page.locator('[data-feuille-du-bas] [data-studio-tiroir-style]').count()) === 1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      /* LA BIBLIOTHÈQUE : l'icône du champ ouvre le tiroir ; le style choisi s'y pose en étiquette (pièce jointe). */
      await page.locator('[data-studio-agent] [data-studio-ouvrir-bibliotheque]').click();
      await page.locator('[data-studio-tiroir-bibliotheque]').waitFor({ state: 'visible', timeout: 10000 });
      const appliquer = page.locator('[data-studio-appliquer-style]').first();
      await appliquer.waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
      if (await appliquer.count()) {
        await appliquer.click();
        await page.locator('[data-studio-agent] [data-prompt-file-flag]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
        const etiquette = await page.locator('[data-studio-agent] [data-prompt-file-pastille]').first().getAttribute('data-prompt-file-etiquette').catch(() => null);
        noter('10. le style choisi se pose en étiquette dans le champ, le tiroir refermé', /^Style /.test(etiquette ?? '') && (await page.locator('[data-studio-agent] [data-prompt-file-flag][data-tag="coupe"]').count()) === 0 && (await page.locator('[data-studio-tiroir-bibliotheque]').count()) === 0, String(etiquette));
        await page.waitForTimeout(1500);
        await capture(page, '10-etiquette-de-style');
      } else console.log('  SAUTÉ 10. aucun style dans la bibliothèque de ce serveur');
      await page.locator('[data-colonne-studio-creation] [data-studio-ouvrir="medias"]').click();
      await page.locator('[data-studio-media-commun]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
      noter('6. la bibliothèque commune liste les médias du projet', (await page.locator('[data-studio-media-commun]').count()) >= 1);
      noter('9. le tiroir du bas des médias a son bouton « Filtres » en haut', (await page.locator('[data-feuille-du-bas] [data-bouton-filtres="studio-medias"]').count()) === 1);
      noter('9. chaque média se lit sur place (lecteur ou vignette)', (await page.locator('[data-studio-media-commun] video, [data-studio-media-commun] img, [data-studio-media-commun] audio, [data-studio-media-commun] [data-lecteur-son], [data-studio-media-commun] button').count()) >= 1);
      await capture(page, '06-medias');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      /* Décliner vit dans « Construction », à l'étape des formats. */
      /* LE RETOUR À LA VERSION 1 A VIDÉ LE MONTAGE : rien ne se lit, le seul bouton est éteint et le dit (01/11/2026).
         On revient à la version où le plan est posé, et il se rallume. */
      {
        const bas = page.locator('[data-studio-mettre-en-production="fil"]');
        const raison = (await bas.getAttribute('data-raison')) ?? '';
        noter('11. un montage vide éteint « Construction », qui dit ce qu’il attend', (await bas.getAttribute('data-geste-possible')) === 'non' && /première version/.test(raison), raison);
        const avecLePlan = page.locator('[data-colonne-studio-creation] [data-studio-archive]').filter({ hasText: 'plan de la carte versé' }).first();
        await avecLePlan.hover();
        await avecLePlan.locator('[data-studio-revenir]').click();
        await page.locator('[data-studio-mettre-en-production="fil"][data-geste-possible="oui"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
        noter('11. dès qu’une version se lit, le bouton du bas se rallume', (await bas.getAttribute('data-geste-possible')) === 'oui');
      }
      await page.locator('[data-studio-mettre-en-production]').first().click();
      await page.locator('[data-studio-ouvrir-export]').click();
      noter('6. la déclinaison et l’envoi vers les réseaux sont à portée', (await page.locator('[data-studio-decliner-formats]').count()) === 1 && (await page.locator('[data-studio-vers-reseaux]').count()) === 1);
      await page.locator('[data-studio-vers-reseaux]').click();
      await page.waitForTimeout(800);
      const db2 = baseDeDonnees({ readonly: true });
      const lien = db2.prepare('SELECT contenu_marketing_id AS c FROM studio_creations WHERE id = ?').get(creationId);
      const etape = lien?.c ? db2.prepare('SELECT etape FROM marketing_contenus WHERE id = ?').get(lien.c) : null;
      db2.close();
      noter('6. l’envoi crée un brouillon, jamais une publication', etape?.etape === 'brouillon' || etape?.etape === 'idee', `étape ${etape?.etape}`);
      /* 5. L'export revient à la carte */
      if (process.env.BELUGA_VERIF_EXPORT !== '0') {
        const verifierFinal = () => {
          const db = baseDeDonnees({ readonly: true });
          const c = JSON.parse(db.prepare('SELECT data FROM cards WHERE id = ?').get('c-camera').data);
          db.close();
          return c.realisation?.finaux ?? [];
        };
        await page.locator('[data-studio-decliner-formats]').click();
        let finaux = [];
        for (let i = 0; i < 120 && !finaux.length; i++) {
          await page.waitForTimeout(2000);
          finaux = verifierFinal();
        }
        noter('5. l’export prêt revient aux finaux de la carte', finaux.length >= 1, `${finaux.length} final(aux)`);
      }
    }

    /* 8. Téléphone */
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-CH', serviceWorkers: 'block' });
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const mobile = await tel.newPage();
    mobile.on('pageerror', (e) => noterErreur(e));
    await mobile.goto(`${BASE}/#studio/cre-neuve`);
    await mobile.locator('[data-studio-volet-telephone]').waitFor({ state: 'visible', timeout: 20000 });
    noter('8. au téléphone, la ligne de temps s’ouvre sous l’aperçu', await mobile.locator('[data-studio-regle]').first().isVisible());
    await capture(mobile, '08-telephone-montage');
    const hauteurs = await mobile.evaluate(() => {
      const a = document.querySelector('[data-studio-colonne-apercu]')?.getBoundingClientRect();
      const b = document.querySelector('[data-studio-volet-telephone]')?.getBoundingClientRect();
      return { apercu: a?.bottom ?? 0, volet: b?.top ?? 0, bas: b?.bottom ?? 0, vue: window.innerHeight, debord: document.documentElement.scrollWidth - window.innerWidth };
    });
    noter('8. l’aperçu ne chevauche pas le volet, et rien ne déborde', hauteurs.apercu <= hauteurs.volet + 1 && hauteurs.bas <= hauteurs.vue + 1 && hauteurs.debord <= 0, JSON.stringify(hauteurs));
    await mobile.locator('[data-studio-ouvrir="agent"]').tap();
    await mobile.locator('[data-studio-agent="conversation"]').waitFor({ state: 'visible', timeout: 10000 });
    await mobile.waitForTimeout(500);
    noter('8. la conversation s’ouvre dans la page, sans tiroir', (await mobile.locator('[data-studio-volet-telephone="agent"] [data-studio-agent="conversation"] textarea, [data-studio-volet-telephone="agent"] [data-studio-agent="conversation"] [contenteditable="true"]').count()) >= 1);
    await capture(mobile, '08-telephone-agent');
    /* MÊMES MARGES QUE L'APERÇU, RIEN DE COUPÉ À DROITE (31/10/2026, capture #4582). */
    const marges = await mobile.evaluate(() => {
      const volet = document.querySelector('[data-studio-volet-telephone="agent"]');
      const champ = volet?.querySelector('textarea, [contenteditable="true"]');
      const apercu = document.querySelector('[data-studio-rangee-apercu]')?.getBoundingClientRect();
      const cadre = champ?.closest('[data-composer], form, [data-champ-d-ecriture]')?.getBoundingClientRect();
      const coupes = [...(volet?.querySelectorAll('button') ?? [])].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 0.5;
      }).length;
      return { apercu: apercu ? [Math.round(apercu.left), Math.round(apercu.right)] : null, cadre: cadre ? [Math.round(cadre.left), Math.round(cadre.right)] : null, coupes, debord: document.documentElement.scrollWidth - window.innerWidth };
    });
    noter('8. la conversation a les marges de l’aperçu, rien n’est coupé à droite', marges.coupes === 0 && marges.debord <= 0 && marges.cadre?.[0] === marges.apercu?.[0] && marges.cadre?.[1] === marges.apercu?.[1], JSON.stringify({ coupes: marges.coupes, debord: marges.debord, apercu: marges.apercu, cadre: marges.cadre }));
    /* Le clavier ouvert (la variable que pose sa mesure) prend sur l'aperçu, jamais sur le champ. */
    await mobile.evaluate(() => document.querySelector('[data-studio-rangee-apercu]').style.setProperty('--clavier', '340px'));
    await mobile.waitForTimeout(200);
    const clavier = await mobile.evaluate(() => document.querySelector('[data-studio-colonne-apercu]')?.getBoundingClientRect().height ?? -1);
    noter('8. clavier ouvert : l’aperçu s’efface pour le champ', clavier === 0, `${clavier} px`);
    await mobile.evaluate(() => document.querySelector('[data-studio-rangee-apercu]').style.removeProperty('--clavier'));
    noter('9. au téléphone, trois onglets : Montage, Agent, Réglages', (await mobile.locator('[data-studio-onglets] [data-studio-ouvrir]').count()) === 3);
    await tel.close();

    /* 9. L'accueil d'une création sans directeur : le champ d'écriture standard, la barre d'étapes, les modes. */
    await page.goto(`${BASE}/#studio/cre-vide`);
    await page.locator('[data-studio-agent="accueil"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-studio-mode]').first().waitFor({ state: 'visible', timeout: 15000 });
    noter(
      '10. l’accueil porte le champ d’écriture standard et la barre du directeur, sans barre d’étapes',
      (await page.locator('[data-studio-agent="accueil"] [data-composer-envoi]').count()) === 1 &&
        (await page.locator('[data-studio-agent="accueil"] [data-studio-config-agent="creation"]').count()) === 1 &&
        (await page.locator('[data-studio-agent="accueil"] [data-barre-du-fil], [data-studio-agent="accueil"] [data-barre-etapes]').count()) === 0,
    );
    noter('10. les types de média sont une liste verticale, chacun avec sa photo', await page.evaluate(() => {
      const modes = [...document.querySelectorAll('[data-studio-mode]')];
      const boites = modes.map((m) => m.getBoundingClientRect());
      return modes.length === 9 && modes.every((m) => m.querySelector('[data-studio-mode-image]')) && boites.every((b, i) => i === 0 || (Math.abs(b.x - boites[0].x) < 1 && b.y > boites[i - 1].y));
    }));
    const disponible = page.locator('[data-studio-mode][data-studio-mode-disponible="oui"]').first();
    if (await disponible.count()) {
      const id = await disponible.getAttribute('data-studio-mode');
      /* Le clic ENVOIE la première demande : elle est retenue ici, aucun moteur ne part du contrôle. */
      await page.evaluate(() => {
        const envoyer = WebSocket.prototype.send;
        window.__demandesRetenues = [];
        WebSocket.prototype.send = function (donnees) {
          if (typeof donnees === 'string' && donnees.includes('"studio.assistant"')) return void window.__demandesRetenues.push(donnees);
          return envoyer.call(this, donnees);
        };
      });
      await disponible.click();
      await page.waitForTimeout(800);
      const db = baseDeDonnees({ readonly: true });
      const garde = db.prepare('SELECT value FROM meta WHERE key = ?').get('studio.mode.cre-vide');
      db.close();
      noter('9. le mode choisi se garde sur la création', garde?.value === id, `${garde?.value} au lieu de ${id}`);
      const demandes = await page.evaluate(() => window.__demandesRetenues);
      noter('10. le clic sur un type lance la conversation (première demande envoyée)', demandes.length === 1 && /Je veux réaliser/.test(demandes[0]), demandes.join(' ').slice(0, 200));
    } else {
      noter('9. un mode sans service se dit indisponible', (await page.locator('[data-studio-mode-disponible="non"]').count()) === 9);
    }
    {
      const fil = await page.locator('[data-studio-agent="accueil"]').boundingBox();
      noter('9. la conversation ne dépasse pas la largeur d’une conversation', !!fil && fil.width <= 821, `${Math.round(fil?.width ?? 0)} px`);
    }
    await capture(page, '09-accueil');

    /* 9. La colonne de gauche */
    await page.goto(`${BASE}/#en-route`);
    await page.locator('[data-agent-en-liste="c-mere"]').first().waitFor({ state: 'visible', timeout: 20000 });
    noter('9. une fille dont la mère est listée ne paraît pas à plat', (await page.locator('[data-liste-des-agents] [data-agent-en-liste="c-fille"]').count()) === 0);
    await page.locator('[data-liste-des-agents] [data-deplier-filles="c-mere"]').first().click();
    await page.locator('[data-filles-de-la-mere] [data-agent-en-liste="c-fille"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
    noter('9. la carte mère déplie sa fille', (await page.locator('[data-liste-des-agents] [data-filles-de-la-mere] [data-agent-en-liste="c-fille"]').count()) === 1);
    noter('9. plus aucun trait d’arborescence dans la colonne', (await page.locator('[data-branche-membre]').count()) === 0);
    const ligneProjet = page.locator('[data-drag-id="p-essai"]').first();
    if (await ligneProjet.count()) {
      await ligneProjet.hover();
      await page.waitForTimeout(300);
      noter('9. un « + » paraît au survol d’un projet', await page.locator('[data-nouvel-agent-projet="p-essai"]').first().isVisible());
    }
    const ligneGroupe = page.locator('[data-drag-id="p-groupe"]').first();
    if (await ligneGroupe.count()) {
      await ligneGroupe.hover();
      await page.waitForTimeout(300);
      noter('9. un « + » paraît au survol d’un projet réuni', await page.locator('[data-nouvel-agent-projet="p-groupe"]').first().isVisible());
    }
    {
      const avant = await page.evaluate(() => ({ hash: location.hash, titre: document.title, cartes: document.querySelectorAll('[data-agent-en-liste]').length }));
      /* La loupe de la colonne a disparu (06/11/2026) : Ctrl+F ouvre la recherche au centre, sans changer de page. */
      await page.keyboard.press('Control+f');
      await page.locator('[data-champ-recherche-centrale]').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('[data-champ-recherche-centrale]').fill('Essai');
      await page.waitForTimeout(800);
      const apres = await page.evaluate(() => ({ hash: location.hash, titre: document.title }));
      noter('9. Ctrl+F ouvre la recherche au centre sans changer de page', apres.hash === avant.hash && apres.titre === avant.titre, `${avant.hash} → ${apres.hash}`);
      await capture(page, '09-colonne-recherche');
    }
  } finally {
    await navigateur.close();
  }
  noter('aucune erreur de page', !erreurs.length, erreurs.slice(0, 3).join(' | '));
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications`);
  process.exit(echecs ? 1 : 0);
}

principal().catch((err) => {
  console.error(err);
  console.error(journal.slice(-30).join(''));
  process.exit(1);
});
