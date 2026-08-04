#!/usr/bin/env node
/**
 * Une carte proposée pendant une conversation Codex part-elle bien sur Codex ?
 *
 * Deux relevés, du plus profond au plus visible :
 *   1. la RÈGLE, jouée sur le catalogue RÉEL de cette machine : une proposition
 *      faite sous Codex ne peut pas ressortir avec un modèle Claude ;
 *   2. l'ÉCRAN, dans un vrai navigateur : la carte à valider affiche le moteur
 *      et le modèle de la conversation, et ses trois réglages s'ouvrent encore.
 *
 * Une proposition d'essai est posée en base le temps du relevé, puis retirée ;
 * le projet ouvert au départ est remis en place en partant.
 *
 *   node scripts/verif-reglages-proposition.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { catalogueMoteurs } from '../server/dist/catalogue-moteurs.js';
import { listEngines } from '../server/dist/engines/index.js';
import { reglagesDeLaProposition } from '../shared/dist/reglages-proposition.js';

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const BASE_DB = '/root/haikodev/data/haikodev.db';
const CLE_PROJET_ACTIF = 'project.active';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on vérifie l'écran, pas le mur d'accès. */
function poserSession() {
  const db = new Database(BASE_DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification réglages de proposition',
  );
  db.close();
  return { token, empreinte };
}

/** La conversation de chef d'orchestre où poser la proposition d'essai. */
function chefDOrchestre() {
  const db = new Database(BASE_DB, { readonly: true });
  const ligne = db
    .prepare(
      `SELECT a.id AS agentId, a.project_id AS projectId, p.name AS nom
         FROM agents a JOIN projects p ON p.id = a.project_id
        WHERE a.role = 'orchestrator' AND p.archived = 0
        ORDER BY p.name = 'HaikoDev' DESC, a.created_at DESC LIMIT 1`,
    )
    .get();
  db.close();
  return ligne;
}

function poserProposition(agentId, run) {
  const db = new Database(BASE_DB);
  const id = crypto.randomUUID();
  const message = {
    id,
    agentId,
    role: 'assistant',
    content: "Vérification automatique : proposition d'essai, à retirer.",
    steps: [],
    todos: [],
    proposals: [
      {
        id: crypto.randomUUID(),
        title: "Essai — réglages hérités de la conversation",
        description: 'Proposition posée par un script de vérification. Elle disparaît toute seule.',
        labels: [],
        run,
        decision: 'pending',
      },
    ],
    questions: [],
    downloads: [],
    attachments: [],
    streaming: false,
    createdAt: Date.now(),
  };
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    agentId,
    'assistant',
    JSON.stringify(message),
    message.createdAt,
  );
  db.close();
  return id;
}

