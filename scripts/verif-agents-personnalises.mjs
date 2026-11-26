#!/usr/bin/env node
/**
 * LES AGENTS PERSONNALISÉS D'UN PROJET, DANS UN VRAI NAVIGATEUR (carte « Agents personnalisés dans les projets »,
 * 24/11/2026).
 *
 * Sur un démon d'essai (base neuve, dossier de projets à lui, aucun compte moteur : aucun tour ne part) :
 *  1. l'accueil du projet porte « Tâches | Agents » collé au titre (20 px, 38 px, onglet choisi en aplat contrasté), et « Tâches » montre le tableau des tâches ;
 *  2. « Agents » écrit « #projet/<id>/agents » et montre l'état vide et « Nouvel agent » ;
 *  3. « Nouvel agent » ouvre SA page : conversation à gauche, configuration à droite (0 sur 8, tout « à définir »),
 *     « Allumer l'agent » éteint, fil d'Ariane « Agents / Nouvel agent » ;
 *  4. une fiche complète allume « Allumer l'agent » ; allumer l'écrit au journal ; « Lancer maintenant » sans compte
 *     dit qu'il attend un compte, sans lancer de moteur ;
 *  5. de retour au tableau : une ligne par agent, l'en-tête trie, l'état se filtre, la recherche trouve ;
 *  6. une réponse préparée qui attend un clic s'affiche en bleu (« À valider ») et dans le point du matin ;
 *  7. le choix Tâches / Agents est retenu pour le projet ;
 *  8. sur téléphone (390 px) : la liste empilée, la page de l'agent en deux onglets, rien ne déborde ;
 *  9. en clair et en sombre, sans erreur de page ;
 * 10. LES TABLEAUX DE BORD (24/11/2026, maquette #d9190) : « Tâches | Agents » collé au grand titre, « #en-route/agents »
 *     montre les agents de TOUS les projets avec leur colonne « Projet » (filtrable), sans le tableau des tâches ;
 *     « Nouvel agent » demande d'abord le projet et ouvre la page de l'agent dans ce projet ; un clic sur une ligne
 *     ouvre l'agent dans son projet ; le choix est retenu ; sur téléphone, « Agents » entre dans la rangée existante.
 *
 *   node scripts/verif-agents-personnalises.mjs        (après `npm run build`, depuis la copie de la carte)
 *   VERIF_CAPTURES=/tmp/captures-agents node scripts/verif-agents-personnalises.mjs   (écrit les captures)
 *
 * Jamais `BELUGA_URL` ni `BELUGA_TOKEN` : la session d'une heure est fabriquée en base jetable, et part avec elle.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7203);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.VERIF_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
/** La clarté (0 → 1) d'une couleur `rgb(…)` calculée. */
function luminance(css) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css || '');
  if (!m) return -1;
  return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
}

/**
 * LE SÉLECTEUR « TÂCHES | AGENTS » COLLÉ AU TITRE (24/11/2026, captures #20dba, maquettes #e5044 et #ccaab) : à 20 px à
 * droite du grand titre, centré sur lui, 38 px de haut, et l'onglet choisi en aplat contrasté — noir en clair, gris
 * très clair (jamais blanc pur) en sombre, texte inversé.
 */
async function controlerLeSelecteurDuTitre(page, selecteur, theme, repereDuTitre = 'accueil-du-projet') {
  const m = await page.evaluate(([sel, repere]) => {
    const titre = document.querySelector(`[data-titre-de-page="${repere}"]`);
    const barre = document.querySelector(sel);
    const choisi = barre?.querySelector('[aria-selected="true"]');
    if (!titre || !barre || !choisi) return null;
    const t = titre.getBoundingClientRect();
    const b = barre.getBoundingClientRect();
    const st = getComputedStyle(choisi);
    return { ecart: b.left - t.right, centre: Math.abs(b.top + b.height / 2 - (t.top + t.height / 2)), hauteur: b.height, fond: st.backgroundColor, texte: st.color, taille: st.fontSize };
  }, [selecteur, repereDuTitre]);
  verifier(`(${theme}${repereDuTitre === 'accueil-du-projet' ? '' : ', ' + repereDuTitre}) « Tâches | Agents » est à 20 px à droite du titre, centré sur lui`, !!m && Math.abs(m.ecart - 20) <= 2 && m.centre <= 2, JSON.stringify(m));
  verifier(`(${theme}) le sélecteur est plus grand que la barre commune (38 px, texte 15 px)`, !!m && Math.round(m.hauteur) === 38 && m.taille === '15px', JSON.stringify(m));
  const fond = luminance(m?.fond);
  const texte = luminance(m?.texte);
  verifier(
    `(${theme}) l’onglet choisi est un aplat contrasté (${theme === 'light' ? 'noir, texte blanc' : 'gris très clair, texte noir'})`,
    theme === 'light' ? fond >= 0 && fond < 0.15 && texte > 0.95 : fond > 0.75 && fond < 0.98 && texte >= 0 && texte < 0.15,
    JSON.stringify(m),
  );
}


