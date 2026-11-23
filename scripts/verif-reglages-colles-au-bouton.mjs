#!/usr/bin/env node
/**
 * LES RÉGLAGES DE L'AGENT D'UNE CARTE SONT TOUJOURS COLLÉS AU BOUTON
 * PRINCIPAL DE LA RANGÉE D'ACTION (moitié droite, jour d'un pixel, décision du
 * 21/10/2026 — jamais au bout de la rangée) — et une carte mise en ligne, qui
 * n'a plus aucun bouton, dit sous « Déploiement » quel agent a traité la
 * demande.
 *
 *   node scripts/verif-reglages-colles-au-bouton.mjs
 *
 * Démon d'essai à soi (base neuve, plafond d'agents à zéro, aucun moteur
 * appelé). Jamais `BELUGA_URL`. Deux cartes, sur ordinateur puis téléphone :
 *   1. « À déployer » : « Déployer » seul, l'icône des réglages COLLÉE à sa
 *      droite (écart ≤ 2 px), sur la même ligne, rien dans la barre d'écriture ;
 *   1 bis. « Planifié » : « Lancer », l'icône collée à sa droite, AVANT l'horloge ;
 *   2. archivée et mise en ligne : aucune rangée d'action, aucune icône, plus de
 *      point « Déploiement » dans le fil (13/11/2026, #b6079) ; la ligne des
 *      étapes, dépliée, lit à droite de « Travail » le moteur, le modèle, la
 *      réflexion et le compte de l'agent d'EXÉCUTION, et « Déployé » + sa date ;
 *   3. sur ordinateur, le module de VOIX (rendu visible) est au coin bas droit
 *      et AU-DESSUS de la discussion ouverte : le point en son centre lui
 *      appartient, la barre d'écriture ne le recouvre pas.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_RANGEE_PORT || 7231);
const BASE = `http://127.0.0.1:${PORT}`;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-reglages-rangee-',
  port: PORT,
  messageCommit: 'rangee',
});

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-essai';
const COMPTE = 'compte-essai@exemple.ch';

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), maintenant, maintenant + 3600_000, 'vérification réglages au bout de la rangée',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID, name: 'Essai rangée', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1,
    archived: false, createdAt: maintenant, updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  const poser = (id, colonne, titre, enPlus = {}) => {
    const agentId = `a-${id}`;
    const carte = {
      id, projectId: PROJET_ID, agentId, title: titre, description: 'Carte du contrôle.', labels: [],
      column: colonne, position: 1, origin: 'user',
      run: { engine: 'claude', model: 'claude-sonnet-5-5', thinking: 'high', mode: 'direct' },
      scheduling: { asap: false, attempts: 0, restarts: 0 },
      parcours: { comprehensionValidee: { at: maintenant - 50, version: 0 } },
      excludedFromDeploy: false, horsTache: false, createdAt: maintenant, updatedAt: maintenant, ...enPlus,
    };
    db.prepare(
      `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, PROJET_ID, colonne, 1, titre, JSON.stringify(carte), maintenant, maintenant);
    const agent = {
      id: agentId, projectId: PROJET_ID, cardId: id, role: 'task', title: titre,
      run: { engine: 'claude', model: 'claude-opus-5-5', thinking: 'high', mode: 'direct' },
      account: COMPTE, status: 'done', createdAt: maintenant, updatedAt: maintenant,
    };
    db.prepare(
      `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(agentId, PROJET_ID, id, 'task', 'done', JSON.stringify(agent), maintenant, maintenant);
    const demande = {
      id: `m-${id}`, agentId, role: 'user', content: 'Fais l’essai.', steps: [], todos: [], proposals: [],
      questions: [], downloads: [], attachments: [], createdAt: maintenant - 100,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      demande.id, agentId, 'user', JSON.stringify(demande), maintenant - 100,
    );
    /* LA RÉPONSE PORTE SON BLOC JSON DE CHIFFRAGE, que l'écran ne montre jamais. */
    const reponse = {
      id: `r-${id}`, agentId, role: 'assistant',
      content: 'C’est fait, tout est vert.\n\n```json\n{"machineSeconds": 600, "seniorHours": 0.5, "summary": "essai"}\n```',
      steps: [], todos: [], proposals: [], questions: [], downloads: [], attachments: [], createdAt: maintenant - 50,
    };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      reponse.id, agentId, 'assistant', JSON.stringify(reponse), maintenant - 50,
    );
    db.prepare(
      `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, reussie, donnees)
       VALUES (?, ?, 0, 'rapport', 'jalon', ?, ?, 'task', ?, 'Réponse rendue', ?, 1, ?)`,
    ).run(`j-${id}`, id, maintenant - 50, agentId, reponse.id, reponse.content, JSON.stringify({ compte: COMPTE }));
  };
  /* Le module de voix est caché par défaut : on le rend visible. */
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('voix.visible', 'true', maintenant);
  poser('c-a-deployer', 'to_deploy', 'Essai à déployer');
  poser('c-planifiee', 'planned', 'Essai planifié');
  poser('c-en-ligne', 'archived', 'Essai en ligne', { deployedAt: maintenant - 1000 });
  db.close();
}

