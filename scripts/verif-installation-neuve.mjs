#!/usr/bin/env node
/**
 * UNE INSTALLATION NEUVE, REJOUÉE SUR CE QUI PARTIRAIT AU PUBLIC.
 *
 * Beluga Build s'installe chez d'autres que son auteur, depuis le dépôt public.
 * Ce contrôle ne regarde donc PAS le dépôt de travail : il construit l'ARBRE
 * ATTENDU — ce que la copie publique recevrait de la révision jugée, chemins
 * interdits écartés et contenu filtré —, l'extrait dans un dossier jetable, et
 * s'y comporte comme un inconnu : installer, construire, démarrer, ouvrir.
 *
 * Il verrouille quatre promesses :
 *
 *  1. RIEN DE PERSONNEL NE PART. L'arbre attendu est refusé au moindre secret
 *     (filtre de contenu) et à la moindre valeur propre à une installation
 *     (`interditsAuPublic` : nom de domaine, adresse d'expédition) ; ni
 *     `prive/`, ni `data/`, ni les tests n'y figurent.
 *  2. L'ARBRE SE SUFFIT. Aucun script publié n'importe un fichier resté au
 *     privé, la notice ne renvoie vers aucun fichier absent, et l'installation
 *     suivie de la construction passe.
 *  3. ELLE DÉMARRE VIDE. Zéro compte, zéro projet, zéro unité de mémoire, une
 *     identité d'installation entièrement vierge — et, seules dans le pool, les
 *     compétences d'interface publiées avec le code (semées au démarrage).
 *  4. LE PREMIER ACCÈS EST GARDÉ. La page d'installation remplace la page de
 *     connexion ; le lien d'installation y fait entrer le code tout seul ; un
 *     mauvais code ne crée rien ; le bon code crée le compte, ouvre la session
 *     et mène à l'assistant de démarrage, bloqué sur la page des moteurs tant
 *     qu'aucun moteur ne répond.
 *  5. LA MISE EN ROUTE EST UNE DISCUSSION (20/11/2026) : l'agent « Beluga »
 *     demande d'abord le moteur, l'orbe à la place du champ d'écriture ; le
 *     moteur choisi a son bouton « Installer » (aucune commande à coller), la sortie
 *     s'affiche dans la barre du bas, qui s'ouvre pendant le travail et se
 *     replie après, se relit après un rechargement, et reste en bas sur un
 *     écran étroit. Le bouton est jugé avec un
 *     faux installateur (`BELUGA_INSTALLATEUR_D_ESSAI`), jamais un vrai moteur.
 *
 *   node scripts/verif-installation-neuve.mjs                    # la révision courante (HEAD)
 *   node scripts/verif-installation-neuve.mjs --revision main
 *   node scripts/verif-installation-neuve.mjs --sans-construction  # l'arbre et ses règles seulement (rapide)
 *   node scripts/verif-installation-neuve.mjs --archive /tmp/beluga.tar.gz   # garde l'arbre en archive
 *
 * À LANCER DEPUIS LA COPIE DE TRAVAIL D'UNE CARTE, jamais depuis le dépôt
 * principal (règle des contrôles à démon jetable). Le démon monté ici est un
 * démon d'ESSAI : son port, sa base, son dossier personnel et ses projets sont
 * à lui, les binaires des moteurs pointent dans le vide, et il porte le nom
 * « beluga-essai-<port> ». Aucun quota n'est dépensé.
 */
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (nom, defaut = '') => {
  const i = args.indexOf(`--${nom}`);
  return i === -1 ? defaut : (args[i + 1] ?? defaut);
};
const REVISION = option('revision', 'HEAD');
const SANS_CONSTRUCTION = args.includes('--sans-construction');
const ARCHIVE = option('archive');
const PORT = Number(process.env.BELUGA_VERIF_PORT || 7262);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(RACINE, 'data', 'verification');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};
const finir = () => {
  const bons = resultats.filter((r) => r.ok).length;
  console.log(`\n${bons}/${resultats.length} contrôles passés`);
  process.exit(resultats.every((r) => r.ok) ? 0 : 1);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-installation-neuve-'));
const ARBRE = path.join(TMP, 'beluga');
let demon = null;
const nettoyer = () => {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', nettoyer);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const git = (dossier, a, o = {}) =>
  execFileSync('git', ['-C', dossier, ...a], { encoding: 'utf8', maxBuffer: 1 << 30, ...o }).trim();

/* ------------------------------------------------------------------ */
/* 1. L'arbre attendu : rien de personnel ne part                       */
/* ------------------------------------------------------------------ */

console.log(`\n1. L'arbre attendu au public (révision ${REVISION})`);
const { construireLArbreAttendu, chemInterdit, CHEMINS_PUBLIES, competencesAPublier, nomsPrivesDuPool, nomsPrecisAVerrouiller } = await import(
  pathToFileURL(path.join(RACINE, 'scripts/synchroniser-miroir-public.mjs')).href
);
const { chargerLesRegles } = await import(pathToFileURL(path.join(RACINE, 'scripts/filtre-contenu.mjs')).href);
const charge = chargerLesRegles();
const interditsAuPublic = (charge.valeurs.interditsAuPublic ?? []).map((v) => String(v).trim()).filter(Boolean);
noter(
  'les valeurs propres à une installation sont déclarées interdites au public',
  interditsAuPublic.length > 0,
  interditsAuPublic.length ? `${interditsAuPublic.length} valeur(s)` : 'clé « interditsAuPublic » vide',
);

const nu = path.join(TMP, 'nu.git');
git(TMP, ['init', '--quiet', '--bare', nu]);
git(nu, ['fetch', '--quiet', RACINE, `+${REVISION}:refs/prive/jugee`]);
/* Les compétences d'interface, triées et contrôlées comme la synchronisation le fait. */
const POOL = path.join(process.env.BELUGA_DATA || '/root/beluga/data', 'competences');
const triees = await competencesAPublier(POOL, charge.regles, charge.valeurs);
const publiees = new Set(triees.publiees.map((p) => p.nom));
const nomsPrecis = nomsPrecisAVerrouiller(await nomsPrivesDuPool(POOL, charge.valeurs), charge.regles.listeBlanche ?? []);
noter('le verrou des données personnelles connaît les adresses et dépôts des projets', nomsPrecis.length > 0, `${nomsPrecis.length} nom(s)`);
const attendu = await construireLArbreAttendu(nu, 'refs/prive/jugee', charge.regles, interditsAuPublic, triees.fichiers, nomsPrecis);
noter(
  'aucun secret ni valeur personnelle dans les fichiers publiés',
  attendu.restes.length === 0,
  attendu.restes.length
    ? attendu.restes
        .slice(0, 6)
        .map((r) => `${r.chemin}:${r.ligne} [${r.motif}]`)
        .join(' ; ')
    : `${attendu.fichiers} fichiers, ${attendu.remplacements} valeur(s) rendue(s) neutre(s)`,
);

fs.mkdirSync(ARBRE, { recursive: true });
execFileSync('bash', ['-c', `git -C "${nu}" archive ${attendu.arbre} | tar -x -C "${ARBRE}"`]);
if (ARCHIVE) {
  execFileSync('tar', ['-czf', ARCHIVE, '-C', ARBRE, '.']);
  console.log(`        archive de l'arbre attendu : ${ARCHIVE}`);
}

const existe = (relatif) => fs.existsSync(path.join(ARBRE, relatif));
noter('ni « prive/ », ni « data/ », ni les tests ne partent', !existe('prive') && !existe('data') && !existe('server/src/test'));
noter('le fichier de reprise des valeurs d’une installation ne part pas', !existe('prive/identite-installation.json'));
{
  const parties = existe('competences') ? fs.readdirSync(path.join(ARBRE, 'competences')) : [];
  const avecProvenance = parties.filter((nom) => /^provenance-/m.test(fs.readFileSync(path.join(ARBRE, 'competences', nom, 'SKILL.md'), 'utf8')));
  noter(
    'les compétences d’interface partent, sans provenance ni fiche interne',
    parties.length === publiees.size && parties.length > 0 && !parties.some((nom) => nom.startsWith('beluga-')) && !avecProvenance.length,
    `${parties.length} publiée(s), ${triees.retenues.length} retenue(s)${avecProvenance.length ? ` — provenance : ${avecProvenance.join(', ')}` : ''}`,
  );
}

/* ------------------------------------------------------------------ */
/* 2. L'arbre se suffit                                                 */
/* ------------------------------------------------------------------ */

console.log("\n2. L'arbre se suffit à lui-même");
const attendus = ['scripts/installer.sh', 'scripts/installer-services.sh', 'scripts/code-installation.mjs', 'scripts/set-credentials.mjs', 'scripts/beluga.service', 'README.md', 'package.json'];
const manquants = attendus.filter((f) => !existe(f));
noter('les fichiers de l’installation sont publiés', manquants.length === 0, manquants.join(', '));

for (const script of ['scripts/installer.sh', 'scripts/installer-services.sh']) {
  if (!existe(script)) continue;
  const syntaxe = spawnSync('bash', ['-n', path.join(ARBRE, script)]);
  noter(`${script} est un script valide`, syntaxe.status === 0, String(syntaxe.stderr).trim().slice(0, 200));
}

const unite = existe('scripts/beluga.service') ? fs.readFileSync(path.join(ARBRE, 'scripts/beluga.service'), 'utf8') : '';
noter(
  'l’unité du service ne nomme aucun compte réel',
  /^User=beluga$/m.test(unite) && /^Environment=HOME=\/home\/beluga$/m.test(unite),
  (unite.match(/^(User|Environment=HOME)=.*$/gm) ?? []).join(' · '),
);

// Les imports relatifs des scripts publiés : aucun ne vise un fichier resté au privé.
const importsCasses = [];
for (const fichier of fs.readdirSync(path.join(ARBRE, 'scripts')).filter((f) => f.endsWith('.mjs'))) {
  const texte = fs.readFileSync(path.join(ARBRE, 'scripts', fichier), 'utf8');
  for (const trouve of texte.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    const cible = path.join(ARBRE, 'scripts', trouve[1]);
    // `../server/dist/…` et `../shared/dist/…` naissent à la construction.
    if (/\/(server|shared)\/dist\//.test(cible)) continue;
    if (!fs.existsSync(cible)) importsCasses.push(`${fichier} → ${trouve[1]}`);
  }
}
noter('aucun script publié n’importe un fichier absent', importsCasses.length === 0, importsCasses.join(' ; '));

// La notice : chaque fichier qu'elle nomme existe dans l'arbre.
const notice = existe('README.md') ? fs.readFileSync(path.join(ARBRE, 'README.md'), 'utf8') : '';
const cites = new Set();
for (const trouve of notice.matchAll(/(?<![\w/.-])((?:scripts|docs|server|shared|web|outils)\/[\w./-]+\.[a-z]{2,4}|[A-Z]{4,}\.md)(?![\w-])/g)) cites.add(trouve[1]);
const fantomes = [...cites].filter((f) => f !== 'README.md' && !existe(f));
noter('la notice ne renvoie vers aucun fichier absent', fantomes.length === 0, fantomes.join(', '));
// Logiciel libre (23/11/2026) : la notice installe le code depuis le dépôt public, nomme la licence et les trois offres.
noter(
  'la notice installe depuis le dépôt public, sous licence libre, avec les offres Gratuit, Cloud et Pro',
  /raw\.githubusercontent\.com\/haikostudio\/beluga\/main\/scripts\/installer\.sh/.test(notice) &&
    /AGPL-3\.0/.test(notice) &&
    /Gratuit/.test(notice) && /Cloud/.test(notice) && /Pro\b/.test(notice) &&
    !/git@github\.com|PolyForm|Tous droits réservés/i.test(notice),
);
for (const fichier of ['LICENSE', 'LICENSING.md', 'CLA.md', 'TRADEMARKS.md', 'CONTRIBUTING.md', '.github/workflows/cla.yml']) {
  noter(`« ${fichier} » part au public`, existe(fichier));
}
noter('les fabriques privées ne partent pas au public', !existe('.github/workflows/applications.yml'));

if (SANS_CONSTRUCTION) finir();

/* ------------------------------------------------------------------ */
/* 3. Installer, construire, démarrer                                   */
/* ------------------------------------------------------------------ */

console.log('\n3. Installation et construction, comme un inconnu');
const envPropre = { ...process.env, NODE_ENV: 'development' };
for (const cle of Object.keys(envPropre)) if (cle.startsWith('BELUGA_')) delete envPropre[cle];
const lancer = (commande, a, limite) => spawnSync(commande, a, { cwd: ARBRE, env: envPropre, encoding: 'utf8', timeout: limite, maxBuffer: 1 << 28 });

const installation = lancer('npm', ['install', '--include=dev', '--no-audit', '--no-fund', '--loglevel=error'], 15 * 60_000);
noter('« npm install » passe', installation.status === 0, installation.status === 0 ? '' : String(installation.stderr).slice(-300));
const construction = installation.status === 0 ? lancer('npm', ['run', 'build'], 15 * 60_000) : { status: 1, stdout: '', stderr: 'non lancée' };
noter(
  '« npm run build » passe',
  construction.status === 0,
  construction.status === 0 ? '' : `${construction.stdout}${construction.stderr}`.slice(-400),
);
if (construction.status !== 0) finir();

console.log('\n4. Premier démarrage');
const DATA = path.join(TMP, 'data');
const HOME = path.join(TMP, 'home');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, HOME, PROJETS, SHOTS]) fs.mkdirSync(dossier, { recursive: true });
const NULLE_PART = path.join(TMP, 'nulle-part', 'aucun-outil');

/*
 * UN FAUX OUTIL GITHUB, pour juger la page GitHub et la page « Votre propre
 * Beluga » sans toucher à GitHub ni créer de dépôt chez personne. Il n'est
 * relié à RIEN au départ : la connexion par code (`auth login --web`) écrit un
 * code comme le vrai, puis « accepte » au bout de trois secondes — il est alors
 * relié au compte « essai ». Il ne connaît aucun dépôt, et « crée » le dépôt
 * demandé comme un dépôt nu de ce dossier jetable, relié sous le nom `origin` —
 * la sauvegarde qui suit est donc un vrai `git push`.
 */
const FAUX_BIN = path.join(TMP, 'faux-bin');
const GH_RELIE = path.join(TMP, 'gh-relie');
const DEPOTS = path.join(TMP, 'depots-distants');
fs.mkdirSync(FAUX_BIN, { recursive: true });
fs.mkdirSync(DEPOTS, { recursive: true });
fs.writeFileSync(
  path.join(FAUX_BIN, 'gh'),
  `#!/usr/bin/env bash
case "$1 $2" in
  "--version "*) echo "gh version 0.0.0 (essai)"; exit 0 ;;
  "api user") [ -f "${GH_RELIE}" ] && { echo "essai"; exit 0; }; echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4 ;;
  "auth login")
    echo "! First copy your one-time code: ABCD-1234" >&2
    echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2
    sleep 3; touch "${GH_RELIE}"; exit 0 ;;
  "auth setup-git") exit 0 ;;
  "repo view") echo "Could not resolve to a Repository" >&2; exit 1 ;;
  "repo create")
    cible="$3"; source=""; distant="origin"
    while [ $# -gt 0 ]; do
      case "$1" in --source) source="$2"; shift ;; --remote) distant="$2"; shift ;; esac
      shift
    done
    nu="${DEPOTS}/$(echo "$cible" | tr / _).git"
    git init --quiet --bare "$nu" && git -C "$source" remote add "$distant" "$nu" && echo "dépôt privé créé : $cible"
    exit $? ;;
esac
echo "faux gh : appel inattendu : $*" >&2; exit 2
`,
  { mode: 0o755 },
);

demon = spawn('node', [path.join(ARBRE, 'server', 'dist', 'main.js')], {
  cwd: ARBRE,
  env: {
    ...envPropre,
    NODE_ENV: 'production',
    HOME,
    PATH: `${FAUX_BIN}:${envPropre.PATH}`,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_CLAUDE_BIN: NULLE_PART,
    BELUGA_CODEX_BIN: NULLE_PART,
    BELUGA_CURSOR_BIN: NULLE_PART,
    // Un démon d'ESSAI (nom, base, dossiers à lui)… qui démarre comme une VRAIE
    // installation neuve : c'est ce départ-là qu'on juge.
    BELUGA_ESSAI: '1',
    BELUGA_PREMIER_DEMARRAGE: 'reel',
    // Le bouton « Installer » se juge sans télécharger un vrai moteur : le démon
    // d'essai lance cette ligne inoffensive à la place de la commande de l'éditeur.
    BELUGA_INSTALLATEUR_D_ESSAI: 'echo "pose de l outil"; sleep 2; echo "outil en place"',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let journal = '';
demon.stdout.on('data', (d) => (journal += String(d)));
demon.stderr.on('data', (d) => (journal += String(d)));

const portOuvert = () =>
  new Promise((resolve) => {
    const prise = net.connect(PORT, '127.0.0.1');
    prise.on('connect', () => (prise.end(), resolve(true)));
    prise.on('error', () => resolve(false));
  });
let demarre = false;
for (let i = 0; i < 240 && !demarre; i++) {
  demarre = await portOuvert();
  if (!demarre) await new Promise((r) => setTimeout(r, 500));
}
noter('le démon démarre sur une base vide', demarre, demarre ? '' : journal.slice(-400));
if (!demarre) finir();

const code = /CODE D'INSTALLATION[^\n]*\n[^\n]*?([A-Z2-9]{4}(?:-[A-Z2-9]{4}){3})/.exec(journal)?.[1] ?? '';
noter('un code d’installation est tiré et montré une fois au journal', Boolean(code));
noter('aucun identifiant tiré au hasard n’est écrit au journal', !/mot de passe :/.test(journal));

const lire = () => new Database(path.join(DATA, 'beluga.db'), { readonly: true });
{
  const db = lire();
  const compte = (sql) => db.prepare(sql).get().n;
  noter('zéro compte', compte('SELECT COUNT(*) AS n FROM users') === 0);
  noter('zéro projet avant le premier compte — le tableau part vide', compte('SELECT COUNT(*) AS n FROM projects') === 0);
  // Chaque compétence semée est aussi une unité de la mémoire (`competences-memoire.ts`) : celles-là seulement.
  noter(
    'aucune unité de mémoire hors des compétences semées',
    compte("SELECT COUNT(*) AS n FROM connaissances WHERE auteur != 'pool-de-competences'") === 0,
    `${compte("SELECT COUNT(*) AS n FROM connaissances WHERE auteur = 'pool-de-competences'")} unité(s) venue(s) des compétences`,
  );
  noter('aucun accès au coffre-fort', compte('SELECT COUNT(*) AS n FROM secrets') === 0);
  const garde = db.prepare("SELECT value FROM meta WHERE key = 'installation.code'").get()?.value ?? '';
  noter('le code n’est gardé que haché', /^[0-9a-f]{64}$/.test(garde) && !garde.includes(code.replace(/-/g, '')));
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  const identite = reglages.installation ?? {};
  const remplies = Object.entries(identite).filter(([, valeur]) => valeur);
  noter(
    'l’identité de l’installation est entièrement vierge',
    remplies.length === 0,
    remplies.map(([cle, valeur]) => `${cle}=${valeur}`).join(', '),
  );
  noter('l’assistant de démarrage est annoncé « à faire »', reglages.assistant?.statut === 'a-faire');
  db.close();
}
const fiches = fs.existsSync(path.join(DATA, 'competences'))
  ? fs.readdirSync(path.join(DATA, 'competences')).filter((nom) => fs.existsSync(path.join(DATA, 'competences', nom, 'SKILL.md')))
  : [];
// Décision du 14/10/2026 : les compétences d'interface publiées sont semées au premier démarrage — elles, et rien d'autre.
noter(
  'les compétences publiées sont semées, et rien d’autre',
  fiches.length === publiees.size && fiches.every((nom) => publiees.has(nom)),
  `${fiches.length} semée(s), ${publiees.size} publiée(s)`,
);

/* ------------------------------------------------------------------ */
/* 5. Le premier accès                                                  */
/* ------------------------------------------------------------------ */

console.log('\n5. Le premier accès');
const accueil = await fetch(BASE, { headers: { 'accept-language': 'fr' } }).then((r) => r.text());
noter('la première page est celle de l’installation, pas un formulaire de connexion', accueil.includes('data-page-installation') && !accueil.includes('action="/auth/login"'));
noter('sans session, l’application reste fermée', (await fetch(`${BASE}/api/me`)).status === 401);
const anglais = await fetch(BASE, { headers: { 'accept-language': 'en-US,en;q=0.9' } }).then((r) => r.text());
noter('la page d’installation suit la langue du navigateur', anglais.includes('Installation code'));
noter('sans lien, la page demande le code et dit comment obtenir un lien neuf', /class="code" name="code"/.test(accueil) && /code-installation\.mjs --lien/.test(accueil));

// LE LIEN DE FIN D'INSTALLATION : le code entre tout seul, personne ne recopie rien.
const parLeLien = await fetch(`${BASE}/?installation=${code}`, { headers: { 'accept-language': 'fr' } });
const pageDuLien = await parLeLien.text();
noter(
  'le lien d’installation remplit le code : plus de champ à recopier ni de commande à taper',
  pageDuLien.includes(`type="hidden" name="code" value="${code}"`) && !/class="code" name="code"/.test(pageDuLien) && !/code-installation\.mjs/.test(pageDuLien),
);
noter(
  'la page du lien ne se garde nulle part et ne donne son adresse à aucun autre site',
  parLeLien.headers.get('cache-control') === 'no-store' && parLeLien.headers.get('referrer-policy') === 'no-referrer',
  `${parLeLien.headers.get('cache-control')} · ${parLeLien.headers.get('referrer-policy')}`,
);
{
  const db = lire();
  noter('ouvrir le lien ne compte aucun essai', db.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get().n === 0);
  db.close();
}
noter('le code n’apparaît pas au journal du démon après l’ouverture du lien', journal.split(code).length <= 2);

const poster = (corps) =>
  fetch(`${BASE}/auth/installation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': corps.ip ?? '203.0.113.9' },
    body: JSON.stringify(corps),
    redirect: 'manual',
  });
const COMPTE = { nomAffiche: 'Ana Durand', username: 'ana', password: 'un-mot-de-passe-long' };
const refus = await poster({ ...COMPTE, code: 'AAAA-AAAA-AAAA-AAAA', ip: '203.0.113.10' });
{
  const db = lire();
  noter('un mauvais code ne crée aucun compte', refus.status === 400 && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0);
  db.close();
}
const insiste = await poster({ ...COMPTE, code, ip: '203.0.113.10' });
noter('après un essai raté, la même adresse doit attendre — même avec le bon code', insiste.status === 429);

const cree = await poster({ ...COMPTE, code, ip: '203.0.113.11' });
const temoin = /beluga_session=([^;]+)/.exec(cree.headers.get('set-cookie') ?? '')?.[1] ?? '';
noter('le bon code crée le compte et ouvre la session', cree.status === 200 && Boolean(temoin));
const rejoue = await poster({ ...COMPTE, username: 'intrus', code, ip: '203.0.113.12' });
{
  const db = lire();
  noter(
    'le code ne sert qu’une fois : la porte est fermée dès que le compte existe',
    rejoue.status === 403 && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 1,
    `réponse ${rejoue.status}`,
  );
  noter('le compte porte le nom saisi, pas un nom écrit dans le code', db.prepare('SELECT nom_affiche AS nom FROM users').get().nom === 'Ana Durand');
  db.close();
}
// LE PROJET DE L'OUTIL ARRIVE AVEC LE PREMIER COMPTE : GitHub n'est pas nécessaire pour modifier Beluga Build.
{
  const debut = Date.now();
  let projetsDeLOutil = [];
  while (Date.now() - debut < 20_000) {
    const db = lire();
    projetsDeLOutil = db.prepare('SELECT name, path, data FROM projects').all();
    db.close();
    if (projetsDeLOutil.length) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  noter(
    'le projet de l’application est sur le tableau dès le premier compte, sans GitHub',
    projetsDeLOutil.length === 1 && projetsDeLOutil[0].path === ARBRE && JSON.parse(projetsDeLOutil[0].data).isSelf === true,
    projetsDeLOutil.map((p) => p.name).join(', ') || 'aucun',
  );
}
const sansCompte = await fetch(BASE).then((r) => r.text());
noter('le compte créé, la page d’installation laisse la place à la page de connexion', sansCompte.includes('action="/auth/login"'));

/* ------------------------------------------------------------------ */
/* 6. L'assistant, dans un vrai navigateur                              */
/* ------------------------------------------------------------------ */

console.log("\n6. L'assistant de démarrage");
const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 }, locale: 'fr-CH', serviceWorkers: 'block' });
  await contexte.addCookies([{ name: 'beluga_session', value: temoin, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
  const page = await contexte.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const assistant = page.locator('[data-assistant-demarrage="1"]');
  await assistant.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => undefined);
  noter('la mise en route occupe l’écran, en discussion', (await assistant.count()) === 1 && (await page.locator('[data-bulle-de-beluga="ouverture"]').count()) === 1);
  noter('elle s’ouvre sur la question du moteur', (await assistant.getAttribute('data-etape').catch(() => null)) === 'moteurs');
  noter(
    'plus aucune page : ni champ d’écriture, ni barre de pages — l’orbe de l’agent en bas',
    (await page.locator('[data-assistant-demarrage] textarea').count()) === 0 &&
      (await page.locator('[data-assistant-demarrage] nav').count()) === 0 &&
      (await page.locator('[data-pied-de-mise-en-route] [data-orbe-de-l-agent]').count()) === 1,
  );
  noter(
    'au repos, aucun terminal n’occupe l’écran : ni volet à droite, ni barre en bas',
    (await page.locator('[data-terminal-d-installation]').count()) === 0,
  );
  await page.locator('[data-question="moteurs"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-bienvenue.png') });
  noter('les moteurs sont proposés au choix', (await page.locator('[data-choix-moteur]').count()) >= 3);
  await page.locator('[data-choix-moteur="claude"]').click().catch(() => undefined);
  await page.locator('[data-moteur="claude"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  noter('le moteur choisi déplie ses gestes dans la bulle, « à installer »', (await page.locator('[data-question="moteurs"] [data-moteur="claude"][data-etape="a-installer"]').count()) === 1);
  noter(
    'sans moteur prêt, on ne peut ni continuer ni passer',
    (await page.locator('[data-assistant-continuer]').isDisabled()) && (await page.locator('[data-assistant-plus-tard]').count()) === 0,
  );
  noter(
    'aucune commande à coller : le moteur choisi a son bouton « Installer »',
    (await page.locator('[data-commande-installation]').count()) === 0 && (await page.locator('[data-moteur="claude"] [data-installer]').count()) === 1,
  );

  // LE BOUTON : il dit son départ dès le clic, et la barre du bas s'ouvre sur la sortie.
  await page.locator('[data-installer="claude"]').click();
  const parti = await page
    .locator('[data-travail="claude"][data-etat-du-travail="en-cours"]')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  noter('« Installer » dit son départ et s’éteint tant que le travail dure', parti && (await page.locator('[data-installer="claude"]').isDisabled()));
  await page.locator('[data-choix-moteur="codex"]').click().catch(() => undefined);
  noter('pendant ce temps, un autre moteur ne peut pas être lancé', await page.locator('[data-installer="codex"]').isDisabled().catch(() => false));
  const sortie = page.locator('[data-terminal-d-installation="en-bas"] .xterm-rows');
  const vue = await page
    .waitForFunction(() => (document.querySelector('[data-terminal-d-installation="en-bas"][data-ouvert="oui"] .xterm-rows')?.textContent ?? '').includes('pose de l outil'), null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  noter('la barre du bas s’ouvre seule, et la sortie s’y affiche en direct', vue, ((await sortie.textContent().catch(() => '')) ?? '').slice(0, 120));
  {
    const barre = await page.locator('[data-terminal-d-installation="en-bas"]').boundingBox();
    const pied = await page.locator('[data-pied-de-mise-en-route]').boundingBox();
    const valider = await page.locator('[data-assistant-continuer]').boundingBox();
    noter(
      'la barre est tout en bas, sous l’orbe, et ne recouvre aucun bouton',
      Boolean(barre && pied && valider && barre.y >= pied.y + pied.height - 1 && valider.y + valider.height <= barre.y && barre.width > 600),
      barre ? `y ${Math.round(barre.y)}, largeur ${Math.round(barre.width)}` : 'introuvable',
    );
  }
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-installation-en-cours.png') });
  const rallume = await page
    .waitForFunction(() => !document.querySelector('[data-installer="codex"]')?.hasAttribute('disabled'), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  await page.locator('[data-choix-moteur="claude"]').click().catch(() => undefined);
  const fini = await page
    .locator('[data-travail="claude"][data-etat-du-travail="reussi"]')
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  noter('le travail se termine, et le bouton se rallume', fini && rallume);
  noter(
    'une fois le travail réussi, la barre se replie toute seule',
    await page
      .locator('[data-terminal-d-installation="en-bas"][data-ouvert="non"]')
      .waitFor({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false),
  );

  // UN ÉCRAN RECHARGÉ RETROUVE LE TRAVAIL : sa sortie est gardée par le démon.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('[data-basculer-terminal]').click({ timeout: 30_000 }).catch(() => undefined);
  const retrouve = await page
    .waitForFunction(() => (document.querySelector('[data-terminal-d-installation="en-bas"] .xterm-rows')?.textContent ?? '').includes('outil en place'), null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  noter('après un rechargement, la barre repliée se rouvre d’un clic et la sortie se relit', retrouve);
  noter('la mise en route reprend à la question du moteur', (await assistant.getAttribute('data-etape').catch(() => null)) === 'moteurs');

  // SUR TÉLÉPHONE, la même barre en bas : rien ne se déplie sous le bouton.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('[data-terminal-d-installation="en-bas"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
  noter(
    'écran étroit : la barre du bas, et aucune sortie dépliée sous le bouton',
    (await page.locator('[data-terminal-d-installation="en-bas"]').count()) === 1 && (await page.locator('[data-terminal-d-installation="dessous"]').count()) === 0,
  );
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-telephone.png') });
  await page.setViewportSize({ width: 1400, height: 900 });
  /*
   * AUCUN MOTEUR N'EST CONNECTÉ ICI, donc la page des moteurs reste fermée —
   * comme elle le doit. Pour juger les pages suivantes, on la note « faite »
   * dans la base de ce démon d'essai : un geste d'essai, dit comme tel.
   */
  {
    const db = new Database(path.join(DATA, 'beluga.db'));
    const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get().value);
    noter('une installation neuve appelle son agent « Beluga »', reglages.assistantNom === 'Beluga', reglages.assistantNom || 'aucun nom');
    reglages.assistant = { statut: 'a-faire', etapes: { moteurs: 'faite' } };
    db.prepare("UPDATE meta SET value = ? WHERE key = 'settings'").run(JSON.stringify(reglages));
    db.close();
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  // BELUGA SE PRÉSENTE, puis la mémoire posée par l'installation dit son état.
  await page.locator('[data-question="bienvenue"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  noter('après le moteur, Beluga se présente dans une bulle', /Beluga Build/.test((await page.locator('[data-bulle-de-beluga="bienvenue"]').textContent().catch(() => '')) ?? ''));
  await page.locator('[data-memoire]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  noter(
    'la mémoire dit son état, et se répare d’un bouton quand elle manque',
    (await page.locator('[data-memoire="a-reparer"] [data-installer="memoire"]').count()) === 1,
    (await page.locator('[data-memoire]').getAttribute('data-memoire').catch(() => null)) ?? 'absente',
  );
  await page.locator('[data-assistant-continuer]').click().catch(() => undefined);
  // LES NOMS : indispensables, mais « Beluga » est déjà là ; il ne manque que le prénom.
  await page.locator('[data-question="assistant"] [data-prenom-de-l-utilisateur]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  noter(
    'la question des noms : sans « Plus tard », sans voix, « Beluga » proposé',
    (await page.locator('[data-assistant-plus-tard]').count()) === 0 &&
      (await page.locator('[data-question="assistant"] [data-assistant-vocal]').count()) === 0 &&
      (await page.locator('[data-nom-de-l-assistant]').inputValue().catch(() => '')) === 'Beluga',
  );
  await page.locator('[data-prenom-de-l-utilisateur]').fill('Ana');
  await page.locator('[data-prenom-de-l-utilisateur]').blur();
  const nomsPrets = await page
    .waitForFunction(() => !document.querySelector('[data-assistant-continuer]')?.hasAttribute('disabled'), null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  noter('le prénom donné, « Valider » s’allume', nomsPrets);
  await page.locator('[data-assistant-continuer]').click().catch(() => undefined);
  await page.locator('[data-bulle-de-la-personne="assistant"]').waitFor({ timeout: 20_000 }).catch(() => undefined);
  noter('la réponse s’écrit en bulle, à droite', /Ana/.test((await page.locator('[data-bulle-de-la-personne="assistant"]').textContent().catch(() => '')) ?? ''));
  const allerA = async (etape) => {
    for (let i = 0; i < 9; i++) {
      if ((await assistant.getAttribute('data-etape').catch(() => null)) === etape) return true;
      await page.locator('[data-assistant-plus-tard]').click({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
    return (await assistant.getAttribute('data-etape').catch(() => null)) === etape;
  };

  // VOTRE ORDINATEUR (20/11/2026) : juste après les noms, le parcours d'installation de l'ordinateur, le MÊME que
  // Réglages › Extension ; « Valider » éteint tant qu'aucun navigateur n'est relié, « Plus tard » permis.
  await page.locator('[data-question="ordinateur"] [data-parcours-integre]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  noter(
    '« Votre ordinateur » vient après les noms, avec le parcours vertical de l’installation',
    (await assistant.getAttribute('data-etape').catch(() => null)) === 'ordinateur' &&
      (await page.locator('[data-question="ordinateur"] [data-etape-connexion="telecharger"][data-etat="en-cours"]').count()) === 1,
  );
  noter(
    'elle se passe : « Plus tard » est là, « Valider » attend un navigateur relié',
    (await page.locator('[data-question="ordinateur"] [data-assistant-plus-tard]').count()) === 1 &&
      (await page.locator('[data-question="ordinateur"] footer [data-assistant-continuer]').isDisabled().catch(() => false)),
  );
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-ordinateur.png') });
  await page.locator('[data-question="ordinateur"] footer [data-assistant-plus-tard]').click().catch(() => undefined);
  await page.locator('[data-bulle-de-la-personne="ordinateur"][data-issue="passee"]').waitFor({ timeout: 20_000 }).catch(() => undefined);
  noter('« Plus tard » la remet aux réglages et la discussion continue', (await page.locator('[data-bulle-de-la-personne="ordinateur"][data-issue="passee"]').count()) === 1);

  // LE NOM DE DOMAINE : cinq fournisseurs, et la règle « tous les noms » pour les autres.
  await page.locator('[data-assistant-demarrage="1"][data-etape="domaine"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  const fournisseurs = await page.locator('[data-choix="fournisseur-de-noms"] [data-choix-valeur]').evaluateAll((lignes) => lignes.map((l) => l.getAttribute('data-choix-valeur')));
  noter(
    'cinq fournisseurs de noms sont proposés, plus la règle « tous les noms »',
    ['hetzner', 'cloudflare', 'infomaniak', 'ovh', 'gandi', 'joker'].every((id) => fournisseurs.includes(id)),
    fournisseurs.join(', '),
  );
  await page.locator('[data-choix-valeur="ovh"]').click();
  await page.locator('[data-secret="dns-ovh-consommateur"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
  noter('OVH demande ses trois clés, chacune dans son champ', (await page.locator('[data-secret^="dns-ovh-"]').count()) === 3);
  await page.locator('[data-choix-valeur="joker"]').click();
  await page.locator('[data-regle-tous-les-noms]').waitFor({ timeout: 15_000 }).catch(() => undefined);
  noter('un autre fournisseur : la règle « tous les noms » est expliquée, sans jeton à confier', (await page.locator('[data-regle-tous-les-noms]').count()) === 1 && (await page.locator('[data-secret^="dns"]').count()) === 0);

  // GITHUB D'ABORD : la page ne se passe pas, le premier projet n'apparaît qu'une fois relié.
  noter('la page GitHub est atteinte', await allerA('projet'));
  await page.locator('[data-section-installation="github"][data-github="a-relier"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  noter(
    'GitHub pas relié : ni premier projet, ni « Plus tard », et « Continuer » éteint qui dit pourquoi',
    (await page.locator('[data-premier-projet]').count()) === 0 &&
      (await page.locator('[data-assistant-plus-tard]').count()) === 0 &&
      (await page.locator('[data-assistant-continuer]').isDisabled()) &&
      /Reliez GitHub pour continuer/.test((await page.locator('[data-question="projet"] footer').textContent().catch(() => '')) ?? ''),
  );
  await page.locator('[data-jeton-github-lien]').click().catch(() => undefined);
  noter(
    'le jeton reste possible derrière un lien, avec son explication et le lien d’un jeton classique',
    (await page.locator('[data-explication-jeton]').count()) === 1 &&
      /scopes=repo,workflow/.test((await page.locator('[data-creer-jeton-classique]').getAttribute('href').catch(() => '')) ?? ''),
  );
  // La page de GitHub s'ouvre dans un onglet : on le referme, rien ne part chez GitHub.
  page.context().on('page', (onglet) => void onglet.close().catch(() => undefined));
  await page.locator('[data-se-connecter-github]').click().catch(() => undefined);
  const codeMontre = await page.locator('[data-code-github="ABCD-1234"]').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  noter('« Se connecter avec GitHub » montre le code à coller', codeMontre);
  const relie = await page.locator('[data-section-installation="github"][data-github="relie"]').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  noter('une fois le code accepté, la page passe au vert toute seule', relie);
  noter(
    'GitHub relié : le premier projet apparaît, « Continuer » s’allume',
    (await page.locator('[data-premier-projet]').count()) === 1 && !(await page.locator('[data-assistant-continuer]').isDisabled()),
  );
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-github.png') });
  await page.locator('[data-assistant-continuer]').click().catch(() => undefined);
  {
    const suivante = await page.locator('[data-assistant-demarrage="1"][data-etape="copie"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
    const db = lire();
    const assistantLu = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}').assistant;
    db.close();
    noter('« Valider » mène à la question suivante, la mise en route reste ouverte', suivante, suivante ? '' : JSON.stringify(assistantLu));
  }

  // VOTRE PROPRE BELUGA : la copie privée, et le projet sur le tableau.
  noter('la page « Votre propre Beluga » est atteinte', await allerA('copie'));
  await page.locator('[data-installer="copie"]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await page.locator('[data-installer="copie"]').click().catch(() => undefined);
  const copieFaite = await page
    .locator('[data-section-installation="copie"][data-copie="faite"]')
    .waitFor({ timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  const sortieDeLaCopie = (await page.locator('[data-terminal-d-installation="en-bas"] .xterm-rows').textContent().catch(() => '')) ?? '';
  noter('« Créer ma copie » va au bout, sous les yeux', copieFaite, copieFaite ? '' : sortieDeLaCopie.slice(-300));
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-copie.png') });
  {
    const git = (...a) => spawnSync('git', ['-C', ARBRE, ...a], { encoding: 'utf8' }).stdout.trim();
    const distants = git('remote', '-v');
    noter(
      'le dépôt public devient « amont », le dépôt de la personne « origin »',
      /^amont\s+https:\/\/github\.com\/haikostudio\/beluga\.git/m.test(distants) && /^origin\s+.*essai_beluga\.git/m.test(distants),
      distants.split('\n').filter((l) => l.includes('(fetch)')).join(' · '),
    );
    // La branche poussée, pas le `HEAD` du dépôt nu (qui garde son nom de branche par défaut).
    const pousse = spawnSync('git', ['-C', path.join(DEPOTS, 'essai_beluga.git'), 'for-each-ref', '--format=%(objectname)', 'refs/heads'], { encoding: 'utf8' }).stdout.trim().split('\n');
    noter('le code est sauvegardé dans le dépôt de la personne', pousse.includes(git('rev-parse', 'HEAD')), `${pousse.length} branche(s) reçue(s)`);
    const db = lire();
    const projet = db.prepare('SELECT name, path, data FROM projects').all();
    noter(
      'le projet de l’application reste seul sur le tableau après la copie — pas de doublon',
      projet.length === 1 && projet[0].path === ARBRE && JSON.parse(projet[0].data).isSelf === true,
      projet.map((p) => p.name).join(', '),
    );
    db.close();
  }

  // LES COURRIELS : trois façons d'envoyer, et rien ne part sans expéditeur.
  noter('la page des courriels est atteinte', await allerA('courriels'));
  // LA SORTIE DIRECTE EST SONDÉE DÈS L'OUVERTURE : bloquée, « Par ce serveur » passe en dernier et ne se prend plus.
  await page.locator('[data-section-installation="courriels"]:not([data-sortie-directe="sondage"])').waitFor({ timeout: 30_000 }).catch(() => undefined);
  const sortieDirecte = (await page.locator('[data-section-installation="courriels"]').getAttribute('data-sortie-directe').catch(() => null)) ?? 'sondage';
  noter('la sortie directe est sondée dès l’ouverture de la page', sortieDirecte !== 'sondage', sortieDirecte);
  const modes = await page.locator('[data-choix="mode-des-courriels"] [data-choix-valeur]').evaluateAll((lignes) => lignes.map((l) => l.getAttribute('data-choix-valeur')));
  noter(
    sortieDirecte === 'bloquee'
      ? 'envoi direct bloqué : le service de courriel d’abord, « Par ce serveur » en dernier et éteint'
      : 'trois façons d’envoyer, le serveur d’abord',
    sortieDirecte === 'bloquee'
      ? modes.join(',') === 'smtp,resend,serveur' && (await page.locator('[data-choix-valeur="serveur"]').isDisabled())
      : modes.join(',') === 'serveur,smtp,resend',
    modes.join(', '),
  );
  await page.locator('[data-choix-valeur="smtp"]').click();
  await page.locator('[data-reglages-smtp]').waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.locator('[data-prereglage-smtp="brevo"]').click().catch(() => undefined);
  await page.waitForTimeout(800);
  noter(
    'un préréglage remplit le serveur d’envoi et le port, rien d’autre',
    (await page.locator('[data-identite="smtpHote"]').inputValue().catch(() => '')) === 'smtp-relay.brevo.com' &&
      (await page.locator('[data-identite="smtpPort"]').inputValue().catch(() => '')) === '587' &&
      (await page.locator('[data-identite="smtpIdentifiant"]').inputValue().catch(() => 'x')) === '',
  );
  if (sortieDirecte !== 'bloquee') await page.locator('[data-choix-valeur="serveur"]').click();
  await page.locator('[data-courriel-d-essai]').fill('essai@example.org');
  await page.locator('[data-envoyer-courriel-d-essai]').click();
  const bilan = ((await page.locator('[data-bilan-courriel-d-essai]').textContent({ timeout: 60_000 }).catch(() => '')) ?? '').trim();
  noter('sans expéditeur, l’essai dit qu’aucun courriel ne part — et rien ne part', /expéditeur/i.test(bilan), bilan.slice(0, 120));
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-courriels.png') });

  // L'ESPACE CLIENT : l'adresse arrive proposée, d'après l'adresse provisoire ou le domaine.
  if (await allerA('espace-client')) {
    await page.locator('[data-adresse="espace-client"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const proposee = await page.locator('[data-adresse="espace-client"]').inputValue().catch(() => '');
    // Un serveur dont le service web n'a pas été posé par l'installateur (ce démon d'essai) crée ses adresses à la main :
    // on n'y propose rien qu'un clic ne saurait mettre en place.
    const aLaMain = (await page.locator('[data-identite="hoteEspaceClient"]').count()) > 0;
    noter(
      aLaMain
        ? 'service web posé à la main : aucune adresse proposée qu’un clic ne saurait mettre en place'
        : 'l’adresse de l’espace client arrive proposée, prête à mettre en place',
      aLaMain ? proposee === '' : /^espace\./.test(proposee),
      proposee || 'champ vide',
    );
  }

  // LES COMPÉTENCES : celles publiées avec Beluga Build se lisent ; d'autres s'ajoutent plus tard, par un agent.
  noter('la page des compétences est atteinte', await allerA('competences'));
  await page.locator('[data-liste-competences]:not([data-liste-competences="chargement"])').waitFor({ timeout: 30_000 }).catch(() => undefined);
  const listees = Number((await page.locator('[data-liste-competences]').getAttribute('data-liste-competences').catch(() => '0')) ?? '0');
  noter('les compétences semées sont listées, à explorer', listees === publiees.size && listees > 0, `${listees} listée(s), ${publiees.size} publiée(s)`);
  await page.locator('[data-competence]').first().click().catch(() => undefined);
  noter(
    'une compétence s’ouvre et se lit',
    await page
      .locator('[data-lecture-competence] h2, [data-lecture-competence] p')
      .nth(1)
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false),
  );
  await page.locator('[data-fermer-lecture-competence]').click().catch(() => undefined);
  noter(
    'elle dit qu’un agent peut ajouter d’autres sources à tout moment',
    /demander à un agent/.test((await page.locator('[data-sources-par-un-agent]').textContent().catch(() => '')) ?? ''),
  );
  noter('la page des fonctions en plus est atteinte', await allerA('facultatif'));
  noter(
    'la dictée et la voix s’installent d’un bouton ; la mémoire n’est plus une option',
    (await page.locator('[data-fonction="dictee"] [data-installer="dictee"]').count()) === 1 &&
      (await page.locator('[data-fonction="voix"] [data-installer="voix"]').count()) === 1 &&
      (await page.locator('[data-fonction="recherche"]').count()) === 0 &&
      (await page.locator('[data-section-installation="facultatif"] [data-commande]').count()) === 0,
  );
  await page.locator('[data-assistant-plus-tard]').click().catch(() => undefined);
  await assistant.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => undefined);
  noter('la dernière réponse referme la mise en route', (await assistant.count()) === 0);

  /*
   * LA VISITE GUIDÉE. Ici, la copie personnelle a déjà posé un projet : la
   * visite ne part donc pas seule (elle ne le fait que sans projet, règle
   * testée dans `visite-guidee.test.ts`). On la relance comme le bouton des
   * réglages, et on juge la bulle et sa croix.
   */
  await page.evaluate(() => window.dispatchEvent(new Event('beluga:visite-guidee')));
  const bulle = page.locator('[data-visite-guidee]');
  // Sans moteur prêt, la fenêtre « Mettons un moteur en place » recouvre l'écran : la bulle s'efface sous elle.
  // Cette fenêtre arrive un instant après la mise en route refermée : on lui laisse le temps de paraître.
  const RECOUVRE = '[role="dialog"], [role="alertdialog"], [data-assistant-moteurs]';
  await page.locator(RECOUVRE).first().waitFor({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const fenetre = (await page.locator(RECOUVRE).count()) > 0;
  if (fenetre) {
    noter('une fenêtre ouverte par-dessus : la bulle s’efface, elle ne la recouvre pas', (await bulle.count()) === 0);
  } else {
    noter(
      'relancée, la visite pose une bulle contre un bouton de l’écran — un projet existe, l’étape « + » est passée',
      (await bulle.count()) === 1 && (await bulle.getAttribute('data-etape-visite').catch(() => 'projet')) !== 'projet',
      (await bulle.getAttribute('data-etape-visite').catch(() => null)) ?? 'aucune bulle',
    );
    await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-visite-guidee.png') });
    await page.locator('[data-fermer-visite]').click().catch(() => undefined);
    noter('une croix la ferme, pour de bon', await bulle.waitFor({ state: 'detached', timeout: 10_000 }).then(() => true).catch(() => false));
  }

  // LES NOUVEAUTÉS (logiciel libre, 23/11/2026) : la version gratuite EST le dépôt public et en reçoit les nouveautés.
  // Quand il a autre chose que cette copie, la bande NOIRE du haut le dit, pleine largeur et collée en haut (la même
  // forme que la bande de l'extension), et mène à la page « Mise à jour ». Rien ne se pose ni ne se lance tout seul,
  // et la section « Passer à Beluga Cloud » ne contacte personne avant son clic.
  const amontLu = spawnSync('git', ['-C', ARBRE, 'rev-parse', '--verify', '--quiet', 'amont/main'], { encoding: 'utf8' }).status === 0;
  if (!amontLu) {
    console.log('        (dépôt public injoignable d’ici : le bandeau de mise à jour n’est pas jugé)');
  } else {
    const bande = page.locator('[data-bandeau-mise-a-jour]');
    await bande.waitFor({ timeout: 60_000 }).catch(() => undefined);
    const forme = await bande
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { haut: r.top, gauche: r.left, droite: window.innerWidth - r.right, arrondi: s.borderTopLeftRadius, genre: el.getAttribute('data-bande-du-haut') };
      })
      .catch(() => null);
    noter(
      'des nouveautés du dépôt public : la bande « Mettre à jour » touche le haut et les deux bords, sans arrondi',
      !!forme && forme.haut === 0 && forme.gauche === 0 && Math.abs(forme.droite) < 1 && forme.arrondi === '0px' && forme.genre === 'information',
      JSON.stringify(forme),
    );
    await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-bandeau.png') });
    for (const [largeur, schema] of [[390, 'dark'], [390, 'light'], [1440, 'light']]) {
      await page.setViewportSize({ width: largeur, height: largeur === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: schema });
      await page.waitForTimeout(600);
      const haut = await bande.evaluate((el) => el.getBoundingClientRect().top).catch(() => -1);
      noter(`[${largeur} ${schema}] la bande reste collée en haut`, haut === 0, String(haut));
      await page.screenshot({ path: path.join(SHOTS, `installation-neuve-bandeau-${largeur}-${schema}.png`) });
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    // Le bouton de la bande ne lance rien : il ouvre la page « Mise à jour » des réglages.
    await page.locator('[data-mettre-a-jour]').click().catch(() => undefined);
    const pageMaj = page.locator('[data-page-mise-a-jour="suivi"]');
    noter(
      'le bouton de la bande ouvre la page « Mise à jour » des réglages',
      await pageMaj.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false),
    );
    noter(
      'la section « Passer à Beluga Cloud » est là, fermée : personne n’est contacté avant son clic',
      (await page.locator('[data-offre-cloud="fermee"]').count()) === 1,
    );
    await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-page-mise-a-jour.png') });
    for (const [largeur, schema] of [[390, 'dark'], [390, 'light'], [1440, 'light']]) {
      await page.setViewportSize({ width: largeur, height: largeur === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: schema });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS, `installation-neuve-page-mise-a-jour-${largeur}-${schema}.png`) });
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    const avant = lire();
    const cartesAvant = avant.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
    avant.close();
    noter('ouvrir la page ne pose aucune tâche', cartesAvant === 0, `${cartesAvant} carte(s)`);
    await page.locator('[data-recuperer-les-nouveautes]').click().catch(() => undefined);
    await page.waitForTimeout(5000);
    const db = lire();
    const cartes = db.prepare("SELECT title, column_key AS colonne, json_extract(data, '$.miseAJourBeluga') AS marque FROM cards").all();
    db.close();
    noter(
      '« Mettre à jour » de la page pose une tâche MARQUÉE dans le projet de l’application',
      cartes.length === 1 && /nouveautés/.test(cartes[0].title) && cartes[0].marque === 1,
      JSON.stringify(cartes),
    );
    const git = (...a) => spawnSync('git', ['-C', ARBRE, ...a], { encoding: 'utf8' }).stdout.trim();
    noter('rien n’a été appliqué tout seul : le code n’a pas bougé', git('status', '--porcelain', '--untracked-files=no') === '');
    await page.keyboard.press('Escape').catch(() => undefined);
  }

  const identite = await page.locator('meta[name="beluga-installation"]').getAttribute('content');
  const dite = Object.values(JSON.parse(identite ?? '{}')).filter(Boolean);
  noter('la page ne porte aucune valeur d’installation', dite.length === 0, dite.join(', '));
  const texte = (await page.locator('body').innerText()).toLowerCase();
  const vues = interditsAuPublic.filter((valeur) => texte.includes(valeur.toLowerCase()));
  noter('aucune valeur interdite n’apparaît à l’écran', vues.length === 0, vues.join(', '));
  await page.screenshot({ path: path.join(SHOTS, 'installation-neuve-assistant.png') });
} finally {
  await navigateur.close();
}

const pannes = journal.split('\n').filter((ligne) => /\bERROR\b|exception non rattrapée|promesse rejetée/.test(ligne));
noter('le journal du démon ne porte aucune erreur', pannes.length === 0, pannes.slice(0, 3).join(' | ').slice(0, 400));

finir();
