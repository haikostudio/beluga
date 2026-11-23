#!/usr/bin/env node
/**
 * LES AGENTS DE CONFIGURATION ET LEUR PROCESSUS, À L'ÉCRAN (refonte du
 * 29/09/2026), dans un VRAI navigateur :
 *
 *  - le tiroir du bandeau « Mise en production » n'a plus d'onglets ni de
 *    flèche : l'interrupteur, puis À SA DROITE un bouton de réglages qui ouvre
 *    la rubrique « Mise en production » des réglages du projet ; avec un
 *    processus, sa page dit POURQUOI en deux phrases au plus (le résumé, plus
 *    le récit de l'agent), liste les étapes en clair, et range les commandes
 *    derrière « Détail technique » ;
 *  - le tiroir de l'agent, ouvert depuis la rubrique, est PAR-DESSUS la fenêtre
 *    des réglages — jugé à l'écran (ce qu'on touche en son milieu), pas dans
 *    l'arbre ;
 *  - dans cette rubrique, en TROIS TEMPS (11/10/2026), les mêmes que la
 *    rubrique « Déploiement » : OÙ J'EN SUIS (l'interrupteur, une phrase
 *    d'état, trois repères, et le SEUL bouton de l'agent), CE QUI SE PASSERA AU
 *    CLIC (les étapes en titres simples, puis pourquoi ce processus, en deux
 *    phrases au plus), LES RÉGLAGES (l'adresse, le reste derrière « Réglages
 *    avancés ») ;
 *  - éteinte, les deux derniers temps sont masqués et le bouton de l'agent est
 *    éteint, avec sa phrase ; allumée, le processus absent se dit, et le
 *    bouton « Initialiser » ouvre un TIROIR où un second bouton lance le
 *    premier tour (`procedure.tour`, retenu ici avant de partir : aucun moteur
 *    n'est appelé) — rien ne part à la simple visite ;
 *  - chaque bouton de la rubrique a un FOND (jamais transparent) ;
 *  - un projet AVEC processus et agent retenu : les étapes se lisent d'emblée,
 *    les commandes, la date et le lieu déclaré par l'agent derrière « Détail
 *    technique », fermé par défaut ; l'adresse et la branche ne sont plus
 *    répétées ; le bouton dit « Reconfigurer » et ouvre la conversation dans un
 *    tiroir, sans relancer aucun tour ; le journal « Étude de l'agent » a
 *    disparu, même pour une étude de quatorze paragraphes ;
 *  - un réglage changé depuis l'écriture fait dire « à revérifier », dans la
 *    phrase d'état, sans rien avoir à ouvrir ;
 *  - la rubrique « Déploiement » montre le déroulé commun, puis son propre
 *    agent ; un champ rangé derrière « Réglages avancés » part quand même avec
 *    « Enregistrer », qui ne touche JAMAIS aux processus ni aux agents ;
 *  - PENDANT L'INITIALISATION : la zone droite du bandeau dit son état, une
 *    vignette spéciale paraît en tête de « En cours », le bouton de la rubrique dit
 *    « Agent au travail… » avec sa roue, et le clic sur la vignette ouvre le
 *    TIROIR de l'agent SANS fenêtre de réglages ; l'agent fini, elle quitte le
 *    tableau et passe dans « Archiver » des Tableaux de bord, sans point bleu
 *    (06/10/2026) ;
 *  - aucune erreur JavaScript.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_INITPROD_PORT`), plafond d'agents à zéro.
 *
 *   node scripts/verif-initialisation-production.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_INITPROD_PORT || 7219);
/* L'écran peut être servi par le serveur de développement (`HAIKO_INITPROD_URL`), branché sur ce démon d'essai par `BELUGA_DEMON_PORT`. */
const BASE = process.env.HAIKO_INITPROD_URL || `http://127.0.0.1:${PORT}`;
const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-initialisation-production-',
  port: PORT,
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 200)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-initprod';

function poserProjet(miseEnProduction, autres = {}) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const projet = {
    id: PROJET_ID,
    name: 'Essai initialisation',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    /* Un projet qui déployait déjà avant que le déploiement ne demande son
       initialisation (migration 117) : son déroulé commun reste en service. */
    deploiement: { commande: 'npm run build', service: 'autoproject-essai', herite: true },
    miseEnProduction,
    ...autres,
    createdAt: t,
    updatedAt: t,
  };
  db.prepare('DELETE FROM projects').run();
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  db.close();
}

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification de l’initialisation de la production',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.close();
  poserProjet({});
}

const AGENT_ID = 'a-config-prod';
const MESSAGE_AGENT = 'La production tourne chez l’hébergeur : j’ai préparé le script de déploiement.';

