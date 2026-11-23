import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lireTitresHumains, titreAffiche, titreHumainPropre, demandeDeTitresHumains, type DemandeLlm } from '@beluga/shared';

/*
 * LE TITRE CLAIR DE LA MÉMOIRE (`shared/src/titres-humains.ts`,
 * `server/src/titres-humains.ts`) : ce qu'on accepte (des mots courants, pas du
 * code), la lecture tolérante de la réponse du modèle, la porte qui le pose sans
 * version ni écrasement, la mise à jour qui le garde ou l'oublie, et la tâche de
 * fond reprenable sur un faux modèle. Le titre technique, lui, ne bouge jamais.
 */

test('un titre clair : des mots courants, nettoyés ; du code ou une longueur hors bornes est refusé', () => {
  assert.equal(titreHumainPropre('  « le coffre se range par projet. »  '), 'Le coffre se range par projet');
  assert.equal(titreHumainPropre('Les notifications arrivent sur iPhone'), 'Les notifications arrivent sur iPhone');
  assert.equal(titreHumainPropre('Mémoire'), '', 'un seul mot ne dit rien');
  assert.equal(titreHumainPropre('Le fichier memoire-classeurs.tsx est trop long'), '');
  assert.equal(titreHumainPropre('La fonction chercherUnites trouve tout'), '');
  assert.equal(titreHumainPropre('La variable BELUGA_URL vise la production'), '');
  assert.equal(titreHumainPropre('Lancer `npm test` avant tout'), '');
  assert.equal(titreHumainPropre(Array(14).fill('mot').join(' ')), '');
});

test('la réponse du modèle se lit entre crochets ; un id inconnu ou un titre refusé est écarté', () => {
  const texte = 'Voici :\n```json\n[{"id":"mem-0001","titre":"Le coffre se range par projet"},{"id":"MEM-0002","titre":"x"},{"id":"MEM-9999","titre":"Un titre en trop ici"}]\n```';
  const lus = lireTitresHumains(texte, new Set(['MEM-0001', 'MEM-0002']));
  assert.deepEqual([...lus], [['MEM-0001', 'Le coffre se range par projet']]);
  assert.equal(lireTitresHumains('pas de JSON', new Set(['MEM-0001'])).size, 0);
  assert.equal(titreAffiche({ titre: 'technique' }), 'technique');
  assert.equal(titreAffiche({ titre: 'technique', titreHumain: 'Clair pour tous' }), 'Clair pour tous');
  const demande = demandeDeTitresHumains([{ id: 'MEM-0001', titre: 't', resume: 'r'.repeat(900) }]);
  assert.equal(demande.length, 2);
  assert.ok(String(demande[1]!.content).length < 500, 'le résumé est coupé');
});

const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'titres-humains-'));
process.env.BELUGA_DATA = DONNEES;
const k = await import('../connaissances.js');
const fond = await import('../titres-humains.js');
const { getDb } = await import('../db.js');

const PROJET = 'p-titres';
getDb()
  .prepare('INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
  .run(PROJET, 'Titres', DONNEES, '{}', Date.now(), Date.now());

const UNITE = {
  type: 'convention',
  importance: 'P2',
  titre: 'Toute zone qui défile passe par ZoneDefilement',
  resume: 'Une liste qui défile utilise le composant commun de défilement, pour garder les mêmes ombres et la même barre.',
  sujets: ['interface'],
};

test('la porte garde le titre clair donné par l’agent, sans toucher au titre technique', () => {
  const r = k.proposerUnite(PROJET, { ...UNITE, titreHumain: 'Les listes défilent toutes de la même façon' }, { auteur: 'tache/t1' });
  assert.ok(r.ok);
  const u = k.lireUnite(r.ok ? r.unite.id : '')!;
  assert.equal(u.titreHumain, 'Les listes défilent toutes de la même façon');
  assert.equal(u.titre, UNITE.titre);
  // Une mise à jour au même titre technique garde le titre clair ; un titre technique réécrit l'oublie.
  k.proposerUnite(PROJET, { action: 'update', id: u.id, type: 'convention', titre: UNITE.titre, resume: `${UNITE.resume} Même sur téléphone.` }, { auteur: 'tache/t2' });
  assert.equal(k.lireUnite(u.id)!.titreHumain, 'Les listes défilent toutes de la même façon');
  k.proposerUnite(PROJET, { action: 'update', id: u.id, type: 'convention', titre: 'Chaque zone défilante passe par le composant commun', resume: UNITE.resume }, { auteur: 'tache/t3' });
  assert.equal(k.lireUnite(u.id)!.titreHumain, undefined);
});

test('poser un titre clair ne crée pas de version et n’écrase jamais un titre posé', () => {
  const r = k.proposerUnite(PROJET, { ...UNITE, titre: 'Les dates passées se comparent au jour', resume: 'Un événement passé ne se situe jamais dans le temps sans avoir comparé sa date à celle du jour.' }, { auteur: 'tache/t4' });
  assert.ok(r.ok);
  const id = r.ok ? r.unite.id : '';
  const version = k.lireUnite(id)!.version;
  assert.equal(k.poserTitreHumain(id, 'La fonction lireDate compare'), false, 'du code est refusé');
  assert.equal(k.poserTitreHumain(id, 'Les dates se comparent au jour'), true);
  assert.equal(k.poserTitreHumain(id, 'Un autre titre clair ici'), false, 'un titre posé reste');
  assert.equal(k.lireUnite(id)!.version, version);
  assert.deepEqual(k.titresHumainsDe([id.toLowerCase(), 'MEM-9999']), { [id]: 'Les dates se comparent au jour' });
});

test('la tâche de fond remplit par lots, reprend où elle en est, et s’arrête sur un refus du fournisseur', async () => {
  for (let i = 0; i < 5; i += 1) {
    k.proposerUnite(
      PROJET,
      { ...UNITE, titre: `Règle numéro ${i} du rangement des cartes`, resume: `La carte numéro ${i} se range dans sa colonne dès que son tour finit, sans attendre.` },
      { auteur: `tache/lot-${i}` },
    );
  }
  let appels = 0;
  const appel = async (demande: DemandeLlm) => {
    appels += 1;
    const elements = JSON.parse(String(demande.messages[1]!.content)) as { id: string }[];
    // Le premier élément de chaque lot reçoit un titre refusé : il est écarté, pas redemandé en boucle.
    const titres = elements.map((e, i) => ({ id: e.id, titre: i === 0 ? 'x' : `Titre clair pour ${e.id.replace('-', ' ')}` }));
    return { ok: true as const, statut: 200, corps: { choices: [{ message: { content: JSON.stringify(titres) } }] } };
  };
  const sansAvant = k.compterSansTitreHumain();
  const un = await fond.remplirLesTitresHumains({ lot: 2, maxLots: 1, appel });
  assert.equal(un.lots, 1);
  assert.equal(un.poses, 1);
  const deux = await fond.remplirLesTitresHumains({ lot: 2, appel });
  assert.equal(deux.restants, Math.ceil(sansAvant / 2), 'un sur deux refusé, le reste posé');
  assert.ok(appels >= 3);

  k.proposerUnite(PROJET, { ...UNITE, titre: 'Une unité neuve après la panne', resume: 'Une unité écrite après la panne attend son titre clair au prochain réveil de la tâche.' }, { auteur: 'tache/neuve' });
  const panne = await fond.remplirLesTitresHumains({ appel: async () => ({ ok: false as const, statut: 503, raison: 'Aucune clé' }) });
  assert.equal(panne.arret, 'Aucune clé');
  assert.equal(panne.poses, 0);
});
