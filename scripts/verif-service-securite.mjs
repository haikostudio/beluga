#!/usr/bin/env node
/**
 * LE SERVICE « SÉCURITÉ », DANS UN VRAI NAVIGATEUR (carte « Service Sécurité des projets », 15/11/2026).
 *
 * Sur un démon d'essai (base neuve, dossier de projets à lui, jamais celui en service, aucun quota) et un petit dépôt
 * git qui porte une vraie requête SQL montée avec une saisie (le contrôle de sécurité la relève) :
 *  1. la page « Sécurité » montre Beluga Build, suivi dès le démarrage sans geste, et son bouton « Ajouter un projet » est en BAS de la page ;
 *  2. ajouter le projet ouvre sa page : la conversation de l'agent à gauche, le rapport à droite, classé par gravité ;
 *  3. les blocs graves sont ouverts, « Ce qui a été vérifié » est EN TÊTE du rapport et déplié ;
 *  4. cocher un point ÉCRIT sa ligne dans le champ d'écriture, décocher la RETIRE, et rien n'est envoyé ;
 *  5. la tête du rapport (choix de l'audit, « Lancer un audit ») tient sur une hauteur, au pixel près ;
 *  6. la liste montre le projet, et ses contrôles d'en-tête ont la même hauteur (32 px ordinateur) ;
 *  7. sur téléphone (390 px), la page d'un projet passe en deux onglets, sans débordement en largeur ;
 *  8. aucun rapport ne recopie la valeur d'une clé écrite dans le dépôt (DEC-501) ;
 *  9. la page d'un projet prend TOUT le cadre (capture #66c6), en clair et en sombre : le volet du rapport touche la
 *     barre du fil et le bord droit, la conversation se centre dans la place à gauche du volet, son champ est en bas ;
 *     la LISTE, elle, garde sa colonne centrée ;
 * 10. cocher une ligne fait du bouton du pied « Actions sur la sélection (N) », sans ouvrir la page du projet ; son menu
 *     propose « Relancer l'analyse » (un audit part) et « Lancer la correction » ;
 * 11. un DOUBLE CLIC sur un cran à liste du fil (le service, la portée) ramène à l'accueil du service, liste refermée ;
 * 12. (carte « Sécurité : bilan, écran et historique », 25/11/2026) le volet s'ouvre sur la NOTE sur 100 (anneau, une
 *     barre par gravité), puis une ligne par catégorie, repliée, qui s'ouvre sur ses points ; la liste porte la colonne
 *     « Note » et des dates en français ;
 * 13. la conversation de l'agent porte les repères du service (l'audit), un bilan ```bilan-securite``` s'y lit en liste
 *     rangée Pas fait → À finir → Fait, et les échanges d'avant un nouveau départ se chargent EN REMONTANT, la lecture
 *     restant en place.
 *
 *   node scripts/verif-service-securite.mjs        (après `npm run build`, depuis la copie de la carte)
 *   VERIF_CAPTURES=/tmp/captures-securite node scripts/verif-service-securite.mjs   (écrit les captures)
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN` : la session d'une heure est fabriquée en base jetable, et part avec elle.
 */
import { porteeSurTousLesProjets } from './lib/navigation.mjs';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7197);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({ prefixe: 'verif-securite-', port: PORT, signaux: true });
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const SECRET = 'sk_live_' + 'Zx81Qw'.repeat(5);

function poserLeDecor() {
  // Le dépôt d'essai : une requête montée avec la saisie du visiteur, et une clé côté serveur (dépôt privé : tue).
  fs.mkdirSync(path.join(DEPOT, 'server'), { recursive: true });
  fs.writeFileSync(
    path.join(DEPOT, 'server', 'routes.js'),
    "export function lire(req, db) {\n  return db.query(`SELECT * FROM clients WHERE id = ${req.query.id}`);\n}\n",
  );
  fs.writeFileSync(path.join(DEPOT, 'server', 'config.js'), `export const STRIPE_SECRET_KEY = '${SECRET}';\n`);
  execFileSync('git', ['add', '-A'], { cwd: DEPOT });
  execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'code'], { cwd: DEPOT });

  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const p = { id: 'p-essai', name: 'Boutique', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run('p-essai', 'Boutique', DEPOT, JSON.stringify(p), T, T);
  db.close();
}

