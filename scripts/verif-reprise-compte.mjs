#!/usr/bin/env node
/**
 * « Avec quel compte poursuivre ? » — le bloc affiché dans la conversation
 * quand un tour a été coupé par la limite d'un compte.
 *
 * Tout est INJECTÉ dans le canal temps réel : le message porteur de la reprise
 * et les relevés de quota. Aucun compte réel n'est touché, aucun tour n'est
 * lancé — la commande de reprise est interceptée avant de partir, ce qui permet
 * justement de prouver qu'un DOUBLE CLIC n'en envoie qu'une.
 *
 * Vise le serveur de DÉVELOPPEMENT (HAIKO_REPRISE_URL, localhost:7099 par
 * défaut) : le code jugé n'est pas encore publié.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_REPRISE_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');
const resultats = [];

function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session d'une heure, fabriquée puis retirée : le jeton n'est jamais réutilisé. */
function sessionEssai() {
  const require = createRequire(import.meta.url);
  const ouvrir = () => require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3_600_000,
    'vérification reprise de compte',
  );
  db.close();
  return {
    cookie,
    retirer() {
      const suite = ouvrir();
      suite.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
      suite.close();
    },
  };
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const session = sessionEssai();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await contexte.addCookies([
    { name: 'haikodev_session', value: session.cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && erreurs.push(message.text()));

  await page.addInitScript(() => {
    window.__agents = {};
    window.__ecouteurs = [];
    // Ce qui PART vers le serveur : c'est là qu'on compte les commandes.
    window.__envois = [];
    const envoyer = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      try {
        const charge = JSON.parse(donnees);
        if (charge?.cmd?.type) window.__envois.push(charge.cmd);
        // La reprise ne doit RIEN lancer pendant une vérification : on la
        // retient ici, après l'avoir comptée.
        if (charge?.cmd?.type === 'reprise.compte') return;
      } catch {}
      return envoyer.call(this, donnees);
    };
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, (event) => {
          try {
            const charge = JSON.parse(event.data);
            for (const agent of charge.agents ?? []) window.__agents[agent.id] = agent;
            if (charge.agent) window.__agents[charge.agent.id] = charge.agent;
          } catch {}
          return ecouteur.call(this, event);
        });
      },
    });
    window.__injecter = (charge) => {
      if (charge.agent) window.__agents[charge.agent.id] = charge.agent;
      const event = { data: JSON.stringify(charge) };
      for (const ecouteur of window.__ecouteurs) ecouteur.call(window, event);
    };
    /** Les relevés de quota : c'est eux qui font vivre la liste des comptes. */
    window.__poserQuotas = (quotas) => window.__injecter({ type: 'quotas', quotas });
    /** Le message d'un tour coupé par la limite d'un compte. */
    window.__poserReprise = (agentId, reprise) =>
      window.__injecter({
        type: 'message.upsert',
        message: {
          id: 'essai-reprise-message',
          agentId,
          role: 'assistant',
          content: 'La construction serveur passe. Voyons le nouveau test avant l’interface.',
          steps: [],
          todos: [],
          proposals: [],
          questions: [],
          downloads: [],
          attachments: [],
          streaming: false,
          repriseCompte: reprise,
          createdAt: Date.now(),
        },
      });
  });

  const compte = (id, label, disponible, options = {}) => ({
    id,
    engine: 'claude',
    label,
    priority: options.priority ?? 10,
    active: false,
    available: disponible,
    session: { usedPct: options.pct ?? 0, resetsAt: options.resetsAt },
    weekly: { usedPct: options.pct ?? 0, resetsAt: options.resetsAt },
    fetchedAt: Date.now(),
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(5_000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);

    // L'agent RÉELLEMENT affiché, lu dans le composeur : c'est le seul dont
    // les messages s'écrivent dans la conversation ouverte.
    const composeur = page.locator('[data-contexte-agent]:visible').first();
    await composeur.waitFor({ state: 'visible', timeout: 15_000 });
    const chefId = await composeur.getAttribute('data-agent-contexte');
    noter('la conversation du chef est ouverte', !!chefId, chefId ?? 'agent introuvable');
    if (!chefId) throw new Error('agent du chef introuvable');

    const dansUneHeure = Date.now() + 3_600_000;
    const reprise = {
      engine: 'claude',
      compteEpuise: 'essai-compte-1',
      compteEpuiseLabel: 'Essai — compte épuisé',
      resetsAt: dansUneHeure,
      motif: 'texte-de-limite',
      at: Date.now(),
    };

    /* 1. Aucun compte libre : le bloc reste, et le dit. */
    await page.evaluate(
      ([quotas]) => window.__poserQuotas(quotas),
      [[compte('essai-compte-1', 'Essai — compte épuisé', false, { pct: 100, resetsAt: dansUneHeure }),
        compte('essai-compte-2', 'Essai — relève', false, { pct: 100, resetsAt: dansUneHeure })]],
    );
    await page.evaluate(([id, r]) => window.__poserReprise(id, r), [chefId, reprise]);
    await page.waitForTimeout(600);

    const bloc = page.locator('[data-reprise-compte="attente"]:visible').first();
    await bloc.waitFor({ state: 'visible', timeout: 8_000 });
    noter('le bloc « Avec quel compte poursuivre ? » s’affiche', /Avec quel compte poursuivre/.test(await bloc.textContent()));
    noter('il nomme le compte tombé', /Essai — compte épuisé/.test(await bloc.textContent()));
    noter(
      'aucun compte libre : le choix reste ouvert et le dit',
      (await bloc.locator('[data-reprise-attente]').count()) === 1 &&
        (await bloc.locator('[data-compte-reprise]').count()) === 0,
    );
    noter('le compte à sec est nommé, avec son échéance', /Essai — relève/.test(await bloc.textContent()));

    /* 2. Un compte se libère : le bouton apparaît TOUT SEUL. */
    await page.evaluate(
      ([quotas]) => window.__poserQuotas(quotas),
      [[compte('essai-compte-1', 'Essai — compte épuisé', false, { pct: 100, resetsAt: dansUneHeure }),
        compte('essai-compte-2', 'Essai — relève', true, { pct: 18 })]],
    );
    await page.waitForTimeout(500);
    const bouton = bloc.locator('[data-compte-reprise="essai-compte-2"]');
    noter('un compte qui se libère apparaît sans recharger la page', (await bouton.count()) === 1);
    noter('le bouton dit ce que le compte a déjà consommé', /18 %/.test((await bouton.textContent()) ?? ''));
    noter('la phrase « aucun compte libre » a disparu', (await bloc.locator('[data-reprise-attente]').count()) === 0);

    /* 3. Jamais un autre moteur, jamais le compte tombé. */
    await page.evaluate(
      ([quotas]) => window.__poserQuotas(quotas),
      [[compte('essai-compte-1', 'Essai — compte épuisé', true, { pct: 100 }),
        compte('essai-compte-2', 'Essai — relève', true, { pct: 18 }),
        { ...compte('essai-codex', 'Essai — Codex', true), engine: 'codex' },
        { ...compte('essai-coupe', 'Essai — coupé', true), disabled: true }]],
    );
    await page.waitForTimeout(400);
    noter(
      'ni le compte tombé, ni un autre moteur, ni un compte coupé',
      (await bloc.locator('[data-compte-reprise="essai-compte-1"]').count()) === 0 &&
        (await bloc.locator('[data-compte-reprise="essai-codex"]').count()) === 0 &&
        (await bloc.locator('[data-compte-reprise="essai-coupe"]').count()) === 0,
    );

    /* 4. Double clic : une seule commande part. */
    await page.evaluate(() => (window.__envois.length = 0));
    await bouton.click();
    await bouton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
    const envois = await page.evaluate(() =>
      window.__envois.filter((cmd) => cmd.type === 'reprise.compte'),
    );
    noter('un double clic n’envoie qu’une reprise', envois.length === 1, `${envois.length} envoi(s)`);
    noter(
      'la reprise nomme le message et le compte choisi',
      envois[0]?.messageId === 'essai-reprise-message' && envois[0]?.accountId === 'essai-compte-2',
    );

    /* 5. Téléphone : le bloc reste lisible et cliquable au doigt. */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    // Sur téléphone, la conversation vit derrière le bouton « Chef » du menu du
    // bas : sans ce clic, on mesurerait un bloc qui n'est pas à l'écran.
    await page.locator('nav[data-menu-bas] button', { hasText: 'Chef' }).first().click();
    await page.waitForTimeout(800);
    // Rouvrir la conversation la recharge depuis le serveur : le message
    // d'essai, lui, n'existe que dans le navigateur — on le repose.
    await page.evaluate(([id, r]) => window.__poserReprise(id, r), [chefId, reprise]);
    await page.waitForTimeout(600);
    const surTelephone = page.locator('[data-reprise-compte="attente"]:visible').first();
    const mesures = await surTelephone.evaluate((node) => {
      const cible = node.querySelector('[data-compte-reprise]');
      const bloc = node.getBoundingClientRect();
      return {
        largeur: bloc.width,
        deborde: bloc.right > window.innerWidth + 1,
        hauteurCible: cible ? cible.getBoundingClientRect().height : 0,
      };
    });
    noter('sur téléphone, le bloc ne déborde pas de l’écran', !mesures.deborde, `${Math.round(mesures.largeur)} px`);
    noter('la cible tactile fait au moins 32 px', mesures.hauteurCible >= 32, `${Math.round(mesures.hauteurCible)} px`);

    /* 6. Décision déjà prise — ce que montre un rechargement : plus de boutons. */
    await page.evaluate(
      ([id, r]) =>
        window.__poserReprise(id, {
          ...r,
          choisi: 'essai-compte-2',
          choisiLabel: 'Essai — relève',
          choisiA: Date.now(),
        }),
      [chefId, reprise],
    );
    await page.waitForTimeout(500);
    const repris = page.locator('[data-reprise-compte="reprise"]:visible').first();
    await repris.waitFor({ state: 'visible', timeout: 5_000 });
    noter('une fois repris, le bloc dit sur quel compte', /repris sur/.test(await repris.textContent()));
    noter('plus aucun bouton de reprise', (await page.locator('[data-compte-reprise]:visible').count()) === 0);

    /* 7. Relève automatique : le fil dit clairement qui a pris la suite. */
    await page.evaluate(
      ([id, r]) =>
        window.__poserReprise(id, {
          ...r,
          choisi: 'essai-compte-2',
          choisiLabel: 'Essai — relève',
          choisiA: Date.now(),
          automatique: true,
        }),
      [chefId, reprise],
    );
    await page.waitForTimeout(400);
    noter('la relève automatique est dite dans le fil', /automatiquement/.test((await repris.textContent()) ?? ''));

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
    session.retirer();
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
