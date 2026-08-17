#!/usr/bin/env node
/*
 * LA COLONNE DE GAUCHE PILOTÉE PAR LE CHEF D'ORCHESTRE, REJOUÉE DE BOUT EN BOUT.
 *
 * Le chef ne peut pas écrire dans un projet : ranger, renommer ou mettre de côté
 * passe donc par deux outils du démon. Ce contrôle rejoue le parcours entier sur
 * une base jetable, sans moteur et sans démon :
 *
 *  1. il LISTE la colonne : les projets et leurs groupes, dans leur ordre ;
 *  2. il CRÉE un groupe coloré, y RANGE un projet, puis l'en SORT ;
 *  3. il RENOMME un projet et le REMONTE en tête de colonne ;
 *  4. il MET DE CÔTÉ un projet : ses cartes vivantes sont NOMMÉES, rien n'est perdu ;
 *  5. les deux interdits tiennent : pas de suppression, pas de montage sans adresse ;
 *  6. chaque geste ANNONCE la colonne à l'interface (événements du bus) ;
 *  7. la consigne du chef lui dit que ces outils existent.
 *
 *   node scripts/verif-gestion-projets.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le dépôt d'où PART ce script, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Base et dossiers JETABLES, posés AVANT tout import du serveur. */
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-colonne-base-'));
const PROJETS = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-colonne-projets-'));
process.env.HAIKODEV_DATA = BASE;
process.on('exit', () => {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.rmSync(PROJETS, { recursive: true, force: true });
});

const store = await import(path.join(RACINE, 'server/dist/store.js'));
const outils = await import(path.join(RACINE, 'server/dist/tools.js'));
const runtime = await import(path.join(RACINE, 'server/dist/runtime.js'));
const { bus } = await import(path.join(RACINE, 'server/dist/bus.js'));
const partage = await import(path.join(RACINE, 'shared/dist/index.js'));

