#!/usr/bin/env node
/**
 * LE VOLET DU CAHIER DES CHARGES — dans un vrai navigateur (carte « Volet dédié
 * au cahier des charges », 09/10/2026).
 *
 * Démon à soi, base jetable : aucune donnée réelle touchée, aucun quota dépensé
 * (aucun agent ne part : `maxAgents` à 0).
 *
 *  A. La carte du cahier s'ouvre dans un volet À PART : pas d'onglets, trois
 *     étapes (Création du projet → Définition du cahier des charges → Terminé),
 *     pas de barre d'écriture ni de « Valider et lancer », ni bandeau ni pause ;
 *     « Lire le cahier des charges » ouvre la rangée d'action, réglages collés ;
 *     le déroulé est COLLÉ au-dessus de la rangée, hors du fil, à 12 px au plus
 *     du bouton : réduit à ses ronds quand on remonte, déplié en bas.
 *  B. Une carte ORDINAIRE garde ses onglets et sa barre d'écriture.
 *
 * LES ONGLETS D'UNE CARTE, DEPUIS LA REFONTE DU 11/10/2026 : la carte est une
 * page (`[data-page-carte]`) et ses onglets sont des LIGNES de la colonne de
 * gauche (`[data-options-de-carte] [data-onglet-carte="chat|comments|billing|
 * github"]`), plus une rangée posée sous le titre. « Pas d'onglets » se lit
 * donc là : le menu de la tâche du cahier est monté dans la colonne et n'en
 * porte aucun ; celui d'une carte ordinaire porte les quatre.
 *  C. L'export : le menu du volet propose PDF et Texte, le PDF se télécharge ;
 *     l'adresse rend un vrai PDF, le texte, et 404 pour un projet sans cahier.
 *  D. La configuration du projet porte le bouton « Cahier des charges » ; un
 *     projet sans document ne le porte pas.
 *  E. Le passage de la carte dans « Archivé » referme son volet.
 *  F. AGENT AU TRAVAIL (22/10/2026) : la barre d'écriture revient, avec
 *     « Suspendre » et « Lire le cahier des charges » au-dessus du champ ; une
 *     QUESTION EN ATTENTE la retire, le panneau de décision garde la main
 *     (`barreDEcritureDuVolet`). Ordinateur (1280 px) et téléphone (390 px).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-volet-du-cahier.mjs
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_VOLET_CAHIER_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-cahier';
const VIDE = 'p-sans-cahier';
const CAHIER = crypto.randomUUID();
const ORDINAIRE = crypto.randomUUID();
const AU_TRAVAIL = crypto.randomUUID();
const AGENT_AU_TRAVAIL = crypto.randomUUID();

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-volet-cahier-',
  port: PORT,
  depot: false,
  signaux: true,
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(JETON), t, t + 3600_000, 'vérification du volet du cahier');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const [id, nom] of [[PROJET, 'Atelier Cahier'], [VIDE, 'Atelier Sans Cahier']]) {
    const dossier = path.join(PROJETS, id);
    fs.mkdirSync(path.join(dossier, 'docs'), { recursive: true });
    const projet = { id, name: nom, path: dossier, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: t, updatedAt: t };
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(id, nom, dossier, JSON.stringify(projet), t, t);
  }
  fs.writeFileSync(
    path.join(PROJETS, PROJET, 'docs/cahier-des-charges.md'),
    '# Cahier des charges — Atelier Cahier\n\n## Vision\nRéserver des courts de tennis.\n\n## Technologies\n| Couche | Choix |\n| --- | --- |\n| Base | PostgreSQL |\n\n## Inspiration\nà voir\n',
  );
  const cahier = { faites: 6, total: 24, phase: 'technologies', restants: ['Paiement'], majA: t };
  const carte = (id, titre, data) =>
    db
      .prepare(
        `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description)
         VALUES (?, ?, 'planned', ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, PROJET, id === CAHIER ? 1 : 2, titre, JSON.stringify(data), t, t, 'Carte posée par un contrôle automatique.');
  carte(CAHIER, 'Cahier des charges', { cahierDesCharges: cahier });
  carte(ORDINAIRE, 'Carte ordinaire', {});
  /* La carte ordinaire a déjà échangé : sans message, elle montrerait sa configuration. */
  const agent = crypto.randomUUID();
  db.prepare('UPDATE cards SET agent_id = ? WHERE id = ?').run(agent, ORDINAIRE);
  const fiche = { id: agent, projectId: PROJET, cardId: ORDINAIRE, role: 'task', title: 'Carte ordinaire', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'done', createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(agent, PROJET, ORDINAIRE, 'task', 'done', JSON.stringify(fiche), t, t);
  const message = { id: crypto.randomUUID(), agentId: agent, role: 'user', content: 'Carte d’essai : ne rien exécuter.', steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], streaming: false, createdAt: t - 1000 };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(message.id, agent, 'user', JSON.stringify(message), message.createdAt);
  db.close();
}

