#!/usr/bin/env node
/**
 * LA QUESTION COMPACTE DU TÉLÉPHONE ET LA CARTE DE CONSTRUCTION D'UN CAHIER.
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-question-compacte-et-construction.mjs
 *
 * Le script monte son PROPRE démon (`demarrerDemonDEssai`, port
 * `HAIKO_QUESTION_COMPACTE_PORT`, jamais `BELUGA_URL`), base neuve, aucun moteur.
 *
 * Demande du 22/10/2026 :
 *   A. sur téléphone (390 × 844), une question en attente se réduit à son
 *      intitulé et à « Répondre » ; le bouton ouvre une feuille du bas avec la
 *      question entière, ses choix et le champ ; la réponse envoyée referme la
 *      feuille ;
 *   B. sur ordinateur (1280 px), la question reste entière, sans feuille ;
 *   C. le pied ne se replie pas sans besoin : déroulé du cahier et question
 *      compacte tiennent ensemble, le déroulé reste déplié ;
 *   D. la carte de construction née d'un cahier (`suiteDuCahier`) porte
 *      « Lancer », sans « Lancer et valider » ni « Auto » ; le clic ouvre les
 *      réglages de l'agent avec « Valider la configuration et lancer », et la
 *      carte ne part pas tant que ce bouton n'est pas pressé.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_QUESTION_COMPACTE_PORT || 7241);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-question-compacte';
const AVEC_QUESTION = crypto.randomUUID();
const AGENT = crypto.randomUUID();
const CONSTRUCTION = crypto.randomUUID();
const CAPTURES = '/tmp/verif-question-compacte';
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-question-compacte-',
  port: PORT,
  depot: false,
  signaux: true,
});
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');

function poserLeDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(sha(JETON), t, t + 3600_000, 'vérification de la question compacte');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  const dossier = path.join(PROJETS, PROJET);
  fs.mkdirSync(path.join(dossier, 'docs'), { recursive: true });
  /* Le cahier terminé : le rattrapage du démarrage le joint à la carte de construction. */
  fs.writeFileSync(path.join(dossier, 'docs', 'cahier-des-charges.md'), '# Cahier des charges\n\n## Vision\nUn atelier compact.\n');
  const projet = { id: PROJET, name: 'Atelier Compact', path: dossier, defaultEngine: 'claude', isSelf: false, branchesDePublication: {}, rank: 1000, archived: false, createdAt: t, updatedAt: t };
  db.prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').run(PROJET, projet.name, dossier, JSON.stringify(projet), t, t);
  const briefing = 'Le cahier des charges du projet « Atelier Compact » est terminé. Construis maintenant l’application, d’après lui.';
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description)
     VALUES (?, ?, 'planned', 2, ?, ?, ?, ?, ?)`,
  ).run(
    CONSTRUCTION,
    PROJET,
    'Construction de « Atelier Compact »',
    JSON.stringify({ briefing, suiteDuCahier: { cahierId: 'cahier-archive' }, run: { engine: 'claude', thinking: 'none', mode: 'direct' } }),
    t,
    t,
    'Construire l’application à partir de son cahier des charges.',
  );
  db.close();
}

/* Un agent arrêté sur sa question, reposé juste avant chaque mesure : la veille
   des tours bloqués le refermerait sinon. La carte est un cahier en cours, pour
   que son déroulé soit collé dans le pied avec la question. */
function reposerLaQuestion() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  const donnees = { cahierDesCharges: { faites: 3, total: 20, phase: 'interfaces', restants: ['Paiement'], majA: t } };
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', 1, 'Cahier avec question', ?, ?, ?, 'Carte posée par un contrôle automatique.', ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, agent_id = excluded.agent_id`,
  ).run(AVEC_QUESTION, PROJET, JSON.stringify(donnees), t, t, AGENT);
  const fiche = { id: AGENT, projectId: PROJET, cardId: AVEC_QUESTION, role: 'cadrage', title: 'Cahier avec question', run: { engine: 'claude', thinking: 'none', mode: 'direct' }, status: 'running', startedAt: t, tourVivantDepuis: t, createdAt: t, updatedAt: t };
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(AGENT, PROJET, AVEC_QUESTION, 'cadrage', 'running', JSON.stringify(fiche), t, t);
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(AGENT);
  const message = (role, content, questions, at) => {
    const m = { id: crypto.randomUUID(), agentId: AGENT, role, content, steps: [], todos: [], proposals: [], questions, downloads: [], attachments: [], streaming: false, createdAt: at };
    db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, AGENT, role, JSON.stringify(m), at);
  };
  message('user', 'Carte d’essai : ne rien exécuter.', [], t - 2000);
  message(
    'assistant',
    '',
    [
      {
        id: 'q-compacte',
        question: 'Quel moyen de paiement ?',
        description: 'Le choix décide des écrans de paiement à prévoir et des frais par transaction.',
        kind: 'single',
        options: [{ id: 'a', label: 'Carte' }, { id: 'b', label: 'Virement' }],
        allowFreeText: true,
        answerAttachments: [],
        cancelled: false,
      },
    ],
    t - 1000,
  );
  db.close();
}

