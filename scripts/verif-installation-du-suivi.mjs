#!/usr/bin/env node
/**
 * L'INSTALLATION DU SUIVI, DE BOUT EN BOUT (carte « Services et fils d'Ariane fiables », 20/11/2026, captures #c7fe et
 * #1fbc : « après que j'ai sélectionné ce truc, j'ai pas de bouton en bas »).
 *
 *   npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-installation-du-suivi.mjs
 *
 * Démon jetable, base neuve, aucun agent lancé (`maxAgents: 0`). Quatre sites, un par état :
 *   - SANS SUIVI (`absent`) : un message au centre, « Initialiser l'installation du suivi », le tableau du site en fond
 *     flou et inerte, aucun chiffre lisible au premier plan ; le bouton ouvre l'assistant, dont le PIED reste dans
 *     l'écran à chaque étape (1440×900 et 390×844) ; le choix retenu est marqué (`aria-pressed`, pastille cochée) ;
 *     étape 1 → 2 → méthode manuelle → code + « Terminé » ; puis méthode automatique → « Lancer l'installation » crée
 *     la carte d'installation et l'assistant passe au résumé (« Voir l'agent au travail ») ; rechargé, le site dit
 *     « L'installation du suivi est en cours » ;
 *   - CODE POSÉ SANS VISITE (`attente`) : « Données pas encore récoltées » et « Tester le suivi », qui répond ;
 *   - CODE FAUX (`probleme`) : « Corriger l'installation » ouvre l'assistant ;
 *   - SUIVI VÉRIFIÉ (`verifie`) : le tableau ordinaire, sans message ;
 * puis un service vide pour un projet (Backup) montre son fond flou, sans `data-silhouette` (ce n'est pas un chargement).
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const PORT = Number(process.env.BELUGA_VERIF_PORT || 7247);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = path.join(RACINE, 'data/verification');
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, PROJETS, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-installation-du-suivi-',
  port: PORT,
  depot: false,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0' },
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const MAINTENANT = Date.now();

const SITES = {
  absent: { id: 'p-absent', nom: 'Atelier Sans Suivi', etat: 'absent', diagnostic: null },
  /* Un second site sans suivi pour le téléphone : celui de l'ordinateur a déjà sa carte d'installation. */
  absentTel: { id: 'p-absent-tel', nom: 'Atelier Sans Suivi Mobile', etat: 'absent', diagnostic: null },
  attente: { id: 'p-attente', nom: 'Atelier En Attente', etat: 'pose', diagnostic: null },
  probleme: { id: 'p-probleme', nom: 'Atelier A Corriger', etat: 'absent', diagnostic: 'mauvaise-cle' },
  verifie: { id: 'p-verifie', nom: 'Atelier Verifie', etat: 'verifie', diagnostic: null },
};

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(jeton), MAINTENANT, MAINTENANT + 3600_000, 'vérification installation du suivi');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  let rang = 1;
  for (const s of Object.values(SITES)) {
    const chemin = path.join(PROJETS, s.id);
    fs.mkdirSync(chemin, { recursive: true });
    const p = { id: s.id, name: s.nom, path: chemin, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: rang++, archived: false, createdAt: MAINTENANT, updatedAt: MAINTENANT };
    db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(s.id, s.nom, chemin, JSON.stringify(p), MAINTENANT, MAINTENANT);
    db.prepare(
      `INSERT INTO marketing_espaces (project_id, cle_suivi, adresse, origines, methode_suivi, etat_suivi, langue, mode_suivi, cree_le, maj_le)
       VALUES (?, ?, ?, '[]', 'manuel', ?, 'fr', 'visiteur', ?, ?)`,
    ).run(s.id, `cle${s.id.replace(/\W/g, '')}`, 'http://127.0.0.1:9/', s.etat, MAINTENANT, MAINTENANT);
    if (s.diagnostic) db.prepare('UPDATE marketing_espaces SET diagnostic_suivi = ? WHERE project_id = ?').run(s.diagnostic, s.id);
  }
  db.close();
}

const lire = (sql, ...args) => {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};

