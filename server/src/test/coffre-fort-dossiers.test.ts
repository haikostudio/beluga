import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DUREE_ARCHIVE_MS,
  chercherDossier,
  cheminDuDossier,
  cheminTexte,
  construireArbreDeDossiers,
  creeUnCycle,
  descendantsDuDossier,
  filtrerAcces,
  genreDeLAppel,
  jugerAcces,
  jugerDossier,
  regrouperParDossier,
  type AccesCoffre,
  type DossierCoffre,
} from '@beluga/shared';

/**
 * LES DOSSIERS DU COFFRE-FORT — un arbre à niveaux illimités, désigné par chemin.
 *
 * Verrouillé ici : un dossier n'est jamais vu comme une fiche (table à part),
 * une fiche rangée suit le projet du dossier, retirer un dossier archive ses
 * fiches du MÊME instant et les restaure ensemble (sans réveiller une fiche
 * archivée à la main avant), la purge emporte le dossier avec ses fiches, et
 * les règles pures (juger, regrouper, retrouver) tiennent.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-fort-dossiers-'));
process.env.BELUGA_DATA = bacASable;

const coffre = await import('../coffre-fort.js');
const { getDb } = await import('../db.js');
const { callTool } = await import('../tools.js');
const store = await import('../store.js');

function projetNeuf(nom: string) {
  return store.saveProject({
    id: store.newId(),
    name: nom,
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    archived: false,
    createdAt: store.now(),
    updatedAt: store.now(),
  } as any);
}

const projetA = projetNeuf('Projet A');
const projetB = projetNeuf('Projet B');

function fiche(nom: string, extra: Record<string, unknown> = {}, maintenant = Date.now()) {
  const r = coffre.enregistrerAcces({ nom, type: 'jeton', champs: { service: 'X', jeton: `j-${nom}` }, ...extra }, maintenant);
  assert.equal(r.ok, true, (r as any).raison);
  return (r as any).acces as AccesCoffre;
}

function dossier(nom: string, projectId: string | null = null, maintenant = Date.now()) {
  const r = coffre.enregistrerDossier({ nom, projectId }, maintenant);
  assert.equal(r.ok, true, (r as any).raison);
  return (r as any).dossier as DossierCoffre;
}

/* ----------------------------- règles pures ----------------------------- */

test('juger un dossier : un nom obligatoire, borné, et un projet', () => {
  assert.equal(jugerDossier({ nom: '  ' }).ok, false);
  assert.equal(jugerDossier({ nom: 'x'.repeat(200) }).ok, false);
  const bon = jugerDossier({ nom: ' Serveur OVH ', projectId: ' p1 ', champs: { secret: 'non' } });
  assert.deepEqual(bon, { ok: true, nom: 'Serveur OVH', projectId: 'p1', projectIdDit: true });
  assert.equal(jugerDossier({ nom: 'A/B' }).ok, false, 'un « / » sépare les niveaux, il ne se glisse pas dans un nom');
  assert.equal((jugerDossier({ nom: 'A' }) as any).parentId, undefined, 'parent tu = ne rien changer');
  assert.equal((jugerDossier({ nom: 'A', parentId: '' }) as any).parentId, null, 'parent vide = la racine');
  assert.equal((jugerDossier({ nom: 'A', parentId: ' p ' }) as any).parentId, 'p');
});

test('juger une fiche : le dossier tu ne déplace rien, null la sort, une chaîne la range', () => {
  const base = { nom: 'F', type: 'jeton', champs: { jeton: 'a' } };
  const tu = jugerAcces(base);
  assert.equal(tu.ok && 'dossierId' in tu, false);
  const sort = jugerAcces({ ...base, dossierId: null });
  assert.equal(sort.ok && sort.dossierId, null);
  const range = jugerAcces({ ...base, dossierId: ' d1 ' });
  assert.equal(range.ok && range.dossierId, 'd1');
});

test('regrouper : dossiers alphabétiques d’abord, fiches libres à la fin, dossier inconnu = racine', () => {
  const d = (id: string, nom: string): DossierCoffre => ({ id, nom, projectId: null, creeLe: 0, modifieLe: 0 });
  const f = (id: string, dossierId?: string | null): AccesCoffre => ({
    id, nom: id, type: 'autre', projectId: null, champs: {}, note: '', creeLe: 0, modifieLe: 0, origine: 'coffre', dossierId,
  });
  const groupes = regrouperParDossier([f('a', 'z'), f('b'), f('c', 'y'), f('e', 'fantome')], [d('z', 'Zèbre'), d('y', 'Albatros'), d('v', 'Vide')]);
  assert.deepEqual(groupes.map((g) => g.dossier?.nom ?? null), ['Albatros', 'Vide', 'Zèbre', null]);
  assert.deepEqual(groupes[3]!.acces.map((x) => x.id), ['b', 'e']);
  assert.equal(regrouperParDossier([], [d('v', 'Vide')], { sansVides: true }).length, 0);
});

