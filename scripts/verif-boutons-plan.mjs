#!/usr/bin/env node
/**
 * LES BOUTONS « VALIDER / REFUSER » AU BAS D'UN PLAN, ET LE REPLI DES
 * ITÉRATIONS PRÉCÉDENTES — dans un vrai navigateur, sur un agent RÉEL.
 *
 * Le plan s'affine par itérations : seul le DERNIER porte ses boutons. Une
 * version précédente se replie toute seule, se rouvre en lecture, et n'offre
 * plus rien à décider (`indexDuPlanCourant`, `shared/src/plan-conversation.ts`).
 *
 * Le plan lui-même est INJECTÉ par le point d'essai de la page
 * (`window.haikodevEssai.plan`, `web/src/lib/client.ts`) : on n'attend pas
 * qu'un vrai tour d'écriture en produise un. « VALIDER », lui, envoie un vrai
 * message au vrai chef d'orchestre du projet d'essai — c'est ce chemin-là
 * qu'on juge, exactement celui qu'emprunterait un clic humain. L'agent est
 * arrêté juste après l'envoi : on n'attend pas sa réponse, seul le DÉPART du
 * message compte ici.
 *
 * « REFUSER », LUI, N'ENVOIE RIEN : il écrit dans la barre d'écriture et
 * s'arrête là — c'est justement ce que ce script vérifie, avec la mise en
 * colonne des boutons sur écran étroit.
 *
 * ON Y VÉRIFIE AUSSI, DEPUIS : le FOND GRIS du cadre (il doit se distinguer de
 * la page derrière lui, dans les deux thèmes), la partie « Améliorations
 * apportées » devenue une LISTE CLIQUABLE — un clic retient l'idée dans la
 * barre d'écriture, sans rien envoyer —, et la DISPARITION des pastilles
 * d'axes de réflexion qui étaient posées sous le cadre.
 *
 *   HAIKO_PLAN_URL=http://localhost:7099 node scripts/verif-boutons-plan.mjs
 *
 * Le serveur de DÉVELOPPEMENT est visé : un script de vérification ne reprend
 * jamais HAIKODEV_URL, qui désigne l'application déjà publiée, ni
 * HAIKODEV_TOKEN, qui est le jeton d'un agent.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from '/root/haikodev/node_modules/better-sqlite3/lib/index.js';

const BASE = process.env.HAIKO_PLAN_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';
fs.mkdirSync(SHOTS, { recursive: true });

const db = new Database('/root/haikodev/data/haikodev.db');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Jeton de session, une heure, haché en base et retiré en partant.
const jeton = crypto.randomBytes(32).toString('base64url');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jeton),
  Date.now(),
  Date.now() + 3600_000,
  'vérification boutons plan',
);

// Un projet d'essai jetable : un dossier vide suffit, la conversation ne
// touche à aucun code.
const dossier = fs.mkdtempSync('/tmp/boutons-plan-');
const projetId = crypto.randomUUID();
const maintenant = Date.now();
const projet = {
  id: projetId,
  name: 'Essai — boutons plan',
  path: dossier,
  defaultEngine: 'claude',
  isSelf: false,
  miseEnProduction: {},
  archived: false,
  createdAt: maintenant,
  updatedAt: maintenant,
};
db.prepare(
  'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const nettoyer = () => {
  try {
    for (const agent of db.prepare('SELECT id FROM agents WHERE project_id = ?').all(projetId)) {
      db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agent.id);
      db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agent.id);
    }
    db.prepare('DELETE FROM agents WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM cards WHERE project_id = ?').run(projetId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projetId);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
  } catch (err) {
    console.error('ménage : ', err);
  }
  fs.rmSync(dossier, { recursive: true, force: true });
};
process.on('exit', nettoyer);

/*
 * PASSER EN TÉLÉPHONE. Sous 640 px, la conversation vit derrière le bouton
 * « Chef » de la barre du bas, et l'application RETIENT la dernière vue
 * ouverte : un essai peut donc arriver sur le tableau et n'y trouver aucun
 * plan. On force la vue, puis on attend que le cadre du plan soit RÉELLEMENT
 * mesurable.
 *
 * L'application monte DEUX conversations — celle du grand écran et celle du
 * téléphone —, dont une seule occupe des pixels. Les mesures passent donc par
 * la hauteur réelle de chaque élément, jamais par un sélecteur descendant :
 * l'arbre invisible porte les mêmes repères, et l'on mesurerait le mauvais.
 */
