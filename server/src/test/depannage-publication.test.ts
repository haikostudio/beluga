import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  DeployRun,
  MAX_REPARATIONS_PAR_ETAPE,
  blocageApresLesEssais,
  blocageSansMoteur,
  decisionDeReparation,
  demandeDeReparation,
  raisonCourteDeLEchec,
  Project,
  agentsDeLaBande,
  demandeDeDepannage,
  depannagesDeLaBande,
  depanneurVivant,
  relanceOfferte,
  effortParDefaut,
  niveauDAccueil,
  publicationADepanner,
  voletDeLAgentDePublication,
} from '@beluga/shared';

/*
 * « RÉSOUDRE LE PROBLÈME » : l'agent qui dépanne une publication tombée, puis
 * la relance lui-même. Règles pures, consigne, et idempotence du bouton.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'depannage-publication-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { rolePrompt } = await import('../runtime.js');
const { depannerLaPublication, demanderLaRelance } = await import('../depannage-publication.js');
const { tourDeReparation, rendreLaReparation } = await import('../reparation-publication.js');

/* ------------------------------------------------------------------ */
/* Règles pures                                                        */
/* ------------------------------------------------------------------ */

test('le bouton ne s’offre que sur la dernière publication, tombée ou arrêtée', () => {
  const tombee = { id: 'a', state: 'failed' };
  assert.equal(publicationADepanner(tombee, { id: 'a' }), true);
  assert.equal(publicationADepanner({ id: 'a', state: 'stopped' }, { id: 'a' }), true);
  assert.equal(publicationADepanner({ id: 'a', state: 'running' }, { id: 'a' }), false);
  assert.equal(publicationADepanner({ id: 'a', state: 'success' }, { id: 'a' }), false);
  // Une publication passée, relue : jamais relancée depuis sa relecture.
  assert.equal(publicationADepanner(tombee, { id: 'b' }), false);
  assert.equal(publicationADepanner(null, { id: 'a' }), false);
});

test('un dépanneur est vivant tant qu’il travaille ou attend une réponse', () => {
  assert.equal(depanneurVivant({ id: 'x', status: 'running' }), true);
  assert.equal(depanneurVivant({ id: 'x', status: 'done', tourVivantDepuis: 1 }), true);
  assert.equal(depanneurVivant({ id: 'x', status: 'done', attendReponse: true }), true);
  assert.equal(depanneurVivant({ id: 'x', status: 'done' }), false);
  assert.equal(depanneurVivant(null), false);
});

test('Tableaux de bord : le dépannage a sa carte, et quitte la bande des agents sans carte', () => {
  const maintenant = 100_000_000;
  const lien = { runId: 'r', cible: 'dev' as const };
  const agents = [
    { id: 'dep', status: 'running', startedAt: 3, depannagePublication: lien },
    { id: 'question', status: 'idle', attendReponse: true, startedAt: 5, depannagePublication: lien },
    { id: 'fini-recent', status: 'done', endedAt: maintenant - 10_000, startedAt: 2, depannagePublication: lien },
    { id: 'fini-ce-matin', status: 'done', endedAt: maintenant - 3_600_000, startedAt: 1, depannagePublication: lien },
    /* Fini depuis plus de 24 heures : il a quitté « Archiver ». */
    { id: 'fini-vieux', status: 'done', endedAt: maintenant - 90_000_000, startedAt: 0, depannagePublication: lien },
    { id: 'autre', status: 'running', startedAt: 4, role: 'deploy' },
  ];
  assert.deepEqual(depannagesDeLaBande(agents).map((a) => a.id), ['question', 'dep']);
  assert.deepEqual(agentsDeLaBande(agents).map((a) => a.id), ['autre']);
});

test('la demande nomme l’étape, le message et la fin du journal', () => {
  const demande = demandeDeDepannage({
    projet: 'Essai',
    dossier: '/tmp/essai',
    cible: 'production',
    etape: 'Mise en ligne',
    erreur: 'rsync a échoué',
    journal: 'ligne 1\nligne 2',
    branche: 'main',
  });
  assert.match(demande, /la mise en production du projet « Essai »/);
  assert.match(demande, /Étape tombée : « Mise en ligne »/);
  assert.match(demande, /rsync a échoué/);
  assert.match(demande, /ligne 2/);
  assert.match(demande, /relancer_publication/);
});

/* ------------------------------------------------------------------ */
/* Consigne et accueil                                                 */
/* ------------------------------------------------------------------ */

