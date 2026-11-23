#!/usr/bin/env node
/**
 * CHAQUE GENRE D'ÉTAPE DANS SON ENCADRÉ, ET PLUS AUCUNE DONNÉE BRUTE.
 *
 *   node scripts/verif-etapes-illustrees.mjs
 *
 * Ce contrôle NE DÉPENSE PAS UN JETON : il n'attend aucun moteur. Il POSE une
 * carte d'essai et son journal directement dans la base réellement servie — une
 * étape de CHAQUE genre : question, mémoire, commande, fichier lu, fichier
 * modifié, recherche, page web, ligne de liste, outil du démon, genre
 * inattendu —, ouvre la carte dans un VRAI navigateur et juge ce que l'écran en
 * fait. La carte et son journal sont retirés à la fin, quoi qu'il arrive.
 *
 * CE QUI EST VÉRIFIÉ :
 *   1. chaque genre d'étape s'affiche dans SON encadré, avec son bandeau de
 *      tête — aucun genre oublié, aucun retombé dans le refuge ;
 *   2. la question porte sa réponse retenue MARQUÉE, et son complément écrit à
 *      la main dessous ;
 *   3. la mémoire se lit en VOLETS — un par référence trouvée, tous fermés au
 *      départ —, et un clic en ouvre un qui va chercher la fiche complète ;
 *   4. aucune DONNÉE BRUTE ne subsiste dans le fil : pas d'accolade JSON hors
 *      du point « JSON intégral », qui est sa place ;
 *   5. les mêmes encadrés servent dans la version RACONTÉE et dans la version
 *      DÉTAILLÉE du même point ;
 *   6. UN SEUL CLIC : ouvrir la phrase d'une étape montre directement ses
 *      encadrés — aucune sous-ligne à rouvrir, aucune qui s'ouvrirait sur du
 *      vide —, l'intention d'une commande déjà dite par la phrase n'est pas
 *      redite, le temps pris et l'échec passent dans le bandeau, et un outil du
 *      tableau nomme la carte par son TITRE, jamais par son identifiant.
 *
 * Le tout est rejoué avec un système en apparence CLAIRE puis SOMBRE. Cela ne
 * change l'écran que si le réglage « Automatique » est retenu : une apparence
 * imposée par le compte ou le projet reste la même. Les couleurs des encadrés
 * ne viennent que des jetons de thème, que `verif-themes.mjs` juge dans les
 * douze palettes.
 *
 * L'interface jugée est celle du DÉPÔT (serveur de développement, port 7099) ;
 * la base est celle du démon en service, où la carte d'essai vit le temps du
 * contrôle. Les assertions portent sur l'ÉTAT (attribut, volet ouvert ou
 * fermé), jamais sur une hauteur en pixels.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { cheminDeLaBaseServie } from './lib/base-servie.mjs';
import { creerResultats } from './lib/verif-resultats.mjs';

const BASE = process.env.BELUGA_VERIF_URL || 'http://localhost:7099';
const PROJET = process.env.BELUGA_PROJET || 'Beluga';
const TITRE = 'Carte d’essai — étapes illustrées';

const { results, record } = creerResultats();
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * LA MÉMOIRE, TELLE QUE LE DÉMON LA REND — la forme exacte de
 * `rendreUnitesTrouvees` (`server/src/connaissances.ts`), figée aussi côté
 * règle pure dans `server/src/test/memoire-lue.test.ts`.
 */
const MEMOIRE_RENDUE = [
  '2 unité(s) pour « bandeau du haut » :',
  '- MEM-1443 · project · P0 · Beluga Build : le tableau qui pilote des agents (fiche 00_project)',
  '  Beluga Build est l’outil de cadrage puis d’exécution des tâches de développement.',
  '- DEC-0042 · decision · P1 · global · Le coin haut gauche répond au coin haut droit (fiche 05_decisions) — déjà lue dans cette session',
  '  Les deux coins du bandeau portent le même poids visuel.',
  '',
  'Lis une unité entière avec « lire » et son « id ».',
].join('\n');