async function cadreCourantVisible(page) {
  return page.evaluate(() => {
    const cadres = Array.from(document.querySelectorAll('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="courant"]'));
    const vu = cadres.find((n) => n.getBoundingClientRect().height > 0);
    if (!vu) return null;
    const boite = (selecteur) => {
      const cible = vu.querySelector(selecteur);
      if (!cible) return null;
      const r = cible.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const bouton = (libelle) => {
      const cible = Array.from(vu.querySelectorAll('[data-boutons-plan] button')).find((b) =>
        (b.textContent ?? '').trim().startsWith(libelle),
      );
      if (!cible) return null;
      const r = cible.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const r = vu.getBoundingClientRect();
    return {
      cadre: { x: r.x, y: r.y, width: r.width, height: r.height },
      entete: boite('[data-entete-plan]'),
      valider: bouton('Valider'),
      refuser: bouton('Refuser'),
    };
  });
}

async function attendreLeCadreCourant(page) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="courant"]')).some(
        (n) => n.getBoundingClientRect().height > 0 && n.querySelector('[data-entete-plan]'),
      ),
    null,
    { timeout: 20000 },
  );
}

async function passerEnTelephone(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const chef = page.locator('[data-menu-bas]').getByRole('button', { name: 'Chef' });
  if (await chef.count()) {
    await chef.first().click();
    await page.waitForTimeout(400);
  }
  await attendreLeCadreCourant(page);
}

/** …et revenir au grand écran, une fois la mesure prise. */
async function revenirAuGrandEcran(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await attendreLeCadreCourant(page);
}

const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
await contexte.addCookies([
  { name: 'haikodev_session', value: jeton, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
]);
const page = await contexte.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e)));

await page.goto(`${BASE}/#projet/${projetId}`, { waitUntil: 'domcontentloaded' });

if (!(await page.evaluate(() => Boolean(window.haikodevEssai?.plan)))) {
  noter('la page est bien celle du serveur de développement', false, 'point d’essai absent — viser le serveur de dev');
  await navigateur.close();
  process.exit(1);
}

// Le chef d'orchestre du projet d'essai se crée à l'ouverture du panneau de
// droite : on attend sa conversation avant d'y injecter quoi que ce soit.
await page.waitForSelector('textarea[placeholder="Écrivez votre demande…"]', { timeout: 20000 });
await page.waitForTimeout(500);

const agentId = await page.evaluate(() => {
  const zone = document.querySelector('textarea[placeholder="Écrivez votre demande…"]');
  const capsule = zone?.closest('div.relative')?.querySelector('[data-agent-contexte]');
  return capsule?.getAttribute('data-agent-contexte') ?? null;
});
noter('le chef d’orchestre du projet d’essai est ouvert', !!agentId, agentId ?? 'introuvable');
if (!agentId) {
  await navigateur.close();
  process.exit(1);
}

/*
 * Les plans d'essai portent leurs « Améliorations apportées » EN LISTE : c'est
 * cette partie-là qui s'affiche cliquable, comme les « Évolutions possibles »
 * d'une réponse d'agent.
 */
const PLAN_1 = [
  '## 🎯 Faisabilité',
  '',
  'Possible sans réserve particulière.',
  '',
  '## 🛤️ Chemin à suivre',
  '',
  '1. Ajouter le bouton.',
  '2. Le relier à l’export.',
  '',
  '## 📈 Conséquences',
  '',
  'Un export de plus, rien d’autre ne change.',
  '',
  '## 🎯 Améliorations apportées',
  '',
  '- Ajoute un export au format tableur.',
  '- Retiens le dernier dossier choisi.',
  '- Préviens quand l’export est prêt.',
].join('\n');

