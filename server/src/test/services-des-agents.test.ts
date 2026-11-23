import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* TOUT AGENT SE SERT DE TOUS LES SERVICES, avec les droits de la      */
/* personne qui lui parle (02/11/2026) — sur une base neuve, sans       */
/* aucun moteur : notes, refus en clair, publication proposée puis      */
/* programmée au SEUL clic, réponse au client préparée, miroir d'un     */
/* bouton à prix du Studio dans le fil du demandeur.                    */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'services-des-agents-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, AgentQuestion, Card, Message, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { getDb, setMeta } = await import('../db.js');
const { bus } = await import('../bus.js');
const { outilServices, refusParLesDroits, trancherLeGesteAValider, guideDesServicesDeLAgent } = await import('../services-des-agents.js');
const { noterLInterlocuteur, interlocuteurDeLAgent } = await import('../interlocuteur.js');
const { creerCompte, compteParId } = await import('../comptes.js');

const maintenant = store.now();
for (const id of ['p-un', 'p-deux']) {
  store.saveProject(Project.parse({ id, name: id === 'p-un' ? 'Projet Un' : 'Projet Deux', path: bacASable, createdAt: maintenant, updatedAt: maintenant }));
}
const carte = store.saveCard(Card.parse({ id: 'carte-un', projectId: 'p-un', title: 'Carte un', column: 'running', position: 1, run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }));
const agent = store.saveAgent(
  Agent.parse({ id: 'agent-un', projectId: 'p-un', cardId: carte.id, role: 'task', title: 'Agent un', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }),
);
const ctx = { agentId: agent.id, projectId: 'p-un', role: 'task' as const, cardId: carte.id };

test('sans aucun compte, le propriétaire est le seul interlocuteur possible', async () => {
  const qui = await interlocuteurDeLAgent(agent.id);
  assert.equal(qui?.role, 'admin');
});

test('un agent lit les médias de son projet, et le refus de cadrage est dit en clair', async () => {
  const liste = await outilServices(ctx, { service: 'medias', action: 'lister' });
  assert.ok(liste.ok, liste.text);
  assert.match(liste.text, /Projet Un/);
  // Le service Notes est retiré (11/11/2026) : il n'est plus un service connu.
  assert.equal((await outilServices(ctx, { service: 'notes', action: 'lister' })).ok, false);
  const cadrage = await outilServices({ ...ctx, role: 'cadrage' }, { service: 'medias', action: 'reutiliser' });
  assert.equal(cadrage.ok, false);
  assert.match(cadrage.text, /Lancer/);
});

test('une publication proposée reste « à valider » : seul le clic la programme', async () => {
  const { enregistrerComptes } = await import('../publication-sociale.js');
  enregistrerComptes('p-un', [{ reseau: 'instagram', distantId: 'ig-1', nom: 'Compte essai', jetons: { acces: 'jeton-essai' } as any, renouvelable: false }]);
  const r = await outilServices(ctx, { service: 'reseaux', action: 'proposer', texte: 'Notre nouveauté', canal: 'instagram', date: '2026-12-01', heure: '18:30' });
  assert.ok(r.ok, r.text);
  assert.ok(r.question?.gesteAValider, 'un bouton est posé dans le fil');
  assert.equal(r.question!.options[0]!.label, 'Programmer le 01/12 à 18h30');
  const { lireContenu } = await import('../marketing.js');
  const id = r.question!.gesteAValider!.contenuId!;
  assert.equal(lireContenu(id)?.etape, 'a_valider');
  const admin = creerCompte({ identifiant: 'proprio', role: 'admin', motDePasse: 'mot-de-passe-solide' }, ['p-un', 'p-deux']).compte;
  const non = await trancherLeGesteAValider(r.question!, 'Pas maintenant', admin);
  assert.deepEqual(non, { ok: true, fait: false });
  assert.equal(lireContenu(id)?.etape, 'a_valider');
  const oui = await trancherLeGesteAValider(r.question!, r.question!.options[0]!.label, admin);
  assert.ok(oui.ok && oui.fait, JSON.stringify(oui));
  assert.equal(lireContenu(id)?.etape, 'programme');
  assert.equal(lireContenu(id)?.heurePrevue, '18:30');
});

