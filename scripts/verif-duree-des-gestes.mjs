#!/usr/bin/env node
/**
 * L'HEURE ET LA DURÉE DE CHAQUE GESTE, DANS UN VRAI NAVIGATEUR.
 *
 * Le fil d'une carte disait CE QUE l'agent avait fait, jamais QUAND ni COMBIEN
 * DE TEMPS : la mesure existait dans le journal, l'affichage manquait. Ce
 * contrôle prouve les cinq promesses qui en découlent :
 *
 *   1. chaque geste porte « il y a 26 min · 1 min 32 s » : le temps écoulé,
 *      puis la durée (27/10/2026, captures #ae52 et #3c8a) ;
 *   2. un geste jamais chronométré n'affiche que le temps écoulé, jamais « 0 s » ;
 *   3. le temps total se lit en TÊTE de l'étape et en PIED de la liste, hors
 *      du repli « voir les N de plus » ;
 *   4. la mention vient EN DERNIER, sous la phrase, sur grand écran comme sur
 *      téléphone — un seul nœud ;
 *   5. le bloc de compréhension se lit d'UNE SEULE COULEUR, et ses points sont
 *      des VOLETS : le premier ouvert, et celui qu'on ouvre se retrouve au
 *      retour sur la carte.
 *
 * On pose une carte d'essai, on la lit, on la retire. Son titre porte « Carte
 * d'essai » : `nettoyer-essais.mjs` la ramasse même si ce script tombe.
 *
 *   env -u BELUGA_TOKEN BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-duree-des-gestes.mjs
 *
 * On vise le serveur de DÉVELOPPEMENT : BELUGA_URL désigne l'application publiée.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const SHOTS = `${dossierDesDonnees()}/verification`;
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const TITRE = "Carte d'essai — heure et durée de chaque geste";

/* TROIS GESTES AUX DURÉES CHOISIES : 1,5 s, 92 s (donc « 1 min 32 s », la forme
   exacte demandée), et un DERNIER jamais chronométré. */
const T0 = Date.now() - 3_600_000;
const GESTES = [
  { intention: 'Regarder l’état du dépôt', commande: 'git status', at: T0, duree: 1_500 },
  { intention: 'Lancer les tests du démon', commande: 'npm test', at: T0 + 10_000, duree: 92_000 },
  { intention: null, fichier: '/root/beluga/web/src/app.tsx', at: T0 + 110_000, duree: null },
];
/* L'ENVELOPPE ATTENDUE : du premier geste à la fin du dernier chronométré. */
const TOTAL_MS = T0 + 10_000 + 92_000 - T0;

const COMPREHENSION = [
  'Vous voulez lire le temps de chaque geste, et la compréhension d’une seule voix.',
  '',
  '1. L’heure et la durée à droite de chaque geste.',
  '2. Le temps total en tête et en pied.',
  '3. Les points de la compréhension en volets.',
  '',
  '**1. L’heure et la durée** — chaque geste dit quand il a commencé et combien il a pris.',
  'Comment : la mention se pose à droite de la phrase, sous elle sur téléphone.',
  'Résultat : on mesure la rapidité du travail sans rien déplier.',
  '',
  '**2. Le temps total** — le même total en tête de l’étape et sous la liste.',
  'Comment : l’enveloppe du passage, calculée par une règle pure partagée.',
  'Résultat : on sait ce que l’étape a coûté en temps, d’un coup d’œil.',
  '',
  '**3. Les volets** — le sommaire et les points développés ne font plus qu’une liste.',
  'Comment : l’entête d’un volet est la ligne de sommaire, son contenu le point.',
  'Résultat : on lit la liste entière, puis on descend dans ce qu’on veut.',
].join('\n');

