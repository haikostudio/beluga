import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE VISUEL VIVANT D'UNE CAMPAGNE (carte « Visuel vivant pendant la création de campagne », 10/11/2026).
 *
 *  - l'agent de campagne dessine une ESQUISSE gratuite, sans attendre : elle rejoint sa discussion ;
 *  - la dernière esquisse devient l'image de la campagne, tant qu'aucune image ni aucun vrai visuel ne la remplace ;
 *  - ni les esquisses ni les maquettes d'un choix n'entrent dans le Studio ou dans Médias ;
 *  - la consigne de l'agent illustre ses questions et dessine après chaque grande étape.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'esquisses-de-campagne-'));
process.env.BELUGA_DATA = bacASable;
process.env.BELUGA_IMAGE_GRATUITE_FACTICE = '1';

const shared = await import('@beluga/shared');
const { Project, Agent, SERVICE_DU_DIRECTEUR, pieceDeConception, apercuDeCampagne, nomDEsquisse, consigneDuChef } = shared;
const store = await import('../store.js');
const marketing = await import('../marketing.js');
const communication = await import('../communication.js');
const { joindreUnFichier } = await import('../joindre-fichier.js');
const { dessinerUneEsquisse } = await import('../esquisses-de-campagne.js');
const { mediasEnFabrication } = await import('../medias-en-fabrication.js');
const { cheminDePieceJointe } = await import('../pieces-jointes.js');

const admin = { id: 'admin', role: 'admin', projets: [] } as any;

/** Attend que plus aucun bloc de l'agent ne soit en fabrication. */
async function esquissesTerminees(agentId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (!mediasEnFabrication().some((m) => m.agentId === agentId && m.etat === 'en-cours')) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('esquisse jamais terminée');
}

test('une pièce de conception se reconnaît par son nom ou son outil, jamais un vrai visuel', () => {
  assert.equal(pieceDeConception({ nom: nomDEsquisse(3) }), true);
  assert.equal(pieceDeConception({ nom: 'exemple-B.png' }), true);
  assert.equal(pieceDeConception({ outil: 'Page photographiée sur le serveur' }), true);
  assert.equal(pieceDeConception({ outil: shared.OUTIL_D_ESQUISSE }), true);
  assert.equal(pieceDeConception({ nom: 'visuel-noel.png', outil: 'Studio' }), false);
  assert.equal(pieceDeConception({ nom: 'exemple de visuel.png' }), false);
});

test("l'image d'une campagne : la sienne, puis son premier visuel, et à défaut sa dernière esquisse", () => {
  assert.equal(apercuDeCampagne('img', 'visuel', 'esq'), 'img');
  assert.equal(apercuDeCampagne(null, 'visuel', 'esq'), 'visuel');
  assert.equal(apercuDeCampagne(null, undefined, 'esq'), 'esq');
  assert.equal(apercuDeCampagne(null, null, null), null);
});

