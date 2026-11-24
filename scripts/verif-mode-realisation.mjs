#!/usr/bin/env node
/**
 * LE MODE « RÉALISATION » (confirmé dans la discussion depuis le 11/11/2026, plus de bouton caméra) : SES CONSIGNES, SON
 * OUTIL ET LA PAGE « MÉDIAS ».
 *
 *   node scripts/verif-mode-realisation.mjs
 *
 * Le script monte son PROPRE démon, sur un port libre (`BELUGA_REALISATION_PORT`,
 * 7233 par défaut), avec une base neuve, un FAUX moteur et un disque de médias
 * factice : le démon de production n'est pas touché, pas un jeton ni un
 * centime n'est dépensé. Il ne lit JAMAIS `BELUGA_URL` ni `BELUGA_TOKEN`. À
 * lancer depuis une copie de travail, jamais depuis le dépôt principal.
 *
 * Ce qui est vérifié, à la souris dans un vrai navigateur :
 *   1. une carte neuve porte l'interrupteur « Réalisation », ÉTEINT ;
 *   2. le mode Studio (vidéo) confirmé l'allume en base et pose l'étiquette, SANS forcer le plan et SANS lancer un seul tour
 *      de moteur : le champ d'écriture reste, et l'état survit à un
 *      rechargement ;
 *   3. le premier message lance le cadrage : la consigne emporte le type
 *      confirmé (pas redemandé) et les quatre
 *      étapes (Brief → Esquisses → Montage → Téléchargement, 26/10/2026) ; le
 *      cadrage — le directeur, du brief au téléchargement — reçoit
 *      « cahier_de_realisation » et « realiser », plus jamais l'outil des
 *      aperçus ; la barre d'écriture reste, la rangée du média au-dessus ;
 *   4. le document se lit dans le tiroir ; une pause (posée par le démon) rend
 *      la barre d'écriture, la reprise renvoie le document ; une fois tout
 *      tranché, toujours aucun bouton « Lancer », et l'on reste au Brief ;
 *   5. retirer le mode l'éteint ; le reconfirmer par un
 *      type rend le volet tel quel ;
 *   6. en vue téléphone (390 px), clair et sombre, le chemin tient à l'écran,
 *      sans bouton « Lancer » ;
 *   7. « Passer aux esquisses » au bouton du bas : le passage s'écrit, la
 *      carte reste dans « Planifié » (aucun lancement : le directeur la garde,
 *      réveillé UNE fois pour proposer la première génération à prix),
 *      le bouton dit ce qui manque ensuite ; le message suivant part au
 *      directeur avec la consigne des esquisses, et « monter » lui est refusé
 *      tant que l'utilisateur n'a pas cliqué « Passer au montage » ;
 *   7 bis. tour refermé, la barre d'étapes est la TÊTE du repère des tâches
 *      collé au champ (un seul bloc) ; les flèches du haut à gauche montrent
 *      les procédures passées puis reviennent à la dernière ; en vue
 *      téléphone le bloc reste collé au champ ;
 *   7 ter. « Valider » ouvre la liste des plans et place l'image dans le plan
 *      choisi ; à la souris, une image du fil se glisse vers une case d'image,
 *      et deux cases pleines échangent leurs images (28/10/2026) ;
 *   8. la page « Médias » montre les médias du projet, rangés par carte.
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exiger = createRequire(path.join(RACINE, 'package.json'));
const Database = exiger('better-sqlite3');
const { WebSocket } = exiger('ws');
const PORT = Number(process.env.BELUGA_REALISATION_PORT || 7233);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-realisation-'));
const PROJET_ID = 'projet-realisation';

/** Chaque durée de tâche affichée tient-elle DANS le repère et dans sa zone qui défile ? */
async function dureesDansLeCadre(page, detail = false) {
  return page.evaluate((detail) => {
    const volet = document.querySelector('[data-volet="taches"]');
    const lignes = [...(volet?.querySelectorAll('[data-taches-en-branches] > li') ?? [])];
    const mesures = lignes.map((li) => {
      const duree = li.lastElementChild?.getBoundingClientRect();
      const zone = li.parentElement.getBoundingClientRect();
      /* Le cadre : la colonne des étapes (capture #b153), pas le bloc entier. */
      const cadre = (li.closest('[data-chemin-realisation]') ?? volet).getBoundingClientRect();
      return { texte: li.lastElementChild?.textContent, droite: duree?.right, zone: zone.right, cadre: cadre.right };
    });
    if (detail) return mesures;
    return mesures.length > 0 && mesures.every((m) => /\d/.test(m.texte ?? '') && m.droite <= m.zone + 0.5 && m.droite <= m.cadre + 0.5);
  }, detail);
}

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DEPOT = path.join(TMP, 'depot');
const DEMANDES = path.join(TMP, 'demandes');
const MAISON = path.join(TMP, 'maison');
const COMPTE = path.join(TMP, 'compte-claude');
for (const dossier of [DATA, PROJETS, DEPOT, DEMANDES, MAISON, COMPTE]) fs.mkdirSync(dossier, { recursive: true });
fs.writeFileSync(
  path.join(COMPTE, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { accessToken: 'jeton-d-essai', expiresAt: Date.now() + 3600_000 } }),
);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DEPOT });
fs.writeFileSync(path.join(DEPOT, 'README.md'), '# essai\n');
execFileSync('git', ['add', 'README.md'], { cwd: DEPOT });
execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '-qm', 'départ'], { cwd: DEPOT });

/*
 * LE FAUX MOTEUR garde chaque demande reçue, puis demande au pont la liste de
 * ses outils et, s'il y trouve « evaluer », l'appelle : c'est ce qu'un vrai
 * moteur ferait. Il pose le titre et rend une compréhension, pour que le tour
 * de cadrage se referme proprement.
 */
