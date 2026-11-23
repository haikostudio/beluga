#!/usr/bin/env node
/**
 * LA MISE EN PRODUCTION D'UN REGROUPEMENT, dans un VRAI navigateur :
 *
 *  - le bouton de mise en production d'un regroupement est dans la barre
 *    d'en-tête de la page, hors de toute colonne (11/10/2026 : plus de bandeau
 *    en bas du tableau), et sa pastille dit la SOMME des versions en attente de
 *    ses membres ;
 *  - son tiroir liste UNE LIGNE PAR MEMBRE, sans interrupteur, sans réglages
 *    d'entête et sans bouton « Initier » : le groupe ne publie rien lui-même ;
 *  - un membre sans processus, ou dont l'interrupteur est éteint, a un bouton
 *    éteint ET sa raison écrite en clair ;
 *  - le bouton général compte les membres prêts, ne demande QU'UNE confirmation
 *    et envoie un `deploy.start` par membre prêt, EN MÊME TEMPS ;
 *  - un refus du serveur s'écrit sur la ligne de son projet sans retenir
 *    l'autre lancement ;
 *  - le bouton d'une ligne n'envoie qu'UN `deploy.start`, pour ce projet ;
 *  - le bandeau fermé porte la moyenne des mises en production en route, et ne
 *    reste pas « en cours » quand l'une réussit pendant que l'autre échoue ;
 *  - un clic sur une ligne ouvre le déroulé du membre, avec un retour ;
 *  - sur téléphone, où ce bouton n'est plus dessiné, la page s'ouvre par la
 *    ligne « Mise en production » du menu à trois points ; rien n'y déborde et
 *    chaque bouton reste entier à l'écran ;
 *  - chaque carte de projet porte ses réglages dans le COIN HAUT DROIT et son
 *    bouton sur TOUTE LA LARGEUR, dessous (05/10/2026) ;
 *  - une mise en production pose une carte Système en tête de « En cours » du
 *    tableau du groupe tant qu'elle tourne — plus de cadre violet depuis la
 *    refonte monochrome : c'est sa tête, « Mise en production », qui la
 *    distingue ; terminée, elle quitte le tableau, sans point bleu ni lecture
 *    envoyée (06/10/2026) ;
 *  - « Tableaux de bord », page rechargée : la carte d'une mise en production
 *    en cours est dans « Actifs », celle d'une terminée depuis moins de 24 h
 *    dans « Archiver », plus basse qu'une carte, relues en BASE ; aucune ne
 *    porte de point bleu ni n'allume le repère bleu du projet.
 *
 * Démon et base d'ESSAI à soi (`BELUGA_GROUPE_PORT`), plafond d'agents à zéro :
 * aucun moteur appelé, aucune publication réelle. Les `deploy.start` sont
 * RETENUS avant de partir, et le contrôle y répond lui-même (`ack`) ; les
 * déroulés sont injectés dans le canal temps réel, comme le démon les diffuse.
 *
 *   node scripts/verif-production-groupe.mjs
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerDemonDEssai } from './lib/demon-d-essai.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_GROUPE_PORT || 7214);
const BASE = `http://127.0.0.1:${PORT}`;
const { TMP, DATA, DEPOT, journal, attendrePort } = demarrerDemonDEssai({
  prefixe: 'verif-production-groupe-',
  port: PORT,
});

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const GROUPE = 'p-groupe';
const A = 'm-interface';
const B = 'm-serveur';
const SANS = 'm-sans-processus';
const ETEINT = 'm-eteint';
const PROCESSUS = { processus: { etapes: [{ libelle: 'Contrôle', commande: 'true', delaiS: 10 }] } };

function depotGit(nom) {
  const dossier = path.join(TMP, nom);
  fs.mkdirSync(dossier, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dossier });
  execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', 'commit', '--allow-empty', '-qm', 'départ'], { cwd: dossier });
  return dossier;
}

function poserDecor() {
  const db = new Database(path.join(DATA, 'beluga.db'));
  const t = Date.now();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    t,
    t + 3_600_000,
    'vérification de la mise en production d’un regroupement',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM deploys').run();

  const dossierDuGroupe = path.join(DATA, 'regroupements', GROUPE);
  fs.mkdirSync(dossierDuGroupe, { recursive: true });
  const base = { defaultEngine: 'claude', isSelf: false, archived: false, deploiement: {}, createdAt: t, updatedAt: t };
  const projets = [
    { ...base, id: GROUPE, name: 'Essai groupe', path: dossierDuGroupe, rank: 1, regroupement: true, miseEnProduction: {} },
    { ...base, id: A, name: 'Interface', path: DEPOT, rank: 2, regroupementId: GROUPE, deploiement: PROCESSUS, miseEnProduction: PROCESSUS, miseEnProductionActive: true },
    { ...base, id: B, name: 'Serveur', path: depotGit('depot-serveur'), rank: 3, regroupementId: GROUPE, deploiement: PROCESSUS, miseEnProduction: PROCESSUS, miseEnProductionActive: true },
    { ...base, id: SANS, name: 'Sans processus', path: depotGit('depot-sans'), rank: 4, regroupementId: GROUPE, miseEnProduction: {}, miseEnProductionActive: true },
    { ...base, id: ETEINT, name: 'Interrupteur éteint', path: depotGit('depot-eteint'), rank: 5, regroupementId: GROUPE, miseEnProduction: PROCESSUS, miseEnProductionActive: false },
  ];
  for (const projet of projets) {
    db.prepare(
      'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), t, t);
  }

  /* « INTERFACE » EST À DEUX ENREGISTREMENTS DE SA PRODUCTION ; « Serveur » n'a
     jamais été mis en production : la pastille du groupe doit dire 2. */
  const git = (...a) => execFileSync('git', ['-c', 'user.email=essai@local', '-c', 'user.name=essai', ...a], { cwd: DEPOT }).toString().trim();
  const enLigne = git('rev-parse', 'HEAD');
  for (const n of [1, 2]) git('commit', '--allow-empty', '-qm', `après la mise en ligne ${n}`);
  const fin = t - 3 * 24 * 3_600_000;
  const ancienne = {
    id: 'r-ancienne',
    projectId: A,
    state: 'success',
    cible: 'production',
    steps: [],
    cardIds: [],
    reprises: 0,
    repriseApresCoupure: false,
    queued: false,
    startedAt: fin - 60_000,
    endedAt: fin,
    targetCommit: enLigne,
  };
  db.prepare(
    'INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(ancienne.id, A, 'success', JSON.stringify(ancienne), ancienne.startedAt, ancienne.endedAt);
  db.close();
}

