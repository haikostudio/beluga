import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA CORRECTION DE SÉCURITÉ QUI VA AU BOUT, LA NOTE ET L'HISTORIQUE CÔTÉ DÉMON (carte « Sécurité : bilan, écran et
 * historique », 25/11/2026), sur une base jetable et un relevé factice — aucun réseau, aucun moteur, aucun site :
 *
 *  - la note de chaque projet se compte sur les points encore présents ; « — » (null) sans audit réussi ;
 *  - « Relancer l'analyse » de la sélection ne lance pas deux fois le même projet ;
 *  - la carte de correction groupée porte ses points ; la consigne « aller au bout » part à ses tours, et à elle seule ;
 *  - un bilan qui oublie des points est renvoyé UNE fois, puis accepté et complété ;
 *  - un geste du site en ligne est ENREGISTRÉ sans être joué, puis marqué appliqué une seule fois ; seule la mise en
 *    production les joue ;
 *  - l'historique de l'agent de sécurité porte ses audits et ses corrections, et l'agent relit ses échanges anciens.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'securite-correction-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project, Message } = shared;
const store = await import('../store.js');
const { getDb } = await import('../db.js');
const securite = await import('../service-securite.js');
const historique = await import('../historique-de-service.js');

const projet = store.saveProject(Project.parse({ id: 'p-corr', name: 'Projet corrigé', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));
const second = store.saveProject(Project.parse({ id: 'p-second', name: 'Second projet', path: bacASable, createdAt: store.now(), updatedAt: store.now() }));

type Constat = import('@beluga/shared').ConstatSecurite;
const constat = (id: string, categorie: Constat['categorie'], gravite: Constat['gravite']): Constat => ({
  id,
  categorie,
  gravite,
  titre: `Point ${id}`,
  risque: 'r',
  proposition: 'p',
  ou: [],
});
const constats: Constat[] = [constat('ia', 'robots', 'elevee'), constat('garde', 'robots', 'elevee'), constat('csp', 'entetes', 'moyenne'), constat('html', 'xss', 'faible')];
let relevesLances = 0;
securite.remplacerLeReleve(async ({ nom }) => {
  relevesLances++;
  return { rapport: { projet: nom, date: 'aujourd’hui', depotPublic: false, constats: [...constats], etapes: [{ nom: 'Lecture', etat: 'fait' }] } };
});

test('la note se compte sur les points présents ; un projet sans audit réussi n’a pas de note', async () => {
  securite.ajouterProjet(projet.id);
  getDb().prepare('INSERT INTO securite_projets (project_id, ajoute_le) VALUES (?, ?)').run(second.id, Date.now());
  const avant = securite.listerProjetsSuivis().find((p) => p.projectId === second.id)!;
  assert.equal(avant.note, null, 'sans audit : « — », jamais 100');
  await securite.attendreLaFile();
  const suivi = securite.listerProjetsSuivis().find((p) => p.projectId === projet.id)!;
  assert.equal(suivi.note, 100 - 12 - 12 - 6 - 2);
  assert.deepEqual(suivi.restants, { critique: 0, elevee: 2, moyenne: 1, faible: 1 });
  const vue = securite.lireVueDAudit(projet.id)!;
  assert.equal(vue.audit.note, 68);
  assert.deepEqual(vue.evolution, [{ lance: vue.audit.lance, note: 68 }]);
  assert.equal(vue.avancement?.total, 4);
});

test('« Relancer l’analyse » de la sélection : un audit par projet, jamais deux fois le même', async () => {
  const r = securite.auditerLaSelection([projet.id, second.id, projet.id, 'p-inconnu']);
  assert.deepEqual(r.lances.sort(), [projet.id, second.id].sort());
  assert.deepEqual(r.ecartes, [{ projectId: 'p-inconnu', raison: 'projet introuvable' }]);
  const encore = securite.auditerLaSelection([projet.id]);
  assert.deepEqual(encore.dejaEnCours, [projet.id], 'déjà en file : il ne repart pas');
  await securite.attendreLaFile();
  assert.equal(securite.listerProjetsSuivis().find((p) => p.projectId === second.id)!.note, 68);
});

let cardId = '';
test('la carte de correction porte ses points, et la consigne « aller au bout » ne part qu’à elle', async () => {
  securite.remplacerLeLanceur(async () => ({ ok: true }));
  const r = await securite.corrigerLaSelection([projet.id]);
  cardId = r.cartes[0]!.cardId;
  const points = securite.pointsDeLaCarte(cardId);
  assert.deepEqual(points.map((p) => p.empreinte).sort(), ['entetes:csp', 'robots:garde', 'robots:ia', 'xss:html']);
  assert.equal(points.find((p) => p.empreinte === 'robots:ia')?.titre, 'Point ia');
  assert.match(securite.consigneDeCorrectionDeLaCarte(cardId), /VA JUSQU'AU BOUT/);
  assert.equal(securite.consigneDeCorrectionDeLaCarte('carte-ordinaire'), '', 'une carte ordinaire ne reçoit rien');
  assert.match(store.getCard(cardId)!.description, /bilan_securite/);
  // La note compte encore les points en correction : ils ne sont pas réglés.
  assert.equal(securite.listerProjetsSuivis().find((p) => p.projectId === projet.id)!.note, 68);
  securite.remplacerLeLanceur(null);
});

test('un bilan qui oublie des points est renvoyé UNE fois, puis accepté et complété', () => {
  const partiel = [{ empreinte: 'robots:ia', titre: 'IA', statut: 'fait', but: 'b', fait: 'f' }];
  const premier = securite.noterLeBilan(cardId, partiel);
  assert.equal(premier.ok, false);
  assert.match((premier as { raison: string }).raison, /oublie 3 point/);
  const second = securite.noterLeBilan(cardId, partiel);
  assert.equal(second.ok, true, 'la seconde fois, le bilan passe : la carte ne reste jamais coincée');
  const lignes = (second as { lignes: { empreinte: string; statut: string; fait: string }[] }).lignes;
  assert.equal(lignes.length, 4);
  assert.equal(lignes.filter((l) => l.statut === 'pas-fait' && l.fait === shared.NON_TRAITE).length, 3);
  assert.match((second as { bloc: string }).bloc, /^```bilan-securite\n/);
  assert.equal(securite.noterLeBilan('carte-ordinaire', partiel).ok, false);
});

test('un geste du site en ligne est enregistré sans être joué, puis appliqué une seule fois', () => {
  const temoin = path.join(bacASable, 'geste-joue');
  assert.equal(securite.enregistrerLeGeste('carte-ordinaire', { libelle: 'x', commande: 'true' }).ok, false, 'réservé aux corrections');
  assert.equal(securite.enregistrerLeGeste(cardId, { libelle: '', commande: 'true' }).ok, false);
  const issue = securite.enregistrerLeGeste(cardId, { libelle: 'Activer le garde des visiteurs', commande: `touch ${temoin}`, delai_s: 30, empreinte: 'robots:garde' });
  assert.equal(issue.ok, true);
  assert.equal(fs.existsSync(temoin), false, 'RIEN n’est exécuté à l’enregistrement (MEM-4501)');
  const aJouer = securite.gestesAAppliquer([cardId, 'autre-carte']);
  assert.equal(aJouer.length, 1);
  assert.deepEqual(securite.gestesAAppliquer(['autre-carte']), [], 'une mise en production partielle ne joue que les cartes choisies');
  assert.equal(securite.marquerLeGesteApplique(aJouer[0]!.id, 'ok'), true);
  assert.equal(securite.marquerLeGesteApplique(aJouer[0]!.id, 'ok'), false, 'jamais deux fois');
  assert.deepEqual(securite.gestesAAppliquer([cardId]), []);
  const bilan = securite.bilanDeLaCarte(cardId);
  assert.equal(bilan.gestes.length, 1);
  assert.ok(bilan.gestes[0]!.appliqueLe);
  assert.equal('commande' in bilan.gestes[0]!, false, 'l’écran ne reçoit jamais la commande');
});

test('seule la mise en production joue les gestes, après son processus, sous la réparation', () => {
  const source = fs.readFileSync(new URL('../../src/deploy.ts', import.meta.url), 'utf8');
  const appels = source.match(/gestesAAppliquer\(/g) ?? [];
  assert.equal(appels.length, 1, 'un seul endroit joue les gestes');
  const fonction = source.slice(source.indexOf('async function mettreEnProduction('), source.indexOf('async function alignerLaSurveillanceApresProduction('));
  assert.ok(fonction.includes('gestesAAppliquer(cartesDuLot)'), 'dans mettreEnProduction');
  assert.ok(fonction.indexOf('processus.etapes.entries()') < fonction.indexOf('gestesAAppliquer('), 'après les étapes du processus');
  assert.ok(fonction.includes('marquerLeGesteApplique('));
});

test('l’historique de l’agent de sécurité : ses audits, ses corrections et ses échanges anciens', () => {
  getDb().prepare('UPDATE securite_projets SET agent_id = ? WHERE project_id = ?').run('agent-histo', projet.id);
  assert.deepEqual(historique.sujetDeLAgent('agent-histo'), { service: 'securite', id: projet.id });
  assert.equal(historique.sujetDeLAgent('agent-inconnu'), null);
  assert.deepEqual(historique.reperesDeLAgent('agent-inconnu'), []);
  const reperes = historique.reperesDeLAgent('agent-histo');
  assert.ok(reperes.some((r) => r.icone === 'audit' && /Premier audit · 4 points à traiter/.test(r.texte)), JSON.stringify(reperes));
  assert.ok(reperes.some((r) => r.icone === 'correction' && r.texte.includes('Sécurité : corriger 4 points')));
  assert.ok(reperes.every((r, i) => i === 0 || reperes[i - 1]!.le <= r.le), 'du plus ancien au plus récent');
  const vieux = Date.now() - 20 * 24 * 3600 * 1000;
  store.saveMessage(Message.parse({ id: 'm-vieux', agentId: 'agent-histo', role: 'user', content: 'Débloque ChatGPT sur ce site', createdAt: vieux }));
  store.saveMessage(Message.parse({ id: 'm-reponse', agentId: 'agent-histo', role: 'assistant', content: 'C’est un garde-fou commun du serveur.', createdAt: vieux + 1000 }));
  const texte = historique.historiquePourLAgent('agent-histo', { chercher: 'chatgpt' });
  assert.match(texte, /Utilisateur : Débloque ChatGPT/);
  assert.doesNotMatch(texte, /Audit/, 'la recherche filtre');
  const tout = historique.historiquePourLAgent('agent-histo', { limite: 2 });
  assert.match(tout, /plus ancien\(s\)/, 'il dit comment remonter');
  securite.remplacerLeReleve(null);
  assert.ok(relevesLances >= 3);
});

test('les repères des autres services : pannes en transitions, sauvegardes, exports, journal d’un agent', () => {
  const db = getDb();
  const maintenant = Date.now();
  db.prepare("INSERT INTO sites_surveilles (id, url, nom, cree_le, agent_id) VALUES ('site-1', 'https://exemple.test', 'Exemple', ?, 'agent-surv')").run(maintenant);
  const controle = db.prepare("INSERT INTO controles_surveillance (site_id, instant, etat, raison) VALUES ('site-1', ?, ?, ?)");
  [['ok', null], ['ok', null], ['panne', 'injoignable'], ['panne', 'injoignable'], ['ok', null]].forEach(([etat, raison], i) => controle.run(maintenant + i * 1000, etat, raison));
  const surv = historique.reperesDeLAgent('agent-surv');
  assert.deepEqual(surv.map((r) => r.icone), ['panne', 'retabli'], 'cinq contrôles, deux repères');
  assert.equal(surv[0]!.alerte, true);

  db.prepare("INSERT INTO backup_sites (id, nom, data, cree_le, modifie_le, recette_agent_id) VALUES ('bk-1', 'Site', '{}', ?, ?, 'agent-bk')").run(maintenant, maintenant);
  db.prepare("INSERT INTO backup_points (id, site_id, debut, statut, data) VALUES ('pt-1', 'bk-1', ?, 'reussi', '{}'), ('pt-2', 'bk-1', ?, 'echec', '{}')").run(maintenant, maintenant + 1);
  assert.deepEqual(historique.reperesDeLAgent('agent-bk').map((r) => r.texte), ['Sauvegarde réussie', 'Sauvegarde échouée']);

  db.prepare("INSERT INTO studio_creations (id, project_id, titre, agent_id, cree_le, maj_le) VALUES ('cr-1', ?, 'Film', 'agent-studio', ?, ?)").run(projet.id, maintenant, maintenant);
  db.prepare("INSERT INTO studio_exports (id, creation_id, project_id, format, etat, version, cree_le, maj_le, termine_le) VALUES ('ex-1', 'cr-1', ?, '9:16', 'pret', 1, ?, ?, ?), ('ex-2', 'cr-1', ?, '16:9', 'en-cours', 1, ?, ?, NULL)").run(projet.id, maintenant, maintenant, maintenant, projet.id, maintenant, maintenant);
  assert.deepEqual(historique.reperesDeLAgent('agent-studio').map((r) => r.texte), ['Export prêt · 9:16'], 'un export en cours ne fait pas de repère');

  db.prepare("INSERT INTO agents_perso (id, project_id, agent_id, fiche, cree_le, mis_a_jour_le) VALUES ('ap-1', ?, 'agent-perso', '{}', ?, ?)").run(projet.id, maintenant, maintenant);
  db.prepare("INSERT INTO agents_perso_journal (id, agent_perso_id, project_id, date, genre, resume, issue) VALUES ('j-1', 'ap-1', ?, ?, 'horaire', 'Point du matin envoyé', 'ok')").run(projet.id, maintenant);
  assert.deepEqual(historique.reperesDeLAgent('agent-perso').map((r) => r.texte), ['Point du matin envoyé']);
  assert.equal(historique.estAgentDeService('agent-perso'), true);
});
