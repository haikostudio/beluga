#!/usr/bin/env node
/**
 * La liste des tâches tient-elle dans LE REPÈRE COMPACT, collé au champ de saisie ?
 *
 * Une fois le tour refermé, la liste ne revient plus en barre pleine largeur
 * posée à part : c'est le MÊME repère que pendant le travail qui reste en
 * place, juste au-dessus de la barre d'écriture, et un clic l'ouvre.
 *
 * On ouvre une carte dont l'agent a une liste, en écran de téléphone puis en
 * écran d'ordinateur, on fait défiler la conversation de haut en bas, et on
 * vérifie que l'en-tête ne quitte jamais l'écran, qu'il reste au-dessus de la
 * barre d'écriture, que c'est bien le repère compact, et que le pli se retient.
 *
 *   HAIKODEV_VERIF_URL=http://localhost:7099 node scripts/verif-volet-taches.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
/*
 * LA CARTE EST POSÉE PAR LE CONTRÔLE LUI-MÊME, plus jamais cherchée parmi les
 * vraies. Deux fois de suite, la carte réelle nommée ici avait été archivée
 * entre-temps et le contrôle échouait sans que rien ne soit cassé. Carte,
 * agent et message sont donc INJECTÉS dans le canal temps réel, comme le fait
 * `verif-progression-taches.mjs` : rien n'est écrit en base à part la session
 * d'essai.
 */
const CARTE = 'essai-volet-taches';
const AGENT = 'essai-volet-taches-agent';
const TITRE = 'Essai — volet des tâches';
/** La liste que l'agent est censé montrer : deux faites, une en cours, deux à faire. */
const LISTE = [
  { label: 'Lire le code existant', state: 'done' },
  { label: 'Écrire le correctif', state: 'done' },
  { label: 'Construire le projet', state: 'running' },
  { label: 'Lancer les tests', state: 'todo' },
  { label: 'Enregistrer et pousser', state: 'todo' },
];
const SHOTS = '/root/haikodev/data/verification';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  // En base, la session est rangée sous son empreinte : le cookie garde le clair.
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification volet des tâches',
  );
  db.close();
  return token;
}