const FAUX_MOTEUR = path.join(TMP, 'faux-claude.mjs');
fs.writeFileSync(
  FAUX_MOTEUR,
  `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) { process.stdout.write('faux-moteur 0.0.0 (essai)\\n'); process.exit(0); }
let demande = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (demande += d));
process.stdin.on('end', () => jouer());
const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const TMP = ${JSON.stringify(TMP)};
async function jouer() {
  fs.writeFileSync(${JSON.stringify(DEMANDES)} + '/' + Date.now() + '.txt', demande);
  dire({ type: 'system', subtype: 'init', session_id: 'session-' + Math.random().toString(16).slice(2) });
  const cheminMcp = process.argv[process.argv.indexOf('--mcp-config') + 1];
  const pont = cheminMcp && fs.existsSync(cheminMcp) ? JSON.parse(fs.readFileSync(cheminMcp, 'utf8')).mcpServers?.beluga?.env : null;
  const entetes = pont ? {
    'content-type': 'application/json',
    'x-beluga-token': pont.BELUGA_TOKEN,
    'x-beluga-agent': pont.BELUGA_AGENT,
    'x-beluga-tour': pont.BELUGA_TOUR,
  } : {};
  const appeler = async (name, args) => {
    if (!pont) return null;
    const res = await fetch(pont.BELUGA_URL + '/internal/call', { method: 'POST', headers: entetes, body: JSON.stringify({ name, args }) });
    const rendu = await res.json().catch(() => null);
    fs.appendFileSync(TMP + '/pont.log', JSON.stringify({ name, rendu }) + '\\n');
    return rendu;
  };
  /* LE GESTE 1 DU CADRAGE D'ABORD : le titre, seul, avant tout autre outil. */
  /* Une demande de suite (reprise) ne redit pas l'identifiant : on garde celui du premier tour. */
  const cardId = /Identifiant de cette carte[^:]*:\\s*([0-9a-f-]{36})/i.exec(demande)?.[1] ?? (fs.existsSync(TMP + '/carte.txt') ? fs.readFileSync(TMP + '/carte.txt', 'utf8') : undefined);
  if (cardId) fs.writeFileSync(TMP + '/carte.txt', cardId);
  if (cardId) await appeler('board_update_card', { cardId, title: 'Essai du mode Réalisation' });
  if (pont) {
    const res = await fetch(pont.BELUGA_URL + '/internal/tools', { method: 'POST', headers: entetes, body: '{}' });
    const outils = ((await res.json().catch(() => ({}))).tools ?? []).map((t) => t.name);
    fs.appendFileSync(TMP + '/outils.log', JSON.stringify(outils) + '\\n');
  }
  /* LE QUESTIONNAIRE DE RÉALISATION : le document et l'avancement après la
     réponse, comme un vrai cadrage — terminé au tour de reprise. */
  const outilsServis = pont ? (fs.readFileSync(TMP + '/outils.log', 'utf8').trim().split('\\n').pop() ?? '') : '';
  const reponseEnImages = demande.includes('Néon nocturne') && !demande.includes('REPRISE DU QUESTIONNAIRE');
  const auxEsquisses = demande.includes('L’ÉTAPE EN COURS EST « ESQUISSES »');
  if (cardId && !reponseEnImages && !auxEsquisses && outilsServis.includes('cahier_de_realisation') && demande.includes('MODE RÉALISATION ALLUMÉ')) {
    const fin = demande.includes('REPRISE DU QUESTIONNAIRE');
    await appeler('cahier_de_realisation', {
      document:
        '# Réalisation\\n\\n## Intention\\nVendre l’application.\\n\\n## Format et livrables\\n' + (fin ? 'Vertical 9:16, 20 s.' : 'à voir') + '\\n\\n' +
        ['Scénario et découpage', 'Direction artistique', 'Personnages et continuité', 'Plan par plan', 'Son', 'Montage et incrustations', 'Droits et conformité', 'Contrôle qualité', 'Devis prévisionnel']
          .map((titre) => '## ' + titre + '\\n' + (fin ? 'Écrit pour l’essai.' : 'à voir') + '\\n\\n').join('') +
        '## Budget et seuil\\n' + (fin ? 'Budget total : 12 $\\nSeuil d’accord par génération : 1 $\\nNouvelles tentatives maximales par plan : 2' : 'à voir') + '\\n',
      faites: fin ? 8 : 2,
      total: 8,
      phase: fin ? 'budget' : 'format',
      restants: fin ? [] : ['Format', 'Budget'],
      termine: fin,
    });
    /* LE BRIEF ET LE DÉCOUPAGE, écrits dès le premier tour : « Passer aux esquisses » les attend. */
    if (!fin && outilsServis.includes('"production"')) {
      await appeler('production', { action: 'brief', champs: [{ champ: 'objectif', valeur: 'Vendre l’application', source: 'demande' }] });
      await appeler('production', { action: 'plans', plans: [{ titre: 'Plan 1', contenu: 'La plage au réveil.\\nDurée : 4 s\\nCapacité : montage' }] });
    }
    /* LE CHOIX EN IMAGES (22/10/2026) : deux images jointes, puis une question
       dont chaque option porte son image. */
    if (!fin) {
      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const ids = [];
      for (const nom of ['apercu-neon.png', 'apercu-pastel.png']) {
        const chemin = ${JSON.stringify(DATA)} + '/' + nom;
        fs.writeFileSync(chemin, Buffer.concat([PNG, Buffer.from(nom)]));
        await appeler('attach_file', { path: chemin });
      }
      const { createRequire } = await import('node:module');
      const Database = createRequire(${JSON.stringify(path.join(RACINE, 'package.json'))})('better-sqlite3');
      const db = new Database(${JSON.stringify(path.join(DATA, 'beluga.db'))}, { readonly: true });
      for (const nom of ['apercu-neon.png', 'apercu-pastel.png']) ids.push(db.prepare("SELECT id FROM attachments WHERE json_extract(data, '$.name') = ? ORDER BY created_at DESC").get(nom)?.id);
      db.close();
      await appeler('ask_user', {
        question: 'Quelle ambiance pour la vidéo ?',
        kind: 'single',
        options: [
          { label: 'Néon nocturne', image: ids[0] },
          { label: 'Pastel doux', image: ids[1] },
        ],
      });
    }
  }
  /* AUX ESQUISSES, le directeur essaie d'ouvrir le montage : le serveur le lui refuse, c'est le geste de l'utilisateur. */
  if (auxEsquisses && outilsServis.includes('"realiser"')) {
    await appeler('realiser', { action: 'monter' });
  }
  await appeler('rendre_comprehension', {
    texte: 'Vous voulez une vidéo.',
    resumeDemande: 'Vous demandez un essai.',
    resumeComprehension: 'Je comprends qu’il faut essayer le mode.',
    sujets: ['interface'],
    partieTechnique: { taches: [{ titre: 'Essayer', description: 'Rien d’autre.' }], faits: [], risques: 'Aucun.' },
  });
  dire({ type: 'assistant', message: { content: [{ type: 'text', text: 'Compris.' }] } });
  dire({ type: 'result', subtype: 'success', session_id: 'session-essai', usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}
`,
);
fs.chmodSync(FAUX_MOTEUR, 0o755);

const journal = [];
const envDuDemon = { ...process.env };
delete envDuDemon.BELUGA_TOKEN;
delete envDuDemon.BELUGA_URL;
const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...envDuDemon,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    // Aucun modèle de traduction ici : les consignes passent telles quelles (traduction-des-consignes.ts).
    BELUGA_TRADUCTION_IDENTITE: "1",
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
    BELUGA_CLAUDE_BIN: FAUX_MOTEUR,
    BELUGA_MEDIAS: path.join(TMP, 'disque-de-stockage', 'beluga-medias'),
    HOME: MAISON,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

process.on('exit', () => {
  if (process.env.BELUGA_REALISATION_JOURNAL) fs.writeFileSync(process.env.BELUGA_REALISATION_JOURNAL, journal.join(''));
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  if (!process.env.BELUGA_REALISATION_GARDER) fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const jeton = crypto.randomBytes(24).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (lecture = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lecture });

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification mode réalisation',
  );
  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai réalisation',
    path: DEPOT,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);
  db.prepare('INSERT INTO accounts (id, engine, data, updated_at) VALUES (?, ?, ?, ?)').run(
    'compte-essai',
    'claude',
    JSON.stringify({ id: 'compte-essai', engine: 'claude', label: 'Compte d’essai', priority: 1, configDir: COMPTE }),
    maintenant,
  );
  db.close();
}

const cartes = () => {
  const db = base(true);
  const lignes = db.prepare('SELECT id, column_key, data FROM cards').all();
  db.close();
  /* La colonne est une VRAIE colonne de la table : elle ne vit pas dans `data`. */
  return lignes.map((l) => ({ id: l.id, ...JSON.parse(l.data), column: l.column_key }));
};
const demandesRecues = () =>
  fs
    .readdirSync(DEMANDES)
    .sort()
    .map((nom) => fs.readFileSync(path.join(DEMANDES, nom), 'utf8'));
const lignes = (fichier) =>
  fs.existsSync(path.join(TMP, fichier))
    ? fs.readFileSync(path.join(TMP, fichier), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

/** Une commande au démon d'essai, par le même canal que l'interface. */
function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { Cookie: `beluga_session=${jeton}` } });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 40000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

