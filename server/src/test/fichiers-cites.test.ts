import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UN FICHIER CITÉ PAR L'AGENT S'OUVRE — ET RIEN D'AUTRE.
 *
 * La reconnaissance d'un chemin dans le texte est prudente (« Node.js » ne se
 * clique pas), et la route ne sert qu'un fichier dont le chemin RÉEL tombe dans
 * les dossiers du projet : ni « .. », ni lien symbolique vers /etc.
 */

process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fichiers-cites-'));
const { cheminDeFichierCite, typeServiDUnFichierCite, adresseDeFichierCite, documentsDuTour } = await import('@beluga/shared');
const { fichierCite } = await import('../files.js');

test('seul un texte qui a toute la forme d’un chemin se clique', () => {
  assert.equal(cheminDeFichierCite('/mnt/disque/rapport.pdf'), '/mnt/disque/rapport.pdf');
  assert.equal(cheminDeFichierCite('web/src/lib/markdown.tsx:42'), 'web/src/lib/markdown.tsx');
  assert.equal(cheminDeFichierCite('./docs/plan.md'), 'docs/plan.md');
  assert.equal(cheminDeFichierCite('file:///tmp/a%20b.png'), null, 'un espace n’est jamais accepté');
  assert.equal(cheminDeFichierCite('file:///tmp/capture.png'), '/tmp/capture.png');
  for (const faux of ['Node.js', 'package.json', 'https://exemple.fr/a.pdf', '3/4', '@beluga/shared', 'scripts/*.mjs', '../secret.txt', 'npm run build', 'src/lib']) {
    assert.equal(cheminDeFichierCite(faux), null, faux);
  }
});

test('une page HTML ou un SVG ne se sert jamais tel quel', () => {
  assert.deepEqual(typeServiDUnFichierCite('text/html'), { type: 'text/plain; charset=utf-8', isole: true });
  assert.equal(typeServiDUnFichierCite('image/svg+xml').isole, true);
  assert.deepEqual(typeServiDUnFichierCite('application/pdf'), { type: 'application/pdf', isole: false });
  assert.match(adresseDeFichierCite({ projectId: 'p', agentId: 'a', chemin: '/x y.pdf', info: true }), /^\/api\/fichier-cite\?project=p&path=%2Fx\+y\.pdf&agent=a&info=1$/);
});

test('la route ne sert que ce qui tombe réellement dans les racines', () => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-projet-'));
  const dehors = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-dehors-'));
  fs.mkdirSync(path.join(projet, 'docs'));
  fs.writeFileSync(path.join(projet, 'docs', 'rapport.pdf'), '%PDF-1.4');
  fs.writeFileSync(path.join(dehors, 'secret.txt'), 'non');
  fs.symlinkSync(path.join(dehors, 'secret.txt'), path.join(projet, 'lien.txt'));

  const relatif = fichierCite('docs/rapport.pdf', [projet], [projet]);
  assert.equal(relatif?.mime, 'application/pdf');
  assert.equal(relatif?.taille, 8);
  assert.ok(fichierCite(path.join(projet, 'docs', 'rapport.pdf'), [projet], []));
  assert.equal(fichierCite('../' + path.basename(dehors) + '/secret.txt', [projet], [projet]), null, 'pas de sortie par ..');
  assert.equal(fichierCite(path.join(dehors, 'secret.txt'), [projet], []), null, 'hors racines');
  assert.equal(fichierCite('lien.txt', [projet], [projet]), null, 'un lien symbolique qui sort est refusé');
  assert.equal(fichierCite('/etc/passwd', [projet], [projet]), null);
  assert.equal(fichierCite('docs', [projet], [projet]), null, 'un dossier n’est pas un fichier');
});