test('retrouver un dossier par identifiant ou par nom, accents et casse ignorés', () => {
  const liste = [{ id: 'd1', nom: 'Serveur Été' }];
  const trouve = (cle: string) => {
    const r = chercherDossier(liste, cle);
    return r.ok ? r.dossier : undefined;
  };
  assert.equal(trouve('d1')?.id, 'd1');
  assert.equal(trouve('serveur ete')?.id, 'd1');
  assert.equal(trouve('autre'), undefined);
});

test('la recherche porte aussi sur le nom du dossier', () => {
  const f: AccesCoffre = { id: 'a', nom: 'Jeton', type: 'jeton', projectId: null, champs: {}, note: '', creeLe: 0, modifieLe: 0, origine: 'coffre', dossierId: 'd1' };
  assert.equal(filtrerAcces([f], 'ovh').length, 0);
  assert.equal(filtrerAcces([f], 'ovh', () => undefined, (id) => (id === 'd1' ? 'Serveur OVH' : undefined)).length, 1);
});

test('chemin, descendants et cycle d’un arbre de dossiers', () => {
  const d = (id: string, nom: string, parentId: string | null = null): DossierCoffre => ({ id, nom, parentId, projectId: null, creeLe: 0, modifieLe: 0 });
  const liste = [d('a', 'Clients'), d('b', 'Acme', 'a'), d('c', 'Prod', 'b'), d('x', 'Autre')];
  assert.deepEqual(cheminDuDossier(liste, 'c'), ['Clients', 'Acme', 'Prod']);
  assert.equal(cheminTexte(liste, 'c'), 'Clients/Acme/Prod');
  assert.equal(cheminTexte(liste, 'c', ' › '), 'Clients › Acme › Prod');
  assert.deepEqual(cheminDuDossier(liste, 'inconnu'), []);
  assert.deepEqual(descendantsDuDossier(liste, 'a').map((x) => x.id).sort(), ['b', 'c']);
  assert.equal(creeUnCycle(liste, 'a', 'c'), true, 'sous son petit-enfant');
  assert.equal(creeUnCycle(liste, 'a', 'a'), true, 'sous lui-même');
  assert.equal(creeUnCycle(liste, 'c', 'x'), false);
  assert.equal(creeUnCycle(liste, 'a', null), false);
  // Une boucle abîmée en base ne fait pas tourner le calcul.
  const boucle = [d('p', 'P', 'q'), d('q', 'Q', 'p')];
  assert.ok(cheminDuDossier(boucle, 'p').length <= 2);
  assert.ok(descendantsDuDossier(boucle, 'p').length <= 2);
});

test('retrouver un dossier par chemin ; un nom simple ambigu est refusé avec les chemins', () => {
  const d = (id: string, nom: string, parentId: string | null = null): DossierCoffre => ({ id, nom, parentId, projectId: null, creeLe: 0, modifieLe: 0 });
  const liste = [d('a', 'Clients'), d('b', 'Acme', 'a'), d('p1', 'Prod', 'b'), d('v', 'Vitrine'), d('p2', 'Prod', 'v'), d('u', 'Unique', 'v')];
  const chemin = chercherDossier(liste, 'clients/acme/PROD');
  assert.equal(chemin.ok && chemin.dossier.id, 'p1');
  const autre = chercherDossier(liste, 'Vitrine/Prod');
  assert.equal(autre.ok && autre.dossier.id, 'p2');
  const ambigu = chercherDossier(liste, 'prod');
  assert.equal(ambigu.ok, false);
  assert.deepEqual(!ambigu.ok && ambigu.candidats.sort(), ['Clients/Acme/Prod', 'Vitrine/Prod']);
  const simple = chercherDossier(liste, 'unique');
  assert.equal(simple.ok && simple.dossier.id, 'u', 'un nom unique se retrouve sans son chemin');
  assert.equal(chercherDossier(liste, 'Clients/Prod').ok, false, 'un chemin qui saute un niveau n’existe pas');
  assert.equal(chercherDossier(liste, 'p2').ok, true, 'l’id passe avant tout');
});

