import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE SERVICE SÉCURITÉ CÔTÉ DÉMON (carte « Service Sécurité des projets », 15/11/2026, puis « Test de sécurité
 * hebdomadaire par projet », 16/11/2026), sur une base jetable et un relevé factice — aucun npm audit, aucun réseau,
 * aucun moteur :
 *
 *  - ajouter un projet lance son premier audit, qui n'alerte jamais ;
 *  - un audit hebdomadaire identique ne signale rien ; un point critique NOUVEAU s'affiche dans le tableau, sans réveiller
 *    d'agent ;
 *  - une carte proposée par l'agent emporte ses points, qui passent « en correction » au clic ;
 *  - la mise en ligne de la carte relance l'audit : le point disparu passe « corrigé », celui qui résiste revient ;
 *  - un agent qui n'est pas celui d'un projet suivi ne peut lier aucune carte ;
 *  - la synchronisation suit chaque projet actif, sans archivés ni regroupements, une seule fois ;
 *  - un projet créé entre dans le suivi ;
 *  - une tournée lance un audit par projet dû, jamais pour un projet archivé, et jamais deux fois dans la même semaine ;
 *  - un contrôle impossible reste visible pour son seul projet.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'service-securite-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project } = shared;
const store = await import('../store.js');
const { getDb } = await import('../db.js');
const securite = await import('../service-securite.js');

