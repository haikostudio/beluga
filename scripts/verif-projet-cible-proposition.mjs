#!/usr/bin/env node
/**
 * Le PROJET où une carte proposée va naître se lit EN CLAIR : une ligne
 * « icône + nom du projet » au-dessus du titre, sur la vignette « À valider »
 * du bandeau comme sur l'encadré « Carte créée » — et plus aucune icône seule
 * devant le titre.
 *
 *   node scripts/verif-projet-cible-proposition.mjs
 *   HAIKO_CAPTURES=/chemin node scripts/verif-projet-cible-proposition.mjs   (captures clair / sombre)
 *
 * Banc : le fil de l'assistant flottant (`Chat` → `MessageView` + bandeau des
 * propositions), dans un démon jetable monté depuis CETTE copie — base neuve,
 * aucun moteur appelé.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_PROJET_CIBLE_PORT || 7193);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.HAIKO_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-projet-cible-',
  port: PORT,
  depot: false,
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const jeton = crypto.randomBytes(32).toString('hex');
const NOM_LONG = 'Boutique en ligne des ateliers de céramique du Haut-Doubs et de la vallée';
const TITRE_ATTENTE = 'Refaire la page des tarifs';
const TITRE_ACCEPTEE = 'Corriger le formulaire de contact';

async function poserLeDecor() {
  process.env.BELUGA_DATA = DATA;
  const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const { getDb } = await import(path.join(RACINE, 'server/dist/db.js'));
  const db = getDb();
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(jeton).digest('hex'), t, t + 3600_000, 'vérification projet cible',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  for (const [id, name] of [['p-maison', 'Kipou'], ['p-ailleurs', NOM_LONG]]) {
    const dossier = path.join(PROJETS, id);
    fs.mkdirSync(dossier, { recursive: true });
    store.saveProject(shared.Project.parse({ id, name, path: dossier, createdAt: t, updatedAt: t }));
  }
  const { agentAssistantGlobal } = await import(path.join(RACINE, 'server/dist/assistant-global.js'));
  const agent = agentAssistantGlobal();
  if (!agent) throw new Error('assistant introuvable');

  const carte = store.saveCard(shared.Card.parse({
    id: 'c-acceptee', projectId: 'p-maison', title: TITRE_ACCEPTEE, column: 'planned', position: 1,
    run: { engine: 'claude' }, createdAt: t, updatedAt: t,
  }));
  const message = (id, contenu, decalage, proposals) =>
    store.saveMessage(shared.Message.parse({ id, agentId: agent.id, role: 'assistant', content: contenu, createdAt: t + decalage, proposals }));
  message('m-1', 'Voici une carte pour le formulaire.', 0, [
    { id: 'pr-acceptee', title: TITRE_ACCEPTEE, description: 'Le formulaire de contact n’envoie plus rien.', decision: 'accepted', cardId: carte.id, projectId: 'p-maison' },
  ]);
  message('m-2', 'Et une autre pour le site de la boutique.', 1000, [
    { id: 'pr-attente', title: TITRE_ATTENTE, description: 'Les prix affichés ne sont plus les bons.', projectId: 'p-ailleurs' },
  ]);
  return { agent };
}

async function ouvrirLAssistant(page, telephone) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const rond = page.locator('[data-bouton-du-bord]:visible').first();
  await rond.waitFor({ timeout: 20000 });
  await attendre(1500);
  // Le toucher du bouton du bord lance la voix : le volet s'ouvre en texte par le point d'essai.
  if ((await rond.getAttribute('data-ouvert')) !== 'oui') await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  await page.locator('[data-vignette="proposition"]').first().waitFor({ timeout: 20000 }).catch(() => undefined);
  await page.mouse.move(2, 2);
  await attendre(800);
}

/** La ligne du projet est-elle AU-DESSUS du titre, avec son nom, dans le cadre ? */
async function relever(page, conteneur) {
  return page.evaluate((sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const ligne = n.querySelector('[data-projet-de-proposition]');
    const titre = n.querySelector('[data-titre-de-proposition]');
    const nom = ligne?.querySelector('[data-nom-projet-de-proposition]');
    const l = ligne?.getBoundingClientRect();
    const ti = titre?.getBoundingClientRect();
    const v = n.getBoundingClientRect();
    const no = nom?.getBoundingClientRect();
    return {
      projet: ligne?.getAttribute('data-projet-de-proposition') ?? '',
      nom: nom?.textContent ?? '',
      auDessus: !!(l && ti && l.bottom <= ti.top + 1),
      dansLeCadre: !!(no && no.right <= v.right + 1 && no.left >= v.left),
      tronque: !!(nom && nom.scrollWidth > nom.clientWidth),
      lignes: n.querySelectorAll('[data-projet-de-proposition]').length,
      /* Plus d'icône seule rangée à côté du titre. */
      iconeAcoteDuTitre: !!titre?.parentElement?.querySelector(':scope > [role="img"]'),
    };
  }, conteneur);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  await poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [nom, viewport, telephone] of [
      ['ordinateur', { width: 1440, height: 900 }, false],
      ['telephone', { width: 390, height: 844 }, true],
    ]) {
      const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', serviceWorkers: 'block', ...(telephone ? { isMobile: true, hasTouch: true } : {}) });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      try {
        await ouvrirLAssistant(page, telephone);
        const v = await relever(page, '[data-vignette="proposition"]');
        noter(`${nom} · la vignette « À valider » nomme le projet où la carte naîtra`, v?.projet === 'p-ailleurs' && v?.nom === NOM_LONG, JSON.stringify(v));
        noter(`${nom} · la ligne du projet est au-dessus du titre, une seule fois`, v?.auDessus && v?.lignes === 1 && !v?.iconeAcoteDuTitre);
        noter(`${nom} · un nom long reste dans la vignette (tronqué)`, v?.dansLeCadre && v?.tronque);
        const a = await relever(page, '[data-carte-proposee="validee"]');
        noter(`${nom} · l'encadré « Carte créée » nomme son projet au-dessus du titre`, a?.projet === 'p-maison' && a?.nom === 'Kipou' && a?.auDessus && a?.lignes === 1 && !a?.iconeAcoteDuTitre, JSON.stringify(a));
        noter(`${nom} · rien ne déborde en largeur`, await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 0));

        /* Mode édition : la ligne reste au-dessus du champ du titre. */
        const vignette = page.locator('[data-vignette="proposition"]').first();
        await vignette.getByRole('button', { name: 'Modifier' }).click();
        await attendre(300);
        const edition = await page.evaluate(() => {
          const n = document.querySelector('[data-vignette="proposition"]');
          const l = n?.querySelector('[data-projet-de-proposition]')?.getBoundingClientRect();
          const champ = n?.querySelector('input')?.getBoundingClientRect();
          return !!(l && champ && l.bottom <= champ.top + 1);
        });
        noter(`${nom} · en modification, la ligne du projet reste au-dessus du champ du titre`, edition);
        if (CAPTURES) {
          for (const sombre of [false, true]) {
            await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
            await attendre(300);
            await page.screenshot({ path: path.join(CAPTURES, `${nom}-edition-${sombre ? 'sombre' : 'clair'}.png`) });
          }
          await page.evaluate(() => document.documentElement.classList.toggle('dark', false));
        }
        await vignette.getByRole('button', { name: 'Terminer' }).click();
        await page.mouse.move(2, 2);
        await attendre(300);
        if (CAPTURES) {
          for (const sombre of [false, true]) {
            await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
            await attendre(300);
            await page.screenshot({ path: path.join(CAPTURES, `${nom}-${sombre ? 'sombre' : 'clair'}.png`) });
            const acceptee = page.locator('[data-carte-proposee="validee"]').first();
            await acceptee.scrollIntoViewIfNeeded();
            await attendre(200);
            await page.screenshot({ path: path.join(CAPTURES, `${nom}-carte-creee-${sombre ? 'sombre' : 'clair'}.png`) });
          }
        }
        noter(`${nom} · aucune erreur de page`, erreurs.length === 0, erreurs[0] ?? '');
      } finally {
        await contexte.close();
      }
    }
  } finally {
    await navigateur.close();
    nettoyer?.();
  }
  const ok = resultats.filter((r) => r.ok).length;
  console.log(`\n${ok}/${resultats.length} contrôles passés`);
  process.exit(ok === resultats.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  nettoyer?.();
  process.exit(1);
});