test('l’arbre range les fiches à tous les niveaux, dossier inconnu = racine', () => {
  const d = (id: string, nom: string, parentId: string | null = null): DossierCoffre => ({ id, nom, parentId, projectId: null, creeLe: 0, modifieLe: 0 });
  const f = (id: string, dossierId?: string | null): AccesCoffre => ({
    id, nom: id, type: 'autre', projectId: null, champs: {}, note: '', creeLe: 0, modifieLe: 0, origine: 'coffre', dossierId,
  });
  const dossiers = [d('b', 'Zèbre', 'a'), d('a', 'Alpha'), d('c', 'Beta'), d('o', 'Orphelin', 'disparu'), d('v', 'Vide', 'a')];
  const arbre = construireArbreDeDossiers([f('1', 'b'), f('2'), f('3', 'a'), f('4', 'fantome'), f('5', 'o')], dossiers);
  assert.deepEqual(arbre.racines.map((n) => n.dossier.nom), ['Alpha', 'Beta', 'Orphelin']);
  const alpha = arbre.racines[0]!;
  assert.deepEqual(alpha.enfants.map((n) => n.dossier.nom), ['Vide', 'Zèbre']);
  assert.equal(alpha.total, 2, 'Alpha en compte une, et une dans Zèbre');
  assert.equal(alpha.enfants[1]!.chemin, 'Alpha › Zèbre');
  assert.deepEqual(arbre.acces.map((x) => x.id), ['2', '4']);
  const sansVides = construireArbreDeDossiers([f('1', 'b')], dossiers, { sansVides: true });
  assert.deepEqual(sansVides.racines.map((n) => n.dossier.nom), ['Alpha']);
  assert.deepEqual(sansVides.racines[0]!.enfants.map((n) => n.dossier.nom), ['Zèbre']);
});

/* ------------------------------- serveur -------------------------------- */

test('un dossier n’est JAMAIS une fiche : il ne paraît pas dans listerAcces', () => {
  const avant = coffre.listerAcces().length;
  const d = dossier('Dossier invisible aux lecteurs');
  assert.equal(coffre.listerAcces().length, avant);
  assert.equal(coffre.listerAcces().some((a) => a.id === d.id), false);
  assert.ok(coffre.listerDossiers().some((x) => x.id === d.id));
  const nbSecrets = (getDb().prepare('SELECT COUNT(*) AS n FROM secrets WHERE id = ?').get(d.id) as { n: number }).n;
  assert.equal(nbSecrets, 0);
});

test('créer, renommer, refuser un doublon', () => {
  const d = dossier('Serveur OVH', projetA.id);
  assert.equal(coffre.enregistrerDossier({ nom: 'serveur ovh' }).ok, false, 'même nom (casse ignorée)');
  assert.equal(coffre.enregistrerDossier({ nom: 'X', projectId: 'inconnu' }).ok, false, 'projet inconnu');
  const r = coffre.enregistrerDossier({ id: d.id, nom: 'Serveur OVH 2', projectId: projetA.id });
  assert.equal(r.ok && r.dossier.nom, 'Serveur OVH 2');
  assert.equal(coffre.enregistrerDossier({ id: 'inconnu', nom: 'Z' }).ok, false);
});

test('une fiche rangée suit le projet du dossier ; changer le projet du dossier déménage ses fiches', () => {
  const d = dossier('Dossier de A', projetA.id);
  const f = fiche('Fiche rangée', { projectId: projetB.id, dossierId: d.id });
  assert.equal(f.projectId, projetA.id);
  assert.equal(f.dossierId, d.id);

  const libre = fiche('Fiche libre', { projectId: projetB.id });
  assert.equal(libre.dossierId, null);
  const rangee = coffre.rangerAcces(libre.id, d.id);
  assert.equal(rangee.ok && rangee.acces.projectId, projetA.id);
  const sortie = coffre.rangerAcces(libre.id, null);
  assert.equal(sortie.ok && sortie.acces.dossierId, null);

  const r = coffre.enregistrerDossier({ id: d.id, nom: 'Dossier de A', projectId: projetB.id });
  assert.equal(r.ok, true);
  assert.equal(coffre.listerAcces().find((a) => a.id === f.id)?.projectId, projetB.id);
});

