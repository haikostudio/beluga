import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RapportDUsage,
  appareilDuNavigateur,
  centiles,
  empreinteDePanne,
  familleDeRoute,
  fonctionnaliteDuGeste,
  genreDuProjet,
  lieuDeLaPanne,
  nettoyerLeRapport,
  nettoyerPile,
  nettoyerTexteLibre,
} from '@beluga/shared';

const INSTALLATION = '671c6126-4b06-4bcd-87a5-927076cbed9a';
const SECRET = 'a'.repeat(64);

test('le nettoyage retire courriels, adresses, chemins, jetons et numéros', () => {
  const brut =
    "Échec pour jean.dupont@exemple.fr sur https://exemple.fr/admin?x=1 depuis 192.168.1.20 : ENOENT /home/jean/projets/client-secret/index.php, jeton ghp_abcdefghijklmnopqrstuvwxyz0123, tél +41 79 123 45 67";
  const propre = nettoyerTexteLibre(brut);
  assert.doesNotMatch(propre, /jean|dupont|exemple\.fr|192\.168|client-secret|ghp_|79 123/);
  assert.match(propre, /\[courriel\]/);
  assert.match(propre, /\[adresse\]/);
  assert.match(propre, /\[ip\]/);
  assert.match(propre, /\[chemin\]/);
  assert.match(propre, /\[jeton\]/);
  assert.match(propre, /\[numero\]/);
});

test('un chemin du code de Beluga garde sa fin, sans le compte de la machine', () => {
  const propre = nettoyerTexteLibre('at handle (/home/marie/beluga/server/dist/ws.js:120:7)');
  assert.match(propre, /server\/dist\/ws\.js:120:7/);
  assert.doesNotMatch(propre, /marie/);
  // Une seconde passe (à la réception) ne change plus rien.
  assert.equal(nettoyerTexteLibre(propre), propre);
});

test('une date, une version et un numéro de ligne restent lisibles', () => {
  assert.equal(nettoyerTexteLibre('version 2026-10-20 b4d5c94, ligne 42'), 'version 2026-10-20 b4d5c94, ligne 42');
});

test('les identifiants tirés au hasard disparaissent : deux fois la même panne se reconnaît', () => {
  const a = nettoyerTexteLibre('carte 0b3c1c55-7e11-4c1a-9b0a-4f5d1a2b3c4d introuvable');
  const b = nettoyerTexteLibre('carte 9d8e7f6a-1111-4222-8333-444455556666 introuvable');
  assert.equal(a, b);
  assert.equal(empreinteDePanne('serveur', a), empreinteDePanne('serveur', b));
  assert.notEqual(empreinteDePanne('serveur', a), empreinteDePanne('affichage', a));
  assert.match(empreinteDePanne('x', 'y'), /^[0-9a-f]{16}$/);
});

test('le mot libre est coupé à sa longueur', () => {
  assert.equal(nettoyerTexteLibre('mot '.repeat(200)).length, 501);
});

test('une pile nettoyée garde ses lignes utiles', () => {
  const pile = nettoyerPile('Error: x\n    at f (/root/beluga/web/src/app.tsx:10:3)\n    at g (/home/ana/secret/thing.js:1:1)');
  assert.match(pile!, /web\/src\/app\.tsx:10:3/);
  assert.doesNotMatch(pile!, /ana|secret/);
  assert.equal(lieuDeLaPanne('Error\n    at f (/root/beluga/web/src/app.tsx:10:3)'), 'f (web/src/app.tsx:10:3)');
});

test('centiles et familles', () => {
  assert.deepEqual(centiles([]), { n: 0, p50: 0, p95: 0, max: 0 });
  const c = centiles(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(c.p50, 50);
  assert.equal(c.p95, 95);
  assert.equal(c.max, 100);
  assert.equal(familleDeRoute('/api/relais/installations?x=1'), 'relais');
  assert.equal(familleDeRoute('/api/../../etc'), 'autre');
  assert.equal(fonctionnaliteDuGeste('card.move'), 'card');
});

test('appareil, système et navigateur', () => {
  assert.deepEqual(
    appareilDuNavigateur('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    { appareil: 'telephone', systeme: 'iOS', navigateur: 'Safari' },
  );
  assert.deepEqual(appareilDuNavigateur('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'), {
    appareil: 'ordinateur',
    systeme: 'Linux',
    navigateur: 'Chrome',
  });
});

test('le genre d’un projet se lit dans les noms de sa racine, jamais dans son contenu', () => {
  assert.deepEqual(genreDuProjet(['package.json', 'nuxt.config.ts', 'tsconfig.json']), { genre: 'site', langages: ['javascript', 'typescript'] });
  assert.equal(genreDuProjet(['capacitor.config.ts', 'package.json']).genre, 'mobile');
  assert.equal(genreDuProjet(['wp-config.php', 'wp-content']).genre, 'site');
  assert.equal(genreDuProjet(['go.mod', 'main.go']).genre, 'application');
  assert.equal(genreDuProjet(['outil.py', 'requirements.txt']).genre, 'script');
  assert.equal(genreDuProjet(['LISEZMOI.md']).genre, 'autre');
});

function rapport(jour: string, extra: Partial<RapportDUsage> = {}, installation = INSTALLATION): RapportDUsage {
  return RapportDUsage.parse({ installation, secret: SECRET, jour, version: 'v', ...extra });
}

test('le rapport ne porte aucun nom de projet : seulement genre, langages et services', () => {
  const r = rapport('2026-10-22', {
    projets: { total: 1, liste: [{ genre: 'site', langages: ['php'], services: ['github'], nom: 'Client secret' } as never] },
  });
  assert.doesNotMatch(JSON.stringify(r.projets), /Client secret|nom/);
});

test('la dernière passe renettoie pannes et mots libres', () => {
  const r = nettoyerLeRapport(
    rapport('2026-10-22', {
      erreurs: [{ empreinte: 'x', source: 'serveur', message: 'échec pour ana@exemple.ch', n: 2 }],
      satisfaction: [{ p: 'abcdefabcdef', t: 1, note: 8, mot: 'Super, écrivez-moi : ana@exemple.ch' }],
    }),
  );
  assert.doesNotMatch(JSON.stringify(r), /ana@exemple\.ch/);
});