async function ouvrir(navigateur, largeur, hauteur) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: JETON, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  return { contexte, page, erreurs };
}
const attendre = async (page, condition, limite = 10000) => {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await condition()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};
const visibles = (page, selecteur) => page.locator(`${selecteur}:visible`).count();

async function questionSurTelephone(navigateur) {
  reposerLaQuestion();
  const { contexte, page, erreurs } = await ouvrir(navigateur, 390, 844);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${AVEC_QUESTION}`, { waitUntil: 'domcontentloaded' });
  const compacte = await attendre(page, async () => (await visibles(page, '[data-question-compacte]')) > 0, 30000);
  await page.screenshot({ path: `${CAPTURES}/telephone-question.png` });
  noter('A. téléphone : la question se réduit à un encadré compact', compacte);
  const intitule = await page.locator('[data-question-compacte] [data-intitule-question]').first().textContent().catch(() => '');
  noter('A. téléphone : l’encadré porte l’intitulé', /moyen de paiement/.test(intitule ?? ''), String(intitule));
  noter(
    'A. téléphone : ni choix ni précision dans l’encadré',
    (await visibles(page, '[data-question-compacte] [data-zone-choix-question]')) === 0 &&
      (await visibles(page, '[data-question-compacte] [data-description-question]')) === 0,
  );

  /* C. Le déroulé et la question compacte tiennent ensemble : rien à replier. */
  const deroule = await page.evaluate(() => {
    const bloc = document.querySelector('[data-bloc-du-pied="chemin"]');
    return { present: !!bloc, replie: bloc?.hasAttribute('data-bloc-replie') ?? null };
  });
  noter('C. téléphone : le déroulé reste déplié quand la place suffit', deroule.present && deroule.replie === false, JSON.stringify(deroule));

  await page.locator('[data-question-compacte] [data-repondre-question]').first().click();
  const feuille = await attendre(page, async () => (await visibles(page, '[data-feuille-question] [data-zone-choix-question]')) > 0);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${CAPTURES}/telephone-feuille.png` });
  noter('A. téléphone : « Répondre » ouvre la feuille avec les choix', feuille);
  noter('A. téléphone : la feuille porte la précision', (await visibles(page, '[data-feuille-question] [data-description-question]')) > 0);
  await page.locator('[data-feuille-question] [data-option-question="a"]').first().click();
  await page.locator('[data-feuille-question] [data-repondre-question]').first().click();
  const refermee = await attendre(page, async () => (await visibles(page, '[data-feuille-question]')) === 0, 15000);
  const toasts = await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts().catch(() => []);
  await page.screenshot({ path: `${CAPTURES}/telephone-apres-reponse.png` });
  noter('A. téléphone : la réponse envoyée referme la feuille', refermee, refermee ? '' : toasts.join(' | '));
  noter('A. téléphone : aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

async function questionSurOrdinateur(navigateur) {
  reposerLaQuestion();
  const { contexte, page, erreurs } = await ouvrir(navigateur, 1280, 800);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${AVEC_QUESTION}`, { waitUntil: 'domcontentloaded' });
  const entiere = await attendre(page, async () => (await visibles(page, '[data-bulle-question] [data-zone-choix-question]')) > 0, 30000);
  noter('B. ordinateur : la question reste entière, choix compris', entiere);
  noter('B. ordinateur : aucun encadré compact', (await visibles(page, '[data-question-compacte]')) === 0);
  noter('B. ordinateur : aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

async function carteDeConstruction(navigateur) {
  for (const [nom, largeur, hauteur] of [['téléphone', 390, 844], ['ordinateur', 1280, 800]]) {
    const { contexte, page, erreurs } = await ouvrir(navigateur, largeur, hauteur);
    await page.goto(`${BASE}/#projet/${PROJET}/tache/${CONSTRUCTION}`, { waitUntil: 'domcontentloaded' });
    const demandeFaite = await attendre(page, async () => (await page.locator('[data-point="demande"][data-point-etat="fait"]').count()) > 0, 30000);
    noter(`D. ${nom} : le point « Demande » est fait, il ne tourne plus`, demandeFaite, String(await page.locator('[data-point="demande"]').first().getAttribute('data-point-etat').catch(() => null)));
    const lancer = page.locator('[data-geste-principal="lancer"]:visible').first();
    const pret = await attendre(page, async () => (await lancer.count()) > 0, 30000);
    noter(`D. ${nom} : la carte de construction porte « Lancer »`, pret);
    noter(
      `D. ${nom} : pas de « Lancer et valider » (« Auto » a quitté l’écran le 13/11/2026)`,
      (await visibles(page, '[data-geste-principal="valider-et-lancer"]')) === 0,
    );
    if (pret) await lancer.click();
    const feuille = await attendre(page, async () => (await visibles(page, `[data-validation-configuration="${CONSTRUCTION}"]`)) > 0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${CAPTURES}/${nom === 'téléphone' ? 'telephone' : nom}-validation.png` });
    noter(`D. ${nom} : « Lancer » ouvre les réglages de l’agent`, feuille && (await visibles(page, '[data-carte-configuration] [data-ligne-configuration]')) >= 3);
    noter(`D. ${nom} : avec « Valider la configuration et lancer »`, (await visibles(page, '[data-valider-configuration]')) === 1);
    await page.waitForTimeout(800);
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const ligne = db.prepare('SELECT column_key, agent_id FROM cards WHERE id = ?').get(CONSTRUCTION);
    const agents = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE card_id = ?').get(CONSTRUCTION).n;
    db.close();
    noter(`D. ${nom} : rien ne part avant la validation`, ligne.column_key === 'planned' && !ligne.agent_id && agents === 0, JSON.stringify({ ...ligne, agents }));
    noter(`D. ${nom} : aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await contexte.close();
  }
  /* La carte posée SANS demande (comme avant la règle) l'a reçue à son ouverture : un jalon, le cahier joint. */
  {
    const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
    const jalons = db
      .prepare("SELECT agent_id, resultat, donnees FROM card_journal WHERE card_id = ? AND nature = 'jalon' AND libelle = 'Demande'")
      .all(CONSTRUCTION);
    const pieces = JSON.parse(jalons[0]?.donnees ?? '{}').pieces ?? [];
    const piece = pieces[0] ? db.prepare('SELECT data FROM attachments WHERE id = ?').get(pieces[0]) : undefined;
    db.close();
    noter('D. la carte de construction a UNE demande écrite, sans agent', jalons.length === 1 && !jalons[0].agent_id, JSON.stringify(jalons.length));
    noter('D. avec le cahier des charges en pièce jointe', /Cahier des charges — Atelier Compact\.md/.test(piece?.data ?? ''), piece?.data?.slice(0, 120));
  }
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await questionSurTelephone(navigateur);
    await questionSurOrdinateur(navigateur);
    await carteDeConstruction(navigateur);
  } finally {
    await navigateur.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    resultats.push({ nom: 'exécution', ok: false });
  })
  .finally(() => {
    nettoyer();
    const echecs = resultats.filter((r) => !r.ok).length;
    console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis.`);
    process.exit(echecs ? 1 : 0);
  });
