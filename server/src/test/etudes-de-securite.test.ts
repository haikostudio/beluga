import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * LES ÉTUDES DE SÉCURITÉ RÉDIGÉES, RATTACHÉES AU SERVICE SÉCURITÉ (carte « Audits passés et synchro Beluga Pass »,
 * 15/11/2026) :
 *
 *  - une étude en markdown libre devient un rapport classé par gravité, « Ce qui risque » / « Ce qu'on propose »,
 *    avec les étapes de « Ce qui a été vérifié » — sur les VRAIES études figées dans le dépôt ;
 *  - l'empreinte d'un point d'étude ne porte aucun chiffre et reste unique ;
 *  - l'import met le projet en suivi sans aucun audit en file, une seule fois, et rejouer ne double rien ;
 *  - le premier contrôle hebdomadaire après une étude est une base : aucun « Nouveau », aucun réveil, et les points
 *    d'étude restent « à traiter ».
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'etudes-securite-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project, rapportDepuisEtude, identifiantDuTitre, graviteAnnoncee, etatsApresControle, precedentDeComparaison, nouveauxPointsGraves } = shared;
const store = await import('../store.js');
const { getDb } = await import('../db.js');
const securite = await import('../service-securite.js');

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ETUDES = path.resolve(ICI, '..', '..', '..', 'docs', 'securite', 'etudes-2026-11-15');
const lire = (nom: string) => securite.lireFichierDEtude(fs.readFileSync(path.join(ETUDES, nom), 'utf8'))!;

test('les gravités annoncées se reconnaissent sous toutes leurs formes', () => {
  assert.equal(graviteAnnoncee('### Failles critiques'), 'critique');
  assert.equal(graviteAnnoncee('Critique — On peut écouter le direct des autres'), 'critique');
  assert.equal(graviteAnnoncee('**Élevée : un autre site peut parler à Beluga**'), 'elevee');
  assert.equal(graviteAnnoncee('Gravité moyenne — formulaire de contact'), 'moyenne');
  assert.equal(graviteAnnoncee('Risques de gravité faible'), 'faible');
  assert.equal(graviteAnnoncee('Moyenne, sans effet aujourd’hui : coffre-fort'), 'moyenne');
  assert.equal(graviteAnnoncee('Ce qui a été vérifié'), null);
  assert.equal(graviteAnnoncee('Relevés écartés'), null);
});

test('une empreinte d’étude ne porte aucun chiffre', () => {
  assert.equal(identifiantDuTitre('12 composants à faille élevée et 4 à faille moyenne'), 'composants-a-faille-elevee-et-a-faille-moyenne');
  assert.equal(identifiantDuTitre('Le relevé de 24 avis'), identifiantDuTitre('Le relevé de 25 avis'));
});

