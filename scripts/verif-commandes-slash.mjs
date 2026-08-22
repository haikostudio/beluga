#!/usr/bin/env node
/**
 * LES COMMANDES « / » PROPOSÉES EXISTENT-ELLES ENCORE DANS LES PROGRAMMES ?
 *
 * `shared/src/commandes-slash.ts` recopie les commandes que chaque moteur porte
 * dans son propre exécutable : elles ne sont écrites nulle part sur le disque,
 * et relire trois cents mégaoctets à chaque ouverture de menu est impossible.
 * Une copie, ça rouille — ce contrôle relit donc les programmes RÉELLEMENT
 * installés et dit ce qui a disparu d'une mise à jour.
 *
 * Le programme n'est PAS relu à chaque fois : un exécutable inchangé se
 * reconnaît à sa taille et à sa date, et le relevé précédent est repris.
 *
 * Puis, dans un vrai navigateur : taper « / » ouvre le menu du moteur choisi,
 * changer de moteur change la liste, et choisir une commande l'écrit en tête du
 * message — telle quelle, c'est la seule forme que les moteurs comprennent.
 *
 * Se lance contre le serveur de développement :
 *   npm run dev --workspace web -- --port 7099
 *   node scripts/verif-commandes-slash.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin écrit en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * LA BASE EST CELLE DU DÉMON QUI TOURNE, PAS CELLE DE LA COPIE DE TRAVAIL.
 *
 * Lancé depuis un dossier de carte (`git worktree`), ce script a sous la main
 * un `data/haikodev.db` À LUI — vide, et que personne n'écoute. La session
 * d'essai y serait posée pendant que l'application, elle, interroge la base du
 * dépôt principal : l'écran resterait sur « Connexion au serveur… » sans que
 * rien ne dise pourquoi. On remonte donc au dépôt principal par Git.
 */
function depotPrincipal() {
  try {
    const commun = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: RACINE,
      encoding: 'utf8',
    }).trim();
    return path.dirname(path.resolve(RACINE, commun));
  } catch {
    return RACINE;
  }
}

const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const DB = process.env.HAIKODEV_DB || path.join(depotPrincipal(), 'data', 'haikodev.db');
const CACHE = path.join(os.tmpdir(), 'haikodev-releve-commandes-moteur.json');

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ */
/* 1. Ce que les programmes installés portent vraiment                  */
/* ------------------------------------------------------------------ */

/** Le programme derrière un nom de commande, lien symbolique suivi. */
function programmeDe(nom) {
  for (const dossier of (process.env.PATH || '').split(':')) {
    const candidat = path.join(dossier, nom);
    try {
      if (fs.statSync(candidat).isFile()) return fs.realpathSync(candidat);
    } catch {
      /* pas là : au suivant. */
    }
  }
  return null;
}

/**
 * LES NOMS CHERCHÉS SONT ÉPROUVÉS PENDANT LA LECTURE, PAS APRÈS.
 *
 * Un exécutable de trois cents mégaoctets rendrait des MILLIONS de mots : les
 * garder pour les trier ensuite ferait enfler la mémoire au point de ralentir
 * tout le reste du contrôle. On lit donc par morceaux et on ne retient qu'une
 * chose — le nom cherché a-t-il été vu, oui ou non.
 *
 * Trois façons de le voir, parce que les deux moteurs ne rangent pas pareil :
 * DÉCLARÉ `name:"…"` (Claude Code range ses commandes ainsi) ; SEUL, entre deux
 * octets qui ne s'impriment pas ; ou COLLÉ À UN VOISIN de la même liste (Codex
 * écrit tous ses noms bout à bout : « …archiveresumeapp… »).
 *
 * Aucune de ces trois n'est une simple présence du mot quelque part : « new »
 * ou « diff » se trouvent mille fois par hasard dans trois cents mégaoctets, et
 * un contrôle qui ne peut pas échouer ne contrôle rien.
 */