async function main() {
  const db = new Database(cheminDeLaBaseServie());
  const projet = db.prepare('SELECT id FROM projects WHERE archived = 0 ORDER BY created_at LIMIT 1').get();
  if (!projet) throw new Error('Aucun projet actif dans la base servie.');

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3_600_000,
    'vérification durée des gestes',
  );

  const carteId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const tourId = `essai-${carteId}`;
  const maintenant = Date.now();

  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, conversation_agent_id)
     VALUES (?, ?, 'planned', 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    carteId,
    projet.id,
    TITRE,
    JSON.stringify({
      parcours: {
        comprehension: { texte: COMPREHENSION, hypotheses: [], sujets: [], tourId, at: T0 + 120_000 },
      },
    }),
    maintenant,
    maintenant,
    'Carte posée par un contrôle automatique.',
    agentId,
  );
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'cadrage', 'idle', ?, ?, ?)`,
  ).run(
    agentId,
    projet.id,
    carteId,
    JSON.stringify({
      id: agentId,
      projectId: projet.id,
      cardId: carteId,
      role: 'cadrage',
      title: TITRE,
      status: 'idle',
      run: { engine: 'claude', model: 'claude-opus-5', thinking: 'high' },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );
  db.prepare("INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, 'user', ?, ?)").run(
    `${agentId}-m1`,
    agentId,
    JSON.stringify({ id: `${agentId}-m1`, agentId, role: 'user', content: 'Carte d’essai : ne rien exécuter.', createdAt: maintenant }),
    maintenant,
  );

  const poser = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, donnees)
     VALUES (@id, @card_id, @rang, 'cadrage', @nature, @at, @agent_id, 'cadrage', @tour_id, @libelle, @outil, @params, @resultat, 1, @duree_ms, @donnees)`,
  );
  let rang = 0;
  for (const geste of GESTES) {
    rang += 1;
    poser.run({
      id: `${carteId}-g${rang}`,
      card_id: carteId,
      rang,
      nature: 'requete',
      at: geste.at,
      agent_id: agentId,
      tour_id: tourId,
      libelle: geste.commande ? 'Bash' : 'Read',
      outil: geste.commande ? 'Bash' : 'Read',
      params: JSON.stringify(
        geste.commande ? { command: geste.commande, description: geste.intention } : { file_path: geste.fichier },
      ),
      resultat: 'ok',
      duree_ms: geste.duree,
      donnees: null,
    });
  }
  rang += 1;
  poser.run({
    id: `${carteId}-c1`,
    card_id: carteId,
    rang,
    nature: 'jalon',
    at: T0 + 120_000,
    agent_id: agentId,
    tour_id: tourId,
    libelle: 'Compréhension',
    outil: null,
    params: null,
    resultat: COMPREHENSION,
    duree_ms: null,
    donnees: JSON.stringify({ hypotheses: ['Le journal porte déjà les durées.'], sujets: ['interface'] }),
  });

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 950 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  const adresse = `${BASE}/#projet/${encodeURIComponent(projet.id)}/tache/${encodeURIComponent(carteId)}`;

  /** Ouvre la carte, son passage « Compréhension », et la « Réflexion » qui cache les gestes. */
  async function ouvrirLeFil() {
    /* UN VRAI RECHARGEMENT : deux `goto` sur la MÊME adresse ne diffèrent que
       par leur fragment, et le navigateur ne recharge alors RIEN — l'état de
       l'écran survivrait, et le souvenir des volets ne serait jamais éprouvé. */
    if (page.url().startsWith(BASE)) await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    else await page.goto(adresse, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await attendre(6_000);
    /* LA CARTE EST UNE PAGE (`[data-page-carte]`), plus un tiroir. Le premier
       `[data-point]` du fil est « configuration », toujours `hidden` : on attend
       un point RÉELLEMENT affiché. */
    const tiroir = page.locator(`[data-page-carte="${carteId}"]`);
    await tiroir.locator('[data-point]:not([hidden])').first().waitFor({ timeout: 30_000 });
    const point = tiroir.locator('[data-point="comprehension"]').last();
    /* LES GESTES SE LISENT DANS LE FIL DU TOUR, RÉUNIS EN GROUPES REPLIÉS (13/11/2026) : on déplie chaque groupe pour
       que ses cartons se dessinent. */
    await point.locator('[data-groupe-bascule]').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    for (const bascule of await point.locator('[data-groupe-bascule][aria-expanded="false"]').all()) {
      await bascule.click();
      await attendre(300);
    }
    return { tiroir, point };
  }

  try {
    const { tiroir, point } = await ouvrirLeFil();
    noter('la carte d’essai s’ouvre sur son fil', (await tiroir.locator('[data-point]:not([hidden])').count()) > 0);

    /* ---------- 1. L'heure et la durée de chaque geste ---------- */

    const mentions = await point.locator('[data-duree-bloc]').allInnerTexts();
    noter(
      'chaque geste porte son heure et sa durée',
      mentions.length === 3,
      `${mentions.length} mention(s) : ${mentions.join(' | ')}`,
    );
    noter(
      'l’écriture est « il y a … · durée » (captures #ae52 et #3c8a)',
      mentions.filter((m) => /^(il y a .+|à l’instant) · .+$/.test(m.trim())).length === 2,
      mentions.join(' | '),
    );
    noter(
      'une durée de 92 s se dit « 1 min 32 s », pas « 1 min »',
      mentions.some((m) => m.includes('1 min 32 s')),
      mentions.join(' | '),
    );
    /* UN GESTE JAMAIS CHRONOMÉTRÉ : le temps écoulé, et AUCUNE durée. */
    noter(
      'un geste sans mesure n’affiche que le temps écoulé',
      mentions.filter((m) => /^(il y a [^·]+|à l’instant)$/.test(m.trim())).length === 1,
      mentions.join(' | '),
    );

    /* ---------- 2. Le total, en tête et en pied ---------- */

    const enTete = point.locator('[data-duree-totale-etape]').first();
    const enPied = point.locator('[data-duree-totale-pied]').first();
    noter(
      'le temps total se lit en tête de l’étape',
      (await enTete.count()) === 1 && (await enTete.innerText()).trim().length > 0,
      (await enTete.count()) ? (await enTete.innerText()).trim() : 'absent',
    );
    noter(
      'le même total est rappelé sous la liste des gestes',
      (await enPied.count()) === 1 && (await enPied.getAttribute('data-duree-totale-pied')) === String(TOTAL_MS),
      (await enPied.count()) ? (await enPied.innerText()).trim() : 'absent',
    );
    noter(
      'les deux totaux disent la même durée',
      (await enTete.count()) === 1 &&
        (await enPied.count()) === 1 &&
        (await enPied.innerText()).includes((await enTete.innerText()).trim()),
      `${(await enTete.count()) ? (await enTete.innerText()).trim() : '—'} / ${(await enPied.count()) ? (await enPied.innerText()).trim() : '—'}`,
    );
    /* LE TOTAL N'EST PAS DANS LE REPLI : il ne se cache pas derrière le bouton
       « voir les N de plus », qui ne sert qu'aux listes longues. */
    noter(
      'le total du pied vit hors du repli « voir les … de plus »',
      await enPied.evaluate((el) => !el.closest('[data-blocs-repli]')),
    );

    /* ---------- 3. Sur grand écran, la mention vient EN DERNIER, sous la phrase ---------- */

    const places = await point.evaluate(() => {
      const lues = [];
      for (const mention of document.querySelectorAll('[data-duree-bloc]')) {
        const phrase = mention.parentElement?.querySelector('[data-bloc-raconte-phrase]');
        if (!phrase) continue;
        const m = mention.getBoundingClientRect();
        const p = phrase.getBoundingClientRect();
        lues.push({ dessous: m.top >= p.bottom - 2, enDernier: mention.parentElement?.lastElementChild === mention || !mention.nextElementSibling });
      }
      return lues;
    });
    noter(
      'sur grand écran, la mention se pose sous la phrase, en dernier',
      places.length === 3 && places.every((p) => p.dessous && p.enDernier),
      JSON.stringify(places),
    );
    await page.screenshot({ path: `${SHOTS}/duree-des-gestes.png` });

    /* ---------- 4. Sur téléphone, elle passe DESSOUS ---------- */

    await page.setViewportSize({ width: 390, height: 844 });
    await attendre(1_200);
    const surTelephone = await point.evaluate(() => {
      const lues = [];
      for (const mention of document.querySelectorAll('[data-duree-bloc]')) {
        const phrase = mention.parentElement?.querySelector('[data-bloc-raconte-phrase]');
        if (!phrase) continue;
        const m = mention.getBoundingClientRect();
        const p = phrase.getBoundingClientRect();
        lues.push({ dessous: m.top >= p.bottom - 2, aGauche: Math.abs(m.left - p.left) < 4 });
      }
      return lues;
    });
    noter(
      'sur téléphone aussi, la mention est sous la phrase, alignée à gauche',
      surTelephone.length === 3 && surTelephone.every((p) => p.dessous && p.aGauche),
      JSON.stringify(surTelephone),
    );
    /* UN SEUL NŒUD, REPLACÉ : deux mentions dans le DOM se liraient deux fois. */
    noter(
      'la mention n’est rendue qu’UNE fois par geste',
      (await point.locator('[data-duree-bloc]').count()) === 3,
      `${await point.locator('[data-duree-bloc]').count()} nœud(s)`,
    );
    await page.screenshot({ path: `${SHOTS}/duree-des-gestes-telephone.png` });
    await page.setViewportSize({ width: 1400, height: 950 });
    await attendre(1_000);

    /* ---------- 5. Les points : un texte posé, plus de volets ----------
       La compréhension est un texte détaché (12/10/2026) : chaque point est une
       section dont le contenu se lit d'emblée, sans bascule ni mémoire d'ouverture. */

    const sections = tiroir.locator('[data-point-comprehension]');
    noter('les points de la compréhension sont des sections', (await sections.count()) === 3, `${await sections.count()} section(s)`);
    noter(
      'aucun volet à ouvrir : rien n’est replié',
      (await tiroir.locator('[data-volet-bascule]').count()) === 0,
      `${await tiroir.locator('[data-volet-bascule]').count()} bascule(s)`,
    );
    const apres = await ouvrirLeFil();
    await attendre(1_500);

    /* ---------- 6. La compréhension : une seule couleur ---------- */

    const bloc = apres.tiroir.locator('[data-comprehension-contenu]').last();
    await bloc.waitFor({ timeout: 20_000 }).catch(() => {});
    /* TOUS LES VOLETS OUVERTS D'ABORD, VOLET TECHNIQUE COMPRIS : un texte jamais
       dessiné ne peut pas être jugé. */
    for (const bascule of await bloc.locator('[data-volet-bascule]').all()) {
      const li = bascule.locator('xpath=ancestor::li[1]');
      if ((await li.getAttribute('data-volet-ouvert')) === 'non') await bascule.click();
    }
    const technique = bloc.locator('[data-comprehension-technique-bascule]').first();
    if ((await technique.count()) && (await bloc.locator('[data-comprehension-technique="replie"]').count())) {
      await technique.click();
    }
    await attendre(800);
    const couleurs = await bloc.evaluate((racine) => {
      const vues = new Map();
      const porteDuTexte = (el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      for (const el of racine.querySelectorAll('*')) {
        if (el.tagName === 'svg' || el.closest('svg')) continue;
        if (!porteDuTexte(el)) continue;
        const couleur = getComputedStyle(el).color;
        if (!vues.has(couleur)) vues.set(couleur, el.textContent.trim().slice(0, 40));
      }
      return [...vues.entries()];
    });
    noter(
      'tout le texte du bloc de compréhension est d’une seule couleur',
      couleurs.length === 1,
      couleurs.map(([c, t]) => `${c} « ${t} »`).join(' | '),
    );
    await page.screenshot({ path: `${SHOTS}/duree-des-gestes-comprehension.png` });

    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close().catch(() => undefined);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    if (process.env.BELUGA_GARDER) {
      console.log(`\ncarte d'essai gardée : ${carteId} (projet ${projet.id})`);
      db.close();
      return;
    }
    db.prepare('DELETE FROM card_journal WHERE card_id = ?').run(carteId);
    db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
    db.prepare('DELETE FROM cards WHERE id = ?').run(carteId);
    db.close();
  }

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) tenus.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