test('le dépannage manuel : accueil minimal, sa propre consigne, un effort moyen', () => {
  assert.equal(niveauDAccueil({ role: 'deploy', motif: 'depannage-manuel' }), 'minimal');
  assert.equal(effortParDefaut({ role: 'deploy', motif: 'depannage-manuel' }), 'medium');
  const consigne = rolePrompt('deploy', false, 'claude', 'minimal', 'depannage-manuel');
  assert.match(consigne, /relancer_publication/);
  assert.match(consigne, /NE REDÉMARRE JAMAIS le serveur Beluga Build/);
  assert.doesNotMatch(consigne, /la publication reprend toute seule/);
  // La réparation silencieuse garde la sienne : elle rend son verdict, l'étape se rejoue seule.
  const reparation = rolePrompt('deploy', false, 'claude', 'minimal', 'depannage');
  assert.match(reparation, /rendre_reparation/);
  assert.match(reparation, /REJOUÉE toute seule/);
  assert.doesNotMatch(reparation, /relancer_publication/);
  assert.equal(effortParDefaut({ role: 'deploy', motif: 'depannage' }), 'medium');
});

/* ------------------------------------------------------------------ */
/* Le bouton, côté démon                                               */
/* ------------------------------------------------------------------ */

function publicationTombee(projectId: string): DeployRun {
  return store.saveDeploy(
    DeployRun.parse({
      id: store.newId(),
      projectId,
      state: 'failed',
      cible: 'dev',
      error: 'La construction a échoué.',
      steps: [
        { key: 'merge', state: 'done', log: '' },
        { key: 'build', state: 'failed', log: 'error TS2322: boom' },
      ],
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
    }),
  );
}

test('deux clics simultanés n’ouvrent qu’UN agent, relié à la publication', async () => {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'projet-'));
  const projet = store.saveProject(Project.parse({ id: store.newId(), name: 'Essai', path: dossier, createdAt: 1, updatedAt: 1 }));
  const run = publicationTombee(projet.id);
  const envois: string[] = [];
  const outils = {
    catalogue: async () => [],
    envoyer: async (agentId: string, texte: string) => {
      envois.push(`${agentId}:${texte.slice(0, 20)}`);
    },
  };
  const [a, b] = await Promise.all([depannerLaPublication(run.id, outils as any), depannerLaPublication(run.id, outils as any)]);
  assert.equal(a.agentId, b.agentId);

  const relu = store.getDeploy(run.id)!;
  assert.equal(relu.depannage?.agentId, a.agentId);
  const agent = store.getAgent(a.agentId)!;
  assert.deepEqual(agent.depannagePublication, { runId: run.id, cible: 'dev' });
  const depanneurs = store.listAgents(projet.id).filter((x: Agent) => x.depannagePublication);
  assert.equal(depanneurs.length, 1);

  // Au travail : le bouton le rend tel quel, sans nouvelle demande.
  store.saveAgent({ ...agent, status: 'running' });
  const c = await depannerLaPublication(run.id, outils as any);
  assert.equal(c.agentId, a.agentId);
  assert.equal(c.deja, true);
});

test('une publication réussie ou remplacée ne se dépanne pas', async () => {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'projet-'));
  const projet = store.saveProject(Project.parse({ id: store.newId(), name: 'Essai 2', path: dossier, createdAt: 1, updatedAt: 1 }));
  const ancienne = publicationTombee(projet.id);
  // Une publication plus récente est partie depuis.
  store.saveDeploy(DeployRun.parse({ id: store.newId(), projectId: projet.id, state: 'running', startedAt: Date.now() + 5000 }));
  await assert.rejects(depannerLaPublication(ancienne.id, { catalogue: async () => [], envoyer: async () => {} } as any));
});

test('seul le dépanneur de la publication peut la relancer', () => {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'projet-'));
  const projet = store.saveProject(Project.parse({ id: store.newId(), name: 'Essai 3', path: dossier, createdAt: 1, updatedAt: 1 }));
  const quelconque = store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: projet.id,
      role: 'task',
      title: 'Un agent',
      run: { engine: 'claude', thinking: 'none' },
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const refus = demanderLaRelance(quelconque.id);
  assert.equal(refus.ok, false);
  assert.match(refus.texte, /réservé/);
});

test('chaque agent de publication ouvre le volet de SON étape', () => {
  // Le dépanneur suit sa cible, même quand la dernière publication est l'autre étape.
  assert.equal(
    voletDeLAgentDePublication({
      agent: { id: 'd', depannagePublication: { cible: 'dev' } },
      derniere: { agentId: 'c', cible: 'production' },
    }),
    'dev',
  );
  assert.equal(voletDeLAgentDePublication({ agent: { id: 'd', depannagePublication: { cible: 'production' } } }), 'production');
  // L'agent de configuration garde son onglet « Conversation ».
  assert.equal(voletDeLAgentDePublication({ agent: { id: 'cfg' }, configurationId: 'cfg' }), 'configuration');
  // Le conducteur suit la cible de sa publication ; une publication sans cible est un déploiement.
  assert.equal(voletDeLAgentDePublication({ agent: { id: 'c' }, derniere: { agentId: 'c', cible: 'dev' } }), 'dev');
  assert.equal(voletDeLAgentDePublication({ agent: { id: 'c' }, derniere: { agentId: 'c' } }), 'dev');
  assert.equal(voletDeLAgentDePublication({ agent: { id: 'c' }, derniere: { agentId: 'c', cible: 'production' } }), 'production');
  // Inconnu de l'écran : la production, comme avant.
  assert.equal(voletDeLAgentDePublication({ agent: { id: 'x' }, derniere: null }), 'production');
});