async function attendre(condition, limiteMs = 20000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  /* La liste des étapes se replie comme celle des tâches (#9c15) : dépliée ici, pour lire ses lignes. */
  await contexte.addInitScript(() => localStorage.setItem('beluga.volet-taches.deplie', '1'));
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  const ecarterLAssistant = () =>
    page.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });

  /* Le projet est nommé : l'application s'ouvre désormais sur le tableau de bord, où « Nouvelle tâche » n'est pas. */
  await page.goto(`${BASE}/#projet/${PROJET_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await ecarterLAssistant();

  /* -------- 1. La carte neuve porte l'interrupteur, éteint -------- */
  /* « Nouvelle tâche » vit en tête de la colonne de gauche ; le bouton du bas
     de l'écran (téléphone) porte le même repère, monté mais caché ici. */
  await page.locator('[data-nouvelle-carte="planned"]:visible').first().click();
  await attendre(() => cartes().length === 1);
  const carte = cartes()[0];
  noter('une carte neuve naît', !!carte);
  /* PLUS DE BOUTONS DE MODE DANS LE CHAMP (11/11/2026), ni d'étiquette (24/11/2026) : le mode se confirme dans la discussion. */
  await page.waitForTimeout(1000);
  noter(
    'le champ n’a plus de bouton de mode',
    (await page.locator('[data-interrupteur-realisation], [data-interrupteur-plan], [data-interrupteur-creation]').count()) === 0,
  );
  noter('la carte naît sans le mode', !carte?.parcours?.realisationSouhaitee);

  /* -------- 2. Un clic l'allume : rien ne part -------- */
  /* Le titre parle déjà de vidéo : la question doit paraître quand même. */
  await commande({ type: 'card.update', id: carte.id, patch: { title: 'Première vidéo de vente' } });
  /* Le mode Studio CONFIRMÉ (l'agent l'écrit par « board_update_card » ; le démon garde le même geste). */
  await commande({ type: 'card.realisation.souhaitee', cardId: carte.id, media: 'video' });
  noter('le mode Studio (vidéo) s’écrit en base', !!(await attendre(() => !!cartes()[0]?.parcours?.realisationSouhaitee)));
  noter('le type choisi s’écrit sur la carte (vidéo)', (cartes()[0]?.realisation?.medias ?? []).join() === 'video');
  noter('un clic l’allume en base', await attendre(() => !!cartes()[0]?.parcours?.realisationSouhaitee));
  noter('l’état du questionnaire est posé, sans genre', !!cartes()[0]?.realisation && !cartes()[0]?.realisation?.genre);
  noter('le plan n’est plus forcé', !cartes()[0]?.parcours?.planSouhaite);
  /* ALLUMER N'OUVRE PAS LE VOLET (décision du 19/10/2026) : la conversation
     reste ordinaire, seul le bouton est allumé. */
  await page.waitForTimeout(1500);
  noter('aucun volet de réalisation avant l’envoi', (await page.locator('[data-volet-realisation]').count()) === 0);
  /* UNE CRÉATION DE MÉDIA A SON BOUTON DÈS L'ALLUMAGE (26/10/2026) : « Passer aux esquisses », éteint tant que le brief n'est pas écrit, jamais « Lancer ». */
  noter(
    'avant l’envoi : la rangée porte « Passer aux esquisses », éteint, et aucun lancement',
    await attendre(async () => (await page.locator('[data-barre-realisation] [data-geste-du-media="passer-esquisses"][aria-disabled="true"]').count()) === 1, 10000) &&
      (await page.locator('[data-geste-principal="lancer"], [data-geste-principal="valider-et-lancer"]').count()) === 0,
  );
  noter('aucune frise « Types de média » avant l’envoi', (await page.locator('[data-barre-etapes="genre"]').count()) === 0);
  noter('aucun écran « Image ou vidéo ? » : plus de choix posé par le bandeau', (await page.locator('[data-realisation-genre]').count()) === 0);
  noter('sans aucun tour de moteur : allumer ne lance rien', demandesRecues().length === 0, `${demandesRecues().length} demande(s)`);
  noter('la barre d’écriture ordinaire reste là pour écrire sa demande', (await page.locator('[data-composer] textarea:visible').count()) >= 1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ecarterLAssistant();
  noter('le mode survit à un rechargement', await attendre(() => !!cartes()[0]?.parcours?.realisationSouhaitee, 20000));
  noter('toujours aucun volet ni tour de moteur après le rechargement', (await page.locator('[data-volet-realisation]').count()) === 0 && demandesRecues().length === 0);

  /* -------- 3. Le premier message lance le cadrage, qui pose la question -------- */
  await page.locator('[data-composer] textarea:visible').first().fill('Je veux une vidéo promotionnelle avec une musique.');
  /* L'envoi est un carré arrondi de la taille du micro, à flèche vers la droite. */
  const tailles = await page.evaluate(() => {
    const boite = (e) => (e ? { l: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10, rayon: parseFloat(getComputedStyle(e).borderTopLeftRadius) } : null);
    return { envoi: boite(document.querySelector('[data-composer-envoi]')), micro: boite(document.querySelector('[data-mic-button]')) };
  });
  noter(
    'le bouton d’envoi a la taille du micro et des coins arrondis, pas un rond',
    !!tailles.envoi && !!tailles.micro && tailles.envoi.l === tailles.micro.l && tailles.envoi.h === tailles.micro.h && tailles.envoi.rayon === tailles.micro.rayon && tailles.envoi.rayon < tailles.envoi.l / 2,
    JSON.stringify(tailles),
  );
  await page.locator('[data-composer-envoi]').first().click();
  noter('le message part au moteur', await attendre(() => demandesRecues().length >= 1, 30000));
  const premiere = demandesRecues()[0] ?? '';
  noter('il emporte le message exact de l’utilisateur', premiere.includes('Je veux une vidéo promotionnelle avec une musique.'));
  /* LA BARRE D'ÉCRITURE RESTE (26/10/2026) : la rangée du média se pose au-dessus du champ, sans bandeau à sa place. */
  /* Le faux directeur pose sa question en images dans la foulée : quand elle arrive, c'est elle qui
     occupe la place du champ, comme toute question — l'un ou l'autre, jamais l'ancien bandeau. */
  noter(
    'le premier envoi garde la barre d’écriture, la rangée du média au-dessus',
    await attendre(async () => (await page.locator('[data-barre-realisation]').count()) >= 1
      && ((await page.locator('[data-composer] textarea:visible').count()) >= 1 || (await page.locator('[data-choix-en-images], [data-question-compacte]').count()) > 0), 15000),
  );
  noter('la date du premier envoi est sur la carte', !!cartes()[0]?.realisation?.demandeA);
  noter(
    'il emporte la consigne : type confirmé (vidéo), pas redemandé, une vidéo comprenant tout — plus aucun bouton caméra',
    premiere.includes('MODE RÉALISATION ALLUMÉ') && premiere.includes('A CONFIRMÉ CE QU’IL VEUT OBTENIR : VIDÉO') && premiere.includes('Ne le redemande pas') && premiere.includes('Une VIDÉO comprend d’office') && !/bouton caméra/i.test(premiere),
  );
  await attendre(() => lignes('outils.log').length >= 1, 15000);
  const outilsDuCadrage = lignes('outils.log')[0] ?? [];
  noter('le cadrage reçoit « cahier_de_realisation »', outilsDuCadrage.includes('cahier_de_realisation'));
  noter('le cadrage — le directeur, du brief au téléchargement — reçoit aussi « realiser »', outilsDuCadrage.includes('realiser'));
  noter('le type choisi reste « vidéo » sur la carte après la réponse du cadrage', await attendre(() => (cartes()[0]?.realisation?.medias ?? []).join() === 'video', 20000));
  noter('l’avancement s’écrit sur la carte', await attendre(() => cartes()[0]?.realisation?.faites === 2, 20000));
  /* PLUS D'APERÇUS PAYÉS D'OFFICE (26/10/2026) : chaque génération a son bouton à prix, aux esquisses. */
  noter('le cadrage ne reçoit plus l’outil des aperçus', !outilsDuCadrage.includes('apercu_de_realisation'));
  noter(
    'la consigne annonce les quatre étapes, le Brief en cours, et le bouton du bas',
    premiere.includes('BRIEF → ESQUISSES → MONTAGE → TÉLÉCHARGEMENT') && premiere.includes('L’ÉTAPE EN COURS EST « BRIEF »') && premiere.includes('BOUTON DU BAS'),
  );
  /* LE VOLET DE SUIVI DU STUDIO CRÉATIF s'ouvre seul à droite dès que le chemin
     paraît : une nouvelle production s'ouvre avec lui. SA CROIX ET LE BOUTON
     « SUIVI » LE FERMENT, ET LA CARTE S'EN SOUVIENT (décision du 28/10/2026, qui
     remplace « toujours ouvert, sans croix ») : fermé, il le reste après un
     rechargement ; rouvert, il le reste aussi. On juge ensuite le chemin en
     largeur de téléphone, où il reste dans la conversation. */
  noter('le volet de suivi s’ouvre de lui-même à droite', await attendre(async () => (await page.locator('[data-volet-de-suivi]').count()) === 1, 15000));
  noter('le volet porte sa croix, à côté de la dépense', (await page.locator('[data-volet-de-suivi] [data-croix-du-volet="suivi"]').count()) === 1);
  noter('le bouton « Suivi » est allumé tant que le suivi est ouvert', (await page.locator('[data-basculer-le-suivi="ouvert"][aria-pressed="true"]').count()) === 1);
  await page.locator('[data-croix-du-volet="suivi"]').click();
  noter('la croix ferme le suivi', await attendre(async () => (await page.locator('[data-volet-de-suivi]').count()) === 0, 5000));
  noter(
    'fermé, le chemin du tournage revient dans la conversation, sans son propre bouton « Suivi »',
    await attendre(async () => (await page.locator('[data-chemin-realisation]').count()) >= 1, 8000) && (await page.locator('[data-ouvrir-le-suivi]').count()) === 0,
  );
  await page.reload();
  await page.locator('[data-basculer-le-suivi]').waitFor({ timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  noter(
    'fermé, il le reste après un rechargement',
    (await page.locator('[data-volet-de-suivi]').count()) === 0 && (await page.locator('[data-basculer-le-suivi="ferme"]').count()) === 1,
  );
  {
    const db = base(true);
    const ligne = db.prepare(`SELECT value FROM preferences WHERE key = 'suivi.fermes'`).get();
    db.close();
    noter('la fermeture est gardée pour cette carte dans les réglages du compte, en base', !!ligne && JSON.parse(ligne.value).includes(cartes()[0]?.id), ligne?.value ?? 'aucune ligne');
  }
  await page.locator('[data-basculer-le-suivi]').click();
  noter('le bouton « Suivi » le rouvre', await attendre(async () => (await page.locator('[data-volet-de-suivi]').count()) === 1, 5000));
  await page.reload();
  noter('rouvert, il le reste après un rechargement', await attendre(async () => (await page.locator('[data-volet-de-suivi]').count()) === 1, 20000));
  await page.setViewportSize({ width: 390, height: 844 });
  noter('en largeur de téléphone, il laisse la place au chemin', await attendre(async () => (await page.locator('[data-volet-de-suivi]').count()) === 0, 10000));
  /* LE CHEMIN, collé au-dessus de la rangée d'action : les quatre étapes du média, le Brief en cours. */
  noter(
    'le chemin s’affiche, à l’étape Brief',
    await attendre(async () => (await page.locator('[data-chemin-realisation][data-jalon="brief"]').count()) === 1, 15000),
  );
  noter('il porte quatre étapes, le Brief en cours', (await page.locator('[data-etape-chemin]').count()) === 4 && (await page.locator('[data-etape-chemin="brief"]').getAttribute('data-etat')) === 'encours');
  /* PLUS AUCUN TEXTE SOUS L'ÉTAPE (décision du 23/10/2026) : ni membre de l'équipe, ni mission, ni « Ensuite », ni enveloppe. */
  noter(
    'l’étape en cours ne porte aucun texte sous son nom',
    await page.evaluate(() => {
      const ici = document.querySelector('[data-chemin-realisation] [data-etape-depliee]');
      return !!ici && !ici.querySelector('[data-relais-realisation], [data-chemin-suivant], [data-chemin-pret], [data-enveloppe-apercus], p');
    }),
  );
  /* COLLÉ EN BAS (22/10/2026) : hors du fil, juste au-dessus de la rangée d'action, sans jauge ni pause. */
  noter(
    'le chemin est collé hors du fil, au-dessus de la rangée d’action',
    await page.evaluate(() => {
      const chemin = document.querySelector('[data-chemin-realisation]');
      const rangee = document.querySelector('[data-barre-realisation]');
      return !!chemin && !chemin.closest('[data-fil="parcours"]') && !!rangee && chemin.getBoundingClientRect().bottom <= rangee.getBoundingClientRect().top + 1;
    }),
  );
  /* LE CHOIX EN IMAGES : deux vignettes cliquables, le clic répond, l'image rejoint le tableau d'ambiance.
     En largeur de téléphone, la barre d'écriture reste (26/10/2026) : la question attend en version
     compacte, et « Répondre » ouvre sa feuille du bas. */
  {
    const compacte = page.locator('[data-question-compacte] [data-repondre-question]').first();
    await attendre(async () => (await compacte.count()) === 1 || (await page.locator('[data-choix-en-images]').count()) > 0, 20000);
    if ((await compacte.count()) === 1) await compacte.click();
  }
  noter(
    'la question en images s’affiche en vignettes',
    await attendre(async () => (await page.locator('[data-choix-en-images] [data-option-image]').count()) === 2, 20000),
    String(await page.locator('[data-choix-en-images] [data-option-image]').count()),
  );
  noter('chaque vignette porte son image', (await page.locator('[data-choix-en-images] img[data-image-piece]').count()) === 2);
  await page.locator('[data-choix-en-images] [data-option-question]').first().click();
  noter('le clic retient la vignette', (await page.locator('[data-choix-en-images] [data-option-retenue]').count()) === 1);
  await page.locator('[data-bulle-question]:has([data-choix-en-images]) [data-repondre-question]').first().click();
  noter(
    'le choix retenu rejoint le tableau d’ambiance de la carte',
    await attendre(() => (cartes()[0]?.realisation?.ambiance ?? []).some((p) => p.legende === 'Néon nocturne'), 20000),
    JSON.stringify(cartes()[0]?.realisation?.ambiance ?? null),
  );
  /* LE TABLEAU D'AMBIANCE NE VIT PLUS QUE DANS LE VOLET SUIVI (27/10/2026) : plus rien au bas du fil. */
  noter('le tableau d’ambiance ne se pose plus au bas du fil', (await page.locator('[data-tableau-ambiance]').count()) === 0);
  /* PLUS DE BOUTON « LANCER » : le directeur artistique guide toute la production dans la
     conversation ; l'utilisateur change d'étape par le bouton du bas (26/10/2026). */
  noter('pendant les questions : aucun bouton « Lancer la fabrication »', (await page.locator('[data-realisation-lancer]').count()) === 0);
  /* LES QUATRE ÉTAPES D'UN MÉDIA, LE BOUTON DU PASSAGE SUIVANT, JAMAIS « DÉPLOYER » (26/10/2026). */
  noter(
    'la barre montre les quatre étapes du média',
    (await page.locator('[data-barre-etapes] [data-segment]').evaluateAll((els) => els.map((e) => e.getAttribute('data-segment')).join(','))) === 'brief,esquisses,montage,telechargement',
  );
  noter(
    'le bouton de la rangée dit le passage suivant, allumé une fois le brief et le découpage écrits',
    await attendre(async () => (await page.locator('[data-barre-realisation][data-geste-possible="oui"] [data-geste-du-media="passer-esquisses"]').count()) === 1, 15000),
  );
  const reglagesDuMedia = await page.locator('[data-barre-realisation] [data-reglages-du-lancement] svg').first().boundingBox().catch(() => null);
  noter('l’icône des réglages, collée au bouton, a la taille des autres icônes (16 px)', !!reglagesDuMedia && reglagesDuMedia.width >= 15.5, JSON.stringify(reglagesDuMedia));
  noter('aucun « Déployer » sur une création de média', (await page.locator('[data-entete-de-zone]:has([data-titre-carte])').count()) >= 1 &&
      (await page.locator('[data-entete-de-zone]:has([data-titre-carte]) button:visible', { hasText: /Déployer|Mise en production/ }).count()) === 0 &&
      (await page.locator('[data-barre-realisation] button', { hasText: /Déployer/ }).count()) === 0 && (await page.locator('[data-geste="deployer-lot"]').count()) === 0);
  noter(
    'plus de bandeau : ni compteur, ni jauge, ni pause, ni caméra',
    (await page.locator('[data-realisation-avancement], [data-realisation-jauge], [data-realisation-pause], [data-realisation-reprendre], [data-realisation-eteindre], [data-realisation-etat]').count()) === 0,
  );
  /* « LIRE LE CAHIER DE RÉALISATION » A QUITTÉ LE FIL (25/10/2026) : il vit dans le PIED FIXE du
     volet « Suivi de la production », sur toute sa largeur, hors du défilement des étapes. */
  noter('« Lire le cahier de réalisation » n’est plus dans le fil', (await page.locator('[data-fil="parcours"] [data-lecture-du-cahier]').count()) === 0);
  /* Retour à l'ordinateur : le suivi, jamais fermé sur cette carte, se rouvre seul. */
  await page.setViewportSize({ width: 1400, height: 900 });
  await attendre(async () => (await page.locator('[data-volet-de-suivi]').count()) === 1, 10000);
  const suiviOuvertParLeControle = !(await page.locator('[data-volet-de-suivi]').count());
  if (suiviOuvertParLeControle) await page.locator('[data-basculer-le-suivi]').first().click().catch(() => undefined);
  await attendre(async () => (await page.locator('[data-volet-de-suivi] [data-lecture-du-cahier="realisation"]').count()) === 1, 10000);
  const piedDuSuivi = async (cible) =>
    cible.evaluate(() => {
      const volet = document.querySelector('[data-volet-de-suivi]');
      const bouton = volet?.querySelector('[data-lecture-du-cahier="realisation"] [data-realisation-lire]');
      if (!volet || !bouton) return null;
      const zone = volet.querySelector('[data-accordeon-du-suivi]')?.closest('[data-zone-defilement], .overflow-y-auto') ?? null;
      if (zone) zone.scrollTop = zone.scrollHeight;
      const v = volet.getBoundingClientRect();
      const b = bouton.getBoundingClientRect();
      return {
        pleineLargeur: b.width >= v.width - 40,
        enBas: Math.round(v.bottom - b.bottom) <= 24,
        visible: b.bottom <= window.innerHeight && b.top >= 0 && b.height > 0,
        horsDefilement: !zone || !zone.contains(bouton),
      };
    });
  const pied = await piedDuSuivi(page);
  noter(
    'le bouton est dans le pied fixe du suivi, sur toute sa largeur (#5f84), visible même après défilement',
    !!pied && pied.pleineLargeur && pied.enBas && pied.visible && pied.horsDefilement,
    JSON.stringify(pied),
  );

  /* -------- 4. Lire, pause, reprise, fin -------- */
  await page.locator('[data-realisation-lire]').click();
  noter(
    'le tiroir montre le document, rubriques à voir comprises',
    await attendre(async () => (await page.locator('[data-tiroir-realisation] [data-realisation-partie="a-voir"]').count()) >= 1, 15000),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  /* Le chemin du tournage ne se lit plus qu'en largeur de téléphone, à côté du suivi permanent. */
  await page.setViewportSize({ width: 390, height: 844 });
  await attendre(() => lignes('pont.log').some((l) => l.name === 'rendre_comprehension'), 15000);
  await page.waitForTimeout(1500);
  /* La pause n'a plus de bouton : une pause déjà posée (par le démon) rend la
     barre d'écriture, et c'est en écrivant qu'on reprend. */
  await commande({ type: 'card.realisationPause', id: carte.id });
  noter('la pause se pose', await attendre(() => !!cartes()[0]?.realisation?.enPauseA));
  noter('la carte reste dans « Planifié »', cartes()[0]?.column === 'planned', cartes()[0]?.column);
  noter(
    'en pause : la barre d’écriture revient pour reprendre en écrivant',
    await attendre(async () => (await page.locator('[data-composer] textarea:visible').count()) >= 1, 10000),
  );
  const avantReprise = demandesRecues().length;
  await commande({ type: 'card.realisationReprendre', id: carte.id });
  noter('la reprise renvoie le document', await attendre(() => demandesRecues().slice(avantReprise).some((d) => d.includes('REPRISE DU QUESTIONNAIRE') && d.includes('Vendre l’application')), 30000));
  noter('tout tranché : l’état est terminé', await attendre(() => !!cartes()[0]?.realisation?.termineA, 20000));
  noter('terminé : toujours aucun bouton « Lancer » — on change d’étape au bouton du bas', (await page.locator('[data-realisation-lancer]').count()) === 0);
  noter(
    'terminé : la barre d’écriture est revenue sous le bandeau, avec son bouton d’envoi',
    await attendre(async () => (await page.locator('[data-composer] textarea:visible').count()) >= 1, 10000),
  );
  noter(
    'terminé : le chemin reste au Brief tant que l’utilisateur n’a pas cliqué « Passer aux esquisses »',
    await attendre(async () => (await page.locator('[data-chemin-realisation][data-jalon="brief"] [data-etape-chemin="brief"][data-etat="encours"]').count()) === 1, 10000),
  );
  noter('terminé : la lecture du cahier n’est toujours pas dans le fil', (await page.locator('[data-fil="parcours"] [data-lecture-du-cahier]').count()) === 0);

  /* -------- 5. Éteindre, rallumer : le mode écrit sur la carte fait foi -------- */
  await commande({ type: 'card.realisation.souhaitee', cardId: carte.id, media: null });
  noter(
    'éteinte : la barre d’écriture revient',
    await attendre(async () => (await page.locator('[data-composer] textarea:visible').count()) >= 1, 10000),
  );
  noter('l’état n’est pas effacé', (cartes()[0]?.realisation?.medias ?? []).join() === 'video');
  await commande({ type: 'card.realisation.souhaitee', cardId: carte.id, media: 'video' });
  noter(
    'rallumée : la rangée du média revient où elle en était',
    await attendre(async () => (await page.locator('[data-barre-realisation] [data-geste-du-media="passer-esquisses"]').count()) === 1, 10000),
  );

  /* -------- 6. Téléphone, clair et sombre -------- */
  for (const schema of ['light', 'dark']) {
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block', colorScheme: schema, isMobile: true, hasTouch: true });
  /* La liste des étapes se replie comme celle des tâches (#9c15) : dépliée ici, pour lire ses lignes. */
  await tel.addInitScript(() => localStorage.setItem('beluga.volet-taches.deplie', '1'));
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const p = await tel.newPage();
    p.on('pageerror', (e) => erreurs.push(String(e)));
    await p.goto(`${BASE}/#carte=${carte.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.addStyleTag({ content: '[data-assistant-moteurs] { display: none !important; }' });
    const bandeau = p.locator('[data-chemin-realisation]:visible').first();
    let tient = await attendre(async () => (await bandeau.count()) === 1, 20000);
    if (!tient) {
      await p.locator(`[data-card-id="${carte.id}"], [data-carte="${carte.id}"]`).first().click().catch(() => {});
      tient = await attendre(async () => (await bandeau.count()) === 1, 15000);
    }
    const boite = tient ? await bandeau.boundingBox() : null;
    noter(`téléphone (${schema === 'dark' ? 'sombre' : 'clair'}) : le chemin du tournage tient dans la largeur de l’écran`, !!boite && boite.x >= 0 && boite.width <= 390, boite ? `${Math.round(boite.x)}+${Math.round(boite.width)}` : 'chemin absent');
    noter(`téléphone (${schema === 'dark' ? 'sombre' : 'clair'}) : aucun bouton « Lancer »`, (await p.locator('[data-realisation-lancer]').count()) === 0);
    /* UNE LISTE VERTICALE, PLUS AUCUNE FRISE (23/10/2026) : sept lignes l'une
       sous l'autre, tous les noms écrits, le relais SOUS l'étape où l'on est.
       LE PIED COMPACT NE LA REPLIE PLUS JAMAIS (décision du 25/10/2026,
       captures #1640 et #c92f) : les autres blocs se replient pour elle. */
    const replie = await p.evaluate(() => {
      const section = document.querySelector('[data-chemin-realisation]');
      return section?.querySelector('[data-deplier-bloc]') ? section.querySelectorAll('[data-etape-chemin]').length : null;
    });
    noter(`téléphone (${schema === 'dark' ? 'sombre' : 'clair'}) : le pied compact ne replie jamais le chemin du tournage`, replie === null, String(replie));
    const cheminTel = await p.evaluate(() => {
      const section = document.querySelector('[data-chemin-realisation]');
      const liste = section?.querySelector('ol');
      const ici = section?.querySelector('[data-etape-depliee]');
      const etapes = [...(liste?.querySelectorAll('[data-etape-chemin]') ?? [])];
      if (!section || !liste || !ici || !etapes.length) return null;
      const boites = etapes.map((e) => e.getBoundingClientRect());
      const cases = etapes.map((e) => e.querySelector('[data-case-de-tache]')?.getBoundingClientRect().left ?? -1);
      const nomIci = section.querySelector('[data-etape-depliee] [data-nom-etape]');
      return {
        etapes: etapes.length,
        vertical: boites.every((b, i) => i === 0 || b.top >= boites[i - 1].bottom - 1),
        casesAlignees: Math.max(...cases) - Math.min(...cases) <= 1,
        cochees: etapes.filter((e) => e.querySelector('[data-case-de-tache="done"]')).length,
        rail: !!section.querySelector('[data-rond-etape], [data-trait-chemin]'),
        deborde: liste.scrollWidth > liste.clientWidth + 1 || Math.max(...boites.map((b) => b.right)) > liste.getBoundingClientRect().right + 1,
        noms: [...liste.querySelectorAll('[data-nom-etape]')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => n.textContent),
        sansTexteSousLEtape: !!nomIci && !ici.querySelector('[data-relais-realisation], [data-chemin-suivant], [data-chemin-pret], [data-enveloppe-apercus], p'),
        hauteur: Math.round(section.getBoundingClientRect().height),
        violet: [...section.querySelectorAll('*')].some((e) => /\bteinte/.test(String(e.className?.baseVal ?? e.className ?? ''))),
        icone: !!ici.querySelector('[data-nom-etape] svg'),
      };
    });
    noter(
      `téléphone (${schema === 'dark' ? 'sombre' : 'clair'}) : le chemin est une liste de quatre étapes cochées comme des tâches, tous les noms écrits, aucun texte sous l’étape en cours, sans violet ni pictogramme`,
      !!cheminTel && cheminTel.etapes === 4 && cheminTel.vertical && cheminTel.casesAlignees && cheminTel.cochees === 0 && !cheminTel.rail && !cheminTel.deborde && cheminTel.noms.length === 4
        && cheminTel.sansTexteSousLEtape && cheminTel.hauteur <= 844 * 0.45 && !cheminTel.violet && !cheminTel.icone,
      JSON.stringify(cheminTel),
    );
    if (process.env.BELUGA_REALISATION_CAPTURE) await p.screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE.replace(/\.png$/, `-tel-${schema}.png`) });
    await tel.close();
  }
  if (process.env.BELUGA_REALISATION_CAPTURE) await page.screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE.replace(/\.png$/, '-volet.png') });

  /* -------- 7. « Passer aux esquisses » : le bouton du bas, jamais un lancement -------- */
  const avantPassage = demandesRecues().length;
  const comprehensionsAvant = lignes('pont.log').filter((l) => l.name === 'rendre_comprehension').length;
  noter(
    '« Passer aux esquisses » est allumé : le brief et le découpage sont écrits',
    await attendre(async () => (await page.locator('[data-barre-realisation][data-geste-possible="oui"] [data-geste-du-media="passer-esquisses"]').count()) === 1, 15000),
  );
  await page.locator('[data-barre-realisation] [data-geste-du-media="passer-esquisses"]').first().click();
  noter('le clic écrit le passage sur la carte', await attendre(() => !!cartes()[0]?.realisation?.esquissesA, 15000));
  /* LE DIRECTEUR EST RÉVEILLÉ UNE FOIS, pour proposer la première génération à prix
     (CONSIGNE_DU_PASSAGE) : un seul tour, au cadrage — jamais un lancement de la carte. */
  const reveil = await attendre(() => demandesRecues().slice(avantPassage).some((d) => d.includes('L’UTILISATEUR VIENT DE PASSER AUX ESQUISSES')), 15000);
  noter(
    'la carte reste dans « Planifié » : le directeur la garde, réveillé une seule fois pour proposer la première génération',
    reveil && cartes()[0]?.column === 'planned' && demandesRecues().length - avantPassage === 1,
    `${cartes()[0]?.column} · ${demandesRecues().length - avantPassage} demande(s)`,
  );
  const apresReveil = demandesRecues().length;
  noter('la barre du haut passe aux esquisses', await attendre(async () => (await page.locator('[data-barre-etapes="esquisses"]').count()) === 1, 10000));
  /* Le seul plan d'essai se fait au montage (aucun service branché ici) : rien à valider avant les séquences. */
  noter(
    'le bouton suivant dit le passage d’après : « Passer aux séquences vidéo »',
    await attendre(async () => (await page.locator('[data-barre-realisation] [data-geste-du-media="passer-sequences"]').count()) === 1, 10000),
  );
  await page.locator('[data-composer] textarea:visible').first().fill('On commence les images.');
  await page.locator('[data-composer-envoi]').first().click();
  noter(
    'le message suivant part au directeur, avec la consigne des esquisses',
    await attendre(() => demandesRecues().slice(apresReveil).some((d) => d.includes('On commence les images.') && d.includes('L’ÉTAPE EN COURS EST « ESQUISSES »')), 30000),
  );
  noter(
    '« monter » lui est refusé tant que l’utilisateur n’a pas cliqué « Passer au montage »',
    await attendre(() => lignes('pont.log').some((l) => l.name === 'realiser' && l.rendu?.ok === false && /Passer au montage/.test(l.rendu?.text ?? '')), 30000),
  );

  /* -------- 7 bis. Étapes et tâches en un seul bloc, procédures passées aux flèches -------- */
  noter('le tour du directeur se referme', await attendre(() => lignes('pont.log').filter((l) => l.name === 'rendre_comprehension').length > comprehensionsAvant, 40000));
  await page.waitForTimeout(2000);
  let totalProcedures = 3;
  {
    /* Deux tours passés qui s'étaient annoncé une liste de tâches. */
    const db = base();
    const dernier = db.prepare("SELECT agent_id, data, created_at FROM messages WHERE role = 'assistant' AND data LIKE '%Compris.%' ORDER BY created_at DESC").get();
    const modele = JSON.parse(dernier.data);
    /* Le dernier tour a-t-il sa propre liste ? Sans elle, les flèches ne
       comptent que les deux procédures passées, et la plus récente reste
       affichée par défaut (décision du 23/10/2026, capture #e509). */
    totalProcedures = modele.todos?.length ? 3 : 2;
    [['Préparer les plans', 'Écrire le scénario'], ['Fabriquer le plan 1', 'Monter la vidéo']].forEach((libelles, i) => {
      const id = `procedure-essai-${i}`;
      const at = dernier.created_at - (2 - i) * 60000;
      /* Des durées longues (« 1 h 12 min ») : elles doivent tenir DANS le cadre. */
      const todos = libelles.map((label) => ({ state: 'done', label, startedAt: at - 4400000, endedAt: at }));
      db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id, dernier.agent_id, 'assistant', JSON.stringify({ ...modele, id, createdAt: at, content: 'Tour passé.', todos, steps: [] }), at,
      );
    });
    db.close();
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await attendre(async () => (await page.locator('[data-volet="taches"] [data-ligne-du-temoin]').count()) === 1, 15000);
  /* UN SEUL PLI (23/10/2026) : la ligne d'état replie étapes ET tâches d'un clic, un second rouvre tout. */
  {
    const etat = () => page.evaluate(() => ({
      etapes: !!document.querySelector('[data-volet="taches"] [data-entete-du-repere] [data-etape-chemin]'),
      taches: !!document.querySelector('[data-volet="taches"] [data-liste-du-temoin]'),
      ligne: !!document.querySelector('[data-volet="taches"] [data-ligne-du-temoin]'),
    }));
    const statut = page.locator('[data-volet="taches"] [data-statut-du-temoin]');
    if ((await etat()).etapes) await statut.click();
    const replie = await etat();
    noter('replié, le repère ne garde que sa ligne d’état : ni étapes ni tâches', replie.ligne && !replie.etapes && !replie.taches, JSON.stringify(replie));
    await statut.click();
    const rouvert = await etat();
    noter('un clic sur la ligne d’état rouvre étapes et tâches ensemble', rouvert.etapes && rouvert.taches, JSON.stringify(rouvert));
    await statut.click();
    const rereplie = await etat();
    noter('un second clic replie les deux ensemble', !rereplie.etapes && !rereplie.taches, JSON.stringify(rereplie));
    await statut.click();
  }
  await attendre(async () => (await page.locator('[data-chemin-realisation]').count()) === 1, 15000);
  noter(
    'un seul bloc collé au champ : la barre d’étapes en tête du repère des tâches',
    await attendre(async () => (await page.locator('[data-volet="taches"] [data-entete-du-repere] [data-chemin-realisation][data-chemin-integre]').count()) === 1, 15000)
      && (await page.locator('[data-chemin-realisation]').count()) === 1,
  );
  /* PLUS AUCUNE FRISE (23/10/2026) : les quatre étapes du média l'une sous l'autre. */
  noter(
    'les étapes du repère forment une liste verticale de quatre lignes',
    await page.evaluate(() => {
      const etapes = [...document.querySelectorAll('[data-volet="taches"] [data-etape-chemin]')].map((e) => e.getBoundingClientRect());
      return etapes.length === 4 && etapes.every((b, i) => i === 0 || b.top >= etapes[i - 1].bottom - 1);
    }),
  );
  noter(
    'les flèches s’affichent à droite, sur la plus récente',
    await attendre(async () => (await page.locator(`[data-volet="taches"] [data-fleches-procedures="${totalProcedures}/${totalProcedures}"]`).count()) === 1, 10000)
      && (await page.locator('[data-volet="taches"][data-procedure-passee]').count()) === 0,
  );
  /* LES BRANCHES (23/10/2026) : chaque tâche reliée à la case de l'étape, coude chez la dernière, sans violet. */
  {
    if (totalProcedures === 2) {
      /* LE GROUPE NE DISPARAÎT PAS TOUT SEUL : le dernier tour n'a pas de liste, la précédente reste sous l'étape. */
      noter(
        'sans liste au dernier tour, la procédure précédente reste affichée sous l’étape',
        await attendre(async () => (await page.locator('[data-volet="taches"] [data-etape-depliee] [data-liste-du-temoin]').getByText('Fabriquer le plan 1').count()) === 1, 5000),
      );
    }
    const branches = await page.evaluate(() => {
      const ici = document.querySelector('[data-volet="taches"] [data-etape-depliee]');
      const caseEtape = ici?.querySelector(':scope > [data-case-de-tache]')?.getBoundingClientRect();
      const tronc = ici?.querySelector('[data-tronc-des-taches]')?.getBoundingClientRect();
      const lignes = [...(ici?.querySelectorAll('[data-taches-en-branches] > li') ?? [])];
      const genres = lignes.map((l) => l.querySelector('[data-branche-de-tache]')?.getAttribute('data-branche-de-tache'));
      const traits = [...(ici?.querySelectorAll('[data-branche-de-tache] > span') ?? [])].map((t) => t.getBoundingClientRect());
      const cases = lignes.map((l) => l.querySelector('[data-case-de-tache]')?.getBoundingClientRect());
      if (!caseEtape || !tronc || !lignes.length || !traits.length || cases.some((c) => !c)) return null;
      const milieu = caseEtape.left + caseEtape.width / 2;
      return {
        genres,
        troncSousLaCase: Math.abs(tronc.left + 0.5 - milieu) <= 1 && tronc.top >= caseEtape.bottom - 0.5 && tronc.top - caseEtape.bottom <= 3,
        axe: traits.every((t) => Math.abs(t.left + 0.5 - milieu) <= 1),
        enRetrait: cases.every((c) => c.left > caseEtape.right),
        jusquAuxCases: traits.filter((t) => t.width > 2).every((t, i) => Math.abs(t.right - (cases[i].left - 2)) <= 1),
        violet: [...ici.querySelectorAll('[data-branche-de-tache] *, [data-tronc-des-taches]')].some((e) => /\bteinte/.test(String(e.className ?? ''))),
      };
    });
    noter(
      'les tâches sous l’étape sont en retrait, reliées à sa case par des branches, coude chez la dernière',
      !!branches && branches.genres.at(-1) === 'dernier' && branches.genres.slice(0, -1).every((g) => g === 'milieu')
        && branches.troncSousLaCase && branches.axe && branches.enRetrait && branches.jusquAuxCases && !branches.violet,
      JSON.stringify(branches),
    );
    if (process.env.BELUGA_REALISATION_CAPTURE) await page.locator('[data-volet="taches"]').screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE.replace(/\.png$/, '-branches.png') });
  }
  noter('ordinateur : la durée des tâches reste dans le cadre', await dureesDansLeCadre(page), JSON.stringify(await dureesDansLeCadre(page, true)));
  noter(
    'les flèches sont posées dans la moitié droite du repère',
    await page.evaluate(() => {
      const volet = document.querySelector('[data-volet="taches"]')?.getBoundingClientRect();
      const f = document.querySelector('[data-volet="taches"] [data-fleches-procedures]')?.getBoundingClientRect();
      return !!volet && !!f && f.left > volet.left + volet.width / 2;
    }),
  );
  await page.locator('[data-procedure-precedente]').click();
  noter(
    'la ligne du témoin reste en tête du bloc, au-dessus des étapes, et la liste se range sous l’étape où l’on est',
    await attendre(async () => page.evaluate(() => {
      const volet = document.querySelector('[data-volet="taches"]');
      const ligne = volet?.querySelector(':scope > [data-ligne-du-temoin]');
      const etapes = volet?.querySelector(':scope > [data-entete-du-repere]');
      return !!ligne && !!etapes && ligne.getBoundingClientRect().bottom <= etapes.getBoundingClientRect().top + 1
        && !etapes.querySelector('[data-ligne-du-temoin]')
        && !!volet.querySelector('[data-etape-depliee] [data-taches-de-l-etape] [data-liste-du-temoin]');
    }), 5000),
  );
  noter(
    'la flèche gauche montre la procédure précédente, liste dépliée',
    await attendre(async () => (await page.locator(`[data-volet="taches"][data-procedure-passee] [data-fleches-procedures="${totalProcedures - 1}/${totalProcedures}"]`).count()) === 1, 5000)
      && (await page.locator('[data-volet="taches"] [data-etape-depliee] [data-liste-du-temoin]').getByText(totalProcedures === 3 ? 'Fabriquer le plan 1' : 'Préparer les plans').count()) === 1,
  );
  noter(
    'dans la ligne, le statut ouvre à gauche et les flèches précèdent le chevron, tout à droite',
    await page.evaluate(() => {
      const ligne = document.querySelector('[data-volet="taches"] [data-ligne-du-temoin]');
      const f = ligne?.querySelector('[data-fleches-procedures]')?.getBoundingClientRect();
      const c = ligne?.querySelector('[data-chevron-du-temoin]')?.getBoundingClientRect();
      const statut = ligne?.querySelector('button[aria-expanded]:not([data-chevron-du-temoin])')?.getBoundingClientRect();
      return !!f && !!c && !!statut && statut.left < f.left && f.right <= c.left + 1 && ligne.lastElementChild?.hasAttribute('data-chevron-du-temoin');
    }),
  );
  if (totalProcedures === 3) await page.locator('[data-procedure-precedente]').click();
  noter('puis la plus ancienne', await attendre(async () => (await page.locator('[data-volet="taches"]').getByText('Écrire le scénario').count()) === 1, 5000));
  for (let i = 1; i < totalProcedures; i++) await page.locator('[data-procedure-suivante]').click();
  noter(
    'la flèche droite revient à la dernière',
    await attendre(async () => (await page.locator(`[data-volet="taches"] [data-fleches-procedures="${totalProcedures}/${totalProcedures}"]`).count()) === 1, 5000)
      && (await page.locator('[data-volet="taches"][data-procedure-passee]').count()) === 0,
  );
  {
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-CH', serviceWorkers: 'block', isMobile: true, hasTouch: true });
  /* La liste des étapes se replie comme celle des tâches (#9c15) : dépliée ici, pour lire ses lignes. */
  await tel.addInitScript(() => localStorage.setItem('beluga.volet-taches.deplie', '1'));
    await tel.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    const p = await tel.newPage();
    await p.goto(`${BASE}/#carte=${carte.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await attendre(async () => (await p.locator('[data-volet="taches"] [data-ligne-du-temoin]').count()) === 1, 15000);
    /* Navigateur neuf : replié d'office, on déplie. */
    if ((await p.locator('[data-volet="taches"] [data-chemin-realisation]').count()) === 0) await p.locator('[data-volet="taches"] [data-chevron-du-temoin]').click();
    await attendre(async () => (await p.locator('[data-volet="taches"] [data-chemin-realisation]').count()) === 1, 15000);
    noter('téléphone : la durée des tâches reste dans le cadre', await dureesDansLeCadre(p), JSON.stringify(await dureesDansLeCadre(p, true)));
    const bloc = await p.evaluate(() => {
      const volet = document.querySelector('[data-volet="taches"]');
      const champ = document.querySelector('[data-champ-d-ecriture]');
      const r = volet?.getBoundingClientRect();
      return volet && champ ? { colle: Math.abs(r.bottom - 12 - champ.getBoundingClientRect().top) <= 2, largeur: r.width, ecran: window.innerWidth } : null;
    });
    noter('téléphone : le bloc reste collé au champ et tient dans l’écran', !!bloc && bloc.colle && bloc.largeur <= bloc.ecran, JSON.stringify(bloc));
    /* Remonter lire replie le relais de l'étape en cours, comme avant. */
    await p.evaluate(() => {
      const zone = document.querySelector('[data-fil="parcours"]')?.closest('[data-zone-defilement], .overflow-y-auto') ?? null;
      zone?.scrollTo?.({ top: 0 });
    });
    if (process.env.BELUGA_REALISATION_CAPTURE) await p.screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE.replace(/\.png$/, '-bloc-tel.png') });
    await tel.close();
  }
  if (process.env.BELUGA_REALISATION_CAPTURE) await page.screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE.replace(/\.png$/, '-bloc.png') });

  /* -------- 7 ter. Placer une image dans un plan (28/10/2026) --------
     « Valider » ouvre la liste des plans, le choix valide l'image DANS ce plan ;
     à la souris, une image du fil se glisse vers une case d'image, et une case
     pleine glissée vers une autre échange les deux images. Le découpage passe
     ici à deux plans d'image : le plan d'essai ne se faisait qu'au montage. */
  {
    const db = base();
    const maintenant = Date.now();
    const plan1 = db.prepare("SELECT * FROM production_elements WHERE card_id = ? AND genre = 'plan' ORDER BY version DESC").get(carte.id);
    db.prepare('UPDATE production_elements SET contenu = ? WHERE card_id = ? AND cle = ?').run('La plage au réveil.\nDurée : 4 s\nCapacité : image', carte.id, plan1.cle);
    db.prepare(
      `INSERT INTO production_elements (id, project_id, card_id, genre, cle, version, titre, contenu, etat, parent, cree_le) VALUES ('plan-2-essai', ?, ?, 'plan', 'plan-2', 1, 'Plan 2', ?, ?, NULL, ?)`,
    ).run(PROJET_ID, carte.id, 'Le café du matin.\nDurée : 3 s\nCapacité : image', plan1.etat, maintenant);
    const pieces = ['apercu-neon.png', 'apercu-pastel.png'].map((nom) => db.prepare("SELECT id FROM attachments WHERE json_extract(data, '$.name') = ? ORDER BY created_at DESC").get(nom)?.id);
    [['media-place-a', pieces[0]], ['media-place-b', pieces[1]]].forEach(([id, piece], i) => {
      db.prepare(
        `INSERT INTO medias_realisation (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, raison, prix, source_prix, etat, attachment_id, cree_le, modifie_le)
         VALUES (?, ?, ?, NULL, 'tache/essai', 'Plan 1', ?, 'image', 'image', 'fal', 'fal-ai/flux/schnell', 'FLUX Schnell', '{"consigne":"x","format":"16:9"}', 'essai', 0.003, 'api-fal', 'fini', ?, ?, ?)`,
      ).run(id, PROJET_ID, carte.id, i + 1, piece, maintenant + i, maintenant + i);
      db.prepare(
        `INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES (?, ?, ?, NULL, ?, 'image', 'plan 1', ?, 'Plan 1', 'FLUX Schnell · fal', '', ?)`,
      ).run(crypto.randomUUID(), PROJET_ID, carte.id, piece, i + 1, maintenant + i);
    });
    db.close();
    const media = (id) => {
      const d = base(true);
      const l = d.prepare('SELECT retenu_le, plan_place FROM medias_realisation WHERE id = ?').get(id);
      d.close();
      return l;
    };
    await page.setViewportSize({ width: 1400, height: 900 });
    /* Relire la production écrite en base ; la carte se rouvre depuis le tableau si le rechargement l'a refermée. */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ecarterLAssistant();
    if (!(await attendre(async () => (await page.locator('[data-basculer-le-suivi]').count()) === 1, 8000))) {
      await page.locator(`[data-card-id="${carte.id}"], [data-carte="${carte.id}"]`).first().click().catch(() => {});
      await attendre(async () => (await page.locator('[data-basculer-le-suivi]').count()) === 1, 20000);
    }
    if ((await page.locator('[data-volet-de-suivi]').count()) === 0) await page.locator('[data-basculer-le-suivi]').click();
    noter(
      'le suivi montre une case d’image par plan',
      await attendre(async () => (await page.locator('[data-volet-de-suivi] [data-case-du-plan][data-genre-accepte="image"]').count()) === 2, 20000),
    );
    const menuA = page.locator(`[data-media-livre="${pieces[0]}"] [data-menu-actions]`).first();
    await menuA.waitFor({ timeout: 20000 }).catch(() => undefined);
    await menuA.scrollIntoViewIfNeeded().catch(() => undefined);
    await menuA.click();
    await page.locator('[data-media-retenir-par-plan]').click();
    noter(
      '« Valider » ouvre la liste des plans, le plan prévu par l’agent marqué',
      await attendre(async () => (await page.locator('[data-menu-des-plans] [data-placer-dans-le-plan]').count()) === 2, 5000)
        && (await page.locator('[data-placer-dans-le-plan="plan-1"][data-plan-prevu]').count()) === 1,
    );
    await page.locator('[data-placer-dans-le-plan="plan-2"]').click();
    noter('le choix valide l’image DANS ce plan', await attendre(() => !!media('media-place-a')?.retenu_le && media('media-place-a')?.plan_place === 'plan-2', 8000), JSON.stringify(media('media-place-a')));
    const dansLaCase = (cle, piece) =>
      page.evaluate(([c, p]) => (document.querySelector(`[data-volet-de-suivi] [data-case-du-plan="${c}"][data-genre-accepte="image"]`)?.innerHTML ?? '').includes(p), [cle, piece]);
    noter('l’image paraît dans la case du plan 2', await attendre(() => dansLaCase('plan-2', pieces[0]), 8000));
    /* Les images d'essai font un point de côté : sans leur taille réelle, le menu « … » posé dessus couvrirait toute la vignette. */
    await page.addStyleTag({ content: '[data-media-livre-ouvrir] img { width: 240px !important; height: 135px !important; }' });
    /* Glisser à la souris : par petits pas, comme une vraie main. */
    const glisser = async (source, cible) => {
      await source.scrollIntoViewIfNeeded().catch(() => undefined);
      const a = await source.boundingBox();
      const b = await cible.boundingBox();
      if (!a || !b) return false;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 6, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
      const survol = await cible.getAttribute('data-case-etat');
      await page.mouse.up();
      return survol;
    };
    const caseImage = (cle) => page.locator(`[data-volet-de-suivi] [data-case-du-plan="${cle}"][data-genre-accepte="image"]`);
    const survol = await glisser(page.locator(`[data-media-livre-ouvrir="${pieces[1]}"]`).first(), caseImage('plan-1'));
    noter('la case survolée par l’image le montre', survol === 'survolee', String(survol));
    noter('une image du fil glissée vers le plan 1 y est validée', await attendre(() => media('media-place-b')?.plan_place === 'plan-1' && !!media('media-place-b')?.retenu_le, 8000), JSON.stringify(media('media-place-b')));
    noter('le glisser n’ouvre pas l’image en grand', (await page.locator('[data-visionneuse]').count()) === 0);
    await attendre(() => dansLaCase('plan-1', pieces[1]), 8000);
    await glisser(caseImage('plan-2').locator('[data-glissable-vers-un-plan]').first(), caseImage('plan-1'));
    noter(
      'une case pleine glissée vers une autre échange les deux images',
      await attendre(() => media('media-place-a')?.plan_place === 'plan-1' && media('media-place-b')?.plan_place === 'plan-2', 8000),
      JSON.stringify([media('media-place-a'), media('media-place-b')]),
    );
    noter('le suivi suit l’échange', await attendre(async () => (await dansLaCase('plan-1', pieces[0])) && (await dansLaCase('plan-2', pieces[1])), 8000));
    if (process.env.BELUGA_REALISATION_CAPTURE) await page.screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE.replace(/\.png$/, '-placement.png') });
  }

  /* -------- 8. La page « Médias » -------- */
  {
    const db = base();
    const maintenant = Date.now();
    db.prepare(
      `INSERT INTO medias_realisation (id, project_id, card_id, agent_id, branche, plan, version, capacite, genre, service, modele, modele_nom, demande, raison, prix, source_prix, etat, cree_le, modifie_le)
       VALUES ('media-essai', ?, ?, NULL, 'tache/essai', 'Plan 1', 1, 'image', 'image', 'fal', 'fal-ai/flux/schnell', 'FLUX Schnell', '{"consigne":"x","format":"16:9"}', 'essai', 0.003, 'api-fal', 'fini', ?, ?)`,
    ).run(PROJET_ID, carte.id, maintenant, maintenant);
    db.close();
  }
  /* Les médias d'un projet se lisent dans le lieu Médias de sa marque (Communication) : le lien « #medias/<projet> » y mène. */
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${BASE}/#medias/${PROJET_ID}`, { waitUntil: 'domcontentloaded' });
  noter(
    'la marque du projet liste ses médias',
    await attendre(async () => (await page.locator('[data-communication-tableau="medias"] [data-communication-ligne]').count()) >= 1, 15000),
  );
  noter('le filtre « Vidéos » trie la liste', await (async () => {
    await page.locator('[data-communication-segment="genre-medias"] button', { hasText: 'Vidéos' }).click();
    return attendre(async () => (await page.locator('[data-communication-medias-vide], [data-communication-tableau="medias"]').count()) >= 1, 10000);
  })());
  if (process.env.BELUGA_REALISATION_CAPTURE) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: process.env.BELUGA_REALISATION_CAPTURE });
  }

  noter('aucune erreur dans la page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passées.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  console.error(journal.join('').slice(-3000));
  process.exit(1);
});
