import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GESTES_GROUPE,
  GESTES_PROJET,
  REFUS_CREATION_SANS_ADRESSE,
  REFUS_SUPPRESSION_GROUPE,
  REFUS_SUPPRESSION_PROJET,
  couleurDeGroupe,
  lireGesteGroupe,
  lireGesteProjet,
  rangsApresDeplacement,
  resumeColonneDeGauche,
  retrouverParNom,
} from '@haikodev/shared';

/*
 * Même précaution que les autres contrôles qui écrivent : la base du démon est
 * figée au premier import de `../config.js`. On la détourne AVANT, puis on
 * importe le store et les outils dynamiquement.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'gestion-projets-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { callTool, createCard, toolsFor } = await import('../tools.js');
const { CONSIGNE_GESTION_PROJETS, rolePrompt } = await import('../runtime.js');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-colonne-'));

function projet(nom: string, extra: Record<string, unknown> = {}) {
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: fs.mkdtempSync(path.join(dossier, 'p-')),
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    rank: 1000,
    createdAt: store.now(),
    updatedAt: store.now(),
    ...extra,
  } as any);
}

/* ------------------------------------------------------------------ */
/* Les règles pures : ce qui est recevable, ce qui est refusé          */
/* ------------------------------------------------------------------ */

test('un projet ne se supprime pas : le refus dit quoi faire à la place', () => {
  for (const action of ['supprimer', 'delete', 'effacer']) {
    const lu = lireGesteProjet({ action, projet: 'Haiko' });
    assert.equal(lu.ok, false);
    assert.equal(!lu.ok && lu.raison, REFUS_SUPPRESSION_PROJET);
    assert.ok(!lu.ok && lu.raison.includes('retirer'));
  }
});

test('un groupe ne se retire pas par un agent', () => {
  const lu = lireGesteGroupe({ action: 'supprimer', groupe: 'Clients' });
  assert.equal(!lu.ok && lu.raison, REFUS_SUPPRESSION_GROUPE);
});

test('un projet ne se monte pas sans son adresse, sauf refus déclaré', () => {
  const muet = lireGesteProjet({ action: 'creer', nom: 'Nouveau' });
  assert.equal(!muet.ok && muet.raison, REFUS_CREATION_SANS_ADRESSE);

  const avecAdresse = lireGesteProjet({ action: 'creer', nom: 'Nouveau', sousDomaine: 'nouveau', port: 7100 });
  assert.equal(avecAdresse.ok, true);
  assert.equal(avecAdresse.ok && avecAdresse.demande.geste === 'creer' && avecAdresse.demande.port, 7100);

  const declare = lireGesteProjet({ action: 'creer', nom: 'Nouveau', sansAdresse: true });
  assert.equal(declare.ok, true);
  assert.equal(declare.ok && declare.demande.geste === 'creer' && declare.demande.sansAdresse, true);
});

test('une action inconnue nomme les actions possibles', () => {
  const lu = lireGesteProjet({ action: 'publier', projet: 'Haiko' });
  assert.equal(lu.ok, false);
  for (const geste of GESTES_PROJET) assert.ok(!lu.ok && lu.raison.includes(geste));
  const groupe = lireGesteGroupe({ action: 'publier' });
  for (const geste of GESTES_GROUPE) assert.ok(!groupe.ok && groupe.raison.includes(geste));
});

test('un déplacement sans groupe ni position ne fait rien, et le dit', () => {
  const rien = lireGesteProjet({ action: 'deplacer', projet: 'Haiko' });
  assert.equal(rien.ok, false);

  const sortie = lireGesteProjet({ action: 'deplacer', projet: 'Haiko', groupe: 'aucun' });
  assert.equal(sortie.ok && sortie.demande.geste === 'deplacer' && sortie.demande.horsGroupe, true);

  const vide = lireGesteProjet({ action: 'deplacer', projet: 'Haiko', groupe: '' });
  assert.equal(vide.ok && vide.demande.geste === 'deplacer' && vide.demande.horsGroupe, true);
});

test('une couleur se dit avec un mot, un code court ou un code entier', () => {
  const lue = (brut: string) => {
    const resultat = couleurDeGroupe(brut);
    return resultat.ok ? resultat.demande.couleur ?? 'aucune' : `refusé : ${resultat.raison}`;
  };
  assert.equal(lue('Bleu'), '#3b82f6');
  assert.equal(lue('#38F'), '#3388ff');
  assert.equal(lue('#3b82f6'), '#3b82f6');
  assert.equal(lue('aucune'), 'aucune');
  const refus = couleurDeGroupe('bleu-canard');
  assert.equal(refus.ok, false);
  assert.ok(!refus.ok && refus.raison.includes('bleu'));
});

test('un nom retrouve sa ligne, une ambiguïté rend la main', () => {
  const lignes = [
    { id: 'a', name: 'Haiko Studio' },
    { id: 'b', name: 'Haiko Compta' },
    { id: 'c', name: 'Root' },
  ];
  assert.equal(retrouverParNom('Root', lignes, 'projet').ok, true);
  assert.equal(retrouverParNom('root', lignes, 'projet').ok, true);
  assert.equal(retrouverParNom('a', lignes, 'projet').ok, true);
  assert.equal(retrouverParNom('compta', lignes, 'projet').ok, true);

  const ambigu = retrouverParNom('Haiko', lignes, 'projet');
  assert.equal(ambigu.ok, false);
  assert.ok(!ambigu.ok && ambigu.raison.includes('Haiko Studio'));

  const absent = retrouverParNom('Inconnu', lignes, 'projet');
  assert.ok(!absent.ok && absent.raison.includes('Root'));
});