/** L'agent de configuration retenu sur le projet, et un message déjà échangé. */
function poserAgentDeConfiguration(etat = { status: 'done' }) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const agent = {
    id: AGENT_ID, projectId: PROJET_ID, role: 'deploy', title: 'Configuration de la mise en production',
    run: { engine: 'claude', thinking: 'none' }, createdAt: t, updatedAt: t, ...etat,
  };
  db.prepare('DELETE FROM agents WHERE id = ?').run(AGENT_ID);
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, NULL, 'deploy', ?, ?, ?, ?)`,
  ).run(AGENT_ID, PROJET_ID, agent.status, JSON.stringify(agent), t, t);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(AGENT_ID);
  const message = {
    id: 'm-config-prod', agentId: AGENT_ID, role: 'assistant', content: MESSAGE_AGENT, steps: [], todos: [],
    proposals: [], questions: [], downloads: [], attachments: [], streaming: false, createdAt: t,
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, AGENT_ID, 'assistant', JSON.stringify(message), t,
  );
  db.close();
}

const ETAPES = [
  { libelle: 'Déclencher le déploiement GitHub', commande: 'gh workflow run deploy.yml --ref main', delaiS: 60 },
  { libelle: 'Contrôler le site', commande: 'curl -fsS https://exemple.test', delaiS: 20 },
];

async function ouvrir(navigateur) {
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.addInitScript(() => {
    /* Les tours d'agent et les mises en ligne sont RETENUS avant de partir ;
       le reste passe, et tout est noté. */
    window.__envoyes = [];
    const envoyer = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      const texte = String(donnees);
      try {
        window.__envoyes.push(JSON.parse(texte));
      } catch {
        /* battement */
      }
      if (texte.includes('"procedure.tour"') || texte.includes('"deploy.start"')) return;
      return envoyer.call(this, donnees);
    };
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);
  const onglet = page.getByRole('button', { name: /^Tableau$/ });
  if (await onglet.count()) {
    await onglet.first().click();
    await page.waitForTimeout(1_500);
  }
  await page.waitForSelector('[data-bandeau-production]', { timeout: 30_000 });
  return { contexte, page, erreurs };
}

const envoyes = (page, type) => page.evaluate((type) => window.__envoyes.filter((m) => m?.cmd?.type === type || m?.type === type), type);

/** LE PREMIER TEMPS D'UNE RUBRIQUE : son état, sa phrase, ses trois repères. */
const ouJEnSuis = (page, cible) =>
  page.locator(`[data-ou-j-en-suis="${cible}"]`).evaluate((bloc) => ({
    etat: bloc.getAttribute('data-etat-de-l-etape'),
    phrase: bloc.querySelector('[data-phrase-d-etat]')?.textContent?.trim() ?? '',
    reperes: [...bloc.querySelectorAll('[data-repere]')]
      .map((repere) => `${repere.getAttribute('data-repere')}:${repere.getAttribute('data-repere-etat')}`)
      .join(' '),
  }));

/** Le bouton d'un repli de la rubrique : « reglages-avances » ou « detail-technique ». */
const repli = (page, rubrique, repere) => page.locator(`[data-rubrique-contenu="${rubrique}"] [data-${repere}]`);

/**
 * LE TIROIR DE L'AGENT EST-IL VRAIMENT AU-DESSUS ? Sa présence dans la page ne
 * le dit pas : ouvert depuis la fenêtre des réglages, il peut se glisser
 * DESSOUS, là où personne ne le voit ni ne le touche. On regarde donc ce que
 * touche un doigt posé en son milieu.
 */
const tiroirDeLAgentAuDessus = (page) =>
  page.evaluate(() => {
    const tiroir = document.querySelector('[data-tiroir-agent-configuration]');
    if (!tiroir) return { ok: false, touche: 'tiroir absent' };
    const r = tiroir.getBoundingClientRect();
    const touche = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const recouvrant = touche?.closest('[data-config-projet], [data-fenetre-centree], [role="dialog"]');
    return {
      ok: !!touche?.closest('[data-tiroir-agent-configuration]'),
      touche: touche
        ? `${touche.tagName.toLowerCase()} dans ${
            recouvrant?.hasAttribute('data-config-projet')
              ? 'la fenêtre « Configuration du projet »'
              : recouvrant?.hasAttribute('data-page-de-zone')
                ? 'la page du tiroir'
                : (recouvrant?.tagName.toLowerCase() ?? 'la page')
          }`
        : 'rien',
    };
  });

/** Ouvre (ou referme) un repli, sans jamais le basculer deux fois. */
async function basculerRepli(page, rubrique, repere, ouvert) {
  const bouton = repli(page, rubrique, repere);
  if ((await bouton.getAttribute('aria-expanded')) !== String(ouvert)) await bouton.click();
  await page.waitForTimeout(250);
}

try {
  await attendrePort();
  poserDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });

  /* ---------- 1. Sans processus, production désactivée ---------- */
  let { contexte, page, erreurs } = await ouvrir(navigateur);
  await page.locator('[data-ouvrir-tiroir-production]').click();
  await page.waitForSelector('[data-tiroir-procedure-production]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  noter(
    'le tiroir n’a plus d’onglets ni de flèche qui referme',
    (await page.locator('[data-onglet-tiroir-production], [data-fermer-tiroir-production]').count()) === 0,
  );
  const positions = await page.evaluate(() => {
    const entete = document.querySelector('[data-entete-tiroir-production]');
    const inter = entete?.querySelector('[data-interrupteur-mise-en-production]')?.getBoundingClientRect();
    const reglages = entete?.querySelector('[data-reglages-tiroir-production]')?.getBoundingClientRect();
    return inter && reglages ? { inter: inter.right, reglages: reglages.left } : null;
  });
  noter(
    'le bouton de réglages est à droite de l’interrupteur',
    !!positions && positions.reglages >= positions.inter,
    JSON.stringify(positions),
  );
  noter(
    'sans processus, le tiroir le dit en clair',
    /pas encore de processus/.test((await page.locator('[data-tiroir-procedure-production] [data-procedure-absente="archived"]').first().textContent().catch(() => '')) ?? ''),
  );
  let tours = await envoyes(page, 'procedure.tour');
  noter('ouvrir le tiroir ne lance aucun tour d’agent', tours.length === 0, JSON.stringify(tours).slice(0, 160));
  await page.locator('[data-reglages-tiroir-production]').click();
  await page.waitForSelector('[data-rubrique-contenu="production"]', { timeout: 60_000 });
  await page.waitForTimeout(600);
  noter(
    'le bouton de réglages ouvre la rubrique « Mise en production » PAR-DESSUS le tiroir, qui reste ouvert',
    (await page.locator('[data-tiroir-procedure-production]').count()) === 1 &&
      (await page.locator('[data-rubrique-ouverte="production"]').count()) === 1,
  );
  noter(
    'éteinte : le contenu est masqué, le bouton de l’agent éteint et il dit pourquoi au survol',
    (await page.locator('[data-activation-production="non"]').count()) === 1 &&
      (await page.locator('[data-rubrique-contenu="production"] [data-champ-adresse-production], [data-rubrique-contenu="production"] [data-processus-en-place]').count()) === 0 &&
      /désactivée/.test((await page.locator('[data-agent-configuration="production"][data-voile-configuration="oui"]').getAttribute('title').catch(() => '')) ?? '') &&
      (await page.locator('[data-ouvrir-agent-configuration="production"]').isDisabled()),
  );
  const eteinte = await ouJEnSuis(page, 'production');
  noter(
    'éteinte : la phrase d’état le dit, l’interrupteur vit dans le même bloc, et les repères se taisent',
    /^Désactivée/.test(eteinte.phrase) &&
      eteinte.reperes === '' &&
      (await page.locator('[data-ou-j-en-suis="production"] [data-activation-production="non"] [data-interrupteur-mise-en-production]').count()) === 1,
    JSON.stringify(eteinte),
  );
  noter(
    'aucune ancienne cible (SSH, FTP, consigne, miroir) ne subsiste',
    (await page.locator('[data-type-cible-production], [data-miroir-public], [data-prompt-production], [data-base-production]').count()) === 0,
  );
  await page.locator('[data-rubrique-contenu="production"] [data-interrupteur-mise-en-production]').click();
  await page.waitForSelector('[data-activation-production="oui"]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  noter(
    'allumée : le bouton se rallume, le processus absent se dit',
    (await page.locator('[data-agent-configuration="production"][data-voile-configuration="non"]').count()) === 1 &&
      (await page.locator('[data-ouvrir-agent-configuration="production"]').isEnabled()) &&
      /pas encore de processus/.test((await page.locator('[data-processus-en-place="production"]').textContent().catch(() => '')) ?? ''),
  );
  tours = await envoyes(page, 'procedure.tour');
  noter('visiter la rubrique ne lance aucun tour', tours.length === 0, JSON.stringify(tours).slice(0, 160));
  const ouvrirAgent = page.locator('[data-ou-j-en-suis="production"] [data-ouvrir-agent-configuration="production"]');
  noter(
    'le bouton « Initialiser » vit dans le premier temps « où j’en suis », et aucune conversation n’est dans le contenu',
    /^Initialiser$/.test(((await ouvrirAgent.textContent().catch(() => '')) ?? '').trim()) &&
      (await ouvrirAgent.getAttribute('data-etat-bouton-agent')) === 'initialiser' &&
      (await page.locator('[data-rubrique-contenu="production"] [data-conversation-procedure]').count()) === 0,
  );
  /* LA RUBRIQUE EN TROIS TEMPS (11/10/2026) : où j'en suis, ce qui se passera
     au clic, les réglages — dans cet ordre, de haut en bas. Le bouton de
     l'agent est le SEUL de la rubrique, et le seul bouton du premier temps
     (l'interrupteur mis à part) ; il se pose DESSOUS, sur toute la largeur, en
     violet plein (demande du 19/10/2026). */
  const place = await ouvrirAgent.evaluate((b) => {
    const bloc = b.closest('[data-ou-j-en-suis]');
    const rubrique = b.closest('[data-rubrique-contenu]');
    const haut = (selecteur) => rubrique.querySelector(selecteur)?.getBoundingClientRect().top ?? null;
    const cadre = bloc.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return {
      agents: rubrique.querySelectorAll('[data-ouvrir-agent-configuration]').length,
      boutonsDuBloc: bloc.querySelectorAll('button:not([role="switch"])').length,
      droite: Math.round(cadre.right - r.right),
      largeur: Math.round(r.width),
      bloc: Math.round(cadre.width),
      dessous: Math.round(r.top - (bloc.querySelector('[data-phrase-d-etat]')?.getBoundingClientRect().bottom ?? r.top)),
      fond: getComputedStyle(b).backgroundColor,
      ordre: [cadre.top, haut('[data-processus-en-place]'), haut('[data-reglages-de-l-etape]')],
    };
  });
  noter(
    'il est le seul bouton du premier temps, sous la phrase d’état, sur toute la largeur, en violet plein',
    place.agents === 1 && place.boutonsDuBloc === 1 && place.dessous > 0 && place.largeur > place.bloc * 0.85 && /^rgb\((\d+), (\d+), (\d+)\)$/.test(place.fond) && (() => { const [, r, g, b] = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(place.fond).map(Number); return b > r && b > g; })(),
    JSON.stringify(place),
  );
  noter(
    'les trois temps se suivent : où j’en suis, ce qui se passera au clic, les réglages',
    place.ordre.every((haut) => haut !== null) && place.ordre[0] < place.ordre[1] && place.ordre[1] < place.ordre[2],
    JSON.stringify(place.ordre),
  );
  const aConfigurer = await ouJEnSuis(page, 'production');
  noter(
    'sans processus : « à configurer », une phrase d’état et trois repères dont aucun n’est atteint',
    aConfigurer.etat === 'a-configurer' &&
      /^À configurer/.test(aConfigurer.phrase) &&
      aConfigurer.reperes === 'etude:a-faire processus:a-faire essai:a-faire',
    JSON.stringify(aConfigurer),
  );
  noter(
    'seule l’adresse publique reste à vue : la branche est rangée derrière « Réglages avancés », fermé par défaut',
    (await page.locator('[data-rubrique-contenu="production"] [data-champ-adresse-production]').isVisible()) &&
      (await repli(page, 'production', 'reglages-avances').getAttribute('aria-expanded')) === 'false' &&
      (await page.locator('[data-rubrique-contenu="production"] [data-branche-production]').count()) === 0,
  );
  const sansFond = await page.evaluate(() =>
    [...document.querySelectorAll('[data-config-projet] button:not([role="switch"]), [data-config-projet] [role="button"]')]
      .filter((b) => b.offsetParent && !b.closest('[data-rubrique-config], nav, [data-retour-menu-config]') && !b.matches('[data-info], [aria-label="Close"]') && !b.closest('[data-bulle-info]'))
      .filter((b) => b.textContent.trim().length > 0)
      .filter((b) => {
        const fond = getComputedStyle(b).backgroundColor;
        return fond === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(fond);
      })
      .map((b) => b.textContent.trim().slice(0, 30)),
  );
  noter('chaque bouton à libellé de la fenêtre a un fond', sansFond.length === 0, sansFond.join(' | '));
  await ouvrirAgent.click();
  await page.waitForSelector('[data-tiroir-agent-configuration="production"]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    'le clic ouvre le tiroir de l’agent, et les réglages restent en place',
    (await page.locator('[data-tiroir-empile="oui"] [data-tiroir-agent-configuration="production"]').count()) === 1 &&
      (await page.locator('[data-rubrique-contenu="production"]').count()) === 1,
  );
  /* « PAR-DESSUS » SE JUGE À L'ÉCRAN, pas dans l'arbre : c'est le tiroir qu'on
     doit toucher en son milieu, pas la fenêtre des réglages restée dessous. */
  const dessus = await tiroirDeLAgentAuDessus(page);
  noter('ce tiroir est PAR-DESSUS la fenêtre des réglages : c’est lui qu’on touche', dessus.ok, `on touche : ${dessus.touche}`);
  /* LE CLIC SUR « INITIALISER » EST LE GESTE (16/10/2026) : il ouvre le tiroir ET
     lance le premier tour, sans second clic sur le bouton du tiroir. */
  noter(
    'le clic sur « Initialiser » lance l’agent tout seul : le tiroir n’attend plus de second clic',
    (await page.locator('[data-tiroir-agent-configuration="production"] [data-conversation-procedure="aucune"]').count()) === 0,
  );
  await page.waitForTimeout(800);
  tours = await envoyes(page, 'procedure.tour');
  noter(
    'il lance UN seul tour, pour la production, sans quitter les réglages',
    tours.length === 1 && JSON.stringify(tours[0]).includes('"production"') &&
      (await page.locator('[data-rubrique-contenu="production"]').count()) === 1,
    JSON.stringify(tours).slice(0, 160),
  );
  noter('aucune mise en ligne ne part des réglages', (await envoyes(page, 'deploy.start')).length === 0);
  noter('sans processus — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 2. Avec un processus écrit et son agent ---------- */
  poserAgentDeConfiguration();
  poserProjet(
    {
      agentId: AGENT_ID,
      processus: {
        resume: 'La production tourne chez l’hébergeur, alimentée par GitHub.',
        explication: 'Votre site est **hébergé chez o2switch**. Le bouton lance le déploiement GitHub, puis vérifie que le site répond.',
        cible: 'exemple.test, hébergement o2switch',
        etapes: ETAPES,
        ecritLe: Date.now(),
        empreinte: JSON.stringify({ adresse: 'https://exemple.test', branche: '' }),
      },
    },
    { miseEnProductionActive: true, adresseProduction: 'https://exemple.test' },
  );
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  /* Procédure en place, le bouton ouvre la CONFIRMATION (22/10/2026) : le volet
     s'ouvre par la flèche accolée. */
  await page.locator('[data-chevron-production]').click();
  await page.waitForSelector('[data-tiroir-procedure-production]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  /* LA PAGE NE MONTRE PLUS LE RÉCIT ENTIER DE L'AGENT (revue téléphone du
     11/10/2026) : POURQUOI ce processus, en deux phrases au plus — son résumé,
     la même règle que la rubrique des réglages —, puis les étapes en clair, et
     les commandes derrière « Détail technique », replié. */
  const explication = await page
    .locator('[data-explication-configuration="agent"]')
    .evaluate((bloc) => {
      const detail = bloc.querySelector('details[data-etapes-configuration]');
      return {
        pourquoi: bloc.querySelector('[data-pourquoi-ce-processus]')?.textContent?.trim() ?? '',
        etapes: [...bloc.querySelectorAll('[data-etapes-en-clair] li')].map((li) => li.textContent?.trim() ?? ''),
        /* Ce qui se lit sans rien ouvrir : tout, sauf le contenu du repli. */
        aVue: [...bloc.children].filter((e) => e !== detail).map((e) => e.textContent ?? '').join(' '),
        detail: detail
          ? { titre: detail.querySelector('summary')?.textContent?.trim() ?? '', ouvert: detail.open, texte: detail.textContent ?? '' }
          : null,
      };
    })
    .catch(() => null);
  noter(
    'la page garde le pourquoi (le résumé de l’agent, pas son récit), les étapes en clair et le bouton de mise en production',
    !!explication &&
      explication.pourquoi === 'La production tourne chez l’hébergeur, alimentée par GitHub.' &&
      !/hébergé chez o2switch/.test(explication.aVue) &&
      explication.etapes.length === 2 &&
      explication.etapes[0].includes('Déclencher le déploiement GitHub') &&
      explication.etapes[1].includes('Contrôler le site') &&
      (await page.locator('[data-pied-tiroir-production] [data-bouton-publication]').count()) > 0,
    JSON.stringify({ pourquoi: explication?.pourquoi, etapes: explication?.etapes }),
  );
  noter(
    'les commandes n’y sont pas à vue : elles se lisent derrière « Détail technique », replié',
    !!explication?.detail &&
      explication.detail.titre === 'Détail technique' &&
      explication.detail.ouvert === false &&
      !explication.aVue.includes('gh workflow run') &&
      explication.detail.texte.includes('gh workflow run deploy.yml --ref main'),
    JSON.stringify({ titre: explication?.detail?.titre, ouvert: explication?.detail?.ouvert }),
  );
  await page.locator('[data-reglages-tiroir-production]').click();
  await page.waitForSelector('[data-processus-en-place="production"]', { timeout: 60_000 });
  await page.waitForTimeout(1_500);
  const bloc = page.locator('[data-processus-en-place="production"]');
  /* CE QUI SE PASSERA AU CLIC, D'EMBLÉE : les étapes en titres simples, et rien
     de technique. Les commandes, la date et le lieu déclaré par l'agent se
     lisent derrière « Détail technique », FERMÉ par défaut. */
  const texteReplie = (await bloc.textContent()) ?? '';
  noter(
    'les étapes du processus se lisent d’emblée, en titres simples, sans une seule commande',
    (await bloc.locator('[data-etapes-processus="2"] li').count()) === 2 &&
      texteReplie.includes('Déclencher le déploiement GitHub') &&
      texteReplie.includes('Contrôler le site') &&
      !texteReplie.includes('gh workflow run') &&
      !texteReplie.includes('curl -fsS') &&
      (await repli(page, 'production', 'detail-technique').getAttribute('aria-expanded')) === 'false',
    texteReplie.slice(0, 200),
  );
  noter(
    'l’adresse et la branche ne sont plus répétées au-dessus des étapes',
    (await bloc.locator('[data-processus-branche], [data-processus-adresse]').count()) === 0 &&
      !/Adresse visée/.test(texteReplie),
  );
  const pourquoi = ((await bloc.locator('[data-pourquoi-processus]').textContent().catch(() => '')) ?? '').trim();
  noter(
    'pourquoi ce processus : le résumé de l’agent, en deux phrases au plus — jamais le récit de son étude',
    pourquoi.includes('La production tourne chez l’hébergeur, alimentée par GitHub.') &&
      !/hébergé chez o2switch/.test(texteReplie) &&
      (await page.locator('[data-etude-processus], [data-etude-voir-plus]').count()) === 0,
    pourquoi,
  );
  const pret = await ouJEnSuis(page, 'production');
  noter(
    'où j’en suis : « prêt », l’étude et le processus faits, et « Prêt à partir » faute d’essai connu',
    pret.etat === 'pret' && /^Prêt/.test(pret.phrase) && pret.reperes === 'etude:fait processus:fait pret:fait',
    JSON.stringify(pret),
  );
  await basculerRepli(page, 'production', 'detail-technique', true);
  const texteBloc = (await bloc.textContent()) ?? '';
  noter(
    '« Détail technique » déplie les commandes exactes, les délais, la date et le lieu déclaré par l’agent',
    texteBloc.includes('gh workflow run deploy.yml --ref main') &&
      texteBloc.includes('curl -fsS https://exemple.test') &&
      /60 s au plus/.test(texteBloc) &&
      (await bloc.locator('[data-processus-ecrit-le]').count()) === 1 &&
      /exemple\.test, hébergement o2switch/.test((await bloc.locator('[data-processus-adresse="agent"]').textContent().catch(() => '')) ?? ''),
    texteBloc.slice(0, 200),
  );
  const flux = await bloc.evaluate((n) => {
    const points = [...n.querySelectorAll('[data-point-processus]')];
    const ronds = points.map((p) => p.querySelector('[data-rond-processus]')?.getBoundingClientRect());
    const traits = points.map((p) => p.querySelector('[data-trait-processus]')?.getBoundingClientRect());
    return {
      genres: points.map((p) => p.getAttribute('data-point-processus')),
      icones: points.filter((p) => p.querySelector('[data-rond-processus] svg')).length,
      rondsAGauche: ronds.every((r, i) => r && r.right <= points[i].querySelector('[data-titre-point-processus]').getBoundingClientRect().left),
      traitsCentres: traits.every((t, i) => t && Math.abs(t.left + t.width / 2 - (ronds[i].left + ronds[i].width / 2)) < 1.5),
    };
  });
  noter(
    'les étapes forment un flux : un rond à icône à gauche, une ligne verticale centrée qui les relie, le titre à droite',
    flux.genres.join(',') === 'github,controle' && flux.icones === 2 && flux.rondsAGauche && flux.traitsCentres,
    JSON.stringify(flux),
  );
  noter('rien n’est à revérifier tant que les réglages n’ont pas bougé', (await bloc.getAttribute('data-processus-a-revoir')) === null);
  noter(
    'la conversation de l’agent retenu n’est pas dans le contenu : le bouton « Reconfigurer » du premier temps l’ouvre dans un tiroir',
    (await page.locator('[data-rubrique-contenu="production"] [data-conversation-procedure]').count()) === 0 &&
      (await page.locator('[data-ou-j-en-suis="production"] [data-ouvrir-agent-configuration="production"][data-etat-bouton-agent="reconfigurer"]').count()) === 1 &&
      /Reconfigurer/.test((await page.locator('[data-ouvrir-agent-configuration="production"]').textContent()) ?? ''),
  );
  await page.locator('[data-ouvrir-agent-configuration="production"]').click();
  await page.waitForSelector(`[data-tiroir-agent-configuration] [data-conversation-procedure="${AGENT_ID}"]`, { timeout: 15_000 });
  noter(
    'dans le tiroir, la conversation de l’agent retenu se lit',
    ((await page.locator(`[data-tiroir-agent-configuration] [data-conversation-procedure="${AGENT_ID}"]`).textContent().catch(() => '')) ?? '').includes('préparé le script de déploiement'),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  noter(
    'Échap ne referme que le tiroir du dessus',
    (await page.locator('[data-tiroir-agent-configuration]').count()) === 0 &&
      (await page.locator('[data-rubrique-contenu="production"]').count()) === 1,
  );
  tours = await envoyes(page, 'procedure.tour');
  noter('un agent retenu ne relance AUCUN tour tout seul', tours.length === 0, JSON.stringify(tours).slice(0, 160));
  noter('avec processus — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 2 ter. Une longue étude ne s'étale plus : deux phrases, aucun journal ---------- */
  const LONGUE = Array.from(
    { length: 14 },
    (_, i) => `Paragraphe ${i + 1} : le site est hébergé chez o2switch, le bouton lance le déploiement GitHub puis vérifie que le site répond, avec une adresse très longue https://exemple.test/${'a'.repeat(90)}.`,
  ).join('\n\n');
  poserProjet(
    {
      agentId: AGENT_ID,
      /* SANS résumé : le pourquoi retombe alors sur le DÉBUT de l'explication —
         deux phrases, jamais les quatorze paragraphes du récit. */
      processus: {
        explication: LONGUE,
        etapes: ETAPES,
        ecritLe: Date.now(),
        empreinte: JSON.stringify({ adresse: 'https://exemple.test', branche: '' }),
      },
    },
    { miseEnProductionActive: true, adresseProduction: 'https://exemple.test' },
  );
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'production' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-processus-en-place="production"] [data-pourquoi-processus]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  const mesure = await page.locator('[data-rubrique-contenu="production"]').evaluate((rubrique) => {
    const pourquoi = rubrique.querySelector('[data-pourquoi-processus]');
    return {
      texte: pourquoi.textContent ?? '',
      horizontal: pourquoi.scrollWidth > pourquoi.clientWidth + 1 || rubrique.scrollWidth > rubrique.clientWidth + 1,
      journal: rubrique.querySelectorAll('[data-etude-processus], [data-etude-apercu], [data-etude-voir-plus]').length,
      quatorze: (rubrique.textContent ?? '').includes('Paragraphe 14'),
      zoneAvecBarre: [...document.querySelectorAll('[data-rubrique-contenu] *')].filter((e) => {
        const o = getComputedStyle(e).overflowY;
        return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1;
      }).length,
    };
  });
  noter(
    'une longue étude ne s’étale plus : le pourquoi garde ses deux premières phrases, sans débordement à droite',
    mesure.texte.includes('Paragraphe 1 :') &&
      mesure.texte.includes('Paragraphe 2 :') &&
      !mesure.texte.includes('Paragraphe 3 :') &&
      !mesure.horizontal,
    JSON.stringify({ ...mesure, texte: mesure.texte.slice(0, 80) }),
  );
  noter(
    'le journal « Étude de l’agent » a disparu : ni aperçu, ni « Voir plus », ni tiroir, ni la suite du récit',
    mesure.journal === 0 && !mesure.quatorze && (await page.locator('[data-tiroir-etude-processus]').count()) === 0,
    JSON.stringify({ journal: mesure.journal, quatorze: mesure.quatorze }),
  );
  noter('la rubrique ne contient aucune zone qui défile dans la page qui défile', mesure.zoneAvecBarre === 0, String(mesure.zoneAvecBarre));
  await page.screenshot({ path: '/tmp/rubrique-trois-temps.png' });
  noter('longue étude — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 2 quater. Un processus SANS agent : « Reconfigurer » lance d'un seul clic (21/10/2026) ---------- */
  poserProjet(
    {
      processus: {
        resume: 'La production tourne chez l’hébergeur, alimentée par GitHub.',
        etapes: ETAPES,
        ecritLe: Date.now(),
        empreinte: JSON.stringify({ adresse: 'https://exemple.test', branche: '' }),
      },
    },
    { miseEnProductionActive: true, adresseProduction: 'https://exemple.test' },
  );
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'production' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-ou-j-en-suis="production"] [data-etat-bouton-agent="reconfigurer"]', { timeout: 60_000 });
  await page.waitForTimeout(600);
  tours = await envoyes(page, 'procedure.tour');
  noter('processus sans agent — visiter la rubrique ne lance aucun tour', tours.length === 0, JSON.stringify(tours).slice(0, 160));
  await page.locator('[data-ou-j-en-suis="production"] [data-ouvrir-agent-configuration="production"]').click();
  await page.waitForSelector('[data-tiroir-agent-configuration]', { timeout: 15_000 });
  await page.waitForTimeout(1_200);
  tours = await envoyes(page, 'procedure.tour');
  noter(
    'processus sans agent — UN clic sur « Reconfigurer » lance le premier tour, une seule fois, sans second bouton',
    tours.length === 1 && (await page.locator('[data-tiroir-agent-configuration] [data-conversation-procedure="aucune"]').count()) === 0,
    JSON.stringify(tours).slice(0, 160),
  );
  noter('processus sans agent — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 2 bis. Un réglage changé depuis, et un processus d'avant ---------- */
  poserProjet(
    {
      agentId: AGENT_ID,
      processus: {
        resume: 'La production tourne chez l’hébergeur, alimentée par GitHub.',
        etapes: ETAPES,
        ecritLe: Date.now(),
        empreinte: JSON.stringify({ adresse: 'https://ancienne.test', branche: '' }),
      },
    },
    { miseEnProductionActive: true, adresseProduction: 'https://exemple.test' },
  );
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'production' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-processus-en-place="production"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  noter(
    'l’adresse changée depuis l’écriture fait dire « à revérifier »',
    (await page.locator('[data-processus-en-place="production"]').getAttribute('data-processus-a-revoir')) === 'adresse' &&
      /À revérifier/.test((await page.locator('[data-avertissement-processus]').textContent().catch(() => '')) ?? ''),
  );
  /* L'AVERTISSEMENT NE SE RANGE PAS : il EST la phrase d'état du premier temps,
     lisible sans rien ouvrir — les deux replis de la rubrique sont fermés. */
  const aRevoir = await ouJEnSuis(page, 'production');
  noter(
    'et cela se lit d’emblée : la phrase d’état est l’avertissement, le dernier repère dit « à revérifier »',
    aRevoir.etat === 'a-reverifier' &&
      /^À revérifier/.test(aRevoir.phrase) &&
      /adresse/.test(aRevoir.phrase) &&
      aRevoir.reperes === 'etude:fait processus:fait a-reverifier:a-revoir' &&
      (await page.locator('[data-ou-j-en-suis="production"] [data-phrase-d-etat][data-avertissement-processus]').isVisible()) &&
      (await repli(page, 'production', 'detail-technique').getAttribute('aria-expanded')) === 'false' &&
      (await repli(page, 'production', 'reglages-avances').getAttribute('aria-expanded')) === 'false',
    JSON.stringify(aRevoir),
  );
  /* SANS LIEU DÉCLARÉ PAR L'AGENT, L'ADRESSE NE SE LIT QU'À UN ENDROIT : son
     champ. Elle était répétée au-dessus des étapes (« celle des réglages »). */
  await basculerRepli(page, 'production', 'detail-technique', true);
  noter(
    'sans lieu déclaré par l’agent, l’adresse des réglages n’est plus répétée : elle se lit dans son champ',
    (await page.locator('[data-rubrique-contenu="production"] [data-processus-adresse]').count()) === 0 &&
      (await page.locator('[data-champ-adresse-production]').inputValue()) === 'https://exemple.test',
  );

  /* ---------- 3. La rubrique Déploiement ---------- */
  await page.locator('[data-rubrique-config="deploiement"]').click();
  await page.waitForSelector('[data-rubrique-contenu="deploiement"]', { timeout: 60_000 });
  await page.waitForTimeout(600);
  const commande = page.locator('[data-commande-deploiement-champ]');
  const service = page.locator('[data-service-deploiement-champ]');
  /* SEULE L'ADRESSE RESTE À VUE : le port, la branche, la commande et les
     services sont rangés derrière « Réglages avancés », fermé par défaut. */
  noter(
    'seule l’adresse à contrôler reste à vue : port, branche, commande et services sont rangés',
    (await page.locator('[data-rubrique-contenu="deploiement"] [data-url-dev]').isVisible()) &&
      (await repli(page, 'deploiement', 'reglages-avances').getAttribute('aria-expanded')) === 'false' &&
      (await page.locator('[data-port-projet-champ], [data-branche-dev], [data-commande-deploiement-champ], [data-service-deploiement-champ]').count()) === 0,
  );
  await basculerRepli(page, 'deploiement', 'reglages-avances', true);
  noter(
    'la rubrique porte ses réglages, pré-remplis',
    (await commande.inputValue()) === 'npm run build' && (await service.inputValue()) === 'autoproject-essai',
  );
  const commun = page.locator('[data-processus-en-place="dev"][data-processus-origine="commun"]');
  const titresCommuns = ((await commun.textContent().catch(() => '')) ?? '');
  await basculerRepli(page, 'deploiement', 'detail-technique', true);
  noter(
    'projet hérité sans processus écrit : le déroulé commun est montré étape par étape, sa commande dans le détail',
    (await commun.count()) === 1 &&
      /autoproject-essai/.test(titresCommuns) &&
      !/npm run build/.test(titresCommuns) &&
      /npm run build/.test((await commun.textContent()) ?? ''),
    titresCommuns.slice(0, 200),
  );
  const herite = await ouJEnSuis(page, 'dev');
  noter(
    'où j’en suis : « prêt » par le déroulé commun — aucune étude encore, mais un processus en service',
    herite.etat === 'pret' && /déroulé commun/.test(herite.phrase) && herite.reperes === 'etude:a-faire processus:fait pret:fait',
    JSON.stringify(herite),
  );
  noter(
    'et le déploiement a SON agent de configuration, dans le premier temps, qui ne part pas tout seul',
    (await page.locator('[data-ou-j-en-suis="dev"] [data-ouvrir-agent-configuration="dev"]').count()) === 1 &&
      (await envoyes(page, 'procedure.tour')).length === 0,
  );
  await service.fill('autoproject-autre.service');
  /* UN CHAMP RANGÉ PART QUAND MÊME : on referme « Réglages avancés » avant
     d'enregistrer. Le champ n'est plus dans la page, sa valeur est tenue par
     la fenêtre. */
  await basculerRepli(page, 'deploiement', 'reglages-avances', false);
  noter('le champ modifié est bien rangé avant l’enregistrement', (await service.count()) === 0);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(1_500);
  const maj = (await envoyes(page, 'project.update')).at(-1);
  const patch = maj?.cmd?.patch ?? maj?.patch ?? {};
  noter(
    '« Enregistrer » envoie la commande et le service, « .service » retiré',
    patch?.deploiement?.commande === 'npm run build' && patch?.deploiement?.service === 'autoproject-autre',
    JSON.stringify(patch?.deploiement),
  );
  noter(
    'et ne touche JAMAIS aux processus ni aux agents',
    !('miseEnProduction' in patch) && !('processus' in (patch.deploiement ?? {})) && !('agentId' in (patch.deploiement ?? {})),
    Object.keys(patch).join(','),
  );
  const relu = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const enBase = JSON.parse(relu.prepare('SELECT data FROM projects WHERE id = ?').get(PROJET_ID).data);
  relu.close();
  noter(
    'en base : le service est enregistré, le processus et l’agent retenu sont intacts',
    enBase.deploiement?.service === 'autoproject-autre' &&
      enBase.miseEnProduction?.processus?.etapes?.length === 2 &&
      enBase.miseEnProduction?.agentId === AGENT_ID,
    JSON.stringify({ d: enBase.deploiement, n: enBase.miseEnProduction?.processus?.etapes?.length }),
  );
  noter('réglages — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 3 bis. Un déploiement qui a SON processus ---------- */
  poserProjet(
    {},
    {
      deploiement: {
        commande: 'npm run build',
        service: 'autoproject-essai',
        agentId: 'a-config-dev',
        processus: {
          explication: 'Le déploiement **reconstruit** puis relance le service.',
          cible: 'ce serveur, service autoproject-essai',
          etapes: [{ libelle: 'Construire et relancer', commande: 'npm run build && sudo systemctl restart autoproject-essai', delaiS: 300 }],
          ecritLe: Date.now(),
          empreinte: JSON.stringify({ adresse: '', port: '', branche: '', commande: 'npm run build', services: 'autoproject-essai' }),
        },
      },
    },
  );
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'deploiement' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-processus-en-place="dev"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  const blocDev = page.locator('[data-processus-en-place="dev"]');
  await basculerRepli(page, 'deploiement', 'detail-technique', true);
  noter(
    'le processus écrit par l’agent du déploiement remplace le déroulé commun à l’écran',
    (await blocDev.getAttribute('data-processus-origine')) === 'agent' &&
      (await blocDev.locator('[data-etapes-processus="1"] li').count()) === 1 &&
      /Construire et relancer/.test((await blocDev.locator('[data-titre-point-processus]').first().textContent()) ?? '') &&
      /ce serveur, service autoproject-essai/.test((await blocDev.locator('[data-processus-adresse="agent"]').textContent().catch(() => '')) ?? '') &&
      (await blocDev.getAttribute('data-processus-a-revoir')) === null,
  );
  noter(
    'où j’en suis, côté déploiement : « prêt », étude et processus faits',
    (await ouJEnSuis(page, 'dev')).etat === 'pret' && (await ouJEnSuis(page, 'dev')).reperes === 'etude:fait processus:fait pret:fait',
    JSON.stringify(await ouJEnSuis(page, 'dev')),
  );
  await basculerRepli(page, 'deploiement', 'reglages-avances', true);
  await page.locator('[data-commande-deploiement-champ]').fill('npm run build:prod');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(1_500);
  const reluDev = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  const enBaseDev = JSON.parse(reluDev.prepare('SELECT data FROM projects WHERE id = ?').get(PROJET_ID).data);
  reluDev.close();
  noter(
    '« Enregistrer » garde le processus et l’agent du déploiement',
    enBaseDev.deploiement?.commande === 'npm run build:prod' &&
      enBaseDev.deploiement?.processus?.etapes?.length === 1 &&
      enBaseDev.deploiement?.agentId === 'a-config-dev',
    JSON.stringify(enBaseDev.deploiement).slice(0, 200),
  );
  /* « Enregistrer » referme la fenêtre : on la rouvre sur la même rubrique. */
  if (!(await page.locator('[data-processus-en-place="dev"]').count())) {
    await page.evaluate((id) => {
      window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'deploiement' } }));
    }, PROJET_ID);
    await page.waitForSelector('[data-processus-en-place="dev"]', { timeout: 60_000 });
  }
  await page.waitForTimeout(800);
  noter(
    'la commande changée fait dire « à revérifier » au processus du déploiement',
    (await page.locator('[data-processus-en-place="dev"]').getAttribute('data-processus-a-revoir').catch(() => null)) === 'commande' &&
      (await ouJEnSuis(page, 'dev')).etat === 'a-reverifier' &&
      /commande de mise à jour/.test((await ouJEnSuis(page, 'dev')).phrase),
    JSON.stringify(await ouJEnSuis(page, 'dev').catch(() => null)),
  );
  noter('déploiement — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 3 ter. Un projet NEUF : le déploiement est à initialiser ---------- */
  /* Le montage a relevé son service, mais personne n'a initialisé son
     déploiement : il ne part pas, et la colonne comme la rubrique le disent. */
  poserProjet({}, { deploiement: { service: 'autoproject-neuf' } });
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.waitForTimeout(1_200);
  const absentColonne = page.locator('[data-procedure-absente="to_deploy"]');
  noter(
    'projet neuf : la colonne « À déployer » propose d’initialiser le déploiement',
    (await page.locator('[data-initier-procedure="dev"]').count()) >= 1 &&
      /procédure de déploiement/.test((await absentColonne.first().textContent().catch(() => '')) ?? '') &&
      !/mise en production/.test((await absentColonne.first().textContent().catch(() => '')) ?? ''),
    (await absentColonne.first().textContent().catch(() => 'absente')) ?? '',
  );
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'deploiement' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-rubrique-contenu="deploiement"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  noter(
    'projet neuf : la rubrique « Déploiement » dit qu’il est à initialiser, sans déroulé commun',
    (await page.locator('[data-processus-en-place="dev"][data-processus-absent]').count()) === 1 &&
      (await page.locator('[data-processus-origine="commun"]').count()) === 0,
  );
  noter(
    'projet neuf : le bouton du premier temps dit « Initialiser », et l’état « à configurer »',
    (await page.locator('[data-ou-j-en-suis="dev"] [data-ouvrir-agent-configuration="dev"]').getAttribute('data-etat-bouton-agent')) ===
      'initialiser' &&
      (await ouJEnSuis(page, 'dev')).etat === 'a-configurer' &&
      (await ouJEnSuis(page, 'dev')).reperes === 'etude:a-faire processus:a-faire essai:a-faire',
    JSON.stringify(await ouJEnSuis(page, 'dev').catch(() => null)),
  );
  noter('projet neuf — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  /* ---------- 4. Le suivi de l'initialisation ---------- */
  /* Le démon d'essai remet au repos un agent « au travail » qu'aucun moteur
     ne porte : l'état se pose donc DANS L'ÉCRAN, par le point d'essai du
     serveur de développement (`HAIKO_INITPROD_URL`). Sans lui, la partie
     « au travail » ne peut pas se jouer, et le contrôle le dit. */
  poserProjet({ agentId: AGENT_ID }, { miseEnProductionActive: true });
  poserAgentDeConfiguration({ status: 'done' });
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  const pointDEssai = await page.evaluate(
    (id) => !!window.belugaEssai?.agent?.(id, { status: 'running', startedAt: Date.now(), tourVivantDepuis: Date.now(), endedAt: undefined }),
    AGENT_ID,
  );
  noter('le point d’essai des agents est là (serveur de développement)', pointDEssai, pointDEssai ? '' : 'HAIKO_INITPROD_URL manquant ?');
  await page.waitForTimeout(1_000);
  const bandeau = page.locator('[data-bandeau-production]');
  noter(
    'au travail, la zone droite du bandeau le dit',
    (await bandeau.getAttribute('data-initialisation-production')) === 'travail' &&
      /Initialisation/.test((await page.locator('[data-etat-initialisation]').textContent().catch(() => '')) ?? ''),
    await page.locator('[data-etat-initialisation]').textContent().catch(() => 'absente'),
  );
  const vignette = page.locator('[data-bande-cartes="running"] [data-vignette-initialisation-production]');
  noter('une vignette spéciale paraît en tête de « En cours »', (await vignette.count()) === 1);
  /* LE BORD BLEU EST PARTI AVEC LES CADRES (refonte) : le bleu de la mise en
     ligne se lit désormais sur le nuage du titre et sur le nom de l'étape. */
  noter(
    'elle porte le bleu de la mise en ligne et n’est pas une carte',
    (await vignette.locator('h3 svg.text-publie').count()) === 1 &&
      (await vignette.locator('[data-tete-gauche] .text-publie').count()) === 1 &&
      (await page.locator('[data-bande-cartes="running"] [data-card-id]').count()) === 0,
  );
  const compteur = (await page.locator('[data-compteur-colonne="running"]').first().textContent().catch(() => '')) ?? '';
  noter('le compteur de la colonne ne la compte pas', !/1/.test(compteur), compteur);
  await page.locator('[data-ouvrir-initialisation-production]').click();
  await page.waitForSelector('[data-tiroir-agent-configuration="production"]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  noter(
    'son clic ouvre le TIROIR de l’agent, sans fenêtre de réglages',
    (await page.locator('[data-tiroir-agent-configuration="production"]').count()) === 1 &&
      (await page.locator('[data-config-projet]').count()) === 0 &&
      (await page.locator('[data-tiroir-procedure-production]').count()) === 0,
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  noter('Échap referme ce tiroir', (await page.locator('[data-tiroir-agent-configuration]').count()) === 0);
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'production' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-rubrique-contenu="production"]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  const boutonTravail = page.locator('[data-ou-j-en-suis="production"] [data-ouvrir-agent-configuration="production"]');
  noter(
    'au travail, le bouton de la rubrique dit « Agent au travail… » avec sa roue',
    (await boutonTravail.getAttribute('data-etat-bouton-agent')) === 'travail' &&
      /Agent au travail/.test((await boutonTravail.textContent()) ?? '') &&
      (await boutonTravail.locator('svg.animate-spin').count()) === 1,
    await boutonTravail.getAttribute('data-etat-bouton-agent').catch(() => 'absent'),
  );
  const enEtude = await ouJEnSuis(page, 'production');
  noter(
    'au travail, la phrase d’état dit « étude en cours » et le premier repère tourne',
    enEtude.etat === 'etude' && /^Étude en cours/.test(enEtude.phrase) && /^etude:en-cours /.test(enEtude.reperes),
    JSON.stringify(enEtude),
  );
  await boutonTravail.click();
  await page.waitForSelector('[data-tiroir-agent-configuration="production"]', { timeout: 15_000 });
  await page.waitForTimeout(600);
  noter(
    'le bouton de la rubrique ouvre le même tiroir, les réglages restant en place',
    (await page.locator('[data-tiroir-empile="oui"] [data-tiroir-agent-configuration="production"]').count()) === 1 &&
      (await page.locator('[data-rubrique-contenu="production"]').count()) === 1,
  );
  const dessusAuTravail = await tiroirDeLAgentAuDessus(page);
  noter('là aussi, le tiroir est PAR-DESSUS la fenêtre des réglages', dessusAuTravail.ok, `on touche : ${dessusAuTravail.touche}`);
  noter('vignette et bouton — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  poserAgentDeConfiguration({ status: 'idle', attendReponse: true });
  ({ contexte, page, erreurs: erreurs } = await ouvrir(navigateur));
  await page.waitForTimeout(1_000);
  noter(
    'en attente de réponse, le bandeau et la vignette le disent',
    (await page.locator('[data-bandeau-production]').getAttribute('data-initialisation-production')) === 'question' &&
      (await page.locator('[data-etat-vignette-initialisation="question"]').count()) === 1,
  );
  /* L'AGENT ATTEND : le bouton du haut le dit et ouvre SA conversation, sans
     relancer de tour (22/10/2026) ; la rubrique le dit aussi. */
  noter(
    'en attente de réponse, le bouton du haut le dit, et son clic ouvre la conversation sans tour',
    (await page.locator('[data-ouvrir-tiroir-production]').getAttribute('data-etat-bouton-agent')) === 'question',
  );
  await page.locator('[data-ouvrir-tiroir-production]').click();
  await page.waitForSelector(`[data-tiroir-agent-configuration="production"] [data-conversation-procedure="${AGENT_ID}"]`, { timeout: 30_000 });
  noter('aucun tour relancé par ce clic', (await envoyes(page, 'procedure.tour')).length === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('beluga:config-projet', { detail: { projectId: id, rubrique: 'production' } }));
  }, PROJET_ID);
  await page.waitForSelector('[data-rubrique-contenu="production"]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  const enQuestion = await ouJEnSuis(page, 'production').catch(() => ({ etat: null, phrase: '', reperes: '' }));
  noter(
    'dans la rubrique, le bouton dit « Répondre à l’agent » et la phrase d’état que l’agent attend',
    (await page.locator('[data-ou-j-en-suis="production"] [data-ouvrir-agent-configuration="production"][data-etat-bouton-agent="question"]').count()) === 1 &&
      enQuestion.etat === 'question' &&
      /attend votre réponse/.test(enQuestion.phrase),
    JSON.stringify(enQuestion),
  );
  noter('suivi — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();

  poserAgentDeConfiguration({ status: 'done', endedAt: Date.now() - 10 * 60_000 });
  ({ contexte, page, erreurs } = await ouvrir(navigateur));
  await page.waitForTimeout(1_000);
  /* L'AGENT FINI DEPUIS DIX MINUTES (06/10/2026) : le bandeau a oublié
     « terminé » au bout d'une minute, la vignette a quitté le tableau, et sa
     carte attend dans « Archiver » des Tableaux de bord pendant 24 heures
     (`etatDeLaVignetteDInitialisation`), sans point bleu. */
  noter(
    'l’agent fini : le bandeau n’en dit plus rien, la vignette a quitté le tableau',
    (await page.locator('[data-bande-cartes="running"] [data-vignette-initialisation-production]').count()) === 0 &&
      (await page.locator('[data-bandeau-production]').getAttribute('data-initialisation-production')) === null,
  );
  await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-page-en-route]', { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const vignetteTerminee = page.locator('[data-liste-terminee] [data-vignette-initialisation-production]');
  noter(
    'Tableaux de bord : sa carte est dans « Archiver », « terminé », sans point bleu, plus basse qu’une carte',
    (await vignetteTerminee.count()) === 1 &&
      (await vignetteTerminee.locator('[data-etat-vignette-initialisation="fini"]').count()) === 1 &&
      (await page.locator('[data-systeme-non-lu]').count()) === 0 &&
      ((await vignetteTerminee.boundingBox())?.height ?? 999) < 130,
    JSON.stringify(await vignetteTerminee.boundingBox()),
  );
  noter('carte terminée — aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();
  await navigateur.close();
} catch (err) {
  noter('le contrôle est allé au bout', false, `${err?.message ?? err}\n${journal.slice(-5).join('')}`);
} finally {
  await nettoyer?.();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