test('la réponse au client est une proposition, jamais un envoi', async () => {
  const espace = await import('../espace-client.js');
  const admin = compteParId(creerCompte({ identifiant: 'proprio-2', role: 'admin', motDePasse: 'mot-de-passe-solide' }, []).compte.id)!;
  const d = espace.creerDemande({ id: admin.id, nom: admin.nomAffiche, role: 'admin' } as any, { projectId: 'p-un', titre: 'Changer le logo' });
  const avant = espace.messagesDeLaDemande(d.id).length;
  const r = await outilServices(ctx, { service: 'messagerie', action: 'proposer_reponse', id: d.id, texte: 'C’est fait demain.' });
  assert.ok(r.ok, r.text);
  assert.equal(r.question?.gesteAValider?.genre, 'repondre_demande');
  assert.equal(espace.messagesDeLaDemande(d.id).length, avant, 'rien ne part sans clic');
});

test('un accès en lecture seule : lire oui, écrire non, autre projet fermé, outils de l’assistant fermés', async () => {
  const lecteur = creerCompte({ identifiant: 'lecteur-essai', role: 'lecteur', projets: ['p-un'], motDePasse: 'mot-de-passe-solide' }, ['p-un', 'p-deux']).compte;
  noterLInterlocuteur({ agentId: agent.id }, lecteur);
  assert.equal((await interlocuteurDeLAgent(agent.id))?.role, 'lecteur');
  assert.ok((await outilServices(ctx, { service: 'medias', action: 'lister' })).ok);
  const ecrire = await outilServices(ctx, { service: 'medias', action: 'reutiliser' });
  assert.equal(ecrire.ok, false);
  assert.match(ecrire.text, /personne qui te parle/);
  assert.doesNotMatch(ecrire.text, /je n.ai pas les droits/i);
  const ailleurs = await outilServices(ctx, { service: 'medias', action: 'lister', projet: 'Projet Deux' });
  assert.equal(ailleurs.ok, false);
  assert.ok(await refusParLesDroits(ctx, 'assistant_messagerie', { action: 'en_attente' }));
  assert.ok(await refusParLesDroits(ctx, 'coffre_fort', { action: 'lister' }), 'coffre fermé à ce lecteur');
  const surveillances = await outilServices(ctx, { service: 'surveillances', action: 'lister' });
  assert.equal(surveillances.ok, false, 'un service sans projet reste au propriétaire');
  const guide = await guideDesServicesDeLAgent(agent.id, 'p-un');
  assert.match(guide, /lecture seule/);
  assert.doesNotMatch(guide, /Surveillance/);
});

test('un interlocuteur inconnu alors qu’un accès tiers existe : le droit le plus étroit', async () => {
  const autre = store.saveAgent(
    Agent.parse({ id: 'agent-deux', projectId: 'p-un', role: 'task', title: 'Agent de nuit', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }),
  );
  assert.equal(await interlocuteurDeLAgent(autre.id), null);
  const c2 = { agentId: autre.id, projectId: 'p-un', role: 'task' as const };
  assert.ok((await outilServices(c2, { service: 'medias', action: 'lister' })).ok);
  assert.equal((await outilServices(c2, { service: 'medias', action: 'reutiliser' })).ok, false);
  assert.equal(await refusParLesDroits(c2, 'coffre_fort', { action: 'lister' }), null, 'les outils d’avant gardent leur usage');
});

test('un bouton à prix du directeur a son miroir chez le demandeur, et se ferme une fois tranché', async () => {
  const { creerCreation, marquerAgentStudio } = await import('../studio.js');
  const { demarrerLeSuiviStudio } = await import('../suivi-studio.js');
  demarrerLeSuiviStudio();
  const creation = creerCreation({ projectId: 'p-un', titre: 'Vidéo d’essai' });
  assert.ok(creation.ok);
  const id = (creation as any).creation.id as string;
  const carteDuDirecteur = store.saveCard(
    Card.parse({ id: 'carte-studio', projectId: 'p-un', title: 'Studio', labels: ['studio'], column: 'planned', position: 2, run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }),
  );
  const directeur = store.saveAgent(
    Agent.parse({ id: 'directeur', projectId: 'p-un', cardId: carteDuDirecteur.id, role: 'cadrage', title: 'Directeur', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }),
  );
  marquerAgentStudio(id, directeur.id, carteDuDirecteur.id);
  const bloc = store.saveMessage(Message.parse({ id: 'bloc-suivi', agentId: agent.id, role: 'assistant', content: 'Vidéo', createdAt: maintenant }));
  setMeta(`studio.demandeur.${id}`, agent.id);
  setMeta(`studio.suivi.${id}`, bloc.id);
  const question = AgentQuestion.parse({
    id: 'q-voix',
    question: 'Générer la voix finale ?',
    kind: 'text',
    options: [],
    allowFreeText: true,
    depenseDuFil: { genre: 'voix', creationId: id, plafond: 0.4 },
  });
  const origine = store.saveMessage(Message.parse({ id: 'msg-directeur', agentId: directeur.id, role: 'assistant', content: 'Proposition', questions: [question], createdAt: maintenant }));
  bus.emit({ type: 'message.upsert', message: origine });
  await new Promise((r) => setTimeout(r, 200));
  const miroir = store.getMessage(bloc.id)!.questions.find((q) => q.relaiDe?.questionId === 'q-voix');
  assert.ok(miroir, 'le bouton à prix est relayé chez le demandeur');
  assert.equal(miroir!.depenseDuFil?.plafond, 0.4);
  /* Tranché dans le Studio : le miroir se ferme, sans second paiement. */
  const tranche = store.saveMessage({ ...origine, questions: origine.questions.map((q) => ({ ...q, answer: 'Refuser', answeredAt: Date.now() })) });
  bus.emit({ type: 'message.upsert', message: tranche });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(store.getMessage(bloc.id)!.questions.find((q) => q.id === miroir!.id)?.answer, 'Refuser');
  assert.equal(store.getMessage(bloc.id)!.questions.length, 1, 'un seul miroir, jamais doublé');
  getDb();
});