/** Le thème de l'essai : une préférence du serveur (`usePref('theme')`), posée avant d'ouvrir les pages. */
function poserLeTheme(clarte) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run(
    'theme',
    JSON.stringify(clarte),
    Date.now(),
  );
  db.close();
}

/** La page du service sur « Tous les projets » (elle s'ouvre sur le projet en cours). */
async function ouvrirTousLesProjets(page) {
  /* LE FIL « SERVICE / PROJET » (20/11/2026) : le nom du service remet la page sur tous les projets. */
  const service = page.locator('[data-cran-a-menu="service-de-la-page"]').first();
  /* Au tout premier chargement, l'arrivée sur « Tableaux de bord » (rôle pas encore connu) peut devancer l'adresse :
     on la redonne, trois fois au plus. */
  for (let essai = 0; essai < 3; essai++) {
    await page.goto(`${BASE}/#securite`, { waitUntil: 'load' });
    if (await service.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false)) break;
    await page.goto(`${BASE}/#`, { waitUntil: 'load' });
  }
  await service.waitFor({ state: 'visible', timeout: 15_000 });
  if (!(await porteeSurTousLesProjets(page))) throw new Error('« Tous les projets » ne se choisit pas');
}

/** Les hauteurs des contrôles visibles d'une rangée. */
async function hauteurs(page, selecteur) {
  return page.$$eval(selecteur, (elements) =>
    elements
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => Math.round(e.getBoundingClientRect().height)),
  );
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