test('corriger une fiche sans parler du dossier la laisse dans son dossier', () => {
  const d = dossier('Dossier qui garde');
  const f = fiche('Fiche gardée', { dossierId: d.id });
  const r = coffre.enregistrerAcces({ id: f.id, nom: 'Fiche gardée v2', type: 'jeton', champs: { jeton: 'neuf' } });
  assert.equal(r.ok && r.acces.dossierId, d.id);
  const sortie = coffre.enregistrerAcces({ id: f.id, nom: 'Fiche gardée v2', type: 'jeton', champs: { jeton: 'neuf' }, dossierId: null });
  assert.equal(sortie.ok && sortie.acces.dossierId, null);
  assert.equal(coffre.enregistrerAcces({ nom: 'Z', type: 'jeton', dossierId: 'inconnu' }).ok, false);
});

test('retirer un dossier archive ses fiches du même instant ; restaurer les rend ensemble, pas celle retirée avant', () => {
  const maintenant = Date.now();
  const d = dossier('Dossier à retirer');
  const a = fiche('Fiche A du dossier', { dossierId: d.id });
  const b = fiche('Fiche B du dossier', { dossierId: d.id });
  const avant = fiche('Fiche retirée avant', { dossierId: d.id });
  assert.equal(coffre.supprimerAcces(avant.id, maintenant - 5000).ok, true);

  const res = coffre.supprimerDossier(d.id, maintenant);
  assert.deepEqual({ ok: res.ok, fiches: res.fiches }, { ok: true, fiches: 2 });
  assert.equal(coffre.listerDossiers().some((x) => x.id === d.id), false);
  assert.ok(coffre.listerDossiersArchives().some((x) => x.id === d.id));
  const actives = coffre.listerAcces().map((x) => x.id);
  assert.equal(actives.includes(a.id) || actives.includes(b.id), false);
  assert.equal(coffre.supprimerDossier(d.id).ok, false, 'pas deux fois');
  assert.equal(coffre.rangerAcces(avant.id, d.id).ok, false, 'une fiche archivée ne se range pas');

  const back = coffre.restaurerDossier(d.id);
  assert.deepEqual({ ok: back.ok, fiches: back.fiches }, { ok: true, fiches: 2 });
  const apres = coffre.listerAcces().filter((x) => x.dossierId === d.id).map((x) => x.id).sort();
  assert.deepEqual(apres, [a.id, b.id].sort());
  assert.ok(coffre.listerArchives().some((x) => x.id === avant.id), 'la fiche retirée avant reste aux archives');
});

test('restaurer une fiche seule d’un dossier archivé la rend à la racine', () => {
  const d = dossier('Dossier archivé entier');
  const f = fiche('Fiche du dossier archivé', { dossierId: d.id });
  coffre.supprimerDossier(d.id);
  assert.equal(coffre.restaurerAcces(f.id).ok, true);
  assert.equal(coffre.listerAcces().find((x) => x.id === f.id)?.dossierId, null);
});

test('un dossier dont une fiche est lue par une surveillance ne se retire pas', () => {
  const d = dossier('Dossier surveillé');
  const f = fiche('Fiche surveillée', { dossierId: d.id });
  getDb()
    .prepare("INSERT INTO sites_surveilles (id, url, nom, cree_le, recette) VALUES ('s-dossier', 'https://surveille.test', 'Surveillé', 0, ?)")
    .run(JSON.stringify({ acces: { id: f.id, champ: 'jeton' } }));
  const r = coffre.supprimerDossier(d.id);
  assert.equal(r.ok, false);
  assert.match(String(r.raison), /surveillance/);
  assert.ok(coffre.listerDossiers().some((x) => x.id === d.id));
  getDb().prepare("DELETE FROM sites_surveilles WHERE id = 's-dossier'").run();
});

test('la purge emporte le dossier archivé avec ses fiches, jamais un dossier récent', () => {
  const maintenant = Date.now();
  const vieux = dossier('Dossier vieux');
  const recent = dossier('Dossier récent');
  const fv = fiche('Fiche du vieux', { dossierId: vieux.id });
  const fr = fiche('Fiche du récent', { dossierId: recent.id });
  coffre.supprimerDossier(vieux.id, maintenant - DUREE_ARCHIVE_MS - 1000);
  coffre.supprimerDossier(recent.id, maintenant - 1000);

  coffre.purgerArchives(maintenant);
  const lignes = (id: string) => getDb().prepare('SELECT 1 FROM secrets WHERE id = ?').get(id);
  assert.equal(lignes(fv.id), undefined);
  assert.ok(lignes(fr.id));
  assert.equal(getDb().prepare('SELECT 1 FROM dossiers_coffre WHERE id = ?').get(vieux.id), undefined);
  assert.ok(getDb().prepare('SELECT 1 FROM dossiers_coffre WHERE id = ?').get(recent.id));
});

