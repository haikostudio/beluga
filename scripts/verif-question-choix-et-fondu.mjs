#!/usr/bin/env node
/**
 * LA QUESTION À BEAUCOUP DE CHOIX, DANS UN VRAI NAVIGATEUR (demande du 28/10/2026).
 *
 *   npm run build && env -u BELUGA_TOKEN node scripts/verif-question-choix-et-fondu.mjs
 *
 * Sur son PROPRE démon (`demarrerDemonDEssai`, port `HAIKO_QUESTION_CHOIX_PORT`,
 * jamais `BELUGA_URL`), une question à sept choix posée dans le panneau
 * « Une décision attend » :
 *   1. la barre « Répondre / Joindre / Annuler » collée touche le VRAI bas de
 *      la zone (le retrait intérieur de la zone est compensé), rien ne paraît
 *      sous elle (`elementsFromPoint`), et le fondu du bas s'éteint tant
 *      qu'elle est collée — jamais de dégradé sur les boutons (#2e5f, #d4b1) ;
 *   2. le choix retenu est encadré de jaune, sur un fond légèrement jaune (#4088) ;
 *   3. en clair, la liste des tâches est plus légère et la barre des messages
 *      en attente sur un fond gris plein, sans dégradé violet (#42b7) ;
 *   4. une barre simplement posée à sa place n'est pas « collée » : le fondu
 *      reste allumé au bord bas de la zone, et ne remonte jamais (#a30e) ;
 *   5. LES BOUTONS DE LA BARRE SONT TOUJOURS AU-DESSUS DU VOILE (#4b4c,
 *      29/10/2026) : la zone défile de haut en bas par pas de 4 px, et à
 *      CHAQUE pas `document.elementsFromPoint` au centre de chaque bouton de
 *      la barre (« Répondre », « Joindre », « Annuler »…) rend le bouton AVANT
 *      tout `[data-voile-defilement]` — en clair et en sombre, à 1280 × 800 et
 *      à 390 × 844, avec une puis deux questions empilées. Seule cette preuve
 *      compte : un ancêtre qui crée un contexte d'empilement annulerait le
 *      z-index sans que les classes le disent.
 *   6. DANS LA FEUILLE DU BAS, LE FONDU S'ARRÊTE AU CADRE JAUNE (#f1c2, #4fee,
 *      30/10/2026) : à 390 × 844, en clair et en sombre, la bande du voile haut
 *      (celui du bas s'éteint sous la barre collée, #d4b1) (ombre ET flou) tient entre les bords INTÉRIEURS du cadre ±1 px ;
 *      `elementsFromPoint` sur la bordure jaune et au bord de l'écran, à la
 *      hauteur du voile, ne rend aucun voile allumé ; l'ombre prend le fond du
 *      cadre ; le champ « Ou votre propre réponse » se détache du cadre
 *      (écart de clarté ≥ 4,5 points).
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { demarrerDemonDEssai, RACINE } from './lib/demon-d-essai.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const PORT = Number(process.env.HAIKO_QUESTION_CHOIX_PORT || 7245);
const BASE = `http://127.0.0.1:${PORT}`;
const PROJET = 'p-question-compacte';
const AVEC_QUESTION = crypto.randomUUID();
const AGENT = crypto.randomUUID();
const CONSTRUCTION = crypto.randomUUID();
const CAPTURES = '/tmp/verif-question-choix';
fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-question-choix-',
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
function reposerLaQuestion(deux = false) {
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
        options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({ id, label: `Choix ${id.toUpperCase()}`, description: `Une précision assez longue pour que le choix ${i + 1} prenne deux lignes et que la question déborde de son panneau, comme sur la capture.` })),
        allowFreeText: true,
        answerAttachments: [],
        cancelled: false,
      },
      ...(deux
        ? [
            {
              id: 'q-seconde',
              question: 'Quelle couleur pour les encadrés ?',
              description: 'Une seconde question empilée sous la première.',
              kind: 'single',
              options: ['h', 'i', 'j', 'k'].map((id) => ({ id, label: `Teinte ${id.toUpperCase()}`, description: 'Une précision qui prend de la place, pour que la seconde question déborde aussi.' })),
              allowFreeText: true,
              answerAttachments: [],
              cancelled: false,
            },
          ]
        : []),
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


/* 1. L'OMBRE DU BAS NE SE POSE JAMAIS SUR LES BOUTONS (#2e5f) ; LA BARRE COLLÉE TOUCHE LE VRAI BAS DE LA ZONE, RIEN NE
      PARAÎT SOUS ELLE, ET LE FONDU S'ÉTEINT TANT QU'ELLE EST COLLÉE (#d4b1, 04/11/2026).
   2. LE CHOIX RETENU EST ENCADRÉ DE JAUNE SUR UN FOND LÉGÈREMENT JAUNE (#4088).
   3. EN CLAIR, LA LISTE DES TÂCHES EST PLUS LÉGÈRE ET L'ATTENTE EST UN GRIS PLEIN (#42b7). */
