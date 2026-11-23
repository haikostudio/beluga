/**
 * VÉRIFICATION — LES CARTES SYSTÈME DES TABLEAUX DE BORD (06/10/2026).
 *
 * Une carte Système (mise en production, dépannage, agent sans carte) est dans
 * « Actifs » tant qu'elle travaille ou attend une réponse ; finie, elle passe
 * 24 heures dans « Archiver », puis disparaît — sans rechargement. Elle ne
 * porte plus de point bleu et n'allume aucun repère. Sa hauteur suit son
 * contenu : nettement moins que les 178 px d'une carte.
 *
 * RECALÉ SUR LA REFONTE (11/10/2026). Le CADRE VIOLET de ces cartes a disparu
 * avec les couleurs d'état (« un état ne se dit plus par une couleur ») : une
 * carte Système a désormais « la même tenue que toute carte — un fond pâle,
 * aucun cadre » (`CLASSE_CADRE_SYSTEME`, `web/src/lib/gabarit-tableau.ts`).
 * L'assertion du cadre violet est donc traduite : aucun trait autour, et le
 * fond d'une carte (jeton `--surface`, un gris sans teinte), en clair comme en
 * sombre.
 *
 * Contrôle :
 *  - « Actifs » : la mise en production qui tourne, le dépannage au travail,
 *    l'agent arrêté sur sa question ;
 *  - « Archiver » : la mise en production finie et l'agent sans carte fini,
 *    rangés par date de fin, hors du compteur de la colonne ;
 *  - aucun point bleu, aucun repère bleu dans la colonne de gauche ;
 *  - tenue d'une carte (aucun cadre, fond `--surface`), hauteur au contenu et
 *    alignement sur la grille, en clair et en sombre, puis sur téléphone ;
 *  - la mise en production finie il y a 24 h moins quelques secondes quitte
 *    « Archiver » toute seule, page ouverte.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_SYSTEME_PORT`), plafond d'agents à zéro :
 * aucun moteur appelé, aucune publication réelle.
 *
 *   node scripts/verif-cartes-systeme-terminees.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_SYSTEME_PORT || 7232);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-cartes-systeme-terminees-',
  port: PORT,
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const JOUR = 24 * 60 * 60 * 1000;
/* La mise en production finie qui doit partir PENDANT le contrôle. */
const MARGE_AVANT_SORTIE_MS = 75_000;
const P1 = 's-interface';
const P2 = 's-serveur';

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton), t, t + 3_600_000, 'vérification des cartes Système terminées',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  for (const table of ['projects', 'deploys', 'agents']) db.prepare(`DELETE FROM ${table}`).run();
  /* Thème AUTOMATIQUE : le schéma de couleurs du navigateur choisit clair ou sombre. */
  db.prepare(
    'INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('theme', JSON.stringify('auto-origine-sombre'), t);

  const base = { defaultEngine: 'claude', isSelf: false, archived: false, deploiement: {}, miseEnProduction: {}, createdAt: t, updatedAt: t };
  for (const [rank, projet] of [
    [1, { ...base, id: P1, name: 'Interface', path: DEPOT }],
    [2, { ...base, id: P2, name: 'Serveur', path: DEPOT }],
  ]) {
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .run(projet.id, projet.name, projet.path, JSON.stringify({ ...projet, rank }), t, t);
  }

  const run = (projectId, patch) => ({
    id: `r-${projectId}`, projectId, state: 'running', cible: 'production', steps: [], cardIds: [], reprises: 0,
    repriseApresCoupure: false, queued: false, startedAt: t - 30_000, ...patch,
  });
  const poserRun = (r) =>
    db.prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.projectId, r.state, JSON.stringify(r), r.startedAt, r.endedAt ?? null);
  poserRun(run(P1, { currentStep: 'build', steps: [{ key: 'merge', state: 'done', log: '' }, { key: 'build', state: 'running', log: '' }] }));
  poserRun(run(P2, { state: 'success', startedAt: t - JOUR - 60_000, endedAt: t - JOUR + MARGE_AVANT_SORTIE_MS, steps: [{ key: 'merge', state: 'done', log: '' }] }));

  const agent = (id, projectId, patch) => ({
    id, projectId, role: 'task', title: id, run: { engine: 'claude', thinking: 'none' }, createdAt: t - 60_000, updatedAt: t, ...patch,
  });
  const poserAgent = (a) =>
    db.prepare(`INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`)
      .run(a.id, a.projectId, a.role, a.status, JSON.stringify(a), a.createdAt, a.updatedAt);
  poserAgent(agent('a-fini', P1, { title: 'Résumé rendu sans carte', status: 'done', startedAt: t - 900_000, endedAt: t - 600_000 }));
  poserAgent(agent('a-question', P2, { title: 'Attend votre choix', status: 'idle', attendReponse: true, startedAt: t - 120_000, endedAt: t - 60_000 }));
  poserAgent(agent('a-depannage', P2, {
    role: 'deploy', title: 'Dépannage', status: 'running', startedAt: t - 20_000, depannagePublication: { runId: `r-${P2}`, cible: 'production' },
  }));
  /* Fini depuis plus de 24 heures : plus de carte. */
  poserAgent(agent('a-avant-hier', P1, { title: 'Fini avant-hier', status: 'done', startedAt: t - 2 * JOUR, endedAt: t - 2 * JOUR + 60_000, updatedAt: t - 2 * JOUR }));
  db.close();
}