/* --------------------------- dossiers imbriqués -------------------------- */

function sous(nom: string, parent: DossierCoffre, maintenant = Date.now()) {
  const r = coffre.enregistrerDossier({ nom, parentId: parent.id }, maintenant);
  assert.equal(r.ok, true, (r as any).raison);
  return (r as any).dossier as DossierCoffre;
}

test('un sous-dossier prend le projet de son parent, et son chemin se lit sur les fiches', () => {
  const racine = dossier('Imb — Clients', projetA.id);
  const acme = sous('Acme', racine);
  const prod = sous('Prod', acme);
  assert.equal(acme.parentId, racine.id);
  assert.equal(prod.projectId, projetA.id, 'hérité de la racine');
  // Le projet demandé à la création est ignoré : celui du parent l'emporte.
  const force = coffre.enregistrerDossier({ nom: 'Forcé', parentId: acme.id, projectId: projetB.id });
  assert.equal(force.ok && force.dossier.projectId, projetA.id);
  const f = fiche('Imb — jeton prod', { dossierId: prod.id, projectId: projetB.id });
  assert.equal(f.projectId, projetA.id);
  const lue = coffre.listerAcces().find((a) => a.id === f.id);
  assert.equal(lue?.dossierChemin, 'Imb — Clients/Acme/Prod');
  assert.equal(coffre.listerAcces().find((a) => a.dossierId == null)?.dossierChemin ?? null, null);
  assert.equal(coffre.cheminDeDossier(prod.id), 'Imb — Clients/Acme/Prod');
});

test('le nom est unique parmi les frères, pas dans tout le coffre', () => {
  const a = dossier('Imb — Frère A');
  const b = dossier('Imb — Frère B');
  const prodA = sous('Prod', a);
  const prodB = sous('Prod', b);
  assert.notEqual(prodA.id, prodB.id, 'deux « Prod » sous deux parents');
  assert.equal(coffre.enregistrerDossier({ nom: 'prod', parentId: a.id }).ok, false, 'même nom sous le même parent');
  assert.equal(coffre.enregistrerDossier({ nom: 'Imb — frère a' }).ok, false, 'et à la racine');
  const dehors = coffre.enregistrerDossier({ nom: 'Prod' });
  assert.equal(dehors.ok, true, 'un « Prod » à la racine ne gêne pas ceux des parents');
  assert.equal(coffre.enregistrerDossier({ nom: 'X', parentId: 'inconnu' }).ok, false, 'parent inconnu');
});

test('déplacer un dossier : jamais dans lui-même ni sous ses descendants', () => {
  const haut = dossier('Imb — Haut');
  const milieu = sous('Milieu', haut);
  const bas = sous('Bas', milieu);
  assert.equal(coffre.enregistrerDossier({ id: haut.id, nom: 'Imb — Haut', parentId: bas.id }).ok, false);
  assert.equal(coffre.enregistrerDossier({ id: haut.id, nom: 'Imb — Haut', parentId: haut.id }).ok, false);
  const deplace = coffre.enregistrerDossier({ id: bas.id, nom: 'Bas', parentId: haut.id });
  assert.equal(deplace.ok && deplace.dossier.parentId, haut.id);
  const racine = coffre.enregistrerDossier({ id: bas.id, nom: 'Bas', parentId: '' });
  assert.equal(racine.ok && racine.dossier.parentId, null);
  // Ne rien dire du parent = ne pas bouger.
  const reste = coffre.enregistrerDossier({ id: milieu.id, nom: 'Milieu v2' });
  assert.equal(reste.ok && reste.dossier.parentId, haut.id);
});