const echecs = [];
function verifier(condition, message, detail = '') {
  if (condition) console.log(`  ✓ ${message}${detail ? ` — ${detail}` : ''}`);
  else {
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ''}`);
    echecs.push(message);
  }
}

/* Ce que l'interface reçoit : on écoute le bus comme le ferait un navigateur. */
const vus = [];
bus.subscribe((evenement) => vus.push(evenement));

function projet(nom) {
  const dossier = fs.mkdtempSync(path.join(PROJETS, 'p-'));
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: dossier,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    rank: 1000,
    createdAt: store.now(),
    updatedAt: store.now(),
  });
}

const haiko = projet('Haiko Studio');
const root = projet('Root');
const CHEF = { projectId: haiko.id, role: 'orchestrator', agentId: 'chef-essai' };

/* ------------------------------------------------------------------ */
/* 1. La colonne se lit                                                */
/* ------------------------------------------------------------------ */

console.log('1. La colonne de gauche se lit');
const liste = await outils.callTool(CHEF, 'project_manage', { action: 'lister' });
verifier(liste.ok, 'lister répond');
verifier(liste.text.includes('Haiko Studio') && liste.text.includes('Root'), 'les deux projets sont nommés');

/* ------------------------------------------------------------------ */
/* 2. Un groupe, un projet dedans, puis dehors                         */
/* ------------------------------------------------------------------ */

console.log('2. Un groupe créé, un projet rangé dedans puis sorti');
const cree = await outils.callTool(CHEF, 'group_manage', { action: 'creer', nom: 'Clients', couleur: 'bleu' });
const groupe = store.listGroups().find((g) => g.name === 'Clients');
verifier(cree.ok && !!groupe, 'le groupe « Clients » est créé');
verifier(groupe?.color === '#3b82f6', 'la couleur nommée devient une teinte de la palette', groupe?.color);
verifier(
  partage.COULEURS_DE_GROUPE.includes(groupe?.color),
  'cette teinte est dans la palette du sélecteur de la barre latérale',
);

const range = await outils.callTool(CHEF, 'project_manage', {
  action: 'deplacer',
  projet: 'Haiko',
  groupe: 'Clients',
});
verifier(range.ok, 'le projet est rangé dans le groupe');
verifier(store.getProject(haiko.id).groupId === groupe?.id, 'le rangement est enregistré');
verifier(store.getProject(root.id).groupId === undefined, "le voisin n'a pas bougé");

const sortie = await outils.callTool(CHEF, 'project_manage', { action: 'deplacer', projet: 'Haiko', groupe: 'aucun' });
verifier(sortie.ok && store.getProject(haiko.id).groupId === undefined, '« aucun » sort le projet du groupe');

const regle = await outils.callTool(CHEF, 'group_manage', { action: 'regler', groupe: 'Clients', replie: true });
verifier(regle.ok && store.listGroups().find((g) => g.id === groupe.id).collapsed === true, 'le groupe se replie');

const renommeGroupe = await outils.callTool(CHEF, 'group_manage', {
  action: 'renommer',
  groupe: 'Clients',
  nom: 'Clients 2026',
});
verifier(
  renommeGroupe.ok && store.listGroups().some((g) => g.name === 'Clients 2026'),
  'le groupe se renomme',
);

/* ------------------------------------------------------------------ */
/* 3. Renommer et remonter un projet                                   */
/* ------------------------------------------------------------------ */

console.log('3. Un projet renommé, puis remonté en tête');
const renomme = await outils.callTool(CHEF, 'project_manage', {
  action: 'renommer',
  projet: 'Haiko',
  nom: 'Haiko Cloud',
});
verifier(renomme.ok && store.getProject(haiko.id).name === 'Haiko Cloud', 'le projet est renommé');

await outils.callTool(CHEF, 'project_manage', { action: 'deplacer', projet: 'Haiko Cloud', position: 1 });
const ordonnes = store.listProjects().sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000));
verifier(ordonnes[0].id === haiko.id, 'le projet passe en tête de colonne', `rang ${ordonnes[0].rank}`);
verifier(new Set(ordonnes.map((p) => p.rank)).size === ordonnes.length, 'aucun rang en double après le rangement');

/* ------------------------------------------------------------------ */
/* 4. Mettre de côté : les cartes vivantes sont nommées                */
/* ------------------------------------------------------------------ */

console.log('4. Un projet mis de côté, ses cartes nommées');
outils.createCard(root.id, { title: 'Refaire l’accueil', origin: 'user' });
const retire = await outils.callTool(CHEF, 'project_manage', { action: 'retirer', projet: 'Root' });
verifier(retire.ok && store.getProject(root.id).archived === true, 'le projet quitte la colonne');
verifier(retire.text.includes('Refaire l’accueil'), 'sa carte vivante est nommée avant qu’il disparaisse');
verifier(store.listCards(root.id).length === 1, 'la carte est toujours en base');
verifier(store.listProjects().every((p) => p.id !== root.id), 'la colonne ne le montre plus');
const apres = await outils.callTool(CHEF, 'project_manage', { action: 'lister' });
verifier(apres.text.includes('Mis de côté') && apres.text.includes('Root'), 'il se lit comme « mis de côté »');

const remis = await outils.callTool(CHEF, 'project_manage', { action: 'remettre', projet: 'Root' });
verifier(remis.ok && store.getProject(root.id).archived === false, 'et il revient sur demande');

/* ------------------------------------------------------------------ */
/* 5. Les deux interdits                                               */
/* ------------------------------------------------------------------ */

console.log('5. Les interdits posés dans l’outil');
const suppression = await outils.callTool(CHEF, 'project_manage', { action: 'supprimer', projet: 'Root' });
verifier(!suppression.ok, 'supprimer un projet est refusé');
verifier(suppression.text === partage.REFUS_SUPPRESSION_PROJET, 'le refus dit de le RETIRER à la place');
verifier(!!store.getProject(root.id), 'le projet est toujours là');

const retraitGroupe = await outils.callTool(CHEF, 'group_manage', { action: 'supprimer', groupe: 'Clients 2026' });
verifier(!retraitGroupe.ok, 'retirer un groupe est refusé');
verifier(store.listGroups().length === 1, 'le groupe est toujours là');

const montageMuet = await outils.callTool(CHEF, 'project_manage', { action: 'creer', nom: 'Projet sans adresse' });
verifier(!montageMuet.ok, 'monter un projet sans adresse est refusé');
verifier(
  montageMuet.text.includes('ask_user') && montageMuet.text.includes('port'),
  'le refus dit de demander le sous-domaine et le port',
);
verifier(!fs.existsSync(path.join(PROJETS, 'projet-sans-adresse')), 'aucun dossier n’a été créé au passage');

const inconnu = await outils.callTool(CHEF, 'project_manage', { action: 'renommer', projet: 'Jamais vu', nom: 'X' });
verifier(!inconnu.ok && inconnu.text.includes('Root'), 'un nom inconnu rend la liste des projets connus');

/* ------------------------------------------------------------------ */
/* 6. Chaque geste se voit dans la colonne                             */
/* ------------------------------------------------------------------ */

console.log('6. Chaque geste est annoncé à l’interface');
verifier(vus.some((e) => e.type === 'project.upsert'), 'les projets changés sont réémis');
verifier(vus.some((e) => e.type === 'groups'), 'la liste des groupes est réémise');
/*
 * Le geste est bien DIT au bus (la trace reste) — mais ce message d'« info » ne
 * s'affiche plus : depuis la règle des TROIS motifs, un geste réussi ne notifie
 * pas, la colonne de gauche montrant elle-même son nouvel état
 * (`messageAlerte`, `shared/src/notification-tri.ts`).
 */
verifier(vus.some((e) => e.type === 'toast'), 'le geste laisse sa trace sur le bus');

/* ------------------------------------------------------------------ */
/* 7. Le chef sait que ces outils existent                             */
/* ------------------------------------------------------------------ */

console.log('7. La consigne du chef');
const consigne = runtime.rolePrompt('orchestrator', false, 'claude');
verifier(consigne.includes(runtime.CONSIGNE_GESTION_PROJETS), 'la consigne de la colonne est bien dans son briefing');
verifier(
  runtime.CONSIGNE_GESTION_PROJETS.includes('project_manage') &&
    runtime.CONSIGNE_GESTION_PROJETS.includes('group_manage'),
  'elle nomme les deux outils',
);
const noms = outils.toolsFor('orchestrator').map((t) => t.name);
verifier(noms.includes('project_manage') && noms.includes('group_manage'), 'et les outils lui sont servis');

console.log('');
if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec :`);
  for (const echec of echecs) console.error(`  - ${echec}`);
  process.exit(1);
}
console.log('Tous les contrôles de la colonne de gauche sont passés.');