test('les documents d’un tour : écrits, joints, sans doublon, jamais du code ni une suppression', () => {
  // Un journal borne ses paramètres : le JSON arrive souvent coupé en route.
  const coupe = '{\n  "relativePath": "docs/leads/2026-10-25-leads-saas-pwa.md",\n  "content": "# Leads SaaS — relevé du 25';
  assert.deepEqual(
    documentsDuTour([
      { outil: 'mcp__beluga__write_document', params: coupe, reussie: true },
      { outil: 'write_document', params: coupe },
      { outil: 'write_document', params: '{"relativePath": "docs/vieux.md", "action": "supprimer"}' },
      { outil: 'write_document', params: '{"relativePath": "docs/refuse.md"}', reussie: false },
      { outil: 'Write', params: '{"file_path": "/root/beluga/.worktrees/carte-1/docs/rapport.md", "content": "x"}' },
      { outil: 'Write', params: '{"file_path": "/root/beluga/server/src/index.ts", "content": "x"}' },
      { outil: 'mcp__beluga__attach_file', params: '{"path": "/mnt/pieces/c819ae-capture.png"}' },
      { outil: 'attach_file', params: '{"path": "/mnt/pieces/devis.pdf"}' },
      { outil: 'Read', params: '{"file_path": "/root/beluga/docs/lu.md"}' },
    ]),
    ['docs/leads/2026-10-25-leads-saas-pwa.md', 'docs/rapport.md', '/mnt/pieces/devis.pdf'],
  );
  assert.deepEqual(documentsDuTour([{ outil: 'write_document', params: '{"relativePath": "notes.md"}' }]), ['notes.md']);
});

test('un chemin de copie refermée retombe sur le fichier du projet', () => {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-repli-'));
  fs.mkdirSync(path.join(projet, 'docs'));
  fs.writeFileSync(path.join(projet, 'docs', 'plan.md'), '# plan');
  fs.symlinkSync('/etc/hostname', path.join(projet, 'docs', 'lien.md'));
  for (const copie of [`${projet}/.worktrees/carte-1/docs/plan.md`, `/root/beluga/data/copies/carte-1/docs/plan.md`]) {
    assert.equal(fichierCite(copie, [projet], [projet])?.file, fs.realpathSync(path.join(projet, 'docs', 'plan.md')), copie);
  }
  assert.equal(fichierCite(`${projet}/.worktrees/carte-1/docs/lien.md`, [projet], [projet]), null, 'un lien qui sort reste refusé');
  assert.equal(fichierCite(`${projet}/.worktrees/carte-1/docs/absent.md`, [projet], [projet]), null);
});

test('les règles de la copie : citations, écritures, fichiers sensibles', async () => {
  const { cheminsCitesDansLeTexte, cheminEcritParUnOutil, fichierSensible, relatifDUneCopieDeCarte } = await import('@beluga/shared');
  assert.deepEqual(
    cheminsCitesDansLeTexte('Voir `docs/a.md:12`, [le plan](/tmp/plan.pdf), `Node.js`, [site](https://x.fr/a.pdf) et encore `docs/a.md`.'),
    ['docs/a.md', '/tmp/plan.pdf'],
  );
  assert.equal(cheminEcritParUnOutil('mcp__beluga__write_document', '{"relativePath":"docs/x.md"}'), 'docs/x.md');
  assert.equal(cheminEcritParUnOutil('write_document', '{"relativePath":"docs/x.md","action":"supprimer"}'), null);
  assert.equal(cheminEcritParUnOutil('Write', '{"file_path":"/tmp/x.ts"}'), '/tmp/x.ts');
  assert.equal(cheminEcritParUnOutil('Read', '{"file_path":"/tmp/x.ts"}'), null);
  for (const oui of ['/root/p/.env', '.env.local', '/a/cle.pem', '/a/.ssh/config.txt', 'credentials.json', '/a/beluga.db']) assert.equal(fichierSensible(oui), true, oui);
  for (const non of ['docs/plan.md', '.env.example', '/tmp/rapport.pdf', 'docs/keystone.md']) assert.equal(fichierSensible(non), false, non);
  assert.deepEqual(relatifDUneCopieDeCarte('/root/p/.worktrees/c/docs/a.md'), { relatif: 'docs/a.md', depot: '/root/p' });
  assert.deepEqual(relatifDUneCopieDeCarte('/root/b/data/copies/c/docs/a.md'), { relatif: 'docs/a.md' });
  assert.equal(relatifDUneCopieDeCarte('/root/p/docs/a.md'), null);
});