/** Où sont les cartes Système, et de quelle taille. */
const RELEVE = () => {
  const vignettes = [...document.querySelectorAll('[data-vignette-mise-en-production], [data-vignette-depannage], [data-vignette-agent-en-route]')];
  /* Le fond d'une carte, lu sur une sonde hors flux qui porte le jeton `--surface`. */
  const sonde = document.createElement('div');
  sonde.style.cssText = 'position:absolute;width:0;height:0;background-color:hsl(var(--surface))';
  document.body.append(sonde);
  const fondDeCarte = getComputedStyle(sonde).backgroundColor;
  sonde.remove();
  const canaux = (fondDeCarte.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return {
    fondDeCarte,
    /* Un gris SANS TEINTE : les trois canaux égaux. */
    fondSansTeinte: canaux.length === 3 && Math.max(...canaux) - Math.min(...canaux) <= 1,
    vignettes: vignettes.map((v) => {
      const r = v.getBoundingClientRect();
      const colonne = v.closest('[data-liste-terminee]') ? 'termines' : v.closest('[data-bande-productions], [data-bande-depannages], [data-bande-agents]') ? 'actifs' : null;
      const grilleParente = v.parentElement?.getBoundingClientRect();
      return {
        id: v.getAttribute('data-vignette-mise-en-production') ?? v.getAttribute('data-vignette-depannage') ?? v.getAttribute('data-vignette-agent-en-route'),
        colonne,
        hauteur: Math.round(r.height),
        aligne: !!grilleParente && Math.abs(r.left - grilleParente.left) < 1 && Math.abs(r.width - grilleParente.width) < 1,
        /* LA TENUE D'UNE CARTE : aucun trait autour du cadre (ni bordure ni contour), et le fond d'une carte. */
        ...(() => {
          const cadre = v.querySelector('[role="button"]');
          if (!cadre) return { sansCadre: false, fond: null };
          const s = getComputedStyle(cadre);
          const traits = ['Top', 'Right', 'Bottom', 'Left'].map((c) => (s[`border${c}Style`] === 'none' ? 0 : parseFloat(s[`border${c}Width`])));
          return { sansCadre: Math.max(...traits, s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth)) === 0, fond: s.backgroundColor };
        })(),
        /* Le reflet qui GLISSE dans la barre de travail sort par construction de
           son cadre, qui le rogne : il n'est pas un débordement. */
        deborde: [...v.querySelectorAll('*')]
          .filter((e) => !/animate-/.test(String(e.className)) && e.getBoundingClientRect().right > r.right + 1)
          .map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`)[0] ?? false,
      };
    }),
    points: document.querySelectorAll('[data-systeme-non-lu]').length,
    reperes: document.querySelectorAll('[data-repere-rendus]').length,
    sombre: document.documentElement.classList.contains('dark'),
  };
};

let navigateur;
try {
  if (!(await attendrePort())) throw new Error('le démon d’essai ne répond pas');
  poserDecor();
  navigateur = await chromium.launch({ channel: 'chrome', headless: true });

  const ouvrir = async (viewport, schema, telephone = false) => {
    const contexte = await navigateur.newContext({ viewport, isMobile: telephone, hasTouch: telephone, locale: 'fr-CH', serviceWorkers: 'block', colorScheme: schema });
    await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));
    await page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-en-route]', { timeout: 30_000 });
    await page.waitForTimeout(3_000);
    return { contexte, page, erreurs };
  };
  const ou = (releve, id) => releve.vignettes.find((v) => v.id === id);

  for (const schema of ['light', 'dark']) {
    const { contexte, page, erreurs } = await ouvrir({ width: 1400, height: 900 }, schema);
    const r = await page.evaluate(RELEVE);
    const nom = schema === 'dark' ? 'sombre' : 'clair';
    noter(`${nom} — le thème est bien ${nom}`, r.sombre === (schema === 'dark'));
    noter(`${nom} — « Actifs » : la mise en production en cours, le dépannage, l’agent qui attend sa réponse`,
      ou(r, P1)?.colonne === 'actifs' && ou(r, 'a-depannage')?.colonne === 'actifs' && ou(r, 'a-question')?.colonne === 'actifs',
      JSON.stringify(r.vignettes.map((v) => [v.id, v.colonne])));
    noter(`${nom} — « Archiver » : la mise en production finie et l’agent fini ; l’avant-hier n’est plus là`,
      ou(r, P2)?.colonne === 'termines' && ou(r, 'a-fini')?.colonne === 'termines' && !ou(r, 'a-avant-hier'),
      JSON.stringify(r.vignettes.map((v) => [v.id, v.colonne])));
    const ordre = await page.evaluate(() =>
      [...document.querySelectorAll('[data-liste-terminee] > *')].map((e) => e.getAttribute('data-vignette-mise-en-production') ?? e.getAttribute('data-vignette-agent-en-route') ?? 'carte'),
    );
    noter(`${nom} — « Archiver » range par date de fin, la plus récente en haut`, ordre.join(',') === `a-fini,${P2}`, ordre.join(','));
    noter(`${nom} — le compteur de « Archiver » ne compte pas les cartes Système`,
      (await page.evaluate(() => document.querySelector('[data-compte-en-route="archive"]')?.textContent?.trim() ?? null)) === '0');
    noter(`${nom} — aucune ne porte de point bleu, aucun repère bleu à gauche`, r.points === 0 && r.reperes === 0, JSON.stringify([r.points, r.reperes]));
    noter(`${nom} — tenue d’une carte (aucun cadre, fond « surface » sans teinte), hauteur au contenu (bien moins que 178 px), alignées sur la grille, rien ne déborde`,
      r.vignettes.length === 5 && r.fondSansTeinte &&
        r.vignettes.every((v) => v.sansCadre && v.fond === r.fondDeCarte && v.hauteur > 60 && v.hauteur < 140 && v.aligne && !v.deborde),
      JSON.stringify([r.fondDeCarte, ...r.vignettes.map((v) => [v.id, v.sansCadre, v.fond, v.hauteur, v.aligne, v.deborde])]));
    await page.screenshot({ path: path.join(TMP, `tableaux-de-bord-${nom}.png`) });
    noter(`${nom} — aucune erreur JavaScript`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }

  /* Téléphone : les deux colonnes défilent de côté. */
  {
    const { contexte, page, erreurs } = await ouvrir({ width: 390, height: 844 }, 'light', true);
    const r = await page.evaluate(RELEVE);
    noter('téléphone — mêmes cartes, hauteur au contenu, alignées, rien ne déborde',
      r.vignettes.length === 5 && r.vignettes.every((v) => v.hauteur < 150 && v.aligne && !v.deborde),
      JSON.stringify(r.vignettes.map((v) => [v.id, v.hauteur, v.aligne, v.deborde])));
    await page.screenshot({ path: path.join(TMP, 'tableaux-de-bord-telephone.png') });
    noter('téléphone — aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }

  /* 24 HEURES PASSÉES, PAGE OUVERTE : la mise en production finie s'en va seule. */
  {
    const { contexte, page, erreurs } = await ouvrir({ width: 1400, height: 900 }, 'light');
    noter('avant l’échéance, la mise en production finie est dans « Archiver »', (await page.locator(`[data-liste-terminee] [data-vignette-mise-en-production="${P2}"]`).count()) === 1);
    const debut = Date.now();
    await page.waitForSelector(`[data-vignette-mise-en-production="${P2}"]`, { state: 'detached', timeout: MARGE_AVANT_SORTIE_MS + 90_000 });
    noter('passé 24 heures, elle quitte « Archiver » sans rechargement', true, `${Math.round((Date.now() - debut) / 1000)} s d’attente`);
    noter('l’agent fini, lui, reste', (await page.locator('[data-liste-terminee] [data-vignette-agent-en-route="a-fini"]').count()) === 1);
    noter('échéance — aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }
} catch (err) {
  noter('le contrôle est allé au bout', false, `${err?.message ?? err}\n${journal.slice(-5).join('')}`);
} finally {
  await navigateur?.close();
  if (process.env.BELUGA_SYSTEME_CAPTURES) {
    fs.mkdirSync(process.env.BELUGA_SYSTEME_CAPTURES, { recursive: true });
    for (const nom of fs.readdirSync(TMP).filter((f) => f.endsWith('.png'))) {
      fs.copyFileSync(path.join(TMP, nom), path.join(process.env.BELUGA_SYSTEME_CAPTURES, nom));
    }
  }
  await nettoyer?.();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
