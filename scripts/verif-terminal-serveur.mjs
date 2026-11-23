#!/usr/bin/env node
/*
 * LE TERMINAL DU SERVEUR RÉPOND-IL VRAIMENT ?
 *
 * Les règles pures sont déjà verrouillées par `server/dist/test/terminal-serveur.test.js`. Ce
 * contrôle-ci fait ce qu'aucun test unitaire ne peut faire : il OUVRE une vraie session tmux, s'y
 * attache par la vraie voie WebSocket, TAPE une commande et LIT ce qui revient. C'est la seule
 * façon de prouver les trois points qui cassent en silence :
 *
 *   1. l'attache réussit (un `tmux attach` sur de simples tuyaux échouerait) ;
 *   2. la taille demandée par l'écran est celle du terminal, et non 80×24 ;
 *   3. les accents traversent le tuyau entiers.
 *
 * Il tourne DEPUIS LE DÉPÔT D'OÙ IL PART : la session d'essai porte un nom à elle
 * (`beluga-verif`), jamais celle de l'utilisateur, et elle est retirée à la fin — un contrôle ne
 * doit pas laisser un terminal ouvert derrière lui.
 *
 * Lancer : node scripts/verif-terminal-serveur.mjs   (après `npm run build:server`)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

const {
  decoderSortie,
  ligneDeTaille,
  RELAIS_TERMINAL,
  argumentsAttache,
  argumentsCreationSession,
  argumentsEnvironnementSession,
  argumentsFinDeSession,
  choisirLeCompteDuTerminal,
} = await import(path.join(RACINE, 'shared/dist/index.js'));

/* --- 1. L'attache : une vraie session, une vraie commande ---------------- */

const SESSION = 'beluga-verif';
const tmux = (args) => spawnSync('tmux', args, { encoding: 'utf8' });
const tmuxLa = tmux(['-V']).status === 0;
verifier('tmux est installé sur cette machine', tmuxLa);

if (tmuxLa) {
  tmux(['kill-session', '-t', SESSION]);
  tmux(['new-session', '-d', '-s', SESSION, '-x', '100', '-y', '30']);
  tmux(['set-option', '-t', SESSION, 'window-size', 'latest']);

  const relais = path.join(RACINE, RELAIS_TERMINAL);
  verifier('le relais qui ouvre le terminal est bien là', fs.existsSync(relais));

  const { commande, arguments: args } = argumentsAttache(SESSION, 150, 45, relais);
  const client = spawn(commande, args, {
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });

  const decodeur = new TextDecoder();
  let vu = '';
  const avaler = (morceau) => {
    vu += decodeur.decode(decoderSortie(Buffer.from(morceau).toString('base64')), { stream: true });
  };
  client.stdout.on('data', avaler);

  const patienter = (ms) => new Promise((r) => setTimeout(r, ms));
  await patienter(900);

  // La commande écrite ici prouve DEUX choses d'un coup : la largeur réellement
  // vue par le shell, et un accent qui a traversé le tuyau sans être abîmé.
  client.stdin.write('printf "LARGEUR=%s ACCENT=été\\n" "$(tput cols)"\n');
  await patienter(1300);
  verifier('l’attache répond, à la largeur demandée, accents intacts', vu.includes('LARGEUR=150 ACCENT=été'));

  // Le quatrième tuyau : la fenêtre du navigateur a changé de taille.
  client.stdio[3].write(ligneDeTaille(210, 50));
  await patienter(500);
  vu = '';
  client.stdin.write('printf "APRES=%s\\n" "$(tput cols)"\n');
  await patienter(1300);
  verifier('un redimensionnement de la fenêtre atteint le terminal', vu.includes('APRES=210'));

  client.kill('SIGTERM');
  await patienter(300);
  // FERMER L'ÉCRAN NE TUE RIEN : la session doit survivre au client détaché.
  verifier('la session survit au départ de l’écran', tmux(['has-session', '-t', SESSION]).status === 0);
  tmux(['kill-session', '-t', SESSION]);
}

/* --- 1 bis. LE COFFRE DU COMPTE ARRIVE-T-IL JUSQU'AU SHELL ? ------------- */

