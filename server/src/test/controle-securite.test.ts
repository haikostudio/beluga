import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carteDeCorrection,
  cheminCoteNavigateur,
  clesEcrites,
  constatsDAcces,
  constatsDeCles,
  constatsDeDependances,
  constatsDEntetes,
  constatsDInjections,
  graviteDAudit,
  graviteDUneCle,
  injectionsDansLeCode,
  rapportEnTexte,
  routesDuFichier,
  trierParGravite,
} from '@beluga/shared';

/* La frontière du silence sur les identifiants, tranchée avec l'utilisateur : une clé ne se signale
 * que si des inconnus peuvent la lire — dépôt public, ou clé envoyée au navigateur. */

// Valeurs fabriquées pour le test, découpées pour ne jamais ressembler à une clé dans ce fichier.
const CLE_IA = 'sk-' + 'ant-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const MOT_DE_PASSE = 'Zq8' + 'mW2xKp9';

test('une clé gardée dans un dépôt privé, côté serveur, ne se signale pas', () => {
  const cles = clesEcrites('server/config.ts', `const cle = "${CLE_IA}";\nconst password = "${MOT_DE_PASSE}";`);
  assert.equal(cles.length, 2, 'la clé est bien reconnue…');
  assert.deepEqual(constatsDeCles(cles, false), [], '…mais le rapport n’en dit rien');
  assert.equal(graviteDUneCle(cles[0]!, false), null);
});

test('un fichier .env privé reste muet, même rangé sous le dossier de l’interface', () => {
  const cles = clesEcrites('web/.env', `API_SECRET="${MOT_DE_PASSE}"`);
  assert.equal(cles.length, 1);
  assert.deepEqual(constatsDeCles(cles, false), []);
});

test('dépôt public : toute clé écrite est critique, sans jamais recopier sa valeur', () => {
  const cles = clesEcrites('server/config.ts', `const cle = "${CLE_IA}";`);
  const [c] = constatsDeCles(cles, true);
  assert.equal(c!.gravite, 'critique');
  const rapport = rapportEnTexte({ projet: 'x', date: 'aujourd’hui', depotPublic: true, constats: [c!], etapes: [] });
  assert.doesNotMatch(rapport, new RegExp(CLE_IA.slice(10, 30)));
  assert.match(rapport, /server\/config\.ts:1/);
});

test('une clé envoyée au navigateur se signale même dans un dépôt privé', () => {
  const page = clesEcrites('web/src/carte.ts', `const apiKey = "${MOT_DE_PASSE}";`);
  assert.equal(constatsDeCles(page, false)[0]!.gravite, 'elevee');
  const variable = clesEcrites('.env', `VITE_STRIPE_SECRET_KEY="${MOT_DE_PASSE}"`);
  assert.equal(variable[0]!.versNavigateur, true);
  assert.equal(constatsDeCles(variable, false)[0]!.id, 'secrets-navigateur');
});

test('les valeurs de façade et les renvois à une variable ne sont pas des clés', () => {
  assert.deepEqual(clesEcrites('a.ts', 'const password = "changeme123";'), []);
  assert.deepEqual(clesEcrites('a.ts', 'const apiKey = process.env.API_KEY;'), []);
  assert.deepEqual(clesEcrites('a.ts', 'const token = "${TOKEN_FROM_ENV}";'), []);
  assert.deepEqual(clesEcrites('web/i18n.ts', '"login.password": "Password",'), [], 'un libellé de traduction');
  assert.deepEqual(clesEcrites('web/i18n.ts', '"account.passwordHint": "Mot.de.passe",'), []);
});

test('le dossier serveur le plus proche l’emporte sur celui de l’interface', () => {
  assert.equal(cheminCoteNavigateur('web/src/App.tsx'), true);
  assert.equal(cheminCoteNavigateur('public/app.js'), true);
  assert.equal(cheminCoteNavigateur('web/server/api.ts'), false);
  assert.equal(cheminCoteNavigateur('server/src/http.ts'), false);
});