/** La page ouverte, pour la capture d'un échec. */
let pageEnCours = null;

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const theme of ['light', 'dark']) {
      poserLeTheme(theme === 'light' ? 'clair' : 'sombre');
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CH', colorScheme: theme });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      pageEnCours = page;
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));

      if (theme === 'light') {
        /* 1. Le projet de Beluga Build est suivi dès le démarrage (sans geste) ; son bouton « Ajouter » est en bas. */
        await ouvrirTousLesProjets(page);
        const ajouter = page.locator('[data-securite-ajouter]').first();
        await ajouter.waitFor({ state: 'visible', timeout: 30_000 });
        verifier(
          'Beluga Build est suivi dès le démarrage, sans geste',
          await page.getByText('Beluga Build', { exact: true }).first().isVisible(),
        );
        const boite = await ajouter.boundingBox();
        verifier('« Ajouter un projet » est en bas de la page', !!boite && boite.y > 1000 * 0.75, boite ? `y = ${Math.round(boite.y)}` : 'introuvable');
        await capturer(page, 'liste-avant-ajout-ordinateur-clair');

        /* 2. Ajouter le projet : sa page s'ouvre, l'audit part. */
        await ajouter.click();
        await page.locator('[data-liste-option="p-essai"]').first().click();
        await page.locator('[data-securite-page="p-essai"]').waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('[data-securite-rapport]:not([data-securite-rapport="attente"])').waitFor({ state: 'visible', timeout: 120_000 });
        const rapport = await page.locator('[data-securite-rapport]').getAttribute('data-securite-rapport');
        verifier('le premier audit est rendu dans le volet de droite', rapport && rapport !== 'attente' && rapport !== 'erreur', rapport ?? '');
        /* 3. LA DISPOSITION A (25/11/2026, maquette #2312) : la note et ses barres, puis une ligne par catégorie. */
        const carteNote = page.locator('[data-securite-carte-note]').first();
        verifier('la note de sécurité ouvre le rapport', await carteNote.isVisible(), (await carteNote.getAttribute('data-securite-carte-note')) ?? '');
        verifier('la note se lit dans un anneau, sur 100', (await carteNote.locator('[data-anneau-note]').count()) === 1 && /sur 100/.test((await carteNote.textContent()) ?? ''));
        const barres = await carteNote.locator('[data-securite-barre]').count();
        verifier('une barre par gravité', barres === 4, String(barres));
        const ordre = await page.$$eval('[data-securite-carte-note], [data-securite-categories], [data-bloc-repliable="securite-robots"]', (els) =>
          els.map((e) => (e.hasAttribute('data-securite-carte-note') ? 'note' : e.hasAttribute('data-securite-categories') ? 'categories' : 'robots')),
        );
        verifier('la note, puis les catégories, puis l’accès des robots', ordre.join(',') === 'note,categories,robots', ordre.join(','));
        const categorie = page.locator('[data-securite-categorie="injection"]').first();
        verifier('la requête montée avec une saisie est rangée dans « Requêtes et commandes »', (await categorie.count()) > 0);
        verifier('les catégories sont repliées à l’ouverture', (await categorie.getAttribute('data-ouvert')) === 'non');
        verifier('les contrôles sans point gardent leur ligne', (await page.locator('[data-securite-controle]').count()) > 0);
        await categorie.locator('button').first().click();
        const injection = page.locator('[data-securite-point*="injection"]').first();
        await injection.waitFor({ state: 'visible', timeout: 5_000 });
        verifier('une catégorie s’ouvre sur ses points', (await categorie.getAttribute('data-ouvert')) === 'oui');

        /* 8. Aucune valeur secrète dans la page. */
        verifier('aucune valeur de clé recopiée dans le rapport', !(await page.content()).includes(SECRET));

        /* 4. Cocher écrit, décocher retire, rien ne part. */
        await page.locator('[data-securite-conversation] textarea').first().waitFor({ state: 'visible', timeout: 60_000 });
        const champ = page.locator('[data-securite-conversation] textarea').first();
        const caseDuPoint = injection.locator('[data-securite-case]');
        await caseDuPoint.click();
        await page.waitForTimeout(300);
        const apres = await champ.inputValue();
        verifier('cocher un point écrit sa ligne dans le champ', /^- Corriger : /m.test(apres), JSON.stringify(apres.slice(0, 80)));
        verifier('la case se lit cochée', (await caseDuPoint.getAttribute('data-securite-case')) === 'cochee');
        await capturer(page, 'projet-ordinateur-clair');
        await caseDuPoint.click();
        await page.waitForTimeout(300);
        verifier('décocher retire la ligne', (await champ.inputValue()).trim() === '', JSON.stringify(await champ.inputValue()));
        const messages = await page.locator('[data-securite-conversation] [data-message]').count();
        verifier('rien n’a été envoyé à l’agent', messages === 0, `${messages} message(s)`);
        await mesurerLePleinCadre(page, 'clair');
        await verifierLaConversation(page);

        /* 5. La tête du rapport sur une hauteur. */
        const tete = await hauteurs(page, '[data-securite-tete-du-rapport] > *');
        verifier('la tête du rapport : contrôles de même hauteur', tete.length >= 1 && tete.every((h) => h === tete[0]), JSON.stringify(tete));

        /* 6. La liste, ses contrôles d'en-tête. */
        await ouvrirTousLesProjets(page);
        await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
        verifier('la liste montre le projet suivi', true);
        /* 12. LA COLONNE « NOTE » ET LES DATES EN FRANÇAIS (25/11/2026). */
        const note = await page.locator('[data-securite-ligne="p-essai"] [data-securite-note]').first().getAttribute('data-securite-note').catch(() => null);
        verifier('la liste porte la note du projet', note !== null && Number(note) >= 0 && Number(note) <= 100, String(note));
        const texteDeLaLigne = (await page.locator('[data-securite-ligne="p-essai"]').first().textContent()) ?? '';
        verifier('les dates de la liste sont en français', !/January|February|March|April|May|June|July|August|September|October|November|December/.test(texteDeLaLigne), texteDeLaLigne.slice(-60));
        /* LA RECHERCHE EST UNE LOUPE (22/11/2026) : la loupe fermée porte `data-recherche-en-icone`. */
        const entete = await hauteurs(page, '[data-tete-de-la-page-de-service] [data-recherche-en-icone], [data-bascule-tableau-cartes="vue-de-la-securite"]');
        verifier('les contrôles d’en-tête de la liste ont la même hauteur (32 px)', entete.length >= 2 && entete.every((h) => h === 32), JSON.stringify(entete));
        await capturer(page, 'liste-ordinateur-clair');
        await mesurerLaColonneDeLaListe(page, 'clair');

        /* 10. La sélection : cocher une ligne change le bouton du pied, sans ouvrir la page du projet. */
        const caseLigne = page.locator('[data-securite-choisir="p-essai"]').first();
        await caseLigne.click();
        await page.waitForTimeout(300);
        verifier('cocher une ligne n’ouvre pas la page du projet', (await page.locator('[data-securite-page]').count()) === 0);
        const actions = page.locator('[data-securite-actions]').first();
        verifier('le pied devient « Actions sur la sélection (1) »', /Actions sur la sélection \(1\)/.test((await actions.textContent().catch(() => '')) ?? ''));
        verifier('la case se lit cochée', (await caseLigne.getAttribute('aria-checked')) === 'true');
        /* La case d'en-tête ne se lit cochée que si TOUTES les lignes visibles le sont (Beluga Build est suivi aussi). */
        const lignesVisibles = await page.locator('[data-securite-ligne]').count();
        verifier(
          'la case d’en-tête suit les lignes visibles',
          (await page.locator('[data-securite-tout-choisir]').first().getAttribute('aria-checked')) === String(lignesVisibles === 1),
          `${lignesVisibles} ligne(s)`,
        );
        await actions.click();
        const relancer = page.locator('[data-securite-relancer-selection]').first();
        await relancer.waitFor({ state: 'visible', timeout: 5_000 });
        verifier('le menu propose « Relancer l’analyse » et « Lancer la correction »', (await page.locator('[data-securite-corriger]').first().isVisible()) && /Relancer l’analyse/.test((await relancer.textContent()) ?? ''));
        await capturer(page, 'selection-ordinateur-clair');
        const auditsAvant = compterLesAudits('manuel');
        await relancer.click();
        const auditParti = await attendre(() => compterLesAudits('manuel') > auditsAvant, 15_000);
        verifier('« Relancer l’analyse » lance un audit du projet coché', auditParti, `${auditsAvant} → ${compterLesAudits('manuel')}`);
        /* Le relevé occupe le démon quelques secondes : la réponse (et la sélection vidée) peut suivre l'audit en base. */
        /* « Ajouter un projet » ne revient que s'il reste un projet à ajouter : on juge le bouton des actions. */
        const vide = await attendre(async () => (await page.locator('[data-securite-actions]').count()) === 0, 20_000);
        const messagesPassagers = await page.$$eval('[data-toast-texte]', (els) => els.map((e) => e.textContent).join(' | ')).catch(() => '');
        verifier('après le geste, la sélection se vide', vide && (await caseLigne.getAttribute('aria-checked')) !== 'true', messagesPassagers);
        await capturer(page, 'apres-relance-ordinateur-clair');
        await caseLigne.click();
        await page.waitForTimeout(300);
        await page.locator('[data-securite-tout-choisir]').first().click();
        await page.waitForTimeout(300);
        verifier('la case d’en-tête coche toutes les lignes visibles', (await page.locator('[data-securite-actions]').first().textContent().catch(() => ''))?.includes(`(${lignesVisibles})`));
        await page.locator('[data-securite-tout-choisir]').first().click();
        await page.waitForTimeout(300);
        verifier('tout décocher retire le bouton des actions', (await page.locator('[data-securite-actions]').count()) === 0);

        /* 11. Le double clic sur le cran du service ramène à son accueil, liste refermée. */
        await page.locator('[data-securite-ligne="p-essai"]').first().click();
        await page.locator('[data-securite-page="p-essai"]').waitFor({ state: 'visible', timeout: 30_000 });
        /* LE NOM DU SERVICE MÈNE À SA LISTE, LE CHEVRON (au survol) À LA LISTE DES SERVICES (20/11/2026). */
        await page.locator('[data-nom-du-cran="service-de-la-page"]').first().click();
        await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(400);
        verifier('clic sur « Sécurité » : retour à la liste', (await page.locator('[data-securite-page]').count()) === 0);
        verifier('clic sur « Sécurité » : aucune liste ouverte', (await page.locator('[data-liste-option]').count()) === 0);
        await page.locator('[data-cran-a-menu="service-de-la-page"]').first().hover();
        await page.locator('[data-voisins-du-cran="service-de-la-page"]').first().click();
        const listeOuverte = await page.locator('[data-liste-option]').first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
        verifier('le chevron du service ouvre la liste des services', listeOuverte);
        await page.keyboard.press('Escape');
      } else {
        await ouvrirTousLesProjets(page);
        await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
        await capturer(page, 'liste-ordinateur-sombre');
        await mesurerLaColonneDeLaListe(page, 'sombre');
        await page.locator('[data-securite-ligne="p-essai"]').first().click();
        await page.locator('[data-securite-rapport]').first().waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(800);
        await capturer(page, 'projet-ordinateur-sombre');
        await mesurerLePleinCadre(page, 'sombre');
        await ouvrirTousLesProjets(page);
      }
      verifier(`aucune erreur de page (${theme})`, erreurs.length === 0, erreurs.join(' | '));

      /* 7. Téléphone : la même page rétrécie à 390 px (le service s'ouvre depuis l'écran déjà chargé). */
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await page.locator('[data-securite-ligne="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
      await capturer(page, `liste-telephone-${theme === 'light' ? 'clair' : 'sombre'}`);
      await page.locator('[data-securite-ligne="p-essai"]').first().click();
      await page.locator('[data-securite-page="p-essai"]').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('[data-securite-rapport]').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(600);
      const largeur = await page.evaluate(() => document.documentElement.scrollWidth);
      verifier(`téléphone (${theme}) : rien ne déborde en largeur`, largeur <= 390, `${largeur} px`);
      verifier(`téléphone (${theme}) : deux onglets, Rapport et Conversation`, (await page.locator('[data-securite-page] [role="tab"]').count()) === 2);
      await capturer(page, `projet-telephone-${theme === 'light' ? 'clair' : 'sombre'}`);
      const barre = await page.locator('[data-securite-page] [role="tablist"]').first().boundingBox();
      verifier(`téléphone (${theme}) : les onglets gardent la marge de page`, !!barre && barre.x >= 12 && barre.x + barre.width <= 390 - 12, barre ? `${Math.round(barre.x)} → ${Math.round(barre.x + barre.width)}` : '');
      /* UNE SEULE MARGE DE 16 PX, LE RETOUR ET « LANCER UN AUDIT » DANS L'EN-TÊTE DE LA FEUILLE (22/11/2026, #7ae7, #ccad). */
      const feuille = await page.evaluate(() => {
        const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
        const bloc = [...document.querySelectorAll('[data-securite-page] [data-securite-carte-note]')].find(vis);
        return {
          bord: bloc ? Math.round(bloc.getBoundingClientRect().left) : null,
          retour: !!document.querySelector('[data-entete-feuille] [data-entete-gauche] [data-retour-de-la-feuille]'),
          lancer: !!document.querySelector('[data-entete-feuille] [data-entete-droite] [data-securite-lancer]'),
          lancers: document.querySelectorAll('[data-securite-lancer]').length,
          rangeeVide: vis(document.querySelector('[data-tete-de-la-feuille-de-service]')),
        };
      });
      verifier(`téléphone (${theme}) : les blocs du rapport sont à 16 px du bord, une seule marge`, feuille.bord === 16, `${feuille.bord} px`);
      verifier(`téléphone (${theme}) : le retour est dans l’en-tête de la feuille`, feuille.retour);
      verifier(`téléphone (${theme}) : « Lancer un audit » est dans l’en-tête, en un seul exemplaire`, feuille.lancer && feuille.lancers === 1, `${feuille.lancers}`);
      verifier(`téléphone (${theme}) : aucune ligne vide sous l’en-tête de la feuille`, !feuille.rangeeVide);
      await page.locator('[data-securite-page] [role="tab"]').nth(1).click();
      await page.locator('[data-securite-conversation] textarea').first().waitFor({ state: 'visible', timeout: 30_000 });
      verifier(`téléphone (${theme}) : l’onglet « Conversation » se lit choisi`, (await page.locator('[data-securite-page] [role="tab"]').nth(1).getAttribute('aria-selected')) === 'true');
      await page.mouse.move(195, 600);
      await capturer(page, `conversation-telephone-${theme === 'light' ? 'clair' : 'sombre'}`);
      const champTel = await page.locator('[data-securite-conversation] textarea').first().boundingBox();
      verifier(`téléphone (${theme}) : le champ d’écriture est collé en bas`, !!champTel && champTel.y > 844 * 0.7, champTel ? `y = ${Math.round(champTel.y)}` : '');
      await contexte.close();
    }
  } catch (err) {
    if (CAPTURES && pageEnCours) await pageEnCours.screenshot({ path: path.join(CAPTURES, 'echec.png') }).catch(() => undefined);
    throw err;
  } finally {
    await navigateur.close();
  }
}