/** Le journal de la carte d'essai : un genre d'étape par entrée. */
function journalDEssai(cardId, agentId) {
  /* Le premier geste : une commande dont la phrase du bloc enchâsse déjà
     l'intention, et qui a pris deux secondes. */
  const debut = Date.now() - 600_000;
  const entrees = [];
  let rang = 0;
  const poser = (partiel) => {
    rang += 1;
    entrees.push({
      id: `${cardId}-j${rang}`,
      card_id: cardId,
      rang,
      phase: 'execution',
      nature: 'requete',
      at: debut + rang * 1000,
      agent_id: agentId,
      agent_role: 'execution',
      tour_id: `${cardId}-tour`,
      libelle: '',
      outil: null,
      params: null,
      resultat: null,
      reussie: null,
      duree_ms: null,
      etat: null,
      donnees: null,
      ...partiel,
    });
  };

  poser({
    nature: 'point',
    libelle: 'Illustrer chaque genre d’étape',
    etat: 'running',
    donnees: JSON.stringify({ rang: 1, sur: 1 }),
  });
  poser({ outil: 'Bash', libelle: 'Bash', params: JSON.stringify({ command: 'npm test', description: 'Lancer les tests' }), resultat: '3750 tests au vert', duree_ms: 2000 });
  poser({ outil: 'Read', libelle: 'Read', params: JSON.stringify({ file_path: '/root/beluga/web/src/app.tsx', offset: 120 }), resultat: 'const a = 1;' });
  poser({
    outil: 'Edit',
    libelle: 'Edit',
    params: JSON.stringify({ file_path: '/root/beluga/web/src/app.tsx', old_string: 'const a = 1;', new_string: 'const a = 2;' }),
    resultat: 'ok',
  });
  poser({ outil: 'Grep', libelle: 'Grep', params: JSON.stringify({ pattern: 'EncadreEtape', path: 'web/src' }), resultat: 'web/src/components/encadre-etape.tsx:31' });
  poser({ outil: 'WebFetch', libelle: 'WebFetch', params: JSON.stringify({ url: 'https://example.com/doc', prompt: 'Lire la doc' }), resultat: 'La documentation dit ceci.' });
  poser({
    outil: 'mcp__beluga__memoire',
    libelle: 'Base de connaissances',
    params: JSON.stringify({ geste: 'chercher', demande: 'bandeau du haut' }),
    resultat: MEMOIRE_RENDUE,
  });
  poser({
    outil: 'mcp__beluga__ask_user',
    libelle: 'mcp__beluga__ask_user',
    params: JSON.stringify({
      question: 'On garde le bandeau du haut ?',
      description: 'Le bandeau porte la cloche et le menu.',
      kind: 'single',
      options: [
        { id: 'oui', label: 'Oui, on le garde', description: 'rien ne bouge' },
        { id: 'non', label: 'Non, on le retire' },
      ],
    }),
    resultat: 'Réponse de l’utilisateur : Non, on le retire — mais on garde la cloche',
  });
  /* UN OUTIL DU DÉMON : ses paramètres se lisent NOMMÉS, jamais en JSON. */
  poser({
    outil: 'mcp__beluga__coffre_fort',
    libelle: 'Coffre-fort',
    params: JSON.stringify({ action: 'lister', projet: 'Beluga' }),
    resultat: '3 accès enregistrés.',
  });
  /* LES OUTILS DU TABLEAU, DONT DEUX REFUS : la carte visée se lit par son
     titre, et le refus se dit comme tel. */
  poser({
    outil: 'mcp__beluga__board_update_card',
    libelle: 'Modification d\'une carte',
    params: JSON.stringify({ title: 'Titre provisoire' }),
    resultat: 'Carte introuvable.',
    reussie: 0,
  });
  poser({
    outil: 'mcp__beluga__board_update_card',
    libelle: 'Modification d\'une carte',
    params: JSON.stringify({ cardId, title: 'Titre provisoire' }),
    resultat: 'Carte mise à jour.',
    reussie: 1,
  });
  /* UN GENRE INATTENDU : il tombe sur l'encadré générique, jamais sur du brut. */
  poser({
    outil: 'OutilInconnuDuJour',
    libelle: 'OutilInconnuDuJour',
    params: JSON.stringify({ cible: 'quelque chose', mode: 'essai' }),
    resultat: 'rendu quelconque',
  });
  return entrees;
}