test('une IMAGE demandée au Studio : son bloc le dit, montre la dernière version livrée, et propose le Studio en nouvelle fenêtre', async () => {
  const { creerCreation, marquerAgentStudio } = await import('../studio.js');
  const { demarrerLeSuiviStudio } = await import('../suivi-studio.js');
  demarrerLeSuiviStudio();
  const creation = creerCreation({ projectId: 'p-un', titre: 'Visuel de rentrée' });
  assert.ok(creation.ok);
  const id = (creation as any).creation.id as string;
  const carte = store.saveCard(
    Card.parse({ id: 'carte-studio-image', projectId: 'p-un', title: 'Studio', labels: ['studio'], column: 'planned', position: 3, run: { engine: 'claude' }, createdAt: maintenant, updatedAt: maintenant }),
  );
  marquerAgentStudio(id, 'directeur', carte.id);
  const bloc = store.saveMessage(Message.parse({ id: 'bloc-image', agentId: agent.id, role: 'assistant', content: 'Image', createdAt: maintenant }));
  setMeta(`studio.demandeur.${id}`, agent.id);
  setMeta(`studio.suivi.${id}`, bloc.id);
  setMeta(`studio.genre.${id}`, 'image');
  const livrer = (piece: string, le: number) =>
    getDb()
      .prepare("INSERT INTO medias_livres (id, project_id, card_id, agent_id, attachment_id, genre, groupe, version, sujet, outil, legende, livre_le) VALUES (?, 'p-un', ?, 'directeur', ?, 'image', 'g', 1, 'Visuel', 'Codex', '', ?)")
      .run(`livre-${piece}`, carte.id, piece, le);
  livrer('version-1', maintenant);
  bus.emit({ type: 'studio', creationId: id } as any);
  await new Promise((r) => setTimeout(r, 200));
  let lu = store.getMessage(bloc.id)!;
  assert.match(lu.content, /Image « Visuel de rentrée » — Studio/);
  assert.match(lu.content, /\n\n\[Ouvrir dans le Studio\]\(#studio\/[^)]+\)$/, 'le lien du Studio, seul sur sa dernière ligne (un bouton à l’écran)');
  assert.deepEqual(lu.attachments, ['version-1'], 'la dernière version en aperçu');
  livrer('version-2', maintenant + 1000);
  bus.emit({ type: 'studio', creationId: id } as any);
  await new Promise((r) => setTimeout(r, 200));
  lu = store.getMessage(bloc.id)!;
  assert.deepEqual(lu.attachments, ['version-2'], 'une version neuve remplace l’aperçu, sans s’empiler');
  /* LE BLOC STRUCTURÉ (11/11/2026) : l'écran en fait un lecteur, le texte reste en repli. */
  assert.equal(lu.suiviStudio?.creationId, id);
  assert.equal(lu.suiviStudio?.genre, 'image');
  assert.equal(lu.suiviStudio?.apercu, 'version-2', 'le lecteur montre la dernière version livrée');
  assert.deepEqual(lu.suiviStudio?.exports, []);
});

test('l’agent qui a demandé une création a TOUS les gestes autour du montage ; un autre agent du projet ne la pilote pas', async () => {
  const { creerCreation, creerExport, majExport, lireCreation } = await import('../studio.js');
  const nee = creerCreation({ projectId: 'p-un', titre: 'Film de campagne' });
  assert.ok(nee.ok);
  const id = (nee as any).creation.id as string;
  /* L'agent de campagne, à qui le PROPRIÉTAIRE parle (l'agent des tests plus haut parle à un lecteur). */
  const demandeur = store.saveAgent(Agent.parse({ id: 'agent-campagne', projectId: 'p-un', role: 'task', title: 'Campagne', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }));
  const proprio = compteParId(creerCompte({ identifiant: 'proprio-studio', role: 'admin', motDePasse: 'mot-de-passe-solide' }, ['p-un']).compte.id)!;
  noterLInterlocuteur({ agentId: demandeur.id }, proprio);
  const ctx = { agentId: demandeur.id, projectId: 'p-un', role: 'task' as const };
  setMeta(`studio.demandeur.${id}`, demandeur.id);
  setMeta(`studio.genre.${id}`, 'video');
  const lu = await outilServices(ctx, { service: 'studio', action: 'lire', creationId: id });
  assert.ok(lu.ok, lu.text);
  assert.match(lu.text, /CRÉATION « Film de campagne »/);
  assert.match(lu.text, /EXPORTS : aucun/);
  /* Le suivi ne donne plus de lien à recopier dans une phrase (capture #b1ff). */
  const suivi = await outilServices(ctx, { service: 'studio', action: 'suivre', creationId: id });
  assert.ok(suivi.ok);
  assert.doesNotMatch(suivi.text, /\]\(#studio\//);
  /* Récupérer sans export prêt : la marche à suivre, pas un renvoi au Studio. */
  const rien = await outilServices(ctx, { service: 'studio', action: 'recuperer', creationId: id });
  assert.equal(rien.ok, false);
  assert.match(rien.text, /« exporter »/);
  /* Une retouche vide est refusée avec ce qu'il faut écrire. */
  const vide = await outilServices(ctx, { service: 'studio', action: 'retouche', creationId: id });
  assert.equal(vide.ok, false);
  /* Un export prêt se lit dans « lire », avec sa pièce. */
  const e = creerExport({ creation: lireCreation(id)!, format: '9:16', genre: 'video', voixEnEssai: 0 });
  majExport(e.id, { etat: 'pret', attachmentId: 'piece-film' });
  assert.match((await outilServices(ctx, { service: 'studio', action: 'lire', creationId: id })).text, /pièce piece-film/);
  /* Un autre agent du même projet : « suivre » oui, piloter non. */
  const autre = store.saveAgent(Agent.parse({ id: 'agent-autre', projectId: 'p-un', role: 'task', title: 'Autre', run: { engine: 'claude' }, status: 'idle', createdAt: maintenant, updatedAt: maintenant }));
  noterLInterlocuteur({ agentId: autre.id }, proprio);
  const refus = await outilServices({ ...ctx, agentId: autre.id }, { service: 'studio', action: 'exporter', creationId: id, format: '1:1' });
  assert.equal(refus.ok, false);
  assert.match(refus.text, /ni par toi ni pour ta campagne/);
  /* Une création d'un autre projet n'existe pas pour lui. */
  const ailleurs = await outilServices(ctx, { service: 'studio', action: 'lire', creationId: id, projet: 'Projet Deux' });
  assert.equal(ailleurs.ok, false);
  /* « MONTRER » POSE LE LECTEUR EN BAS DU FIL (12/11/2026, capture #9def) : un bloc neuf, avec son suivi, que le démon
     tient à jour ensuite — plus jamais un « bloc ci-dessus » qui n'existe pas. */
  const avant = store.listMessages(demandeur.id).length;
  const montre = await outilServices(ctx, { service: 'studio', action: 'montrer', creationId: id });
  assert.ok(montre.ok, montre.text);
  assert.match(montre.text, /est posé dans ta conversation/);
  const fil = store.listMessages(demandeur.id);
  assert.equal(fil.length, avant + 1);
  const bloc = fil.at(-1)!;
  assert.equal(bloc.suiviStudio?.creationId, id);
  assert.deepEqual(bloc.suiviStudio?.taches, [], 'la liste de tâches du directeur est relayée (vide ici : aucun directeur)');
  const { getMeta } = await import('../db.js');
  assert.equal(getMeta(`studio.suivi.${id}`), bloc.id, 'le bloc neuf devient celui que le démon met à jour');
});
