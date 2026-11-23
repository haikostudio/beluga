import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA CAMPAGNE EN CONVERSATION ET SA CORBEILLE (carte « Suppression de campagne et menu nettoyé », 10/11/2026).
 *
 *  - supprimer une campagne la sort des listes, met ses médias à la corbeille (leur campagne gardée) et annule ses
 *    publications PRÉVUES — jamais une publication partie ;
 *  - la restaurer rend ses médias et ses publications encore à venir ; une date passée reste annulée ;
 *  - une campagne dont l'agent travaille ne se supprime pas ;
 *  - la purge efface après 30 jours, son agent compris ;
 *  - une campagne menée par son agent veut sa STRATÉGIE complète avant la moindre publication ;
 *  - l'agent d'une campagne : un par campagne, à l'adresse de sa campagne, jamais en coulisses (ask_user permis).
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'campagnes-corbeille-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project, Agent, cleDuChefDeCampagne, fusionnerStrategie, lireRoleDuChef, publicationARetablir, rubriquesManquantes, titreProvisoireDeCampagne, RUBRIQUES_DE_STRATEGIE, consigneDuChef } = shared;
const store = await import('../store.js');
const marketing = await import('../marketing.js');
const communication = await import('../communication.js');
const { getDb, setMeta } = await import('../db.js');