test('injections : la saisie directe d’un visiteur aggrave le point', () => {
  const sql = injectionsDansLeCode('server/a.ts', 'db.query(`SELECT * FROM u WHERE id = ${req.query.id}`);');
  assert.equal(sql[0]!.genre, 'injection-sql');
  assert.equal(constatsDInjections(sql)[0]!.gravite, 'critique');
  const interne = injectionsDansLeCode('server/a.ts', 'db.prepare(`SELECT * FROM t WHERE c = ${colonne}`).all();');
  assert.equal(constatsDInjections(interne)[0]!.gravite, 'moyenne');
  const sur = injectionsDansLeCode('server/a.ts', "db.prepare('SELECT * FROM t WHERE id = ?').get(id);");
  assert.deepEqual(sur, []);
  const shell = injectionsDansLeCode('server/a.ts', 'execSync(`git log ${branche}`);');
  assert.equal(shell[0]!.genre, 'injection-shell');
  const xss = injectionsDansLeCode('web/a.tsx', '<div dangerouslySetInnerHTML={{ __html: texte }} />');
  assert.equal(xss[0]!.genre, 'xss');
  assert.deepEqual(injectionsDansLeCode('web/a.ts', "el.innerHTML = '';"), []);
  assert.deepEqual(injectionsDansLeCode('server/test/a.test.ts', 'execSync(`rm ${x}`)'), [], 'les tests ne comptent pas');
});

test('routes : un fichier sans garde visible est signalé, une garde globale fait taire', () => {
  const nu = routesDuFichier('server/routes.ts', "app.get('/api/a', h);\napp.post('/api/b', h);")!;
  assert.deepEqual([nu.routes, nu.ecritures, nu.garde], [2, 1, false]);
  assert.equal(constatsDAcces([nu], false)[0]!.gravite, 'elevee');
  assert.deepEqual(constatsDAcces([nu], true), []);
  const garde = routesDuFichier('server/r.ts', "app.get('/api/a', requireAuth, h);")!;
  assert.deepEqual(constatsDAcces([garde], false), []);
});

test('en-têtes : un site nu reçoit ses points, un site soigné aucun', () => {
  const nu = constatsDEntetes({ adresse: 'https://x.fr', statut: 200, entetes: { 'x-powered-by': 'Express 4.18' } });
  const ids = nu.map((c) => c.id);
  for (const id of ['entete-hsts', 'entete-csp', 'entete-cadre', 'entete-nosniff', 'entete-referrer', 'entete-version']) {
    assert.ok(ids.includes(id), id);
  }
  const soigne = constatsDEntetes({
    adresse: 'https://x.fr',
    statut: 200,
    redirigeVersHttps: true,
    entetes: {
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'set-cookie': ['sid=1; Path=/; Secure; HttpOnly'],
    },
  });
  assert.deepEqual(soigne, []);
});

test('dépendances : le socle du site a son propre point, le reste est classé par gravité', () => {
  assert.equal(graviteDAudit('high'), 'elevee');
  const constats = constatsDeDependances([
    { nom: 'next', gravite: 'critique', correctionDisponible: true, pile: 'npm' },
    { nom: 'lodash', gravite: 'moyenne', correctionDisponible: true, pile: 'npm' },
    { nom: 'tar', gravite: 'elevee', correctionDisponible: false, pile: 'npm' },
  ]);
  assert.deepEqual(trierParGravite(constats).map((c) => c.id), ['cadre-faille-connue', 'dependances-elevee', 'dependances-moyenne']);
});

test('le rapport se lit par gravité et chaque point devient une carte proposée', () => {
  const constats = constatsDEntetes({ adresse: 'http://x.fr', statut: 200, entetes: {} });
  const texte = rapportEnTexte({
    projet: 'Essai',
    date: '7 novembre',
    depotPublic: false,
    constats,
    etapes: [{ nom: 'Composants externes', etat: 'non-verifie', note: 'outil absent' }],
  });
  assert.ok(texte.indexOf('## Élevée') < texte.indexOf('## Moyenne'));
  assert.ok(texte.indexOf('## Moyenne') < texte.indexOf('## Faible'));
  assert.match(texte, /\*\*Ce qui risque :\*\*/);
  assert.match(texte, /\*\*Ce qu'on propose :\*\*/);
  assert.match(texte, /non vérifié — Composants externes/);
  const carte = carteDeCorrection(constats[0]!);
  assert.match(carte.titre, /^Sécurité : /);
  assert.match(carte.description, /\*\*Vérification\*\*/);
});