/*
 * UN AGENT QUI A L'AIR DE TRAVAILLER, sans processus derrière : la veille des
 * tours bloqués le referme vite, donc le décor se REPOSE juste avant chaque
 * mesure (même raison que `verif-arret-carte.mjs`). `question` ajoute une
 * question ask_user restée sans réponse.
 */
function reposerAgentAuTravail({ question = false } = {}) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const donnees = { cahierDesCharges: { faites: 6, total: 24, phase: 'technologies', restants: ['Paiement'], majA: t } };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 3, 'Cahier au travail', ?, ?, ?, 'Carte posée par un contrôle automatique.', ?)
     ON CONFLICT(id) DO UPDATE SET column_key = excluded.column_key, data = excluded.data, updated_at = excluded.updated_at, agent_id = excluded.agent_id`,
  ).run(AU_TRAVAIL, PROJET, JSON.stringify(donnees), t, t, AGENT_AU_TRAVAIL);
  const fiche = { id: AGENT_AU_TRAVAIL, projectId: PROJET, cardId: AU_TRAVAIL, role: 'cadrage', title: 'Cahier au travail', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', startedAt: t, tourVivantDepuis: t, createdAt: t, updatedAt: t };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT_AU_TRAVAIL, PROJET, AU_TRAVAIL, 'cadrage', 'running', JSON.stringify(fiche), t, t);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(AGENT_AU_TRAVAIL);
  const message = (role, content, questions, at) => {
    const m = { id: crypto.randomUUID(), agentId: AGENT_AU_TRAVAIL, role, content, steps: [], todos: [], proposals: [], questions, downloads: [], attachments: [], streaming: false, createdAt: at };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, AGENT_AU_TRAVAIL, role, JSON.stringify(m), at);
  };
  message('user', 'Carte d’essai : ne rien exécuter.', [], t - 2000);
  if (question) {
    message('assistant', '', [{ id: 'q-essai', question: 'Quel moyen de paiement ?', kind: 'single', options: [{ id: 'a', label: 'Carte' }, { id: 'b', label: 'Virement' }], allowFreeText: true, answerAttachments: [], cancelled: false }], t - 1000);
  }
  db.close();
}

async function ouvrir(navigateur) {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs };
}
const attendre = async (page, condition, limite = 10000) => {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};
const visibles = (page, selecteur) => page.locator(`${selecteur}:visible`).count();
/* La colonne de gauche : dans une tâche, elle porte ses options (ordinateur). */
const COLONNE = 'aside[data-zone="gauche"]';

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: `beluga_session=${JETON}` } });
    const id = crypto.randomUUID();
    w.on('open', () => w.send(JSON.stringify({ id, cmd })));
    w.on('message', (brut) => {
      const ev = JSON.parse(String(brut));
      if (ev.type === 'ack' && ev.id === id) {
        w.close();
        ev.ok === false ? reject(new Error(ev.error)) : resolve(ev.data);
      }
    });
    w.on('error', reject);
  });
}

async function voletDuCahier(navigateur) {
  const { contexte, page, erreurs } = await ouvrir(navigateur);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${CAHIER}`, { waitUntil: 'domcontentloaded' });
  const ouvert = await attendre(page, async () => (await visibles(page, `[data-volet-cahier="${CAHIER}"]`)) > 0, 30000);
  noter('A. la carte du cahier s’ouvre sur son volet', ouvert);

  /* A. Le volet à part. Ses options sont montées dans la colonne de gauche — sans
     quoi « aucun onglet » ne prouverait rien — et n'y portent aucun onglet. */
  const optionsMontees = await attendre(page, async () => (await page.locator(`${COLONNE} [data-options-de-carte="${CAHIER}"]`).count()) > 0);
  noter(
    'A. aucune rangée d’onglets',
    optionsMontees && (await visibles(page, '[data-onglet-carte]')) === 0 && (await visibles(page, '[data-barre-onglets]')) === 0,
    optionsMontees ? '' : 'les options de la tâche ne sont pas montées dans la colonne',
  );
  const etapes = await page.locator('[data-barre-etapes]:visible [data-segment]').evaluateAll((els) => els.map((e) => e.getAttribute('data-segment')));
  noter('A. trois étapes : création, cahier, terminé', etapes.join(',') === 'creation,cahier,termine', etapes.join(','));
  const libelles = await page.locator('[data-barre-etapes]:visible [data-segment]').allInnerTexts();
  noter('A. leurs noms', libelles.join(' | ') === 'Création du projet | Définition du cahier des charges | Terminé', libelles.join(' | '));
  noter('A. pas de barre d’écriture', (await visibles(page, '[data-composer]')) === 0);
  noter('A. pas de « Valider et lancer »', (await page.getByText('Lancer et valider').count()) === 0);
  /* PLUS DE BANDEAU NI DE PAUSE (21/10/2026) ; PLUS DE RANGÉE VIDE (22/10/2026) :
     « Lire le cahier des charges » est le premier bouton de la rangée d'action,
     les réglages collés à sa droite, sur une seule ligne. */
  noter(
    'A. plus de bandeau, de compteur, de jauge ni de pause',
    (await page.locator('[data-cahier-des-charges], [data-cahier-avancement], [data-cahier-jauge], [data-cahier-pause], [data-cahier-reprendre]').count()) === 0,
  );
  /* LE DÉROULÉ DU CAHIER (22/10/2026), comme le chemin du tournage : phases,
     phase en cours, « Question 7 sur 24 », suivante — COLLÉ EN BAS, hors du fil
     qui défile, juste au-dessus de la rangée d'action. */
  const deroule = await page.evaluate(() => {
    const chemin = document.querySelector('[data-chemin-cahier]');
    if (!chemin) return { erreur: 'absent' };
    const etats = [...chemin.querySelectorAll('[data-etape-cahier]')].map((e) => `${e.getAttribute('data-etape-cahier')}:${e.getAttribute('data-etat')}`);
    const fil = document.querySelector('[data-fil="parcours"]');
    const barre = [...document.querySelectorAll('[data-volet-cahier] [data-barre-cahier]')].find((e) => e.getBoundingClientRect().height > 0);
    return {
      etats: etats.join(','),
      compte: chemin.querySelector('[data-compte-cahier]')?.textContent,
      suivante: chemin.querySelector('[data-cahier-suivante]')?.textContent,
      horsDuFil: !fil.contains(chemin),
      sousLeFil: Math.round(chemin.getBoundingClientRect().top - fil.getBoundingClientRect().bottom),
      auDessusDeLaBarre: !!barre && chemin.getBoundingClientRect().bottom <= barre.getBoundingClientRect().top + 1,
    };
  });
  noter(
    'A. le déroulé du cahier : phases, « Question 7 sur 24 », la suivante, collé hors du fil au-dessus de la rangée',
    deroule.etats === 'vision:fait,interfaces:fait,mecanismes:fait,technologies:encours,hebergement:avenir,identite:avenir,relecture:avenir' &&
      /Technologies · Question 7 sur 24/.test(deroule.compte ?? '') &&
      /Ensuite : Hébergement/.test(deroule.suivante ?? '') &&
      deroule.horsDuFil && deroule.sousLeFil >= 0 && deroule.auDessusDeLaBarre,
    JSON.stringify(deroule),
  );
  noter('A. plus de lecture en fin de fil', (await page.locator('[data-fil="parcours"] [data-lecture-du-cahier="cahier"]').count()) === 0);
  /* LES TRAITS ENTRE LES RONDS SE VOIENT (capture #8fcf) : un par intervalle,
     d'une largeur réelle, peints en `--faint` (à venir) ou `--text` (fait) —
     jamais `--border`, invisible dans onze palettes sur douze. */
  {
    const traits = await page.evaluate(() => {
      const fondDe = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        }
        return 'rgb(0, 0, 0)';
      };
      const chemin = document.querySelector('[data-chemin-cahier]');
      const liste = [...(chemin?.querySelectorAll('[data-trait-cahier]') ?? [])];
      return {
        nombre: liste.length,
        ronds: chemin?.querySelectorAll('[data-etape-cahier]').length ?? 0,
        largeurs: liste.map((t) => Math.round(t.getBoundingClientRect().width)),
        visibles: liste.every((t) => {
          const c = getComputedStyle(t).backgroundColor;
          const alpha = Number((c.match(/rgba?\(([^)]+)\)/)?.[1].split(',')[3] ?? '1').trim());
          return c !== fondDe(t.parentElement) && alpha >= 0.5;
        }),
        couleurs: [...new Set(liste.map((t) => getComputedStyle(t).backgroundColor))],
      };
    });
    noter(
      'A. un trait visible relie chaque rond du déroulé',
      traits.nombre === traits.ronds - 1 && traits.largeurs.every((l) => l >= 8) && traits.visibles,
      JSON.stringify(traits),
    );
  }
  /* SEUL LE NOM DE LA PHASE EN COURS S'ÉCRIT, MÊME SUR GRAND ÉCRAN (22/10/2026) :
     les autres gardent leur rond, et leur nom paraît en bulle au survol. */
  {
    const noms = await page.evaluate(() =>
      [...document.querySelectorAll('[data-chemin-cahier] [data-etape-cahier]')].filter((e) => {
        const nom = e.querySelector('span span:last-child');
        return nom && nom.getBoundingClientRect().width > 0;
      }).map((e) => e.getAttribute('data-etape-cahier')),
    );
    noter('A. ordinateur : le déroulé ne nomme que la phase en cours', noms.join(',') === 'technologies', noms.join(','));
    await page.locator('[data-chemin-cahier] [data-etape-cahier="vision"] [title]').first().hover();
    const bulle = await page.locator('[role="tooltip"][data-infobulle]').first().textContent({ timeout: 3000 }).catch(() => null);
    noter('A. ordinateur : le rond d’une phase faite donne son nom au survol', /Vision/.test(bulle ?? ''), String(bulle));
    await page.screenshot({ path: '/tmp/verif-volet-cahier/ordinateur-deroule.png' });
    await page.mouse.move(5, 5);
  }
  for (const [format, taille] of [
    ['ordinateur', { width: 1440, height: 900 }],
    ['téléphone', { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(taille);
    await page.waitForTimeout(400);
    const rangee = await page.evaluate(() => {
      const barres = [...document.querySelectorAll('[data-volet-cahier] [data-barre-cahier]')].filter((e) => e.getBoundingClientRect().height > 0);
      const barre = barres[0];
      const lire = barre?.querySelector('[data-cahier-lire]')?.getBoundingClientRect();
      const icone = barre?.querySelector('[data-reglages-du-lancement]')?.getBoundingClientRect();
      if (!barre || !lire || !icone) return { erreur: `rangée ${!!barre}, lire ${!!lire}, réglages ${!!icone}` };
      const largeur = barre.getBoundingClientRect().width;
      return {
        ecart: Math.round(icone.left - lire.right),
        memeLigne: Math.abs(icone.top - lire.top) <= 1,
        large: lire.width + icone.width > largeur * 0.9,
        hauteur: Math.round(barre.getBoundingClientRect().height),
      };
    });
    noter(
      `A. ${format} : « Lire » en tête de rangée, réglages collés à droite, une seule ligne`,
      !rangee.erreur && rangee.ecart >= 0 && rangee.ecart <= 2 && rangee.memeLigne && rangee.large &&
        /* Une seule ligne : 36 px de boutons sur ordinateur, 43 px sur téléphone
           (boutons agrandis de 20 % sous 640 px). */
        rangee.hauteur <= (format === 'téléphone' ? 46 : 40),
      JSON.stringify(rangee),
    );
  }
  {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const noms = await page.evaluate(() =>
      [...document.querySelectorAll('[data-chemin-cahier] [data-etape-cahier]')].filter((e) => {
        const nom = e.querySelector('span span:last-child');
        return nom && nom.getBoundingClientRect().width > 0;
      }).map((e) => e.getAttribute('data-etape-cahier')),
    );
    const deborde = await page.evaluate(() => {
      const c = document.querySelector('[data-chemin-cahier]');
      return c ? c.scrollWidth > c.clientWidth + 1 : true;
    });
    noter('A. téléphone : le déroulé ne nomme que la phase en cours, sans déborder', noms.join(',') === 'technologies' && !deborde, `${noms.join(',')} déborde=${deborde}`);
    /* ÉCART DÉROULÉ → BOUTON ET VIDE SOUS LE BOUTON (22/10/2026). */
    const bas = await page.evaluate(() => {
      const chemin = document.querySelector('[data-chemin-cahier] > div');
      const lire = [...document.querySelectorAll('[data-volet-cahier] [data-cahier-lire]')].find((e) => e.getBoundingClientRect().height > 0);
      const volet = document.querySelector('[data-volet-cahier]');
      if (!chemin || !lire || !volet) return { erreur: `${!!chemin} ${!!lire} ${!!volet}` };
      return {
        ecart: Math.round(lire.getBoundingClientRect().top - chemin.getBoundingClientRect().bottom),
        dessous: Math.round(volet.getBoundingClientRect().bottom - lire.getBoundingClientRect().bottom),
      };
    });
    noter('A. téléphone : déroulé à 12 px au plus du bouton, 8 px au plus dessous', !bas.erreur && bas.ecart >= 0 && bas.ecart <= 12 && bas.dessous <= 8, JSON.stringify(bas));
    /* RÉDUIT QUAND ON REMONTE, DÉPLIÉ EN BAS : un fil allongé pour l'essai. */
    await page.evaluate(() => {
      const fil = document.querySelector('[data-fil="parcours"]');
      const cale = document.createElement('div');
      cale.setAttribute('data-cale-d-essai', '');
      cale.style.height = '2400px';
      cale.style.flexShrink = '0';
      fil.insertBefore(cale, fil.firstChild);
    });
    const etatDuDeroule = () =>
      page.evaluate(() => {
        const c = document.querySelector('[data-chemin-cahier]');
        const compte = c?.querySelector('[data-compte-cahier]');
        const rond = c?.querySelector('[data-etape-cahier="technologies"]');
        return {
          reduit: c?.hasAttribute('data-chemin-reduit') ?? null,
          compteVisible: !!compte && compte.getBoundingClientRect().height > 4 && Number(getComputedStyle(compte.closest('.grid')).opacity) > 0.9,
          rondVisible: !!rond && rond.getBoundingClientRect().height > 0,
        };
      });
    await page.waitForTimeout(300);
    {
      const boite = await page.locator('[data-fil="parcours"]').boundingBox();
      await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
      for (let i = 0; i < 8; i += 1) await page.mouse.wheel(0, -500);
    }
    await page.waitForTimeout(500);
    console.log('  …  fil remonté :', await page.locator('[data-fil="parcours"]').evaluate((f) => `${f.scrollTop}/${f.scrollHeight}/${f.clientHeight}`));
    const enHaut = await etatDuDeroule();
    noter('A. on remonte : le déroulé se réduit à ses ronds, toujours visible', enHaut.reduit === true && enHaut.rondVisible && !enHaut.compteVisible, JSON.stringify(enHaut));
    await page.screenshot({ path: '/tmp/verif-volet-cahier/telephone-remonte.png' });
    await page.locator('[data-fil="parcours"]').evaluate((f) => f.scrollTo({ top: f.scrollHeight }));
    await page.waitForTimeout(600);
    const enBas = await etatDuDeroule();
    const resteEnBas = await page.locator('[data-fil="parcours"]').evaluate((f) => Math.round(f.scrollHeight - f.scrollTop - f.clientHeight));
    noter('A. revenu en bas : le déroulé se déplie, « Question n sur total » visible, sans osciller', enBas.reduit === false && enBas.compteVisible && resteEnBas <= 24, `${JSON.stringify(enBas)} reste=${resteEnBas}`);
    await page.waitForTimeout(600);
    noter('A. le déroulé reste déplié en bas', (await etatDuDeroule()).reduit === false);
    await page.evaluate(() => document.querySelector('[data-cale-d-essai]')?.remove());
    fs.mkdirSync('/tmp/verif-volet-cahier', { recursive: true });
    await page.screenshot({ path: '/tmp/verif-volet-cahier/telephone.png' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  /* C. L'export depuis le volet. */
  await page.locator('[data-cahier-exporter]:visible').first().click();
  const pdf = page.locator('[data-cahier-export="pdf"]');
  noter('C. le menu propose PDF et Texte', (await pdf.isVisible().catch(() => false)) && (await page.locator('[data-cahier-export="md"]').isVisible()));
  const [telecharge] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), pdf.click()]);
  const nom = telecharge?.suggestedFilename() ?? '';
  const chemin = telecharge ? await telecharge.path() : null;
  const debut = chemin ? fs.readFileSync(chemin).subarray(0, 5).toString() : '';
  noter('C. le PDF se télécharge, sous le nom du projet', nom === 'Cahier des charges — Atelier Cahier.pdf' && debut === '%PDF-', `${nom} ${debut}`);

  /* La lecture : le tiroir porte aussi l'export. */
  await page.locator('[data-cahier-lire]:visible').click();
  const tiroir = await attendre(page, async () => (await visibles(page, `[data-tiroir-cahier="${PROJET}"] [data-cahier-partie]`)) > 0);
  noter('A. « Lire » ouvre le document, avec ses parties', tiroir);
  noter('C. le tiroir de lecture porte le menu d’export', (await visibles(page, `[data-tiroir-cahier="${PROJET}"] [data-cahier-exporter]`)) > 0);
  await page.keyboard.press('Escape');

  /* E. Le passage dans « Archivé » referme le volet. */
  await page.waitForTimeout(500);
  await commande({ type: 'card.move', id: CAHIER, column: 'archived' });
  const ferme = await attendre(page, async () => (await visibles(page, `[data-volet-cahier="${CAHIER}"]`)) === 0);
  noter('E. l’archivage de la carte referme son volet', ferme);
  noter('aucune erreur de page', !erreurs.length, erreurs.join(' | '));
  await contexte.close();
}

async function carteOrdinaire(navigateur) {
  const { contexte, page } = await ouvrir(navigateur);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${ORDINAIRE}`, { waitUntil: 'domcontentloaded' });
  const onglets = `${COLONNE} [data-options-de-carte="${ORDINAIRE}"] [data-onglet-carte]`;
  await attendre(page, async () => (await visibles(page, onglets)) > 0, 30000);
  const cles = await page.locator(`${onglets}:visible`).evaluateAll((els) => els.map((e) => e.getAttribute('data-onglet-carte')));
  noter('B. une carte ordinaire garde ses onglets', cles.join(',') === 'chat,comments,billing,github', cles.join(',') || 'aucun');
  noter('B. …et sa barre d’écriture', (await visibles(page, '[data-composer]')) > 0);
  noter('B. …et sa barre d’étapes habituelle', (await page.locator('[data-barre-etapes]:visible [data-segment="demande"]').count()) > 0);
  await contexte.close();
}

async function configuration(navigateur) {
  const { contexte, page } = await ouvrir(navigateur);
  await page.goto(`${BASE}/#projet/${PROJET}/config/general`, { waitUntil: 'domcontentloaded' });
  const bouton = await attendre(page, async () => (await visibles(page, `[data-cahier-du-projet="${PROJET}"]`)) > 0, 30000);
  noter('D. la configuration du projet porte « Cahier des charges »', bouton);
  if (bouton) {
    await page.locator(`[data-cahier-du-projet="${PROJET}"]`).click();
    noter('D. il ouvre le document', await attendre(page, async () => (await visibles(page, `[data-tiroir-cahier="${PROJET}"] [data-cahier-partie]`)) > 0));
  }
  await page.goto(`${BASE}/#projet/${VIDE}/config/general`, { waitUntil: 'domcontentloaded' });
  await attendre(page, async () => (await visibles(page, '[data-rubrique-contenu="general"]')) > 0, 30000);
  await page.waitForTimeout(1000);
  noter('D. un projet sans cahier ne porte pas le bouton', (await visibles(page, '[data-cahier-du-projet]')) === 0);

  /* C. L'adresse d'export, directement. */
  const r = (format, projet = PROJET) => page.request.get(`${BASE}/api/projets/cahier-des-charges?projet=${projet}&format=${format}`);
  const pdf = await r('pdf');
  noter('C. l’adresse rend un PDF', pdf.status() === 200 && (pdf.headers()['content-type'] ?? '').startsWith('application/pdf'));
  const md = await r('md');
  noter('C. …et le texte', md.status() === 200 && (await md.text()).includes('## Vision'));
  noter('C. …et 404 sans document', (await r('pdf', VIDE)).status() === 404);
  await contexte.close();
}

async function agentAuTravail(navigateur) {
  for (const [nom, largeur, hauteur] of [['ordinateur', 1280, 800], ['téléphone', 390, 844]]) {
    const { contexte, page, erreurs } = await ouvrir(navigateur);
    await page.setViewportSize({ width: largeur, height: hauteur });
    reposerAgentAuTravail();
    await page.goto(`${BASE}/#projet/${PROJET}/tache/${AU_TRAVAIL}`, { waitUntil: 'domcontentloaded' });
    const barre = await attendre(page, async () => (await visibles(page, '[data-composer]')) > 0, 30000);
    noter(`F. ${nom} : agent au travail, la barre d’écriture revient`, barre);
    noter(`F. ${nom} : …avec « Suspendre »`, (await visibles(page, '[data-suspendre-agent]')) === 1);
    const ordre = await page.evaluate(() => {
      const lire = document.querySelector('[data-barre-cahier]');
      const champ = document.querySelector('[data-composer] textarea');
      return !!lire && !!champ && lire.getBoundingClientRect().bottom <= champ.getBoundingClientRect().top + 1;
    });
    noter(`F. ${nom} : « Lire le cahier des charges » au-dessus du champ, une seule fois`, ordre && (await visibles(page, '[data-barre-cahier]')) === 1);
    noter(`F. ${nom} : un seul bouton de réglages`, (await visibles(page, '[data-barre-cahier] ~ * [aria-label*="églages"], [data-composer] [aria-label*="églages"]')) <= 1);
    /* Le témoin au-dessus du champ ne nomme plus moteur ni modèle (26/10/2026) :
       seule la carte du tableau garde `EtiquetteDuModele`. */
    noter(`F. ${nom} : le témoin du champ ne nomme pas moteur ni modèle`, (await visibles(page, '[data-temoin-reflexion] [data-etiquette-modele]')) === 0);
    if (largeur > 1000) {
      const tableau = await page.context().newPage();
      reposerAgentAuTravail();
      await tableau.goto(`${BASE}/#projet/${PROJET}`, { waitUntil: 'domcontentloaded' });
      const surLaCarte = await attendre(tableau, async () => (await visibles(tableau, '[data-etiquette-modele]')) > 0, 20000);
      const texte = surLaCarte ? await tableau.locator('[data-etiquette-modele]:visible').first().getAttribute('data-etiquette-modele') : null;
      if (!surLaCarte) await tableau.screenshot({ path: '/tmp/verif-volet-cahier/tableau-etiquette.png' }).catch(() => {});
      noter('F. tableau : la carte au travail nomme moteur et modèle', /claude/i.test(texte ?? ''), texte ?? 'absent');
      await tableau.close();
    }
    reposerAgentAuTravail({ question: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const panneau = await attendre(page, async () => (await visibles(page, `[data-volet-cahier="${AU_TRAVAIL}"]`)) > 0, 30000);
    noter(`F. ${nom} : question en attente, le panneau de décision garde la main`, panneau && (await visibles(page, '[data-composer]')) === 0);
    noter(`F. ${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.join(' | '));
    await contexte.close();
  }
}

let navigateur;
let code = 1;
try {
  if (!(await attendrePort())) {
    console.error(journal.join(''));
    throw new Error('le démon d’essai ne démarre pas');
  }
  poserLeDecor();
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  await carteOrdinaire(navigateur);
  await configuration(navigateur);
  await voletDuCahier(navigateur);
  await agentAuTravail(navigateur);
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  code = echecs.length ? 1 : 0;
} catch (err) {
  console.error(err);
} finally {
  await navigateur?.close().catch(() => {});
  nettoyer();
  process.exit(code);
}