/* ---------- 1. Le cadre et ses deux boutons ---------- */

await page.evaluate(([id, texte]) => window.haikodevEssai.plan(id, texte), [agentId, PLAN_1]);
await page.waitForTimeout(400);

/*
 * L'APPLICATION MONTE DEUX CONVERSATIONS — celle du grand écran et celle du
 * téléphone —, dont une seule est visible à la fois (l'autre mesure zéro pixel).
 * Tout ce qu'on juge ici se lit donc dans le fil VISIBLE : sans « :visible », le
 * moindre compte vaudrait deux et le moindre clic serait ambigu.
 */
const cadre = page.locator('[data-mode-plan-reponse="ouvert"]:visible');
noter('le plan affiche son cadre dédié, déplié d’emblée', (await cadre.count()) === 1);
noter('le bouton Valider est visible', await cadre.getByRole('button', { name: 'Valider' }).isVisible());
noter('le bouton Refuser est visible', await cadre.getByRole('button', { name: 'Refuser' }).isVisible());
noter('la toute première version porte le repère « version 1 »', (await cadre.locator('text=version 1').count()) >= 1);
noter(
  'aucune liste de versions précédentes pour la toute première version',
  (await cadre.locator('[data-versions-plan]').count()) === 0,
);
noter(
  'le sélecteur de niveau propose les trois paliers, Standard retenu par défaut',
  (await cadre.locator('[data-niveau-plan="standard"][aria-pressed="true"]').count()) === 1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-ouvert.png` });

// Choisir « Léger » avant de valider : le niveau retenu doit voyager dans le
// message envoyé au chef, pour que la carte proposée en hérite.
await cadre.locator('[data-niveau-plan="leger"]').click();
noter(
  'le clic sur « Léger » le rend actif à la place de Standard',
  (await cadre.locator('[data-niveau-plan="leger"][aria-pressed="true"]').count()) === 1,
);

/* ---------- 2. « Valider » bascule en direct et enchaîne, sans rien taper ---------- */

const avantTexte = await page.locator('textarea[placeholder="Écrivez votre demande…"]:visible').first().inputValue();
noter('rien n’est écrit dans la barre avant de valider', avantTexte === '');

const messagesAvant = await page.locator('[data-fil="conversation"] >> text=Vas-y, lance ce plan.').count();
await cadre.getByRole('button', { name: 'Valider' }).click();

await page.waitForSelector('text=Vas-y, lance ce plan.', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
const messagesApres = await page.locator('[data-fil="conversation"] >> text=Vas-y, lance ce plan.').count();
noter(
  '« Valider » enchaîne tout seul : un message est parti sans rien taper',
  messagesApres > messagesAvant,
  `${messagesAvant} → ${messagesApres}`,
);
noter(
  'le niveau choisi (« Léger ») voyage dans le message envoyé',
  (await page.locator('[data-fil="conversation"] >> text=Niveau retenu pour la carte : « Léger »').count()) >= 1,
);

const modeApres = await page.locator('[data-mode-plan]').first().getAttribute('data-mode-plan');
noter('« Valider » a repassé la conversation en mode direct', modeApres === 'inactif', modeApres ?? 'introuvable');

// On coupe le tour tout de suite : seul le départ du message est jugé ici,
// pas la réponse du chef — inutile de laisser tourner un vrai agent.
const arret = page.getByRole('button', { name: "Arrêter l'action en cours" });
if (await arret.count()) {
  await arret.click();
  await page.waitForTimeout(300);
}

/* ---------- 3. Le plan précédent s'est replié tout seul, et se rouvre au clic ---------- */

await page.waitForTimeout(300);
const replieApresValidation = page.locator('[data-mode-plan-reponse="replie"]:visible');
noter(
  'le plan validé se replie tout seul dès qu’un message le suit',
  (await replieApresValidation.count()) >= 1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-replie.png` });