/*
 * Le point ENTIER de cette carte : le `claude` tapé dans le terminal doit lire
 * le coffre du compte Max x20, pas celui du compte système. tmux fige
 * l'environnement d'un shell à sa CRÉATION — on le prouve ici en créant une
 * session d'essai avec un `CLAUDE_CONFIG_DIR` bidon, puis en demandant au shell
 * ce qu'il voit. On prouve aussi qu'un CHANGEMENT de compte ne peut passer que
 * par une session RECRÉÉE : la même session, réattachée avec une autre valeur,
 * garde l'ancienne.
 *
 * La session d'essai porte son propre nom (`beluga-verif-compte`) : la session
 * partagée de l'utilisateur n'est jamais touchée.
 */
if (tmuxLa) {
  const SESSION_COMPTE = 'beluga-verif-compte';
  const COFFRE_A = '/tmp/beluga-verif-coffre-a';
  const COFFRE_B = '/tmp/beluga-verif-coffre-b';
  const relais = path.join(RACINE, RELAIS_TERMINAL);
  const patienter = (ms) => new Promise((r) => setTimeout(r, ms));

  const lireLeCoffreDuShell = async (coffre) => {
    tmux(argumentsFinDeSession(SESSION_COMPTE));
    // Le coffre part par `-e`, comme le fait le démon : tmux est un SERVEUR, et
    // l'environnement du processus qui appelle n'atteint pas le shell.
    const env = { ...process.env, TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: coffre };
    spawnSync('tmux', argumentsCreationSession(SESSION_COMPTE, 100, 30, { CLAUDE_CONFIG_DIR: coffre }), {
      env,
      encoding: 'utf8',
    });
    spawnSync('tmux', argumentsEnvironnementSession(SESSION_COMPTE, 'CLAUDE_CONFIG_DIR', coffre), { encoding: 'utf8' });
    const { commande, arguments: args } = argumentsAttache(SESSION_COMPTE, 100, 30, relais);
    // L'attache part SANS la variable : on veut prouver que c'est la CRÉATION
    // qui l'a posée, pas l'environnement de l'écran attaché.
    const attache = spawn(commande, args, {
      env: { ...process.env, TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: '' },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    const decodeur = new TextDecoder();
    let vu = '';
    attache.stdout.on('data', (morceau) => {
      vu += decodeur.decode(decoderSortie(Buffer.from(morceau).toString('base64')), { stream: true });
    });
    await patienter(900);
    attache.stdin.write('printf "COFFRE=[%s]\\n" "$CLAUDE_CONFIG_DIR"\n');
    await patienter(1300);
    attache.kill('SIGTERM');
    await patienter(200);
    return vu;
  };

  const vuA = await lireLeCoffreDuShell(COFFRE_A);
  verifier('la session est créée avec le coffre du compte retenu', vuA.includes(`COFFRE=[${COFFRE_A}]`));

  // MÊME session, autre valeur d'environnement : elle garde l'ancien coffre.
  // C'est ce qui oblige à TUER la session pour changer de compte.
  const { commande: c2, arguments: a2 } = argumentsAttache(SESSION_COMPTE, 100, 30, relais);
  const rattache = spawn(c2, a2, {
    env: { ...process.env, TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: COFFRE_B },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  const decodeur2 = new TextDecoder();
  let vuMeme = '';
  rattache.stdout.on('data', (morceau) => {
    vuMeme += decodeur2.decode(decoderSortie(Buffer.from(morceau).toString('base64')), { stream: true });
  });
  await new Promise((r) => setTimeout(r, 900));
  rattache.stdin.write('printf "COFFRE=[%s]\\n" "$CLAUDE_CONFIG_DIR"\n');
  await new Promise((r) => setTimeout(r, 1300));
  rattache.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  verifier(
    'une session vivante garde son coffre : changer de compte EXIGE de la recréer',
    vuMeme.includes(`COFFRE=[${COFFRE_A}]`) && !vuMeme.includes(`COFFRE=[${COFFRE_B}]`),
  );

  const vuB = await lireLeCoffreDuShell(COFFRE_B);
  verifier('la session recréée part bien sur le nouveau coffre', vuB.includes(`COFFRE=[${COFFRE_B}]`));

  tmux(argumentsFinDeSession(SESSION_COMPTE));
  verifier('la session d’essai est retirée derrière elle', tmux(['has-session', '-t', SESSION_COMPTE]).status !== 0);
  // La session PARTAGÉE de l'utilisateur n'a jamais été visée par ce contrôle.
  verifier(
    'le contrôle n’a jamais nommé la session partagée réelle',
    SESSION !== 'beluga' && SESSION_COMPTE !== 'beluga',
  );
}

/* --- 1 ter. La règle de choix, sans machine ------------------------------ */

{
  const comptes = [
    { id: 'claude-pro', engine: 'claude', label: 'Claude — Pro', plan: 'Pro' },
    { id: 'claude-max', engine: 'claude', label: 'Claude — Max x20', plan: 'Max x20' },
  ];
  verifier(
    'sans rien demander, le terminal part sur le compte Max x20',
    choisirLeCompteDuTerminal(comptes).compte?.id === 'claude-max',
  );
  verifier(
    'un compte choisi à la main l’emporte sur le palier',
    choisirLeCompteDuTerminal(comptes, 'claude-pro').compte?.id === 'claude-pro',
  );
  const sansMax = choisirLeCompteDuTerminal([comptes[0]]);
  verifier(
    'l’absence de compte Max x20 est DITE, jamais un repli silencieux',
    sansMax.compte === undefined && !!sansMax.avertissement && sansMax.raison === 'aucun',
  );
}

/* --- 2. La voie WebSocket, gardée par le mur d'accès --------------------- */

const ws = lire('server/src/ws.ts');
verifier(
  'la voie du terminal passe APRÈS le contrôle de session, jamais avant',
  ws.indexOf('isAuthenticated(req)') < ws.indexOf('chemin === ROUTE_TERMINAL'),
);
verifier(
  'elle est aiguillée sur son chemin exact, paramètres retirés',
  ws.includes("const chemin = req.url.split('?')[0]") && ws.includes('chemin === ROUTE_TERMINAL'),
);

const voie = lire('server/src/ws-terminal.ts');
verifier(
  'fermer un écran détache le client, il ne tue pas ce qui tourne',
  voie.includes("ws.on('close', detacher)") && voie.includes("client.kill('SIGTERM')"),
);
verifier('un message refusé est DIT à l’écran, pas avalé', voie.includes("envoyer({ type: 'panne', message: lecture.refus })"));
verifier(
  'le compte retenu est annoncé à l’ouverture, avec son avertissement',
  voie.includes('compte: afficher()') && voie.includes('avertissement: choix.avertissement'),
);
verifier(
  'changer de compte RETIENT le choix, TUE la session, et le dit',
  voie.includes('retenirLeCompteDuTerminal(lecture.message.id)') &&
    voie.includes('tuerLaSession()') &&
    voie.includes("type: 'compte-change'"),
);

const demonTerminal = lire('server/src/terminal.ts');
verifier(
  'la session tmux est créée AVEC l’environnement du compte',
  demonTerminal.includes('argumentsCreationSession(SESSION_TERMINAL, colonnes, lignes, surLaSession)'),
);
verifier(
  'le coffre du compte pose bien CLAUDE_CONFIG_DIR (applyAccountEnv)',
  demonTerminal.includes('applyAccountEnv(enregistrement)') && demonTerminal.includes('CLAUDE_CONFIG_DIR'),
);
verifier(
  'le compte du terminal est un réglage du SERVEUR, gardé en base',
  demonTerminal.includes("'terminal.compte'") && demonTerminal.includes('setMeta'),
);

/* --- 3. Le bouton et son morceau à part --------------------------------- */

/*
 * L'ENTRÉE DU TERMINAL A QUITTÉ LE MENU DES TROIS POINTS pour la page « Serveur
 * et agents » des réglages (demande du 11/10/2026) : le menu « … » ne garde que
 * les options du projet affiché, les réglages s'ouvrent de partout. Le terminal,
 * lui, est une page de la zone principale : la RACINE le porte, referme les
 * réglages et l'ouvre — l'entrée ne fait que le demander.
 */
const barre = lire('web/src/components/quota-bar.tsx');
const pageServeur = lire('web/src/components/reglages/page-serveur.tsx');
const porteur = lire('web/src/components/terminal-de-l-application.tsx');
const racine = lire('web/src/app.tsx');
const fenetreDesReglages = lire('web/src/components/settings-view.tsx');
const { ARBORESCENCE_REGLAGES } = await import(path.join(RACINE, 'shared/dist/index.js'));
verifier(
  'le terminal s’ouvre depuis un BOUTON de la page « Gestes sur le serveur » des réglages (rubrique Serveur, « Avancé »)',
  /<Button[^>]*onClick=\{ouvrirLeTerminal\}[^>]*data-terminal-bouton/.test(pageServeur) &&
    /'gestes-serveur':\s*\{[^}]*page-serveur[^}]*SectionGestesServeur/.test(fenetreDesReglages),
);
{
  // L'ordre des pages se lit à sa source, l'arborescence partagée des réglages.
  const pages = ARBORESCENCE_REGLAGES.flatMap((groupe) => groupe.pages.map((page) => ({ ...page, groupe: groupe.cle })));
  const gestes = pages.find((page) => page.cle === 'gestes-serveur');
  verifier(
    'il se pose dans la page « Gestes sur le serveur » (rubrique Serveur, sous « Avancé »), sous le redémarrage',
    gestes?.groupe === 'serveur' &&
      gestes.avance === true &&
      (gestes.libelles ?? []).includes('Terminal du serveur') &&
      pageServeur.indexOf('data-terminal-bouton>') > pageServeur.indexOf('data-bouton-redemarrage="reglages"') &&
      pageServeur.indexOf('data-bouton-redemarrage="reglages"') > 0,
  );
}
verifier(
  'plus aucun bouton ni entrée de terminal ne traîne dans le bandeau ou le menu des trois points',
  !barre.includes('data-terminal-bouton') &&
    !barre.includes('aria-label="Terminal du serveur"') &&
    !barre.includes('terminal-serveur') &&
    !racine.includes('data-terminal-bouton'),
);
verifier(
  'l’afficheur ne se télécharge qu’au premier clic',
  porteur.includes('React.lazy') &&
    porteur.includes("import('@/components/terminal-serveur')") &&
    porteur.includes("<PanneauALaDemande monte={etat !== 'ferme'}>") &&
    // La page des réglages ne fait que DEMANDER l'ouverture : elle ne tire pas l'afficheur avec elle.
    !pageServeur.includes('terminal-serveur'),
);
verifier(
  'la racine porte le terminal, referme les réglages à son ouverture, et il garde son mot dans l’adresse',
  racine.includes('<TerminalDeLApplication onOuverture={fermerLesReglages}') &&
    porteur.includes("useTiroirAdresse('terminal', ouvert, suivreLAdresse)") &&
    /const ouvrir = \(\) => \{\s*onOuverture\(\);\s*setEtat\('ouvert'\);/.test(porteur),
);

const ecran = lire('web/src/components/terminal-serveur.tsx');
verifier('les couleurs du terminal suivent le thème de l’application', ecran.includes('couleursDuTheme()'));
verifier(
  'la taille part AVEC la demande d’ouverture, pas après',
  ecran.includes('?colonnes=${terminal.cols}&lignes=${terminal.rows}'),
);
verifier(
  'un changement de largeur prévient la session, pas seulement l’afficheur',
  ecran.includes('ResizeObserver') && ecran.includes("type: 'taille'"),
);
verifier(
  'l’entête montre le compte en cours et son menu',
  ecran.includes('data-terminal-compte') && ecran.includes('data-terminal-compte-choix'),
);
verifier(
  'changer de compte demande confirmation, en disant ce qui sera perdu',
  ecran.includes('<ConfirmDialog') && ecran.includes('sera perdu'),
);
verifier(
  'le bouton dit dès le clic qu’il part en requête',
  ecran.includes('setBascule(true)') && ecran.includes('animate-spin'),
);
verifier(
  'l’absence de compte s’affiche en clair, elle ne se devine pas',
  ecran.includes('data-terminal-avertissement'),
);

/* --- 4. Dans un vrai navigateur, si on lui donne une adresse --------------- */

/*
 * FACULTATIF, ET VISÉ SUR LE SERVEUR DE DÉVELOPPEMENT — jamais sur
 * `BELUGA_URL`, qui désigne l'application DÉJÀ PUBLIÉE :
 *   HAIKO_TERMINAL_URL=http://localhost:7099 node scripts/verif-terminal-serveur.mjs
 * On ne juge ici que ce qui se voit : le bouton est-il là, et le clic ouvre-t-il
 * un vrai afficheur de terminal ? La liaison, elle, est déjà prouvée plus haut.
 */
const ADRESSE = process.env.HAIKO_TERMINAL_URL;
if (ADRESSE) {
  /*
   * LA BASE SE TROUVE PAR LA MÊME RÈGLE QUE LE DÉMON, jamais par un nom écrit à
   * la main : un `beluga.db` vide posé à côté de la vraie base s'ouvre sans
   * broncher, et le contrôle mourait sur « no such table: sessions ».
   */
  const { cheminDeLaBaseServie, dossierDesDonnees } = await import('./lib/base-servie.mjs');
  const DONNEES = dossierDesDonnees();
  const crypto = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () => require(path.join(DONNEES, '../node_modules/better-sqlite3'))(cheminDeLaBaseServie());

  // Une session d'une heure, fabriquée puis retirée : la base ne garde que
  // l'empreinte du cookie, jamais le cookie.
  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    Date.now(),
    Date.now() + 3_600_000,
    'vérification du terminal',
  );
  db.close();

  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome' });
  let remettreLaCarteOuverte = () => undefined;
  try {
    const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
    await contexte.addCookies([{ name: 'beluga_session', value: cookie, domain: 'localhost', path: '/' }]);
    const page = await contexte.newPage();
    /*
     * LE BOUTON « … » N'EXISTE QUE SUR LE TABLEAU D'UN PROJET : pour juger qu'il
     * ne propose plus le terminal, il faut l'avoir sous la main. On ouvre donc le
     * projet que l'application retient DÉJÀ (lecture seule : rien n'y change).
     */
    const lecture = ouvrir();
    let projet = '';
    try {
      projet = JSON.parse(lecture.prepare("SELECT value FROM preferences WHERE key = 'project.active'").get()?.value ?? '""') || '';
    } catch {
      projet = '';
    }
    if (projet && !lecture.prepare('SELECT 1 FROM projects WHERE id = ? AND archived = 0').get(projet)) projet = '';
    /*
     * OUVRIR UN PROJET PAR SON ADRESSE REFERME LA CARTE QU'IL RETENAIT OUVERTE,
     * et ce souvenir vit en base. On le relève AVANT et on le repose en partant
     * — seulement si c'est bien la valeur laissée par ce contrôle qu'on y lit :
     * un changement fait entre-temps par l'utilisateur lui appartient.
     */
    if (projet) {
      const cle = `card.open.${projet}`;
      const avant = lecture.prepare('SELECT value FROM preferences WHERE key = ?').get(cle)?.value ?? null;
      remettreLaCarteOuverte = () => {
        const fin = ouvrir();
        const lue = fin.prepare('SELECT value FROM preferences WHERE key = ?').get(cle)?.value ?? null;
        if (lue !== avant && lue === JSON.stringify('')) {
          if (avant === null) fin.prepare('DELETE FROM preferences WHERE key = ?').run(cle);
          else fin.prepare('UPDATE preferences SET value = ?, updated_at = ? WHERE key = ?').run(avant, Date.now(), cle);
        }
        fin.close();
      };
    }
    lecture.close();
    await page.goto(projet ? `${ADRESSE}/#projet/${projet}` : ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    // L'accès au terminal passe par les réglages, ouverts par le bouton du pied
    // de la colonne de gauche : c'est lui qu'on attend.
    await page.waitForSelector('[data-reglages-menu]', { state: 'visible', timeout: 30_000 });
    verifier(
      'réglages fermés, ni le bandeau ni la colonne ne portent de bouton de terminal',
      (await page.locator('header [data-terminal-bouton], [data-terminal-bouton]').count()) === 0,
    );

    /*
     * LE BANDEAU NE TIENT JAMAIS EN PLACE : la cloche et les pastilles s'y
     * rafraîchissent sans cesse, et l'attente de stabilité de `page.click`
     * peut y expirer. Le menu s'ouvre sur l'APPUI (Radix écoute `pointerdown`) :
     * on émet donc l'événement directement sur le bouton, sans viser des
     * coordonnées qui auront bougé.
     */
    const troisPoints = page.locator('[data-menu-general]');
    if (projet) {
      await troisPoints.first().waitFor({ state: 'visible', timeout: 30_000 });
      await troisPoints
        .first()
        .dispatchEvent('pointerdown', { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      await page.waitForSelector('[role="menu"] [data-menu-fichiers]', { timeout: 10_000 });
      verifier(
        'le menu des trois points ne propose plus le terminal',
        (await page.locator('[role="menu"] [data-terminal-bouton]').count()) === 0 &&
          (await page.locator('[role="menu"] [role="menuitem"]').filter({ hasText: /terminal/i }).count()) === 0,
      );
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role="menu"]', { state: 'detached', timeout: 10_000 });
    } else {
      // Aucun projet en service : le bouton « … » n'existe nulle part, il n'a donc rien à proposer.
      verifier('le menu des trois points ne propose plus le terminal', (await troisPoints.count()) === 0);
    }

    await page.click('[data-reglages-menu]', { timeout: 10_000 });
    await page.waitForSelector('[data-modale-reglages]', { timeout: 10_000 });
    await page.click('[data-rubrique-reglages="serveur"]', { timeout: 10_000 });
    await page.click('[data-basculer-avance]', { timeout: 10_000 });
    await page.click('[data-menu-reglages] [data-page-menu="gestes-serveur"]', { timeout: 10_000 });
    await page.waitForSelector('[data-page-reglages="gestes-serveur"] [data-reglages-gestes-serveur] [data-terminal-bouton]', { timeout: 10_000 });
    verifier(
      'la page « Gestes sur le serveur » des réglages propose le terminal',
      await page.isVisible('[data-reglages-gestes-serveur] [data-terminal-bouton]'),
    );

    await page.locator('[data-reglages-gestes-serveur] [data-terminal-bouton]').first().click({ timeout: 10_000 });
    await page.waitForSelector('[data-terminal-serveur]', { timeout: 15_000 });
    // L'afficheur pose un canevas dès qu'il est monté : c'est la preuve que le
    // morceau chargé à la demande est bien arrivé et s'est ouvert.
    await page.waitForSelector('[data-terminal-serveur] canvas, [data-terminal-serveur] .xterm', { timeout: 15_000 });
    verifier('le clic ouvre un vrai afficheur de terminal', true);
    // Le terminal est une PAGE de la zone principale : resté derrière la fenêtre
    // des réglages, il ne se verrait pas.
    await page.waitForSelector('[data-modale-reglages]', { state: 'detached', timeout: 10_000 }).catch(() => undefined);
    const adresse = await page.evaluate(() => location.hash);
    verifier(
      `le clic referme les réglages, et l’adresse porte « …/volet/terminal » (lu : « ${adresse} »)`,
      (await page.locator('[data-modale-reglages]').count()) === 0 && adresse.endsWith('/volet/terminal'),
    );

    // Le compte qui dépense se lit DANS l'entête du tiroir, sans déborder de sa
    // place. On ne juge pas ici QUEL compte : cela dépend du démon en service.
    await page.waitForSelector('[data-terminal-compte]', { timeout: 10_000 });
    const boite = await page.locator('[data-terminal-compte]').boundingBox();
    verifier(
      'le compte du terminal s’affiche dans l’entête, sans déborder',
      !!boite && boite.width > 0 && boite.width < 400,
    );
  } catch (erreur) {
    verifier(`dans le navigateur : ${erreur.message.split('\n').slice(0, 6).join(' / ')}`, false);
  } finally {
    await navigateur.close();
    remettreLaCarteOuverte();
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

const rates = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - rates}/${resultats.length} contrôles au vert`);
process.exit(rates ? 1 : 0);
