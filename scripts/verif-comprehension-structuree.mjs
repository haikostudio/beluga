#!/usr/bin/env node
/**
 * LA COMPRÉHENSION STRUCTURÉE, DANS UN VRAI NAVIGATEUR.
 *
 * Le nouveau format impose trois parties : une phrase d'ouverture, un SOMMAIRE
 * numéroté de ce qui a été demandé, puis un bloc par point — « **1. Intitulé** »,
 * « Comment : … », « Résultat : … ». Les deux résumés courts du fil, eux,
 * s'aèrent d'une ligne vide entre chaque idée. Un test unitaire prouve le
 * RANGEMENT du texte ; seul un navigateur prouve qu'il s'AFFICHE, et que les
 * sauts de ligne des résumés ne sont pas aplatis par la mise en page : celui de
 * la demande ne s'écrit PLUS sous sa bulle (13/11/2026, le fil est une discussion), celui de la compréhension
 * sur la ligne OUVERTE de la carte de son passage (`data-point-phrase`).
 *
 * DEPUIS QUE LE CADRAGE N'IMPOSE PLUS CE GABARIT, la compréhension ordinaire
 * est un TEXTE LIBRE en paragraphes. La carte d'essai porte donc DEUX
 * compréhensions : la première au gabarit à trois parties (les cartes déjà
 * écrites doivent garder leurs volets), la dernière en texte libre (elle doit
 * se lire entière, en paragraphes séparés, sans volet ni sommaire).
 *
 * On pose la carte d'essai, on l'ouvre, on juge, puis on la retire. Le titre porte « Carte d'essai » :
 * `nettoyer-essais.mjs` la ramasse même si ce script tombe en route.
 *
 *   env -u BELUGA_TOKEN BELUGA_VERIF_URL=http://localhost:7099 node scripts/verif-comprehension-structuree.mjs
 *
 * On vise le serveur de DÉVELOPPEMENT : BELUGA_URL désigne l'application publiée.
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { cheminDeLaBaseServie, dossierDesDonnees } from './lib/base-servie.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
/* Les captures suivent le dossier de données VISÉ (`BELUGA_DATA`), comme la
   base : rejoué sur un démon d'essai, le contrôle n'écrit rien chez le vrai. */
const SHOTS = path.join(dossierDesDonnees(), 'verification');
fs.mkdirSync(SHOTS, { recursive: true });

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const TITRE = "Carte d'essai — compréhension structurée";

const COMPREHENSION = [
  'Vous voulez des compréhensions plus détaillées et mieux structurées.',
  '',
  '1. Une liste d’ouverture qui énumère tout ce qui a été demandé.',
  '2. Chaque point repris dessous, avec sa référence.',
  '3. Les deux résumés courts du fil aérés.',
  '',
  '**1. La liste d’ouverture** — toutes les demandes tiennent sur une ligne chacune, sans explication.',
  'Comment : la liste se pose sous la phrase d’ouverture, en tête du point « Compréhension » du fil de la carte.',
  'Résultat : on voit d’un coup tout ce qui a été demandé, sans rien déplier.',
  '',
  '**2. La reprise point par point** — chaque ligne de la liste a son bloc, sous le même numéro.',
  'Comment : le numéro se pose devant l’intitulé, dans le fil de la carte.',
  'Résultat : on retrouve sans hésiter à quelle demande un point répond.',
  '',
  '**3. Les résumés aérés** — les deux textes courts du fil respirent.',
  'Comment : une ligne vide sépare chaque idée, sous les points « Demande » et « Compréhension ».',
  'Résultat : le fil se lit sans effort, au lieu d’un pavé de trois phrases collées.',
].join('\n');

const COMPREHENSION_LIBRE = [
  'Vous trouvez les compréhensions trop pauvres : elles ressemblent à un formulaire rempli plutôt qu’à une vraie réponse.',
  '',
  'En regardant la carte, deux freins ressortent : la découpe imposée, qui ne laissait aucune place au raisonnement, et les limites de longueur, qui coupaient la réponse trop tôt.',
  '',
  'Vous verrez donc, avant chaque lancement, un texte qui se lit comme une réponse écrite pour vous.',
].join('\n');

const RESUME_DEMANDE = ['Vous demandez des compréhensions plus détaillées.', '', 'Et des résumés courts aérés.'].join('\n');
const RESUME_COMPREHENSION = ['La compréhension s’ouvre sur la liste des demandes.', '', 'Chaque point dit sa manière et son résultat.'].join('\n');

const db = new Database(cheminDeLaBaseServie());
const projet = db.prepare('SELECT id FROM projects ORDER BY created_at LIMIT 1').get();
if (!projet) {
  console.log('Aucun projet en base : rien à juger.');
  process.exit(1);
}