noter(
  'le plan replié est annoncé comme une version précédente',
  (await replieApresValidation.first().getAttribute('data-mode-plan-etat')) === 'ancien',
);

await replieApresValidation.first().click();
await page.waitForTimeout(300);
const rouvert = page.locator('[data-mode-plan-reponse="ouvert"]:visible').first();
const rouvertOk = (await page.locator('[data-mode-plan-reponse="ouvert"]:visible').count()) >= 1;
noter('un clic sur le bandeau replié rouvre le plan, contenu intact', rouvertOk);
const contenuIntact = await page.locator('text=Un export de plus').count();
noter('le contenu rouvert est bien celui d’origine, inchangé', contenuIntact >= 1);

// Une version périmée se relit, elle ne se décide plus : aucun bouton d'action dedans.
const ancienOuvert = page.locator('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="ancien"]:visible');
noter('le plan rouvert est bien marqué « ancien »', (await ancienOuvert.count()) === 1);
noter(
  'un plan précédent rouvert ne porte plus de bouton Valider / Refuser',
  (await ancienOuvert.getByRole('button', { name: 'Valider' }).count()) === 0 &&
    (await ancienOuvert.getByRole('button', { name: 'Refuser' }).count()) === 0,
);
noter(
  'la version rouverte, non courante, porte son numéro',
  (await rouvert.locator('text=version 1').count()) >= 1,
);
noter(
  'elle propose « Repartir de cette version » à la place',
  await rouvert.getByRole('button', { name: 'Repartir de cette version' }).isVisible(),
);
noter(
  'sans version suivante encore écrite, aucune différence ne s’affiche',
  (await rouvert.locator('text=Différences avec la version suivante').count()) === 0,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-rouvert.png` });

/* ---------- 4. Un second plan, plus récent : versions, différences, « Refuser » ---------- */

// Un second plan « dernier » : le premier, déjà suivi d'un message, doit
// rester replié pendant que ce nouveau-là s'affiche déplié.
const PLAN_2 = [
  '## 🎯 Faisabilité',
  '',
  'Autre demande, faisable aussi.',
  '',
  '## 🛤️ Chemin à suivre',
  '',
  '1. Étape unique.',
  '',
  '## 📈 Conséquences',
  '',
  'Aucune.',
  '',
  '## 🎯 Améliorations apportées',
  '',
  '- Ajoute un raccourci au clavier.',
  '- Garde une trace des exports passés.',
  '- Propose un envoi par courriel.',
].join('\n');
await page.evaluate(([id, texte]) => window.haikodevEssai.plan(id, texte), [agentId, PLAN_2]);
await page.waitForTimeout(400);

const dernierCadre = page.locator('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="courant"]:visible');
noter('le second plan s’affiche déplié, lui aussi', (await dernierCadre.count()) === 1);
noter(
  'un seul plan porte ses boutons : le plus récent',
  (await page.locator('[data-fil="conversation"]:visible').getByRole('button', { name: 'Valider', exact: true }).count()) ===
    1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-iterations.png` });

/* ---------- 3 bis. L'ENTÊTE TIENT SUR UNE SEULE LIGNE ---------- */

/*
 * « Plan proposé », le numéro de version et le rappel des versions précédentes
 * s'empilaient en colonnes dès que la largeur manquait. On mesure donc la
 * HAUTEUR RÉELLE de l'entête : une seule ligne de texte, jamais deux.
 */
const entete = await dernierCadre.locator('[data-entete-plan]').first().boundingBox();
noter(
  'l’entête du plan tient sur une seule ligne',
  !!entete && entete.height <= 28,
  entete ? `${Math.round(entete.height)} px de haut` : 'entête introuvable',
);
const enteteEtroit = await (async () => {
  await passerEnTelephone(page);
  const mesures = await cadreCourantVisible(page);
  await page.screenshot({ path: `${SHOTS}/boutons-plan-entete-telephone.png` });
  await revenirAuGrandEcran(page);
  return mesures?.entete ?? null;
})();
noter(
  'sur un téléphone aussi, l’entête reste sur une ligne',
  !!enteteEtroit && enteteEtroit.height <= 28,
  enteteEtroit ? `${Math.round(enteteEtroit.height)} px de haut` : 'entête introuvable',
);