test('le projet se propage à tout l’arbre, une base de données protégée l’interdit', () => {
  const racine = dossier('Imb — Propage', projetA.id);
  const fils = sous('Fils', racine);
  const petit = sous('Petit-fils', fils);
  const f1 = fiche('Imb — fiche fils', { dossierId: fils.id });
  const f2 = fiche('Imb — fiche petit-fils', { dossierId: petit.id });
  const r = coffre.enregistrerDossier({ id: racine.id, nom: 'Imb — Propage', projectId: projetB.id });
  assert.equal(r.ok, true, (r as any).raison);
  const projetDe = (id: string) => coffre.listerDossiers().find((d) => d.id === id)?.projectId;
  assert.equal(projetDe(fils.id), projetB.id);
  assert.equal(projetDe(petit.id), projetB.id);
  const actifs = coffre.listerAcces();
  assert.equal(actifs.find((a) => a.id === f1.id)?.projectId, projetB.id);
  assert.equal(actifs.find((a) => a.id === f2.id)?.projectId, projetB.id);

  // Déplacer sous un parent d'un autre projet : même propagation.
  const autre = dossier('Imb — Autre projet', projetA.id);
  const deplace = coffre.enregistrerDossier({ id: fils.id, nom: 'Fils', parentId: autre.id });
  assert.equal(deplace.ok, true, (deplace as any).raison);
  assert.equal(projetDe(petit.id), projetA.id);
  assert.equal(coffre.listerAcces().find((a) => a.id === f2.id)?.projectId, projetA.id);

  // Une base de données protégée : le déménagement est refusé, rien ne bouge.
  const base = coffre.enregistrerAcces({ nom: 'Imb — base', type: 'base-de-donnees', champs: { hote: 'h', base: 'b', utilisateur: 'u', mot_de_passe: 'p' }, dossierId: petit.id });
  assert.equal(base.ok, true, (base as any).raison);
  const refus = coffre.enregistrerDossier({ id: autre.id, nom: 'Imb — Autre projet', projectId: projetB.id });
  assert.equal(refus.ok, false);
  assert.match(String((refus as any).raison), /base de données/);
  assert.equal(projetDe(petit.id), projetA.id);
});

test('retirer un dossier emporte sa descendance au même instant ; restaurer rend le lot, pas l’archivé à part', () => {
  const maintenant = Date.now();
  const racine = dossier('Imb — Cascade');
  const fils = sous('Fils', racine);
  const petit = sous('Petit', fils);
  const apart = sous('Archivé avant', racine);
  const f0 = fiche('Imb — racine', { dossierId: racine.id });
  const f1 = fiche('Imb — petit', { dossierId: petit.id });
  const fa = fiche('Imb — avant', { dossierId: apart.id });
  assert.equal(coffre.supprimerDossier(apart.id, maintenant - 9000).ok, true);

  const res = coffre.supprimerDossier(racine.id, maintenant);
  assert.deepEqual({ ok: res.ok, fiches: res.fiches, dossiers: res.dossiers }, { ok: true, fiches: 2, dossiers: 2 });
  const actifs = coffre.listerDossiers().map((d) => d.id);
  assert.equal([racine.id, fils.id, petit.id].some((id) => actifs.includes(id)), false);
  assert.equal(coffre.listerAcces().some((a) => [f0.id, f1.id].includes(a.id)), false);

  const back = coffre.restaurerDossier(racine.id);
  assert.deepEqual({ ok: back.ok, fiches: back.fiches, dossiers: back.dossiers }, { ok: true, fiches: 2, dossiers: 2 });
  const voici = coffre.listerDossiers().map((d) => d.id);
  assert.ok([racine.id, fils.id, petit.id].every((id) => voici.includes(id)));
  assert.equal(voici.includes(apart.id), false, 'le dossier archivé avant reste aux archives');
  assert.ok(coffre.listerArchives().some((a) => a.id === fa.id));
  assert.equal(coffre.listerAcces().find((a) => a.id === f1.id)?.dossierChemin, 'Imb — Cascade/Fils/Petit');
});

test('une surveillance qui lit une fiche d’un sous-dossier bloque le retrait de tout l’arbre', () => {
  const racine = dossier('Imb — Surveillé');
  const fils = sous('Fils', racine);
  const f = fiche('Imb — fiche surveillée', { dossierId: fils.id });
  getDb()
    .prepare("INSERT INTO sites_surveilles (id, url, nom, cree_le, recette) VALUES ('s-imb', 'https://imbrique.test', 'Imbriqué', 0, ?)")
    .run(JSON.stringify({ acces: { id: f.id, champ: 'jeton' } }));
  const r = coffre.supprimerDossier(racine.id);
  assert.equal(r.ok, false);
  assert.match(String(r.raison), /surveillance/);
  assert.ok(coffre.listerDossiers().some((d) => d.id === fils.id), 'rien n’est archivé');
  getDb().prepare("DELETE FROM sites_surveilles WHERE id = 's-imb'").run();
});