async function ouvrir(navigateur, token, telephone) {
  const context = await navigateur.newContext({
    viewport: telephone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: telephone,
    hasTouch: telephone,
    deviceScaleFactor: telephone ? 3 : 1,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  // On se greffe sur le canal temps réel, sans rien remplacer de ce qui arrive
  // vraiment du serveur : `__injecter` rejoue un événement tel quel.
  await page.addInitScript(() => {
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  return { context, page, erreurs };
}

/** Le projet AFFICHÉ : c'est dans SON tableau que la carte d'essai est posée. */
async function projetAffiche(page) {
  return page.evaluate(
    () =>
      document.querySelector('[data-espace-dev]')?.getAttribute('data-espace-dev') ??
      document.querySelector('[data-drag-kind="project"]')?.getAttribute('data-drag-id') ??
      null,
  );
}

/** Pose la carte d'essai, son agent au travail et son message porteur de liste. */
async function poserLaCarte(page, projectId, { avecMessage }) {
  await page.evaluate(
    ([projectId, cardId, agentId, titre, liste, avecMessage]) => {
      window.__injecter({
        type: 'card.upsert',
        card: {
          id: cardId,
          projectId,
          title: titre,
          description: '',
          labels: [],
          column: 'running',
          // EN TÊTE de la colonne : posée en queue, la carte tombait hors du
          // premier paquet de vingt et n'était jamais rendue sur grand écran.
          position: -1,
          origin: 'user',
          run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
          excludedFromDeploy: false,
          horsTache: false,
          agentId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      window.__injecter({
        type: 'agent.upsert',
        agent: {
          id: agentId,
          projectId,
          cardId,
          role: 'task',
          title: titre,
          run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'medium', mode: 'direct' },
          status: 'running',
          todos: { done: 2, total: 5 },
          etapeEnCours: 'Construire le projet',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });
      if (!avecMessage) return;
      // La conversation de la carte ENTIÈRE, pas un simple `message.upsert` :
      // la carte n'existe pas côté serveur, il n'a donc jamais envoyé sa
      // conversation, et un message seul n'aurait rejoint aucune liste.
      window.__injecter({
        type: 'card.conversation',
        cardId,
        activeAgentId: agentId,
        messages: [
          {
            id: 'essai-volet-taches-message',
            agentId,
            role: 'assistant',
            content: 'Travail en cours.',
            steps: [{ id: 's1', label: 'Construction du projet', state: 'running' }],
            todos: liste,
            proposals: [],
            questions: [],
            downloads: [],
            attachments: [],
            streaming: true,
            plan: false,
            createdAt: Date.now(),
          },
        ],
      });
    },
    [projectId, CARTE, AGENT, TITRE, LISTE, avecMessage],
  );
}

/** Un clic sur l'en-tête du volet, posé directement sur le bon bouton. */
async function cliquerEntete(page) {
  await page.evaluate(() => {
    document.querySelector('[data-volet="taches"] button')?.click();
  });
}

async function ouvrirLaCarte(page) {
  const projectId = await projetAffiche(page);
  if (!projectId) return false;

  // La carte d'abord, sans son message : le tiroir demande sa conversation au
  // serveur en s'ouvrant, et une liste vide effacerait un message injecté trop
  // tôt. On le pose donc UNE FOIS le tiroir ouvert.
  await poserLaCarte(page, projectId, { avecMessage: false });
  await page.waitForTimeout(1800);

  /*
   * PUIS on repart d'un écran NU. L'ordre compte : l'application rouvre la
   * carte quittée la dernière fois DÈS QUE les cartes du projet lui arrivent —
   * donc juste après notre injection. Refermer avant, c'était refermer trop
   * tôt : le tiroir revenait et son voile avalait le clic sur le tableau.
   */
  for (let essai = 0; essai < 4; essai += 1) {
    const ouvert =
      (await page.locator('[role="dialog"]').count()) > 0 ||
      (await page.locator('[aria-hidden="true"][data-state="open"]').count()) > 0;
    if (!ouvert) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }

  // La colonne d'abord : sur grand écran, le tableau défile de côté et un clic
  // « en force » sur une carte hors champ ne déclenche rien.
  await page
    .locator('[data-column="running"]')
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(600);

  const carte = page.locator('article', { hasText: TITRE }).first();
  if (!(await carte.count())) return false;
  await carte.scrollIntoViewIfNeeded().catch(() => {});
  await carte.click();
  await page.waitForTimeout(2500);

  const surConversation = await surLaConversation(page);
  await poserLaCarte(page, projectId, { avecMessage: true });
  await page.waitForTimeout(1500);
  return surConversation;
}

/** L'onglet « Conversation » du tiroir : c'est là que vit le volet. */
async function surLaConversation(page) {
  const onglet = page.locator('[role="tab"]', { hasText: 'Conversation' }).first();
  if (await onglet.count()) {
    await onglet.click({ force: true });
    await page.waitForTimeout(2500);
  }
  return (await page.locator('[role="dialog"] [role="tab"]').count()) > 0;
}

async function mesurer(page) {
  return page.evaluate(() => {
    const volet = document.querySelector('[data-volet="taches"]');
    const tete = volet?.querySelector('button');
    if (!tete) return null;
    const r = tete.getBoundingClientRect();
    const zone = document.querySelector('textarea');
    const rz = zone?.getBoundingClientRect();
    return {
      haut: Math.round(r.top),
      bas: Math.round(r.bottom),
      ecran: window.innerHeight,
      visible: r.top >= 0 && r.bottom <= window.innerHeight,
      auDessusDeLaBarre: rz ? r.bottom <= rz.top + 2 : null,
      /* Le repère compact et le volet des tâches sont désormais UN SEUL
         élément : celui qui est collé au champ de saisie. */
      compact: volet.hasAttribute('data-temoin-reflexion'),
      texte: (tete.textContent || '').trim().slice(0, 90),
    };
  });
}

async function faireDefiler(page, vers) {
  await page.evaluate((v) => {
    const fils = Array.from(document.querySelectorAll('div')).filter(
      (d) => d.scrollHeight > d.clientHeight + 50 && d.className.includes('overflow-y-auto'),
    );
    const fil = fils.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (fil) fil.scrollTop = v === 'haut' ? 0 : fil.scrollHeight;
  }, vers);
  await page.waitForTimeout(700);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const token = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  for (const telephone of [true, false]) {
    const ecran = telephone ? 'téléphone' : 'ordinateur';
    const { context, page, erreurs } = await ouvrir(navigateur, token, telephone);
    const ouverte = await ouvrirLaCarte(page);
    noter(`${ecran} : la conversation de la carte s'ouvre`, ouverte);

    let mesure = await mesurer(page);
    if (!mesure) await page.screenshot({ path: `${SHOTS}/volet-${ecran}-introuvable.png` });
    noter(`${ecran} : le volet des tâches est là`, !!mesure, mesure?.texte);

    if (mesure) {
      noter(`${ecran} : l'en-tête est entièrement visible`, mesure.visible, `${mesure.haut}→${mesure.bas} / ${mesure.ecran}`);
      noter(
        `${ecran} : le volet est posé au-dessus de la barre d'écriture`,
        mesure.auDessusDeLaBarre !== false,
        mesure.auDessusDeLaBarre === null ? 'pas de barre d\'écriture ici' : '',
      );
      noter(
        `${ecran} : c'est le repère COMPACT, pas une barre pleine largeur séparée`,
        mesure.compact,
      );

      // Le pli par défaut : replié sur téléphone, déplié sur ordinateur.
      const lignes = await page.locator('ul li', { hasText: /./ }).count();
      const deplie = await page.evaluate(() => {
        return (
          document.querySelector('[data-volet="taches"] button')?.getAttribute('aria-expanded') === 'true'
        );
      });
      noter(`${ecran} : pli d'origine correct`, deplie === !telephone, deplie ? 'déplié' : 'replié', lignes);
      await page.screenshot({ path: `${SHOTS}/volet-${ecran}-origine.png` });

      // On remonte tout en haut de la conversation : le volet ne bouge pas.
      await faireDefiler(page, 'haut');
      const enHaut = await mesurer(page);
      noter(`${ecran} : en remontant la conversation, le volet reste à l'écran`, !!enHaut?.visible);
      await faireDefiler(page, 'bas');

      // On déplie / replie : le choix doit être retenu au rechargement.
      await cliquerEntete(page);
      await page.waitForTimeout(500);
      const apresClic = await page.evaluate(() => {
        return (
          document.querySelector('[data-volet="taches"] button')?.getAttribute('aria-expanded') === 'true'
        );
      });
      noter(`${ecran} : le pli se change au clic`, apresClic === telephone);
      await page.screenshot({ path: `${SHOTS}/volet-${ecran}-bascule.png` });

      const memoire = await page.evaluate(() => window.localStorage.getItem('haikodev.volet-taches.ouvert'));
      noter(`${ecran} : le choix est retenu`, memoire === (apresClic ? '1' : '0'), `retenu « ${memoire} »`);

      // Déplié, la liste reste bornée et ne mange pas la conversation.
      if (!apresClic) {
        await cliquerEntete(page);
        await page.waitForTimeout(500);
      }
      {
        const hauteur = await page.evaluate(() => {
          const l = document.querySelector('[data-volet="taches"] ul');
          return l ? Math.round(l.getBoundingClientRect().height) : null;
        });
        noter(
          `${ecran} : la liste dépliée reste bornée`,
          hauteur !== null && hauteur <= Math.min(page.viewportSize().height * 0.35, 260) + 4,
          `${hauteur} px`,
        );
      }
    }

    noter(`${ecran} : aucune erreur dans la console`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();
  }

  await navigateur.close();
  const ratés = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - ratés.length}/${resultats.length} contrôles au vert`);
  process.exit(ratés.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