async function main() {
  const db = new Database(cheminDeLaBaseServie());
  const projet = db.prepare('SELECT id FROM projects WHERE name = ?').get(PROJET);
  if (!projet) throw new Error(`Projet « ${PROJET} » introuvable dans la base servie.`);

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3_600_000,
    'vérification des étapes illustrées',
  );

  const carteId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const maintenant = Date.now();
  db.prepare(
    `INSERT INTO cards (id, project_id, column_key, position, title, data, created_at, updated_at, description, agent_id)
     VALUES (?, ?, 'planned', ?, ?, '{}', ?, ?, ?, ?)`,
  ).run(carteId, projet.id, 1, TITRE, maintenant, maintenant, 'Carte posée par un contrôle automatique.', agentId);
  db.prepare(
    `INSERT INTO agents (id, project_id, card_id, role, status, data, created_at, updated_at)
     VALUES (?, ?, ?, 'task', 'done', ?, ?, ?)`,
  ).run(
    agentId,
    projet.id,
    carteId,
    JSON.stringify({
      id: agentId,
      projectId: projet.id,
      cardId: carteId,
      role: 'task',
      title: TITRE,
      status: 'done',
      run: { engine: 'claude', model: 'claude-opus-5', thinking: 'high', mode: 'direct' },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );
  db.prepare('INSERT INTO messages (id, agent_id, role, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
    `${agentId}-m1`,
    agentId,
    'user',
    JSON.stringify({ id: `${agentId}-m1`, agentId, role: 'user', content: 'Carte d’essai : ne rien exécuter.', createdAt: maintenant }),
    maintenant,
  );

  const poserJournal = db.prepare(
    `INSERT INTO card_journal (id, card_id, rang, phase, nature, at, agent_id, agent_role, tour_id, libelle, outil, params, resultat, reussie, duree_ms, etat, donnees)
     VALUES (@id, @card_id, @rang, @phase, @nature, @at, @agent_id, @agent_role, @tour_id, @libelle, @outil, @params, @resultat, @reussie, @duree_ms, @etat, @donnees)`,
  );
  for (const entree of journalDEssai(carteId, agentId)) poserJournal.run(entree);

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    for (const apparence of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'fr-CH', serviceWorkers: 'block', colorScheme: apparence });
      await context.addCookies([{ name: 'beluga_session', value: cookie, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      const erreurs = [];
      page.on('pageerror', (error) => erreurs.push(String(error)));

      const adresse = `${BASE}/#projet/${encodeURIComponent(projet.id)}/tache/${encodeURIComponent(carteId)}`;
      await page.goto(adresse, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await attendre(7_000);

      const tiroir = page.locator('[role="dialog"]').last();
      await tiroir.locator('[data-point]').first().waitFor({ timeout: 30_000 });

      const ouvrirLePoint = async (etape) => {
        const point = tiroir.locator(`[data-point="${etape}"]`).last();
        for (let essai = 0; essai < 3; essai += 1) {
          if ((await point.getAttribute('data-point-ouvert')) === 'oui') return point;
          await point.locator(`[data-point-bascule="${etape}"]`).click();
          await attendre(1_200);
        }
        return point;
      };
      await ouvrirLePoint('travail');
      const contenu = tiroir.locator('[data-point-contenu="travail"]').first();

      /* ---------- 1. La question : son encadré, dans le récit ---------- */

      record(
        'la question posée s’affiche dans son encadré, sans qu’on déplie rien',
        (await contenu.locator('[data-encadre="question"]').count()) >= 1,
      );
      const retenues = await contenu.locator('[data-encadre-question-option="retenue"]').allInnerTexts();
      record(
        'la réponse retenue porte sa marque de sélection, et elle seule',
        retenues.length === 1 && retenues[0].includes('Non, on le retire'),
        retenues.join(' | '),
      );
      const complement = await contenu.locator('[data-encadre-question-complement]').first().innerText().catch(() => '');
      record(
        'le complément écrit à la main se lit sous les réponses',
        complement.includes('mais on garde la cloche'),
        complement.trim().slice(0, 80),
      );

      /* ---------- 2. Chaque genre a son encadré ---------- */

      /* On déplie tous les blocs racontés : leurs traces portent le reste des
         genres, un par ligne. */
      const bascules = contenu.locator('[data-bloc-raconte-bascule]');
      for (let i = 0; i < (await bascules.count()); i += 1) {
        await bascules.nth(i).click({ timeout: 5_000 }).catch(() => undefined);
        await attendre(200);
      }
      await attendre(1_200);

      /* BELUGA_CAPTURE=<dossier> garde une image de chaque apparence, pour
         juger le rendu à l'œil. */
      if (process.env.BELUGA_CAPTURE) {
        await contenu.screenshot({ path: `${process.env.BELUGA_CAPTURE}/etapes-${apparence}.png` }).catch(() => undefined);
      }

      /* ---------- 6. Un seul clic, aucune sous-ligne ---------- */

      record(
        'aucune sous-ligne à rouvrir sous une étape dépliée',
        (await contenu.locator('[data-trace-bascule]').count()) === 0,
      );
      const gestesVides = await contenu
        .locator('[data-bloc-raconte-detail] > li')
        .evaluateAll((n) => n.filter((li) => !li.querySelector('[data-encadre]') || !(li.textContent ?? '').trim()).length);
      const gestes = await contenu.locator('[data-bloc-raconte-detail] > li').count();
      record('chaque geste d’une étape ouverte montre son encadré, jamais du vide', gestes > 0 && gestesVides === 0, `${gestes} geste(s), ${gestesVides} vide(s)`);
      record(
        'l’intention déjà dite par la phrase n’est pas redite dans l’encadré',
        (await contenu.locator('[data-encadre="commande"]').count()) >= 1 &&
          (await contenu.locator('[data-encadre="commande"] [data-encadre-intention]').count()) === 0,
      );
      record('le temps pris se lit dans le bandeau', (await contenu.locator('[data-encadre-bandeau] [data-encadre-duree]').count()) >= 1);
      const encadresOutil = await contenu.locator('[data-encadre="outil"]').allInnerTexts();
      const texteOutils = encadresOutil.join(' | ');
      record(
        'un outil du tableau nomme la carte par son titre, pas par son identifiant',
        texteOutils.includes(TITRE) && !texteOutils.includes(carteId),
        texteOutils.slice(0, 160),
      );
      record(
        'un outil refusé garde son signal rouge et dit son refus',
        (await contenu.locator('[data-encadre="outil"][data-encadre-echec="oui"] [data-encadre-refus]').count()) >= 1,
      );

      const sortesVues = new Set(
        (await contenu.locator('[data-encadre]').evaluateAll((n) => n.map((e) => e.getAttribute('data-encadre')))).filter(Boolean),
      );
      const attendues = ['question', 'memoire', 'commande', 'fichier', 'modification', 'recherche', 'web', 'outil'];
      const manquantes = attendues.filter((sorte) => !sortesVues.has(sorte));
      record(
        'chaque genre d’étape s’affiche dans SON encadré',
        manquantes.length === 0,
        manquantes.length ? `manque : ${manquantes.join(', ')}` : [...sortesVues].join(', '),
      );
      const sansBandeau = await contenu
        .locator('[data-encadre]')
        .evaluateAll((n) => n.filter((e) => !e.querySelector('[data-encadre-bandeau]')).length);
      record('chaque encadré porte son bandeau de tête', sansBandeau === 0, `${sansBandeau} sans bandeau`);

      /* ---------- 3. La mémoire, en volets ---------- */

      const volets = contenu.locator('[data-memoire-reference]');
      const nombreDeVolets = await volets.count();
      record(
        'la mémoire se lit en volets, un par référence trouvée',
        nombreDeVolets === 2,
        `${nombreDeVolets} volet(s)`,
      );
      const etats = await volets.evaluateAll((n) => n.map((e) => e.getAttribute('data-memoire-reference-etat')));
      record('tous les volets sont fermés au départ', etats.every((e) => e === 'ferme'), etats.join(', '));
      const titres = await volets.locator('[data-memoire-reference-bascule]').allInnerTexts();
      record(
        'chaque volet porte le titre lisible de sa référence, pas sa ligne brute',
        titres.some((titre) => titre.includes('le tableau qui pilote des agents')) &&
          !titres.some((titre) => titre.includes('(fiche ')),
        titres.join(' | ').slice(0, 140),
      );

      if (nombreDeVolets) {
        const premier = volets.first();
        await premier.locator('[data-memoire-reference-bascule]').click({ timeout: 5_000 });
        await attendre(2_000);
        record(
          'un clic ouvre le volet',
          (await premier.getAttribute('data-memoire-reference-etat')) === 'ouvert',
        );
        const detail = premier.locator('[data-memoire-reference-detail]').first();
        const texte = (await detail.count()) ? await detail.innerText() : '';
        record(
          'le volet ouvert montre un contenu — la fiche demandée, ou le résumé connu',
          texte.trim().length > 10 && (await detail.locator('[data-memoire-reference-silhouette]').count()) === 0,
          texte.trim().slice(0, 80),
        );
      }

      /* ---------- 4. Plus aucune donnée brute ---------- */

      const brut = await contenu.evaluate((racine) => {
        const suspects = [];
        for (const bloc of racine.querySelectorAll('[data-encadre], [data-bloc-raconte]')) {
          const texte = bloc.textContent ?? '';
          if (/\{\s*"[a-z_]+"\s*:/i.test(texte)) suspects.push(texte.slice(0, 90));
        }
        return suspects;
      });
      record(
        'aucune donnée brute ne subsiste dans les encadrés',
        brut.length === 0,
        brut.slice(0, 2).join(' | '),
      );

      /* ---------- 5. La version détaillée montre les MÊMES encadrés ---------- */

      const bascule = tiroir.locator('[data-point-technique="travail"]').first();
      if (await bascule.count()) {
        await bascule.click({ timeout: 5_000 });
        await attendre(1_500);
        record(
          'la version détaillée montre les mêmes encadrés, pas l’ancien affichage',
          (await contenu.locator('[data-encadre="question"]').count()) >= 1 &&
            (await contenu.locator('[data-bloc-raconte-vue="technique"]').count()) >= 1,
        );
        await bascule.click({ timeout: 5_000 }).catch(() => undefined);
      } else {
        record('la version détaillée montre les mêmes encadrés, pas l’ancien affichage', false, 'bascule introuvable');
      }

      record(`aucune erreur de page (${apparence})`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    if (process.env.BELUGA_GARDER) {
      console.log(`\ncarte d'essai gardée : ${carteId} (projet ${projet.id})`);
      db.close();
      return;
    }
    db.prepare('DELETE FROM card_journal WHERE card_id = ?').run(carteId);
    db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM queue WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
    db.prepare('DELETE FROM cards WHERE id = ?').run(carteId);
    db.close();
  }

  const echecs = results.filter((r) => !r.ok);
  console.log(`\n${results.length - echecs.length}/${results.length} contrôles au vert`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