test('restaurer un sous-dossier dont le parent reste archivé le remonte à la racine ; un frère du même nom bloque', () => {
  const racine = dossier('Imb — Orphelin');
  const fils = sous('Fils orphelin', racine);
  const f = fiche('Imb — fiche orpheline', { dossierId: fils.id });
  coffre.supprimerDossier(racine.id);
  const r = coffre.restaurerDossier(fils.id);
  assert.equal(r.ok, true, (r as any).raison);
  const rendu = coffre.listerDossiers().find((d) => d.id === fils.id);
  assert.equal(rendu?.parentId, null, 'son parent est archivé : il remonte à la racine');
  assert.equal(coffre.listerAcces().find((a) => a.id === f.id)?.dossierChemin, 'Fils orphelin');

  // Un frère de même nom occupe déjà la place : restaurer est refusé en clair.
  const autre = dossier('Imb — Place prise');
  const e1 = sous('Dossier', autre);
  coffre.supprimerDossier(e1.id);
  sous('Dossier', autre);
  const refus = coffre.restaurerDossier(e1.id);
  assert.equal(refus.ok, false);
  assert.match(String(refus.raison), /existe déjà/);
});

test('la purge emporte l’arbre archivé, enfants avant parents', () => {
  const maintenant = Date.now();
  const vieux = dossier('Imb — Vieil arbre');
  const fils = sous('Fils', vieux);
  const petit = sous('Petit', fils);
  const fp = fiche('Imb — fiche du petit', { dossierId: petit.id });
  coffre.supprimerDossier(vieux.id, maintenant - DUREE_ARCHIVE_MS - 1000);
  coffre.purgerArchives(maintenant);
  const ligne = (table: string, id: string) => getDb().prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  assert.equal(ligne('secrets', fp.id), undefined);
  for (const d of [vieux, fils, petit]) assert.equal(ligne('dossiers_coffre', d.id), undefined);
});

test('assurer un chemin crée les niveaux manquants, une seule fois, sous le projet de la racine', () => {
  const r = coffre.assurerCheminDeDossiers('Imb — Chemin/Niveau 2/Niveau 3', projetA.id);
  assert.equal(r.ok && r.cree, true);
  const encore = coffre.assurerCheminDeDossiers('imb — chemin/niveau 2/niveau 3', projetB.id);
  assert.equal(encore.ok && encore.cree, false);
  assert.equal(encore.ok && encore.dossier.id, r.ok && r.dossier.id);
  assert.equal(r.ok && r.dossier.projectId, projetA.id);
  assert.equal(coffre.cheminDeDossier(r.ok ? r.dossier.id : null), 'Imb — Chemin/Niveau 2/Niveau 3');
});

/* ----------------------------- outil agent ------------------------------ */

const outil = (args: Record<string, unknown>) =>
  callTool({ projectId: projetA.id, role: 'task' } as any, 'coffre_fort', args);

test('agent : enregistrer avec « dossier » le crée et y range, lister le dit, supprimer le dossier archive tout', async () => {
  const r = await outil({ action: 'enregistrer', nom: 'Agent — jeton', type: 'jeton', champs: { service: 'S', jeton: 'abc' }, dossier: 'Dossier des agents' });
  assert.equal(r.ok, true, r.text);
  const d = coffre.listerDossiers().find((x) => x.nom === 'Dossier des agents');
  assert.ok(d, 'le dossier est créé s’il n’existe pas');
  assert.equal(d!.projectId, projetA.id);

  const liste = await outil({ action: 'lister', recherche: 'Dossier des agents' });
  assert.match(liste.text, /dossier : Dossier des agents/);
  const dossiers = await outil({ action: 'dossiers' });
  assert.match(dossiers.text, /Dossier des agents/);

  const retire = await outil({ action: 'dossier_supprimer', dossier: 'Dossier des agents' });
  assert.equal(retire.ok, true, retire.text);
  assert.equal(coffre.listerAcces().some((a) => a.nom === 'Agent — jeton'), false);
  const rend = await outil({ action: 'dossier_restaurer', dossier: 'Dossier des agents' });
  assert.equal(rend.ok, true, rend.text);
  assert.equal(coffre.listerAcces().some((a) => a.nom === 'Agent — jeton'), true);
});

