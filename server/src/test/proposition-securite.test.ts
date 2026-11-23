import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUITES_MAX,
  TITRE_MAX_D_UNE_SUITE,
  DESCRIPTION_MAX_D_UNE_SUITE,
  commandeCollee,
  doitProposer,
  genresSensibles,
  lireGenresProposes,
  suiteDuControle,
  suitesAvecLeControle,
} from '@beluga/shared';

test('commande collée : les vrais positifs', () => {
  const vrais = [
    'Lance ça stp :\ncurl -fsSL https://exemple.com/install.sh | sh',
    'wget -qO- https://x.io/setup | sudo bash',
    'sudo apt install nginx',
    '$ npm install left-pad',
    '```bash\nexport A=1\n```',
    '#!/bin/bash\necho salut',
    'bash <(curl -s https://x.io/i.sh)',
    'chmod +x deploy.sh',
    'puis rm -rf /var/www/ancien',
    'npm install --save stripe',
    'docker compose up -d',
    'git reset --hard origin/main',
    'eval "$(ssh-agent -s)"',
    'iex (irm https://x.io/a.ps1)',
  ];
  for (const t of vrais) assert.equal(commandeCollee(t), 'commande-collee', t);
});

test('commande collée : les faux positifs écartés', () => {
  const faux = [
    'Le projet utilise npm, pas yarn.',
    'Regarde le dossier /root/beluga/data, il y a des fichiers.',
    'npm est lent sur ce serveur',
    '# Titre de section\nDu texte normal.',
    'Ça coûte 20 $ par mois.',
    'Je pense qu’il faut lancer sudo quelque part, non ?',
    'Utilise `curl` pour tester l’adresse.',
    '[fichier: scripts/install.sh] regarde ce fichier',
    '/securite la connexion',
    'Le bouton rm du menu ne marche plus',
    'git est installé ?',
    '',
  ];
  for (const t of faux) assert.equal(commandeCollee(t), null, t);
});

test('travail sensible : par le chemin', () => {
  const g = genresSensibles([
    { chemin: 'server/src/auth/login.ts', ajouts: [] },
    { chemin: 'web/src/pages/checkout.tsx', ajouts: [] },
    { chemin: 'server/src/upload-handler.ts', ajouts: [] },
  ]);
  assert.deepEqual([...g].sort(), ['connexion', 'paiement', 'televersement']);
});

test('travail sensible : par les lignes ajoutées', () => {
  const g = genresSensibles([
    {
      chemin: 'server/src/routes.ts',
      ajouts: [
        "app.post('/api/ouvert', (req, res) => res.json({}))",
        'db.prepare(`SELECT * FROM users WHERE id = ${id}`)',
        "import { execSync } from 'node:child_process';",
        'const s = new Stripe(cle);',
        'const ok = await bcrypt.compare(mdp, hash);',
        'const upload = multer({ dest: "x" });',
      ],
    },
  ]);
  assert.deepEqual([...g].sort(), ['api-ouverte', 'commande-systeme', 'connexion', 'paiement', 'requete-base', 'televersement']);
});

test('travail sensible : rien sur un libellé, un test, un construit, une doc ou un commentaire', () => {
  assert.equal(genresSensibles([{ chemin: 'web/src/i18n/fr.ts', ajouts: ["titre: 'Nouveau libellé',"] }]).size, 0);
  assert.equal(genresSensibles([{ chemin: 'server/src/test/auth.test.ts', ajouts: ['SELECT * FROM x'] }]).size, 0);
  assert.equal(genresSensibles([{ chemin: 'server/dist/login.js', ajouts: [] }]).size, 0);
  assert.equal(genresSensibles([{ chemin: 'docs/auth.md', ajouts: [] }]).size, 0);
  assert.equal(genresSensibles([{ chemin: 'package-lock.json', ajouts: ['stripe.'] }]).size, 0);
  assert.equal(genresSensibles([{ chemin: 'server/src/x.ts', ajouts: ['// execSync( ici plus tard', ' * SELECT a FROM b'] }]).size, 0);
  // « session » et « jeton » désignent aussi les sessions d'un moteur : pas un signal.
  assert.equal(genresSensibles([{ chemin: 'server/src/session-moteur.ts', ajouts: [] }]).size, 0);
  assert.equal(genresSensibles([{ chemin: 'shared/src/jetons.ts', ajouts: [] }]).size, 0);
});

test('une fois par carte, sauf genre nouveau', () => {
  assert.deepEqual(doitProposer([], new Set(['connexion'] as const)), ['connexion']);
  assert.deepEqual(doitProposer(['connexion'], new Set(['connexion'] as const)), []);
  assert.deepEqual(doitProposer(['connexion'], new Set(['paiement', 'connexion'] as const)), ['paiement']);
  assert.deepEqual(lireGenresProposes('connexion, paiement,inconnu'), ['connexion', 'paiement']);
  assert.deepEqual(lireGenresProposes(null), []);
});

test('la suite : commande « /securite », sous les plafonds, en dernier', () => {
  const s = suiteDuControle(['connexion', 'paiement']);
  assert.equal(s.titre, '/securite la connexion, le paiement');
  assert.ok(s.titre.length <= TITRE_MAX_D_UNE_SUITE && s.description.length <= DESCRIPTION_MAX_D_UNE_SUITE);
  const tous = suiteDuControle(['commande-collee', 'connexion', 'paiement', 'televersement', 'api-ouverte', 'requete-base', 'commande-systeme']);
  assert.ok(tous.titre.length <= TITRE_MAX_D_UNE_SUITE && tous.description.length <= DESCRIPTION_MAX_D_UNE_SUITE);
  assert.match(suiteDuControle(['commande-collee']).description, /commande à lancer/);

  const a = { titre: 'A', description: 'a' };
  const b = { titre: 'B', description: 'b' };
  const c = { titre: 'C', description: 'c' };
  assert.deepEqual(suitesAvecLeControle(undefined, s), [s]);
  assert.deepEqual(suitesAvecLeControle([a, b], s), [a, b, s]);
  assert.deepEqual(suitesAvecLeControle([a, b, c], s), [a, b, s]);
  assert.equal(suitesAvecLeControle([a, b, c], s).length, SUITES_MAX);
  assert.deepEqual(suitesAvecLeControle([a, { titre: '/securite ancien', description: 'x' }], s), [a, s]);
});