let browser;
try {
  if (!(await attendrePort())) throw new Error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
  poserLeDecor();
  browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = async (largeur, hauteur, sombre = false) => {
    const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur }, colorScheme: sombre ? 'dark' : 'light' });
    await ctx.addCookies([{ name: 'beluga_session', value: jeton, domain: '127.0.0.1', path: '/' }]);
    return ctx;
  };
  const suivre = (page) => {
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    return erreurs;
  };
  const ouvrirLeSite = async (page, id) => {
    await page.goto(`${BASE}/#statistiques/${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-stats-sans-chiffres], [data-marketing-statistiques]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
  };
  /** Le pied de l'assistant et son bouton principal tiennent-ils dans l'écran ? */
  const piedVisible = (page) =>
    page.evaluate(() => {
      const pied = [...document.querySelectorAll('[data-stats-assistant-pied]')].find((e) => e.getBoundingClientRect().height > 0);
      if (!pied) return { ok: false, detail: 'pied absent' };
      const r = pied.getBoundingClientRect();
      const bouton = [...pied.querySelectorAll('button')].pop();
      const b = bouton?.getBoundingClientRect();
      const ok = r.top >= 0 && r.bottom <= innerHeight + 0.5 && !!b && b.bottom <= innerHeight + 0.5 && b.height > 0;
      const tiroir = pied.closest('[data-page-de-zone]');
      const t = tiroir?.getBoundingClientRect();
      const chaine = [];
      for (let el = pied.parentElement; el && chaine.length < 6; el = el.parentElement) chaine.push(`${el.tagName}.${(el.className || '').toString().slice(0, 60)}:${Math.round(el.getBoundingClientRect().height)}`);
      return { ok, detail: `pied ${Math.round(r.top)}→${Math.round(r.bottom)}, écran ${innerHeight}${ok ? '' : `, tiroir ${t && Math.round(t.top)}→${t && Math.round(t.bottom)} style=${tiroir?.getAttribute('style')} | ${chaine.join(' < ')}`}` };
    });

  for (const [largeur, hauteur, nomTaille] of [
    [1440, 900, 'ordinateur'],
    [390, 844, 'téléphone'],
  ]) {
    const ctx = await contexte(largeur, hauteur);
    const page = await ctx.newPage();
    const erreurs = suivre(page);
    const absent = largeur === 1440 ? SITES.absent : SITES.absentTel;

    /* SANS SUIVI : le message, le fond flou, le bouton. */
    await ouvrirLeSite(page, absent.id);
    const vide = await page.evaluate(() => {
      const bloc = document.querySelector('[data-stats-sans-chiffres]');
      const fond = bloc?.querySelector('[data-fond-de-l-etat-vide]');
      const style = fond ? getComputedStyle(fond) : null;
      const bouton = bloc?.querySelector('[data-creer-depuis-l-etat-vide]');
      const r = bouton?.getBoundingClientRect();
      return {
        etat: bloc?.getAttribute('data-stats-sans-chiffres') ?? null,
        fond: !!fond?.querySelector('[data-marketing-statistiques]'),
        inerte: !!fond && fond.hasAttribute('inert') && fond.getAttribute('aria-hidden') === 'true',
        opacite: style ? Number(style.opacity) : null,
        flou: style?.filter ?? '',
        libelle: bouton?.textContent?.trim() ?? '',
        centre: r ? Math.abs(r.left + r.width / 2 - (bloc.getBoundingClientRect().left + bloc.getBoundingClientRect().width / 2)) < 4 : false,
        chiffresAuPremierPlan: [...document.querySelectorAll('[data-marketing-indicateur]')].some((e) => !e.closest('[data-fond-de-l-etat-vide]') && e.getBoundingClientRect().height > 0),
        periode: !!document.querySelector('[data-stats-vue]'),
      };
    });
    noter(`${nomTaille} · sans suivi : message au centre`, vide.etat === 'absent' && vide.centre, JSON.stringify({ etat: vide.etat, centre: vide.centre }));
    noter(`${nomTaille} · sans suivi : bouton « Initialiser l'installation du suivi »`, vide.libelle === 'Initialiser l’installation du suivi', vide.libelle);
    noter(`${nomTaille} · sans suivi : le tableau du site en fond, flou, à 30 %, inerte`, vide.fond && vide.inerte && Math.abs((vide.opacite ?? 0) - 0.3) < 0.01 && /blur/.test(vide.flou), `${vide.opacite} ${vide.flou}`);
    noter(`${nomTaille} · sans suivi : aucun chiffre ni vue au premier plan`, !vide.chiffresAuPremierPlan && !vide.periode);
    await page.screenshot({ path: path.join(CAPTURES, `installation-suivi-vide-${largeur}.png`) });

    /* L'ASSISTANT : le pied à chaque étape. */
    await page.click('[data-stats-sans-chiffres] [data-creer-depuis-l-etat-vide]');
    await page.waitForSelector('[data-stats-assistant-pied]', { timeout: 10000 });
    await page.waitForTimeout(400);
    let p = await piedVisible(page);
    noter(`${nomTaille} · assistant étape 1 : le bouton du bas est dans l'écran`, p.ok, p.detail);
    await page.click('[data-stats-mode="anonyme"]');
    await page.waitForTimeout(150);
    const marque = await page.evaluate(() => ({
      retenu: document.querySelector('[data-stats-mode="anonyme"]')?.getAttribute('aria-pressed'),
      libre: document.querySelector('[data-stats-mode="visiteur"]')?.getAttribute('aria-pressed'),
      pastille: document.querySelector('[data-stats-mode="anonyme"] [data-stats-choix-marque]')?.getAttribute('data-stats-choix-marque'),
    }));
    noter(`${nomTaille} · le choix retenu est marqué`, marque.retenu === 'true' && marque.libre === 'false' && marque.pastille === 'retenu', JSON.stringify(marque));
    await page.screenshot({ path: path.join(CAPTURES, `installation-suivi-etape1-${largeur}.png`) });
    p = await piedVisible(page);
    noter(`${nomTaille} · après le choix, le bouton « Suivant » est toujours dans l'écran`, p.ok, p.detail);
    await page.click('[data-stats-assistant-suivant]');
    await page.waitForSelector('[data-stats-methode="manuel"]', { timeout: 10000 });
    const mode = lire('SELECT mode_suivi FROM marketing_espaces WHERE project_id = ?', absent.id)[0]?.mode_suivi;
    noter(`${nomTaille} · étape 1 → 2 : le type de suivi est enregistré`, mode === 'anonyme', mode);
    p = await piedVisible(page);
    noter(`${nomTaille} · assistant étape 2 : le bouton du bas est dans l'écran`, p.ok, p.detail);
    await page.click('[data-stats-methode="manuel"]');
    await page.click('[data-stats-assistant-suivant]');
    await page.waitForSelector('[data-stats-assistant-termine]', { timeout: 10000 });
    const code = await page.evaluate(() => /s\.js/.test(document.body.innerText));
    noter(`${nomTaille} · méthode manuelle : le code à poser est montré`, code);
    p = await piedVisible(page);
    noter(`${nomTaille} · assistant étape 3 : « Terminé » est dans l'écran`, p.ok, p.detail);
    await page.screenshot({ path: path.join(CAPTURES, `installation-suivi-etape3-${largeur}.png`) });
    await page.click('[data-stats-assistant-retour]');
    await page.click('[data-stats-methode="auto"]');
    await page.click('[data-stats-assistant-suivant]');
    await page.waitForSelector('[data-marketing-installer-suivi="installer"]', { timeout: 10000 });
    p = await piedVisible(page);
    noter(`${nomTaille} · méthode automatique : « Lancer l'installation » est dans l'écran`, p.ok, p.detail);
    if (largeur === 1440) {
      await page.click('[data-marketing-installer-suivi="installer"]');
      await page.waitForSelector('[data-marketing-installer-suivi="ouvrir"]', { timeout: 15000 }).catch(() => {});
      const cartes = lire("SELECT title, column_key FROM cards WHERE project_id = ?", SITES.absent.id);
      noter('ordinateur · « Lancer l’installation » crée la carte d’installation', cartes.some((c) => /suivi/i.test(c.title)), JSON.stringify(cartes));
      noter('ordinateur · l’assistant passe au suivi : « Voir l’agent au travail »', (await page.locator('[data-marketing-installer-suivi="ouvrir"]').count()) > 0);
      p = await piedVisible(page);
      noter('ordinateur · résumé : le bouton du bas est dans l’écran', p.ok, p.detail);
      await ouvrirLeSite(page, SITES.absent.id);
      const etat = await page.getAttribute('[data-stats-sans-chiffres]', 'data-stats-sans-chiffres').catch(() => null);
      const titre = await page.locator('[data-stats-sans-chiffres] h2').textContent().catch(() => '');
      noter('ordinateur · rechargé : « L’installation du suivi est en cours »', etat === 'installation' && /en cours/.test(titre ?? ''), `${etat} — ${titre}`);
      await page.screenshot({ path: path.join(CAPTURES, `installation-suivi-en-cours-${largeur}.png`) });
    }

    /* CODE POSÉ, AUCUNE VISITE. */
    await ouvrirLeSite(page, SITES.attente.id);
    const attente = await page.evaluate(() => ({
      etat: document.querySelector('[data-stats-sans-chiffres]')?.getAttribute('data-stats-sans-chiffres'),
      titre: document.querySelector('[data-stats-sans-chiffres] h2')?.textContent ?? '',
    }));
    noter(`${nomTaille} · code posé : « Données pas encore récoltées »`, attente.etat === 'attente' && attente.titre === 'Données pas encore récoltées', JSON.stringify(attente));
    await page.click('[data-stats-sans-chiffres] [data-stats-tester-bouton]');
    const reponse = await page.waitForSelector('[data-stats-sans-chiffres] [data-stats-tester-resultat]', { timeout: 30000 }).then(() => true).catch(() => false);
    noter(`${nomTaille} · « Tester le suivi » répond`, reponse);
    await page.screenshot({ path: path.join(CAPTURES, `installation-suivi-attente-${largeur}.png`) });

    /* CODE FAUX. */
    await ouvrirLeSite(page, SITES.probleme.id);
    const probleme = await page.getAttribute('[data-stats-sans-chiffres]', 'data-stats-sans-chiffres').catch(() => null);
    noter(`${nomTaille} · code à corriger : son message`, probleme === 'probleme', probleme);
    await page.click('[data-stats-sans-chiffres] [data-creer-depuis-l-etat-vide]').catch(() => {});
    const assistantOuvert = await page.waitForSelector('[data-stats-assistant-pied]', { timeout: 10000 }).then(() => true).catch(() => false);
    noter(`${nomTaille} · « Corriger l’installation » ouvre l’assistant`, assistantOuvert);
    await page.waitForTimeout(700); // la feuille du bas finit de monter
    p = await piedVisible(page);
    noter(`${nomTaille} · « Corriger » : le bouton du bas est dans l'écran`, p.ok, p.detail);
    await page.screenshot({ path: path.join(CAPTURES, `installation-suivi-corriger-${largeur}.png`) });

    /* SUIVI VÉRIFIÉ : le tableau ordinaire. */
    await ouvrirLeSite(page, SITES.verifie.id);
    const verifie = await page.evaluate(() => ({
      message: !!document.querySelector('[data-stats-sans-chiffres]'),
      tableau: !!document.querySelector('[data-marketing-statistiques]'),
    }));
    noter(`${nomTaille} · suivi vérifié : le tableau, sans message`, !verifie.message && verifie.tableau, JSON.stringify(verifie));

    noter(`${nomTaille} · aucune erreur de page`, !erreurs.length, erreurs[0] ?? '');
    await ctx.close();
  }

  /* SOMBRE : la page sans suivi et l'assistant se dessinent. */
  {
    const ctx = await contexte(1440, 900, true);
    const page = await ctx.newPage();
    await ouvrirLeSite(page, SITES.probleme.id);
    await page.screenshot({ path: path.join(CAPTURES, 'installation-suivi-sombre-1440.png') });
    await page.click('[data-stats-sans-chiffres] [data-creer-depuis-l-etat-vide]').catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(CAPTURES, 'installation-suivi-assistant-sombre-1440.png') });
    await ctx.close();
  }

  /* UN SERVICE VIDE POUR UN PROJET : le fond flou, qui n'est pas une silhouette de chargement. */
  {
    const ctx = await contexte(1440, 900);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#backups?projet=${SITES.verifie.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-backups-vide]', { timeout: 30000 }).catch(() => {});
    const fond = await page.evaluate(() => {
      const bloc = document.querySelector('[data-backups-vide]');
      const f = bloc?.querySelector('[data-fond-de-l-etat-vide]');
      return { vide: !!bloc, fond: !!f && f.children.length > 0, silhouette: !!f?.querySelector('[data-silhouette]'), anime: !!f?.querySelector('.animate-silhouette') };
    });
    noter('Backup vide pour un projet : fond flou présent', fond.vide && fond.fond, JSON.stringify(fond));
    noter('Backup vide : le fond ne se dit pas « chargement » et ne respire pas', !fond.silhouette && !fond.anime);
    await page.screenshot({ path: path.join(CAPTURES, 'installation-suivi-backup-vide-1440.png') });
    await ctx.close();
  }
} catch (err) {
  noter('déroulé du contrôle', false, err?.stack ?? String(err));
} finally {
  await browser?.close().catch(() => {});
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
process.exit(echecs ? 1 : 0);