function retirer(messageId, empreinte, projetAvant) {
  const db = new Database(BASE_DB);
  if (messageId) db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
  if (empreinte) db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  if (projetAvant === null) db.prepare('DELETE FROM preferences WHERE key = ?').run(CLE_PROJET_ACTIF);
  else if (projetAvant !== undefined)
    db.prepare(
      'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(CLE_PROJET_ACTIF, projetAvant, Date.now());
  db.close();
}

function viserProjet(projectId) {
  const db = new Database(BASE_DB);
  const avant = db.prepare('SELECT value FROM preferences WHERE key = ?').get(CLE_PROJET_ACTIF);
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(CLE_PROJET_ACTIF, JSON.stringify(projectId), Date.now());
  db.close();
  return avant ? avant.value : null;
}

async function main() {
  /* ---------------- 1. La règle, sur le catalogue réel ---------------- */

  const catalogue = await catalogueMoteurs();
  const codex = catalogue.find((m) => m.id === 'codex');
  const claude = catalogue.find((m) => m.id === 'claude');
  console.log(
    `Catalogue lu sur cette machine : ${catalogue
      .map((m) => `${m.label} ${m.installed ? `(${m.models.length} modèles, ${m.comptesDisponibles} compte(s))` : '(absent)'}`)
      .join(' · ')}`,
  );

  if (!codex?.installed || !claude?.installed) {
    console.log('Les deux moteurs ne sont pas installés ici : la règle ne peut pas être jouée pour de vrai.');
    process.exit(0);
  }

  const modelesClaude = new Set(claude.models.map((m) => m.id));
  const sousCodex = reglagesDeLaProposition({ engine: 'codex' }, catalogue);
  noter(
    'sous Codex, le modèle proposé vient du catalogue Codex',
    !!sousCodex && codex.models.some((m) => m.id === sousCodex.model),
    `${sousCodex?.model} / réflexion ${sousCodex?.thinking}`,
  );

  const modeleEmprunte = reglagesDeLaProposition(
    { engine: 'codex', model: claude.models[0].id, thinking: 'xhigh' },
    catalogue,
  );
  noter(
    'un modèle Claude glissé dans une proposition Codex est écarté',
    !!modeleEmprunte && !modelesClaude.has(modeleEmprunte.model ?? ''),
    `rendu : ${modeleEmprunte?.model}`,
  );

  const sansCompte = reglagesDeLaProposition(
    { engine: 'codex' },
    catalogue.map((m) => (m.id === 'codex' ? { ...m, comptesDisponibles: 0 } : m)),
  );
  noter(
    'un moteur sans compte se dit, et le moteur ne change pas dans le dos',
    sansCompte?.engine === 'codex' && /aucun compte/i.test(sansCompte?.avertissement ?? ''),
    sansCompte?.avertissement ?? '(aucun avertissement)',
  );

  /* ---------------- 2. L'écran, dans un vrai navigateur ---------------- */

  const chef = chefDOrchestre();
  if (!chef) {
    console.log('Aucune conversation de chef d’orchestre en base : rien à montrer à l’écran.');
    process.exit(resultats.some((r) => !r.ok) ? 1 : 0);
  }
  console.log(`Conversation d’essai : chef d’orchestre de « ${chef.nom} ».`);

  const attendu = sousCodex;
  // Les libellés affichés viennent du catalogue du moteur, pas des identifiants.
  const moteurs = await listEngines();
  const codexInfo = moteurs.find((m) => m.id === 'codex');
  const claudeInfo = moteurs.find((m) => m.id === 'claude');
  const libelleModele = codexInfo?.models.find((m) => m.id === attendu.model)?.label ?? attendu.model;
  let messageId;
  let projetAvant;
  let empreinte;
  let navigateur;
  try {
    projetAvant = viserProjet(chef.projectId);
    messageId = poserProposition(chef.agentId, {
      engine: attendu.engine,
      model: attendu.model,
      thinking: attendu.thinking,
      mode: 'direct',
    });

    const session = poserSession();
    empreinte = session.empreinte;
    navigateur = await chromium.launch({
      channel: 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    });
    const context = await navigateur.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'haikodev_session', value: session.token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (error) => erreurs.push(String(error)));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    // L'application peut rouvrir sur un panneau : la conversation du chef vit
    // dans la colonne de droite, et se retrouve à l'Échap près.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);

    /* Le cadre ENTIER de la carte à valider — titre, avertissement et barre de
       réglages — et non le seul paragraphe du titre. */
    const bloc = page
      .getByText('Essai — réglages hérités de la conversation')
      .first()
      .locator('xpath=ancestor::div[contains(@class,"border-accent/40")][1]');
    const vu = (await bloc.count()) > 0;
    noter('la proposition d’essai est bien affichée', vu);

    if (vu) {
      await bloc.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
      const texte = (await bloc.innerText()).replace(/\s+/g, ' ');
      noter('le moteur de la conversation est affiché sur la carte à valider', texte.includes(codex.label), texte.slice(0, 160));
      noter(
        'le modèle affiché est celui du moteur retenu',
        texte.toLowerCase().includes(libelleModele.toLowerCase()),
        `attendu : ${libelleModele}`,
      );
      // Aucun libellé de modèle Claude ne doit apparaître sur une carte Codex.
      const intrus = (claudeInfo?.models ?? [])
        .map((m) => m.label)
        .filter((label) => texte.toLowerCase().includes(label.toLowerCase()));
      noter('aucun modèle Claude n’apparaît sur une proposition Codex', intrus.length === 0, intrus.join(', '));

      // Les trois réglages restent MODIFIABLES : le menu du moteur s'ouvre.
      const menuMoteur = bloc.getByRole('button', { name: new RegExp(codex.label, 'i') }).first();
      if (await menuMoteur.count()) {
        await menuMoteur.click({ force: true });
        await page.waitForTimeout(1200);
        const ouvert = await page.getByRole('menu').count();
        noter('les réglages restent modifiables avant validation', ouvert > 0);
        await page.keyboard.press('Escape');
      } else {
        noter('les réglages restent modifiables avant validation', false, 'menu du moteur introuvable');
      }
    }

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    retirer(messageId, empreinte, projetAvant);
  }

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