noter('il porte le repère « version 2 »', (await dernierCadre.locator('text=version 2').count()) >= 1);

noter(
  '« Repartir de cette version » reste offert sur la première version',
  await rouvert.getByRole('button', { name: 'Repartir de cette version' }).isVisible(),
);
noter(
  'la première version, rouverte, affiche maintenant ses différences avec la version 2',
  (await rouvert.locator('text=Différences avec la version suivante').count()) === 1,
);

await dernierCadre.locator('[data-versions-plan]').click();
await page.waitForTimeout(200);
noter(
  'le plan courant liste sa version précédente en dépliant « 1 version précédente »',
  (await dernierCadre.locator('[data-liste-versions-plan] >> text=Version 1').count()) === 1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-versions.png` });

/* ---------- 4 bis. « AMÉLIORATIONS APPORTÉES » EST LA LISTE CLIQUABLE ---------- */

/*
 * Les pastilles d'axes de réflexion posées sous le cadre (« Plus simple »,
 * « Une autre approche »…) ont été RETIRÉES : elles proposaient des angles
 * écrits d'avance que personne ne comprenait. Les suggestions viennent
 * désormais du PLAN lui-même — sa quatrième partie s'affiche cliquable, comme
 * les « Évolutions possibles » d'une réponse d'agent. Un clic RETIENT l'idée
 * dans la barre d'écriture ; rien ne part sans un envoi.
 */
const barre = page.locator('textarea[placeholder="Écrivez votre demande…"]:visible').first();
await barre.fill('');
await page.waitForTimeout(200);

noter(
  'plus aucune pastille d’axes de réflexion sous le cadre',
  (await page.locator('[data-suggestion-plan], [data-suggestions-plan]').count()) === 0 &&
    (await page.locator('[data-fil="conversation"]:visible >> text=Pour aller plus loin').count()) === 0,
);

const cliquables = dernierCadre.locator('[data-suggestion-cliquable]');
await cliquables.first().waitFor({ state: 'visible', timeout: 20000 });
noter(
  'les « Améliorations apportées » du plan courant sont cliquables',
  (await cliquables.count()) === 3,
  `${await cliquables.count()} idée(s)`,
);
noter(
  'une version précédente, elle, ne propose rien à cocher',
  (await rouvert.locator('[data-suggestion-cliquable]').count()) === 0,
);

const messagesAvantSuggestion = await page
  .locator('[data-fil="conversation"]:visible >> text=Ajoute un raccourci au clavier')
  .count();
const libelle = (await cliquables.first().innerText()).trim();
await cliquables.first().click();
await page.waitForTimeout(400);
noter(
  'un clic retient l’idée dans la barre d’écriture',
  (await page.locator('[data-composeur-retenu]:visible').count()) === 1,
  libelle.slice(0, 50),
);
noter(
  '…et la marque comme retenue dans le plan',
  (await dernierCadre.locator('[data-suggestion-cliquable][aria-pressed="true"]').count()) === 1,
);
noter(
  '…sans rien envoyer : aucun message n’est parti',
  (await page.locator('[data-fil="conversation"]:visible >> text=Ajoute un raccourci au clavier').count()) ===
    messagesAvantSuggestion,
);

// Une seconde idée S'AJOUTE : on ne perd pas la première.
await cliquables.nth(1).click();
await page.waitForTimeout(300);
noter(
  'une seconde idée s’ajoute à la première, sans l’écraser',
  (await page.locator('[data-composeur-retenu]:visible').count()) === 2,
);
// …et un second clic la retire : la liste se coche et se décoche.
await cliquables.nth(1).click();
await page.waitForTimeout(300);
noter(
  'recliquer une idée la retire',
  (await page.locator('[data-composeur-retenu]:visible').count()) === 1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-suggestions.png` });