async function choixEtFondu(navigateur) {
  reposerLaQuestion();
  const { contexte, page, erreurs } = await ouvrir(navigateur, 1280, 800);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${AVEC_QUESTION}`, { waitUntil: 'domcontentloaded' });
  const prete = await attendre(page, async () => (await visibles(page, '[data-option-question="a"]')) > 0, 30000);
  noter('la question à sept choix s’affiche', prete);
  const option = page.locator('[data-option-question="b"]:visible').first();
  await option.click();
  await page.waitForTimeout(400);
  const style = await option.evaluate((el) => {
    const s = getComputedStyle(el);
    return { ombre: s.boxShadow, fond: s.backgroundColor, cadre: getComputedStyle(document.documentElement).getPropertyValue('--cadre-question').trim() };
  });
  const jaune = (texte) => /rgba?\((2[0-5]\d|1[89]\d), (1[5-9]\d|2[0-4]\d), ([0-9]{1,2}|1[0-2]\d)/.test(texte);
  noter('le choix retenu porte un cadre jaune', jaune(style.ombre), style.ombre);
  noter('le choix retenu porte un fond légèrement jaune', jaune(style.fond) && /rgba\(/.test(style.fond), style.fond);
  // Le fondu du bas de la zone qui défile, juste au-dessus de la barre « Répondre ».
  const mesure = await page.evaluate(() => {
    const barres = [...document.querySelectorAll('[data-actions-question]')].filter((b) => b.getBoundingClientRect().height > 0);
    const barre = barres[barres.length - 1];
    let zone = barre?.parentElement;
    while (zone && !zone.parentElement?.querySelector(':scope > [data-voile-defilement="vertical-fin"]')) zone = zone.parentElement;
    const voile = zone?.parentElement?.querySelector(':scope > [data-voile-defilement="vertical-fin"]');
    if (!barre || !voile) return null;
    const cadre = barre.getBoundingClientRect();
    const basZone = zone.getBoundingClientRect().bottom;
    /* CE QUI SE VOIT ENTRE LA BARRE ET LE BAS DE LA ZONE (#d4b1) : à chaque pixel sous le haut de la barre, le premier
       élément rendu (hors voile) doit être la barre ou l'un de ses enfants — jamais le texte de la question. */
    const x = Math.round(cadre.left + cadre.width * 0.75);
    const intrus = [];
    for (let y = Math.ceil(cadre.top) + 1; y < basZone - 0.5; y += 1) {
      const premier = document.elementsFromPoint(x, y).find((el) => !el.closest('[data-voile-defilement]'));
      if (premier && !barre.contains(premier)) intrus.push({ y, quoi: premier.tagName + (premier.textContent ?? '').slice(0, 30) });
    }
    return { allume: voile.getAttribute('data-voile-allume'), hautDeLaBarre: cadre.top, basDeLaBarre: cadre.bottom, basZone, intrus };
  });
  noter('la barre collée touche le vrai bas de la zone (#d4b1)', !!mesure && Math.abs(mesure.basDeLaBarre - mesure.basZone) <= 1, JSON.stringify(mesure && { bas: mesure.basDeLaBarre, zone: mesure.basZone }));
  noter('rien ne paraît sous la barre collée (elementsFromPoint)', !!mesure && mesure.intrus.length === 0, JSON.stringify(mesure?.intrus.slice(0, 4)));
  noter('barre collée : le fondu du bas s’éteint, aucun dégradé au-dessus des boutons', mesure?.allume === 'non', JSON.stringify(mesure && { allume: mesure.allume }));
  await page.screenshot({ path: `${CAPTURES}/question-choix.png` });
  /* 4. UNE BARRE À SA PLACE N'EST PAS COLLÉE (#a30e) : du contenu suit la
     question, on défile cran par cran. Tant que le bloc de la question tient
     dans la zone, le fondu reste au bord bas de la zone ; il ne remonte qu'en
     suivant ce qui dépasse, sans jamais sauter d'un coup de la hauteur de la barre. */
  const parcours = await page.evaluate(async () => {
    const barres = [...document.querySelectorAll('[data-actions-question]')].filter((b) => b.getBoundingClientRect().height > 0);
    const barre = barres[barres.length - 1];
    const bloc = barre?.parentElement;
    let zone = bloc;
    while (zone && !zone.parentElement?.querySelector(':scope > [data-voile-defilement="vertical-fin"]')) zone = zone.parentElement;
    const voile = zone?.parentElement?.querySelector(':scope > [data-voile-defilement="vertical-fin"]');
    if (!bloc || !zone || !voile) return null;
    const suite = document.createElement('div');
    suite.style.height = '600px';
    suite.setAttribute('data-essai-suite', '');
    bloc.after(suite);
    const image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await image();
    const basZone = () => zone.getBoundingClientRect().bottom;
    const releves = [];
    // De « bloc entièrement visible, 120 px au-dessus du bas » à « bloc qui dépasse de 120 px ».
    for (let ecart = -120; ecart <= 120; ecart += 6) {
      zone.scrollTop += bloc.getBoundingClientRect().bottom - basZone() - ecart;
      await image();
      releves.push({ ecart: Math.round(bloc.getBoundingClientRect().bottom - basZone()), retrait: Math.round(basZone() - voile.getBoundingClientRect().bottom), allume: voile.getAttribute('data-voile-allume') });
    }
    suite.remove();
    return releves;
  });
  const visiblesEntiers = (parcours ?? []).filter((r) => r.ecart < -2);
  noter('bloc de la question entièrement visible : le fondu reste au bord bas de la zone', visiblesEntiers.length > 0 && visiblesEntiers.every((r) => Math.abs(r.retrait) <= 1), JSON.stringify(visiblesEntiers.slice(0, 6)));
  noter('pendant le défilement, le fondu ne remonte jamais au-dessus du bas de la zone', !!parcours?.length && parcours.every((r) => Math.abs(r.retrait) <= 1), JSON.stringify((parcours ?? []).filter((r) => Math.abs(r.retrait) > 1).slice(0, 3)));
  noter('bloc entièrement visible, du contenu dessous : le fondu reste allumé', visiblesEntiers.length > 0 && visiblesEntiers.every((r) => r.allume === 'oui'), JSON.stringify(visiblesEntiers.slice(0, 3)));
  noter('bloc qui dépasse largement (barre collée) : le fondu s’éteint', !!parcours?.length && parcours[parcours.length - 1].allume === 'non', JSON.stringify(parcours?.slice(-2)));
  // Le mode clair.
  const clair = await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    const r = getComputedStyle(document.documentElement);
    const essai = document.createElement('div');
    essai.className = 'decroche-violet';
    document.body.appendChild(essai);
    const violet = getComputedStyle(essai);
    const sortie = { decroche: r.getPropertyValue('--decroche').trim(), attente: r.getPropertyValue('--decroche-attente').trim(), part: violet.getPropertyValue('--part-de-couleur').trim(), gris: violet.getPropertyValue('--gris-du-decroche').trim(), fond: violet.backgroundImage };
    essai.remove();
    return sortie;
  });
  noter('en clair, la liste des tâches est plus légère (93 %)', clair.decroche === '0 0% 93%', JSON.stringify(clair));
  noter('en clair, la barre des messages en attente est un gris plein, sans dégradé', clair.fond === 'none', JSON.stringify(clair));
  await page.screenshot({ path: `${CAPTURES}/question-choix-clair.png` });
  noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}


/* 5. À CHAQUE CRAN DE DÉFILEMENT, LES BOUTONS DE LA BARRE PASSENT AVANT LE VOILE (#4b4c). */
async function boutonsAuDessusDuVoile(navigateur, { largeur, hauteur, sombre, deux }) {
  reposerLaQuestion(deux);
  const { contexte, page, erreurs } = await ouvrir(navigateur, largeur, hauteur);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${AVEC_QUESTION}`, { waitUntil: 'domcontentloaded' });
  await attendre(page, async () => (await visibles(page, '[data-repondre-question]')) > 0, 20000);
  // Sur téléphone, la question est COMPACTE : son « Répondre » ouvre la feuille du bas, où vit la barre.
  if ((await visibles(page, '[data-question-compacte] [data-repondre-question]')) > 0) {
    await page.locator('[data-question-compacte] [data-repondre-question]:visible').first().click();
    await attendre(page, async () => (await visibles(page, '[data-feuille-question] [data-actions-question]')) > 0, 12000);
    await page.waitForTimeout(500);
  }
  await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
  await page.waitForTimeout(300);
  const bilan = await page.evaluate(async () => {
    /* LE VOILE EST `pointer-events: none` : `elementsFromPoint` l'ignorerait, et
       le contrôle passerait même voile par-dessus. Le temps de la mesure, il
       redevient « touchable » — l'ordre rendu suit alors l'ordre réel de
       peinture, contexte d'empilement compris. */
    const touchable = document.createElement('style');
    touchable.textContent = '[data-voile-defilement], [data-voile-defilement] * { pointer-events: auto !important; }';
    document.head.appendChild(touchable);
    const image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const barres = [...document.querySelectorAll('[data-actions-question]')].filter((b) => b.getBoundingClientRect().height > 0);
    const zones = new Set();
    for (const barre of barres) {
      let zone = barre.parentElement;
      while (zone && !zone.parentElement?.querySelector(':scope > [data-voile-defilement="vertical-fin"]')) zone = zone.parentElement;
      if (zone) zones.add(zone);
    }
    let pas = 0;
    let verifies = 0;
    const fautes = [];
    for (const zone of zones) {
      const course = zone.scrollHeight - zone.clientHeight;
      for (let y = 0; y <= course + 4; y += 4) {
        zone.scrollTop = Math.min(y, course);
        await image();
        pas += 1;
        const cadreZone = zone.getBoundingClientRect();
        for (const bouton of zone.querySelectorAll('[data-actions-question] button')) {
          const b = bouton.getBoundingClientRect();
          if (!b.height || !b.width) continue;
          const x = b.left + b.width / 2;
          const yc = b.top + b.height / 2;
          // Seul un bouton réellement à l'écran, dans la vue de la zone, se juge.
          if (yc < cadreZone.top + 2 || yc > cadreZone.bottom - 2 || x < 0 || x > innerWidth || yc > innerHeight) continue;
          const pile = document.elementsFromPoint(x, yc);
          const iBouton = pile.findIndex((el) => el === bouton || bouton.contains(el));
          // Seul un voile ALLUMÉ (visible) compte : éteint, il est transparent.
          const iVoile = pile.findIndex((el) => el.closest('[data-voile-defilement]')?.getAttribute('data-voile-allume') === 'oui');
          verifies += 1;
          if (iBouton < 0 || (iVoile >= 0 && iVoile < iBouton)) {
            fautes.push({ y: zone.scrollTop, bouton: (bouton.textContent ?? '').trim().slice(0, 20), iBouton, iVoile, dessus: pile[0]?.getAttribute('data-voile-defilement') ?? pile[0]?.tagName });
          }
        }
      }
    }
    touchable.remove();
    const chaine = barres[0] ? (() => { const out = []; let e = barres[0]; while (e && out.length < 14) { out.push(`${e.tagName}${e.hasAttribute('data-zone-defilement') ? '[zone]' : ''}${e.querySelector(':scope > [data-voile-defilement]') ? '[voile]' : ''}`); e = e.parentElement; } return out.join('<'); })() : 'aucune barre';
    return { zones: zones.size, pas, verifies, fautes: fautes.slice(0, 5), nbFautes: fautes.length, ...(zones.size ? {} : { chaine, barres: barres.length }) };
  });
  const libelle = `${largeur}×${hauteur}, ${sombre ? 'sombre' : 'clair'}, ${deux ? 'deux questions' : 'une question'}`;
  noter(`boutons de la barre au-dessus du voile à chaque cran (${libelle})`, bilan.verifies > 0 && bilan.nbFautes === 0, JSON.stringify(bilan));
  await page.screenshot({ path: `${CAPTURES}/barre-au-dessus-${largeur}-${sombre ? 'sombre' : 'clair'}-${deux ? 2 : 1}.png` });
  noter(`aucune erreur de page (${libelle})`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

/* 6. LE FONDU DE LA FEUILLE DE QUESTION TIENT DANS LE CADRE JAUNE (#f1c2, #4fee). */
async function feuilleBornee(navigateur, { sombre, bordure }) {
  reposerLaQuestion();
  const { contexte, page, erreurs } = await ouvrir(navigateur, 390, 844);
  await page.goto(`${BASE}/#projet/${PROJET}/tache/${AVEC_QUESTION}`, { waitUntil: 'domcontentloaded' });
  await attendre(page, async () => (await visibles(page, '[data-question-compacte] [data-repondre-question]')) > 0, 20000);
  await page.locator('[data-question-compacte] [data-repondre-question]:visible').first().click();
  await attendre(page, async () => (await visibles(page, '[data-feuille-question] [data-actions-question]')) > 0, 12000);
  await page.evaluate((s) => {
    const racine = document.documentElement;
    racine.dataset.theme = s ? 'sombre' : 'clair';
    racine.classList.toggle('dark', s);
  }, sombre);
  await page.waitForTimeout(600);
  const bilan = await page.evaluate(async (bordure) => {
    const image = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const zone = document.querySelector('[data-zone-feuille-question]');
    const cadre = zone?.querySelector('[data-feuille-question]');
    if (!zone || !cadre) return { faute: 'feuille introuvable' };
    /* Ouverte depuis le panneau « Une décision attend », la bulle laisse le
       trait jaune au panneau ; ouverte depuis le fil (captures #f1c2, #4fee),
       elle porte le sien. Les deux cas se jugent. */
    if (bordure) cadre.classList.add('cadre-de-question');
    await image();
    // Au milieu de la course : les deux voiles sont allumés.
    zone.scrollTop = Math.round((zone.scrollHeight - zone.clientHeight) / 2);
    zone.dispatchEvent(new Event('scroll'));
    await image();
    await new Promise((r) => setTimeout(r, 400));
    const s = getComputedStyle(cadre);
    const c = cadre.getBoundingClientRect();
    const interieur = { gauche: c.left + parseFloat(s.borderLeftWidth), droite: c.right - parseFloat(s.borderRightWidth) };
    const voiles = [...zone.parentElement.querySelectorAll(':scope > [data-voile-defilement]')].map((v) => {
      const r = v.getBoundingClientRect();
      const couches = [...v.children].map((e) => e.getBoundingClientRect()).map((e) => [Math.round(e.left), Math.round(e.right)]);
      const ombre = v.lastElementChild ? getComputedStyle(v.lastElementChild).backgroundColor : '';
      return { cote: v.getAttribute('data-voile-defilement'), allume: v.getAttribute('data-voile-allume'), gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom, couches, ombre };
    });
    // Le voile rendu touchable le temps de la mesure (il est `pointer-events: none`).
    const touchable = document.createElement('style');
    touchable.textContent = '[data-voile-defilement], [data-voile-defilement] * { pointer-events: auto !important; }';
    document.head.appendChild(touchable);
    const recouvrements = [];
    for (const v of voiles.filter((x) => x.allume === 'oui')) {
      const y = (v.haut + v.bas) / 2;
      const bord = parseFloat(s.borderLeftWidth);
      /* Sur la bordure jaune (s'il y en a une), juste hors du cadre, et au bord
         de l'écran — en PIXELS ENTIERS : le navigateur arrondit le point visé
         (12,5 est jugé sur le pixel 13, celui du voile). */
      const points = [Math.floor(c.left) - 1, Math.ceil(c.right) + 1, 1, innerWidth - 2, ...(bord ? [Math.floor(c.left), Math.ceil(c.right) - 1] : [])];
      for (const x of points) {
        const dessus = document.elementsFromPoint(x, y)[0];
        if (dessus?.closest('[data-voile-defilement]')) recouvrements.push({ cote: v.cote, x, y: Math.round(y) });
      }
    }
    touchable.remove();
    const champ = cadre.querySelector('[data-champ-reponse-question]');
    return {
      interieur,
      voiles,
      recouvrements,
      fondCadre: s.backgroundColor,
      fondChamp: champ ? getComputedStyle(champ).backgroundColor : null,
      bordure: s.borderLeftWidth,
    };
  }, bordure);
  const libelle = `${sombre ? 'sombre' : 'clair'}, ${bordure ? `bordure jaune ${bilan.bordure ?? '?'}` : 'sans bordure'}`;
  if (bilan.faute) {
    noter(`feuille de question (${libelle})`, false, bilan.faute);
    await contexte.close();
    return;
  }
  const allumes = bilan.voiles.filter((v) => v.allume === 'oui');
  /* Au milieu de la course, la barre « Répondre » est collée au bas : elle fait le bord, le fondu du bas s'éteint
     (#d4b1, 04/11/2026) ; celui du haut reste allumé. */
  const etat = Object.fromEntries(bilan.voiles.map((v) => [v.cote, v.allume]));
  noter(`feuille (${libelle}) : au milieu de la course, le fondu du haut est allumé et celui du bas s'éteint sous la barre collée`, etat['vertical-debut'] === 'oui' && etat['vertical-fin'] === 'non', JSON.stringify(bilan.voiles.map((v) => [v.cote, v.allume])));
  const dedans = (g, d) => g >= bilan.interieur.gauche - 1 && d <= bilan.interieur.droite + 1;
  noter(
    `feuille (${libelle}) : ombre et flou tiennent entre les bords intérieurs du cadre jaune`,
    allumes.length > 0 && allumes.every((v) => dedans(v.gauche, v.droite) && v.couches.every(([g, d]) => dedans(g, d))),
    JSON.stringify({ interieur: bilan.interieur, voiles: allumes.map((v) => [v.cote, Math.round(v.gauche), Math.round(v.droite)]) }),
  );
  noter(`feuille (${libelle}) : aucun voile sur la bordure jaune ni au bord de l'écran`, allumes.length > 0 && bilan.recouvrements.length === 0, JSON.stringify(bilan.recouvrements.slice(0, 4)));
  // `rgb(…)` en 0–255, `color(srgb …)` (le mélange de l'ombre) en 0–1.
  const rgb = (texte) => {
    const valeurs = (texte?.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    return /^color\(/.test(texte ?? '') ? valeurs.map((v) => v * 255) : valeurs;
  };
  const clarte = (texte) => {
    const [r, g, b] = rgb(texte);
    return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255) * 100;
  };
  // L'ombre : le fond du cadre, un cran plus foncé (× 0,94).
  const attendue = rgb(bilan.fondCadre).map((v) => v * 0.94);
  const ombresJustes = allumes.every((v) => rgb(v.ombre).every((val, i) => Math.abs(val - attendue[i]) <= 0.02 * 255));
  noter(`feuille (${libelle}) : l'ombre prend le fond du cadre, un cran plus foncé`, allumes.length > 0 && ombresJustes, JSON.stringify({ cadre: bilan.fondCadre, ombres: allumes.map((v) => v.ombre) }));
  const ecart = Math.abs(clarte(bilan.fondChamp) - clarte(bilan.fondCadre));
  noter(`feuille (${libelle}) : le champ de réponse se détache du cadre (≥ 4,5 points)`, !!bilan.fondChamp && ecart >= 4.5, `champ ${bilan.fondChamp}, cadre ${bilan.fondCadre}, écart ${ecart.toFixed(1)}`);
  await page.screenshot({ path: `${CAPTURES}/feuille-bornee-${sombre ? 'sombre' : 'clair'}-${bordure ? 'bordure' : 'nue'}.png` });
  noter(`aucune erreur de page (feuille, ${libelle})`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await choixEtFondu(navigateur);
    for (const sombre of [false, true]) {
      for (const bordure of [false, true]) await feuilleBornee(navigateur, { sombre, bordure });
    }
    for (const [largeur, hauteur] of [[1280, 800], [390, 844]]) {
      for (const sombre of [false, true]) {
        for (const deux of [false, true]) await boutonsAuDessusDuVoile(navigateur, { largeur, hauteur, sombre, deux });
      }
    }
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