async function ouvrir(page, carteId) {
  await page.goto(`${BASE}/#projet/${PROJET_ID}/tache/${carteId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
}

const lireRangee = (page) =>
  page.evaluate(() => {
    const barre = document.querySelector('[data-barre-action]');
    if (!barre) return null;
    const reglages = barre.querySelector('[data-reglages-du-lancement]')?.getBoundingClientRect();
    const principal = barre.querySelector('[data-geste-principal], [data-geste="deployer-lot"], [data-gestes-rangement] button')?.getBoundingClientRect();
    const horloge = null; // l'horloge de programmation a quitté l'écran (13/11/2026)
    const cadre = barre.getBoundingClientRect();
    return {
      reglages: reglages ? { x: reglages.x, y: reglages.y, droite: reglages.right } : null,
      principal: principal ? { y: principal.y, droite: principal.right } : null,
      horloge: horloge ? { x: horloge.x } : null,
      dansLaBarre: document.querySelectorAll('[data-rangee-de-boutons] [data-raccourci-reglages]').length,
      droiteBarre: cadre.right,
    };
  });

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  for (const [ecran, taille] of [['ordinateur', { width: 1400, height: 900 }], ['téléphone', { width: 390, height: 844 }]]) {
    await page.setViewportSize(taille);

    /* 1. « Déployer » seul, l'icône au bout. */
    await ouvrir(page, 'c-a-deployer');
    if (ecran === 'ordinateur') {
      await page.mouse.move(20, 120);
      await page.waitForTimeout(600);
      const voix = await page.evaluate(() => {
        const module = document.querySelector('[data-module-voix]');
        if (!module) return null;
        const r = module.getBoundingClientRect();
        const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          droite: Math.round(window.innerWidth - r.right),
          bas: Math.round(window.innerHeight - r.bottom),
          auDessus: !!dessus && module.contains(dessus),
          /* Le robot de l'assistant tient le coin : la voix se pose à sa gauche, sans le chevaucher. */
          robot: (() => { const b = document.querySelector('[data-terminal-rond]'); if (!b) return null; const q = b.getBoundingClientRect(); const d = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { visible: !!d && b.contains(d), x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width) }; })(),
          chevaucheRobot: (() => {
            const robot = document.querySelector('[data-terminal-rond]')?.getBoundingClientRect();
            return !!robot && !(r.right <= robot.left || r.left >= robot.right || r.bottom <= robot.top || r.top >= robot.bottom);
          })(),
        };
      });
      noter(
        'ordinateur — discussion ouverte : la voix est au coin bas droit, au-dessus de tout',
        !!voix && voix.auDessus && !voix.chevaucheRobot && voix.droite >= 0 && voix.droite <= 130 && voix.bas >= 0 && voix.bas <= 40,
        JSON.stringify(voix),
      );
      if (process.env.CAPTURE_VOIX) await page.screenshot({ path: process.env.CAPTURE_VOIX });
    }
    const colle = (r) =>
      !!r && !!r.reglages && !!r.principal &&
      r.reglages.x - r.principal.droite >= 0 && r.reglages.x - r.principal.droite <= 2 &&
      Math.abs(r.reglages.y - r.principal.y) < 2 && r.reglages.droite <= r.droiteBarre + 1;
    const r = await lireRangee(page);
    noter(
      `${ecran} — « À déployer » : l’icône des réglages est collée à droite de « Déployer », même ligne`,
      colle(r),
      JSON.stringify(r),
    );
    noter(`${ecran} — « À déployer » : plus d’icône des réglages dans la barre d’écriture`, r?.dansLaBarre === 0, String(r?.dansLaBarre));
    const texteDuFil = await page.evaluate(() => document.body.innerText ?? '');
    noter(
      `${ecran} — la réponse se lit, sans son bloc json de chiffrage`,
      texteDuFil.includes('C’est fait, tout est vert.') && !texteDuFil.includes('machineSeconds'),
      texteDuFil.includes('machineSeconds') ? 'bloc json visible' : texteDuFil.includes('C’est fait') ? '' : 'réponse absente',
    );

    /* 1 bis. Carte au repos : « Lancer », ses réglages collés, l'horloge après. */
    await ouvrir(page, 'c-planifiee');
    const p = await lireRangee(page);
    noter(
      `${ecran} — « Planifié » : les réglages sont collés à droite de « Lancer », avant l’horloge`,
      colle(p) && (!p.horloge || p.horloge.x >= p.reglages.droite + 4),
      JSON.stringify(p),
    );

    /* 2. Carte en ligne : plus de rangée, plus de point « Déploiement » ; moteur et date dans la ligne des étapes. */
    await ouvrir(page, 'c-en-ligne');
    if ((await page.locator('[data-ligne-etapes]:visible').getAttribute('data-ligne-ouverte')) === null) {
      await page.locator('[data-barre-en-ligne]:visible').click();
      await page.waitForTimeout(400);
    }
    const etat = await page.evaluate(() => ({
      barre: document.querySelectorAll('[data-barre-action]').length,
      icones: document.querySelectorAll('[data-raccourci-reglages]').length,
      point: document.querySelectorAll('[data-point="deploiement"]').length,
      moteur: document.querySelector('[data-moteur-du-travail]')?.textContent?.trim() ?? null,
      date: document.querySelector('[data-segment="a_deployer"]')?.textContent?.trim() ?? null,
    }));
    noter(`${ecran} — carte en ligne : aucune rangée d’action ni icône des réglages`, etat.barre === 0 && etat.icones === 0, JSON.stringify(etat));
    noter(
      `${ecran} — carte en ligne : plus de point « Déploiement », le moteur d’exécution à droite de « Travail »`,
      etat.point === 0 && !!etat.moteur && /Opus/.test(etat.moteur) && etat.moteur.includes(COMPTE),
      JSON.stringify(etat),
    );
    noter(`${ecran} — carte en ligne : l’étape s’appelle « Déployé » et porte sa date`, !!etat.date && etat.date.startsWith('Déployé ·'), etat.date ?? 'absente');
  }

  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join(''));
  process.exit(1);
});