await cliquables.first().click();
await page.waitForTimeout(300);
await barre.fill('');
await page.waitForTimeout(200);

/* ---------- 4 ter. LE CADRE POSE SON PROPRE FOND GRIS ---------- */

/*
 * Un plan doit se repérer dans le fil AVANT d'être lu. Son fond vient d'un
 * jeton à lui (`--fond-plan`, `web/src/styles.css`) : on vérifie donc qu'il
 * DIFFÈRE réellement du fond de la page, et qu'il tient dans les deux thèmes —
 * un gris posé en opacité aurait disparu sur fond blanc.
 */
const luminance = (couleur) => {
  const [r, v, b] = (couleur.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * v + 0.0722 * b;
};
const fonds = async () =>
  page.evaluate(() => {
    const cadres = Array.from(
      document.querySelectorAll('[data-mode-plan-reponse="ouvert"][data-mode-plan-etat="courant"]'),
    );
    const vu = cadres.find((n) => n.getBoundingClientRect().height > 0);
    return {
      cadre: vu ? getComputedStyle(vu).backgroundColor : null,
      page: getComputedStyle(document.body).backgroundColor,
      sombre: document.documentElement.classList.contains('dark'),
    };
  });

const fondSombre = await fonds();
noter(
  'le cadre du plan pose un fond gris, distinct de la page',
  !!fondSombre.cadre &&
    !/rgba\(0, 0, 0, 0\)|transparent/.test(fondSombre.cadre) &&
    Math.abs(luminance(fondSombre.cadre) - luminance(fondSombre.page)) >= 8,
  `cadre ${fondSombre.cadre} / page ${fondSombre.page}`,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-fond.png` });

// Le même repère doit tenir dans l'AUTRE thème.
await page.evaluate(() => document.documentElement.classList.toggle('dark'));
await page.waitForTimeout(300);
const fondClair = await fonds();
noter(
  'le fond gris tient aussi dans l’autre thème',
  !!fondClair.cadre &&
    !/rgba\(0, 0, 0, 0\)|transparent/.test(fondClair.cadre) &&
    Math.abs(luminance(fondClair.cadre) - luminance(fondClair.page)) >= 8,
  `cadre ${fondClair.cadre} / page ${fondClair.page}`,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-fond-autre-theme.png` });
await page.evaluate(() => document.documentElement.classList.toggle('dark'));
await page.waitForTimeout(300);

/* ---------- 4 quater. « REFUSER » NE RELANCE PLUS RIEN TOUT SEUL ---------- */