/* ------------------------------------------------------------------ */
/* La réparation silencieuse, DANS la publication                      */
/* ------------------------------------------------------------------ */

test('la règle : trois essais par étape, jamais sur un arrêt ni une machine saturée', () => {
  assert.equal(MAX_REPARATIONS_PAR_ETAPE, 3);
  assert.equal(decisionDeReparation({ essais: 0, motif: 'error TS2322: boom', cle: 'build' }), 'reparer');
  assert.equal(decisionDeReparation({ essais: 2, motif: 'boom', cle: 'build' }), 'reparer');
  assert.equal(decisionDeReparation({ essais: 3, motif: 'boom', cle: 'build' }), 'abandon');
  assert.equal(decisionDeReparation({ essais: 0, motif: 'sh: Cannot fork — serveur saturé', cle: 'build' }), 'hors-champ');
  assert.equal(decisionDeReparation({ essais: 0, motif: 'boom', arrete: true }), 'hors-champ');
  // Un texte qui parle de redémarrage n'est pas une coupure : l'étape est bien tombée.
  assert.equal(decisionDeReparation({ essais: 0, motif: 'Redémarrage de x : le service n’est pas reparti', cle: 'restart' }), 'reparer');
});

test('la raison courte d’un échec est sa conclusion, jamais la première ligne du récit', () => {
  const texte = 'dev : travaux en cours enregistrés\ntache/a : écartée\n\nToutes les cartes du lot sont en conflit : rien n’a pu être fusionné.';
  assert.equal(raisonCourteDeLEchec(texte), 'Toutes les cartes du lot sont en conflit : rien n’a pu être fusionné.');
  assert.equal(raisonCourteDeLEchec('La construction a échoué :\nerror TS2322'), 'La construction a échoué :');
});

test('la demande de réparation nomme l’essai, et un heurt de fusion se règle sans quitter la fusion', () => {
  const simple = demandeDeReparation({ projet: 'Essai', dossier: '/tmp/e', cible: 'dev', etape: 'Mise à jour', essai: 1, journal: 'error TS2322' });
  assert.match(simple, /Essai 1 sur 3/);
  assert.match(simple, /rendre_reparation/);
  assert.match(simple, /error TS2322/);
  const derniere = demandeDeReparation({ projet: 'Essai', dossier: '/tmp/e', cible: 'production', etape: 'Mise en ligne', essai: 3, journal: '' });
  assert.match(derniere, /DERNIER/);
  assert.match(derniere, /La mise en production/);
  const heurt = demandeDeReparation({
    projet: 'Essai',
    dossier: '/tmp/e',
    cible: 'dev',
    etape: 'Fusion des branches',
    essai: 1,
    journal: '',
    heurt: { branche: 'tache/a', brancheDAccueil: 'dev', titre: 'Outil', fichiers: ['server/src/db.ts'] },
  });
  assert.match(heurt, /server\/src\/db\.ts/);
  assert.match(heurt, /n’annule pas la fusion/);
  assert.match(heurt, /jamais `git add -A`/);
});

test('l’encadré par défaut dit l’étape, et sans compte libre il le dit', () => {
  assert.match(blocageSansMoteur('Mise à jour').explication, /aucun compte/);
  const apres = blocageApresLesEssais({ etape: 'Mise à jour', essais: 3, raison: 'boom', agentId: 'a' });
  assert.match(apres.explication, /3 essais/);
  assert.match(apres.marcheASuivre ?? '', /conversation de l’agent/);
});

function projetDEssai(nom: string) {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'projet-'));
  return store.saveProject(Project.parse({ id: store.newId(), name: nom, path: dossier, createdAt: 1, updatedAt: 1 }));
}

const CATALOGUE_LIBRE = async () => [{ id: 'claude', installed: true, comptesDisponibles: 1, models: [] }];

function tour(projectId: string, surcharge: Record<string, unknown> = {}) {
  return {
    projectId,
    runId: 'run-essai',
    cible: 'dev' as const,
    etape: 'build',
    titre: 'Réparation du déploiement — Mise à jour',
    demande: 'répare',
    signal: new AbortController().signal,
    ...surcharge,
  };
}