/** Le nombre d'audits du projet d'essai pour un déclencheur. */
function compterLesAudits(declencheur) {
  const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
  try {
    return db.prepare("SELECT COUNT(*) AS n FROM securite_audits WHERE project_id = 'p-essai' AND declencheur = ?").get(declencheur).n;
  } finally {
    db.close();
  }
}

async function attendre(condition, delai) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  return false;
}

/**
 * 13. LA CONVERSATION DE L'AGENT : ses repères, un bilan en liste à cocher, et le chargement EN REMONTANT. Un long
 * passé est posé en base — 300 messages avant un nouveau départ, puis un compte rendu qui porte un bloc
 * ```bilan-securite``` —, et la page est rechargée.
 */
async function verifierLaConversation(page) {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const agentId = db.prepare("SELECT agent_id FROM securite_projets WHERE project_id = 'p-essai'").get()?.agent_id;
  if (!agentId) {
    db.close();
    verifier('historique : l’agent de sécurité est né', false);
    return;
  }
  const debut = Date.now() - 30 * 24 * 3600_000;
  const inserer = db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)');
  const poser = (id, role, content, at) => inserer.run(id, agentId, role, JSON.stringify({ id, agentId, role, content, createdAt: at }), at);
  db.transaction(() => {
    for (let i = 0; i < 150; i++) {
      poser(`essai-q-${i}`, 'user', `Question ancienne numéro ${i}`, debut + i * 60_000);
      poser(`essai-r-${i}`, 'assistant', `Réponse ancienne numéro ${i}`, debut + i * 60_000 + 1000);
    }
  })();
  const depart = debut + 200 * 60_000;
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`chat.depart.${agentId}`, String(depart));
  const bilan = [
    { empreinte: 'injection-sql:injection-sql', titre: 'Requête montée à la main', categorie: 'injection-sql', statut: 'fait', but: 'Empêcher un visiteur de glisser des ordres dans la base.', fait: 'La requête est protégée.' },
    { empreinte: 'robots:garde', titre: 'Rien ne coupe les aspirateurs', categorie: 'robots', statut: 'a-finir', but: 'Bloquer les visiteurs insistants.', fait: 'Protection prête.', production: true },
    { empreinte: 'secrets:cle', titre: 'Clé dans le dépôt', categorie: 'secrets', statut: 'pas-fait', but: 'Sortir la clé du dépôt.', fait: 'Aucun coffre côté serveur.' },
  ];
  poser('essai-demande', 'user', 'Fais le bilan', Date.now() - 60_000);
  poser('essai-bilan', 'assistant', `### Ce qui est fait\n\nVoici le bilan.\n\n\`\`\`bilan-securite\n${JSON.stringify(bilan)}\n\`\`\``, Date.now() - 50_000);
  db.close();

  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-securite-conversation] [data-message]').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-bilan-securite]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  const groupes = await page.$$eval('[data-bilan-groupe]', (els) => els.map((e) => e.getAttribute('data-bilan-groupe')));
  verifier('un bilan de correction se lit en liste rangée Pas fait → À finir → Fait', groupes.join(',') === 'pas-fait,a-finir,fait', groupes.join(','));
  verifier('le compteur du bilan est juste', /1 fait · 1 à finir · 1 pas fait/.test((await page.locator('[data-bilan-compteur]').first().textContent().catch(() => '')) ?? ''));
  verifier('une ligne qui attend la production le dit', /Attend votre mise en production/.test((await page.locator('[data-bilan-ligne="robots:garde"]').first().textContent().catch(() => '')) ?? ''));
  verifier('les messages ordinaires restent du texte', /Réponse ancienne numéro 149/.test((await page.locator('[data-securite-conversation]').first().textContent()) ?? ''));
  const reperes = await page.locator('[data-securite-conversation] [data-repere-du-fil="audit"]').count();
  verifier('la conversation porte les repères des audits', reperes >= 1, String(reperes));
  if (CAPTURES) await capturer(page, 'conversation-bilan-ordinateur-clair');

  const avant = await page.locator('[data-securite-conversation] [data-message]').count();
  verifier('le chargeur du haut attend les échanges plus anciens', (await page.locator('[data-chargeur-du-haut]').count()) === 1, `${avant} message(s) reçus`);
  /* On remonte en haut du fil : le paquet précédent arrive tout seul, et le message lu reste à l'écran. */
  const repere = await page.evaluate(() => {
    const premier = document.querySelector('[data-securite-conversation] [data-message]');
    let zone = premier?.parentElement ?? null;
    while (zone && zone.scrollHeight <= zone.clientHeight + 2) zone = zone.parentElement;
    if (!zone || !premier) return null;
    zone.scrollTop = 0;
    return premier.getAttribute('data-message');
  });
  const charge = await attendre(async () => (await page.locator('[data-securite-conversation] [data-message]').count()) > avant, 15_000);
  const apres = await page.locator('[data-securite-conversation] [data-message]').count();
  verifier('en remontant, les échanges plus anciens se chargent', charge && apres >= 300, `${avant} → ${apres}`);
  await page.waitForTimeout(500);
  const resteVisible = await page.evaluate((id) => {
    const el = id ? document.querySelector(`[data-securite-conversation] [data-message="${id}"]`) : null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }, repere);
  verifier('la lecture reste en place pendant le chargement (aucun saut au début du paquet)', resteVisible);
  verifier('plus rien à charger : le chargeur du haut disparaît', (await page.locator('[data-chargeur-du-haut]').count()) === 0);
}