function chercherDansLeProgramme(chemin, nomsCherches) {
  const trouves = new Set();
  const restants = new Set(nomsCherches);
  const CHEVAUCHEMENT = 4096;
  const TAILLE = 16 * 1024 * 1024;
  const tampon = Buffer.alloc(TAILLE);
  const fd = fs.openSync(chemin, 'r');
  let reste = '';
  try {
    for (;;) {
      if (!restants.size) break;
      const lus = fs.readSync(fd, tampon, 0, TAILLE, null);
      if (lus <= 0) break;
      // Seuls les signes imprimables comptent : le reste sépare les suites.
      let texte = reste;
      for (let i = 0; i < lus; i += 1) {
        const octet = tampon[i];
        texte += octet >= 32 && octet < 127 ? String.fromCharCode(octet) : '\n';
      }
      for (const nom of [...restants]) {
        const vu =
          texte.includes(`name:"${nom}"`) ||
          texte.includes(`\n${nom}\n`) ||
          nomsCherches.some((voisin) => voisin !== nom && (texte.includes(`${voisin}${nom}`) || texte.includes(`${nom}${voisin}`)));
        if (vu) {
          trouves.add(nom);
          restants.delete(nom);
        }
      }
      reste = texte.slice(-CHEVAUCHEMENT);
    }
  } finally {
    fs.closeSync(fd);
  }
  return [...trouves];
}

/** Ce qui a été vu dans un programme, repris tel quel s'il n'a pas bougé. */
function releve(nomDuMoteur, cheminCommande, nomsCherches) {
  const programme = programmeDe(cheminCommande);
  if (!programme) return null;
  const etat = fs.statSync(programme);
  // UN FICHIER INCHANGÉ SE RECONNAÎT À SA TAILLE ET À SA DATE, pas en le
  // relisant : relire six cents mégaoctets pour rien coûte une minute.
  const empreinte = `${programme}:${etat.size}:${etat.mtimeMs}:${[...nomsCherches].sort().join(',')}`;
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    cache = {};
  }
  if (cache[nomDuMoteur]?.empreinte === empreinte) {
    return { trouves: cache[nomDuMoteur].trouves, programme, repris: true };
  }
  const trouves = chercherDansLeProgramme(programme, nomsCherches);
  cache[nomDuMoteur] = { empreinte, trouves };
  try {
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  } catch {
    /* pas de cache possible : on relira, c'est tout. */
  }
  return { trouves, programme, repris: false };
}