const etape = (key, state) => ({ key, state, log: '' });
const deroule = (projectId, patch) => ({
  id: `r-${projectId}`,
  projectId,
  state: 'running',
  cible: 'production',
  steps: [],
  cardIds: [],
  reprises: 0,
  repriseApresCoupure: false,
  queued: false,
  startedAt: Date.now(),
  ...patch,
});

async function ouvrirLeTableau(navigateur, viewport, telephone = false) {
  const contexte = await navigateur.newContext({
    viewport,
    isMobile: telephone,
    hasTouch: telephone,
    locale: 'fr-CH',
    serviceWorkers: 'block',
  });
  await contexte.addCookies([{ name: 'beluga_session', value: jeton, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.addInitScript(() => {
    /* « deploy.start » est RETENU avant de partir : rien n'est publié, et le
       contrôle répond lui-même à chaque demande, par son identifiant. */
    window.__starts = [];
    window.__lectures = [];
    const envoyer = WebSocket.prototype.send;
    WebSocket.prototype.send = function (donnees) {
      if (String(donnees).includes('"deploy.start"')) {
        const { id, cmd } = JSON.parse(String(donnees));
        window.__starts.push({ id, projectId: cmd.projectId, cible: cmd.cible, at: Date.now() });
        return;
      }
      /* « deploy.read » n'existe plus (06/10/2026) : s'il partait encore, il serait NOTÉ ici. */
      if (String(donnees).includes('"deploy.read"')) window.__lectures.push(JSON.parse(String(donnees)).cmd.runId);
      return envoyer.call(this, donnees);
    };
    window.__ecouteurs = [];
    const propriete = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() {
        return propriete.get.call(this);
      },
      set(ecouteur) {
        window.__ecouteurs.push(ecouteur);
        return propriete.set.call(this, ecouteur);
      },
    });
    window.__injecter = (evenement) => {
      const donnees = JSON.stringify(evenement);
      for (const ecouteur of window.__ecouteurs) ecouteur({ data: donnees });
    };
  });
  await page.goto(`${BASE}/#projet/${GROUPE}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);
  /* Plus de bouton « Tableau » à activer : le bas du téléphone ne porte plus de
     barre. Le composant de mise en production est MONTÉ dans les deux cas, mais
     ne se dessine que sur ordinateur (dans la barre d'en-tête) : sur téléphone
     il reste caché et parle par le menu à trois points. */
  await page.waitForSelector(`[data-bandeau-production="${GROUPE}"]`, { state: telephone ? 'attached' : 'visible', timeout: 30_000 });
  return { contexte, page, erreurs };
}

const injecter = (page, evenement) => page.evaluate((evenement) => window.__injecter(evenement), evenement);
const injecterDeroule = (page, run) => injecter(page, { type: 'deploy.upsert', run });
const starts = (page) => page.evaluate(() => window.__starts);
const repondre = (page, id, ok, error) => injecter(page, { type: 'ack', id, ok, data: ok ? { ok: true } : undefined, error });

const RELEVE = () => {
  const bandeau = document.querySelector('[data-bandeau-production]');
  if (!bandeau) return null;
  const entete = document.querySelector('[data-entete-tiroir-production]');
  const ouvreur = bandeau.querySelector('[data-ouvrir-tiroir-production]');
  const pastille = bandeau.querySelector('[data-mises-a-jour-en-attente]');
  const chiffre = bandeau.querySelector('[data-pourcent-bandeau]');
  const barre = bandeau.querySelector('[data-barre-bandeau]');
  const general = document.querySelector('[data-bouton-production-groupe]');
  const lignes = [...document.querySelectorAll('[data-membre-production]')].map((ligne) => {
    const bouton = ligne.querySelector('[data-bouton-production-membre]');
    const b = bouton?.getBoundingClientRect();
    const r = ligne.getBoundingClientRect();
    return {
      id: ligne.getAttribute('data-membre-production'),
      etat: ligne.getAttribute('data-etat-membre'),
      nom: ligne.querySelector('[data-ouvrir-membre-production] .font-medium')?.textContent?.trim() ?? null,
      eteint: bouton?.disabled ?? null,
      agent: bouton?.getAttribute('data-etat-bouton-agent') ?? null,
      enVol: !!bouton?.querySelector('.animate-spin'),
      raison: ligne.querySelector('[data-raison-membre-production]')?.textContent?.trim() ?? null,
      erreur: ligne.querySelector('[data-erreur-membre-production]')?.textContent?.trim() ?? null,
      avancement: ligne.querySelector('[data-avancement-membre]')?.getAttribute('data-avancement-membre') ?? null,
      reussite: !!ligne.querySelector('[data-reussite-membre]'),
      tombee: ligne.querySelector('[data-derniere-production]')?.textContent?.trim() ?? null,
      ecart: ligne.querySelector('[data-ecart-production]')?.textContent?.trim() ?? null,
      /* La barre de la ligne : absente (`null`), en route (« non ») ou figée en erreur (« oui »). */
      barre: (() => {
        const barre = ligne.querySelector('[data-barre-membre-production]');
        return barre ? (barre.getAttribute('data-erreur') ?? 'non') : null;
      })(),
      /* LES RÉGLAGES DANS LE COIN HAUT DROIT de la carte, le bouton DESSOUS,
         sur toute la largeur (aux marges de la carte près). */
      reglagesEnHautADroite: (() => {
        const g = ligne.querySelector('[data-reglages-membre-production]')?.getBoundingClientRect();
        return !!g && g.top - r.top < 16 && r.right - g.right < 16 && g.top >= r.top - 1;
      })(),
      boutonPleineLargeur: !!b && b.width >= r.width - 24 && b.left - r.left < 14 && r.right - b.right < 14,
      boutonSousLesReglages: (() => {
        const g = ligne.querySelector('[data-reglages-membre-production]')?.getBoundingClientRect();
        return !!b && !!g && b.top >= g.bottom - 1;
      })(),
      boutonEntier: !!b && b.left >= 0 && b.right <= window.innerWidth + 0.5,
      deborde: ligne.scrollWidth > ligne.clientWidth + 1 || r.right > window.innerWidth + 0.5,
    };
  });
  return {
    id: bandeau.getAttribute('data-bandeau-production'),
    suivi: bandeau.getAttribute('data-suivi'),
    /* SUR ORDINATEUR, le bouton vit dans la barre d'en-tête de la page. */
    dansLaBarre: !!bandeau.closest('[data-gestes-de-page="barre"]'),
    /* L'icône du bouton : la fusée au repos, la roue en route, la croix sur un échec. */
    icone: (ouvreur?.querySelector('svg')?.getAttribute('class') ?? '').match(/lucide-(rocket|loader|x)\b/)?.[1] ?? null,
    dansUneColonne: !!bandeau.closest('[data-column]'),
    deborde: bandeau.scrollWidth > bandeau.clientWidth + 1,
    /* Rien ne pousse la page en largeur — jugé sur la page entière : sur
       téléphone le composant ne dessine rien, sa propre boîte ne dirait rien. */
    pageDeborde: document.documentElement.scrollWidth > window.innerWidth + 1,
    pastille: pastille ? { valeur: pastille.getAttribute('data-mises-a-jour-en-attente'), titre: pastille.getAttribute('title') } : null,
    chiffre: chiffre
      ? {
          valeur: Number(chiffre.getAttribute('data-pourcent-bandeau')),
          teinte: ['text-en-cours', 'text-danger', 'text-success'].find((k) => chiffre.classList.contains(k)) ?? null,
          /* Écrit dans l'encre du bouton, dont l'aplat ne laisserait pas lire une teinte d'état. */
          encre: !!ouvreur && getComputedStyle(chiffre).color === getComputedStyle(ouvreur).color,
        }
      : null,
    barre: barre
      ? { pourcent: barre.getAttribute('data-pourcent'), erreur: barre.getAttribute('data-erreur'), teinte: barre.getAttribute('data-teinte') }
      : null,
    tiroir: !!entete,
    /* Le titre de la page est le dernier cran du fil d'Ariane de sa barre ; sur
       téléphone ou sans fil, il reste dans l'entête de la page. */
    titre:
      (
        [...document.querySelectorAll('[data-page-de-zone] [data-titre-de-page]')].pop() ??
        [...document.querySelectorAll('[data-feuille-du-bas] h2')].pop() ?? entete?.querySelector('h2')
      )?.textContent?.trim() ?? null,
    interrupteur: !!entete?.querySelector('[data-interrupteur-mise-en-production]'),
    reglagesDEntete: !!entete?.querySelector('[data-reglages-tiroir-production]'),
    retour: !!entete?.querySelector('[data-retour-membres-production]'),
    /* « Initier » de la MISE EN PRODUCTION seulement : le bouton « Déployer » de
       la barre d'en-tête, sans procédure de déploiement, porte le sien (`dev`). */
    initier: !!document.querySelector('[data-initier-procedure="production"]'),
    lignes,
    general: general
      ? {
          texte: general.textContent?.trim() ?? '',
          nombre: general.getAttribute('data-bouton-production-groupe'),
          eteint: general.disabled,
          entier: general.getBoundingClientRect().right <= window.innerWidth + 0.5,
        }
      : null,
    raisonGenerale: document.querySelector('[data-pied-tiroir-production] [data-raison-bouton-production]')?.textContent?.trim() ?? null,
    detail: document.querySelector('[data-detail-membre-production]')?.getAttribute('data-detail-membre-production') ?? null,
    etapesDuDeroule: document.querySelectorAll('[data-detail-membre-production] [data-parcours-etapes] > li').length,
  };
};

const ligne = (releve, id) => releve?.lignes.find((l) => l.id === id);

/** Les cartes violettes de mise en production à l'écran, où qu'elles soient. */
const VIGNETTES = () =>
  [...document.querySelectorAll('[data-vignette-mise-en-production]')].map((vignette) => {
    const cadre = vignette.querySelector('[data-ouvrir-mise-en-production]');
    const point = vignette.querySelector('[data-systeme-non-lu]');
    const p = point?.querySelector('span')?.getBoundingClientRect();
    const c = cadre?.getBoundingClientRect();
    /* Le point n'est ROGNÉ par rien : l'élément réellement sous son centre est lui. */
    const dessus = p ? document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2) : null;
    return {
      projet: vignette.getAttribute('data-vignette-mise-en-production'),
      etat: vignette.getAttribute('data-etat-vignette-production'),
      colonne: vignette.closest('[data-bande-cartes]')?.getAttribute('data-bande-cartes') ?? null,
      bande: vignette.closest('[data-bande-productions]') ? 'productions' : vignette.closest('[data-liste-terminee]') ? 'termines' : null,
      hauteur: Math.round(vignette.getBoundingClientRect().height),
      premiere: !vignette.closest('[data-bande-cartes]')?.querySelector('[data-carte]') ||
        !!(vignette.compareDocumentPosition(vignette.closest('[data-bande-cartes]').querySelector('[data-carte]')) & Node.DOCUMENT_POSITION_FOLLOWING),
      /* PLUS DE CADRE VIOLET (refonte monochrome : une carte Système a la tenue
         de toute carte) : c'est sa tête qui la nomme, « Mise en production ». */
      nommee: /Mise en production/.test(vignette.querySelector('[data-tete-carte-en-route]')?.textContent ?? ''),
      texte: vignette.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      avancement: vignette.querySelector('[data-avancement-production]')?.getAttribute('data-avancement-production') ?? null,
      barre: (() => {
        const barre = vignette.querySelector('[data-barre-vignette-production]');
        return barre ? (barre.getAttribute('data-erreur') ?? 'non') : null;
      })(),
      point: point ? point.getAttribute('data-systeme-non-lu') : null,
      pointBleu: !!point?.querySelector('.bg-termine'),
      pointVisible: !!dessus && !!point && point.contains(dessus),
      /* Dans le COIN HAUT DROIT : à cheval sur le bord, comme sur une carte ordinaire. */
      pointDansLeCoin: !!p && !!c && Math.abs(p.left + p.width / 2 - c.right) < 10 && Math.abs(p.top + p.height / 2 - c.top) < 10,
      dansUnBouton: !!vignette.querySelector('button [class*="line-clamp"]'),
    };
  });
const vignette = (liste, id) => liste.find((v) => v.projet === id);
const compteDeColonne = (page) =>
  page.evaluate(() => document.querySelector('[data-column="running"] [data-compte-colonne]')?.textContent?.trim() ?? null);

/** La fenêtre de confirmation ouverte : son titre, son texte, et le clic sur « Mettre à jour ». */
async function confirmer(page) {
  const fenetre = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Mettre à jour' }) });
  await fenetre.waitFor({ timeout: 5_000 });
  const texte = (await fenetre.textContent()) ?? '';
  await fenetre.getByRole('button', { name: 'Mettre à jour' }).click();
  await page.waitForTimeout(500);
  return texte;
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  if (!(await attendrePort())) {
    console.error('Le démon d’essai n’a pas démarré :\n' + journal.join(''));
    process.exit(1);
  }
  poserDecor();
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* ---------------- Ordinateur ---------------- */
  const { contexte, page, erreurs } = await ouvrirLeTableau(navigateur, { width: 1400, height: 900 });
  await page.waitForTimeout(1_500);
  const repos = await page.evaluate(RELEVE);
  noter('le bouton de mise en production du groupe est dans la barre d’en-tête, hors de toute colonne', repos?.id === GROUPE && repos.dansLaBarre && !repos.dansUneColonne, JSON.stringify({ id: repos?.id, barre: repos?.dansLaBarre }));
  noter('fermé, il est au repos et sa pastille dit la somme des versions en attente (2)', repos?.suivi === 'repos' && repos.pastille?.valeur === '2' && /2 versions en attente/.test(repos.pastille.titre ?? ''), JSON.stringify(repos?.pastille));

  await page.click('[data-ouvrir-tiroir-production]');
  await page.waitForSelector('[data-membre-production]', { timeout: 10_000 });
  await page.waitForTimeout(1_500);
  const ouvert = await page.evaluate(RELEVE);
  noter('le tiroir liste une ligne par membre, dans l’ordre', ouvert?.lignes.map((l) => l.id).join(',') === [A, B, SANS, ETEINT].join(','), ouvert?.lignes.map((l) => l.nom).join(' | '));
  noter('le groupe n’a ni interrupteur, ni réglages d’entête, ni bouton « Initier »', ouvert?.tiroir && !ouvert.interrupteur && !ouvert.reglagesDEntete && !ouvert.initier, JSON.stringify({ i: ouvert?.interrupteur, r: ouvert?.reglagesDEntete, n: ouvert?.initier }));
  noter('les deux membres prêts ont un bouton allumé, sans raison écrite', [A, B].every((id) => ligne(ouvert, id)?.etat === 'pret' && ligne(ouvert, id)?.eteint === false && !ligne(ouvert, id)?.raison), JSON.stringify([ligne(ouvert, A), ligne(ouvert, B)].map((l) => [l?.etat, l?.eteint])));
  noter('chaque ligne dit l’état de sa version', /2 versions de retard/.test(ligne(ouvert, A)?.ecart ?? '') && /Jamais mise en production/.test(ligne(ouvert, B)?.ecart ?? ''), `${ligne(ouvert, A)?.ecart} | ${ligne(ouvert, B)?.ecart}`);
  /* Un membre ALLUMÉ sans processus mène à son agent de configuration (22/10/2026) : son bouton est vivant, et la raison reste écrite. */
  noter('le membre sans processus dit pourquoi, et son bouton mène à son agent de configuration', ligne(ouvert, SANS)?.etat === 'eteint' && ligne(ouvert, SANS)?.eteint === false && ligne(ouvert, SANS)?.agent === 'initialiser' && /pas encore de processus/.test(ligne(ouvert, SANS)?.raison ?? ''), JSON.stringify(ligne(ouvert, SANS)));
  noter('le membre à l’interrupteur éteint est éteint, et dit pourquoi', ligne(ouvert, ETEINT)?.etat === 'eteint' && ligne(ouvert, ETEINT)?.eteint === true && /désactivée pour ce projet/.test(ligne(ouvert, ETEINT)?.raison ?? ''), ligne(ouvert, ETEINT)?.raison);
  noter('le bouton général compte les deux membres prêts', ouvert?.general?.nombre === '2' && !ouvert.general.eteint && /Mettre en production la sélection \(2\)/.test(ouvert.general.texte), ouvert?.general?.texte);
  noter('chaque carte de projet porte ses réglages dans le coin haut droit', ouvert?.lignes.length === 4 && ouvert.lignes.every((l) => l.reglagesEnHautADroite), JSON.stringify(ouvert?.lignes.map((l) => l.reglagesEnHautADroite)));
  noter('« Mettre en production » occupe toute la largeur de la carte, sous le contenu', ouvert?.lignes.every((l) => l.boutonPleineLargeur && l.boutonSousLesReglages), JSON.stringify(ouvert?.lignes.map((l) => [l.boutonPleineLargeur, l.boutonSousLesReglages])));
  const avantLancement = await page.evaluate(VIGNETTES);
  noter('au repos, aucune carte violette de mise en production', avantLancement.length === 0, JSON.stringify(avantLancement.map((v) => v.projet)));
  await page.screenshot({ path: path.join(TMP, 'groupe-liste.png') });

  /* LE LANCEMENT GÉNÉRAL : une seule confirmation, deux demandes ensemble. */
  await page.click('[data-bouton-production-groupe]');
  const annonce = await confirmer(page);
  noter('une seule confirmation, qui nomme les deux projets', /2 projets vont partir/.test(annonce) && annonce.includes('Interface') && annonce.includes('Serveur'), annonce.slice(0, 160));
  const partis = await starts(page);
  noter('le bouton général envoie un lancement par membre prêt, ensemble', partis.length === 2 && partis.map((s) => s.projectId).sort().join(',') === [A, B].sort().join(',') && partis.every((s) => s.cible === 'production') && Math.abs(partis[0].at - partis[1].at) < 200, JSON.stringify(partis.map((s) => [s.projectId, s.cible])));
  const enVol = await page.evaluate(RELEVE);
  noter('dès le clic, les deux boutons disent que la demande est partie', [A, B].every((id) => ligne(enVol, id)?.enVol && ligne(enVol, id)?.eteint), JSON.stringify([ligne(enVol, A)?.enVol, ligne(enVol, B)?.enVol]));

  /* « Interface » part ; « Serveur » est refusé : chacun son verdict. */
  const refus = 'Un agent travaille encore dans le dossier : Refonte.';
  await repondre(page, partis.find((s) => s.projectId === B).id, false, refus);
  await repondre(page, partis.find((s) => s.projectId === A).id, true);
  await injecterDeroule(page, deroule(A, { currentStep: 'build', steps: [etape('merge', 'done'), etape('commit', 'done'), etape('build', 'running'), etape('publish', 'todo')] }));
  await page.waitForTimeout(800);
  const mixte = await page.evaluate(RELEVE);
  noter('le refus s’écrit sur la ligne de son projet, sans retenir l’autre', ligne(mixte, B)?.erreur === refus && ligne(mixte, A)?.etat === 'en-cours' && !ligne(mixte, A)?.erreur, JSON.stringify([ligne(mixte, B)?.erreur, ligne(mixte, A)?.etat]));
  noter('la ligne en route porte son avancement', Number(ligne(mixte, A)?.avancement) > 0 && ligne(mixte, A)?.barre === 'non', JSON.stringify([ligne(mixte, A)?.avancement, ligne(mixte, A)?.barre]));
  /* LE CHIFFRE S'ÉCRIT DANS L'ENCRE DU BOUTON (11/10/2026) : une teinte d'état ne
     se lirait pas sur son aplat. « En cours » se dit par la roue et par la barre. */
  noter('le bouton passe « en cours », au pourcentage du seul membre en route', mixte?.suivi === 'en-cours' && mixte.chiffre?.valeur === Number(ligne(mixte, A)?.avancement) && mixte.chiffre.encre === true && mixte.icone === 'loader' && mixte.barre?.teinte === 'en-cours', JSON.stringify([mixte?.chiffre, mixte?.icone, mixte?.barre]));
  noter('le bouton général ne compte plus que le membre resté prêt', mixte?.general?.nombre === '1', mixte?.general?.texte);
  const enRouteV = await page.evaluate(VIGNETTES);
  noter('la mise en production en route pose UNE carte Système en tête de « En cours », au nom de son projet', enRouteV.length === 1 && vignette(enRouteV, A)?.colonne === 'running' && vignette(enRouteV, A)?.nommee && vignette(enRouteV, A)?.premiere && /Interface/.test(vignette(enRouteV, A)?.texte ?? ''), JSON.stringify(enRouteV.map((v) => [v.projet, v.colonne, v.nommee, v.premiere])));
  noter('elle dit l’avancement, en cours, sans point bleu tant qu’elle tourne', vignette(enRouteV, A)?.etat === 'en-cours' && vignette(enRouteV, A)?.avancement === ligne(mixte, A)?.avancement && vignette(enRouteV, A)?.barre === 'non' && vignette(enRouteV, A)?.point === null && !vignette(enRouteV, A)?.dansUnBouton, JSON.stringify(vignette(enRouteV, A)));

  /* LE BOUTON D'UNE LIGNE : une confirmation, UN lancement, pour ce projet. */
  await page.click(`[data-bouton-production-membre="${B}"]`);
  const annonceB = await confirmer(page);
  const apresB = await starts(page);
  noter('le bouton d’une ligne nomme son projet et n’envoie qu’un lancement, pour lui', /Serveur/.test(annonceB) && apresB.length === 3 && apresB[2].projectId === B && apresB[2].cible === 'production', JSON.stringify(apresB.map((s) => s.projectId)));
  await repondre(page, apresB[2].id, true);
  await injecterDeroule(page, deroule(B, { currentStep: 'merge', steps: [etape('merge', 'running'), etape('commit', 'todo'), etape('build', 'todo'), etape('publish', 'todo')] }));
  await page.waitForTimeout(800);
  const deux = await page.evaluate(RELEVE);
  const moyenne = Math.round((Number(ligne(deux, A)?.avancement) + Number(ligne(deux, B)?.avancement)) / 2);
  noter('deux membres en route : le refus s’efface et le bandeau porte leur moyenne', !ligne(deux, B)?.erreur && ligne(deux, B)?.etat === 'en-cours' && deux?.chiffre?.valeur === moyenne && Number(ligne(deux, A)?.avancement) !== Number(ligne(deux, B)?.avancement), JSON.stringify([ligne(deux, A)?.avancement, ligne(deux, B)?.avancement, deux?.chiffre?.valeur]));
  noter('plus aucun membre prêt : le bouton général s’éteint et dit pourquoi', deux?.general?.eteint === true && /en cours/.test(deux.raisonGenerale ?? ''), deux?.raisonGenerale);

  /* LE DÉTAIL D'UN MEMBRE, puis le retour à la liste. */
  await page.click(`[data-ouvrir-membre-production="${A}"]`);
  await page.waitForSelector(`[data-detail-membre-production="${A}"]`, { timeout: 10_000 });
  await page.waitForTimeout(600);
  const detail = await page.evaluate(RELEVE);
  noter('un clic sur une ligne ouvre le déroulé du membre, à son nom, avec un retour', detail?.detail === A && detail.titre === 'Interface' && detail.retour && detail.etapesDuDeroule > 0 && detail.lignes.length === 0, JSON.stringify({ t: detail?.titre, e: detail?.etapesDuDeroule }));
  await page.screenshot({ path: path.join(TMP, 'groupe-detail.png') });
  await page.click('[data-retour-membres-production]');
  await page.waitForTimeout(500);
  const retour = await page.evaluate(RELEVE);
  noter('le retour ramène à la liste des membres', !retour?.detail && retour?.lignes.length === 4 && retour.titre === 'Mise en production', retour?.titre);

  /* UNE RÉUSSITE ET UN ÉCHEC EN MÊME TEMPS : le bandeau ne reste pas « en cours ». */
  const fin = Date.now();
  await injecterDeroule(page, deroule(A, { state: 'success', endedAt: fin, steps: ['merge', 'commit', 'build', 'publish'].map((k) => etape(k, 'done')) }));
  await injecterDeroule(page, deroule(B, { state: 'failed', endedAt: fin, currentStep: 'commit', steps: [etape('merge', 'done'), etape('commit', 'failed'), etape('build', 'todo'), etape('publish', 'todo')] }));
  await page.waitForTimeout(1_200);
  const fini = await page.evaluate(RELEVE);
  /* L'échec se dit par la CROIX et par la barre, restée rouge ; le chiffre reste dans l'encre du bouton. */
  noter('réussite et échec ensemble : le bouton quitte « en cours » et passe en erreur', fini?.suivi === 'en-echec' && fini.icone === 'x' && fini.barre?.erreur === 'oui' && fini.barre.teinte === 'danger', JSON.stringify([fini?.suivi, fini?.icone, fini?.chiffre, fini?.barre]));
  noter('la ligne réussie le dit, la ligne tombée aussi', ligne(fini, A)?.reussite === true && ligne(fini, B)?.etat === 'en-echec' && /a échoué/.test(ligne(fini, B)?.tombee ?? '') && ligne(fini, B)?.barre === 'oui', JSON.stringify([ligne(fini, A)?.reussite, ligne(fini, B)?.tombee]));
  noter('après la fin, les deux membres peuvent repartir', fini?.general?.nombre === '2' && !fini.general.eteint, fini?.general?.texte);
  await page.screenshot({ path: path.join(TMP, 'groupe-fin.png') });

  /* TERMINÉES, LES CARTES VIOLETTES QUITTENT LE TABLEAU (06/10/2026) : leur
     résultat se lit dans le bandeau du bas, et rien n'est « à lire ». */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const finiesV = await page.evaluate(VIGNETTES);
  noter('terminées, les cartes violettes quittent « En cours » du tableau', finiesV.length === 0, JSON.stringify(finiesV.map((v) => [v.projet, v.etat])));
  noter('aucune lecture envoyée, aucun point bleu de carte Système', (await page.evaluate(() => window.__lectures)).length === 0 && (await page.locator('[data-systeme-non-lu]').count()) === 0);
  await page.screenshot({ path: path.join(TMP, 'groupe-cartes-violettes.png') });

  /* LE « DÉPLOYER » DU GROUPE (27/10/2026) : il ne lance plus l'agent du
     groupe ; il liste les projets membres à cocher, et lance chacun. */
  const departsAvant = (await page.evaluate(() => window.__starts)).length;
  await page.click('[data-bouton-deploiement-groupe]');
  await page.waitForSelector('[data-membre-deploiement]', { timeout: 10_000 });
  await page.waitForTimeout(500);
  const RELEVE_DEPLOIEMENT = (groupe) => ({
    lignes: [...document.querySelectorAll('[data-membre-deploiement]')].map((ligne) => ({
      id: ligne.getAttribute('data-membre-deploiement'),
      etat: ligne.getAttribute('data-etat-membre'),
      cochee: ligne.querySelector('[data-case-deploiement-membre]')?.getAttribute('aria-checked'),
      configurer: !!ligne.querySelector('[data-configurer-deploiement-membre]'),
    })),
    bouton: document.querySelector('[data-bouton-deployer-selection]')?.textContent?.trim(),
    /* Le volet d'un agent ouvert sur le GROUPE serait le symptôme d'avant. */
    agentDuGroupe: location.hash.includes(`${groupe}/volet`),
  });
  const dep = await page.evaluate(RELEVE_DEPLOIEMENT, GROUPE);
  noter(
    '« Déployer » du groupe liste ses quatre projets, dans l’ordre',
    dep.lignes.map((l) => l.id).join(',') === [A, B, SANS, ETEINT].join(','),
    JSON.stringify(dep.lignes.map((l) => l.id)),
  );
  noter(
    'les projets qui savent se déployer sont cochés d’office, les autres proposent leur configuration',
    [A, B].every((id) => dep.lignes.find((l) => l.id === id)?.cochee === 'true') &&
      [SANS, ETEINT].every((id) => dep.lignes.find((l) => l.id === id)?.cochee === 'false' && dep.lignes.find((l) => l.id === id)?.configurer),
    JSON.stringify(dep.lignes.map((l) => [l.id, l.cochee, l.configurer])),
  );
  noter('le bouton compte la sélection', /Déployer la sélection \(2\)/.test(dep.bouton ?? ''), dep.bouton);
  await page.click(`[data-case-deploiement-membre="${B}"]`);
  await page.waitForTimeout(200);
  const decoche = await page.evaluate(RELEVE_DEPLOIEMENT, GROUPE);
  noter('décocher un projet le retire du compte', /Déployer la sélection \(1\)/.test(decoche.bouton ?? ''), decoche.bouton);
  await page.click('[data-bouton-deployer-selection]');
  await page.waitForTimeout(500);
  const departsDeploiement = (await page.evaluate(() => window.__starts)).slice(departsAvant);
  noter(
    '« Déployer la sélection » lance le déploiement du seul projet coché, jamais un agent pour le groupe',
    departsDeploiement.length === 1 && departsDeploiement[0].projectId === A && departsDeploiement[0].cible === 'dev' && !decoche.agentDuGroupe,
    JSON.stringify(departsDeploiement.map((d) => [d.projectId, d.cible])),
  );
  await page.screenshot({ path: path.join(TMP, 'groupe-deploiement.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  await contexte.close();

  /* ---------------- Téléphone ---------------- */
  const tel = await ouvrirLeTableau(navigateur, { width: 390, height: 844 }, true);
  await tel.page.waitForTimeout(1_000);
  /* SUR TÉLÉPHONE, le bouton de la barre n'est plus dessiné : la page s'ouvre
     par la ligne « Mise en production » du menu à trois points du projet. */
  await tel.page.locator('[data-entete-de-zone] [data-menu-general]').click();
  await tel.page.locator('[role="menu"] [data-menu-production]').click({ timeout: 10_000 });
  await tel.page.waitForSelector('[data-membre-production]', { timeout: 10_000 });
  await tel.page.waitForTimeout(1_500);
  const telephone = await tel.page.evaluate(RELEVE);
  noter('téléphone — quatre lignes, rien ne déborde, chaque bouton reste entier', telephone?.lignes.length === 4 && !telephone.deborde && !telephone.pageDeborde && telephone.lignes.every((l) => l.boutonEntier && !l.deborde) && telephone.general?.entier, JSON.stringify(telephone?.lignes.map((l) => [l.boutonEntier, l.deborde])));
  noter('téléphone — réglages en haut à droite, bouton sur toute la largeur', telephone?.lignes.every((l) => l.reglagesEnHautADroite && l.boutonPleineLargeur && l.boutonSousLesReglages), JSON.stringify(telephone?.lignes.map((l) => [l.reglagesEnHautADroite, l.boutonPleineLargeur])));
  await tel.page.screenshot({ path: path.join(TMP, 'groupe-telephone.png') });
  noter('téléphone — aucune erreur JavaScript', tel.erreurs.length === 0, tel.erreurs.slice(0, 2).join(' | '));
  await tel.contexte.close();

  /* ---------------- Tableaux de bord, relus en BASE ---------------- */
  /* Deux mises en production écrites en base, sans passer par l'écran : une
     qui tourne (« Interface »), une tombée il y a une minute (« Serveur »), plus un
     DÉPLOIEMENT sur ce serveur lancé après elle, qui ne doit rien masquer. */
  {
    const db = new Database(path.join(DATA, 'beluga.db'));
    const t = Date.now();
    const poser = (run) =>
      db
        .prepare('INSERT INTO deploys (id, project_id, state, data, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(run.id, run.projectId, run.state, JSON.stringify(run), run.startedAt, run.endedAt ?? null);
    poser(deroule(A, { id: 'b-interface', startedAt: t - 20_000, currentStep: 'build', steps: [etape('merge', 'done'), etape('commit', 'done'), etape('build', 'running'), etape('publish', 'todo')] }));
    poser(deroule(B, { id: 'b-serveur', state: 'failed', startedAt: t - 90_000, endedAt: t - 60_000, currentStep: 'commit', steps: [etape('merge', 'done'), etape('commit', 'failed'), etape('build', 'todo'), etape('publish', 'todo')] }));
    poser(deroule(B, { id: 'b-serveur-dev', cible: 'dev', state: 'success', startedAt: t - 30_000, endedAt: t - 25_000, steps: [etape('merge', 'done')] }));
    /* Une mise en production finie depuis PLUS DE 24 HEURES (« Interrupteur éteint ») n'a plus de carte. */
    poser(deroule(ETEINT, { id: 'b-eteint', state: 'success', startedAt: t - 90_000_000, endedAt: t - 89_000_000, steps: [etape('merge', 'done')] }));
    db.close();
  }
  const bord = await ouvrirLeTableau(navigateur, { width: 1400, height: 900 });
  await bord.page.goto(`${BASE}/#en-route`, { waitUntil: 'domcontentloaded' });
  await bord.page.reload({ waitUntil: 'domcontentloaded' });
  await bord.page.waitForSelector('[data-page-en-route]', { timeout: 30_000 });
  await bord.page.waitForTimeout(3_000);
  const bordV = await bord.page.evaluate(VIGNETTES);
  noter('Tableaux de bord, page rechargée : en cours dans « Actifs », tombée dans « Archiver », relues en base', bordV.length === 2 && bordV.every((v) => v.nommee) && vignette(bordV, A)?.etat === 'en-cours' && vignette(bordV, A)?.bande === 'productions' && vignette(bordV, B)?.etat === 'en-echec' && vignette(bordV, B)?.bande === 'termines', JSON.stringify(bordV.map((v) => [v.projet, v.etat, v.bande])));
  noter('chacune nomme son projet, sans point bleu', /Interface/.test(vignette(bordV, A)?.texte ?? '') && /Serveur/.test(vignette(bordV, B)?.texte ?? '') && bordV.every((v) => v.point === null), JSON.stringify(bordV.map((v) => [v.projet, v.point])));
  noter('les cartes violettes sont nettement plus basses qu’une carte (178 px)', bordV.every((v) => v.hauteur > 60 && v.hauteur < 130), JSON.stringify(bordV.map((v) => [v.projet, v.hauteur])));
  noter('la section des mises en production est en tête de « Actifs »', await bord.page.evaluate(() => {
    const section = document.querySelector('[data-bande-productions]');
    const autres = [...document.querySelectorAll('[data-bande-depannages], [data-bande-agents], [data-liste-en-route]')];
    return !!section && autres.every((autre) => !!(section.compareDocumentPosition(autre) & Node.DOCUMENT_POSITION_FOLLOWING));
  }));
  /* Le repère bleu de la colonne de gauche ne s'allume pas pour une carte Système. */
  const rendus = await bord.page.evaluate(() =>
    [...document.querySelectorAll('[data-repere-rendus]')].map((r) => r.getAttribute('aria-label') ?? ''),
  );
  noter('la mise en production terminée n’allume pas le repère bleu de la colonne de gauche', rendus.length === 0, JSON.stringify(rendus));
  await bord.page.screenshot({ path: path.join(TMP, 'tableaux-de-bord.png') });
  /* LE CLIC SUR LA CARTE EN COURS mène au tableau de son projet, tiroir de production ouvert. */
  await bord.page.click(`[data-ouvrir-mise-en-production="${A}"]`);
  await bord.page.waitForSelector('[data-entete-tiroir-production]', { timeout: 15_000 });
  await bord.page.waitForTimeout(600);
  noter('un clic sur la carte mène au tableau de son projet, suivi de production ouvert', bord.page.url().includes(`#projet/${A}`) && (await bord.page.locator('[data-entete-tiroir-production]').count()) === 1, bord.page.url());
  noter('Tableaux de bord — aucune erreur JavaScript', bord.erreurs.length === 0, bord.erreurs.slice(0, 2).join(' | '));
  await bord.contexte.close();

  await navigateur.close();
  const rates = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
  if (process.env.BELUGA_GROUPE_CAPTURES) {
    fs.mkdirSync(process.env.BELUGA_GROUPE_CAPTURES, { recursive: true });
    for (const nom of fs.readdirSync(TMP).filter((f) => f.endsWith('.png'))) {
      fs.copyFileSync(path.join(TMP, nom), path.join(process.env.BELUGA_GROUPE_CAPTURES, nom));
    }
  }
  process.exit(rates.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  console.error(journal.slice(-20).join(''));
  process.exit(1);
});