test("l'esquisse rejoint la discussion sans bloquer, devient l'image de la campagne et reste hors de Médias", async () => {
  const projetId = store.newId();
  store.saveProject(Project.parse({ id: projetId, name: 'Esquisses', path: path.join(bacASable, projetId), createdAt: Date.now(), updatedAt: Date.now() }));
  marketing.assurerEspace(projetId);
  const marque = communication.creerMarque({ nom: 'Esquisses', origine: 'projets', projets: [projetId] }, admin);
  const campagne = communication.ecrireCampagne({ marqueId: marque.id, titre: 'Rentrée', statut: 'preparation' }, admin);
  const agent = store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: projetId,
      role: 'task',
      title: 'Rentrée',
      workdir: bacASable,
      run: { engine: 'claude' },
      status: 'running',
      service: { id: SERVICE_DU_DIRECTEUR, nom: 'Communication', adresse: `communication/${marque.id}/campagnes/${campagne.id}` },
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );

  const vide = dessinerUneEsquisse({ agentId: agent.id, campagneId: campagne.id, titreDeCampagne: 'Rentrée', consigne: '  ' });
  assert.equal(vide.ok, false, 'une esquisse sans description est refusée');

  const r = dessinerUneEsquisse({ agentId: agent.id, campagneId: campagne.id, titreDeCampagne: 'Rentrée', consigne: 'A bright school bag on a desk, brand purple' });
  assert.equal(r.ok, true);
  assert.match(r.text, /N’attends pas/, "l'outil rend la main aussitôt");
  const bloc = mediasEnFabrication().find((m) => m.agentId === agent.id);
  assert.ok(bloc, 'un bloc d’attente paraît au bas de la discussion');
  assert.equal(bloc!.suivi, 'service', 'le démon le tient : la fin du tour ne le ferme pas');
  await esquissesTerminees(agent.id);

  const fini = mediasEnFabrication().find((m) => m.id === bloc!.id);
  assert.equal(fini?.etat, 'fini');
  const premiere = communication.esquisseDeCampagne(campagne.id);
  assert.ok(premiere && fini?.attachmentId === premiere, 'la pièce du bloc est l’esquisse retenue');
  assert.equal(store.getAttachment(premiere!)?.name, nomDEsquisse(1));

  dessinerUneEsquisse({ agentId: agent.id, campagneId: campagne.id, titreDeCampagne: 'Rentrée', consigne: 'Same idea, warmer light' });
  await esquissesTerminees(agent.id);
  const seconde = communication.esquisseDeCampagne(campagne.id);
  assert.notEqual(seconde, premiere, 'la dernière esquisse remplace la précédente');
  assert.equal(store.getAttachment(seconde!)?.name, nomDEsquisse(2));

  const liste = communication.lireCampagnes(marque.id, admin) as any;
  assert.equal(liste.campagnes.find((c: any) => c.id === campagne.id).apercu, seconde, 'la liste montre la dernière esquisse');

  /* Une maquette de choix jointe par le même agent ne va pas davantage dans Médias. */
  const fichier = path.join(bacASable, 'maquette.png');
  fs.writeFileSync(fichier, Buffer.concat([fs.readFileSync(cheminDePieceJointe(store.getAttachment(premiere!)! as any)), Buffer.from('maquette')]));
  const maquette = await joindreUnFichier({ projectId: projetId, agentId: agent.id, fichier, nom: 'exemple-A.png', deLAgent: true });
  assert.equal(maquette.ok, true);

  assert.equal(communication.rangerLesMediasDesChefsDansLeStudio([projetId]), 0, 'ni esquisse ni maquette ne rejoint le Studio');
  const medias = communication.lireMedias(marque.id, admin) as any;
  const pieces = new Set(medias.medias.flatMap((m: any) => [m.attachmentId, ...(m.versions ?? []).map((v: any) => v.attachmentId)]));
  assert.equal(pieces.has(premiere), false, 'la première esquisse n’est pas dans Médias');
  assert.equal(pieces.has(seconde), false, 'la dernière esquisse n’est pas dans Médias');

  /* Une image posée par ailleurs garde la main sur l'esquisse. */
  communication.ecrireCampagne({ marqueId: marque.id, id: campagne.id, image: 'image-choisie' }, admin);
  const apres = communication.lireCampagnes(marque.id, admin) as any;
  assert.equal(apres.campagnes.find((c: any) => c.id === campagne.id).apercu, 'image-choisie');
});

test("la consigne de l'agent de campagne illustre ses questions et dessine après chaque grande étape", () => {
  const consigne = consigneDuChef('campagne');
  assert.match(consigne, /exemple_de_choix/);
  assert.match(consigne, /nature « page »/);
  assert.match(consigne, /action « esquisse »/);
  assert.match(consigne, /Tu NE DEMANDES PAS d'abord si la personne veut des exemples/);
  assert.match(consigne, /action « image »/);
  assert.match(consigne, /nouvelle fenêtre/);
  assert.doesNotMatch(consigne, /Ne fabrique AUCUN visuel à ce stade/);
});