const verifier = (nom, ok, detail = '') => {
  resultats.push(!!ok);
  console.log(`  ${ok ? 'OK' : 'ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* LE GARDE D'ESSAI : le démon jetable reprend les comptes de la machine ; sans lui, « Lancer maintenant » partirait
   vraiment au moteur. Le passage attend donc un compte, comme sans quota. */
const { DATA, DEPOT, journal, attendrePort, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-agents-perso-',
  port: PORT,
  signaux: true,
  env: { BELUGA_AGENTS_PERSO_SANS_MOTEUR: '1' },
});
const jeton = crypto.randomBytes(32).toString('hex');
const T = Date.now();
const PROJET = 'p-essai';
const AUTRE = 'p-atelier';

const base = () => new Database(path.join(DATA, 'beluga.db'));

function poserLeDecor() {
  const db = base();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), T, T + 3600_000, 'essai');
  const p = { id: PROJET, name: 'Boutique', path: DEPOT, defaultEngine: 'claude', isSelf: false, rank: 1, archived: false, createdAt: T, updatedAt: T };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, 'Boutique', DEPOT, JSON.stringify(p), T, T);
  const a = { ...p, id: AUTRE, name: 'Atelier', rank: 2 };
  db.prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(AUTRE, 'Atelier', DEPOT, JSON.stringify(a), T, T);
  db.close();
}

function poserLeTheme(clarte) {
  const db = base();
  db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)').run('theme', JSON.stringify(clarte), Date.now());
  db.close();
}

/** Une fiche complète, écrite en base comme l'outil `agent_fiche` l'aurait fait rubrique par rubrique. */
function remplirLaFiche(id, nom) {
  const fiche = {
    nom,
    mission: 'Lire chaque nouvelle demande client et préparer une réponse.',
    declencheurs: [{ genre: 'evenement', source: 'messagerie.demande' }, { genre: 'horaire', rythme: 'jour', heure: '08:00', joursExclus: [0, 6], report: true }],
    faitSeul: ['Lire la demande', 'Préparer une réponse au client'],
    demandeAccord: ['Envoyer la réponse au client'],
    jamais: ['Promettre un délai'],
    emporte: { competences: [], acces: ['Messagerie / Brevo'], memoire: true },
    limite: { passages: 5, periode: 'jour' },
  };
  const db = base();
  db.prepare('UPDATE agents_perso SET fiche = ?, mis_a_jour_le = ? WHERE id = ?').run(JSON.stringify(fiche), Date.now(), id);
  db.close();
}

/** Une réponse préparée qui attend le clic « Envoyer au client » (comme `services`, `proposer_reponse`). */
async function poserUneReponseAValider(agentPersoId) {
  process.env.BELUGA_DATA = DATA;
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const { Message, AgentQuestion } = await import(path.join(RACINE, 'shared/dist/index.js'));
  const db = base();
  const { agent_id: agentId } = db.prepare('SELECT agent_id FROM agents_perso WHERE id = ?').get(agentPersoId);
  db.prepare("INSERT INTO agents_perso_journal (id, agent_perso_id, project_id, date, genre, source, resume, issue) VALUES (?, ?, ?, ?, 'evenement', 'messagerie.demande', ?, 'a_valider')").run(
    crypto.randomUUID(),
    agentPersoId,
    PROJET,
    Date.now() - 60_000,
    'À valider : une réponse préparée pour Marie (formulaire en panne).',
  );
  db.close();
  store.saveMessage(
    Message.parse({
      id: crypto.randomUUID(),
      agentId,
      role: 'assistant',
      content: 'À valider : une réponse préparée pour Marie.',
      questions: [
        AgentQuestion.parse({
          id: crypto.randomUUID(),
          question: 'Envoyer cette réponse au client (la demande « Formulaire en panne ») ?',
          description: 'Bonjour Marie, nous regardons le formulaire aujourd’hui.',
          kind: 'single',
          options: [
            { id: 'envoyer', label: 'Envoyer au client' },
            { id: 'non', label: 'Ne pas envoyer' },
          ],
          allowFreeText: false,
        }),
      ],
      createdAt: Date.now(),
    }),
  );
}

/**
 * CE QUE FAIT L'AGENT SE LIT DANS SA CONVERSATION (carte « Agents des services et Beluga Connect », 26/11/2026) : une
 * note de fiche en clair (« Nom noté : … », dans la couleur du texte), puis un passage fait seul (« Lancer maintenant »),
 * écrit EN JAUNE sous sa tête « Passage automatique · … ».
 */
async function poserNoteEtPassage(agentPersoId) {
  process.env.BELUGA_DATA = DATA;
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const { Message } = await import(path.join(RACINE, 'shared/dist/index.js'));
  const db = base();
  const { agent_id: agentId } = db.prepare('SELECT agent_id FROM agents_perso WHERE id = ?').get(agentPersoId);
  db.close();
  const t0 = Date.now() - 5 * 60_000;
  store.saveMessage(
    Message.parse({
      id: crypto.randomUUID(),
      agentId,
      role: 'assistant',
      content: 'J’ai noté mon nom ; je regarde maintenant vos demandes de la semaine.',
      steps: [
        { id: crypto.randomUUID(), label: 'Nom noté : Veilleur des demandes', detail: 'Nom noté : Veilleur des demandes', state: 'done', outil: 'mcp__beluga__agent_fiche', startedAt: t0, endedAt: t0 + 1_000 },
      ],
      createdAt: t0,
    }),
  );
  store.saveMessage(
    Message.parse({
      id: crypto.randomUUID(),
      agentId,
      role: 'assistant',
      content: 'Fait : 2 demandes lues, une réponse préparée pour Marie. Objectif : 3 demandes traitées sur 4 cette semaine. Prochaine étape proposée : relancer le devis de lundi.',
      passageAutomatique: { genre: 'manuel' },
      createdAt: t0 + 60_000,
    }),
  );
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(CAPTURES, `${nom}.png`) });
}

/** Ouvre une adresse ; au tout premier chargement, l'accueil peut devancer l'adresse : on la redonne (trois fois). */
async function ouvrir(page, fragment, repere) {
  for (let essai = 0; essai < 3; essai++) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/#${fragment}`, { waitUntil: 'load' });
    if (await page.locator(repere).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) return;
  }
  await page.locator(repere).first().waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * 10. LES TABLEAUX DE BORD : « Tâches | Agents » à côté du titre, les agents de tous les projets. En clair, on crée en
 * plus un agent dans « Atelier » par « Nouvel agent » (le projet d'abord). Rend l'identifiant de cet agent.
 */
async function controlerLesTableauxDeBord(page, theme, agentDeLAtelier) {
  const sel = '[data-barre-onglets="tableaux-de-bord-taches-agents"]';
  await ouvrir(page, 'en-route', sel);
  verifier(`(${theme}) Tableaux de bord : « Tâches | Agents » est dans la tête du grand titre`, (await page.locator(`[data-tete-de-page-a-grand-titre="tableaux-de-bord"] ${sel}[data-variante-onglets="accueil"]`).count()) === 1);
  if (theme === 'light') {
    await page.locator(`${sel} [data-onglet="taches"]`).click();
    await page.locator('[data-tableau-des-taches]').first().waitFor({ state: 'visible', timeout: 15_000 });
    verifier('Tableaux de bord : « Tâches » montre le tableau des tâches', (await page.locator('[data-tableau-des-taches]').count()) === 1);
    await capturer(page, `tableaux-taches-1440-${theme}`);
  }
  await page.locator(`${sel} [data-onglet="agents"]`).click();
  await page.locator('[data-agents-du-projet="tous"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-agents-du-projet="tous"] [data-ligne-agent-perso]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  verifier(`(${theme}) Tableaux de bord : « Agents » écrit #en-route/agents`, page.url().endsWith('#en-route/agents'), page.url());
  verifier(`(${theme}) Tableaux de bord : en « Agents », le tableau des tâches et sa recherche ne sont plus montés`, (await page.locator('[data-tableau-des-taches]').count()) === 0);
  await controlerLeSelecteurDuTitre(page, sel, theme, 'tableaux-de-bord');
  if (theme === 'light') {
    /* « Nouvel agent » : la liste des projets d'abord, puis la page de l'agent dans le projet choisi. */
    await page.locator('[data-nouvel-agent-perso="tous"]').click();
    const option = page.locator(`[data-liste-option="${AUTRE}"]`);
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    verifier('« Nouvel agent » propose d’abord les projets (Boutique et Atelier)', (await page.locator(`[data-liste-option="${PROJET}"]`).count()) === 1 && (await option.count()) === 1);
    await capturer(page, `tableaux-nouvel-agent-1440-${theme}`);
    await option.click();
    await page.locator('[data-page-agent-perso]').waitFor({ state: 'visible', timeout: 30_000 });
    agentDeLAtelier = decodeURIComponent(page.url().split('/agents/')[1] ?? '');
    verifier('le projet choisi reçoit l’agent : #projet/<atelier>/agents/<agent>', page.url().includes(`#projet/${AUTRE}/agents/`) && !!agentDeLAtelier, page.url());
    await ouvrir(page, 'en-route/agents', '[data-agents-du-projet="tous"] [data-ligne-agent-perso]');
  }
  const lignes = await page.locator('[data-agents-du-projet="tous"] [data-ligne-agent-perso]').count();
  /* LES ÉQUIPES SEMÉES (26/11/2026) s'ajoutent aux agents créés : au moins les trois créés ici. */
  verifier(`(${theme}) Tableaux de bord : les agents des deux projets (au moins les 3 créés)`, lignes >= 3, String(lignes));
  verifier(
    `(${theme}) Tableaux de bord : la colonne « Projet » nomme Boutique et Atelier`,
    (await page.locator(`[data-agents-du-projet="tous"] [data-cellule-projet="${PROJET}"]`).count()) >= 2 && (await page.locator(`[data-agents-du-projet="tous"] [data-cellule-projet="${AUTRE}"]`).count()) >= 1,
  );
  const entetes = await page.locator('[data-agents-du-projet="tous"] thead th').allInnerTexts();
  verifier(`(${theme}) Tableaux de bord : en-tête Agent, Projet, Quand il agit, État, Dernière action, Actif`, ['Agent', 'Projet', 'Quand il agit', 'État', 'Dernière action', 'Actif'].every((e) => entetes.some((x) => x.includes(e))) && !entetes.some((x) => x.includes('Ce qu’il fait')), entetes.join(' · '));
  verifier(`(${theme}) Tableaux de bord : le point du matin nomme le projet`, (await page.locator('[data-point-du-matin] [data-point-ouvrir]').count()) >= 1 && (await page.locator('[data-point-du-matin] [data-point-ouvrir]').first().innerText()).includes('Boutique'));
  for (const largeur of [1440, 1024]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.waitForTimeout(300);
    const cadre = await page.locator('[data-tableau="agents-de-tous-les-projets"] table').first().evaluate((t) => {
      const colonne = document.querySelector('[data-colonne-des-tableaux-de-bord]')?.getBoundingClientRect();
      const recherche = document.querySelector('[data-tete-de-page-a-grand-titre="tableaux-de-bord"] [data-recherche-de-la-page]')?.getBoundingClientRect();
      const rangee = document.querySelector('[data-rangee-de-l-entete="tableaux-de-bord"]')?.getBoundingClientRect();
      return {
        table: Math.round(t.getBoundingClientRect().width),
        cadre: Math.round(t.parentElement?.getBoundingClientRect().width ?? 0),
        colonnes: t.querySelectorAll('thead th').length,
        recherche: recherche ? Math.round(recherche.width) : null,
        rangeeDepasse: rangee && colonne ? Math.round(rangee.right - colonne.right) : null,
        deborde: document.documentElement.scrollWidth - innerWidth,
      };
    });
    verifier(
      `(${theme}) Tableaux de bord à ${largeur} px : le tableau tient dans son cadre, la recherche (≥ 140 px) dans la rangée du titre`,
      cadre.table <= cadre.cadre + 1 && cadre.deborde <= 0 && (cadre.recherche ?? 0) >= 140 && (cadre.rangeeDepasse ?? 1) <= 0,
      JSON.stringify(cadre),
    );
    await capturer(page, `tableaux-agents-${largeur}-${theme}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  if (theme === 'light') {
    /* Le filtre « Projet » ne garde que l'Atelier. */
    await page.locator('[data-tableau-bouton-filtre="agents-de-tous-les-projets"]').click();
    await page.locator(`[data-tableau-choix-filtre="projet:${AUTRE}"]`).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    /* L'Atelier a aussi son équipe semée (26/11/2026) : le filtre garde ses seules lignes, dont l'agent créé ici. */
    verifier(
      'Tableaux de bord : le filtre « Projet » ne garde que l’Atelier',
      (await page.locator(`[data-agents-du-projet="tous"] [data-cellule-projet="${PROJET}"]`).count()) === 0 && (await page.locator(`[data-ligne-agent-perso="${agentDeLAtelier}"]`).count()) === 1,
    );
    /* Un clic sur la ligne ouvre l'agent dans son projet. */
    await page.locator(`[data-ligne-agent-perso="${agentDeLAtelier}"]`).click();
    await page.locator('[data-page-agent-perso]').waitFor({ state: 'visible', timeout: 15_000 });
    verifier('Tableaux de bord : un clic ouvre l’agent dans son projet', page.url().endsWith(`#projet/${AUTRE}/agents/${agentDeLAtelier}`), page.url());
    /* Le choix est retenu : l'application rouverte sans adresse revient sur « Agents ». */
    await page.goto('about:blank');
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(800);
    verifier('Tableaux de bord : rouverts sans adresse, ils reprennent « Agents »', (await page.locator(`${sel} [data-onglet="agents"][aria-selected="true"]`).count()) === 1, page.url());
  }
  return agentDeLAtelier;
}

const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function principal() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let premier = null;
  let second = null;
  let atelier = null;
  try {
    for (const theme of ['light', 'dark']) {
      poserLeTheme(theme === 'light' ? 'clair' : 'sombre');
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CH', colorScheme: theme, serviceWorkers: 'block' });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 200)));
      /* LA PAGE D'UN PROJET EST CELLE DE SON ÉQUIPE (carte « Beluga piloté par des agents », 26/11/2026) : la barre
         « Équipe | Tâches » du volet remplace le sélecteur « Tâches | Agents » du grand titre ; l'ancien tableau des
         agents s'ouvre par « Tableau des agents », dans le menu à trois points. */
      const selecteur = '[data-barre-onglets="projet-onglets"]';
      const ouvrirLeTableau = async () => {
        await ouvrir(page, `projet/${PROJET}`, '[data-gabarit-equipe="projet"]');
        await page.locator('[data-menu-general]:visible').first().click();
        await page.locator('[data-option-tableau-des-agents]').first().click();
        await page.locator('[data-agents-du-projet] [data-ligne-agent-perso]').first().waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(300);
      };

      if (theme === 'light') {
        /* 1. La page du projet : la discussion de l'équipe, et le volet « Équipe | Tâches ». */
        await ouvrir(page, `projet/${PROJET}`, selecteur);
        verifier('la page du projet est celle de son équipe, avec « Équipe | Tâches »', (await page.locator(`${selecteur} [data-onglet]`).count()) === 2 && (await page.locator('[data-table-de-l-equipe]').count()) === 1);

        /* 2. « Nouvel agent » : en bas du volet, sur toute sa largeur. */
        const bouton = page.locator('[data-nouvel-agent-de-l-equipe]').first();
        verifier('« Nouvel agent » est le geste principal, en bas de la page', (await bouton.boundingBox())?.y > 700);
        await capturer(page, `agents-equipe-1440-${theme}`);

        /* 3. « Nouvel agent » ouvre sa page. */
        await bouton.click();
        await page.locator('[data-page-agent-perso]').waitFor({ state: 'visible', timeout: 30_000 });
        premier = decodeURIComponent(page.url().split('/agents/')[1] ?? '');
        verifier('« Nouvel agent » ouvre #projet/<id>/agents/<agent>', !!premier, page.url());
        await page.locator('[data-configuration-agent-perso]').waitFor({ state: 'visible', timeout: 15_000 });
        verifier('la configuration compte 0 sur 8', (await page.locator('[data-completion-agent-perso="0/8"]').count()) === 1);
        verifier('les huit rubriques sont « à définir dans la conversation »', (await page.locator('[data-rubrique-agent-perso]:not([data-remplie])').count()) === 8);
        verifier('« Allumer l’agent » est éteint tant que la fiche est incomplète', await page.locator('[data-agent-perso-allumer]').isDisabled());
        verifier('la conversation a son champ d’écriture', await page.locator('[data-agent-perso-conversation] [data-composer] textarea').first().isVisible());
        verifier('le mot d’accueil invite à dire ce qu’il doit faire', await page.locator('[data-accueil-agent-perso]').isVisible());
        verifier('le fil d’Ariane porte l’agent (visage, prénom, état)', (await page.locator('[data-cran-de-l-agent], [data-cran-agent-perso]').count()) >= 1);
        const volet = await page.locator('aside[data-volet-equipe="agent"]').boundingBox();
        const conv = await page.locator('[data-agent-perso-conversation]').first().boundingBox();
        verifier('conversation à gauche, configuration à droite', !!volet && !!conv && conv.x < volet.x && volet.x + volet.width >= 1440 - 2, volet ? `${Math.round(volet.x)}+${Math.round(volet.width)}` : '');
        await capturer(page, `agent-nouveau-1440-${theme}`);

        /* 4. Fiche complète, allumer, lancer sans compte. */
        remplirLaFiche(premier, 'Veilleur des demandes');
        await ouvrir(page, `projet/${PROJET}/agents/${premier}`, '[data-completion-agent-perso="8/8"]');
        verifier('une fiche complète compte 8 sur 8', true);
        const allumer = page.locator('[data-agent-perso-allumer]');
        verifier('« Allumer l’agent » s’allume', await allumer.isEnabled());
        await allumer.click();
        await page.locator('[data-agent-perso-eteindre]').waitFor({ state: 'visible', timeout: 15_000 });
        verifier('allumé, il propose « Mettre en pause » et le journal le dit', (await page.locator('[data-journal-agent-perso]').innerText()).includes('Allumé par l’utilisateur'));
        await page.locator('[data-agent-perso-lancer]').click();
        await page.locator('[data-journal-agent-perso]', { hasText: 'En attente d’un compte avec du quota' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
        const journalTexte = await page.locator('[data-journal-agent-perso]').innerText();
        verifier('« Lancer maintenant » sans compte attend un compte, sans moteur', journalTexte.includes('En attente d’un compte avec du quota'), journalTexte.split('\n').slice(0, 3).join(' | '));
        verifier('les gestes verrouillés sont rappelés sous « Ce qu’il ne fait jamais »', (await page.locator('[data-gestes-verrouilles]').innerText()).includes('envoyer un message à un client'));
        /* LES DEUX BOUTONS DU PIED, L'UN SOUS L'AUTRE, CHACUN SUR TOUTE LA LARGEUR (26/11/2026). */
        const pied = await page.locator('[data-pied-agent-perso]').boundingBox();
        const boutons = await page.locator('[data-pied-agent-perso] button:visible').evaluateAll((l) => l.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
        verifier(
          'pied du volet : « Mettre en pause » puis « Lancer maintenant », l’un sous l’autre, pleine largeur',
          !!pied && boutons.length === 2 && boutons[1].y >= boutons[0].y + boutons[0].h - 1 && boutons.every((b) => Math.abs(b.w - boutons[0].w) < 2 && b.w >= pied.width - 2 * 20 - 2),
          JSON.stringify(boutons.map((b) => [Math.round(b.y), Math.round(b.w)])) + ` pied ${Math.round(pied?.width ?? 0)}`,
        );
        await poserNoteEtPassage(premier);
        await ouvrir(page, `projet/${PROJET}/agents/${premier}`, '[data-passage-automatique]');
        const passage = await page.evaluate(() => {
          const bloc = document.querySelector('[data-passage-automatique]');
          const tete = bloc?.querySelector('[data-tete-du-passage]');
          const texte = [...(bloc?.querySelectorAll('p, li') ?? [])].find((e) => /Fait : 2 demandes/.test(e.textContent ?? ''));
          const note = [...document.querySelectorAll('[data-reponse-agent]:not([data-passage-automatique]) *')].find((e) => e.children.length === 0 && /Nom noté : Veilleur des demandes/.test(e.textContent ?? ''));
          const rgb = (el) => (el ? getComputedStyle(el).color : '');
          return { tete: tete?.textContent ?? '', couleurTete: rgb(tete), couleurTexte: rgb(texte), couleurNote: rgb(note), note: !!note };
        });
        /* Chrome rend une couleur mêlée en « color(srgb r g b) » (0 à 1), sinon en « rgb(r, g, b) » (0 à 255). */
        const jaune = (css) => {
          const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css || '');
          const m = srgb ? srgb.slice(1).map((x) => Number(x) * 255) : (/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css || '') ?? []).slice(1).map(Number);
          return m.length === 3 && m[0] > m[2] + 60 && m[1] > m[2] + 40;
        };
        verifier('le passage fait seul se lit en jaune, sous « Passage automatique · lancé à la main »', /Passage automatique · lancé à la main/.test(passage.tete) && jaune(passage.couleurTete) && jaune(passage.couleurTexte), `${passage.tete} ${passage.couleurTete} ${passage.couleurTexte}`);
        verifier('la note de fiche se lit en clair, dans la couleur du texte (pas en jaune)', passage.note && !jaune(passage.couleurNote), passage.couleurNote);
        await capturer(page, `agent-complet-1440-${theme}`);

        /* 5. Le tableau (« Tableau des agents », menu à trois points) : tri, filtre, recherche. */
        await ouvrirLeTableau();
        verifier('« Tableau des agents » ouvre l’ancien tableau du projet', (await page.locator('[data-agents-du-projet]').count()) === 1);
        await page.locator('[data-nouvel-agent-perso]').first().click();
        await page.locator('[data-page-agent-perso]').waitFor({ state: 'visible', timeout: 30_000 });
        second = decodeURIComponent(page.url().split('/agents/')[1] ?? '');
        await poserUneReponseAValider(premier);
        await ouvrirLeTableau();
        /* Les cinq membres semés de l'équipe, plus les deux agents créés ici. */
        verifier('le tableau montre une ligne par agent (équipe semée comprise)', (await page.locator('[data-ligne-agent-perso]').count()) === 7);
        const entetes = await page.locator('[data-agents-du-projet] thead th').allInnerTexts();
        verifier('une seule ligne d’en-tête : Agent, Quand il agit, Ce qu’il fait, État, Dernière action, Actif', ['Agent', 'Quand il agit', 'Ce qu’il fait', 'État', 'Dernière action', 'Actif'].every((e) => entetes.some((x) => x.includes(e))), entetes.join(' · '));
        const triAvant = await page.locator('[data-tableau="agents-du-projet"]').getAttribute('data-tableau-tri');
        const avant = await page.locator('[data-ligne-agent-perso]').first().getAttribute('data-ligne-agent-perso');
        await page.locator('[data-agents-du-projet] [data-tri-colonne="nom"]').first().click();
        await page.waitForTimeout(300);
        const triApres = await page.locator('[data-tableau="agents-du-projet"]').getAttribute('data-tableau-tri');
        const apres = await page.locator('[data-ligne-agent-perso]').first().getAttribute('data-ligne-agent-perso');
        verifier('un clic sur l’en-tête « Agent » inverse le tri', avant !== apres && triAvant !== triApres, `${triAvant} → ${triApres}`);
        verifier('la réponse préparée s’affiche en bleu « À valider »', (await page.locator(`[data-ligne-agent-perso="${premier}"] [data-etat-agent-perso="a_valider"]`).count()) === 1);
        verifier('le point du matin propose d’aller à ce qui attend', (await page.locator(`[data-point-du-matin] [data-point-ouvrir="${premier}"]`).count()) === 1);
        await page.locator('[data-tableau-recherche="agents-du-projet"]').fill('Veilleur');
        await page.waitForTimeout(300);
        verifier('la recherche trouve l’agent par son nom', (await page.locator('[data-ligne-agent-perso]').count()) === 1);
        await page.locator('[data-tableau-recherche="agents-du-projet"]').fill('');
        await page.locator('[data-tableau-bouton-filtre="agents-du-projet"]').click();
        await page.locator('[data-tableau-choix-filtre="etat:brouillon"]').click();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        verifier('le filtre d’état ne garde que les brouillons', (await page.locator('[data-ligne-agent-perso]').count()) === 1 && (await page.locator(`[data-ligne-agent-perso="${second}"]`).count()) === 1);
        await page.locator('[data-tableau-bouton-filtre="agents-du-projet"]').click();
        await page.locator('[role="menuitem"][data-effacer-filtres]').click();
        await page.keyboard.press('Escape');
        verifier('l’interrupteur d’un brouillon est éteint et grisé', await page.locator(`[data-interrupteur-agent-perso="${second}"]`).isDisabled());
        const cadre = await page.locator('[data-tableau="agents-du-projet"] table').first().evaluate((t) => {
          const parent = t.parentElement;
          return { table: Math.round(t.getBoundingClientRect().width), cadre: Math.round(parent?.getBoundingClientRect().width ?? 0) };
        });
        verifier('les six colonnes tiennent dans le cadre à 1440 px', cadre.table <= cadre.cadre + 1, `${cadre.table} / ${cadre.cadre}`);
        await capturer(page, `agents-tableau-1440-${theme}`);

        /* 7. Entrer par la colonne ouvre la page de l'équipe du projet. */
        await page.goto('about:blank');
        await page.goto(`${BASE}/#tableau-de-bord`, { waitUntil: 'load' });
        const ligneDuProjet = page.locator(`[data-projet-cible="${PROJET}"] a`).first();
        await ligneDuProjet.waitFor({ state: 'visible', timeout: 20_000 });
        await ligneDuProjet.click();
        await page.locator(selecteur).first().waitFor({ state: 'visible', timeout: 15_000 });
        verifier('entrer par la colonne ouvre la page de l’équipe', (await page.locator('[data-gabarit-equipe="projet"]').count()) === 1);
        atelier = await controlerLesTableauxDeBord(page, theme, atelier);
      } else {
        await controlerLesTableauxDeBord(page, theme, atelier);
        await ouvrirLeTableau();
        await capturer(page, `agents-tableau-1440-${theme}`);
      }
      if (theme === 'dark') {
        await ouvrir(page, `projet/${PROJET}/agents/${premier}`, '[data-configuration-agent-perso]');

        await capturer(page, `agent-complet-1440-${theme}`);
      }

      /* 8. Téléphone. */
      await page.setViewportSize({ width: 390, height: 844 });
      await ouvrir(page, `projet/${PROJET}`, selecteur);
      await page.waitForTimeout(500);
      verifier(`téléphone (${theme}) : rien ne déborde sur la page de l’équipe`, (await debordement(page)) <= 0);
      await capturer(page, `agents-equipe-390-${theme}`);
      {
        const fonds = await page.evaluate((sel) => {
          const choisi = document.querySelector(`${sel} [aria-selected="true"]`);
          return choisi ? getComputedStyle(choisi).backgroundColor : '';
        }, selecteur);
        const l = luminance(fonds);
        verifier(`téléphone (${theme}) : l’onglet choisi garde l’aplat contrasté`, theme === 'light' ? l >= 0 && l < 0.15 : l > 0.75, fonds);
      }
      await ouvrir(page, `projet/${PROJET}/agents/${premier}`, '[data-barre-onglets="agent-onglets"]');
      /* « Discussion » puis la fiche (un agent libre sans outil) : deux onglets, la même barre que le projet. */
      verifier(`téléphone (${theme}) : la page de l’agent passe en deux onglets`, (await page.locator('[data-barre-onglets="agent-onglets"] [data-onglet]').count()) === 2);
      await capturer(page, `agent-conversation-390-${theme}`);
      await page.locator('[data-barre-onglets="agent-onglets"] [data-onglet="fiche"]').click();
      await page.locator('[data-configuration-agent-perso]').waitFor({ state: 'visible', timeout: 10_000 });
      verifier(`téléphone (${theme}) : la configuration et son pied`, await page.locator('[data-pied-agent-perso]').isVisible());
      verifier(`téléphone (${theme}) : un seul bouton en bas de l’écran`, (await page.locator('[data-pied-agent-perso] button:visible').count()) === 1);
      verifier(`téléphone (${theme}) : rien ne déborde sur la page de l’agent`, (await debordement(page)) <= 0);
      await capturer(page, `agent-configuration-390-${theme}`);

      /* 10 bis. Tableaux de bord au téléphone : « Agents » dans la rangée existante, une seule rangée. */
      await ouvrir(page, 'en-route/agents', '[data-agents-du-projet="tous"] [data-ligne-agent-perso]');
      await page.waitForTimeout(400);
      verifier(`téléphone (${theme}) : Tableaux de bord, « Agents » choisi dans la rangée des onglets`, (await page.locator('[data-barre-onglets="tableaux-de-bord"] [data-onglet="agents"][aria-selected="true"]').count()) === 1);
      verifier(`téléphone (${theme}) : Tableaux de bord, une seule rangée d’onglets`, (await page.locator('[data-barre-onglets="tableaux-de-bord-taches-agents"]:visible').count()) === 0);
      verifier(`téléphone (${theme}) : Tableaux de bord, chaque agent dit son projet`, (await page.locator('[data-agents-du-projet="tous"] [data-projet-de-l-agent]:visible').count()) === (await page.locator('[data-agents-du-projet="tous"] [data-ligne-agent-perso]:visible').count()));
      verifier(`téléphone (${theme}) : Tableaux de bord, rien ne déborde`, (await debordement(page)) <= 0);
      await capturer(page, `tableaux-agents-390-${theme}`);
      /* « Nouvel agent » au téléphone : rangé en tête des trois points du haut, il ouvre la liste des projets. */
      await page.locator('[data-trois-points-du-haut]:visible').first().click();
      const nouvelAuTelephone = page.locator('[data-menu-du-haut-principal] [data-nouvel-agent-perso="tous"]');
      const nouvelVisible = await nouvelAuTelephone.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
      if (nouvelVisible) await nouvelAuTelephone.click();
      const listeVisible = nouvelVisible && (await page.locator(`[data-liste-option="${AUTRE}"]`).waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false));
      verifier(`téléphone (${theme}) : « Nouvel agent » (trois points du haut) ouvre la liste des projets`, listeVisible);
      await capturer(page, `tableaux-nouvel-agent-390-${theme}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      if (await page.locator(`[data-liste-option="${AUTRE}"]`).isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await page.locator('[data-barre-onglets="tableaux-de-bord"] [data-onglet="taches"]').click();
      await page.waitForTimeout(400);
      verifier(`téléphone (${theme}) : « Tâches » ramène la liste et l’adresse #en-route`, page.url().endsWith('#en-route') && (await page.locator('[data-agents-du-projet="tous"]').count()) === 0, page.url());

      verifier(`aucune erreur de page (${theme})`, erreurs.length === 0, erreurs.join(' | '));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
  const moteur = journal.join('').match(/fil du moteur reparti|engine spawn/gi);
  verifier('aucun moteur joint pendant l’essai', !moteur, moteur?.join(', '));
}

principal()
  .catch((err) => {
    console.error(err);
    resultats.push(false);
  })
  .finally(() => {
    nettoyer();
    const ok = resultats.filter(Boolean).length;
    console.log(`\n${ok}/${resultats.length} contrôles passent.`);
    process.exit(ok === resultats.length && resultats.length ? 0 : 1);
  });
