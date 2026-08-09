#!/usr/bin/env node
/**
 * Le pourcentage de contexte dans le composeur commun : chef, carte, thèmes,
 * téléphone, vraie valeur zéro, seuils 49/50, compression et indisponibilité.
 * Les agents et la carte sont injectés dans le canal temps réel ; seule la
 * session d'essai touche la base, puis elle est retirée.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HAIKO_CONTEXTE_URL || 'http://localhost:7099';
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';
const PRINCIPAL = path.resolve(DONNEES, '..');
const CAPTURES = path.join(DONNEES, 'verification');
const resultats = [];

function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function sessionEssai() {
  const require = createRequire(import.meta.url);
  const db = require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3_600_000,
    'vérification contexte composeur',
  );
  db.close();
  return {
    cookie,
    retirer() {
      const suite = require(path.join(PRINCIPAL, 'node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));
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
    window.__agentsContexte = {};
    window.__ecouteursContexte = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteursContexte.push(ecouteur);
        return propriete.set.call(this, (event) => {
          try {
            const charge = JSON.parse(event.data);
            for (const agent of charge.agents ?? []) window.__agentsContexte[agent.id] = agent;
            if (charge.agent) window.__agentsContexte[charge.agent.id] = charge.agent;
          } catch {}
          return ecouteur.call(this, event);
        });
      },
    });
    window.__injecterContexte = (charge) => {
      if (charge.agent) window.__agentsContexte[charge.agent.id] = charge.agent;
      const event = { data: JSON.stringify(charge) };
      for (const ecouteur of window.__ecouteursContexte) ecouteur.call(window, event);
    };
    window.__mesurerContexte = (agentId, usedTokens, capacityTokens, percentage) => {
      const agent = structuredClone(window.__agentsContexte[agentId]);
      if (percentage === null) delete agent.contextUsage;
      else agent.contextUsage = { usedTokens, capacityTokens, percentage, measuredAt: Date.now() };
      window.__injecterContexte({ type: 'agent.upsert', agent });
    };
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(5_000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);

    const chef = page.locator('[data-contexte-agent]:visible').first();
    await chef.waitFor({ state: 'visible', timeout: 15_000 });
    const chefId = await chef.getAttribute('data-agent-contexte');
    noter('le composeur du chef porte la capsule', !!chefId, chefId ?? 'agent absent');
    if (!chefId) throw new Error('agent du chef introuvable');

    const verifier = async (pourcentage, texte) => {
      await page.evaluate(([id, p]) => window.__mesurerContexte(id, p * 1_000, 100_000, p), [chefId, pourcentage]);
      await page.waitForTimeout(250);
      noter(`le chef affiche ${texte}`, (await chef.textContent())?.trim() === texte);
    };
    await verifier(0, '0 %');
    await verifier(49, '49 %');
    await verifier(50, '50 %');
    await verifier(18, '18 %');
    noter('la compression remplace la mesure précédente', (await chef.textContent())?.trim() === '18 %');

    await page.evaluate((id) => window.__mesurerContexte(id, 0, 0, null), chefId);
    await page.waitForTimeout(250);
    noter('sans donnée, aucun zéro n’est inventé', (await chef.textContent())?.trim() === '—');
    noter('le détail nomme la mesure indisponible', /indisponible/.test((await chef.getAttribute('aria-label')) ?? ''));

    const placement = await chef.evaluate((capsule) => {
      const champ = capsule.parentElement;
      const zone = champ?.querySelector('textarea');
      if (!champ || !zone) return null;
      const c = capsule.getBoundingClientRect();
      const f = champ.getBoundingClientRect();
      return {
        dedans: c.top >= f.top && c.right <= f.right + 1,
        reserve: Number.parseFloat(getComputedStyle(zone).paddingRight) >= c.width + 8,
      };
    });
    noter('la capsule reste en haut à droite du champ', !!placement?.dedans);
    noter('le texte garde une réserve et ne passe pas sous la capsule', !!placement?.reserve);

    const couleurs = [];
    for (const sombre of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), sombre);
      await page.waitForTimeout(150);
      couleurs.push(await chef.evaluate((node) => {
        const style = getComputedStyle(node);
        return { texte: style.color, fond: style.backgroundColor, bord: style.borderColor };
      }));
    }
    noter('la capsule suit les deux thèmes', couleurs.every((c) => c.texte !== c.fond && c.bord !== 'rgba(0, 0, 0, 0)'));

    const carteId = 'essai-contexte-composeur';
    const agentCarteId = 'essai-agent-contexte-composeur';
    const chefAgent = await page.evaluate((id) => window.__agentsContexte[id], chefId);
    await page.evaluate(
      ([projectId, cardId, agentId]) => {
        const maintenant = Date.now();
        window.__injecterContexte({
          type: 'card.upsert',
          card: {
            id: cardId, projectId, title: 'Essai contexte du composeur', description: '', labels: [],
            column: 'planned', position: maintenant, origin: 'user', run: { engine: 'codex', mode: 'direct' },
            excludedFromDeploy: false, horsTache: false, agentId, createdAt: maintenant, updatedAt: maintenant,
          },
        });
        window.__injecterContexte({
          type: 'agent.upsert',
          agent: {
            id: agentId, projectId, cardId, role: 'analysis', title: 'Analyse de la carte',
            run: { engine: 'codex', mode: 'direct' }, status: 'idle',
            contextUsage: { usedTokens: 50_000, capacityTokens: 100_000, percentage: 50, measuredAt: maintenant },
            createdAt: maintenant, updatedAt: maintenant,
          },
        });
      },
      [chefAgent.projectId, carteId, agentCarteId],
    );
    await page.waitForTimeout(500);
    // L'application peut reprendre un tiroir laissé ouvert lors d'une visite
    // précédente. On le referme avant de cliquer la carte injectée.
    for (let tentative = 0; tentative < 3; tentative += 1) {
      if (!(await page.locator('[role="dialog"]:visible').count())) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    const carte = page.locator(`[data-carte="${carteId}"]`).first();
    await carte.scrollIntoViewIfNeeded();
    await carte.click();
    const capsuleCarte = page.locator(`[data-agent-contexte="${agentCarteId}"]:visible`);
    await capsuleCarte.waitFor({ state: 'visible', timeout: 8_000 });
    noter('le composeur d’une carte affiche la même mesure', (await capsuleCarte.textContent())?.trim() === '50 %');

    await page.evaluate((id) => {
      const agent = structuredClone(window.__agentsContexte[id]);
      agent.role = 'task';
      agent.title = 'Exécution de la carte';
      agent.contextUsage = { usedTokens: 49_000, capacityTokens: 100_000, percentage: 49, measuredAt: Date.now() };
      window.__injecterContexte({ type: 'agent.upsert', agent });
    }, agentCarteId);
    await page.waitForTimeout(250);
    noter('le même composeur suit aussi l’agent d’exécution', (await capsuleCarte.textContent())?.trim() === '49 %');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const mobile = await capsuleCarte.evaluate((capsule) => {
      const champ = capsule.parentElement;
      const c = capsule.getBoundingClientRect();
      const f = champ.getBoundingClientRect();
      return c.left >= f.left && c.right <= f.right && c.top >= f.top && c.bottom <= f.bottom;
    });
    noter('sur téléphone, la capsule reste entièrement dans le champ', mobile);
    noter('les réglages et l’envoi restent visibles sur téléphone', (await page.locator('button[title="Envoyer"]:visible').count()) > 0);
    await page.screenshot({ path: path.join(CAPTURES, 'contexte-composeur-telephone.png') });
    noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
    session.retirer();
  }

  const echecs = resultats.filter((item) => !item.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  if (echecs.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
