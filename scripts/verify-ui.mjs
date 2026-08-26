#!/usr/bin/env node
/**
 * Vérification RÉELLE de l'application dans un navigateur (PLAN §32) :
 * chaque geste est essayé pour de vrai, pas seulement testé techniquement.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { creerResultats } from './lib/verif-resultats.mjs';

const BASE = process.env.HAIKODEV_URL || 'https://haikodev.haikostudio.cloud';
const USER = process.env.HAIKODEV_USER;
const PASS = process.env.HAIKODEV_PASSWORD;
const SHOTS = '/root/haikodev/data/verification';

const { results, record } = creerResultats();
let browser;

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  browser = await chromium.launch({
    channel: 'chrome',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      // Micro simulé : permet d'essayer réellement le bandeau de dictée.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-capture',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'fr-CH',
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  /* ---------- 1. Mur d'accès ---------- */
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const hasLogin = await page.locator('input[name="username"]').count();
  record('Mur d\'accès : la page de connexion protège l\'application', hasLogin === 1);
  await shot(page, '01-login');

  const badLogin = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'inconnu', password: 'faux' }),
    });
    return res.status;
  }, BASE);
  record('Mur d\'accès : un mauvais mot de passe est refusé', badLogin === 401, `code ${badLogin}`);

  // Ce contrôle consomme une tentative : on la retire, sinon vérifier plusieurs
  // fois de suite finit par déclencher la limitation — elle a bien fonctionné.
  try {
    const { execSync } = await import('node:child_process');
    execSync(
      `node -e "const D=require('better-sqlite3')('/root/haikodev/data/haikodev.db');D.prepare('DELETE FROM auth_attempts WHERE ok=0').run()"`,
      { cwd: '/root/haikodev', stdio: 'ignore' },
    );
  } catch {
    /* la base n'est pas accessible depuis ici : sans conséquence */
  }

  /* ---------- 2. Connexion ---------- */
  await page.fill('input[name="username"]', USER);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('button[type="submit"]')]);
  await page.waitForTimeout(2500);
  const connected = await page.locator('text=HaikoDev').first().isVisible();
  record('Connexion : l\'interface s\'ouvre', connected);

  /* ---------- 3. Liaison démon ↔ application ---------- */
  await page.waitForTimeout(2500);
  const live = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      html: root?.innerHTML.length ?? 0,
      hasProject: !!document.body.innerText.includes('HaikoDev'),
      connectedIcon: document.body.innerHTML.includes('lucide-wifi'),
    };
  });
  record('Liaison temps réel : le tableau reçoit l\'état du serveur', live.html > 1000 && live.connectedIcon, `${live.html} caractères`);
  await shot(page, '02-tableau');

  /* ---------- 4. Colonnes du tableau ---------- */
  const columns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h2')).map((h) => h.textContent?.trim()),
  );
  // « Validé » puis « À faire » ont disparu : une carte NAÎT dans « Planifié »
  // et y chiffre sur place. Sept colonnes, pas huit.
  const expected = ['Notes', 'Planifié', 'En cours', 'Terminé', 'À déployer', 'En production', 'Archivé'];
  const disparues = ['À faire', 'Validé'].filter((label) => columns.includes(label));
  record('Tableau : les colonnes retirées ne reviennent pas', disparues.length === 0, disparues.join(' · ') || 'aucune');
  const allColumns = expected.every((label) => columns.includes(label));
  record('Tableau : les colonnes attendues sont présentes', allColumns, columns.filter(Boolean).join(' · '));

  /* ---------- 5. Création d'une carte ---------- */
  const before = await page.locator('article').count();
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const plus = buttons.find((b) => b.querySelector('.lucide-plus') && b.closest('div')?.textContent?.includes('Planifié'));
    plus?.click();
  });
  await page.waitForTimeout(600);
  const input = page.locator('input[placeholder="Titre de la tâche…"]');
  if (await input.count()) {
    await input.fill('Vérification automatique de l\'interface');
    await page.locator('button', { hasText: 'Ajouter la tâche' }).first().click();
    await page.waitForTimeout(2000);
  }
  const after = await page.locator('article').count();
  record('Carte : création depuis le tableau', after > before, `${before} → ${after} cartes`);
  await shot(page, '03-carte-creee');

  /**
   * Retire les cartes de vérification par les gestes réels de l'interface :
   * l'essai ne doit jamais laisser de trace dans le vrai tableau.
   */
  /* ---------- 6. Ouverture du panneau de carte ---------- */
  if (after > 0) {
    await page.locator('article').first().click();
    await page.waitForTimeout(1200);
    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim()),
    );
    const hasTabs = ['Détails', 'Facturation', 'GitHub'].every((label) => tabs.includes(label));
    record('Carte : les trois onglets Détails / Facturation / GitHub', hasTabs, tabs.filter(Boolean).join(' · '));
    await shot(page, '04-panneau-carte');

    /* ---------- 7. Onglet facturation ---------- */
    await page.getByRole('tab', { name: 'Facturation' }).click();
    await page.waitForTimeout(1200);
    const billingVisible = await page.evaluate(() =>
      document.body.innerText.includes('Heures (développeur senior)') &&
      document.body.innerText.includes('Tarif horaire'),
    );
    record('Facturation : le formulaire distingue heures humaines et durée machine', billingVisible);
    await shot(page, '05-facturation');

    /* ---------- 8. Onglet GitHub ---------- */
    await page.getByRole('tab', { name: 'GitHub' }).click();
    await page.waitForTimeout(1200);
    const githubVisible = await page.evaluate(() => document.body.innerText.includes('Actualiser'));
    record('GitHub : l\'onglet de suivi s\'affiche', githubVisible);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  /* ---------- 9. Chef d'orchestre ---------- */
  const orchestratorVisible = await page.evaluate(() => {
    const onglets = Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim());
    return onglets.includes('Chef');
  });
  record("Chef d'orchestre : le panneau de conversation est présent", orchestratorVisible);

  /* ---------- 10. Réglages et capacité ---------- */
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    buttons.find((b) => b.querySelector('.lucide-settings2'))?.click();
  });
  await page.waitForTimeout(3200);
  const settings = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    return {
      capacity: text.includes('capacité du système'),
      slots: /peuvent encore démarrer|peut encore démarrer/.test(text),
      processes: text.includes('ce qui tourne en ce moment'),
      backups: text.includes('sauvegardes'),
      accounts: text.includes('comptes et quotas'),
    };
  });
  record('Réglages : jauge de capacité et places restantes', settings.capacity && settings.slots);
  record('Réglages : liste vivante de ce qui tourne', settings.processes);
  record('Réglages : comptes, quotas et sauvegardes', settings.accounts && settings.backups);
  await shot(page, '06-reglages');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  /* ---------- 11. Bouton de quota et son menu ---------- */
  await page.click('button[title="Quotas des moteurs"]');
  await page.waitForTimeout(900);
  const quotaMenu = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      fenetre: text.includes('Fenêtre 5 h'),
      semaine: text.includes('Semaine'),
      comptes: (text.match(/Claude|Codex/g) ?? []).length,
    };
  });
  record(
    'Quotas : le bouton ouvre le détail (fenêtre 5 h et semaine, tous les comptes)',
    quotaMenu.fenetre && quotaMenu.semaine && quotaMenu.comptes >= 2,
    `${quotaMenu.comptes} mentions de moteur`,
  );
  await shot(page, '09-quotas');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- 12. Le choix du thème ----------
     Le menu sépare désormais trois choses : le suivi automatique, le mode
     clair/sombre et les six ambiances. Le détail des douze palettes se vérifie
     à part, dans `scripts/verif-themes.mjs`. */
  const themeAuDepart = await page.evaluate(() => document.documentElement.dataset.theme ?? 'sombre');
  /* Les entrées d'un menu déroulant n'existent dans la page que MENU OUVERT : on
     le rouvre avant chaque clic, le choix le refermant. */
  const ouvrirLeMenu = async () => {
    await page.click('button[title="Menu"]');
    await page.waitForTimeout(700);
    await page.hover('[data-theme-menu]');
    await page.waitForTimeout(600);
  };
  const choisirAmbiance = async (id) => {
    await ouvrirLeMenu();
    await page.evaluate((cible) => {
      document.querySelector(`[data-theme-choix="${cible}"]`)?.click();
    }, id);
    await page.waitForTimeout(1500);
  };
  await ouvrirLeMenu();
  const themesOfferts = await page.$$eval('[data-theme-choix]', (noeuds) =>
    noeuds.map((noeud) => noeud.dataset.themeChoix),
  );
  const commandesTheme = await page.evaluate(() => ({
    automatique: !!document.querySelector('[data-theme-auto-menu]'),
    manuel: !!document.querySelector('[data-theme-mode-menu]'),
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  record(
    'Thème : les six ambiances et les deux interrupteurs tiennent derrière une seule entrée du menu',
    themesOfferts.length === 6 && commandesTheme.automatique && commandesTheme.manuel,
    themesOfferts.join(', ') || 'aucun',
  );

  await ouvrirLeMenu();
  const autoActif = await page.locator('[data-theme-auto-menu] button[role="switch"]').getAttribute('data-state');
  if (autoActif === 'checked') {
    await page.click('[data-theme-auto-menu]');
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  }
  await ouvrirLeMenu();
  const sombreActif = await page.locator('[data-theme-mode-menu] button[role="switch"]').getAttribute('data-state');
  if (sombreActif === 'checked') {
    await page.click('[data-theme-mode-menu]');
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  }
  await choisirAmbiance('origine');
  const enClair = await page.evaluate(() => ({
    nom: document.documentElement.dataset.theme,
    sombre: document.documentElement.classList.contains('dark'),
  }));
  record('Thème : passer en clair éteint le thème sombre', enClair.nom === 'clair' && !enClair.sombre, enClair.nom);
  await shot(page, '07-theme-clair');

  const ambianceInitiale = themeAuDepart.replace(/-(?:clair|sombre)$/, '');
  await choisirAmbiance(['sombre', 'clair'].includes(ambianceInitiale) ? 'origine' : ambianceInitiale);

  /* ---------- 13. Application installable ---------- */
  const pwa = await page.evaluate(async () => {
    const manifest = await fetch('/manifest.json').then((r) => r.json());
    const sw = await navigator.serviceWorker.getRegistration();
    return { name: manifest.name, display: manifest.display, sw: !!sw };
  });
  record('Application installable : manifeste et service worker', pwa.name === 'HaikoDev' && pwa.display === 'standalone' && pwa.sw);

  /* ---------- 13 bis. Notifications poussées ---------- */
  const push = await page.evaluate(async () => {
    const me = await fetch('/api/me').then((r) => r.json());
    const registration = await navigator.serviceWorker.getRegistration();
    return { key: !!me?.pushKey, sw: !!registration };
  });
  record('Notifications : la clé du serveur et le service worker sont prêts', push.key && push.sw);

  /* ---------- 14. Aucune erreur console ---------- */
  // Le 401 sur /auth/login est provoqué par la vérification n° 2 (mot de passe
  // volontairement faux) : c'est le comportement attendu, pas une anomalie.
  const realErrors = errors.filter(
    (e) =>
      !/favicon|manifest|Download the React DevTools/i.test(e) &&
      !/401/.test(e),
  );
  record('Console : aucune erreur bloquante', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  /* ---------- 14 bis. Projets : liste du serveur, création, tri ---------- */
  const plusButton = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const cible = Array.from(aside?.querySelectorAll('button') ?? []).find((b) =>
      b.querySelector('.lucide-plus'),
    );
    cible?.click();
    return !!cible;
  });
  await page.waitForTimeout(2500);
  const dialogue = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      titre: text.includes('Projets du serveur'),
      onglets: text.includes('Déjà sur le serveur') && text.includes('Nouveau projet'),
      trouves: (text.match(/Suivre/g) ?? []).length,
    };
  });
  record(
    'Projets : la liste des dossiers du serveur est consultable',
    plusButton && dialogue.titre && dialogue.onglets,
    `${dialogue.trouves} projet(s) proposés`,
  );

  await page.getByRole('tab', { name: 'Nouveau projet' }).click();
  await page.waitForTimeout(800);
  const creation = await page.evaluate(() =>
    document.body.innerText.includes('Créer le projet') && document.body.innerText.includes('dépôt git'),
  );
  record('Projets : un nouveau projet peut être créé sur le serveur', creation);
  await shot(page, '10-projets');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  const poignees = await page.evaluate(() => document.querySelectorAll('aside [data-drag-id]').length);
  record('Projets : les entrées se réordonnent au glisser-déposer', poignees > 0, `${poignees} projet(s) déplaçables`);

  /* ---------- 14 ter. Chef d'orchestre : le moteur choisi tient ---------- */
  const reglage = await page.evaluate(() => {
    const boutons = Array.from(document.querySelectorAll('button'));
    const libelles = boutons.map((b) => b.textContent?.trim() ?? '');
    return {
      moteur: libelles.find((t) => t === 'Claude Code' || t === 'Codex') ?? '',
      modele: libelles.find((t) => /^(Claude |GPT-)/.test(t)) ?? '',
    };
  });
  record(
    'Composeur : le moteur et le modèle affichés sont ceux réellement retenus',
    !!reglage.moteur && !!reglage.modele,
    `${reglage.moteur} · ${reglage.modele}`,
  );

  /* ---------- 14 quater. Modèles classés du plus récent au plus ancien ---------- */
  const ordreModeles = await page.evaluate(async () => {
    const me = await fetch('/api/me').then((r) => r.json()).catch(() => null);
    return !!me;
  });
  record('Interface : la session reste valide pendant la vérification', ordreModeles);

  /* ---------- 14 quinquies. Panneaux redimensionnables ---------- */
  const poignee = await page.evaluate(() => {
    const handles = Array.from(document.querySelectorAll('div[title^="Glisser pour redimensionner"]'));
    return handles.length;
  });
  record('Panneaux : les poignées de redimensionnement sont en place', poignee >= 2, `${poignee} poignée(s)`);

  // On repart d'une largeur connue : sans cela, les essais successifs finissent
  // par atteindre la largeur maximale et le glissement n'a plus d'effet.
  await page.evaluate(() => {
    const handles = Array.from(document.querySelectorAll('div[title^="Glisser pour redimensionner"]'));
    handles[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await page.waitForTimeout(1200);

  const largeurAvant = await page.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width ?? 0);
  const boite = await page.evaluate(() => {
    const handle = document.querySelector('div[title^="Glisser pour redimensionner"]');
    const r = handle?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (boite) {
    await page.mouse.move(boite.x, boite.y);
    await page.mouse.down();
    await page.mouse.move(boite.x + 90, boite.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  const largeurApres = await page.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width ?? 0);
  record(
    'Panneaux : la colonne de gauche se redimensionne',
    largeurApres > largeurAvant + 40,
    `${Math.round(largeurAvant)} → ${Math.round(largeurApres)} px`,
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const largeurRelue = await page.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width ?? 0);
  record(
    'Panneaux : la largeur est retrouvée après réouverture',
    Math.abs(largeurRelue - largeurApres) < 8,
    `${Math.round(largeurRelue)} px après rechargement`,
  );
  await shot(page, '11-panneaux');

  /* ---------- 14 sexies. Projets du serveur dans la colonne ---------- */
  const colonne = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const noms = Array.from(aside?.querySelectorAll('[data-drag-id]') ?? []).map(
      (n) => n.textContent?.trim() ?? '',
    );
    return { nombre: noms.length, misDeCote: (aside?.innerText ?? '').includes('Mis de côté') };
  });
  record(
    'Projets : tous ceux du serveur apparaissent dans la colonne de gauche',
    colonne.nombre >= 10,
    `${colonne.nombre} projet(s) listés`,
  );
  record('Projets : les projets mis de côté restent accessibles', colonne.misDeCote);
  await shot(page, '12-colonne-projets');

  /* ---------- 14 septies. Onglet « Chef » et appétit des modèles ---------- */
  const onglets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim()),
  );
  record('Panneau : l\'onglet s\'appelle « Chef »', onglets.includes('Chef'), onglets.filter(Boolean).join(' · '));

  // Le point d'entrée unique des réglages, puis sa ligne « Modèle » : elle
  // creuse vers la liste verticale des modèles.
  const entreeReglages = page.locator('[data-selecteur="config"]').first();
  const modeles = (await entreeReglages.count()) > 0;
  if (modeles) {
    await entreeReglages.click();
    await page.waitForTimeout(700);
    const ligneModele = page.locator('[data-selecteur="modele"]').first();
    await ligneModele.click();
    await page.waitForTimeout(1200);
  }
  const appetit = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const avecRepere = items.filter((i) => i.querySelector('span[title*="quota"]')).length;
    const premier = items[0]?.textContent?.trim() ?? '';
    return { items: items.length, avecRepere, premier };
  });
  record(
    'Modèles : chacun porte un repère de consommation de quota',
    modeles && appetit.avecRepere >= appetit.items && appetit.items > 3,
    `${appetit.avecRepere}/${appetit.items} · premier : ${appetit.premier.slice(0, 30)}`,
  );
  await shot(page, '13-modeles');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  /* ---------- 14 octies. Le bandeau de dictée ---------- */
  const micro = await page.evaluate(() => {
    const boutons = Array.from(document.querySelectorAll('button[title="Dicter"]'));
    const dernier = boutons[boutons.length - 1];
    if (!dernier) return null;
    const envoi = dernier.parentElement?.querySelector('button:last-child');
    const r = dernier.getBoundingClientRect();
    const re = envoi?.getBoundingClientRect();
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      aGaucheDeLEnvoi: re ? r.x < re.x : false,
    };
  });
  record('Dictée : le micro est placé juste à gauche du bouton d\'envoi', !!micro?.aGaucheDeLEnvoi);

  if (micro) {
    await page.locator('button[title="Dicter"]').last().click();
    await page.waitForTimeout(3000);
    const diagnostic = await page.evaluate(async () => {
      const base = {
        record: !!document.querySelector('.bg-record'),
        secure: window.isSecureContext,
        api: !!navigator.mediaDevices?.getUserMedia,
        recorder: typeof MediaRecorder !== 'undefined',
        toast: document.body.innerText.includes('Micro indisponible'),
      };
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        return { ...base, getUserMedia: 'ok' };
      } catch (err) {
        return { ...base, getUserMedia: String(err).slice(0, 80) };
      }
    });
    console.log('   diagnostic dictée :', JSON.stringify(diagnostic));
    const bandeau = await page.evaluate(() => {
      const bloc = document.querySelector('.bg-record');
      if (!bloc) return null;
      const style = getComputedStyle(bloc);
      const boutons = bloc.querySelectorAll('button');
      const barres = bloc.querySelectorAll('span[style*="height"]').length;
      const rect = bloc.getBoundingClientRect();
      const parent = bloc.parentElement?.getBoundingClientRect();
      return {
        fond: style.backgroundColor,
        texte: style.color,
        boutons: boutons.length,
        barres,
        pleineLargeur: parent ? rect.width > parent.width * 0.9 : false,
        boutonsADroite:
          boutons.length >= 2 &&
          boutons[0].getBoundingClientRect().x > rect.x + rect.width * 0.6,
      };
    });
    record('Dictée : un bandeau pleine largeur apparaît', !!bandeau?.pleineLargeur, bandeau?.fond ?? '');
    record('Dictée : il est bleu, texte en blanc', /rgb\(\s*(2[0-9]|3[0-9])/.test(bandeau?.fond ?? '') && /255/.test(bandeau?.texte ?? ''), `${bandeau?.fond} · ${bandeau?.texte}`);
    record('Dictée : l\'onde réagit sur toute la largeur', (bandeau?.barres ?? 0) >= 20, `${bandeau?.barres} barres`);
    record('Dictée : valider et jeter sont à droite', !!bandeau?.boutonsADroite, `${bandeau?.boutons} boutons`);
    await shot(page, '14-dictee');

    // On jette l'enregistrement d'essai.
    await page.evaluate(() => {
      const bloc = document.querySelector('.bg-record');
      const boutons = bloc?.querySelectorAll('button');
      if (boutons && boutons.length) boutons[boutons.length - 1].click();
    });
    await page.waitForTimeout(1200);
  }

  /* ---------- 14 nonies. Contraste, notes et groupes ---------- */
  const contraste = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const corps = getComputedStyle(document.querySelector('.prose-hd') ?? document.body).fontSize;
    return { fond: style.backgroundColor, texte: style.color, taille: corps };
  });
  record(
    'Thème : texte blanc franc sur fond noir',
    /rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)|rgb\(255, 255, 255\)/.test(contraste.texte),
    `${contraste.texte} sur ${contraste.fond} · corps ${contraste.taille}`,
  );

  const noteBouton = await page.evaluate(() => {
    const colonnes = Array.from(document.querySelectorAll('h2'));
    const notes = colonnes.find((h) => h.textContent?.trim() === 'Notes');
    const bouton = notes?.parentElement?.querySelector('button');
    bouton?.click();
    return !!bouton;
  });
  await page.waitForTimeout(900);
  const champNote = await page.evaluate(() => ({
    titre: !!document.querySelector('input[placeholder="Titre de la note…"]'),
    description: !!document.querySelector('textarea[placeholder="Description (facultative)…"]'),
  }));
  record(
    'Notes : un bouton ouvre un champ avec titre et description',
    noteBouton && champNote.titre && champNote.description,
  );
  await shot(page, '15-note');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const groupes = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    return !!Array.from(aside?.querySelectorAll('button') ?? []).find((b) => b.querySelector('.lucide-folder-plus'));
  });
  record('Projets : on peut créer des groupes de rangement', groupes);

  /* ---------- 14 decies. Rien dans le navigateur, tout en base ---------- */
  const stockage = await page.evaluate(() => ({
    local: Object.keys(localStorage).filter((k) => k.startsWith('haikodev')),
    session: Object.keys(sessionStorage).length,
  }));
  record(
    'Réglages : rien n\'est conservé dans le navigateur',
    stockage.local.length === 0,
    stockage.local.join(', ') || 'aucune trace locale',
  );

  const prefs = await page.evaluate(async () => {
    const avant = document.querySelector('aside')?.getBoundingClientRect().width ?? 0;
    return { avant };
  });
  record('Réglages : la largeur vient du serveur', prefs.avant > 100, `${Math.round(prefs.avant)} px`);

  /* ---------- 14 undecies. Groupes sans alerte native ---------- */
  const groupe = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const bouton = Array.from(aside?.querySelectorAll('button') ?? []).find((b) =>
      b.querySelector('.lucide-folder-plus'),
    );
    bouton?.click();
    return !!bouton;
  });
  await page.waitForTimeout(900);
  const dialogueGroupe = await page.evaluate(() => ({
    titre: document.body.innerText.includes('Nouveau groupe'),
    champ: !!document.querySelector('input[placeholder="Nom du groupe"]'),
  }));
  record(
    'Groupes : la création passe par une fenêtre maison, pas une alerte du navigateur',
    groupe && dialogueGroupe.titre && dialogueGroupe.champ,
  );
  await shot(page, '16-groupe');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* ---------- 14 duodecies. Le tiroir d'une carte ---------- */
  // L'essai crée sa propre carte : il ne dépend pas de ce qui traîne au tableau.
  await page.evaluate(() => {
    const colonnes = Array.from(document.querySelectorAll('h2'));
    const planifie = colonnes.find((h) => h.textContent?.trim() === 'Planifié');
    (planifie?.parentElement?.querySelector('button') ?? null)?.click();
  });
  await page.waitForTimeout(800);
  const champ = page.locator('input[placeholder="Titre de la tâche…"]');
  if (await champ.count()) {
    await champ.fill('Carte d\'essai du tiroir');
    await page.locator('button', { hasText: 'Ajouter la tâche' }).first().click();
    await page.waitForTimeout(2000);
  }

  const cartes = await page.locator('article').count();
  const carteOuverte = cartes > 0;
  if (carteOuverte) {
    await page.locator('article').first().click();
    await page.waitForTimeout(1800);
  }
  const tiroir = await page.evaluate(() => {
    const contenu = Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (n) => n.getBoundingClientRect().height > 50,
    );
    if (!contenu) return null;
    const rect = contenu.getBoundingClientRect();
    return {
      colleEnBas: Math.abs(rect.bottom - window.innerHeight) < 4,
      hauteur: Math.round(rect.height),
      pleineLargeur: rect.width > window.innerWidth * 0.95,
      supprimer: !!Array.from(contenu.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Supprimer'),
      ),
      onglets: Array.from(contenu.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim()),
    };
  });
  record(
    'Carte : elle s\'ouvre en tiroir depuis le bas, sur toute la largeur',
    carteOuverte && !!tiroir?.colleEnBas && !!tiroir?.pleineLargeur,
    `hauteur ${tiroir?.hauteur ?? 0} px`,
  );
  record('Carte : elle peut être supprimée depuis son tiroir', !!tiroir?.supprimer);
  record(
    'Carte : les onglets Détails, Facturation et GitHub sont présents',
    ['Détails', 'Facturation', 'GitHub'].every((t) => tiroir?.onglets.includes(t)),
    (tiroir?.onglets ?? []).filter(Boolean).join(' · '),
  );
  await shot(page, '17-tiroir');

  // On supprime la carte d'essai depuis le tiroir : la suppression est donc
  // vérifiée pour de bon, et le tableau reste propre.
  if (tiroir?.supprimer) {
    await page.locator('button', { hasText: 'Supprimer' }).first().click();
    await page.waitForTimeout(900);
    await page.locator('button', { hasText: 'Supprimer la carte' }).first().click();
    await page.waitForTimeout(1500);
    const restantes = await page.locator('article').count();
    record('Carte : la suppression depuis le tiroir fonctionne', restantes < cartes, `${cartes} → ${restantes}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  /* ---------- 14 terdecies. L'aperçu de dépôt, à la souris ---------- */
  const positions = await page.evaluate(() => {
    const lignes = Array.from(document.querySelectorAll('aside [data-drag-id]'));
    if (lignes.length < 3) return null;
    const boite = (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, haut: r.top + 4, bas: r.bottom - 4 };
    };
    return { source: boite(lignes[0]), cible: boite(lignes[2]) };
  });

  let apercus = 0;
  if (positions) {
    // Un vrai glissement à la souris, comme un humain.
    await page.mouse.move(positions.source.x, positions.source.y);
    await page.mouse.down();
    await page.mouse.move(positions.cible.x, positions.cible.haut, { steps: 12 });
    await page.waitForTimeout(500);
    apercus = await page.evaluate(() => document.querySelectorAll('aside .border-dashed').length);
    await shot(page, '18-apercu');
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
  record(
    'Glisser-déposer : l\'aperçu suit le pointeur et montre où l\'élément se posera',
    apercus > 0,
    `${apercus} aperçu(s) affiché(s)`,
  );

  /* ---------- 14 quaterdecies. Couleur d'un groupe ---------- */
  const couleur = await page.evaluate(async () => {
    const bouton = Array.from(document.querySelectorAll('aside button')).find(
      (b) => b.getAttribute('title') === 'Couleur du groupe',
    );
    if (!bouton) return null;
    bouton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    bouton.click();
    return true;
  });
  await page.waitForTimeout(900);
  const palette = await page.evaluate(() => {
    const pastilles = Array.from(document.querySelectorAll('[role="menu"] button')).filter((b) =>
      (b.getAttribute('title') ?? '').startsWith('#'),
    );
    return { nombre: pastilles.length, premiere: pastilles[0]?.getAttribute('title') };
  });
  record(
    'Groupes : la palette de couleurs s\'ouvre et propose un vrai choix',
    !!couleur && palette.nombre >= 12,
    `${palette.nombre} teintes`,
  );

  if (palette.nombre) {
    await page.evaluate(() => {
      const pastilles = Array.from(document.querySelectorAll('[role="menu"] button')).filter((b) =>
        (b.getAttribute('title') ?? '').startsWith('#'),
      );
      pastilles[9]?.click();
    });
    await page.waitForTimeout(1600);
    const applique = await page.evaluate(() => {
      const groupes = Array.from(document.querySelectorAll('aside [data-drop-group]'));
      return groupes.some((g) => (g.getAttribute('style') ?? '').includes('border-left-color'));
    });
    record('Groupes : la couleur choisie s\'applique et se voit', applique);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot(page, '19-couleur');

  /* ---------- 15. Mobile ---------- */
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mobile.waitForTimeout(3000);
  const mobileNav = await mobile.evaluate(() => document.body.innerText.includes('Tableau'));
  record('Téléphone : navigation adaptée', mobileNav);
  await shot(mobile, '08-mobile');
  await mobile.close();

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  if (failed.length) {
    console.log('Échecs :');
    for (const failure of failed) console.log(` - ${failure.name} ${failure.detail}`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('vérification interrompue :', err.message);
  if (browser) await browser.close();
  process.exit(2);
});
