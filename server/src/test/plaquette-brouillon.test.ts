/**
 * LIRE, ÉDITER, ENREGISTRER (carte « Finitions du lecteur de charte », 06/11/2026).
 *
 * Décision de l'utilisateur : « Enregistrer crée une nouvelle version, mais le client ne voit que la version finale ».
 * Les retouches de l'équipe vont donc dans un BROUILLON : ni la version, ni le lien du client, ni le PDF ne bougent
 * avant « Enregistrer ». Chaque version publiée garde son instantané. Essai sur une VRAIE base (la migration 165).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'plaquette-brouillon-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const pl = await import('../plaquettes.js');

const projet = store.saveProject({
  id: store.newId(),
  name: 'Atelier',
  path: bacASable,
  defaultEngine: 'claude',
  isSelf: false,
  archived: false,
  createdAt: store.now(),
  updatedAt: store.now(),
} as any);

const MARQUE = { nom: 'Atelier', couleur: '#2b5cff', texte: '#16181d', fond: '#ffffff' };

function creer() {
  const r = pl.creerPlaquette({
    projectId: projet.id,
    titre: 'Charte',
    blocs: [
      { id: 'c', genre: 'couverture', titre: 'Charte' },
      { id: 'r', genre: 'ressources', titre: 'Fichiers', texte: 'à télécharger' },
      { id: 't', genre: 'texte', titre: 'Avant', texte: 'Texte publié' },
    ],
    marque: MARQUE,
    format: 'a4-portrait',
    adresse: 'vous',
  });
  if (!r.ok) throw new Error(r.raison);
  return r.plaquette;
}

test('une retouche va dans le brouillon : la version publiée, le lien du client et le PDF ne bougent pas', () => {
  const p = creer();
  assert.equal(p.version, 1);
  /* Les fichiers à télécharger passent en dernier dès la création. */
  assert.deepEqual(
    p.blocs.map((b) => b.id),
    ['c', 't', 'r'],
  );
  const blocs = p.blocs.map((b) => (b.id === 't' ? { ...b, texte: 'Texte du brouillon' } : b));
  const r = pl.enregistrerLeBrouillon(p.id, { blocs });
  assert.ok(r.ok);
  const publiee = pl.lirePlaquette(p.id)!;
  assert.equal(publiee.version, 1, 'la version ne monte pas pour un brouillon');
  assert.equal(publiee.blocs.find((b) => b.id === 't')?.texte, 'Texte publié', 'le client voit encore la version publiée');
  const fiche = pl.ficheDeLaPlaquette(p.id)!;
  assert.equal(fiche.brouillon?.blocs.find((b) => b.id === 't')?.texte, 'Texte du brouillon');
  assert.equal(fiche.brouillon?.base, 1);
});

test('« Enregistrer » publie le brouillon en nouvelle version, garde son instantané, et efface le brouillon', () => {
  const p = creer();
  pl.enregistrerLeBrouillon(p.id, { titre: 'Charte v2' });
  const r = pl.publierLeBrouillon(p.id, { blocs: p.blocs.map((b) => (b.id === 't' ? { ...b, texte: 'Dernière frappe' } : b)) });
  assert.ok(r.ok);
  const publiee = pl.lirePlaquette(p.id)!;
  assert.equal(publiee.version, 2);
  assert.equal(publiee.titre, 'Charte v2', 'le brouillon est repris');
  assert.equal(publiee.blocs.find((b) => b.id === 't')?.texte, 'Dernière frappe', 'le dernier changement aussi');
  assert.equal(pl.brouillonDe(p.id), null);
  assert.deepEqual(
    pl.versionsDe(p.id).map((v) => v.version),
    [2, 1],
  );
  /* Rien à publier : la version reste la même. */
  const encore = pl.publierLeBrouillon(p.id);
  assert.ok(encore.ok);
  assert.equal(pl.lirePlaquette(p.id)!.version, 2);
});

test('« Abandonner » efface le brouillon ; une publication de l’agent ne l’écrase pas et se signale par sa base', () => {
  const p = creer();
  pl.enregistrerLeBrouillon(p.id, { titre: 'Brouillon humain' });
  /* L'agent publie pendant ce temps : le brouillon reste, parti d'une version plus ancienne. */
  const agent = pl.modifierPlaquette(p.id, { titre: 'Version de l’agent' });
  assert.ok(agent.ok);
  const b = pl.brouillonDe(p.id)!;
  assert.equal(b.titre, 'Brouillon humain');
  assert.ok(b.base < pl.lirePlaquette(p.id)!.version);
  assert.ok(pl.abandonnerLeBrouillon(p.id));
  assert.equal(pl.brouillonDe(p.id), null);
  assert.equal(pl.lirePlaquette(p.id)!.titre, 'Version de l’agent');
});