const carteId = crypto.randomUUID();
/* LE FIL N'EXISTE QUE POUR UNE CARTE QUI A SON AGENT DE CONVERSATION : sans lui,
   le tiroir s'ouvre sur la configuration de l'agent et ne montre aucun point. */
const agentId = crypto.randomUUID();
const tourId = `essai-${carteId}`;
const maintenant = Date.now();
const jalon = (rang, libelle, resultat, donnees) =>
  db
    .prepare(
      `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, resultat, donnees, reussie)
       VALUES (?, ?, ?, 'cadrage', 'jalon', ?, ?, 'cadrage', ?, ?, ?, ?, 1)`,
    )
    .run(crypto.randomUUID(), carteId, rang, maintenant + rang, agentId, tourId, libelle, resultat, donnees);

const token = crypto.randomBytes(32).toString('hex');
const empreinte = crypto.createHash('sha256').update(token).digest('hex');
try {
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description)
     VALUES (?, ?, 'planned', 1, ?, ?, ?, ?, ?)`,
  ).run(
    carteId,
    projet.id,
    TITRE,
    JSON.stringify({
      parcours: {
        comprehension: {
          texte: COMPREHENSION,
          hypotheses: [],
          sujets: [],
          resumeDemande: RESUME_DEMANDE,
          resumeComprehension: RESUME_COMPREHENSION,
          tourId,
          at: maintenant,
        },
      },
    }),
    maintenant,
    maintenant,
    'Carte posée par un contrôle automatique.',
  );
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'cadrage', 'idle', ?, ?, ?)`,
  ).run(
    agentId,
    projet.id,
    carteId,
    JSON.stringify({
      id: agentId,
      projectId: projet.id,
      cardId: carteId,
      role: 'cadrage',
      title: TITRE,
      run: { engine: 'claude', model: 'claude-sonnet-5', thinking: 'low' },
      status: 'idle',
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );
  db.prepare('UPDATE cards SET conversation_agent_id = ? WHERE id = ?').run(agentId, carteId);
  /* SANS UN SEUL MESSAGE, le tiroir s'ouvre sur la configuration de l'agent et
     le fil en points n'est pas dessiné du tout (`configurationOuverte`). */
  const messageId = crypto.randomUUID();
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, \'user\', ?, ?)').run(
    messageId,
    agentId,
    JSON.stringify({
      id: messageId,
      agentId,
      role: 'user',
      content: 'Je veux des compréhensions plus détaillées.',
      steps: [],
      todos: [],
      proposals: [],
      questions: [],
      downloads: [],
      attachments: [],
      streaming: false,
      createdAt: maintenant,
    }),
    maintenant,
  );
  jalon(1, 'Demande', 'Une demande d’essai.', JSON.stringify({ resumeDemande: RESUME_DEMANDE }));
  jalon(2, 'Compréhension', COMPREHENSION, JSON.stringify({ hypotheses: [], sujets: [], resumeDemande: RESUME_DEMANDE, resumeComprehension: RESUME_COMPREHENSION }));
  /* UNE COMPRÉHENSION PAR PASSAGE : la version libre suit une seconde demande,
     sinon elle remplacerait la première dans le même passage. */
  jalon(3, 'Demande', 'Une précision d’essai.', JSON.stringify({ resumeDemande: RESUME_DEMANDE }));
  jalon(4, 'Compréhension', COMPREHENSION_LIBRE, JSON.stringify({ hypotheses: [], sujets: [], resumeDemande: RESUME_DEMANDE, resumeComprehension: RESUME_COMPREHENSION }));
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification compréhension structurée',
  );
  db.close();

  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await contexte.addCookies([{ name: 'beluga_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await contexte.newPage();
    await page.goto(`${BASE}/#projet/${projet.id}`, { waitUntil: 'domcontentloaded' });
    const article = page.locator('article').filter({ hasText: TITRE }).first();
    const vue = await article
      .waitFor({ state: 'visible', timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    noter('la carte d’essai est au tableau', vue);
    if (vue) {
      await article.evaluate((el) => el.click());
      const point = page.locator('[role="dialog"] [data-point="comprehension"]').first();
      await point.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
      if ((await point.getAttribute('data-point-ouvert').catch(() => null)) === 'non') {
        await point.locator('[data-point-bascule]').first().evaluate((el) => el.click());
      }
      await page.locator('[data-moment="comprehension"]').last().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1200);

      /* LES POINTS SONT DES VOLETS : le premier ouvert, les autres fermés. On les
         ouvre TOUS avant de juger — « Comment » et « Résultat » d'un volet replié
         ne sont pas dessinés du tout, et un contrôle qui ne les compte pas
         mesurerait le repli, pas la mise en forme. */
      const derniereCarte = page.locator('[data-moment="comprehension"]').filter({ has: page.locator('[data-point-comprehension]') }).last();
      for (const bascule of await derniereCarte.locator('[data-volet-bascule]').all()) {
        const volet = bascule.locator('xpath=ancestor::li[1]');
        if ((await volet.getAttribute('data-volet-ouvert')) === 'non') await bascule.evaluate((el) => el.click());
      }
      await page.waitForTimeout(800);

      const lu = await page.evaluate(() => {
        const derniere = [...document.querySelectorAll('[data-moment="comprehension"]')].filter((m) => m.querySelector('[data-point-comprehension]')).at(-1);
        const sommaire = derniere?.querySelector('[data-comprehension-sommaire]');
        const points = [...(derniere?.querySelectorAll('[data-point-comprehension]') ?? [])];
        /* LE SAUT DE LIGNE EST-IL VISIBLE ? On compare la hauteur rendue à celle
           d'une seule ligne : un pavé aplati tiendrait sur deux lignes serrées. */
        const lignesRendues = (el) => {
          const ligne = el ? parseFloat(getComputedStyle(el).lineHeight) : 0;
          return ligne > 0 ? Math.round(el.getBoundingClientRect().height / ligne) : 0;
        };
        /* Le résumé de la DEMANDE ne se lit plus sous sa bulle (13/11/2026) : aucun `data-point-resume`. */
        const resume = [...document.querySelectorAll('[data-point="demande"] [data-point-resume]')].find((p) => p.textContent?.includes('compréhensions plus détaillées'));
        /* Celui de la COMPRÉHENSION est la ligne de la carte de son passage
           (`[data-carte-du-passage] [data-point-phrase]`) : deux lignes au plus
           fermée, ses paragraphes gardés une fois ouverte — elle l'est ici. */
        const ligneDeCarte = [...document.querySelectorAll('[data-point="comprehension"][data-point-ouvert="oui"] [data-carte-du-passage] [data-point-phrase]')].find((p) =>
          p.textContent?.includes('s’ouvre sur la liste des demandes'),
        );
        return {
          forme: derniere?.querySelector('[data-comprehension-contenu]')?.getAttribute('data-comprehension-forme') ?? null,
          /* LE SOMMAIRE EST LA LISTE DES VOLETS : une ligne par point, comptée
             au PREMIER niveau — les listes à puces d'un point développé sont
             elles aussi des `li`, et les compter les confondrait. */
          lignesDuSommaire: sommaire ? sommaire.querySelectorAll(':scope > li').length : 0,
          references: points.map((p) => p.getAttribute('data-point-reference')),
          intitules: points.map((p) => p.getAttribute('data-point-comprehension')),
          comments: points.filter((p) => p.querySelector('[data-point-part="Comment"]')).length,
          resultats: points.filter((p) => p.querySelector('[data-point-part="Résultat"]')).length,
          cadres: points.filter((p) => [...p.querySelectorAll('[data-point-part], [data-point-part] > *')].some((b) => getComputedStyle(b).borderTopWidth !== '0px')).length,
          /* CHAQUE PART EST UN BLOC À DEUX ÉTAGES : un en-tête (le libellé) et un
             panneau (le texte), deux éléments distincts, au fond différent. */
          etages: [...(derniere?.querySelectorAll('[data-point-part]') ?? [])].map((part) => {
            const entete = part.querySelector(':scope > [data-en-tete-de-panneau]');
            const panneau = part.querySelector(':scope > [data-panneau]');
            const fond = (el) => (el ? getComputedStyle(el).backgroundColor : '');
            return {
              entete: entete?.textContent ?? '',
              panneau: !!panneau?.textContent?.trim(),
              fondsDistincts: !!entete && !!panneau && fond(entete) !== fond(panneau) && !/rgba\(0, 0, 0, 0\)|transparent/.test(fond(entete) + fond(panneau)),
            };
          }),
          resume: resume?.textContent ?? '',
          lignesDuResume: lignesRendues(resume),
          ligneDeCarte: ligneDeCarte?.textContent ?? '',
          lignesDeLaLigneDeCarte: lignesRendues(ligneDeCarte),
        };
      });

      noter('la compréhension se lit en points', lu.forme === 'points' && lu.intitules.length === 3, JSON.stringify(lu.intitules));
      noter('le sommaire des demandes s’affiche en tête', lu.lignesDuSommaire === 3, `${lu.lignesDuSommaire} ligne(s)`);
      noter('chaque point porte sa référence', JSON.stringify(lu.references) === JSON.stringify(['1', '2', '3']), JSON.stringify(lu.references));
      noter('chaque point montre sa manière et son résultat', lu.comments === 3 && lu.resultats === 3, `${lu.comments} manière(s), ${lu.resultats} résultat(s)`);
      noter(
        'chaque part a son en-tête et son panneau, aux fonds distincts',
        lu.etages.length === 6 && lu.etages.every((e) => (e.entete === 'Comment' || e.entete === 'Résultat') && e.panneau && e.fondsDistincts),
        JSON.stringify(lu.etages[0] ?? null),
      );
      noter('aucune de ces parts ne pose de bordure', lu.cadres === 0, `${lu.cadres} part(s) encadrée(s)`);
      noter('la demande n’est plus reformulée sous sa bulle (13/11/2026)', lu.lignesDuResume === 0 && !lu.resume, lu.resume.slice(0, 80));
      noter(
        'celui de la compréhension garde la sienne, sur la ligne ouverte de la carte de son passage',
        lu.ligneDeCarte.includes('Chaque point dit sa manière et son résultat') && lu.lignesDeLaLigneDeCarte >= 3,
        lu.ligneDeCarte ? `${lu.lignesDeLaLigneDeCarte} ligne(s) rendues` : 'aucun résumé affiché',
      );
      await page.locator('[data-moment="comprehension"]').last().scrollIntoViewIfNeeded().catch(() => {});
      await page.screenshot({ path: `${SHOTS}/comprehension-structuree.png` });
      /* LE MÊME BLOC EN CLAIR : l'en-tête doit rester distinct de son panneau
         dans la palette claire d'origine aussi, pas seulement en sombre. */
      const enClair = await page.evaluate(() => {
        const racine = document.documentElement;
        racine.dataset.theme = 'clair';
        racine.classList.remove('dark');
        const part = document.querySelector('[data-moment="comprehension"] [data-point-part]');
        const fond = (el) => (el ? getComputedStyle(el).backgroundColor : '');
        return { entete: fond(part?.querySelector('[data-en-tete-de-panneau]')), panneau: fond(part?.querySelector('[data-panneau]')) };
      });
      noter('en clair aussi, l’en-tête se détache de son panneau', !!enClair.entete && enClair.entete !== enClair.panneau, JSON.stringify(enClair));
      await page.screenshot({ path: `${SHOTS}/comprehension-structuree-clair.png` });
      /* LE TEXTE LIBRE, cas ordinaire d'aujourd'hui : rendu entier, en trois
         paragraphes distincts, sans volet ni sommaire. */
      /* Ouvrir le passage suivant REFERME le premier : on le juge en dernier. */
      for (const bascule of await page.locator('[role="dialog"] [data-point="comprehension"][data-point-ouvert="non"] [data-point-bascule]').all()) {
        await bascule.evaluate((el) => el.click()).catch(() => {});
      }
      await page.waitForTimeout(800);
      const libre = await page.evaluate(() => {
        /* Repérée par son TEXTE, pas par sa place : le fil range ses moments à
           sa manière, et un contrôle ne doit pas dépendre de cet ordre. */
        const tous = [...document.querySelectorAll('[data-moment="comprehension"]')];
        const m = tous.find((x) => x.textContent?.includes('une réponse écrite pour vous'));
        const contenu = m?.querySelector('[data-comprehension-contenu]');
        return {
          forme: contenu?.getAttribute('data-comprehension-forme') ?? null,
          paragraphes: contenu ? contenu.querySelectorAll('p').length : 0,
          volets: m ? m.querySelectorAll('[data-point-comprehension]').length : -1,
          sommaire: !!m?.querySelector('[data-comprehension-sommaire]'),
          fin: contenu?.textContent?.includes('une réponse écrite pour vous') ?? false,
          moments: tous.length,
        };
      });
      noter(
        'une compréhension en texte libre se lit entière, en paragraphes',
        libre.forme === 'texte' && libre.paragraphes >= 3 && libre.volets === 0 && !libre.sommaire && libre.fin,
        JSON.stringify(libre),
      );
    }
    await contexte.close();
  } finally {
    await navigateur.close();
  }
} finally {
  const fin = new Database(cheminDeLaBaseServie());
  fin.prepare('DELETE FROM card_journal WHERE card_id = ?').run(carteId);
  fin.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
  fin.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
  fin.prepare('DELETE FROM cards WHERE id = ?').run(carteId);
  fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  fin.close();
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) tenus.`);
process.exit(echecs ? 1 : 0);