test('la colonne de gauche s’écrit dans son ordre, groupes et projets mêlés', () => {
  const texte = resumeColonneDeGauche(
    [
      { id: 'p1', name: 'Haiko', groupId: 'g1', rank: 10 },
      { id: 'p2', name: 'Root', rank: 5 },
      { id: 'p3', name: 'Ancien', rank: 40, archived: true },
    ],
    [{ id: 'g1', name: 'Clients', rank: 20, color: '#3b82f6' }],
  );
  const lignes = texte.split('\n');
  assert.ok(lignes[0].includes('Root'));
  assert.ok(lignes[1].includes('Clients') && lignes[1].includes('1 projet'));
  assert.ok(lignes[2].includes('Haiko'));
  assert.ok(texte.includes('Mis de côté') && texte.includes('Ancien'));
});

test('une position renumérote tout le voisinage, sans trou ni égalité', () => {
  const ordre = rangsApresDeplacement(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    'c',
    1,
  );
  assert.deepEqual(ordre, [
    { id: 'c', rank: 10 },
    { id: 'a', rank: 20 },
    { id: 'b', rank: 30 },
  ]);
  // Une position au-delà de la liste range en bas, elle ne casse rien.
  assert.deepEqual(rangsApresDeplacement([{ id: 'a' }, { id: 'b' }], 'a', 99), [
    { id: 'b', rank: 10 },
    { id: 'a', rank: 20 },
  ]);
});

/* ------------------------------------------------------------------ */
/* Les outils, sur une vraie base                                      */
/* ------------------------------------------------------------------ */

test('les deux outils sont servis à tous les rôles, chef compris', () => {
  for (const role of ['task', 'orchestrator', 'analysis', 'deploy'] as const) {
    const noms = toolsFor(role).map((t) => t.name);
    assert.ok(noms.includes('project_manage'), `project_manage manque pour ${role}`);
    assert.ok(noms.includes('group_manage'), `group_manage manque pour ${role}`);
  }
});

test('la consigne du chef annonce la colonne de gauche', () => {
  const consigne = rolePrompt('orchestrator', false, 'claude');
  assert.ok(consigne.includes(CONSIGNE_GESTION_PROJETS));
  assert.ok(CONSIGNE_GESTION_PROJETS.includes('project_manage'));
  assert.ok(CONSIGNE_GESTION_PROJETS.includes('group_manage'));
});

test('le chef crée un groupe, range un projet dedans, puis l’en sort', async () => {
  const haiko = projet('Haiko');
  const root = projet('Root');
  const ctx = { agentId: 'chef', projectId: haiko.id, role: 'orchestrator' as const };

  const cree = await callTool(ctx, 'group_manage', { action: 'creer', nom: 'Clients', couleur: 'bleu' });
  assert.equal(cree.ok, true);
  const groupe = store.listGroups().find((g) => g.name === 'Clients');
  assert.ok(groupe);
  assert.equal(groupe!.color, '#3b82f6');

  const range = await callTool(ctx, 'project_manage', { action: 'deplacer', projet: 'Haiko', groupe: 'Clients' });
  assert.equal(range.ok, true);
  assert.equal(store.getProject(haiko.id)!.groupId, groupe!.id);
  assert.ok(range.text.includes('Clients'));

  const sortie = await callTool(ctx, 'project_manage', { action: 'deplacer', projet: 'Haiko', groupe: 'aucun' });
  assert.equal(sortie.ok, true);
  assert.equal(store.getProject(haiko.id)!.groupId, undefined);

  // Le voisin n'a pas bougé de groupe au passage.
  assert.equal(store.getProject(root.id)!.groupId, undefined);
});

test('renommer, retirer puis remettre un projet passe par les outils', async () => {
  const cible = projet('Ancien nom');
  const ctx = { agentId: 'chef', projectId: cible.id, role: 'orchestrator' as const };

  await callTool(ctx, 'project_manage', { action: 'renommer', projet: 'Ancien nom', nom: 'Nom neuf' });
  assert.equal(store.getProject(cible.id)!.name, 'Nom neuf');

  const carte = createCard(cible.id, { title: 'Une carte vivante', origin: 'user' });
  assert.equal(carte.column, 'planned');

  const retire = await callTool(ctx, 'project_manage', { action: 'retirer', projet: 'Nom neuf' });
  assert.equal(retire.ok, true);
  assert.equal(store.getProject(cible.id)!.archived, true);
  // Rien ne disparaît sans avoir été dit : la carte encore vivante est nommée.
  assert.ok(retire.text.includes('Une carte vivante'));
  assert.ok(retire.text.includes("rien n'est supprimé"));
  // Mis de côté, pas effacé : la carte est toujours là, le projet aussi.
  assert.equal(store.listCards(cible.id).length, 1);

  const remis = await callTool(ctx, 'project_manage', { action: 'remettre', projet: 'Nom neuf' });
  assert.equal(remis.ok, true);
  assert.equal(store.getProject(cible.id)!.archived, false);
});

test('l’outil refuse la suppression d’un projet, et le projet reste', async () => {
  const garde = projet('À garder');
  const ctx = { agentId: 'chef', projectId: garde.id, role: 'orchestrator' as const };
  const refus = await callTool(ctx, 'project_manage', { action: 'supprimer', projet: 'À garder' });
  assert.equal(refus.ok, false);
  assert.equal(refus.text, REFUS_SUPPRESSION_PROJET);
  assert.ok(store.getProject(garde.id));
});

test('lister rend la colonne telle qu’elle est', async () => {
  const vu = projet('Visible');
  const ctx = { agentId: 'chef', projectId: vu.id, role: 'orchestrator' as const };
  const liste = await callTool(ctx, 'project_manage', { action: 'lister' });
  assert.equal(liste.ok, true);
  assert.ok(liste.text.includes('Visible'));
});