test('un essai réparé : l’agent rend son verdict, et n’a ni vignette ni carte Système', async () => {
  const projet = projetDEssai('Réparation');
  const issue = await tourDeReparation(tour(projet.id), {
    catalogue: CATALOGUE_LIBRE,
    actifs: () => [],
    envoyer: async (agentId: string) => {
      assert.equal(rendreLaReparation(agentId, { issue: 'reparee', explication: 'Une virgule manquait.' }).ok, true);
    },
  } as any);
  assert.equal(issue.issue, 'reparee');
  const agent = store.getAgent(issue.agentId!)!;
  assert.equal(agent.reparationPublication?.etape, 'build');
  assert.equal(agentsDeLaBande([{ ...agent, status: 'running' }]).length, 0);
  assert.equal(voletDeLAgentDePublication({ agent }), 'dev');
});

test('un abandon porte l’explication et la marche à suivre ; sans marche, l’outil refuse', async () => {
  const projet = projetDEssai('Abandon');
  const issue = await tourDeReparation(tour(projet.id), {
    catalogue: CATALOGUE_LIBRE,
    actifs: () => [],
    envoyer: async (agentId: string) => {
      assert.equal(rendreLaReparation(agentId, { issue: 'abandon', explication: 'Le mot de passe a expiré.' }).ok, false);
      rendreLaReparation(agentId, { issue: 'abandon', explication: 'Le mot de passe a expiré.', marche_a_suivre: 'Renouvelez-le.' });
    },
  } as any);
  assert.equal(issue.issue, 'abandon');
  assert.equal(issue.issue === 'abandon' && issue.marcheASuivre, 'Renouvelez-le.');
});

test('sans verdict, l’essai est « tenté » et l’étape se rejouera ; sans compte libre, rien ne part', async () => {
  const projet = projetDEssai('Tentée');
  const tentee = await tourDeReparation(tour(projet.id), { catalogue: CATALOGUE_LIBRE, actifs: () => [], envoyer: async () => {} } as any);
  assert.equal(tentee.issue, 'tentee');
  let envoye = false;
  const sans = await tourDeReparation(tour(projet.id), {
    catalogue: async () => [],
    actifs: () => [],
    envoyer: async () => {
      envoye = true;
    },
  } as any);
  assert.equal(sans.issue, 'sans-moteur');
  assert.equal(envoye, false);
  // Un agent sans lien de réparation ne peut pas rendre de verdict.
  assert.equal(rendreLaReparation('inconnu', { issue: 'reparee', explication: 'x' }).ok, false);
});

test('un agent qui ne rend pas la main est arrêté au plafond ; un arrêt de la publication le coupe', async () => {
  const projet = projetDEssai('Délai');
  const coupes: string[] = [];
  const delai = await tourDeReparation(tour(projet.id), {
    catalogue: CATALOGUE_LIBRE,
    envoyer: async () => {},
    actifs: () => store.listAgents(projet.id).map((a: Agent) => a.id),
    arreter: (id: string) => coupes.push(id),
    plafondMs: 20,
    sondeMs: 5,
  } as any);
  assert.equal(delai.issue, 'delai');
  assert.deepEqual(coupes, [delai.agentId]);

  const controleur = new AbortController();
  const arret = await tourDeReparation(tour(projet.id, { signal: controleur.signal }), {
    catalogue: CATALOGUE_LIBRE,
    envoyer: async () => {
      controleur.abort();
    },
    actifs: () => store.listAgents(projet.id).map((a: Agent) => a.id),
    arreter: (id: string) => coupes.push(id),
    sondeMs: 5,
  } as any);
  assert.equal(arret.issue, 'arret');
  assert.equal(coupes.length, 2);
});

test('« Relancer » se tait tant que le dépanneur travaille ou attend, et revient sinon', () => {
  const tombee = { state: 'failed' };
  assert.equal(relanceOfferte(tombee, { id: 'd', status: 'running' }), false);
  assert.equal(relanceOfferte(tombee, { id: 'd', status: 'idle', tourVivantDepuis: 1 }), false);
  assert.equal(relanceOfferte(tombee, { id: 'd', status: 'idle', attendReponse: true }), false);
  /* fini sans reprise, refusé faute de quota, introuvable : toujours une issue */
  assert.equal(relanceOfferte(tombee, { id: 'd', status: 'done' }), true);
  assert.equal(relanceOfferte(tombee, undefined), true);
  assert.equal(relanceOfferte({ state: 'stopped' }, null), true);
  /* une publication qui tourne ou a réussi ne se relance pas d'ici */
  assert.equal(relanceOfferte({ state: 'running' }, null), false);
  assert.equal(relanceOfferte(null, null), false);
});
