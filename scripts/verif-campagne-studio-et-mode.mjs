#!/usr/bin/env node
/**
 * CAMPAGNE, STUDIO ET MODE DU CHAMP (carte du 11/11/2026, capture #b1ff) — sur un DÉMON JETABLE, sans aucun moteur :
 *
 *  1. le bloc de suivi d'une création du Studio, dans le fil de l'agent qui l'a demandée, est un LECTEUR :
 *     « Voir la dernière version » monte l'aperçu EN DIRECT (lecture seule) ; un export prêt se lit dans le lecteur
 *     vidéo commun ; « Ouvrir dans le Studio » est SEUL sur sa dernière ligne ; la vidéo n'est pas redoublée dans la
 *     bande « Ce que l'agent a vu » ;
 *  2. un lien du Studio cité DANS une phrase est un simple lien souligné ; seul sur sa ligne, un bouton ;
 *  3. le champ d'écriture d'une carte à cadrer n'a plus de boutons de mode : une étiquette d'un mot, non cliquable,
 *     avec son info-bulle, dès qu'un mode est confirmé ;
 *  4. rien ne déborde, aucune erreur de page, à 1440 et 390 px, en clair et en sombre (captures si
 *     HAIKO_CAMPAGNE_STUDIO_CAPTURES est posé) ;
 *  5. (carte du 12/11/2026, captures #8ca2 et #3e3a) la conversation du Studio, après une question tranchée, se
 *     TERMINE sur la réponse de l'agent — plus sur la note « Je compose maintenant… », qui faisait croire à un travail
 *     en cours — et aucun témoin de travail ne paraît ; la Construction d'une vidéo SANS voix s'ouvre sur « Formats »,
 *     « étape 1 sur 2 », celle d'une vidéo AVEC voix garde « Voix finale », « étape 1 sur 3 ».
 *
 *   node scripts/verif-campagne-studio-et-mode.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HAIKO_CAMPAGNE_STUDIO_PORT || 7243);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.HAIKO_CAMPAGNE_STUDIO_CAPTURES || '';
if (CAPTURES) fs.mkdirSync(CAPTURES, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok: !!ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
console.log(`  …  dépôt jugé : ${RACINE}`);

const { DATA, PROJETS, attendrePort, journal, demon, nettoyer } = demarrerDemonDEssai({
  prefixe: 'verif-campagne-studio-',
  port: PORT,
  depot: false,
  env: { BELUGA_ADRESSE_PUBLIQUE: BASE, BELUGA_MARKETING_NUIT: '0', BELUGA_PUBLICATION_SOCIALE: '0', BELUGA_COULISSES_ESSAI: '1' },
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusquA(test, limite = 10_000) {
  const fin = Date.now() + limite;
  while (Date.now() < fin) {
    if (await test().catch(() => false)) return true;
    await attendre(200);
  }
  return !!(await test().catch(() => false));
}

const jeton = crypto.randomBytes(32).toString('hex');

/** Le décor, écrit par les modules du démon eux-mêmes, dans SA base jetable. */
async function poserLeDecor() {
  process.env.BELUGA_DATA = DATA;
  const shared = await import(path.join(RACINE, 'shared/dist/index.js'));
  const store = await import(path.join(RACINE, 'server/dist/store.js'));
  const { getDb, setMeta } = await import(path.join(RACINE, 'server/dist/db.js'));
  const studio = await import(path.join(RACINE, 'server/dist/studio.js'));
  const { joindreUnFichier } = await import(path.join(RACINE, 'server/dist/joindre-fichier.js'));
  const { ajouterAuJournal } = await import(path.join(RACINE, 'server/dist/journal-carte.js'));
  const db = getDb();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(crypto.createHash('sha256').update(jeton).digest('hex'), maintenant, maintenant + 3600_000, 'vérification campagne studio');
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  const dossier = path.join(PROJETS, 'p-essai');
  fs.mkdirSync(dossier, { recursive: true });
  store.saveProject(shared.Project.parse({ id: 'p-essai', name: 'Kipou', path: dossier, createdAt: maintenant, updatedAt: maintenant }));

  /* Une carte à cadrer, mode Studio (vidéo) confirmé : l'étiquette doit paraître. */
  const carte = store.saveCard(
    shared.Card.parse({
      id: 'c-cadrage',
      projectId: 'p-essai',
      title: 'Vidéo de lancement',
      column: 'planned',
      position: 1,
      run: { engine: 'claude' },
      parcours: { plans: [], realisationSouhaitee: true },
      realisation: { ...shared.realisationNeuve(), medias: ['video'] },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  const cadrage = store.saveAgent(shared.Agent.parse({ id: 'ag-cadrage', projectId: 'p-essai', cardId: carte.id, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }));
  store.saveCard({ ...store.getCard(carte.id), agentId: cadrage.id });

  /* L'agent de campagne (sans carte) et deux créations du Studio qu'il a demandées. */
  /* Le fil de l'agent qui a demandé la vidéo : celui de l'assistant flottant sert de banc — c'est le même fil de
     conversation (`Chat` → `MessageView`) que celui d'une campagne, sans monter toute une marque. */
  const { agentAssistantGlobal } = await import(path.join(RACINE, 'server/dist/assistant-global.js'));
  const campagne = agentAssistantGlobal();
  if (!campagne) throw new Error('assistant introuvable');

  const composition = shared.appliquerOperation(
    shared.compositionVide('9:16', 4),
    {
      op: 'lot',
      operations: [
        { op: 'inserer', pisteId: 'vecteurs', segment: { id: 'd1', genre: 'texte', debut: 0, duree: 4, texte: 'Kipou', taille: 140, couleur: '#ffffff', position: { x: 50, y: 50 } } },
      ],
    },
    () => crypto.randomUUID().slice(0, 8),
  );
  if (!composition.ok) throw new Error(`composition : ${JSON.stringify(composition)}`);
  const enDirect = studio.creerCreation({ projectId: 'p-essai', titre: 'Teaser de rentrée', formats: ['9:16'], composition: composition.composition });
  const finie = studio.creerCreation({ projectId: 'p-essai', titre: 'Film de lancement', formats: ['9:16'], composition: composition.composition });
  if (!enDirect.ok || !finie.ok) throw new Error('créations');

  /* Une vraie petite vidéo, jointe comme un export prêt. */
  const mp4 = path.join(DATA, 'film-essai.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x6d28d9:s=360x640:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4]);
  const jointe = await joindreUnFichier({ projectId: 'p-essai', agentId: campagne.id, fichier: mp4, nom: 'film-de-lancement.mp4' });
  if (!jointe.ok) throw new Error(`pièce : ${jointe.raison ?? ''}`);
  const exportPret = studio.creerExport({ creation: studio.lireCreation(finie.creation.id), format: '9:16', genre: 'video', voixEnEssai: 0 });
  studio.majExport(exportPret.id, { etat: 'pret', attachmentId: jointe.attachment.id });

  const message = (id, contenu, decalage, extra = {}) =>
    store.saveMessage(shared.Message.parse({ id, agentId: campagne.id, role: 'assistant', content: contenu, createdAt: maintenant + decalage, ...extra }));
  message('m-intro', 'Je lance la vidéo dans le Studio.', 0);
  for (const [creation, bloc, decalage, exports, attachments] of [
    [enDirect.creation, 'b-direct', 1000, [], []],
    [finie.creation, 'b-fini', 2000, [{ exportId: exportPret.id, attachmentId: jointe.attachment.id, format: '9:16' }], [jointe.attachment.id]],
  ]) {
    setMeta(`studio.demandeur.${creation.id}`, campagne.id);
    setMeta(`studio.genre.${creation.id}`, 'video');
    setMeta(`studio.suivi.${creation.id}`, bloc);
    message(
      bloc,
      `🎬 **Vidéo « ${creation.titre} » — Studio**\n\nÉtape : montage.\n\n[Ouvrir dans le Studio](#studio/${creation.id})`,
      decalage,
      {
        attachments,
        suiviStudio: {
          creationId: creation.id,
          genre: 'video',
          titre: creation.titre,
          etape: exports.length ? 'telechargement' : 'montage',
          phrase: exports.length ? 'Téléchargement — la vidéo est prête' : 'Montage — la vidéo s’assemble dans le Studio',
          version: creation.version,
          formats: ['9:16'],
          exportEnCours: false,
          exports,
          /* LE DIRECTEUR DU STUDIO EN DIRECT (12/11/2026) : sa liste de tâches tant qu'il travaille, son compte rendu ensuite. */
          ...(exports.length
            ? { taches: [{ label: 'Raccourcir la fin', state: 'done' }, { label: 'Changer la musique', state: 'done' }], directeurAuTravail: false, compteRendu: 'J’ai raccourci la fin et changé la musique : la version 2 est prête.' }
            : { taches: [{ label: 'Relire la demande de retouche', state: 'done' }, { label: 'Monter la nouvelle fin', state: 'running' }, { label: 'Exporter la vidéo', state: 'todo' }], directeurAuTravail: true }),
        },
      },
    );
  }
  /* UNE CARTE POSÉE PAR L'AGENT DE NUIT, sans jalon « Demande » (capture #6e9b) : sa demande doit se lire en bulle. */
  const nuit = store.saveAgent(shared.Agent.parse({ id: 'ag-nuit', projectId: 'p-essai', role: 'analysis', title: 'Auto-amélioration — nuit du 12.11.2026', run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant }));
  const carteNuit = store.saveCard(
    shared.Card.parse({
      id: 'c-nuit',
      projectId: 'p-essai',
      title: 'Contrôles navigateur aux repères disparus',
      column: 'planned',
      position: 2,
      origin: 'agent',
      origineAgentId: nuit.id,
      labels: ['auto amélioration'],
      description: 'Résumé court de la carte de nuit.',
      briefing: 'Cinq contrôles du navigateur visent des repères qui ont disparu de l’écran : les réaligner sur les repères actuels.',
      run: { engine: 'claude' },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  const cadrageNuit = store.saveAgent(shared.Agent.parse({ id: 'ag-cadrage-nuit', projectId: 'p-essai', cardId: carteNuit.id, role: 'cadrage', title: 'Cadrage', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }));
  store.saveCard({ ...store.getCard(carteNuit.id), agentId: cadrageNuit.id });
  /* AUCUN VRAI TOUR : le filet « cadrage jamais parti » relancerait le moteur à l'ouverture de la carte
     (`relancerLeCadrageJamaisParti`, `maxAgents: 0` ne retient pas un tour silencieux) — on le dit déjà parti. */
  setMeta(`premier-tour-cadrage:${carteNuit.id}`, String(maintenant));
  ajouterAuJournal({ cardId: carteNuit.id, phase: 'cadrage', nature: 'jalon', libelle: 'Tour lancé', agentId: cadrageNuit.id, agentRole: 'cadrage' });
  ajouterAuJournal({ cardId: carteNuit.id, phase: 'cadrage', nature: 'requete', libelle: 'memoire', outil: 'memoire', resultat: '8 unités', reussie: true, agentId: cadrageNuit.id, agentRole: 'cadrage' });

  /* LA CONSTRUCTION SUIT LE MÉDIA : une création AVEC une voix (l'autre, « Teaser de rentrée », n'en a pas). */
  const avecVoix = shared.appliquerOperation(
    composition.composition,
    { op: 'inserer', pisteId: 'voix', segment: { id: 'v1', genre: 'voix', debut: 0, duree: 3, texte: 'Bonjour, voici Kipou.' } },
    () => crypto.randomUUID().slice(0, 8),
  );
  if (!avecVoix.ok) throw new Error(`voix : ${JSON.stringify(avecVoix)}`);
  const parlee = studio.creerCreation({ projectId: 'p-essai', titre: 'Vidéo parlée', formats: ['9:16'], composition: avecVoix.composition });
  if (!parlee.ok) throw new Error('création parlée');

  /* LE FIL DU STUDIO APRÈS UNE QUESTION TRANCHÉE (capture #8ca2) : un directeur au repos, dont le tour a posé une
     question, reçu « Sans voix », noté la suite, puis rendu sa réponse — tout dans le MÊME message. */
  const dirigee = studio.creerCreation({ projectId: 'p-essai', titre: 'Démo du coffre-fort', formats: ['9:16'], composition: composition.composition });
  if (!dirigee.ok) throw new Error('création dirigée');
  const carteStudio = store.saveCard(
    shared.Card.parse({
      id: 'c-studio',
      projectId: 'p-essai',
      title: 'Studio — Démo du coffre-fort',
      column: 'planned',
      position: 3,
      run: { engine: 'claude' },
      parcours: { plans: [], realisationSouhaitee: true },
      realisation: { ...shared.realisationNeuve(), medias: ['video'] },
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
  );
  const directeur = store.saveAgent(shared.Agent.parse({ id: 'ag-directeur', projectId: 'p-essai', cardId: carteStudio.id, role: 'cadrage', title: 'Directeur artistique', run: { engine: 'claude' }, status: 'done', createdAt: maintenant, updatedAt: maintenant }));
  store.saveCard({ ...store.getCard(carteStudio.id), agentId: directeur.id });
  setMeta(`premier-tour-cadrage:${carteStudio.id}`, String(maintenant));
  db.prepare('UPDATE studio_creations SET card_id = ?, agent_id = ? WHERE id = ?').run(carteStudio.id, directeur.id, dirigee.creation.id);
  const REPONSE = 'J’ai fait la première version complète : elle dure quatre secondes, sans voix, avec une musique douce.';
  store.saveMessage(shared.Message.parse({ id: 'm-dir-demande', agentId: directeur.id, role: 'user', content: 'Une démo du coffre-fort, au style du site.', createdAt: maintenant - 60_000 }));
  store.saveMessage(
    shared.Message.parse({
      id: 'm-dir-reponse',
      agentId: directeur.id,
      role: 'assistant',
      content: REPONSE,
      createdAt: maintenant - 59_000,
      questions: [{ id: 'q1', question: 'Voix off pour cette démo ?', kind: 'single', options: [{ id: 'o0', label: 'Sans voix, musique douce seule' }, { id: 'o1', label: 'Voix off calme' }], answer: 'Sans voix, musique douce seule' }],
    }),
  );
  const parDirecteur = { cardId: carteStudio.id, agentId: directeur.id, agentRole: 'cadrage' };
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'jalon', libelle: 'Demande', resultat: 'Une démo du coffre-fort, au style du site.', donnees: { messageId: 'm-dir-demande', titreDuPoint: 'Démo du coffre-fort' }, at: maintenant - 60_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'jalon', libelle: 'Tour lancé', at: maintenant - 59_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'requete', libelle: 'memoire', outil: 'memoire', resultat: '8 unités', reussie: true, at: maintenant - 58_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'requete', libelle: 'Question posée', outil: 'mcp__beluga__ask_user', params: { question: 'Voix off pour cette démo ?', kind: 'single', options: [{ label: 'Sans voix, musique douce seule' }, { label: 'Voix off calme' }] }, resultat: 'Réponse de l’utilisateur : Sans voix, musique douce seule', reussie: true, at: maintenant - 50_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'jalon', libelle: shared.JALON_NOTE_DE_L_AGENT, resultat: 'Pas de voix, donc. Je compose maintenant la musique douce.', at: maintenant - 49_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'requete', libelle: 'Lecture', outil: 'Read', params: { file_path: 'README.md' }, resultat: 'ok', reussie: true, at: maintenant - 40_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'cadrage', nature: 'jalon', libelle: shared.JALON_NOTE_DE_L_AGENT, resultat: 'Musique posée, je relis la version.', at: maintenant - 30_000 });
  ajouterAuJournal({ ...parDirecteur, phase: 'rapport', nature: 'jalon', libelle: 'Réponse rendue', resultat: REPONSE, reussie: true, at: maintenant - 20_000 });

  message('m-lien', `La retouche est partie : tu peux suivre le montage dans [le Studio](#studio/${finie.creation.id}) si tu veux.\n\n[Ouvrir dans le Studio](#studio/${finie.creation.id})`, 3000);
  const themeSombre = shared.themeChoisiDepuisReglage({ ambiance: shared.AMBIANCES[0].id, clarte: 'sombre', automatique: false });
  const themeClair = shared.themeChoisiDepuisReglage({ ambiance: shared.AMBIANCES[0].id, clarte: 'clair', automatique: false });
  return { carte, carteNuit, campagne, piece: jointe.attachment.id, enDirect: enDirect.creation.id, parlee: parlee.creation.id, dirigee: dirigee.creation.id, themeSombre, themeClair };
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  for (const sombre of [false, true]) {
    await page.evaluate((s) => document.documentElement.classList.toggle('dark', s), sombre);
    await attendre(300);
    await page.screenshot({ path: path.join(CAPTURES, `${nom}-${sombre ? 'sombre' : 'clair'}.png`) }).catch(() => undefined);
  }
  await page.evaluate(() => document.documentElement.classList.toggle('dark', false));
}

/** La conversation de l'agent demandeur : le rond de l'assistant, en bas à droite. */
async function ouvrirLAgent(page, telephone) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  /* Le rond flotte sur ordinateur ; au téléphone, c'est le bouton de l'entête. */
  const rond = page.locator('[data-bouton-du-bord]:visible').first();
  await rond.waitFor({ timeout: 20000 });
  await attendre(1500);
  /* L'état ouvert de l'assistant est RETENU d'un appareil à l'autre : on ne l'ouvre que s'il est fermé. */
  if ((await rond.getAttribute('data-ouvert')) !== 'oui') {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('beluga:ouvrir-assistant')));
  }
  await page.locator('[data-assistant-chat], [data-assistant-conversation]').first().waitFor({ timeout: 15000 }).catch(() => undefined);
}

async function main() {
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  const decor = await poserLeDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [nom, viewport, telephone] of [
      ['ordinateur', { width: 1440, height: 900 }, false],
      ['telephone', { width: 390, height: 844 }, true],
    ]) {
      /* SANS `serviceWorkers: 'block'` : le blocage de Playwright lit `navigator.serviceWorker` jusque dans le cadre
         isolé de l'aperçu (sans `allow-same-origin`) et y lève une SecurityError qui n'existe pas pour l'utilisateur. */
      const contexte = await navigateur.newContext({ viewport, locale: 'fr-CH', ...(telephone ? { isMobile: true, hasTouch: true } : {}) });
      await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await contexte.newPage();
      const erreurs = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));

      /* -------- 1. Le fil de campagne : le lecteur -------- */
      await ouvrirLAgent(page, telephone);
      const blocFini = page.locator(`[data-bloc-du-studio]`).filter({ has: page.locator('[data-bloc-du-studio-fichier]') }).first();
      noter(`${nom} · le bloc d’une vidéo prête montre le lecteur`, await jusquA(async () => (await blocFini.locator('video').count()) === 1, 20000));
      noter(`${nom} · « Ouvrir dans le Studio » est le DERNIER élément du bloc, seul sur sa ligne`, await page.evaluate(() => {
        const bloc = [...document.querySelectorAll('[data-bloc-du-studio]')].at(-1);
        const bouton = bloc?.lastElementChild;
        if (!bouton?.hasAttribute('data-ouvrir-le-studio')) return false;
        const r = bouton.getBoundingClientRect();
        const avant = bouton.previousElementSibling?.getBoundingClientRect();
        return getComputedStyle(bouton).display === 'flex' && (!avant || r.top >= avant.bottom - 1);
      }));
      noter(`${nom} · la vidéo n’est pas redoublée dans « Ce que l’agent a vu »`, (await page.locator(`video[src*="${decor.piece}"]`).count()) === 1, `${await page.locator(`video[src*="${decor.piece}"]`).count()} lecteur(s)`);
      await blocFini.scrollIntoViewIfNeeded().catch(() => undefined);
      await capturer(page, `fil-video-finie-${nom}`);
      const blocDirect = page.locator('[data-bloc-du-studio]').filter({ has: page.locator('[data-bloc-du-studio-lire-apercu]') }).first();
      noter(`${nom} · sans export, rien de lourd avant le clic : une affiche « Voir la dernière version »`, (await blocDirect.locator('iframe').count()) === 0);
      await blocDirect.locator('[data-bloc-du-studio-lire-apercu]').scrollIntoViewIfNeeded();
      await blocDirect.locator('[data-bloc-du-studio-lire-apercu]').click();
      noter(`${nom} · au clic, l’aperçu en direct se monte (cadre isolé)`, await jusquA(async () => (await page.locator('[data-bloc-du-studio-apercu="pret"] iframe').count()) === 1, 20000));
      noter(`${nom} · et il lit tout seul`, await jusquA(async () => (await page.locator('[data-bloc-du-studio-lecture="lit"]').count()) === 1, 10000));
      await page.locator('[data-bloc-du-studio-voile]').first().click();
      noter(`${nom} · un clic sur l’image met en pause (lecture seule, aucune sélection)`, await jusquA(async () => (await page.locator('[data-bloc-du-studio-lecture="arret"]').count()) === 1, 5000));
      /* L'APERÇU S'AGRANDIT (12/11/2026) : la même composition, en fenêtre. */
      await page.locator('[data-bloc-du-studio-agrandir-apercu]').first().click();
      noter(`${nom} · l’aperçu en direct s’agrandit dans une fenêtre`, await jusquA(async () => (await page.locator('[data-fenetre-apercu-studio] iframe').count()) === 1, 15000));
      await capturer(page, `apercu-agrandi-${nom}`);
      await page.keyboard.press('Escape');
      await jusquA(async () => (await page.locator('[data-fenetre-apercu-studio]').count()) === 0, 5000);
      /* LA LISTE DE TÂCHES DU DIRECTEUR, EN DIRECT, puis son compte rendu (12/11/2026, capture #8adf). */
      noter(`${nom} · le bloc montre ce que fait le directeur du Studio, ligne en cours en violet`, (await page.locator('[data-bloc-du-studio-taches="en-cours"]').count()) === 1 && (await page.locator('[data-bloc-du-studio-taches="en-cours"] [data-bloc-du-studio-tache="running"]').count()) === 1 && (await page.locator('[data-bloc-du-studio-taches="en-cours"] [data-bloc-du-studio-tache]').count()) === 3);
      noter(`${nom} · une fois fini, le bloc porte le compte rendu du directeur`, (await page.locator('[data-bloc-du-studio-taches="fini"] [data-bloc-du-studio-compte-rendu]').innerText().catch(() => '')).includes('raccourci la fin'));
      await page.locator('[data-bloc-du-studio-taches="en-cours"]').scrollIntoViewIfNeeded().catch(() => undefined);
      await capturer(page, `fil-taches-du-directeur-${nom}`);

      /* -------- 2. Les liens du Studio dans le texte -------- */
      noter(`${nom} · cité dans une phrase : un simple lien`, (await page.locator('[data-lien-du-studio]').count()) >= 1 && (await page.locator('p:has([data-lien-du-studio]) [data-ouvrir-le-studio]').count()) === 0);
      noter(`${nom} · seul sur sa ligne : un bouton posé en bloc`, (await page.locator('.prose-hd [data-ouvrir-le-studio]').count()) >= 1);
      noter(`${nom} · rien ne déborde dans le fil`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
      await capturer(page, `fil-campagne-${nom}`);

      /* -------- 3. Plus d'étiquette du mode dans le champ (24/11/2026) -------- */
      await page.goto(`${BASE}/#projet/p-essai/tache/${decor.carte.id}`, { waitUntil: 'domcontentloaded' });
      noter(`${nom} · le champ est là`, await jusquA(async () => (await page.locator('[data-composer] textarea').count()) >= 1, 20000));
      noter(`${nom} · plus aucun bouton de mode dans le champ`, (await page.locator('[data-interrupteur-plan], [data-interrupteur-creation], [data-interrupteur-realisation]').count()) === 0);
      noter(`${nom} · rien ne déborde sur la carte`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
      await capturer(page, `champ-sans-etiquette-${nom}`);

      /* -------- 4. La demande d'une carte posée par l'agent de nuit -------- */
      await page.goto(`${BASE}/#projet/p-essai/tache/${decor.carteNuit.id}`, { waitUntil: 'domcontentloaded' });
      const bulle = page.locator('[data-bulle="utilisateur"]').first();
      noter(`${nom} · la carte de nuit montre sa demande en bulle`, await jusquA(async () => (await bulle.innerText().catch(() => '')).includes('repères qui ont disparu'), 20000), await bulle.innerText().catch(() => ''));
      noter(`${nom} · la bulle dit qui l’a écrite`, (await page.locator('[data-auteur-demande]').first().innerText().catch(() => '')).includes('nuit'));
      await capturer(page, `carte-de-nuit-${nom}`);

      if (telephone) {
        /* -------- 5. Le rond violet du Studio, au téléphone -------- */
        await page.goto(`${BASE}/#studio/${decor.enDirect}`, { waitUntil: 'domcontentloaded' });
        const rondViolet = page.locator('[data-centre-du-bas="action"][data-bouton-du-bas="mise-en-production"]');
        noter(`${nom} · dans une création du Studio, le menu du bas porte le rond violet de la Construction`, await jusquA(async () => (await rondViolet.count()) === 1 && (await rondViolet.isVisible()), 20000));
        /* L'APERÇU S'OUVRE SUR UN INSTANT PARLANT (capture #8ca2) : le titre « Kipou » court de 0 à 4 s, la tête de
           lecture s'ouvre une seconde après son entrée, jamais sur le cadre vide de t = 0. */
        const tete = page.locator('[data-studio-temps]').first();
        noter(
          `${nom} · l’aperçu s’ouvre à 1 s, sur le titre, pas sur le cadre vide de 0 s`,
          await jusquA(async () => /^1\.00/.test(((await tete.textContent().catch(() => '')) ?? '').trim()), 15000),
          ((await tete.textContent().catch(() => '')) ?? '').trim(),
        );
        await capturer(page, `studio-rond-violet-${nom}`);
        await rondViolet.tap();
        noter(`${nom} · le rond ouvre la Construction (version finale et export)`, await jusquA(async () => (await page.locator('[data-studio-etape-production]').count()) >= 1, 10000));
        await capturer(page, `studio-construction-${nom}`);
        /* LA CONSTRUCTION SUIT LE MÉDIA : « Teaser de rentrée » n'a aucune voix. */
        const sousTitre = page.locator('[data-studio-etape-production]').first();
        noter(
          `${nom} · une vidéo sans voix ouvre la Construction sur « Formats », étape 1 sur 2`,
          (await page.locator('[data-studio-fenetre-production="formats"]').count()) === 1 &&
            (await sousTitre.getAttribute('data-studio-etapes-production')) === 'formats,fichiers' &&
            /étape 1 sur 2/.test(await sousTitre.innerText()),
          await sousTitre.innerText().catch(() => ''),
        );
        noter(`${nom} · et ne parle nulle part de voix finale`, !/Voix finale/.test(await page.locator('[data-studio-fenetre-production]').innerText().catch(() => '')));
        await page.goto(`${BASE}/#studio/${decor.parlee}`, { waitUntil: 'domcontentloaded' });
        await jusquA(async () => (await rondViolet.count()) === 1 && (await rondViolet.isVisible()), 20000);
        await rondViolet.tap();
        noter(
          `${nom} · une vidéo AVEC voix garde « Voix finale », étape 1 sur 3`,
          await jusquA(async () => (await page.locator('[data-studio-fenetre-production="voix"]').count()) === 1 && /étape 1 sur 3/.test(await page.locator('[data-studio-etape-production]').first().innerText()), 10000),
        );
        await capturer(page, `studio-construction-avec-voix-${nom}`);
      } else {
        /* -------- 6. Deux onglets : chacun garde sa page, le thème suit -------- */
        const autre = await contexte.newPage();
        await page.goto(`${BASE}/#projet/p-essai`, { waitUntil: 'domcontentloaded' });
        await autre.goto(`${BASE}/#projet/p-essai`, { waitUntil: 'domcontentloaded' });
        const etatColonne = (p) => p.getAttribute('[data-colonne-projets]', 'data-colonne-projets').catch(() => null);
        await page.locator('[data-replier-colonne="depliee"]').first().waitFor({ timeout: 20000 });
        await autre.locator('[data-colonne-projets]').first().waitFor({ timeout: 20000 });
        await page.locator('[data-replier-colonne="depliee"]').first().click();
        const reduiteIci = await jusquA(async () => (await etatColonne(page)) !== 'depliee', 5000);
        await attendre(2000);
        noter('deux onglets · replier la colonne dans un onglet ne la replie pas dans l’autre', reduiteIci && (await etatColonne(autre)) === 'depliee', `${await etatColonne(page)} / ${await etatColonne(autre)}`);
        await page.locator('[data-replier-colonne="reduite"]').first().click().catch(() => undefined);
        /* Le THÈME, lui, suit : un autre onglet qui le change (rejoué par un canal à part) change celui-ci. */
        const sombreAvant = await autre.evaluate(() => document.documentElement.classList.contains('dark'));
        const voulu = sombreAvant ? decor.themeClair : decor.themeSombre;
        const accuse = await page.evaluate(
          (valeur) =>
            new Promise((fin) => {
              const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
              ws.onopen = () => ws.send(JSON.stringify({ id: 'essai-theme', cmd: { type: 'prefs.set', key: 'theme', value: valeur, onglet: 'onglet-d-essai' } }));
              ws.onmessage = (m) => {
                if (String(m.data).includes('essai-theme')) {
                  ws.close();
                  fin(true);
                }
              };
              setTimeout(() => fin(false), 8000);
            }),
          voulu,
        );
        noter('deux onglets · le thème changé ailleurs suit dans cet onglet', accuse && (await jusquA(async () => (await autre.evaluate(() => document.documentElement.classList.contains('dark'))) !== sombreAvant, 8000)));
        await autre.close();
      }

      /* -------- 7. Le fil du Studio après une question tranchée (capture #8ca2) -------- */
      await page.goto(`${BASE}/#studio/${decor.dirigee}`, { waitUntil: 'domcontentloaded' });
      /* L'assistant, ouvert plus haut (et retenu d'un appareil à l'autre), recouvrirait le Studio : on le referme. */
      const fermerAssistant = page.locator('[aria-label="Fermer l’assistant"]:visible').first();
      if (await jusquA(async () => (await fermerAssistant.count()) === 1, 5000)) await fermerAssistant.click().catch(() => undefined);
      if (telephone) {
        await page.locator('[data-studio-ouvrir="agent"]').first().waitFor({ timeout: 20000 });
        await page.locator('[data-studio-ouvrir="agent"]').first().click();
      }
      const conversation = page.locator('[data-studio-agent="conversation"]');
      noter(`${nom} · la conversation du Studio montre la réponse de l’agent`, await jusquA(async () => (await conversation.locator('[data-reponse-du-point="apres-le-recit"]').innerText().catch(() => '')).includes('première version complète'), 20000));
      const ordre = await page.evaluate(() => {
        const c = document.querySelector('[data-studio-agent="conversation"]');
        const texte = c?.innerText ?? '';
        const iReponse = texte.lastIndexOf('première version complète');
        return {
          noteAvant: texte.indexOf('Je compose maintenant') >= 0 && texte.indexOf('Je compose maintenant') < iReponse,
          questionAvant: texte.indexOf('Voix off pour cette démo') >= 0 && texte.indexOf('Voix off pour cette démo') < iReponse,
          titreAvecLaReponse: texte.lastIndexOf('Démo du coffre-fort') < iReponse && texte.lastIndexOf('Démo du coffre-fort') > texte.indexOf('Je compose maintenant'),
          derniere: texte.slice(iReponse).replace(/\s+/g, ' ').slice(0, 200),
        };
      });
      noter(`${nom} · la question tranchée et la note « Je compose maintenant… » viennent AVANT la réponse`, ordre.noteAvant && ordre.questionAvant, JSON.stringify(ordre));
      noter(`${nom} · le titre de la réponse reste collé à sa réponse, en bas`, ordre.titreAvecLaReponse);
      noter(
        `${nom} · aucun témoin de travail : le bouton Construction est allumé et rien ne tourne`,
        (await page.locator('[data-studio-mettre-en-production="fil"][data-geste-possible="oui"]').count()) === 1 &&
          (await conversation.locator('[data-point-de-la-carte="encours"], [data-point-attente]').count()) === 0,
      );
      await conversation.locator('[data-reponse-du-point]').scrollIntoViewIfNeeded().catch(() => undefined);
      await capturer(page, `studio-fil-apres-question-${nom}`);

      noter(`${nom} · aucune erreur de page`, erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
}

try {
  await main();
} catch (err) {
  noter('l’essai va au bout', false, String(err?.stack ?? err).slice(0, 400));
} finally {
  demon.kill('SIGTERM');
  await attendre(500);
  nettoyer?.();
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles réussis.`);
process.exit(echecs ? 1 : 0);