/** 9. LA PAGE D'UN PROJET EN PLEIN CADRE : mesures au pixel, sur la page ouverte à 1440 × 1000. */
async function mesurerLePleinCadre(page, theme) {
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const boite = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, droite: r.right, bas: r.bottom, l: r.width };
    };
    return {
      zone: boite('[data-contenu-de-la-page-de-service]'),
      volet: boite('aside[data-securite-volet]'),
      rangee: boite('[data-securite-page]'),
      colonne: boite('[data-securite-conversation] > div'),
      champ: boite('[data-securite-conversation] textarea'),
      hauteur: window.innerHeight,
    };
  });
  const { zone, volet, rangee, colonne, champ, hauteur } = m;
  const ok = zone && volet && rangee && colonne && champ;
  verifier(`plein cadre (${theme}) : la page est mesurable`, ok, JSON.stringify(m).slice(0, 200));
  if (!ok) return;
  /* PAS DE LIGNE DE TITRE AU-DESSUS D'UNE CONVERSATION + VOLET (22/11/2026) : le volet touche le haut de la zone, et
     aucun grand titre n'est visible. */
  const titreVisible = await page.evaluate(() => {
    const h = document.querySelector('[data-titre-de-page-de-service]');
    return !!h && h.getBoundingClientRect().height > 0 && getComputedStyle(h.closest('[data-tete-de-la-page-de-service]') ?? h).display !== 'none';
  });
  verifier(`plein cadre (${theme}) : aucune ligne de titre au-dessus de la conversation`, !titreVisible);
  verifier(`plein cadre (${theme}) : le volet touche le haut de la zone`, Math.abs(volet.y - zone.y) <= 2, `volet ${Math.round(volet.y)} / zone ${Math.round(zone.y)}`);
  verifier(`plein cadre (${theme}) : le volet touche le bord droit, aucun vide à sa droite`, Math.abs(volet.droite - zone.droite) <= 1, `volet ${Math.round(volet.droite)} / zone ${Math.round(zone.droite)}`);
  verifier(`plein cadre (${theme}) : la rangée part du bord gauche de la zone`, Math.abs(rangee.x - zone.x) <= 1, `rangée ${Math.round(rangee.x)} / zone ${Math.round(zone.x)}`);
  const milieu = (zone.x + volet.x) / 2;
  const centre = colonne.x + colonne.l / 2;
  verifier(`plein cadre (${theme}) : la conversation est centrée dans la place restante`, Math.abs(centre - milieu) <= 4, `centre ${Math.round(centre)} / milieu ${Math.round(milieu)}`);
  verifier(`plein cadre (${theme}) : le champ d’écriture est collé en bas`, champ.y > hauteur * 0.85, `y = ${Math.round(champ.y)} / ${hauteur}`);
}

/** La LISTE garde sa colonne de service : ses marges de côté (40 px) et sa marge haute — le plein cadre ne la touche pas. */
async function mesurerLaColonneDeLaListe(page, theme) {
  const m = await page.evaluate(() => {
    const c = document.querySelector('[data-corps-de-la-page-de-service]');
    if (!c) return null;
    const st = getComputedStyle(c);
    return { gauche: parseFloat(st.paddingLeft), droite: parseFloat(st.paddingRight), haut: parseFloat(st.marginTop) };
  });
  verifier(`liste (${theme}) : elle garde sa colonne et ses marges`, !!m && m.gauche >= 32 && m.gauche === m.droite && m.haut >= 16, JSON.stringify(m));
}

try {
  await principal();
} catch (err) {
  verifier('le contrôle a pu aller au bout', false, String(err?.message ?? err).slice(0, 300));
  console.error(journal.slice(-30).join(''));
} finally {
  nettoyer();
}
const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis`);
process.exit(echecs ? 1 : 0);