const admin = { id: 'admin', role: 'admin', projets: [] } as any;
const JOUR = 24 * 3600_000;
const jourLocal = (instant: number) => {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function projet(nom: string): string {
  const id = store.newId();
  store.saveProject(Project.parse({ id, name: nom, path: path.join(bacASable, id), createdAt: Date.now(), updatedAt: Date.now() }));
  marketing.assurerEspace(id);
  return id;
}

function contenu(projectId: string, campagneId: string, titre: string, etape: string, datePrevue: string | null): string {
  const cree = marketing.creerContenu({ projectId, genre: 'post', canal: 'instagram', titre, texte: 'x', origine: 'agent', ...(datePrevue ? { datePrevue } : {}) } as any) as any;
  getDb().prepare('UPDATE marketing_contenus SET etape = ? WHERE id = ?').run(etape, cree.contenu.id);
  communication.rattacherContenuACampagne(cree.contenu.id, campagneId, admin);
  return cree.contenu.id;
}

const etape = (id: string) => marketing.lireContenu(id)?.etape;

function agentFactice(statut: 'idle' | 'running'): string {
  const agent = store.saveAgent(
    Agent.parse({ id: store.newId(), projectId: store.listProjects()[0]!.id, role: 'task', title: 'Agent de campagne', workdir: bacASable, run: { engine: 'claude' }, status: statut, createdAt: store.now(), updatedAt: store.now() }),
  );
  return agent.id;
}

test('supprimer une campagne : hors des listes, médias à la corbeille, publications prévues annulées, parties intactes ; restaurer rend ce qui est encore à venir', () => {
  const id = projet('Corbeille de campagnes');
  const marque = communication.creerMarque({ nom: 'Corbeille de campagnes', origine: 'projets', projets: [id] }, admin);
  const campagne = communication.ecrireCampagne({ marqueId: marque.id, titre: 'Noël', statut: 'en_cours' }, admin);
  const autre = communication.ecrireCampagne({ marqueId: marque.id, titre: 'Printemps', statut: 'en_cours' }, admin);
  const demain = jourLocal(Date.now() + 2 * JOUR);
  const hier = jourLocal(Date.now() - 2 * JOUR);
  const partie = contenu(id, campagne.id, 'Partie', 'publie', hier);
  const avenir = contenu(id, campagne.id, 'À venir', 'programme', demain);
  const passee = contenu(id, campagne.id, 'Passée', 'pret', hier);
  const ailleurs = contenu(id, autre.id, 'Ailleurs', 'programme', demain);
  getDb().prepare("INSERT INTO studio_medias (id, project_id, genre, provenance, nom, attachment_id, mime, cree_le) VALUES ('mc1', ?, 'image', 'import', 'Visuel', 'attc1', 'image/png', ?)").run(id, Date.now());
  getDb().prepare('INSERT INTO communication_media_contenu (contenu_id, attachment_id, cree_le) VALUES (?, ?, ?)').run(avenir, 'attc1', Date.now());
  const medias = () => communication.lireMedias(marque.id, admin) as any;
  assert.equal(medias().medias.find((m: any) => m.cle === 'piece:mc1')?.campagneId, campagne.id, 'le média est rangé dans la campagne par sa publication');
  const avant = communication.lireCampagnes(marque.id, admin) as any;
  assert.equal(avant.campagnes.find((c: any) => c.id === campagne.id).aAnnuler, 2, 'la confirmation sait combien de publications seront annulées');

  const r = communication.supprimerCampagne(campagne.id, admin);
  assert.deepEqual(r, { medias: 1, publications: 2 });
  const apres = communication.lireCampagnes(marque.id, admin) as any;
  assert.deepEqual(apres.campagnes.map((c: any) => c.id), [autre.id], 'elle sort de la liste');
  assert.equal(apres.corbeille.length, 1);
  assert.equal(apres.corbeille[0].id, campagne.id);
  assert.equal(apres.corbeille[0].effaceLe - apres.corbeille[0].supprimeLe, 30 * JOUR);
  assert.throws(() => communication.lireCampagne(marque.id, campagne.id, admin), /introuvable/);
  assert.equal(etape(partie), 'publie', 'une publication partie ne bouge jamais');
  assert.equal(etape(avenir), 'abandonne');
  assert.equal(etape(passee), 'abandonne');
  assert.equal(etape(ailleurs), 'programme', 'les autres campagnes ne bougent pas');
  assert.equal(medias().medias.some((m: any) => m.cle === 'piece:mc1'), false, 'son média sort de la médiathèque');
  assert.equal(medias().corbeille.some((m: any) => m.cle === 'piece:mc1'), true, '… et passe à la corbeille des médias');
  assert.match(communication.refusTantQueLaFicheManque(campagne.id) ?? '', /corbeille/, 'rien ne se prépare pour une campagne à la corbeille');
  assert.throws(() => communication.ecrireCampagne({ id: campagne.id, titre: 'Autre' }, admin), /corbeille/);
  assert.deepEqual(communication.supprimerCampagne(campagne.id, admin), { medias: 0, publications: 0 }, 'supprimer deux fois ne fait rien de plus');

  const rendu = communication.restaurerCampagne(campagne.id, admin);
  assert.deepEqual(rendu, { medias: 1, publications: 1 });
  const restauree = communication.lireCampagnes(marque.id, admin) as any;
  assert.equal(restauree.campagnes.length, 2);
  assert.equal(restauree.corbeille.length, 0);
  assert.equal(etape(avenir), 'programme', 'une publication à venir retrouve son étape');
  assert.equal(etape(passee), 'abandonne', 'une date passée reste annulée');
  assert.equal(etape(partie), 'publie');
  assert.equal(medias().medias.find((m: any) => m.cle === 'piece:mc1')?.campagneId, campagne.id, 'le média revient dans SA campagne');
});

test('une campagne dont l’agent travaille ne se supprime pas ; la purge efface après 30 jours, son agent compris', () => {
  const id = projet('Purge de campagnes');
  const marque = communication.creerMarque({ nom: 'Purge de campagnes', origine: 'projets', projets: [id] }, admin);
  const campagne = communication.ecrireCampagne({ marqueId: marque.id, titre: 'Été', statut: 'en_cours' }, admin);
  const agentId = agentFactice('running');
  setMeta(cleDuChefDeCampagne(campagne.id), agentId);
  assert.throws(() => communication.supprimerCampagne(campagne.id, admin), /travaille/);
  assert.equal((communication.lireCampagnes(marque.id, admin) as any).campagnes[0].agentAuTravail, true);
  store.saveAgent({ ...store.getAgent(agentId)!, status: 'idle' });
  communication.supprimerCampagne(campagne.id, admin, Date.now() - 29 * JOUR);
  assert.equal(communication.purgerLaCorbeilleDesCampagnes(), 0, 'à 29 jours, elle attend encore');
  assert.equal((communication.lireCampagnes(marque.id, admin) as any).corbeille.length, 1);
  assert.equal(communication.purgerLaCorbeilleDesCampagnes(Date.now() + 2 * JOUR), 1, 'à 31 jours, elle est effacée');
  assert.equal((communication.lireCampagnes(marque.id, admin) as any).corbeille.length, 0);
  assert.equal(store.getAgent(agentId), null, 'son agent part avec elle');
  assert.throws(() => communication.restaurerCampagne(campagne.id, admin), /introuvable/);
});

test('une campagne menée par son agent veut sa stratégie complète avant la moindre publication', () => {
  const id = projet('Stratégie');
  const marque = communication.creerMarque({ nom: 'Stratégie', origine: 'projets', projets: [id] }, admin);
  const huitPoints = {
    typesMedias: ['image'],
    quantiteMedias: 6,
    rythme: '2 par semaine',
    cible: 'Les indépendants',
    reseaux: ['instagram'],
    debut: '2026-12-01',
    fin: '2026-12-20',
    objectifChiffre: 300,
    mesure: 'visites',
    message: 'Une minute suffit',
    ton: 'complice',
    appelAction: 'Essayez',
  };
  const campagne = communication.ecrireCampagne({ marqueId: marque.id, titre: 'Hiver', ...huitPoints }, admin);
  assert.equal(communication.refusTantQueLaFicheManque(campagne.id), null, 'sans agent, les huit points suffisent (comme avant)');
  setMeta(cleDuChefDeCampagne(campagne.id), agentFactice('idle'));
  assert.match(communication.refusTantQueLaFicheManque(campagne.id) ?? '', /stratégie/);
  const partielle = communication.ecrireCampagne({ id: campagne.id, strategie: { idee: 'Faire connaître la nouvelle offre', parcours: 'Découverte, puis essai' } }, admin);
  assert.deepEqual(Object.keys(partielle.strategie).sort(), ['idee', 'parcours']);
  const complete = communication.ecrireCampagne({ id: campagne.id, strategie: { angles: 'A : le temps gagné · B : le prix', concurrence: 'Deux agences locales', preuves: 'Trois témoignages', budget: 'Aucun', indicateurs: '50 visites par semaine' } }, admin);
  assert.deepEqual(rubriquesManquantes(complete.strategie), [], 'chaque écriture complète, sans effacer les rubriques déjà là');
  assert.equal(communication.refusTantQueLaFicheManque(campagne.id), null);
  const contexte = communication.contexteDeLaCampagnePourSonAgent(campagne.id) ?? '';
  assert.match(contexte, /La stratégie est complète/);
  assert.match(contexte, /La fiche a ses huit points/);
  assert.match(contexte, new RegExp(campagne.id));
});

test('les règles de la stratégie et du titre provisoire', () => {
  assert.deepEqual(fusionnerStrategie({ idee: 'a', angles: 'b' }, { angles: '', budget: ' 500 € ', inconnu: 'x' }), { idee: 'a', budget: '500 €' });
  assert.deepEqual(fusionnerStrategie({ idee: 'a' }, null), { idee: 'a' });
  assert.equal(rubriquesManquantes({}).length, RUBRIQUES_DE_STRATEGIE.length);
  assert.equal(publicationARetablir({ etape: 'abandonne', datePrevue: '2026-12-01' }, '2026-11-10'), true);
  assert.equal(publicationARetablir({ etape: 'abandonne', datePrevue: '2026-11-01' }, '2026-11-10'), false, 'une date passée reste annulée');
  assert.equal(publicationARetablir({ etape: 'abandonne', datePrevue: null }, '2026-11-10'), true);
  assert.equal(publicationARetablir({ etape: 'pret', datePrevue: '2026-12-01' }, '2026-11-10'), false, 'une publication touchée depuis ne se réécrit pas');
  assert.equal(titreProvisoireDeCampagne('Je veux une série de vidéos pour Noël. Avec un ton chaleureux.'), 'Je veux une série de vidéos pour Noël');
  assert.ok(titreProvisoireDeCampagne('x'.repeat(200)).length <= 60);
  assert.equal(titreProvisoireDeCampagne('   '), 'Nouvelle campagne');
  assert.deepEqual(lireRoleDuChef(JSON.stringify({ niveau: 'campagne', compteId: 'c', marqueId: 'm', campagneId: 'k' })), { niveau: 'campagne', compteId: 'c', marqueId: 'm', campagneId: 'k' });
  assert.equal(lireRoleDuChef(JSON.stringify({ niveau: 'campagne', compteId: 'c', marqueId: 'm' })), null, 'un agent de campagne sans campagne n’existe pas');
  const consigne = consigneDuChef('campagne');
  assert.match(consigne, /ask_user/);
  assert.match(consigne, /\(recommandé\)/);
  assert.match(consigne, /Idée et stratégie/);
  assert.doesNotMatch(consigne, /un seul bloc de code de langage/, 'pas de blocs du directeur : ce fil ne les affiche pas');
});

test('l’agent d’une campagne : un par campagne, à l’adresse de sa campagne, jamais en coulisses', async () => {
  const id = projet('Agent de campagne');
  const marque = communication.creerMarque({ nom: 'Agent de campagne', origine: 'projets', projets: [id] }, admin);
  const campagne = communication.ecrireCampagne({ marqueId: marque.id, titre: 'Lancement', statut: 'preparation' }, admin);
  const { chefDeCampagne } = await import('../directeur-marketing.js');
  const { roleDuChef } = await import('../directeur-marketing.js');
  const { questionRefuseeEnCoulisses } = await import('../communication-coulisses.js');
  assert.equal(communication.campagneMeneeParSonAgent(campagne.id), false);
  const agent = await chefDeCampagne(admin, marque.id, campagne.id);
  assert.equal(agent.service?.adresse, `communication/${marque.id}/campagnes/${campagne.id}`);
  assert.deepEqual(roleDuChef(agent.id), { niveau: 'campagne', compteId: 'admin', marqueId: marque.id, campagneId: campagne.id });
  assert.equal((await chefDeCampagne(admin, marque.id, campagne.id)).id, agent.id, 'une seule conversation par campagne');
  assert.equal(store.listMessages(agent.id, 5).length, 1, 'une campagne plus ancienne reçoit un mot d’accueil, sans moteur');
  assert.equal(questionRefuseeEnCoulisses(agent.id), null, 'ses questions passent : personne ne le met en coulisses');
  assert.equal(communication.campagneMeneeParSonAgent(campagne.id), true);
  const detail = communication.lireCampagne(marque.id, campagne.id, admin) as any;
  assert.equal(detail.agentId, agent.id);
  assert.equal(detail.strategieManquante.length, RUBRIQUES_DE_STRATEGIE.length);

  /* « Nouvelle campagne » : la campagne et son agent naissent au premier message, sans mot d'accueil. */
  process.env.BELUGA_AGENT_DE_CAMPAGNE_SANS_MOTEUR = '1';
  const r = (await communication.jouerUnGeste({ geste: 'campagne.creer', id: marque.id, texte: 'Une série de vidéos pour présenter nos tutos. Sur Instagram.' }, admin)) as any;
  const nee = communication.lireCampagne(marque.id, r.campagneId, admin) as any;
  assert.equal(nee.campagne.statut, 'preparation');
  assert.equal(nee.campagne.titre, 'Une série de vidéos pour présenter nos tutos');
  assert.equal(nee.agentId, r.agentId);
  const messages = store.listMessages(r.agentId, 5);
  assert.equal(messages.length, 1, 'la bulle de la personne, sans mot d’accueil');
  assert.equal(messages[0]!.role, 'user');
  await assert.rejects(() => communication.jouerUnGeste({ geste: 'campagne.creer', id: marque.id, texte: '   ' }, admin), /Décrivez/);
});