const messagesRefusAvant = await page.locator('[data-fil="conversation"]:visible >> text=Je refuse ce plan').count();
await dernierCadre.getByRole('button', { name: 'Refuser' }).click();
await page.waitForTimeout(800);
const messagesRefusApres = await page.locator('[data-fil="conversation"]:visible >> text=Je refuse ce plan').count();
noter(
  '« Refuser » ne lance AUCUN tour : rien n’est parti dans le fil',
  messagesRefusApres === messagesRefusAvant,
  `${messagesRefusAvant} → ${messagesRefusApres}`,
);
const champApresRefus = await barre.inputValue();
noter(
  '…le refus est écrit dans la barre, prêt à être complété',
  champApresRefus.includes('Je refuse ce plan'),
  champApresRefus.slice(0, 60),
);
noter(
  '…et le cadre le dit, pour qu’on ne reclique pas dans le vide',
  (await dernierCadre.locator('[data-refus-prepare]').count()) === 1,
);
noter(
  'le plan refusé garde ses boutons tant que rien n’est envoyé',
  await dernierCadre.getByRole('button', { name: 'Valider' }).isVisible(),
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-refus-prepare.png` });
await barre.fill('');
await page.waitForTimeout(200);

/* ---------- 4 quinquies. SUR TÉLÉPHONE, LES BOUTONS S'EMPILENT ---------- */

const surGrandEcran = await cadreCourantVisible(page);
noter(
  'sur grand écran, Valider et Refuser restent côte à côte',
  !!surGrandEcran?.valider &&
    !!surGrandEcran?.refuser &&
    Math.abs(surGrandEcran.valider.y - surGrandEcran.refuser.y) < 4,
  surGrandEcran?.valider && surGrandEcran?.refuser
    ? `Valider y=${Math.round(surGrandEcran.valider.y)}, Refuser y=${Math.round(surGrandEcran.refuser.y)}`
    : 'boutons introuvables',
);

await passerEnTelephone(page);
const surTelephone = await cadreCourantVisible(page);
noter(
  'sur téléphone, Refuser passe SOUS Valider',
  !!surTelephone?.valider &&
    !!surTelephone?.refuser &&
    surTelephone.refuser.y >= surTelephone.valider.y + surTelephone.valider.height - 2,
  surTelephone?.valider && surTelephone?.refuser
    ? `Valider y=${Math.round(surTelephone.valider.y)}, Refuser y=${Math.round(surTelephone.refuser.y)}`
    : 'boutons introuvables',
);
noter(
  '…et les boutons restent DANS le cadre, sans déborder',
  !!surTelephone?.cadre &&
    !!surTelephone?.refuser &&
    surTelephone.refuser.x >= surTelephone.cadre.x - 1 &&
    surTelephone.refuser.x + surTelephone.refuser.width <= surTelephone.cadre.x + surTelephone.cadre.width + 1,
);
await page.screenshot({ path: `${SHOTS}/boutons-plan-telephone.png` });
await revenirAuGrandEcran(page);

/* ---------- 5. « Repartir de cette version » relance le mode plan ---------- */

/*
 * L'ARRÊT N'EST PAS INSTANTANÉ, et un message envoyé à un agent encore occupé
 * part en FILE D'ATTENTE : il ne s'affiche donc pas dans le fil, et le contrôle
 * suivant conclurait à tort que le bouton n'envoie rien. On attend que le tour
 * précédent soit vraiment fini — le bouton d'arrêt disparaît avec lui.
 */
await page
  .waitForFunction(
    () => !document.querySelector('button[aria-label="Arrêter l\'action en cours"], button[title="Arrêter l\'action en cours"]'),
    null,
    { timeout: 20000 },
  )
  .catch(() => {});
await page.waitForTimeout(500);
const messagesRepriseAvant = await page
  .locator('[data-fil="conversation"] >> text=Abandonne les versions écrites après la version 1')
  .count();
await rouvert.getByRole('button', { name: 'Repartir de cette version' }).click();
await page
  .waitForSelector('text=Abandonne les versions écrites après la version 1', { timeout: 15000 })
  .catch(() => {});
await page.waitForTimeout(500);
const messagesRepriseApres = await page
  .locator('[data-fil="conversation"] >> text=Abandonne les versions écrites après la version 1')
  .count();
noter(
  '« Repartir de cette version » envoie un message citant la version choisie',
  messagesRepriseApres > messagesRepriseAvant,
  `${messagesRepriseAvant} → ${messagesRepriseApres}`,
);
const modeApresReprise = await page.locator('[data-mode-plan]').first().getAttribute('data-mode-plan');
noter(
  '« Repartir de cette version » relance le mode plan',
  modeApresReprise === 'actif',
  modeApresReprise ?? 'introuvable',
);

const arretReprise = page.getByRole('button', { name: "Arrêter l'action en cours" });
if (await arretReprise.count()) {
  await arretReprise.click();
  await page.waitForTimeout(300);
}

noter('aucune erreur dans la page', erreurs.length === 0, erreurs[0] ?? '');

await navigateur.close();

// On arrête l'agent réel qu'on vient de faire parler : le tour lancé par
// Valider/Refuser n'a plus rien à faire au-delà de ce constat.
try {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(sha(jeton));
} catch {
  /* déjà retiré en sortie de script */
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
process.exit(echecs ? 1 : 0);