test('l’étude de Beluga devient un rapport classé, chaque point avec son risque', () => {
  const { corps } = lire('beluga.md');
  const r = rapportDepuisEtude(corps, { projet: 'Beluga', date: '15 novembre 2026' });
  assert.deepEqual(shared.compteParGravite(r.constats), { critique: 0, elevee: 1, moyenne: 4, faible: 6 });
  const canal = r.constats.find((c) => c.gravite === 'elevee')!;
  assert.equal(canal.titre, 'Un autre site peut parler à Beluga avec votre session');
  assert.match(canal.risque, /canal principal/);
  assert.match(canal.proposition, /n'accepter le canal|n’accepter le canal/i);
  assert.ok(r.constats.every((c) => c.categorie === 'etude' && !/\d/.test(c.id)));
  assert.equal(new Set(r.constats.map((c) => c.id)).size, r.constats.length);
  assert.ok(r.etapes.length >= 5, 'les étapes de « Ce qui a été vérifié » sont lues');
});

test('l’étude de HaikoBill : paragraphes numérotés en gras et liste de points faibles', () => {
  const { corps } = lire('haikobill.md');
  const r = rapportDepuisEtude(corps, { projet: 'HaikoBill', date: 'x' });
  assert.deepEqual(shared.compteParGravite(r.constats), { critique: 2, elevee: 2, moyenne: 4, faible: 4 });
  const premier = r.constats[0]!;
  assert.equal(premier.titre, 'Les données comptables se lisent ET se modifient sans connexion');
  assert.match(premier.proposition, /être connecté/);
  assert.ok(r.etapes.some((e) => e.etat === 'non-verifie'), 'le « Non vérifié » est gardé');
});

test('les quatorze études figées donnent chacune un rapport non vide', () => {
  const fichiers = fs.readdirSync(ETUDES).filter((f) => f.endsWith('.md'));
  assert.equal(fichiers.length, 14);
  for (const f of fichiers) {
    const { entete, corps } = lire(f);
    const r = rapportDepuisEtude(corps, { projet: entete.nom, date: 'x' });
    assert.ok(r.constats.length >= 4, `${f} : ${r.constats.length} point(s)`);
    assert.ok(r.constats.every((c) => c.titre && c.risque), `${f} : chaque point a un titre et un risque`);
    assert.ok(r.etapes.length >= 3, `${f} : ${r.etapes.length} étape(s) vérifiée(s)`);
  }
});

test('après une étude, le contrôle suivant est une base : rien de nouveau, rien qui alerte', () => {
  const etude = { declencheur: 'etude' as const, rapport: { constats: [{ id: 'x', categorie: 'etude' as const, gravite: 'critique' as const, titre: 'x', risque: 'r', proposition: '', ou: [] }] } };
  assert.equal(precedentDeComparaison(etude), null);
  assert.equal(precedentDeComparaison({ ...etude, declencheur: 'hebdo' as const })?.declencheur, 'hebdo');
  const courant = { constats: [{ id: 'csp', categorie: 'entetes' as const, gravite: 'critique' as const, titre: 'c', risque: 'r', proposition: 'p', ou: [] }] };
  assert.deepEqual(nouveauxPointsGraves(precedentDeComparaison(etude)?.rapport ?? null, courant), []);
});

test('un point d’étude ne passe « corrigé » que par la mise en ligne de sa carte', () => {
  const rapportAuto = { constats: [] };
  assert.deepEqual(etatsApresControle([{ empreinte: 'etude:a', etat: 'a-traiter' }], rapportAuto), []);
  assert.deepEqual(etatsApresControle([{ empreinte: 'etude:a', etat: 'en-correction', cardId: 'c1' }], rapportAuto), []);
  assert.deepEqual(etatsApresControle([{ empreinte: 'etude:a', etat: 'en-correction', cardId: 'c1' }], rapportAuto, ['c1']), [
    { empreinte: 'etude:a', etat: 'corrige', cardId: 'c1' },
  ]);
  // Un point du contrôle automatique disparu, lui, est corrigé comme avant.
  assert.deepEqual(etatsApresControle([{ empreinte: 'entetes:csp', etat: 'a-traiter' }], rapportAuto), [{ empreinte: 'entetes:csp', etat: 'corrige' }]);
});

test('l’import rattache l’étude sans audit en file, une seule fois, et le premier hebdo ne réveille rien', async () => {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'etudes-'));
  const brut = fs.readFileSync(path.join(ETUDES, 'beluga.md'), 'utf8');
  const { entete } = lire('beluga.md');
  const projet = store.saveProject(Project.parse({ id: entete.projet, name: 'Beluga', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
  fs.writeFileSync(path.join(dossier, 'beluga.md'), brut);
  fs.writeFileSync(path.join(dossier, 'inconnu.md'), brut.replace(entete.projet, 'projet-absent').replace(entete.carte, 'carte-autre'));

  const premier = securite.importerLesEtudes(dossier, entete.fini + 1000);
  assert.deepEqual(premier.importees, ['Beluga']);
  assert.equal(premier.passees.length, 1);
  const suivi = securite.listerProjetsSuivis().find((p) => p.projectId === projet.id)!;
  assert.equal(suivi.enCours, false, 'aucun audit en file');
  assert.equal(suivi.dernierAudit?.declencheur, 'etude');
  assert.deepEqual(suivi.aTraiter, { critique: 0, elevee: 1, moyenne: 4, faible: 6 });
  assert.equal(suivi.prochainPassage, entete.lance + shared.RYTHME_DES_AUDITS_MS, 'le contrôle automatique passe sept jours après l’étude');
  const audit = getDb().prepare("SELECT cartes FROM securite_audits WHERE project_id = ? AND declencheur = 'etude'").get(projet.id) as { cartes: string };
  assert.deepEqual(JSON.parse(audit.cartes), [entete.carte]);

  // Rejouer : zéro doublon. Retirer puis rejouer : le projet ne revient pas.
  assert.deepEqual(securite.importerLesEtudes(dossier).importees, []);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM securite_audits WHERE project_id = ?').get(projet.id) as { n: number }).n, 1);

  // Le premier contrôle hebdomadaire : une base, sans « Nouveau », points d'étude intacts.
  securite.remplacerLeReleve(async ({ nom }) => ({
    rapport: {
      projet: nom,
      date: 'x',
      depotPublic: false,
      constats: [{ id: 'csp', categorie: 'entetes', gravite: 'critique', titre: 'CSP', risque: 'r', proposition: 'p', ou: [] }],
      etapes: [],
    },
  }));
  securite.lancerAudit(projet.id, 'hebdo');
  await securite.attendreLaFile();
  assert.deepEqual(securite.lireVueDAudit(projet.id)?.nouveaux, []);
  const etats = getDb().prepare("SELECT etat, COUNT(*) AS n FROM securite_points WHERE project_id = ? AND empreinte LIKE 'etude:%' GROUP BY etat").all(projet.id);
  assert.deepEqual(etats, [{ etat: 'a-traiter', n: 11 }]);

  securite.retirerProjet(projet.id);
  assert.deepEqual(securite.importerLesEtudes(dossier).importees, []);
  assert.equal(securite.estSuivi(projet.id), false);
  securite.remplacerLeReleve(null);
});
