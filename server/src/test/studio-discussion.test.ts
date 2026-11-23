import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LE STUDIO AVANCE PAR QUESTIONS ET RÉPONSES (demande du 01/11/2026, capture
 * #6db2) : la consigne fixe l'ordre du directeur et interdit de renvoyer vers un
 * bouton ; la voix finale et le personnage 3D se proposent dans le fil, et seul
 * le clic exact sur « Générer » dépense.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-discussion-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { AgentQuestion, CONSIGNE_STUDIO_SANS_ETAPES, Project, consigneDuQuestionnaire, depenseAccordeeParLaReponse, validationNonBloquante, choixArrete, REPONSE_GENERER_LE_LOT, REPONSE_REFUSER_LE_LOT } = shared;
const store = await import('../store.js');
const studio = await import('../studio.js');
const { trancherLaDepenseDuFil } = await import('../studio-depense-du-fil.js');

const projet = store.saveProject(Project.parse({ id: 'p-disc', name: 'Discussion', path: bacASable, createdAt: 1, updatedAt: 1 }));
const cree = studio.creerCreation({ projectId: projet.id });
assert.ok(cree.ok);
const creationId = cree.creation.id;
const depense3d = () =>
  studio.creerDepense({ projectId: projet.id, creationId, genre: 'modele3d', modele: 'meshy', plafond: 1.2, raison: 'Personnage', details: { nom: 'x', duFil: true }, demandeePar: 'agent' });

test('la consigne : la nouvelle fabrication n’est pas une retouche, l’ordre est dit, aucun renvoi vers un bouton', () => {
  assert.match(CONSIGNE_STUDIO_SANS_ETAPES, /un NOUVEAU média payant.*N’EST JAMAIS une retouche/);
  assert.match(CONSIGNE_STUDIO_SANS_ETAPES, /\(1\) si aucun style.*\(3\).*« chiffrer ».*\(4\) DANS LE MÊME TOUR.*« devis » avec « variantes ».*« lot ».*\(5\).*« choisir »/);
  assert.match(CONSIGNE_STUDIO_SANS_ETAPES, /n’écris JAMAIS « cliquez sur Valider », « envoyez-moi un mot », « Valider la voix »/);
  assert.match(CONSIGNE_STUDIO_SANS_ETAPES, /Une réponse écrite à une proposition ne lance jamais rien/);
});

test('le style se demande avant la première fabrication dans le Studio, avant le brief sur le tableau, jamais une fois retenu', () => {
  const dansLeStudio = consigneDuQuestionnaire({ medias: ['video'], document: '', sansEtapes: true });
  assert.match(dansLeStudio, /1 sexies\. LE STYLE, AVANT LA PREMIÈRE FABRICATION PAYANTE/);
  assert.match(consigneDuQuestionnaire({ medias: ['video'], document: '' }), /1 sexies\. LE STYLE, JUSTE APRÈS LE TYPE/);
  assert.match(consigneDuQuestionnaire({ medias: ['video'], document: '', sansEtapes: true, style: shared.STYLES_DE_REALISATION[0]!.id }), /Ne le redemande pas/);
});

test('dans le Studio, le type se dit dans la discussion : plus aucun renvoi vers le bouton caméra', () => {
  const avecType = consigneDuQuestionnaire({ medias: ['video'], document: '', sansEtapes: true });
  const sansType = consigneDuQuestionnaire({ document: '', sansEtapes: true });
  assert.match(sansType, /demande-le d’abord avec « ask_user ».*« production » action « type »/);
  for (const c of [avecType, sansType]) assert.doesNotMatch(c, /bouton caméra/i);
  /* Le bouton caméra a disparu partout (11/11/2026) : les cartes du tableau confirment le type dans la discussion aussi. */
  assert.doesNotMatch(consigneDuQuestionnaire({ document: '' }), /bouton caméra/i);
});

test('la proposition du fil traverse le schéma, ne bloque personne, et les anciennes questions restent lisibles', () => {
  const q = AgentQuestion.parse({ id: 'q1', question: 'Générer ?', kind: 'text', options: [], depenseDuFil: { genre: 'voix', creationId, plafond: 0.4 } });
  assert.equal(q.depenseDuFil?.plafond, 0.4);
  assert.equal(validationNonBloquante(q), true);
  assert.equal(AgentQuestion.parse({ id: 'q2', question: 'Ancienne', options: [] }).depenseDuFil, undefined);
});

test('seul le libellé exact du bouton accorde ; une phrase écrite ne dépense jamais', () => {
  assert.equal(depenseAccordeeParLaReponse(REPONSE_GENERER_LE_LOT), true);
  for (const phrase of ['oui', 'Oui, génère', 'Générer mais moins cher', REPONSE_REFUSER_LE_LOT, '']) assert.equal(depenseAccordeeParLaReponse(phrase), false, phrase);
  assert.equal(choixArrete('On arrête'), true);
  assert.equal(choixArrete('B — version 2'), false);
});

test('personnage 3D : une phrase ou « Refuser » refuse sans lancer ; la dépense ne se décide qu’une fois', async () => {
  const d = depense3d();
  const fait = await trancherLaDepenseDuFil({ genre: 'modele3d', creationId, plafond: 1.2, depenseId: d.id }, 'oui vas-y');
  assert.ok(fait.ok);
  assert.equal(studio.lireDepense(d.id)!.etat, 'refusee');
  const encore = await trancherLaDepenseDuFil({ genre: 'modele3d', creationId, plafond: 1.2, depenseId: d.id }, REPONSE_GENERER_LE_LOT);
  assert.equal(encore.ok, false, 'une dépense décidée ne repart jamais');
  assert.equal(studio.lireDepense(d.id)!.etat, 'refusee');
});

test('personnage 3D : le clic valide la dépense et la lance une seule fois', async () => {
  const d = depense3d();
  const clic = await trancherLaDepenseDuFil({ genre: 'modele3d', creationId, plafond: 1.2, depenseId: d.id }, REPONSE_GENERER_LE_LOT);
  assert.ok(clic.ok);
  assert.notEqual(studio.lireDepense(d.id)!.etat, 'en-attente');
  assert.equal((await trancherLaDepenseDuFil({ genre: 'modele3d', creationId, plafond: 1.2, depenseId: d.id }, REPONSE_GENERER_LE_LOT)).ok, false);
});

test('voix finale : le refus ne crée aucune dépense ; une voix déjà en fabrication refuse un second clic', async () => {
  const avant = studio.listerDepenses(creationId).filter((d) => d.genre === 'voix').length;
  assert.ok((await trancherLaDepenseDuFil({ genre: 'voix', creationId, plafond: 0.4 }, REPONSE_REFUSER_LE_LOT)).ok);
  assert.equal(studio.listerDepenses(creationId).filter((d) => d.genre === 'voix').length, avant);
  studio.creerDepense({ projectId: projet.id, creationId, genre: 'voix', modele: 'm', plafond: 0.4, raison: 'prise', etat: 'validee', details: {}, demandeePar: 'humain' });
  const second = await trancherLaDepenseDuFil({ genre: 'voix', creationId, plafond: 0.4 }, REPONSE_GENERER_LE_LOT);
  assert.ok(!second.ok && /déjà en fabrication/.test(second.raison));
  assert.equal(studio.listerDepenses(creationId).filter((d) => d.genre === 'voix').length, avant + 1, 'aucune seconde dépense');
});