const projet = store.saveProject(
  Project.parse({ id: 'p-secu', name: 'Projet suivi', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

type Constat = import('@beluga/shared').ConstatSecurite;
function constat(id: string, gravite: Constat['gravite']): Constat {
  return { id, categorie: 'entetes', gravite, titre: `Point ${id}`, risque: 'r', proposition: 'p', ou: [`a.ts:${Math.round(Math.random() * 100)}`] };
}
let constats: Constat[] = [constat('csp', 'moyenne'), constat('cadre', 'faible')];
// Un relevé factice : le projet « Projet en panne » ne peut pas être contrôlé (son contrôle échoue).
securite.remplacerLeReleve(async ({ nom }) => {
  if (nom === 'Projet en panne') throw new Error('npm audit indisponible');
  return {
    rapport: { projet: nom, date: 'aujourd’hui', depotPublic: false, constats: [...constats], etapes: [{ nom: 'Lecture', etat: 'fait' }] },
  };
});

/** Insère un projet dans la base comme le fait l'application (colonnes + données), archivé ou regroupement au besoin. */
function inscrireProjet(id: string, nom: string, options: { archived?: boolean; regroupement?: boolean } = {}): void {
  const archived = options.archived === true;
  const donnees = {
    id,
    name: nom,
    path: bacASable,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived,
    createdAt: store.now(),
    updatedAt: store.now(),
    ...(options.regroupement ? { regroupement: true } : {}),
  };
  getDb()
    .prepare('INSERT OR REPLACE INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, nom, bacASable, archived ? 1 : 0, JSON.stringify(donnees), store.now(), store.now());
}

function etats(): Record<string, string> {
  return Object.fromEntries(
    (getDb().prepare('SELECT empreinte, etat FROM securite_points WHERE project_id = ?').all(projet.id) as { empreinte: string; etat: string }[]).map((l) => [
      l.empreinte,
      l.etat,
    ]),
  );
}

function nombreDAudits(projectId: string, declencheur: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM securite_audits WHERE project_id = ? AND declencheur = ?').get(projectId, declencheur) as { n: number }).n;
}

test('ajouter un projet lance son premier audit, sans alerte', async () => {
  const liste = securite.ajouterProjet(projet.id);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].enCours, true);
  await securite.attendreLaFile();
  const apres = securite.listerProjetsSuivis()[0];
  assert.equal(apres.enCours, false);
  assert.equal(apres.dernierAudit?.declencheur, 'ajout');
  assert.deepEqual(apres.aTraiter, { critique: 0, elevee: 0, moyenne: 1, faible: 1 });
  assert.deepEqual(etats(), { 'entetes:csp': 'a-traiter', 'entetes:cadre': 'a-traiter' });
  assert.throws(() => securite.ajouterProjet(projet.id), /déjà suivi/);
});

test('un audit hebdomadaire identique ne signale rien ; un critique nouveau se lit dans le tableau, sans réveil', async () => {
  securite.lancerAudit(projet.id, 'hebdo');
  await securite.attendreLaFile();
  const vue = securite.lireVueDAudit(projet.id);
  assert.deepEqual(vue?.nouveaux, []);

  constats = [...constats, constat('injection', 'critique')];
  securite.lancerAudit(projet.id, 'hebdo');
  await securite.attendreLaFile();
  assert.deepEqual(securite.lireVueDAudit(projet.id)?.nouveaux, ['entetes:injection']);
  const suivi = securite.listerProjetsSuivis().find((p) => p.projectId === projet.id)!;
  assert.equal(suivi.aTraiter.critique, 1, 'le critique reste visible dans le tableau');
  assert.equal(suivi.agentId, undefined, 'aucun agent n’est né pour ce point');

  // Le même point la semaine suivante : il n'est plus nouveau.
  securite.lancerAudit(projet.id, 'hebdo');
  await securite.attendreLaFile();
  assert.deepEqual(securite.lireVueDAudit(projet.id)?.nouveaux, []);
});

test('la carte de correction emporte ses points, et la mise en ligne prouve la correction', async () => {
  getDb().prepare('UPDATE securite_projets SET agent_id = ? WHERE project_id = ?').run('agent-secu', projet.id);
  // Un autre agent ne lie rien.
  assert.equal(securite.noterPropositionDeCorrection('autre', 'prop-x', ['entetes:csp']).ok, false);
  // Un point inconnu non plus.
  assert.equal(securite.noterPropositionDeCorrection('agent-secu', 'prop-y', ['entetes:inconnu']).ok, false);
  const lien = securite.noterPropositionDeCorrection('agent-secu', 'prop-1', ['entetes:csp', 'entetes:injection']);
  assert.deepEqual(lien, { ok: true, empreintes: ['entetes:csp', 'entetes:injection'] });

  // Refusée : rien ne bouge.
  securite.apresDecisionDeProposition('prop-y', undefined);
  // Acceptée : les deux points passent en correction.
  securite.apresDecisionDeProposition('prop-1', 'carte-1');
  assert.equal(etats()['entetes:csp'], 'en-correction');
  assert.equal(etats()['entetes:injection'], 'en-correction');
  assert.equal(securite.listerProjetsSuivis()[0].enCorrection, 2);

  // Une carte sans point ne relance rien.
  assert.equal(securite.apresMiseEnLigne(['carte-sans-point']), 0);
  // La carte part en ligne : l'injection a disparu, la CSP résiste.
  constats = constats.filter((c) => c.id !== 'injection');
  assert.equal(securite.apresMiseEnLigne(['carte-1']), 1);
  await securite.attendreLaFile();
  assert.equal(etats()['entetes:injection'], 'corrige');
  assert.equal(etats()['entetes:csp'], 'a-traiter');
  const vue = securite.lireVueDAudit(projet.id);
  assert.equal(vue?.audit.declencheur, 'apres-mise-en-ligne');
  assert.equal(vue?.points.find((p) => p.empreinte === 'entetes:injection')?.cardId, 'carte-1');
});

test('la synchronisation suit chaque projet actif, sans archivés ni regroupements, une seule fois', () => {
  inscrireProjet('p-actif-1', 'Actif un');
  inscrireProjet('p-actif-2', 'Actif deux');
  inscrireProjet('p-archive', 'Archivé', { archived: true });
  inscrireProjet('p-regroupement', 'Regroupement', { regroupement: true });
  assert.equal(securite.synchroniserLesProjets(), 2);
  const suivis = new Set(securite.listerProjetsSuivis().map((p) => p.projectId));
  assert.ok(suivis.has('p-actif-1') && suivis.has('p-actif-2'));
  assert.equal(suivis.has('p-archive'), false);
  assert.equal(suivis.has('p-regroupement'), false);
  assert.equal(securite.synchroniserLesProjets(), 0, 'rejouer la synchronisation n’ajoute aucun doublon');
});

test('un projet créé entre dans le suivi ; un archivé ou un regroupement n’y entre pas ; une panne ne fait rien planter', async () => {
  inscrireProjet('p-cree', 'Projet créé');
  securite.suivreLeProjetCree('p-cree');
  assert.equal(securite.estSuivi('p-cree'), true);
  await securite.attendreLaFile();
  assert.equal(securite.listerProjetsSuivis().find((p) => p.projectId === 'p-cree')?.dernierAudit?.declencheur, 'ajout');

  assert.doesNotThrow(() => securite.suivreLeProjetCree('p-cree'), 'déjà suivi : rien à faire, sans erreur');
  inscrireProjet('p-cree-archive', 'Créé archivé', { archived: true });
  securite.suivreLeProjetCree('p-cree-archive');
  assert.equal(securite.estSuivi('p-cree-archive'), false);
  inscrireProjet('p-cree-regroupement', 'Créé regroupement', { regroupement: true });
  securite.suivreLeProjetCree('p-cree-regroupement');
  assert.equal(securite.estSuivi('p-cree-regroupement'), false);
  assert.doesNotThrow(() => securite.suivreLeProjetCree('projet-inexistant'));
  assert.equal(securite.estSuivi('projet-inexistant'), false);
});

test('la tournée lance un audit par projet dû, une fois par semaine, et saute un projet archivé', async () => {
  await securite.attendreLaFile();
  const maintenant = Date.now();
  const suivis = () => securite.listerProjetsSuivis().map((p) => p.projectId);
  const semaine = 7 * 24 * 60 * 60 * 1000;

  // Le premier passage : les projets synchronisés sans audit sont dus, et reçoivent leur premier audit.
  securite.tourneeSecurite(maintenant);
  await securite.attendreLaFile();
  // Tous ont leur audit : rien n'est dû dans l'heure qui suit.
  assert.equal(securite.tourneeSecurite(maintenant + 60_000), 0);

  // Une semaine plus tard, chaque projet suivi est dû, et un seul audit part pour chacun.
  const avant = Object.fromEntries(suivis().map((id) => [id, nombreDAudits(id, 'hebdo')]));
  assert.equal(securite.tourneeSecurite(maintenant + semaine + 60_000), suivis().length);
  await securite.attendreLaFile();
  for (const id of suivis()) assert.equal(nombreDAudits(id, 'hebdo') - avant[id], 1, `un seul audit hebdomadaire pour ${id}`);

  // Un projet archivé reste dans la table, mais la tournée le saute.
  inscrireProjet('p-actif-2', 'Actif deux', { archived: true });
  const deuxSemaines = maintenant + 2 * semaine + 120_000;
  assert.equal(securite.tourneeSecurite(deuxSemaines), suivis().length - 1);
  await securite.attendreLaFile();
  assert.equal(securite.listerProjetsSuivis().some((p) => p.projectId === 'p-actif-2'), true, 'l’archivé reste suivi dans la table');

  // Réactivé : il reprend son cycle, et une seule tournée ne lui envoie qu'un audit (pas de rafale).
  inscrireProjet('p-actif-2', 'Actif deux');
  const avantReactivation = nombreDAudits('p-actif-2', 'hebdo');
  securite.tourneeSecurite(deuxSemaines + 60_000);
  await securite.attendreLaFile();
  assert.equal(nombreDAudits('p-actif-2', 'hebdo') - avantReactivation, 1);
});

test('un contrôle impossible reste visible pour son seul projet', async () => {
  inscrireProjet('p-panne', 'Projet en panne');
  inscrireProjet('p-sain', 'Projet sain');
  // La tournée suit ces deux projets (synchronisation) et leur lance leur premier audit ; les autres ne sont pas dus.
  assert.equal(securite.tourneeSecurite(), 2);
  await securite.attendreLaFile();
  const liste = securite.listerProjetsSuivis();
  const panne = liste.find((p) => p.projectId === 'p-panne');
  const sain = liste.find((p) => p.projectId === 'p-sain');
  assert.equal(panne?.dernierAudit?.erreur, 'npm audit indisponible');
  assert.equal(panne?.dernierAudit?.compte, undefined, 'un contrôle impossible n’a pas de compte');
  assert.equal(panne?.enCours, false);
  assert.equal(sain?.dernierAudit?.erreur, undefined, 'l’échec d’un projet ne touche pas le projet voisin');
  assert.ok(sain?.dernierAudit?.compte, 'le projet sain garde son compte');
});

test('« Corriger la sélection » : une carte par projet, tous les points du plus grave au plus léger, lancée', async () => {
  constats = [...constats, constat('secret', 'critique')];
  securite.lancerAudit(projet.id, 'manuel');
  await securite.attendreLaFile();
  const lances: string[] = [];
  securite.remplacerLeLanceur(async (id) => {
    lances.push(id);
    return { ok: true };
  });
  const r = await securite.corrigerLaSelection([projet.id, 'p-inconnu', projet.id]);
  assert.equal(r.cartes.length, 1);
  assert.deepEqual(r.ecartes, [{ projectId: 'p-inconnu', raison: 'projet introuvable' }]);
  const carte = store.getCard(r.cartes[0].cardId)!;
  assert.equal(carte.column, 'planned');
  // Les trois points à traiter, critique d'abord, puis moyenne, puis faible ; le point corrigé n'y est pas.
  const ordre = ['entetes:secret', 'entetes:csp', 'entetes:cadre'].map((e) => carte.description.indexOf(`Empreinte : ${e}`));
  assert.ok(ordre.every((i) => i >= 0) && ordre[0] < ordre[1] && ordre[1] < ordre[2], JSON.stringify(ordre));
  assert.ok(!carte.description.includes('entetes:injection'));
  assert.match(carte.description, /\*\*Vérification\*\*/);
  assert.equal(r.cartes[0].points, 3);
  // Ses points passent « en correction », liés à la carte : la mise en ligne relancera l'audit.
  assert.equal(etats()['entetes:secret'], 'en-correction');
  assert.equal(etats()['entetes:cadre'], 'en-correction');
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(lances, [carte.id]);
  // Un second clic ne double rien : plus aucun point à traiter.
  const encore = await securite.corrigerLaSelection([projet.id]);
  assert.deepEqual(encore, { cartes: [], ecartes: [{ projectId: projet.id, raison: 'rien à traiter' }] });
  securite.remplacerLeLanceur(null);
});

test('l’historique se liste, et retirer un projet efface son suivi', () => {
  assert.ok(securite.listerAudits(projet.id).length >= 4);
  assert.equal(securite.retirerProjet(projet.id).some((p) => p.projectId === projet.id), false);
  assert.deepEqual(etats(), {});
  securite.remplacerLeReleve(null);
});