async function controlerLesCopies() {
  const { COMMANDES_INTEGREES } = await import(path.join(RACINE, 'shared/dist/commandes-slash.js'));
  for (const [moteur, commande] of [
    ['claude', 'claude'],
    ['codex', 'codex'],
  ]) {
    const attendues = (COMMANDES_INTEGREES[moteur] ?? []).map((c) => c.nom);
    const lu = releve(moteur, commande, attendues);
    if (!lu) {
      record(`${moteur} : le programme est installé`, false, 'introuvable dans le PATH');
      continue;
    }
    const vus = new Set(lu.trouves);
    const disparues = attendues.filter((nom) => !vus.has(nom));
    record(
      `${moteur} : les ${attendues.length} commandes recopiées existent encore dans le programme`,
      disparues.length === 0,
      disparues.length ? `disparues : ${disparues.join(', ')}` : `${lu.repris ? 'relevé repris' : 'programme relu'}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 2. Le menu dans un vrai navigateur                                   */
/* ------------------------------------------------------------------ */

function poserSession(db) {
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification commandes slash',
  );
  return { cookie, empreinte };
}

/** Choisit le moteur dans les réglages de l'agent de la barre d'écriture. */
async function choisirLeMoteur(page, barre, nomAffiche) {
  await barre.locator('[data-selecteur="config"]').first().click();
  await page.waitForTimeout(900);
  await page.locator('[role="menu"][aria-label="Réglages de l\'agent"] [data-selecteur="moteur"]').first().click();
  await page.waitForTimeout(900);
  await page.locator('[role="menu"]').last().getByText(nomAffiche, { exact: true }).first().click();
  await page.waitForTimeout(1400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

/** Les noms visibles dans le menu « / », dans l'ordre affiché. */
async function nomsDuMenu(page) {
  return page.locator('[data-menu-slash] [data-commande]').evaluateAll((noeuds) =>
    noeuds.map((n) => n.getAttribute('data-commande')),
  );
}

async function main() {
  if (!process.env.HAIKO_SLASH_SANS_PROGRAMMES) await controlerLesCopies();

  const { default: Database } = await import(path.join(RACINE, 'node_modules/better-sqlite3/lib/index.js'));
  const db = new Database(DB);
  const { cookie, empreinte } = poserSession(db);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);
    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }
    const ongletChef = page.getByRole('button', { name: 'Chef', exact: true }).first();
    if (await ongletChef.count()) {
      await ongletChef.click({ force: true });
      await page.waitForTimeout(2500);
    }

    // PIÈGE : plusieurs barres d'écriture coexistent. Celle qu'on VOIT seule.
    const barre = page.locator('[data-composer]').filter({ has: page.locator('textarea:visible') }).last();
    const zone = barre.locator('textarea').last();
    try {
      await zone.waitFor({ state: 'visible', timeout: 20000 });
    } catch (souci) {
      await page.screenshot({ path: '/tmp/slash-echec.png' });
      console.error(
        'composeurs =',
        await page.locator('[data-composer]').count(),
        'textareas =',
        await page.locator('textarea').count(),
        'barres =',
        await barre.count(),
      );
      throw souci;
    }

    /* ---- Claude ---- */
    await choisirLeMoteur(page, barre, 'Claude');
    await zone.click();
    await zone.fill('');
    await zone.type('/', { delay: 60 });
    await page.waitForTimeout(2500);
    const menuClaude = page.locator('[data-menu-slash]');
    record('Taper « / » ouvre le menu au-dessus du champ', await menuClaude.isVisible().catch(() => false));
    const nomsClaude = await nomsDuMenu(page);
    record('Le menu de Claude liste des commandes', nomsClaude.length > 0, `${nomsClaude.length} commandes`);
    record(
      'Le menu de Claude porte des commandes propres à Claude',
      nomsClaude.includes('context') || nomsClaude.includes('compact'),
      nomsClaude.slice(0, 8).join(', '),
    );

    /* ---- Le filtre suit ce qui est tapé ---- */
    await zone.type('sta', { delay: 60 });
    await page.waitForTimeout(900);
    const filtres = await nomsDuMenu(page);
    record(
      'Le menu se resserre sur ce qui est tapé',
      filtres.length > 0 && filtres.length < nomsClaude.length && filtres.every((n) => n.includes('sta')),
      filtres.join(', '),
    );

    /* ---- Choisir écrit la commande en tête du message ---- */
    await page.locator('[data-menu-slash] [data-commande]').first().click();
    await page.waitForTimeout(1000);
    const ecrit = await zone.inputValue();
    record('La commande choisie s’écrit « /nom » en tête du message', /^\/[a-z0-9-]+ /.test(ecrit), ecrit);
    record('Le menu se referme une fois la commande écrite', !(await menuClaude.isVisible().catch(() => false)));
    const pastille = page.locator('[data-commande-reconnue]');
    record('La commande reconnue est annoncée au-dessus du champ', (await pastille.count()) > 0);

    /* ---- Le reste du message part inchangé ---- */
    await zone.type('regarde le dossier web/src et la date 12/08', { delay: 15 });
    await page.waitForTimeout(900);
    record(
      'Une adresse de dossier ou une date n’ouvrent pas le menu',
      !(await menuClaude.isVisible().catch(() => false)),
    );
    const complet = await zone.inputValue();
    record(
      'Le texte garde la commande en tête, sans rien transformer',
      /^\/[a-z0-9-]+ .*web\/src.*12\/08$/.test(complet),
      complet,
    );

    /* ---- Codex : une autre liste ---- */
    await zone.fill('');
    await page.waitForTimeout(400);
    await choisirLeMoteur(page, barre, 'GPT');
    await zone.click();
    await zone.type('/', { delay: 60 });
    await page.waitForTimeout(2500);
    const nomsCodex = await nomsDuMenu(page);
    record('Le menu de GPT (Codex) liste aussi des commandes', nomsCodex.length > 0, `${nomsCodex.length} commandes`);
    record(
      'Changer de moteur change la liste',
      JSON.stringify(nomsCodex) !== JSON.stringify(nomsClaude),
      `Claude ${nomsClaude.length} / Codex ${nomsCodex.length}`,
    );
    record(
      'Le menu de Codex porte des commandes propres à Codex',
      nomsCodex.includes('diff') || nomsCodex.includes('init'),
      nomsCodex.slice(0, 8).join(', '),
    );

    /* ---- Échappement referme sans rien écrire ---- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    record(
      'Échappement referme le menu sans rien écrire',
      !(await page.locator('[data-menu-slash]').isVisible().catch(() => false)) &&
        (await zone.inputValue()) === '/',
    );

    await zone.fill('');
    await page.waitForTimeout(600);
    record('Aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } catch (souci) {
    console.error(souci);
    throw souci;
  } finally {
    await browser.close();
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    db.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