test('agent : renommer un dossier, sortir une fiche (dossier vide), nom inconnu refusé en clair', async () => {
  const f = fiche('Agent — à sortir');
  const ranger = await outil({ action: 'enregistrer', id: f.id, nom: f.nom, type: 'jeton', champs: { jeton: 'x' }, dossier: 'Dossier à renommer' });
  assert.equal(ranger.ok, true, ranger.text);
  const renomme = await outil({ action: 'dossier_enregistrer', dossier: 'Dossier à renommer', nom: 'Dossier renommé' });
  assert.equal(renomme.ok, true, renomme.text);
  assert.ok(coffre.listerDossiers().some((d) => d.nom === 'Dossier renommé'));
  const sort = await outil({ action: 'enregistrer', id: f.id, nom: f.nom, type: 'jeton', champs: { jeton: 'x' }, dossier: '' });
  assert.equal(sort.ok, true, sort.text);
  assert.equal(coffre.listerAcces().find((a) => a.id === f.id)?.dossierId, null);
  const inconnu = await outil({ action: 'dossier_supprimer', dossier: 'Rien de tel' });
  assert.equal(inconnu.ok, false);
  assert.doesNotMatch(inconnu.text, /droit/i);
});

test('agent : un chemin « A/B/C » crée tout, lister dit le chemin, un nom ambigu est refusé avec la liste', async () => {
  const r = await outil({ action: 'enregistrer', nom: 'Agent — imbriqué', type: 'jeton', champs: { service: 'S', jeton: 'abc' }, dossier: 'Agent Clients/Acme/Recette' });
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /Agent Clients\/Acme\/Recette/);
  const liste = await outil({ action: 'lister', recherche: 'Agent — imbriqué' });
  assert.match(liste.text, /dossier : Agent Clients\/Acme\/Recette/);
  const dossiers = await outil({ action: 'dossiers' });
  assert.match(dossiers.text, /Agent Clients\/Acme\/Recette/);
  assert.match(dossiers.text, /1 fiche ici|1 fiche\)/);
  assert.match(dossiers.text, /1 dans tout le sous-arbre/, 'le parent compte celles du sous-arbre');

  // Un second « Recette » sous un autre parent : le nom simple devient ambigu.
  const deux = await outil({ action: 'dossier_enregistrer', nom: 'Agent Vitrine' });
  assert.equal(deux.ok, true, deux.text);
  const prod2 = await outil({ action: 'dossier_enregistrer', nom: 'Recette', parent: 'Agent Vitrine' });
  assert.equal(prod2.ok, true, prod2.text);
  const ambigu = await outil({ action: 'enregistrer', nom: 'Agent — ambigu', type: 'jeton', champs: { jeton: 'x' }, dossier: 'Recette' });
  assert.equal(ambigu.ok, false);
  assert.match(ambigu.text, /Agent Clients\/Acme\/Recette/);
  assert.match(ambigu.text, /Agent Vitrine\/Recette/);
  assert.equal(coffre.listerAcces().some((a) => a.nom === 'Agent — ambigu'), false, 'rien n’est enregistré au hasard');

  // Déplacer un dossier avec « parent », puis le retirer et le rendre avec tout son sous-arbre.
  const deplace = await outil({ action: 'dossier_enregistrer', dossier: 'Agent Clients/Acme', parent: 'Agent Vitrine' });
  assert.equal(deplace.ok, true, deplace.text);
  assert.match(deplace.text, /Agent Vitrine\/Acme/);
  const retire = await outil({ action: 'dossier_supprimer', dossier: 'Agent Vitrine' });
  assert.equal(retire.ok, true, retire.text);
  assert.match(retire.text, /sous-dossier/);
  assert.equal(coffre.listerAcces().some((a) => a.nom === 'Agent — imbriqué'), false);
  const rend = await outil({ action: 'dossier_restaurer', dossier: 'Agent Vitrine' });
  assert.equal(rend.ok, true, rend.text);
  assert.equal(coffre.listerAcces().find((a) => a.nom === 'Agent — imbriqué')?.dossierChemin, 'Agent Vitrine/Acme/Recette');
});

test('assistant : lire les dossiers est direct, ranger/restaurer écrit, retirer un dossier demande l’accord', () => {
  assert.equal(genreDeLAppel('coffre_fort', { action: 'dossiers' }), 'lecture');
  assert.equal(genreDeLAppel('coffre_fort', { action: 'dossier_enregistrer' }), 'ecriture');
  assert.equal(genreDeLAppel('coffre_fort', { action: 'dossier_restaurer' }), 'ecriture');
  assert.equal(genreDeLAppel('coffre_fort', { action: 'dossier_supprimer' }), 'suppression');
});
